import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';

// The original WXS reader owns window identity, read-only checks and closing.
// This bridge only waits for its explicit ready event and returns its saved JSON.
export class WxsCapture {
  constructor({python,entry,directory,env={},spawnReader=spawn}) {Object.assign(this,{python,entry,directory,env,spawnReader});this.jobs=new Map();}
  async prepare(expectedTitle,signal,hwnd) {
    if(typeof expectedTitle!=='string'||!expectedTitle.trim()||expectedTitle.length>500)throw new Error('현재 목록에서 확인한 문서 제목이 필요합니다.');
    if([...this.jobs.values()].some(j=>!j.done))throw new Error('진행 중인 공문 읽기 결과부터 확인하세요.');
    if(hwnd!==undefined&&!/^[1-9]\d*$/.test(String(hwnd)))throw new Error('실제 windows 결과의 HWND가 필요합니다.');
    const id=crypto.randomUUID(),dir=path.join(this.directory,id);fs.mkdirSync(dir,{recursive:true});
    const job={id,expected_title:expectedTitle,output:path.join(dir,'document.json'),ready:false,done:false};this.jobs.set(id,job);
    const child=this.spawnReader(this.python,['-s','-X','utf8',this.entry,hwnd===undefined?'read-next':'read-open',...(hwnd===undefined?[]:['--hwnd',String(hwnd)]),'--expected-title',expectedTitle,'--out',job.output,'--background','--attachments-dir',path.join(dir,'attachments'),'--timeout','300'],{windowsHide:true,env:{...process.env,...this.env},stdio:['ignore','pipe','pipe']});job.child=child;
    let buffer='';
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{if(!job.ready){child.kill();reject(new Error('WXS 읽기 대기 준비 시간이 초과되었습니다. 문서를 열지 마세요.'));}},15000);
      const abort=()=>{if(!job.ready){child.kill();reject(new Error('공문 읽기 준비를 중단했습니다.'));}};signal?.addEventListener('abort',abort,{once:true});
      const finish=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
      child.stdout.on('data',chunk=>{buffer+=chunk.toString('utf8');if(buffer.length>65536)buffer=buffer.slice(-65536);const lines=buffer.split(/\r?\n/);buffer=lines.pop();for(const line of lines){try{if(JSON.parse(line).ready===true){job.ready=true;finish();resolve();}}catch{}}});
      child.stderr.on('data',()=>{});
      child.on('error',error=>{job.done=true;job.error=error.message;finish();reject(error);});
      child.on('exit',code=>{job.done=true;job.code=code;finish();if(!job.ready)reject(new Error('WXS 읽기 대기 준비에 실패했습니다. 문서를 열지 마세요.'));});
      if(signal?.aborted)abort();
    });
    return {id,ready:true,expected_title:expectedTitle,...(hwnd===undefined?{}:{existing_window:true}),instruction:hwnd===undefined?'이제 현재 웹 목록에서 이 제목 한 건만 연 뒤 같은 id로 result를 조회하세요.':'이미 열린 같은 공문을 읽고 있습니다. 새 공문을 열지 말고 같은 id로 result를 조회하세요.'};
  }
  result(id,{offset=0,chars=4000}={}) {
    const job=this.jobs.get(id);if(!job)throw new Error('현재 세션에서 준비한 읽기 id가 필요합니다.');
    if(!job.done)return {id,ready:job.ready,pending:true,expected_title:job.expected_title};
    let document;if(fs.existsSync(job.output))document=JSON.parse(fs.readFileSync(job.output,'utf8'));
    if(document?.body?.text){const text=document.body.text;offset=Math.max(0,Number(offset));chars=Math.min(12000,Math.max(100,Number(chars)));document.body={...document.body,text:text.slice(offset,offset+chars),offset,totalChars:text.length,nextOffset:offset+chars,hasMore:text.length>offset+chars};}
    return {id,pending:false,expected_title:job.expected_title,exit_code:job.code,output:job.output,...(document?{document}:{error:job.error||'WXS 읽기를 완료하지 못했습니다. 다른 창을 임의로 고르거나 같은 제목을 다시 열지 마세요.'})};
  }
}
