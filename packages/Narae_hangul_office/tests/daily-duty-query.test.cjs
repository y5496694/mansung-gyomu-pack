const test=require('node:test'),assert=require('node:assert/strict'),{neisTask,neisStep}=require('../src/neis-task.cjs');
const tool={name:'gyomu_browser',parameters:{type:'object',properties:{action:{enum:['snapshot','click','uncheck']}},required:['action']}},pair=(args,value,id)=>[{type:'function_call',name:'gyomu_browser',arguments:JSON.stringify(args),call_id:id},{type:'function_call_output',call_id:id,output:JSON.stringify(value)}];
const screen=(rows=[['가상학교','교사','가상민','조퇴']])=>({title:'4세대 나이스 시스템',text:'일일근무상황조회\nTotal '+rows.length,elements:[{ref:'school',label:'나의업무, 가상학교',role:'combobox',display:'가상학교'},{ref:'day',label:'일자',tag:'input',value:'2039-05-04'},{ref:'department',label:'부서, 가상학교',role:'combobox',display:'가상학교'},{ref:'query',label:'조회',role:'button'}],tableData:[{headers:['부서','직급/직위/직종','성명','근무상황'],rows,hasMore:false}],hasMore:false});
const task=()=>neisTask('나이스 대상 "가상민"의 2039-05-04 복무 조회');
test('school-wide daily list is queried with observed scope and date before filtering the requested person',()=>{
 const t=task(),s=screen(),input=pair({action:'snapshot'},s,'before');let step=neisStep(t,input,[tool]);assert.deepEqual(step.tools[0].parameters.properties.ref.enum,['query']);
 input.push(...pair({action:'click',ref:'query'},s,'queried'));step=neisStep(t,input,[tool]);assert.match(step.receipt,/가상학교 \/ 2039-05-04/);assert.match(step.receipt,/총 1건 대조/);assert.match(step.receipt,/가상민.*조퇴/);
});
test('an absent name is reported only as absent from the scoped public list, without claiming no duty exists',()=>{
 const t=task(),s=screen([['가상학교','교사','다른사람','연가']]),input=[...pair({action:'snapshot'},s,'before'),...pair({action:'click',ref:'query'},s,'queried')],step=neisStep(t,input,[tool]);assert.match(step.receipt,/가상민의 복무 항목은 확인되지/);assert.match(step.receipt,/복무가 없다고 단정하지/);
});
test('different department, truncated rows and mismatched total cannot produce a completed daily lookup',()=>{
 for(const change of [s=>s.elements[2].display='다른학교',s=>s.tableData[0].hasMore=true,s=>s.text='일일근무상황조회\nTotal 2']){
  const t=task(),s=screen();change(s);const step=neisStep(t,[...pair({action:'snapshot'},s,'before'),...pair({action:'click',ref:'query'},s,'queried')],[tool]);assert(!step.receipt.includes('총 1건 대조'));assert.deepEqual(step.tools,[]);
 }
});
test('unread controls are inspected after querying, while later observations preserve the verified query conditions',()=>{
 const t=task(),s={...screen(),hasMore:true,nextOffset:50},input=[...pair({action:'snapshot'},s,'before'),...pair({action:'click',ref:'query'},s,'queried')];let step=neisStep(t,input,[tool]);assert.deepEqual(step.tools[0].parameters.properties.offset.enum,[50]);
 input.push(...pair({action:'snapshot',offset:50,limit:100},{...screen(),elements:[]},'remaining'));step=neisStep(t,input,[tool]);assert.match(step.receipt,/가상민/);assert.match(step.receipt,/총 1건 대조/);
});
test('a fixed next-step request does not duplicate the whole school table into the model context',()=>{
 const t=task(),s=screen();s.tables=['UNRELATED_PRIVATE_CANARY'.repeat(5000)];s.text+='\nUNRELATED_PRIVATE_CANARY'.repeat(5000);const step=neisStep(t,pair({action:'snapshot'},s,'before'),[tool]);
 assert.deepEqual(step.context.elements.map(e=>e.ref),['query']);assert(!JSON.stringify(step.context).includes('UNRELATED_PRIVATE_CANARY'));assert(JSON.stringify(step.context).length<1000);
});
