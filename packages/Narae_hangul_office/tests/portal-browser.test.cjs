'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {login}=require('../src/portal-login.cjs');

test('dedicated Chrome uses observed certificate iframe, delayed SSO and real service popups',async()=>{
 const {OfficeSchoolBrowser}=await import('../src/school-browser.mjs');
 const browser=new OfficeSchoolBrowser(),secret='synthetic-password-for-local-fixture',state={},events=[];
 let submitted=0,matched=false;
 try{
  await browser.start({headed:false});
  await browser.context.route('https://*.fixture/**',async route=>{
   const request=route.request(),u=new URL(request.url());let body;
   if(u.pathname==='/submit'){submitted++;matched=request.postData()===secret;body='<script>setTimeout(()=>parent.location.href="https://portal.fixture/home",150)</script>';}
   else if(u.hostname==='neis.fixture')body='<title>나이스 업무</title><button>복무관리</button><p>가상 로그인 사용자</p>';
   else if(u.hostname==='edufine.fixture')body='<title>K-에듀파인</title><button>문서관리</button><p>가상 로그인 사용자</p>';
   else if(u.pathname==='/home')body='<title>업무포털</title><button>로그아웃</button><a href="#notice">나이스</a><a id="https://neis.fixture/work" href="https://neis.fixture/work" target="_blank">나이스</a><a href="https://edufine.fixture/work" target="_blank">K-에듀파인</a>';
   else if(u.pathname==='/cert')body='<title>인증서 선택</title><button onclick="this.remove()">하드디스크</button><table><tr id="cert"><td>개인 가상 인증서 유효함</td></tr></table><script>document.getElementById("cert").addEventListener("click",()=>window.selected=true)</script><input type="password" aria-label="인증서 암호"><button onclick="fetch(\'/submit\',{method:\'POST\',body:window.selected?document.querySelector(\'input\').value:\'NOT_SELECTED\'}).then(r=>r.text()).then(h=>document.write(h))">확인</button>';
   else body='<title>업무포털 로그인</title><button onclick="document.querySelector(\'iframe\').src=\'/cert\'">교육행정 전자서명 인증서 로그인</button><iframe title="인증서" style="width:800px;height:500px"></iframe>';
   await route.fulfill({contentType:'text/html;charset=utf-8',body});
  });
  const original=browser.execute.bind(browser);browser.execute=async args=>{const result=await original(args);events.push({args,result});return result;};
  const profile={region:'충북',storage_type:'HDD',certificate_name:'가상 인증서',password:secret};
  const result=await login({systems:['neis','edufine']},{cfg:{portalUrl:'https://portal.fixture/login',region:'충북'},browser,state,readProfile:async action=>action==='Status'?{valid:true,certificate_path_exists:true}:profile});
  assert.equal(result.complete,true,JSON.stringify(result));assert.deepEqual(result.systems,{neis:true,edufine:true});
  assert.equal(submitted,1);assert.equal(matched,true);assert.equal(profile.password,null);
  assert.equal(JSON.stringify(events).includes(secret),false);assert.equal(JSON.stringify(result).includes(secret),false);
  await login({systems:[]},{cfg:{portalUrl:'https://portal.fixture/login',region:'충북'},browser,state,readProfile:()=>{throw Error('must reuse login');}});
  assert.equal(submitted,1);
 }finally{await browser.browser?.close();}
});
