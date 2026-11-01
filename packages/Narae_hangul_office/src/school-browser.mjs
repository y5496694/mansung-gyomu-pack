// Office integration layer; preserve the vendored browser snapshot.
import {SchoolBrowser,finalOperation} from '../vendor/narae-gyomu/src/school-browser.mjs';
import {bound,Fault,browserPath} from '../vendor/narae-gyomu/packages/narae_browser/src/browser.mjs';
import {chromium} from 'playwright-core';
import {randomUUID} from 'node:crypto';
import session from './school-session.cjs';
import regional from './school-region.cjs';
function calendarChanged(expected){
 const popup=[...document.querySelectorAll('.cl-calendar.cl-popup')].find(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';});
 const state=JSON.stringify(popup?{text:popup.innerText,labels:[...popup.querySelectorAll('[aria-label]')].map(e=>e.getAttribute('aria-label'))}:null);
 return expected===undefined?state:state!==expected;
}
function documentRowsDOM(){
 if(!/\/retrieveSanctnProgrsDocList\.do$/.test(location.pathname))return [];
 return [...document.querySelectorAll('tr')].flatMap(row=>{
  const checkbox=row.querySelector('input[type=checkbox]');if(!checkbox)return [];
  const cells=[...row.cells].map(c=>c.innerText.replace(/\s+/g,' ').trim()),headers=[...row.closest('table')?.querySelectorAll('thead tr:last-child th')||[]].map(c=>c.innerText.replace(/\s+/g,''));
  if(!headers.length){const head=[...row.closest('table')?.querySelectorAll('tr')||[]].find(r=>r.querySelector('th'));if(head)headers.push(...[...head.cells].map(c=>c.innerText.replace(/\s+/g,'')));}
  const titleIndex=headers.findIndex(h=>h==='제목'),progressIndex=headers.findIndex(h=>h==='진행상태'),statusIndex=progressIndex>=0?progressIndex:headers.findIndex(h=>/^(?:결재|처리|문서)?상태$/.test(h)),ids=new Set();
  // The progress checkbox starts with the document ID; later fields contain
  // template IDs which must not be treated as additional document candidates.
  const checkboxId=String(checkbox.value||'').split(',')[0];
  if(/^[A-Z][A-Z0-9]{17,31}$/.test(checkboxId))ids.add(checkboxId);
  else for(const e of row.querySelectorAll('a[onclick]'))for(const id of (e.getAttribute('onclick')||'').match(/\b[A-Z][A-Z0-9]{17,31}\b/g)||[])ids.add(id);
  const title=titleIndex>=0?cells[titleIndex]:[...row.querySelectorAll('a')].find(e=>(e.innerText||'').trim().length>5)?.innerText.replace(/\s+/g,' ').trim();
  return title&&ids.size?[{title,status:statusIndex>=0?cells[statusIndex]:cells.find(c=>/^(?:기안)?회수$/.test(c))||'',text:row.innerText.replace(/\s+/g,' ').trim(),documentIds:[...ids],selected:checkbox.checked,checkboxRef:checkbox.getAttribute('data-narae-ref')}]:[];
 });
}
export class OfficeSchoolBrowser extends SchoolBrowser {
 constructor({profile,connection='isolated',connectionDirectory,endpoint,environment={}}={}){super();Object.assign(this,{profile,connection,connectionDirectory,endpoint,environment});this.closed=false;}
 resetTask(){this.launchAttempts=new Set();this.clickAttempts=new Map();}
 async diagnostics(){
  const current=await this.scope().evaluate(async()=>{
   const permissions={};for(const name of ['local-network-access','loopback-network','local-network'])try{permissions[name]=(await navigator.permissions.query({name})).state;}catch{permissions[name]='unsupported';}
   return {title:document.title,origin:location.origin,permissions,loading:[...document.querySelectorAll('.isloading-overlay,[role=progressbar]')].map(e=>({visible:e.getBoundingClientRect().width>0&&getComputedStyle(e).display!=='none',text:(e.innerText||'').slice(0,150)})),localResources:performance.getEntriesByType('resource').flatMap(e=>{try{const u=new URL(e.name);return /^(?:localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)?[{origin:u.origin,path:u.pathname,duration:Math.round(e.duration),transferSize:e.transferSize}]:[];}catch{return [];}}).slice(-20)};
  });
  return {...current,networkFailures:(this.networkFailures||[]).map(({origin,path,code})=>/^https?:\/\//.test(origin)?{origin,path:/^\/[\w/.-]{0,160}$/.test(path)?path:'[redacted]',code}:{origin:'[local-application]',code}),externalClickObserved:Boolean(this.externalIntent),...(this.pendingExternalApp?{externalApplication:{id:this.pendingExternalApp.id,scheme:this.pendingExternalApp.scheme,sourceOrigin:this.pendingExternalApp.sourceOrigin,formatTitle:this.pendingExternalApp.formatTitle,authority:(/^[A-Za-z0-9.:-]{0,50}$/.test(new URL(this.pendingExternalApp.url).host)?new URL(this.pendingExternalApp.url).host:'[redacted]'),launched:Boolean(this.pendingExternalApp.launched)}}:{}),untrusted:true};
 }
 captureExternalUri(raw,intent){let url;try{url=new URL(raw);}catch{return;}if(!intent||Date.now()-intent.at>15000||url.protocol!=='wxsclient:'||!/^\/open&url:[A-Za-z0-9+/%=]+&title:/.test(url.pathname))return;if(this.pendingExternalApp?.url===raw)return;this.pendingExternalApp={id:randomUUID(),scheme:'wxsclient',sourceOrigin:intent.sourceOrigin,formatTitle:intent.formatTitle,url:raw,launched:false,...(Array.isArray(intent.nativeBaseline)?{nativeBaseline:intent.nativeBaseline}:{})};}
 async prepareExternalCapture(locator,entry){
  this.externalIntent={page:this.page,at:Date.now(),sourceOrigin:new URL(this.scope().url()).origin,formatTitle:entry.label.replace(/\s*새창열기$/,'').trim(),nativeBaseline:this.externalNativeBaseline};this.externalNativeBaseline=undefined;
  this.externalBindings||=new WeakMap();let binding=this.externalBindings.get(this.page);if(!binding){binding='__naraeWxs_'+randomUUID().replaceAll('-','');const page=this.page;await page.exposeBinding(binding,(_source,raw)=>{const intent=this.externalIntent;if(intent?.page===page)this.captureExternalUri(raw,intent);});this.externalBindings.set(page,binding);}
  await this.scope().evaluate(binding=>{const record=value=>{if(typeof value==='string'&&/^wxsclient:/i.test(value))void window[binding](value);},scan=node=>{if(node.nodeType!==1)return;if(node.matches('iframe,frame'))record(node.getAttribute('src'));node.querySelectorAll?.('iframe,frame').forEach(e=>record(e.getAttribute('src')));};const observer=new MutationObserver(records=>{for(const r of records){if(r.type==='attributes'){record(r.oldValue);record(r.target.getAttribute('src'));}for(const node of r.addedNodes)scan(node);}});observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src'],attributeOldValue:true});setTimeout(()=>observer.disconnect(),15000);},binding);
 }
 watchExternalApps(){
  if(!this.context?.pages)return;
  this.externalIntentPages||=new WeakSet();for(const page of this.context.pages())if(!this.externalIntentPages.has(page)){this.externalIntentPages.add(page);page.on('requestfailed',request=>{const intent=this.externalIntent;if(intent?.page===page)this.captureExternalUri(request.url(),intent);});}
 }
 watchNetwork(){
  this.networkPages||=new WeakSet();for(const page of this.context.pages())if(!this.networkPages.has(page)){this.networkPages.add(page);page.on('requestfailed',request=>{let u;try{u=new URL(request.url());}catch{return;}this.networkFailures||=[];this.networkFailures.push({origin:['http:','https:'].includes(u.protocol)?u.origin:'[local-application]',...(['http:','https:'].includes(u.protocol)?{path:u.pathname}:{}),code:String(request.failure()?.errorText||'').match(/(?:net::)?ERR_[A-Z0-9_]+/)?.[0]||'NETWORK_FAILED'});this.networkFailures=this.networkFailures.slice(-20);});}
 }
 installFinalDialogs(){
  const watch=page=>{page.removeAllListeners('dialog');page.on('dialog',async dialog=>{const auth=this.finalAuthorization;
   if(!auth){this.pendingDialog={dialog,page,id:'d'+ ++this.dialogSerial,type:dialog.type(),message:dialog.message(),url:page.url()};for(const wake of this.dialogWaiters||[])wake();return;}
   const deletion=auth.operation==='delete-recalled',matches=auth.operation==='submit'?/상신|결재올림/:auth.operation==='withdraw'?/회수/:deletion?/삭제|연계반송/:/결재|승인/;
   const accepted=Boolean(auth.page===page&&!auth.dialog&&dialog.type()==='confirm'&&auth.text&&dialog.message()===auth.text&&!/발송|전송|반려|인증|암호|서명/.test(dialog.message())&&(deletion||!/삭제/.test(dialog.message()))&&matches.test(dialog.message()));
   if(auth.page===page&&!auth.dialog)auth.dialog={type:dialog.type(),message:dialog.message(),accepted};await(accepted?dialog.accept():dialog.dismiss()).catch(()=>{});
  });};if(this.finalDialogWatcher)this.context.off('page',this.finalDialogWatcher);this.finalDialogWatcher=watch;this.context.on('page',watch);for(const page of this.context.pages())watch(page);
 }
 async deleteRecalledClick(command,entry){
  if(!/\/retrieveSanctnProgrsDocList\.do$/.test(new URL(this.scope().url()).pathname))throw new Fault('UNSUPPORTED_FINAL_ACTION','회수본 삭제는 문서진행에서 확인한 한 건만 지원합니다.');
  const rows=(await this.scope().evaluate(documentRowsDOM)).filter(r=>r.selected),current=await this.withFinalState({});
  if(command.confirmFinalAction!==true||command.expectedLabel!==entry.label||command.expectedUrl!==this.scope().url()||command.expectedState!==current.finalState)throw new Fault('FINAL_ACTION_CONFIRMATION_REQUIRED','회수본 삭제는 현재 문서·버튼·화면 지문과 명시적 허가가 필요합니다.');
  if(rows.length!==1||rows[0].title!==command.expectedDocument||!rows[0].documentIds.includes(command.expectedDocumentId)||!/^(?:기안)?회수$/.test(rows[0].status))throw new Fault('RECALLED_DOCUMENT_REQUIRED','문서진행의 회수 상태 한 건과 정확한 제목·문서 ID를 확인하세요.');
  const {locator}=this.ref(command.ref),button=await locator.evaluate(e=>({label:(e.getAttribute('aria-label')||e.innerText||e.value||'').replace(/\s+/g,' ').trim(),disabled:Boolean(e.disabled)||e.getAttribute('aria-disabled')==='true'}));
  if(button.disabled||button.label!==entry.label)throw new Fault('FINAL_ACTION_TARGET_CHANGED','삭제 버튼이 미리보기와 달라졌습니다.');
  const key=JSON.stringify([this.scope().url(),'delete-recalled',command.expectedDocumentId]);if(this.finalAttempts.has(key))throw new Fault('FINAL_ACTION_ALREADY_ATTEMPTED','같은 회수본 삭제를 이미 시도했습니다. 서버 결과를 확인하고 반복하지 마세요.');
  this.finalAttempts.add(key);const auth={page:this.page,operation:'delete-recalled',text:command.confirmationText};this.finalAuthorization=auth;
  try{await locator.click({noWaitAfter:true});this.invalidate();const result=await this.snapshot(command);if(auth.dialog?.type==='confirm'&&!auth.dialog.accepted)this.finalAttempts.delete(key);return {...result,finalAction:{operation:'delete-recalled',attempted:true,completed:false,verificationRequired:true,...(auth.dialog?{nativeDialog:auth.dialog}:{})}};}finally{this.finalAuthorization=null;}
 }
 async lifecycleContext(){
  const url=new URL(this.scope().url());if(!regional.edufineHost(url.hostname)||!url.pathname.endsWith('/retrieveRtrvlScrin.do'))return null;
  const form=await this.scope().evaluate(()=>{const field=document.getElementById('opinion');return {label:field?.labels?.[0]?.innerText||'',text:document.body.innerText};}),operation=/삭제의견/.test(form.label)?'delete-recalled':/회수의견/.test(form.label)?'withdraw':null;if(!operation)return null;
  const opener=await this.page.opener();if(!opener||opener.isClosed()||new URL(opener.url()).origin!==url.origin)return null;
  const matches=[];for(const frame of opener.frames())if(/\/retrieveSanctnProgrsDocList\.do$/.test(new URL(frame.url()).pathname))for(const row of await frame.evaluate(documentRowsDOM))if(row.selected)matches.push({row,frame});
  if(matches.length!==1||matches[0].row.documentIds.length!==1)return null;
  const {row,frame}=matches[0];if(operation==='delete-recalled'&&(!/^(?:기안)?회수$/.test(row.status)||!form.text.includes(row.title)))return null;return {operation,documentId:row.documentIds[0],title:row.title,parentTab:this.pages.indexOf(opener),parentFrame:opener.frames().indexOf(frame),parentUrl:frame.url(),openerVerified:true};
 }
 async lifecycleOpinionClick(command,entry){
  const context=await this.lifecycleContext(),current=await this.withFinalState({});
  if(!context||command.confirmFinalAction!==true||command.expectedDocument!==context.title||command.expectedDocumentId!==context.documentId||command.expectedLabel!==entry.label||command.expectedUrl!==this.scope().url()||command.expectedState!==current.finalState)throw new Fault('LIFECYCLE_OPINION_REQUIRED','실제 부모 목록의 선택 한 건과 같은 의견작성 창·지문을 확인하세요.');
  const page=this.page,opener=await page.opener(),key=JSON.stringify([page.url(),context.operation,context.documentId,'opinion']);if(this.finalAttempts.has(key))throw new Fault('FINAL_ACTION_ALREADY_ATTEMPTED','이 의견 확인을 이미 시도했습니다. 서버 목록을 확인하세요.');
  const auth={page,operation:context.operation,text:command.confirmationText},parent=opener.frames()[context.parentFrame],refresh=parent.waitForNavigation({waitUntil:'domcontentloaded',timeout:5000}).catch(()=>null);this.finalAttempts.add(key);this.finalAuthorization=auth;
  try{await this.ref(command.ref).locator.click({noWaitAfter:true});await page.waitForEvent('close',{timeout:5000}).catch(e=>{if(e.name!=='TimeoutError')throw e;});await refresh;if(page.isClosed()){this.page=opener;this.frame=opener.frames().find(f=>f.url()===context.parentUrl)||opener.frames()[context.parentFrame];this.invalidate();}if(auth.dialog?.type==='confirm'&&!auth.dialog.accepted)this.finalAttempts.delete(key);return {...await this.snapshot(command),finalAction:{operation:context.operation,phase:'opinion',attempted:true,completed:false,verificationRequired:true,...(auth.dialog?{nativeDialog:auth.dialog}:{})}};}finally{this.finalAuthorization=null;}
 }
 async start({headed=false}={}){
  if(this.connection!=='isolated'){const result=await super.start({headed:true,connection:this.connection,endpoint:this.endpoint,directory:this.connectionDirectory,environment:this.environment});this.browser.on('disconnected',()=>{this.closed=true;});this.context.on('close',()=>{this.closed=true;});return result;}
  if(!this.profile){const result=await super.start({headed});this.context.on('close',()=>{this.closed=true;});return result;}
  this.context=await chromium.launchPersistentContext(this.profile,{headless:!headed,chromiumSandbox:true,executablePath:browserPath(),args:['--hide-crash-restore-bubble','--restore-last-session'],viewport:{width:1280,height:900},locale:'ko-KR',acceptDownloads:false,serviceWorkers:'block'});
  this.context.on('close',()=>{this.closed=true;});
  this.browser={close:()=>this.context.close()};this.context.setDefaultTimeout(12000);
  const watch=p=>{if(this.pages.includes(p))return;this.pages.push(p);p.on('framenavigated',f=>{if(f===p.mainFrame()&&p===this.page)this.invalidate();});p.on('pageerror',e=>{this.errors.push(e.message.slice(0,200));this.errors=this.errors.slice(-10);});p.on('dialog',d=>d.dismiss().catch(()=>{}));};
  this.context.on('page',watch);for(const p of this.context.pages())watch(p);this.page=this.pages.findLast(p=>/^https?:/.test(p.url()))||this.pages[0]||await this.context.newPage();this.installFinalDialogs();
  return {browser:'chromium',headless:!headed,isolated:true,persistent:true};
 }
 async snapshot(args={}){
  this.watchNetwork();
  if(this.pendingDialog)return super.snapshot(args);
  if(this.attached&&(!this.page||this.page.isClosed()))return {attached:true,url:'about:blank',title:'기존 Chrome 연결됨',text:'현재 연결 작업 공간에 웹 탭이 없습니다. 요청한 웹 주소를 기존 Chrome 프로필에서 여세요.',elements:[],frames:[],tabs:[],untrusted:true};
  this.sessionPages||=new Map();try{const u=new URL(this.page.url());if(u.protocol==='https:'&&Object.hasOwn(session.HOSTS,u.hostname))this.sessionPages.set(u.hostname,this.page);}catch{}
  const version='s'+ ++this.serial;this.refs.clear();
  const result=await this.scope().evaluate(({version,limit,chars,offset,filter,selector})=>{
   const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&!e.closest('[aria-hidden=true],[inert]');};
   const dialogs=[...document.querySelectorAll('dialog[open],[role=dialog],[aria-modal=true],.modal-hidden')].filter(e=>visible(e)||e.matches('.modal-hidden')&&[...e.querySelectorAll('.modal-bg,button,a,[role=button]')].some(visible)),dialog=dialogs.at(-1),calendar=[...document.querySelectorAll('.cl-calendar.cl-popup')].filter(visible).at(-1),root=calendar||dialog||document.body;
   if(!root)return {url:location.href,title:document.title,loading:true,text:'화면 전환 중',elements:[],frames:[],tables:[],dialog:null};
   const labelled=e=>(e.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.innerText||'').join(' ').trim();
   const formLabel=e=>{const label=e.labels?.[0];if(!label)return '';const copy=label.cloneNode(true);copy.querySelectorAll('input,select,textarea,button').forEach(child=>child.remove());return copy.textContent;};
   const name=e=>(e.getAttribute('aria-label')||(/^(button|submit)$/.test(e.type||'')?e.value:'')||labelled(e)||formLabel(e)||e.getAttribute('placeholder')||e.getAttribute('title')||e.innerText||e.getAttribute('name')||'').replace(/\s+/g,' ').trim().slice(0,180);
   const query=selector||'a[href],button,input:not([type=hidden]),textarea,select,[onclick],[role=button],[role=link],[role=combobox],[role=option],[role=gridcell],[role=treeitem],[role=menuitem],[role=tab],[role=checkbox],[role=radio],[contenteditable=true]';
   const textMatches=[];if(filter){const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);for(let node=walker.nextNode();node;node=walker.nextNode()){const e=node.parentElement;if(e&&!/^(SCRIPT|STYLE|NOSCRIPT)$/.test(e.tagName)&&(node.nodeValue||'').includes(filter)&&(e.innerText||'').trim().length<=180&&visible(e))textMatches.push(e);}}
   const nodes=[...new Set([...root.querySelectorAll(query),...textMatches,...(dialog&&!calendar?[...document.querySelectorAll('[role=listbox] [role=option]')].filter(visible):[])])].filter(e=>!textMatches.some(leaf=>leaf!==e&&e.contains(leaf)&&name(leaf)===name(e))),elements=[],targets=new Set();
   for(const e of nodes){if(!visible(e)&&!(['checkbox','radio'].includes(e.type)&&e.parentElement&&visible(e.parentElement)))continue;const cell=e.closest('td'),table=cell?.closest('table'),header=table?.querySelector('thead tr')?.cells[cell.cellIndex]||[...table?.querySelectorAll('tr')||[]].find(row=>row.querySelector('th'))?.cells[cell.cellIndex],documentTitle=Boolean(cell&&header?.innerText.replace(/\s|[▲▼▴▾↕]/g,'')==='제목'&&(e.innerText||'').trim().length>5);const label=documentTitle?(e.innerText||'').replace(/\s+/g,' ').trim().slice(0,500):name(e);if(filter&&!label.includes(filter))continue;const tag=e.tagName.toLowerCase(),type=e.getAttribute('type')||'',nexacroMenu=/\.gridMenu\.body\.gridrow_\d+\.cell_\d+_\d+\.celltreeitem\.treeitemtext(?::text)?$/.test(e.id||'')&&Boolean(e.closest('.treeitemtext')),role=nexacroMenu?'treeitem':e.getAttribute('role')||(label==='결재'&&e.closest('nav,[role=navigation]')&&!dialog?'menuitem':['checkbox','radio'].includes(type)?type:tag==='a'?'link':tag==='input'?'textbox':e.hasAttribute('onclick')?'button':tag),ref=`${version}/e${elements.length+1}`;
    let target=e;if(textMatches.includes(e)&&e.closest('.nexacontentsbox')){const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2),h=hit?.getBoundingClientRect();if(hit&&root.contains(hit)&&hit.matches('.nexainnercontainer')&&h.width<=Math.max(300,r.width*2)&&h.height<=Math.max(80,r.height*2))target=hit;}if(targets.has(target))continue;targets.add(target);
    const sensitive=type==='password'||/password|one-time-code/.test(e.autocomplete||'');
    target.setAttribute('data-narae-ref',ref);elements.push({ref,role,tag,type,label,id:e.id||'',disabled:Boolean(e.disabled)||e.getAttribute('aria-disabled')==='true',...(documentTitle?{documentTitle:true}:{}),...(target!==e?{pointerTarget:true}:{}),...(nexacroMenu?{nexacroMenu:true}:{}),...(tag==='a'?{href:e.href}:{}),...(['input','textarea','select'].includes(tag)?{value:sensitive?'[인증정보]':e.value}:{}),...(['combobox','option','tab','treeitem'].includes(role)?{expanded:e.getAttribute('aria-expanded'),selected:e.getAttribute('aria-selected'),display:e.innerText.slice(0,180)}:{}),...(tag==='input'&&/일자/.test(label)?{dateInput:{placeholder:e.getAttribute('placeholder'),maxLength:e.maxLength,inputMode:e.inputMode,className:e.className,container:e.parentElement?.className,parentContainer:e.parentElement?.parentElement?.className}}:{}),...(tag==='select'?{options:[...e.options].map(o=>({text:o.text,value:o.value,selected:o.selected}))}:{}),...(['checkbox','radio'].includes(type)?{checked:e.checked}:{})});
   }
   return {url:location.href,title:document.title,dialog:calendar?'달력':dialog?(name(dialog)||'대화상자'):null,text:(root?.innerText||'').slice(0,chars),tables:[...root.querySelectorAll('table,[role=grid]')].filter(visible).map(e=>e.innerText.slice(0,3000)).slice(0,5),elements:elements.slice(offset,offset+limit),totalElements:elements.length,appliedFilter:filter||null,hasMore:elements.length>offset+limit,nextOffset:offset+limit,calendars:[...document.querySelectorAll('[class*="calendar" i]')].filter(e=>visible(e)&&e.innerText.trim()).filter((e,_i,list)=>!list.some(parent=>parent!==e&&parent.contains(e))).map(e=>({className:e.className,text:e.innerText.slice(0,1000)})).slice(0,2),frames:[...document.querySelectorAll('iframe,frame')].map(e=>({name:e.name||e.title||'',url:e.src}))};
  },{version,limit:bound(args.limit,1,100,50),chars:bound(args.chars,100,12000,1800),offset:bound(args.offset,0,10000,0),filter:args.filter||'',selector:args.selector||''});
  if(result.loading)return {...result,version,untrusted:true};
  result.tableData=await this.scope().evaluate(()=>[...document.querySelectorAll('table,[role=grid]')].filter(t=>{const r=t.getBoundingClientRect();return r.width>0&&r.height>0;}).slice(0,5).map(t=>{const rows=[...t.querySelectorAll('tr,[role=row]')],header=rows.find(r=>r.querySelector('th,[role=columnheader]')),data=rows.filter(r=>r!==header).map(r=>[...r.querySelectorAll('td,[role=gridcell]')].map(c=>c.innerText.trim())).filter(r=>r.length);return {headers:header?[...header.querySelectorAll('th,[role=columnheader]')].map(c=>c.innerText.trim()):[],rows:data.slice(0,100),hasMore:data.length>100,totalVisibleRows:data.length};}));
  for(const entry of result.elements)this.refs.set(entry.ref,entry);
  result.documentRows=await this.scope().evaluate(documentRowsDOM);result.selectedDocuments=result.documentRows.filter(r=>r.selected).map(({text,documentIds})=>({text,documentIds}));const lifecycle=await this.lifecycleContext();if(lifecycle)result.lifecycleContext=lifecycle;
  this.lastObservation=result;return this.withFinalState({version,frameIndex:this.page.frames().indexOf(this.scope()),...result,untrusted:true});
 }
 async execute(command){
  if(command.action==='dialog'){
   const prior=this.pendingUi,dialogPage=this.pendingDialog?.page;if(dialogPage&&dialogPage!==this.page){this.page=dialogPage;this.frame=null;this.invalidate();}const result=await this.executeObserved(command);if(prior){let timer;try{await Promise.race([prior,new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(new Fault('NAVIGATION_PENDING','안내를 닫은 뒤 원래 화면 전환이 끝나지 않았습니다. 같은 클릭을 반복하지 마세요.')),15000);})]);}finally{clearTimeout(timer);}if(this.pendingUi===prior)this.pendingUi=null;return this.snapshot(command);}return result;
  }
  if(this.pendingDialog)return {url:this.page.url(),nativeDialog:this.dialogState(),actionPending:true,dialog:null,text:'사이트 안내창 응답 대기',elements:[],untrusted:true};
  let wake;const notice=new Promise(resolve=>{wake=()=>resolve({notice:true});});this.dialogWaiters||=new Set();this.dialogWaiters.add(wake);
  const work=this.executeObserved(command).catch(async error=>{if(!/Execution context was destroyed|Cannot read properties of null/.test(error.message))throw error;for(let attempt=0;attempt<4;attempt++){await new Promise(resolve=>setTimeout(resolve,200));try{return {...await this.snapshot(command),observedAfterTransition:true,originalActionRepeated:false};}catch(next){if(!/Execution context was destroyed|Cannot read properties of null/.test(next.message))throw next;}}throw error;});try{const result=await Promise.race([work.then(value=>({value})),notice]);if(result.notice){this.pendingUi=work.catch(error=>({error:error.message}));return {url:this.page.url(),nativeDialog:this.dialogState(),actionPending:true,dialog:null,text:'사이트 안내창 응답 대기',elements:[],untrusted:true};}return result.value;}finally{this.dialogWaiters.delete(wake);}
 }
 async executeObserved(command){
  this.watchExternalApps();
  if(this.pendingDialog&&['snapshot','read'].includes(command.action))return this.snapshot(command);
  if(command.action==='diagnostics')return this.diagnostics();
  if(command.action==='click'&&this.ref(command.ref).entry.label==='확인'&&await this.lifecycleContext())return this.lifecycleOpinionClick(command,this.ref(command.ref).entry);
  if(command.action==='local-access'){
   const url=new URL(this.page.url());if(this.attached||url.protocol!=='https:'||!Object.hasOwn(session.HOSTS,url.hostname)||command.expectedOrigin!==url.origin)throw new Fault('LOCAL_ACCESS_ORIGIN_REQUIRED','현재 독립 업무 창에서 관찰한 HTTPS 업무포털·에듀파인 출처 한 곳만 지정하세요.');
   await this.context.grantPermissions(['local-network-access'],{origin:url.origin});return {...await this.diagnostics(),permissionGranted:true,refreshed:false};
  }
  if(this.attached&&(!this.page||this.page.isClosed())&&['snapshot','read','frames'].includes(command.action))return this.snapshot(command);
  if(command.action==='open'&&regional.portalHost(new URL(command.url).hostname)){const requested=new URL(command.url).href,existing=this.context.pages().find(p=>!p.isClosed()&&p.url()===requested);if(existing){this.page=existing;this.frame=null;await existing.bringToFront();this.invalidate();return this.snapshot(command);}}
  if(command.action==='frame'){const target=this.page.frames()[command.index];if(target&&/websocket|webReport|내용없음/i.test(target.name()))throw new Fault('UTILITY_FRAME','웹소켓·리포트 보조 프레임입니다. 업무 메뉴가 있는 최상위 frame 0을 사용하세요.');}
  if(command.action==='click'&&this.ref(command.ref).entry.nexacroMenu&&command.method===undefined)command={...command,method:'dom'};
  const calendarBefore=command.action==='click'&&this.lastObservation?.dialog==='달력'?await this.scope().evaluate(calendarChanged):undefined;
  const origin=this.page,popup=command.action==='click'?this.context.waitForEvent('page',{timeout:1500}).catch(()=>null):null;let clickedLabel,queryNavigation;const commitDate=command.action==='fill'&&/등록일자|신청일자|시작일자|종료일자/.test(this.ref(command.ref).entry.label);
  if(command.action==='click'){
   const {entry,locator}=this.ref(command.ref),label=entry.label.replace(/\s+/g,'');
   if(regional.edufineHost(new URL(this.scope().url()).hostname)&&/^fncFormDraft\(/.test(await locator.getAttribute('onclick')||''))await this.prepareExternalCapture(locator,entry);
   clickedLabel=label;
   if(/^(조회|검색)$/.test(label))queryNavigation=this.scope().waitForNavigation({waitUntil:'domcontentloaded',timeout:5000}).catch(()=>null);
   if(!finalOperation(entry.label)){this.clickAttempts||=new Map();const signature=JSON.stringify({url:this.scope().url(),label,dialog:this.lastObservation?.dialog,values:this.lastObservation?.elements?.filter(e=>Object.hasOwn(e,'value')).map(e=>[e.label,e.value])}),attempts=this.clickAttempts.get(signature)||0;if(attempts>=3)throw new Fault('REPEATED_UI_ACTION','같은 화면·입력값에서 같은 버튼을 반복해 중지했습니다. 현재 탭을 유지하고 작업을 확인하세요.');this.clickAttempts.set(signature,attempts+1);}
   if(label==='K-에듀파인'){this.launchAttempts||=new Set();const key=origin.url()+'\n'+label;if(this.launchAttempts.has(key))throw new Fault('REPEATED_SERVICE_LAUNCH','같은 요청에서 에듀파인 열기를 이미 시도했습니다. 열린 탭을 확인하고 메뉴를 다시 누르지 마세요.');this.launchAttempts.add(key);}
   if(entry.disabled)throw new Fault('DISABLED_ELEMENT','비활성 항목입니다. 현재 화면을 다시 확인하세요.');
   // The parent validates document-bound explicit authorization for final actions.
   if(label==='승인요청'){
    const context=await locator.evaluate(e=>{const root=e.closest('[role=dialog],dialog')||document.body;return (root.getAttribute('aria-label')||'')+' '+root.innerText;});
    const trip=/출장신청/.test(context)&&/출장지/.test(context)&&/출장목적/.test(context);
    if(!/근무상황신청/.test(context)&&!trip)throw new Fault('UNSUPPORTED_FINAL_ACTION','근무상황신청 또는 출장신청 준비창의 승인요청인지 확인되지 않았습니다.');
   }
  }
  if(command.action==='select'&&this.ref(command.ref).entry.tag!=='select')throw new Fault('CUSTOM_COMBOBOX','HTML select가 아닙니다. combobox를 click한 뒤 실제 option ref를 click하세요.');
  let result;
  if(['check','uncheck'].includes(command.action)&&['checkbox','radio'].includes(this.ref(command.ref).entry.type)&&!await this.ref(command.ref).locator.isVisible()){
   await this.ref(command.ref).locator.evaluate((e,wanted)=>{const parent=e.parentElement,r=parent?.getBoundingClientRect();if(!r?.width||!r.height||e.disabled||!['checkbox','radio'].includes(e.type))throw Error('선택 가능한 현재 체크박스가 아닙니다.');if(e.checked!==wanted)e.click();if(e.checked!==wanted)throw Error('체크박스 선택 결과가 요청과 다릅니다.');},command.action==='check');this.invalidate();result=await this.snapshot(command);
  }else if(command.action==='click'&&/^(?:삭제|삭제\s*\/\s*연계반송)$/.test(this.ref(command.ref).entry.label))result=await this.deleteRecalledClick(command,this.ref(command.ref).entry);
  else result=await super.execute(command);
  if(result?.actionPending&&result.nativeDialog)return result;
  if(calendarBefore!==undefined)await this.scope().waitForFunction(calendarChanged,calendarBefore,{timeout:7000,polling:50}).catch(error=>{if(error.name!=='TimeoutError')throw error;throw new Fault('CALENDAR_UPDATE_NOT_OBSERVED','달력 변경을 확인하지 못했습니다. 같은 버튼을 다시 누르지 말고 현재 화면을 새로 관찰하세요.');});
  if(queryNavigation){await queryNavigation;return {...await this.snapshot(command),...(result.finalAction?{finalAction:result.finalAction}:{})};}
  if(commitDate)await this.page.keyboard.press('Tab');
  if(command.action==='frames')return {...await this.snapshot(),frames:result.frames.filter(f=>f.index===0||!/websocket|webReport|내용없음/i.test(f.name||'')),ignoredFrames:result.frames.filter(f=>f.index!==0&&/websocket|webReport|내용없음/i.test(f.name||''))};
  if(popup){let target=await popup;if(!target&&clickedLabel==='K-에듀파인')for(const candidate of [...this.context.pages()].reverse()){if(!candidate.isClosed()&&candidate!==origin&&await candidate.opener()===origin){target=candidate;break;}}if(target&&!target.isClosed()){this.page=target;this.frame=null;await target.waitForLoadState('domcontentloaded');await target.waitForFunction(()=>Boolean(document.body?.innerText.trim())||[...document.querySelectorAll('button,input:not([type=hidden]),a[href],select,[role=button]')].some(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;}),undefined,{timeout:12000}).catch(e=>{if(e.name!=='TimeoutError')throw e;});await target.bringToFront();this.invalidate();return {...await this.snapshot(command),...(result.finalAction?{finalAction:result.finalAction}:{})};}}
  if(command.action==='frame')await this.scope().waitForLoadState('domcontentloaded',{timeout:12000});
  if(command.action==='click')return {...result,...await this.snapshot(command),...(result.finalAction?{finalAction:result.finalAction}:{})};
  if(['fill','select','wait','frame'].includes(command.action))return {...result,...await this.snapshot(command)};
  return result;
 }
}
