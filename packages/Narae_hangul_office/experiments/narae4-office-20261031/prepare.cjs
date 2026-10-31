// Copy the reproducible synthetic run into D:; never train inside the source tree.
'use strict';
const fs=require('node:fs'),path=require('node:path');
const destination=path.resolve(process.argv[2]||'D:/Codex/training/narae4-office-reproduction');
const allowed=path.resolve('D:/Codex/training'),relative=path.relative(allowed,destination);
if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw new Error('Choose a new run directory below D:/Codex/training.');
if(fs.existsSync(destination))throw new Error('Existing runs are preserved. Choose a new directory.');
for(const name of ['scripts','data','logs','cache','evaluation','outputs','tmp'])fs.mkdirSync(path.join(destination,name),{recursive:true});
for(const name of ['train.py','export.py','heldout.cjs','download-base.cjs'])fs.copyFileSync(path.join(__dirname,'scripts',name),path.join(destination,'scripts',name));
for(const name of ['train.jsonl','validation.jsonl','manifest.json'])fs.copyFileSync(path.join(__dirname,'datasets',name),path.join(destination,'data',name));
fs.copyFileSync(path.join(__dirname,'base-metadata.json'),path.join(destination,'base-metadata.json'));
console.log(JSON.stringify({run:destination,syntheticOnly:true,next:'Run scripts/download-base.cjs, then scripts/train.py with a compatible Windows CPU PyTorch environment.'}));
