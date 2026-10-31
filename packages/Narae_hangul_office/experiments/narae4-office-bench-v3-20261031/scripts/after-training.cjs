'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),alias='Narae4-Qwen3.5-2B-Office-Bench-LoRA-v3',report=path.join(root,'outputs',alias,'training-report.json');
const pause=ms=>new Promise(r=>setTimeout(r,ms)),python='D:/Codex/training/narae-sft-20261019/venv/Scripts/python.exe';
const status=(stage,detail={})=>{fs.writeFileSync(path.join(root,'pipeline-state.json'),JSON.stringify({at:new Date().toISOString(),stage,...detail},null,2));console.log(JSON.stringify({stage,...detail}));};
async function run(exe,args,log){
 status(path.basename(log));const out=fs.openSync(path.join(root,'logs',log),'w');
 try{await new Promise((resolve,reject)=>{const child=spawn(exe,args,{cwd:root,windowsHide:true,stdio:['ignore',out,out]});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(log+' failed with exit '+code)));});}finally{fs.closeSync(out);}
}
(async()=>{
 status('waiting-for-training-report');const started=Date.now();
 while(!fs.existsSync(report)){
  const file=path.join(root,'outputs',alias,'status.json');if(fs.existsSync(file)&&JSON.parse(fs.readFileSync(file)).stage==='failed')throw Error('Training failed; do not evaluate partial adapter');
  if(Date.now()-started>10800000)throw Error('Training did not complete within three hours');await pause(3000);
 }
 const trained=JSON.parse(fs.readFileSync(report));if(!trained.actual_weight_training||trained.optimizer_steps!==48)throw Error('Training report incomplete');
 await pause(2000);
 await run(python,['-X','utf8','scripts/export.py'],'export-run.log');
 for(const mode of ['baseline','trained'])for(const retention of [false,true])await run(process.execPath,['scripts/evaluate.cjs',mode,...(retention?['--retention']:[])],`${mode}${retention?'-retention':''}-run.log`);
 status('complete',{actualWeightTraining:true,optimizerSteps:48});
})().catch(error=>{status('failed',{message:error.message});process.exitCode=1;});
