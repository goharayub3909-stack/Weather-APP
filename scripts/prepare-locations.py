#!/usr/bin/env python3
"""Build a local Pakistan place index from GeoNames (CC BY 4.0)."""
import io,json,subprocess,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def build(zip_bytes,admin_text):
 pinned=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import{cities}from './public/cities.js';console.log(JSON.stringify(cities))"],cwd=ROOT,text=True))
 provinces={row.split('\t')[0]:row.split('\t')[1] for row in admin_text.splitlines() if row.startswith('PK.')}
 names={value[0].split(' / ')[0].casefold():(id,value) for id,value in pinned.items()}
 records=[];used=set()
 with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
  if archive.testzip() is not None:raise ValueError('GeoNames archive checksum failed')
  for line in archive.read('PK.txt').decode('utf-8').splitlines():
   parts=line.split('\t')
   if len(parts)<19 or parts[8]!='PK':continue
   feature,code=parts[6:8]
   if not (feature=='P' or (feature=='A' and code in ['ADM1','ADM2','ADM3']) or (feature=='T' and code in ['MT','PK','VAL'])):continue
   lat,lon=float(parts[4]),float(parts[5])
   if not(23<=lat<=38 and 60<=lon<=78):continue
   name=parts[2] or parts[1];id='gn:'+parts[0]
   match=names.get(name.casefold())
   if match and abs(match[1][1]-lat)<.25 and abs(match[1][2]-lon)<.25:id=match[0];used.add(id)
   aliases=','.join(dict.fromkeys([parts[1]]+parts[3].split(',')))[:400]
   records.append([id,name,round(lat,5),round(lon,5),provinces.get('PK.'+parts[10],''),int(parts[14] or 0),aliases,code])
 for id,(name,lat,lon) in pinned.items():
  if id not in used:records.append([id,name,lat,lon,'',0,name,'PPL'])
 records.sort(key=lambda row:(-row[5],row[1]));return {'source':'GeoNames','license':'CC BY 4.0','source_url':'https://www.geonames.org/','places':records}

if __name__=='__main__':
 from urllib.request import Request,urlopen
 def get(url):
  with urlopen(Request(url,headers={'User-Agent':'MonsoonWeather/1.0'}),timeout=40) as r:return r.read()
 archive=Path('/tmp/new-geonames').read_bytes() if Path('/tmp/new-geonames').exists() else get('https://download.geonames.org/export/dump/PK.zip')
 admin=Path('/tmp/new-admin').read_text() if Path('/tmp/new-admin').exists() else get('https://download.geonames.org/export/dump/admin1CodesASCII.txt').decode()
 catalog=build(archive,admin);path=ROOT/'public/location-data/index.json';path.parent.mkdir(exist_ok=True);path.write_text(json.dumps(catalog,ensure_ascii=False,separators=(',',':'))+'\n');print('Indexed Pakistan places:',len(catalog['places']),'bytes',path.stat().st_size)
