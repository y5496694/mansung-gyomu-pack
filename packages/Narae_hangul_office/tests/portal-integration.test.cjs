'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const portal=require('../src/portal-login.cjs'),{OfficeIntegrations}=require('../src/office-integrations.cjs');
test('automatic login switches an attached browser to dedicated and keeps one attempt state per browser',async()=>{
 const before=portal.login,states=[],switches=[];
 const integration=new OfficeIntegrations({home:'D:/Codex/tmp',settings:()=>({browserMode:'extension'}),policy:{approve:async()=>{}}});
 integration.ready=async()=>{};integration.instance={browser:{attached:true,closed:false}};
 integration.connectBrowser=async mode=>{switches.push(mode);integration.instance.browser={attached:false,closed:false};};
 portal.login=async(_args,deps)=>{states.push(deps.state);deps.state.attempted=true;return {authenticated:true,complete:true};};
 try{
  await integration.execute('gyomu_portal_login',{operation:'login'});
  await integration.execute('gyomu_portal_login',{operation:'login'});
  assert.deepEqual(switches,['isolated']);assert.equal(states[0],states[1]);
  integration.instance.browser={attached:false,closed:false};
  await integration.execute('gyomu_portal_login',{operation:'login'});
  assert.notEqual(states[0],states[2]);
 }finally{portal.login=before;}
});
test('Office exposes exactly one login tool after importing the shared portal vendor',async()=>{
 const home=fs.mkdtempSync('D:/Codex/tmp/office-login-catalog-'),integration=new OfficeIntegrations({home,root:path.resolve(__dirname,'..'),python:process.execPath,workspace:()=>home,settings:()=>({keepSchoolSession:false}),policy:{}});
 try{const tools=await integration.tools();assert.equal(tools.filter(t=>t.name==='gyomu_portal_login').length,1);assert.equal(new Set(tools.map(t=>t.name)).size,tools.length);}
 finally{await integration.close();fs.rmSync(home,{recursive:true,force:true});}
});
