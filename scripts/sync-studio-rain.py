"""Shared 0.5° ECMWF rain display grid, refreshed at most twice daily.

This samples the real 0.25° model more finely than the wind studio's 1° mesh.
72 hours maintain coverage of the 48-hour studio between 12-hour refreshes.
"""
import json,os,time,math
from datetime import datetime,timedelta,timezone
from pathlib import Path
from urllib.parse import urlencode,urlsplit
from urllib.request import Request,urlopen
GRID={'west':60,'east':78,'south':23,'north':38,'columns':37,'rows':31,'spacing_degrees':.5}

def get(url):
    for attempt in range(3):
        try:
            with urlopen(Request(url,headers={'User-Agent':'BadalPK shared non-commercial rain display'}),timeout=60) as r:return json.load(r)
        except Exception:
            if attempt==2:raise
            time.sleep(20)

def valid(d):
    try:
        axis=[datetime.fromisoformat(t.replace('Z','+00:00')) for t in d['times']]
        return d.get('model')=='ecmwf_ifs025' and d.get('schema_version')==1 and d.get('grid')==GRID and d.get('units')=='mm' and len(axis)==72 and all(t.tzinfo is not None and (i==0 or (t-axis[i-1]).total_seconds()==3600) for i,t in enumerate(axis)) and datetime.fromisoformat(d['retrieved_at']).tzinfo is not None and len(d['rain'])==72 and all(len(row)==1147 and all(v is None or (type(v) in (int,float) and math.isfinite(v) and 0<=v<=500) for v in row) for row in d['rain'])
    except (KeyError,ValueError,TypeError,AttributeError):return False

def sync(path=Path('public/studio-data/rain.json')):
    old=None
    if path.exists():
        try:
            d=json.loads(path.read_text())
            if valid(d):old=d
        except Exception:pass
    previous=os.environ.get('PREVIOUS_RAIN_URL','')
    if urlsplit(previous).hostname=='goharayub3909-stack.github.io':
        try:
            d=get(previous)
            if valid(d) and (old is None or d['retrieved_at']>old['retrieved_at']):old=d
        except Exception:pass
    now=datetime.now(timezone.utc)
    if old and 0<=(now-datetime.fromisoformat(old['retrieved_at'])).total_seconds()<43200:
        path.parent.mkdir(exist_ok=True);path.write_text(json.dumps(old,separators=(',',':'))+'\n');print('Rain detail: reused actual 0.5 degree snapshot.');return True
    try:
        coords=[(23+y*.5,60+x*.5) for y in range(31) for x in range(37)];first=now.replace(minute=0,second=0,microsecond=0);times=None;frames=None
        for start in range(0,len(coords),8):
            batch=coords[start:start+8];q={'latitude':','.join(str(p[0]) for p in batch),'longitude':','.join(str(p[1]) for p in batch),'models':'ecmwf_ifs025','hourly':'rain','timezone':'UTC','cell_selection':'nearest','start_hour':first.strftime('%Y-%m-%dT%H:00'),'end_hour':(first+timedelta(hours=71)).strftime('%Y-%m-%dT%H:00')}
            data=get('https://api.open-meteo.com/v1/forecast?'+urlencode(q))
            if isinstance(data,dict):data=[data]
            if len(data)!=len(batch):raise ValueError('Incomplete batch')
            for j,(p,(lat,lon)) in enumerate(zip(data,batch)):
                h=p['hourly'];axis=[datetime.fromisoformat(t).replace(tzinfo=timezone.utc).isoformat().replace('+00:00','Z') for t in h['time']]
                if len(axis)!=72 or any(datetime.fromisoformat(t.replace('Z','+00:00'))!=first+timedelta(hours=k) for k,t in enumerate(axis)):raise ValueError('Hour axis mismatch')
                if abs(p['latitude']-lat)>.26 or abs(p['longitude']-lon)>.26 or p['hourly_units']['rain']!='mm' or p['utc_offset_seconds']!=0 or len(h['rain'])!=72:raise ValueError('Unexpected cell or units')
                if times is None:times=axis;frames=[[None]*len(coords) for _ in times]
                if times!=axis:raise ValueError('Mismatched times')
                for t,v in enumerate(h['rain']):frames[t][start+j]=v if type(v) in (int,float) and 0<=v<=500 else None
            print('Rain detail:',start+len(batch),'/',len(coords),'actual cells',flush=True)
            if start+len(batch)<len(coords):time.sleep(2)
        d={'schema_version':1,'model':'ecmwf_ifs025','source':'ECMWF IFS 0.25° via Open-Meteo','grid':GRID,'times':times,'rain':frames,'units':'mm','retrieved_at':datetime.now(timezone.utc).isoformat(),'status':'updated'}
        path.parent.mkdir(exist_ok=True);temp=path.with_suffix('.tmp');temp.write_text(json.dumps(d,separators=(',',':'))+'\n');temp.replace(path);print('Rain detail published: 1147 cells, 72 hours.');return True
    except Exception as error:
        if old:
            path.parent.mkdir(exist_ok=True);path.write_text(json.dumps(old,separators=(',',':'))+'\n')
        print('Rain detail refresh unavailable:',type(error).__name__,'; coarse actual forecast remains available.');return False
if __name__=='__main__':sync()
