const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
const {runPython}=require('../src/python.cjs'),{inspection}=require('../src/cli-output.cjs');
const fs=require('node:fs');
test('large Korean stdout preserves characters split between pipe buffers',async()=>{
 const value=await runPython(process.execPath,path.join(os.tmpdir(),'narae-output-test'),'../tests/fixtures/utf8-output.cjs',{});
 assert.equal(value.text,'한글·한국어🙂'.repeat(20000));assert(!value.text.includes('\ufffd'));
});
test('compact inspection has one paragraph representation and explicit pagination',()=>{
 const data={blocks:[{id:'body/0',text:'한글',editable:true,textStyle:{font:'맑은 고딕',size:11,language_fonts:Array(7).fill('맑은 고딕')},paragraphStyle:{align:'LEFT'},runs:[]}],tables:[],hash:'sample',textDetailsLoaded:true};
 const compact=inspection(data);assert(!('blocks' in compact));assert(!('runs' in compact.paragraphs[0]));assert.equal(compact.paragraphs[0].text_style.size,11);
 const full=inspection(data,{full:true});assert.equal(full.blocks,data.blocks);assert.equal(full.paragraphs[0].textStyle.language_fonts.length,7);
 const empty=inspection(data,{limit:0});assert(empty.hasMore);assert.equal(empty.counts.paragraphs,1);assert.throws(()=>inspection(data,{offset:-1}),/offset/);
});
test('Office skill installation preserves the independent Hangul skill',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'office-skills-'));
 try{fs.mkdirSync(path.join(directory,'narae-hangul'));const file=path.join(directory,'narae-hangul/SKILL.md');fs.writeFileSync(file,'independent');
  const result=require('../scripts/install-skills.cjs').install({directory});assert.deepEqual(result.installed,['narae-hangul-office']);assert.equal(fs.readFileSync(file,'utf8'),'independent');
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
