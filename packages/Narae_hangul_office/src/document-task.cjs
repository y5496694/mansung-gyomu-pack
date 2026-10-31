'use strict';
const path=require('node:path');
function timeReplacement(prompt){
 const times=[...new Set([...prompt.matchAll(/\b((?:[01]?\d|2[0-3]):[0-5]\d)\b/g)].map(m=>m[1]))];
 if(times.length!==2||!new RegExp(times[0]+'[^\\d]{0,16}'+times[1]+'\\s*(?:으로|로)').test(prompt))return null;
 const end=prompt.indexOf(times[1]),old=prompt.lastIndexOf(times[0],end),marker=[...prompt.slice(0,old).matchAll(/(\d+교시)\s*문단/g)].at(-1)?.[1];
 return {from:times[0],to:times[1],marker};
}
function verifiedTimeChange(prompt,records,edit,read,same){
 if(!/만(?:\s|바꾸|고쳐|수정|변경)/.test(prompt)||/PDF|첨부|전송|보내|기안|상신|결재|나이스|복무|메신저|쪽지|이어서|그다음|비교|요약|여러|각각|다른\s*(?:문서|파일)|검토(?:해|하|도|부탁)/i.test(prompt))return null;
 const change=timeReplacement(prompt);if(!change||!edit?.value.saved||edit.value.modeledContentVerified===false)return null;const times=[change.from,change.to];
 const ops=edit.args.operations;if(ops?.length!==1||!['replace_text','set_text'].includes(ops[0].op))return null;const op=ops[0];
 if(op.op==='replace_text'&&(op.expected!==1||typeof op.find!=='string'||!op.find.includes(times[0])||op.replace!==op.find.replace(times[0],times[1])))return null;
 const before=records.slice(0,records.indexOf(edit)).findLast(r=>r.name==='read_document'&&same(r.args.path)&&!r.value.error);
 if(!before||before.value.hasMore||read.value.hasMore||before.value.textDetailsLoaded===false||read.value.textDetailsLoaded===false)return null;
 if((before.value.hash||before.value.input_sha256)!==edit.args.expectedHash||(read.value.hash||read.value.input_sha256)!==edit.value.hash)return null;
 const a=before.value.paragraphs||before.value.blocks,b=read.value.paragraphs||read.value.blocks;if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length||a.some(p=>typeof p.text!=='string')||b.some(p=>typeof p.text!=='string'))return null;
 const indexes=a.flatMap((p,i)=>p.id===op.target?[i]:[]);if(indexes.length!==1)return null;const index=indexes[0],expected=a.map(p=>p.text);
 if(op.op==='set_text'){if(expected[index].split(times[0]).length-1!==1||op.text!==expected[index].replace(times[0],times[1]))return null;expected[index]=op.text;}
 else{if(expected[index].split(op.find).length-1!==1)return null;expected[index]=expected[index].replace(op.find,op.replace);}
 return expected.every((s,i)=>s===b[i].text)?{from:times[0],to:times[1]}:null;
}
function documentStep(prompt,input,all,workspace,allowReceipt=false,selectedFile){
 const records=[];for(const item of input){if(item.type!=='function_call_output')continue;const call=input.find(c=>c.type==='function_call'&&c.call_id===item.call_id);if(!call)continue;try{records.push({name:call.name,args:JSON.parse(call.arguments),value:JSON.parse(item.output)});}catch{}}
 if(records.some(r=>r.value?.finalAction||/^wxs-final/.test(r.value?.kind||'')))return null;
 const latest=records.at(-1),continuation=latest?.value;
 if(latest?.name==='read_document'&&continuation?.error&&/\.(?:pdf|docx|xlsx?|pptx|csv|txt)$/i.test(latest.args.path||'')){
  const tool=structuredClone(all.find(t=>t.name==='gyomu_wxs_attachment'));if(tool){const values={path:latest.args.path,chars:1500};tool.parameters={type:'object',properties:{path:{type:'string',enum:[values.path]},chars:{type:'integer',enum:[1500]}},required:['path','chars'],additionalProperties:false};return {tools:[tool],required:true,instructions:'이 파일은 HWP/HWPX가 아니다. 같은 작업 폴더 파일을 형식별 저장 첨부 읽기 도구로 확인한다. 읽기 오류를 내용 없음으로 처리하지 않는다.'};}
 }
 if(['read_document','gyomu_wxs_attachment'].includes(latest?.name)){
  // A later edit legitimately starts a new read revision.
  const changed=records.findLastIndex(r=>['edit_document','edit_live_document'].includes(r.name)&&r.args.path===latest.args.path);
  const hashes=new Set(records.slice(changed+1).filter(r=>r.name===latest.name&&r.args.path===latest.args.path&&!r.value.error).map(r=>r.value.hash||r.value.input_sha256||r.value.sha256).filter(Boolean));
  if(hashes.size>1)return {tools:[],receipt:'여러 범위를 읽는 중 파일 해시가 달라져 서로 다른 원문을 합쳐 요약하지 않았습니다. 최신 파일을 다시 읽어야 합니다. 요약 미완료입니다.'};
 }
 if(['read_document','gyomu_wxs_attachment'].includes(latest?.name)&&continuation?.hasMore===true&&Number.isSafeInteger(continuation.nextOffset)&&continuation.nextOffset>(latest.args.offset||0)){
  const tool=structuredClone(all.find(t=>t.name===latest.name));
  if(tool){const values={path:latest.args.path,offset:continuation.nextOffset,...(latest.name==='read_document'?{limit:60}:{chars:1500})};tool.parameters={type:'object',properties:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,{type:typeof v==='number'?'integer':'string',enum:[v]}])),required:Object.keys(values),additionalProperties:false};return {tools:[tool],required:true,context:{source:'실제 읽기 결과에 남은 본문이 있음',path:latest.args.path,nextOffset:continuation.nextOffset},instructions:'같은 파일의 아직 읽지 않은 다음 범위를 이어 읽는다. 부분 읽기를 전체 확인으로 보고하지 않는다.'};}
 }
 if(/요약/.test(prompt)&&!/수정|편집|바꾸|변경|만들|생성|첨부(?:해|하)|기안|상신|에듀파인|공문|메신저|쪽지|소통|나이스|복무/.test(prompt)&&['read_document','gyomu_wxs_attachment'].includes(latest?.name)&&!continuation?.hasMore&&continuation?.textDetailsLoaded!==false){
  const reads=records.filter(r=>r.name===latest.name&&r.args.path===latest.args.path),good=reads.filter(r=>!r.value.error&&r.value.source_unchanged!==false&&!r.value.needs_visual_review),paragraphs=[...new Map(good.flatMap(r=>r.value.paragraphs||[]).map(p=>[p.id,p])).values()],text=latest.name==='read_document'?paragraphs.map(p=>p.text).join('\n'):good.sort((a,b)=>(a.args.offset||0)-(b.args.offset||0)).map(r=>r.value.text||'').join('');
  let next=0;const contiguous=good.every(r=>{const offset=r.value.offset??r.args.offset??0,ok=offset===next;next=offset+(r.value.text||'').length;return ok;});
  const complete=latest.name==='read_document'?good.length===reads.length&&paragraphs.length===continuation?.counts?.paragraphs:good.length===reads.length&&contiguous;
  return {tools:[],evidenceReport:true,context:{documents:[{title:latest.args.path,bodyRead:Boolean(text),body:text,attachments:[]}],unconfirmed:good.length<reads.length?[{title:latest.args.path,error:continuation?.error||'원본 변경·시각 확인·읽기 실패'}]:[]},footer:'파일 읽기 범위: '+(complete?'확인한 텍스트 범위 끝까지 조회':'일부 범위만 확인')+'. 그림·도장 등 시각 요소는 별도 확인 대상입니다.',instructions:'실제 조회한 파일 텍스트만 원문 근거로 요약한다.'};
 }
 const tracked=records.findLast(r=>r.name==='read_document'&&!r.value?.error&&r.value?.textDetailsLoaded===false);
 if(tracked&&typeof tracked.args.path==='string'&&!records.slice(records.indexOf(tracked)+1).some(r=>r.name==='read_live_document'&&r.args.path===tracked.args.path)){
  const tool=structuredClone(all.find(t=>t.name==='read_live_document'));
  if(tool){tool.parameters={type:'object',properties:{path:{type:'string',enum:[tracked.args.path]}},required:['path'],additionalProperties:false};return {tools:[tool],required:true,context:{source:'파일 엔진에서 변경 추적 때문에 현재 본문을 읽지 못한 실제 문서',path:tracked.args.path},instructions:'textDetailsLoaded:false는 빈 문서가 아니다. read_live_document로 현재 한글의 실제 본문과 liveRevision을 읽는다. 읽겠다는 답변으로 도구 실행을 대신하지 않는다.'};}
 }
 if(typeof selectedFile==='string'&&/수정|고쳐|바꾸|바꿔|변경|굵게|글꼴|서식/.test(prompt)&&!/열려\s*있|열린\s*한글|실시간|현재\s*한글/.test(prompt)){
  const same=p=>typeof p==='string'&&path.resolve(p).toLowerCase()===path.resolve(selectedFile).toLowerCase();
  const lastRead=records.findLast(r=>r.name==='read_document'&&same(r.args.path)&&!r.value?.error),edit=records.findLast(r=>['edit_document','edit_live_document'].includes(r.name)&&same(r.args.path));
  const read=lastRead&&{...lastRead,value:{...lastRead.value,paragraphs:[...new Map(records.filter(r=>r.name==='read_document'&&same(r.args.path)&&!r.value.error&&(r.value.hash||r.value.input_sha256)===(lastRead.value.hash||lastRead.value.input_sha256)).flatMap(r=>r.value.paragraphs||r.value.blocks||[]).map(p=>[p.id,p])).values()]}};
  if(!read||edit&&records.indexOf(edit)>records.indexOf(lastRead)){
   const tool=structuredClone(all.find(t=>t.name==='read_document'));if(tool){tool.parameters={type:'object',properties:{path:{type:'string',enum:[selectedFile]}},required:['path'],additionalProperties:false};return {tools:[tool],required:true,context:{source:'사용자가 선택한 실제 문서',path:selectedFile},instructions:'편집 전 또는 편집 시도 후에는 선택한 파일을 실제로 다시 읽어 최신 해시·문단 ID·저장된 내용을 확인한다.'};}
  }
  const verified=verifiedTimeChange(prompt,records,edit,read,same);if(verified)return {tools:[],receipt:'선택 문서의 시간 변경을 저장하고 다시 읽어 확인했습니다.\n'+selectedFile+'\n'+verified.from+' → '+verified.to+'\n그 밖의 문단 텍스트가 유지된 것도 대조했습니다.'};
  if(read?.value?.textDetailsLoaded!==false&&(read?.value?.hash||read?.value?.input_sha256)){
   const tools=structuredClone(all.filter(t=>['edit_document',...(read.value.hasMore?['read_document']:[]),...(/PDF/i.test(prompt)?['export_pdf']:[])].includes(t.name))),tool=tools.find(t=>t.name==='edit_document');
   if(tool){tool.parameters.properties.path={type:'string',enum:[selectedFile]};tool.parameters.properties.expectedHash={type:'string',enum:[read.value.hash||read.value.input_sha256]};tool.parameters.required=['path','expectedHash','operations'];if(!/사본|별도.{0,8}파일|다른.{0,8}파일|새.{0,8}이름/.test(prompt))delete tool.parameters.properties.target;else tool.parameters.required.push('target');const ids=[...new Set([...(read.value.paragraphs||[]),...(read.value.blocks||[])].map(p=>p.id).filter(Boolean))];if(ids.length)for(const op of tool.parameters.properties.operations.items.anyOf)if(op.properties?.target)op.properties.target={type:'string',enum:ids};}
   const change=timeReplacement(prompt);
   if(tool&&change&&/만/.test(prompt)&&!/서식|글꼴|굵게|PDF|첨부|전송|기안|상신|요약/.test(prompt)){
    const candidates=(read.value.paragraphs||[]).filter(p=>p.text?.split(change.from).length===2&&(!change.marker||new RegExp('(?:^|[^0-9])'+change.marker).test(p.text)));
    if(candidates.length===1){tool.parameters.properties.operations={type:'array',minItems:1,maxItems:1,items:{type:'object',properties:{op:{type:'string',enum:['set_text']},target:{type:'string',enum:[candidates[0].id]},text:{type:'string',enum:[candidates[0].text.replace(change.from,change.to)]}},required:['op','target','text'],additionalProperties:false}};return {tools:[tool],required:true,instructions:'사용자 요청의 시각 변경 대상 문단을 실제 원문에서 유일하게 확인했다. 지정된 해시·문단·변경 원문으로 편집을 실행한 뒤 다시 읽어 검증한다.'};}
   }
   return {tools,instructions:'선택 파일은 방금 일반 파일 엔진으로 읽었다. 같은 파일의 같은 내용을 다시 읽지 않는다. 실제 해시와 문단 ID로 edit_document를 사용한다. 저장 후 다시 읽은 내용이 이미 요청대로 바뀌었으면 도구를 호출하지 말고 최종 확인 결과를 답한다. liveRevision을 파일 해시로 지어내지 않는다.'};
  }
 }
 if(!/PDF\s*(?:사본|버전)|PDF\s*(?:로|으로)\s*(?:출력|내보내|저장|변환)|PDF(?:도|까지)?\s*(?:만들|생성)|\.pdf["”]?/i.test(prompt)||/PDF.{0,12}(?:하지\s*마|만들지\s*마|필요\s*없)/i.test(prompt))return null;
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
