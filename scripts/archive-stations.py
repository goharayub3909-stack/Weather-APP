"""Archive sanitized station snapshots in free GitHub Release assets.

Monthly releases hold one compressed JSONL asset per PKT day. Revisions are
uploaded before older revisions are removed, so cancellation cannot erase the
last successful archive. No login response, cookie or credential is archived.
"""
import csv,gzip,hashlib,json,math,os,subprocess,tempfile
from collections import defaultdict
from datetime import datetime,timedelta,timezone
from pathlib import Path

REPO='goharayub3909-stack/Weather-APP'
PKT=timezone(timedelta(hours=5))
FIELDS='id name lat lon network temperature humidity wind_speed wind_direction wind_gust_10min dew_point wet_bulb heat_index wind_chill solar_radiation uv_index visibility pressure rain_24h rain_daily rain_monthly rain_yearly rain_monsoon rain_rate rain_rate_instant rain_rate_max rain_rate_max_label rain_rate_max_observed_label rain_daily_period rain_24h_period rain_24h_observed_label observed_time_basis observed_at observed_label'.split()

def gh(*args):
    # stderr is deliberately not echoed; gh may include request details.
    result=subprocess.run(['gh',*args],capture_output=True,text=True)
    if result.returncode:raise RuntimeError('GitHub archive operation unavailable')
    return result.stdout

def release_tag(date):return 'station-history-'+date.strftime('%Y-%m')
def release(tag,create=False):
    try:return json.loads(gh('release','view',tag,'--repo',REPO,'--json','assets,url'))
    except RuntimeError:
        if not create:return {'assets':[]}
        gh('release','create',tag,'--repo',REPO,'--title','Pakistan station observations · '+tag[-7:],'--notes','Sanitized station observations collected by Badal PK from archive activation onward. PKT daily compressed JSONL. captured_at is download time; station.observed_at is provider observation time (or null). No historical readings are backfilled.','--latest=false')
        return json.loads(gh('release','view',tag,'--repo',REPO,'--json','assets,url'))

def unpack(path):
    with gzip.open(path,'rt',encoding='utf-8') as f:return [json.loads(line) for line in f if line.strip()]

def fingerprint(station):return hashlib.sha256(json.dumps(station,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def append_snapshot(records,snapshot,now):
    if snapshot.get('status')!='updated':return records,0
    seen={fingerprint(r['station']) for r in records};result=list(records);added=0
    for supplied in snapshot.get('stations',[]):
        station={k:supplied[k] for k in FIELDS if k in supplied}
        if not station.get('id') or not isinstance(station.get('name'),str):continue
        key=fingerprint(station)
        if key in seen:continue
        result.append({'captured_at':now.astimezone(PKT).isoformat(),'station':station});seen.add(key);added+=1
    return result,added

def parse_time(value):
    try:
        date=datetime.fromisoformat(value.replace('Z','+00:00'))
        return date if date.tzinfo is not None else None
    except (ValueError,AttributeError,TypeError):return None

def station_key(s):return hashlib.sha256('|'.join(str(s.get(k,'')) for k in ['network','id','lat','lon']).encode()).hexdigest()[:20]
def valid_number(value,low,high):return type(value) in (int,float) and math.isfinite(value) and low<=value<=high

def publish_recent(records,path,now,archive_url):
    path.mkdir(parents=True,exist_ok=True);anchor=now.astimezone(timezone.utc).replace(minute=0,second=0,microsecond=0);start=anchor-timedelta(hours=72)
    groups=defaultdict(dict);metadata={};captured=[]
    for record in records:
        s=record['station'];time=parse_time(s.get('observed_at'));capture=parse_time(record.get('captured_at'))
        if capture:captured.append(capture)
        if not valid_number(s.get('lat'),23,38) or not valid_number(s.get('lon'),60,78):continue
        key=station_key(s);metadata[key]=s
        if not time or not capture or time>now+timedelta(minutes=5) or time<start or time>=anchor:continue
        if not valid_number(s.get('temperature'),-90,65) or not valid_number(s.get('humidity'),0,100):continue
        hour=time.astimezone(timezone.utc).replace(minute=0,second=0,microsecond=0)
        previous=groups[key].get(hour)
        # Latest actual observation in an hour; revised same-time reports use
        # the latest capture. Do not average or forward-fill missing hours.
        if previous is None or (time,capture)>(previous[0],previous[1]):groups[key][hour]=(time,capture,s)
    activation=Path('public/station-archive-config.json')
    started=json.loads(activation.read_text()).get('started_at') if activation.exists() else None
    manifest={'schema_version':1,'source':'Archived WeatherWalay observations','published_at':now.astimezone(PKT).isoformat(),'archive_started_at':started or (min(captured).isoformat() if captured else None),'recent_window_started_at':min(captured).isoformat() if captured else None,'archive_url':archive_url,'time_note':'Provider observation time and collection time are separate. One latest observed sample per completed hour; no missing hours are filled. Permanent archive activation and earliest capture in the recent download window are recorded separately.','stations':[]}
    for key,s in metadata.items():
        rows=sorted(groups[key].items());h={'time':[],'temperature_2m':[],'relative_humidity_2m':[],'observed_at':[],'captured_at':[]}
        for hour,(time,capture,row) in rows:
            h['time'].append(hour.isoformat());h['temperature_2m'].append(row['temperature']);h['relative_humidity_2m'].append(row['humidity']);h['observed_at'].append(time.isoformat());h['captured_at'].append(capture.isoformat())
        name=key+'.json';data={'schema_version':1,'station':{k:s.get(k) for k in ['id','name','lat','lon','network','observed_time_basis']},'hourly':h}
        (path/name).write_text(json.dumps(data,separators=(',',':'))+'\n')
        manifest['stations'].append({'name':s['name'],'lat':s['lat'],'lon':s['lon'],'hours':len(rows),'file':name,'network':s.get('network')})
    (path/'index.json').write_text(json.dumps(manifest,separators=(',',':'))+'\n')
    with (path/'recent.csv').open('w',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=['captured_at',*FIELDS]);writer.writeheader()
        for r in records:
            row={'captured_at':r['captured_at'],**{k:r['station'].get(k) for k in FIELDS}}
            writer.writerow({k:("'"+v if isinstance(v,str) and v.startswith(('=','+','-','@')) else v) for k,v in row.items()})
    return manifest

def main():
    now=datetime.now(timezone.utc);today=now.astimezone(PKT).date();tag=release_tag(today);snapshot=json.loads(Path('public/observation-data/stations.json').read_text())
    with tempfile.TemporaryDirectory() as tmp:
        root=Path(tmp);releases={};daily={}
        for days in range(4):
            date=today-timedelta(days=days);day_tag=release_tag(date)
            if day_tag not in releases:releases[day_tag]=release(day_tag,create=snapshot.get('status')=='updated' and day_tag==tag)
            prefix='stations-'+date.isoformat()+'__';assets=[a for a in releases[day_tag]['assets'] if a['name'].startswith(prefix) and a['name'].endswith('.jsonl.gz')]
            if assets:
                latest=max(assets,key=lambda a:a['name']);gh('release','download',day_tag,'--repo',REPO,'--pattern',latest['name'],'--dir',str(root));daily[date]=unpack(root/latest['name'])
            else:daily[date]=[]
        records,added=append_snapshot(daily[today],snapshot,now);daily[today]=records
        if added:
            name='stations-'+today.isoformat()+'__'+now.strftime('%Y%m%dT%H%M%S%fZ')+'.jsonl.gz';asset=root/name
            with gzip.open(asset,'wt',encoding='utf-8') as f:
                for record in records:f.write(json.dumps(record,separators=(',',':'))+'\n')
            gh('release','upload',tag,str(asset),'--repo',REPO)
            # Upload succeeded: deleting previous revisions is now safe. If
            # cleanup is interrupted, the next run chooses the newest revision.
            for a in releases[tag]['assets']:
                if a['name'].startswith('stations-'+today.isoformat()+'__') and a['name'].endswith('.jsonl.gz'):gh('release','delete-asset',tag,a['name'],'--repo',REPO,'--yes')
        manifest=publish_recent([r for date in sorted(daily) for r in daily[date]],Path('public/station-history'),now,'https://github.com/'+REPO+'/releases/tag/'+tag)
        print('Station archive:',added,'new distinct records;',len(records),'records in PKT day;',len(manifest['stations']),'station histories indexed.')

if __name__=='__main__':main()
