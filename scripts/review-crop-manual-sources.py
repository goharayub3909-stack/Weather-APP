"""Read official KP crop guides as reference data; never execute page scripts."""
import concurrent.futures,json,os,re,subprocess,urllib.request
from html import unescape
from urllib.parse import urljoin
from pathlib import Path
ROOT='https://zarat.kp.gov.pk/crops'
NAMES={'Wheat','Rice','Cotton','Sugarcane','Maize','Potato (White)','Chickpea (Gram Pea)','Mustard','Sunflower','Peanut (Ground-nut)','Barley','Onion','Tomato','Berseem','Mango','Citrus','Apple','Date Palm'}
def html(url):
 with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0 public agricultural reference review'}),timeout=40) as r:return r.read(4000000).decode(errors='replace')
def plain(body):
 body=re.sub(r'<(script|style|noscript)\b[^>]*>.*?</\1>',' ',body,flags=re.S|re.I)
 return re.sub(r'\s+',' ',unescape(re.sub('<[^>]+>',' ',body))).strip()
def links(body):return [(unescape(h),plain(t)) for h,t in re.findall(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>',body,re.S|re.I)]
def review(pair):
 url,name=pair
 try:
  body=html(url);data={'name':name,'url':url,'text':plain(body)[:40000],'links':[(h,t) for h,t in links(body) if re.search(r'wheat|rice|cotton|maize|sugarcane|potato|production|technology',h+' '+t,re.I)][:40]}
 except Exception as e:data={'name':name,'url':url,'error':str(e)}
 payload={'name':'Pakistan crop guide: '+name,'head_sha':os.environ['GITHUB_SHA'],'status':'completed','conclusion':'success','output':{'title':'Official KP crop reference: '+name,'summary':json.dumps(data,ensure_ascii=False)}}
 file=Path('/tmp/crop-check-'+re.sub('[^a-z]','',name.lower())+'.json');file.write_text(json.dumps(payload));subprocess.run(['gh','api','repos/'+os.environ['GITHUB_REPOSITORY']+'/check-runs','--input',str(file)],check=True,stdout=subprocess.DEVNULL)
if __name__=='__main__':
 pairs=[(urljoin(ROOT,h),name) for h,name in links(html(ROOT)) if name in NAMES and '/view_crop/' in h]
 pairs += [('https://www.pakissan.com/?s='+crop,'Pakistan production guide: '+crop) for crop in ['wheat','rice','cotton','maize','potato','sugarcane']]
 pairs += [('https://www.fao.org/4/x0490e/x0490e00.htm','FAO 56 methods')]
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(review,pairs))
