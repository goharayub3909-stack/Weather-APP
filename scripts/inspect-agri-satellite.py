"""Verify public STAC scene and raster endpoints; no credentials or login data."""
import json,urllib.request,urllib.parse
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
  elif collection=='landsat-c2-l2':params={'collection':collection,'item':p['id'],'assets':'red,green,blue','color_formula':'gamma RGB 2.7, sigmoidal RGB 15 0.55, saturation 1.3','rescale':'0,30000'}
  else:params={'collection':collection,'item':p['id'],'assets':'250m_16_days_NDVI','rescale':'0,10000','colormap_name':'rdylgn'}
  try:record['tilejson']=get(ROOT+'data/v1/item/tilejson.json?'+urllib.parse.urlencode(params))
  except Exception as e:record['tile_error']=type(e).__name__
  if collection!='modis-13Q1-061':
   bands='B08,B04' if collection=='sentinel-2-l2a' else 'nir08,red';nir,red=bands.split(',')
   params={'collection':collection,'item':p['id'],'assets':bands,'expression':f'({nir}-{red})/({nir}+{red})','unscale':'true','rescale':'-1,1','colormap_name':'rdylgn'}
  try:record['ndvi_tilejson']=get(ROOT+'data/v1/item/tilejson.json?'+urllib.parse.urlencode(params))
  except Exception as e:record['tile_error']=type(e).__name__
  results.append(record)
 except Exception as e:results.append({'collection':collection,'error':type(e).__name__})
print(json.dumps(results,separators=(',',':')))
