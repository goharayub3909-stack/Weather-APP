"""Read public Pakistani guidance; preserve source evidence without inventing updates."""
import concurrent.futures,json,os,re,subprocess,urllib.request
from html import unescape
from pathlib import Path
URLS=["https://namc.pmd.gov.pk/", "https://namc.pmd.gov.pk/crop-calendar.php", "https://aari.punjab.gov.pk/wheat", "https://aari.punjab.gov.pk/crop_production_technology", "https://agripunjab.gov.pk/", "https://zarat.kp.gov.pk/", "https://www.fao.org/4/y5146e/y5146e0i.htm"]
def read(url):
 try:
  request=urllib.request.Request(url,headers={"User-Agent":"BadalPK public guidance verification"})
  with urllib.request.urlopen(request,timeout=30) as response: body=response.read(2000000).decode(errors="replace"); final=response.url
  links=re.findall(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>',body,re.I|re.S)
  links=[(unescape(h),re.sub("<[^>]+>"," ",unescape(t)).strip()) for h,t in links if re.search("crop|wheat|calendar|bulletin|advis|frost|production|potato|rice",h+" "+t,re.I)]
  text=re.sub(r"<(script|style)\b[^>]*>.*?</\1>","",body,flags=re.I|re.S)
  text=re.sub(r"\s+"," ",unescape(re.sub("<[^>]+>"," ",text)))
  return {"url":url,"final":final,"text":text[:11000],"links":links[:35]}
 except Exception as error:return {"url":url,"error":str(error)}
if __name__=="__main__":
 with concurrent.futures.ThreadPoolExecutor(max_workers=7) as pool: results=list(pool.map(read,URLS))
 payload={"name":"Pakistan agricultural sources","head_sha":os.environ["GITHUB_SHA"],"status":"completed","conclusion":"success","output":{"title":"Official guidance retrieval evidence","summary":json.dumps(results,ensure_ascii=False)[:64000]}}
 Path("/tmp/agri-sources-check.json").write_text(json.dumps(payload))
 subprocess.run(["gh","api","repos/"+os.environ["GITHUB_REPOSITORY"]+"/check-runs","--input","/tmp/agri-sources-check.json"],check=True,stdout=subprocess.DEVNULL)
