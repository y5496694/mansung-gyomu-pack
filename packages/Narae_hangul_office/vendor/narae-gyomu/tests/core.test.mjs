import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
process.env.NARAE_GYOMU_DATA=fs.mkdtempSync((await import('node:os')).tmpdir()+'/gyomu-core-');
const {HOME,DATA,initialize,outputPath}=await import('../src/paths.mjs');
const {Models}=await import('../src/models.mjs');
const {Tools}=await import('../src/tools.mjs');
const {Agent}=await import('../src/agent.mjs');
initialize();

test('model switch waits for old process exit and verifies the actual adapter',async()=>{
  const events=[];let alive=0,maxAlive=0;
  const m=new Models({spawnModel:(_exe,args)=>{
    const child=new EventEmitter();child.pid=1000+events.length;child.exitCode=null;child.signalCode=null;
    child.alias=args[args.indexOf('--alias')+1];child.adapter=args[args.indexOf('--lora')+1];
    events.push('start '+child.alias);maxAlive=Math.max(maxAlive,++alive);
    child.kill=()=>{setTimeout(()=>{alive--;child.exitCode=0;events.push('exit '+child.alias);child.emit('exit',0);},15);};
    return child;
  }});
  m.check=async file=>path.join(HOME,file.path);
  m.request=async route=>route==='/health'?{status:'ok'}:route==='/lora-adapters'?[{path:m.child.adapter,scale:1}]:{data:[{id:m.child.alias}]};
  await m.activate('narae1');await m.activate('narae2');
  assert.equal(m.status().active,'narae2');assert.equal(maxAlive,1);
  assert.ok(events[1].startsWith('exit '));assert.ok(events[2].startsWith('start EXAONE'));
  m.request=async route=>route==='/health'?{status:'ok'}:route==='/lora-adapters'?[{path:'wrong.gguf',scale:1}]:{data:[]};
  await assert.rejects(m.activate('narae3'),e=>e.code==='ADAPTER_IDENTITY');
  assert.equal(m.status().active,null);assert.equal(alive,0);
});

test('unselected files and output traversal cannot enter a document job',async()=>{
  const tools=new Tools({status:()=>({})},{subprocess:async()=>{throw new Error('must not execute');}});
  await assert.rejects(tools.call('hangul.inspect',{path:'D:/private/not-selected.hwp'}),e=>e.code==='FILE_NOT_ATTACHED');
  assert.throws(()=>outputPath('../escape.hwpx'),e=>e.code==='INVALID_FILENAME');
  await assert.rejects(tools.call('hangul.create',{title:'x',body:''}),e=>e.code==='EMPTY_BODY');
  await assert.rejects(tools.call('hangul.run',{job:{action:'create',overwrite_source:true}}),e=>e.code==='OVERWRITE_UNSUPPORTED');
  await assert.rejects(tools.call('wxs.prepare',{hwnd:'123',config:{title:'x'}}),e=>e.code==='WXS_WINDOW_NOT_OBSERVED');
});

test('CBE prepare is a dry run and a confirmed request cannot send twice',async()=>{
  let sends=0;
  const tools=new Tools({status:()=>({})},{subprocess:async(_exe,args)=>{
    if(args.includes('search'))return {items:[{id:'a'.repeat(24),name:'가상교사',department:'가상학교'}]};
    if(args.includes('--dry-run'))return {dryRun:true,sent:false};
    sends++;return {sent:true,verified:true,messageId:'test-message'};
  }});
  await tools.call('cbe.search',{name:'가상교사'});
  const prepared=await tools.call('cbe.prepare',{kind:'note',recipient_ids:['a'.repeat(24)],body:'원문\n그대로'});
  assert.equal(sends,0);assert.equal(prepared.performed,false);
  await tools.confirm(prepared.pendingId);assert.equal(sends,1);
  await assert.rejects(tools.confirm(prepared.pendingId),e=>e.code==='ACTION_USED');assert.equal(sends,1);
});

test('uncertain send stays nonretryable instead of claiming success',async()=>{
  const tools=new Tools({status:()=>({})},{subprocess:async(_exe,args)=>args.includes('--dry-run')?{dryRun:true}:{sent:null,verified:false,retry:false}});
  tools.people.set('b'.repeat(24),{id:'b'.repeat(24),name:'가상'});
  const p=await tools.call('cbe.prepare',{kind:'chat',recipient_ids:['b'.repeat(24)],body:'내용'});
  await assert.rejects(tools.confirm(p.pendingId),e=>e.code==='SEND_NOT_VERIFIED');
  await assert.rejects(tools.confirm(p.pendingId),e=>e.code==='ACTION_USED');
});

test('agent cannot complete document creation after only reading a skill',async()=>{
  let turn=0;
  const models={status:()=>({active:'narae1'}),complete:async()=>({model:'Narae1',content:JSON.stringify(++turn===1?
    {tool:'skill.read',args:{area:'hangul'}}:{tool:'finish',args:{answer:'작성 완료'}})})};
  const tools={register:files=>files.map(p=>({path:p})),call:async()=>({text:'절차'})};
  const agent=new Agent(models,tools),job=agent.start('한글 문서를 만들어줘');
  while(agent.current)await new Promise(r=>setTimeout(r,10));
  assert.equal(job.status,'failed');assert.equal(job.error.code,'NOT_PERFORMED');
  assert.equal(job.answer,undefined);
});

test('agent executes selected model calls and persists observed results',async()=>{
  let turn=0,called=0;
  const models={status:()=>({active:'narae3'}),complete:async()=>({model:'Narae3',content:JSON.stringify(++turn===1?
    {tool:'system.status',args:{}}:{tool:'finish',args:{answer:'설치 상태 확인'}})})};
  const tools={register:()=>[],call:async(name)=>{assert.equal(name,'system.status');called++;return {installed:true};}};
  const agent=new Agent(models,tools),job=agent.start('도구 상태 확인해줘');
  while(agent.current)await new Promise(r=>setTimeout(r,10));
  assert.equal(called,1);assert.equal(job.status,'completed');
  assert.equal(job.events.find(e=>e.type==='observation').result.data.installed,true);
  assert.equal(agent.conversation(job.conversationId).messages.at(-1).model,'Narae3');
});

test('single confirmed result ends without repeated model calls and old goals do not restart',async()=>{
  let calls=0;
  const models={status:()=>({active:'narae3'}),complete:async()=>({model:'Narae3',content:JSON.stringify(++calls===1?
    {tool:'hangul.create',args:{title:'가상',body:'확정한 본문'}}:{tool:'finish',args:{answer:'네'}})})};
  const tools={register:()=>[],call:async()=>({success:true,artifacts:{document:'D:/test.hwpx'},modeled_content_verified:true})};
  const agent=new Agent(models,tools),job=agent.start('한글 문서를 만들어줘');
  while(agent.current)await new Promise(r=>setTimeout(r,10));
  assert.equal(job.status,'completed');assert.equal(job.completionMode,'verified-tool-result');assert.equal(calls,1);
  const next=agent.start('고마워',{conversationId:job.conversationId});
  while(agent.current)await new Promise(r=>setTimeout(r,10));
  assert.equal(next.status,'completed');assert.equal(next.answer,'네');assert.equal(calls,2);
});
