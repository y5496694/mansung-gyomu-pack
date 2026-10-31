'use strict';
const path=require('node:path'),fs=require('node:fs');
function observations(input){const records=[];for(const item of input){if(item.type!=='function_call_output')continue;const call=input.find(c=>c.type==='function_call'&&c.call_id===item.call_id);if(!call)continue;try{records.push({name:call.name,args:JSON.parse(call.arguments),value:JSON.parse(item.output)});}catch{}}return records;}
function dates(text){return [...String(text).matchAll(/(20\d{2})\s*(?:년|[-./])\s*(\d{1,2})\s*(?:월|[-./])\s*(\d{1,2})(?:일)?/g)].map(m=>m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0'));}
function validateWxsBody(prompt,input,args){
 if(typeof args.config?.body!=='string')return;
 const files=(args.config.attachments||[]).filter(p=>/\.hwpx?$/i.test(p));if(!files.length)return;
 const records=observations(input),sources=[];
 for(const file of files){const read=records.findLast(r=>r.name==='read_document'&&!r.value?.error&&path.resolve(r.args.path).toLowerCase()===path.resolve(file).toLowerCase()&&(r.value?.hash||r.value?.input_sha256));if(!read)throw new Error('기안 첨부의 실제 본문을 먼저 read_document로 읽으세요. 파일명만으로 내용을 작성하지 않습니다.');sources.push([...(read.value.paragraphs||[]),...(read.value.blocks||[])].map(p=>p.text||'').join('\n'));}
 if(/수정|변경|바꾸/.test(prompt))return;
 const allowed=new Set(dates(prompt+'\n'+sources.join('\n'))),unknown=dates(args.config.body).filter(d=>!allowed.has(d));if(unknown.length)throw new Error('기안 본문에 첨부·사용자 요청에서 확인되지 않은 날짜가 있습니다: '+[...new Set(unknown)].join(', ')+'. 첨부의 실제 내용만 사용하거나 일정은 붙임 계획을 참조하도록 작성하세요.');
}
// Bind native continuation to observed handles/receipts, never invented IDs.
function wxsStep(prompt,input,step,task){
 if(!['edufine','school-final'].includes(task?.area))return step;
 const records=observations(input);
 const native=records.filter(r=>r.name.startsWith('gyomu_wxs')),tools=structuredClone(step.tools),required=(name,values,instructions)=>{const tool=tools.find(t=>t.name===name);if(!tool)return step;tool.parameters={type:'object',properties:Object.fromEntries(Object.entries(values).map(([key,value])=>[key,{type:'string',enum:[String(value)]}])),required:Object.keys(values),additionalProperties:false};return {tools:[tool],required:true,context:{source:'직전 실제 WXS 도구 결과',observations:native.slice(-2).map(r=>{const text=JSON.stringify(r);return text.length<=4000?r:{name:r.name,args:r.args,truncated:true,preview:text.slice(0,4000)};})},instructions};};
 const prepared=native.findLast(r=>r.name==='gyomu_wxs_final_prepare'&&r.value?.ok&&r.value.receiptId),confirmed=native.find(r=>r.name==='gyomu_wxs_final_confirm'||r.name==='gyomu_wxs_final_continue'&&r.args.operation==='confirm-previewed');
 if(prepared&&!confirmed){
  const dialog=native.findLast(r=>r.name==='gyomu_wxs_final_dialog'&&r.args.receipt_id===prepared.value.receiptId);
  if(!dialog)return required('gyomu_wxs_final_dialog',{receipt_id:prepared.value.receiptId},'직전 실행의 실제 receiptId로 확인창을 읽는다. 상신을 다시 실행하지 않는다.');
  const message=dialog.value?.message;
  if(dialog.value?.document_preview?.fingerprint&&typeof message==='string'&&tools.some(t=>t.name==='gyomu_wxs_final_continue'))return required('gyomu_wxs_final_continue',{operation:'confirm-previewed',receipt_id:prepared.value.receiptId,expected_message:message,expected_fingerprint:dialog.value.document_preview.fingerprint},'원본 CLI가 반환한 내부결재 준비 후 본문·결재선·첨부·공개 구분 미리보기를 현재 기록의 지문으로 대조한다. 원본 CLI의 변경 검증을 통과한 동일 기록만 이어 처리한다.');
  if((dialog.value?.present===true||dialog.value?.status==='confirmation')&&typeof message==='string'&&/상신|결재|승인/.test(message)&&/겠습니까|할까요/.test(message)&&!dialog.value.document_preview&&!dialog.value.route_review&&!/삭제|발송|전송|반려|인증|암호|서명/.test(message))return required('gyomu_wxs_final_confirm',{receipt_id:prepared.value.receiptId,expected_message:message},'실제로 관찰한 같은 실행의 확인 문구를 정확히 사용한다. 목록 재조회 전에는 완료로 보고하지 않는다.');
  return {...step,tools:tools.filter(t=>['gyomu_browser','gyomu_wxs'].includes(t.name)),instructions:'이 확인창은 자동 수락 가능한 일반 상신·결재 확인으로 검증되지 않았다. 문구와 현재 상태를 보고하고 재상신·별도 수락을 하지 않는다.'};
 }
 if(confirmed&&prepared&&tools.some(t=>t.name==='gyomu_wxs_final_continue')){
  const preview=native.find(r=>r.name==='gyomu_wxs_final_continue'&&r.args.operation==='process-preview'),applied=native.find(r=>r.name==='gyomu_wxs_final_continue'&&r.args.operation==='process-apply');
  if(!confirmed.value.error&&!preview)return required('gyomu_wxs_final_continue',{operation:'process-preview',receipt_id:prepared.value.receiptId},'상신 확인 후 원본 CLI로 동일 기록의 실제 문서처리 양식과 선택값을 확인한다.');
  if(preview?.value.fingerprint&&!applied)return required('gyomu_wxs_final_continue',{operation:'process-apply',receipt_id:prepared.value.receiptId,expected_fingerprint:preview.value.fingerprint},'직전 실제 문서처리 양식의 지문으로 동일 작업을 한 번 이어 처리한다. 암호·공문게시·변경된 문서는 원본 CLI에서 거절된다. 이후 목록을 재조회한다.');
 }
 if(confirmed&&!records.some(r=>r.name==='gyomu_browser'&&records.indexOf(r)>records.indexOf(confirmed)&&!r.value?.error))return required('gyomu_browser',{action:'snapshot'},'최종 확인 뒤 현재 문서진행 목록의 제목·상태·결재자를 실제 재조회한다.');
 const saveAttempt=native.findLast(r=>r.name==='gyomu_wxs_save'||r.name==='gyomu_wxs_prepare'&&r.value?.ok&&(r.value.result?.saved===true||r.value.result?.save?.saved===true));
 if(saveAttempt){
  const reread=native.findLast(r=>r.name==='gyomu_wxs'&&r.args.operation==='draft-status'&&String(r.args.hwnd)===String(saveAttempt.args.hwnd)&&native.indexOf(r)>native.indexOf(saveAttempt));
  if(!reread)return required('gyomu_wxs',{operation:'draft-status',hwnd:saveAttempt.args.hwnd},'임시저장을 이미 한 번 시도했다. 같은 창의 실제 상태를 다시 읽고 재저장하지 않는다.');
  if(saveAttempt.value.error||!saveAttempt.value.ok||!(saveAttempt.value.result?.saved===true||saveAttempt.value.result?.save?.saved===true)||reread.value.error)return {tools:[],receipt:'기안 임시저장을 시도했지만 완료를 확인하지 못했습니다. '+(saveAttempt.value.error||reread.value.error||'저장 결과 미확인')+'\n같은 창의 상태를 재조회했으며 같은 저장을 반복하거나 상신하지 않았습니다.'};
  if(task.area==='edufine'&&task.writing&&!task.summary&&!task.documentCreate){
   const before=native.slice(0,native.indexOf(saveAttempt)).findLast(r=>r.name==='gyomu_wxs'&&r.args.operation==='draft-status'&&String(r.args.hwnd)===String(saveAttempt.args.hwnd)&&!r.value.error);
   const changed=before&&saveAttempt.name==='gyomu_wxs_save'&&['title','body','attachments','approval_route'].some(k=>Object.hasOwn(before.value,k)&&JSON.stringify(before.value[k])!==JSON.stringify(reread.value[k]));
   return {tools:[],receipt:changed?'임시저장 응답 후 같은 창을 다시 읽었지만 원문·첨부·결재선 중 변경된 항목이 있어 보존 완료로 처리하지 않았습니다.\n재저장하거나 상신하지 않았습니다.':'기안 임시저장 응답과 같은 창의 제목·본문·첨부·결재선을 재조회했습니다.\n제목: '+(reread.value.title||'제목 미확인')+'\n미상신입니다. 저장·입력을 반복하지 않았습니다. 임시저장 목록 재열기와 첨부 서버 바이트 검증은 별도 확인 대상입니다.'};
  }
  return {...step,tools:tools.filter(t=>!['gyomu_wxs_save','gyomu_wxs_prepare','gyomu_wxs_options'].includes(t.name)),instructions:(step.instructions||'')+' 임시저장 시도 뒤 같은 초안을 다시 읽었다. 같은 저장이나 본문 입력을 반복하지 않고 실제 결과·목록 확인 범위만 보고한다.'};
 }
 const direct=/현재\s*열린\s*WXS|이미\s*열린\s*WXS/i.test(prompt),listing=native.findLast(r=>r.name==='gyomu_wxs'&&r.args.operation==='windows'&&!r.value?.error),windows=listing?.value?.windows||[];
 if(direct&&!listing&&tools.some(t=>t.name==='gyomu_wxs_prepare'))return required('gyomu_wxs',{operation:'windows'},'현재 열린 WXS의 실제 제목과 HWND부터 조회한다. 핸들을 추측하거나 다른 문서를 열지 않는다.');
 const window=windows.length===1?windows[0]:null,status=native.findLast(r=>r.name==='gyomu_wxs'&&r.args.operation==='draft-status'&&!r.value?.error),applied=native.findLast(r=>r.name==='gyomu_wxs_prepare'&&r.value?.ok);
 if(window&&!status)return required('gyomu_wxs',{operation:'draft-status',hwnd:window.hwnd},'조회한 동일 HWND의 본문·제목·첨부·결재선을 먼저 확인한다.');
 const paths=[...prompt.matchAll(/["“]([^"“”\r\n]+\.hwpx?)["”]/gi)].map(m=>m[1]).filter(p=>path.isAbsolute(p)&&fs.existsSync(p));
 if(paths.length===1&&!prepared&&!applied&&!records.some(r=>r.name==='read_document'&&!r.value?.error&&path.resolve(r.args.path).toLowerCase()===path.resolve(paths[0]).toLowerCase()&&(r.value?.hash||r.value?.input_sha256)))return required('read_document',{path:paths[0]},'첨부할 실제 한글 계획서를 먼저 읽고 날짜·장소·인원·예산을 확인한다. 본문에 없는 사실을 만들지 않는다.');
 if(applied&&(!status||native.indexOf(status)<native.indexOf(applied)))return required('gyomu_wxs',{operation:'draft-status',hwnd:applied.args.hwnd},'입력 후 동일 기안을 다시 읽어 본문·첨부 서버 사본·결재선을 대조한다. 파일명만으로 첨부 검증을 완료하지 않는다.');
 if(applied&&status&&!saveAttempt&&/임시\s*저장/.test(prompt)){
  const config=applied.args.config||{},normalize=s=>String(s||'').replace(/\s+/g,' ').trim();
  if(config.title&&normalize(config.title)!==normalize(status.value.title)||config.body&&!normalize(status.value.document_text||status.value.body).includes(normalize(config.body)))return {tools:[],receipt:'기안 입력 후 다시 읽은 제목·본문이 요청한 값과 일치하지 않아 임시저장을 실행하지 않았습니다. 미상신입니다.'};
  if(status.value.title)return required('gyomu_wxs_save',{hwnd:applied.args.hwnd,expected_title:status.value.title,name:config.save_name||status.value.title},'기안 입력과 재조회를 확인했다. 사용자가 요청한 임시저장을 같은 제목으로 한 번 실행한다. 상신하지 않는다.');
 }
 const basic=/첨부/.test(prompt)&&/한글|\.hwpx?/i.test(prompt)&&!/과제카드|공개설정|비공개|수신자\s*지정|자동\s*발송|본문.{0,12}(?:서식|그대로|보존)/.test(prompt);
 for(const tool of tools){
  if(tool.name==='gyomu_wxs_prepare'&&window&&typeof status?.value?.title==='string'){
   tool.parameters.properties.hwnd={type:'string',enum:[String(window.hwnd)]};tool.parameters.required=[...new Set([...(tool.parameters.required||[]),'hwnd'])];const config=tool.parameters.properties.config;if(config?.properties){config.properties.expected_title={type:'string',enum:[status.value.title]};config.required=[...new Set([...(config.required||[]),'expected_title'])];}
  }
  if(tool.name==='gyomu_wxs_prepare'&&task.writing){
   const config=tool.parameters.properties.config,literals={title:prompt.match(/제목(?:은|으로|:|：)?\s*["“]([^"”]+)["”]/)?.[1],body:prompt.match(/본문(?:은|으로|:|：)?\s*["“]([^"”]+)["”]/)?.[1]};
   if(config?.properties)for(const [key,value]of Object.entries(literals))if(value){config.properties[key]={type:'string',enum:[value]};config.required=[...new Set([...(config.required||[]),key])];}
   if(literals.body&&config?.properties&&!/과제|수신|결재.{0,12}(?:추가|지정|변경|바꾸)|공개|비공개|관인|발송|첨부/.test(prompt))config.properties=Object.fromEntries(Object.entries(config.properties).filter(([k])=>['expected_title','title','body','save_name'].includes(k)));
  }
  if(tool.name==='gyomu_wxs_prepare'&&basic){const config=tool.parameters.properties.config;if(!config?.properties)continue;config.properties=Object.fromEntries(Object.entries(config.properties).filter(([key])=>['expected_title','title','body','attachments'].includes(key)));const title=prompt.match(/제목\s*[:：]?\s*["“]([^"”]+)["”]/)?.[1]||prompt.match(/제목\s+([^,\n]+),/)?.[1];if(title)config.properties.title={type:'string',enum:[title.trim()]};if(/첨부(?:해|하|하고|해서)/.test(prompt)){config.required=[...new Set([...(config.required||[]),'attachments'])];config.properties.attachments.minItems=1;}if(/기안문.{0,12}(?:작성|만들)|본문.{0,40}(?:작성|만들)/.test(prompt))config.required=[...new Set([...(config.required||[]),'body'])];if(window){tool.parameters.properties.hwnd={type:'string',enum:[String(window.hwnd)]};if(typeof status?.value?.title==='string')config.properties.expected_title={type:'string',enum:[status.value.title]};}}
 }
 if(task.writing&&!task.documentCreate&&!applied&&window&&status&&/(?:제목|본문)(?:은|으로|:|：)?\s*["“][^"”]+["”]/.test(prompt)&&tools.some(t=>t.name==='gyomu_wxs_prepare'))return {...step,tools:tools.filter(t=>t.name==='gyomu_wxs_prepare'),required:true,instructions:'사용자가 지정한 제목·본문을 아직 입력하지 않았다. 실제 창과 원래 제목에 맞춰 WXS 입력 도구를 먼저 실행한다. 입력 전 임시저장을 완료로 대신하지 않는다.'};
 return {...step,tools:applied?tools.filter(t=>t.name!=='gyomu_wxs_prepare'):tools};
}
module.exports={wxsStep,validateWxsBody};
