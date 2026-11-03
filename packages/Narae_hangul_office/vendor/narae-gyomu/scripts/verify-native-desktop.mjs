import fs from 'node:fs';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright-core';
import {browserPath} from '../packages/narae_browser/src/browser.mjs';
const data=fs.mkdtempSync('D:/Codex/tmp/gyomu-desktop-');
const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
const env={...process.env,NARAE_GYOMU_DATA:data,NARAE_GYOMU_PORT:'0',NARAE_GYOMU_TEST_HIDDEN:'1',TEMP:data,TMP:data};
delete env.ELECTRON_RUN_AS_NODE;
const log=fs.openSync(data+'/desktop.log','a');
const child=spawn('D:/Codex/apps/NaraeGyomu/NaraeGyomu.exe',['--remote-debugging-port='+port],{env,windowsHide:true,stdio:['ignore',log,log]});
fs.closeSync(log);
let browser,page;
try{
  for(let i=0;i<150;i++){
    if(child.exitCode!==null)throw new Error('Packaged desktop exited');
    try{const response=await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(500)});if(response.ok)break;}catch{}
    await new Promise(r=>setTimeout(r,200));
  }
  browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);
  const context=browser.contexts()[0];
  for(let i=0;i<150 && !context.pages().length;i++)await new Promise(r=>setTimeout(r,200));
  page=context.pages()[0];if(!page)throw new Error('No desktop window');
  await page.waitForFunction(()=>document.querySelectorAll('.model-card').length===3);
  if(await page.title()!=='나래교무')throw new Error('Wrong desktop title');
  const info=await page.evaluate(()=>window.naraeDesktop.info());
  if(!info.packaged || !info.userData.startsWith(data.replaceAll('/','\\')))throw new Error('Desktop did not store user data on D:');
  if(!await page.evaluate(()=>Boolean(window.naraeDesktop?.chooseFiles)))throw new Error('Native file picker bridge missing');
  // Hidden native windows can suspend screenshot frames. Render the same live
  // packaged UI in isolated headless Chrome; native title/IPC were checked above.
  const state=JSON.parse(fs.readFileSync(data+'/daemon.json','utf8'));
  process.env.TEMP=data;process.env.TMP=data;
  const renderer=await chromium.launch({executablePath:browserPath(),headless:true});
  try {
    const view=await renderer.newPage({viewport:{width:1360,height:900}});
    await view.goto(`http://127.0.0.1:${state.port}/#${state.token}`);
    await view.waitForFunction(()=>document.querySelectorAll('.model-card').length===3);
    await view.screenshot({path:'verification/desktop.png',fullPage:true});
  }finally{await renderer.close();}
  fs.writeFileSync('verification/desktop.json',JSON.stringify({verified:true,...info,threeButtons:true,nativeFilePicker:true,
    screenshotRenderer:'same packaged UI via isolated headless Chrome',syntheticNoSchoolActions:true},null,2)+'\n');
  console.log(JSON.stringify({verified:true,...info}));
}finally{
  if(page)await page.close().catch(()=>{});
  await browser?.close().catch(()=>{});
  if(child.exitCode===null) {
    let timer;await Promise.race([once(child,'exit'),new Promise(r=>timer=setTimeout(r,10000))]);clearTimeout(timer);
    if(child.exitCode===null)child.kill();
  }
  const file=data+'/daemon.json';
  if(fs.existsSync(file)){
    const state=JSON.parse(fs.readFileSync(file,'utf8'));
    await fetch(`http://127.0.0.1:${state.port}/api/shutdown`,{method:'POST',headers:{authorization:'Bearer '+state.token,'content-type':'application/json'},body:'{}'}).catch(()=>{});
  }
}
