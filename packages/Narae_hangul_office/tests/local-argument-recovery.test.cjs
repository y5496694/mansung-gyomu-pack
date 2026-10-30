'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runAgent,tools}=require('../src/agent.cjs'),{responseFrom}=require('../src/local-ai.cjs');
test('invalid model arguments never execute and are returned as field-specific feedback for correction',async()=>{
 let turn=0,executed=0;
 const parse=action=>responseFrom({choices:[{finish_reason:'stop',message:{content:JSON.stringify(action)}}]},tools);
 const answer=await runAgent({prompt:'저장된 한글 파일을 읽어줘',settings:{provider:'local'},signal:new AbortController().signal,send:()=>{},request:async body=>{
  turn++;if(turn===1)return parse({type:'tool',name:'read_document',args:{path:42}});
  if(turn===2){const feedback=body.input.findLast(i=>i.type==='function_call_output');assert.match(JSON.parse(feedback.output).error,/args.path/);assert.equal(executed,0);return parse({type:'tool',name:'read_document',args:{path:'D:/synthetic/plan.hwp'}});}
  return parse({type:'final',text:'실제 본문을 확인했습니다.'});
 },execute:async(name,args)=>{assert.equal(name,'read_document');assert.equal(args.path,'D:/synthetic/plan.hwp');executed++;return {hash:'verified',paragraphs:[{text:'훈련'}]};}});
 assert.equal(executed,1);assert.equal(turn,3);assert.match(answer,/확인/);
});
