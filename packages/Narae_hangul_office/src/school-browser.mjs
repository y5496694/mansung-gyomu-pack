// Office integration layer; preserve the vendored browser snapshot.
import {SchoolBrowser} from '../vendor/narae-gyomu/src/school-browser.mjs';
import {bound,Fault,browserPath} from '../vendor/narae-gyomu/packages/narae_browser/src/browser.mjs';
import {chromium} from 'playwright-core';
import session from './school-session.cjs';
export class OfficeSchoolBrowser extends SchoolBrowser {
 constructor({profile}={}){super();this.profile=profile;this.closed=false;}
 resetTask(){this.launchAttempts=new Set();this.clickAttempts=new Map();}
 async start({headed=false}={}){
  if(!this.profile){const result=await super.start({headed});this.context.on('close',()=>{this.closed=true;});return result;}
  this.context=await chromium.launchPersistentContext(this.profile,{headless:!headed,chromiumSandbox:true,executablePath:browserPath(),args:['--hide-crash-restore-bubble'],viewport:{width:1280,height:900},locale:'ko-KR',acceptDownloads:false,serviceWorkers:'block'});
  this.context.on('close',()=>{this.closed=true;});
  this.browser={close:()=>this.context.close()};this.context.setDefaultTimeout(12000);
  const watch=p=>{if(this.pages.includes(p))return;this.pages.push(p);p.on('framenavigated',f=>{if(f===p.mainFrame()&&p===this.page)this.invalidate();});p.on('pageerror',e=>{this.errors.push(e.message.slice(0,200));this.errors=this.errors.slice(-10);});p.on('dialog',d=>d.dismiss().catch(()=>{}));};
  this.context.on('page',watch);for(const p of this.context.pages())watch(p);this.page=this.pages.findLast(p=>/^https?:/.test(p.url()))||this.pages[0]||await this.context.newPage();
  return {browser:'chromium',headless:!headed,isolated:true,persistent:true};
 }
 async snapshot(args={}){
  this.sessionPages||=new Map();try{const u=new URL(this.page.url());if(u.protocol==='https:'&&Object.hasOwn(session.HOSTS,u.hostname))this.sessionPages.set(u.hostname,this.page);}catch{}
  const version='s'+ ++this.serial;this.refs.clear();
  const result=await this.scope().evaluate(({version,limit,chars,offset,filter})=>{
   const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&!e.closest('[aria-hidden=true],[inert]');};
   const dialogs=[...document.querySelectorAll('dialog[open],[role=dialog],[aria-modal=true],.modal-hidden')].filter(visible),dialog=dialogs.at(-1),root=dialog||document.body;
   const labelled=e=>(e.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.innerText||'').join(' ').trim();
   const name=e=>(e.getAttribute('aria-label')||labelled(e)||e.labels?.[0]?.innerText||e.getAttribute('placeholder')||e.getAttribute('title')||e.innerText||e.getAttribute('name')||'').replace(/\s+/g,' ').trim().slice(0,180);
   const query='a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[role=combobox],[role=option],[role=treeitem],[role=menuitem],[role=tab],[role=checkbox],[role=radio],[contenteditable=true]';
   const textMatches=filter?[...root.querySelectorAll('div,span,a')].filter(e=>!e.children.length&&(e.innerText||'').trim().length<=180&&(e.innerText||'').includes(filter)):[];
   const nodes=[...new Set([...root.querySelectorAll(query),...textMatches,...(dialog?[...document.querySelectorAll('[role=listbox] [role=option]')].filter(visible):[])])],elements=[];
   for(const e of nodes){if(!visible(e))continue;const label=name(e);if(filter&&!label.includes(filter))continue;const tag=e.tagName.toLowerCase(),type=e.getAttribute('type')||'',role=e.getAttribute('role')||(tag==='a'?'link':tag==='input'?'textbox':tag),ref=`${version}/e${elements.length+1}`;
    const sensitive=type==='password'||/password|one-time-code/.test(e.autocomplete||'');
    e.setAttribute('data-narae-ref',ref);elements.push({ref,role,tag,type,label,disabled:Boolean(e.disabled)||e.getAttribute('aria-disabled')==='true',...(tag==='a'?{href:e.href}:{}),...(['input','textarea','select'].includes(tag)?{value:sensitive?'[인증정보]':e.value}:{}),...(['combobox','option','tab','treeitem'].includes(role)?{expanded:e.getAttribute('aria-expanded'),selected:e.getAttribute('aria-selected'),display:e.innerText.slice(0,180)}:{}),...(tag==='select'?{options:[...e.options].map(o=>({text:o.text,value:o.value,selected:o.selected}))}:{}),...(['checkbox','radio'].includes(type)?{checked:e.checked}:{})});
   }
   return {url:location.href,title:document.title,dialog:dialog?(name(dialog)||'대화상자'):null,text:(root?.innerText||'').slice(0,chars),tables:[...root.querySelectorAll('table,[role=grid]')].filter(visible).map(e=>e.innerText.slice(0,3000)).slice(0,5),elements:elements.slice(offset,offset+limit),totalElements:elements.length,hasMore:elements.length>offset+limit,nextOffset:offset+limit,frames:[...document.querySelectorAll('iframe,frame')].map(e=>({name:e.name||e.title||'',url:e.src}))};
  },{version,limit:bound(args.limit,1,100,50),chars:bound(args.chars,100,12000,1800),offset:bound(args.offset,0,10000,0),filter:args.filter||''});
  for(const entry of result.elements)this.refs.set(entry.ref,entry);
  this.lastObservation=result;return {version,frameIndex:this.page.frames().indexOf(this.scope()),...result,untrusted:true};
 }
 async execute(command){
  if(command.action==='frame'){const target=this.page.frames()[command.index];if(target&&/websocket|webReport|내용없음/i.test(target.name()))throw new Fault('UTILITY_FRAME','웹소켓·리포트 보조 프레임입니다. 업무 메뉴가 있는 최상위 frame 0을 사용하세요.');}
  const origin=this.page,popup=command.action==='click'?this.context.waitForEvent('page',{timeout:1500}).catch(()=>null):null;let clickedLabel;
  if(command.action==='click'){
   const {entry,locator}=this.ref(command.ref),label=entry.label.replace(/\s+/g,'');
   clickedLabel=label;
   this.clickAttempts||=new Map();const signature=JSON.stringify({url:this.scope().url(),label,dialog:this.lastObservation?.dialog,values:this.lastObservation?.elements?.filter(e=>Object.hasOwn(e,'value')).map(e=>[e.label,e.value])}),attempts=this.clickAttempts.get(signature)||0;if(attempts>=3)throw new Fault('REPEATED_UI_ACTION','같은 화면·입력값에서 같은 버튼을 반복해 중지했습니다. 현재 탭을 유지하고 작업을 확인하세요.');this.clickAttempts.set(signature,attempts+1);
   if(label==='K-에듀파인'){this.launchAttempts||=new Set();const key=origin.url()+'\n'+label;if(this.launchAttempts.has(key))throw new Fault('REPEATED_SERVICE_LAUNCH','같은 요청에서 에듀파인 열기를 이미 시도했습니다. 열린 탭을 확인하고 메뉴를 다시 누르지 마세요.');this.launchAttempts.add(key);}
   if(entry.disabled)throw new Fault('DISABLED_ELEMENT','비활성 항목입니다. 현재 화면을 다시 확인하세요.');
   if(label!=='승인요청'&&/^(?:최종)?(?:상신|결재올림|결재승인|발송|전송|삭제|승인)(?:하기|합니다|요청)?[.!…]*$/.test(label))throw new Fault('UNSUPPORTED_FINAL_ACTION','최종 상신·승인·발송은 직접 처리하세요. 현재 준비 상태에서 중지합니다.');
   if(label==='승인요청'){
    const context=await locator.evaluate(e=>{const root=e.closest('[role=dialog],dialog')||document.body;return (root.getAttribute('aria-label')||'')+' '+root.innerText;});
    if(!/근무상황신청/.test(context))throw new Fault('UNSUPPORTED_FINAL_ACTION','근무상황신청 준비창의 승인요청인지 확인되지 않았습니다.');
   }
  }
  if(command.action==='select'&&this.ref(command.ref).entry.tag!=='select')throw new Fault('CUSTOM_COMBOBOX','HTML select가 아닙니다. combobox를 click한 뒤 실제 option ref를 click하세요.');
  const result=await super.execute(command);
  if(command.action==='frames')return {...result,frames:result.frames.filter(f=>f.index===0||!/websocket|webReport|내용없음/i.test(f.name||'')),ignoredFrames:result.frames.filter(f=>f.index!==0&&/websocket|webReport|내용없음/i.test(f.name||''))};
  if(popup){let target=await popup;if(!target&&clickedLabel==='K-에듀파인')for(const candidate of [...this.context.pages()].reverse()){if(!candidate.isClosed()&&candidate!==origin&&await candidate.opener()===origin){target=candidate;break;}}if(target&&!target.isClosed()){this.page=target;this.frame=null;await target.waitForLoadState('domcontentloaded');await target.bringToFront();this.invalidate();return this.snapshot(command);}}
  if(command.action==='frame')await this.scope().waitForLoadState('domcontentloaded',{timeout:12000});
  if(['fill','select','wait','frame'].includes(command.action))return {...result,...await this.snapshot(command)};
  return result;
 }
}
