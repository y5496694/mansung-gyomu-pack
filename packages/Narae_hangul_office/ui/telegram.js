(()=>{
 const el=id=>document.getElementById(id),call=(name,args)=>window.narae.call(name,args);let approval;
 function show(value){el('telegramStatus').textContent=value.error||(!value.hasToken?'연결 안 됨':value.linked?'@'+value.username+' · 내 계정 연결됨'+(value.running?' · 처리 중':''):'@'+value.username+' · 내 계정 연결 링크를 텔레그램에서 여세요.');el('telegramOpenPair').disabled=!value.pairURL;el('telegramPair').disabled=!value.hasToken;if('approval' in value)showApproval(value.approval);}
 function showApproval(value){approval=value;el('telegramApproval').hidden=!value;el('telegramApprovalDetails').textContent=value?value.name+'\n'+JSON.stringify(value.args,null,2):'';}
 async function action(fn){el('telegramError').textContent='';try{await fn();}catch(error){el('telegramError').textContent=error.message;}}
 el('telegramButton').onclick=()=>action(async()=>{show(await call('telegramState'));el('telegramDialog').showModal();});el('telegramClose').onclick=()=>el('telegramDialog').close();
 el('telegramBotFather').onclick=()=>action(()=>call('telegramBotFather'));
 el('telegramConnect').onclick=()=>action(async()=>{const token=el('telegramToken').value;el('telegramToken').value='';show(await call('telegramConnect',{token}));});
 el('telegramPair').onclick=()=>action(async()=>show(await call('telegramPair')));el('telegramOpenPair').onclick=()=>action(()=>call('telegramOpenPair'));el('telegramUnlink').onclick=()=>action(async()=>show(await call('telegramUnlink')));
 for(const [id,allow]of [['telegramAllow',true],['telegramDeny',false]])el(id).onclick=()=>action(async()=>{if(approval)await call('remoteDecide',{id:approval.id,digest:approval.digest,allow});});
 window.narae.onEvent(event=>{if(event.type==='telegram')show(event.telegram);if(event.type==='approval')showApproval(event.approval);});
})();
