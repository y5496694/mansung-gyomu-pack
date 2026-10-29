import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

test('absolute app Python and portable relative Python both reach the WXS reader unchanged',()=>{
 const parent='D:/Codex/tmp',home=fs.mkdtempSync(path.join(parent,'gyomu-python-path-')),entry=pathToFileURL(path.resolve('src/tools.mjs')).href;
 try{for(const configured of [process.execPath,path.join('runtime','python with spaces','python.exe')]){fs.writeFileSync(path.join(home,'runtime.json'),JSON.stringify({python:configured}));const script='const {Tools}=await import('+JSON.stringify(entry)+');const tools=new Tools({status:()=>({})});process.stdout.write(JSON.stringify({python:tools.python,capturePython:tools.captures.python}));';const child=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',windowsHide:true,env:{...process.env,NARAE_GYOMU_HOME:home,NARAE_GYOMU_DATA:path.join(home,'data')}});assert.equal(child.status,0,child.stderr);const actual=JSON.parse(child.stdout),expected=path.resolve(home,configured);assert.equal(actual.python,expected);assert.equal(actual.capturePython,expected);}}finally{if(path.dirname(path.resolve(home))!==path.resolve(parent))throw Error('Unexpected test folder');fs.rmSync(home,{recursive:true,force:true});}
});
