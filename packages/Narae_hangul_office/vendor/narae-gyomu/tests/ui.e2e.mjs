import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';
process.env.NARAE_GYOMU_DATA=fs.mkdtempSync((await import('node:os')).tmpdir()+'/gyomu-ui-');
const {DATA}=await import('../src/paths.mjs');
const {createApp}=await import('../src/server.mjs');
const {browserPath}=await import('../packages/narae_browser/src/browser.mjs');
test('chat UI switches exactly one AI, shows real execution and renders hostile text inert',async()=>{
  let active=null,turn=0,calls=0;
  const models={loading:null,status:()=>({selected:'narae2',active,models:[1,2,3].map(n=>({id:'narae'+n,label:'나래'+n,size:['0.6B','2.4B','4B'][n-1],note:n===2?'EXAONE · 연구·평가용':'로컬 학습 모델',installed:true}))}),
    activate:async id=>{active=id;return models.status();},stop:async()=>{},
    complete:async()=>({model:'Narae1',content:JSON.stringify(++turn===1?{tool:'system.status',args:{}}:{tool:'finish',args:{answer:'<img src=x onerror=alert(1)> 실제 도구 확인 완료'}})})};
  const tools={register:()=>[],close:async()=>{},call:async name=>{assert.equal(name,'system.status');calls++;return {installed:true};}};
  const app=await createApp({port:0,models,tools});
  const browser=await chromium.launch({executablePath:browserPath(),headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1360,height:900}});
    const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
    await page.goto(app.origin+'/#'+app.token);
    await page.getByRole('button',{name:'활성화',exact:true}).first().click();
    await page.waitForFunction(()=>document.querySelectorAll('.model-card.active').length===1);
    await page.locator('#input').fill('도구 상태를 확인해줘');
    await page.locator('#chat-form').evaluate(form=>form.requestSubmit());
    await page.waitForFunction(()=>document.querySelector('.message.assistant .bubble')?.textContent.includes('실제 도구 확인'));
    assert.equal(calls,1);assert.equal(await page.locator('.bubble img').count(),0);
    assert.equal(await page.locator('.execution').count(),2);
    await page.screenshot({path:DATA+'/ui-test.png',fullPage:true});
    assert.deepEqual(pageErrors,[]);
  }finally{await browser.close();await app.shutdown();}
});
