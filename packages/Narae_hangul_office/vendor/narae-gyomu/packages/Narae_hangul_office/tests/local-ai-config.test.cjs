const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {LocalAI}=require('../src/local-ai.cjs');
test('model folder and autostart survive app reconstruction without moving existing files',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'narae-config-')),root=path.resolve(__dirname,'..'),folder=path.join(home,'separate-models');
 try{const ai=new LocalAI({root,home});const old=path.join(ai.dir,'keep.txt');fs.writeFileSync(old,'keep');ai.configure({directory:folder,autoStart:false});const restored=new LocalAI({root,home});assert.equal(restored.dir,folder);assert.equal(restored.autoStart,false);assert.equal(fs.readFileSync(old,'utf8'),'keep');restored.setAutoStart(true);assert.equal(new LocalAI({root,home}).autoStart,true);restored.busy='narae1';assert.throws(()=>restored.configure({directory:home}),/중지/);restored.busy=null;assert.throws(()=>restored.configure({directory:'relative'}),/절대 경로/);await ai.close();await restored.close();}finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('a request during startup joins the same model load rather than launching a second server',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'narae-activation-')),ai=new LocalAI({root:path.resolve(__dirname,'..'),home});let release,loads=0;
 try{ai.startModel=()=>{loads++;return new Promise(r=>release=r);};const first=ai.activate('narae1'),second=ai.activate('narae1');await assert.rejects(ai.activate('narae3'),/기다리/);release({active:'narae1'});assert.deepEqual(await first,await second);assert.equal(loads,1);assert.equal(ai.activation,null);}finally{await ai.close();fs.rmSync(home,{recursive:true,force:true});}
});
