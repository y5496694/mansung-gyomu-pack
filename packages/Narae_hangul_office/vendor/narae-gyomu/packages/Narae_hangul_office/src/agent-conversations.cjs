'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
function replaceTranscript(temp,file){
 // Windows readers and antivirus can briefly lock the destination. Keep the old
 // transcript intact and retry the same completed write, never the append.
 const delays=[20,40,80,160],wait=new Int32Array(new SharedArrayBuffer(4));
 for(let attempt=0;;attempt++)try{fs.renameSync(temp,file);return;}catch(error){
  if(process.platform!=='win32'||!['EPERM','EACCES','EBUSY','UNKNOWN'].includes(error.code)||attempt===delays.length){error.recoveryFile=temp;throw error;}
  Atomics.wait(wait,0,0,delays[attempt]);
 }
}
class AgentConversations{
 constructor(home){this.dir=path.join(home,'data/agent');fs.mkdirSync(this.dir,{recursive:true});}
 file(session){if(!/^(?:local|[a-f0-9]{32})$/.test(session))throw new Error('AGENT_SESSION');return path.join(this.dir,session+'.json');}
 read(session){const file=this.file(session);if(!fs.existsSync(file))return {revision:0,messages:[]};return JSON.parse(fs.readFileSync(file,'utf8'));}
 append(session,role,content,origin){if(!['user','assistant','error'].includes(role)||!['pc','kakao','telegram'].includes(origin))throw new Error('AGENT_MESSAGE');const value=this.read(session);value.messages.push({id:randomUUID(),role,content:String(content).slice(0,50000),origin,created:Date.now()});value.messages=value.messages.slice(-100);value.revision++;const file=this.file(session),tmp=file+'.'+randomUUID()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value),{mode:0o600});replaceTranscript(tmp,file);return value;}
 history(session){return this.read(session).messages.filter(m=>['user','assistant'].includes(m.role)).map(({role,content})=>({role,content}));}
}
module.exports={AgentConversations};
