"""Publish whitelisted WeatherWalay station observations, never login/session data.

The authenticated app uses /feed/current with a session bootstrap token and a
per-response column permutation. Both remain in memory. Field meanings were
verified against the provider's MapboxReport.js current-parameter selectors.
"""
import http.cookiejar
import json
import math
import os
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlencode, urljoin, urlsplit
from urllib.request import build_opener, HTTPCookieProcessor, Request, urlopen

ORIGIN='https://forecasting.weatherwalay.com'

def numeric(value, low, high):
    return value if type(value) in (int,float) and math.isfinite(value) and low <= value <= high else None

def observation_time(raw,feed_time=None):
    if not isinstance(raw,str): return None,None
    if re.fullmatch(r'\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)',raw):
        try:return datetime.fromisoformat(raw.replace('Z','+00:00')).isoformat(),'Explicit provider timestamp'
        except ValueError:return None,None
    # The site is explicitly PKT. A yearless display label can be aligned to
    # the authenticated feed's full timestamp only within a bounded 48h window.
    if not isinstance(feed_time,str):return None,None
    try:
        anchor=datetime.fromisoformat(feed_time.replace('Z','+00:00')).astimezone(timezone(timedelta(hours=5)))
        for year in (anchor.year,anchor.year-1,anchor.year+1):
            stamp=datetime.strptime(raw.strip().upper()+f' {year}','%I:%M %p, %d %B %Y').replace(tzinfo=anchor.tzinfo)
            if -300<=(anchor-stamp).total_seconds()<=48*3600:return stamp.isoformat(),'PKT interpretation; year aligned to feed timestamp'
    except (ValueError,TypeError):pass
    return None,None

def sanitize(rows, perm, feed_time=None):
    if not isinstance(perm,list) or sorted(perm)!=list(range(len(perm))) or len(perm)<162:
        raise ValueError('Unsupported station schema')
    result=[]
    for wire in rows:
        if not isinstance(wire,list) or len(wire)!=len(perm): continue
        row=[None]*len(perm)
        for i,index in enumerate(perm): row[index]=wire[i]
        lat,lon=numeric(row[2],23,38),numeric(row[3],60,78)
        if lat is None or lon is None or not isinstance(row[1],str): continue
        source=str(row[4] or '')[:40]
        # Neighboring IMD observations are outside this Pakistan station layer.
        if 'IMD' in source.upper(): continue
        raw_time=row[161] if isinstance(row[161],str) else None
        observed_at,basis=observation_time(raw_time,feed_time)
        result.append({'id':str(row[0])[:60],'name':row[1][:120],'lat':lat,'lon':lon,'network':source,
                       'temperature':numeric(row[5],-90,65),'humidity':numeric(row[73],0,100),
                       'wind_speed':numeric(row[91],0,500),'wind_direction':numeric(row[92],0,360),
                       'wind_gust_10min':numeric(row[95],0,500),'dew_point':numeric(row[25],-100,65),
                       'heat_index':numeric(row[41],-100,90),'wind_chill':numeric(row[49],-120,70),
                       'solar_radiation':numeric(row[86],0,2000),'uv_index':numeric(row[81],0,30),
                       'visibility':numeric(row[164],0,200000) if len(row)>164 else None,
                       'pressure':numeric(row[127],300,1100),
                       'rain_24h':numeric(row[105],0,5000),'rain_daily':numeric(row[106],0,5000),
                       'rain_monthly':numeric(row[107],0,30000),'rain_yearly':numeric(row[108],0,100000),
                       'rain_monsoon':numeric(row[109],0,30000),'rain_rate':numeric(row[121],0,3000),
                       'rain_rate_instant':numeric(row[122],0,3000),'rain_rate_max':numeric(row[123],0,3000),
                       'rain_rate_max_label':str(row[124])[:100] if row[124] is not None else None,
                       'rain_daily_period':'02:00–02:00 PKT (provider day)' if source.upper()=='PMD' else '00:00–00:00 PKT (provider day)',
                       'rain_24h_period':'08:00–08:00 PKT' if source.upper()=='PMD' else '24 hours before station sync',
                       'rain_24h_observed_label':str(row[13])[:100] if source.upper()=='PMD' and row[13] is not None else raw_time,
                       'observed_time_basis':basis,
                       'observed_at':observed_at,'observed_label':raw_time[:100] if raw_time else None})
    return result

def retrieve():
    username=os.environ.get('WEATHERWALAY_USERNAME');password=os.environ.get('WEATHERWALAY_PASSWORD')
    if not username or not password: raise ValueError('Missing repository secrets')
    opener=build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
    opener.open(ORIGIN+'/login',timeout=30).read()
    opener.open(Request(ORIGIN+'/login',data=urlencode({'username':username,'password':password}).encode()),timeout=30).read()
    response=opener.open(ORIGIN+'/realtime',timeout=30)
    html=response.read(5_000_000).decode()
    if urlsplit(response.url).path=='/login': raise ValueError('Login unavailable')
    match=re.search(r'(?:window\.)?__WW_BOOT__\s*=\s*(\{[^;]+\})\s*;',html)
    if not match: raise ValueError('Station bootstrap unavailable')
    boot=json.loads(match.group(1));endpoint=urljoin(ORIGIN,boot.get('endpoint','/feed/current'))
    if urlsplit(endpoint).hostname!='forecasting.weatherwalay.com': raise ValueError('Unexpected endpoint')
    response=opener.open(Request(endpoint,headers={'X-Requested-With':'XMLHttpRequest','X-WW-Token':boot.get('token','')}),timeout=40)
    payload=json.loads(response.read(20_000_000));stations=sanitize(payload.get('rows',[]),boot.get('perm',[]),payload.get('lastUpdateTime'))
    if not stations: raise ValueError('No valid station observations')
    return {'source':'WeatherWalay realtime','retrieved_at':datetime.now(timezone.utc).isoformat(),'status':'updated',
            'time_note':'Yearless station labels use PKT and are aligned to the authenticated feed timestamp only within 48 hours; time basis is recorded per station. Download time does not establish observation freshness.',
            'rain_note':'Weekly totals are not supplied. Daily: PMD 02–02 PKT, AWS 00–00 PKT; last 24h: PMD 08–08, AWS rolling before sync. Monthly/yearly/monsoon are provider totals, not normals or departures.',
            'stations':stations}

if __name__=='__main__':
    path=Path('public/observation-data/stations.json');path.parent.mkdir(exist_ok=True)
    previous=os.environ.get('PREVIOUS_STATIONS_URL','')
    if previous and urlsplit(previous).hostname=='goharayub3909-stack.github.io':
        try:
            with urlopen(previous,timeout=20) as r: old=json.load(r)
            if old.get('source')=='WeatherWalay realtime' and isinstance(old.get('stations'),list):
                # Already-published sanitized data only, not an authenticated response.
                path.write_text(json.dumps(old,separators=(',',':'))+'\n')
        except Exception: pass
    try:
        result=retrieve();path.write_text(json.dumps(result,separators=(',',':'))+'\n')
        print('Published Pakistan station records:',len(result['stations']))
    except Exception:
        # Never print exception text: URLs, session headers or login content may leak.
        if path.exists():
            old=json.loads(path.read_text());old['status']='cached';path.write_text(json.dumps(old,separators=(',',':'))+'\n')
        print('WeatherWalay refresh unavailable; no new station observations published.')
