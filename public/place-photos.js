// On-demand Commons geotagged photos: never scrape Google image results.
let current,sequence=0;
const strip=html=>new DOMParser().parseFromString(html||'','text/html').body.textContent.trim();
export function setPhotoPlace(place){current=place;sequence++;document.getElementById('place-photo-grid').replaceChildren();document.getElementById('place-photos-status').textContent='';document.querySelector('.city-gallery').open=false;}
export function initPlacePhotos(){
 const button=document.getElementById('load-place-photos'),status=document.getElementById('place-photos-status'),grid=document.getElementById('place-photo-grid');
 button.addEventListener('click',async()=>{
  if(!current)return;const token=++sequence,[name,lat,lon]=current;status.textContent='Finding licensed photos near '+name+'…';grid.replaceChildren();
  try{
   const url=new URL('https://commons.wikimedia.org/w/api.php');url.search=new URLSearchParams({action:'query',format:'json',origin:'*',generator:'geosearch',ggscoord:lat+'|'+lon,ggsradius:'10000',ggsnamespace:'6',ggslimit:'24',prop:'imageinfo',iiprop:'url|extmetadata',iiurlwidth:'640'});
   const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error();const data=await r.json();if(token!==sequence)return;let count=0;
   for(const page of Object.values(data.query?.pages||{})){
    const info=page.imageinfo?.[0],meta=info?.extmetadata,license=strip(meta?.LicenseShortName?.value),src=info?.thumburl||info?.url;
    if(!src||!/^https:\/\/upload\.wikimedia\.org\//.test(src)||!/(?:CC BY|CC0|public domain)/i.test(license)||!info.descriptionurl?.startsWith('https://commons.wikimedia.org/'))continue;
    const figure=document.createElement('figure'),link=document.createElement('a'),img=document.createElement('img'),caption=document.createElement('figcaption');link.href=info.descriptionurl;link.target='_blank';link.rel='noopener noreferrer';img.src=src;img.loading='lazy';img.alt=strip(meta.ObjectName?.value)||page.title.replace(/^File:/,'');caption.textContent=strip(meta.Artist?.value).slice(0,120)+' · '+license;link.append(img,caption);figure.append(link);grid.append(figure);count++;
   }
   status.textContent=count?`${count} geotagged photos within 10 km of ${name}. Each photo links to its source and licence.`:'No licensed geotagged photos found nearby. The city illustration remains available.';
  }catch{if(token===sequence)status.textContent='Nearby photos could not be loaded. Try again later.';}
 });
}
