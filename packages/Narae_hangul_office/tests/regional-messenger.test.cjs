'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {tool,argumentsFor}=require('../src/regional-messenger.cjs');
test('regional local-store operations reach the real CLI with exact account and validated file paths',()=>{
 const checked=[],policy={allowed(value){checked.push(value);return 'D:/workspace/'+value;}};
 assert.deepEqual(argumentsFor({operation:'bind-store',kind:'notes',database:'my-cache.db',owner:'교직원계정',install_directory:'app'},{region:'제주',policy}),['--region','제주','bind-store','--kind','notes','--database','D:/workspace/my-cache.db','--owner','교직원계정','--install-dir','D:/workspace/app']);
 assert.deepEqual(checked,['my-cache.db','app']);
 assert.deepEqual(argumentsFor({operation:'notes',query:'김교사 100%',limit:20,offset:0},{region:'경기',policy}),['--region','경기','notes','--query','김교사 100%','--limit','20','--offset','0']);
});
test('schema exposes dedicated cache capabilities without claiming verified regional sends',()=>{
 for(const operation of ['accounts','bind-store','notes','note','chats','chat','contacts'])assert(tool.parameters.properties.operation.enum.includes(operation));
 assert.match(tool.description,/전용 로컬 DB/);assert.match(tool.description,/캐시는 서버 동기화/);
 const policy={allowed(){throw Error('outside workspace');}};
 assert.throws(()=>argumentsFor({operation:'accounts',database:'D:/other/private.db'},{region:'경기',policy}),/outside/);
});
