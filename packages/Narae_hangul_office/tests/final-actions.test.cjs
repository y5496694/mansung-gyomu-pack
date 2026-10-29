const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');

test('authorized final actions use real native buttons, exact confirmation, changed-state and duplicate guards',async t=>{
 const {OfficeSchoolBrowser:SchoolBrowser}=await import('../src/school-browser.mjs');
 const records=[];
 const server=http.createServer((req,res)=>{
  res.setHeader('content-type','text/html;charset=utf-8');
  if(req.method==='POST'){records.push(req.url);res.end('ok');return;}
  const approve=req.url.includes('approve'),label=approve?'결재':'상신';
  const message=req.url.includes('wrong-dialog')?'결재 문서를 삭제하시겠습니까?':label+'하시겠습니까?';
  res.end(`<!doctype html><meta charset="utf-8"><h1>합성 조퇴 신청 QA-001</h1><p>합성 검토자 → 합성 결재자</p><label>사유<input id="reason" value="합성 검증"></label><button onclick="if(confirm('${message}'))fetch('/record?kind=${label}',{method:'POST'}).then(()=>{window.completed=true;document.querySelector('#result').textContent='QA-001 처리 상태 반영';})">${label}</button><button>삭제</button><p id="result">미처리</p>`);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=new SchoolBrowser();
 const base='http://127.0.0.1:'+server.address().port;
 const click=(s,label,extra={})=>({action:'click',ref:s.elements.find(e=>e.label===label).ref,
  confirmFinalAction:true,expectedDocument:'합성 조퇴 신청 QA-001',expectedLabel:label,
  expectedUrl:s.url,expectedState:s.finalState,...extra});
 try{
  await browser.start({headed:false});
  let s=await browser.execute({action:'open',url:base+'/submit'});
  assert.match(s.finalState,/^[a-f0-9]{64}$/);
  await t.test('missing authorization does not submit',async()=>{
   await assert.rejects(browser.execute(click(s,'상신',{confirmFinalAction:false})),e=>e.code==='FINAL_ACTION_CONFIRMATION_REQUIRED');
   assert.equal(records.length,0);
  });
  await t.test('live field changes invalidate the reviewed state',async()=>{
   await browser.page.locator('#reason').fill('변경된 사유');
   await assert.rejects(browser.execute(click(s,'상신')),e=>e.code==='FINAL_ACTION_TARGET_CHANGED');
   assert.equal(records.length,0);s=await browser.snapshot();
  });
  await t.test('an unobserved native confirmation is canceled without a server write',async()=>{
   s=await browser.execute(click(s,'상신'));
   assert.equal(s.finalAction.nativeDialog.message,'상신하시겠습니까?');
   assert.equal(s.finalAction.nativeDialog.accepted,false);assert.equal(records.length,0);
  });
  await t.test('exact observed confirmation reaches the server once, but does not claim completion',async()=>{
   s=await browser.execute(click(s,'상신',{confirmationText:'상신하시겠습니까?'}));
   await browser.page.waitForFunction(()=>window.completed===true);
   assert.equal(records.length,1);assert.equal(s.finalAction.completed,false);
   assert.equal(s.finalAction.nativeDialog.accepted,true);
   assert.match((await browser.read()).text,/QA-001 처리 상태 반영/);
   s=await browser.snapshot();
   await assert.rejects(browser.execute(click(s,'상신',{confirmationText:'상신하시겠습니까?'})),e=>e.code==='FINAL_ACTION_ALREADY_ATTEMPTED');
   assert.equal(records.length,1);
  });
  await t.test('explicit approval also reaches the native control and server',async()=>{
   s=await browser.execute({action:'open',url:base+'/approve'});
   s=await browser.execute(click(s,'결재',{confirmationText:'결재하시겠습니까?'}));
   await browser.page.waitForFunction(()=>window.completed===true);
   assert.equal(records.length,2);assert.equal(s.finalAction.operation,'approve');
   assert.equal(s.finalAction.completed,false);
  });
  await t.test('unrelated deletion confirmation and deletion controls stay unsupported',async()=>{
   s=await browser.execute({action:'open',url:base+'/approve-wrong-dialog'});
   s=await browser.execute(click(s,'결재',{confirmationText:'결재 문서를 삭제하시겠습니까?'}));
   assert.equal(s.finalAction.nativeDialog.accepted,false);
   await assert.rejects(browser.execute(click(s,'삭제')),e=>e.code==='UNSUPPORTED_FINAL_ACTION');
   assert.equal(records.length,2);
  });
 }finally{await browser.browser?.close();await new Promise(r=>server.close(r));}
});
