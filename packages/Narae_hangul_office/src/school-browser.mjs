// Office integration layer; preserve the vendored browser snapshot.
import {SchoolBrowser} from '../vendor/narae-gyomu/src/school-browser.mjs';
import {bound,Fault} from '../vendor/narae-gyomu/packages/narae_browser/src/browser.mjs';
export class OfficeSchoolBrowser extends SchoolBrowser {
 async snapshot(args={}){
  const version='s'+ ++this.serial;this.refs.clear();
  const result=await this.scope().evaluate(({version,limit,chars,offset,filter})=>{
   const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&!e.closest('[aria-hidden=true],[inert]');};
   const dialogs=[...document.querySelectorAll('dialog[open],[role=dialog],[aria-modal=true]')].filter(visible),dialog=dialogs.at(-1),root=dialog||document.body;
   const labelled=e=>(e.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.innerText||'').join(' ').trim();
   const name=e=>(e.getAttribute('aria-label')||labelled(e)||e.labels?.[0]?.innerText||e.getAttribute('placeholder')||e.getAttribute('title')||e.innerText||e.getAttribute('name')||'').replace(/\s+/g,' ').trim().slice(0,180);
   const query='a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[role=combobox],[role=option],[role=treeitem],[role=menuitem],[role=tab],[role=checkbox],[role=radio],[contenteditable=true]';
   const nodes=[...new Set([...root.querySelectorAll(query),...(dialog?[...document.querySelectorAll('[role=listbox] [role=option]')].filter(visible):[])])],elements=[];
   for(const e of nodes){if(!visible(e))continue;const label=name(e);if(filter&&!label.includes(filter))continue;const tag=e.tagName.toLowerCase(),type=e.getAttribute('type')||'',role=e.getAttribute('role')||(tag==='a'?'link':tag==='input'?'textbox':tag),ref=`${version}/e${elements.length+1}`;
    const sensitive=type==='password'||/password|one-time-code/.test(e.autocomplete||'');
    e.setAttribute('data-narae-ref',ref);elements.push({ref,role,tag,type,label,disabled:Boolean(e.disabled)||e.getAttribute('aria-disabled')==='true',...(tag==='a'?{href:e.href}:{}),...(['input','textarea','select'].includes(tag)?{value:sensitive?'[인증정보]':e.value}:{}),...(['combobox','option','tab','treeitem'].includes(role)?{expanded:e.getAttribute('aria-expanded'),selected:e.getAttribute('aria-selected'),display:e.innerText.slice(0,180)}:{}),...(tag==='select'?{options:[...e.options].map(o=>({text:o.text,value:o.value,selected:o.selected}))}:{}),...(['checkbox','radio'].includes(type)?{checked:e.checked}:{})});
   }
   return {url:location.href,title:document.title,dialog:dialog?(name(dialog)||'대화상자'):null,text:(root?.innerText||'').slice(0,chars),elements:elements.slice(offset,offset+limit),totalElements:elements.length,hasMore:elements.length>offset+limit,nextOffset:offset+limit,frames:[...document.querySelectorAll('iframe,frame')].map(e=>({name:e.name||e.title||'',url:e.src}))};
  },{version,limit:bound(args.limit,1,100,50),chars:bound(args.chars,100,12000,1800),offset:bound(args.offset,0,10000,0),filter:args.filter||''});
  for(const entry of result.elements)this.refs.set(entry.ref,entry);
  return {version,frameIndex:this.page.frames().indexOf(this.scope()),...result,untrusted:true};
 }
 async execute(command){
  if(command.action==='click'){
   const {entry,locator}=this.ref(command.ref),label=entry.label.replace(/\s+/g,'');
   if(entry.disabled)throw new Fault('DISABLED_ELEMENT','비활성 항목입니다. 현재 화면을 다시 확인하세요.');
   if(label!=='승인요청'&&/^(?:최종)?(?:상신|결재올림|결재승인|발송|전송|삭제|승인)(?:하기|합니다|요청)?[.!…]*$/.test(label))throw new Fault('UNSUPPORTED_FINAL_ACTION','최종 상신·승인·발송은 직접 처리하세요. 현재 준비 상태에서 중지합니다.');
   if(label==='승인요청'){
    const context=await locator.evaluate(e=>{const root=e.closest('[role=dialog],dialog')||document.body;return (root.getAttribute('aria-label')||'')+' '+root.innerText;});
    if(!/근무상황신청/.test(context))throw new Fault('UNSUPPORTED_FINAL_ACTION','근무상황신청 준비창의 승인요청인지 확인되지 않았습니다.');
   }
  }
  if(command.action==='select'&&this.ref(command.ref).entry.tag!=='select')throw new Fault('CUSTOM_COMBOBOX','HTML select가 아닙니다. combobox를 click한 뒤 실제 option ref를 click하세요.');
  const result=await super.execute(command);
  if(['fill','select','wait'].includes(command.action))return {...result,...await this.snapshot(command)};
  return result;
 }
}
