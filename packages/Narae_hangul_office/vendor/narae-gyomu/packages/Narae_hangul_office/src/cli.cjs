#!/usr/bin/env node
// Agent-facing document commands. No Electron, provider login, or paid AI call.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createHash,randomUUID}=require('node:crypto');
const {runPython}=require('./python.cjs'),{NativeDocuments}=require('./native-documents.cjs');
const root=path.resolve(__dirname,'..');
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const absolute=(value,base)=>{if(typeof value!=='string'||!value.trim())throw new Error('파일 경로가 필요합니다.');return path.resolve(base,value);};
function normalize(job,base){
 if(!job||Array.isArray(job)||typeof job!=='object')throw new Error('작업 JSON은 객체여야 합니다.');
 if(job.schema!==undefined&&job.schema!==1)throw new Error('schema: 1만 지원합니다.');
 const req=structuredClone(job);req.path=job.path||job.input||(job.action==='create'?job.output:undefined);
 if(req.path)req.path=absolute(req.path,base);
 if(job.output&&job.action!=='create')req.target=absolute(job.output,base);
 if(job.target)req.target=absolute(job.target,base);
 req.expectedHash=job.expectedHash||job.expected_input_sha256;
 if(job.overwrite_output===true)req.overwrite=true;
 if(job.image_path)req.image_path=absolute(job.image_path,base);
 const images=items=>{for(const item of items||[]){if(item.type==='image')item.path=absolute(item.path,base);for(const row of item.rows||[])for(const cell of row)images(cell.blocks);}};
 images(req.blocks);
 if(job.preview)throw new Error('preview 대신 export 작업으로 PDF 사본을 생성하세요.');
 return req;
}
function resultPath(file,job,base,jobFile){
 if(!file)return null;
 file=absolute(file,process.cwd());
 const protectedPaths=[jobFile,job.path,job.input,job.output,job.target,job.image_path].filter(Boolean).map(p=>absolute(p,base));
 const visit=value=>{if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){if(key==='path'&&typeof item==='string')protectedPaths.push(absolute(item,base));else visit(item);}};visit(job.blocks);
 const canonical=p=>{if(fs.existsSync(p))return fs.realpathSync(p).toLowerCase();const parent=path.dirname(p);return path.join(fs.existsSync(parent)?fs.realpathSync(parent):parent,path.basename(p)).toLowerCase();};
 if(protectedPaths.some(p=>canonical(p)===canonical(file)))throw new Error('결과 JSON은 작업 JSON·문서·그림과 다른 경로로 지정하세요.');
 return file;
}
function writeResult(file,response){if(!file)return;fs.mkdirSync(path.dirname(file),{recursive:true});const stage=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(stage,JSON.stringify(response,null,2));fs.renameSync(stage,file);}finally{fs.rmSync(stage,{force:true});}}
async function lock(home,file,operation){
 const key=createHash('sha256').update((fs.existsSync(file)?fs.realpathSync(file):path.resolve(file)).toLowerCase()).digest('hex');
 const directory=path.join(home,'cache','cli-locks');fs.mkdirSync(directory,{recursive:true});const target=path.join(directory,key);
 try{fs.mkdirSync(target);}catch(error){if(error.code==='EEXIST')throw new Error('이 문서의 다른 CLI 작업이 진행 중입니다. 종료 후 다시 실행하세요. 잠금: '+target);throw error;}
 fs.writeFileSync(path.join(target,'owner.json'),JSON.stringify({pid:process.pid,at:new Date().toISOString(),file}));
 try{return await operation();}finally{fs.rmSync(target,{recursive:true,force:true});}
}
async function execute(job,{base=process.cwd(),home=process.env.NARAE_OFFICE_HOME||path.join(process.env.LOCALAPPDATA||os.homedir(),'NaraeHangulOffice'),python=require('./runtime-python.cjs').resolvePython(root)}={}){
 const req=normalize(job,base),action=req.action;
 if(action==='schema')return {schema:1,actions:['doctor','inspect','create','edit','insert-signature','export','open','list','live-read','live-edit','install-skill'],signature:{action:'insert-signature',required:['input','output','expected_input_sha256','image_path','anchor_text','x_mm','y_mm'],optional:['width_mm','height_mm','expected_count','occurrence'],placement:'paper top-left, mm; TreatAsChar=false; TextWrap=BehindText'},...require('./hwp-file-contracts.cjs')};
 if(action==='install-skill')return require('../scripts/install-skills.cjs').install({appRoot:root,directory:req.directory});
 if(action==='doctor'){
  const hancom=require('./hancom.cjs').discoverHancom(),available=fs.existsSync(python);
  if(!available||!hancom.hangul)throw new Error('설치.cmd로 설치하고 한컴오피스 한글을 먼저 설치·실행하세요. Python: '+python);
  return {version:require('../package.json').version,root,home,python,hancom,aiAccountRequired:false};
 }
 if(!fs.existsSync(python))throw new Error('앱 런타임이 없습니다. 설치.cmd를 실행하세요.');
 for(const folder of ['cache','data/backups','backups'])fs.mkdirSync(path.join(home,folder),{recursive:true});
 const native=new NativeDocuments(home,python),doc=input=>runPython(python,home,'documents.py',input);
 try{
  if(action==='list')return await native.list();
  require('./format-policy.cjs').assertDocument(req.path||'');
  return await lock(home,req.path,async()=>{
   if(action==='open')return {path:req.path,...await native.openFile(req.path)};
   if(action==='live-read'||action==='live-edit'){
    if(action==='live-edit'&&!req.liveRevision)throw new Error('직전 live-read의 liveRevision이 필요합니다.');
    await native.openFile(req.path);
    return await native.withFileLock(req.path,()=>runPython(python,home,'live_hangul.py',{...req,action:action==='live-read'?'read':'edit',save:req.save!==false,backupDir:path.join(home,'backups')}));
   }
   if(action==='create')return {output:req.path,...await doc({...req,action:'create'})};
   if(action==='insert-signature'){
    if(!req.expectedHash)throw new Error('직전 inspect의 input_sha256을 expected_input_sha256으로 지정하세요.');
    return await native.savedFileOperation(req.path,{editing:true},()=>doc({...req,action:'insert_signature'}));
   }
   if(action==='edit'){
    if(!req.expectedHash)throw new Error('직전 inspect의 input_sha256 또는 hash를 expected_input_sha256으로 지정하세요.');
    return {input:req.path,output:req.target||req.path,...await native.savedFileOperation(req.path,{editing:true},()=>doc({...req,action:'save'}))};
   }
   if(action==='export')return await native.savedFileOperation(req.path,{},()=>doc({...req,action:'export'}));
   if(action==='inspect'){
    const before=hash(req.path),data=await native.savedFileOperation(req.path,{},()=>doc({...req,action:'inspect'}));
    if(hash(req.path)!==before)throw new Error('읽는 동안 원본이 변경되었습니다. 다시 읽으세요.');
    return {...require('./cli-output.cjs').inspection(data,req),input:req.path,input_sha256:data.hash,input_unchanged:true,format:path.extname(req.path).slice(1),warnings:data.limitations||[]};
   }
   throw new Error('지원하지 않는 action입니다. schema 명령을 확인하세요.');
  });
 }finally{native.close();}
}
const usage='narae-office doctor | schema | install-skill | run <job.json|-> [--result result.json] | inspect <file> [--full] [--offset N --limit N] | live-read <file> | open <file> | list | export <file> --pdf <new.pdf>\ncreate/edit/live-edit: run 작업 JSON을 사용하세요. 기본 읽기는 compact JSON이며 --full로 전체 서식을 받습니다. 실패 종료코드는 1입니다.';
async function main(argv=process.argv.slice(2)){
 let output,response;
 try{
  if(!argv.length||['help','--help','-h'].includes(argv[0])){process.stdout.write(usage+'\n');return 0;}
  const args=[...argv],action=args.shift(),take=name=>{const i=args.indexOf(name);if(i<0)return undefined;if(!args[i+1])throw new Error(name+' 값이 필요합니다.');return args.splice(i,2)[1];};
  const result=take('--result'),fullIndex=args.indexOf('--full'),full=fullIndex>=0;
  if(full)args.splice(fullIndex,1);
  const offset=take('--offset'),limit=take('--limit');let job,base=process.cwd(),jobFile;
  if(action==='run'){
   const file=args.shift();if(!file)throw new Error('작업 JSON 경로 또는 -를 지정하세요.');
   if(file!=='-'){jobFile=path.resolve(file);base=path.dirname(jobFile);}
   job=JSON.parse(fs.readFileSync(jobFile||0,'utf8').replace(/^\uFEFF/,''));
  }else{const pdf=take('--pdf');job={schema:1,action};if(!['doctor','schema','list','install-skill'].includes(action))job.path=args.shift();if(pdf)job.target=pdf;}
  if(full)job.full=true;if(offset!==undefined)job.offset=Number(offset);if(limit!==undefined)job.limit=Number(limit);
  if(args.length)throw new Error('알 수 없는 인자: '+args.join(' '));
  output=resultPath(result,job,base,jobFile);
  response={success:true,...await execute(job,{base})};
 }catch(error){response={success:false,error:error.message};}
 try{writeResult(output,response);}catch(error){response={success:false,error:'결과 JSON 저장 실패: '+error.message,operationResult:response};}
 process.stdout.write(JSON.stringify(response,null,2)+'\n');return response.success?0:1;
}
if(require.main===module)main().then(code=>process.exitCode=code).catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
module.exports={execute,main,normalize,resultPath,lock};
