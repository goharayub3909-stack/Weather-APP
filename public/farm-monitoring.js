// Pure geometry and raster-value helpers. Never infer missing pixels or scenes.
export const finite=v=>typeof v==='number'&&Number.isFinite(v);
export function pointInField(point,vertices){let inside=false;const [y,x]=point;for(let i=0,j=vertices.length-1;i<vertices.length;j=i++){const [yi,xi]=vertices[i],[yj,xj]=vertices[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;}return inside;}
const turn=(a,b,c)=>(b[1]-a[1])*(c[0]-a[0])-(b[0]-a[0])*(c[1]-a[1]);
export function validField(v){
 if(v.length<3||v.some(p=>p.length!==2||!p.every(finite)||Math.abs(p[0])>85||Math.abs(p[1])>180))return false;
 if(new Set(v.map(p=>p.join(','))).size!==v.length)return false;
 if(Math.abs(v.reduce((s,a,i)=>{const b=v[(i+1)%v.length];return s+a[1]*b[0]-b[1]*a[0];},0))<1e-12)return false;
 const on=(a,b,p)=>Math.abs(turn(a,b,p))<1e-12&&p[0]>=Math.min(a[0],b[0])&&p[0]<=Math.max(a[0],b[0])&&p[1]>=Math.min(a[1],b[1])&&p[1]<=Math.max(a[1],b[1]);
 for(let i=0;i<v.length;i++)for(let j=i+1;j<v.length;j++){if(j===i+1||(i===0&&j===v.length-1))continue;const a=v[i],b=v[(i+1)%v.length],c=v[j],d=v[(j+1)%v.length];if(turn(a,b,c)*turn(a,b,d)<0&&turn(c,d,a)*turn(c,d,b)<0||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b))return false;}
 return true;
}
export function fieldSamplePoints(v){
 if(!validField(v))return [];
 const ys=v.map(p=>p[0]),xs=v.map(p=>p[1]),minY=Math.min(...ys),maxY=Math.max(...ys),minX=Math.min(...xs),maxX=Math.max(...xs),points=[];
 for(const [y,x]of [[.5,.5],[.25,.25],[.25,.75],[.75,.25],[.75,.75],[.5,.25],[.5,.75],[.25,.5],[.75,.5]]){const p=[minY+(maxY-minY)*y,minX+(maxX-minX)*x];if(pointInField(p,v))points.push(p);if(points.length===5)break;}
 // A highly concave field can miss the regular sample lattice. Do not sample
 // an outside centroid or substitute a point on another field.
 return points;
}
export function rasterValue(data){const values=data?.values;if(!Array.isArray(values))return null;const flat=values.flat(Infinity);return flat.length===1&&finite(flat[0])?flat[0]:null;}
export function validPixel(sensor,value){if(!finite(value)||!Number.isInteger(value))return false;if(sensor==='sentinel')return [4,5,6].includes(value);if(sensor==='landsat')return value>=0&&(value&63)===0;if(sensor==='modis-lst')return value>=0&&(value&255)===0;return sensor==='modis'&&value===0;}
export const qualityAsset=sensor=>({sentinel:'SCL',landsat:'qa_pixel',modis:'250m_16_days_pixel_reliability','modis-lst':'QC_Day'})[sensor];
export function recentSceneDays(features,now=Date.now(),lookback=90){
 const start=now-lookback*86400000,days=new Map();for(const f of [...features].sort((a,b)=>String(b.properties.datetime||b.properties.start_datetime).localeCompare(String(a.properties.datetime||a.properties.start_datetime)))){const stamp=f.properties.datetime||f.properties.start_datetime,time=Date.parse(stamp);if(!finite(time)||time<start||time>now)continue;const date=new Date(time).toLocaleDateString('en-CA',{timeZone:'Asia/Karachi'});if(!days.has(date))days.set(date,f);}return [...days.entries()].sort(([a],[b])=>a.localeCompare(b));
}
export function historyNarrative(rows,{crop=null,stage='mixed'}={}){
 const valid=rows.filter(r=>finite(r.value)).sort((a,b)=>a.time-b.time);if(valid.length<3||valid.at(-1).time-valid[0].time<14*86400000)return 'Not enough clear, quality-checked vegetation observations over time to interpret crop development. At least three acquisitions spanning 14 days are needed. Missing days are not evidence of poor crop health.';
 const first=valid[0].value,last=valid.at(-1).value,peak=Math.max(...valid.map(r=>r.value)),change=last-first,span=Math.round((valid.at(-1).time-valid[0].time)/86400000),name=crop?.name||'the selected field';
 const intro=`${valid.length} usable acquisitions over ${span} days: vegetation index ${first.toFixed(2)} → ${last.toFixed(2)} (peak ${peak.toFixed(2)}). `;
 const pattern=first<.25&&last>=.4&&change>=.15?'Vegetation has established or increased. This is consistent with emergence and canopy growth if the crop and calendar fit.':peak>=.45&&last<.25&&peak-last>=.25?'Substantial canopy loss or senescence is visible. Harvest or field clearing is possible; stress, crop change and other causes can produce a similar signal.':change<=-.15?'Vegetation greenness has declined. Check normal maturity, water stress, pest / disease symptoms and management before deciding the cause.':last>=.55?'A persistently strong green-canopy signal is present. This suggests vegetation cover, but does not establish disease-free plants or yield.':last<.2?'Vegetation cover is low. The field may be unsown, recently harvested or sparsely covered; bare soil and crop type also affect the index.':'Vegetation is relatively stable or changing gradually. Compare with the expected crop development and inspect the field.';
 return intro+pattern+` ${name} · selected stage: ${stage}. Sowing, harvest dates and exact growth stage are not confirmed by spectral indices; use field records and the local seasonal window. A three-month series can include a previous crop or fallow period, not just the currently selected crop.`;
}
export function renderFieldChart(root,rows,{title='Satellite acquisitions',unit='',start=Date.now()-90*86400000,end=Date.now(),color='#92d494'}={}){
 root.replaceChildren();const valid=rows.filter(r=>finite(r.value)&&finite(r.time)).sort((a,b)=>a.time-b.time),heading=document.createElement('h4');heading.textContent=title;root.append(heading);if(!valid.length){const p=document.createElement('p');p.textContent='No usable readings in this period. Gaps are not filled.';root.append(p);return;}
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),w=720,h=240,p={l:54,r:22,t:22,b:38},lo=Math.min(...valid.map(r=>finite(r.min)?r.min:r.value)),hi=Math.max(...valid.map(r=>finite(r.max)?r.max:r.value),lo+.1),pad=(hi-lo)*.12,min=lo-pad,max=hi+pad,x=t=>p.l+(t-start)/(end-start)*(w-p.l-p.r),y=v=>h-p.b-(v-min)/(max-min)*(h-p.t-p.b);
 svg.setAttribute('viewBox',`0 0 ${w} ${h}`);svg.setAttribute('role','img');svg.setAttribute('aria-label',title+'. Dots are actual available readings, gaps are unavailable data.');const add=(tag,attrs,text)=>{const e=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;svg.append(e);return e;};
 for(let i=0;i<4;i++){const v=min+(max-min)*i/3;add('line',{x1:p.l,x2:w-p.r,y1:y(v),y2:y(v),stroke:'currentColor',opacity:.12});add('text',{x:p.l-8,y:y(v)+4,'text-anchor':'end',fill:'currentColor','font-size':12},v.toFixed(2));}
 for(let i=0;i<4;i++){const t=start+(end-start)*i/3;add('text',{x:x(t),y:h-10,'text-anchor':'middle',fill:'currentColor','font-size':12},new Date(t).toLocaleDateString('en-GB',{timeZone:'Asia/Karachi',day:'numeric',month:'short'}));}
 for(const [i,r]of valid.entries()){if(finite(r.min)&&finite(r.max)){add('line',{x1:x(r.time),x2:x(r.time),y1:y(r.min),y2:y(r.max),stroke:color,'stroke-width':6,opacity:.35});}const previous=valid[i-1];if(previous&&r.time-previous.time<=20*86400000)add('line',{x1:x(previous.time),y1:y(previous.value),x2:x(r.time),y2:y(r.value),stroke:color,'stroke-width':2,'stroke-dasharray':'5 5',opacity:.7});const dot=add('circle',{cx:x(r.time),cy:y(r.value),r:4,fill:color,stroke:'currentColor','stroke-width':.5}),tip=document.createElementNS(ns,'title');tip.textContent=new Date(r.time).toLocaleString('en-GB',{timeZone:'Asia/Karachi'})+' PKT: '+r.value.toFixed(3)+' '+unit+(r.count?' · '+r.count+' usable sample positions':'');dot.append(tip);}
 root.append(svg);const note=document.createElement('small');note.textContent=unit+(valid.some(r=>finite(r.min)&&finite(r.max))?' · dots = sample mean; vertical bars = sample min–max.':' · dots = actual available readings.')+' Dashed lines connect observations and do not supply missing daily values.';root.append(note);
}
export function thermalMoistureIndex(temperature,wet,dry){
 if(![temperature,wet,dry].every(finite)||temperature< -80||temperature>100||wet< -30||dry>80||dry-wet<5)return null;
 return Math.max(0,Math.min(1,(dry-temperature)/(dry-wet)));
}
// Relative vigour comparisons use actual quality-screened positions, not a
// percentage of field area or a productivity / yield measurement.
export function vegetationSamples(samples,{stage='mixed'}={}){
 const valid=samples.filter(s=>finite(s.value)),values=valid.map(s=>s.value).sort((a,b)=>a-b);
 if(valid.length<3||valid.length<samples.length*.6)return {ready:false,note:'Too few clear sample positions to compare this field.',samples:[]};
 const min=values[0],max=values.at(-1),mean=values.reduce((a,b)=>a+b,0)/values.length,spread=max-min;
 const labelled=valid.map(s=>({...s,zone:s.value<.2?'Low / non-vegetated signal':spread<.1?'Similar green-cover signal':s.value<=min+spread*.25?'Lower relative vigour':s.value>=max-spread*.25?'Higher relative vigour':'Typical relative vigour'}));
 return {ready:true,min,max,mean,vegetated:values.filter(v=>v>=.2).length,count:valid.length,samples:labelled,note:valid.length+' clear sample positions; '+values.filter(v=>v>=.2).length+' have NDVI ≥0.2. This is a sample indicator, not field-area coverage. '+(['pre-sowing','sowing','harvest'].includes(stage)?'Low cover can fit the selected stage. ':'')+'Higher vigour is only a potential-productivity proxy. Compare weak and strong spots by scouting and paired soil / leaf tests; check irrigation uniformity or drainage before treating. No cause or yield is diagnosed.'};
}
