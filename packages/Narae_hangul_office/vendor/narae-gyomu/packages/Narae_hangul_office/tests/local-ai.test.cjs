const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{createHash}=require('node:crypto');
const {download}=require('../src/verified-download.cjs'),{LocalAI,loopback,responseFrom}=require('../src/local-ai.cjs'),connections=require('../src/connection-settings.cjs');
test('verified downloads reject partial/corrupt files and retain existing complete files',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'narae-download-')),file=path.join(home,'model.gguf'),bytes=Buffer.from('실제 가중치 대신 합성 바이트'),spec={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 try{await download('synthetic',file,spec,{fetchImpl:async()=>new Response(bytes)});assert.deepEqual(fs.readFileSync(file),bytes);await download('synthetic',file,spec,{fetchImpl:async()=>{throw new Error('must reuse');}});fs.writeFileSync(file,'broken');await assert.rejects(download('synthetic',file,spec,{fetchImpl:async()=>new Response(Buffer.alloc(bytes.length))}),/SHA256/);assert.equal(fs.readFileSync(file,'utf8'),'broken');assert(!fs.readdirSync(home).some(p=>p.endsWith('.part')));}finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('local settings do not reuse OAuth, cloud keys or cloud endpoints',()=>{
 const cloud=connections.normalize({});const local=connections.update(cloud,{provider:'local',model:'narae1'});assert.equal(local.connectionMode,'local');assert.match(local.endpoint,/127.0.0.1/);assert.equal(connections.update(local,{provider:'openai'}).connectionMode,'oauth');assert.throws(()=>loopback('http://example.com/v1'));assert.throws(()=>loopback('https://127.0.0.1/v1'));assert.throws(()=>loopback('http://user:secret@127.0.0.1/v1'));
});
test('managed models and other local server settings survive provider switches and restart independently',()=>{
 const legacy={provider:'local',localSource:'managed',connectionMode:'local',aiConnections:{'local:local':{endpoint:'http://127.0.0.1:11434/v1',model:'narae1'}}};
 let current=connections.normalize(legacy);current=connections.update(current,{provider:'local',localSource:'external',endpoint:'http://127.0.0.1:12345/v1',model:'server-model'});
 current=connections.update(current,{provider:'openai',connectionMode:'api',model:'gpt-test'});current=connections.update(current,{provider:'local',localSource:'managed'});assert.equal(current.model,'narae1');assert(!current.endpoint.includes('12345'));
 current=connections.normalize(JSON.parse(JSON.stringify(current)));current=connections.update(current,{provider:'local',localSource:'external'});assert.equal(current.model,'server-model');assert.equal(current.endpoint,'http://127.0.0.1:12345/v1');
 assert.equal(connections.update(current,{provider:'openai',connectionMode:'api'}).model,'gpt-test');assert.equal(legacy.aiConnections['local:local'].model,'narae1');
});
test('Narae3 recommendation does not select a model or change an existing model preference',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'narae-recommended-'));try{const ai=new LocalAI({root:path.resolve(__dirname,'..'),home});assert.deepEqual(ai.status().models.filter(m=>m.recommended).map(m=>m.id),['narae3']);assert.equal(ai.status().active,null);assert.equal(connections.normalize({}).provider,'openai');const chosen=connections.update(connections.normalize({}),{provider:'local',model:'narae1'});assert.equal(connections.normalize(chosen).model,'narae1');await ai.close();}finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('local planner refuses truncation and unknown tools instead of claiming completion',()=>{
 const result=content=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]});assert.equal(responseFrom(result({type:'tool',name:'read_document',args:{path:'a.hwpx'}}),[{name:'read_document'}]).output[0].name,'read_document');assert.throws(()=>responseFrom(result({type:'tool',name:'shell',args:{}}),[]));assert.throws(()=>responseFrom({choices:[{finish_reason:'length'}]},[]));
});
test('only a single explicit local creation may finish from a verified engine result',()=>{
 const {localCreationResult}=require('../src/agent.cjs'),settings={provider:'local'},calls=[{}],result={modeledContentVerified:true,path:'결과.hwpx'};
 assert.match(localCreationResult('결과.hwpx를 새로 만들어 주세요',settings,calls,'create_document',result),/결과.hwpx/);
 assert.equal(localCreationResult('결과.hwpx 작성 후 PDF도 만들어 주세요',settings,calls,'create_document',result),null);
 assert.equal(localCreationResult('결과.hwpx를 새로 만들어 주세요',settings,calls,'create_document',{path:'결과.hwpx'}),null);
});
test('external local server runs the same planner without cloud credentials',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'narae-local-'));let observed;
 const server=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;observed=JSON.parse(raw);assert(!req.headers.authorization);res.setHeader('content-type','application/json');res.end(JSON.stringify({model:'synthetic',choices:[{finish_reason:'stop',message:{content:'{"type":"final","text":"로컬 응답"}'}}]}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const ai=new LocalAI({root:path.resolve(__dirname,'..'),home});const result=await ai.request({settings:{localSource:'external',endpoint:'http://127.0.0.1:'+server.address().port+'/v1',model:'synthetic'},body:{instructions:'한글 작성',input:[{role:'user',content:'안녕'}],tools:[]}});assert.equal(result.output[0].content[0].text,'로컬 응답');assert.equal(observed.response_format.type,'json_schema');await ai.close();}finally{await new Promise(r=>server.close(r));fs.rmSync(home,{recursive:true,force:true});}
});
test('local planner does not repeat file listing and stops repeated writes',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'narae-repeat-'));let body;
 const tools=[{name:'list_files',parameters:{type:'object',properties:{}}},{name:'create_document',parameters:{type:'object',properties:{path:{type:'string'}}}}];
 const ai=new LocalAI({root:path.resolve(__dirname,'..'),home,fetchImpl:async(_url,req)=>{body=JSON.parse(req.body);return new Response(JSON.stringify({model:'synthetic',choices:[{finish_reason:'stop',message:{content:'{"type":"tool","name":"create_document","args":{"path":"a.hwpx"}}'}}]}));}});
 const settings={localSource:'external',endpoint:'http://127.0.0.1:12345/v1',model:'synthetic'},call={type:'function_call',name:'create_document',arguments:'{"path":"a.hwpx"}'};
 try{await ai.request({settings,body:{instructions:'작성',tools,input:[{role:'user',content:'새 문서'},{type:'function_call',name:'list_files',arguments:'{}'},{type:'function_call_output',output:'[]'}]}});assert(!body.response_format.json_schema.schema.oneOf.some(s=>s.properties?.name?.const==='list_files'));await assert.rejects(ai.request({settings,body:{instructions:'작성',tools,input:[call,call]}}),/반복/);}finally{await ai.close();fs.rmSync(home,{recursive:true,force:true});}
});
