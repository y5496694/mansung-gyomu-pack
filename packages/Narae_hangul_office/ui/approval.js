(()=>{
 const el=id=>document.getElementById(id),dialog=el('approvalDialog');let pending=null,deciding=false;
 const names={create_document:'한글 문서 만들기',edit_document:'한글 문서 수정',edit_live_document:'열린 한글 문서 수정',export_pdf:'PDF 사본 저장'},keys={path:'문서',target:'저장 위치',text:'내용',blocks:'문서 구성',operations:'수정 내용',url:'주소',ref:'화면 항목',action:'작업',value:'선택값',key:'입력 키'};
 function details(value){return (names[value.name]||value.name)+'\n\n'+Object.entries(value.args).filter(([key])=>!['expectedHash','liveRevision'].includes(key)).map(([key,item])=>(keys[key]||key)+'\n'+(typeof item==='string'?item:JSON.stringify(item,null,2))).join('\n\n');}
 function show(value){pending=value;el('approvalError').textContent='';const telegram=value?.channel==='telegram';for(const [id,current] of [['remote',!telegram],['telegram',telegram]]){el(id+'Approval').hidden=!value||!current;el(id+'ApprovalDetails').textContent=value&&current?details(value):'';}if(value&&!dialog.open){dialog.showModal();el(telegram?'telegramDeny':'remoteDeny').focus();}else if(!value&&dialog.open)dialog.close();}
 async function decide(allow){if(!pending||deciding)return;deciding=true;const {id,digest}=pending;try{await window.narae.call('remoteDecide',{id,digest,allow});}catch(error){el('approvalError').textContent=error.message;}finally{deciding=false;}}
 for(const [id,allow]of [['remoteAllow',true],['remoteDeny',false],['telegramAllow',true],['telegramDeny',false],['approvalClose',false]])el(id).onclick=()=>void decide(allow);
 dialog.addEventListener('cancel',event=>{event.preventDefault();void decide(false);});
 window.narae.onEvent(event=>{if(event.type==='approval')show(event.approval);});
 window.narae.call('approvalState').then(show).catch(()=>{});
 el('toolAutoAllow').onchange=async()=>{const enabled=el('toolAutoAllow').checked;try{await window.narae.call('configure',{toolAutoAllow:enabled});el('generalSettingsStatus').textContent=enabled?'자동 허용을 켰습니다. 승인창 없이 실행합니다.':'실행할 때 승인창을 표시합니다.';}catch(error){el('toolAutoAllow').checked=!enabled;el('generalSettingsStatus').textContent=error.message;}};
})();
