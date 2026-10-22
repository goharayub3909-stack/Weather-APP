export const normalize=text=>String(text).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function rankLocations(places,query,limit=12){
 const q=normalize(query);if(q.length<2)return[];
 return places.map(place=>{const name=place.normalizedName??normalize(place.name),aliases=place.normalizedAliases??normalize(place.aliases||'');let score=name===q?1000:name.startsWith(q)?700:name.includes(q)?350:aliases.includes(q)?180:0;if(!score)return null;score+=Math.log10(1+(place.population||0))*9;return {place,score};}).filter(Boolean).sort((a,b)=>b.score-a.score).slice(0,limit).map(x=>x.place);
}
export function initLocationSearch({cities,onSelect}){
 const input=document.getElementById('search'),list=document.getElementById('location-results');let active=-1,results=[],places=Object.entries(cities).map(([id,[name,lat,lon]])=>({id,name,lat,lon,region:'Pakistan',population:0,aliases:name}));
 function close(){list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;}
 function select(place){onSelect(place);input.value='';close();}
 function draw(provided){results=provided??rankLocations(places,input.value);list.replaceChildren();active=-1;for(const [i,place]of results.entries()){const button=document.createElement('button');button.type='button';button.id='location-result-'+i;button.setAttribute('role','option');button.setAttribute('aria-selected','false');button.tabIndex=-1;const title=document.createElement('strong');title.textContent=place.name;const region=document.createElement('span');region.textContent=place.region||'Pakistan';button.append(title,region);button.addEventListener('mousedown',e=>e.preventDefault());button.addEventListener('click',()=>select(place));list.append(button);}list.hidden=!results.length;input.setAttribute('aria-expanded',String(results.length>0));}
 input.removeAttribute('list');input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls','location-results');input.setAttribute('aria-expanded','false');input.addEventListener('input',()=>{draw();worker?.postMessage({type:'query',query:input.value});});input.addEventListener('focus',()=>{draw();startWorker();});
 input.addEventListener('keydown',e=>{if(e.key==='Escape'){close();return;}if(e.key==='ArrowDown'||e.key==='ArrowUp'){if(!results.length)return;e.preventDefault();active=(active+(e.key==='ArrowDown'?1:-1)+results.length)%results.length;[...list.children].forEach((el,i)=>el.setAttribute('aria-selected',String(i===active)));input.setAttribute('aria-activedescendant','location-result-'+active);list.children[active].scrollIntoView({block:'nearest'});}if(e.key==='Enter'&&results.length){e.preventDefault();select(results[Math.max(0,active)]);}});
 document.addEventListener('click',e=>{if(!input.parentElement.contains(e.target))close();});
 let worker;
 function startWorker(){
  if(worker)return;
  worker=new Worker(new URL('./location-worker.js',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{
   if(data.type==='ready'){input.placeholder='Search '+data.count.toLocaleString()+' Pakistan places…';worker.postMessage({type:'query',query:input.value});}
   if(data.type==='results'&&data.query===input.value&&document.activeElement===input)draw(data.places);
  };
 }
}
