#!/usr/bin/env python3
"""Cache genuine ECMWF IFS hourly fields for the free static weather studio.

A shared 1-degree display mesh avoids hundreds of API calls for every visitor.
The upstream model is IFS 0.25 degree; display interpolation adds no resolution.
Refresh at most every six hours, retaining only actual previous forecasts on error.
"""
import json
import math
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

ENDPOINT='https://api.open-meteo.com/v1/forecast'
GRID={'west':60,'east':78,'south':23,'north':38,'columns':19,'rows':16,'spacing_degrees':1}
LEVELS=('surface','850','500','250')
FIELDS=['temperature_2m','relative_humidity_2m','wind_speed_10m','wind_direction_10m','cloud_cover','surface_pressure']
for pressure in LEVELS[1:]:
    FIELDS.extend(f'{field}_{pressure}hPa' for field in ('temperature','relative_humidity','wind_speed','wind_direction'))

def number(value,low,high):
    return round(value,3) if type(value) in (int,float) and math.isfinite(value) and low<=value<=high else None

def utc(stamp):
    # Open-Meteo explicitly returns UTC when timezone=UTC is requested.
    return datetime.fromisoformat(stamp).replace(tzinfo=timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z')

def coordinates(grid=GRID):
    return [(grid['south']+y*(grid['north']-grid['south'])/(grid['rows']-1),grid['west']+x*(grid['east']-grid['west'])/(grid['columns']-1)) for y in range(grid['rows']) for x in range(grid['columns'])]

def build(points,coords,grid=GRID):
    if len(points)!=len(coords) or len(points)!=grid['columns']*grid['rows']:
        raise ValueError('Missing forecast points')
    times=[utc(t) for t in points[0].get('hourly',{}).get('time',[])]
    if len(times)<24 or any(datetime.fromisoformat(b.replace('Z','+00:00')).timestamp()-datetime.fromisoformat(a.replace('Z','+00:00')).timestamp()!=3600 for a,b in zip(times,times[1:])):
        raise ValueError('Invalid hourly forecast axis')
    count=len(coords)
    levels={level:{key:[[None]*count for _ in times] for key in ('temperature','humidity','u','v')} for level in LEVELS}
    clouds=[[None]*count for _ in times]
    for index,(point,(lat,lon)) in enumerate(zip(points,coords)):
        if abs(point.get('latitude',999)-lat)>.26 or abs(point.get('longitude',999)-lon)>.26:
            raise ValueError('Provider returned an unexpected model cell')
        hourly=point.get('hourly',{});units=point.get('hourly_units',{})
        if [utc(t) for t in hourly.get('time',[])]!=times or point.get('utc_offset_seconds')!=0:
            raise ValueError('Inconsistent forecast times')
        for field in FIELDS:
            if len(hourly.get(field,[]))!=len(times): raise ValueError('Missing forecast field')
            unit='m/s' if field.startswith('wind_speed') else '°' if field.startswith('wind_direction') else '°C' if field.startswith('temperature') else 'hPa' if field=='surface_pressure' else '%'
            if units.get(field)!=unit: raise ValueError('Unexpected provider units')
        for t in range(len(times)):
            clouds[t][index]=number(hourly['cloud_cover'][t],0,100)
            surface_pressure=number(hourly['surface_pressure'][t],100,1100)
            for level in LEVELS:
                # Do not plot extrapolated pressure-level weather below ground.
                if level!='surface' and (surface_pressure is None or float(level)>surface_pressure): continue
                suffix='2m' if level=='surface' else level+'hPa'
                temp=number(hourly['temperature_'+suffix][t],-120,70)
                rh=number(hourly['relative_humidity_'+suffix][t],0,100)
                suffix='10m' if level=='surface' else level+'hPa'
                speed=number(hourly['wind_speed_'+suffix][t],0,200)
                direction=number(hourly['wind_direction_'+suffix][t],0,360)
                fields=levels[level];fields['temperature'][t][index]=temp;fields['humidity'][t][index]=rh
                if speed is not None and (direction is not None or speed==0):
                    angle=math.radians(direction or 0)
                    fields['u'][t][index]=round(-speed*math.sin(angle),4)
                    fields['v'][t][index]=round(-speed*math.cos(angle),4)
    if any(not any(value is not None for row in levels[level]['u'] for value in row) for level in LEVELS):
        raise ValueError('A wind level has no actual forecast values')
    return {'schema_version':1,'model':'ecmwf_ifs025','source':'ECMWF IFS via Open-Meteo','source_url':ENDPOINT,
            'retrieved_at':datetime.now(timezone.utc).isoformat(),'status':'updated','grid':grid,
            'times':times,'levels':levels,'cloud_cover':clouds,
            'units':{'temperature':'°C','humidity':'%','u':'m/s','v':'m/s','cloud_cover':'%'},
            'notes':'1° display sampling of the 0.25° model. Cloud cover is total column, not pressure-level cloud. Below-terrain pressure levels are masked. Model initialization time is not supplied by this API.'}

def get(url):
    for attempt in range(3):
        try:
            with urlopen(Request(url,headers={'User-Agent':'BadalPK/1.0 (shared non-commercial forecast studio)'}),timeout=60) as response:
                return json.load(response)
        except HTTPError as error:
            if error.code not in (429,502,503,504) or attempt==2: raise
            delay=min(40,max(2,int(error.headers.get('Retry-After','20'))));time.sleep(delay)

def valid_previous(data):
    return data.get('model')=='ecmwf_ifs025' and data.get('schema_version')==1 and data.get('times') and data.get('levels') and data.get('grid')==GRID

def sync(path):
    old=None
    if path.exists():
        try:
            candidate=json.loads(path.read_text())
            if valid_previous(candidate): old=candidate
        except (ValueError,OSError): pass
    previous=os.environ.get('PREVIOUS_STUDIO_URL','')
    if previous and urlsplit(previous).hostname=='goharayub3909-stack.github.io':
        try:
            candidate=get(previous)
            if valid_previous(candidate) and (old is None or candidate['retrieved_at']>old['retrieved_at']): old=candidate
        except Exception: pass
    now=datetime.now(timezone.utc)
    if old:
        age=(now-datetime.fromisoformat(old['retrieved_at'].replace('Z','+00:00'))).total_seconds()
        if 0<=age<6*3600 and datetime.fromisoformat(old['times'][-1].replace('Z','+00:00'))>now:
            path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(old,separators=(',',':'))+'\n')
            print('Studio: reused actual forecast snapshot; next upstream refresh after six hours.');return True
    try:
        coords=coordinates();points=[]
        for start in range(0,len(coords),32):
            batch=coords[start:start+32]
            query={'latitude':','.join(str(p[0]) for p in batch),'longitude':','.join(str(p[1]) for p in batch),
                   'hourly':','.join(FIELDS),'models':'ecmwf_ifs025','forecast_hours':48,
                   'wind_speed_unit':'ms','timezone':'UTC','cell_selection':'nearest'}
            result=get(ENDPOINT+'?'+urlencode(query))
            if isinstance(result,dict): result=[result]
            if not isinstance(result,list) or len(result)!=len(batch): raise ValueError('Incomplete forecast batch')
            points.extend(result)
            print(f'Studio: fetched {len(points)}/{len(coords)} actual model cells',flush=True)
        data=build(points,coords);path.parent.mkdir(parents=True,exist_ok=True)
        temp=path.with_suffix('.tmp');temp.write_text(json.dumps(data,separators=(',',':'))+'\n');temp.replace(path)
        print('Studio: published',len(data['times']),'hourly frames at four elevations.');return True
    except Exception as error:
        if old:
            old={**old,'status':'cached','attempted_at':now.isoformat()};path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(old,separators=(',',':'))+'\n')
        print('Studio: forecast refresh unavailable ('+type(error).__name__+'); no fabricated data substituted.');return False

if __name__=='__main__': sync(Path('public/studio-data/forecast.json'))
