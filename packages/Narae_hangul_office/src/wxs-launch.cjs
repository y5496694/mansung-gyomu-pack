'use strict';
const path=require('node:path'),{spawn}=require('node:child_process');
const tool={type:'function',name:'gyomu_wxs_launch',description:'실제 공용서식 클릭에서 관찰한 WXS 실행 요청만 비공개 IPC로 원본 WXS CLI에 전달한다. preview로 설치된 등록 기안기의 서명과 지문을 확인한 뒤 같은 id/fingerprint로 한 번 apply한다. 실행 URI는 모델·인자·로그에 노출하지 않는다. 기안 창 존재와 상신 완료는 별도 검증이다.',parameters:{type:'object',properties:{operation:{enum:['preview','apply']},id:{type:'string'},fingerprint:{type:'string'}},required:['operation','id'],additionalProperties:false}};
function privateCLI({root,python,env,request,apply,fingerprint,signal}){
 return new Promise((resolve,reject)=>{const entry=path.join(root,'vendor/narae-gyomu/packages/narae_gyomoo_portal/skills/wxs-cli/scripts/wxs_cli.py'),args=['-s','-X','utf8',entry,'launch-registered',...(apply?['--apply','--expected-fingerprint',fingerprint]:[])],child=spawn(python,args,{windowsHide:true,shell:false,env:{...process.env,...env},stdio:['pipe','pipe','pipe']}),out=[];let bytes=0,settled=false;
 const fail=()=>{if(!settled){settled=true;reject(Error('등록된 WXS 실행 결과를 확인하지 못했습니다. 같은 실행을 반복하지 말고 창 목록을 확인하세요.'));}};
 const timer=setTimeout(()=>{child.kill();fail();},30000),abort=()=>{child.kill();fail();};signal?.addEventListener('abort',abort,{once:true});
 child.stdout.on('data',b=>{bytes+=b.length;if(bytes>65536){child.kill();fail();}else out.push(b);});child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});child.on('error',fail);child.on('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(settled)return;if(code!==0)return fail();try{const result=JSON.parse(Buffer.concat(out).toString('utf8'));settled=true;resolve(result);}catch{fail();}});child.stdin.end(JSON.stringify(request),'utf8');
 });
}
async function execute(args,{root,python,instance,signal,run=privateCLI}){
 const browser=instance.browser,entry=browser?.pendingExternalApp;if(!entry||entry.id!==args.id||browser.attached||!require('./school-region.cjs').edufineHost(new URL(entry.sourceOrigin).hostname)||entry.scheme!=='wxsclient')throw Error('현재 공용서식 클릭에서 관찰한 WXS 실행 ID가 필요합니다.');
 if(entry.attempted)throw Error('이 WXS 실행 요청은 이미 시도했습니다. 열린 창을 확인하고 반복하지 마세요.');
 if(args.operation==='apply'&&(!entry.preview?.ready||args.fingerprint!==entry.preview.fingerprint))throw Error('직전 WXS 실행 미리보기와 같은 지문이 필요합니다.');
 if(args.operation==='apply'){
  const windows=await instance.wxs(['windows'],signal),identity=rows=>rows.map(({hwnd,pid,title})=>[String(hwnd),pid,title]).sort((a,b)=>a[0].localeCompare(b[0]));if(!Array.isArray(windows.windows)||windows.windows.length&&(!Array.isArray(entry.nativeBaseline)||JSON.stringify(identity(windows.windows))!==JSON.stringify(identity(entry.nativeBaseline))))throw Error('서식 클릭 뒤 새 WXS 창이 있거나 기존 창이 변경되어 중복 실행하지 않았습니다. 현재 창을 확인하세요.');
  entry.attempted=true;
 }
 const result=await run({root,python,env:instance.pythonEnv,request:{url:entry.url,source_origin:entry.sourceOrigin,format_title:entry.formatTitle,...(entry.document?{document:entry.document}:{})},apply:args.operation==='apply',fingerprint:args.fingerprint,signal});
 if(args.operation==='preview')entry.preview=result;else entry.launched=Boolean(result.applied);
 return {...result,requestId:entry.id,documentOpenVerified:false};
}
module.exports={tool,execute,privateCLI};
