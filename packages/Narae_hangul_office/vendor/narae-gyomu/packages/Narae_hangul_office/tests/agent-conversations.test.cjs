'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {AgentConversations}=require('../src/agent-conversations.cjs');
test('a transient Windows transcript lock retries one write without duplicating the turn',{skip:process.platform!=='win32'},t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'narae-transcript-')),store=new AgentConversations(home),rename=fs.renameSync;let attempts=0;
 try{store.append('local','user','합성 요청','pc');t.mock.method(fs,'renameSync',(temp,file)=>{if(++attempts<3)throw Object.assign(new Error('synthetic lock'),{code:'UNKNOWN'});return rename(temp,file);});store.append('local','assistant','합성 응답','pc');const saved=store.read('local');assert.equal(attempts,3);assert.equal(saved.revision,2);assert.deepEqual(saved.messages.map(m=>m.content),['합성 요청','합성 응답']);assert.equal(fs.readdirSync(store.dir).length,1);}finally{t.mock.restoreAll();fs.rmSync(home,{recursive:true,force:true});}
});
test('persistent transcript replacement failure preserves both the original and a recoverable new write',t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'narae-transcript-')),store=new AgentConversations(home);let attempts=0,recovery;
 try{store.append('local','user','원본 합성 요청','pc');const original=fs.readFileSync(store.file('local'));t.mock.method(fs,'renameSync',()=>{attempts++;throw Object.assign(new Error('synthetic lock'),{code:'EACCES'});});assert.throws(()=>store.append('local','assistant','보존할 합성 응답','pc'),error=>{recovery=error.recoveryFile;return error.code==='EACCES';});assert.equal(attempts,process.platform==='win32'?5:1);assert.deepEqual(fs.readFileSync(store.file('local')),original);const pending=JSON.parse(fs.readFileSync(recovery));assert.equal(pending.revision,2);assert.equal(pending.messages.at(-1).content,'보존할 합성 응답');}finally{t.mock.restoreAll();fs.rmSync(home,{recursive:true,force:true});}
});
