const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>value?.[key]!==undefined).map(key=>[key,value[key]]));
function inspection(data,req={}){
 if(req.full!==undefined&&typeof req.full!=='boolean')throw new Error('full은 true/false로 지정하세요.');
 const offset=req.offset??0,limit=req.limit??data.blocks.length;
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<0)throw new Error('offset과 limit는 0 이상의 정수로 지정하세요.');
 const paragraphs=data.blocks.slice(offset,offset+limit).map(p=>req.full?{...p,editable_text:p.editable,text_style:p.textStyle,paragraph_style:p.paragraphStyle}:{
  id:p.id,text:p.text,editable_text:p.editable,
  text_style:pick(p.textStyle,['font','size','bold','italic','underline','strike','color','background','superscript','subscript','stretch','letter_spacing']),
  paragraph_style:pick(p.paragraphStyle,['align','left','right','indent','before','after','line','line_type','page_break'])});
 const base=req.full?{...data}:pick(data,['kind','path','name','hash','bytes','tables','images','textDetailsLoaded','revisionState']);
 return {...base,paragraphs,counts:{paragraphs:data.blocks.length,tables:data.tables.length},view:req.full?'full':'compact',
  offset,nextOffset:offset+paragraphs.length,hasMore:offset+paragraphs.length<data.blocks.length};
}
module.exports={inspection};
