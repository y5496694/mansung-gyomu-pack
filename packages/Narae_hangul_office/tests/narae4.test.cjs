'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {candidatesFor,chosenAction,decisionPayload}=require('../src/local-decision.cjs');
const {LocalAI,messagesFor,modelFiles,modelURL}=require('../src/local-ai.cjs');
function body(labels=['조회','다음 페이지']){return {instructions:'현재 화면에서 다음 단계',tool_choice:'required',input:[{role:'user',content:'조회해 줘.'},{role:'user',content:'도구 관찰 결과:\n'+JSON.stringify({elements:labels.map((label,i)=>({ref:'s2/e'+i,label}))})}],tools:[{name:'gyomu_browser',parameters:{type:'object',properties:{action:{type:'string',enum:['click']},ref:{type:'string',enum:labels.map((_,i)=>'s2/e'+i)}},required:['action','ref'],additionalProperties:false}}]};}
test('decision candidates require observed current refs and cannot generate arguments or final actions',()=>{
 assert.equal(candidatesFor(body()).length,2);
 assert.equal(candidatesFor(body(['상신','인증서 로그인'])).length,0);
 assert.deepEqual(candidatesFor(body(['닫기','상신'])),[],'removing a protected candidate must not turn Close into an automatic single action');
 const unknown=body();unknown.tools[0].parameters.properties.ref.enum=['unobserved'];assert.equal(candidatesFor(unknown).length,0);
 const arbitrary=body();arbitrary.tools[0].parameters.properties.action.enum=['fill'];arbitrary.tools[0].parameters.required.push('text');arbitrary.tools[0].parameters.properties.text={type:'string'};assert.equal(candidatesFor(arbitrary).length,0);
 const optional=body();delete optional.tool_choice;assert.deepEqual(candidatesFor(optional),[]);
 const dialog=body();dialog.input.at(-1).content='관찰:\n'+JSON.stringify({nativeDialog:{id:'d1',message:'확인'}});assert.deepEqual(candidatesFor(dialog),[]);
});
test('low confidence, delegation, invalid probability distributions and unknown choices fall back',()=>{
 const c=candidatesFor(body()),a={choice:'ACTION_0',probabilities:{ACTION_0:.96,ACTION_1:.01,DELEGATE:.03}};assert.equal(chosenAction(a,c),c[0]);
 for(const v of [{...a,choice:'DELEGATE'},{...a,choice:'ACTION_99'},{choice:'ACTION_0',probabilities:{ACTION_0:.8,DELEGATE:.2}},{choice:'ACTION_0',probabilities:{ACTION_0:NaN}},{choice:'ACTION_0',probabilities:{ACTION_0:.96,ACTION_1:.6}}])assert.equal(chosenAction(v,c),null);
});
test('decision inputs retain the complete request and fall back instead of cropping long or incomplete state',()=>{
 const b=body(),c=candidatesFor(b),payload=decisionPayload(b,c);assert.equal(payload.state.user_request,'조회해 줘.');assert.equal(payload.state.observed.elements.length,2);
 b.input[0].content='조회하고 '+ '조건을 유지하세요.'.repeat(600);assert.equal(decisionPayload(b,c),null);
 assert.deepEqual(candidatesFor(body(['문서 저장','결제'])),[]);
});
test('local multimodal planner sends image parts and text instead of serializing image bytes as text',()=>{
 const url='data:image/png;base64,iVBORw0KGgo=';const messages=messagesFor({instructions:'이미지를 분석',tools:[],input:[{role:'user',content:[{type:'input_text',text:'그림에 적힌 시간을 읽어 줘.'},{type:'input_image',image_url:url}]}]});
 assert.deepEqual(messages[1].content,[{type:'text',text:'그림에 적힌 시간을 읽어 줘.'},{type:'image_url',image_url:{url}}]);
 assert.throws(()=>messagesFor({instructions:'',input:[{role:'user',content:[{type:'input_image',image_url:'https://untrusted.example/image.png'}]}]}),/이미지/);
});
test('multi-component installs verify every weight and use separately pinned upstream repositories',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'narae4-components-')),root=path.resolve(__dirname,'..');
 const spec={path:'file.gguf',bytes:4,sha256:'a'.repeat(64),repoId:'Qwen/test',revision:'b'.repeat(40)},model={id:'narae4',base:spec,adapter:spec,projector:spec,decision:spec};
 const ai=new LocalAI({root,home,catalog:{models:[model]}});try{assert.deepEqual(modelFiles(model),['base','adapter','projector','decision']);assert.match(modelURL({},spec),/Qwen\/test\/resolve\/bbbb/);
  const folder=path.join(ai.dir,'narae4');fs.mkdirSync(folder);for(const key of modelFiles(model))fs.writeFileSync(path.join(folder,key+'.gguf'),'test');fs.writeFileSync(path.join(folder,'installed.json'),JSON.stringify(Object.fromEntries(modelFiles(model).map(k=>[k,spec.sha256]))));assert(ai.installed(model));fs.unlinkSync(path.join(folder,'decision.gguf'));assert(!ai.installed(model));
 }finally{await ai.close();fs.rmSync(home,{recursive:true,force:true});}
});
test('old text models reject images before claiming the vision request ran',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'narae4-vision-')),ai=new LocalAI({root:path.resolve(__dirname,'..'),home});try{await assert.rejects(ai.activate('narae3',{vision:true}),e=>e.code==='LOCAL_VISION_UNSUPPORTED');}finally{await ai.close();fs.rmSync(home,{recursive:true,force:true});}
});
test('mode switches reuse in-process weight verification but changed files are rejected',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'narae4-verify-')),ai=new LocalAI({root:path.resolve(__dirname,'..'),home}),{createHash}=require('node:crypto');
 const bytes=Buffer.from('verified model bytes'),m={id:'synthetic',base:{bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}};fs.mkdirSync(path.join(ai.dir,m.id));fs.writeFileSync(ai.file(m,'base'),bytes);
 try{await ai.verifyFiles(m);await ai.verifyFiles(m);fs.writeFileSync(ai.file(m,'base'),Buffer.alloc(bytes.length,120));await assert.rejects(ai.verifyFiles(m),/SHA256/);}finally{await ai.close();fs.rmSync(home,{recursive:true,force:true});}
});
test('image read results enter the next real agent request as a vision input and not a false text observation',async()=>{
 const {runAgent}=require('../src/agent.cjs');const {readImage}=require('../src/agent-media.cjs');let requests=0;
 const image=readImage(path.join(__dirname,'../ui/assets/narae-office.png'));
 const result=await runAgent({prompt:'그림 파일을 분석해 줘.',settings:{workspace:'D:/synthetic'},history:[],signal:new AbortController().signal,send:()=>{},execute:async()=>({kind:'image',path:'D:/synthetic/picture.png',image}),request:async b=>{requests++;if(requests===1)return {output:[{type:'function_call',name:'read_image',arguments:'{"path":"D:/synthetic/picture.png"}',call_id:'image'}]};assert(b.input.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='input_image')));assert(!b.input.filter(m=>m.type==='function_call_output').some(m=>m.output.includes(image.base64)));return {output:[{type:'message',content:[{type:'output_text',text:'그림 분석 결과'}]}]};}});
 assert.equal(result,'그림 분석 결과');assert.equal(requests,2);
});
test('the planner rejects invented text blocks before the document engine is called',()=>{
 const {tools}=require('../src/agent.cjs'),{validate}=require('../src/remote-policy.cjs');const schema=tools.find(t=>t.name==='create_document').parameters;
 assert.throws(()=>validate({path:'D:/synthetic/a.hwpx',blocks:[{type:'text',text:'안내'}]},schema),/지원하지 않는/);
 assert.doesNotThrow(()=>validate({path:'D:/synthetic/a.hwpx',blocks:[{type:'paragraph',text:'안내'}]},schema));
 assert.throws(()=>validate({text:'안내'},schema),/필수 인자/);
});
test('a tracked document must actually be read live before it can be summarized, with no duplicate live retry',()=>{
 const {documentStep}=require('../src/document-task.cjs'),{tools}=require('../src/agent.cjs');
 const input=[{type:'function_call',name:'read_document',arguments:'{"path":"D:/synthetic/a.hwpx"}',call_id:'file'},{type:'function_call_output',call_id:'file',output:'{"textDetailsLoaded":false}'}];
 const step=documentStep('문서 내용을 요약해 줘.',input,tools,'D:/synthetic');assert(step.required);assert.equal(step.tools[0].name,'read_live_document');assert.deepEqual(step.tools[0].parameters.properties.path.enum,['D:/synthetic/a.hwpx']);
 input.push({type:'function_call',name:'read_live_document',arguments:'{"path":"D:/synthetic/a.hwpx"}',call_id:'live'},{type:'function_call_output',call_id:'live',output:'{"error":"현재 열린 한글을 확인하지 못했습니다."}'});
 assert.equal(documentStep('문서 내용을 요약해 줘.',input,tools,'D:/synthetic'),null);
});
test('selected saved-file edits require a fresh read and cannot invent live revisions or reread unchanged state forever',()=>{
 const {documentStep}=require('../src/document-task.cjs'),{tools}=require('../src/agent.cjs'),file='D:/synthetic/a.hwpx',prompt='회의 시간을 바꿔 줘.',input=[];
 let step=documentStep(prompt,input,tools,'D:/synthetic',false,file);assert.equal(step.tools[0].name,'read_document');assert(step.required);
 input.push({type:'function_call',name:'read_document',arguments:JSON.stringify({path:file}),call_id:'r1'},{type:'function_call_output',call_id:'r1',output:JSON.stringify({hash:'a'.repeat(64),textDetailsLoaded:true,paragraphs:[{id:'body/0',text:'15:20'}]})});
 step=documentStep(prompt,input,tools,'D:/synthetic',false,file);assert(!step.tools.some(t=>['read_document','edit_live_document'].includes(t.name)));assert.deepEqual(step.tools[0].parameters.properties.expectedHash.enum,['a'.repeat(64)]);
 input.push({type:'function_call',name:'edit_document',arguments:JSON.stringify({path:file}),call_id:'edit'},{type:'function_call_output',call_id:'edit',output:JSON.stringify({saved:true,hash:'b'.repeat(64)})});
 step=documentStep(prompt,input,tools,'D:/synthetic',false,file);assert.equal(step.tools[0].name,'read_document');assert(step.required);
});
