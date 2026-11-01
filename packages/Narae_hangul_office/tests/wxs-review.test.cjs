'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const review=require('../src/wxs-review.cjs');
test('native review operations use the real CLI, unique workspace outputs and exact document binding',async()=>{
 const workspace=fs.mkdtempSync('D:/Codex/tmp/wxs-review-'),calls=[],instance={wxs:async argv=>{calls.push(argv);return {verified:true,source:'native-fixture'};}};
 try{const directories=[];for(const operation of review.operations){const result=await review.execute({operation,hwnd:'701',expected_title:'가상 검수',editable_draft:operation==='export-attachments'},{instance,workspace});assert.equal(result.verified,true);assert.equal(result.review_operation,operation);assert(result.review_directory.startsWith(path.resolve(workspace)+path.sep));directories.push(result.review_directory);assert(calls.at(-1).includes('가상 검수'));assert(calls.at(-1).includes('701'));}assert.equal(new Set(directories).size,3);assert(calls[2].includes('--editable-draft'));await assert.rejects(review.execute({operation:'capture',hwnd:'701'},{instance,workspace}),/정확한 기안 제목/);assert.equal(calls.length,3);}
 finally{fs.rmSync(workspace,{recursive:true,force:true});}
});
test('the native review catalog preserves the original read-only tool contract',()=>{
 const tool={description:'원본 WXS',parameters:{properties:{operation:{enum:['windows','draft-status']}}}},extended=review.extend(tool);assert.deepEqual(tool.parameters.properties.operation.enum,['windows','draft-status']);for(const op of review.operations)assert(extended.parameters.properties.operation.enum.includes(op));assert(extended.parameters.properties.expected_title);assert.match(extended.description,/실제 본문 PNG/);
});
