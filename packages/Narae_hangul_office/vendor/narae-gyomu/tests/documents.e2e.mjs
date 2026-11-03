import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
process.env.NARAE_GYOMU_DATA=fs.mkdtempSync((await import('node:os')).tmpdir()+'/gyomu-docs-');
const {DATA,OUTPUTS,initialize}=await import('../src/paths.mjs');initialize();
const {Tools}=await import('../src/tools.mjs');
test('Narae Hangul Office CLI creates and edits HWP/HWPX without changing originals',async()=>{
  const tools=new Tools({status:()=>({})});
  const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  for(const format of ['hwp','hwpx']){
    const filename='검증.'+format;
    const made=await tools.call('hangul.create',{title:'가상 연수 안내',body:'제출 기한: 2026. 11. 24. 15:00\n기제출자는 재제출하지 않음',format,filename});
    assert.equal(made.success,true);assert.equal(made.modeled_content_verified,true);
    const file=path.join(OUTPUTS,filename),before=sha(file);
    const view=await tools.call('hangul.inspect',{path:file});
    assert.ok(view.paragraphs.some(p=>p.text==='기제출자는 재제출하지 않음'));
    const target=view.paragraphs.find(p=>p.text.startsWith('제출 기한')).id;
    const edited=await tools.call('hangul.edit',{path:file,filename:'수정.'+format,expected_input_sha256:view.input_sha256,operations:[{op:'set_text',target,text:'제출 기한: 2026. 11. 25. 15:00'}]});
    assert.equal(edited.success,true);assert.equal(sha(file),before);
    const after=await tools.call('hangul.inspect',{path:path.join(OUTPUTS,'수정.'+format)});
    assert.ok(after.paragraphs.some(p=>p.text==='제출 기한: 2026. 11. 25. 15:00'));
    assert.ok(after.paragraphs.some(p=>p.text==='기제출자는 재제출하지 않음'));
    await assert.rejects(tools.call('hangul.create',{title:'x',body:'x',format,filename}),e=>e.code==='OUTPUT_EXISTS');
  }
  const doctor=await tools.call('wxs',{operation:'doctor'});
  assert.equal(doctor.dependencies.pythoncom,true);assert.equal(doctor.dependencies.win32gui,true);
  fs.writeFileSync(path.join(DATA,'result.json'),JSON.stringify({verified:true,formats:['hwp','hwpx'],sourcePreserved:true,wxsPrerequisites:true}));
});
