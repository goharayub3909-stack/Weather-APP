export const WMS_ENDPOINT='https://view.eumetsat.int/geoserver/wms';
export function validSatelliteLayer(layer){
 return Boolean(layer&&typeof layer.name==='string'&&/^[A-Za-z0-9_.:-]+$/.test(layer.name)&&['EPSG:3857','EPSG:4326','CRS:84'].includes(layer.crs)&&Array.isArray(layer.bounds)&&layer.bounds.length===4&&layer.bounds.every(Number.isFinite));
}
export function acquisitionLabel(stamp){
 if(!stamp)return 'Provider default · exact acquisition time unavailable';
 const date=new Date(stamp);if(!Number.isFinite(date.getTime()))return 'Acquisition time unavailable';
 return date.toLocaleString('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})+' UTC · '+date.toLocaleTimeString('en-GB',{timeZone:'Asia/Karachi',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})+' PKT';
}
export function wmsOptions(layer,time){
 if(!validSatelliteLayer(layer))throw Error('Invalid advertised WMS layer');
 if(time&&(!Array.isArray(layer.times)||!layer.times.includes(time)))throw Error('Time was not advertised for this layer');
 const options={layers:layer.name,styles:'',format:'image/png',transparent:true,version:'1.3.0',attribution:'Satellite imagery © EUMETSAT',opacity:1};
 if(time)options.time=time;return options;
}
