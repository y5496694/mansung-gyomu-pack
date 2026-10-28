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
async function models(){const config=structuredClone(settings);return provider.listModels({settings:config,credential:await credential(config),apiKey:config.connectionMode==='api'?keys[config.provider].get():undefined});}
function persist(next){settings=next;save('settings.json',settings);}
async function configure(args={}){idle();if(oauth.pending)throw new Error('진행 중인 로그인을 마치거나 취소하세요.');const next=connections.update(settings,args);if(typeof args.hwpAutoSave==='boolean')next.hwpAutoSave=args.hwpAutoSave;if(args.apiKey?.trim())keys[next.provider].set(args.apiKey.trim());persist(next);return metadata();}
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
async function preview(args){const file=document(args.path),hash=createHash('sha256').update(fs.readFileSync(file)).digest('hex'),pdf=path.join(home,'cache',hash+'.pdf');return native.savedFileOperation(file,{},async()=>{if(!fs.existsSync(pdf))await runPython(python,home,'documents.py',{action:'previewNativeHangul',path:file,target:pdf});return runPython(python,home,'documents.py',{action:'inspect',path:pdf,page:args.page||0});});}
const methods={
 state:()=>metadata(),configure,
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
  try{const request=async body=>provider.requestResponse({settings:config,credential:await credential(config),apiKey:config.connectionMode==='api'?keys[config.provider].get():undefined,signal,body});const text=await runAgent({prompt,context:file,settings:config,request,execute,send:emit,signal,history});history.push({role:'user',content:prompt},{role:'assistant',content:text});history=history.slice(-100);save('conversation.json',history);return text;}finally{controller=null;emit({type:'done'});}
 }
};
ipcMain.handle('narae:call',async(event,name,args)=>{if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||!Object.hasOwn(methods,name))throw new Error('허용되지 않은 요청');return methods[name](args||{});});
app.whenReady().then(()=>{window=new BrowserWindow({width:1420,height:940,minWidth:1000,minHeight:680,title:'나래 한글 오피스',backgroundColor:'#f5f6f8',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});window.setMenuBarVisibility(false);window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());window.loadFile(path.join(root,'ui/index.html'));});
app.on('window-all-closed',()=>app.quit());app.on('before-quit',()=>{controller?.abort();oauth.cancel();native.close();});
