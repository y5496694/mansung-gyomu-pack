import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {WxsCapture} from '../src/wxs-capture.mjs';

test('WXS bridge waits for native ready, keeps one reader and preserves authentication results',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wxs-bridge-'));let child,args;
 const capture=new WxsCapture({python:'synthetic-python',entry:'original-wxs-cli.py',directory,spawnReader:(_exe,argv)=>{args=argv;child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};setImmediate(()=>{child.stdout.write('{"ready":');child.stdout.write('true}\n');});return child;}});
 try{const ready=await capture.prepare('합성 공문 제목');assert(ready.ready);assert(args.includes('read-next'));assert(args.includes('--attachments-dir'));assert(args.includes('--background'));assert.equal(capture.result(ready.id).pending,true);await assert.rejects(capture.prepare('다른 문서'),/진행 중/);const job=capture.jobs.get(ready.id);fs.writeFileSync(job.output,JSON.stringify({status:'authentication_required',closed:false,preserved:true,body:{body_read:false}}));child.emit('exit',2);const result=capture.result(ready.id);assert.equal(result.exit_code,2);assert.equal(result.document.preserved,true);assert.equal(result.document.closed,false);fs.writeFileSync(job.output,JSON.stringify({closed:true,body:{text:'합성'.repeat(200)}}));const first=capture.result(ready.id,{chars:100});assert(first.document.body.hasMore);assert.equal(first.document.body.totalChars,400);assert.equal(capture.result(ready.id,{offset:100,chars:400}).document.body.hasMore,false);assert.equal(JSON.parse(fs.readFileSync(job.output)).body.text.length,400);assert.throws(()=>capture.result('invented'),/현재 세션/);}finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('WXS bridge never reports readiness after a failed original reader',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wxs-failure-'));
 const capture=new WxsCapture({python:'synthetic-python',entry:'original-wxs-cli.py',directory,spawnReader:()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};setImmediate(()=>child.emit('exit',1));return child;}});
 try{await assert.rejects(capture.prepare('합성 문서'),/문서를 열지/);assert.equal([...capture.jobs.values()][0].done,true);}finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('an existing approved document uses the original read-open reader and keeps exact identity',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wxs-existing-'));let args,child;
 const capture=new WxsCapture({python:'synthetic-python',entry:'original-wxs-cli.py',directory,spawnReader:(_exe,argv)=>{args=argv;child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};setImmediate(()=>child.stdout.write('{"ready":true}\n'));return child;}});
 try{await assert.rejects(capture.prepare('합성 공문',undefined,'invented'),/HWND/);assert.equal(capture.jobs.size,0);const ready=await capture.prepare('합성 공문',undefined,'12345');assert.equal(ready.existing_window,true);assert(args.includes('read-open'));assert(!args.includes('read-next'));assert.equal(args[args.indexOf('--hwnd')+1],'12345');assert.equal(args[args.indexOf('--expected-title')+1],'합성 공문');assert.match(ready.instruction,/새 공문을 열지/);assert.equal(capture.result(ready.id).pending,true);child.emit('exit',1);}finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('cancellation after readiness notifies the original reader without killing a potentially hidden document',async()=>{const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wxs-cancel-'));let child,argv,killed=false;const capture=new WxsCapture({python:'synthetic-python',entry:'original-wxs-cli.py',directory,spawnReader:(_exe,args)=>{argv=args;child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{killed=true;};setImmediate(()=>child.stdout.write('{"ready":true}\n'));return child;}});try{const controller=new AbortController(),ready=await capture.prepare('합성 공문',controller.signal);controller.abort();assert.equal(killed,false);const marker=argv[argv.indexOf('--cancel-file')+1];assert(fs.existsSync(marker));const job=capture.jobs.get(ready.id);fs.writeFileSync(job.output,JSON.stringify({status:'cancelled',body:{body_read:false},preserved:true,closed:false}));child.emit('exit',0);assert.equal(capture.result(ready.id).document.status,'cancelled');}finally{fs.rmSync(directory,{recursive:true,force:true});}});
