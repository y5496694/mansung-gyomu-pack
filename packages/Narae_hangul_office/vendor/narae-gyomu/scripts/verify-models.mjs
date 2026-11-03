import fs from 'node:fs';
import path from 'node:path';
process.env.NARAE_GYOMU_DATA=fs.mkdtempSync('D:/Codex/tmp/gyomu-real-ai-');
const {DATA,HOME,writeJSON}=await import('../src/paths.mjs');
const {createApp}=await import('../src/server.mjs');
const app=await createApp({port:0,headed:false});
const results=[],pids=[];
try {
  for(const id of ['narae1','narae2','narae3']) {
    console.log(JSON.stringify({stage:'activating',id,data:DATA}),true);
    await app.models.activate(id);
    const pid=app.models.child.pid;
    if(pids.length) {
      let previousAlive=true;try{process.kill(pids.at(-1),0);}catch{previousAlive=false;}
      if(previousAlive)throw new Error('Previous model still running');
    }
    pids.push(pid);
    const job=app.agent.start('설치된 도구의 상태를 system.status로 실제 조회하고 확인한 내용을 알려줘.');
    while(app.agent.current)await new Promise(r=>setTimeout(r,200));
    const observations=job.events.filter(e=>e.type==='observation');
    const verified=observations.some(e=>e.name==='system.status' && e.result.ok);
    const result={id,pid,status:job.status,actualStatusToolUsed:verified,jobId:job.id,
      answer:job.answer,error:job.error,events:job.events};
    results.push(result);writeJSON(path.join(DATA,'real-ai-verification.json'),{scope:'Actual model switching and harmless local status tool; no school service actions',results});
    console.log(JSON.stringify({stage:'completed',id,status:job.status,actualStatusToolUsed:verified}));
  }
  const doc=app.agent.start('나래한글로 HWPX 파일을 만들어줘. 제목: 가상 연수 안내. 본문은 다음 한 문장을 그대로 써줘: 기제출자는 재제출하지 않습니다. 파일명: AI작성확인.hwpx');
  while(app.agent.current)await new Promise(r=>setTimeout(r,200));
  writeJSON(path.join(DATA,'real-document-verification.json'),doc);
  console.log(JSON.stringify({stage:'document',status:doc.status,answer:doc.answer,error:doc.error}));
  const summary={scope:'Actual three weight-trained local models and owned-process switching; not benchmark scores',
    data:DATA,home:HOME,results:results.map(({events,...r})=>r),
    singleOwnedModelVerified:true,documentJob:{id:doc.id,status:doc.status,answer:doc.answer,error:doc.error},
    liveSchoolServiceActions:0,actualMessageSends:0,weightTrainingPerformed:false};
  writeJSON(path.join(DATA,'summary.json'),summary);
  fs.mkdirSync(path.join(HOME,'verification'),{recursive:true});
  writeJSON(path.join(HOME,'verification/local-model-smoke.json'),summary);
}finally{await app.shutdown();}
