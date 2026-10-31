'use strict';
// Actual candidate weights with synthetic school observations and real files.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),office=process.env.NARAE_OFFICE_ROOT||'D:/Codex/workspaces/Narae_hangul_office';
const digest=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const scriptSha256=digest(__filename),only=process.argv.includes('--only')?process.argv[process.argv.indexOf('--only')+1]:null;
function prepare(){
 if(process.argv.includes('--installed')){const catalog=structuredClone(require(office+'/resources/local-models.json'));return {catalog,model:catalog.models.find(m=>m.id==='narae4'),models:'D:/Codex/models/narae-office',installed:true};}
 const verification=JSON.parse(fs.readFileSync(path.join(root,'exports/verification.json')));assert(verification.all_tensors_bitwise_equal);
 const catalog=structuredClone(require(office+'/resources/local-models.json')),model=catalog.models.find(m=>m.id==='narae4'),adapter=path.join(root,'exports/Narae4-Qwen3.5-2B-Office-Bench-LoRA-v3-f32.gguf');
 model.alias='Narae4-Qwen3.5-2B-Office-Bench-LoRA-v3';model.adapter={path:path.basename(adapter),bytes:fs.statSync(adapter).size,sha256:digest(adapter)};model.optimizerUpdates=64;model.continuationOptimizerUpdates=48;
 const models=path.join(root,'evaluation/candidate-models'),directory=path.join(models,'narae4');fs.mkdirSync(directory,{recursive:true});
 for(const key of ['base','adapter','projector','decision']){const source=key==='adapter'?adapter:'D:/Codex/models/narae-office/narae4/'+key+'.gguf',target=path.join(directory,key+'.gguf');if(!fs.existsSync(target))fs.linkSync(source,target);assert.equal(digest(target),model[key].sha256);}
 fs.writeFileSync(path.join(directory,'installed.json'),JSON.stringify(Object.fromEntries(['base','adapter','projector','decision'].map(k=>[k,model[k].sha256]))));
 const catalogFile=path.join(root,'evaluation/candidate-catalog.json');fs.writeFileSync(catalogFile,JSON.stringify(catalog,null,2));return {catalog,model,models,catalogFile};
}
async function main(){
 if(!root.toLowerCase().startsWith('d:\\codex\\training\\'))throw Error('Run the copied script inside a D:/Codex/training run.');
 const candidate=prepare();if(process.argv.includes('--prepare-only')){console.log(JSON.stringify({models:candidate.models,catalog:candidate.catalogFile}));return;}
 const {LocalAI}=require(office+'/src/local-ai.cjs'),{run}=require(office+'/src/agent-cli.cjs'),{execute:document}=require(office+'/src/cli.cjs');
 const vendor=(await import(require('node:url').pathToFileURL(office+'/vendor/narae-gyomu/src/catalog.mjs').href)).tools.map(t=>({type:'function',...t,name:'gyomu_'+t.name.replaceAll('.','_')}));
 const attempt=path.join(root,'evaluation/workflow-'+Date.now()),workspace=path.join(attempt,'workspace'),home=path.join(attempt,'home');fs.mkdirSync(workspace,{recursive:true});const results=[];
 async function test(id,prompt,{context,allowChanges=false,mock,check}={}){
  if(only&&!only.split(',').includes(id))return;
  const events=[],start=Date.now();let result,error,passed=false;
  try{result=await run({prompt,workspace,context,model:'narae4',allowChanges},{home,signal:AbortSignal.timeout(600000),createAI:options=>{const ai=new LocalAI({...options,catalog:candidate.catalog});ai.dir=candidate.models;return ai;},...(mock?{createIntegrations:()=>({async tools(){return structuredClone(vendor);},execute:mock,async close(){}})}:{}),onEvent:e=>{if(['tool','error'].includes(e.type))events.push(e);}});passed=await check(result,events);}catch(e){error=e.message;}
  const record={id,passed:Boolean(passed),scope:mock?'actual local candidate model + mock school tools':'actual local candidate model + native document/image tools',seconds:(Date.now()-start)/1000,result,error,events};results.push(record);fs.writeFileSync(path.join(attempt,id+'.json'),JSON.stringify(record,null,2));console.log(JSON.stringify({id,passed:record.passed,error,seconds:record.seconds}));
 }
 const noteBodies={fa:'가상 참가 신청서를 2038-09-11까지 제출해 주세요.',fb:'가상 도서 수량을 2038-09-12까지 회신해 주세요.'};
 await test('workflow-cbe','소통메신저 받은 쪽지 최근 2건 본문을 모두 읽고 할 일과 기한을 요약해 줘.',{mock:async(name,args)=>{assert.equal(name,'gyomu_cbe_notes');if(args.operation==='list')return {items:[{id:'fa',title:'가상 신청'},{id:'fb',title:'가상 도서'}],page:1,total:2};assert(noteBodies[args.id]);return {id:args.id,title:args.id==='fa'?'가상 신청':'가상 도서',text:noteBodies[args.id],attachments:[]};},check:(r,e)=>['2038-09-11','2038-09-12'].every(s=>r.text.includes(s))&&new Set(e.filter(x=>x.name==='gyomu_cbe_notes'&&x.args.operation==='read').map(x=>x.args.id)).size===2});
 const page={title:'결재진행 | 업무관리시스템',url:'https://fixture.invalid/edufine/progress',frameIndex:4,text:'2038-09-01 ~ 2038-09-12 / 총 2건 / 1/1페이지',tables:['문서제목 결재상태 현재결재자\n가상 신청 계획 결재중 가상교감\n가상 도서 계획 검토중 가상부장'],elements:[{ref:'s1/a',label:'가상 신청 계획',documentTitle:true},{ref:'s1/b',label:'가상 도서 계획',documentTitle:true}]};
 const skill=()=>({text:fs.readFileSync(office+'/resources/agent-skills/edufine.md','utf8'),hasMore:false});
 await test('workflow-progress','에듀파인 문서진행의 상태와 현재 결재자를 확인해 줘. 본문은 아직 열지 마.',{mock:async(name)=>name==='gyomu_skill_read'?skill():(assert.equal(name,'gyomu_browser'),page),check:r=>['가상교감','가상부장'].every(s=>r.text.includes(s))&&/본문.*미확인/.test(r.text)});
 let prepared,opened=false;const captures=new Map(),attachments=[path.join(workspace,'가상첨부1.txt'),path.join(workspace,'가상첨부2.txt')];fs.writeFileSync(attachments[0],'신청서 제출처는 가상교육실입니다.');fs.writeFileSync(attachments[1],'도서 수량 회신처는 가상운영실입니다.');
 await test('workflow-edufine-read','에듀파인 진행 중 문서 2건의 본문과 모든 첨부를 읽고 할 일·기한·제출처를 요약해 줘.',{allowChanges:true,mock:async(name,args)=>{
  if(name==='gyomu_skill_read')return skill();
  if(name==='gyomu_browser'){if(args.action==='click'){assert(prepared);assert.equal(args.ref,prepared.index===0?'s1/a':'s1/b');opened=true;}return page;}
  if(name==='gyomu_wxs_read'){if(args.operation==='prepare'){assert(!opened);const index=page.elements.findIndex(e=>e.label===args.expected_title);assert(index>=0);prepared={id:'capture-'+index,index,title:args.expected_title};captures.set(prepared.id,prepared);return {id:prepared.id,ready:true,expected_title:prepared.title};}assert.equal(args.operation,'result');const c=captures.get(args.id);assert(c&&opened);opened=false;return {id:c.id,pending:false,expected_title:c.title,document:{title:c.title,closed:true,body:{body_read:true,text:Object.values(noteBodies)[c.index],hasMore:false},attachments:{files:[{path:attachments[c.index],exported:true}]}}};}
  if(name==='gyomu_wxs_attachment')return {path:args.path,text:fs.readFileSync(args.path,'utf8'),hasMore:false,source_unchanged:true,needs_visual_review:false};
  throw Error('Unexpected fixture tool '+name);
 },check:(r,e)=>['2038-09-11','2038-09-12','가상교육실','가상운영실'].every(s=>r.text.includes(s))&&e.filter(x=>x.name==='gyomu_wxs_read'&&x.args.operation==='prepare').length===2&&/공문 2건/.test(r.text)});
 let saved=0,readback=false;const draft={title:'가상 보존 기안',body:'가상 기안 원문을 보존합니다.',attachments:[],approval_route:[{name:'가상교감',role:'결재'}]};
 await test('workflow-draft-save','현재 열린 WXS 기안을 임시저장해 줘. 제목과 원문은 유지하고 상신하지 마.',{allowChanges:true,mock:async(name,args)=>{if(name==='gyomu_browser')return {...page,title:'K-에듀파인',frameIndex:0,elements:[],text:'가상 임시저장'};if(name==='gyomu_skill_read')return skill();if(name==='gyomu_wxs'){if(args.operation==='windows')return {windows:[{hwnd:'9931',title:draft.title}]};assert.equal(args.operation,'draft-status');if(saved)readback=true;return {...draft,saved:Boolean(saved)};}if(name==='gyomu_wxs_save'){assert.equal(args.hwnd,'9931');assert.equal(args.expected_title,draft.title);saved++;assert.equal(saved,1);return {ok:true,result:{saved:true}};}throw Error('Unrequested fixture mutation: '+name);},check:r=>saved===1&&readback&&/임시저장|임시 저장/.test(r.text)&&/미상신|상신.*(?:않|마|전)/.test(r.text)});
 const file=path.join(workspace,'가상회의.hwpx');let nativeBefore;
 const contentSignature=d=>({blocks:d.blocks.map(({id,text,textStyle,paragraphStyle})=>({id,text,textStyle,paragraphStyle})),tables:d.tables});
 await test('workflow-native-create','훈련용 가상 회의 안내를 "가상회의.hwpx"로 만들어 줘. 2038년 9월 13일 15:20, 장소 가상회의실, 안건 가상 자료 검토. 실제 학교 일정이 아님을 표시해 줘.',{allowChanges:true,check:async()=>{const d=await document({action:'inspect',path:file,full:true},{home});nativeBefore=contentSignature(d);fs.writeFileSync(path.join(attempt,'native-before.json'),JSON.stringify(d,null,2));const s=d.blocks.map(b=>b.text).join('\n').replace(/\s/g,'');return s.includes('15:20')&&s.includes('가상회의실')&&s.includes('가상자료검토')&&/2038.{0,8}9.{0,8}13/.test(s)&&/실제.{0,20}(아님|아닙)/.test(s);}});
 await test('workflow-native-edit','회의 시각 15:20만 15:50으로 바꾸고 저장된 내용을 확인해 줘. 다른 내용은 유지해 줘.',{context:file,allowChanges:true,check:async()=>{const d=await document({action:'inspect',path:file,full:true},{home});fs.writeFileSync(path.join(attempt,'native-after.json'),JSON.stringify(d,null,2));const expected=structuredClone(nativeBefore);if(!expected)return false;for(const b of expected.blocks)b.text=b.text.replaceAll('15:20','15:50');return JSON.stringify(contentSignature(d))===JSON.stringify(expected);}});
 const image=path.join(workspace,'가상안내.png');fs.copyFileSync(path.join(root,'fixtures/notice.png'),image);
 await test('workflow-vision','작업 폴더의 "가상안내.png"를 read_image로 실제 분석해서 보이는 장소, 비용, 시작·종료 시간을 알려 줘.',{check:r=>{const s=r.text.replaceAll(',','');return ['꿈빛과학관','174000','09:20','11:40'].every(t=>s.includes(t));}});
 const report={model:candidate.model.alias,adapterSha256:candidate.model.adapter.sha256,actualLocalWeights:true,actualCandidateWeights:!candidate.installed,syntheticOnly:true,scriptSha256,selection:only||'all',scope:'School tools are mock observations; HWPX and image tools use real engines. No school login or submission.',attempt,passed:results.filter(r=>r.passed).length,total:results.length,results};fs.writeFileSync(path.join(attempt,'report.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(root,'evaluation/workflow-report'+(candidate.installed?'-installed':'')+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,total:report.total}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
