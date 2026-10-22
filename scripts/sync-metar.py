"""Publish Pakistan airport observations from the free official NOAA METAR API."""
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

def sanitize(rows):
    stations = {}
    keys = ('icaoId','obsTime','temp','dewp','wdir','wspd','wgst','altim','rawOb','lat','lon','name','clouds')
    for row in rows:
        code = row.get('icaoId', '')
        if not code.startswith('OP') or len(code) != 4: continue
        lat, lon = row.get('lat'), row.get('lon')
        if not isinstance(lat,(float,int)) or not isinstance(lon,(float,int)) or not 23 <= lat <= 38 or not 60 <= lon <= 78: continue
        if not isinstance(row.get('obsTime'),(int,float)): continue
        if row['obsTime'] <= stations.get(code,{}).get('obsTime',0): continue
        stations[code] = {k:row.get(k) for k in keys}
    return list(stations.values())

if __name__ == '__main__':
    path=Path('public/observation-data/metar.json');path.parent.mkdir(exist_ok=True)
    try:
        request=Request('https://aviationweather.gov/api/data/metar?bbox=23,60,38,78&format=json&hours=3',headers={'User-Agent':'MonsoonWeather/1.0'})
        with urlopen(request,timeout=40) as r: rows=json.load(r)
        data=sanitize(rows)
        if not data: raise ValueError('No valid Pakistan observations')
        path.write_text(json.dumps({'source':'NOAA Aviation Weather Center','retrieved_at':datetime.now(timezone.utc).isoformat(),'stations':data},separators=(',',':'))+'\n')
        print('Published Pakistan airport reports:',len(data))
    except Exception:
        print('METAR refresh unavailable; no new reports published.')
