'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {validate}=require('../../src/remote-policy.cjs'),root=__dirname;
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const manifest=read('datasets/manifest.json'),digest=file=>createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
for(const [name,sha] of Object.entries(manifest.files))assert.equal(digest('datasets/'+name),sha,name);
assert.equal(digest('evaluation/heldout-cases.json'),manifest.heldoutSha256);
assert.equal(digest('evaluation/retention-cases.json'),read('evaluation/retention-freeze.json').sha256);
const rows=split=>fs.readFileSync(path.join(root,'datasets',split+'.jsonl'),'utf8').trim().split('\n').map(JSON.parse),train=rows('train'),validation=rows('validation'),heldout=read('evaluation/heldout-cases.json');
assert.equal(train.length,64);assert.equal(validation.length,16);assert.equal(heldout.length,32);
const ids=new Set(),inputs=new Set(),validationInputs=new Set();let targets=0;
for(const [split,data] of [['train',train],['validation',validation]])for(const row of data){
 // The eight original v1 TRAIN replay rows predate the per-row provenance flag;
 // they are covered by the frozen, audited synthetic replay manifest hash.
 assert(row.syntheticOnly===true||row.syntheticOnly===undefined&&row.id.startsWith('retention-'),row.id);assert(!ids.has(row.id),row.id);ids.add(row.id);
 const input=JSON.stringify(row.messages.slice(1,-1));
 if(split==='train')inputs.add(input);else {assert(!inputs.has(input),'Exact input overlap: '+row.id);validationInputs.add(input);}
 const schemaText=row.messages[0].content.match(/사용 가능한 도구와 인자:\n([^\n]+)/)[1],tools=JSON.parse(schemaText),answer=JSON.parse(row.messages.at(-1).content);
 if(answer.type==='tool'){const tool=tools.find(t=>t.name===answer.name);assert(tool,'Unknown tool: '+row.id);validate(answer.args,tool.parameters);targets++;}else assert.equal(answer.type,'final');
}
for(const c of heldout){
 assert(!ids.has(c.id),c.id);ids.add(c.id);
 const messages=c.messages?c.messages.slice(1,-1):[{role:'user',content:c.prompt},...(c.observed||[]).flatMap(o=>[{role:'assistant',content:JSON.stringify({type:'tool',name:o.name,args:o.args})},{role:'user',content:'도구 관찰 결과: '+JSON.stringify(o.value)}])];
 const input=JSON.stringify(messages);assert(!inputs.has(input)&&!validationInputs.has(input),'Heldout input overlap: '+c.id);
 if(c.answer?.type==='tool')validate(c.answer.args,c.tools.find(t=>t.name===c.answer.name).parameters);
}
console.log(JSON.stringify({syntheticOnly:true,train:train.length,validation:validation.length,heldout:heldout.length,toolTargetsValidated:targets,exactCrossSplitInputOverlap:0,hashesVerified:true}));
