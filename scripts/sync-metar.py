"""Publish Pakistan airport observations from the free official NOAA METAR API."""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
import obs_qc

def quality_control(data, folder):
    """Quality control (scripts/obs_qc.py, rules in qc-rules.json): readings stay in the rows, flagged ones are marked in `qc`; the temperatures of the
    realtime.json stations (when that file is there) are the neighbours the airports are judged against. A failure never stops the refresh. Returns the summary or {}."""
    def load(name):
        try: return json.loads((folder/name).read_text(encoding='utf-8'))
        except (OSError, ValueError): return None
    try:
        now = datetime.now(timezone.utc)
        realtime = load('realtime.json')
        neighbours = obs_qc.realtime_temperature_neighbours(realtime, now.timestamp()*1000) if realtime else []
        report, state = obs_qc.qc_metar(data, (load('qc-state-metar.json') or {}).get('state', {}), neighbours)
        checked_at = now.isoformat()
        (folder/'qc-report-metar.json').write_text(json.dumps(dict(checked_at=checked_at, **report),separators=(',',':'))+'\n')
        (folder/'qc-state-metar.json').write_text(json.dumps(dict(version=1, saved_at=checked_at, state=state),separators=(',',':'))+'\n')
        print('QC:', report['summary']['checked'], 'METAR readings checked,', report['summary']['flagged'], 'flagged', report['summary']['by_rule'])
        return dict(checked_at=checked_at, rules_version=obs_qc.RULES['version'], **report['summary'])
    except Exception as e:
        print('QC unavailable:', type(e).__name__)
        return {}

def sanitize(rows):
    stations = {}
    keys = ('icaoId','obsTime','temp','dewp','wdir','wspd','wgst','altim','rawOb','lat','lon','name','clouds','wxString','visib','elev')
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
        qc = quality_control(data, path.parent)
        out = {'source':'NOAA Aviation Weather Center','retrieved_at':datetime.now(timezone.utc).isoformat(),'stations':data}
        if qc: out['qc'] = qc
        tmp=path.with_name(path.name+'.tmp'); tmp.write_text(json.dumps(out,separators=(',',':'))+'\n'); os.replace(tmp,path)      # replaced in one step: a reader (the 1 km step) never sees half a file
        print('Published Pakistan airport reports:',len(data))
    except Exception:
        print('METAR refresh unavailable; no new reports published.')
