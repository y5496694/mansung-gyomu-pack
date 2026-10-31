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
test('a saved workspace attachment can be read in a new CLI session; outside files remain blocked',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'wxs-selected-attachment-')),workspace=path.join(home,'Documents');fs.mkdirSync(workspace);const inside=path.join(workspace,'saved.txt'),outside=path.join(home,'outside.txt');fs.writeFileSync(inside,'가상 첨부');fs.writeFileSync(outside,'가상 외부');const policy=new RemotePolicy({workspace:()=>workspace}),integration=new OfficeIntegrations({home,root:path.resolve(__dirname,'..'),python:process.execPath,workspace:()=>workspace,settings:()=>({}),policy});let calls=0;
 integration.ready=async()=>{};integration.catalog=[{name:'gyomu_wxs_attachment',original:'wxs.attachment',parameters:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}}];integration.instance={approvedFiles:new Map(),register(files){for(const file of files)this.approvedFiles.set(file,true);},async close(){},async call(name,args){calls++;assert.equal(name,'wxs.attachment');assert(this.approvedFiles.has(inside));return {path:args.path,text:'가상 첨부',hasMore:false,source_unchanged:true};}};
 try{await assert.rejects(integration.execute('gyomu_wxs_attachment',{path:outside}),/작업 폴더/);assert.equal(calls,0);const result=await integration.execute('gyomu_wxs_attachment',{path:inside});assert.equal(result.path,inside);assert.equal(calls,1);}finally{await integration.close();policy.close();fs.rmSync(home,{recursive:true,force:true});}
});
