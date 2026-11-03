import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
process.env.NARAE_GYOMU_DATA=fs.mkdtempSync('D:/Codex/tmp/gyomu-login-tools-');
const {initialize}=await import('../src/paths.mjs');initialize();
const {Tools}=await import('../src/tools.mjs');
const controller=createRequire(import.meta.url)('../packages/narae_gyomoo_portal/skills/narae-gyomu-work-portal/scripts/portal-login.cjs');
test('portal login rejects secret arguments and status starts no browser or model',async()=>{
 const tools=new Tools({status:()=>{throw Error('no model');}}),before=controller.loadProfile;let calls=0;
 controller.loadProfile=async action=>{calls++;assert.equal(action,'Status');return {valid:true};};
 try{
  await assert.rejects(tools.call('portal.login',{operation:'login',password:'synthetic'}),e=>e.code==='PORTAL_LOGIN_ARGUMENTS');
  await assert.rejects(tools.call('portal.login',{operation:'login',systems:['neis','neis']}),e=>e.code==='PORTAL_LOGIN_ARGUMENTS');
  assert.deepEqual(await tools.call('portal.login',{operation:'status'}),{valid:true});assert.equal(tools.browser,null);assert.equal(calls,1);
 }finally{controller.loadProfile=before;}
});
