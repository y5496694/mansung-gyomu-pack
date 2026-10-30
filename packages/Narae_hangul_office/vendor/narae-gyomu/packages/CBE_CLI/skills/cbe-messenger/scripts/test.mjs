import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import { selectTarget, socketUrl, plain, Messenger } from './messenger.mjs';
import {positive,run,printResult} from './cli.mjs';
import {mkdtempSync,writeFileSync,rmSync,readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const target={type:'page',id:'a-b',url:'http://stmsg.cbe.go.kr:7880/ezmaru/pc/main',webSocketDebuggerUrl:'ws://127.0.0.1:9000/devtools/page/a-b'};
test('앱 메인 페이지만 선택하며 중복·다른 호스트는 거절',()=>{
  assert.equal(selectTarget([{...target,url:'about:blank'},target]),target);
  assert.throws(()=>selectTarget([target,target]));
  assert.throws(()=>selectTarget([{...target,url:'http://stmsg.cbe.go.kr.evil:7880/ezmaru/pc/main'}]));
});
test('디버깅 소켓은 같은 로컬 포트와 정확한 페이지 ID로 한정',()=>{
  assert.equal(socketUrl(target,9000),target.webSocketDebuggerUrl);
  for(const url of ['ws://example.com:9000/devtools/page/a-b','ws://127.0.0.1:9001/devtools/page/a-b','ws://127.0.0.1:9000/devtools/page/other','ws://user:pass@127.0.0.1:9000/devtools/page/a-b'])assert.throws(()=>socketUrl({...target,webSocketDebuggerUrl:url},9000));
});
test('서버를 변형하는 임의 API 경로는 호출하지 않음',async()=>{
  await assert.rejects(()=>new Messenger().query('/pc/note/deleteNote',{}),/지원하지/);
});
test('페이지 범위와 숫자 파싱 검증',()=>{
  assert.equal(positive('100','limit',100),100);
  for(const value of ['0','-1','1.5','101','NaN','1e2'])assert.throws(()=>positive(value,'limit',100));
});

test('잉여 위치 인자와 너무 큰 대화 offset은 앱 연결 전에 거절',async()=>{
  const original=Messenger.connect;let connections=0;
  Messenger.connect=async()=>{connections++;throw Error('must not connect');};
  try{
    for(const args of [['notes','list','typo'],['notes','read','id','extra'],['chats','list','extra'],['chats','read','room','extra'],['users','search','이름','extra'],['users','show','id','extra'],['memos','list','extra'],['open','main','extra'],['open','chat','room','extra']])await assert.rejects(()=>run(args),/지원하지 않는 명령/);
    await assert.rejects(()=>run(['chats','read','room','--offset','9007199254740993']),/offset이 너무/);
    await assert.rejects(()=>run(['notes','send','--to','111111111111111111111111','--text','예약 요청','--reserved']),/예약 전송은 지원하지/);
    assert.equal(connections,0);
  }finally{Messenger.connect=original;}
});

test('전체 건수 미상과 재조회 미확인을 확인 완료로 출력하지 않음',()=>{
  const output=[],original=console.log;console.log=(value)=>output.push(String(value));
  try{
    printResult({page:1,items:[]},false);
    assert.doesNotMatch(output.pop(),/undefined|전체/);
    printResult({sent:true,verified:false,messageId:'id'},false);
    assert.doesNotMatch(output.pop(),/서버 기록 확인 완료/);
  }finally{console.log=original;}
});
test('메시지 HTML 및 엔티티를 실행 없이 텍스트로 변환',()=>{
  assert.equal(plain('<p>안녕 &amp; &lt;동료&gt;</p><div>다음<br>줄 &#x1F600;</div>'),'안녕 & <동료>\n다음\n줄 😀');
  assert.equal(plain('&#99999999;'),'&#99999999;');
});
test('보안 쪽지는 JSON 결과에서도 본문을 숨김',async()=>{
  const c=new Messenger();c.query=async()=>({RESULT:'SUCCESS',LIST:{NTE_SECURITY_YN:'Y',NTE_TITLE:'secret',NTE_CONTENT:'secret',NTE_CONTENT_HTML:'secret',RECEIVE_USER:[],ATTACH_IMAGE:[]}});
  const r=await c.note('id');assert.ok(!JSON.stringify(r).includes('secret'));
});
test('대화방 ID는 마지막 메시지 ID 대신 LCODE 사용',async()=>{
  const c=new Messenger();c.query=async()=>({RESULT:'SUCCESS',LIST_COUNT:-1,LIST:[{LCODE:'room',MCODE:'other',NMC_CODE:'message'}]});
  const r=await c.chats();assert.equal(r.items[0].id,'room');assert.equal(r.total,null);
});
test('쪽지 다음 페이지는 첫 행 날짜를 기준으로 조회',async()=>{
  const c=new Messenger();const calls=[];c.query=async(path,params)=>{calls.push(params);return {RESULT:'SUCCESS',LIST_COUNT:-1,LIST:[{NTE_REGDATE:'20261015090000000'},{NTE_REGDATE:'20261014090000000'}]};};
  const r=await c.notes({page:2,limit:2});assert.equal(calls.length,2);assert.equal(calls[0].pageNo,1);assert.equal(calls[1].offset,'20261015090000000');assert.equal(r.offset,'20261015090000000');
});
test('실제 CLI 진입점에서 도움말·잘못된 인자를 처리',()=>{
  const entry=fileURLToPath(new URL('./cli.mjs',import.meta.url));
  const help=spawnSync(process.execPath,[entry,'--help'],{encoding:'utf8'});
  assert.equal(help.status,0);assert.match(help.stdout,/cbe notes list/);
  const invalid=spawnSync(process.execPath,[entry,'notes','list','--limit','0','--json'],{encoding:'utf8'});
  assert.equal(invalid.status,1);assert.ok(JSON.parse(invalid.stderr).error);
});
test('전송은 수신자와 본문이 있어야 함',async()=>{
  const c=new Messenger();await assert.rejects(()=>c.sendChat('bad','hi'));
  await assert.rejects(()=>c.sendChat('111111111111111111111111',' '));
});
test('다른 참여자가 포함된 대화방에는 전송하지 않음',async()=>{
  const c=new Messenger();c.user=async id=>[{id,name:'테스트'}];c.sendSettings=async()=>({userId:'222222222222222222222222',socket:true,limits:{}});c.query=async()=>({SCODE:'333333333333333333333333',NMS_TYPE:'C',RUIDS:'111111111111111111111111,444444444444444444444444'});c.evaluate=async()=>{throw Error('must not call transport');};
  await assert.rejects(()=>c.sendChat('111111111111111111111111','hi'),/일치하지/);
});
test('백그라운드 전송은 한번 호출하고 서버의 같은 메시지 ID로 검증',async()=>{
  const {c,state}=fixture();
  const result=await c.sendChat(UID,'hello');assert.equal(result.verified,true);assert.equal(state.packets.length,1);assert.equal(result.created,false);assert.equal(result.messageId,state.packets[0].NMC_CODE);
});
test('기본 이름 검색은 내 조직 일치 결과만 반환하고 전체 검색을 생략',async()=>{
  const c=new Messenger();const calls=[];c.query=async(path)=>{calls.push(path);return {WITH_USER_LIST:[{NUR_UUID:'local',NUR_NIC:'홍길동',NCG_FULLNAME:'내학교>행정실'},{NUR_UUID:'local',NUR_NIC:'홍길동',NCG_FULLNAME:'내학교>행정실'},{NUR_UUID:'other',NUR_NIC:'김다른'}]};};
  const r=await c.users('홍길동');assert.deepEqual(calls,['/pc/common/pageInitInfo']);assert.equal(r.scope,'my');assert.equal(r.fallback,false);assert.equal(r.total,1);assert.equal(r.items[0].department,'내학교>행정실');
});
test('내 조직에 이름이 없으면 전체 조직 검색으로 전환하고 후보를 유지',async()=>{
  const c=new Messenger();const calls=[];c.query=async(path,params)=>{calls.push({path,params});return path==='/pc/common/pageInitInfo'?{WITH_USER_LIST:[{NUR_UUID:'local',NUR_NIC:'김다른'}]}:{TOTAL_LIST_COUNT:2,TOTAL_LIST:[{NUR_UUID:'a',NUR_NIC:'홍길동'},{NUR_UUID:'b',NUR_NIC:'홍길동'}]};};
  const r=await c.users('홍길동');assert.equal(calls.length,2);assert.equal(calls[1].path,'/pc/user/newUserSearch');assert.equal(r.scope,'all');assert.equal(r.fallback,true);assert.equal(r.items.length,2);
});
test('전체 조직을 지정하면 내 조직 조회를 생략',async()=>{
  const c=new Messenger();const calls=[];c.query=async(path)=>{calls.push(path);return {TOTAL_LIST_COUNT:1,TOTAL_LIST:[{NUR_UUID:'a',NUR_NIC:'홍길동'}]};};
  const r=await c.users('홍길동',{scope:'all'});assert.deepEqual(calls,['/pc/user/newUserSearch']);assert.equal(r.requestedScope,'all');assert.equal(r.fallback,false);
});
test('내 조직만 지정하거나 내 조직의 다음 페이지가 비어도 전체로 전환하지 않음',async()=>{
  const c=new Messenger();c.query=async(path)=>{assert.equal(path,'/pc/common/pageInitInfo');return {WITH_USER_LIST:[{NUR_UUID:'a',NUR_NIC:'홍길동'}]};};
  const empty=await c.users('없는이름',{scope:'my'});assert.equal(empty.items.length,0);assert.equal(empty.scope,'my');
  const next=await c.users('홍길동',{page:2,limit:1});assert.equal(next.items.length,0);assert.equal(next.total,1);assert.equal(next.scope,'my');assert.equal(next.fallback,false);
});
test('내 조직 조회 실패를 이름 없음으로 오해하지 않음',async()=>{
  const c=new Messenger();let calls=0;c.query=async()=>{calls++;return {};};await assert.rejects(()=>c.users('홍길동'),/내 조직 사용자 목록/);assert.equal(calls,1);
});

const UID='111111111111111111111111',OWN='222222222222222222222222',ROOM='333333333333333333333333',OTHER='444444444444444444444444';
function fixture(options={}){
  const c=new Messenger(),state={requests:[],packets:[],uploads:[],note:null,retries:0,sequence:10,settings:{userId:OWN,name:'본인',offline:false,socket:true,limits:{C04:'100',C05:'100'},fileLimits:{P04:'Y',P05:'10',P06:'20'}}};
  const $=selector=>({val:()=>selector.includes('ContextRoot')?'/ezmaru':''});
  const originalAjax=$.ajax=function(o){
    const path=o.url.replace('/ezmaru',''),p=o.data.nativeEncrypted;
    state.requests.push({path,params:structuredClone(p)});
    if(options.failWrite&&path==='/pc/note/write'){o.error({status:504},'timeout');return;}
    let data;
    if(path==='/message/chatlist1vs1')data={SCODE:options.noRoom?'':ROOM,NMS_TYPE:'C',RUIDS:UID+','+OWN};
    else if(path==='/pc/message/newchatlist'){
      const packet=state.packets.at(-1)||{NMS_TYPE:'C',RUIDS:UID+','+OWN};
      const upload=state.uploads.find(u=>u.fields.code===packet.NMC_CODE);
      data={PERMISSION:{...state.settings.fileLimits,...(options.roomNoFiles?{P04:'N'}:{})},CHAT_INFO:{NMS_SCODE:p.scode,NMS_TYPE:packet.NMS_TYPE},USER_OFFSET_LIST:(options.wrongMembers?[UID,OTHER]:packet.RUIDS.split(',')).map(NMU_UID=>({NMU_UID})),LIST:[{...structuredClone(packet),...(upload?{MAF_ORI_NAME:options.wrongFile?'wrong.txt':upload.file.name,MAF_FILE_SIZE:upload.file.size}:{})}]};
    }else if(path==='/common/checkcharfilter')data={DATA:options.filter||''};
    else if(path==='/pc/note/sendtotalusercount')data={TOTAL_USER_COUNT:p.ruids.split(':‡:').length,NOT_SAME_WITHGROUP_USER_CNT:options.threshold??20,USER_LIST:p.ruids.split(':‡:').map(NUR_UUID=>({NUR_UUID}))};
    else if(path==='/pc/note/write'){
      state.note=structuredClone(p);data={LIST:{NTE_CODE:p.nteCode}};
    }else if(path==='/pc/note/noteDetail')data={LIST:{NTE_CODE:state.note.nteCode,NUR_UUID:OWN,NTE_CONTENT:state.note.nteContent,NTE_TITLE:state.note.nteTitle,NTE_REGDATE:'20261015',ATTACH_IMAGE:state.uploads.filter(u=>u.fields.code===state.note.nteCode).map(u=>({NNF_ORI_NAME:options.wrongFile?'wrong.txt':u.file.name,NNF_FILE_SIZE:u.file.size}))}};
    else if(path==='/pc/note/getAllReceiveUserForNote')data={LIST:(options.wrongNoteRecipient?[OTHER]:state.note.ruids.split(':‡:')).map(NRU_UID=>({NRU_UID}))};
    else if(path==='/common/fileuploadConfirm')data={BSON:(++state.sequence).toString(16).padStart(24,'0')};
    else if(path==='/common/getBsonCode4Chat')data={NMS_TYPE:'C'};
    else throw Error('Unexpected mock route '+path);
    o.success({nativeResponse:{RESULT:options.rejectWrite&&path==='/pc/note/write'?'FAIL':'SUCCESS',...data}});
  };
  class MockXHR {
    open(method,url,async){assert.equal(method,'POST');assert.match(url,/\/file\/mock\/fileupload$/);assert.equal(async,true);}
    setRequestHeader(name,value){assert.ok(['Accept','X-Requested-With'].includes(name));assert.ok(value);}
    send(form){
      const file=form.get('file'),fields=Object.fromEntries([...form].filter(([k])=>k!=='file'));
      state.uploads.push({file,fields});
      if(options.failUploadAt===state.uploads.length){this.onerror();return;}
      this.status=200;this.responseText=JSON.stringify({RESULT:'SUCCESS',REGDATE:'20261015',FILENAME:file.name,FILESIZE:file.size,UPLOADFILEPATH:'/mock/uploaded'});this.onload();
    }
  }
  const context=vm.createContext({window:{},$,JSON,Error,DOMParser:undefined,Blob,FormData,Uint8Array,atob,XMLHttpRequest:MockXHR,
    ObjectId:function(){const id=(++state.sequence).toString(16).padStart(24,'0');this.toString=()=>id;},
    common_activityData:{getData:key=>({nurUuid:state.settings.userId,nurNic:state.settings.name,subStatus:state.settings.offline?'FAKEOFF':'ON',permission:{COM:state.settings.limits,PC:state.settings.fileLimits},fileServerUrl:options.badFileServer?'http://wrong.invalid/file/mock':'http://stmsg.cbe.go.kr:7880/file/mock'}[key])},
    common_controller:{getTodayString:()=> '20261015',langFormat:(_key,fallback)=>({format:()=>fallback})},
    realtimeConect_activityData:{getData:()=>state.settings.socket},
    main_activityData:{getChatEncKey:()=> 'in-memory mock key'},
    cryptoUtil:{encryptAES256WithSHA256Key:text=>{state.extension=JSON.parse(text);return 'native-encrypted-invite';}},
    realtimeConect_view:{sendMessageChat:packet=>{state.packets.push(structuredClone(packet));packet.NMC_CONTENT='';return true;}},
    // Emulate native request encryption, response decoding and transport retry.
    EZAjax:o=>$.ajax({...o,data:{nativeEncrypted:o.data},success:r=>o.success(r.nativeResponse),error:()=>{state.retries++;throw Error('Native automatic retry must never run for writes');}}),
  });
  c.evaluate=async expression=>vm.runInContext(expression,context);
  c.pageConfig=async()=>({PRODUCT_NAME:'CBE',PC_NOTE_USE:options.noNote?'N':'Y',USE_CHAR_FILTER:options.filterEnabled?'Y':'N',USE_EXTENSION_FOR_CHAT_INVITE:options.extension?'Y':''});
  c.user=async id=>[{id,name:id===UID?'동료1':id===OWN?'본인':'동료2'}];
  return {c,state,context,$,originalAjax};
}

test('새 1:1 방은 첫 일반 메시지로 만들고 방·참여자·원문을 검증',async()=>{
  const {c,state}=fixture({noRoom:true});const text='<literal> &amp; '+ '긴 글'.repeat(200);
  const r=await c.sendChat(UID,text);assert.equal(r.created,true);assert.equal(r.text,text);assert.notEqual(r.room,r.messageId);assert.equal(state.packets[0].NMS_TYPE,'C');assert.equal(state.packets[0].NMC_CTYPE,'M');
  assert.ok(state.requests.find(r=>r.path==='/pc/message/newchatlist').params.contentsLength>text.length);
});

test('새 그룹은 초대 메타데이터와 본인을 포함하고 첫 메시지를 검증',async()=>{
  const {c,state}=fixture();const r=await c.createChat([UID,OTHER],'첫 메시지',{title:'업무 협의'});
  const p=state.packets[0];assert.equal(r.created,true);assert.equal(p.NMS_TYPE,'G');assert.equal(p.NMC_CTYPE,'I');assert.equal(p.NMS_TITLE,'업무 협의');assert.equal(p.INVITE_RUIDS,UID+','+OTHER);
  assert.deepEqual(JSON.parse(p.NMC_CONTENT.split(':‡:')[2]).map(u=>u.i),[UID,OTHER,OWN]);assert.equal(state.packets.length,1);
});

test('확장 초대 설정은 앱 암호화를 사용하고 본문과 초대 정보를 분리',async()=>{
  const {c,state}=fixture({extension:true});await c.createChat([UID,OTHER],'첫 :‡: 메시지');
  assert.equal(state.packets[0].NMC_CONTENT,'첫 :‡: 메시지');assert.equal(state.packets[0].NMC_EXTENSION_ENC,'native-encrypted-invite');assert.deepEqual(state.extension.invite.map(u=>u.i),[UID,OTHER,OWN]);
  assert.equal((await c.messages(state.packets[0].NMC_SCODE)).items[0].text,'첫 :‡: 메시지');
});

test('그룹 구분자·최대 인원·중복·자기 자신은 제출 전에 차단',async()=>{
  const {c,state}=fixture();await assert.rejects(()=>c.createChat([UID,OTHER],'a:‡:b'),/구분자/);
  await assert.rejects(()=>c.createChat([UID,UID],'hi'),/중복/);await assert.rejects(()=>c.createChat(OWN,'hi'),/본인/);
  state.settings.limits.C04='2';await assert.rejects(()=>c.createChat([UID,OTHER],'hi'),/최대 인원/);assert.equal(state.packets.length,0);
});

test('새 방 조회의 누락·손상 응답을 새 방 없음으로 취급하지 않음',async()=>{
  const {c,state}=fixture();c.query=async()=>({SCODE:null});await assert.rejects(()=>c.sendChat(UID,'hi'),/응답/);assert.equal(state.packets.length,0);
});

test('대화 dry-run은 새 방 생성도 메시지 전송도 하지 않음',async()=>{
  const {c,state}=fixture({noRoom:true});const r=await c.createChat([UID,OTHER],'hi',{dryRun:true});assert.equal(r.sent,false);assert.equal(r.willCreate,true);assert.equal(state.sequence,10);assert.equal(state.packets.length,0);
});

test('다른 서버 참여자는 성공으로 처리하지 않고 재전송 없이 ID 보존',async()=>{
  const {c,state}=fixture({wrongMembers:true});await assert.rejects(()=>c.sendChat(UID,'hi'),e=>e.receipt?.verified===false&&e.receipt.messageId===state.packets[0].NMC_CODE&&e.receipt.room===ROOM&&e.receipt.retry===false);assert.equal(state.packets.length,1);
});

test('쪽지는 앱 암호화 경로로 한 번 제출하고 본문·수신자를 따로 검증',async()=>{
  const {c,state,$,originalAjax}=fixture();const text='<태그> & "따옴표"\n다음 줄';const r=await c.sendNote([UID,OTHER],text,{title:'제목'});
  assert.equal(r.verified,true);assert.equal(r.text,text);assert.equal(state.note.nteContentHtml,'&lt;태그&gt; &amp; &quot;따옴표&quot;<br>다음 줄');assert.equal(state.note.ruids,UID+':‡:'+OTHER);assert.equal(state.note.mode,'write');assert.equal(state.note.fileCount,0);assert.equal(state.note.nteReservYn,'N');assert.equal($.ajax,originalAjax);
  assert.equal(state.requests.filter(r=>r.path==='/pc/note/write').length,1);assert.equal(state.retries,0);
});

test('쪽지 전송 HTTP 오류는 native 재시도를 제거하고 불확실한 ID 반환',async()=>{
  const {c,state,$,originalAjax}=fixture({failWrite:true});await assert.rejects(()=>c.sendNote(UID,'hi'),e=>e.receipt?.sent===null&&!!e.receipt.noteId&&e.receipt.retry===false);
  assert.equal(state.requests.filter(r=>r.path==='/pc/note/write').length,1);assert.equal(state.retries,0);assert.equal($.ajax,originalAjax);
});

test('서버 쪽지 실패·수신자 불일치는 완료로 보고하지 않음',async()=>{
  for(const options of [{rejectWrite:true},{wrongNoteRecipient:true}]){const {c,state}=fixture(options);await assert.rejects(()=>c.sendNote(UID,'hi'),e=>e.receipt?.verified===false);assert.equal(state.requests.filter(r=>r.path==='/pc/note/write').length,1);}
});

test('쪽지 dry-run은 수신자 확인 기준을 반환하고 write 호출은 생략',async()=>{
  const {c,state}=fixture({threshold:0});const r=await c.sendNote(UID,'hi',{dryRun:true});assert.equal(r.requiresConfirmation,true);assert.equal(r.sent,false);assert.equal(state.note,null);
  await assert.rejects(()=>c.sendNote(UID,'hi'),/confirm-many/);assert.equal(state.note,null);
  const sent=await c.sendNote(UID,'hi',{confirmMany:true});assert.equal(sent.verified,true);
});

test('쪽지 권한·금칙어·인원 제한을 우회하지 않음',async()=>{
  for(const options of [{noNote:true},{filterEnabled:true,filter:'금칙어'}]){const {c,state}=fixture(options);await assert.rejects(()=>c.sendNote(UID,'hi'));assert.equal(state.note,null);}
  const {c,state}=fixture();state.settings.limits.C05='1';await assert.rejects(()=>c.sendNote([UID,OTHER],'hi'),/최대 수신자/);assert.equal(state.note,null);
});

test('본인 쪽지는 myReciveFlag를 설정하고 다른 수신자와 혼합하지 않음',async()=>{
  const {c,state}=fixture();const r=await c.sendNote(OWN,'나에게');assert.equal(r.verified,true);assert.equal(state.note.myReciveFlag,'Y');
  await assert.rejects(()=>c.sendNote([UID,OWN],'hi'),/본인만/);
});

const attachmentDir=mkdtempSync(join(tmpdir(),'cbe-attachment-test-'));
after(()=>rmSync(attachmentDir,{recursive:true,force:true}));
function localFile(name,data='첨부 테스트\n'){
  const path=join(attachmentDir,name);writeFileSync(path,data);return path;
}

test('쪽지는 한글·공백·쉼표 경로의 파일을 원본 바이트로 업로드한 뒤 한 번 제출',async()=>{
  const {c,state}=fixture(),bytes=Buffer.from([0,255,13,10,128,35]),path=localFile('한글 자료,1.bin',bytes);
  const r=await c.sendNote(UID,'본문',{files:[path]});
  assert.equal(r.verified,true);assert.equal(state.note.fileCount,1);assert.equal(r.files[0].name,'한글 자료,1.bin');
  assert.deepEqual(Buffer.from(await state.uploads[0].file.arrayBuffer()),bytes);
  assert.deepEqual(state.uploads[0].fields,{uuid:OWN,type:'note',code:r.noteId,auth:'00000000000000000000000c',clientType:'pc',count:'1'});
  assert.equal(state.requests.filter(r=>r.path==='/pc/note/write').length,1);assert.equal(state.retries,0);
});

test('여러 쪽지 첨부는 같은 쪽지 ID·인증으로 업로드하고 모두 서버 검증',async()=>{
  const {c,state}=fixture();const r=await c.sendNote(UID,undefined,{files:[localFile('첫 파일.txt'),localFile('둘째 파일.txt','두 번째')]});
  assert.equal(r.text,'내용없음');assert.equal(r.title,'첫 파일.txt');assert.equal(r.files.length,2);assert.equal(state.note.fileCount,2);
  assert.ok(state.uploads.every(u=>u.fields.code===r.noteId&&u.fields.count==='2'));
  assert.equal(state.uploads[0].fields.auth,state.uploads[1].fields.auth);
});

test('대화 파일만 보내기는 F 패킷 하나와 업로드 인증 ID를 연결',async()=>{
  const {c,state}=fixture({noRoom:true});const r=await c.sendChat(UID,undefined,{files:[localFile('파일만.pdf','pdf bytes')]});
  const p=state.packets[0],u=state.uploads[0];assert.equal(r.verified,true);assert.equal(r.created,true);assert.equal(state.packets.length,1);
  assert.equal(p.NMC_CTYPE,'F');assert.equal(p.NMC_CODE,u.fields.code);assert.equal(p.NMC_MCODE,u.fields.auth);assert.equal(u.fields.scode,r.room);assert.equal(u.fields.type,'chat');
  assert.equal(p.FILENAME,'파일만.pdf');assert.equal(p.FILESIZE,u.file.size);assert.equal(p.UPLOADFILEPATH,'/mock/uploaded');assert.deepEqual(r.messageIds,[p.NMC_CODE]);
});

test('대화 본문과 여러 파일은 M,F,F 순서로 보내고 각 ID를 보존',async()=>{
  const {c,state}=fixture();const r=await c.sendChat(UID,'자료입니다',{files:[localFile('자료1.txt'),localFile('자료2.txt')]});
  assert.deepEqual(state.packets.map(p=>p.NMC_CTYPE),['M','F','F']);assert.equal(r.messageIds.length,3);assert.equal(r.files.length,2);assert.equal(r.messageId,r.messageIds[0]);
  assert.ok(state.uploads.every(u=>u.fields.count==='1'));assert.equal(state.retries,0);
});

test('새 그룹 파일 전송은 초대와 F 패킷을 분리하고 그룹 유형·수신자 유지',async()=>{
  const {c,state}=fixture({extension:true});const r=await c.createChat([UID,OTHER],undefined,{title:'자료방',files:[localFile('그룹.txt')]});
  assert.deepEqual(state.packets.map(p=>p.NMC_CTYPE),['I','F']);assert.ok(state.packets.every(p=>p.NMS_TYPE==='G'));
  assert.equal(state.packets[1].INVITE_RUIDS,undefined);assert.equal(state.packets[1].RUIDS,[UID,OTHER,OWN].join(','));assert.equal(r.verified,true);
});

test('첨부 dry-run은 로컬 파일과 제한만 검사하고 인증·업로드·방 생성은 생략',async()=>{
  for(const kind of ['note','chat']){
    const {c,state}=fixture({noRoom:true}),files=[localFile('점검.txt')];
    const r=await c[kind==='note'?'sendNote':'sendChat'](UID,undefined,{files,dryRun:true});
    assert.equal(r.sent,false);assert.equal(r.files.length,1);assert.equal(state.uploads.length,0);assert.equal(state.packets.length,0);assert.equal(state.note,null);
    assert.ok(!state.requests.some(r=>['/common/getBsonCode4Chat','/common/fileuploadConfirm','/pc/note/write'].includes(r.path)));
  }
});

test('첨부 권한·개수·크기·확장자 제한을 본문 전송 전에 차단',async()=>{
  const path=localFile('제한.bin');
  for(const change of [s=>s.fileLimits.P04='N',s=>s.fileLimits.P05='0',s=>s.fileLimits.P06='bad',s=>s.fileLimits.P06='0.000001',s=>s.limits.C19='PDF,HWP']){
    const {c,state}=fixture();change(state.settings);
    await assert.rejects(()=>c.sendChat(UID,'본문',{files:[path]}));assert.equal(state.packets.length,0);assert.equal(state.uploads.length,0);
  }
  const {c,state}=fixture();state.settings.fileLimits.P05='1';await assert.rejects(()=>c.sendNote(UID,'본문',{files:[path,localFile('다른.bin')]}),/1개/);assert.equal(state.note,null);
});

test('기존 대화방의 첨부 제한이 전역 권한보다 엄격하면 본문·파일 모두 차단',async()=>{
  const {c,state}=fixture({roomNoFiles:true});await assert.rejects(()=>c.sendChat(UID,'본문',{files:[localFile('방 권한.txt')]}),/첨부 권한/);
  assert.equal(state.uploads.length,0);assert.equal(state.packets.length,0);
});

test('존재하지 않는 파일·폴더·중복 경로는 어떤 제출도 하지 않음',async()=>{
  for(const files of [[join(attachmentDir,'missing.txt')],[attachmentDir],[localFile('중복.txt'),join(attachmentDir,'.','중복.txt')]]){
    const {c,state}=fixture();await assert.rejects(()=>c.sendNote(UID,'hi',{files}));assert.equal(state.requests.length,0);assert.equal(state.uploads.length,0);
  }
});

test('쪽지 첨부 업로드 실패는 쪽지 write를 호출하지 않고 재시도하지 않음',async()=>{
  const {c,state}=fixture({failUploadAt:2});
  await assert.rejects(()=>c.sendNote(UID,'본문',{files:[localFile('성공.txt'),localFile('실패.txt')]}),e=>e.receipt?.sent===false&&e.receipt.stage==='upload'&&e.receipt.uploadedFiles.length===1&&e.receipt.retry===false);
  assert.equal(state.note,null);assert.equal(state.uploads.length,2);assert.equal(state.retries,0);
});

test('대화 일부 전송 후 실패는 완료 ID와 실패 파일 ID를 반환하며 중복 전송하지 않음',async()=>{
  const {c,state}=fixture({failUploadAt:2});
  await assert.rejects(()=>c.sendChat(UID,'본문',{files:[localFile('부분1.txt'),localFile('부분2.txt')]}),e=>e.receipt?.sent===null&&e.receipt.partial===true&&e.receipt.messageIds.length===2&&e.receipt.files.length===1&&!!e.receipt.pendingFile.messageId&&e.receipt.retry===false);
  assert.equal(state.packets.length,2);assert.equal(state.uploads.length,2);assert.equal(state.retries,0);
});

test('서버 파일명·용량 불일치는 쪽지·대화 성공으로 보고하지 않음',async()=>{
  for(const method of ['sendNote','sendChat']){
    const {c,state}=fixture({wrongFile:true});await assert.rejects(()=>c[method](UID,undefined,{files:[localFile('대조.txt')]}),e=>e.receipt?.verified===false&&e.receipt.retry===false);
    assert.equal(state.uploads.length,1);
  }
});

test('점검 후 변경된 파일·예상 외 파일 서버는 업로드 전에 차단하고 임시 바이트 제거',async()=>{
  for(const badServer of [false,true]){
    const {c,state,context}=fixture({badFileServer:badServer}),path=localFile('변경.txt'),original=c.uploadFile.bind(c);
    c.uploadFile=async(file,...args)=>{if(!badServer)writeFileSync(path,'변경한 내용');return original(file,...args);};
    await assert.rejects(()=>c.sendNote(UID,'본문',{files:[path]}));assert.equal(state.uploads.length,0);assert.equal(state.note,null);assert.equal(Object.keys(context.window).some(k=>k.startsWith('__cbeCliUpload_')),false);
  }
});

test('큰 바이너리는 여러 CDP 청크를 거쳐도 원본 바이트와 일치하고 빈 파일도 지원',async()=>{
  const bytes=Buffer.alloc(400000);for(let i=0;i<bytes.length;i++)bytes[i]=i%256;
  const {c,state}=fixture();await c.sendNote(UID,'본문',{files:[localFile('청크.bin',bytes),localFile('빈 파일.txt','')]});
  assert.deepEqual(Buffer.from(await state.uploads[0].file.arrayBuffer()),bytes);assert.equal(state.uploads[1].file.size,0);
});

test('CLI는 반복 --file과 본문 없는 첨부를 전달하고 조회 명령의 --file은 거절',async()=>{
  const original=Messenger.connect,log=console.log,{c,state}=fixture();c.close=()=>{};
  Messenger.connect=async()=>c;console.log=()=>{};
  try{
    await run(['notes','send','--to',UID,'--file',localFile('CLI 1.txt'),'--file',localFile('CLI 2.txt'),'--dry-run','--json']);
    assert.equal(state.uploads.length,0);await assert.rejects(()=>run(['notes','list','--file','unused']),/전송 명령/);
  }finally{Messenger.connect=original;console.log=log;}
});

function downloadFixture(options={}){
  const c=new Messenger(),state={urls:[],account:OWN,queries:[]},fileId='aaaaaaaaaaaaaaaaaaaaaaaa';
  const files=options.files??[{NNF_CODE:fileId,NNF_NCODE:UID,NNF_ORI_NAME:'한글 자료,1.hwp',NNF_FILE_SIZE:'69 KB',NNF_FILEURL:'/upload/note/mock.hwp',VALID_YN:'Y',VALID_DATE:'20270622235900000',DELETE_YN:'N'}];
  c.query=async(path,params)=>{state.queries.push({path,params});return {RESULT:'SUCCESS',LIST:{NTE_CODE:UID,ATTACH_IMAGE:files,...options.note}};};
  class MockDownloadXHR {
    open(method,url,async){assert.equal(method,'GET');assert.equal(async,true);state.urls.push(url);}
    getResponseHeader(name){return name==='Content-Type'?(options.contentType??'application/octet-stream'):name==='Content-Length'?(options.noLength?null:String(options.length??this.response.byteLength)):null;}
    send(){
      if(options.networkError||options.failAt===state.urls.length){this.onerror();return;}
      const bytes=options.bytes??Buffer.from([0,255,128,13,10,32]);
      this.response=options.oversize?{byteLength:256*1024*1024+1}:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
      this.status=options.status??200;if(options.changedAccount)state.account=OTHER;this.onload();
    }
    abort(){this.onabort?.();}
  }
  const context=vm.createContext({window:{},XMLHttpRequest:MockDownloadXHR,Uint8Array,btoa,
    Base64:{encode:text=>Buffer.from(text,'utf8').toString('base64')},
    common_activityData:{getData:key=>({nurUuid:state.account,permission:{PC:{P07:options.allowed??'Y'}},fileServerUrl:options.server??'http://stmsg.cbe.go.kr:7880/file/v2/mockSession'}[key])},
    common_controller:{getTodayString:()=> '20261029150000000'},
  });
  c.evaluate=async expression=>vm.runInContext(expression,context);
  return {c,state,context,files,fileId};
}
function downloadDir(){return mkdtempSync(join(attachmentDir,'download-'));}

test('쪽지 첨부는 로그인된 앱에서 GET하고 한글 파일명·바이트·해시를 검증',async()=>{
  const {c,state,context}=downloadFixture(),outDir=downloadDir();
  const result=await c.downloadNote(UID,{outDir});
  assert.equal(result.downloaded,true);assert.equal(result.verified,true);assert.equal(result.files.length,1);
  const file=result.files[0],bytes=Buffer.from([0,255,128,13,10,32]);
  assert.deepEqual(readFileSync(file.path),bytes);assert.equal(file.sha256,createHash('sha256').update(bytes).digest('hex'));
  assert.equal(file.size,6);assert.equal(file.contentLength,6);
  assert.equal(state.urls[0].split('/').at(-1),Buffer.from('한글 자료,1.hwp').toString('base64').replaceAll('/','*').replaceAll('+','@'));
  assert.ok(!JSON.stringify(result).includes('mockSession'));assert.equal(Object.keys(context.window).length,0);
  assert.deepEqual(state.queries[0].params,{nteCode:UID,nteReservYn:'N',activeWindow:'false',noteType:'R'});
});
test('특정 첨부 선택과 보낸·예약 쪽지 옵션을 유지하고 없는 ID는 다운로드하지 않음',async()=>{
  const {c,state,files}=downloadFixture();
  await c.downloadNote(UID,{outDir:downloadDir(),type:'S',reserved:true,attachmentId:files[0].NNF_CODE});
  assert.equal(state.queries[0].params.noteType,'S');assert.equal(state.queries[0].params.nteReservYn,'Y');
  await assert.rejects(()=>c.downloadNote(UID,{outDir:downloadDir(),attachmentId:OTHER}),/해당 첨부파일/);assert.equal(state.urls.length,1);
});
test('기존 파일과 중복 파일명은 다운로드 전 거절하고 덮어쓰지 않음',async()=>{
  const {c,state,files}=downloadFixture(),outDir=downloadDir();writeFileSync(join(outDir,files[0].NNF_ORI_NAME),'원본');
  await assert.rejects(()=>c.downloadNote(UID,{outDir}),/덮어쓰지/);assert.equal(readFileSync(join(outDir,files[0].NNF_ORI_NAME),'utf8'),'원본');assert.equal(state.urls.length,0);
  const duplicate=downloadFixture({files:[files[0],{...files[0],NNF_CODE:OTHER}]});
  await assert.rejects(()=>duplicate.c.downloadNote(UID,{outDir:downloadDir()}),/중복/);assert.equal(duplicate.state.urls.length,0);
});
test('보안·회수·만료·삭제·다른 쪽지 소속 첨부는 다운로드하지 않음',async()=>{
  for(const note of [{NTE_SECURITY_YN:'Y'},{NTE_WITHDRAW_YN:'Y'},{NTE_CODE:OTHER}]){
    const {c,state}=downloadFixture({note});await assert.rejects(()=>c.downloadNote(UID,{outDir:downloadDir()}));assert.equal(state.urls.length,0);
  }
  const base=downloadFixture().files[0];
  for(const patch of [{VALID_YN:'N'},{VALID_DATE:'20250101000000000'},{DELETE_YN:'Y'},{NNF_NCODE:OTHER},{NNF_FILEURL:'/upload/note/../secret'},{NNF_FILEURL:'http://evil.invalid/file'},{NNF_ORI_NAME:'..\\secret.hwp'},{NNF_ORI_NAME:'CON.hwp'},{NNF_ORI_NAME:'file.hwp:stream'},{NNF_ORI_NAME:'file.hwp.'}]){
    const {c,state}=downloadFixture({files:[{...base,...patch}]});await assert.rejects(()=>c.downloadNote(UID,{outDir:downloadDir()}));assert.equal(state.urls.length,0);
  }
});
test('다운로드 권한·파일 서버·로그인 계정 변경을 확인하고 임시 파일을 정리',async()=>{
  for(const options of [{allowed:'N'},{server:'http://stmsg.cbe.go.kr.evil/file/v2/token'},{changedAccount:true}]){
    const {c,context}=downloadFixture(options),outDir=downloadDir();await assert.rejects(()=>c.downloadNote(UID,{outDir}));assert.deepEqual(readdirSync(outDir),[]);assert.equal(Object.keys(context.window).length,0);
  }
});
test('HTTP 오류·오류 페이지·크기 불일치·용량 초과는 성공 파일을 남기지 않음',async()=>{
  for(const options of [{status:403},{contentType:'text/html'},{contentType:'application/json'},{length:999},{networkError:true},{oversize:true}]){
    const {c,context}=downloadFixture(options),outDir=downloadDir();await assert.rejects(()=>c.downloadNote(UID,{outDir}));assert.deepEqual(readdirSync(outDir),[]);assert.equal(Object.keys(context.window).length,0);
  }
});
test('여러 다운로드와 청크 바이너리·빈 파일은 정확히 저장하고 부분 실패 정보를 보존',async()=>{
  const bytes=Buffer.alloc(400000);for(let i=0;i<bytes.length;i++)bytes[i]=i%256;
  for(const content of [bytes,Buffer.alloc(0)]){
    const {c}=downloadFixture({bytes:content,noLength:true}),r=await c.downloadNote(UID,{outDir:downloadDir()});assert.deepEqual(readFileSync(r.files[0].path),content);assert.equal(r.files[0].contentLength,null);
  }
  const base=downloadFixture().files[0],{c}=downloadFixture({files:[base,{...base,NNF_CODE:OTHER,NNF_ORI_NAME:'두 번째.hwp'}],failAt:2}),outDir=downloadDir();
  await assert.rejects(()=>c.downloadNote(UID,{outDir}),e=>e.receipt.partial===true&&e.receipt.files.length===1&&e.receipt.retry===false);
  assert.deepEqual(readdirSync(outDir),[base.NNF_ORI_NAME]);
});
test('CLI 다운로드 인자를 연결 전에 검사하고 검증된 저장 결과만 출력',async()=>{
  const original=Messenger.connect,log=console.log;let connected=0;
  Messenger.connect=async()=>{connected++;throw Error('must not connect');};
  try{
    for(const args of [['notes','download',UID],['notes','list','--out-dir','unused'],['notes','download',UID,'--out-dir','unused','--attachment','bad'],['notes','download',UID,'extra','--out-dir','unused']])await assert.rejects(()=>run(args));
    assert.equal(connected,0);
    const {c}=downloadFixture();c.close=()=>{};Messenger.connect=async()=>c;console.log=()=>{};
    await run(['notes','download',UID,'--out-dir',downloadDir(),'--json']);
  }finally{Messenger.connect=original;console.log=log;}
});
