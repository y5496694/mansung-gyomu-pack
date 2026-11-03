import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'narae-attachment-test-'));
process.env.NARAE_GYOMU_DATA=directory;
const {Tools}=await import('../src/tools.mjs');
const {initialize}=await import('../src/paths.mjs');initialize();

test('actual original attachment reader preserves source, paginates text and detects changed cached input',async()=>{
 const file=path.join(directory,'synthetic.txt');fs.writeFileSync(file,'합성 공문 첨부\n제출 기한: 2026-11-02\n'+'가'.repeat(200));const tools=new Tools({status:()=>({})});
 tools.python=process.env.NARAE_TEST_PYTHON||'python';tools.register([file]);
 const first=await tools.call('wxs.attachment',{path:file,chars:100});assert.equal(first.status,'extracted');assert(first.hasMore);assert.equal(first.source_unchanged,true);assert.match(first.text,/2026-11-02/);assert.equal(first.content_reviewed,false);const second=await tools.call('wxs.attachment',{path:file,offset:first.nextOffset,chars:1000});assert.equal(second.hasMore,false);assert.equal(first.text+second.text,fs.readFileSync(file,'utf8'));fs.appendFileSync(file,'변경');await assert.rejects(tools.call('wxs.attachment',{path:file}),e=>e.code==='ATTACHMENT_CHANGED');
});
