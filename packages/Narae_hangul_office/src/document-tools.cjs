'use strict';
// GUI and headless agents use the same document CLI and verification contract.
const fs=require('node:fs'),path=require('node:path');
const supportedFile=/\.(?:hwpx?|png|jpe?g|gif|webp|pdf|docx|xlsx?|pptx|csv|txt)$/i;
function creation(args){
 const copy={...args};if(copy.blocks){if(copy.notice&&!JSON.stringify(copy.blocks).includes(copy.notice))copy.blocks=[...copy.blocks,{type:'paragraph',text:copy.notice}];return copy;}
 const lines=String(copy.text||'').split(/\r?\n/),first=lines.findIndex(s=>s.trim());
 if(!copy.title&&first>=0&&lines[first].trim().length<=100)copy.title=lines[first].trim();
 if(copy.title&&first>=0&&lines[first].trim()===copy.title.trim())lines.splice(0,first+1);
 if(copy.notice&&!lines.join('\n').includes(copy.notice))lines.push('',copy.notice);
 copy.content=lines.join('\n');return copy;
}
async function executeDocumentTool(name,args,{workspace,home,python,signal,execute=require('./cli.cjs').execute}={}){
 if(signal?.aborted)throw new Error('작업을 중지했습니다.');
 if(name==='list_files')return fs.readdirSync(workspace).filter(f=>supportedFile.test(f)&&fs.statSync(path.join(workspace,f)).isFile()).map(f=>path.join(workspace,f));
 if(name==='read_image')return {kind:'image',path:args.path,image:require('./agent-media.cjs').readImage(args.path)};
 const actions={read_document:'inspect',read_live_document:'live-read',edit_live_document:'live-edit',edit_document:'edit',create_document:'create',export_pdf:'export'};
 if(!actions[name])throw new Error('지원하지 않는 문서 도구입니다.');
 const req={...(name==='create_document'?creation(args):args),action:actions[name],...(name==='read_document'?{full:false,limit:args.limit??60}:{} )};
 return execute(req,{base:workspace,home,python,signal});
}
module.exports={executeDocumentTool,creation,supportedFile};
