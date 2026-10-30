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
