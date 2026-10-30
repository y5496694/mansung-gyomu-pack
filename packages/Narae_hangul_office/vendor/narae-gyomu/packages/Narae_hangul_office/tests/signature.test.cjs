const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {normalize,resultPath,execute}=require('../src/cli.cjs');
test('signature image paths resolve from the job and cannot be result paths',()=>{
 const base=path.resolve('jobs'),job={action:'insert-signature',input:'source.hwp',output:'signed.hwp',image_path:'signature.png'};
 assert.equal(normalize(job,base).image_path,path.join(base,'signature.png'));
 assert.throws(()=>resultPath(path.join(base,'signature.png'),job,base),/결과 JSON/);
});
test('schema advertises signature placement and expected source hash',async()=>{
 const schema=await execute({action:'schema'});
 assert.ok(schema.actions.includes('insert-signature'));
 assert.ok(schema.signature.required.includes('expected_input_sha256'));
 assert.ok(schema.signature.required.includes('anchor_text'));
 assert.match(schema.signature.placement,/BehindText/);
});
