'use strict';
const path=require('node:path'),{spawn}=require('node:child_process');
const portal=require('./portal-login.cjs');
const fields=['certificate_name','certificate_path','storage_type','storage_name','disk_label','disk_drive'];
class CertificateSettings{
 constructor(home){this.home=home;this.saving=false;}
 request(action,cfg,input){return new Promise((resolve,reject)=>{
  // Secrets travel over stdin only; neither command arguments nor errors contain them.
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'certificate-settings.ps1'),'-Action',action,'-Region',cfg.region,...(cfg.credentialsPath?['-Path',cfg.credentialsPath]:[])],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let output='',finished=false;const fail=()=>{if(finished)return;finished=true;clearTimeout(timer);reject(new Error('인증서 설정을 처리하지 못했습니다. 현재 Windows 사용자와 보안 문서의 접근 권한을 확인하세요.'));};
  const timer=setTimeout(()=>{child.kill();fail();},20000);
  child.on('error',fail);child.stdin.on('error',()=>{});child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{output+=chunk;if(output.length>65536){child.kill();fail();}});child.stderr.resume();
  child.on('close',code=>{if(finished)return;if(code!==0)return fail();try{const value=JSON.parse(output.replace(/^\uFEFF/,''));if(value.error){finished=true;clearTimeout(timer);return reject(new Error(value.error));}finished=true;clearTimeout(timer);resolve(value);}catch{fail();}});
  child.stdin.end(input?JSON.stringify(input):'');
 });}
 async state(){const cfg=portal.config(this.home);return this.request('Read',cfg);}
 async save(input={}){
  if(this.saving)throw new Error('인증서를 저장하고 있습니다. 잠시 기다려 주세요.');
  const cfg=portal.config(this.home);
  if(input.region!==cfg.region)throw new Error('교육청 지역이 변경되었습니다. 인증서 설정을 다시 열어 주세요.');
  const value={};for(const key of fields){if(typeof input[key]!=='string'||input[key].length>2048)throw new Error('인증서 입력값을 확인하세요.');value[key]=input[key].trim();}
  if(!value.certificate_name||!value.certificate_path||!path.win32.isAbsolute(value.certificate_path))throw new Error('인증서 이름과 인증서의 절대 경로를 입력하세요.');
  if(!['HardDisk','Removable'].includes(value.storage_type))throw new Error('인증서 저장 매체를 선택하세요.');
  if(value.storage_type==='Removable'&&!value.disk_label&&!value.disk_drive)throw new Error('이동식 디스크 이름 또는 드라이브를 입력하세요.');
  if(value.storage_type==='HardDisk'){value.disk_label='';value.disk_drive='';}
  if(typeof input.password!=='string'||input.password.length>4096)throw new Error('인증서 비밀번호를 확인하세요.');
  value.password=input.password;this.saving=true;
  try{return await this.request('Save',cfg,value);}finally{value.password=null;this.saving=false;}
 }
}
module.exports={CertificateSettings};
