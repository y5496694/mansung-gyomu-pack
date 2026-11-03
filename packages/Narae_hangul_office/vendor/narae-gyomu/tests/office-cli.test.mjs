import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {officeRoot,runOffice} from '../src/office-cli.mjs';
test('Narae4 delegates to the installed Office CLI without starting the three-model daemon',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'narae-office-bridge-'));try{
  fs.mkdirSync(path.join(root,'src'));for(const file of ['agent-cli.cjs','cli.cjs'])fs.writeFileSync(path.join(root,'src',file),'// synthetic');
  const env={NARAE_OFFICE_ROOT:root,CODEX_HOME:root};let called=false;
  assert.equal(officeRoot(env),root);
  const args=['agent','D:/Codex/가상 작업/요청.json','--result','D:/Codex/가상 결과.json'];
  const code=await runOffice(args,{env,spawnImpl:(exe,argv,options)=>{called=true;assert.deepEqual(argv,[path.join(root,'src/cli.cjs'),...args]);assert.equal(options.windowsHide,true);assert.equal(options.stdio,'inherit');const child=new EventEmitter();queueMicrotask(()=>child.emit('close',7));return child;}});
  assert(called);assert.equal(code,7);
  assert.throws(()=>officeRoot({...env,NARAE_OFFICE_ROOT:path.join(root,'missing')}),/업데이트/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
