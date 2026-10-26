import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessHealth,assessOutlook,normalizeSample,wbgtApprox,heatIndexC,pktParts,LEVELS,TEXT} from '../public/health-engine.js';

const H=3600000,MIN=60000;
const base={temp_c:20,rh:50,pressure_hpa:1010,wind_speed_ms:3,pm25:20,soil_moisture:25,soil_temp_c:20,rain_acc_48h:0};
const iso=ms=>new Date(ms).toISOString();
const at=s=>Date.parse(s);
// Build readings every `stepMin` minutes for `hours` hours ending at `end` (inclusive of end).
function series(end,hours,stepMin,fn,extra={}){
 const out=[];for(let m=hours*60;m>=0;m-=stepMin){const t=end-m*MIN;out.push({...base,...extra,...fn((end-t)/H,t),timestamp:iso(t)});}return out;
}
const now=at('2026-10-20T12:00:00+05:00');
const reading=(over={},t=now)=>({...base,...over,timestamp:iso(t)});

test('timestamps must carry an explicit offset, and implausible values are nulled and reported',()=>{
 assert.equal(normalizeSample({...base,timestamp:'2026-10-20T12:00:00'}).ok,false);
 const n=normalizeSample({...base,rh:140,pressure_hpa:'1010',pm25:undefined,timestamp:'2026-10-20T12:00:00+05:00'});
 assert.equal(n.ok,true);assert.equal(n.sample.rh,null);assert.equal(n.sample.pressure_hpa,null);
 assert.deepEqual(n.invalid.sort(),['pressure_hpa','rh']);assert.ok(n.missing.includes('pm25'));
 assert.throws(()=>assessHealth({...base,timestamp:'bad'}));
});

test('Pakistan clock rules use UTC+5',()=>{assert.equal(pktParts(at('2026-10-20T02:30:00Z')).hour,7.5);assert.equal(pktParts(at('2026-10-20T20:00:00Z')).month,10);});

test('WBGT approximation and heat index follow published forms',()=>{
 const w=wbgtApprox(35,50);assert.ok(w>34.5&&w<35.1,String(w));
 const hi=heatIndexC(35,50);assert.ok(hi>40&&hi<43,String(hi));
 assert.equal(wbgtApprox(null,50),null);assert.ok(Math.abs(heatIndexC(20,50)-20)<.01);
});

test('WBGT above 31 °C is CRITICAL with the extreme-danger message in both languages',()=>{
 const r=assessHealth(reading({temp_c:38,rh:60}));const m=r.modules.heat;
 assert.ok(m.metrics.wbgt_c>31);assert.equal(m.level,'CRITICAL');
 assert.equal(m.headline.en,'Extreme Danger: High Risk of Heat Stroke & Cardiac Stress');assert.match(m.headline.ur,/[؀-ۿ]/);
 assert.equal(r.overall_level,'CRITICAL');assert.equal(r.alerts[0].module,'heat');
 assert.equal(assessHealth(reading({temp_c:22,rh:40})).modules.heat.level,'LOW');
 assert.equal(assessHealth(reading({temp_c:null,rh:null})).modules.heat.level,'UNKNOWN');
});

test('dengue needs temperature, humidity and recent rain together, and flags the biting windows',()=>{
 let r=assessHealth(reading({temp_c:27,rh:80,rain_acc_48h:12}));
 assert.equal(r.modules.dengue.level,'HIGH');
 assert.equal(r.modules.dengue.flags.peak_biting_window_now,false);
 assert.equal(r.modules.dengue.flags.high_viral_transmission_potential,null);
 r=assessHealth(reading({temp_c:27,rh:80,rain_acc_48h:12},at('2026-10-20T07:00:00+05:00')));assert.equal(r.modules.dengue.flags.peak_biting_window_now,true);
 r=assessHealth(reading({temp_c:27,rh:80,rain_acc_48h:12},at('2026-10-20T17:00:00+05:00')));assert.equal(r.modules.dengue.flags.peak_biting_window_now,true);
 r=assessHealth(reading({temp_c:27,rh:80,rain_acc_48h:0}));assert.notEqual(r.modules.dengue.level,'HIGH');
 r=assessHealth(reading({temp_c:35,rh:30,rain_acc_48h:0}));assert.equal(r.modules.dengue.level,'LOW');
});

test('missing rain data cannot produce a HIGH or LOW dengue grade',()=>{
 const r=assessHealth(reading({temp_c:27,rh:80,rain_acc_48h:null}));const m=r.modules.dengue;
 assert.equal(m.status,'partial');assert.equal(m.level,'MODERATE');assert.ok(r.data_quality.missing_inputs.includes('rain_acc_48h'));
});

test('48 hours above 28 °C raises dengue one level and names High Viral Transmission Potential',()=>{
 const hist=series(now,48,60,()=>({temp_c:29.5,rh:80,rain_acc_48h:10}));
 const r=assessHealth(hist.at(-1),hist.slice(0,-1));const m=r.modules.dengue;
 assert.equal(m.flags.high_viral_transmission_potential,true);assert.equal(m.level,'CRITICAL');
 assert.equal(m.headline.en,'High Viral Transmission Potential');
 const cool=series(now,48,60,(h)=>({temp_c:h===10?26:29.5,rh:80,rain_acc_48h:10}));
 assert.equal(assessHealth(cool.at(-1),cool.slice(0,-1)).modules.dengue.flags.high_viral_transmission_potential,false);
 const gappy=hist.filter((_,i)=>i%3===0||i===hist.length-1);
 assert.equal(assessHealth(gappy.at(-1),gappy.slice(0,-1)).modules.dengue.flags.high_viral_transmission_potential,null);
});

test('malaria uses the latest 21:00–05:00 PKT night',()=>{
 const end=at('2026-10-20T06:00:00+05:00');
 const hist=series(end,12,30,(h,t)=>{const hr=pktParts(t).hour;const night=hr>=21||hr<5;return night?{temp_c:24,rh:80}:{temp_c:33,rh:45};});
 let r=assessHealth(hist.at(-1),hist.slice(0,-1));assert.equal(r.modules.malaria.level,'HIGH');
 assert.equal(r.modules.malaria.criteria[0].value,24);
 const cold=series(end,12,30,(h,t)=>{const hr=pktParts(t).hour;return hr>=21||hr<5?{temp_c:14,rh:80}:{temp_c:25,rh:45};});
 r=assessHealth(cold.at(-1),cold.slice(0,-1));assert.notEqual(r.modules.malaria.level,'HIGH');assert.equal(r.modules.malaria.criteria[0].met,false);
 r=assessHealth(reading({temp_c:24,rh:80}));assert.equal(r.modules.malaria.level,'UNKNOWN');
});

test('locust needs wet warm soil plus a rain event, with a capped fallback when soil temperature is offline',()=>{
 let r=assessHealth(reading({soil_moisture:65,soil_temp_c:30,rain_acc_48h:8,temp_c:30}));assert.equal(r.modules.locust.level,'HIGH');
 r=assessHealth(reading({soil_moisture:65,soil_temp_c:null,rain_acc_48h:8,temp_c:30}));
 assert.equal(r.modules.locust.level,'MODERATE');assert.equal(r.modules.locust.confidence,'low');assert.equal(r.modules.locust.criteria[1].proxy,true);
 assert.ok(r.data_quality.fallbacks[0].includes('proxy'));
 r=assessHealth(reading({soil_moisture:40,soil_temp_c:30,rain_acc_48h:8}));assert.notEqual(r.modules.locust.level,'HIGH');
 r=assessHealth(reading({soil_moisture:null,soil_temp_c:30,rain_acc_48h:8}));assert.equal(r.modules.locust.status,'partial');assert.notEqual(r.modules.locust.level,'HIGH');
 r=assessHealth(reading({soil_moisture:65,soil_temp_c:30,rain_acc_48h:0,vegetation_dry:true}));assert.equal(r.modules.locust.level,'HIGH');
});

test('wheat yellow rust needs more than six consecutive cool humid night hours, in season',()=>{
 const end=at('2026-01-15T07:00:00+05:00');
 const wet=series(end,24,30,(h,t)=>{const hr=pktParts(t).hour;return hr>=21||hr<6?{temp_c:10,rh:90}:{temp_c:20,rh:50};});
 let r=assessHealth(wet.at(-1),wet.slice(0,-1));assert.equal(r.modules.rust.level,'HIGH');assert.ok(r.modules.rust.metrics.longest_run_hours>6);
 const short=series(end,24,30,(h,t)=>{const hr=pktParts(t).hour;return hr>=1&&hr<5?{temp_c:10,rh:90}:{temp_c:20,rh:50};});
 r=assessHealth(short.at(-1),short.slice(0,-1));assert.notEqual(r.modules.rust.level,'HIGH');
 const july=at('2026-07-15T07:00:00+05:00');
 const off=series(july,24,30,(h,t)=>{const hr=pktParts(t).hour;return hr>=21||hr<6?{temp_c:10,rh:90}:{temp_c:20,rh:50};});
 r=assessHealth(off.at(-1),off.slice(0,-1));assert.equal(r.modules.rust.level,'LOW');assert.equal(r.modules.rust.status,'out_of_season');
 r=assessHealth(reading({},end));assert.equal(r.modules.rust.level,'UNKNOWN');
});

test('cotton stress needs long heat above 38 °C and a sharp humidity fall, post-monsoon only',()=>{
 const end=at('2026-10-10T18:00:00+05:00');
 const hot=series(end,24,30,(h)=>({temp_c:h>=6&&h<16?40:30,rh:h>=6?80:30}));
 let r=assessHealth(hot.at(-1),hot.slice(0,-1));assert.equal(r.modules.cotton.criteria[0].met,true);assert.equal(r.modules.cotton.criteria[1].met,true);assert.equal(r.modules.cotton.level,'HIGH');
 const mild=series(end,24,30,()=>({temp_c:32,rh:60}));
 r=assessHealth(mild.at(-1),mild.slice(0,-1));assert.equal(r.modules.cotton.level,'LOW');
 const out=series(at('2026-02-10T18:00:00+05:00'),24,30,(h)=>({temp_c:40,rh:h<12?80:40}));
 r=assessHealth(out.at(-1),out.slice(0,-1));assert.equal(r.modules.cotton.status,'out_of_season');
});

test('pressure falls over 3 hours drive migraine and arthritis scores',()=>{
 const hist=series(now,6,30,(h)=>({pressure_hpa:h>=4?1012:h>=1?1012-(4-h)*1.4:1007.8,rh:85,temp_c:12}));
 let r=assessHealth(hist.at(-1),hist.slice(0,-1));
 assert.ok(r.modules.migraine.criteria[0].value>3,String(r.modules.migraine.criteria[0].value));assert.equal(r.modules.migraine.level,'HIGH');
 assert.equal(r.modules.arthritis.level,'HIGH');
 const steady=series(now,6,30,()=>({pressure_hpa:1010,rh:85,temp_c:12}));
 r=assessHealth(steady.at(-1),steady.slice(0,-1));assert.equal(r.modules.migraine.level,'LOW');assert.notEqual(r.modules.arthritis.level,'HIGH');
 r=assessHealth(reading());assert.equal(r.modules.migraine.level,'UNKNOWN');assert.equal(r.modules.migraine.status,'unavailable');
});

test('inversion smog is CRITICAL only when PM2.5 is above 150 with calm wind',()=>{
 let r=assessHealth(reading({pm25:200,wind_speed_ms:1}));assert.equal(r.modules.smog.level,'CRITICAL');
 assert.equal(r.modules.smog.headline.en,'Severe Temperature Inversion Smog: Toxic Particulate Trapping');assert.equal(r.modules.smog.flags.inversion_inferred_from_calm_wind,true);
 r=assessHealth(reading({pm25:200,wind_speed_ms:4}));assert.equal(r.modules.smog.level,'HIGH');
 r=assessHealth(reading({pm25:200,wind_speed_ms:null}));assert.equal(r.modules.smog.level,'HIGH');assert.equal(r.modules.smog.status,'partial');
 r=assessHealth(reading({pm25:100}));assert.equal(r.modules.smog.level,'MODERATE');
 r=assessHealth(reading({pm25:30}));assert.equal(r.modules.smog.level,'LOW');
 r=assessHealth(reading({pm25:null}));assert.equal(r.modules.smog.level,'UNKNOWN');assert.ok(r.data_quality.missing_inputs.includes('pm25'));
 r=assessHealth(reading({pm25:200,wind_speed_ms:1,pm25_source:'model'}));assert.equal(r.modules.smog.confidence,'low');assert.ok(r.data_quality.fallbacks.some(f=>f.includes('model')));
});

test('asthma trigger needs a drop of more than 5 °C in 4 hours plus pollution or humidity',()=>{
 const make=(extra)=>series(now,4,30,(h)=>({temp_c:22-(4-h)*2,...extra}));
 let hist=make({pm25:90,rh:50});let r=assessHealth(hist.at(-1),hist.slice(0,-1));
 assert.equal(r.modules.asthma.criteria[0].met,true);assert.equal(r.modules.asthma.level,'HIGH');
 hist=make({pm25:30,rh:50});r=assessHealth(hist.at(-1),hist.slice(0,-1));assert.notEqual(r.modules.asthma.level,'HIGH');
 hist=make({pm25:null,rh:85});r=assessHealth(hist.at(-1),hist.slice(0,-1));assert.equal(r.modules.asthma.level,'HIGH');
 hist=make({pm25:null,rh:50});r=assessHealth(hist.at(-1),hist.slice(0,-1));assert.equal(r.modules.asthma.status,'partial');assert.notEqual(r.modules.asthma.level,'HIGH');
 r=assessHealth(reading({pm25:90}));assert.equal(r.modules.asthma.criteria[0].met,null);
});

test('cold, dry air opens the influenza / RSV window',()=>{
 assert.equal(assessHealth(reading({temp_c:10,rh:30})).modules.flu.level,'HIGH');
 assert.notEqual(assessHealth(reading({temp_c:10,rh:70})).modules.flu.level,'HIGH');
 assert.equal(assessHealth(reading({temp_c:30,rh:60})).modules.flu.level,'LOW');
});

test('a stale reading yields UNKNOWN rather than a stale grade',()=>{
 const r=assessHealth(reading({temp_c:38,rh:60}),[],{now:iso(now+5*H)});
 assert.equal(r.data_quality.stale,true);assert.ok(Object.values(r.modules).every(m=>m.level==='UNKNOWN'));assert.equal(r.overall_level,'UNKNOWN');assert.equal(r.alerts.length,0);
});

test('history is de-duplicated, ordered and cannot include future or unusable rows',()=>{
 const hist=series(now,3,30,()=>({}));
 const noisy=[...hist.slice(0,-1),...hist.slice(0,-1),{...base,timestamp:'nonsense'},{...base,timestamp:iso(now+H)}].reverse();
 const r=assessHealth(hist.at(-1),noisy);assert.equal(r.data_quality.history_samples,hist.length-1);assert.equal(r.data_quality.history_span_hours,3);
});

test('actions are bilingual and only shown for MODERATE or higher',()=>{
 const r=assessHealth(reading({temp_c:38,rh:60,pm25:200,wind_speed_ms:1}));
 for(const m of Object.values(r.modules))if(m.actions.length){assert.ok(LEVELS.indexOf(m.level)>=1);for(const a of m.actions){assert.ok(a.en.length>20);assert.match(a.ur,/[؀-ۿ]/);}}
 const calm=assessHealth(reading());assert.equal(calm.alerts.filter(a=>a.level==='HIGH'||a.level==='CRITICAL').length,0);
 for(const [id,t] of Object.entries(TEXT)){assert.ok(t.title.en&&t.title.ur,id);assert.ok(t.actions.length,id);}
 assert.ok(r.disclaimer.en&&r.disclaimer.ur);assert.equal(r.schema_version,1);assert.equal(r.timestamp_pkt.endsWith('+05:00'),true);
});

test('every module returns a bounded score and a known level',()=>{
 const hist=series(now,48,30,()=>({}));const r=assessHealth(hist.at(-1),hist.slice(0,-1));
 assert.equal(Object.keys(r.modules).length,11);
 for(const m of Object.values(r.modules)){assert.ok([...LEVELS,'UNKNOWN'].includes(m.level),m.id);if(m.index_score!==null)assert.ok(m.index_score>=0&&m.index_score<=100,m.id);}
});

test('outlook re-runs the engine across forecast hours and applies duration rules',()=>{
 const past=series(now-H,24,60,()=>({}));
 const forecast=[];for(let i=1;i<=12;i++)forecast.push(reading({temp_c:38,rh:60,pressure_hpa:1010,pm25:null},now+i*H));
 const o=assessOutlook(reading({},now),past,forecast,{stepHours:3,horizonHours:12});
 assert.equal(o.steps.length,4);assert.equal(o.steps[0].levels.heat.level,'CRITICAL');assert.equal(o.steps[0].levels.smog.level,'UNKNOWN');assert.equal(o.source,'forecast');
});
