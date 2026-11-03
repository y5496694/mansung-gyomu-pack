'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {CertificateSettings}=require('../src/certificate-settings.cjs'),portal=require('../src/portal-login.cjs');
test('certificate settings use real DPAPI, preserve blank edits, replace passwords and keep failed updates intact',{skip:process.platform!=='win32'},async()=>{
 const home=fs.mkdtempSync('D:/Codex/tmp/office-certificate-'),file=path.join(home,'data','synthetic.clixml'),password='synthetic secret 한글 ! $ ` &';fs.mkdirSync(path.dirname(file));fs.writeFileSync(path.join(home,'data/school-profile.json'),JSON.stringify({region:'충북',credentialsPath:file}));
 const store=new CertificateSettings(home),input={region:'충북',certificate_name:'가상 인증서',certificate_path:home,storage_type:'HardDisk',storage_name:'',disk_label:'',disk_drive:'',password};
 try{
  assert.equal((await store.state()).exists,false);await assert.rejects(store.save({...input,password:''}),/최초 등록/);assert(!fs.existsSync(file));
  let state=await store.save(input);assert.equal(state.valid,true);assert.equal(state.certificate_name,input.certificate_name);assert.equal(state.hasPassword,true);assert(!Object.hasOwn(state,'password'));assert(!JSON.stringify(state).includes(password));assert(!fs.readFileSync(file,'utf8').includes(password));
  const acl=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$a=[IO.File]::GetAccessControl($env:NARAE_TEST_PROFILE);@{protected=$a.AreAccessRulesProtected;users=@($a.Access | ForEach-Object {$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value})}|ConvertTo-Json -Compress"],{encoding:'utf8',windowsHide:true,env:{...process.env,NARAE_TEST_PROFILE:file}}));assert.equal(acl.protected,true);assert.equal(acl.users.length,2);assert(acl.users.includes('S-1-5-18'));
  state=await store.save({...input,certificate_name:'수정된 가상 인증서',password:''});assert.equal(state.certificate_name,'수정된 가상 인증서');let profile=await portal.loadProfile('ReadForBrowser',portal.config(home));assert.equal(profile.password,password);profile.password=null;
  const next='replacement synthetic password';await store.save({...input,password:next});profile=await portal.loadProfile('ReadForBrowser',portal.config(home));assert.equal(profile.password,next);profile.password=null;
  const before=fs.readFileSync(file);await assert.rejects(store.save({...input,certificate_path:path.join(home,'missing')}),/경로를 찾을 수 없습니다/);assert.deepEqual(fs.readFileSync(file),before);
  await assert.rejects(store.save({...input,region:'경기'}),/지역이 변경/);await assert.rejects(store.save({...input,storage_type:'Removable'}),/드라이브/);assert.deepEqual(fs.readFileSync(file),before);
  fs.writeFileSync(path.join(home,'data/school-profile.json'),JSON.stringify({region:'경기',credentialsPath:file}));assert.equal((await store.state()).regionMismatch,true);await assert.rejects(store.save({...input,region:'경기',password:''}),/교육청 변경/);assert.deepEqual(fs.readFileSync(file),before);
  await store.save({...input,region:'경기',storage_type:'Removable',disk_drive:'D:',password:next});assert.equal((await store.state()).regionMismatch,false);
  fs.writeFileSync(file,'invalid synthetic profile');assert.equal((await store.state()).valid,false);await store.save({...input,region:'경기'});assert.equal((await store.state()).valid,true);
  assert.equal(fs.readdirSync(path.dirname(file)).filter(n=>n.endsWith('.clixml')).length,1);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
