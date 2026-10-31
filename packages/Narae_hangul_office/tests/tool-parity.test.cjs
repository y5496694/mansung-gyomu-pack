'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {evidenceReport}=require('../src/evidence-report.cjs'),{executeDocumentTool}=require('../src/document-tools.cjs'),{RemotePolicy}=require('../src/remote-policy.cjs'),{tools,runAgent}=require('../src/agent.cjs');
const pair=(name,args,value,id)=>[{type:'function_call',name,arguments:JSON.stringify(args),call_id:id},{type:'function_call_output',call_id:id,output:JSON.stringify(value)}];
test('source selection cannot invent completion, discard a cancellation/deadline or replace query dates',()=>{
 const context={documents:[{title:'가상 신청',bodyRead:true,body:'마감은 2041-03-19 13:20입니다. 이전 요청은 취소되었습니다.',attachments:[{path:'D:/fixture/서식.txt',text:'제출처는 가상 자료실입니다.',unconfirmed:false},{path:'D:/fixture/실패.pdf',text:'확인하면 안 되는 부분 추출',unconfirmed:true,error:'시각 확인 필요'}]}],query:{text:'2041-03-01~2041-03-31 / 총 1건 / 1/1페이지'}};
 const r=evidenceReport(context,'본문 1건, 첨부 1개 미확인'),ids=r.context.excerpts.map(e=>e.id);assert.equal(ids.length,new Set(ids).size);assert.throws(()=>r.render(['invented']),/원문에 없는/);
 const text=r.render([ids[0]]);for(const expected of ['취소','2041-03-19','가상 자료실','실패.pdf 미확인','조회 조건(실제 목록 표시): 2041-03-01~2041-03-31'])assert(text.includes(expected));assert(!text.includes('확인하면 안 되는 부분 추출'));
});
test('a local messenger agent chooses source IDs and never publishes free-form invented statuses',async()=>{
 const vendor=(await import('../vendor/narae-gyomu/src/catalog.mjs')).tools.map(t=>({...t,name:'gyomu_'+t.name.replaceAll('.','_')}));let reads=0,selection=false;
 const text=await runAgent({prompt:'받은 쪽지 최근 1건의 본문 요약',settings:{provider:'local',workspace:os.tmpdir()},signal:new AbortController().signal,additionalTools:vendor,send:()=>{},
  execute:async(name,args)=>{assert.equal(name,'gyomu_cbe_notes');if(args.operation==='list')return {items:[{id:'source1',title:'가상 회신'}]};reads++;return {id:'source1',text:'가상 도구실로 2041-03-20까지 회신해 주세요.'};},
  request:async body=>{const tool=body.tools[0];if(tool.name==='report_evidence'){selection=true;assert.equal(body.evidenceReport,true);return {output:[{type:'message',content:[{type:'output_text',text:'수신자가 읽었고 업무가 완료됐습니다.'}]}]};}const props=tool.parameters.properties,args=Object.fromEntries(tool.parameters.required.map(k=>[k,props[k].enum[0]]));return {output:[{type:'function_call',name:tool.name,arguments:JSON.stringify(args),call_id:'t'+reads+body.input.length}]};}});
 assert(selection);assert.equal(reads,1);assert(text.includes('2041-03-20'));assert(text.includes('가상 도구실'));assert(!text.includes('수신자가 읽었고'));assert(text.includes('조회한 원문'));
});
test('temp-save with a preserve-body request finishes after one verified readback, including route preservation',async()=>{
 const {taskFor,taskStep}=require('../src/agent-task.cjs'),{wxsStep}=require('../src/wxs-task.cjs');
 const all=(await import('../vendor/narae-gyomu/src/catalog.mjs')).tools.map(t=>({...t,name:'gyomu_'+t.name.replaceAll('.','_')})),prompt='현재 열린 WXS 기안을 임시저장해 줘. 제목·본문·첨부·결재선은 유지하고 상신하지 마.',task=taskFor(prompt);
 const before={title:'가상 기안',body:'원문',attachments:[],approval_route:[{name:'가상 결재',role:'결재'}]},input=[...pair('gyomu_browser',{action:'snapshot'},{title:'K-에듀파인',elements:[]},'s'),...pair('gyomu_wxs',{operation:'draft-status',hwnd:'88'},before,'a'),...pair('gyomu_wxs_save',{hwnd:'88',expected_title:before.title},{ok:true,result:{saved:true}},'b'),...pair('gyomu_wxs',{operation:'draft-status',hwnd:'88'},{...before,saved:true},'c')];
 assert.equal(task.summary,false);const step=wxsStep(prompt,input,taskStep(task,input,all),task);assert(step.receipt.includes('미상신'));assert.equal(step.tools.length,0);
 input.at(-1).output=JSON.stringify({...before,body:'예상치 않은 변경'});assert(wxsStep(prompt,input,taskStep(task,input,all),task).receipt.includes('보존 완료로 처리하지'));
});
test('real document tools preserve the requested heading, read all pages, and save edits to a new copy',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'narae-tool-parity-')),options={workspace:home,home};try{
  const file=path.join(home,'다른파일명.hwpx');await executeDocumentTool('create_document',{path:file,title:'정확한 가상 제목',text:'정확한 가상 제목\n가상 첫 본문\n가상 둘째 본문\n가상 셋째 본문',notice:'합성 훈련용 자료입니다.',page:{width_mm:210,height_mm:297,margins_mm:[20,20,20,20]}},options);
  const a=await executeDocumentTool('read_document',{path:file,limit:2},options),b=await executeDocumentTool('read_document',{path:file,offset:a.nextOffset,limit:20},options);assert.equal(a.paragraphs[0].text,'정확한 가상 제목');assert.equal(a.hasMore,true);assert.equal(b.hasMore,false);assert.equal(a.input_sha256,b.input_sha256);assert.equal(a.paragraphs[0].text_style.bold,true);assert(b.paragraphs.some(p=>p.text==='합성 훈련용 자료입니다.'));
  const target=path.join(home,'사본.hwpx');await executeDocumentTool('edit_document',{path:file,target,expectedHash:b.input_sha256,operations:[{op:'set_text',target:b.paragraphs[0].id,text:'가상 둘째 본문 수정'}]},options);
  const original=await executeDocumentTool('read_document',{path:file},options),copy=await executeDocumentTool('read_document',{path:target},options);assert.equal(original.input_sha256,a.input_sha256);assert(copy.paragraphs.some(p=>p.text==='가상 둘째 본문 수정'));
  const policy=new RemotePolicy({workspace:()=>home,autoAllow:()=>true});assert.throws(()=>policy.prepare('edit_document',{path:file,target:'../outside.hwpx',expectedHash:a.input_sha256,operations:[{op:'set_text',target:'x',text:'x'}]}),/폴더/);policy.close();
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('document and saved-attachment pagination binds the observed next offset',()=>{
 const {documentStep}=require('../src/document-task.cjs'),all=[...tools,{name:'gyomu_wxs_attachment',parameters:{}}];
 for(const name of ['read_document','gyomu_wxs_attachment']){const step=documentStep('가상 파일을 읽어 줘',pair(name,{path:'D:/fixture/file',offset:0},{hasMore:true,nextOffset:60},'a'),all,'D:/fixture');assert.equal(step.required,true);assert.deepEqual(step.tools[0].parameters.properties.offset.enum,[60]);assert.deepEqual(step.tools[0].parameters.properties.path.enum,['D:/fixture/file']);}
});
test('paged source summaries never merge different file revisions or claim a skipped initial range',()=>{
 const {documentStep}=require('../src/document-task.cjs'),input=[...pair('gyomu_wxs_attachment',{path:'D:/fixture/plain.txt',offset:60},{text:'가상 신청서',hasMore:false,sha256:'h1'},'a')];
 let step=documentStep('파일 요약',input,[],'D:/fixture');assert.equal(step.evidenceReport,true);assert(step.footer.includes('일부 범위'));
 input.push(...pair('gyomu_wxs_attachment',{path:'D:/fixture/plain.txt',offset:0},{text:'다른 본문',hasMore:false,sha256:'h2'},'b'));step=documentStep('파일 요약',input,[],'D:/fixture');assert(step.receipt.includes('파일 해시가 달라져'));
});
test('chat evidence retains observed speaker/date without mislabeling the mailbox',()=>{
 const report=evidenceReport({kind:'chat',box:'received',documents:[{title:'가상 회의',items:[{sender:'가상민',date:'2041-04-22 09:00',text:'2041-04-24까지 가상회의실 제출'}]}]});const text=report.render([]);for(const part of ['가상민','2041-04-22 09:00','조회함: 대화'])assert(text.includes(part));assert(!text.includes('조회함: 받은 쪽지'));
});
test('bounded school read actions execute observed arguments but never become an automatic save or final action',()=>{
 const {candidatesFor}=require('../src/local-decision.cjs'),tool=(name,operation)=>({name,parameters:{type:'object',properties:{operation:{type:'string',enum:[operation]},hwnd:{type:'string',enum:['88']}},required:['operation','hwnd'],additionalProperties:false}});
 assert.equal(candidatesFor({tool_choice:'required',tools:[tool('gyomu_wxs','draft-status')]}).length,1);
 for(const [name,op]of [['gyomu_wxs','final-action'],['gyomu_cbe_notes','send'],['gyomu_wxs_save','save']])assert.equal(candidatesFor({tool_choice:'required',tools:[tool(name,op)]}).length,0);
});
test('in-place editing cannot invent a copy destination while an explicit copy retains the new-file tool',()=>{
 const {documentStep}=require('../src/document-task.cjs'),file='D:/fixture/안내.hwpx',input=pair('read_document',{path:file},{hash:'h1',paragraphs:[{id:'p1',text:'가상 시각 10:10'}],hasMore:false},'read');
 const inplace=documentStep('시각 10:10만 10:25로 바꿔 줘',input,tools,'D:/fixture',false,file),copy=documentStep('시각을 수정하고 사본으로 저장해 줘',input,tools,'D:/fixture',false,file);
 assert(!Object.hasOwn(inplace.tools.find(t=>t.name==='edit_document').parameters.properties,'target'));assert(copy.tools.find(t=>t.name==='edit_document').parameters.required.includes('target'));
 const op=inplace.tools.find(t=>t.name==='edit_document').parameters.properties.operations.items;assert(inplace.required);assert.deepEqual(op.properties.text.enum,['가상 시각 10:25']);assert(!op.properties.expected);
});
test('a non-Hangul format error selects the existing format reader instead of reporting an empty summary',()=>{
 const {documentStep}=require('../src/document-task.cjs'),input=pair('read_document',{path:'D:/fixture/안내.txt'},{error:'HWP/HWPX만 지원'},'a'),step=documentStep('안내.txt 요약',input,[{name:'gyomu_wxs_attachment'}],'D:/fixture');assert(step.required);assert.deepEqual(step.tools[0].parameters.properties.path.enum,['D:/fixture/안내.txt']);assert.equal(step.tools[0].name,'gyomu_wxs_attachment');
});
test('new draft literal fields bind to the observed window and input readback leads to exactly one save',async()=>{
 const {taskFor}=require('../src/agent-task.cjs'),{wxsStep}=require('../src/wxs-task.cjs'),all=(await import('../vendor/narae-gyomu/src/catalog.mjs')).tools.map(t=>({...t,name:'gyomu_'+t.name.replaceAll('.','_')}));
 const prompt='현재 열린 WXS 새 기안에 제목 "가상 계획", 본문 "훈련 문안입니다. 끝.』"를 입력하고 임시저장해 줘. 기존 결재선 유지. 상신하지 마.',task=taskFor(prompt),input=[...pair('gyomu_wxs',{operation:'windows'},{windows:[{hwnd:'77',title:'빈 문서'}]},'w'),...pair('gyomu_wxs',{operation:'draft-status',hwnd:'77'},{title:'빈 문서',body:''},'r')];
 let step=wxsStep(prompt,input,{tools:all},task),tool=step.tools.find(t=>t.name==='gyomu_wxs_prepare');assert(step.required);assert.equal(step.tools.length,1);assert.deepEqual(tool.parameters.properties.hwnd.enum,['77']);assert.deepEqual(tool.parameters.properties.config.properties.body.enum,['훈련 문안입니다. 끝.』']);assert(!tool.parameters.properties.config.properties.approval_route);
 input.push(...pair('gyomu_wxs_prepare',{hwnd:'77',config:{expected_title:'빈 문서',title:'가상 계획',body:'훈련 문안입니다. 끝.』'}},{ok:true,result:{saved:false}},'a'),...pair('gyomu_wxs',{operation:'draft-status',hwnd:'77'},{title:'가상 계획',body:'훈련 문안입니다. 끝.』'},'b'));
 step=wxsStep(prompt,input,{tools:all},task);assert.equal(step.tools[0].name,'gyomu_wxs_save');assert.deepEqual(step.tools[0].parameters.properties.expected_title.enum,['가상 계획']);
 const compound=wxsStep(prompt,input.slice(0,4),{tools:[...all,...tools]},{...task,documentCreate:true});assert(compound.tools.some(t=>t.name==='create_document'));
});
test('reobservation cannot reset repeated edit errors just because the model varies failed arguments',async()=>{
 let requests=0;await assert.rejects(runAgent({prompt:'가상 문서 작업',settings:{workspace:'D:/fixture'},signal:new AbortController().signal,send:()=>{},execute:async name=>{if(name==='edit_document')throw Error('합성 편집 오류');return {hash:'same',paragraphs:[]};},request:async()=>{requests++;const editing=requests%2===1;return {output:[{type:'function_call',name:editing?'edit_document':'read_document',arguments:JSON.stringify({path:'D:/fixture/test.hwpx',...(editing?{expectedHash:'same',operations:[{op:'set_text',target:'p1',text:'시도'+requests}]}:{})}),call_id:'r'+requests}]};}}),/같은 도구 오류가 반복/);assert.equal(requests,5);
});
