'use strict';
const name='gyomu_edufine_requisition';
const normalize=v=>String(v||'').replace(/\s+/g,'');
function registrationStep(task,records,tool){
 const last=records.at(-1),plan=records.find(r=>r.args.operation==='draft')?.value,owned=records.find(r=>r.args.operation==='prepare-input')?.value;
 const exact=value=>({enum:[value]}),arg=(operation,values={},context)=>{const args={operation,...values},selected=structuredClone(tool);selected.parameters={type:'object',properties:Object.fromEntries(Object.entries(args).map(([k,v])=>[k,exact(v)])),required:Object.keys(args),additionalProperties:false};return {tools:[selected],required:true,context:context||{source:'실제 품의 도구 결과에서 고정한 다음 동작',operation,preview:{title:plan?.draft?.title,id:owned?.id}},instructions:'현재 품의 전용 미리보기의 값으로 '+operation+'를 한 번 실행한다. 대상 ID·지문·실제 확인창을 바꾸지 않는다. 클릭이나 성공 안내만으로 완료하지 않고 서버 재조회를 확인한다.'};};
 if(!last)return null;
 if(last.value.error)return {tools:[],receipt:'품의 자동 처리 중 중단했습니다: '+(typeof last.value.error==='string'?last.value.error:JSON.stringify(last.value.error))+'\n같은 저장·삭제나 품목 추가를 반복하지 않았습니다.'};
 if(last.args.operation==='draft')return plan.missing?.length?{tools:[],receipt:'품의 등록에 필요한 값: '+plan.missing.join(', ')}:arg('prepare-input',{draft:plan.draft});
 const values={id:owned?.id,digest:owned?.digest};if(!values.id||!values.digest)return {tools:[],receipt:'현재 품의의 입력 미리보기 ID를 확인하지 못했습니다.'};
 if(last.args.operation==='prepare-input')return last.value.ready?arg('fill',values):{tools:[],receipt:'빈 신규 품의 입력 화면을 확인하지 못했습니다.'};
 if(last.args.operation==='fill')return arg('budget-options',values);
 if(last.args.operation==='budget-options'){
  const candidates=last.value.candidates||[],wanted=normalize(plan.draft.budget),matches=candidates.filter(c=>[c.values['산출내역'],c.values['세부항목'],Object.values(c.values).filter(Boolean).join(' ')].some(v=>normalize(v)===wanted));
  if(matches.length!==1)return {tools:[],receipt:'예산을 하나로 확정할 수 없어 선택을 보류했습니다.\n'+candidates.map(c=>[c.values['세부사업'],c.values['세부항목'],c.values['원가통계비목'],c.values['산출내역'],c.values['예산잔액']].join(' / ')).join('\n')+'\n정확한 산출내역을 지정해 주세요. 저장하지 않았습니다.'};
  return arg('select-budget',{...values,budgetKey:matches[0].key});
 }
 if(last.args.operation==='select-budget')return arg('enter-items',values);
 if(last.args.operation==='enter-items'){
  const files=[...task.prompt.matchAll(/["“]([^"”\r\n]+\.(?:pdf|txt|png|jpe?g|hwpx?|xlsx?|docx))["”]/gi)].map(m=>m[1]);
  return files.length?arg('attach',{...values,files}):arg('prepare-save',values);
 }
 if(last.args.operation==='attach')return arg('prepare-save',values);
 if(last.args.operation==='prepare-save')return arg('save',{...values,finalDigest:last.value.finalDigest});
 if(last.args.operation==='prepare-delete')return arg('delete',{...values,finalDigest:last.value.finalDigest});
 const currentDialog=last.value.nativeDialog||last.value.result?.dialog;
 if(currentDialog){const executed=records.findLast(r=>['save','delete'].includes(r.args.operation));if(!executed?.value?.receiptId||!currentDialog.id||typeof currentDialog.message!=='string')return {tools:[],receipt:'품의 최종 실행에 묶인 확인창을 확인하지 못했습니다.'};if(records.filter(r=>r.args.operation==='confirm').some(r=>r.args.dialogId===currentDialog.id))return {tools:[],receipt:'이미 처리한 품의 확인창입니다. 반복 수락하지 않았습니다.'};return arg('confirm',{...values,receiptId:executed.value.receiptId,dialogId:currentDialog.id,message:currentDialog.message});}
 if(last.value.validationRejected)return {tools:[],receipt:'시스템이 저장 전 입력 검사를 거절했습니다: '+(last.args.message||'안내 확인')+'\n저장 완료로 보고하지 않았습니다. 입력값을 검토해야 합니다.'};
 if(['save','delete','confirm'].includes(last.args.operation))return arg('dialog',values);
 if(last.args.operation==='dialog'){const executed=records.findLast(r=>['save','delete'].includes(r.args.operation));return arg(executed.args.operation==='save'?'verify-save':'verify-delete',values);}
 if(last.args.operation==='verify-save'){
  if(!last.value.saved||!last.value.serverReadbackVerified)return {tools:[],receipt:'품의 저장의 서버 재조회가 미확인입니다. 재저장하지 않았습니다.'};
  if(records.some(r=>r.args.operation==='attach'))return arg('verify-attachments',values);
  return task.cleanup?arg('prepare-delete',values):{tools:[],receipt:'품의 저장과 서버 재조회를 확인했습니다.\n품의번호: '+last.value.shortNumber+'\n제목: '+last.value.title+'\n결재요청·상신은 하지 않았습니다.'};
 }
 if(last.args.operation==='verify-attachments')return last.value.attachmentBytesVerified?(task.cleanup?arg('prepare-delete',values):{tools:[],receipt:'품의 저장·서버 재조회·첨부 원본 해시 대조를 확인했습니다. 결재요청·상신은 하지 않았습니다.'}):{tools:[],receipt:'서버 첨부의 원본 해시 일치가 미확인입니다.'};
 if(last.args.operation==='verify-delete')return {tools:[],receipt:last.value.deleted?'시험 품의의 저장·재조회와 삭제 후 서버 조회 결과 없음까지 확인했습니다.\n품의번호: '+last.value.number+'\n제목: '+last.value.title+'\n결재요청·상신·실제 집행은 하지 않았습니다.':'삭제 후 서버 목록에서 부재를 확인하지 못했습니다. 삭제를 반복하지 않았습니다.'};
 return {tools:[],receipt:'품의 처리의 다음 단계를 확인하지 못했습니다. 저장·삭제를 반복하지 않았습니다.'};
}
module.exports={registrationStep};
