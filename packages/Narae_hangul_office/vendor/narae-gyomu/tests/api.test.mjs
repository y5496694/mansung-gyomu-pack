import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.NARAE_GYOMU_DATA=fs.mkdtempSync((await import('node:os')).tmpdir()+'/gyomu-api-');
const {createApp}=await import('../src/server.mjs');
test('API binds localhost, authenticates calls and serializes tool operations',async()=>{
  let release;
  const model={loading:null,status:()=>({models:[]}),stop:async()=>{}};
  const adapters={register:()=>[],close:async()=>{},call:async()=>new Promise(r=>{release=r;})};
  const app=await createApp({port:0,models:model,tools:adapters});
  const headers={authorization:'Bearer '+app.token,'content-type':'application/json'};
  try{
    assert.equal(app.server.address().address,'127.0.0.1');
    assert.equal((await fetch(app.origin+'/api/status')).status,401);
    const evil=await fetch(app.origin+'/api/status',{headers:{...headers,origin:'https://evil.example'}});
    assert.equal(evil.status,400);
    const request=fetch(app.origin+'/api/tools/call',{method:'POST',headers,body:JSON.stringify({tool:'system.status',args:{}})});
    while(!release)await new Promise(r=>setTimeout(r,5));
    const parallel=await fetch(app.origin+'/api/tools/call',{method:'POST',headers,body:JSON.stringify({tool:'system.status',args:{}})});
    assert.equal(parallel.status,409);release({confirmed:true});
    assert.equal((await (await request).json()).data.confirmed,true);
    assert.equal((await fetch(app.origin+'/../package.json')).status,404);
  }finally{await app.shutdown();}
});
