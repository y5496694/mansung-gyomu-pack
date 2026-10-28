// Use the unmodified official ant CLI under an isolated, protected profile.
// Claude.ai subscription credentials are never imported or borrowed.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
function cleanupStale(cache){
 const alive=pid=>{if(!Number.isInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}};
 for(const entry of fs.readdirSync(cache,{withFileTypes:true})){if(!entry.isDirectory()||!/^oauth-ant-[A-Za-z0-9]{6}$/.test(entry.name))continue;const folder=path.join(cache,entry.name);try{const owner=JSON.parse(fs.readFileSync(path.join(folder,'.owner.json'),'utf8'));if(Number.isInteger(owner.pid)&&!alive(owner.pid)&&!alive(owner.childPid))fs.rmSync(folder,{recursive:true,force:true});}catch{}}
}
async function withProfile({home,store,profile,openBrowser,signal},operation){
 const cache=path.resolve(home,'cache');cleanupStale(cache);const folder=fs.mkdtempSync(path.join(cache,'oauth-ant-'));
 const executable=path.resolve(__dirname,'../tools/ant/ant.exe');
 const files=['configs/narae.json','credentials/narae.json'];
 try{
  store.call({action:'protect_directory',path:folder});
  const mark=childPid=>fs.writeFileSync(path.join(folder,'.owner.json'),JSON.stringify({pid:process.pid,childPid}));mark(null);
  for(const name of files)if(profile?.[name]){const file=path.join(folder,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,profile[name],{mode:0o600});}
  const env={...process.env};for(const name of Object.keys(env))if(/^ANTHROPIC_/i.test(name))delete env[name];
  Object.assign(env,{ANTHROPIC_CONFIG_DIR:folder,ANTHROPIC_PROFILE:'narae'});
  const run=(args,{login=false}={})=>new Promise((resolve,reject)=>{
   if(signal?.aborted)return reject(new Error('계정 연결을 취소했습니다.'));
   const child=spawn(executable,['--profile','narae',...args],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='',opened=false,opening=Promise.resolve();
   mark(child.pid||null);
   const abort=()=>child.kill(),timer=setTimeout(abort,login?310000:30000);signal?.addEventListener('abort',abort,{once:true});
   const collect=(stream,chunk)=>{const value=chunk.toString('utf8');if(stream==='out')stdout=(stdout+value).slice(-524288);else stderr=(stderr+value).slice(-524288);
    if(login&&!opened){const match=(stdout+'\n'+stderr).match(/https:\/\/[^\s\x1b]+/);if(match){const url=new URL(match[0]);if(url.origin!=='https://platform.claude.com'){child.kill();return;}opened=true;opening=Promise.resolve().then(()=>openBrowser(url.href)).catch(()=>{child.kill();throw new Error('로그인 브라우저를 열지 못했습니다.');});void opening.catch(()=>{});}}};
   child.stdout.on('data',chunk=>collect('out',chunk));child.stderr.on('data',chunk=>collect('err',chunk));
   child.on('error',()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(new Error('Claude Console 로그인 실행기를 시작하지 못했습니다.'));});
   child.on('close',async code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);try{await opening;if(signal?.aborted)throw new Error('계정 연결을 취소했습니다.');if(code!==0)throw new Error('Claude Console 연결을 완료하지 못했습니다. 브라우저 승인과 Console 계정 상태를 확인하세요.');resolve(stdout.trim());}catch(error){reject(error);}});
  });
  const result=await operation(run),saved={};for(const name of files)if(fs.existsSync(path.join(folder,name)))saved[name]=fs.readFileSync(path.join(folder,name),'utf8');
  return {result,profile:saved};
 }finally{const actual=path.resolve(folder);if(path.dirname(actual)!==cache||!path.basename(actual).startsWith('oauth-ant-'))throw new Error('OAuth 임시 경로 확인 실패');fs.rmSync(actual,{recursive:true,force:true});}
}
module.exports={withProfile};
