'use strict';
const test=require('node:test'),assert=require('node:assert/strict');

test('saved draft launch binds the exact observed saved row and its editing operation',async()=>{
 const {OfficeSchoolBrowser}=await import('../src/school-browser.mjs'),browser=new OfficeSchoolBrowser();
 try{
  await browser.start({headed:false});
  const uri='wxsclient://handysoft.co.kr/open&url:YWJj&title:ICAgIA==&windowsize:ODAwLDYwMA==';
  await browser.page.route('https://klef.cbe.go.kr/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<table><thead><tr><th></th><th>상태</th><th>제목</th></tr></thead><tbody><tr><td><input type="checkbox" value="M10TEST000000000001,3"></td><td></td><td><a href="#a" onclick="fncDoCallGian()">가상 임시저장</a></td></tr></tbody></table><script>function fncDoCallGian(){let f=document.createElement('iframe');f.src=${JSON.stringify(uri)};document.body.append(f);}</script>`}));
  const state=await browser.execute({action:'open',url:'https://klef.cbe.go.kr/bms/cz/cb/viw/retrieveTmprCstdyDocList.do'});
  assert.equal(state.documentRows[0].saved,true);
  await browser.execute({action:'click',ref:state.elements.find(e=>e.documentTitle).ref,method:'dom'});
  for(let i=0;i<10&&!browser.pendingExternalApp;i++)await new Promise(r=>setTimeout(r,20));
  assert.deepEqual(browser.pendingExternalApp.document,{id:'M10TEST000000000001',title:'가상 임시저장',operation:'edit-saved'});
 }finally{await browser.browser?.close();}
});

test('saved and read-only document links capture only the URI emitted by the observed click',async()=>{
 const {OfficeSchoolBrowser}=await import('../src/school-browser.mjs');
 for(const handler of ['fncDoCallGian','doCallClientApp','doCallClientAppExtra']){
  const browser=new OfficeSchoolBrowser();
  try{
   await browser.start({headed:false});
   const title='가상 첨부 검증 문서',uri='wxsclient://handysoft.co.kr/open&url:YWJj&title:ZGVm&windowsize:ODAwLDYwMA==';
   await browser.page.route('https://klef.cbe.go.kr/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<table><tr><th>제목</th></tr><tr><td><a onclick="${handler}(0)">${title}</a></td></tr></table><script>function ${handler}(){const f=document.createElement('iframe');f.src=${JSON.stringify(uri)};document.body.append(f);}</script>`}));
   let state=await browser.execute({action:'open',url:'https://klef.cbe.go.kr/synthetic-list'});
   assert.equal(browser.pendingExternalApp,undefined);
   state=await browser.execute({action:'click',ref:state.elements.find(e=>e.documentTitle).ref});
   await browser.page.waitForFunction(()=>document.querySelector('iframe'));
   for(let i=0;i<10&&!browser.pendingExternalApp;i++)await new Promise(r=>setTimeout(r,20));
   assert.equal(browser.pendingExternalApp?.scheme,'wxsclient');
   assert.equal(browser.pendingExternalApp?.formatTitle,title);
   assert.equal(browser.pendingExternalApp?.launched,false);
  }finally{await browser.browser?.close();}
 }
});

test('document links in a work iframe observe the launcher iframe created in the parent',async()=>{
 const {OfficeSchoolBrowser}=await import('../src/school-browser.mjs'),browser=new OfficeSchoolBrowser();
 try{
  await browser.start({headed:false});
  const uri='wxsclient://handysoft.co.kr/open&url:YWJj&title:ZGVm&windowsize:ODAwLDYwMA==';
  await browser.page.route('https://klef.cbe.go.kr/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:route.request().url().endsWith('/work')?'<table><tr><th>제목</th></tr><tr><td><a onclick="doCallClientApp()">가상 서버 사본</a></td></tr></table><script>function doCallClientApp(){parent.openNative();}</script>':`<iframe src="/work"></iframe><script>function openNative(){let f=document.createElement('iframe');f.src=${JSON.stringify(uri)};document.body.append(f);}</script>`}));
  await browser.execute({action:'open',url:'https://klef.cbe.go.kr/parent'});
  await browser.page.frameLocator('iframe').locator('a').waitFor();
  const index=browser.page.frames().findIndex(f=>f.url().endsWith('/work'));
  const state=await browser.execute({action:'frame',index});
  await browser.execute({action:'click',ref:state.elements.find(e=>e.documentTitle).ref});
  for(let i=0;i<10&&!browser.pendingExternalApp;i++)await new Promise(r=>setTimeout(r,20));
  assert.equal(browser.pendingExternalApp?.formatTitle,'가상 서버 사본');
  assert.equal(browser.pendingExternalApp?.launched,false);
 }finally{await browser.browser?.close();}
});
