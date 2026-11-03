'use strict';
const product=(system,title)=>system==='neis'?/나이스|NEIS/i.test(title||''):/K-에듀파인/.test(title||'');
function usable(system,screen,expectedOrigin){let origin;try{origin=new URL(screen.url).origin;}catch{return false;}return origin===expectedOrigin&&origin.startsWith('https://')&&product(system,screen.title)&&!/로그인|SSO LOGIN/i.test(screen.title||'')&&!/다른 앱 및 서비스|로컬 네트워크.*(?:허용|액세스)|HTTP(?:\s+ERROR)?\s+[45]\d\d|접속.*실패|오류코드/.test(screen.text||'')&&!/로그인(?:이|을)?\s*필요|세션[^\n]{0,20}(?:만료|종료)|인증[^\n]{0,20}만료/.test(screen.text||'')&&screen.elements?.length>0&&!screen.elements.some(e=>e.type==='password'||/인증서.*로그인/.test(e.label||''))&&screen.loading!==true&&!screen.nativeDialog;}
async function ensure(args,{cfg,browser,state,signal,login}){
 const systems=args.systems||[],portalOrigin=new URL(cfg.portalUrl).origin;if(state.serviceRegion!==cfg.region)state.services={};state.services||={};
 const observe=async page=>{browser.page=page;browser.frame=null;browser.invalidate();return browser.execute({action:'snapshot',limit:100,chars:3000});};
 // Reuse only service pages verified in this browser and this education region.
 if(systems.length&&state.serviceRegion===cfg.region){let ready=true;const original=browser.page;
  for(const system of systems){const saved=state.services[system];if(!saved||saved.page.isClosed()||!usable(system,await observe(saved.page),saved.origin)){ready=false;break;}}
  if(ready)return {authenticated:true,complete:true,stage:'verified',region:cfg.region,reused:true,systems:Object.fromEntries(systems.map(system=>[system,true]))};
  browser.page=original;browser.frame=null;browser.invalidate();
 }
 // Record the active page actually observed by the shared login engine. A
 // service link may reuse an existing tab, so "new tab" alone is not evidence.
 const observed={},execute=browser.execute;let result;
 browser.execute=async function(args){const screen=await execute.call(this,args);if(args.action==='snapshot'){let origin;try{origin=new URL(screen.url).origin;}catch{}if(origin&&origin!==portalOrigin&&browser.page?.url()===screen.url)for(const system of systems)if(usable(system,screen,origin))observed[system]={page:browser.page,origin};}return screen;};
 try{result=await login({...args,operation:'login'},{cfg,browser,state,signal});}finally{browser.execute=execute;}
 if(!result.complete||!result.authenticated||!systems.every(system=>result.systems?.[system]===true))return {...result,region:cfg.region};
 if(!systems.length)return {...result,region:cfg.region};
 for(const system of systems){if(!observed[system]||observed[system].page.isClosed())return {...result,complete:false,stage:'system_handoff_unconfirmed',region:cfg.region,message:'진입한 업무 창을 확인하지 못했습니다. 열린 창에서 요청한 시스템을 확인해 주세요.'};
  state.services[system]=observed[system];
 }
 state.serviceRegion=cfg.region;await observe(state.services[systems.at(-1)].page);return {...result,region:cfg.region};
}
module.exports={ensure,usable};
