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
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode, urljoin, urlsplit
from urllib.request import build_opener, HTTPCookieProcessor, Request, urlopen

ORIGIN='https://forecasting.weatherwalay.com'

def numeric(value, low, high):
    return value if type(value) in (int,float) and math.isfinite(value) and low <= value <= high else None

def sanitize(rows, perm):
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
        observed_at=None
        if raw_time and re.fullmatch(r'\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)',raw_time):
            try: observed_at=datetime.fromisoformat(raw_time.replace('Z','+00:00')).isoformat()
            except ValueError: pass
        result.append({'id':str(row[0])[:60],'name':row[1][:120],'lat':lat,'lon':lon,'network':source,
                       'temperature':numeric(row[5],-90,65),'humidity':numeric(row[73],0,100),
                       'wind_speed':numeric(row[91],0,500),'wind_direction':numeric(row[92],0,360),
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
    payload=json.loads(response.read(20_000_000));stations=sanitize(payload.get('rows',[]),boot.get('perm',[]))
    if not stations: raise ValueError('No valid station observations')
    return {'source':'WeatherWalay realtime','retrieved_at':datetime.now(timezone.utc).isoformat(),'status':'updated',
            'time_note':'Provider display times may omit year/timezone. No year or timezone is inferred.',
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
