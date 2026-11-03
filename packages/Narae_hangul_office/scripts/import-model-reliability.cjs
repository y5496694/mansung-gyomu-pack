'use strict';
// Reviewed actual-execution records stay in the user's data directory.
const fs=require('node:fs'),path=require('node:path');
const {ModelReliability}=require('../src/model-reliability.cjs');
try{const [file,home]=process.argv.slice(2);if(!file||!home||!path.isAbsolute(home))throw Error('node scripts/import-model-reliability.cjs 기록.json 앱데이터절대경로');const value=JSON.parse(fs.readFileSync(path.resolve(file),'utf8').replace(/^\uFEFF/,'')),store=new ModelReliability({home,catalog:require('../resources/local-models.json')});console.log(JSON.stringify(store.import(value).map(({id,success,failure,total,unverified,percent})=>({id,success,failure,total,unverified,percent})),null,2));}catch(error){console.error(error.message);process.exitCode=1;}
