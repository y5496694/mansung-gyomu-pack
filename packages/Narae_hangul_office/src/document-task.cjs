'use strict';
const path=require('node:path');
function documentStep(prompt,input,all,workspace,allowReceipt=false){
 if(!/PDF\s*(?:사본|버전)|PDF\s*(?:로|으로)\s*(?:출력|내보내|저장|변환)|PDF(?:도|까지)?\s*(?:만들|생성)|\.pdf["”]?/i.test(prompt)||/PDF.{0,12}(?:하지\s*마|만들지\s*마|필요\s*없)/i.test(prompt))return null;
 const records=[];for(const item of input){if(item.type!=='function_call_output')continue;const call=input.find(c=>c.type==='function_call'&&c.call_id===item.call_id);if(!call)continue;try{records.push({name:call.name,args:JSON.parse(call.arguments),value:JSON.parse(item.output)});}catch{}}
 if(records.some(r=>r.value?.finalAction||/^wxs-final/.test(r.value?.kind||'')))return null;
 const created=records.filter(r=>r.name==='create_document'&&!r.value?.error&&r.value?.modeledContentVerified&&r.value?.path);
 if(created.length!==1)return null;
 const file=created[0].value.path,same=p=>typeof p==='string'&&path.resolve(p).toLowerCase()===path.resolve(file).toLowerCase();
 const required=(name,values,instructions)=>{const tool=structuredClone(all.find(t=>t.name===name));if(!tool)return null;tool.parameters={type:'object',properties:Object.fromEntries(Object.entries(values).map(([key,value])=>[key,{type:'string',enum:[value]}])),required:Object.keys(values),additionalProperties:false};return {tools:[tool],required:true,context:{source:'실제 생성 파일과 아직 수행하지 않은 출력 단계',path:file},instructions};};
 if(!records.some(r=>r.name==='read_document'&&same(r.args.path)&&!r.value?.error&&(r.value?.hash||r.value?.input_sha256)))return required('read_document',{path:file},'생성한 실제 한글 파일을 다시 읽어 내용을 확인한다. PDF 출력은 아직 실행되지 않았다.');
 const exports=records.filter(r=>r.name==='export_pdf'&&same(r.args.path));
 const exported=exports.find(r=>!r.value?.error&&r.value?.pages>0&&r.value?.bytes>0);
 if(exported)return allowReceipt?{tools:[],receipt:'한글 문서와 PDF 사본을 실제로 저장했습니다.\n'+file+'\n'+exported.args.target+'\n저장된 한글 본문을 다시 읽고 PDF 출력 결과를 확인했습니다.'}:null;
 if(exports.length)return {tools:[],receipt:'한글 파일은 생성했지만 PDF 출력을 확인하지 못했습니다.\n'+file+'\nPDF 완료로 처리하지 않았습니다. '+(exports.at(-1).value?.error||'출력 검증 결과가 없습니다.')};
 const names=[...prompt.matchAll(/["“]([^"“”\r\n]+\.pdf)["”]/gi)];if(names.length>1)return null;
 const target=names.length?(path.isAbsolute(names[0][1])?names[0][1]:path.resolve(workspace||path.dirname(file),names[0][1])):file.replace(/\.hwpx?$/i,'.pdf');
 return required('export_pdf',{path:file,target},'사용자가 요청한 PDF 사본은 아직 없다. 실제 export_pdf를 실행한다. 텍스트 답변이나 한글 파일 생성 결과를 PDF 완료 근거로 쓰지 않는다.');
}
module.exports={documentStep};
