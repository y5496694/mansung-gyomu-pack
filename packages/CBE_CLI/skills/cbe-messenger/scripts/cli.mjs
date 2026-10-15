#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { Messenger } from './messenger.mjs';

const HELP=`충북소통메신저 CLI 0.5.0 — 로그인된 앱에 연결

사용법:
  cbe status
  cbe notes list [--box received|sent|unread|important|self|reserved|all]
                 [--search "검색어"] [--search-type send|receive|title|content]
  cbe notes read <쪽지ID> [--type R|S] [--reserved]
  cbe notes send --to <사용자ID[,사용자ID...]> [--text "내용"] [--title "제목"] [--file "경로"]
  cbe chats list [--search "참여자 또는 방 이름"]
  cbe chats read <대화방ID>
  cbe chats send --to <사용자ID> [--text "내용"] [--file "경로"]
  cbe chats create --to <사용자ID[,사용자ID...]> [--text "첫 메시지"] [--title "그룹 제목"] [--file "경로"]
  cbe users search "이름" [--scope auto|my|all]
  cbe users show <사용자ID>
  cbe memos list [--search "검색어"]
  cbe open main
  cbe open note <쪽지ID> [--type R|S] [--reserved]
  cbe open chat <대화방ID>
  cbe open profile <사용자ID>
  cbe compose --to <사용자ID>

공통 옵션:
  --json          정규화된 JSON 출력 (오류는 stderr JSON)
  --page N        페이지 번호, 기본 1
  --limit N       페이지당 개수, 기본 30, 최대 100
  --offset N      서버 조회 기준값, 기본 0
  --scope 범위    이름 검색 범위, 기본 auto (내 조직 우선, 없으면 전체 조직)
  --port N        로컬 디버깅 포트, 기본 9000
  --dry-run       전송 명령의 수신자·설정만 확인 (실제 전송·방 생성 없음)
  --confirm-many  앱에서 추가 수신자 확인이 필요한 쪽지 전송 허용
  --file 경로     첨부할 로컬 파일 (여러 파일은 --file을 반복, 본문 생략 가능)
  --help          도움말

앱을 실행하고 로그인해 두세요. 비밀번호·키를 파일에 저장하지 않습니다.
목록은 서버가 제공한 한 페이지입니다. total:null은 전체 건수를 알 수 없다는 뜻입니다.
chats read는 최신 메시지부터 반환하며 긴 내용은 서버에서 500자로 제한될 수 있습니다.
open은 앱의 일반 열기 동작으로 읽음 처리될 수 있습니다.
compose는 수신자를 지정한 작성창만 엽니다. 실제 전송은 앱에서 합니다.
chats send는 기존 1:1 방을 사용하고, 없으면 첫 메시지와 함께 새 방을 만듭니다.
chats create는 1명이면 1:1, 2명 이상이면 새 그룹을 만들며 본인을 자동 포함합니다.
쪽지·대화에 --file로 파일을 첨부합니다. 대화 본문과 파일은 각각 별도 메시지로 전송됩니다.
--dry-run은 파일 읽기·권한·개수·용량을 점검하고 업로드하지 않습니다. 예약·보안 전송은 미지원입니다.
`;

export function positive(value,name,max=Number.MAX_SAFE_INTEGER) {
  if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<1||Number(value)>max)throw new Error(`${name}: 1~${max} 사이 정수를 입력하세요.`);
  return Number(value);
}
function requiredId(value){if(!value||!/^[-A-Za-z0-9_]{1,128}$/.test(value))throw new Error('목록에서 확인한 유효한 ID를 입력하세요.');return value;}
function clean(value){return String(value??'').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g,'');}

export function printResult(result,json) {
  if(json){console.log(JSON.stringify(result,null,2));return;}
  if(result.dryRun){console.log(clean(JSON.stringify(result,null,2)));return;}
  if(result.sent===true){console.log(clean(`서버 기록 확인 완료 · ${result.noteId?'쪽지':'대화'} ID: ${result.noteId||result.messageId}\n${result.room?'방 ID: '+result.room+'\n':''}수신자: ${result.recipients.map(u=>u.name+' ('+u.id+')').join(', ')}\n\n${result.text}`));for(const file of result.files||[])console.log(clean(`첨부: ${file.name} (${file.size} bytes)`));return;}
  if(result.items){
    if(result.scope)console.log(`검색 범위: ${result.scope==='my'?'내 조직':'전체 조직'}${result.fallback?' (내 조직에 일치하는 이름 없음)':''}`);
    console.log(`페이지 ${result.page} · ${result.items.length}개${result.total===null?'':` · 전체 ${result.total}개`}`);
    if(result.title)console.log(clean(result.title));
    for(const r of result.items){
      console.log(clean(`${r.id||''}  ${r.date||''}  ${r.title||r.name||r.sender||''}${r.type?` [${r.type}]`:''}`));
      const metadata=[r.sender&&r.title?`보낸 사람: ${r.sender}`:'',r.department,r.position,r.phone,r.email].filter(Boolean);
      if(metadata.length)console.log(clean('  '+metadata.join(' · ')));
      if(r.preview||r.text)console.log(clean('  '+String(r.preview||r.text).replace(/\n/g,'\n  ')));
      if(r.attachment)console.log(clean(`  첨부: ${r.attachment.name} (${r.attachment.size} bytes)`));
    }
    return;
  }
  if(result.text!==undefined){
    console.log(clean(`${result.title||'(제목 없음)'}\nID: ${result.id}\n보낸 사람: ${result.sender||''}\n날짜: ${result.date||''}\n\n${result.text}`));
    for(const file of result.files||[])console.log(clean(`첨부: ${file.name} (${file.size} bytes)`));
    return;
  }
  console.log(clean(JSON.stringify(result,null,2)));
}

export async function run(argv=process.argv.slice(2)) {
  const {values:v,positionals:p}=parseArgs({args:argv,allowPositionals:true,strict:true,options:{help:{type:'boolean',short:'h'},json:{type:'boolean'},port:{type:'string',default:'9000'},page:{type:'string',default:'1'},limit:{type:'string',default:'30'},offset:{type:'string',default:'0'},search:{type:'string',default:''},'search-type':{type:'string',default:'send'},box:{type:'string',default:'all'},type:{type:'string',default:'R'},reserved:{type:'boolean'},to:{type:'string'},text:{type:'string'},title:{type:'string'},file:{type:'string',multiple:true,default:[]},'dry-run':{type:'boolean'},'confirm-many':{type:'boolean'},scope:{type:'string',default:'auto'}}});
  if(v.help||!p.length){console.log(HELP);return;}
  const options={page:positive(v.page,'--page'),limit:positive(v.limit,'--limit',100),search:v.search,offset:v.offset};
  const port=positive(v.port,'--port',65535);
  if(!/^\d{1,20}$/.test(v.offset))throw new Error('--offset은 0 이상의 숫자여야 합니다.');
  if(!['R','S'].includes(v.type))throw new Error('--type은 R(받은 쪽지) 또는 S(보낸 쪽지)입니다.');
  if(!['send','receive','title','content'].includes(v['search-type']))throw new Error('--search-type은 send, receive, title, content 중 하나입니다.');
  if(!['auto','my','all'].includes(v.scope))throw new Error('--scope는 auto, my, all 중 하나입니다.');
  const group=p[0],action=p[1]||'list';
  const idCommands=(group==='open'&&action!=='main')||(['notes','chats'].includes(group)&&action==='read')||(group==='users'&&action==='show');
  if(idCommands)requiredId(p[2]);
  if(group==='compose')requiredId(v.to);
  const sending=['notes','chats'].includes(group)&&['send','create'].includes(action);
  if(sending){if(!v.to||v.to.split(',').some(id=>! /^[a-f0-9]{24}$/i.test(id.trim())))throw new Error('--to에 조회한 사용자 ID를 입력하세요.');if(!v.text?.trim()&&!v.file.length)throw new Error('--text에 내용 또는 --file에 첨부파일을 입력하세요.');}
  if((v['dry-run']||v['confirm-many']||v.title!==undefined||v.file.length)&&!sending)throw new Error('--dry-run, --confirm-many, --title, --file은 전송 명령에서만 사용하세요.');
  if(v['confirm-many']&&!(group==='notes'&&action==='send'))throw new Error('--confirm-many는 notes send에서만 사용하세요.');
  if(group==='users'&&action==='search'&&!p[2]?.trim())throw new Error('사용자 검색어를 입력하세요.');
  const valid=(group==='status'&&p.length===1)||(['notes','chats'].includes(group)&&['list','read'].includes(action))||(['notes','chats'].includes(group)&&action==='send'&&p.length===2)||(group==='chats'&&action==='create'&&p.length===2)||(group==='users'&&['search','show'].includes(action))||(group==='memos'&&action==='list')||(group==='open'&&['main','note','chat','profile'].includes(action))||(group==='compose'&&p.length===1);
  if(!valid)throw new Error('지원하지 않는 명령입니다. cbe --help를 확인하세요.');
  const boxes={all:'ALL',received:'R',sent:'S',unread:'N',important:'I',self:'M',reserved:'B'};
  if(group==='notes'&&action==='list'&&!(v.box in boxes))throw new Error('지원하지 않는 --box 값입니다.');
  if(group==='chats'&&action==='list'&&!['all','unread','important'].includes(v.box))throw new Error('대화방 --box는 all, unread, important를 지원합니다.');
  const client=await Messenger.connect(port);
  try{
    let result;
    if(group==='status')result=await client.status();
    else if(group==='notes'&&action==='list')result=await client.notes({...options,box:boxes[v.box],searchType:v['search-type']});
    else if(group==='notes'&&action==='send')result=await client.sendNote(v.to,v.text,{title:v.title,dryRun:!!v['dry-run'],confirmMany:!!v['confirm-many'],files:v.file});
    else if(group==='notes')result=await client.note(p[2],v.type,!!v.reserved);
    else if(group==='chats'&&action==='list')result=await client.chats({...options,box:boxes[v.box]});
    else if(group==='chats'&&['send','create'].includes(action))result=await client[action==='send'?'sendChat':'createChat'](v.to,v.text,{title:v.title,dryRun:!!v['dry-run'],files:v.file});
    else if(group==='chats'){
      if(!Number.isSafeInteger(Number(v.offset)))throw new Error('대화 offset이 너무 큽니다.');
      result=await client.messages(p[2],{...options,offset:Number(v.offset)});
    }
    else if(group==='users'&&action==='search')result=await client.users(p[2],{...options,scope:v.scope});
    else if(group==='users')result=await client.user(p[2]);
    else if(group==='memos')result=await client.memos(options);
    else if(group==='open')result=await client.open(action,p[2],v.type,!!v.reserved);
    else if(group==='compose')result=await client.compose(v.to);
    printResult(result,!!v.json);
  }finally{client.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(resolve(process.argv[1]))).href){
  run().catch(error=>{console.error(process.argv.includes('--json')?JSON.stringify({error:error.message,...error.receipt}):`오류: ${error.message}${error.receipt?.room?' · 방 ID: '+error.receipt.room:''}`);process.exitCode=1;});
}
