'use strict';
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),{spawn}=require('node:child_process'),{once}=require('node:events'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),office=process.env.NARAE_OFFICE_ROOT||'D:/Codex/workspaces/Narae_hangul_office';
const {messagesFor,plannerSchema,responseFrom}=require(office+'/src/local-ai.cjs');
async function fileSha(file){const h=createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex');}
function check(response,c){
 if(c.expected){const o=response.output?.[0],e=c.expected;if(e.tool){if(o?.name!==e.tool)return false;const args=JSON.parse(o.arguments||'{}');if(!Object.entries(e.args).every(([k,v])=>args[k]===v))return false;return !e.operation||args.operations?.some(op=>Object.entries(e.operation).every(([k,v])=>op[k]===v)||op.op==='replace_text'&&op.target===e.operation.target&&op.find==='재료비: 81,000원'&&op.replace===e.operation.text&&op.expected===1);}const text=o?.content?.filter(p=>p.type==='output_text').map(p=>p.text).join('')||'';return o?.type==='message'&&(!e.finalExact||text.trim()===e.finalExact)&&(!e.finalIncludes||e.finalIncludes.every(s=>text.includes(s)))&&(!e.finalIncludesAny||e.finalIncludesAny.some(s=>text.includes(s))||c.id==='failed-save'&&text.includes('미저장'))&&(!e.finalExcludes||e.finalExcludes.every(s=>!text.includes(s)));}
 const o=response.output?.[0],expected=c.answer;
 if(expected.type==='tool'){if(o?.name!==expected.name)return false;const a=JSON.parse(o.arguments);return Object.entries(expected.args).every(([k,v])=>JSON.stringify(a[k])===JSON.stringify(v));}
 const text=o?.content?.filter(p=>p.type==='output_text').map(p=>p.text).join('')||'';
 if(o?.type!=='message')return false;
 if(c.kind==='partial-summary')return text.includes(c.answer.text.match(/2034-\d\d-\d\d/)[0])&&/첨부/.test(text)&&/미확인|확인.*못|읽.*못|암호/.test(text)&&!/(?:모두|전체).{0,10}확인했습니다|첨부.*확인 완료/.test(text);
 if(c.kind==='progress-summary')return ['2건','가상교감','가상부장','결재중','검토중'].every(s=>text.includes(s))&&/본문|첨부/.test(text)&&/미확인|읽지|열지|않/.test(text);
 return false;
}
async function main(){
 const protocol=JSON.parse(fs.readFileSync(path.join(root,'evaluation/protocol-freeze.json')));if(createHash('sha256').update(fs.readFileSync(__filename)).digest('hex')!==protocol.evaluateScriptSha256)throw Error('Evaluation protocol changed after freeze');
 const mode=process.argv[2]||'baseline';if(!['baseline','trained'].includes(mode))throw Error('baseline or trained');
 const retention=process.argv.includes('--retention'),suite=path.join(root,retention?'evaluation/retention-cases.json':'evaluation/heldout-cases.json'),manifest=JSON.parse(fs.readFileSync(path.join(root,'data/manifest.json'))),expectedHash=retention?JSON.parse(fs.readFileSync(path.join(root,'evaluation/retention-freeze.json'))).sha256:manifest.heldoutSha256;
 if(createHash('sha256').update(fs.readFileSync(suite)).digest('hex')!==expectedHash)throw Error('Frozen heldout changed');
 const cases=JSON.parse(fs.readFileSync(suite)),folder=path.join(root,'evaluation',mode+(retention?'-retention':''));fs.mkdirSync(folder,{recursive:true});
 const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const port=s.address().port;await new Promise(r=>s.close(r));
 const adapter=mode==='trained'?path.join(root,'exports/Narae4-Qwen3.5-2B-Office-Bench-LoRA-v3-f32.gguf'):'D:/Codex/models/narae-office/narae4/adapter.gguf';
 const baseSha256=await fileSha('D:/Codex/models/narae-office/narae4/base.gguf'),adapterSha256=await fileSha(adapter);
 if(baseSha256!=='aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223')throw Error('Runtime base hash mismatch');
 const expectedAdapter=mode==='trained'?JSON.parse(fs.readFileSync(path.join(root,'exports/verification.json'))).export_sha256:'19f20486e744bcb9636efcdaf6583c1b9bef545733987a8837e63afdfeecf105';
 if(adapterSha256!==expectedAdapter)throw Error('Runtime adapter hash mismatch');
 const args=['--model','D:/Codex/models/narae-office/narae4/base.gguf','--lora',adapter,'--alias','narae4-gyomu-eval','--host','127.0.0.1','--port',String(port),'--threads','6','--threads-batch','6','--ctx-size','8192','--batch-size','512','--ubatch-size','128','--parallel','1','--cache-ram','0','--gpu-layers','0','--fit','off','--jinja','--reasoning','on','--reasoning-budget','64','--no-warmup','--no-webui'];
 const log=fs.openSync(path.join(folder,'runtime.log'),'w'),child=spawn(office+'/runtime/llama/llama-server.exe',args,{windowsHide:true,stdio:['ignore',log,log]});fs.closeSync(log);
 fs.writeFileSync(path.join(folder,'profile.json'),JSON.stringify({mode,pid:child.pid,args,heldoutSha256:expectedHash,baseSha256,adapterSha256,syntheticOnly:true,retention},null,2));
 const api=async(route,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(180000)});if(!r.ok)throw Error('HTTP '+r.status);return r.json();};
 try{
  for(let i=0;;i++){if(child.exitCode!==null||i>600)throw Error('Server startup failed');try{if((await api('/health')).status==='ok')break;}catch{}await new Promise(r=>setTimeout(r,300));}
  const loaded=await api('/lora-adapters'),models=await api('/v1/models');
  if(loaded.length!==1||path.resolve(loaded[0].path)!==path.resolve(adapter)||loaded[0].scale!==1)throw Error('Active LoRA identity mismatch');
  if(!models.data?.some(m=>m.id==='narae4-gyomu-eval'))throw Error('Active model alias mismatch');
  fs.writeFileSync(path.join(folder,'runtime-verification.json'),JSON.stringify({adapterPathVerified:true,modelAliasVerified:true,scale:1,adapterSha256,baseSha256,protocolSha256:createHash('sha256').update(fs.readFileSync(path.join(root,'evaluation/protocol-freeze.json'))).digest('hex')},null,2));
  const results=[];
  for(const c of cases){const start=Date.now();let response,error;try{const input=c.input||[{role:'user',content:c.prompt}];for(const [i,o]of (c.observed||[]).entries())input.push({type:'function_call',name:o.name,arguments:JSON.stringify(o.args),call_id:'seen'+i},{type:'function_call_output',call_id:'seen'+i,output:JSON.stringify(o.value)});const body={instructions:c.instructions||c.messages[0].content.split('\n사용 가능한 도구와 인자:')[0]+'\n작업 폴더: D:/Codex/training/synthetic-gyomu',input,tools:c.tools};const raw=await api('/v1/chat/completions',{model:'narae4-gyomu-eval',messages:messagesFor(body),temperature:0,seed:719,max_tokens:768,chat_template_kwargs:{enable_thinking:true},response_format:{type:'json_schema',json_schema:{name:'narae_action',schema:plannerSchema(c.tools)}}});response=responseFrom(raw,c.tools);}catch(e){error=e.message;}
   const r={id:c.id,kind:c.kind,passed:response?check(response,c):false,response,error,seconds:(Date.now()-start)/1000};results.push(r);fs.writeFileSync(path.join(folder,c.id+'.json'),JSON.stringify(r,null,2));console.log(JSON.stringify({id:r.id,passed:r.passed,seconds:r.seconds}));
  }
  const report={mode,baseSha256,adapterSha256,suiteSha256:expectedHash,scope:'Direct model choices without bounded executor; synthetic unseen values in known workflow families',total:results.length,passed:results.filter(r=>r.passed).length,results};fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({mode,total:report.total,passed:report.passed}));
 }finally{if(child.exitCode===null){child.kill();await once(child,'exit');}}
}
module.exports={check};if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
