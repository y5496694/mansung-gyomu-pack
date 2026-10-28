const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process'),{createHash}=require('node:crypto');
class KeyStore{
 constructor(home,python,slot='gpt-key'){if(!/^[a-z][a-z0-9-]{0,48}$/.test(slot))throw new Error('잘못된 자격 증명 저장소입니다.');this.home=home;this.python=python;this.slot=slot;this.file=path.join(home,'data',slot+'.bin');fs.mkdirSync(path.join(home,'cache'),{recursive:true});}
 call(request){let output;try{output=execFileSync(this.python,[path.join(__dirname,'key_store.py')],{input:JSON.stringify({...request,home:this.home,slot:this.slot}),windowsHide:true,encoding:'utf8',timeout:15000,stdio:['pipe','pipe','pipe'],env:require('./runtime-python.cjs').pythonEnvironment(this.home)});}catch{throw new Error('Windows 사용자 자격 증명 저장소를 읽거나 저장하지 못했습니다. 연결 설정을 확인하세요.');}const result=JSON.parse(output);if(!result.ok)throw new Error(result.error);return result;}
 get(){if(!fs.existsSync(this.file))return '';const digest=createHash('sha256').update(fs.readFileSync(this.file)).digest('hex');if(digest===this.digest)return this.key;const result=this.call({action:'read'});this.digest=digest;this.key=result.key;return this.key;}
 set(key){this.call({action:'write',key});this.digest=null;this.key=null;return this.get();}
 remove(){fs.rmSync(this.file,{force:true});this.digest=null;this.key=null;}
}
module.exports={KeyStore};
