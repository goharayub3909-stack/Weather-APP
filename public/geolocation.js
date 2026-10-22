// Browser-managed permission; exact coordinates stay in memory, not localStorage.
export function initGeolocation({onLocate,getSelectionRevision}){
 const button=document.getElementById('use-location'),status=document.getElementById('location-status');let sequence=0;
 const say=text=>{status.hidden=false;status.textContent=text;};
 async function locate(){
  if(!navigator.geolocation){say('Your browser does not support location. Choose a place using search.');return;}
  const token=++sequence,revision=getSelectionRevision();button.disabled=true;button.classList.add('locating');button.setAttribute('aria-busy','true');say('Finding your location… Chrome may ask permission.');
  try{localStorage.setItem('badal-location-requested','true');}catch{}
  navigator.geolocation.getCurrentPosition(position=>{
   if(token!==sequence)return;finish();if(revision!==getSelectionRevision()){say('Your selected place is shown. Use My location to switch to your current position.');return;}
   const {latitude:lat,longitude:lon,accuracy}=position.coords;
   if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<23||lat>38||lon<60||lon>78){say('This website covers Pakistan. Please choose a Pakistan place using search.');return;}
   // Approximately 100 m precision is ample for the model forecast; never persist GPS.
   onLocate({lat:Math.round(lat*1000)/1000,lon:Math.round(lon*1000)/1000});
   say('Weather for your current location'+(Number.isFinite(accuracy)?' · device accuracy approximately '+(accuracy<1000?Math.round(accuracy)+' m':(accuracy/1000).toFixed(1)+' km'):'')+'. Coordinates are not saved on this device.');
  },error=>{if(token!==sequence)return;finish();say(error.code===1?'Location permission was declined. You can still search for any Pakistan place.':error.code===3?'Location timed out. Try My location again or use city search.':'Your location could not be determined. Use city search or try again.');}, {enableHighAccuracy:true,timeout:15000,maximumAge:0});
 }
 function finish(){button.disabled=false;button.classList.remove('locating');button.removeAttribute('aria-busy');}
 button.addEventListener('click',locate);
 // Ask on first visit; later visits automatically refresh only a granted permission.
 let requested=false;try{requested=localStorage.getItem('badal-location-requested')==='true';}catch{}
 if(!requested)locate();else if(navigator.permissions?.query)navigator.permissions.query({name:'geolocation'}).then(result=>{if(result.state==='granted')locate();}).catch(()=>{});
}
