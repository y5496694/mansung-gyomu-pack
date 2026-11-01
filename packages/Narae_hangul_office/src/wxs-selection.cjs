'use strict';
const tool={type:'function',name:'gyomu_wxs_select_task',description:'직전 실제 과제카드 선택창의 정확한 이름을 원본 CLI로 확인한다. 현재 기안·선택창·후보를 재검증하며 상신하지 않는다.',parameters:{type:'object',properties:{hwnd:{type:'string'},expected_title:{type:'string'},dialog_hwnd:{type:'string'},task_card:{type:'string'}},required:['hwnd','expected_title','dialog_hwnd','task_card'],additionalProperties:false}};
async function execute(args,{instance,policy,signal}){
 const key=JSON.stringify([String(args.hwnd),args.expected_title,'task']);if(instance.wxsOptionDialogs.get(key)!==String(args.dialog_hwnd))throw Error('현재 기안에서 실제 조회한 과제카드 창이 필요합니다.');
 const argv=['draft-options','--hwnd',args.hwnd,'--expected-title',args.expected_title,'--section','task','--dialog-hwnd',args.dialog_hwnd];
 const preview=await instance.wxs(argv,signal);await policy.approve('현재 기안 과제카드 확인',{...args,preview},signal);if(signal?.aborted)throw Error('중단했습니다.');
 const result=await instance.wxs([...argv,'--task-card',args.task_card,'--apply'],signal);instance.wxsOptionDialogs.delete(key);return result;
}
module.exports={tool,execute};
