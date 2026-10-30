'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {OfficeIntegrations}=require('../src/office-integrations.cjs'),{RemotePolicy}=require('../src/remote-policy.cjs');
test('WXS binary body uses the same workspace boundary as attachments and rejects invented config fields',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'wxs-body-boundary-')),workspace=path.join(home,'Documents');fs.mkdirSync(workspace);const inside=path.join(workspace,'body.hwp'),outside=path.join(home,'private.hwp');fs.writeFileSync(inside,'synthetic');fs.writeFileSync(outside,'private synthetic');
 const policy=new RemotePolicy({workspace:()=>workspace}),integration=new OfficeIntegrations({home,root:path.resolve(__dirname,'..'),python:process.execPath,workspace:()=>workspace,settings:()=>({}),policy});let calls=0;
 try{await integration.ready();integration.instance.call=async(name,args)=>{calls++;assert.equal(name,'wxs.prepare');assert.equal(args.config.body_hwp.path,inside);return {ok:true};};
 const args=file=>({hwnd:'731',config:{expected_title:'새 문서',title:'훈련',body_hwp:{path:file,expected_text:'훈련'}}});
 await assert.rejects(integration.execute('gyomu_wxs_prepare',args(outside)),/작업 폴더/);assert.equal(calls,0);
 await assert.rejects(integration.execute('gyomu_wxs_prepare',{hwnd:'731',config:{expected_title:'새 문서',title:'훈련',invented_body:inside}}),/허용되지/);assert.equal(calls,0);
 assert.equal((await integration.execute('gyomu_wxs_prepare',args(inside))).ok,true);assert.equal(calls,1);
 }finally{await integration.close();policy.close();fs.rmSync(home,{recursive:true,force:true});}
});
