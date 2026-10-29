'use strict';
const {randomUUID}=require('node:crypto');
const HOSTS={'cbe.eduptl.kr':'세션 시간 초기화','klef.cbe.go.kr':'로그아웃 30분 연장'};
async function extendSessionPage(page,host,{signal}={}){
 const result={host,verified:false};if(signal?.aborted)return {...result,status:'cancelled'};if(page.isClosed())return {...result,status:'closed'};
 const tag=randomUUID();let control;
 for(const frame of page.frames()){
  let domain;try{domain=new URL(frame.url()).hostname;}catch{continue;}if(domain!==host)continue;
  const observed=await frame.evaluate(({name,tag})=>{const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&!e.closest('[aria-hidden=true],[inert]');},compact=s=>String(s||'').replace(/\s/g,''),matches=[...document.querySelectorAll('button,a,[role=button]')].filter(e=>visible(e)&&!e.disabled&&[e.getAttribute('aria-label'),e.getAttribute('title'),e.innerText].some(t=>compact(t)===compact(name)));if(matches.length!==1)return null;const e=matches[0];e.setAttribute('data-narae-session',tag);return {found:true};},{name:HOSTS[host],tag}).catch(()=>null);
  if(observed){if(control)return {...result,status:'ambiguous-control'};control=frame;}
 }
 if(!control)return {...result,status:'login-or-control-unavailable'};
 const seconds=()=>control.evaluate(tag=>{const e=document.querySelector('[data-narae-session="'+tag+'"]');if(!e)return null;let node=e.parentElement;const texts=[];for(let i=0;node&&i<6;i++,node=node.parentElement)if(node.innerText.length<1500)texts.push(node.innerText);texts.push((document.body?.innerText||'').slice(0,1500));for(const text of texts){const m=text.match(/(\d{1,3})분\s*(\d{1,2})초/)||text.match(/\b(\d{1,3}):([0-5]\d)\b/);if(m)return Number(m[1])*60+Number(m[2]);}return null;},tag);
 const before=await seconds();if(before===null)return {...result,status:'timer-unobserved'};if(signal?.aborted)return {...result,status:'cancelled'};
 await control.locator('[data-narae-session="'+tag+'"]').click({timeout:12000});let after=null;
 for(let i=0;i<5;i++){if(signal?.aborted)return {...result,status:'cancelled'};await new Promise(r=>setTimeout(r,250));after=await seconds();if(after!==null&&after>=3590&&(after>before||before>=3590))break;}
 const verified=after!==null&&after>=3590&&(after>before||before>=3590);return {...result,status:verified?'extended':'timer-not-confirmed',beforeSeconds:before,afterSeconds:after,verified};
}
class SchoolSessionKeeper{
 constructor({browser,enabled=()=>true,busy=()=>true,notify=()=>{},now=Date.now,extend=extendSessionPage,intervalMs=600000}){Object.assign(this,{browser,enabled,busy,notify,now,extend,intervalMs});this.nextAt=now()+intervalMs;this.results=[];this.pending=null;}
 start(){if(!this.timer){this.timer=setInterval(()=>void this.tick().catch(()=>{}),60000);this.timer.unref?.();}}
 status(){return {enabled:this.enabled(),intervalMinutes:this.intervalMs/60000,nextAt:this.nextAt,running:Boolean(this.pending),results:this.results};}
 tick(force=false,signal){if(this.pending)return this.pending;if(!force&&(!this.enabled()||this.now()<this.nextAt))return Promise.resolve(this.status());this.pending=Promise.resolve().then(async()=>{if(!force&&await this.busy())return this.status();return this.run(signal);}).finally(()=>{this.pending=null;});return this.pending;}
 async run(signal){this.nextAt=this.now()+this.intervalMs;const browser=this.browser();if(browser&&!browser.closed&&!browser.sessionPages&&browser.page&&!browser.page.isClosed()){browser.sessionPages=new Map();for(const page of [browser.page,await browser.page.opener()]){if(!page||page.isClosed())continue;try{const u=new URL(page.url());if(u.protocol==='https:'&&Object.hasOwn(HOSTS,u.hostname))browser.sessionPages.set(u.hostname,page);}catch{}}}const targets=browser&&!browser.closed?[...(browser.sessionPages||new Map())]:[];this.results=[];for(const [host,page]of targets){if(!Object.hasOwn(HOSTS,host)||page.isClosed())continue;if(signal?.aborted)break;try{if(new URL(page.url()).protocol!=='https:'||new URL(page.url()).hostname!==host)continue;this.results.push(await this.extend(page,host,{signal}));}catch{this.results.push({host,verified:false,status:'unavailable'});}}this.lastAt=this.now();const state={...this.status(),lastAt:this.lastAt};this.notify(state);return state;}
 async close(){clearInterval(this.timer);this.timer=null;await this.pending;}
}
const sessionTool={type:'function',strict:false,name:'gyomu_portal_session',original:'portal.session',description:'이미 열린 업무포털·에듀파인 세션의 10분 자동 연장 상태를 확인하거나 실제 연장 버튼을 한 번 실행하고 표시 시간을 대조합니다. 새 창·로그인·문서 변경은 하지 않습니다.',parameters:{type:'object',properties:{operation:{type:'string',enum:['status','extend']}},required:['operation'],additionalProperties:false}};
module.exports={HOSTS,SchoolSessionKeeper,extendSessionPage,sessionTool};
