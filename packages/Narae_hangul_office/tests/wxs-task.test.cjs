'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {wxsStep,validateWxsBody}=require('../src/wxs-task.cjs');let all;
test.before(async()=>{all=(await import('../vendor/narae-gyomu/src/catalog.mjs')).tools.map(t=>({...t,name:'gyomu_'+t.name.replaceAll('.','_')}));});
const prompt='현재 열린 WXS 새 문서에 한글 파일 계획서를 첨부하고 상신해줘',task={area:'school-final'},input=[];
function record(name,args,value){const id=String(input.length);input.push({type:'function_call',name,call_id:id,arguments:JSON.stringify(args)},{type:'function_call_output',call_id:id,output:JSON.stringify(value)});}
test('native draft planning observes a handle before editing and rereads the actual draft after applying',()=>{
 let s=wxsStep(prompt,input,{tools:all},task);assert.equal(s.tools[0].parameters.properties.operation.enum[0],'windows');
 record('gyomu_wxs',{operation:'windows'},{windows:[{hwnd:'731',title:'새 문서'}]});s=wxsStep(prompt,input,{tools:all},task);assert.equal(s.tools[0].parameters.properties.hwnd.enum[0],'731');assert.equal(s.tools[0].parameters.properties.operation.enum[0],'draft-status');
 record('gyomu_wxs',{operation:'draft-status',hwnd:'731'},{title:'새 문서',body:'',attachments:[]});s=wxsStep(prompt,input,{tools:all},task);const prepare=s.tools.find(t=>t.name==='gyomu_wxs_prepare');assert.deepEqual(Object.keys(prepare.parameters.properties.config.properties),['expected_title','title','body','attachments']);assert.deepEqual(prepare.parameters.properties.config.properties.expected_title.enum,['새 문서']);
 record('gyomu_wxs_prepare',{hwnd:'731',config:{title:'가상 계획'}},{ok:true,kind:'wxs-draft'});s=wxsStep(prompt,input,{tools:all},task);assert(s.required);assert.equal(s.tools[0].parameters.properties.operation.enum[0],'draft-status');
});
test('WXS continuation binds its own receipt and the real present/message shape, then requires server observation',()=>{
 record('gyomu_wxs',{operation:'draft-status',hwnd:'731'},{title:'가상 계획'});record('gyomu_wxs_final_prepare',{hwnd:'731'},{ok:true,kind:'wxs-final',receiptId:'owned-receipt'});
 let s=wxsStep(prompt,input,{tools:all},task);assert.equal(s.tools[0].name,'gyomu_wxs_final_dialog');assert.deepEqual(s.tools[0].parameters.properties.receipt_id.enum,['owned-receipt']);
 record('gyomu_wxs_final_dialog',{receipt_id:'other-receipt'},{present:true,message:'상신하시겠습니까?'});assert.equal(wxsStep(prompt,input,{tools:all},task).tools[0].name,'gyomu_wxs_final_dialog');
 record('gyomu_wxs_final_dialog',{receipt_id:'owned-receipt'},{present:true,message:'상신하시겠습니까?',completed:false});s=wxsStep(prompt,input,{tools:all},task);assert.equal(s.tools[0].name,'gyomu_wxs_final_confirm');assert.deepEqual(s.tools[0].parameters.properties.expected_message.enum,['상신하시겠습니까?']);
 record('gyomu_wxs_final_confirm',{receipt_id:'owned-receipt'},{ok:true});s=wxsStep(prompt,input,{tools:all},task);assert.equal(s.tools[0].name,'gyomu_browser');assert.equal(s.tools[0].parameters.properties.action.enum[0],'snapshot');
});
test('internal approval previews and unexpected protected messages cannot be accepted as a simple confirmation',()=>{
 const prefix=input.slice(0,input.findIndex(i=>i.name==='gyomu_wxs_final_confirm'));
 for(const value of [{present:true,message:'결재 문서를 삭제하시겠습니까?'},{present:true,message:'수신자를 지정하지 않으면 내부결재로 처리됩니다. 계속하시겠습니까?',document_preview:{fingerprint:'review-required'}}]){
  const id='blocked',copy=[...prefix,{type:'function_call',name:'gyomu_wxs_final_dialog',call_id:id,arguments:'{"receipt_id":"owned-receipt"}'},{type:'function_call_output',call_id:id,output:JSON.stringify(value)}];const s=wxsStep(prompt,copy,{tools:all},task);assert(!s.required);assert(!s.tools.some(t=>t.name==='gyomu_wxs_final_confirm'));
 }
});
test('an attachment must be read and unrequested dates cannot enter its covering draft',()=>{
 const file='D:/synthetic/plan.hwp',args={config:{attachments:[file],body:'현장체험학습은 2025년 4월 1일 실시합니다.'}};
 assert.throws(()=>validateWxsBody('첨부 계획으로 기안 작성',[],args),/read_document/);
 const records=[{type:'function_call',name:'read_document',call_id:'read',arguments:JSON.stringify({path:file})},{type:'function_call_output',call_id:'read',output:JSON.stringify({hash:'verified',paragraphs:[{text:'훈련 일정 2026년 11월 13일 09:30~12:00'}]})}];
 assert.throws(()=>validateWxsBody('첨부 계획으로 기안 작성',records,args),/2025-04-01/);
 assert.doesNotThrow(()=>validateWxsBody('첨부 계획으로 기안 작성',records,{config:{attachments:[file],body:'2026-11-13 현장체험학습 계획을 붙임과 같이 수립합니다.'}}));
});
