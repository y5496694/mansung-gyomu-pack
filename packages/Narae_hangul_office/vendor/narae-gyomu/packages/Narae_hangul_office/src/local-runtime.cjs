'use strict';
require('./network-trust.cjs').useSystemTrust();
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const {download,sha}=require('./verified-download.cjs'),exec=promisify(execFile);
async function ensureRuntime(root,{signal,progress=()=>{}}={}){
 const spec=require(path.join(root,'scripts/runtime-downloads.json')).llama;
 const dir=path.join(root,'runtime/llama'),exe=path.join(dir,'llama-server.exe');
 if(fs.existsSync(exe)&&await sha(exe)===spec.executableSha256)return exe;
 const archive=path.join(root,'cache/downloads/llama-'+spec.version+'.zip');
 await download(spec.url,archive,spec,{signal,progress});
 const stage=path.join(root,'runtime','llama-stage-'+randomUUID());fs.mkdirSync(stage,{recursive:true});
 try{
  await exec('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/expand-local-runtime.ps1'),'-Archive',archive,'-Destination',stage],{windowsHide:true,signal});
  if(await sha(path.join(stage,'llama-server.exe'))!==spec.executableSha256)throw new Error('AI 실행기 SHA256 검증에 실패했습니다.');
  // Official Python/PySide runtimes supply the Microsoft VC libraries.
  for(const name of ['msvcp140.dll','msvcp140_1.dll','msvcp140_2.dll','vcruntime140.dll','vcruntime140_1.dll','concrt140.dll']){
   const source=[path.join(root,'runtime/python/Lib/site-packages/PySide6',name),path.join(root,'runtime/python',name)].find(fs.existsSync);if(source)fs.copyFileSync(source,path.join(stage,name));
  }
  if(fs.existsSync(dir))fs.renameSync(dir,path.join(root,'runtime','llama-previous-'+randomUUID()));
  fs.renameSync(stage,dir);return exe;
 }finally{if(fs.existsSync(stage))fs.rmSync(stage,{recursive:true,force:true});}
}
module.exports={ensureRuntime};
if(require.main===module)ensureRuntime(path.resolve(__dirname,'..')).then(()=>console.log('로컬 AI 실행기 설치 완료.')).catch(error=>{console.error(error.message);process.exitCode=1;});
