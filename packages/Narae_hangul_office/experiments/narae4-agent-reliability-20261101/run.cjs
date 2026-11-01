'use strict';
// End-to-end installed v1 weights + real image/HWPX tools. Never school writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),os=require('node:os');
const {createHash}=require('node:crypto'),{spawnSync}=require('node:child_process');
const office=path.resolve(__dirname,'../..'),{run}=require(office+'/src/agent-cli.cjs'),{execute}=require(office+'/src/cli.cjs');
const {LocalAI}=require(office+'/src/local-ai.cjs');
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const attempt=path.resolve(process.argv[2]||'D:/Codex/training/narae4-agent-reliability-20261101-'+Date.now());
assert(!fs.existsSync(attempt),'Use a fresh evaluation directory.');
const workspace=path.join(attempt,'workspace'),home=path.join(attempt,'home');fs.mkdirSync(workspace,{recursive:true});
const fixture=spawnSync(process.env.NARAE_FIXTURE_PYTHON||'python',[path.join(__dirname,'fixtures.py'),workspace],{encoding:'utf8',windowsHide:true});assert.equal(fixture.status,0,fixture.stderr);
const modelDir=process.env.NARAE_AI_MODELS||'D:/Codex/models/narae-office',catalog=require(office+'/resources/local-models.json'),model=catalog.models.find(m=>m.id==='narae4');
const expectedAdapter=sha(path.join(modelDir,'narae4/adapter.gguf'));assert.equal(expectedAdapter,model.adapter.sha256);
const sourceFiles=['src/agent.cjs','src/image-task.cjs','src/document-task.cjs','src/local-ai.cjs'];
const sourceSha256=Object.fromEntries(sourceFiles.map(p=>[p,sha(path.join(office,p))])),scriptSha256=sha(__filename),fixtureScriptSha256=sha(path.join(__dirname,'fixtures.py'));
const results=[];
const signature=d=>({paragraphs:d.paragraphs.map(({text,text_style,paragraph_style})=>({text,text_style,paragraph_style})),tables:d.tables});
async function test(id,prompt,options,check){
 const start=Date.now(),events=[],memory={freeBytes:os.freemem(),totalBytes:os.totalmem()};let result,error,passed=false;
 // One model at a time; leave the user's other applications untouched.
 assert(memory.freeBytes>=2.5*1024**3,'Insufficient free memory for an isolated local evaluation.');
 try{result=await run({prompt,workspace,model:'narae4',...options},{home,signal:AbortSignal.timeout(300000),createAI:options=>{const ai=new LocalAI(options);ai.dir=modelDir;return ai;},onEvent:e=>{if(['tool','error'].includes(e.type))events.push(e);}});passed=Boolean(await check(result,events));}catch(e){error=e.message;}
 const record={id,passed,seconds:(Date.now()-start)/1000,memory,result,error,events};results.push(record);fs.writeFileSync(path.join(attempt,id+'.json'),JSON.stringify(record,null,2));console.log(JSON.stringify({id,passed,error,seconds:record.seconds}));
}
async function main(){
 const cases=JSON.parse(fs.readFileSync(path.join(workspace,'expected.json'),'utf8'));
 for(const [i,c]of cases.entries())await test('image-'+i,'"'+c.file+'"를 실제로 읽고 장소, 비용, 시작·종료 시간을 알려 줘.',{},(r,e)=>[c.venue,c.cost.replaceAll(',',''),c.start,c.end].every(s=>r.text.replaceAll(',','').includes(s))&&e.filter(x=>x.name==='read_image').length===1);
 await test('image-comparison','"'+cases[0].file+'"와 "'+cases[1].file+'"를 비교해서 각각의 장소와 비용을 알려 줘.',{},(r,e)=>cases.every(c=>[c.venue,c.cost.replaceAll(',','')].every(s=>r.text.replaceAll(',','').includes(s)))&&e.filter(x=>x.name==='read_image').length===2);
 const file=path.join(workspace,'가상안내.hwpx');
 await execute({action:'create',path:file,title:'가상 행사 안내',blocks:[{type:'paragraph',text:'장소: 솔빛교실'},{type:'paragraph',text:'일시: 2039년 5월 16일 14:10'},{type:'paragraph',text:'훈련용 가상 자료이며 실제 학교 일정이 아닙니다.'}]},{home});
 const before=await execute({action:'inspect',path:file},{home});
 await test('text-replacement','장소만 “솔빛교실”을 “물결교실”로 바꾸고 저장된 내용을 확인해 줘. 다른 내용은 유지해 줘.',{context:file,allowChanges:true},async(r,e)=>{
  const after=await execute({action:'inspect',path:file},{home}),expected=signature(before);expected.paragraphs=expected.paragraphs.map(p=>({...p,text:p.text.replace('솔빛교실','물결교실')}));
  fs.writeFileSync(path.join(attempt,'native-before.json'),JSON.stringify(before,null,2));fs.writeFileSync(path.join(attempt,'native-after.json'),JSON.stringify(after,null,2));
  return JSON.stringify(signature(after))===JSON.stringify(expected)&&e.filter(x=>x.name==='edit_document').length===1&&/솔빛교실 → 물결교실/.test(r.text);
 });
 const sourceUnchanged=sourceFiles.every(p=>sha(path.join(office,p))===sourceSha256[p])&&sha(__filename)===scriptSha256&&sha(path.join(__dirname,'fixtures.py'))===fixtureScriptSha256;
 const report={at:new Date().toISOString(),model:model.alias,adapterSha256:expectedAdapter,actualLocalWeights:true,syntheticOnly:true,scope:'Bounded executor + installed v1 model + real image and HWPX tools. Not raw model choices or public OfficeBench.',fullTenTaskPass:false,releasePassed:false,passed:results.filter(r=>r.passed).length,total:results.length,sourceSha256,scriptSha256,fixtureScriptSha256,sourceUnchanged,fixtures:cases.map(c=>({file:c.file,sha256:sha(path.join(workspace,c.file))})),defaultAdapterChanged:sha(path.join(modelDir,'narae4/adapter.gguf'))!==expectedAdapter,results};
 fs.writeFileSync(path.join(attempt,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({attempt,passed:report.passed,total:report.total,defaultAdapterChanged:report.defaultAdapterChanged}));
 if(!sourceUnchanged||report.passed!==report.total||report.defaultAdapterChanged)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
