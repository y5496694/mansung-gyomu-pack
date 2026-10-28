(()=>{
 'use strict';
 const el=id=>document.getElementById(id),call=(name,args)=>window.narae.call(name,args);let remote={state:'disconnected'};
 const labels={disconnected:'연결 안 됨',pending:'카톡에서 확인 코드 입력 대기',confirmed:'카톡 확인 완료 · 이 PC의 최종 승인 대기',approved:'이 PC 원격 연결 승인됨',revoked:'연결 해제됨',expired:'연결 코드 만료됨'};
 const errors={PAIRING_INPUT:'UID와 PC 이름을 확인해 주세요.',PAIRING_LIMIT:'연결 요청이 많습니다. 기존 요청을 해제하거나 잠시 뒤 다시 시도하세요.',EXISTING_PC_REQUIRES_UNLINK:'다른 PC가 연결돼 있습니다. 카톡에서 연결 해제를 보낸 뒤 다시 승인하세요.',CHAT_CONFIRMATION_REQUIRED:'먼저 카톡에 연결 코드를 보내 주세요.',DEVICE_AUTH:'연결이 만료되거나 해제됐습니다. 다시 연결하세요.'};
 const action=fn=>async event=>{try{el('remoteNotice').textContent='';await fn(event);}catch(error){el('remoteNotice').textContent=errors[error.message]||error.message||'연결을 확인해 주세요.';}};
 function show(value){remote=value;el('remoteStatus').textContent=(labels[value.state]||value.state)+(value.name?' · '+value.name:'')+(value.uid?' · '+value.uid:'')+(value.busy?' · '+(value.progress||'PC에서 처리 중'):'');
  el('remoteNotice').textContent=value.error||'';el('remotePairForm').hidden=!['disconnected','revoked'].includes(value.state);el('remoteApprove').hidden=value.state!=='confirmed';el('remoteUnlink').hidden=value.state==='disconnected';el('remoteCancel').hidden=!value.busy;
  el('remoteCode').hidden=!value.code;el('remoteCode').textContent=value.code?'카톡에 다음 문장을 보내 주세요: 연결 '+value.code+' (5분 이내)':'';
  if(!el('remoteRelay').value&&value.relay)el('remoteRelay').value=value.relay;
  const a=value.approval;el('remoteApproval').hidden=!a;el('remoteApprovalDetails').textContent=a?JSON.stringify({작업:a.name,내용:a.args},null,2):'';
  el('remoteButton').textContent=a?'에이전트 변경 승인 대기':value.busy?'카톡 작업 중':'카카오톡 연동';
  if(a&&!document.querySelector('dialog[open]'))el('remoteDialog').showModal();
 }
 el('remoteButton').onclick=action(async()=>{show(await call('remoteState'));if(!el('remoteDialog').open)el('remoteDialog').showModal();});el('remoteClose').onclick=()=>el('remoteDialog').close();
 el('remotePairForm').onsubmit=action(async event=>{event.preventDefault();if(!el('remoteConsent').checked)return;show(await call('remotePair',{uid:el('remoteUid').value,name:el('remoteName').value,relay:el('remoteRelay').value}));});
 el('remoteRefresh').onclick=action(async()=>show(await call('remoteRefresh')));el('remoteApprove').onclick=action(async()=>show(await call('remoteApprove')));el('remoteUnlink').onclick=action(async()=>show(await call('remoteUnlink')));el('remoteCancel').onclick=action(async()=>show(await call('remoteCancel')));
 async function decide(allow){const a=remote.approval;if(!a)return;await call('remoteDecide',{id:a.id,digest:a.digest,allow});show(await call('remoteState'));}
 el('remoteAllow').onclick=action(()=>decide(true));el('remoteDeny').onclick=action(()=>decide(false));
 window.narae.onEvent(event=>{if(event.type==='remote')show(event.remote);});call('remoteState').then(show).catch(error=>{el('remoteNotice').textContent=error.message;});
})();
