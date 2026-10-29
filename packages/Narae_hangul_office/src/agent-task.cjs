'use strict';
const fs=require('node:fs'),path=require('node:path');
const {messengerTask,messengerTools,messengerStep}=require('./messenger-task.cjs');
const {edufineTask,edufineTools,edufineStep}=require('./edufine-task.cjs');
const {schoolFinalTask,schoolFinalTools,schoolFinalStep}=require('./school-final-task.cjs');
const school=/나이스|NEIS|복무|조퇴|연가|근무상황|개인결재선|기안문서상신|업무\s*포[털탈]/i;
function taskFor(prompt,history=[],now=new Date()){
 if(/업무\s*포[털탈]|에듀파인|gyomu_portal_session/.test(prompt)&&/(?:세션(?:을|의)?\s*(?:시간(?:을)?\s*)?(?:자동\s*)?(?:연장|유지|상태|확인)|남은\s*시간|로그인(?:을)?\s*유지|gyomu_portal_session)/.test(prompt))return {area:'session',observe:false,operation:/연장|extend/.test(prompt)?'extend':'status',instructions:'기존 업무 창의 세션만 확인한다. 새 창이나 로그인을 만들지 않는다.'};
 const messenger=messengerTask(prompt,history);if(messenger)return messenger;
 const final=schoolFinalTask(prompt,history);if(final)return final;
 const edufine=edufineTask(prompt,history,now);if(edufine)return edufine;
 let text=prompt;
 if(!school.test(text)&&/^(?:응|네|예|좋아|계속|진행|다음|로그인.*완료|했어|됐어|해줘|해 봐|다시|사유|날짜|시간|내일|모레|20\d{2}|검토자|결재자)/.test(text.trim())&&!/문서.*(?:만들|작성)|\.hwpx?|메신저/.test(text))text=(history.slice(-8).findLast(i=>i.role==='user'&&school.test(i.content))?.content||'')+'\n'+text;
 if(!school.test(text))return null;
 const neis=/나이스|NEIS|복무|조퇴|연가/i.test(text),mixed=/HWP|한글\s*(?:문서|파일)|\.hwpx?|PDF|쪽지|메신저|CBE|첨부/i.test(prompt);
 const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const times=[...text.matchAll(/\b([0-2]?\d):([0-5]\d)\b/g)].filter(m=>Number(m[1])<24).map(m=>m[1].padStart(2,'0')+':'+m[2]);
 let day=text.match(/\b(20\d{2})[-.]\s*(\d{1,2})[-.]\s*(\d{1,2})\b/);day=day?`${day[1]}-${day[2].padStart(2,'0')}-${day[3].padStart(2,'0')}`:/내일|모레|오늘/.test(text)?new Date(new Date(date+'T00:00:00Z').getTime()+(/모레/.test(text)?2:/내일/.test(text)?1:0)*86400000).toISOString().slice(0,10):null;
 const reason=text.match(/사유(?:는|[:：])\s*([^,\n.]+)/)?.[1].trim();
 return {area:neis?'neis':'portal',openPortal:/업무\s*포[털탈]/.test(prompt)&&/열어|띄워|접속|들어가/.test(prompt),loginIntent:/인증서.*로그인/.test(prompt)&&/눌러|누르|클릭/.test(prompt),openOnly:!neis&&!/에듀파인|공람|공문|기안/.test(prompt),mixed,draft:/초안|준비|신청|올려|등록/.test(text),plan:{date:day,start:times.length===2?times[0]:null,end:times.length===2?times[1]:null,reason,type:/조퇴/.test(text)?'조퇴':null},observe:!/(?:사용법|방법|절차|설명해|가능해[?？]?$|할 수 있(?:어|나요|습니까)[?？]?$)/.test(prompt),instructions:`현재 기준일은 ${date}, 시간대 Asia/Seoul이다. 내일/모레는 이 날짜로 계산한다. 아래 절차는 이미 제공되었으므로 같은 스킬을 반복 조회하지 않는다.\n`+fs.readFileSync(path.join(__dirname,'../resources/agent-skills/neis.md'),'utf8')};
}
function taskTools(task,all){if(task?.area==='school-final')return schoolFinalTools(all);if(task?.area==='session')return all.filter(t=>t.name==='gyomu_portal_session');if(task?.area==='edufine')return edufineTools(all,task);if(task?.area==='cbe')return messengerTools(all);if(!task||task.mixed)return all;return all.filter(t=>['gyomu_browser','gyomu_portal_open','gyomu_portal_session','gyomu_skill_read','gyomu_system_status'].includes(t.name));}
function formReady(plan,observed){
 const fields=(observed.elements||[]).map(e=>({label:e.label.replace(/[\s()]/g,''),value:String(e.value??e.display??'').trim()}));
 const matches=(pattern,value)=>{const found=fields.filter(e=>pattern.test(e.label));return Boolean(value&&found.length&&found.every(e=>{const current=e.value.replace(/[\s./:\-시분]/g,''),expected=value.replace(/[\s./:\-]/g,'');return current===expected||/^\d{1,2}$/.test(current)&&/^\d{1,2}$/.test(expected)&&Number(current)===Number(expected);}));};
 const time=(side,value)=>matches(new RegExp('^(?:'+side+'시각|'+side+'시간)$'),value)||Boolean(value&&matches(new RegExp('^(?:신청기간)?'+side+'(?:시간)?시$'),value.slice(0,2))&&matches(new RegExp('^(?:신청기간)?'+side+'(?:시간)?분$'),value.slice(3)));
 return matches(/근무상황소분류|^소분류$/,plan.type)&&matches(/^(?:신청일자|신청기간시작일자|신청기간종료일자|시작일자|종료일자)$/,plan.date)&&time('시작',plan.start)&&time('종료',plan.end)&&fields.some(e=>/^(?:사유|용무)$/.test(e.label)&&e.value===plan.reason);
}
function taskStep(task,input,all){
 if(task?.area==='school-final')return schoolFinalStep(task,input,all);
 if(task?.area==='session'){const call=input.find(i=>i.type==='function_call'&&i.name==='gyomu_portal_session'),tool=structuredClone(all.find(t=>t.name==='gyomu_portal_session'));if(!call&&tool){tool.parameters.properties.operation={type:'string',enum:[task.operation]};return {tools:[tool],required:true,instructions:'gyomu_portal_session으로 실제 '+task.operation+'를 한 번 실행한다.'};}if(!call)return {tools:[],receipt:'이 실행 환경의 세션 연장 도구가 아직 준비되지 않았습니다.'};let value;try{value=JSON.parse(input.find(i=>i.type==='function_call_output'&&i.call_id===call.call_id)?.output||'{}');}catch{}return {tools:[],receipt:value?.error?'세션 연장을 확인하지 못했습니다. 추가 창이나 로그인은 실행하지 않았습니다.':`자동 세션 연장: ${value?.enabled?'켜짐':'꺼짐'} · ${value?.intervalMinutes||10}분 간격\n`+((value?.results||[]).map(r=>r.host+': '+(r.verified?'연장 확인 · '+r.afterSeconds+'초':r.status)).join('\n')||'아직 확인된 연장 결과가 없습니다. 로그인된 기존 업무 창만 사용합니다.')};}
 if(task?.area==='cbe')return messengerStep(task,input,all);
 if(task?.area==='edufine')return edufineStep(task,input,all);
 if(!task)return {tools:all,instructions:''};
 if(!task.observe)return {tools:[],instructions:'사용 절차를 설명하는 요청이다. 제공된 절차로 답하고 실제 화면을 조작하지 않는다.'};
 const tools=structuredClone(all);let observed,routeApplied=false,certificateAttempted=false,certificateConfirmed=false;
 for(const item of input){if(item.type!=='function_call_output')continue;const call=input.find(c=>c.type==='function_call'&&c.call_id===item.call_id);if(call?.name!=='gyomu_browser'&&call?.name!=='gyomu_portal_open')continue;try{const value=JSON.parse(item.output),args=JSON.parse(call.arguments||'{}'),before=observed?.elements?.find(e=>e.ref===args.ref);if(args.action==='click'&&/교육행정.*전자서명.*인증서.*로그인/.test(before?.label||'')){certificateAttempted=true;certificateConfirmed=!value.error;}if(!value.error){if(args.action==='click'&&/^(?:결재선\s*)?지정$/.test(before?.label||'')&&/기안문서상신/.test(value.dialog||''))routeApplied=true;observed=value;}}catch{}}
 const browser=tools.find(t=>t.name==='gyomu_browser');if(!browser?.parameters?.properties)return {tools,instructions:''};
 if(task.openPortal){
  const opened=input.find(i=>i.type==='function_call'&&i.name==='gyomu_portal_open');
  if(!opened)return {tools:tools.filter(t=>t.name==='gyomu_portal_open'),required:true,instructions:'사용자가 업무포털을 열어 달라고 요청했다. gyomu_portal_open을 실제 실행한다. 열었다는 말로 대신하지 않는다.'};
  const result=input.find(i=>i.type==='function_call_output'&&i.call_id===opened.call_id);let value;try{value=JSON.parse(result?.output||'{}');}catch{}
  if(task.openOnly&&!task.loginIntent&&value?.url?.startsWith('https://')&&!value.error)return {tools:[],receipt:'업무포털 전용 브라우저를 열었습니다. 현재 페이지: '+(value.title||new URL(value.url).hostname)+'\n그 창에서 직접 로그인해 주세요. 로그인·인증 정보는 읽거나 입력하지 않았습니다.'};
 }
 if(task.loginIntent){
  if(certificateAttempted)return {tools:[],receipt:(certificateConfirmed?'인증서 로그인 버튼을 실제로 한 번 실행했습니다.':'인증서 로그인 버튼을 한 번 시도했으나 결과가 확인되지 않았습니다. 재시도하지 않았습니다.')+'\n현재 브라우저 페이지: '+(observed?.title||'미확인')+'\n브라우저 안의 인증서 암호 입력란: '+((observed?.elements||[]).some(e=>e.type==='password')?'확인됨':'확인되지 않음')+'\n암호 입력이나 로그인 제출은 실행하지 않았습니다.'};
  const login=observed?.elements?.find(e=>/교육행정.*전자서명.*인증서.*로그인/.test(e.label));if(login){browser.parameters.properties.action={type:'string',enum:['click']};browser.parameters.properties.ref={type:'string',enum:[login.ref]};browser.parameters.required=['action','ref'];return {tools:[browser],required:true,context:{source:'현재 실제 로그인 화면',url:observed.url,title:observed.title,elements:[login]},instructions:'관찰한 인증서 로그인 버튼을 한 번만 누른다. 비밀번호는 입력하지 않는다.'};}
  const opened=input.find(i=>i.type==='function_call'&&i.name==='gyomu_portal_open');
  if(observed?.url==='about:blank'&&!opened&&tools.some(t=>t.name==='gyomu_portal_open'))return {tools:tools.filter(t=>t.name==='gyomu_portal_open'),required:true,context:{url:observed.url},instructions:'현재 빈 브라우저다. 업무포털을 실제로 열어 로그인 버튼을 먼저 관찰한다. 아직 인증서 버튼은 클릭하지 않았다.'};
  if(opened&&!input.some((i,index)=>i.type==='function_call'&&i.name==='gyomu_browser'&&index>input.indexOf(opened))){browser.parameters.properties.action={type:'string',enum:['snapshot']};return {tools:[browser],required:true,instructions:'업무포털을 연 뒤 현재 페이지를 다시 관찰한다. 인증서 로그인 버튼이 실제로 나타나는지 확인한다.'};}
  if(observed)return {tools:[],receipt:'현재 브라우저 페이지: '+(observed.title||observed.url||'미확인')+'\n인증서 로그인 버튼을 현재 화면에서 확인하지 못했습니다. 버튼 클릭이나 암호 입력·로그인 제출은 실행하지 않았습니다.'};
 }
 const normalize=s=>String(s||'').replace(/[\s./:\-]/g,'');
 if(task.draft&&!task.mixed&&routeApplied&&observed.tables?.length&&[task.plan.date,task.plan.start,task.plan.end,task.plan.reason].every(v=>v&&normalize(observed.text).includes(normalize(v))))return {tools:[],instructions:'',receipt:`연가/조퇴 초안의 입력값과 결재선을 최종 준비 화면에서 확인했습니다.\n${task.plan.date} ${task.plan.start}~${task.plan.end} · 사유: ${task.plan.reason}\n결재선: ${observed.tables.join('\n')}\n최종 상신하지 않았습니다. 화면의 준비 상태를 유지합니다. 별도 임시저장 여부는 확인하지 않았습니다.`};
 let action,refs,instructions='';
 if(!observed){action='snapshot';instructions='먼저 현재 화면을 관찰한다. gyomu_browser action=snapshot. 절차는 이미 주어졌으므로 스킬을 다시 읽지 않는다.';}
 else if(observed.url==='about:blank'&&!input.some(i=>i.type==='function_call'&&i.name==='gyomu_portal_open')&&tools.some(t=>t.name==='gyomu_portal_open'))return {tools:tools.filter(t=>t.name==='gyomu_portal_open'),required:true,context:{url:observed.url},instructions:'현재 열린 업무 화면이 없다. 업무포털을 실제로 열고 현재 화면부터 확인한다.'};
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
 if(action){browser.parameters.properties.action={type:'string',enum:[action]};browser.parameters.required=[...new Set([...(browser.parameters.required||[]),...(refs?['ref']:[]),...(action==='fill'?['text']:[]),...(action==='select'?['value']:[])])];if(refs)browser.parameters.properties.ref={type:'string',enum:refs};return {tools:tools.filter(t=>t.name==='gyomu_browser'),instructions,required:true,context:{source:'현재 실제 화면의 다음 단계 관찰',url:observed?.url,title:observed?.title,dialog:observed?.dialog,elements:refs?observed?.elements?.filter(e=>refs.includes(e.ref)):[],frames:observed?.frames}};}
 // selectOption is only valid on a real HTML select, never a WebSquare div.
 if(observed?.elements){
  const refs=observed.elements.filter(e=>!e.disabled&&!(task.draft&&/근무상황신청/.test(observed.dialog||'')&&!formReady(task.plan,observed)&&e.label.replace(/\s/g,'')==='승인요청')).map(e=>e.ref);
  if(refs.length)browser.parameters.properties.ref={type:'string',enum:refs};
  else {delete browser.parameters.properties.ref;browser.parameters.properties.action.enum=browser.parameters.properties.action.enum.filter(a=>!['click','fill','select','check','uncheck','press'].includes(a));}
  if(!observed.elements.some(e=>e.tag==='select'))browser.parameters.properties.action.enum=browser.parameters.properties.action.enum.filter(a=>a!=='select');
  // Selectors and URLs cannot be guessed as a substitute for observed refs.
  delete browser.parameters.properties.selector;
 }
 return {tools,instructions:'현재 관찰 결과의 ref와 표시값으로 다음 한 단계를 실행한다. 최종 상신은 하지 않는다.'};
}
module.exports={taskFor,taskTools,taskStep,formReady};
