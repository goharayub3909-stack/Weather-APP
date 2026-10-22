export const LIGHTNING_URL='https://www.wetteronline.de/blitzradar/pakistan?wrx=32.07,71.51&wrm=7.26';
export function initLightning(){
 const button=document.getElementById('load-lightning'),frame=document.getElementById('lightning-frame'),status=document.getElementById('lightning-status');
 button.addEventListener('click',()=>{document.getElementById('lightning-placeholder').hidden=true;document.getElementById('lightning-workspace').hidden=false;frame.src=LIGHTNING_URL;button.textContent='Reload lightning map ↻';status.textContent='WetterOnline viewer requested. If the provider blocks display here, open the requested map using the link below. Its own timestamp describes the lightning observations.';});
 frame.addEventListener('error',()=>{status.textContent='WetterOnline’s map could not be displayed here. Open the requested provider map below.';});
}
