'use strict';
const {edufineStep}=require('./edufine-task.cjs');
function lifecycleTask(prompt){
 if(!/에듀파인|문서진행|공문|기안/.test(prompt)||/사용법|방법|설명|코드|개발|상신하고|상신해/.test(prompt)||/(?:회수|삭제)(?:은|는|을|를|도)?\s*(?:하지\s*(?:마|말)|금지)/.test(prompt.replace(/["“][^"”]*["”]/g,'')))return null;
 const operation=/삭제(?:를|까지)?\s*(?:해|하자|진행|실행|처리)/.test(prompt)?'delete-recalled':/회수(?:를|까지)?\s*(?:해|하자|진행|실행|처리)/.test(prompt)?'withdraw':null;if(!operation)return null;
 return {area:'edufine-lifecycle',operation,observe:true,title:prompt.match(/(?:제목|문서)(?:은|는|[:：])?\s*["“]([^"”]+)["”]/)?.[1]||prompt.match(/["“]([^"”]+)["”]/)?.[1],reason:prompt.match(/사유(?:는|[:：])?\s*["“]([^"”]+)["”]/)?.[1],instructions:'사용자가 명시한 한 문서만 회수하거나 회수본을 삭제한다. 현재 제목·실제 문서 ID·회수 상태·확인창과 조회 결과를 대조한다. 결과 불명 처리는 반복하지 않는다.'};
}
function records(input){return input.filter(i=>i.type==='function_call_output').flatMap(i=>{const c=input.find(c=>c.type==='function_call'&&c.call_id===i.call_id);try{return c?[{name:c.name,args:JSON.parse(c.arguments||'{}'),value:JSON.parse(i.output)}]:[];}catch{return [];}});}
function lifecycleStep(task,input,all){
 const rows=records(input),screens=rows.filter(r=>r.name==='gyomu_browser'&&!r.value.error&&r.value.elements),screen=screens.at(-1)?.value,tool=structuredClone(all.find(t=>t.name==='gyomu_browser')),done=receipt=>({tools:[],receipt});
 const required=(values,instructions)=>{if(!tool)return done('업무 브라우저가 없습니다.');tool.parameters={type:'object',properties:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,{type:typeof v==='boolean'?'boolean':typeof v==='number'?'integer':'string',enum:[v]}])),required:Object.keys(values),additionalProperties:false};return {tools:[tool],required:true,context:{source:'현재 문서진행의 실제 관찰',title:screen?.title,text:screen?.text,elements:screen?.elements,documentRows:screen?.documentRows},instructions};};
 if(!task.title)return done('회수·삭제할 정확한 기안 제목이 필요합니다. 다른 문서를 선택하지 않았습니다.');
 if(rows.at(-1)?.value.error)return required({action:'snapshot'},'앞 조작 후 화면 참조가 바뀌었을 수 있다. 현재 화면과 선택 상태를 새로 관찰하고 같은 ref나 최종 처리를 반복하지 않는다.');
 if(!screen)return required({action:'snapshot'},'현재 화면과 대상 목록을 확인한다.');
 if(screen.lifecycleContext){const context=screen.lifecycleContext,fields=screen.elements.filter(e=>e.tag==='textarea'&&/의견/.test(e.label)),buttons=screen.elements.filter(e=>!e.disabled&&e.label==='확인');if(!context.openerVerified||context.operation!==task.operation||context.title!==task.title||!context.documentId||fields.length!==1||buttons.length!==1)return done('현재 의견작성 창과 부모의 대상 문서를 대조하지 못했습니다. 확인하지 않았습니다.');if(!task.reason)return done('이 문서의 의견작성 창이 열려 있습니다. 입력할 회수·삭제 사유가 필요합니다. 같은 처리는 반복하지 않았습니다.');if(fields[0].value!==task.reason)return required({action:'fill',ref:fields[0].ref,text:task.reason},'실제 부모 목록의 대상 한 건과 연결된 의견작성 창에 사용자가 지정한 사유만 입력한다.');return required({action:'click',ref:buttons[0].ref,confirmFinalAction:true,expectedDocument:task.title,expectedDocumentId:context.documentId,expectedLabel:buttons[0].label,expectedUrl:screen.url,expectedState:screen.finalState},'같은 대상의 의견작성 단계만 한 번 확인하고 부모 서버 목록을 재조회한다. 원래 회수·삭제 버튼을 반복하지 않는다.');}
 const attempts=rows.filter(r=>r.name==='gyomu_browser'&&r.args.confirmFinalAction===true),last=attempts.at(-1),declined=last?.value.finalAction?.nativeDialog?.type==='confirm'&&last.value.finalAction.nativeDialog.accepted===false;
 const query=screen.elements.filter(e=>!e.disabled&&/^(조회|검색)$/.test(e.label.trim())),titleFields=screen.elements.filter(e=>e.tag==='input'&&/^(?:문서)?제목$/.test(e.label.replace(/\s/g,''))),progress=/문서진행|결재진행/.test(screen.title||'');
 const queried=after=>rows.some((r,i)=>i>after&&r.name==='gyomu_browser'&&r.args.action==='click'&&!r.value.error&&rows.slice(0,i).findLast(p=>p.value.elements)?.value.elements.some(e=>e.ref===r.args.ref&&/^(조회|검색)$/.test(e.label.trim())));
 if(last&&!declined){
  if(!progress)return done('최종 처리를 한 번 시도했으며 후속 창 또는 결과를 확인해야 합니다. 같은 회수·삭제는 반복하지 않았습니다. 현재 화면: '+screen.title);
  if(!queried(rows.indexOf(last))){if(query.length===1)return required({action:'click',ref:query[0].ref},'같은 최종 처리를 반복하지 않고 현재 조건의 서버 목록을 다시 조회한다.');return done('처리 시도 후 서버 목록을 재조회할 실제 버튼을 확인하지 못했습니다. 완료는 미확인입니다.');}
  const matching=(screen.documentRows||[]).filter(r=>r.documentIds.includes(last.args.expectedDocumentId));
  if(task.operation==='withdraw'&&matching.length===1&&matching[0].title===task.title&&/^(?:기안)?회수$/.test(matching[0].status))return done('같은 문서 ID의 서버 목록을 다시 조회해 회수 상태를 확인했습니다.\n제목: '+task.title+'\n회수를 반복하지 않았습니다.');
  if(task.operation==='delete-recalled'&&(task.titleScoped||titleFields.length===1&&titleFields[0].value===task.title)&&matching.length===0&&/총\s*0\s*건|조회\s*결과(?:가)?\s*없/.test(screen.text||''))return done('정확한 제목으로 서버 목록을 다시 조회해 해당 회수본이 없음을 확인했습니다.\n제목: '+task.title+'\n같은 삭제를 반복하지 않았습니다.');
  return done('처리를 한 번 시도하고 서버 목록을 다시 조회했으나 요청한 결과를 확인하지 못했습니다. 같은 처리는 반복하지 않았습니다.');
 }
 if(!progress)return edufineStep({area:'edufine',target:'문서진행',route:'결재',summary:false,writing:false,observe:true,period:null,instructions:task.instructions},input,all);
 if(!Array.isArray(screen.documentRows))return done('현재 CLI에서 문서진행의 행별 제목·ID·선택·상태를 확인하지 못했습니다. 회수·삭제하지 않았습니다.');
 if(titleFields.length===1){if(titleFields[0].value!==task.title)return required({action:'fill',ref:titleFields[0].ref,text:task.title},'관찰한 제목 검색란에 요청한 정확한 제목을 입력한다.');const lastFill=rows.findLastIndex(r=>r.name==='gyomu_browser'&&r.args.action==='fill');if(!queried(lastFill)&&query.length===1)return required({action:'click',ref:query[0].ref},'제목 검색 조건으로 실제 서버 목록을 조회한다.');task.titleScoped=true;}
 const matching=screen.documentRows.filter(r=>r.title===task.title);if(matching.length!==1||matching[0].documentIds.length!==1)return done('현재 목록에서 같은 제목의 문서를 실제 ID 한 개로 확정하지 못했습니다. 회수·삭제하지 않았습니다.');
 const target=matching[0],selected=screen.documentRows.filter(r=>r.selected);if(selected.some(r=>r!==target))return done('다른 문서가 선택되어 있어 회수·삭제하지 않았습니다.');
 if(task.operation==='withdraw'&&/^(?:기안)?회수$/.test(target.status))return done('해당 문서는 현재 서버 목록에서 이미 회수 상태입니다. 중복 회수하지 않았습니다.');
 if(task.operation==='delete-recalled'&&!/^(?:기안)?회수$/.test(target.status))return done('해당 문서가 회수 상태가 아니어서 삭제하지 않았습니다.');
 if(!target.selected){if(!target.checkboxRef)return done('대상 행의 실제 체크박스를 확인하지 못했습니다.');return required({action:'check',ref:target.checkboxRef},'정확한 제목·ID의 대상 한 건만 선택한다.');}
 const buttons=screen.elements.filter(e=>!e.disabled&&(task.operation==='withdraw'?/^(?:기안)?회수$/:/^(?:삭제|삭제\s*\/\s*연계반송)$/).test(e.label.trim()));if(buttons.length!==1)return done('현재 대상에 실행할 유일한 버튼을 확인하지 못했습니다.');
 let confirmationText;if(declined){const dialog=last.value.finalAction.nativeDialog;if(attempts.length!==1||last.args.expectedDocumentId!==target.documentIds[0]||!/겠습니까|할까요/.test(dialog.message)||!(task.operation==='withdraw'?/회수/:/삭제|연계반송/).test(dialog.message)||/발송|전송|반려|암호|서명/.test(dialog.message))return done('확인창이 요청한 처리와 다르거나 이미 확인을 시도했습니다. 반복하지 않았습니다.');confirmationText=dialog.message;}
 return required({action:'click',ref:buttons[0].ref,confirmFinalAction:true,expectedDocument:task.title,expectedDocumentId:target.documentIds[0],expectedLabel:buttons[0].label,expectedUrl:screen.url,expectedState:screen.finalState,...(confirmationText?{confirmationText}:{})},'현재 제목·실제 ID·상태·화면 지문을 묶어 요청한 '+(task.operation==='withdraw'?'회수':'회수본 삭제')+'를 한 번 실행한다. 실제 확인창과 이후 서버 목록을 대조한다.');
}
module.exports={lifecycleTask,lifecycleStep};
