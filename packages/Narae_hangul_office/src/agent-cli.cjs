'use strict';
// Headless entry to the same local agent and school integrations as the app.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {runAgent,inside}=require('./agent.cjs'),{LocalAI}=require('./local-ai.cjs');
const {RemotePolicy}=require('./remote-policy.cjs'),{OfficeIntegrations}=require('./office-integrations.cjs');
const root=path.resolve(__dirname,'..'),talkTools=require('./talk-store.cjs');
function defaultHome(){return process.env.NARAE_OFFICE_HOME||(process.platform==='win32'?(fs.existsSync('D:/Codex')?'D:/Codex/narae-data/office':path.join(process.env.LOCALAPPDATA||os.homedir(),'NaraeHangulOffice')):path.join(os.homedir(),'.local/share/NaraeHangulOffice'));}
function config(job,base=process.cwd()){
 if(!job||typeof job!=='object'||Array.isArray(job))throw Error('에이전트 작업 JSON은 객체여야 합니다.');
 if(typeof job.prompt!=='string'||!job.prompt.trim()||job.prompt.length>4000)throw Error('prompt를 1~4000자로 입력하세요.');
 if(typeof job.workspace!=='string'||!job.workspace.trim())throw Error('workspace 작업 폴더를 지정하세요.');
 if(job.allowChanges!==undefined&&typeof job.allowChanges!=='boolean')throw Error('allowChanges는 boolean이어야 합니다.');
 if(job.schema!==undefined&&job.schema!==1)throw Error('schema: 1만 지원합니다.');
 if(job.save!==undefined&&typeof job.save!=='boolean')throw Error('save는 boolean이어야 합니다.');
 if(job.model!==undefined&&!['narae1','narae2','narae3','narae4'].includes(job.model))throw Error('설치된 나래 로컬 모델을 지정하세요.');
 if(job.history!==undefined&&(!Array.isArray(job.history)||job.history.length>12||job.history.some(m=>!m||!['user','assistant'].includes(m.role)||typeof m.content!=='string'||m.content.length>8000)))throw Error('history는 user/assistant 대화 12개 이하여야 합니다.');
 const workspace=path.resolve(base,job.workspace);if(!fs.statSync(workspace).isDirectory())throw Error('workspace는 기존 폴더여야 합니다.');
 let context;if(job.context!==undefined){if(typeof job.context!=='string'||!job.context.trim())throw Error('context는 문서 경로여야 합니다.');context=path.resolve(workspace,job.context);if(!inside(workspace,context)||!inside(fs.realpathSync(workspace),fs.realpathSync(context)))throw Error('context는 작업 폴더 안의 문서여야 합니다.');}
 return {settings:{workspace,provider:'local',connectionMode:'local',localSource:'managed',model:job.model||'narae4',browserMode:'isolated',keepSchoolSession:false,hwpAutoSave:job.save!==false},context};
}
async function status({home=defaultHome(),createAI=options=>new LocalAI(options)}={}){
 const ai=createAI({root,home});try{return {version:require('../package.json').version,defaultModel:'narae4',localAI:ai.status(),capabilities:['cbe','cbe-date-range-archive','configured-portal-login','edufine-documents','edufine-progress','school-accounting-list-detail','school-accounting-draft-basic-input','wxs-draft','wxs-final-processing','neis-duty','neis-duty-query','neis-trip-input','neis-trip-submit','hangul'],benchmark:{contract:require('./office-benchmark.cjs').contract.id,requiredTasks:10,releaseVerified:false,command:'narae-talk bench [run.json]'},schoolExecution:'현재 로그인·권한·실제 관찰 결과에 따라 실행합니다. 출장·연가·조퇴의 입력·결재선·상신·서버 확인을 연결하며 실제 결과는 화면과 목록에서 확인합니다. 10개 과제 전체 실환경 합격은 아직 미검증입니다.'};}finally{await ai.close();}
}
async function run(job,{base=process.cwd(),home=defaultHome(),signal=new AbortController().signal,onEvent=()=>{},createAI=options=>new LocalAI(options),createIntegrations=options=>new OfficeIntegrations(options),executeDocument}={}){
 const {settings,context}=config(job,base),friend=job.friend||'narae';talkTools.filterTools(friend,[]);try{settings.kakaoProgram=JSON.parse(fs.readFileSync(path.join(home,'data/settings.json'),'utf8')).kakaoProgram===true;}catch{}for(const d of ['cache','logs','data'])fs.mkdirSync(path.join(home,d),{recursive:true});
 const python=require('./runtime-python.cjs').resolvePython(root),policy=new RemotePolicy({workspace:()=>settings.workspace,autoAllow:()=>job.allowChanges===true,notify:view=>{if(view){onEvent({type:'approvalRequired',name:view.name});policy.decide({id:view.id,digest:view.digest,allow:false});}}});
 const addons=process.env.NARAE_PRODUCT==='talk'?new (require('./talk-addons.cjs').TalkAddons)({root,home,python}):null;
 const ai=createAI({root,home}),integrations=createIntegrations({root,home,python,addons,kakaoCLI:process.env.NARAE_PRODUCT==='talk',workspace:()=>settings.workspace,settings:()=>settings,policy,headed:true,busy:()=>true});
 integrations.region=talkTools.definition(friend)?.region;
 let denied;
 const execute=async(name,args,toolSignal)=>{
  talkTools.assertTool(friend,name,args);if(denied)throw denied;
  try{
   if(name.startsWith('gyomu_'))return await integrations.execute(name,args,toolSignal);
   return await policy.run(name,args,toolSignal,async(name,a)=>{
    if(executeDocument)return executeDocument(name,a,toolSignal);
    return require('./document-tools.cjs').executeDocumentTool(name,{...a,save:settings.hwpAutoSave},{workspace:settings.workspace,home,python,signal:toolSignal});
   });
  }catch(e){if(e.code==='LOCAL_APPROVAL_DENIED')denied=e;throw e;}
 };
 try{
  const text=await runAgent({prompt:job.prompt,context,settings,signal,history:job.history||[],toolDomain:friend,request:body=>ai.request({settings,body,signal}),execute,baseTools:talkTools.filterTools(friend,require('./agent.cjs').tools),additionalTools:talkTools.filterTools(friend,await integrations.tools()),send:onEvent,agentInstructions:'현재는 나래톡 CLI입니다. 추가 친구는 gyomu_addon_read로 해당 id의 절차를 확인하고, 포털 업무는 gyomu_skill_read 절차를 확인합니다. CLI 변경 허용: '+(job.allowChanges===true?'사용자가 이 작업의 변경을 허용했습니다.':'조회만 허용됩니다. 변경 승인은 거절됩니다.')+' 미리보기와 실제 완료, 조회 범위와 전체 범위를 구분합니다.'});
  if(denied)throw denied;return {model:settings.model,workspace:settings.workspace,text};
 }finally{policy.close();try{await integrations.close();}finally{await ai.close();}}
}
module.exports={run,status,config,defaultHome};
