'use strict';
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),{spawn}=require('node:child_process'),{once}=require('node:events'),{randomBytes,randomUUID}=require('node:crypto');
const {download,verified,sha}=require('./verified-download.cjs'),{ensureRuntime}=require('./local-runtime.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function loopback(value){const u=new URL(value);if(u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash)throw new Error('로컬 AI는 http://127.0.0.1:포트/v1 같은 이 컴퓨터 주소를 사용하세요.');return u.href.replace(/\/$/,'').replace(/\/chat\/completions$/,'');}
function modelURL(model,file){if(!/^[\w.-]+\/[\w.-]+$/.test(model.repoId||'')||! /^[a-f0-9]{40}$/.test(model.revision||''))throw new Error('이 모델의 허깅페이스 배포가 아직 등록되지 않았습니다. 기존 모델 가져오기를 사용하거나 배포 정보를 갱신하세요.');return `https://huggingface.co/${model.repoId}/resolve/${model.revision}/${file.path}?download=true`;}
async function freePort(){const server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(r=>server.close(r));return port;}
function plannerSchema(tools){return {oneOf:[{type:'object',properties:{type:{const:'final'},text:{type:'string'}},required:['type','text'],additionalProperties:false},...tools.map(t=>({type:'object',properties:{type:{const:'tool'},name:{const:t.name},args:t.parameters},required:['type','name','args'],additionalProperties:false}))]};}
function shortSchema(schema,depth=0){if(!schema||depth>3)return schema?.type||'object';const out={};for(const key of ['type','enum','const','required'])if(schema[key]!==undefined)out[key]=schema[key];if(schema.properties)out.properties=Object.fromEntries(Object.entries(schema.properties).map(([key,value])=>[key,shortSchema(value,depth+1)]));if(schema.items)out.items=shortSchema(schema.items,depth+1);if(schema.anyOf)out.anyOf=schema.anyOf.map(value=>shortSchema(value,depth+1));return out;}
const fault=(code,message)=>Object.assign(new Error(message),{code});
function trimOldestTurn(messages){
 // Retain the system, the current task and the two latest action/result pairs.
 const latestUser=messages.findLastIndex(m=>m.role==='user'&&!m.content.startsWith('도구 관찰 결과:'));
 for(let i=1;i<messages.length-4;i++){
  if(i===latestUser)continue;
  const count=messages[i].role==='assistant'&&messages[i+1]?.content.startsWith('도구 관찰 결과:')?2:1;
  messages.splice(i,count);return true;
 }return false;
}
function messagesFor(body){const catalog=(body.tools||[]).map(t=>({name:t.name,description:t.description,parameters:shortSchema(t.parameters)}));const messages=[{role:'system',content:body.instructions.replace(/\\/g,'/')+'\n파일 경로는 슬래시(/)로 구분하세요. 응답은 JSON 하나입니다. 도구 실행은 {"type":"tool","name":"도구명","args":{인자}}; 작업을 마쳤거나 답변할 때는 {"type":"final","text":"한국어 답변"}입니다. 관찰된 도구 결과만 완료 근거로 사용하세요. 생략된 결과는 전체 확인으로 보고하지 마세요.\n사용 가능한 도구와 인자:\n'+JSON.stringify(catalog)}];
 for(const item of body.input||[]){let content;if(item.type==='function_call')content=JSON.stringify({type:'tool',name:item.name,args:JSON.parse(item.arguments||'{}')});else if(item.type==='function_call_output')content='도구 관찰 결과: '+item.output;else if(['user','assistant'].includes(item.role))content=typeof item.content==='string'?item.content:JSON.stringify(item.content);else continue;
  messages.push({role:item.role==='assistant'||item.type==='function_call'?'assistant':'user',content});
 }while(messages.reduce((n,m)=>n+m.content.length,0)>24000&&trimOldestTurn(messages)){}return messages;
}
function responseFrom(result,tools){const choice=result.choices?.[0];if(choice?.finish_reason!=='stop')throw new Error('로컬 AI 응답이 중단되거나 길이 한도에 도달했습니다. 요청을 나누세요.');let action;try{action=JSON.parse(choice.message.content);}catch{throw new Error('로컬 AI가 올바른 작업 JSON을 반환하지 않았습니다.');}
 if(action.type==='final'&&typeof action.text==='string'&&action.text.trim())return {output:[{type:'message',role:'assistant',content:[{type:'output_text',text:action.text}]}]};
 if(action.type!=='tool'||!tools.some(t=>t.name===action.name)||!action.args||typeof action.args!=='object'||Array.isArray(action.args))throw new Error('로컬 AI의 도구 선택을 확인할 수 없습니다.');
 const schema=tools.find(t=>t.name===action.name).parameters;if(schema)require('./remote-policy.cjs').validate(action.args,schema);
 return {output:[{type:'function_call',name:action.name,arguments:JSON.stringify(action.args),call_id:randomUUID()}]};
}
class LocalAI{
 constructor({root,home,notify=()=>{},catalog,fetchImpl=fetch}){this.root=root;this.home=home;this.catalog=catalog||require(path.join(root,'resources/local-models.json'));this.fetch=fetchImpl;this.notify=notify;this.configFile=path.join(home,'data/local-ai.json');let saved={};try{saved=JSON.parse(fs.readFileSync(this.configFile,'utf8'));}catch{}this.autoStart=saved.autoStart!==false;this.dir=process.env.NARAE_AI_MODELS||(typeof saved.directory==='string'&&path.isAbsolute(saved.directory)?saved.directory:path.join(home,'models'));fs.mkdirSync(this.dir,{recursive:true});this.active=null;this.child=null;this.busy=null;this.progress=null;this.error='';this.closed=false;}
 saveConfig(next){const temp=this.configFile+'.'+randomUUID()+'.tmp';fs.mkdirSync(path.dirname(this.configFile),{recursive:true});try{fs.writeFileSync(temp,JSON.stringify(next,null,2));fs.renameSync(temp,this.configFile);}finally{fs.rmSync(temp,{force:true});}this.dir=next.directory;this.autoStart=next.autoStart;this.changed();return this.status();}
 configure({directory=this.dir,autoStart=this.autoStart}={}){if(this.busy||this.child)throw new Error('실행 중인 AI를 먼저 중지하세요.');if(typeof directory!=='string'||!path.isAbsolute(directory))throw new Error('모델 저장 폴더는 절대 경로여야 합니다.');directory=path.resolve(directory);fs.mkdirSync(directory,{recursive:true});return this.saveConfig({directory,autoStart:Boolean(autoStart)});}
 setAutoStart(value){return this.saveConfig({directory:this.dir,autoStart:Boolean(value)});}
 model(id){const m=this.catalog.models.find(m=>m.id===id);if(!m)throw new Error('나래1·나래2·나래3 중 선택하세요.');return m;}
 file(m,key){return path.join(this.dir,m.id,key+'.gguf');}
 installed(m){try{const marker=JSON.parse(fs.readFileSync(path.join(this.dir,m.id,'installed.json'),'utf8'));return ['base','adapter'].every(k=>marker[k]===m[k].sha256&&fs.statSync(this.file(m,k)).size===m[k].bytes);}catch{return false;}}
 status(){return {active:this.active?.id||null,busy:this.busy,progress:this.progress,error:this.error,directory:this.dir,autoStart:this.autoStart,models:this.catalog.models.map(m=>({id:m.id,label:m.label,alias:m.alias,size:m.size,note:m.note,license:m.license,researchOnly:m.researchOnly,experimental:m.experimental,recommended:m.id===this.catalog.recommended,bytes:m.base.bytes+m.adapter.bytes,installed:this.installed(m),published:Boolean(m.repoId&&m.revision),repoId:m.repoId}))};}
 changed(){this.notify({type:'localAI',localAI:this.status()});}
 async install(id,{researchAccepted=false,source}={}){
  if(this.busy)throw new Error('다른 AI 설치 또는 전환을 기다리세요.');const m=this.model(id);if(m.researchOnly&&!researchAccepted)throw new Error('나래2의 EXAONE 연구·평가용 이용조건을 확인하세요.');
  this.busy=id;this.abort=new AbortController();this.error='';this.changed();
  try{for(const key of ['base','adapter']){const file=this.file(m,key),spec=m[key];this.progress={id,key,received:0,total:spec.bytes};this.changed();
    if(source){const input=path.join(source,spec.path);if(!await verified(input,spec))throw new Error('기존 '+key+' 모델의 크기·SHA256이 다릅니다.');fs.mkdirSync(path.dirname(file),{recursive:true});const part=file+'.'+randomUUID()+'.part';try{fs.copyFileSync(input,part);if(!await verified(part,spec))throw new Error('모델 복사 검증에 실패했습니다.');fs.renameSync(part,file);}finally{fs.rmSync(part,{force:true});}}
    else await download(modelURL(m,spec),file,spec,{signal:this.abort.signal,fetchImpl:this.fetch,progress:(received,total)=>{this.progress={id,key,received,total};this.changed();}});
   }
   fs.writeFileSync(path.join(this.dir,id,'installed.json'),JSON.stringify({base:m.base.sha256,adapter:m.adapter.sha256,researchAccepted:m.researchOnly?true:undefined}));
  }catch(error){this.error=error.message;throw error;}finally{this.busy=null;this.abort=null;this.progress=null;this.changed();}return this.status();
 }
 async stop(){const child=this.child;this.child=null;this.active=null;this.url=null;this.key=null;if(child&&child.exitCode===null&&child.signalCode===null){child.kill();await Promise.race([once(child,'exit').catch(()=>{}),pause(5000)]);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}this.changed();}
 async activate(id){if(this.activation){if(this.activation.id===id)return this.activation.promise;throw new Error('AI 설치·전환을 기다리세요.');}const promise=this.startModel(id);this.activation={id,promise};try{return await promise;}finally{this.activation=null;}}
 async startModel(id){if(this.closed)throw new Error('AI 실행기가 종료됐습니다.');if(this.busy)throw new Error('AI 설치·전환을 기다리세요.');if(this.active?.id===id)return this.status();const m=this.model(id);if(!this.installed(m))throw new Error('모델을 먼저 설치하세요.');this.busy=id;this.error='';this.changed();
  try{await this.stop();for(const key of ['base','adapter'])if(!await verified(this.file(m,key),m[key]))throw new Error('설치된 모델 SHA256이 다릅니다. 다시 설치하세요.');
   const exe=await ensureRuntime(this.root),port=await freePort();if(this.closed)throw new Error('작업을 종료했습니다.');this.key=randomBytes(24).toString('hex');this.url='http://127.0.0.1:'+port+'/v1';
   const logs=path.join(this.home,'logs');fs.mkdirSync(logs,{recursive:true});const log=fs.openSync(path.join(logs,'local-ai-'+id+'.log'),'a');
   const child=spawn(exe,['--model',this.file(m,'base'),'--lora',this.file(m,'adapter'),'--alias',m.alias,'--host','127.0.0.1','--port',String(port),'--api-key',this.key,'--threads','6','--threads-batch','6','--ctx-size','8192','--parallel','1','--no-context-shift','--no-warmup','--no-webui','--chat-template-kwargs','{"enable_thinking":false}'],{windowsHide:true,stdio:['ignore',log,log]});fs.closeSync(log);this.child=child;let spawnError;child.on('error',e=>{spawnError=e;});child.once('exit',()=>{if(this.child===child){this.child=null;this.active=null;this.changed();}});
   const deadline=Date.now()+180000;for(;;){if(spawnError)throw spawnError;if(this.closed||this.child!==child||child.exitCode!==null||child.signalCode!==null)throw new Error('로컬 AI 실행기가 종료됐습니다. 로그를 확인하세요.');try{const health=await this.api(this.url.replace(/\/v1$/,'')+'/health',undefined,undefined,1500);if(health.status==='ok')break;}catch{}if(Date.now()>deadline)throw new Error('AI 시작 시간이 초과되었습니다.');await pause(250);}
   const adapters=await this.api(this.url.replace(/\/v1$/,'')+'/lora-adapters');if(adapters.length!==1||path.resolve(adapters[0].path)!==path.resolve(this.file(m,'adapter'))||adapters[0].scale!==m.strength)throw new Error('실행 중인 나래 학습 어댑터가 다릅니다.');
   const list=await this.api(this.url+'/models');if(!list.data?.some(x=>x.id===m.alias))throw new Error('실행 중인 AI 이름이 다릅니다.');this.active=m;
  }catch(error){this.error=error.message;await this.stop();throw error;}finally{this.busy=null;this.changed();}return this.status();
 }
 async api(url,body,signal,timeout=180000,managed=true){let response;try{response=await this.fetch(url,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(managed&&this.key?{authorization:'Bearer '+this.key}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(timeout)])});}catch(error){if(error.name==='TimeoutError')throw fault('LOCAL_AI_TIMEOUT','로컬 AI 응답 시간이 초과되었습니다. 마지막 화면에서 이어서 요청하세요.');throw error;}if(!response.ok){const raw=(await response.text()).slice(0,16000);if(/context|n_ctx|too (?:long|large)|exceed.*token/i.test(raw))throw fault('LOCAL_CONTEXT_LIMIT','현재 화면과 대화가 모델 문맥 한도를 넘었습니다. 화면을 좁혀 다시 요청하세요.');throw fault('LOCAL_AI_HTTP','로컬 AI 서버 응답 오류 ('+response.status+')');}return response.json();}
 async fitMessages(messages,signal){
  for(;;){const template=await this.api(this.url.replace(/\/v1$/,'')+'/apply-template',{messages},signal,15000);const tokens=await this.api(this.url.replace(/\/v1$/,'')+'/tokenize',{content:template.prompt,add_special:true},signal,15000);if(!Array.isArray(tokens.tokens))throw fault('LOCAL_TOKENIZER','로컬 모델 토큰 수를 확인할 수 없습니다.');if(tokens.tokens.length<=6000)return messages;if(!trimOldestTurn(messages))throw fault('LOCAL_CONTEXT_LIMIT','현재 화면이 너무 큽니다. snapshot의 filter나 limit으로 필요한 항목만 조회하세요.');}
 }
 async listModels(settings){if(settings.localSource!=='external')return this.catalog.models.map(m=>({id:m.id,name:m.label}));const data=await this.api(loopback(settings.endpoint)+'/models',undefined,undefined,15000,false);if(!Array.isArray(data.data))throw new Error('로컬 서버 모델 목록을 확인하세요.');return data.data.map(m=>({id:m.id,name:m.id}));}
 async request({settings,body,signal}){let url,model,managed=settings.localSource!=='external';if(managed){await this.activate(settings.model);url=this.url;model=this.active.alias;}else{url=loopback(settings.endpoint);model=settings.model;}
  const prior=(body.input||[]).filter(i=>i.type==='function_call'),last=prior.at(-1),tools=structuredClone((body.tools||[]).filter(t=>!(last?.name==='list_files'&&t.name==='list_files')));
  const user=(body.input||[]).findLast(i=>i.role==='user'),names=typeof user?.content==='string'?[...user.content.matchAll(/["“]([^"“”\r\n]+\.(?:hwpx|hwp))["”]/gi)]:[];
  if(settings.workspace&&names.length===1&&path.basename(names[0][1])===names[0][1]){const create=tools.find(t=>t.name==='create_document');if(create?.parameters?.properties?.path)create.parameters.properties.path.enum=[path.join(settings.workspace,names[0][1]).replaceAll('\\','/')];}
  const messages=messagesFor({...body,tools});if(managed)await this.fitMessages(messages,signal);
  const result=await this.api(url+'/chat/completions',{model,messages,temperature:0,seed:719,max_tokens:2048,stream:false,response_format:{type:'json_schema',json_schema:{name:'narae_action',schema:plannerSchema(tools)}}},signal,180000,managed);
  if(result.model!==model)throw new Error('요청과 다른 로컬 모델의 응답입니다.');const response=responseFrom(result,tools),next=response.output[0];let readOnly=false;if(next.name==='gyomu_browser')readOnly=['snapshot','read','tabs','frames','wait'].includes(JSON.parse(next.arguments).action);if(next.type==='function_call'&&!readOnly&&prior.slice(-2).length===2&&prior.slice(-2).every(i=>i.name===next.name&&i.arguments===next.arguments))throw fault('LOCAL_REPEATED_ACTION','로컬 AI가 같은 작업을 반복해 중지했습니다. 마지막 확인 화면에서 이어서 요청하세요.');return response;
 }
 cancelInstall(){this.abort?.abort();}
 async close(){this.closed=true;this.cancelInstall();await this.stop();}
}
module.exports={LocalAI,loopback,modelURL,plannerSchema,messagesFor,responseFrom,trimOldestTurn};
