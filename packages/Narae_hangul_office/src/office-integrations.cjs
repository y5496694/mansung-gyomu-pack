'use strict';
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {validate}=require('./remote-policy.cjs');
const {SchoolSessionKeeper,sessionTool}=require('./school-session.cjs');
const messengerArchive=require('./messenger-archive.cjs');
const messengerDialog=require('./messenger-dialog.cjs');
const portalLogin=require('./portal-login.cjs');
const wxsContinuation=require('./wxs-continuation.cjs');
const officeBench=require('./office-bench-status.cjs');
const wxsReview=require('./wxs-review.cjs');
const wxsLaunch=require('./wxs-launch.cjs');
const wxsSelection=require('./wxs-selection.cjs');
const wxsStartup=require('./wxs-startup.cjs');
const regionalMessenger=require('./regional-messenger.cjs');
const capabilities=require('./office-capabilities.cjs');
const kakaoTools=require('./kakao-tools.cjs');
const vendor=path.resolve(__dirname,'../vendor/narae-gyomu');
function browserTool(tool){const copy=structuredClone(tool);copy.parameters.properties.action.enum.push('diagnostics','local-access');copy.parameters.properties.expectedOrigin={type:'string',description:'local-access에서 실제 관찰한 현재 HTTPS 업무포털 또는 에듀파인 origin. 사용자가 맡긴 로컬 인증서 프로그램 연결에만 사용한다.'};copy.description=copy.description.replace('발송·삭제는 지원하지 않는다.','발송과 일반 삭제는 지원하지 않는다. 명시한 회수본 한 건의 삭제는 문서진행에서 정확한 제목·문서 ID·회수 상태·화면 지문을 확인한 경우만 실행하며 서버 재조회 전에는 미완료다. diagnostics는 로컬 연결 권한·로딩·네트워크 오류를 비밀 인자 없이 확인한다. local-access는 사용자가 맡긴 로컬 프로그램 연결을 현재 독립 업무 창의 expectedOrigin 한 곳에만 허용한다.');return copy;}
class OfficeIntegrations{
 constructor({home,root,python,workspace,policy,settings,headed=true,busy=()=>true,notify=()=>{},browserEnvironment=()=>({}),addons=null,kakaoCLI=false}){Object.assign(this,{home,root,python,workspace,policy,settings,headed,busy,notify,browserEnvironment,addons,kakaoCLI});this.instance=null;this.catalog=[];}
 async ready(){if(this.initializing)return this.initializing;this.initializing=this.initialize();return this.initializing;}
 async initialize(){
  const data=path.join(this.home,'data/gyomu'),runtime=path.join(this.home,'data/gyomu-runtime');
  for(const d of [runtime,data,'outputs','tmp','jobs','inputs','native/Local','native/Roaming'].map(d=>path.isAbsolute(d)?d:path.join(data,d)))fs.mkdirSync(d,{recursive:true});
  fs.writeFileSync(path.join(runtime,'runtime.json'),JSON.stringify({python:this.python}));
  process.env.NARAE_GYOMU_HOME=runtime;process.env.NARAE_GYOMU_DATA=data;process.env.NARAE_OFFICE_ROOT=this.root;
  const [{Tools},{tools},{run}]=await Promise.all(['tools','catalog','process'].map(name=>import(pathToFileURL(path.join(vendor,'src',name+'.mjs')).href)));
  const subprocess=(exe,args,options={})=>run(exe,args,{...options,env:{...options.env,...(exe===process.execPath?{ELECTRON_RUN_AS_NODE:'1'}:{})}});
  this.instance=new Tools({status:()=>({provider:this.settings().provider,model:this.settings().model,source:'office-ai',localModelsStarted:false})},{headed:this.headed,subprocess});
  this.instance.cbe=(args,signal)=>this.instance.subprocess(process.execPath,[path.join(this.root,'vendor/cbe-messenger-cli/cli.mjs'),...args,'--json'],{signal});
  this.messengerDialog=new messengerDialog.MessengerDialog({home:this.home,session:()=>this.session||'local',workspace:this.workspace,call:(args,signal)=>this.instance.cbe(args,signal),people:()=>this.instance.people,allowFile:file=>{const allowed=this.policy.allowed(file);this.instance.register([allowed]);return allowed;},readAttachment:(file,offset,signal)=>this.instance.call('wxs.attachment',{path:file,offset,chars:12000},{signal}),notify:this.notify,approve:(name,args,signal)=>this.policy.approve(name,args,signal)});
  const {OfficeSchoolBrowser}=await import(pathToFileURL(path.join(__dirname,'school-browser.mjs')).href);
  this.Browser=OfficeSchoolBrowser;
  this.instance.browserCall=args=>this.browserCall(args);
  this.catalog=tools.filter(t=>!t.name.startsWith('hangul.')&&t.name!=='files.list'&&t.name!=='portal.login').map(t=>({type:'function',strict:false,name:'gyomu_'+t.name.replaceAll('.','_'),description:t.description+(t.name.endsWith('.prepare')||t.name==='wxs.save'?' 준비 후 PC에서 실제 미리보기를 승인한 경우에만 적용합니다.':''),parameters:t.parameters,original:t.name}));this.catalog.push(sessionTool);this.keeper=new SchoolSessionKeeper({browser:()=>this.instance.browser,enabled:()=>this.settings().keepSchoolSession!==false,busy:this.busy,notify:state=>{if(state.results.length){fs.mkdirSync(path.join(this.home,'logs'),{recursive:true});fs.appendFileSync(path.join(this.home,'logs/school-session.jsonl'),JSON.stringify({at:state.lastAt,results:state.results})+'\n');}this.notify({type:'schoolSession',state});}});this.keeper.start();return this;
 }
 schoolConfig(){const saved=portalLogin.config(this.home);if(!this.region||this.region===saved.region)return saved;return {...require('./school-region.cjs').resolve(this.region),credentialsPath:undefined,certificateOrigins:undefined};}
 async tools({allRegions=false}={}){await this.ready();const chungbuk=this.schoolConfig().id==='cbe';return [...this.catalog.filter(t=>allRegions||chungbuk||!t.original.startsWith('cbe.')).map(({original,...tool})=>original==='wxs'?wxsReview.extend(tool):original==='browser'?browserTool(tool):tool),...(allRegions?[messengerArchive.tool,messengerDialog.tool,regionalMessenger.tool]:chungbuk?[messengerArchive.tool,messengerDialog.tool]:[regionalMessenger.tool]),...(this.kakaoCLI||this.settings().kakaoProgram===true?[kakaoTools.tool]:[]),...(this.addons?.tools()||[]),...capabilities.tools,portalLogin.tool,wxsContinuation.tool,wxsLaunch.tool,wxsSelection.tool,wxsStartup.tool,officeBench.tool];}
 async browserCall(args){if(!this.instance.browser||this.instance.browser.closed){const mode=this.settings().browserMode==='extension'?'extension':'isolated',environment=mode==='extension'?await this.browserEnvironment():{};if(mode==='extension'&&!environment.PLAYWRIGHT_MCP_EXTENSION_TOKEN)throw new Error('설정 → 일반에서 확장 연결 토큰을 저장하거나 기존 Chrome 연결을 먼저 완료하세요.');if(mode==='isolated'&&['snapshot','read','tabs','frames'].includes(args.action))return {notStarted:true,url:'about:blank',title:'열린 업무 브라우저 없음',text:'',elements:[],tabs:[],frames:[],untrusted:true};await this.connectBrowser(mode,{environment});}return this.instance.browser.execute(args);}
 async makeBrowser(mode,{environment}={}){const session=this.session||'local';if(!/^(?:local|[a-f0-9]{32})$/.test(session))throw new Error('브라우저 대화 세션을 확인하세요.');const browser=new this.Browser({profile:this.headed?path.join(this.home,'data/gyomu-browser',session):undefined,connection:mode,connectionDirectory:path.join(this.home,'data/browser-connections',session),environment:environment||await this.browserEnvironment()});browser.schoolRegion=this.schoolConfig().region;try{await browser.start({headed:this.headed});return browser;}catch(error){await browser.browser?.close().catch(()=>{});throw error;}}
 async selectSchoolRegion(){const browser=this.instance.browser,cfg=this.schoolConfig();if(browser&&browser.schoolRegion===undefined)browser.schoolRegion=cfg.region;else if(browser&&!browser.attached&&browser.schoolRegion!==cfg.region){browser.page=await browser.context.newPage();browser.frame=null;browser.schoolRegion=cfg.region;browser.invalidate();this.portalLoginBrowser=null;this.portalLoginState={};}return cfg;}
 async browserState(){const browser=this.instance?.browser;if(!browser||browser.closed)return {connected:false};return {connected:true,mode:browser.attached?'extension':'isolated',...await browser.execute({action:'tabs'})};}
 async connectBrowser(mode,options={}){if(!['isolated','extension'].includes(mode))throw new Error('브라우저 연결 방식을 선택하세요.');if(this.browserStarting)return this.browserStarting;this.browserStarting=(async()=>{await this.ready();await this.keeper?.pending;const existing=this.instance.browser;if(existing&&!existing.closed&&(existing.attached?'extension':'isolated')===mode)return this.browserState();const browser=await this.makeBrowser(mode,options);this.instance.browser=browser;await existing?.browser?.close().catch(()=>{});return this.browserState();})();try{return await this.browserStarting;}finally{this.browserStarting=null;}}
 async disconnectBrowser(){await this.keeper?.pending;const browser=this.instance?.browser;if(browser){await browser.browser?.close();this.instance.browser=null;}return {connected:false};}
 async execute(name,args,signal){
  if(this.addons?.owns(name))return this.addons.execute(name,args,{policy:this.policy,signal,workspace:this.workspace()});
  if(name===kakaoTools.tool.name){validate(args,kakaoTools.tool.parameters);this.kakao||=new (require('./kakao-desktop.cjs').KakaoDesktop)({root:this.root,home:this.home,python:this.python,enabled:()=>this.kakaoCLI||this.settings().kakaoProgram===true});if(!this.kakaoAttempts||this.kakaoSignal!==signal){this.kakaoSignal=signal;this.kakaoAttempts=new Set();}return kakaoTools.execute(args,{desktop:this.kakao,home:this.home,policy:this.policy,signal,attempts:this.kakaoAttempts});}
  if(capabilities.tools.some(t=>t.name===name)){validate(args,capabilities.tools.find(t=>t.name===name).parameters);return capabilities.execute(name,{home:this.home});}
  if(name===regionalMessenger.tool.name){validate(args,regionalMessenger.tool.parameters);return regionalMessenger.execute(args,{root:this.root,home:this.home,region:this.schoolConfig().region,addons:this.addons,policy:this.policy,signal});}
  if((name.startsWith('gyomu_cbe_')||name===messengerArchive.tool.name)&&this.schoolConfig().id!=='cbe')throw Error('선택한 교육청의 메신저 CLI를 사용하세요. 충북 세션을 다른 지역에 재사용하지 않습니다.');
  if(name===officeBench.tool.name){validate(args,officeBench.tool.parameters);return officeBench.status({home:this.home});}
  await this.ready();if(signal?.aborted)throw new Error('작업을 중단했습니다.');
  if(name===messengerDialog.tool.name){if(this.schoolConfig().id!=='cbe')throw Error('충북소통메신저 친구에서 사용하세요.');validate(args,messengerDialog.tool.parameters);return this.messengerDialog.execute(args,signal);}
  if(name===wxsStartup.tool.name){validate(args,wxsStartup.tool.parameters);return wxsStartup.execute(args,{instance:this.instance,policy:this.policy,signal});}
  if(name===wxsSelection.tool.name){validate(args,wxsSelection.tool.parameters);return wxsSelection.execute(args,{instance:this.instance,policy:this.policy,signal});}
  if(name===wxsLaunch.tool.name){validate(args,wxsLaunch.tool.parameters);if(args.operation==='apply')await this.policy.approve('관찰한 공용서식의 등록 WXS 기안기 실행',{id:args.id,fingerprint:args.fingerprint},signal);return wxsLaunch.execute(args,{root:this.root,python:this.python,instance:this.instance,signal});}
  this.wxsContinuationState||=new Map();
  if(name===wxsContinuation.tool.name){validate(args,wxsContinuation.tool.parameters);return wxsContinuation.execute(args,{instance:this.instance,policy:this.policy,state:this.wxsContinuationState,signal});}
  if(name===portalLogin.tool.name){validate(args,portalLogin.tool.parameters);const cfg=this.schoolConfig();if(args.operation==='status')return portalLogin.loadProfile('Status',cfg,signal);await this.policy.approve('등록된 보안 문서로 업무포털 로그인 1회 · 인증정보는 모델에 전달하지 않음',{systems:args.systems||[]},signal);if(!this.instance.browser||this.instance.browser.closed||this.instance.browser.attached)await this.connectBrowser('isolated');await this.selectSchoolRegion();if(this.portalLoginBrowser!==this.instance.browser){this.portalLoginBrowser=this.instance.browser;this.portalLoginState={};}try{return args.operation==='ensure'?await require('./portal-ready.cjs').ensure(args,{cfg,browser:this.instance.browser,state:this.portalLoginState,signal,login:portalLogin.login}):await portalLogin.login(args,{cfg,browser:this.instance.browser,state:this.portalLoginState,signal});}catch(error){if(signal?.aborted)throw new Error("로그인을 중단했습니다.");const stage=this.portalLoginState.stage,known=['observing','profile_status','profile_read','certificate_open','password_input','certificate_submitted'];return {complete:false,stage:"runtime_unconfirmed",...(known.includes(stage)?{failureStage:stage}:{}),failureKind:/Execution context was destroyed|Cannot read properties of null/.test(error.message)?'dom_transition':error.code&&/^[A-Z_]{1,60}$/.test(error.code)?error.code:error.name==='TimeoutError'?'timeout':'unconfirmed',certificateSubmitted:Boolean(this.portalLoginState.submitted),message:"실제 로그인 경로를 확인하지 못했습니다. 인증정보를 포함할 수 있는 오류 상세는 반환하지 않습니다."};}}
  if(name===messengerArchive.tool.name){validate(args,messengerArchive.tool.parameters);this.archiveReports||=new Set();if(args.operation==='read'){if(!this.archiveReports.has(args.report))throw new Error('현재 작업에서 생성한 탐색 보고서만 읽을 수 있습니다.');return messengerArchive.read(args.report,args);}const result=await messengerArchive.scan(args,{call:(argv,s)=>this.instance.cbe(argv,s),directory:path.join(this.workspace(),'나래-소통탐색'),signal,notify:progress=>this.notify({type:'status',text:`소통 탐색: ${progress.source} ${progress.page}페이지 · ${progress.count}건`})});this.archiveReports.add(result.report);return result;}
  const tool=this.catalog.find(t=>t.name===name);if(!tool)throw new Error('지원하지 않는 통합 도구입니다.');validate(args,tool.original==='wxs'?wxsReview.extend(tool).parameters:tool.original==='browser'?browserTool(tool).parameters:tool.parameters);args=structuredClone(args);
  if(tool.original==='wxs'&&wxsReview.operations.includes(args.operation))return wxsReview.execute(args,{instance:this.instance,workspace:this.workspace(),signal});
  if(this.browserRequest!==signal){this.browserRequest=signal;this.instance.browser?.resetTask?.();}
  if(tool.original==='portal.session')return args.operation==='extend'?this.keeper.tick(true,signal):this.keeper.status();
  await this.keeper?.pending;
  if(tool.original==='skill.read'&&args.document){const resolved=path.resolve('/',args.document);if(path.isAbsolute(args.document)||args.document.split(/[\\/]/).includes('..')||!resolved)throw new Error('스킬 내부 참조 문서만 읽을 수 있습니다.');}
  const register=file=>{const allowed=this.policy.allowed(file);this.instance.register([allowed]);return allowed;};
  if(args.files)args.files=args.files.map(register);
  if(tool.original==='wxs.attachment')args.path=register(args.path);
  if(args.config?.body_file)args.config.body_file=register(args.config.body_file);
  if(args.config?.body_hwp)args.config.body_hwp.path=register(args.config.body_hwp.path);
  if(args.config?.attachments)args.config.attachments=args.config.attachments.map(register);
  if(tool.original==='browser'){
   if(args.action==='download'){args.path=this.policy.allowed(args.path);this.instance.downloadRoot=this.workspace();}
   if(args.action==='click'&&this.instance.browser){const b=this.instance.browser,{locator}=b.ref(args.ref);if(require('./school-region.cjs').edufineHost(new URL(b.scope().url()).hostname)&&/^(?:fncFormDraft|fncDoCallGian|doCallClientApp|doCallClientAppExtra|fncRedrft)\(/.test(await locator.getAttribute('onclick')||''))b.externalNativeBaseline=(await this.instance.wxs(['windows'],signal)).windows;}
   if(args.action==='open'){let url;try{url=new URL(args.url);}catch{throw new Error('웹 주소를 확인하세요.');}if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('HTTP(S) 웹 주소만 지원합니다.');}
   if(['fill','type','press'].includes(args.action))await this.noCredentialInput(args);
   if(!['snapshot','read','tabs','frames','frame','scroll','wait','diagnostics'].includes(args.action)){await this.policy.approve('나래 브라우저 · '+args.action,args,signal);if(['fill','type','press'].includes(args.action))await this.noCredentialInput(args);}
  }
  if(tool.original==='portal.open'){await this.policy.approve('업무포털 열기',args,signal);await this.selectSchoolRegion();return this.browserCall({action:'open',url:this.schoolConfig().portalUrl});}
  if(tool.original==='edufine.requisition'&&['prepare-input','fill','select-budget','enter-items','attach','save','delete','confirm'].includes(args.operation))await this.policy.approve('학교회계 품의 · '+args.operation,args,signal);
  if(tool.original==='wxs.read'&&['prepare','open'].includes(args.operation))this.instance.captures.directory=path.join(this.workspace(),'나래-공문조회');
  const result=await this.instance.call(tool.original,args,{signal});
  if(tool.original==='wxs.final.dialog'){const entry=this.wxsContinuationState.get(args.receipt_id)||{};entry.dialog=result;this.wxsContinuationState.set(args.receipt_id,entry);}
  if(result?.pendingId){
   const pending=this.instance.pending.get(result.pendingId);if(!pending||pending.status!=='prepared')throw new Error('미리보기를 확인할 수 없습니다.');
   try{await this.policy.approve('나래교무 · '+pending.kind,{작업:pending.kind,내용:pending.preview},signal);if(signal?.aborted)throw new Error('작업을 중단했습니다.');if(args.files)args.files.forEach(file=>this.policy.allowed(file));return await this.instance.confirm(result.pendingId,signal);}catch(error){if(pending.kind==='cbe'&&pending.status==='completed'&&pending.result?.sent===true&&pending.result.verified===true){let receiptPersisted=false;const file=path.join(this.home,'data/gyomu/jobs','pending-'+result.pendingId+'.json'),temp=file+'.'+process.pid+'.tmp';try{require('./agent-conversations.cjs').replaceFile(temp,file);receiptPersisted=true;}catch{}return {ok:true,kind:'cbe',result:pending.result,receiptPersisted};}if(pending.status==='prepared')pending.status='cancelled';throw error;}
  }
  return result;
 }
 async noCredentialInput(args){const browser=this.instance.browser;if(!browser)throw new Error('먼저 브라우저 화면을 관찰하세요.');const sensitive=e=>{const t=String(e?.getAttribute?.('type')||'').toLowerCase(),a=e?.getAttribute?.('autocomplete')||'';return t==='password'||t==='file'||/password|one-time-code/.test(a);};const blocked=args.ref?await browser.ref(args.ref).locator.evaluate(sensitive):await browser.page.evaluate(()=>{const e=document.activeElement;return e?.type==='password'||e?.type==='file'||/password|one-time-code/.test(e?.autocomplete||'');});if(blocked)throw new Error('로그인·인증·파일 선택은 PC에서 직접 진행하세요.');if(args.action==='press'&&!/^(Enter|Tab|Escape|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|Backspace|Delete|Space|Shift\+Tab|Control\+a|Meta\+a)$/.test(args.key||''))throw new Error('키보드 입력은 기본 탐색 키만 지원합니다.');}
 async reset({keepBrowser=false}={}){if(this.instance){await this.keeper?.pending;const browser=this.instance.browser,keep=keepBrowser&&browser?.attached&&!browser.closed;if(keep)this.instance.browser=null;try{await this.instance.close();}finally{if(keep){this.instance.browser=browser;browser.frame=null;browser.finalAuthorization=null;browser.invalidate?.();browser.resetTask?.();}}this.instance.people.clear();this.instance.windows.clear();this.instance.pending.clear();this.instance.accounting?.pending?.clear();this.instance.approvedFiles.clear();}}
 async close(){await this.keeper?.close();await this.instance?.close();}
}
module.exports={OfficeIntegrations};
