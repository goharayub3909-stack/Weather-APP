// Indicative Pakistan crop calendar, not a district sowing prescription.
// Month numbers are Pakistan local time. Overlapping stages deliberately allow
// multiple planting cycles; users can supply their actual crop and growth stage.
export const ZONES={plains:'Central / northern plains',south:'Southern / warm plains',uplands:'Western uplands',north:'Northern valleys'};
const stage=(months,label,key)=>({months,label,key});
const sow=m=>stage(m,'Sowing / planting','sowing'),grow=m=>stage(m,'Growing crop','growing'),flower=m=>stage(m,'Flowering / grain filling','flowering'),harvest=m=>stage(m,'Harvest / picking','harvest');
const crop=(id,name,urdu,glyph,group,zones,calendar,note,extra={})=>({id,name,urdu,glyph,group,zones,calendar,note,...extra});
export const CROPS=[
 crop('wheat','Wheat','گندم','grain','Rabi',['plains','south','uplands','north'],[stage([10],'Seedbed preparation','sowing'),sow([11,12]),grow([1,2]),flower([3]),harvest([4,5])],'Prepare a level seedbed; use locally recommended varieties and sowing dates.',{cool:true,regional:{south:[sow([11,12]),grow([1]),flower([2]),harvest([3,4])],uplands:[sow([10,11]),grow([12,1,2,3]),flower([4]),harvest([5,6])],north:[sow([3,4]),grow([5,6]),flower([7]),harvest([8,9])]}}),
 crop('rice','Rice','چاول','rice','Kharif',['plains','south'],[sow([5,6,7]),grow([8,9]),harvest([10,11])],'Protect mature grain from rain; dry and store harvested paddy appropriately.'),
 crop('cotton','Cotton','کپاس','cotton','Kharif',['plains','south'],[sow([3,4,5]),grow([6]),flower([7,8]),harvest([9,10,11])],'Pick opened bolls when dry; keep picked cotton off damp soil.'),
 crop('sugarcane','Sugarcane','گنا','cane','Long duration',['plains','south'],[sow([2,3,9,10]),grow([4,5,6,7,8]),harvest([11,12,1])],'Planting and mature-cane harvest can overlap between fields; use your actual crop stage.'),
 crop('maize','Maize','مکئی','maize','Spring / Kharif',['plains','south','north'],[sow([2,3,7,8]),grow([4,5,9]),harvest([6,10,11])],'Keep harvested cobs sheltered and ventilated; avoid storage while grain is damp.',{regional:{north:[sow([4,5]),grow([6,7,8]),harvest([9,10])]}}),
 crop('potato','Potato','آلو','tuber','Rabi / spring',['plains','south','uplands','north'],[sow([10,11,1,2]),grow([12,3]),harvest([1,2,4,5])],'Drain standing water from ridges; protect exposed tubers from sunlight.',{cool:true,regional:{north:[sow([3,4,5]),grow([6,7,8]),harvest([9,10])],uplands:[sow([2,3,8]),grow([4,5,9,10]),harvest([6,7,11])]}}),
 crop('chickpea','Chickpea / gram','چنا','pulse','Rabi',['plains','south','uplands'],[sow([10,11]),grow([12,1]),flower([2,3]),harvest([3,4])],'Avoid waterlogging; base any irrigation on field moisture and crop stage.',{cool:true}),
 crop('mustard','Mustard / rapeseed','سرسوں','flower','Rabi',['plains','south','uplands'],[sow([10,11]),grow([12]),flower([1,2]),harvest([3,4])],'Watch flowering crops for weather stress and scout before deciding on pest control.',{cool:true}),
 crop('sunflower','Sunflower','سورج مکھی','flower','Spring / autumn',['plains','south'],[sow([1,2,3,7,8]),grow([4,9]),flower([4,10]),harvest([5,6,10,11])],'Protect drying heads and stored seed from rain and damp conditions.'),
 crop('groundnut','Groundnut','مونگ پھلی','pulse','Kharif',['plains'],[sow([3,4,5]),grow([6,7,8]),harvest([9,10,11])],'Lift mature pods when soil is workable; cure and dry pods before storage.'),
 crop('barley','Barley','جو','grain','Rabi',['plains','uplands','north'],[sow([10,11,12]),grow([1,2]),flower([3]),harvest([4,5])],'Adjust planting to local winter conditions and variety.',{cool:true,regional:{north:[sow([3,4]),grow([5,6]),flower([7]),harvest([8,9])]}}),
 crop('onion','Onion','پیاز','tuber','Winter / regional',['plains','south','uplands'],[sow([10,11,12,1]),grow([2,3]),harvest([4,5])],'Separate nursery, transplanting and bulb stages; avoid wet storage.',{cool:true}),
 crop('tomato','Tomato','ٹماٹر','fruit','Regional cycles',['plains','south','uplands','north'],[sow([2,3,8,9,10]),grow([4,11]),harvest([5,6,12,1])],'Protect seedlings from frost and wind; ventilate tunnels and support plants.',{regional:{south:[sow([8,9,10,11]),grow([12]),harvest([1,2,3,4])],north:[sow([4,5]),grow([6,7]),harvest([8,9,10])],uplands:[sow([3,4]),grow([5,6]),harvest([7,8,9,10])]}}),
 crop('berseem','Berseem / clover fodder','برسیم','leaf','Rabi fodder',['plains','south'],[sow([9,10,11]),stage([12,1,2,3,4],'Growth / repeated cutting','growing')],'Cut and handle fodder in workable conditions; avoid contaminated or spoiled feed.',{cool:true}),
 crop('mango','Mango','آم','fruit','Orchard',['plains','south'],[stage([12,1,2],'Orchard care','growing'),flower([3,4]),grow([5]),harvest([6,7,8]),stage([9,10,11],'Post-harvest orchard care','growing')],'Check young trees, drainage and irrigation; orchard needs depend on age and variety.'),
 crop('citrus','Citrus / kinnow','کینو','fruit','Orchard',['plains','south'],[harvest([11,12,1,2,3]),flower([3,4]),stage([5,6,7,8,9,10],'Fruit development','growing')],'Check fruit maturity before picking; keep picked fruit shaded and dry.'),
 crop('apple','Apple','سیب','fruit','Orchard',['uplands','north'],[stage([11,12,1,2],'Dormancy / orchard care','growing'),flower([3,4]),grow([5,6,7]),harvest([8,9,10])],'Protect blossom and young fruit during cold spells; picking depends on variety and elevation.'),
 crop('dates','Dates','کھجور','cane','Orchard',['south'],[stage([10,11,12,1],'Post-harvest / orchard care','growing'),flower([2,3]),grow([4,5,6]),harvest([7,8,9])],'Keep ripening or picked fruit protected from rain and ensure good drying conditions.')
];
export function pakistanMonth(now=new Date()){return Number(now.toLocaleDateString('en-CA',{timeZone:'Asia/Karachi',month:'2-digit'}));}
export function seasonName(month,zone='plains'){
 if(zone==='north')return [10,11].includes(month)?'Autumn harvest & winter preparation':[12,1,2].includes(month)?'Winter dormancy & protection':[3,4].includes(month)?'Spring planting & orchard blossom':[5,6].includes(month)?'Summer crop establishment':'Summer crop growth & harvest';
 return [10,11].includes(month)?'Kharif harvest → Rabi preparation':[12,1,2].includes(month)?'Rabi growing season':[3,4].includes(month)?'Rabi harvest → spring planting':[5,6].includes(month)?'Kharif establishment':'Kharif growth & monsoon';
}
export function approximateZone(lat,lon){return lat>=34.7?'north':lat>=28&&lon<68?'uplands':lat<29?'south':'plains';}
export function activity(crop,zone,month){
 const suitable=crop.zones.includes(zone),stages=(crop.regional?.[zone]||crop.calendar).filter(s=>s.months.includes(month));
 return {active:suitable&&stages.length>0,suitable,label:suitable&&stages.length?stages.map(s=>s.label).join(' · '):suitable?'Outside usual field calendar':'Not a typical crop for this guide area',stage:suitable&&stages.length===1?stages[0].key:'mixed'};
}
