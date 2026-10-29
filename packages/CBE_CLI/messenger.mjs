import { randomUUID, createHash } from 'node:crypto';
import { open, realpath, mkdir, lstat, unlink, copyFile, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, resolve, join } from 'node:path';

const ORIGIN = 'http://stmsg.cbe.go.kr:7880';
const MAIN_PATH = '/ezmaru/pc/main';
const READ_ROUTES = new Set([
  '/pc/note/noteList', '/note/noteList', '/pc/note/noteDetail',
  '/pc/message/sessionlist', '/pc/message/newchatlist',
  '/pc/user/newUserSearch', '/pc/user/getUserInfo', '/pc/memo/list', '/message/chatlist1vs1', '/pc/common/pageInitInfo',
  '/common/checkcharfilter', '/pc/note/sendtotalusercount', '/pc/note/getAllReceiveUserForNote',
]);
const WRITE_ROUTES = new Set(['/pc/note/write', '/common/fileuploadConfirm', '/common/getBsonCode4Chat']);

export class DeliveryError extends Error {
  constructor(message,receipt){
    super(`${message} 자동 재전송하지 않았습니다. ${receipt.noteId?'쪽지':receipt.messageId?'메시지':'방'} ID: ${receipt.noteId||receipt.messageId||receipt.room}`);
    this.receipt={sent:null,verified:false,...receipt,retry:false};
  }
}

// Runs inside the app's older CEF. Keep ES5 syntax here.
function startRequest(key,path,params,once,account){
  if(window[key])throw Error('already submitted');
  window[key]={done:false,submitted:false};
  function finish(value){if(window[key]){value.submitted=window[key].submitted;window[key]=value;}}
  var options={url:$('input[name=ContextRoot]').val()+path,async:true,data:params,type:'post',dataType:'json',cache:false,
    success:function(data){finish({done:true,data:data});},
    error:function(r,s){finish({done:true,error:'HTTP '+r.status+' '+s});},complete:function(){}};
  if(!once){EZAjax(options);return true;}
  if(common_activityData.getData('nurUuid')!==account)throw Error('account changed');
  // Let EZAjax prepare native encryption/decryption, but replace its retrying
  // error callback before submitting. Restore $.ajax before any network I/O.
  var ajax=$.ajax,captured=[];
  try{$.ajax=function(o){captured.push(o);};EZAjax(options);}
  finally{$.ajax=ajax;}
  if(captured.length!==1||captured[0].url!==options.url)throw Error('unexpected ajax contract');
  var request=captured[0],success=request.success;
  request.error=options.error;
  request.timeout=20000;
  request.success=function(data){try{success(data);}catch(e){finish({done:true,error:'응답 해석 실패'});}};
  window[key].submitted=true;
  ajax.call($,request);
  return true;
}

function submitChat(account,room,id,recipients,text,title,group,extension,file){
  var key='__cbeCliSend_'+id;
  if(window[key])throw Error('already submitted');
  if(common_activityData.getData('subStatus')==='FAKEOFF')throw Error('offline');
  if(!realtimeConect_activityData.getData('XDMSocket'))throw Error('socket disconnected');
  if(common_activityData.getData('nurUuid')!==account)throw Error('account changed');
  var ownName=common_activityData.getData('nurNic'),content=text,encrypted='';
  if(group){
    var invite=recipients.map(function(u){return {i:u.id,n:u.name,t:'R'};});
    invite.push({i:account,n:ownName,t:'S'});
    if(extension==='Y'){
      encrypted=cryptoUtil.encryptAES256WithSHA256Key(JSON.stringify({version:'1',type:'text',data:{},invite:invite}),main_activityData.getChatEncKey());
    }else{
      var names=recipients.map(function(u){return u.name;}).join(',');
      if(names.length>100)names=common_controller.langFormat('js_timeline_messagedetail_001',recipients[0].name+' 외 '+(recipients.length-1)+'명').format(recipients[0].name,recipients.length-1);
      content=text+':‡:'+common_controller.langFormat('js_timeline_messagedetail_018',ownName+'님이 '+names+'을(를) 초대하였습니다. ').format(ownName,names)+':‡:'+JSON.stringify(invite);
    }
  }
  var data={TYPE:'chat',ACTION:'SEND',INVITEID:'',RUIDS:recipients.map(function(u){return u.id;}).concat(account).join(','),
    NMC_SCODE:room,NMC_CODE:id,NMC_MCODE:'',NMC_REGDATE:common_controller.getTodayString(),NMC_CONTENT:content,
    NMC_CTYPE:group?'I':'M',NUR_NIC:ownName,NUR_UUID:account,NUR_THUMB_PIC:$('input[name=userImg]').val()||'',
    MAF_FILEURL:'',MAF_FILETHUMBURL:'',NMS_TYPE:group?'G':'C',WINDOWNAME:'chat:'+room,NMS_TITLE:title,NMC_FONTCOLOR:'',NMC_FONTSIZE:''};
  if(group){data.INVITE_RUIDS=recipients.map(function(u){return u.id;}).join(',');data.NMC_EXTENSION_ENC=encrypted;}
  if(file){data.NMC_CTYPE='F';data.NMC_MCODE=id;data.NMC_REGDATE=file.date||'';data.NMS_TYPE=file.type;if(file.name!==undefined)data.FILENAME=file.name;if(file.size!==undefined)data.FILESIZE=file.size;if(file.uploadPath!==undefined)data.UPLOADFILEPATH=file.uploadPath;}
  window[key]={submitted:true};
  var queued=realtimeConect_view.sendMessageChat(data);
  window[key].queued=queued;
  return {queued:queued===true,content:content};
}

// Multipart upload runs in the logged-in app; session credentials stay there.
function startUpload(key,account,fields){
  var state=window[key];
  if(!state||state.submitted)throw Error('invalid upload state');
  if(common_activityData.getData('nurUuid')!==account)throw Error('account changed');
  if(common_activityData.getData('subStatus')==='FAKEOFF'||common_activityData.getData('permission').PC.P04!=='Y')throw Error('upload restricted');
  var url=common_activityData.getData('fileServerUrl')+'/fileupload';
  if(!/^http:\/\/stmsg\.cbe\.go\.kr:7880\/file\//.test(url))throw Error('unexpected file server');
  var parts=state.chunks.map(function(chunk){var s=atob(chunk),b=new Uint8Array(s.length);for(var i=0;i<s.length;i++)b[i]=s.charCodeAt(i);return b;});
  var blob=new Blob(parts,{type:'application/octet-stream'}),form=new FormData();
  if(blob.size!==state.size)throw Error('file size changed');
  Object.keys(fields).forEach(function(k){form.append(k,fields[k]);});
  form.append('file',blob,state.name);
  state.chunks=[];
  var xhr=new XMLHttpRequest();
  xhr.open('POST',url,true);xhr.timeout=120000;
  xhr.setRequestHeader('Accept','application/json, text/javascript, */*; q=0.01');
  xhr.setRequestHeader('X-Requested-With','XMLHttpRequest');
  function finish(error,result){window[key]={done:true,submitted:true,error:error||null,result:result||{}};}
  xhr.onload=function(){try{var r=JSON.parse(xhr.responseText);if(xhr.status!==200||r.RESULT!=='SUCCESS')finish('파일 업로드가 거절되었습니다.');else finish(null,{date:r.REGDATE||'',name:r.FILENAME,size:r.FILESIZE,uploadPath:r.UPLOADFILEPATH});}catch(e){finish('파일 업로드 응답을 해석할 수 없습니다.');}};
  xhr.onerror=function(){finish('파일 업로드 연결 오류.');};
  xhr.ontimeout=function(){finish('파일 업로드 시간 초과.');};
  xhr.onabort=function(){finish('파일 업로드 중단.');};
  state.submitted=true;
  xhr.send(form);
  return true;
}

// Keep authenticated file-server URLs inside CEF. Only response bytes leave it.
function startDownload(key,account,file,maxBytes){
  if(window[key])throw Error('download already started');
  if(common_activityData.getData('nurUuid')!==account)throw Error('account changed');
  if(common_activityData.getData('permission').PC.P07!=='Y')throw Error('download restricted');
  var server=common_activityData.getData('fileServerUrl');
  if(!/^http:\/\/stmsg\.cbe\.go\.kr:7880\/file\/(?:v2\/)?[-A-Za-z0-9]+$/.test(server))throw Error('unexpected file server');
  var encoded=Base64.encode(file.name).replace(/\//g,'*').replace(/\+/g,'@');
  var xhr=new XMLHttpRequest(),state={done:false,xhr:xhr};window[key]=state;
  function fail(message){if(window[key]===state){state.done=true;state.error=message;state.bytes=null;}}
  xhr.open('GET',server+file.url+'/'+encoded,true);xhr.responseType='arraybuffer';xhr.timeout=120000;
  xhr.onprogress=function(e){if(e.loaded>maxBytes){fail('첨부파일은 256MiB까지 다운로드할 수 있습니다.');xhr.abort();}};
  xhr.onload=function(){
    if(window[key]!==state)return;
    if(xhr.status!==200){fail('첨부파일 다운로드 실패: HTTP '+xhr.status);return;}
    var contentType=xhr.getResponseHeader('Content-Type')||'',length=xhr.getResponseHeader('Content-Length');
    if((/text\/html/i.test(contentType)&&! /\.html?$/i.test(file.name))||(/application\/json/i.test(contentType)&&! /\.json$/i.test(file.name))){fail('파일 대신 오류 또는 로그인 응답을 받았습니다.');return;}
    if(!xhr.response||typeof xhr.response.byteLength!=='number'){fail('첨부파일 응답 형식이 올바르지 않습니다.');return;}
    var size=xhr.response.byteLength;
    if(size>maxBytes){fail('첨부파일은 256MiB까지 다운로드할 수 있습니다.');return;}
    if(length!==null&&(!/^\d+$/.test(length)||Number(length)!==size)){fail('첨부파일 응답 크기가 일치하지 않습니다.');return;}
    if(common_activityData.getData('nurUuid')!==account){fail('다운로드 중 로그인 계정이 변경되었습니다.');return;}
    state.bytes=new Uint8Array(xhr.response);state.size=size;state.contentLength=length===null?null:Number(length);state.done=true;state.xhr=null;
  };
  xhr.onerror=function(){fail('첨부파일 다운로드 연결 오류.');};
  xhr.ontimeout=function(){fail('첨부파일 다운로드 시간 초과.');};
  xhr.onabort=function(){fail('첨부파일 다운로드 중단.');};
  xhr.send();return true;
}

function downloadChunk(key,offset,length,account){
  var state=window[key];
  if(common_activityData.getData('nurUuid')!==account||!state||!state.done||state.error||!state.bytes)throw Error('invalid download state');
  var end=Math.min(offset+length,state.size),parts=[];
  for(var start=offset;start<end;start+=8192)parts.push(String.fromCharCode.apply(null,state.bytes.subarray(start,Math.min(start+8192,end))));
  return btoa(parts.join(''));
}

function downloadName(name){
  if(typeof name!=='string'||!name||name.length>240||/[<>:"/\\|?*\x00-\x1f\x7f]/.test(name)||/[. ]$/.test(name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))throw Error('안전한 원본 파일명으로 저장할 수 없는 첨부파일입니다.');
  return name;
}

export async function attachmentFiles(paths=[]){
  if(!Array.isArray(paths)||paths.some(p=>typeof p!=='string'||!p.trim()))throw new Error('--file에 파일 경로를 입력하세요.');
  const files=[],seen=new Set();
  for(const path of paths){
    const resolved=await realpath(path),identity=process.platform==='win32'?resolved.toLowerCase():resolved;
    if(seen.has(identity))throw new Error('같은 첨부파일을 중복 지정했습니다.');
    const handle=await open(resolved,'r');
    try{
      const stat=await handle.stat(),name=basename(resolved);
      if(!stat.isFile()||!Number.isSafeInteger(stat.size)||/[\x00-\x1f\x7f]/.test(name))throw new Error('일반 파일만 첨부할 수 있습니다.');
      files.push({path:resolved,name,size:stat.size,mtimeMs:stat.mtimeMs,dev:stat.dev,ino:stat.ino});seen.add(identity);
    }finally{await handle.close();}
  }
  return files;
}

function fileSummary(files){return files.map(({name,size})=>({name,size}));}
function matchingFiles(actual,files,nameKey,sizeKey){
  const signature=(name,size)=>JSON.stringify([name,Number(size)]);
  return Array.isArray(actual)&&actual.length===files.length&&actual.every(f=>typeof f[nameKey]==='string'&&f[sizeKey]!==null&&f[sizeKey]!==''&&Number.isSafeInteger(Number(f[sizeKey]))&&Number(f[sizeKey])>=0)&&actual.map(f=>signature(f[nameKey],f[sizeKey])).sort().join('\n')===files.map(f=>signature(f.name,f.size)).sort().join('\n');
}

function recipientIds(value){
  const ids=(Array.isArray(value)?value:String(value??'').split(',')).map(id=>String(id).trim().toLowerCase());
  if(!ids.length||ids.some(id=>!isId(id))||new Set(ids).size!==ids.length)throw new Error('중복되지 않는 수신자 ID를 쉼표로 구분해 입력하세요.');
  return ids;
}
function isId(value){return typeof value==='string'&&/^[a-f0-9]{24}$/i.test(value);}
function messageText(value){
  if(typeof value!=='string'||!value.trim())throw new Error('빈칸이 아닌 본문이 필요합니다.');
  if(value.length>10000)throw new Error('본문은 10,000자 이하로 입력하세요.');
  return value.replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ');
}
function sameIds(actual,expected){return Array.isArray(actual)&&actual.every(isId)&&new Set(actual).size===actual.length&&[...actual].sort().join(',')===[...expected].sort().join(',');}
function recipientLimit(value){const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:100;}
function escapeHtml(text){return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/\n/g,'<br>');}
function chatText(message){
  const text=String(message.NMC_CONTENT||'');
  if(message.NMC_CTYPE==='I'){
    const parts=text.split(':‡:');
    if(parts.length===3){
      try{const invite=JSON.parse(parts[2]);if(Array.isArray(invite)&&invite.length&&invite.every(u=>isId(u.i)&&['R','S'].includes(u.t)))return plain(parts[0]);}catch{}
    }
  }
  return plain(text);
}

export function selectTarget(targets) {
  const matches = targets.filter(t => {
    try { const u = new URL(t.url); return t.type === 'page' && u.origin === ORIGIN && u.pathname === MAIN_PATH; }
    catch { return false; }
  });
  if (matches.length !== 1) throw new Error(`충북소통메신저 메인 화면이 ${matches.length}개입니다. 앱을 열고 로그인해 주세요.`);
  return matches[0];
}

export function socketUrl(target, port) {
  const u = new URL(target.webSocketDebuggerUrl);
  if (u.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
      || Number(u.port) !== port || u.username || u.password || u.search || u.hash
      || u.pathname !== `/devtools/page/${target.id}`) throw new Error('예상과 다른 메신저 디버깅 주소입니다.');
  u.hostname = '127.0.0.1';
  return u.href;
}

export class Messenger {
  static async connect(port = 9000) {
    let response;
    try { response = await fetch(`http://127.0.0.1:${port}/json`, {redirect:'error', signal:AbortSignal.timeout(5000)}); }
    catch { throw new Error(`메신저 연결 실패 (127.0.0.1:${port}). 충북소통메신저를 실행하고 로그인해 주세요.`); }
    if (!response.ok) throw new Error('메신저 디버깅 응답을 읽을 수 없습니다.');
    const targets = await response.json();
    if (!Array.isArray(targets)) throw new Error('메신저 디버깅 목록 형식이 달라졌습니다.');
    const target = selectTarget(targets);
    const client = new Messenger();
    client.target = target;
    client.pending = new Map();
    client.nextId = 0;
    client.ws = new WebSocket(socketUrl(target, port));
    client.ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const pending = client.pending.get(message.id);
      if (!pending) return;
      client.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`메신저 디버깅 오류: ${message.error.message}`));
      else pending.resolve(message.result);
    });
    client.ws.addEventListener('close', () => client.rejectPending());
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('메신저 연결 시간 초과.')), 5000);
        client.ws.addEventListener('open', () => {clearTimeout(timer); resolve();}, {once:true});
        client.ws.addEventListener('error', () => {clearTimeout(timer); reject(new Error('메신저 연결이 끊겼습니다.'));}, {once:true});
      });
      const ready = await client.evaluate(`typeof EZAjax === 'function' && typeof common_activityData !== 'undefined' && !!common_activityData.getData('nurUuid')`);
      if (!ready) throw new Error('메신저 로그인이 완료되지 않았거나 앱 구조가 달라졌습니다.');
      return client;
    } catch (error) {client.close(); throw error;}
  }

  rejectPending() {
    for (const p of this.pending.values()) {clearTimeout(p.timer); p.reject(new Error('메신저 연결이 종료되었습니다.'));}
    this.pending.clear();
  }
  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState !== WebSocket.OPEN) {reject(new Error('메신저 연결이 닫혔습니다.')); return;}
      const id = ++this.nextId;
      const timer = setTimeout(() => {this.pending.delete(id); reject(new Error(`메신저 응답 시간 초과: ${method}`));}, 15000);
      this.pending.set(id, {resolve,reject,timer});
      this.ws.send(JSON.stringify({id,method,params}));
    });
  }
  async evaluate(expression) {
    const r = await this.call('Runtime.evaluate', {expression,returnByValue:true});
    if (r.exceptionDetails || r.result?.subtype === 'error' || r.wasThrown) throw new Error('메신저 내부 함수 실행에 실패했습니다. 앱 버전 또는 로그인 상태를 확인해 주세요.');
    return r.result?.value;
  }
  close() {this.rejectPending(); this.ws.close();}

  async status() {
    return JSON.parse(await this.evaluate(`JSON.stringify({app:'충북소통메신저',connected:true,userId:common_activityData.getData('nurUuid'),name:common_activityData.getData('nurNic')||'',product:$('input[name=PRODUCT_NAME]').val(),page:location.href})`));
  }

  async query(path, params) {
    if (!READ_ROUTES.has(path)) throw new Error('지원하지 않는 조회 경로입니다.');
    return this.request(path,params);
  }
  async request(path,params,{write=false,account=''}={}) {
    if(!(write?WRITE_ROUTES:READ_ROUTES).has(path))throw new Error('지원하지 않는 요청 경로입니다.');
    const key = write&&path==='/pc/note/write'?'__cbeCliNote_'+params.nteCode:'__cbeCli_' + randomUUID().replaceAll('-', '');
    // Older CEF does not support awaitPromise. Poll an isolated callback result.
    try {
      await this.evaluate(`(${startRequest.toString()})(${[key,path,params,write,account].map(v=>JSON.stringify(v)).join(',')})`);
      const deadline = Date.now()+25000;
      while (Date.now()<deadline) {
        const state = JSON.parse(await this.evaluate(`JSON.stringify(window[${JSON.stringify(key)}])`));
        if (state.done) {
          if (state.error) throw new Error(state.error);
          if (!state.data || state.data.RESULT !== 'SUCCESS') throw new Error(`메신저 요청 실패: ${state.data?.RESULT || '응답 형식 변경'}`);
          return state.data;
        }
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      throw new Error('메신저 요청 시간이 초과되었습니다.');
    } finally {
      await this.evaluate(write?`window[${JSON.stringify(key)}]={done:true,submitted:true}`:`delete window[${JSON.stringify(key)}]`).catch(()=>{});
    }
  }

  async pageConfig(kind){
    const path={note:'/pc/noteWrite',chat:'/pc/messageDetail'}[kind];
    if(!path)throw new Error('지원하지 않는 설정 화면입니다.');
    const key='__cbeCliConfig_'+randomUUID().replaceAll('-','');
    try{
      // Download an inert document only. Never insert it into the app or run scripts.
      await this.evaluate(`(function(){var k=${JSON.stringify(key)};window[k]={done:false};$.ajax({url:$('input[name=ContextRoot]').val()+${JSON.stringify(path)},type:'get',dataType:'html',timeout:10000,success:function(html){try{var doc=new DOMParser().parseFromString(html,'text/html'),data={};['PC_NOTE_USE','USE_EXTENSION_FOR_CHAT_INVITE','USE_CHAR_FILTER','PRODUCT_NAME'].forEach(function(n){var e=doc.querySelector('input[name="'+n+'"]');data[n]=e?e.value:null;});window[k]={done:true,data:data};}catch(e){window[k]={done:true,error:true};}},error:function(){window[k]={done:true,error:true};}});return true;})()`);
      const deadline=Date.now()+12000;
      while(Date.now()<deadline){
        const state=JSON.parse(await this.evaluate(`JSON.stringify(window[${JSON.stringify(key)}])`));
        if(state.done){if(state.error||state.data?.PRODUCT_NAME!=='CBE')throw new Error('앱 전송 설정을 확인할 수 없습니다.');return state.data;}
        await new Promise(r=>setTimeout(r,100));
      }
      throw new Error('앱 전송 설정 조회 시간 초과.');
    }finally{await this.evaluate(`delete window[${JSON.stringify(key)}]`).catch(()=>{});}
  }

  async sendSettings(){
    return JSON.parse(await this.evaluate(`JSON.stringify({userId:common_activityData.getData('nurUuid'),name:common_activityData.getData('nurNic'),offline:common_activityData.getData('subStatus')==='FAKEOFF',socket:!!realtimeConect_activityData.getData('XDMSocket'),limits:common_activityData.getData('permission').COM,fileLimits:common_activityData.getData('permission').PC})`));
  }

  checkAttachments(files,settings,kind){
    if(!files.length)return;
    const p=settings.fileLimits,count=Number(p?.P05),mb=Number(p?.P06);
    if(p?.P04!=='Y')throw new Error('앱에서 파일 첨부 권한이 제한되었습니다.');
    if(!Number.isSafeInteger(count)||count<1||p.P06===null||p.P06===''||!Number.isFinite(mb)||mb<0)throw new Error('앱의 첨부파일 제한을 확인할 수 없습니다.');
    if(files.length>count)throw new Error(`첨부파일은 ${count}개까지 가능합니다.`);
    for(const file of files){
      if((mb>0||kind==='note')&&file.size>mb*1048576)throw new Error(`첨부파일의 최대 용량은 ${mb}MB입니다: ${file.name}`);
      const allowed=String(settings.limits?.C19||'').toUpperCase(),ext=file.name.includes('.')?file.name.split('.').at(-1).toUpperCase():'';
      if(allowed&&(!ext||!allowed.includes(ext)))throw new Error(`앱에서 허용하지 않는 파일 확장자입니다: ${file.name}`);
    }
  }

  async uploadFile(file,fields,account){
    const key='__cbeCliUpload_'+randomUUID().replaceAll('-',''),handle=await open(file.path,'r');
    try{
      const stat=await handle.stat();
      if(!stat.isFile()||['size','mtimeMs','dev','ino'].some(k=>stat[k]!==file[k]))throw new Error('점검 후 첨부파일이 변경되었습니다.');
      await this.evaluate(`window[${JSON.stringify(key)}]=${JSON.stringify({done:false,submitted:false,name:file.name,size:file.size,chunks:[]})};true`);
      const buffer=Buffer.alloc(192*1024);
      for(let offset=0;offset<file.size;){
        const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,file.size-offset),offset);
        if(!bytesRead)throw new Error('첨부파일 읽기가 중단되었습니다.');
        await this.evaluate(`window[${JSON.stringify(key)}].chunks.push(${JSON.stringify(buffer.subarray(0,bytesRead).toString('base64'))});true`);
        offset+=bytesRead;
      }
      const after=await handle.stat();
      if(after.size!==file.size||after.mtimeMs!==file.mtimeMs)throw new Error('첨부파일 읽기 중 파일이 변경되었습니다.');
      await this.evaluate(`(${startUpload.toString()})(${[key,account,fields].map(v=>JSON.stringify(v)).join(',')})`);
      const deadline=Date.now()+125000;
      while(Date.now()<deadline){
        const state=JSON.parse(await this.evaluate(`JSON.stringify({done:window[${JSON.stringify(key)}].done,error:window[${JSON.stringify(key)}].error,result:window[${JSON.stringify(key)}].result})`));
        if(state.done){if(state.error)throw new Error(state.error);return state.result;}
        await new Promise(r=>setTimeout(r,250));
      }
      throw new Error('첨부파일 업로드 결과를 확인할 수 없습니다.');
    }finally{await handle.close();await this.evaluate(`delete window[${JSON.stringify(key)}]`).catch(()=>{});}
  }

  async uploadAuthorization(account){
    const auth=await this.request('/common/fileuploadConfirm',{mode:'PC'},{write:true,account});
    if(!isId(auth.BSON))throw new Error('파일 업로드 인증 응답이 올바르지 않습니다.');
    return auth.BSON;
  }

  async notes({box='ALL',page=1,limit=30,search='',searchType='send',offset='0'}={}) {
    const path=search?'/note/noteList':'/pc/note/noteList';
    const params={mode:box,pageNo:page,pageSize:limit,searchValue:search,searchType,offset,listTempCode:randomUUID()};
    // The app anchors later pages to the FIRST row's date from page 1.
    if(page>1&&offset==='0'){
      const first=await this.query(path,{...params,pageNo:1});
      if(!first.LIST.length)return {page,limit,total:knownCount(first.LIST_COUNT),offset:null,items:[]};
      params.offset=first.LIST[0].NTE_REGDATE;
    }
    const d=await this.query(path,params);
    return {page,limit,total:knownCount(d.LIST_COUNT),offset:page===1?(d.LIST[0]?.NTE_REGDATE||null):params.offset,items:d.LIST.map(noteSummary)};
  }
  async note(id,type='R',reserved=false) {
    const d=await this.query('/pc/note/noteDetail',{nteCode:id,nteReservYn:reserved?'Y':'N',activeWindow:'false',noteType:type});
    const n=d.LIST;
    const hidden=n.NTE_SECURITY_YN==='Y'||n.NTE_WITHDRAW_YN==='Y';
    return {...noteSummary(n),text:hidden?'[보안 또는 회수된 쪽지: 앱에서 확인]':plain(n.NTE_CONTENT||n.NTE_CONTENT_HTML),recipients:(Array.isArray(n.RECEIVE_USER)?n.RECEIVE_USER:[]).map(u=>({id:u.NUR_UUID||u.NRU_UID,name:u.NUR_NIC||u.NRU_NIC||''})),files:hidden?[]:(n.ATTACH_IMAGE||[]).map(f=>({id:f.NNF_CODE,name:f.NNF_ORI_NAME,size:f.NNF_FILE_SIZE,valid:f.VALID_YN,validUntil:f.VALID_DATE})),readDate:n.NRU_READ_DATE||null};
  }
  async downloadNote(id,{type='R',reserved=false,attachmentId,outDir}={}){
    if(!isId(id)||!['R','S'].includes(type)||!outDir?.trim()||(attachmentId!==undefined&&!isId(attachmentId)))throw Error('쪽지 ID, 첨부 ID 및 --out-dir을 확인하세요.');
    const d=await this.query('/pc/note/noteDetail',{nteCode:id,nteReservYn:reserved?'Y':'N',activeWindow:'false',noteType:type}),n=d.LIST;
    if(n?.NTE_CODE!==id)throw Error('요청한 쪽지와 서버 응답이 일치하지 않습니다.');
    if(n.NTE_SECURITY_YN==='Y'||n.NTE_WITHDRAW_YN==='Y')throw Error('보안 또는 회수된 쪽지의 첨부파일은 다운로드하지 않습니다.');
    if(!Array.isArray(n.ATTACH_IMAGE))throw Error('쪽지 첨부 목록을 확인할 수 없습니다.');
    const selected=n.ATTACH_IMAGE.filter(f=>attachmentId===undefined||f.NNF_CODE===attachmentId);
    if(!selected.length)throw Error('해당 첨부파일이 없습니다. notes read 결과의 files[].id를 확인하세요.');
    const settings=JSON.parse(await this.evaluate(`JSON.stringify({account:common_activityData.getData('nurUuid'),allowed:common_activityData.getData('permission').PC.P07,now:common_controller.getTodayString()})`));
    if(!isId(settings.account)||settings.allowed!=='Y')throw Error('앱에서 첨부파일 다운로드 권한이 제한되었습니다.');
    const files=selected.map(f=>{
      if(!isId(f.NNF_CODE)||f.NNF_NCODE!==id||f.VALID_YN!=='Y'||f.DELETE_YN==='Y'||(f.VALID_DATE&&(!/^\d{14,17}$/.test(f.VALID_DATE)||!/^\d{14,17}$/.test(settings.now)||f.VALID_DATE<settings.now)))throw Error('만료·삭제되었거나 소속을 확인할 수 없는 첨부파일입니다.');
      if(typeof f.NNF_FILEURL!=='string'||!/^\/upload\/note\/[-A-Za-z0-9_.]+$/.test(f.NNF_FILEURL)||['.','..'].includes(f.NNF_FILEURL.split('/').at(-1)))throw Error('지원하지 않는 첨부파일 경로입니다.');
      return {id:f.NNF_CODE,name:downloadName(f.NNF_ORI_NAME),url:f.NNF_FILEURL};
    });
    if(new Set(files.map(f=>f.name.toLocaleLowerCase())).size!==files.length)throw Error('첨부파일 이름이 중복됩니다. --attachment로 하나씩 선택해 다른 폴더에 저장하세요.');
    await mkdir(resolve(outDir),{recursive:true});const directory=await realpath(resolve(outDir));
    for(const file of files){try{await lstat(join(directory,file.name));throw Error('이미 존재하는 파일을 덮어쓰지 않습니다: '+file.name);}catch(e){if(e.code!=='ENOENT')throw e;}}
    const result={noteId:id,downloaded:false,verified:false,files:[],background:true};
    try{
      for(const file of files)result.files.push(await this.downloadAttachment(file,directory,settings.account));
      return {...result,downloaded:true,verified:true};
    }catch(error){error.receipt={...result,partial:result.files.length>0,retry:false};throw error;}
  }
  async downloadAttachment(file,directory,account){
    const key='__cbeCliDownload_'+randomUUID().replaceAll('-',''),temp=join(directory,'.cbe-download-'+randomUUID()+'.part'),target=join(directory,file.name);
    let handle;
    try{
      handle=await open(temp,'wx');
      await this.evaluate(`(${startDownload.toString()})(${[key,account,file,256*1024*1024].map(v=>JSON.stringify(v)).join(',')})`);
      const deadline=Date.now()+125000;let state;
      while(Date.now()<deadline){
        state=JSON.parse(await this.evaluate(`JSON.stringify({done:window[${JSON.stringify(key)}].done,error:window[${JSON.stringify(key)}].error,size:window[${JSON.stringify(key)}].size,contentLength:window[${JSON.stringify(key)}].contentLength})`));
        if(state.done)break;
        await new Promise(r=>setTimeout(r,100));
      }
      if(!state?.done)throw Error('첨부파일 다운로드 시간이 초과되었습니다.');
      if(state.error)throw Error(state.error);
      if(!Number.isSafeInteger(state.size)||state.size<0||state.size>256*1024*1024)throw Error('첨부파일 크기를 확인할 수 없습니다.');
      const digest=createHash('sha256');
      for(let offset=0;offset<state.size;){
        const count=Math.min(192*1024,state.size-offset),encoded=await this.evaluate(`(${downloadChunk.toString()})(${[key,offset,count,account].map(v=>JSON.stringify(v)).join(',')})`);
        const bytes=Buffer.from(encoded,'base64');if(bytes.length!==count)throw Error('첨부파일 전송 바이트 수가 일치하지 않습니다.');
        await handle.writeFile(bytes);digest.update(bytes);offset+=bytes.length;
      }
      const stat=await handle.stat();if(stat.size!==state.size)throw Error('저장된 파일 크기가 일치하지 않습니다.');
      await handle.close();handle=null;
      const sha256=digest.digest('hex');
      if(createHash('sha256').update(await readFile(temp)).digest('hex')!==sha256)throw Error('저장된 파일 해시가 일치하지 않습니다.');
      await copyFile(temp,target,constants.COPYFILE_EXCL);
      return {id:file.id,name:file.name,path:target,size:stat.size,sha256,contentLength:state.contentLength??null,verified:true};
    }finally{
      if(handle)await handle.close();
      await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});
      await this.evaluate(`(function(){var k=${JSON.stringify(key)},s=window[k];if(s&&s.xhr)s.xhr.abort();delete window[k];return true;})()`).catch(()=>{});
    }
  }
  async chats({page=1,limit=30,search='',box='ALL',offset='0'}={}) {
    const d=await this.query('/pc/message/sessionlist',{pageNo:page,pageSize:limit,searchValue:search,searchType:'nic',nelStatus:box,offset});
    return {page,limit,total:knownCount(d.LIST_COUNT),items:d.LIST.map(r=>({id:r.LCODE,lastMessageId:r.NMC_CODE,title:plain(r.NMU_CHAT_NAME||r.CHAT_TITLE||r.NIC),participants:r.CHAT_USER_COUNT,date:r.REGDATE,preview:plain(r.CONTENTS),type:r.NMS_TYPE,offset:r.NMU_OFFSET}))};
  }
  async messages(id,{page=1,limit=30,offset=0}={}) {
    const d=await this.messageData(id,{page,limit,offset});
    return {id,page,limit,title:plain(d.CHAT_INFO?.TITLE),items:d.LIST.map(m=>({id:m.NMC_CODE,number:m.NMC_NO,sender:m.NUR_NIC,senderId:m.NUR_UUID,date:m.NMC_REGDATE,type:m.NMC_CTYPE,text:(m.NMC_WITHDRAW_FLAG==='Y'||m.DELETE_YN==='Y')?'[삭제 또는 회수된 메시지]':chatText(m),attachment:m.MAF_ORI_NAME?{name:m.MAF_ORI_NAME,size:m.MAF_FILE_SIZE}:null}))};
  }
  async messageData(id,{page=1,limit=30,offset=0,contentsLength=500}={}){
    const params={pageNo:page,pageSize:limit,scode:id,ruids:'',mode:'',offset,contentsLength,type:'new',newMessageClick:false};
    const flags=JSON.parse(await this.evaluate(`JSON.stringify({v:$('input[name=CHATDETAIL_LIST]').val(),r:$('input[name=VER_CHAT_READ_HERE]').val()})`));
    if(flags.v==='1')params.ver='1';if(flags.r==='1')params.readVer='1';
    return this.query('/pc/message/newchatlist',params);
  }
  async users(search,{page=1,limit=30,scope='auto'}={}) {
    if(!['auto','my','all'].includes(scope))throw new Error('검색 범위는 auto, my, all 중 하나입니다.');
    if(scope!=='all'){
      const own=await this.query('/pc/common/pageInitInfo',{});
      if(!Array.isArray(own.WITH_USER_LIST))throw new Error('내 조직 사용자 목록을 확인할 수 없습니다. 전체 조직 검색으로 임의 전환하지 않았습니다.');
      const needle=search.trim().toLocaleLowerCase();
      const matches=[...new Map(own.WITH_USER_LIST.filter(u=>plain(u.NUR_NIC).toLocaleLowerCase().includes(needle)).map(u=>[u.NUR_UUID,u])).values()];
      if(matches.length||scope==='my')return {page,limit,total:matches.length,scope:'my',requestedScope:scope,fallback:false,items:matches.slice((page-1)*limit,page*limit).map(userSummary)};
    }
    const d=await this.query('/pc/user/newUserSearch',{searchType:'nic',searchValue:search,type:'mainUserSearch',pageNo:page,pageSize:limit});
    return {page,limit,total:knownCount(d.TOTAL_LIST_COUNT),scope:'all',requestedScope:scope,fallback:scope==='auto',items:(d.TOTAL_LIST||[]).map(userSummary)};
  }
  async user(id) {
    const d=await this.query('/pc/user/getUserInfo',{nurSuid:id});
    const rows=Array.isArray(d.LIST)?d.LIST:[d.LIST];
    if(!rows[0])throw new Error('사용자 정보가 없습니다.');
    return rows.map(userSummary);
  }
  async memos({page=1,limit=30,search=''}={}) {
    const d=await this.query('/pc/memo/list',{pageNo:page,pageSize:limit,searchValue:search,searchType:'contents',nelStatus:'ALL',offset:'0'});
    return {page,limit,total:knownCount(d.LIST_COUNT),items:d.LIST.map(m=>({id:m.MCODE||m.NMC_CODE,title:plain(m.CHAT_TITLE||m.TITLE||''),text:plain(m.CONTENTS||m.NMC_CONTENT||''),date:m.REGDATE||m.NMC_REGDATE}))};
  }
  async open(kind,id,type='R',reserved=false) {
    const arg=JSON.stringify(id);
    const calls={main:`pcFuncBringToFront('EZMARU')`,note:`common_popup.viewNote(${JSON.stringify(type)},${arg},${reserved?"'B'":"'ALL'"})`,chat:`common_popup.chat(${arg},'','','')`,profile:`common_popup.viewProfile(${arg},'your')`};
    if(!(kind in calls))throw new Error('지원하지 않는 열기 명령입니다.');
    await this.evaluate(`(function(){${calls[kind]};return true;})()`);
    return {opened:kind,id:id||null};
  }
  async compose(uid) {
    await this.evaluate(`(function(){common_popup.writeNote('favorite',${JSON.stringify(uid)});return true;})()`);
    return {opened:'note-composer',recipientId:uid,sent:false};
  }
  async sendChat(uid,text,options={}){
    if(recipientIds(uid).length!==1)throw new Error('chats send는 수신자 한 명을 지정하세요. 그룹 생성은 chats create를 사용하세요.');
    return this.createChat(uid,text,options);
  }
  async createChat(to,text,{title='',dryRun=false,files:paths=[]}={}){
    const ids=recipientIds(to),files=await attachmentFiles(paths);
    text=files.length&&(text===undefined||(typeof text==='string'&&!text.trim()))?'':messageText(text);
    if(typeof title!=='string'||title.length>100)throw new Error('방 제목은 100자 이하로 입력하세요.');
    const settings=await this.sendSettings(),own=settings.userId,group=ids.length>1;
    if(!isId(own)||settings.offline||!settings.socket)throw new Error('로그인·온라인 상태와 메신저 전송 연결을 확인하세요.');
    this.checkAttachments(files,settings,'chat');
    if(ids.includes(own))throw new Error('대화 수신자에는 본인을 제외해 주세요.');
    if(ids.length+1>recipientLimit(settings.limits?.C04))throw new Error('앱의 대화방 최대 인원을 초과했습니다.');
    if(!group&&title)throw new Error('--title은 새 그룹 대화방에만 지정할 수 있습니다.');
    const recipients=[];
    for(const uid of ids){const u=(await this.user(uid))[0];if(u?.id!==uid)throw new Error('수신자 프로필 ID가 일치하지 않습니다.');recipients.push({id:uid,name:u.name});}
    let room,created=true,extension='';
    if(group){
      const config=await this.pageConfig('chat');extension=config.USE_EXTENSION_FOR_CHAT_INVITE;
      if(!['','N','Y'].includes(extension))throw new Error('그룹 초대 설정을 확인할 수 없습니다.');
      if(extension!=='Y'&&[text,settings.name,...recipients.map(u=>u.name)].some(s=>String(s).includes(':‡:')))throw new Error('그룹의 첫 메시지·이름에는 :‡: 구분자를 사용할 수 없습니다.');
    }else{
      const direct=await this.query('/message/chatlist1vs1',{ruids:ids[0]});
      if(direct.SCODE===''){created=true;}
      else{
        if(!isId(direct.SCODE))throw new Error('1:1 대화방 조회 응답이 올바르지 않습니다.');
        if(direct.NMS_TYPE!=='C'||!sameIds(String(direct.RUIDS||'').split(','),[...ids,own]))throw new Error('1:1 대화방 수신자 정보가 일치하지 않습니다. 전송하지 않았습니다.');
        room=direct.SCODE;created=false;
        if(files.length){
          const detail=await this.messageData(room,{limit:1});
          if(detail.CHAT_INFO?.NMS_SCODE!==room||detail.CHAT_INFO?.NMS_TYPE!=='C'||!sameIds(detail.USER_OFFSET_LIST?.map(u=>u.NMU_UID),[...ids,own]))throw new Error('첨부 전송 전 대화방·참여자 확인에 실패했습니다.');
          this.checkAttachments(files,{...settings,fileLimits:detail.PERMISSION},'chat');
        }
      }
    }
    if(dryRun)return {sent:false,dryRun:true,valid:true,willCreate:created,type:group?'group':'direct',recipients,room:room||null,title,text,files:fileSummary(files),background:true};
    if(!room)room=await this.evaluate('new ObjectId().toString()');
    if(!isId(room))throw new Error('메신저 ID 생성 실패.');
    const receipt={room,messageId:null,messageIds:[],files:[],recipients,created,background:true};
    let date;
    try{
      if(text||group){
        const id=await this.evaluate('new ObjectId().toString()');
        if(!isId(id)||room===id)throw new Error('메신저 ID 생성 실패.');
        receipt.messageId=id;
        const result=await this.evaluate(`(${submitChat.toString()})(${[own,room,id,recipients,text,title,group,extension].map(v=>JSON.stringify(v)).join(',')})`);
        if(!result?.queued)throw new Error('전송 접수 여부가 불확실합니다.');
        date=await this.verifyChat(room,id,own,ids,group,group?'I':'M',result.content);
        receipt.messageIds.push(id);
      }
      for(const file of files){
        receipt.pendingFile={name:file.name,size:file.size};
        await this.request('/common/getBsonCode4Chat',{scode:room,ruids:[...ids,own].join(',')},{write:true,account:own});
        const id=await this.uploadAuthorization(own);
        receipt.pendingFile.messageId=id;
        if(!receipt.messageId)receipt.messageId=id;
        const uploaded=await this.uploadFile(file,{uuid:own,type:'chat',auth:id,clientType:'pc',count:'1',code:id,scode:room},own);
        const result=await this.evaluate(`(${submitChat.toString()})(${[own,room,id,recipients,'',title,false,'',{...uploaded,type:group?'G':'C'}].map(v=>JSON.stringify(v)).join(',')})`);
        if(!result?.queued)throw new Error('파일 메시지 접수 여부가 불확실합니다.');
        date=await this.verifyChat(room,id,own,ids,group,'F','',file);
        receipt.messageIds.push(id);receipt.files.push({name:file.name,size:file.size,messageId:id});
        delete receipt.pendingFile;
      }
      return {sent:true,verified:true,...receipt,recipient:group?undefined:recipients[0],date,title,text};
    }catch(error){throw new DeliveryError(error.message,{...receipt,partial:receipt.messageIds.length>0});}
  }

  async verifyChat(room,id,own,ids,group,type,content,file){
    const deadline=Date.now()+15000;
    while(Date.now()<deadline){
      const history=await this.messageData(room,{limit:100,contentsLength:Math.max(500,content.length+1000)});
      if(history.CHAT_INFO?.NMS_SCODE!==room||history.CHAT_INFO?.NMS_TYPE!==(group?'G':'C')||!sameIds(history.USER_OFFSET_LIST?.map(u=>u.NMU_UID),[...ids,own]))throw new Error('서버 대화방·참여자 검증에 실패했습니다.');
      const found=history.LIST?.find(m=>m.NMC_CODE===id&&m.NUR_UUID===own&&m.NMC_CTYPE===type&&m.NMC_WITHDRAW_FLAG!=='Y'&&m.DELETE_YN!=='Y');
      if(found){
        if(file?!matchingFiles([found],[file],'MAF_ORI_NAME','MAF_FILE_SIZE'):found.NMC_CONTENT!==content)throw new Error('서버 메시지의 본문 또는 첨부파일 정보가 일치하지 않습니다.');
        return found.NMC_REGDATE;
      }
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    throw new Error('서버에서 같은 메시지 기록을 아직 확인하지 못했습니다.');
  }

  async sendNote(to,text,{title,dryRun=false,confirmMany=false,files:paths=[]}={}){
    const ids=recipientIds(to),files=await attachmentFiles(paths);
    const fileOnly=files.length&&(text===undefined||(typeof text==='string'&&!text.trim()));
    text=fileOnly?'내용없음':messageText(text);
    title=title===undefined?(fileOnly?files[0].name:text.split('\n')[0]).slice(0,100):title;
    if(typeof title!=='string'||title.length>100)throw new Error('쪽지 제목은 100자 이하로 입력하세요.');
    const settings=await this.sendSettings(),own=settings.userId;
    if(!isId(own)||settings.offline)throw new Error('로그인·온라인 상태를 확인하세요.');
    this.checkAttachments(files,settings,'note');
    if(ids.length>recipientLimit(settings.limits?.C05))throw new Error('앱의 쪽지 최대 수신자 수를 초과했습니다.');
    if(ids.includes(own)&&ids.length!==1)throw new Error('본인에게 쪽지를 보낼 때는 본인만 지정하세요.');
    const config=await this.pageConfig('note');
    if(config.PC_NOTE_USE!=='Y')throw new Error('쪽지 전송 권한을 확인할 수 없거나 전송이 제한되었습니다.');
    if(!['Y','N'].includes(config.USE_CHAR_FILTER))throw new Error('쪽지 금칙어 설정을 확인할 수 없습니다.');
    const recipients=[];
    for(const uid of ids){const u=(await this.user(uid))[0];if(u?.id!==uid)throw new Error('수신자 프로필 ID가 일치하지 않습니다.');recipients.push({id:uid,name:u.name});}
    const id=await this.evaluate('new ObjectId().toString()');
    if(!isId(id))throw new Error('메신저 ID 생성 실패.');
    const filter=await this.query('/common/checkcharfilter',{nteCode:id,nteContent:text});
    if(typeof filter.DATA!=='string')throw new Error('금칙어 검사 응답이 올바르지 않습니다.');
    if(config.USE_CHAR_FILTER==='Y'&&filter.DATA.trim())throw new Error('앱 금칙어 검사에서 전송이 제한되었습니다.');
    const count=await this.query('/pc/note/sendtotalusercount',{nteCode:id,ruids:ids.join(':‡:'),groupCodeList:'',myGroupCodeList:''});
    if(count.NOTE_SEND_FLAG===false||count.NOTE_SEND_FLAG==='N')throw new Error('앱에서 쪽지 전송을 제한했습니다.');
    const total=Number(count.TOTAL_USER_COUNT),threshold=Number(count.NOT_SAME_WITHGROUP_USER_CNT);
    if(!Number.isSafeInteger(total)||total!==ids.length||total>recipientLimit(settings.limits?.C05)||!sameIds(count.USER_LIST?.map(u=>u.NUR_UUID),ids))throw new Error('서버의 쪽지 수신자 목록·인원 확인에 실패했습니다.');
    if(count.NOT_SAME_WITHGROUP_USER_CNT===null||count.NOT_SAME_WITHGROUP_USER_CNT===undefined||!Number.isSafeInteger(threshold)||threshold<0)throw new Error('앱의 추가 수신자 확인 기준을 읽을 수 없습니다.');
    const requiresConfirmation=total>threshold;
    if(dryRun)return {sent:false,dryRun:true,valid:true,recipients,title,text,files:fileSummary(files),requiresConfirmation,background:true};
    if(requiresConfirmation&&!confirmMany)throw new Error('앱에서 추가 수신자 확인을 요구합니다. 수신자 목록을 확인한 뒤 --confirm-many로 실행하세요.');
    const params={nteCode:id,ruids:ids.join(':‡:'),nteContent:text,nteContentHtml:escapeHtml(text),mode:'write',fileDeleteList:'',fileDeleteCode:'',nteReceiveYn:'N',nteRejectYn:'N',nteReservYn:'N',nteReservDate:'',nteSecurityYn:'N',groupCodeList:'',myGroupCodeList:'',nteReplyYn:'N',nteCharFilter:filter.DATA.trim(),myReciveFlag:ids[0]===own?'Y':'N',fileCount:files.length,nteTitle:title,nteEachYn:'N'};
    const receipt={noteId:id,recipients,files:fileSummary(files),uploadedFiles:[],background:true};
    let submitted=false;
    try{
      if(files.length){
        const auth=await this.uploadAuthorization(own);
        for(const file of files){
          await this.uploadFile(file,{uuid:own,type:'note',code:id,auth,clientType:'pc',count:String(files.length)},own);
          receipt.uploadedFiles.push({name:file.name,size:file.size});
        }
      }
      submitted=true;
      await this.request('/pc/note/write',params,{write:true,account:own});
      const deadline=Date.now()+15000;
      while(Date.now()<deadline){
        const detail=await this.query('/pc/note/noteDetail',{nteCode:id,nteReservYn:'N',activeWindow:'false',noteType:'S'});
        const n=detail.LIST;
        if(n?.NTE_CODE===id&&n.NUR_UUID===own&&n.NTE_CONTENT===text&&n.NTE_TITLE===title&&n.NTE_SECURITY_YN!=='Y'&&n.NTE_WITHDRAW_YN!=='Y'){
          const received=await this.query('/pc/note/getAllReceiveUserForNote',{nteCode:id});
          if(!sameIds(received.LIST?.map(u=>u.NRU_UID),ids))throw new Error('저장된 쪽지의 수신자가 일치하지 않습니다.');
          if(files.length&&!matchingFiles(n.ATTACH_IMAGE,files,'NNF_ORI_NAME','NNF_FILE_SIZE'))throw new Error('저장된 쪽지의 첨부파일 정보가 일치하지 않습니다.');
          return {sent:true,verified:true,...receipt,date:n.NTE_REGDATE,title,text};
        }
        await new Promise(resolve=>setTimeout(resolve,500));
      }
      throw new Error('서버에서 같은 쪽지 기록을 아직 확인하지 못했습니다.');
    }catch(error){throw new DeliveryError(error.message,{...receipt,...(!submitted?{sent:false}:{}),stage:submitted?'verify-note':'upload'});}
  }
}

function knownCount(value){return Number.isFinite(value)&&value>=0?value:null;}
// Convert markup without executing HTML or fetching embedded resources.
export function plain(value='') {
  return String(value??'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/(?:p|div|li)>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[0-9a-f]+|[0-9]+);/gi,s=>{
    const entities={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '};
    if(entities[s.toLowerCase()]!==undefined)return entities[s.toLowerCase()];
    const n=s.toLowerCase().startsWith('&#x')?parseInt(s.slice(3,-1),16):parseInt(s.slice(2,-1),10);
    return Number.isInteger(n)&&n>=0&&n<=0x10ffff?String.fromCodePoint(n):s;
  }).replace(/\r\n/g,'\n').trim();
}
function noteSummary(n){
  const hidden=n.NTE_SECURITY_YN==='Y'||n.NTE_WITHDRAW_YN==='Y';
  return {id:n.NTE_CODE,type:n.NRU_TYPE,title:hidden?'[보안 또는 회수된 쪽지]':plain(n.NTE_TITLE||n.NTE_CONTENT).split('\n')[0],sender:n.NUR_NIC,recipient:n.RNIC,date:n.NTE_REGDATE,read:n.READ_YN?n.READ_YN==='Y':!!n.NRU_READ_DATE,reserved:n.NTE_RESERV_YN==='Y',secure:n.NTE_SECURITY_YN==='Y',withdrawn:n.NTE_WITHDRAW_YN==='Y',attachments:n.FILE_CNT??null,preview:hidden?'':plain(n.NTE_CONTENT).slice(0,180)};
}
function userSummary(u){return {id:u.NUR_UUID,name:u.NUR_NIC,department:u.GROUP_FULL_NAME||u.NCG_FULLNAME||u.CGG_NAME||u.PART_NAME||u.NCG_NAME||'',position:u.POSITION_NAME||u.NUR_GRADE||'',job:u.EXT_JOB||u.NUR_JOB||'',status:u.NUR_STATUS||'',phone:u.NUR_PHONE_OPENYN==='N'?null:(u.EXT_OFFICEPHONE||u.NUR_PHONE||''),email:u.NUR_EMAIL_OPENYN==='N'?null:(u.NUR_EMAIL||'')};}
