(()=>{
 const $=id=>document.getElementById(id),call=(name,args)=>window.narae.call(name,args);let busy=false,connected=false;
 const controls=()=>{for(const id of ['browserMode','browserConnect','browserEnvironmentSave','browserEnvironmentClear','browserExtensionToken','browserEnvironmentBrowser','browserEnvironmentProfile'])$(id).disabled=busy;$('browserDisconnect').disabled=busy||!connected;};
 async function refresh(){const view=await call('browserState');connected=view.connected;$('browserConnectionStatus').textContent=view.connected?'연결됨 · '+(view.mode==='extension'?'기존 Chrome':'전용 업무 창')+' · '+(view.tabs?.find(t=>t.active)?.title||'다음 웹 요청을 기다립니다'):'아직 연결하지 않았습니다.';controls();}
 async function run(fn){if(busy)return;busy=true;controls();try{await fn();}catch(error){$('browserConnectionStatus').textContent=error.message;}finally{busy=false;controls();}}
 async function loadEnvironment(view){view||=await call('browserEnvironmentState');$('browserExtensionToken').value='';$('browserExtensionToken').placeholder=view.hasToken?'토큰 설정됨 · 비워 두면 유지':'확장 토큰 값 또는 변수=값 붙여넣기';$('browserEnvironmentBrowser').value=view.browser;$('browserEnvironmentProfile').value=view.profile;$('browserEnvironmentStatus').textContent=view.tokenSource==='office'?'오피스에 암호화해 저장한 토큰을 사용합니다.':view.tokenSource==='environment'?'현재 환경변수에 설정된 토큰을 사용합니다.':'토큰을 저장하면 연결 승인을 반복하지 않고 자동 연결합니다.';}
 async function saveEnvironment(){const patch={browser:$('browserEnvironmentBrowser').value,profile:$('browserEnvironmentProfile').value};if($('browserExtensionToken').value.trim())patch.token=$('browserExtensionToken').value;await loadEnvironment(await call('browserEnvironmentSave',patch));await refresh();}
 window.naraeBrowser={onState:()=>{},saveEnvironment,loadSettings:async state=>{$('browserMode').value=state.settings.browserMode||'isolated';await loadEnvironment();await refresh();}};
 $('browserEnvironmentSave').onclick=()=>run(async()=>{await saveEnvironment();$('browserEnvironmentStatus').textContent+=' 다음 연결부터 적용합니다.';});
 $('browserEnvironmentClear').onclick=()=>run(async()=>{await loadEnvironment(await call('browserEnvironmentSave',{clearToken:true}));await refresh();});
 $('browserExtensionInstall').onclick=()=>run(()=>call('browserExtensionInstall'));
 $('browserConnect').onclick=()=>run(async()=>{await saveEnvironment();$('browserConnectionStatus').textContent=$('browserMode').value==='extension'?'기존 Chrome에 연결하고 있습니다…':'업무 창을 열고 있습니다…';const state=await call('browserConnect',{mode:$('browserMode').value});window.naraeBrowser.onState(state);await refresh();});
 $('browserDisconnect').onclick=()=>run(async()=>{await call('browserDisconnect');await refresh();});
})();
