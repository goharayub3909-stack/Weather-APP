"""Retrieve the user-requested public reference; never execute page scripts."""
import json,os,re,subprocess,urllib.request
from datetime import datetime,timezone
from html import unescape
from pathlib import Path
url=os.environ.get('REFERENCE_URL','https://metos.global/en/virtual-sensors/')
name=os.environ.get('REFERENCE_NAME','Virtual sensor public reference')
request=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0 (public reference review)'})
with urllib.request.urlopen(request,timeout=45) as response:
 body=response.read(4000000).decode(errors='replace');final=response.url
body=re.sub(r'<(script|style|noscript)\b[^>]*>.*?</\1>',' ',body,flags=re.S|re.I)
text=re.sub(r'\s+',' ',unescape(re.sub('<[^>]+>',' ',body))).strip()
links=[{'url':unescape(h),'title':re.sub(r'\s+',' ',unescape(re.sub('<[^>]+>',' ',t))).strip()} for h,t in re.findall(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>',body,re.S|re.I) if re.search('virtual|sensor|vapor|vapour|deficit|dew|frost|chill|delta|degree|evapo|wetness|spray',h+' '+t,re.I)]
data={'source':url,'final':final,'retrieved_at':datetime.now(timezone.utc).isoformat(),'text':text[:45000],'links':links[:35]}
payload={'name':name,'head_sha':os.environ['GITHUB_SHA'],'status':'completed','conclusion':'success','output':{'title':name,'summary':json.dumps(data,ensure_ascii=False)}}
Path('/tmp/virtual-sensor-check.json').write_text(json.dumps(payload))
subprocess.run(['gh','api','repos/'+os.environ['GITHUB_REPOSITORY']+'/check-runs','--input','/tmp/virtual-sensor-check.json'],check=True,stdout=subprocess.DEVNULL)
