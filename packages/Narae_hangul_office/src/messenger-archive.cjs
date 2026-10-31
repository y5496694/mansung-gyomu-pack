'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const tool={type:'function',name:'gyomu_cbe_archive',description:'쪽지와 대화를 페이지 끝까지 탐색해 기간·검색어에 맞는 원문 근거를 로컬 보고서에 저장한다. complete:false 또는 미확인 항목이 있으면 전체 확인 완료가 아니다. 대화 검색어는 방 이름 필터가 아니라 메시지 본문에 적용한다.',parameters:{type:'object',properties:{operation:{enum:['scan','read']},from:{type:'string'},to:{type:'string'},kinds:{type:'array',items:{enum:['note','chat']},minItems:1},box:{enum:['received','sent','unread','all']},query:{type:'string'},submissionOnly:{type:'boolean'},report:{type:'string'},offset:{type:'integer',minimum:0},pageBudget:{type:'integer',minimum:1,maximum:2000}},required:['operation'],additionalProperties:false}};
const date=value=>{const s=String(value||'').trim(),m=s.match(/^(20\d{2})[-./]?(\d{2})[-./]?(\d{2})/);if(!m)return null;const d=m.slice(1).join('-');return Number.isNaN(Date.parse(d+'T00:00:00Z'))?null:d;};
const submission=/제출|회신|신청|보고서|취합|마감|기한|수합|명단|계획서|결과보고/;
function archiveTask(prompt,now=new Date()){
 if(!/쪽지|대화|소통|CBE/i.test(prompt)||/보내|전송|발송/.test(prompt)||!/개월|탐색|검색|찾아|찾고|찾아서|제출할/.test(prompt))return null;
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now),dates=[...prompt.matchAll(/20\d{2}-\d{2}-\d{2}/g)].map(m=>m[0]);
 let from=dates[0];if(!from){const months=Number(prompt.match(/(\d+)\s*개월/)?.[1]||6),d=new Date(today+'T00:00:00Z'),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-months);const end=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,end));from=d.toISOString().slice(0,10);}
 const query=prompt.match(/(?:검색어|내용|주제)(?:는|은|[:：])?\s*["“]([^"”]+)["”]/)?.[1]||prompt.match(/["“]([^"”]+)["”]/)?.[1]||'';
 return {from,to:dates[1]||today,kinds:/쪽지/.test(prompt)&&/대화/.test(prompt)||/소통|CBE/i.test(prompt)&&!/쪽지|대화/.test(prompt)?['note','chat']:[/쪽지/.test(prompt)?'note':'chat'],box:/보낸/.test(prompt)?'sent':/받은/.test(prompt)?'received':'all',query,submissionOnly:/제출할|제출.*리스트|제출.*목록/.test(prompt)};
}
async function scan(args,{call,directory,signal,notify=()=>{}}){
 if(!date(args.from)||!date(args.to)||args.from>args.to)throw new Error('실제 조회 시작일·종료일을 YYYY-MM-DD로 지정하세요.');
 const result={schema:1,id:crypto.randomUUID(),createdAt:new Date().toISOString(),scope:{from:args.from,to:args.to,kinds:args.kinds||['note','chat'],box:args.box||'all',query:args.query||'',submissionOnly:args.submissionOnly===true,attachments:'본문 탐색. 첨부 내용은 별도 확인 대상'},complete:true,pages:[],unconfirmed:[],records:[],matches:[]},budget=args.pageBudget||1000;let pages=0;
 const fault=(source,error)=>{result.complete=false;result.unconfirmed.push({source,error:String(error).slice(0,250)});};
 const query=async argv=>{if(signal?.aborted)throw new Error('탐색을 중단했습니다.');return call(argv,signal);};
 async function walk(source,argv,handle,{anchored=false}={}){
  let anchor='0',page=1;const seen=new Set(),seenIds=new Set();
  for(;;){
   if(++pages>budget){fault(source,'페이지 예산에 도달했습니다. 전체 확인 미완료');return;}
   let value;try{value=await query([...argv,'--page',String(page),'--limit','100',...(anchored?['--offset',String(anchor)]:[])]);}catch(e){fault(source,e.message);return;}
   if(value?.error||!Array.isArray(value?.items)){fault(source,value?.error||'목록 응답 없음');return;}
   const items=value.items,ids=items.map(i=>i.id?(source==='notes'?String(i.type||'R')+':':'')+String(i.id):''),signature=JSON.stringify(ids);
   result.pages.push({source,page,count:items.length,total:value.total??null,ids});notify({source,page,count:items.length});
   if(items.length&&(!ids.every(Boolean)||new Set(ids).size!==ids.length||seen.has(signature)||ids.some(id=>seenIds.has(id)))){fault(source,'중복 페이지·항목 또는 식별자 누락. 페이지 전체성을 확인할 수 없음');return;}seen.add(signature);ids.forEach(id=>seenIds.add(id));
   if(anchored&&page===1){anchor=value.offset;if(items.length&&!anchor){fault(source,'첫 페이지 날짜 기준점 없음');return;}}
   await handle(items);
   if(!items.length||items.length<100)return;
   // Unknown totals are normal. A short/empty last page is required; never
   // trust a total alone while the server list may change.
   page++;
  }
 }
 const retain=(record)=>{
  const day=date(record.date);if(!day){fault(record.source+':'+record.id,'작성일자 확인 불가');return;}
  if(day<args.from||day>args.to)return;
  if(/^\[(?:보안|회수|삭제)/.test(record.text||'')){fault(record.source+':'+record.id,'보안·회수·삭제 본문 미확인');return;}
  result.records.push(record);
  const text=String(record.title||'')+'\n'+String(record.text||'');
  if((!args.query||text.toLocaleLowerCase().includes(args.query.toLocaleLowerCase()))&&(!args.submissionOnly||submission.test(text)))result.matches.push(record);
 };
 try{
  if(result.scope.kinds.includes('note'))await walk('notes',['notes','list','--box',result.scope.box],async items=>{
   for(const n of items){const d=date(n.date);if(d&&(d<args.from||d>args.to))continue;let full;try{full=await query(['notes','read',n.id,'--type',result.scope.box==='sent'||n.type==='S'?'S':'R']);}catch(e){fault('note:'+n.id,e.message);continue;}if(full?.error)fault('note:'+n.id,full.error);else retain({...full,id:n.id,source:'note',date:full.date||n.date});}
  },{anchored:true});
  if(result.scope.kinds.includes('chat'))await walk('rooms',['chats','list'],async rooms=>{
   for(const room of rooms)await walk('chat:'+room.id,['chats','read',room.id],async items=>{for(const m of items)retain({...m,source:'chat',roomId:room.id,title:room.title||room.id});});
  });
 }catch(e){fault('scan',e.message);}
 // Keep private source evidence out of model prompts and public repositories.
 fs.mkdirSync(directory,{recursive:true});const file=path.join(directory,result.id+'.json');fs.writeFileSync(file,JSON.stringify(result,null,2),{flag:'wx'});
 return read(file,{offset:0});
}
function read(file,{offset=0}={}){
 const value=JSON.parse(fs.readFileSync(file,'utf8')),items=value.matches.slice(offset,offset+20).map(r=>({...r,text:String(r.text||'').slice(0,1600),excerpted:String(r.text||'').length>1600}));
 return {report:file,complete:value.complete,scope:value.scope,totalMatches:value.matches.length,recordsRead:value.records.length,pages:value.pages.length,unconfirmed:value.unconfirmed,items,offset,nextOffset:offset+items.length,hasMore:offset+items.length<value.matches.length};
}
function render(pages){
 const first=pages[0],items=pages.flatMap(p=>p.items||[]),lines=[`탐색 기간: ${first.scope.from}~${first.scope.to} · 본문 ${first.recordsRead}건 · 목록 ${first.pages}페이지`,`전체성: ${first.complete?'조회한 목록의 마지막 페이지까지 확인':'미완료'} · 일치 후보 ${first.totalMatches}건`];
 for(const [i,r]of items.entries())lines.push(`\n${i+1}. ${r.title||'(제목 없음)'} · ${r.date||'시각 미확인'} · ${r.sender||'발신자 미확인'}\n${r.source==='chat'?'대화 '+r.roomId:'쪽지'} / 근거 ID ${r.id}\n${r.text}${r.excerpted?'\n[긴 원문 발췌. 보고서에서 전체 확인 필요]':''}`);
 if(first.unconfirmed.length)lines.push('\n미확인: '+first.unconfirmed.map(u=>u.source+' — '+u.error).join('\n'));
 lines.push('\n제출·회신 후보이며 실제 제출 완료 여부는 별도 확인해야 합니다. 취소·변경·이미 제출한 안내도 원문대로 표시합니다. 첨부 내용은 별도 확인 대상입니다.\n전체 원문·조회 근거: '+first.report);return lines.join('\n');
}
module.exports={tool,archiveTask,scan,read,render,date};
