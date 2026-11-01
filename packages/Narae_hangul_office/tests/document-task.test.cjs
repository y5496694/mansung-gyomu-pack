'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {documentStep}=require('../src/document-task.cjs'),{tools}=require('../src/agent.cjs');
const prompt='"계획.hwp" 만들고 읽어 검토한 뒤 PDF 사본도 만들어 줘',input=[];
function record(name,args,value){const id=String(input.length);input.push({type:'function_call',name,call_id:id,arguments:JSON.stringify(args)},{type:'function_call_output',call_id:id,output:JSON.stringify(value)});}
test('a created HWP and a model completion claim cannot stand in for an actual PDF export',()=>{
 assert.equal(documentStep(prompt,input,tools,'D:/synthetic'),null);
 record('create_document',{path:'D:/synthetic/계획.hwp'},{path:'D:/synthetic/계획.hwp',modeledContentVerified:true});
 assert.equal(documentStep(prompt,input,tools,'D:/synthetic').tools[0].name,'read_document');
 record('read_document',{path:'D:/synthetic/계획.hwp'},{hash:'verified'});input.push({role:'assistant',content:'PDF도 만들었습니다.'});
 let step=documentStep(prompt,input,tools,'D:/synthetic');assert(step.required);assert.equal(step.tools[0].name,'export_pdf');assert(step.tools[0].parameters.properties.target.enum[0].endsWith('계획.pdf'));
 record('export_pdf',{path:'D:/synthetic/계획.hwp',target:'D:/synthetic/계획.pdf'},{pages:1,bytes:100});assert.equal(documentStep(prompt,input,tools,'D:/synthetic'),null);assert.match(documentStep(prompt,input,tools,'D:/synthetic',true).receipt,/계획.pdf/);
 assert.equal(documentStep('"계획.hwp"를 PDF 원본에서 변환해줘',input,tools,'D:/synthetic',true),null);
});
test('failed PDF output is incomplete and a final school attempt cannot start new document writes',()=>{
 const records=input.slice(0,-2),id='failed';records.push({type:'function_call',name:'export_pdf',call_id:id,arguments:'{"path":"D:/synthetic/계획.hwp"}'},{type:'function_call_output',call_id:id,output:'{"error":"export failed"}'});
 assert.match(documentStep(prompt,records,tools,'D:/synthetic').receipt,/확인하지 못/);
 records.push({type:'function_call',name:'gyomu_wxs_final_prepare',call_id:'final',arguments:'{}'},{type:'function_call_output',call_id:'final',output:'{"kind":"wxs-final"}'});assert.equal(documentStep(prompt,records,tools,'D:/synthetic'),null);
});
test('one requested time replacement ends only after matching saved hash and unchanged other paragraphs',()=>{
 const file='D:/synthetic/회의.hwpx',records=[],add=(name,args,value)=>{const id=String(records.length);records.push({type:'function_call',name,arguments:JSON.stringify(args),call_id:id},{type:'function_call_output',call_id:id,output:JSON.stringify(value)});};
 add('read_document',{path:file},{hash:'before',paragraphs:[{id:'p1',text:'가상 회의'},{id:'p2',text:'일시: 2038-09-13 15:20'}],hasMore:false});
 add('edit_document',{path:file,expectedHash:'before',operations:[{op:'replace_text',target:'p2',find:'2038-09-13 15:20',replace:'2038-09-13 15:50',expected:1}]},{saved:true,modeledContentVerified:true,hash:'after'});
 const prompt='회의 시각 15:20만 15:50으로 바꾸고 저장 내용을 확인해 줘.';assert.equal(documentStep(prompt,records,tools,'D:/synthetic',true,file).tools[0].name,'read_document');
 add('read_document',{path:file},{hash:'after',paragraphs:[{id:'new1',text:'가상 회의'},{id:'new2',text:'일시: 2038-09-13 15:50'}],hasMore:false});assert.match(documentStep(prompt,records,tools,'D:/synthetic',true,file).receipt,/15:20 → 15:50/);
 const changed=JSON.parse(records.at(-1).output);changed.paragraphs[0].text='다른 제목';records.at(-1).output=JSON.stringify(changed);assert.equal(documentStep(prompt,records,tools,'D:/synthetic',true,file).receipt,undefined);
});

test('an explicit quoted text replacement uses observed IDs and ends only after a matching saved readback',()=>{
 const file='D:/synthetic/안내.hwpx',prompt='장소만 “초록교실”을 “별빛교실”로 바꿔 줘.',records=[];
 const add=(name,args,value)=>{const id=String(records.length);records.push({type:'function_call',name,arguments:JSON.stringify(args),call_id:id},{type:'function_call_output',call_id:id,output:JSON.stringify(value)});};
 add('read_document',{path:file},{hash:'before',hasMore:false,paragraphs:[{id:'p1',text:'가상 안내'},{id:'p2',text:'장소: 초록교실'}]});
 let step=documentStep(prompt,records,tools,'D:/synthetic',true,file);assert(step.required);
 const op=step.tools[0].parameters.properties.operations.items.properties;assert.deepEqual(op.target.enum,['p2']);assert.deepEqual(op.text.enum,['장소: 별빛교실']);
 add('edit_document',{path:file,expectedHash:'before',operations:[{op:'set_text',target:'p2',text:'장소: 별빛교실'}]},{saved:true,modeledContentVerified:true,hash:'after'});
 assert.equal(documentStep(prompt,records,tools,'D:/synthetic',true,file).tools[0].name,'read_document');
 add('read_document',{path:file},{hash:'after',hasMore:false,paragraphs:[{id:'n1',text:'가상 안내'},{id:'n2',text:'장소: 별빛교실'}]});
 assert.match(documentStep(prompt,records,tools,'D:/synthetic',true,file).receipt,/초록교실 → 별빛교실/);
 for(const extra of ['그리고 표를 추가해 줘.','그리고 제목을 굵게 해 줘.','PDF 사본도 만들어 줘.'])assert.equal(documentStep(prompt+extra,records,tools,'D:/synthetic',true,file).receipt,undefined,extra);
 const after=JSON.parse(records.at(-1).output);after.hash='unexpected';records.at(-1).output=JSON.stringify(after);assert.equal(documentStep(prompt,records,tools,'D:/synthetic',true,file).receipt,undefined);
 after.hash='after';after.paragraphs[0].text='요청하지 않은 변경';records.at(-1).output=JSON.stringify(after);assert.equal(documentStep(prompt,records,tools,'D:/synthetic',true,file).receipt,undefined);
});

test('ambiguous text replacement targets are not automatically chosen',()=>{
 const file='D:/synthetic/안내.hwpx',input=[{type:'function_call',name:'read_document',arguments:JSON.stringify({path:file}),call_id:'r'},{type:'function_call_output',call_id:'r',output:JSON.stringify({hash:'before',hasMore:false,paragraphs:[{id:'p1',text:'초록교실 초록교실'},{id:'p2',text:'초록교실'}]})}];
 const step=documentStep('장소만 "초록교실"을 "별빛교실"로 바꿔 줘.',input,tools,'D:/synthetic',true,file);
 assert(!step.required,'an old value appearing multiple times is not a unique replacement target');
});

test('quoted replacements account for all pages before selecting a target or confirming saved text',()=>{
 const file='D:/synthetic/안내.hwpx',prompt='장소만 “초록교실”을 “별빛교실”로 바꿔 줘.',records=[];
 const add=(name,args,value)=>{const id=String(records.length);records.push({type:'function_call',name,arguments:JSON.stringify(args),call_id:id},{type:'function_call_output',call_id:id,output:JSON.stringify(value)});};
 const read=(hash,offset,text,hasMore)=>add('read_document',{path:file,offset},{hash,offset,hasMore,nextOffset:offset+1,counts:{paragraphs:2},paragraphs:[{id:hash+'-'+offset,text}]});
 read('before',1,'장소: 초록교실',false);assert(!documentStep(prompt,records,tools,'D:/synthetic',true,file).required,'a skipped initial page must not imply a unique target');
 records.length=0;read('before',0,'가상 안내',true);read('before',1,'장소: 초록교실',false);
 assert(documentStep(prompt,records,tools,'D:/synthetic',true,file).required);
 add('edit_document',{path:file,expectedHash:'before',operations:[{op:'set_text',target:'before-1',text:'장소: 별빛교실'}]},{saved:true,modeledContentVerified:true,hash:'after'});
 read('after',0,'가상 안내',true);assert(documentStep(prompt,records,tools,'D:/synthetic',true,file).required);
 read('after',1,'장소: 별빛교실',false);assert.match(documentStep(prompt,records,tools,'D:/synthetic',true,file).receipt,/초록교실 → 별빛교실/);
});
