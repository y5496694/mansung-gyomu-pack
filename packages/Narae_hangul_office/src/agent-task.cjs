'use strict';
const fs=require('node:fs'),path=require('node:path');
const school=/나이스|NEIS|복무|조퇴|연가|근무상황|개인결재선|기안문서상신|업무\s*포[털탈]/i;
function taskFor(prompt,history=[],now=new Date()){
 let text=prompt;
 if(!school.test(text)&&/^(?:응|네|예|좋아|계속|진행|다음|로그인.*완료|했어|됐어|해줘|해 봐|다시|사유|날짜|시간|내일|모레|20\d{2}|검토자|결재자)/.test(text.trim())&&!/문서.*(?:만들|작성)|\.hwpx?|메신저/.test(text))text=(history.slice(-8).findLast(i=>i.role==='user'&&school.test(i.content))?.content||'')+'\n'+text;
 if(!school.test(text))return null;
 const neis=/나이스|NEIS|복무|조퇴|연가/i.test(text),mixed=/HWP|한글\s*(?:문서|파일)|\.hwpx?|PDF|쪽지|메신저|CBE|첨부/i.test(prompt);
 const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const times=[...text.matchAll(/\b([0-2]?\d):([0-5]\d)\b/g)].filter(m=>Number(m[1])<24).map(m=>m[1].padStart(2,'0')+':'+m[2]);
 let day=text.match(/\b(20\d{2})[-.]\s*(\d{1,2})[-.]\s*(\d{1,2})\b/);day=day?`${day[1]}-${day[2].padStart(2,'0')}-${day[3].padStart(2,'0')}`:/내일|모레|오늘/.test(text)?new Date(new Date(date+'T00:00:00Z').getTime()+(/모레/.test(text)?2:/내일/.test(text)?1:0)*86400000).toISOString().slice(0,10):null;
 const reason=text.match(/사유(?:는|[:：])\s*([^,\n.]+)/)?.[1].trim();
 return {area:neis?'neis':'portal',mixed,draft:/초안|준비|신청|올려|등록/.test(text),plan:{date:day,start:times.length===2?times[0]:null,end:times.length===2?times[1]:null,reason,type:/조퇴/.test(text)?'조퇴':null},observe:!/(?:사용법|방법|절차|설명해|가능해|할 수 있)/.test(prompt),instructions:`현재 기준일은 ${date}, 시간대 Asia/Seoul이다. 내일/모레는 이 날짜로 계산한다. 아래 절차는 이미 제공되었으므로 같은 스킬을 반복 조회하지 않는다.\n`+fs.readFileSync(path.join(__dirname,'../resources/agent-skills/neis.md'),'utf8')};
}
function taskTools(task,all){if(!task||task.mixed)return all;return all.filter(t=>['gyomu_browser','gyomu_portal_open','gyomu_skill_read','gyomu_system_status'].includes(t.name));}
function formReady(plan,observed){
 const fields=(observed.elements||[]).map(e=>({label:e.label.replace(/[\s()]/g,''),value:String(e.value??e.display??'').trim()}));
 const matches=(pattern,value)=>{const found=fields.filter(e=>pattern.test(e.label));return Boolean(value&&found.length&&found.every(e=>{const current=e.value.replace(/[\s./:\-시분]/g,''),expected=value.replace(/[\s./:\-]/g,'');return current===expected||/^\d{1,2}$/.test(current)&&/^\d{1,2}$/.test(expected)&&Number(current)===Number(expected);}));};
 const time=(side,value)=>matches(new RegExp('^(?:'+side+'시각|'+side+'시간)$'),value)||Boolean(value&&matches(new RegExp('^(?:신청기간)?'+side+'(?:시간)?시$'),value.slice(0,2))&&matches(new RegExp('^(?:신청기간)?'+side+'(?:시간)?분$'),value.slice(3)));
 return matches(/근무상황소분류|^소분류$/,plan.type)&&matches(/^(?:신청일자|신청기간시작일자|신청기간종료일자|시작일자|종료일자)$/,plan.date)&&time('시작',plan.start)&&time('종료',plan.end)&&fields.some(e=>/^(?:사유|용무)$/.test(e.label)&&e.value===plan.reason);
}
function taskStep(task,input,all){
 if(!task)return {tools:all,instructions:''};
 if(!task.observe)return {tools:[],instructions:'사용 절차를 설명하는 요청이다. 제공된 절차로 답하고 실제 화면을 조작하지 않는다.'};
 const tools=structuredClone(all);let observed,routeApplied=false;
 for(const item of input){if(item.type!=='function_call_output')continue;const call=input.find(c=>c.type==='function_call'&&c.call_id===item.call_id);if(call?.name!=='gyomu_browser'&&call?.name!=='gyomu_portal_open')continue;try{const value=JSON.parse(item.output),args=JSON.parse(call.arguments||'{}'),before=observed?.elements?.find(e=>e.ref===args.ref);if(!value.error){if(args.action==='click'&&/^(?:결재선\s*)?지정$/.test(before?.label||'')&&/기안문서상신/.test(value.dialog||''))routeApplied=true;observed=value;}}catch{}}
 const browser=tools.find(t=>t.name==='gyomu_browser');if(!browser?.parameters?.properties)return {tools,instructions:''};
 const normalize=s=>String(s||'').replace(/[\s./:\-]/g,'');
 if(task.draft&&!task.mixed&&routeApplied&&observed.tables?.length&&[task.plan.date,task.plan.start,task.plan.end,task.plan.reason].every(v=>v&&normalize(observed.text).includes(normalize(v))))return {tools:[],instructions:'',receipt:`연가/조퇴 초안의 입력값과 결재선을 최종 준비 화면에서 확인했습니다.\n${task.plan.date} ${task.plan.start}~${task.plan.end} · 사유: ${task.plan.reason}\n결재선: ${observed.tables.join('\n')}\n최종 상신하지 않았습니다. 화면의 준비 상태를 유지합니다. 별도 임시저장 여부는 확인하지 않았습니다.`};
 let action,refs,instructions='';
 if(!observed){action='snapshot';instructions='먼저 현재 화면을 관찰한다. gyomu_browser action=snapshot. 절차는 이미 주어졌으므로 스킬을 다시 읽지 않는다.';}
 else if(/공지사항|전달사항/.test(observed.dialog||'')){
  const close=observed.elements?.filter(e=>!e.disabled&&/^(닫기|창 닫기|공지사항 닫기|close|×)$/i.test(e.label.trim()));
  if(close?.length){action='click';refs=close.map(e=>e.ref);instructions='현재 공지사항 팝업이 메뉴를 가리고 있다. 관찰된 닫기 ref를 click하여 먼저 닫는다. 배경 메뉴는 누르지 않는다.';}
 }else if(observed.elements?.length===0&&observed.frames?.length){action='frames';instructions='현재 본문은 프레임 안에 있다. 먼저 action=frames로 실제 프레임 index를 조회한다.';}
 else if(!observed.elements&&observed.frames?.some(f=>Number.isInteger(f.index)&&!f.active)){
  action='frame';const indexes=observed.frames.filter(f=>!f.active&&f.url!=='about:blank').map(f=>f.index);browser.parameters.properties.index={type:'integer',enum:indexes};instructions='frames에서 관찰한 실제 index로 action=frame 하여 업무 프레임을 선택한다.';
 }
 const options=observed?.elements?.filter(e=>e.role==='option'&&!e.disabled);
 if(!action&&options?.length){action='click';refs=options.map(e=>e.ref);instructions='현재 펼쳐진 목록의 option을 click한다. combobox를 다시 누르지 않는다. 사용자 요청에 맞는 선택지를 고른다.';}
 if(!action&&task.plan.type&&/근무상황신청/.test((observed?.dialog||'')+' '+(observed?.text||''))){
  const missing=Object.entries({신청일자:task.plan.date,시작시각:task.plan.start,종료시각:task.plan.end,사유:task.plan.reason}).filter(([,v])=>!v).map(([k])=>k);
  if(task.draft&&missing.length)return {tools:[],instructions:'초안 입력에 필요한 '+missing.join(', ')+'가 사용자 요청에서 확인되지 않았다. 값을 지어내거나 입력하지 말고 이 정보만 질문한다.'};
  const p=task.plan,fields=[[/근무상황소분류|^소분류$/,p.type],[/^(?:신청일자|신청기간시작일자|신청기간종료일자|시작일자|종료일자)$/,p.date],[/^(?:시작시각|시작시간)$/,p.start],[/^(?:종료시각|종료시간)$/,p.end],[/^(?:신청기간)?시작(?:시간)?시$/,p.start?.slice(0,2)],[/^(?:신청기간)?시작(?:시간)?분$/,p.start?.slice(3)],[/^(?:신청기간)?종료(?:시간)?시$/,p.end?.slice(0,2)],[/^(?:신청기간)?종료(?:시간)?분$/,p.end?.slice(3)],[/^(?:사유|용무)$/,p.reason]];
  for(const [label,value]of fields){if(!value)continue;const field=observed.elements?.find(e=>label.test(e.label.replace(/\s+/g,''))&&!e.disabled);if(!field)continue;const current=String(field.value??field.display??'').trim();if(current===value)continue;
   action=field.role==='combobox'?'click':field.tag==='select'?'select':field.tag==='input'||field.tag==='textarea'?'fill':null;if(!action)continue;
   refs=[field.ref];if(action==='fill')browser.parameters.properties.text={type:'string',enum:[value]};if(action==='select'){const option=field.options?.find(o=>o.text===value||o.value===value);if(!option){action=null;continue;}browser.parameters.properties.value={type:'string',enum:[option.value]};}
   instructions=`관찰한 ${field.label}에 사용자가 지정한 ${value}를 ${action}한다. 다른 필드와 섞지 않는다.`;break;
  }
 }
 if(!action&&task.draft){
  const labels=/근무상황신청/.test(observed?.dialog||'')?(formReady(task.plan,observed)?['승인요청']:[]):/개인\s*결재선\s*지정/.test(observed?.dialog||'')?['지정']:/기안문서상신/.test(observed?.dialog||'')&&!routeApplied?['개인결재선']:!observed?.dialog?['복무','개인근무상황관리','신청']:[];
  const next=observed?.elements?.find(e=>!e.disabled&&labels.includes(e.label.trim()));if(next){action='click';refs=[next.ref];instructions=`초안 준비가 아직 끝나지 않았다. 관찰한 ${next.label}을 click하여 다음 준비 단계로 이동한다. 최종 상신은 하지 않는다.`;}
 }
 if(action){browser.parameters.properties.action={type:'string',enum:[action]};browser.parameters.required=[...new Set([...(browser.parameters.required||[]),...(refs?['ref']:[]),...(action==='fill'?['text']:[]),...(action==='select'?['value']:[])])];if(refs)browser.parameters.properties.ref={type:'string',enum:refs};return {tools:tools.filter(t=>t.name==='gyomu_browser'),instructions,required:true};}
 // selectOption is only valid on a real HTML select, never a WebSquare div.
 if(observed?.elements){
  const refs=observed.elements.filter(e=>!e.disabled&&!(task.draft&&/근무상황신청/.test(observed.dialog||'')&&!formReady(task.plan,observed)&&e.label.replace(/\s/g,'')==='승인요청')).map(e=>e.ref);
  browser.parameters.properties.ref={type:'string',enum:refs};
  if(!observed.elements.some(e=>e.tag==='select'))browser.parameters.properties.action.enum=browser.parameters.properties.action.enum.filter(a=>a!=='select');
  // Selectors and URLs cannot be guessed as a substitute for observed refs.
  delete browser.parameters.properties.selector;
 }
 return {tools,instructions:'현재 관찰 결과의 ref와 표시값으로 다음 한 단계를 실행한다. 최종 상신은 하지 않는다.'};
}
module.exports={taskFor,taskTools,taskStep,formReady};
