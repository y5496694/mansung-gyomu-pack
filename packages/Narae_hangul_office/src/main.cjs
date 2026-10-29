const {app,BrowserWindow,ipcMain,dialog,shell}=require('electron');
require('./network-trust.cjs').useSystemTrust();
const fs=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const connections=require('./connection-settings.cjs'),provider=require('./provider.cjs'),{KeyStore}=require('./key-store.cjs'),{OAuth}=require('./oauth.cjs'),{NativeDocuments}=require('./native-documents.cjs'),{runPython}=require('./python.cjs'),{runAgent,inside}=require('./agent.cjs');
const root=path.resolve(__dirname,'..'),home=process.env.NARAE_OFFICE_HOME||path.join(process.env.LOCALAPPDATA||app.getPath('appData'),'NaraeHangulOffice');
for(const folder of ['data','cache','logs','Documents'])fs.mkdirSync(path.join(home,folder),{recursive:true});
app.setName('나래 한글 오피스');app.setPath('userData',path.join(home,'data/profile'));app.setPath('sessionData',path.join(home,'cache/session'));app.setPath('logs',path.join(home,'logs'));app.setPath('crashDumps',path.join(home,'logs/crashes'));
const python=require('./runtime-python.cjs').resolvePython(root);
const load=(file,fallback)=>{try{return JSON.parse(fs.readFileSync(path.join(home,'data',file),'utf8'));}catch{return fallback;}};
const save=(file,value)=>{const target=path.join(home,'data',file),temp=target+'.'+randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2));fs.renameSync(temp,target);};
let settings=connections.normalize(load('settings.json',{}),{workspace:path.join(home,'Documents')}),recent=load('recent.json',[]),history=load('conversation.json',[]),window,controller;
fs.mkdirSync(settings.workspace,{recursive:true});
const grants=new Set(),keys={openai:new KeyStore(home,python,'gpt-key'),anthropic:new KeyStore(home,python,'claude-key')},oauth=new OAuth({home,python,openBrowser:url=>shell.openExternal(url)}),native=new NativeDocuments(home,python);
const authorise=file=>{if(typeof file!=='string'||!path.isAbsolute(file))throw new Error('절대 파일 경로가 필요합니다.');file=path.resolve(file);const allowed=target=>inside(settings.workspace,target)||grants.has(target.toLowerCase());if(!allowed(file))throw new Error('먼저 앱에서 문서를 선택하세요.');if(fs.existsSync(file)&&!allowed(fs.realpathSync(file)))throw new Error('연결된 경로가 작업 범위 밖입니다.');return file;};
const document=file=>{file=authorise(file);require('./format-policy.cjs').assertDocument(file);return file;};
function output(file){file=path.isAbsolute(file)?path.resolve(file):path.resolve(settings.workspace,file);if(!inside(settings.workspace,file))throw new Error('새 파일은 작업 폴더 안에 저장하세요.');let parent=path.dirname(file);while(!fs.existsSync(parent))parent=path.dirname(parent);if(!inside(fs.realpathSync(settings.workspace),fs.realpathSync(parent)))throw new Error('출력 폴더의 연결 경로가 작업 범위 밖입니다.');if(fs.existsSync(file)&&!inside(fs.realpathSync(settings.workspace),fs.realpathSync(file)))throw new Error('출력 파일의 연결 경로가 작업 범위 밖입니다.');return file;}
function metadata(){let auth,error;try{auth=oauth.state();}catch{auth={profiles:[],selected:{}};error='계정 저장소를 읽을 수 없습니다. 현재 Windows 사용자로 다시 연결하세요.';}return {version:require('../package.json').version,settings,auth,authError:error,hasKey:Object.fromEntries(Object.entries(keys).map(([name,key])=>{try{return[name,Boolean(key.get())];}catch{return[name,false];}})),recent,history,home,pythonAvailable:fs.existsSync(python),hancom:require('./hancom.cjs').discoverHancom(),running:Boolean(controller)};}
function idle(){if(controller)throw new Error('AI 작업을 마치거나 중지한 뒤 연결 설정을 바꾸세요.');}
async function credential(config){return config.connectionMode==='oauth'?oauth.credential(config.provider):undefined;}
async function models(){const config=structuredClone(settings);if(config.provider==='local')return localAI.listModels(config);return provider.listModels({settings:config,credential:await credential(config),apiKey:config.connectionMode==='api'?keys[config.provider].get():undefined});}
function persist(next){settings=next;save('settings.json',settings);}
async function configure(args={}){idle();if(oauth.pending)throw new Error('진행 중인 로그인을 마치거나 취소하세요.');const next=connections.update(settings,args);if(typeof args.hwpAutoSave==='boolean')next.hwpAutoSave=args.hwpAutoSave;if(args.apiKey?.trim()&&keys[next.provider])keys[next.provider].set(args.apiKey.trim());persist(next);return metadata();}
async function selected(file){file=document(file);recent=[file,...recent.filter(item=>item!==file)].slice(0,30);save('recent.json',recent);return {path:file,name:path.basename(file),hash:createHash('sha256').update(fs.readFileSync(file)).digest('hex')};}
const execute=async(name,args,signal)=>{
 if(signal?.aborted)throw new Error('작업을 중지했습니다.');
 if(name==='list_files')return fs.readdirSync(settings.workspace).filter(file=>/\.hwpx?$/i.test(file)).map(file=>path.join(settings.workspace,file));
 const file=['create_document'].includes(name)?output(args.path):document(args.path);
 if(name==='read_document')return native.savedFileOperation(file,{},()=>runPython(python,home,'documents.py',{action:'inspect',path:file},signal));
 if(name==='read_live_document'||name==='edit_live_document'){
  await native.openFile(file);
  return native.withFileLock(file,()=>runPython(python,home,'live_hangul.py',{...args,path:file,action:name==='read_live_document'?'read':'edit',backupDir:path.join(home,'backups'),save:settings.hwpAutoSave!==false},signal));
 }
 if(name==='edit_document')return native.savedFileOperation(file,{editing:true,signal},()=>runPython(python,home,'documents.py',{...args,path:file,action:'save'},signal));
 if(name==='create_document'){
  require('./format-policy.cjs').assertDocument(file);
  const blocks=args.blocks;
  const checkImages=items=>{for(const item of items||[]){if(item.type==='image'){item.path=authorise(item.path);if(!fs.existsSync(item.path))throw new Error('그림 파일을 찾을 수 없습니다.');}for(const row of item.rows||[])for(const cell of row)checkImages(cell.blocks);}};checkImages(blocks);
  const result=await runPython(python,home,'documents.py',{action:'create',path:file,content:args.text||'',...(blocks?{blocks}:{})},signal);await selected(file);return result;
 }
 if(name==='export_pdf')return native.savedFileOperation(file,{},()=>runPython(python,home,'documents.py',{action:'export',path:file,target:output(args.target)},signal));
 throw new Error('지원하지 않는 문서 작업입니다.');
};
function emit(event){if(window&&!window.isDestroyed())window.webContents.send('narae:event',event);}
const {KakaoConnector}=require('./kakao-connector.cjs'),{RemotePolicy}=require('./remote-policy.cjs');
let remote,telegram,remoteSetupError='',activeAgentChannel='kakao',approvalChannel='kakao';
const {LocalAI}=require('./local-ai.cjs');
const localAI=new LocalAI({root,home,notify:emit});
const requestAI=(config,body,signal)=>config.provider==='local'?localAI.request({settings:config,body,signal}):cloudRequest(config,body,signal);
async function cloudRequest(config,body,signal){return provider.requestResponse({settings:config,credential:await credential(config),apiKey:config.connectionMode==='api'?keys[config.provider].get():undefined,signal,body});}
const approvalView=approval=>approval?{...approval,channel:approvalChannel}:null;
const remotePolicy=new RemotePolicy({workspace:()=>settings.workspace,notify:approval=>{const view=approvalView(approval);emit({type:'approval',approval:view});if(remote){remote.approval=view;remote.changed();}}});
const {AgentConversations}=require('./agent-conversations.cjs'),{OfficeIntegrations}=require('./office-integrations.cjs');
const conversations=new AgentConversations(home);
const integrations=new OfficeIntegrations({home,root,python,workspace:()=>settings.workspace,settings:()=>settings,policy:remotePolicy});
let integrationSession='local',resetting=Promise.resolve();
const agentSession=()=>activeAgentChannel==='telegram'&&telegram?.session()?telegram.session():remote?.state==='approved'&&remote.credentials?remote.credentials.id:'local';
function agentState(){return {...conversations.read(agentSession()),session:agentSession(),running:Boolean(controller),model:settings.model,linked:agentSession()!=='local',viewChannel:activeAgentChannel,telegramLinked:Boolean(telegram?.session()),channel:{name:'나래',searchId:'narae_bot',url:'https://pf.kakao.com/_xjgxfWX',chatUrl:'https://pf.kakao.com/_xjgxfWX/chat'}};}
function agentChanged(){emit({type:'agentConversation',agent:agentState()});}
async function agentChat(prompt,{signal,sessionId=agentSession(),origin='pc',progress=()=>{}}={}){
 idle();if(typeof prompt!=='string'||!prompt.trim()||prompt.length>4000)throw new Error('요청을 1~4000자로 입력하세요.');
 const config=structuredClone(settings);if(!config.model)throw new Error('AI 설정에서 모델을 선택하세요.');
 approvalChannel=origin==='telegram'||origin==='pc'&&activeAgentChannel==='telegram'?'telegram':'kakao';const localController=new AbortController();controller=localController;const relayAbort=()=>localController.abort();signal?.addEventListener('abort',relayAbort,{once:true});if(signal?.aborted)relayAbort();const localSignal=localController.signal;
 let denied;const files=[];if(integrationSession!==sessionId){resetting=resetting.then(()=>integrations.reset());integrationSession=sessionId;}const previous=conversations.history(sessionId);conversations.append(sessionId,'user',prompt,origin);agentChanged();
 try{
  await resetting;if(localSignal.aborted)throw new Error('REMOTE_CANCELLED');
  const request=body=>requestAI(config,body,localSignal);
  const executeShared=async(name,args,toolSignal)=>{if(denied)throw denied;try{const value=name.startsWith('gyomu_')?await integrations.execute(name,args,toolSignal):await remotePolicy.run(name,args,toolSignal,execute);if(origin==='telegram'&&['create_document','edit_document','edit_live_document','export_pdf'].includes(name))files.push(value.path||args.target||args.path);return value;}catch(error){if(error.code==='LOCAL_APPROVAL_DENIED')denied=error;throw error;}};
  const text=await runAgent({prompt,settings:config,request,execute:executeShared,signal:localSignal,history:previous,additionalTools:await integrations.tools(),agentInstructions:'이 대화는 에이전트(실험) 탭과 연결한 사용자의 원격 채널에서 이어집니다. 문서·CBE_CLI·나래 브라우저·나래교무포탈·나래교무 도구로 PC 업무를 처리합니다. 업무 전 gyomu_skill_read로 절차를 확인하세요. 로그인·인증정보는 요청하지 말고 PC에서 사용자가 직접 입력하게 하세요. 문서 변경·브라우저 조작·메시지 발송은 구체적인 PC 승인 후에만 수행됩니다. 미리보기와 실제 완료를 구분하세요. 원격 문서는 작업 폴더 안에서만 사용하세요.',send:event=>{emit({...event,scope:'agent'});if(event.type==='tool'||event.type==='status'){progress(remotePolicy.status()?'PC에서 변경 승인을 기다리고 있어.':'나래 오피스 에이전트가 요청을 처리하고 있어.');}}});
  if(denied)throw denied;if(localSignal.aborted)throw new Error('REMOTE_CANCELLED');conversations.append(sessionId,'assistant',text,origin);return origin==='telegram'?{text,files}:text;
 }catch(error){conversations.append(sessionId,'error',error.code==='LOCAL_APPROVAL_DENIED'?'PC에서 작업을 거절했습니다.':localSignal.aborted?'작업을 중단했습니다. 이미 수행한 변경은 유지됩니다.':'AI 생성에 실패했습니다. 오류 코드: NARAE_AGENT',origin);throw error;
 }finally{signal?.removeEventListener('abort',relayAbort);controller=null;remotePolicy.close();agentChanged();}
}
async function remoteChat(prompt,options){if(!/^[a-f0-9]{32}$/.test(options.sessionId))throw new Error('REMOTE_SESSION');return agentChat(prompt,{...options,origin:'kakao'});}
try{remote=new KakaoConnector({store:new KeyStore(home,python,'kakao-device'),ledgerFile:path.join(home,'data/kakao-jobs.json'),execute:remoteChat,notify:event=>{const session=agentSession();if(integrationSession!==session){if(integrationSession!=='local'){controller?.abort();resetting=resetting.then(()=>integrations.reset());}integrationSession=session;}emit(event);agentChanged();},canRun:()=>!controller,conversation:session=>conversations.read(session),allowLoopback:process.env.NARAE_KAKAO_ALLOW_LOOPBACK==='1'});integrationSession=agentSession();}catch{remoteSetupError='카카오 기기 저장소를 읽지 못했습니다. 연결 해제 후 다시 연결하세요.';}
try{const {TelegramBot}=require('./telegram-bot.cjs');telegram=new TelegramBot({home,store:new KeyStore(home,python,'telegram-bot'),workspace:()=>settings.workspace,execute:agentChat,canRun:()=>!controller,notify:event=>{if(event.telegram.linked)activeAgentChannel='telegram';emit(event);agentChanged();}});}catch{emit({type:'error',text:'텔레그램 저장소를 읽을 수 없습니다. 현재 Windows 사용자로 다시 연결하세요.'});}
function remoteState(){return remote?remote.status():{state:'disconnected',error:remoteSetupError};}
function requireRemote(){if(!remote)throw new Error(remoteSetupError||'카카오 연결기를 초기화하지 못했습니다.');return remote;}
async function preview(args){const file=document(args.path),hash=createHash('sha256').update(fs.readFileSync(file)).digest('hex'),pdf=path.join(home,'cache',hash+'.pdf');return native.savedFileOperation(file,{},async()=>{if(!fs.existsSync(pdf))await runPython(python,home,'documents.py',{action:'previewNativeHangul',path:file,target:pdf});return runPython(python,home,'documents.py',{action:'inspect',path:pdf,page:args.page||0});});}
const methods={
 state:()=>metadata(),configure,
 localAIState:()=>localAI.status(),
 localAIDirectory:async()=>{idle();if(localAI.busy||localAI.child)throw new Error('실행 중인 AI를 먼저 중지하세요.');const picked=await dialog.showOpenDialog(window,{properties:['openDirectory','createDirectory'],title:'AI 모델 저장 폴더 선택',defaultPath:localAI.dir});return picked.canceled?localAI.status():localAI.configure({directory:picked.filePaths[0]});},
 localAIAutoStart:({enabled})=>localAI.setAutoStart(enabled===true),
 localAILicense:({id})=>{localAI.model(id);const names={narae1:'Qwen3-0.6B-LICENSE.txt',narae2:'EXAONE-3.5-LICENSE.txt',narae3:'Qwen3-4B-LICENSE.txt'};return fs.readFileSync(path.join(root,'resources/model-licenses',names[id]),'utf8');},
 localAIExternal:async({endpoint,model})=>{idle();let next=connections.update(settings,{provider:'local',endpoint,model,localSource:'external'});const items=await localAI.listModels(next);if(!model&&items[0])next=connections.update(next,{model:items[0].id});if(!items.some(m=>m.id===next.model))throw new Error('서버에 설치된 모델 ID를 입력하세요: '+items.map(m=>m.id).join(', '));await localAI.stop();persist(next);agentChanged();return metadata();},
 localAIInstall:args=>{idle();return localAI.install(args.id,args);},
 localAIImport:async args=>{idle();const picked=await dialog.showOpenDialog(window,{properties:['openDirectory'],title:'base.gguf와 adapter.gguf가 있는 모델 폴더 선택'});if(picked.canceled)return localAI.status();return localAI.install(args.id,{...args,source:fs.realpathSync(picked.filePaths[0])});},
 localAIUse:async({id})=>{idle();await localAI.activate(id);localAI.setAutoStart(true);persist(connections.update(settings,{provider:'local',model:id,localSource:'managed'}));agentChanged();return metadata();},
 localAIStop:async()=>{idle();if(localAI.busy)throw new Error('AI 준비가 끝난 뒤 중지하세요.');localAI.setAutoStart(false);await localAI.stop();return localAI.status();},
 localAICancel:()=>localAI.cancelInstall(),
 telegramState:()=>({...telegram?.status(),approval:approvalView(remotePolicy.status())}),
 telegramBotFather:()=>shell.openExternal('https://t.me/BotFather'),
 telegramConnect:async({token})=>{idle();if(!telegram)throw new Error('텔레그램 저장소를 초기화하지 못했습니다.');return telegram.connect(token);},
 telegramPair:()=>telegram.pair(),
 telegramUnlink:async()=>{const result=await telegram.unlink();if(activeAgentChannel==='telegram'){activeAgentChannel='kakao';agentChanged();}return result;},
 telegramOpenPair:()=>{const url=telegram.status().pairURL;if(!url)throw new Error('내 계정 연결 링크를 먼저 만드세요.');return shell.openExternal(url);},
 agentView:({channel})=>{if(!['kakao','telegram'].includes(channel))throw new Error('대화 채널을 확인하세요.');activeAgentChannel=channel;agentChanged();return agentState();},
 agentState,
 agentSend:async({prompt})=>{try{return await agentChat(prompt);}finally{await remote?.syncConversation().catch(()=>{});}},
 agentTools:()=>integrations.tools(),
 openNaraeChannel:()=>shell.openExternal('https://pf.kakao.com/_xjgxfWX/chat'),
 remoteState,
 remotePair:args=>{idle();return requireRemote().pair(args);},
 remoteApprove:()=>{idle();return requireRemote().approve();},
 remoteUnlink:async()=>{controller?.abort();await integrations.reset();if(remote)return remote.unlink();new KeyStore(home,python,'kakao-device').remove();remoteSetupError='저장소를 초기화했습니다. 앱을 다시 실행한 뒤 연결하세요.';return remoteState();},
 remoteRefresh:()=>requireRemote().refresh(),
 remoteDecide:args=>remotePolicy.decide(args),
 remoteCancel:()=>{requireRemote().controller?.abort();return remoteState();},
 chooseFolder:async()=>{idle();const result=await dialog.showOpenDialog(window,{properties:['openDirectory','createDirectory'],defaultPath:settings.workspace});if(!result.canceled)persist({...settings,workspace:fs.realpathSync(result.filePaths[0])});return metadata();},
 chooseFile:async()=>{const result=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'한글 문서',extensions:['hwp','hwpx']}]});if(result.canceled)return null;const file=fs.realpathSync(result.filePaths[0]);grants.add(file.toLowerCase());return selected(file);},
 openRecent:async({path:file})=>{if(!recent.includes(file))throw new Error('최근 문서 목록에 없습니다.');grants.add(fs.realpathSync(file).toLowerCase());return selected(file);},
 openNative:async({path:file})=>native.openFile(document(file)),preview,
 exportPDF:async({path:file})=>execute('export_pdf',{path:file,target:path.join(settings.workspace,path.basename(file,path.extname(file))+'-'+Date.now()+'.pdf')}),
 read:async args=>execute('read_live_document',args),
 create:async args=>{idle();return execute('create_document',args);},
 models,
 login:async({add=false}={})=>{idle();const profileId=add?undefined:oauth.state().selected[settings.provider];await oauth.login({provider:settings.provider,profileId});try{const catalog=await models();if(catalog.length&&!catalog.some(item=>item.id===settings.model))persist(connections.update(settings,{model:catalog[0].id}));}catch(error){emit({type:'error',text:'계정은 연결되었습니다. 모델 목록 확인: '+error.message});}return metadata();},
 cancelLogin:()=>oauth.cancel(),
 selectAccount:async({id})=>{idle();await oauth.select(settings.provider,id);return metadata();},
 logout:async()=>{idle();const result=await oauth.logout(settings.provider);emit({type:'status',text:result.message});return metadata();},
 usage:()=>shell.openExternal(settings.provider==='openai'?'https://chatgpt.com/settings/usage':'https://platform.claude.com/settings/usage'),
 revealData:()=>shell.openPath(home),
 cancel:()=>{controller?.abort();return true;},
 clearHistory:()=>{idle();history=[];save('conversation.json',history);return metadata();},
 send:async({prompt,path:file})=>{
  idle();if(typeof prompt!=='string'||!prompt.trim()||prompt.length>50000)throw new Error('요청을 1~50000자로 입력하세요.');if(file)document(file);
  const config=structuredClone(settings);if(!config.model)throw new Error('AI 설정에서 모델을 선택하세요.');
  controller=new AbortController();const signal=controller.signal;
  try{const request=body=>requestAI(config,body,signal);const text=await runAgent({prompt,context:file,settings:config,request,execute,send:emit,signal,history});history.push({role:'user',content:prompt},{role:'assistant',content:text});history=history.slice(-100);save('conversation.json',history);return text;}finally{controller=null;emit({type:'done'});}
 }
};
ipcMain.handle('narae:call',async(event,name,args)=>{if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||!Object.hasOwn(methods,name))throw new Error('허용되지 않은 요청');return methods[name](args||{});});
app.whenReady().then(async()=>{app.setAppUserModelId('Inhow.NaraeHangulOffice');window=new BrowserWindow({width:1420,height:940,minWidth:1000,minHeight:680,title:'나래 한글 오피스',icon:path.join(root,'ui/assets/narae-office.ico'),backgroundColor:'#f4f7fb',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});window.setMenuBarVisibility(false);window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());await window.loadFile(path.join(root,'ui/index.html'));remote?.start();telegram?.start();if(localAI.autoStart&&settings.provider==='local'&&settings.localSource==='managed'&&localAI.catalog.models.some(m=>m.id===settings.model&&localAI.installed(m)))void localAI.activate(settings.model).catch(()=>{});});
app.on('window-all-closed',()=>app.quit());app.on('before-quit',()=>{remote?.close();telegram?.close();void localAI.close();remotePolicy.close();controller?.abort();void integrations.close();oauth.cancel();native.close();});
