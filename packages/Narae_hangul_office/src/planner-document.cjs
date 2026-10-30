'use strict';
// Lossless dictionary encoding of repeated paragraph styles for small models.
function compactDocument(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.hasOwn(value,'plannerStyles'))return value;
 const keys=['textStyle','paragraphStyle','text_style','paragraph_style'],collections=['blocks','paragraphs'].filter(k=>Array.isArray(value[k]));
 if(!collections.length||collections.some(k=>value[k].some(p=>p&&Object.hasOwn(p,'styleRef'))))return value;
 const styles=[],index=new Map(),result={...value};
 for(const key of collections)result[key]=value[key].map(p=>{
  if(!p||typeof p!=='object'||Array.isArray(p))return p;
  const style=Object.fromEntries(keys.filter(k=>Object.hasOwn(p,k)).map(k=>[k,p[k]]));if(!Object.keys(style).length)return p;
  const encoded=JSON.stringify(style);if(!index.has(encoded)){index.set(encoded,styles.length);styles.push(style);}
  return {...Object.fromEntries(Object.entries(p).filter(([k])=>!keys.includes(k))),styleRef:index.get(encoded)};
 });
 if(!styles.length)return value;
 result.plannerStyles=styles;result.styleEncoding='Each paragraph styleRef indexes plannerStyles; original style field names and values are preserved.';
 return JSON.stringify(result).length<JSON.stringify(value).length?result:value;
}
function documentOutput(input,item){
 const call=input.find(c=>c.type==='function_call'&&c.call_id===item.call_id);
 if(call?.name!=='read_document')return item.output;
 try{return JSON.stringify(compactDocument(JSON.parse(item.output)));}catch{return item.output;}
}
module.exports={compactDocument,documentOutput};
