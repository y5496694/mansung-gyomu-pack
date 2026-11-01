'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const operations=['route-preview','route-apply','resume-preview','resume-apply'];
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function execute(args,{instance,policy,state,signal}){
 const prior=instance.pending.get(args.receipt_id);if(prior?.kind!=='wxs-final'||prior.status!=='verification_required')throw Error('현재 상신의 검증 대기 receiptId가 필요합니다.');
 const receipt=JSON.parse(fs.readFileSync(prior.args.receipt,'utf8'));if(receipt.status!=='route_review_required'||receipt.route_review_resumed)throw Error('네이티브 결재경로 사전검사에서 중단된 동일 기록만 확인할 수 있습니다.');
 const entry=state.get(args.receipt_id)||{};state.set(args.receipt_id,entry);
 const read=async()=>{const listing=await instance.wxs(['windows'],signal),matches=listing.windows.filter(w=>w.pid===receipt.window.pid&&/^결재경로설정/.test(w.title));if(matches.length!==1)throw Error('동일 WXS 프로세스의 결재경로 설정창 한 개가 필요합니다.');const values=await instance.wxs(['draft-options','--hwnd',String(receipt.window.hwnd),'--expected-title',receipt.expected_title,'--section','approval','--dialog-hwnd',String(matches[0].hwnd)],signal);const people=values.options?.participants;if(!people?.length||people[0].role!=='기안'||people.slice(1).some(p=>!p.id||!p.name||!p.role))throw Error('현재 전체 결재선을 확인하지 못했습니다.');return {window:values.window,participants:people};};
 if(args.operation==='route-preview'){const preview=await read();entry.routePreview={...preview,fingerprint:digest(preview)};return {...entry.routePreview,readOnly:true};}
 if(args.operation==='resume-preview'){const preview=await instance.wxs(['final-resume','--receipt',prior.args.receipt],signal);entry.resumePreview=preview;return preview;}
 const preview=args.operation==='route-apply'?entry.routePreview:entry.resumePreview;
 if(!preview?.fingerprint||preview.fingerprint!==args.expected_fingerprint)throw Error('직전 실제 경로 또는 재개 미리보기 지문이 필요합니다.');
 if(entry[args.operation])throw Error('동일 상신 기록에서 이 확인을 이미 한 번 시도했습니다. 반복하지 마세요.');
 let argv;
 if(args.operation==='route-apply'){
  if(digest(await read())!==preview.fingerprint)throw Error('결재선이 미리보기 뒤 변경됐습니다.');
  const file=path.join(path.dirname(prior.args.receipt),'wxs-route-review-'+crypto.randomUUID()+'.json');
  fs.writeFileSync(file,JSON.stringify({expected_title:receipt.expected_title,title:receipt.expected_title,approval_route:preview.participants.slice(1).map(({id,name,role})=>({id,name,role}))}),{flag:'wx'});
  argv=['draft-options','--hwnd',String(receipt.window.hwnd),'--expected-title',receipt.expected_title,'--section','approval','--dialog-hwnd',String(preview.window.hwnd),'--confirm-route',file,'--apply'];
 }else argv=['final-resume','--receipt',prior.args.receipt,'--apply','--confirm-final-action','--expected-fingerprint',preview.fingerprint];
 await policy.approve('동일 공문 결재선 확인 · '+args.operation,{receiptId:args.receipt_id,preview},signal);if(signal?.aborted)throw Error('작업을 중단했습니다.');entry[args.operation]=true;
 return {kind:'wxs-route-continuation',receiptId:args.receipt_id,operation:args.operation,completed:false,result:await instance.wxs(argv,signal)};
}
module.exports={operations,execute};
