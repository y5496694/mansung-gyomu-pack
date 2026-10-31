'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),office='D:/Codex/workspaces/Narae_hangul_office',alias='Narae4-Qwen3.5-2B-Office-Bench-LoRA-v3';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const status=(stage,detail={})=>{fs.writeFileSync(path.join(root,'agent-pipeline-state.json'),JSON.stringify({pid:process.pid,at:new Date().toISOString(),stage,...detail},null,2));console.log(JSON.stringify({stage,...detail}));};
async function run(args,log,env={}){status(log);const out=fs.openSync(path.join(root,'logs',log),'w');try{await new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd:root,windowsHide:true,env:{...process.env,TEMP:path.join(root,'tmp'),TMP:path.join(root,'tmp'),...env},stdio:['ignore',out,out]});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(log+' failed: '+code)));});}finally{fs.closeSync(out);}}
(async()=>{
 status('waiting-for-direct-evaluation');const start=Date.now();
 for(;;){const file=path.join(root,'pipeline-state.json'),state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{};if(state.stage==='failed')throw Error('Direct evaluation pipeline failed');if(state.stage==='complete')break;if(Date.now()-start>7200000)throw Error('Direct evaluation timeout');await pause(3000);}
 const candidate=path.join(root,'exports',alias+'-f32.gguf');
 await run([office+'/experiments/narae-office-basic-10-20261031/run.cjs',path.join(root,'evaluation/basic-agent-v3')],'basic-agent-v3.log',{NARAE_BENCH_CANDIDATE:candidate,NARAE_BENCH_ALIAS:alias});
 await run(['scripts/workflows.cjs'],'workflows-v3.log');
 status('complete');
})().catch(error=>{status('failed',{message:error.message});process.exitCode=1;});
