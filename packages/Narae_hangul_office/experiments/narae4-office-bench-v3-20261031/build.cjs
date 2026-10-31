'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const source=__dirname,target=path.resolve(process.argv[2]||'');
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
if(!process.argv[2]||target===source||fs.existsSync(target)&&fs.readdirSync(target).length)throw Error('Provide a new or empty reproduction directory');
const manifest=JSON.parse(fs.readFileSync(path.join(source,'datasets/manifest.json')));
for(const [name,expected] of Object.entries(manifest.files))if(sha(path.join(source,'datasets',name))!==expected)throw Error('Dataset hash mismatch: '+name);
if(sha(path.join(source,'evaluation/heldout-cases.json'))!==manifest.heldoutSha256)throw Error('Heldout hash mismatch');
const retention=JSON.parse(fs.readFileSync(path.join(source,'evaluation/retention-freeze.json')));
if(sha(path.join(source,'evaluation/retention-cases.json'))!==retention.sha256)throw Error('Retention hash mismatch');
for(const dir of ['data','evaluation','scripts','fixtures','logs','outputs','exports','cache/features','tmp'])fs.mkdirSync(path.join(target,dir),{recursive:true});
for(const [from,to] of [['datasets','data'],['evaluation','evaluation'],['scripts','scripts'],['fixtures','fixtures']])for(const item of fs.readdirSync(path.join(source,from),{withFileTypes:true})){if(item.isFile())fs.copyFileSync(path.join(source,from,item.name),path.join(target,to,item.name));}
const base=JSON.parse(fs.readFileSync(path.join(source,'base-manifest.json')));
if(process.env.NARAE_TRAIN_START_ADAPTER)manifest.startingAdapter=path.resolve(process.env.NARAE_TRAIN_START_ADAPTER);
if(process.env.NARAE_TRAIN_BASE){base.destination=path.resolve(process.env.NARAE_TRAIN_BASE);const file=path.join(target,'scripts/train.py');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace("Path('D:/Codex/models/Qwen3.5-2B-HF')",'Path('+JSON.stringify(base.destination.replaceAll('\\','/'))+')'));}
fs.writeFileSync(path.join(target,'data/manifest.json'),JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(path.join(target,'download-manifest.json'),JSON.stringify(base,null,2)+'\n');
console.log(JSON.stringify({directory:target,train:manifest.train,validation:manifest.validation,heldout:manifest.heldout,actualTrainingStarted:false}));
