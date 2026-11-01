'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {imageStep}=require('../src/image-task.cjs'),{runAgent,tools}=require('../src/agent.cjs');
const {messagesFor,trimOldestTurn}=require('../src/local-ai.cjs'),{readImage}=require('../src/agent-media.cjs');
const workspace=path.resolve('D:/synthetic'),file=name=>path.join(workspace,name);
const image=readImage(path.join(__dirname,'../ui/assets/narae-office.png'));
function observation(input,name,args,value){const id=String(input.length);input.push({type:'function_call',name,arguments:JSON.stringify(args),call_id:id},{type:'function_call_output',call_id:id,output:JSON.stringify(value)});}
function loaded(input,name){observation(input,'read_image',{path:file(name)},{kind:'image',loaded:true,path:file(name)});input.push({role:'user',content:[{type:'input_text',text:'도구 관찰 결과: '+name},{type:'input_image',image_url:'data:'+image.mimeType+';base64,'+image.base64}]});}

test('single-image analysis reads actual pixels once and then has a final-only response schema',async()=>{
 let reads=0,requests=0;
 const result=await runAgent({prompt:'"안내.png"를 보고 장소와 비용을 알려 줘.',settings:{provider:'local',workspace},signal:new AbortController().signal,send:()=>{},execute:async(name,args)=>{assert.equal(name,'read_image');assert.equal(args.path,file('안내.png'));reads++;return {kind:'image',path:args.path,image};},request:async body=>{
  if(++requests===1){assert(body.tool_choice==='required');assert.equal(body.tools.length,1);return {output:[{type:'function_call',name:'read_image',arguments:JSON.stringify({path:file('안내.png')}),call_id:'pixels'}]};}
  assert.deepEqual(body.tools,[]);assert(body.input.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='input_image')));
  return {output:[{type:'message',content:[{type:'output_text',text:'판독한 장소·비용'}]}]};
 }});
 assert.equal(result,'판독한 장소·비용');assert.equal(reads,1);assert.equal(requests,2);
});

test('image comparison cannot finish until every explicitly requested image was loaded',()=>{
 const prompt='"첫째.png"와 “둘째.jpg”를 비교해 줘.',input=[];
 assert.deepEqual(imageStep(prompt,input,tools,workspace).tools[0].parameters.properties.path.enum,[file('첫째.png')]);
 loaded(input,'첫째.png');let step=imageStep(prompt,input,tools,workspace);assert(step.required);assert.deepEqual(step.tools[0].parameters.properties.path.enum,[file('둘째.jpg')]);
 loaded(input,'둘째.jpg');step=imageStep(prompt,input,tools,workspace);assert.deepEqual(step.tools,[]);assert(!step.required);
});

test('image receipts alone, image errors, multiple unspecified files and mixed tasks cannot imply visual completion',()=>{
 const input=[];observation(input,'read_image',{path:file('a.png')},{kind:'image',loaded:true,path:file('a.png')});
 assert.equal(imageStep('"a.png"를 분석해 줘.',input,tools,workspace),null);
 const failure=[];observation(failure,'read_image',{path:file('a.png')},{error:'synthetic invalid image'});
 assert.match(imageStep('"a.png"를 분석해 줘.',failure,tools,workspace).instructions,/읽지 못/);
 const actual=[];loaded(actual,'a.png');
 for(const prompt of ['모든 그림을 분석해 줘.','그림을 보고 계획.hwpx를 만들어 줘.','"a.png"와 "원문.txt"를 읽고 비교해 줘.','선택한 그림과 다른 그림도 읽어 줘.','두 이미지를 비교해 줘.','그림과 문서를 비교해 줘.'])assert.equal(imageStep(prompt,actual,tools,workspace,file('a.png')),null,prompt);
 const selected=imageStep('선택한 그림의 시간을 알려 줘.',[],tools,workspace,file('선택.png'));assert.deepEqual(selected.tools[0].parameters.properties.path.enum,[file('선택.png')]);
});

test('context trimming keeps every loaded image and the actual user request',()=>{
 const input=[{role:'user',content:'두 그림을 비교하고 보이는 차이를 알려 줘.'}];loaded(input,'a.png');
 for(let i=0;i<8;i++)observation(input,'list_files',{},['fixture-'+i]);
 loaded(input,'b.png');for(let i=0;i<8;i++)observation(input,'list_files',{},[]);
 const messages=messagesFor({instructions:'이미지 분석',tools:[],input});
 while(trimOldestTurn(messages)){}
 assert.equal(messages.filter(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url')).length,2);
 assert(messages.some(m=>m.content==='두 그림을 비교하고 보이는 차이를 알려 줘.'));
});
