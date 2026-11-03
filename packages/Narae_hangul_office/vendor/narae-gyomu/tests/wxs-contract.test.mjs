import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
process.env.NARAE_GYOMU_DATA=fs.mkdtempSync(os.tmpdir()+'/wxs-contract-');
const {tools,wxsConfig}=await import('../src/catalog.mjs');
const {Tools}=await import('../src/tools.mjs');
test('WXS planner exposes actual title/body/attachment/route config fields',()=>{
  assert.equal(tools.find(t=>t.name==='wxs.prepare').parameters.properties.config,wxsConfig);
  assert.deepEqual(wxsConfig.required,['expected_title','title']);
  assert.equal(wxsConfig.additionalProperties,false);
  assert.equal(wxsConfig.properties.attachments.items.type,'string');
  assert.deepEqual(wxsConfig.properties.approval_route.items.properties.role.enum,['검토','결재']);
  assert.deepEqual(wxsConfig.properties.body_hwp.required,['path','expected_text']);
});
test('binary WXS body must be a selected file before any native operation',async()=>{
  let nativeCalls=0;const instance=new Tools({status:()=>({})},{subprocess:async()=>{nativeCalls++;throw Error('must not invoke');}});
  instance.windows.add('731');
  await assert.rejects(instance.call('wxs.prepare',{hwnd:'731',config:{expected_title:'새 문서',title:'훈련',body_hwp:{path:'D:/private/unselected.hwp',expected_text:'훈련'}}}),e=>e.code==='FILE_NOT_ATTACHED');
  assert.equal(nativeCalls,0);await instance.close();
});
