let catalogPromise,sequence=0;
const landmarks={
 islamabad:'M120 220L240 88L360 220Z M130 220V150M350 220V150 M240 88V220 M120 220H360 M110 230V70H118V230 M362 230V70H370V230',
 karachi:'M180 220V142Q240 75 300 142V220 M170 220H310 M200 160H280 M160 220V140 M320 220V140 M215 220V182H265V220',
 lahore:'M224 220L230 86H250L256 220 M218 145H262 M214 202H266 M226 90Q240 66 254 90 M140 220V170Q160 140 180 170V220 M300 220V170Q320 140 340 170V220',
 faisalabad:'M212 220V135H268V220 M202 135L240 105L278 135 M226 98V78H254V98 M228 160A12 12 0 1 0 252 160A12 12 0 1 0 228 160 M240 150V160L247 165',
 multan:'M175 220V147H305V220 M175 147Q240 63 305 147 M190 136H290 M170 170H310 M190 220V170 M290 220V170 M225 220V188Q240 169 255 188V220',
 peshawar:'M155 220V118H205V220 M275 220V118H325V220 M205 155H275V180Q240 145 205 180 M150 118L180 98L210 118 M270 118L300 98L330 118',
};
function illustration(id){
 const seed=[...id].reduce((n,c)=>n+c.charCodeAt(0),0);
 let buildings='';for(let i=0;i<14;i++){const x=22+i*33,h=30+(seed*(i+7)%70);buildings+=`M${x} 235V${235-h}H${x+22}V235 `;}
 const mountain=['gilgit','skardu','hunza','chillas','astore','ghizer','quetta','chitral','murree'].includes(id)?'M0 235L100 90L155 160L250 45L330 155L390 100L480 235 M212 100L250 45L285 103':'';
 return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 260"><g fill="none" stroke="#d8edf2" stroke-width="3" stroke-linejoin="round" opacity=".8"><path d="${mountain||buildings}"/><path d="${landmarks[id]||''}"/><path d="M0 235H480"/></g></svg>`);
}
export async function showCityImage(id){
 const token=++sequence,image=document.getElementById('city-image'),credit=document.getElementById('city-image-credit'),hero=image.closest('.hero');
 image.onerror=null;image.src=illustration(id);image.hidden=false;hero.classList.remove('has-city-photo');credit.hidden=true;credit.replaceChildren();
 try{
  catalogPromise??=fetch(new URL('./city-data/catalog.json',import.meta.url)).then(r=>{if(!r.ok)throw Error();return r.json();}).catch(()=>({images:{}}));
  const catalog=await catalogPromise;if(token!==sequence)return;const photo=catalog.images?.[id];if(!photo||!/^photos\/[a-z0-9_]+\.(jpg|png|webp)$/.test(photo.file))return;
  const loader=new Image();loader.onload=()=>{
   if(token!==sequence)return;image.src=loader.src;hero.classList.add('has-city-photo');credit.hidden=false;
   const source=document.createElement('a');source.href=photo.source_url;source.target='_blank';source.rel='noopener noreferrer';source.textContent='Photo: '+photo.artist;
   const license=document.createElement('a');license.href=photo.license_url;license.target='_blank';license.rel='noopener noreferrer';license.textContent=photo.license;
   credit.append(source,document.createTextNode(' · '),license);
  };loader.src=new URL('./city-data/'+photo.file,import.meta.url).href;
 }catch{/* Original city illustration remains visible when photography is unavailable. */}
}
