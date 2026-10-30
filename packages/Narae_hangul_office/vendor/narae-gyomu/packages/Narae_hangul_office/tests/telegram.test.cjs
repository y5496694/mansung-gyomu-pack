const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {TelegramBot}=require('../src/telegram-bot.cjs');
test('Telegram pairs only one private owner, rejects strangers and never replays persisted updates',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'narae-tg-'));let token='123456:synthetic_token_only_1234567890',executions=0;const sent=[];
 const store={get:()=>token,set:t=>token=t,remove:()=>token=''};
 const fetchImpl=async(url,req)=>{const method=url.split('/').pop(),body=JSON.parse(req.body);sent.push({method,body});return new Response(JSON.stringify({ok:true,result:true}),{headers:{'content-type':'application/json'}});};
 const bot=new TelegramBot({home,store,workspace:()=>home,fetchImpl,execute:async()=>{executions++;return '완료';}});bot.config={enabled:true,botId:'123456',username:'narae_test_bot',offset:0,jobs:{}};bot.pair();const code=bot.pending.code;
 const update=(id,user,text,type='private')=>({update_id:id,message:{chat:{id:user,type},from:{id:user,is_bot:false},text}});
 try{await bot.process(update(1,10,'/start wrong'));assert(!bot.session());await bot.process(update(2,10,'/start '+code,'group'));assert(!bot.session());await bot.process(update(3,10,'/start '+code));assert(bot.session());await bot.process(update(4,99,'내 파일 읽기'));assert.equal(executions,0);await bot.process(update(5,10,'승인할 문서 작성'));for(let i=0;i<100&&bot.task;i++)await new Promise(r=>setTimeout(r,10));assert.equal(executions,1);await bot.process(update(5,10,'같은 요청'));assert.equal(executions,1);assert(!JSON.stringify(bot.status()).includes(token));assert(!fs.readFileSync(bot.file,'utf8').includes(token));assert.throws(()=>bot.allowed('../outside.hwp'));
  const restarted=new TelegramBot({home,store,workspace:()=>home,fetchImpl,execute:async()=>executions++});await restarted.process(update(5,10,'재시작 재전송'));assert.equal(executions,1);await restarted.unlink();assert(!restarted.session());
 }finally{bot.close();fs.rmSync(home,{recursive:true,force:true});}
});
test('Telegram cancellation stays available during execution and unlink never replays work',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'narae-tg-cancel-'));let aborted=false;
 const bot=new TelegramBot({home,store:{get:()=> '123456:synthetic_token_only_1234567890',remove:()=>{}},workspace:()=>home,fetchImpl:async()=>new Response('{"ok":true,"result":true}'),execute:(_,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(new Error('cancelled'));},{once:true}))});
 bot.config={enabled:true,botId:'1',chatId:'10',ownerId:'10',offset:0,jobs:{}};
 const update=(id,text)=>({update_id:id,message:{chat:{id:10,type:'private'},from:{id:10},text}});
 try{await bot.process(update(1,'수정 요청'));await new Promise(r=>setTimeout(r,20));await bot.process(update(2,'/cancel'));await new Promise(r=>setTimeout(r,20));assert(aborted);assert.equal(bot.config.jobs['1'].state,'cancelled');await bot.unlink();}finally{bot.close();fs.rmSync(home,{recursive:true,force:true});}
});
