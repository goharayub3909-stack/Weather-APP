"""Verify public STAC scene and raster endpoints; no credentials or login data."""
import json,urllib.request,urllib.parse,math
from pathlib import Path
from datetime import datetime,timedelta,timezone
ROOT='https://planetarycomputer.microsoft.com/api/'
def get(url):
 with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'BadalPK noncommercial agri research'}),timeout=40) as r:return json.load(r)
now=datetime.now(timezone.utc);period=(now-timedelta(days=60)).strftime('%Y-%m-%dT00:00:00Z')+'/'+now.strftime('%Y-%m-%dT23:59:59Z')
results=[]
for collection in ['sentinel-2-l2a','landsat-c2-l2','modis-13Q1-061']:
 try:
  q={'collections':collection,'intersects':json.dumps({'type':'Point','coordinates':[73.08,31.42]}),'datetime':period,'limit':3}
  d=get(ROOT+'stac/v1/search?'+urllib.parse.urlencode(q));items=d.get('features',[])
  if not items:results.append({'collection':collection,'count':0});continue
  p=sorted(items,key=lambda x:x['properties'].get('datetime')or x['properties'].get('start_datetime')or'',reverse=True)[0]
  record={'collection':collection,'id':p['id'],'datetime':p['properties'].get('datetime')or p['properties'].get('start_datetime'),'bbox':p.get('bbox'),'assets':list(p['assets']),'cloud':p['properties'].get('eo:cloud_cover'),'feature':p}
  if collection=='sentinel-2-l2a':params={'collection':collection,'item':p['id'],'assets':'visual'}
  elif collection=='landsat-c2-l2':params={'collection':collection,'item':p['id'],'assets':['red','green','blue'],'color_formula':'gamma RGB 2.7, sigmoidal RGB 15 0.55, saturation 1.3','rescale':'0,30000'}
  else:params={'collection':collection,'item':p['id'],'assets':'250m_16_days_NDVI','rescale':'0,10000','colormap_name':'rdylgn'}
  try:record['tilejson']=get(ROOT+'data/v1/item/tilejson.json?'+urllib.parse.urlencode(params,doseq=True))
  except Exception as e:record['tile_error']=type(e).__name__
  if collection!='modis-13Q1-061':
   bands='B08,B04' if collection=='sentinel-2-l2a' else 'nir08,red';nir,red=bands.split(',')
   params={'collection':collection,'item':p['id'],'assets':bands.split(','),'expression':f'({nir}_b1-{red}_b1)/({nir}_b1+{red}_b1)','unscale':'true','rescale':'-1,1','colormap_name':'rdylgn'}
  try:record['ndvi_tilejson']=get(ROOT+'data/v1/item/tilejson.json?'+urllib.parse.urlencode(params,doseq=True))
  except Exception as e:record['tile_error']=type(e).__name__
  record['raster_verification']={}
  for name in ['tilejson','ndvi_tilejson']:
   if name not in record:continue
   z=11;x=int((73.08+180)/360*2**z);lat=math.radians(31.42);y=int((1-math.asinh(math.tan(lat))/math.pi)/2*2**z)
   tile=record[name]['tiles'][0].replace('{z}',str(z)).replace('{x}',str(x)).replace('{y}',str(y))
   try:
    with urllib.request.urlopen(tile,timeout=60) as response:
     payload=response.read();preview=Path('/tmp/field-index-images');preview.mkdir(exist_ok=True);(preview/('sentinel-rgb.png' if collection=='sentinel-2-l2a' and name=='tilejson' else 'source-'+collection+'-'+name+'.png')).write_bytes(payload);record['raster_verification'][name]={'status':response.status,'type':response.headers.get('Content-Type'),'bytes':len(payload),'png':payload.startswith(b'\x89PNG')}
   except Exception as e:record['raster_verification'][name]={'error':str(e),'detail':e.read().decode()[:500] if hasattr(e,'read') else ''}
  results.append(record)
 except Exception as e:results.append({'collection':collection,'error':type(e).__name__})
print(json.dumps(results,separators=(',',':')))
