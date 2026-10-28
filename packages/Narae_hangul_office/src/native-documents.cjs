const {spawn}=require('node:child_process'),path=require('node:path'),{EventEmitter}=require('node:events');
const ownedHwpByHome=new Map();
class NativeDocuments extends EventEmitter{
 constructor(home,python){super();this.home=home;this.python=python;this.pending=null;this.preferred=new Map();this.lastActiveFormat=null;this.snapshot={open_document_list:[],selected_region_by_format:{hwp:null,word:null,excel:null},primary_active_format:null};this.children=new Set();this.fileQueues=new Map();this.busyFiles=new Map();}
 withFileLock(file,operation){const key=path.resolve(file).toLowerCase();this.busyFiles.set(key,(this.busyFiles.get(key)||0)+1);this.emit('file-activity');const next=(this.fileQueues.get(key)||Promise.resolve()).then(operation).finally(()=>{const count=this.busyFiles.get(key)-1;if(count)this.busyFiles.set(key,count);else this.busyFiles.delete(key);this.emit('file-activity');if(this.fileQueues.get(key)===tail)this.fileQueues.delete(key);});const tail=next.catch(()=>{});this.fileQueues.set(key,tail);return next;}
 savedFileOperation(file,{editing=false,signal}={},operation){return this.withFileLock(file,async()=>{if(signal?.aborted)throw new Error('작업을 중지했습니다.');const info=await this.list(),opened=info.open_document_list.find(item=>path.resolve(item.local_path).toLowerCase()===path.resolve(file).toLowerCase());if(opened&&opened.modified!==false)throw new Error('한컴 문서에 저장하지 않은 변경이 있거나 저장 상태를 확인할 수 없습니다. 한컴에서 저장한 뒤 다시 읽으세요.');let closed=false,reusePid,result,failure;if(editing&&opened){const closing=await this.closeFile(file,true);closed=true;if(!closing.owned_application_closed)reusePid=opened.pid;}try{result=await operation();}catch(error){failure=error;}if(closed){try{await this.openFile(file,{reusePid});if(result)result.native_document_reopened=true;}catch(error){if(result)result.native_refresh_error=error.message;}}if(failure)throw failure;return result;});}
 request(input){return new Promise((resolve,reject)=>{const child=spawn(this.python,[path.join(__dirname,'document_live.py')],{windowsHide:true,env:require('./runtime-python.cjs').pythonEnvironment(this.home,{NARAE_HWP_EXE:require('./hancom.cjs').discoverHancom().hangul||''}),stdio:['pipe','pipe','pipe']});this.children.add(child);let output='',stderr='';const timer=setTimeout(()=>{child.kill();reject(new Error('한컴 문서 상태 응답 시간이 초과되었습니다.'));},input.action==='open_hwp'?45000:15000);child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>stderr=(stderr+data).slice(-2000));child.on('error',error=>{clearTimeout(timer);this.children.delete(child);reject(error);});child.on('close',()=>{clearTimeout(timer);this.children.delete(child);try{const value=JSON.parse(output);if(!value.ok)throw new Error(value.error);resolve(value.data);}catch(error){reject(new Error(output?error.message:stderr||'한컴 문서 상태를 읽지 못했습니다.'));}});child.stdin.end(JSON.stringify(input));});}
 list(){
  if(this.pending)return this.pending;
  this.pending=this.request({action:'list'}).then(snapshot=>{
   const foreground=snapshot.open_document_list.find(item=>item.is_foreground);
   for(const format of ['hwp']){
    const docs=snapshot.open_document_list.filter(item=>item.format===format),reported=docs.filter(item=>item.is_active_document);
    let active=docs.find(item=>item===foreground)||reported.find(item=>path.resolve(item.local_path).toLowerCase()===this.preferred.get(format))||reported[0];
    if(!active){active=docs.find(item=>path.resolve(item.local_path).toLowerCase()===this.preferred.get(format));if(active)active.active_source='last-opened-by-narae';}
    for(const item of docs)item.is_active_document=item===active;
    snapshot.selected_region_by_format[format]=active?.selected_region||null;
    if(active)this.preferred.set(format,path.resolve(active.local_path).toLowerCase());
   }
   if(foreground)this.lastActiveFormat=foreground.format;
   if(snapshot.open_document_list.some(item=>item.format===this.lastActiveFormat&&item.is_active_document))snapshot.primary_active_format=this.lastActiveFormat;
   const changed=JSON.stringify(snapshot)!==JSON.stringify(this.snapshot);this.snapshot=snapshot;if(changed)this.emit('document-info',snapshot);return snapshot;
  }).finally(()=>{this.pending=null;});return this.pending;
 }
 async openFile(file,{background=false,reusePid}={}){
  require('./format-policy.cjs').assertDocument(file);
  const {openHancom,nativeKind}=require('./hancom.cjs'),kind=nativeKind(file),format=kind==='hangul'?'hwp':null;
  if(format){this.lastActiveFormat=format;this.preferred.set(format,path.resolve(file).toLowerCase());const current=await this.list();if(current.open_document_list.some(item=>item.format===format&&path.resolve(item.local_path).toLowerCase()===path.resolve(file).toLowerCase())){await this.request({action:'activate',path:file});await this.list();return {status:'success',launched:false,already_open:true,open_verified:true};}}
  let openedByCom=false;
  if(kind==='hangul'){const result=await this.request({action:'open_hwp',path:file,background,...(Number.isInteger(reusePid)?{reuse_pid:reusePid}:{})});openedByCom=result.opened;if(result.owned_pid){const key=path.resolve(this.home).toLowerCase();if(!ownedHwpByHome.has(key))ownedHwpByHome.set(key,new Set());ownedHwpByHome.get(key).add(result.owned_pid);}}
  if(!openedByCom&&!await openHancom(file))return false;
  if(!format)return {status:'success',launched:true,open_verified:false};
  const deadline=Date.now()+12000;
  while(Date.now()<deadline){const info=await this.list();if(info.open_document_list.some(item=>item.format===format&&path.resolve(item.local_path).toLowerCase()===path.resolve(file).toLowerCase()))return {status:'success',launched:true,open_verified:true};await new Promise(resolve=>setTimeout(resolve,300));}
  throw new Error('한컴 프로그램은 시작했지만 선택한 문서가 실제 열렸는지 확인하지 못했습니다.');
 }
 async closeFile(file,withSave=true){const key=path.resolve(this.home).toLowerCase(),snapshot=await this.list(),entry=snapshot.open_document_list.find(item=>path.resolve(item.local_path).toLowerCase()===path.resolve(file).toLowerCase()),owned=entry?.format==='hwp'&&ownedHwpByHome.get(key)?.has(entry.pid);const result=await this.request({action:'close',path:file,with_save:withSave,...(owned?{quit_owned_pid:entry.pid}:{})});if(result.owned_application_closed)ownedHwpByHome.get(key)?.delete(entry.pid);await this.list();return result;}
 watch(){this.list().catch(error=>this.emit('unavailable',error.message));this.timer=setInterval(()=>this.list().catch(error=>this.emit('unavailable',error.message)),3000);this.timer.unref();}
 close(){clearInterval(this.timer);for(const child of this.children)child.kill();this.children.clear();}
}
module.exports={NativeDocuments};
