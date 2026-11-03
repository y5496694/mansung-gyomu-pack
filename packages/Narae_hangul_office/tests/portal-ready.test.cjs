'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{ensure,usable}=require('../src/portal-ready.cjs'),portal=require('../src/portal-login.cjs'),regional=require('../src/school-region.cjs');
async function fixture(region){const {OfficeSchoolBrowser}=await import('../src/school-browser.mjs'),browser=new OfficeSchoolBrowser(),cfg=regional.resolve(region),origin=new URL(cfg.portalUrl).origin,events=[];let submissions=0;await browser.start({headed:false});
 await browser.context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());let body;
  if(url.hostname==='neis.fixture')body='<title>나이스 업무</title><button>가상 복무관리</button>';
  else if(url.hostname==='edufine.fixture')body='<title>K-에듀파인</title><button>가상 문서관리</button>';
  else if(url.origin!==origin)return route.abort();
  else if(url.pathname==='/submit'){submissions++;assert.equal(request.postData(),'SYNTHETIC_CERT_PASSWORD');body='<script>parent.location.href="/home"</script>';}
  else if(url.pathname==='/home')body='<title>업무포털 메인</title><button>로그아웃</button><a href="https://neis.fixture/work" target="_blank">나이스</a><a href="https://edufine.fixture/work" target="_blank">K-에듀파인</a>';
  else if(url.pathname==='/cert')body='<title>인증서 선택</title><button onclick="this.remove()">하드디스크</button><table><tr id="cert"><td>가상 인증서 유효함</td></tr></table><script>document.getElementById("cert").onclick=()=>window.selected=true</script><input type="password" aria-label="인증서 암호"><button onclick="fetch(\'/submit\',{method:\'POST\',body:window.selected?document.querySelector(\'input\').value:\'BAD\'}).then(r=>r.text()).then(h=>document.write(h))">확인</button>';
  else body='<title>업무포털 로그인</title><button onclick="document.querySelector(\'iframe\').src=\'/cert\'">교육행정 전자서명 인증서 로그인</button><iframe title="인증서" style="width:800px;height:500px"></iframe>';
  await route.fulfill({contentType:'text/html;charset=utf-8',body});
 });
 const execute=browser.execute.bind(browser);browser.execute=async args=>{const result=await execute(args);events.push({args,result});return result;};return {browser,cfg,events,submissions:()=>submissions};
}
test('regional ready logs in once through real certificate iframe and service popups, then reuses verified work tabs',async()=>{
 const fixtureState=await fixture('충북'),{browser,cfg,events}=fixtureState,state={},profile={region:cfg.region,storage_type:'HardDisk',certificate_name:'가상 인증서',password:'SYNTHETIC_CERT_PASSWORD'};let reads=0;
 const login=(args,options)=>portal.login(args,{...options,readProfile:async action=>{reads++;return action==='Status'?{valid:true,certificate_path_exists:true}:profile;}});
 try{
  const first=await ensure({systems:['neis','edufine'],allow_local_access:true},{cfg,browser,state,login});assert.equal(first.complete,true,JSON.stringify(first));assert.deepEqual(first.systems,{neis:true,edufine:true});assert.match((await browser.execute({action:'snapshot'})).title,/K-에듀파인/);assert.equal(fixtureState.submissions(),1);assert.equal(profile.password,null);const pages=browser.context.pages().length;
  const second=await ensure({systems:['neis'],allow_local_access:true},{cfg,browser,state,login:()=>{throw Error('must reuse the verified service');}});assert.equal(second.reused,true);assert.match((await browser.execute({action:'snapshot'})).title,/나이스/);assert.equal(fixtureState.submissions(),1);assert.equal(browser.context.pages().length,pages);assert.equal(reads,2);assert(!JSON.stringify(events).includes('SYNTHETIC_CERT_PASSWORD'));assert(!JSON.stringify(first).includes('SYNTHETIC_CERT_PASSWORD'));
 }finally{await browser.browser?.close();}
});
test('missing regional security profile leaves the real portal open and manual login resumes without any credential read',async()=>{
 const {browser,cfg,submissions}=await fixture('경기'),state={};let privateReads=0;
 try{
  const missing=await ensure({systems:['neis']},{cfg,browser,state,login:(args,options)=>portal.login(args,{...options,readProfile:async action=>{assert.equal(action,'Status');return {exists:false,valid:false};}})});assert.equal(missing.stage,'profile_required');assert.equal(browser.page.url(),cfg.portalUrl);assert.equal(submissions(),0);
  await browser.page.goto(new URL('/home',cfg.portalUrl).href);const ready=await ensure({systems:['neis']},{cfg,browser,state,login:(args,options)=>portal.login(args,{...options,readProfile:()=>{privateReads++;throw Error('manual authenticated session needs no profile');}})});assert.equal(ready.complete,true,JSON.stringify(ready));assert.equal(ready.region,'경기');assert.equal(privateReads,0);assert.equal(submissions(),0);assert.match((await browser.execute({action:'snapshot'})).title,/나이스/);
 }finally{await browser.browser?.close();}
});
test('cached work readiness rejects expired sessions, certificate prompts, error pages and a changed origin',()=>{
 const screen={url:'https://neis.fixture/work',title:'나이스 업무',text:'복무관리',elements:[{label:'복무',role:'button'}]};assert(usable('neis',screen,'https://neis.fixture'));
 for(const value of [{text:'세션이 만료되었습니다.'},{text:'로그인이 필요합니다.'},{text:'HTTP ERROR 403'},{elements:[{label:'인증서 암호',type:'password'}]},{url:'https://other.fixture/work'},{loading:true},{nativeDialog:{id:'pending'}}])assert(!usable('neis',{...screen,...value},'https://neis.fixture'));
});
