import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
process.env.NARAE_GYOMU_DATA=fs.mkdtempSync((await import('node:os')).tmpdir()+'/gyomu-browser-');
const {initialize}=await import('../src/paths.mjs');initialize();
const {SchoolBrowser}=await import('../src/school-browser.mjs');

test('real Narae browser handles iframe observations, stale refs and checkbox state',async()=>{
  const site=http.createServer((_req,res)=>{res.setHeader('content-type','text/html;charset=utf-8');res.end(`<!doctype html><title>가상 업무 화면</title><h1>업무포털 시험</h1><iframe style="width:800px;height:500px" srcdoc='<label>이름<input name="name" value="기존"></label><label>비밀번호<input type="password" value="private-test-value"></label><label>확인<input type="checkbox"></label><button>상신</button><p>실제 날짜 2026-10-20</p>'></iframe>`);});
  await new Promise(r=>site.listen(0,'127.0.0.1',r));
  const browser=new SchoolBrowser();
  try{
    await browser.start({headed:false});
    await browser.execute({action:'open',url:'http://127.0.0.1:'+site.address().port});
    const frames=await browser.execute({action:'frames'}),index=frames.frames.find(f=>f.url==='about:srcdoc').index;
    let view=await browser.execute({action:'frame',index});
    assert.equal(view.elements.find(e=>e.type==='password').value,'[비밀번호]');
    const old=view.elements.find(e=>e.label==='이름').ref;
    await browser.execute({action:'fill',ref:old,text:'가상교사'});
    await assert.rejects(browser.execute({action:'fill',ref:old,text:'중복'}),e=>e.code==='STALE_REF');
    view=await browser.execute({action:'snapshot'});
    assert.equal(view.elements.find(e=>e.label==='이름').value,'가상교사');
    const checked=await browser.execute({action:'check',ref:view.elements.find(e=>e.type==='checkbox').ref});
    assert.equal(checked.elements.find(e=>e.type==='checkbox').checked,true);
    await assert.rejects(browser.execute({action:'click',ref:checked.elements.find(e=>e.label==='상신').ref}),e=>e.code==='FINAL_ACTION_CONFIRMATION_REQUIRED');
    assert.match((await browser.execute({action:'read'})).text,/2026-10-20/);
  }finally{await browser.browser?.close();await new Promise(r=>site.close(r));}
});
