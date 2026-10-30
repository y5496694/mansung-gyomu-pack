'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {compactDocument,documentOutput}=require('../src/planner-document.cjs');
test('repeated paragraph styles compact losslessly without changing text, IDs, hashes or differing styles',()=>{
 const original={path:'synthetic.hwp',hash:'original-hash',paragraphs:Array.from({length:30},(_,i)=>({id:'p'+i,text:'본문 '+i,text_style:{font:'맑은 고딕',size:i===0?20:11,bold:i===0,italic:false,underline:false,color:'#000000'},paragraph_style:{align:'LEFT',line:160,before:0,after:0,page_break:false}}))};const before=structuredClone(original),compact=compactDocument(original);
 assert.equal(compact.plannerStyles.length,2);assert(JSON.stringify(compact).length<JSON.stringify(original).length*.6);
 const restored={...compact,paragraphs:compact.paragraphs.map(p=>{const {styleRef,...rest}=p;return {...rest,...compact.plannerStyles[styleRef]};})};delete restored.plannerStyles;delete restored.styleEncoding;
 assert.deepEqual(restored,original);assert.deepEqual(original,before);
});
test('only actual document tool results are encoded and existing reference fields are preserved',()=>{
 const item={type:'function_call_output',call_id:'read',output:'{"paragraphs":[]}'},input=[{type:'function_call',call_id:'read',name:'gyomu_cbe_notes'}];assert.equal(documentOutput(input,item),item.output);
 const value={paragraphs:[{id:'p1',styleRef:'original',text_style:{size:11}}]};assert.equal(compactDocument(value),value);
});
