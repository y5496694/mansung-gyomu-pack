'use strict';
// Self-hosted official Kakao Channel relay. No office credentials, shell or inbound PC ports.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {randomBytes,createHash,timingSafeEqual}=require('node:crypto');
const id=()=>randomBytes(16).toString('hex'),hash=s=>createHash('sha256').update(s).digest('hex');
const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb);};
const terminal=new Set(['completed','failed','cancelled','unknown']);
function pagesOf(text){const pages=[];let page='';for(const char of text){if(page.length+char.length>880){pages.push(page);page='';}page+=char;}pages.push(page);return pages;}
const textReply=(text,buttons=[])=>({version:'2.0',template:{outputs:[{simpleText:{text:text.slice(0,1000)}}],quickReplies:buttons.map(([label,messageText])=>({label,action:'message',messageText}))}});
function fail(status,code){const error=new Error(code);error.status=status;throw error;}
class KakaoRelay{
 constructor({file,secret,botId='',clock=Date.now,fetchImpl=fetch,callbackSeconds=290}={}){
  if(!secret||secret.length<24)throw new Error('A private skill secret of at least 24 characters is required');
  this.file=file;this.secret=secret;this.botId=botId;this.clock=clock;this.fetch=fetchImpl;this.callbackSeconds=callbackSeconds;this.callbacks=new Map();this.rates=new Map();
  this.data={version:1,users:{},devices:{},jobs:{},dedupe:{}};
  if(file&&fs.existsSync(file))this.data=JSON.parse(fs.readFileSync(file,'utf8'));
  for(const job of Object.values(this.data.jobs))if(!terminal.has(job.state)){job.state='unknown';job.error='RELAY_RESTART_UNCERTAIN';}
  this.save();this.server=http.createServer((req,res)=>this.handle(req,res));this.server.requestTimeout=15000;this.server.headersTimeout=15000;
  this.timer=setInterval(()=>this.expire(),1000);this.timer.unref();
 }
 save(){if(!this.file)return;fs.mkdirSync(path.dirname(this.file),{recursive:true});const tmp=this.file+'.'+id()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.data),{mode:0o600});fs.renameSync(tmp,this.file);}
 expire(){let changed=false;const now=this.clock();for(const [key,value]of this.callbacks)if(value.expires<=now)this.callbacks.delete(key);
  for(const d of Object.values(this.data.devices))if(['pending','confirmed'].includes(d.state)&&d.expires<=now){d.state='expired';changed=true;}
  for(const j of Object.values(this.data.jobs))if(!terminal.has(j.state)&&((j.state==='queued'&&now-j.created>20000)||(j.state==='running'&&now-j.heartbeat>45000))){j.state='unknown';j.error='PC_CONNECTION_UNCERTAIN';this.callbacks.delete(j.id);changed=true;}
  for(const [key,cb]of this.callbacks){const job=this.data.jobs[key];if(job&&cb.expires-now<=20000)void this.deliver(job);}
  for(const [key,item]of Object.entries(this.data.dedupe))if(now-item.created>86400000){delete this.data.dedupe[key];changed=true;}
  for(const [key,job]of Object.entries(this.data.jobs))if(terminal.has(job.state)&&now-job.created>7*86400000){delete this.data.jobs[key];this.callbacks.delete(key);changed=true;}
  for(const d of Object.values(this.data.devices))if(d.conversation&&now-d.conversation.updated>7*86400000){delete d.conversation;changed=true;}
  for(const [key,times]of this.rates)if(times.every(time=>now-time>60000))this.rates.delete(key);
  if(changed)this.save();
 }
 limit(ip){const now=this.clock(),items=(this.rates.get(ip)||[]).filter(t=>now-t<60000);if(items.length>=90||(!this.rates.has(ip)&&this.rates.size>=2048))fail(429,'RATE_LIMIT');items.push(now);this.rates.set(ip,items);}
 user(bot,sender,create=false){const identity=hash(bot+'\0'+sender);let u=Object.values(this.data.users).find(u=>u.identity===identity);if(!u&&create){if(Object.keys(this.data.users).length>=50000)fail(503,'CAPACITY');u={uid:'NR-'+randomBytes(8).toString('hex').toUpperCase(),identity};this.data.users[u.uid]=u;this.save();}return u;}
 device(req){const token=(req.headers.authorization||'').replace(/^Bearer /,'');const d=Object.values(this.data.devices).find(d=>equal(d.tokenHash,hash(token)));if(!token||!d||['revoked','expired'].includes(d.state))fail(401,'DEVICE_AUTH');return d;}
 publicDevice(d){return {id:d.id,uid:d.uid,name:d.name,state:d.state,expires:d.expires,lastSeen:d.lastSeen||0};}
 revoke(d){delete d.conversation;d.state='revoked';d.tokenHash='';d.codeHash='';for(const j of Object.values(this.data.jobs))if(j.device===d.id&&!terminal.has(j.state)){j.state='unknown';j.error='DEVICE_REVOKED';this.callbacks.delete(j.id);}this.save();}
 validCallback(url){try{const u=new URL(url);return u.protocol==='https:'&&u.hostname==='bot-api.kakao.com'&&(!u.port||u.port==='443')&&!u.username&&!u.password&&!u.hash&&url.length<2048;}catch{return false;}}
 jobReply(j,page=1){if(!j)return textReply('아직 요청한 작업이 없어.');if(j.state==='completed'){const text=j.output||'작업을 마쳤어.',pages=pagesOf(text);page=Math.min(Math.max(page,1),pages.length);return {version:'2.0',template:{outputs:pages.slice(page-1,page+2).map((text,i)=>({simpleText:{text:text+(pages.length>1?`\n(${page+i}/${pages.length})`:'' )}})),quickReplies:page+2<pages.length?[{label:'다음 내용',action:'message',messageText:`결과 ${j.id} ${page+3}`}]:[]}};}
  if(j.state==='failed')return textReply('AI 생성에 실패했습니다. 오류 코드: '+(j.error==='LOCAL_APPROVAL_DENIED'?'NARAE_APPROVAL_DENIED':'NARAE_REMOTE_AI'));
  if(j.state==='cancelled')return textReply('작업을 중단했어. 이미 수행된 변경은 유지돼.');
  if(j.state==='unknown')return textReply('PC 연결이 끊겨 작업 완료 여부가 불확실해. 자동으로 다시 실행하지 않았으니 PC에서 확인해 줘.');
  return textReply(j.progress||'연결된 PC에서 처리하고 있어.',[['결과 확인','결과 확인'],['중단','중단']]);
 }
 async deliver(j){const cb=this.callbacks.get(j.id);this.callbacks.delete(j.id);if(!cb||cb.expires<=this.clock())return;const pending=!terminal.has(j.state),payload=pending?textReply('작업이 길어지고 있어. 카톡 자동 답변 시간이 끝나기 전에 조회 버튼을 남길게. 아래에서 진행 상태나 완료한 답변을 확인해 줘.',[['결과 확인','결과 '+j.id],['중단','중단']]):this.jobReply(j);j.delivery='callback_attempted';this.save();try{const response=await this.fetch(cb.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'manual',signal:AbortSignal.timeout(8000)});const result=await response.json().catch(()=>({}));j.delivery=response.ok&&result.status==='SUCCESS'?(pending?'callback_progress_accepted_use_poll':'callback_accepted'):'callback_failed';}catch{j.delivery='callback_unknown';}this.save();}
 skill(body){const r=body?.userRequest,bot=body?.bot?.id,sender=r?.user?.id,text=r?.utterance;
  if(typeof bot!=='string'||typeof sender!=='string'||typeof text!=='string'||!bot||bot.length>256||!sender||sender.length>256||!text.trim()||text.length>4000||(r.user.type&&r.user.type!=='botUserKey'))fail(400,'SKILL_FORMAT');
  if(this.botId&&bot!==this.botId)fail(403,'BOT_NOT_ALLOWED');const t=text.trim();const u=this.user(bot,sender,true);
  if(['내 UID','UID','가입','시작'].includes(t))return textReply('나래 UID: '+u.uid+'\n나래 오피스 → 카카오톡 연동에 입력해 줘. UID는 비밀번호가 아니며 카톡 확인과 PC 승인이 모두 필요해.');
  if(t.startsWith('연결 ' )&&!['연결 상태','연결 해제'].includes(t)){
   const d=Object.values(this.data.devices).find(d=>d.uid===u.uid&&d.state==='pending'&&d.expires>this.clock()&&equal(d.codeHash,hash(t.slice(3).trim().toUpperCase())));
   if(!d)return textReply('연결 코드를 확인해 줘. 만료됐다면 PC에서 새 연결 요청을 해 줘.');d.state='confirmed';d.codeHash='';this.save();return textReply('카톡 확인 완료: '+d.name+'\n이제 해당 PC에서 최종 승인해 줘.');
  }
  const d=Object.values(this.data.devices).find(d=>d.uid===u.uid&&d.state==='approved');
  if(t==='연결 해제'){for(const dev of Object.values(this.data.devices))if(dev.uid===u.uid&&!['revoked','expired'].includes(dev.state))this.revoke(dev);return textReply('이 카톡의 PC 원격 연결을 해제했어. UID는 유지돼.');}
  if(t==='연결 상태')return textReply(d?`연결 PC: ${d.name}\n${this.clock()-d.lastSeen<30000?'온라인':'오프라인 · PC와 나래 오피스를 켜 줘.'}`:'아직 승인된 PC가 없어.\n나래 UID: '+u.uid);
  if(t==='대화 확인'||t==='최근 대화'||/^대화 \d+$/.test(t)){
   if(!d)return textReply('승인된 PC를 먼저 연결해 줘.');const messages=d.conversation?.messages||[];if(!messages.length)return textReply('공유된 에이전트 대화가 없어. PC의 에이전트(실험) 탭에서 시작해 줘.');
   const text=messages.map(m=>(m.role==='user'?'나':m.role==='assistant'?'나래':'안내')+' · '+(m.origin==='pc'?'PC':'카톡')+'\n'+m.content).join('\n\n'),pages=pagesOf(text),page=Math.min(Math.max(Number(t.split(' ')[1])||1,1),pages.length);
   return {version:'2.0',template:{outputs:pages.slice(page-1,page+2).map((text,i)=>({simpleText:{text:text+`\n(${page+i}/${pages.length})`}})),quickReplies:page+2<pages.length?[{label:'대화 이어 보기',action:'message',messageText:'대화 '+(page+3)}]:[]}};
  }
  const ownJobs=Object.values(this.data.jobs).filter(j=>j.uid===u.uid).sort((a,b)=>b.created-a.created);
  if(t==='결과 확인'||/^결과 [a-f0-9]{32}(?: \d+)?$/.test(t)){const [,jobId,p]=t.split(' ');const j=t==='결과 확인'?ownJobs[0]:ownJobs.find(j=>j.id===jobId);return this.jobReply(j,Math.min(Number(p)||1,1000));}
  if(!d)return textReply('먼저 PC를 연결해 줘.\n나래 UID: '+u.uid);
  const active=ownJobs.find(j=>j.device===d.id&&!terminal.has(j.state));
  if(t==='중단'){if(active){active.cancelRequested=true;if(active.state==='queued'){active.state='cancelled';void this.deliver(active);}this.save();return textReply('PC에 중단을 요청했어. 이미 수행된 변경은 유지돼.');}return textReply('진행 중인 작업이 없어.');}
  const mid=typeof r.messageId==='string'&&r.messageId.length<=256?r.messageId:'',cb=typeof r.callbackUrl==='string'?r.callbackUrl:'';
  const dedupe=hash(u.uid+'\0'+(mid||cb||t));const prior=this.data.dedupe[dedupe];if(prior&&(mid||cb||this.clock()-prior.created<20000)){if(prior.inputHash!==hash(t))fail(409,'DUPLICATE_CONFLICT');return this.jobReply(this.data.jobs[prior.job]);}
  if(active)return this.jobReply(active);if(this.clock()-d.lastSeen>=30000)return textReply('연결된 PC가 오프라인이야. PC와 나래 오피스를 켜 줘. 이 요청은 나중에 자동 실행하지 않아.');
  if(Object.keys(this.data.jobs).length>=10000)fail(503,'JOB_CAPACITY');
  const j={id:id(),uid:u.uid,device:d.id,prompt:t,state:'queued',created:this.clock(),heartbeat:this.clock(),delivery:cb?'callback_rejected':'not_supplied'};
  this.data.jobs[j.id]=j;this.data.dedupe[dedupe]={job:j.id,created:j.created,inputHash:hash(t)};
  if(this.validCallback(cb)){j.delivery='callback_waiting';this.callbacks.set(j.id,{url:cb,expires:this.clock()+this.callbackSeconds*1000});}
  this.save();return this.callbacks.has(j.id)?{version:'2.0',useCallback:true,data:{text:'연결된 '+d.name+'에서 확인할게.'}}:textReply('연결된 '+d.name+'에서 확인할게. 아래에서 결과를 확인해 줘.',[['결과 확인','결과 확인'],['중단','중단']]);
 }
 async route(req,url,body){this.expire();
  if(req.method==='GET'&&url.pathname==='/health')return {status:'ok',service:'narae-kakao-relay',protocol:1};
  if(req.method==='POST'&&url.pathname.startsWith('/kakao/')){const authorized=url.pathname==='/kakao/skill'?equal(req.headers['x-narae-skill-key'],this.secret):equal(url.pathname.slice(7),this.secret);if(!authorized)fail(404,'NOT_FOUND');return this.skill(body);}
  if(req.method==='POST'&&url.pathname==='/v1/pairings'){
   const uid=String(body.uid||'').trim().toUpperCase(),name=String(body.name||'').trim();if(!this.data.users[uid]||!name||name.length>60)fail(400,'PAIRING_INPUT');
   if(Object.values(this.data.devices).filter(d=>d.uid===uid&&['pending','confirmed'].includes(d.state)).length>=5)fail(429,'PAIRING_LIMIT');
   const token=randomBytes(32).toString('base64url'),code=randomBytes(6).toString('hex').toUpperCase();const d={id:id(),uid,name,state:'pending',expires:this.clock()+300000,tokenHash:hash(token),codeHash:hash(code),lastSeen:0};this.data.devices[d.id]=d;this.save();return {...this.publicDevice(d),token,code};
  }
  if(url.pathname.startsWith('/v1/device')){
   const d=this.device(req);
   if(req.method==='GET'&&url.pathname==='/v1/device')return this.publicDevice(d);
   if(req.method!=='POST')fail(404,'NOT_FOUND');
   if(url.pathname==='/v1/device/revoke'){this.revoke(d);return {revoked:true};}
   if(url.pathname==='/v1/device/approve'){if(d.state!=='confirmed')fail(409,'CHAT_CONFIRMATION_REQUIRED');if(Object.values(this.data.devices).some(x=>x.uid===d.uid&&x.state==='approved'&&x.id!==d.id))fail(409,'EXISTING_PC_REQUIRES_UNLINK');d.state='approved';d.lastSeen=this.clock();this.save();return this.publicDevice(d);}
   if(d.state!=='approved')fail(403,'LOCAL_APPROVAL_REQUIRED');d.lastSeen=this.clock();
   if(url.pathname==='/v1/device/conversation'){
    if(!Number.isSafeInteger(body.revision)||body.revision<0||!Array.isArray(body.messages)||body.messages.length>20)fail(400,'CONVERSATION_FORMAT');
    const messages=body.messages.map(m=>{if(!m||!['user','assistant','error'].includes(m.role)||!['pc','kakao'].includes(m.origin)||typeof m.content!=='string'||m.content.length>800||!Number.isSafeInteger(m.created)||m.created<0)fail(400,'CONVERSATION_FORMAT');return {role:m.role,origin:m.origin,content:m.content,created:m.created};});
    const digest=hash(JSON.stringify(messages)),current=d.conversation;if(current&&body.revision<current.revision)return {accepted:false,revision:current.revision};if(current&&body.revision===current.revision&&current.digest!==digest)fail(409,'CONVERSATION_CONFLICT');
    d.conversation={revision:body.revision,messages,digest,updated:this.clock()};this.save();return {accepted:true,revision:body.revision};
   }
   if(url.pathname==='/v1/device/poll'){const running=Object.values(this.data.jobs).some(j=>j.device===d.id&&j.state==='running');const j=running?null:Object.values(this.data.jobs).find(j=>j.device===d.id&&j.state==='queued');if(j){j.state='running';j.heartbeat=this.clock();j.lease=id();}this.save();return {job:j?{id:j.id,prompt:j.prompt,lease:j.lease,uid:j.uid}:null};}
   if(url.pathname==='/v1/device/heartbeat'){const j=this.data.jobs[body.jobId];if(j&&j.device===d.id&&j.state==='running'&&equal(body.lease,j.lease)){j.heartbeat=this.clock();j.progress=String(body.progress||'').slice(0,150);this.save();return {cancelRequested:Boolean(j.cancelRequested)};}this.save();return {cancelRequested:Boolean(body.jobId)};}
   if(url.pathname==='/v1/device/result'){
    const j=this.data.jobs[body.jobId];if(!j||j.device!==d.id||!equal(body.lease,j.lease))fail(404,'JOB_NOT_FOUND');
    const result={state:body.state,output:typeof body.output==='string'?Array.from(body.output).slice(0,12000).join(''):'',error:body.error==='LOCAL_APPROVAL_DENIED'?'LOCAL_APPROVAL_DENIED':'REMOTE_FAILURE'};
    if(!['completed','failed','cancelled'].includes(result.state))fail(400,'RESULT_STATE');const digest=hash(JSON.stringify(result));
    if(j.resultHash){if(!equal(j.resultHash,digest))fail(409,'RESULT_CONFLICT');return {accepted:true};}
    if(j.state!=='running')fail(409,'JOB_NOT_RUNNING');Object.assign(j,result,{resultHash:digest});this.save();void this.deliver(j);return {accepted:true};
   }
  }
  fail(404,'NOT_FOUND');
 }
 async handle(req,res){try{this.limit((req.socket.remoteAddress||'unknown')+'|'+hash(req.headers.authorization||'anonymous').slice(0,16));const url=new URL(req.url,'http://localhost');const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>65536)fail(413,'TOO_LARGE');chunks.push(chunk);}const raw=Buffer.concat(chunks).toString('utf8');let body={};if(raw){try{body=JSON.parse(raw);}catch{fail(400,'BAD_JSON');}}const result=await this.route(req,url,body);res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(result));}catch(error){res.writeHead(error.status||500,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:error.status?error.message:'RELAY_INTERNAL'}));}}
 async close(){clearInterval(this.timer);this.callbacks.clear();await new Promise(resolve=>this.server.close(resolve));}
}
if(require.main===module){const home=process.env.NARAE_RELAY_HOME||path.join(process.env.LOCALAPPDATA||process.cwd(),'NaraeKakaoRelay');fs.mkdirSync(home,{recursive:true});const keyFile=path.join(home,'skill-secret.txt');if(!fs.existsSync(keyFile))fs.writeFileSync(keyFile,randomBytes(32).toString('base64url'),{mode:0o600});const relay=new KakaoRelay({file:path.join(home,'relay.json'),secret:fs.readFileSync(keyFile,'utf8').trim(),botId:process.env.NARAE_KAKAO_BOT_ID||''});relay.server.listen(Number(process.env.NARAE_RELAY_PORT||8941),'127.0.0.1',()=>console.log('NARAE_RELAY_READY (loopback; private skill key stored in relay data directory)'));}
module.exports={KakaoRelay,textReply};
