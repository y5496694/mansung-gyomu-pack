'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
async function sha(file){const hash=createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');}
async function verified(file,spec){try{return fs.statSync(file).size===spec.bytes&&await sha(file)===spec.sha256;}catch{return false;}}
async function download(url,file,spec,{signal,progress=()=>{},fetchImpl=fetch}={}){
 if(!/^[a-f0-9]{64}$/.test(spec.sha256)||!Number.isSafeInteger(spec.bytes)||spec.bytes<=0)throw new Error('다운로드 무결성 정보가 없습니다.');
 if(await verified(file,spec))return file;
 fs.mkdirSync(path.dirname(file),{recursive:true});const part=file+'.'+randomUUID()+'.part';let output;
 try{
  const response=await fetchImpl(url,{signal,redirect:'follow'});if(!response.ok||!response.body)throw new Error('다운로드 서버 오류 ('+response.status+')');
  const length=response.headers.get('content-length');if(length&&Number(length)!==spec.bytes)throw new Error('다운로드 크기가 배포 정보와 다릅니다.');
  output=fs.openSync(part,'wx');const hash=createHash('sha256');let received=0,last=0;
  for await(const chunk of response.body){if(signal?.aborted)throw new Error('다운로드를 취소했습니다.');received+=chunk.length;if(received>spec.bytes)throw new Error('배포 크기를 초과했습니다.');fs.writeSync(output,chunk);hash.update(chunk);if(Date.now()-last>250){progress(received,spec.bytes);last=Date.now();}}
  fs.closeSync(output);output=undefined;if(received!==spec.bytes||hash.digest('hex')!==spec.sha256)throw new Error('다운로드 SHA256 검증에 실패했습니다.');
  fs.renameSync(part,file);progress(received,spec.bytes);return file;
 }finally{if(output!==undefined)fs.closeSync(output);fs.rmSync(part,{force:true});}
}
module.exports={sha,verified,download};
