const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto');
function install({appRoot=path.resolve(__dirname,'..'),directory=path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'skills')}={}){
 directory=path.resolve(directory);fs.mkdirSync(directory,{recursive:true});directory=fs.realpathSync(directory);
 const backup=path.join(path.dirname(directory),'skill-backups','narae-office-'+Date.now()+'-'+randomUUID());let changed=0;
 for(const name of ['narae-hangul-office','narae-hangul']){
  const target=path.join(directory,name);if(fs.existsSync(target)&&fs.lstatSync(target).isSymbolicLink())throw new Error('연결된 스킬 폴더를 덮어쓸 수 없습니다: '+target);
  const files=[];const visit=(dir,relative='')=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.name==='__pycache__')continue;const rel=path.join(relative,e.name),file=path.join(dir,e.name);if(e.isSymbolicLink())throw new Error('스킬 소스에 연결 파일이 있습니다.');if(e.isDirectory())visit(file,rel);else files.push([rel,fs.readFileSync(file)]);}};visit(path.join(appRoot,'skills',name));
  files.push(['runtime.json',Buffer.from(JSON.stringify({officeRoot:appRoot},null,2))]);
  for(const [relative,data] of files){const output=path.join(target,relative);let parent=path.dirname(output);while(parent!==directory){if(fs.existsSync(parent)&&fs.lstatSync(parent).isSymbolicLink())throw new Error('스킬 연결 경로를 덮어쓸 수 없습니다.');parent=path.dirname(parent);}if(fs.existsSync(output)){if(fs.lstatSync(output).isSymbolicLink())throw new Error('연결된 파일을 덮어쓸 수 없습니다.');if(fs.readFileSync(output).equals(data))continue;const saved=path.join(backup,name,relative);fs.mkdirSync(path.dirname(saved),{recursive:true});fs.copyFileSync(output,saved);}fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,data);changed++;}
 }
 return {installed:['narae-hangul-office','narae-hangul'],directory,changed,...(fs.existsSync(backup)?{backup}:{}),guidance:'새 채팅에서 스킬을 발견할 수 있습니다.'};
}
module.exports={install};
if(require.main===module){try{console.log(JSON.stringify({success:true,...install()},null,2));}catch(error){console.log(JSON.stringify({success:false,error:error.message}));process.exitCode=1;}}
