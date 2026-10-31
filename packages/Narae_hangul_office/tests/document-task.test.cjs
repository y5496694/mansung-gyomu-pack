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
