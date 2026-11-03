'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{TalkAttachments}=require('../src/talk-attachments.cjs');
test('all file extensions and extensionless files retain their bytes and originals when attached',async t=>{
 const base=fs.mkdtempSync(path.join(fs.existsSync('D:/Codex/tmp')?'D:/Codex/tmp':os.tmpdir(),'talk-import-')),workspace=path.join(base,'workspace');fs.mkdirSync(workspace);t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const files=new TalkAttachments({workspace:()=>workspace,output:file=>{assert(path.resolve(file).startsWith(workspace+path.sep));return file;}}),names=['한글 문서.hwp','문서.HWPX','압축.zip','자료.json','예산.xls','발표.ppt','custom.any-extension','README','fixture.EXE'],bytes=Buffer.from([0,255,31,128,13,10]);
 const sources=names.map(name=>{const file=path.join(base,name);fs.writeFileSync(file,bytes);return file;}),results=await files.importPaths([...sources,sources[0]]);
 assert.deepEqual(results.map(file=>file.name),[...names,names[0]]);assert.notEqual(results[0].path,results.at(-1).path);
 for(const file of results)assert.deepEqual(fs.readFileSync(file.path),bytes);
 for(const source of sources)assert.deepEqual(fs.readFileSync(source),bytes);
 assert.equal(fs.readdirSync(path.join(workspace,'나래톡-첨부')).length,10);
 await assert.rejects(files.importPaths([sources[0],workspace]),/폴더/);assert.equal(fs.readdirSync(path.join(workspace,'나래톡-첨부')).length,10);
 await assert.rejects(files.importPaths([]),/1~50/);await assert.rejects(files.importPaths(Array(51).fill(sources[0])),/1~50/);await assert.rejects(files.importPaths(['relative.hwpx']),/경로/);
 await assert.rejects(files.pasteImage({isEmpty:()=>true}),/사진/);
});
