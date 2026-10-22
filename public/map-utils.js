export function darkMap(id){
 const map=L.map(id,{scrollWheelZoom:false,trackResize:false}).setView([30.3753,69.3451],5);
 map.createPane('dark-base');map.getPane('dark-base').classList.add('dark-osm-basemap');map.getPane('dark-base').style.zIndex=200;
 L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{pane:'dark-base',maxZoom:12,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
 map.on('click',()=>map.scrollWheelZoom.enable());window.addEventListener('resize',()=>{if(map.getContainer().offsetWidth)map.invalidateSize();});return map;
}
export const pkt=time=>new Date(time).toLocaleString('en-GB',{timeZone:'Asia/Karachi',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})+' PKT';
export function popup(title,lines){const root=document.createElement('div'),strong=document.createElement('strong');strong.textContent=title;root.append(strong);for(const line of lines){const row=document.createElement('div');row.textContent=line;root.append(row);}return root;}
