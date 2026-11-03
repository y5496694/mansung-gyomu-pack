#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import {spawn} from 'node:child_process';
import {APP, HOME, DATA, DAEMON, initialize, readJSON, Fault} from '../src/paths.mjs';
initialize();
const HELP=`나래교무 0.1.0 · 로컬 교무 AI와 네 도구의 공통 CLI
  narae-gyomu doctor | schema | status
  narae-gyomu models list | activate narae1|narae2|narae3 | stop
  narae-gyomu chat "명령" [--file 절대경로] [--conversation ID] [--json]
  narae-gyomu chat                         대화형 터미널
  narae-gyomu office agent-status          설치된 나래4 오피스 CLI 상태
  narae-gyomu office agent JOB.json [--result RESULT.json]
  narae-gyomu tool call TOOL --args '{"key":"value"}' [--file FILE]
  narae-gyomu tool call TOOL --args-file FILE.json [--file FILE]
  narae-gyomu confirm PENDING_ID           미리보기의 실제 적용 (1회)
  narae-gyomu cancel | shutdown
  narae-gyomu serve                        로컬 API를 포그라운드로 실행
자료: ${DATA}
`;
function options(argv) {
  const pos=[],opts={files:[]};
  for(let i=0;i<argv.length;i++) {
    const a=argv[i];
    if(a==='--help'||a==='-h')pos.push('help');
    else if(a==='--json') opts.json=true;
    else if(['--file','--conversation','--args','--args-file'].includes(a)) {
      if(!argv[i+1]) throw new Fault('ARGUMENT',a+' 값이 필요합니다.');
      const value=argv[++i];
      if(a==='--file') opts.files.push(path.resolve(value));else opts[a.slice(2)]=value;
    } else if(a.startsWith('--')) throw new Fault('ARGUMENT','알 수 없는 옵션: '+a);
    else pos.push(a);
  }
  return {pos,opts};
}
let state;
async function api(route,data) {
  const response=await fetch(`http://127.0.0.1:${state.port}/api/`+route,{method:data===undefined?'GET':'POST',
    headers:{authorization:`Bearer ${state.token}`,'content-type':'application/json'},
    body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(240000)});
  const result=await response.json();
  if(!response.ok || !result.ok) throw new Fault(result.error?.code || 'API',result.error?.message || 'API 오류');
  return result.data;
}
async function connect() {
  state=readJSON(DAEMON,{});
  if(state.port) {
    try {const status=await api('status'); if(status.pid===state.pid) {
      if((status.home || state.home)!==HOME)throw new Fault('INSTANCE_LOCATION','다른 설치 폴더의 나래교무가 실행 중입니다. 그 실행기를 종료한 뒤 다시 시작하세요.');
      return;
    }}
    catch(error) {if(['AUTH','INSTANCE_LOCATION'].includes(error.code)) throw error;}
  }
  const log=fs.openSync(path.join(DATA,'logs/backend.log'),'a');
  const child=spawn(process.execPath,[path.join(APP,'src/server.mjs')],{detached:true,windowsHide:true,
    stdio:['ignore',log,log],env:{...process.env,NARAE_GYOMU_HOME:HOME,NARAE_GYOMU_DATA:DATA}});
  fs.closeSync(log);child.unref();
  for(let i=0;i<200;i++) {
    await new Promise(r=>setTimeout(r,100));state=readJSON(DAEMON,{});
    if(state.pid) try {const status=await api('status');if(status.pid===state.pid)return;}catch{}
  }
  throw new Fault('START_FAILED','프로그램을 시작하지 못했습니다. '+path.join(DATA,'logs/backend.log'));
}
async function chat(text,opts) {
  const job=await api('chat',{text,conversationId:opts.conversation,files:opts.files});
  let latest=job;
  while(latest.status==='running') {await new Promise(r=>setTimeout(r,500));latest=await api('jobs/'+job.id);}
  if(opts.json) console.log(JSON.stringify(latest,null,2));
  else {
    if(latest.answer) console.log(latest.answer);
    if(latest.error) console.error(`${latest.error.code}: ${latest.error.message}`);
    for(const event of latest.events) if(event.type==='observation' && event.result.data?.pendingId)
      console.log('적용 준비 ID: '+event.result.data.pendingId+'\n실제 적용: narae-gyomu confirm '+event.result.data.pendingId);
    console.log('\n대화 ID: '+latest.conversationId);
  }
  if(latest.status==='failed') process.exitCode=1;
  return latest.conversationId;
}
try {
  if(process.argv[2]==='office') {
    process.exitCode=await import('../src/office-cli.mjs').then(m=>m.runOffice(process.argv.slice(3)));
  } else {
  const {pos,opts}=options(process.argv.slice(2)),[command,action,name]=pos;
  if(!command || ['help','--help','-h'].includes(command)) console.log(HELP);
  else if(command==='serve') {
    const app=await import('../src/server.mjs').then(m=>m.createApp());
    for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.shutdown().then(()=>process.exit(0)));
  }
  else if(command==='doctor') {
    const catalog=readJSON(path.join(HOME,'models/catalog.json'));
    console.log(JSON.stringify({version:'0.1.0',app:APP,home:HOME,data:DATA,node:process.version,
      runtime:readJSON(path.join(HOME,'runtime.json')),models:catalog.models.map(m=>({id:m.id,alias:m.alias,
        installed:[m.base,m.adapter].every(f=>fs.existsSync(path.join(HOME,f.path))),actualWeightTraining:m.actualWeightTraining})),
      packages:readJSON(path.join(APP,'sources.lock.json')).sources.map(p=>({name:p.name,commit:p.commit}))},null,2));
  } else {
    await connect();
    let result;
    if(command==='schema') result=await api('schema');
    else if(command==='status') result=await api('status');
    else if(command==='models' && action==='list') result=(await api('status')).models;
    else if(command==='models' && action==='activate') result=await api('models/activate',{id:name});
    else if(command==='models' && action==='stop') result=await api('models/stop',{});
    else if(command==='tool' && action==='call') {
      const args=opts['args-file']?readJSON(path.resolve(opts['args-file'])):JSON.parse(opts.args || '{}');
      result=await api('tools/call',{tool:name,args,files:opts.files});
    } else if(command==='confirm' && action) result=await api('pending/confirm',{id:action});
    else if(command==='cancel') result=await api('cancel',{});
    else if(command==='shutdown') result=await api('shutdown',{});
    else if(command==='chat') {
      if(pos.length>1) await chat(pos.slice(1).join(' '),opts);
      else {
        const terminal=readline.createInterface({input:process.stdin,output:process.stdout});
        try {
          console.log('나래교무 · /exit 종료 · /model narae1|narae2|narae3 전환');
          while(true) {
            const text=(await terminal.question('나 > ')).trim();
            if(text==='/exit')break;if(!text)continue;
            if(text.startsWith('/model ')){console.log(await api('models/activate',{id:text.slice(7).trim()}));continue;}
            opts.conversation=await chat(text,opts);
          }
        } finally {terminal.close();}
      }
    } else throw new Fault('COMMAND','지원하지 않는 명령입니다.\n'+HELP);
    if(result!==undefined) console.log(JSON.stringify(result,null,2));
  }
  }
} catch(e) {console.error(JSON.stringify({ok:false,error:{code:e.code || 'FAILED',message:e.message}}));process.exitCode=1;}
