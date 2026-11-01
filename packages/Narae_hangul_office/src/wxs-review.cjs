'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const operations=['capture','export-document','export-attachments'];
function extend(tool){const copy=structuredClone(tool);copy.description+=' capture는 실제 본문 PNG, export-document는 전체 HWP 사본, export-attachments는 실제 서버 첨부를 작업 폴더에 저장한다. 현재 HWND와 expected_title이 필요하며 저장·상신 완료를 뜻하지 않는다.';copy.parameters.properties.operation.enum.push(...operations);copy.parameters.properties.expected_title={type:'string'};copy.parameters.properties.editable_draft={type:'boolean'};return copy;}
async function execute(args,{instance,workspace,signal}){
 if(!operations.includes(args.operation))throw Error('지원하는 기안 검수 작업이 아닙니다.');
 if(!args.hwnd||typeof args.expected_title!=='string'||!args.expected_title.trim())throw Error('실제로 관찰한 HWND와 정확한 기안 제목이 필요합니다.');
 const directory=path.join(workspace,'나래-기안검수',Date.now()+'-'+crypto.randomUUID());fs.mkdirSync(directory,{recursive:true});
 const argv=[args.operation,'--hwnd',args.hwnd,'--expected-title',args.expected_title];
 if(args.operation==='export-document')argv.push('--path',path.join(directory,'기안사본.hwp'));
 else argv.push('--directory',path.join(directory,args.operation==='capture'?'본문캡처':'서버첨부'));
 if(args.operation==='export-attachments'&&args.editable_draft===true)argv.push('--editable-draft');
 const result=await instance.wxs(argv,signal);
 return {...result,review_operation:args.operation,review_directory:directory};
}
module.exports={operations,extend,execute};
