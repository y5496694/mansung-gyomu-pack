'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {taskFor,taskTools,taskStep}=require('../src/agent-task.cjs');
const all=['gyomu_browser','gyomu_portal_open','gyomu_skill_read','gyomu_wxs','gyomu_wxs_final_prepare','gyomu_wxs_final_dialog','gyomu_wxs_final_confirm','document_create'].map(name=>({name,parameters:{properties:{action:{type:'string',enum:['snapshot','read','click','fill','select','check','press']}}}}));
test('explicit real submit/approve route is separate from draft-only and development requests',()=>{
 for(const [prompt,operation]of [['나이스 조퇴 신청 상신해줘','submit'],['공문 QA-001 결재해줘','approve'],['나이스 조퇴 상신까지 해줘','submit'],['이 공문 결재 올려줘','submit'],['나이스 신청 상신 좀 해줘','submit'],['공문 QA-001 결재까지 진행해줘','approve']]){const task=taskFor(prompt);assert.equal(task.area,'school-final',prompt);assert.equal(task.operation,operation,prompt);assert.equal(task.draft,false);assert(taskTools(task,all).some(t=>t.name==='gyomu_wxs_final_prepare'));assert(taskTools(task,all).some(t=>t.name==='gyomu_wxs_final_dialog'));}
 for(const prompt of ['나이스 조퇴 초안만 준비해줘','나이스 상신하지 마','나이스 상신하지 말고 초안만 준비해줘','나이스 결재 올리지 말고 결재선만 확인해줘','상신 가능하게 깃허브 코드 수정해줘','나이스 상신 방법 설명해줘','나이스 상신 가능한지 확인해줘'])assert.notEqual(taskFor(prompt)?.area,'school-final',prompt);
 assert.equal(taskFor('이 신청 상신해줘',[{role:'user',content:'나이스 조퇴 초안 확인'}]).area,'school-final');
});
test('first final step observes existing page instead of opening a new session',()=>{const step=taskStep(taskFor('나이스 조퇴 상신해줘'),[],all);assert.equal(step.required,true);assert.equal(step.tools.length,1);assert.deepEqual(step.tools[0].parameters.properties.action.enum,['snapshot']);});
test('after an attempted final action, route requires server verification rather than a false draft receipt',()=>{
 const task=taskFor('나이스 조퇴 상신해줘');
 const input=[{type:'function_call',call_id:'1',name:'gyomu_browser',arguments:'{"action":"click"}'},{type:'function_call_output',call_id:'1',output:JSON.stringify({finalAction:{operation:'submit',attempted:true,completed:false}})}];
 const step=taskStep(task,input,all);assert(!step.receipt);assert.match(step.instructions,/재조회/);assert(!step.tools.some(t=>t.name==='gyomu_wxs_final_prepare'));assert(!step.tools.find(t=>t.name==='gyomu_browser').parameters.properties.action.enum.includes('fill'));
});
test('NEIS and Edufine procedures keep explicit final-action support instead of stale blanket prohibitions',()=>{
 for(const file of ['resources/agent-skills/neis.md','resources/agent-skills/edufine.md']){const text=fs.readFileSync(path.resolve(__dirname,'..',file),'utf8');assert.match(text,/명시/);assert.match(text,/재조회/);assert.doesNotMatch(text,/최종 '상신'은 누르지 않는다|최종 상신·결재 승인·공문 발송·공람확인·공람의견 등록·삭제는 실행하지 않는다/);}
});
