import test from 'node:test';
import assert from 'node:assert/strict';
import { selectTarget, socketUrl, plain, Messenger } from './messenger.mjs';
import {positive} from './cli.mjs';
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
  const c=new Messenger(),state={requests:[],packets:[],note:null,retries:0,sequence:10,settings:{userId:OWN,name:'본인',offline:false,socket:true,limits:{C04:'100',C05:'100'}}};
  const $=selector=>({val:()=>selector.includes('ContextRoot')?'/ezmaru':''});
  const originalAjax=$.ajax=function(o){
    const path=o.url.replace('/ezmaru',''),p=o.data.nativeEncrypted;
    state.requests.push({path,params:structuredClone(p)});
    if(options.failWrite&&path==='/pc/note/write'){o.error({status:504},'timeout');return;}
    let data;
    if(path==='/message/chatlist1vs1')data={SCODE:options.noRoom?'':ROOM,NMS_TYPE:'C',RUIDS:UID+','+OWN};
    else if(path==='/pc/message/newchatlist'){
      const packet=state.packets.at(-1);
      data={CHAT_INFO:{NMS_SCODE:p.scode,NMS_TYPE:packet.NMS_TYPE},USER_OFFSET_LIST:(options.wrongMembers?[UID,OTHER]:packet.RUIDS.split(',')).map(NMU_UID=>({NMU_UID})),LIST:[structuredClone(packet)]};
    }else if(path==='/common/checkcharfilter')data={DATA:options.filter||''};
    else if(path==='/pc/note/sendtotalusercount')data={TOTAL_USER_COUNT:p.ruids.split(':‡:').length,NOT_SAME_WITHGROUP_USER_CNT:options.threshold??20,USER_LIST:p.ruids.split(':‡:').map(NUR_UUID=>({NUR_UUID}))};
    else if(path==='/pc/note/write'){
      state.note=structuredClone(p);data={LIST:{NTE_CODE:p.nteCode}};
    }else if(path==='/pc/note/noteDetail')data={LIST:{NTE_CODE:state.note.nteCode,NUR_UUID:OWN,NTE_CONTENT:state.note.nteContent,NTE_TITLE:state.note.nteTitle,NTE_REGDATE:'20261015'}};
    else if(path==='/pc/note/getAllReceiveUserForNote')data={LIST:(options.wrongNoteRecipient?[OTHER]:state.note.ruids.split(':‡:')).map(NRU_UID=>({NRU_UID}))};
    else throw Error('Unexpected mock route '+path);
    o.success({nativeResponse:{RESULT:options.rejectWrite&&path==='/pc/note/write'?'FAIL':'SUCCESS',...data}});
  };
  const context=vm.createContext({window:{},$,JSON,Error,DOMParser:undefined,
    ObjectId:function(){const id=(++state.sequence).toString(16).padStart(24,'0');this.toString=()=>id;},
    common_activityData:{getData:key=>({nurUuid:state.settings.userId,nurNic:state.settings.name,subStatus:state.settings.offline?'FAKEOFF':'ON',permission:{COM:state.settings.limits}}[key])},
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
