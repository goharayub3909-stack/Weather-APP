import {CROP_MANUALS} from './crop-manual-data.js';
const element=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
export function manualForContext(context){
 const manual=CROP_MANUALS[context?.crop?.id];if(!manual)return null;
 // District workbook windows qualify timing only; they do not establish that a
 // field was planted or turn broad weather forecasts into a measured stage.
 const windows=context.field?.records?.map(r=>r.dates).filter(Boolean)||[];
 return {...manual,stages:manual.stages.map(stage=>({...stage,timing:stage.number===2&&windows.length?stage.timing+'. Supplied district reference for '+context.place[0]+': '+[...new Set(windows)].join('; ')+'. Confirm the planting system and actual field date.':stage.timing}))};
}
export function manualText(context,manual=manualForContext(context)){
 if(!manual)return 'Select a crop to view its advisory.';
 const text=[context.crop.name+' · Farmers’ advisory',context.place[0]+' · crop-cycle reference, not a live district prescription',''];
 for(const s of manual.stages)text.push('## 🌾 Stage '+s.number+': '+s.name,'* Objective: '+s.objective,'* Timing: '+s.timing,'* Actionable Steps:',...s.actions.map(a=>'  - '+a),'* Technical Parameters: '+s.technical,'* Critical Danger/Warning: '+s.warning,'');
 text.push('Source: '+manual.source.name+' — '+manual.source.url,'Source reviewed: '+manual.source.reviewed,manual.source.scope,'Chemical products, doses and pre-harvest intervals require the currently registered local label. Soil-test nutrient recommendations and local extension advice take precedence.');return text.join('\n');
}
export function initCropManual(root){
 let lastKey='';
 return {update(context){
  const key=JSON.stringify([context.crop?.id,context.stage,context.field?.verified,context.field?.blocked,context.place[0],context.field?.records?.map(r=>r.dates)]);if(key===lastKey)return;lastKey=key;root.replaceChildren();
  const manual=manualForContext(context);if(!manual){root.append(element('p','farm-explainer','Choose your crop above to view its complete stage-by-stage advisory.'));return;}
  const header=element('div','crop-manual-heading'),heading=element('div');heading.append(element('span','eyebrow','FROM PREPARATION TO POST-HARVEST'),element('h3','',context.crop.name+' · crop-cycle advisory'));const download=element('button','','Download guide');download.type='button';download.addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([manualText(context,manual)],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=context.crop.id+'-farmers-advisory.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});header.append(heading,download);root.append(header);
  root.append(element('p','farm-explainer','Use the seven-day calendar above for weather timing. This full-cycle guide follows visible crop development; it does not assume a future stage has already occurred. Open a stage for its five management points.'));
  const current=manual.stages.filter(s=>s.group===context.stage),first=current[0]?.number;
  for(const stage of manual.stages){
   const card=element('details','crop-manual-stage');card.dataset.stage=String(stage.number);card.dataset.current=String(stage.group===context.stage);card.open=stage.number===first;
   const summary=element('summary'),title=element('h4','','🌾 Stage '+stage.number+': '+stage.name);summary.append(title);if(stage.group===context.stage)summary.append(element('span','crop-stage-badge',context.field?.blocked?'Stage needs confirmation':context.field?.verified?'Selected stage group':'Seasonal stage group'));
   const content=element('div','crop-stage-content');
   const point=(label,text)=>{const p=element('p'),strong=element('strong','',label+': ');p.append(strong,document.createTextNode(text));return p;};
   content.append(point('Objective',stage.objective),point('Timing',stage.timing));const actions=element('div','crop-stage-actions');actions.append(element('strong','','Actionable Steps:'));const list=element('ul');for(const step of stage.actions)list.append(element('li','',step));actions.append(list);content.append(actions,point('Technical Parameters',stage.technical));const warning=element('p','crop-stage-warning');warning.append(element('strong','','Critical Danger/Warning: '+stage.warning));content.append(warning);card.append(summary,content);root.append(card);
  }
  const source=element('details','crop-manual-sources'),sourceTitle=element('summary','','Sources, scope & local adjustments'),link=element('a','',manual.source.name);link.href=manual.source.url;link.target='_blank';link.rel='noopener noreferrer';source.append(sourceTitle,link,element('p','',manual.source.scope+' Retrieved '+manual.source.reviewed+'.'),element('p','','Priority: your district sowing reference and current extension advice → the actual cultivar / establishment method → soil / leaf tests and registered product labels. Crop risks listed in the source include '+manual.risk+'. Weather screens are the app’s planning rules, not official pesticide thresholds.'));root.append(source);
 }};
}
