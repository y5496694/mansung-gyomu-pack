'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomBytes,createHash}=require('node:crypto');
const {inside,tools}=require('./agent.cjs');
const READ=new Set(['list_files','read_document','read_live_document']);
function validate(value,schema,depth=0){
 if(depth>20)throw new Error('원격 도구 인자가 너무 깊습니다.');
 if(schema.anyOf){if(!schema.anyOf.some(option=>{try{validate(value,option,depth+1);return true;}catch{return false;}}))throw new Error('지원하지 않는 변경 인자입니다.');return;}
 if(schema.enum&&!schema.enum.includes(value))throw new Error('지원하지 않는 원격 인자 값입니다.');
 if(schema.type==='object'){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('객체 인자가 필요합니다.');
  for(const required of schema.required||[])if(!Object.hasOwn(value,required))throw new Error('필수 인자가 없습니다: '+required);
  for(const key of Object.keys(value)){if(schema.additionalProperties===false&&!Object.hasOwn(schema.properties||{},key))throw new Error('허용되지 않은 원격 인자입니다: '+key);if(Object.hasOwn(schema.properties||{},key))validate(value[key],schema.properties[key],depth+1);}
 }else if(schema.type==='array'){
  if(!Array.isArray(value)||value.length>1024||(schema.minItems&&value.length<schema.minItems)||(schema.maxItems&&value.length>schema.maxItems))throw new Error('배열 인자를 확인하세요.');
  for(const item of value)validate(item,schema.items||{},depth+1);
 }else if(schema.type==='integer'){if(!Number.isSafeInteger(value))throw new Error('정수 인자가 필요합니다.');}
 else if(schema.type&&typeof value!==schema.type)throw new Error('원격 인자의 형식을 확인하세요.');
 if(typeof value==='number'&&(!Number.isFinite(value)||(schema.minimum!==undefined&&value<schema.minimum)))throw new Error('숫자 인자의 범위를 확인하세요.');
}
class RemotePolicy{
 constructor({workspace,notify=()=>{},timeout=120000,autoAllow=()=>false}){this.workspace=workspace;this.notify=notify;this.timeout=timeout;this.autoAllow=autoAllow;this.pending=null;}
 allowed(file){const root=path.resolve(this.workspace());file=path.isAbsolute(file)?path.resolve(file):path.resolve(root,file);if(!inside(root,file))throw new Error('원격 작업은 오피스 작업 폴더 안에서만 가능합니다.');let parent=file;while(!fs.existsSync(parent)){const next=path.dirname(parent);if(next===parent)throw new Error('작업 경로를 확인하세요.');parent=next;}if(!inside(fs.realpathSync(root),fs.realpathSync(parent)))throw new Error('작업 폴더 밖으로 연결된 경로는 원격으로 사용할 수 없습니다.');return file;}
 prepare(name,args){const tool=tools.find(t=>t.name===name);if(!tool||!args||typeof args!=='object'||Array.isArray(args))throw new Error('지원하지 않는 원격 도구입니다.');validate(args,tool.parameters);const copy=structuredClone(args);if(name!=='list_files'){if(typeof copy.path!=='string')throw new Error('문서 경로가 필요합니다.');copy.path=this.allowed(copy.path);}if(name==='export_pdf'){if(typeof copy.target!=='string')throw new Error('출력 경로가 필요합니다.');copy.target=this.allowed(copy.target);if(fs.existsSync(copy.target))throw new Error('PDF는 새 이름으로 저장하세요.');}if(name==='create_document'&&fs.existsSync(copy.path))throw new Error('기존 파일을 덮어쓰지 말고 새 이름으로 작성하세요.');if(copy.blocks)validate(copy.blocks,require('./hwp-file-contracts.cjs').blocks);const images=items=>{for(const item of items||[]){if(item.type==='image')item.path=this.allowed(item.path);for(const row of item.rows||[])for(const cell of row)images(cell.blocks);}};images(copy.blocks);return copy;}
 status(){return this.pending?.view||null;}
 decide({id,digest,allow}){const p=this.pending;if(!p||p.view.id!==id||p.view.digest!==digest||Date.now()>=p.view.expires)throw new Error('승인 요청이 만료됐거나 다른 작업입니다.');p.finish(allow===true);return {decided:true};}
 async approve(name,args,signal){
  if(signal?.aborted)throw new Error('작업을 중단했습니다.');if(this.pending)throw new Error('앞선 변경 승인을 기다리고 있습니다.');
  if(this.autoAllow()===true)return;
  const copy=structuredClone(args);
  await new Promise((resolve,reject)=>{const view={id:randomBytes(16).toString('hex'),name,args:copy,digest:createHash('sha256').update(JSON.stringify({name,args:copy})).digest('hex'),expires:Date.now()+this.timeout};let timer,settled=false;const denied=()=>{const e=new Error('PC에서 이 변경을 승인하지 않았습니다.');e.code='LOCAL_APPROVAL_DENIED';return e;};const abort=()=>finish(false);const finish=allow=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);this.pending=null;this.notify(null);allow?resolve():reject(denied());};this.pending={view,finish};timer=setTimeout(()=>finish(false),this.timeout);timer.unref();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)finish(false);else this.notify(view);});
  if(signal?.aborted)throw new Error('작업을 중단했습니다.');
 }
 async run(name,args,signal,execute){if(signal?.aborted)throw new Error('작업을 중단했습니다.');const copy=this.prepare(name,args);if(!READ.has(name))await this.approve(name,copy,signal);
  if(signal?.aborted)throw new Error('작업을 중단했습니다.');this.prepare(name,copy);return execute(name,copy,signal);
 }
 close(){this.pending?.finish(false);}
}
module.exports={RemotePolicy,validate};
