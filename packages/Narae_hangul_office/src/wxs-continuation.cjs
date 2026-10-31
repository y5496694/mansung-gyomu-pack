'use strict';
const tool={type:'function',name:'gyomu_wxs_final_continue',description:'동일 상신 receiptId의 내부결재 본문 미리보기 확인과 문서처리 단계를 원본 WXS CLI로 이어간다. 새 상신·재시도를 만들지 않는다. 완료는 문서진행 목록에서 별도로 검증한다.',parameters:{type:'object',properties:{operation:{enum:['process-preview','process-apply','confirm-previewed','ack']},receipt_id:{type:'string'},expected_fingerprint:{type:'string'},expected_message:{type:'string'}},required:['operation','receipt_id'],additionalProperties:false}};
async function execute(args,{instance,policy,state,signal}){
 const prior=instance.pending.get(args.receipt_id);if(prior?.kind!=='wxs-final'||prior.status!=='verification_required')throw new Error('현재 실행이 생성한 검증 대기 receiptId만 이어 처리할 수 있습니다.');
 const key=args.receipt_id,entry=state.get(key)||{};state.set(key,entry);
 if(args.operation==='process-preview'){const preview=await instance.wxs(['final-process','--receipt',prior.args.receipt],signal);entry.processing=preview;return preview;}
 let argv,preview;
 if(args.operation==='process-apply'){
  preview=entry.processing;if(!preview?.fingerprint||preview.fingerprint!==args.expected_fingerprint)throw new Error('실제로 조회한 같은 문서처리 미리보기 지문이 필요합니다.');
  argv=['final-process','--receipt',prior.args.receipt,'--apply','--confirm-final-action','--expected-fingerprint',preview.fingerprint];
 }else if(args.operation==='confirm-previewed'){
  preview=entry.dialog;if(!preview?.document_preview?.fingerprint||preview.document_preview.fingerprint!==args.expected_fingerprint||preview.message!==args.expected_message)throw new Error('원본 final-dialog에서 읽은 정확한 문구와 문서 미리보기 지문이 필요합니다.');
  argv=['final-confirm','--receipt',prior.args.receipt,'--expected-message',args.expected_message,'--expected-fingerprint',args.expected_fingerprint,'--confirm-final-action'];
 }else{
  preview=entry.dialog;if(!preview?.message||preview.message!==args.expected_message)throw new Error('실제 조회한 완료 안내 문구가 필요합니다.');
  argv=['final-ack','--receipt',prior.args.receipt,'--expected-message',args.expected_message];
 }
 const attempt=args.operation;if(entry[attempt])throw new Error('동일 기록의 이 단계는 이미 한 번 시도했습니다. 결과를 조회하고 자동 반복하지 마세요.');
 await policy.approve('동일 공문 상신 이어 처리 · '+attempt,{receiptId:key,preview},signal);if(signal?.aborted)throw new Error('중단했습니다.');entry[attempt]=true;
 return {kind:'wxs-final-continuation',receiptId:key,operation:attempt,completed:false,result:await instance.wxs(argv,signal)};
}
module.exports={tool,execute};
