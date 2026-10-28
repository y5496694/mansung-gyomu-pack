const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
async function locked(file,work){
 fs.mkdirSync(path.dirname(file),{recursive:true});const deadline=Date.now()+45000,owner={pid:process.pid,id:randomUUID()};let fd;
 while(fd===undefined){try{fd=fs.openSync(file,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(owner));}catch(error){if(error.code!=='EEXIST')throw error;try{const prior=JSON.parse(fs.readFileSync(file,'utf8'));try{process.kill(prior.pid,0);}catch(probe){if(probe.code==='ESRCH')fs.unlinkSync(file);}}catch{}if(Date.now()>deadline)throw new Error('다른 연결 작업이 진행 중입니다. 잠시 후 다시 시도하세요.');await new Promise(resolve=>setTimeout(resolve,100));}}
 try{return await work();}finally{fs.closeSync(fd);try{if(JSON.parse(fs.readFileSync(file,'utf8')).id===owner.id)fs.unlinkSync(file);}catch{}}
}
module.exports={locked};
