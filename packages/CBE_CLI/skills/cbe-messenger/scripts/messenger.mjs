import { randomUUID } from 'node:crypto';

const ORIGIN = 'http://stmsg.cbe.go.kr:7880';
const MAIN_PATH = '/ezmaru/pc/main';
const READ_ROUTES = new Set([
  '/pc/note/noteList', '/note/noteList', '/pc/note/noteDetail',
  '/pc/message/sessionlist', '/pc/message/newchatlist',
  '/pc/user/newUserSearch', '/pc/user/getUserInfo', '/pc/memo/list', '/message/chatlist1vs1', '/pc/common/pageInitInfo',
  '/common/checkcharfilter', '/pc/note/sendtotalusercount', '/pc/note/getAllReceiveUserForNote',
]);
const WRITE_ROUTES = new Set(['/pc/note/write']);

export class DeliveryError extends Error {
  constructor(message,receipt){
    super(`${message} 자동 재전송하지 않았습니다. ${receipt.noteId?'쪽지':'메시지'} ID: ${receipt.noteId||receipt.messageId}`);
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

function submitChat(account,room,id,recipients,text,title,group,extension){
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
  window[key]={submitted:true};
  var queued=realtimeConect_view.sendMessageChat(data);
  window[key].queued=queued;
  return {queued:queued===true,content:content};
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
    const key = write?'__cbeCliNote_'+params.nteCode:'__cbeCli_' + randomUUID().replaceAll('-', '');
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
    return JSON.parse(await this.evaluate(`JSON.stringify({userId:common_activityData.getData('nurUuid'),name:common_activityData.getData('nurNic'),offline:common_activityData.getData('subStatus')==='FAKEOFF',socket:!!realtimeConect_activityData.getData('XDMSocket'),limits:common_activityData.getData('permission').COM})`));
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
    return {...noteSummary(n),text:hidden?'[보안 또는 회수된 쪽지: 앱에서 확인]':plain(n.NTE_CONTENT||n.NTE_CONTENT_HTML),recipients:(Array.isArray(n.RECEIVE_USER)?n.RECEIVE_USER:[]).map(u=>({id:u.NUR_UUID||u.NRU_UID,name:u.NUR_NIC||u.NRU_NIC||''})),files:hidden?[]:(n.ATTACH_IMAGE||[]).map(f=>({name:f.NNF_ORI_NAME,size:f.NNF_FILE_SIZE,valid:f.VALID_YN})),readDate:n.NRU_READ_DATE||null};
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
  async createChat(to,text,{title='',dryRun=false}={}){
    const ids=recipientIds(to);text=messageText(text);
    if(typeof title!=='string'||title.length>100)throw new Error('방 제목은 100자 이하로 입력하세요.');
    const settings=await this.sendSettings(),own=settings.userId,group=ids.length>1;
    if(!isId(own)||settings.offline||!settings.socket)throw new Error('로그인·온라인 상태와 메신저 전송 연결을 확인하세요.');
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
      }
    }
    if(dryRun)return {sent:false,dryRun:true,valid:true,willCreate:created,type:group?'group':'direct',recipients,room:room||null,title,text,background:true};
    if(!room)room=await this.evaluate('new ObjectId().toString()');
    const id=await this.evaluate('new ObjectId().toString()');
    if(!isId(room)||!isId(id)||room===id)throw new Error('메신저 ID 생성 실패.');
    const receipt={room,messageId:id,recipients,created,background:true};
    try{
      const result=await this.evaluate(`(${submitChat.toString()})(${[own,room,id,recipients,text,title,group,extension].map(v=>JSON.stringify(v)).join(',')})`);
      if(!result?.queued)throw new Error('전송 접수 여부가 불확실합니다.');
      const deadline=Date.now()+15000;
      while(Date.now()<deadline){
        const history=await this.messageData(room,{limit:100,contentsLength:Math.max(500,result.content.length+1000)});
        if(history.CHAT_INFO?.NMS_SCODE!==room||history.CHAT_INFO?.NMS_TYPE!==(group?'G':'C')||!sameIds(history.USER_OFFSET_LIST?.map(u=>u.NMU_UID),[...ids,own]))throw new Error('서버 대화방·참여자 검증에 실패했습니다.');
        const found=history.LIST?.find(m=>m.NMC_CODE===id&&m.NUR_UUID===own&&m.NMC_CTYPE===(group?'I':'M')&&m.NMC_CONTENT===result.content&&m.NMC_WITHDRAW_FLAG!=='Y'&&m.DELETE_YN!=='Y');
        if(found)return {sent:true,verified:true,...receipt,recipient:group?undefined:recipients[0],date:found.NMC_REGDATE,title,text};
        await new Promise(resolve=>setTimeout(resolve,500));
      }
      throw new Error('서버에서 같은 메시지 기록을 아직 확인하지 못했습니다.');
    }catch(error){throw new DeliveryError(error.message,receipt);}
  }

  async sendNote(to,text,{title,dryRun=false,confirmMany=false}={}){
    const ids=recipientIds(to);text=messageText(text);
    title=title===undefined?text.split('\n')[0].slice(0,100):title;
    if(typeof title!=='string'||title.length>100)throw new Error('쪽지 제목은 100자 이하로 입력하세요.');
    const settings=await this.sendSettings(),own=settings.userId;
    if(!isId(own)||settings.offline)throw new Error('로그인·온라인 상태를 확인하세요.');
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
    if(dryRun)return {sent:false,dryRun:true,valid:true,recipients,title,text,requiresConfirmation,background:true};
    if(requiresConfirmation&&!confirmMany)throw new Error('앱에서 추가 수신자 확인을 요구합니다. 수신자 목록을 확인한 뒤 --confirm-many로 실행하세요.');
    const params={nteCode:id,ruids:ids.join(':‡:'),nteContent:text,nteContentHtml:escapeHtml(text),mode:'write',fileDeleteList:'',fileDeleteCode:'',nteReceiveYn:'N',nteRejectYn:'N',nteReservYn:'N',nteReservDate:'',nteSecurityYn:'N',groupCodeList:'',myGroupCodeList:'',nteReplyYn:'N',nteCharFilter:filter.DATA.trim(),myReciveFlag:ids[0]===own?'Y':'N',fileCount:0,nteTitle:title,nteEachYn:'N'};
    const receipt={noteId:id,recipients,background:true};
    try{
      await this.request('/pc/note/write',params,{write:true,account:own});
      const deadline=Date.now()+15000;
      while(Date.now()<deadline){
        const detail=await this.query('/pc/note/noteDetail',{nteCode:id,nteReservYn:'N',activeWindow:'false',noteType:'S'});
        const n=detail.LIST;
        if(n?.NTE_CODE===id&&n.NUR_UUID===own&&n.NTE_CONTENT===text&&n.NTE_TITLE===title&&n.NTE_SECURITY_YN!=='Y'&&n.NTE_WITHDRAW_YN!=='Y'){
          const received=await this.query('/pc/note/getAllReceiveUserForNote',{nteCode:id});
          if(!sameIds(received.LIST?.map(u=>u.NRU_UID),ids))throw new Error('저장된 쪽지의 수신자가 일치하지 않습니다.');
          return {sent:true,verified:true,...receipt,date:n.NTE_REGDATE,title,text};
        }
        await new Promise(resolve=>setTimeout(resolve,500));
      }
      throw new Error('서버에서 같은 쪽지 기록을 아직 확인하지 못했습니다.');
    }catch(error){throw new DeliveryError(error.message,receipt);}
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
