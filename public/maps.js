// One active map keeps the page compact and stops background playback.
export function initMapTabs(){
 const tabs=[...document.querySelectorAll('[data-map]')];
 function activate(tab){
  tabs.forEach(t=>{const active=t===tab;t.setAttribute('aria-selected',String(active));t.tabIndex=active?0:-1;const pane=document.getElementById(t.dataset.map);pane.hidden=!active;pane.setAttribute('role','tabpanel');pane.setAttribute('aria-labelledby',t.id);});
  window.dispatchEvent(new Event('resize'));
  document.dispatchEvent(new CustomEvent('mapchange',{detail:tab.dataset.map}));
 }
 tabs.forEach((tab,i)=>{tab.id='map-tab-'+i;tab.setAttribute('aria-controls',tab.dataset.map);tab.addEventListener('click',()=>activate(tab));tab.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const target=tabs[event.key==='Home'?0:event.key==='End'?tabs.length-1:(i+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length];target.focus();activate(target);});});activate(tabs[0]);
 document.getElementById('load-weathercom').addEventListener('click',()=>{const frame=document.getElementById('weathercom-frame');frame.hidden=false;frame.src='https://weather.com/en-PK/pk/islamabad-capital-territory/city/islamabad/radar';document.getElementById('weathercom-status').textContent='Weather.com viewer requested. If it stays blank or is blocked by the provider, use “Open provider viewer” above. Forecast time range is controlled by Weather.com.';});
}
