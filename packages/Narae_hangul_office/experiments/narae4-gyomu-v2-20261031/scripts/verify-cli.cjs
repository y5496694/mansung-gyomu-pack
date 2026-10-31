'use strict';
// Real document engine, synthetic content, stub planner. Model tests are separate.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const office=process.env.NARAE_OFFICE_ROOT||'D:/Codex/workspaces/Narae_hangul_office',root=path.resolve(process.argv[2]||'D:/Codex/tmp/narae4-gyomu-cli-'+Date.now());
const call=(name,args)=>({output:[{type:'function_call',name,arguments:JSON.stringify(args),call_id:'step-'+Date.now()}]});
async function main(){
 if(!root.startsWith('D:\\Codex\\tmp\\')||fs.existsSync(root))throw Error('Use a new D:/Codex/tmp verification directory.');
 const workspace=path.join(root,'Documents'),home=path.join(root,'home');fs.mkdirSync(workspace,{recursive:true});
 const file=path.join(workspace,'가상교무-계획.hwpx'),content='가상 교무 시험\n제출기한: 2034-04-18\n예산: 84,000원\n실제 학교 업무와 무관한 합성 문서입니다.';
 const {run}=require(office+'/src/agent-cli.cjs'),{execute}=require(office+'/src/cli.cjs');
 let created=false;
 const result=await run({prompt:'"가상교무-계획.hwpx" 한글 문서를 만들어 줘.',workspace,allowChanges:true},{home,createAI:()=>({async request(){if(created)throw Error('Unexpected repeated creation');created=true;return call('create_document',{path:file,text:content});},async close(){}})});
 const before=await execute({action:'inspect',path:file,full:true},{home}),paragraph=before.paragraphs.find(p=>p.text==='예산: 84,000원');assert(paragraph);
 const changed=await execute({action:'edit',path:file,expected_input_sha256:before.input_sha256,operations:[{op:'set_text',target:paragraph.id,text:'예산: 88,000원'}]},{home});
 const after=await execute({action:'inspect',path:file,full:true},{home});assert(after.paragraphs.some(p=>p.text==='예산: 88,000원'));assert(after.paragraphs.some(p=>p.text==='제출기한: 2034-04-18'));assert.notEqual(before.input_sha256,after.input_sha256);
 const report={version:require(office+'/package.json').version,syntheticOnly:true,planner:'stub (not a model-quality test)',nativeEngine:true,agentCreate:fs.existsSync(file)&&result.text.includes(file),editSaved:Boolean(changed.saved||changed.path||changed.output),rereadVerified:true,scope:'Actual HWPX creation through headless agent, hash-checked edit and reread. No live school request.',file};
 fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({root,...report},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
