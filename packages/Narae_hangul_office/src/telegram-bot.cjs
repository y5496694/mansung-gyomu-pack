'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomBytes,createHash,randomUUID}=require('node:crypto'),{inside}=require('./agent.cjs');
class TelegramBot{
 constructor({home,store,workspace,execute,notify=()=>{},canRun=()=>true,fetchImpl=fetch}){
  Object.assign(this,{home,store,workspace,execute,notify,canRun,fetch:fetchImpl});this.file=path.join(home,'data/telegram.json');fs.mkdirSync(path.dirname(this.file),{recursive:true});
  this.config=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{enabled:false,offset:0,jobs:{}};this.config.jobs||={};
  for(const job of Object.values(this.config.jobs))if(job.state==='running')job.state='unknown';this.error='';this.polling=null;this.task=null;this.pending=null;this.save();
 }
 save(){const stage=this.file+'.'+randomUUID()+'.tmp';fs.writeFileSync(stage,JSON.stringify(this.config),{mode:0o600});fs.renameSync(stage,this.file);}
 session(){return this.config.chatId?createHash('sha256').update(this.config.botId+':'+this.config.chatId).digest('hex').slice(0,32):null;}
 status(){let hasToken=false;try{hasToken=Boolean(this.store.get());}catch{}return {enabled:this.config.enabled,linked:Boolean(this.config.chatId),username:this.config.username||'',hasToken,chatId:this.config.chatId||null,running:Boolean(this.task),error:this.error,pairURL:this.pending&&this.pending.expires>Date.now()?`https://t.me/${this.config.username}?start=${this.pending.code}`:null};}
 changed(){this.notify({type:'telegram',telegram:this.status()});}
 async api(method,body,signal){const token=this.store.get();if(!token)throw new Error('텔레그램 봇 토큰을 먼저 연결하세요.');let response;try{response=await this.fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',body:body instanceof FormData?body:JSON.stringify(body||{}),headers:body instanceof FormData?{}:{'content-type':'application/json'},redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000)});}catch(error){if(signal?.aborted)throw new Error('텔레그램 연결을 중지했습니다.');throw new Error('텔레그램 서버에 연결하지 못했습니다.');}
  const result=await response.json();if(!response.ok||!result.ok)throw new Error('텔레그램 요청 실패 ('+response.status+'). 토큰·봇 사용 상태를 확인하세요.');return result.result;
 }
 pair(){if(!this.config.username)throw new Error('봇 토큰을 먼저 연결하세요.');this.pending={code:randomBytes(18).toString('hex'),expires:Date.now()+600000};this.changed();return this.status();}
 async connect(token){if(typeof token!=='string'||!/^\d{5,20}:[A-Za-z0-9_-]{20,}$/.test(token.trim()))throw new Error('BotFather에서 받은 봇 토큰을 입력하세요.');await this.stop();const previous=this.store.get();this.store.set(token.trim());try{
   const bot=await this.api('getMe');if(!bot.is_bot||!/^[\w]{5,32}$/.test(bot.username||''))throw new Error('유효한 봇 계정을 확인하지 못했습니다.');const webhook=await this.api('getWebhookInfo');if(webhook.url)throw new Error('이미 웹훅에서 사용 중인 봇입니다. 전용 봇을 연결하세요.');
   const latest=await this.api('getUpdates',{offset:-1,limit:1,timeout:0,allowed_updates:['message']});
   this.config={enabled:true,offset:latest.length?latest[0].update_id+1:0,botId:String(bot.id),username:bot.username,jobs:{}};this.error='';this.save();this.pair();this.start();return this.status();
  }catch(error){previous?this.store.set(previous):this.store.remove();if(this.config.enabled)this.start();throw error;}
 }
 start(){if(!this.config.enabled||this.polling)return;const controller=new AbortController();this.polling=controller;void this.loop(controller);this.changed();}
 async stop(){this.polling?.abort();this.polling=null;this.task?.abort();}
 async unlink(){await this.stop();this.config={enabled:false,offset:0,jobs:{}};this.pending=null;this.store.remove();this.save();this.changed();return this.status();}
 async loop(controller){while(!controller.signal.aborted){try{const updates=await this.api('getUpdates',{offset:this.config.offset,timeout:25,limit:20,allowed_updates:['message']},controller.signal);for(const update of updates){if(controller.signal.aborted)break;await this.process(update,controller.signal);}this.error='';}catch{if(controller.signal.aborted)break;this.error='텔레그램 연결을 재시도합니다. 봇 중복 실행·인터넷 상태를 확인하세요.';this.changed();await new Promise(r=>{const timer=setTimeout(r,3000);controller.signal.addEventListener('abort',()=>{clearTimeout(timer);r();},{once:true});});}}if(this.polling===controller)this.polling=null;}
 async say(chat,text,signal){for(let i=0;i<text.length;i+=3500)await this.api('sendMessage',{chat_id:chat,text:text.slice(i,i+3500)},signal);}
 allowed(file){const root=fs.realpathSync(this.workspace()),absolute=path.resolve(root,file);if(!inside(root,absolute)||!fs.existsSync(absolute)||!inside(root,fs.realpathSync(absolute))||!fs.statSync(absolute).isFile()||! /\.(hwp|hwpx|pdf)$/i.test(absolute))throw new Error('작업 폴더 안의 한글·PDF 파일만 전송할 수 있습니다.');return absolute;}
 async sendFile(chat,file,signal){file=this.allowed(file);if(fs.statSync(file).size>50*1024*1024)throw new Error('텔레그램 파일 전송 크기는 50MB까지 지원합니다.');const form=new FormData();form.append('chat_id',String(chat));form.append('document',new Blob([fs.readFileSync(file)]),path.basename(file));await this.api('sendDocument',form,signal);}
 async receive(update,signal){const doc=update.message.document;if(!doc||! /\.(hwp|hwpx)$/i.test(doc.file_name||'')||!Number.isSafeInteger(doc.file_size)||doc.file_size>20*1024*1024)throw new Error('20MB 이하의 HWP·HWPX 파일을 보내세요.');const info=await this.api('getFile',{file_id:doc.file_id},signal);if(!/^[\w/-]+\.\w+$/.test(info.file_path||'')||info.file_path.includes('..'))throw new Error('텔레그램 파일 경로를 확인하지 못했습니다.');
  const response=await this.fetch(`https://api.telegram.org/file/bot${this.store.get()}/${info.file_path}`,{redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(60000)])});if(!response.ok||!response.body)throw new Error('첨부 파일을 받지 못했습니다.');let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>20*1024*1024)throw new Error('첨부 크기를 초과했습니다.');chunks.push(chunk);}if(size!==doc.file_size)throw new Error('첨부 파일 크기가 일치하지 않습니다.');
  const name=path.basename(doc.file_name).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(-100),file=path.join(this.workspace(),'telegram-'+update.update_id+'-'+name);const parent=fs.realpathSync(this.workspace());if(!inside(parent,path.resolve(file)))throw new Error('첨부 경로 오류');fs.writeFileSync(file,Buffer.concat(chunks),{flag:'wx'});return file;
 }
 async process(update,signal=new AbortController().signal){
  if(!Number.isSafeInteger(update.update_id)||update.update_id<this.config.offset)return;this.config.offset=update.update_id+1;this.save();const message=update.message;if(!message||message.chat?.type!=='private'||message.from?.is_bot||String(message.from?.id)!==String(message.chat.id))return;const chat=String(message.chat.id),text=message.text||message.caption||'';
  if(this.pending&&this.pending.expires>Date.now()&&text==='/start '+this.pending.code){this.task?.abort();this.config.chatId=chat;this.config.ownerId=String(message.from.id);this.pending=null;this.save();this.changed();await this.say(chat,'나래 오피스에 연결되었습니다. 요청이나 HWP/HWPX 파일을 보내세요. /files 파일 목록 · /get 파일명 · /cancel 중지. 실제 변경은 PC 승인 후 실행합니다.',signal);return;}
  if(chat!==this.config.chatId||String(message.from.id)!==this.config.ownerId)return;
  if(text==='/cancel'){this.task?.abort();await this.say(chat,'현재 텔레그램 작업을 중지했습니다. 이미 수행한 변경은 유지됩니다.',signal);return;}
  if(text==='/start'||text==='/help'){await this.say(chat,'요청이나 HWP/HWPX 파일을 보내세요. /files 파일 목록 · /get 파일명 · /cancel 중지. PC의 나래 오피스가 켜져 있어야 합니다.',signal);return;}
  if(this.task||!this.canRun()){await this.say(chat,'오피스가 다른 작업을 처리 중입니다. 완료 후 다시 요청하세요.',signal);return;}
  if(text==='/files'){const names=fs.readdirSync(this.workspace()).filter(f=>/\.(hwp|hwpx|pdf)$/i.test(f));await this.say(chat,names.slice(0,50).join('\n')||'작업 폴더에 문서가 없습니다.',signal);return;}
  if(text.startsWith('/get ')){try{await this.sendFile(chat,text.slice(5).trim(),signal);}catch(error){await this.say(chat,error.message,signal);}return;}
  if(!text.trim()&&!message.document)return;if(text.length>4000){await this.say(chat,'요청은 4000자 이내로 나누어 보내세요.',signal);return;}
  const jobId=String(update.update_id);this.config.jobs[jobId]={state:'running',started:Date.now()};for(const id of Object.keys(this.config.jobs).slice(0,-200))delete this.config.jobs[id];this.save();const task=new AbortController();this.task=task;this.changed();
  // Polling continues while the task runs, so /cancel remains responsive.
  void(async()=>{try{let prompt=text;if(message.document){const file=await this.receive(update,task.signal);prompt=(text||'첨부한 문서 내용을 확인해 주세요.')+'\n첨부 문서: '+file;}await this.say(chat,'PC의 나래 오피스가 처리하고 있습니다. 변경이 필요하면 PC에서 승인하세요.',task.signal);const result=await this.execute(prompt,{signal:task.signal,sessionId:this.session(),origin:'telegram'});if(task.signal.aborted)throw new Error('중단');const value=typeof result==='string'?{text:result}:result;if(this.config.jobs[jobId])this.config.jobs[jobId].state='completed';this.save();await this.say(chat,value.text||'처리를 마쳤습니다.',task.signal);for(const file of [...new Set(value.files||[])])await this.sendFile(chat,file,task.signal);
   }catch{if(this.config.jobs[jobId])this.config.jobs[jobId].state=task.signal.aborted?'cancelled':'failed';this.save();if(!task.signal.aborted)await this.say(chat,'요청을 완료하지 못했습니다. PC의 대화·승인 상태를 확인하세요. 이미 수행한 변경은 남을 수 있습니다. 자동 재실행하지 않습니다.').catch(()=>{});
   }finally{if(this.task===task)this.task=null;this.changed();}})();
 }
 close(){void this.stop();}
}
module.exports={TelegramBot};
