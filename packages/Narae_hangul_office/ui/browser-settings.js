(()=>{
 const $=id=>document.getElementById(id),call=(name,args)=>window.narae.call(name,args);let busy=false,connected=false;
 const controls=()=>{for(const id of ['browserMode','browserConnect'])$(id).disabled=busy;$('browserDisconnect').disabled=busy||!connected;};
 async function refresh(){const view=await call('browserState');connected=view.connected;$('browserConnectionStatus').textContent=view.connected?'연결됨 · '+(view.mode==='extension'?'기존 Chrome':'전용 업무 창')+' · '+(view.tabs?.find(t=>t.active)?.title||'탭 선택 완료'):'아직 연결하지 않았습니다.';controls();}
 async function run(fn){if(busy)return;busy=true;controls();try{await fn();}catch(error){$('browserConnectionStatus').textContent=error.message;}finally{busy=false;controls();}}
 window.naraeBrowser={onState:()=>{},loadSettings:async state=>{$('browserMode').value=state.settings.browserMode||'isolated';await refresh();}};
 $('browserExtensionInstall').onclick=()=>run(()=>call('browserExtensionInstall'));
 $('browserConnect').onclick=()=>run(async()=>{$('browserConnectionStatus').textContent=$('browserMode').value==='extension'?'Chrome 연결 화면에서 사용할 기존 탭을 선택하세요…':'업무 창을 열고 있습니다…';const state=await call('browserConnect',{mode:$('browserMode').value});window.naraeBrowser.onState(state);await refresh();});
 $('browserDisconnect').onclick=()=>run(async()=>{await call('browserDisconnect');await refresh();});
})();
