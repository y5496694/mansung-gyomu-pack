'use strict';
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {validate}=require('./remote-policy.cjs');
const vendor=path.resolve(__dirname,'../vendor/narae-gyomu');
class OfficeIntegrations{
 constructor({home,root,python,workspace,policy,settings,headed=true}){Object.assign(this,{home,root,python,workspace,policy,settings,headed});this.instance=null;this.catalog=[];}
 async ready(){if(this.initializing)return this.initializing;this.initializing=this.initialize();return this.initializing;}
 async initialize(){
  const data=path.join(this.home,'data/gyomu'),runtime=path.join(this.home,'data/gyomu-runtime');
  for(const d of [runtime,data,'outputs','tmp','jobs','inputs','native/Local','native/Roaming'].map(d=>path.isAbsolute(d)?d:path.join(data,d)))fs.mkdirSync(d,{recursive:true});
  fs.writeFileSync(path.join(runtime,'runtime.json'),JSON.stringify({python:this.python}));
  process.env.NARAE_GYOMU_HOME=runtime;process.env.NARAE_GYOMU_DATA=data;process.env.NARAE_OFFICE_ROOT=this.root;
  const [{Tools},{tools},{run}]=await Promise.all(['tools','catalog','process'].map(name=>import(pathToFileURL(path.join(vendor,'src',name+'.mjs')).href)));
  const subprocess=(exe,args,options={})=>run(exe,args,{...options,env:{...options.env,...(exe===process.execPath?{ELECTRON_RUN_AS_NODE:'1'}:{})}});
  this.instance=new Tools({status:()=>({provider:this.settings().provider,model:this.settings().model,source:'office-ai',localModelsStarted:false})},{headed:this.headed,subprocess});
  const {OfficeSchoolBrowser}=await import(pathToFileURL(path.join(__dirname,'school-browser.mjs')).href);
  this.instance.browserCall=async args=>{if(!this.instance.browser||this.instance.browser.closed){const session=this.session||'local';if(!/^(?:local|[a-f0-9]{32})$/.test(session))throw new Error('브라우저 대화 세션을 확인하세요.');const browser=new OfficeSchoolBrowser({profile:this.headed?path.join(this.home,'data/gyomu-browser',session):undefined});try{await browser.start({headed:this.headed});this.instance.browser=browser;}catch(error){await browser.browser?.close();throw error;}}return this.instance.browser.execute(args);};
  this.catalog=tools.filter(t=>!t.name.startsWith('hangul.')&&t.name!=='files.list').map(t=>({type:'function',strict:false,name:'gyomu_'+t.name.replaceAll('.','_'),description:t.description+(t.name.endsWith('.prepare')||t.name==='wxs.save'?' 준비 후 PC에서 실제 미리보기를 승인한 경우에만 적용합니다.':''),parameters:t.parameters,original:t.name}));return this;
 }
 async tools(){await this.ready();return this.catalog.map(({original,...tool})=>tool);}
 async execute(name,args,signal){
  await this.ready();if(signal?.aborted)throw new Error('작업을 중단했습니다.');const tool=this.catalog.find(t=>t.name===name);if(!tool)throw new Error('지원하지 않는 통합 도구입니다.');validate(args,tool.parameters);args=structuredClone(args);
  if(tool.original==='skill.read'&&args.document){const resolved=path.resolve('/',args.document);if(path.isAbsolute(args.document)||args.document.split(/[\\/]/).includes('..')||!resolved)throw new Error('스킬 내부 참조 문서만 읽을 수 있습니다.');}
  const register=file=>{const allowed=this.policy.allowed(file);this.instance.register([allowed]);return allowed;};
  if(args.files)args.files=args.files.map(register);
  if(args.config?.body_file)args.config.body_file=register(args.config.body_file);
  if(args.config?.attachments)args.config.attachments=args.config.attachments.map(register);
  if(tool.original==='browser'){
   if(args.action==='open'){let url;try{url=new URL(args.url);}catch{throw new Error('웹 주소를 확인하세요.');}if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('HTTP(S) 웹 주소만 지원합니다.');}
   if(['fill','press'].includes(args.action))await this.noCredentialInput(args);
   if(!['snapshot','read','tabs','frames','frame','scroll','wait'].includes(args.action)){await this.policy.approve('나래 브라우저 · '+args.action,args,signal);if(['fill','press'].includes(args.action))await this.noCredentialInput(args);}
  }
  if(tool.original==='portal.open')await this.policy.approve('업무포털 열기',args,signal);
  if(tool.original==='wxs.read'&&args.operation==='prepare')this.instance.captures.directory=path.join(this.workspace(),'나래-공문조회');
  const result=await this.instance.call(tool.original,args,{signal});
  if(result?.pendingId){
   const pending=this.instance.pending.get(result.pendingId);if(!pending||pending.status!=='prepared')throw new Error('미리보기를 확인할 수 없습니다.');
   try{await this.policy.approve('나래교무 · '+pending.kind,{작업:pending.kind,내용:pending.preview},signal);if(signal?.aborted)throw new Error('작업을 중단했습니다.');if(args.files)args.files.forEach(file=>this.policy.allowed(file));return await this.instance.confirm(result.pendingId,signal);}catch(error){if(pending.status==='prepared')pending.status='cancelled';throw error;}
  }
  return result;
 }
 async noCredentialInput(args){const browser=this.instance.browser;if(!browser)throw new Error('먼저 브라우저 화면을 관찰하세요.');const sensitive=e=>{const t=String(e?.getAttribute?.('type')||'').toLowerCase(),a=e?.getAttribute?.('autocomplete')||'';return t==='password'||t==='file'||/password|one-time-code/.test(a);};const blocked=args.ref?await browser.ref(args.ref).locator.evaluate(sensitive):await browser.page.evaluate(()=>{const e=document.activeElement;return e?.type==='password'||e?.type==='file'||/password|one-time-code/.test(e?.autocomplete||'');});if(blocked)throw new Error('로그인·인증·파일 선택은 PC에서 직접 진행하세요.');if(args.action==='press'&&!/^(Enter|Tab|Escape|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|Backspace|Delete|Space|Shift\+Tab|Control\+a|Meta\+a)$/.test(args.key||''))throw new Error('키보드 입력은 기본 탐색 키만 지원합니다.');}
 async reset(){if(this.instance){await this.instance.close();this.instance.people.clear();this.instance.windows.clear();this.instance.pending.clear();this.instance.approvedFiles.clear();}}
 async close(){await this.instance?.close();}
}
module.exports={OfficeIntegrations};
