'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{isDeepStrictEqual}=require('node:util');
const {pointer}=require('./office-benchmark.cjs');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
class ModelReliability{
 constructor({home,catalog}){this.file=path.join(home,'data/model-reliability.json');this.catalog=catalog;}
 document(){if(!fs.existsSync(this.file))return {schema:1,records:[]};const value=JSON.parse(fs.readFileSync(this.file,'utf8'));if(value.schema!==1||!Array.isArray(value.records)||value.records.length>2000)throw Error('실제 수행 기록 형식을 확인하세요.');return value;}
 read(){return this.document().records;}
 validate(record){
  const model=this.catalog.models.find(m=>m.id===record?.model);
  if(!model||typeof record.id!=='string'||!record.id||record.id.length>160||!['live-service','real-file'].includes(record.environment)||!['work','service-test'].includes(record.kind)||!['success','failure','partial','unverified','cancelled'].includes(record.outcome)||!Number.isFinite(Date.parse(record.at)))throw Error('모델·실제 환경·수행 결과를 확인하세요.');
  for(const key of ['title','verification'])if(typeof record[key]!=='string'||!record[key].trim()||record[key].length>8000)throw Error('업무 제목과 결과 확인 근거가 필요합니다.');
  for(const [key,limit]of [['prompt',50000],['response',250000]])if(record[key]!==null&&(typeof record[key]!=='string'||!record[key].trim()||record[key].length>limit))throw Error('요청·응답 원문 또는 null이 필요합니다.');
  if(record.responseKind!==undefined&&!['assistant','tool-error','unavailable'].includes(record.responseKind))throw Error('응답 원문의 종류를 확인하세요.');
  if(!Array.isArray(record.proofs)||record.proofs.length>20)throw Error('원본 근거 목록이 필요합니다.');
  return model;
 }
 verify(record,cache){
  const model=this.validate(record);if(record.modelAlias!==model.alias||record.adapterSha256!==model.adapter.sha256)throw Error('현재 배포 모델의 가중치와 다른 기록입니다.');
  if(!record.proofs.length)throw Error('실행 결과 원본 근거가 없습니다.');
  const observedText=new Set();for(const proof of record.proofs){
   if(typeof proof.file!=='string'||!path.isAbsolute(proof.file)||!/^[a-f0-9]{64}$/.test(proof.sha256)||!Array.isArray(proof.checks)||!proof.checks.length)throw Error('원본 경로·해시·검사 항목이 필요합니다.');
   let original=cache.get(proof.file);if(!original){const stat=fs.statSync(proof.file);if(!stat.isFile()||stat.size>20*1024*1024)throw Error('원본 근거 파일 크기를 확인하세요.');const bytes=fs.readFileSync(proof.file);original={hash:sha(bytes),value:JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''))};cache.set(proof.file,original);}
   if(original.hash!==proof.sha256)throw Error('원본 근거가 변경됐습니다.');
   if(original.value.syntheticOnly===true||original.value.synthetic===true||original.value.environment==='synthetic')throw Error('가상·모의 수행 기록은 집계하지 않습니다.');
   for(const check of proof.checks){if(!Object.hasOwn(check,'expected')||!isDeepStrictEqual(pointer(original.value,check.pointer),check.expected))throw Error('원본 근거의 검사 값이 다릅니다.');if(typeof check.expected==='string')observedText.add(check.expected);}
  }
  if(record.prompt!==null&&!observedText.has(record.prompt))throw Error('요청 원문을 원본 근거에서 확인하지 못했습니다.');
  if(record.response!==null&&!observedText.has(record.response))throw Error('응답 원문을 원본 근거에서 확인하지 못했습니다.');
 }
 status(id){
  const model=this.catalog.models.find(m=>m.id===id);if(!model)throw Error('등록된 나래 모델을 선택하세요.');
  const cache=new Map();let records,error;try{records=this.read();}catch(e){records=[];error=e.message;}
  const seen=new Set(),rows=[];
  for(const record of records.filter(r=>r?.model===id)){
   if(seen.has(record.id))continue;seen.add(record.id);if(!['live-service','real-file'].includes(record.environment))continue;
   let verified=true,reason;try{this.verify(record,cache);}catch(e){verified=false;reason=e.message;}
   rows.push({id:record.id,at:record.at,title:record.title,prompt:record.prompt??null,response:record.response??null,responseKind:record.responseKind||(record.response===null?'unavailable':'assistant'),kind:record.kind,environment:record.environment,outcome:verified?record.outcome:'unverified',verification:record.verification,evidenceVerified:verified,reason,sourceCount:record.proofs?.length||0,modelAlias:record.modelAlias,adapterSha256:record.adapterSha256});
  }
  rows.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
  const success=rows.filter(r=>r.outcome==='success').length,failure=rows.filter(r=>['failure','partial'].includes(r.outcome)).length,total=success+failure;
  return {id,label:model.label,modelAlias:model.alias,success,failure,total,unverified:rows.filter(r=>r.outcome==='unverified').length,cancelled:rows.filter(r=>r.outcome==='cancelled').length,percent:total?Math.round(success/total*1000)/10:null,records:rows,error,rule:'성공 ÷ (성공 + 실패·부분 완료) × 100. 요청 한 건을 한 번 집계합니다. 실서비스 시험과 실행기 수정 전 시도도 포함합니다. 가상·모의 시험과 미확인·취소·근거 불일치는 제외합니다. 모델·결과 근거가 없는 이전 대화는 집계하지 않습니다. 이 PC의 확인 가능한 기록이며 일반 정확도나 미래 성공 확률은 아닙니다.'};
 }
 summaries(){return this.catalog.models.map(m=>{const {records,...summary}=this.status(m.id);return summary;});}
 import(value){
  if(value?.schema!==1||!Array.isArray(value.records)||value.records.length>2000)throw Error('schema: 1 실제 수행 기록을 선택하세요.');
  const previous=this.document(),records=previous.records,removed=new Set(previous.removedIds||[]),byId=new Map(records.map(r=>[r.id,r])),cache=new Map();
  for(const record of value.records){if(removed.has(record.id))throw Error('사용자가 삭제한 이전 수행 기록은 다시 등록하지 않습니다.');this.validate(record);this.verify(record,cache);byId.set(record.id,record);}
  const next={...previous,schema:1,records:[...byId.values()]};if(next.records.length>2000)throw Error('실제 수행 기록은 2,000건까지 보관합니다.');
  fs.mkdirSync(path.dirname(this.file),{recursive:true});const temp=this.file+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(next,null,2),{mode:0o600});fs.renameSync(temp,this.file);return this.summaries();
 }
}
module.exports={ModelReliability};
