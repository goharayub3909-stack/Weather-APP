// Seasonal calendars describe possibilities, never an observed field stage.
import {activity,pakistanMonth} from './farm-data.js';
export const STAGE_NAMES={'pre-sowing':'Before sowing / seedbed preparation',sowing:'Sowing / planting',growing:'Growing crop',flowering:'Flowering / grain filling',harvest:'Harvest / picking',mixed:'Stage not established'};
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z]/g,'');
const aliases={faisalabad:'faislabad',sheikhupura:'shiekupura',rahimyarkhan:'rahimyarkhan',abbottabad:'abbotabad',pakpattan:'pakpatan',tobateksingh:'tobateksighn'};
export function districtCalendars(reference,crop,place){
 const key=norm(place?.[0]),variants=new Set([key,aliases[key]].filter(Boolean));
 return (reference?.calendar||[]).filter(r=>r.crop===crop?.id&&r.districts.split(/[,;:]/).some(d=>variants.has(norm(d))));
}
export function fieldContext({crop,zone,place,selectedStage='auto',confirmed=false,reference=null,now=new Date()}){
 const calendar=crop?activity(crop,zone,pakistanMonth(now)):null,records=districtCalendars(reference,crop,place);
 let expected=calendar?.stage||'mixed',label=calendar?.label||'Select a crop',basis='Broad regional calendar; not an observed crop stage.';
 // Only explicit day/month windows are machine-readable. Unspecified dates
 // stay unparsed; planting dates never establish emergence or maturity.
 const month=pakistanMonth(now),day=Number(now.toLocaleDateString('en-CA',{timeZone:'Asia/Karachi',day:'2-digit'})),md=month*100+day;
 const windows={'25 Oct -20 Nov · 20 Nov- 5 dec · End of Dec':[[1025,1120],[1120,1205]],'Oct-15 Nov':[[1001,1115]],'15th October to 15th November':[[1015,1115]],'Whole month of Novemeber':[[1101,1130]],'1 Nov-15 Nov · Late then 20 Nov can decrease Yield':[[1101,1115]],'1Nov-30 Nov':[[1101,1130]],'15sep-20Oct':[[915,1020]],'1st Jan-15feb':[[101,215]],'15April-May':[[415,531]],'15aug-15sep':[[815,915]],'15 Jan-15feb':[[115,215]],'15april-15june':[[415,615]],'5-15sep':[[905,915]]};
 const intervals=records.flatMap(r=>windows[r.dates]||[]),inSowingWindow=intervals.some(([a,b])=>md>=a&&md<=b);
 if(inSowingWindow){expected='sowing';label='Within supplied district sowing window · planting unconfirmed';}
 else if(crop?.id==='wheat'&&records.some(r=>r.dates.startsWith('25 Oct'))&&month===10&&day<25){expected='pre-sowing';label='Before district sowing window · prepare seedbed';}
 else if(intervals.length&&expected==='sowing'){expected='mixed';label='Outside supplied district sowing window · confirm actual stage';}
 if(records.length)basis='District sowing reference: '+records.map(r=>r.dates+' ('+r.cycle+')').join('; ')+'. '+records.map(r=>r.source).join('; ')+'. This does not prove your field is planted.';
 const manual=selectedStage!=='auto',stage=manual?selectedStage:expected,conflict=manual&&(expected==='mixed'||stage!==expected),verified=manual&&confirmed;
 const blocked=!crop||stage==='mixed'||(manual&&!confirmed);
 const reason=!crop?'Choose your actual crop first.':stage==='mixed'?'The seasonal guide cannot establish one stage here. Select and confirm your actual field stage.':manual&&!confirmed?'Confirm that this is the stage you observed in this field before operation windows are shown.':stage==='pre-sowing'?'Crop not established: focus on seedbed preparation and the local sowing window.':!manual?'Seasonal estimate only. Confirm the actual field stage before harvest decisions.':'Field stage confirmed by you; maturity and product requirements still need checking.';
 return {stage,expected,label,basis,records,manual,conflict,verified,blocked,reason,suitable:calendar?.suitable??false,operations:{spray:!blocked&&['sowing','growing','flowering'].includes(stage),fertilize:!blocked&&['sowing','growing','flowering'].includes(stage),harvest:!blocked&&stage==='harvest'&&verified}};
}
