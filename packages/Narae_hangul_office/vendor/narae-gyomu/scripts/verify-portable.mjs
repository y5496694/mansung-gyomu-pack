import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
const ROOT='D:/Codex/apps/NaraeGyomu',APP=ROOT+'/resources/app',EXE=ROOT+'/NaraeGyomu.exe';
const DATA=fs.mkdtempSync('D:/Codex/tmp/gyomu-portable-');
const env={...process.env,ELECTRON_RUN_AS_NODE:'1',NARAE_GYOMU_DATA:DATA,NARAE_GYOMU_PORT:'0',TEMP:DATA,TMP:DATA};
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sources={};for(const folder of ['src','web','desktop','bin'])for(const name of fs.readdirSync(APP+'/'+folder))sources[folder+'/'+name]=hash(APP+'/'+folder+'/'+name);
async function cli(args){return new Promise((resolve,reject)=>{
  const child=spawn(EXE,[APP+'/bin/narae-gyomu.mjs',...args],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
  child.on('error',reject);child.on('exit',code=>{if(code!==0)return reject(new Error(err || out));try{resolve(JSON.parse(out));}catch(e){reject(new Error(out+'\n'+err));}});
});}
const results=[];let previousPid;
try{
  const doctor=await cli(['doctor']);
  if(path.resolve(doctor.home)!==path.resolve(ROOT) || path.resolve(doctor.app)!==path.resolve(APP))throw new Error('Relocated CLI used development paths');
  const created=await cli(['tool','call','hangul.create','--args',JSON.stringify({title:'배포본 검증',body:'기제출자는 재제출하지 않습니다.',format:'hwp',filename:'배포본확인.hwp'})]);
  if(!created.success || !created.modeled_content_verified)throw new Error('Portable HWP create failed');
  const wxs=await cli(['tool','call','wxs','--args','{"operation":"doctor"}']);
  if(!wxs.dependencies.pythoncom)throw new Error('Portable WXS dependency missing');
  for(const id of ['narae1','narae2','narae3']){
    console.log(JSON.stringify({stage:'activating',id,data:DATA}),true);
    await cli(['models','activate',id]);
    const session=JSON.parse(fs.readFileSync(DATA+'/model-session.json','utf8'));
    if(previousPid){let alive=true;try{process.kill(previousPid,0);}catch{alive=false;}if(alive)throw new Error('Two model processes are alive');}
    previousPid=session.pid;
    const job=await cli(['chat','도구 상태를 실제로 확인해줘','--json']);
    const called=job.events.some(e=>e.type==='observation' && e.name==='system.status' && e.result.ok);
    if(!called || job.status!=='completed')throw new Error('Actual model status tool did not complete: '+id);
    results.push({id,alias:session.alias,pid:session.pid,baseSha256:session.baseSha256,adapterSha256:session.adapterSha256,
      loaded:session.loaded,status:job.status,completionMode:job.completionMode,jobId:job.id,events:job.events});
    console.log(JSON.stringify({stage:'completed',id}));
  }
  const doc=await cli(['chat','나래한글로 HWPX 파일을 만들어줘. 제목: 가상 연수 안내. 본문은 다음 한 문장을 그대로 써줘: 기제출자는 재제출하지 않습니다. 파일명: 배포AI작성.hwpx','--json']);
  if(doc.status!=='completed')throw new Error('Portable actual model document creation failed');
  const inspect=await cli(['tool','call','hangul.inspect','--args',JSON.stringify({path:DATA+'/outputs/배포AI작성.hwpx'})]);
  if(!inspect.paragraphs.some(p=>p.text==='기제출자는 재제출하지 않습니다.'))throw new Error('Requested body was not preserved');
  for(const [file,digest] of Object.entries(sources))if(hash(APP+'/'+file)!==digest)throw new Error('Sources changed during verification: '+file);
  const report={type:'Relocated portable executable + real learned models + actual CLI; not a benchmark score',
    executable:EXE,node:doctor.node,data:DATA,sources,models:results,
    document:{jobId:doc.id,status:doc.status,bodyPreserved:true,events:doc.events},
    portablePythonHwpVerified:true,wxsPrerequisitesVerified:true,singleOwnedModelVerified:true,
    liveSchoolServiceActions:0,actualMessagesSent:0};
  fs.writeFileSync('verification/portable-models.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({verified:true,models:results.length,document:true,data:DATA}));
}finally{await cli(['shutdown']).catch(()=>{});}
