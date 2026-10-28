const string={type:'string'},number={type:'number'},integer={type:'integer',minimum:0},boolean={type:'boolean'};
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const textStyle=object({font:string,size:number,bold:boolean,italic:boolean,underline:boolean,strike:boolean,color:string,background:string,superscript:boolean,subscript:boolean,stretch:number,letter_spacing:number});
const paragraphStyle=object({align:{type:'string',enum:['LEFT','CENTER','RIGHT','JUSTIFY','DISTRIBUTE']},line:number,line_type:string,left:number,right:number,indent:number,before:number,after:number,page_break:boolean});
const operations={type:'array',minItems:1,items:{anyOf:[
 object({op:{type:'string',enum:['set_text']},target:string,text:string},['op','target','text']),
 object({op:{type:'string',enum:['replace_text']},target:string,find:string,replace:string,expected:{type:'integer',minimum:1}},['op','target','find','replace','expected']),
 object({op:{type:'string',enum:['format']},target:string,text_style:textStyle,paragraph_style:paragraphStyle,start:integer,end:integer},['op','target']),
 object({op:{type:'string',enum:['merge_cells']},table_index:integer,start_row:integer,start_col:integer,row_span:{type:'integer',minimum:1},col_span:{type:'integer',minimum:1},text:string,vertical_align:string},['op','table_index','start_row','start_col','row_span','col_span']),
 object({op:{type:'string',enum:['set_cell_style']},table_index:integer,row:integer,col:integer,vertical_align:string,padding_mm:{type:'array',items:number,minItems:4,maxItems:4},width_mm:number,height_mm:number},['op','table_index','row','col']),
 object({op:{type:'string',enum:['insert_row']},table_index:integer,row_index:integer,height_mm:number},['op','table_index','row_index']),
 object({op:{type:'string',enum:['delete_row']},table_index:integer,row_index:integer},['op','table_index','row_index'])
]}};
const paragraph=object({type:{type:'string',enum:['paragraph']},text:string,text_style:textStyle,paragraph_style:paragraphStyle},['type','text']);
const image=object({type:{type:'string',enum:['image']},path:string,width_mm:number,height_mm:number},['type','path','width_mm','height_mm']);
const table=object({type:{type:'string',enum:['table']},columns_mm:{type:'array',items:number},row_heights_mm:{type:'array',items:number},rows:{type:'array',items:{type:'array',items:object({text:string,text_style:textStyle,paragraph_style:paragraphStyle,background:string,vertical_align:string,blocks:{type:'array',items:{anyOf:[paragraph,image]}}})}}},['type','columns_mm','rows']);
const blocks={type:'array',minItems:1,items:{anyOf:[paragraph,image,table]}};
module.exports={operations,blocks,page:object({width_mm:number,height_mm:number,margins_mm:{type:'array',items:number,minItems:4,maxItems:4}})};
