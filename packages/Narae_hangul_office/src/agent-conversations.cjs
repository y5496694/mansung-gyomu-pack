'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
class AgentConversations{
 constructor(home){this.dir=path.join(home,'data/agent');fs.mkdirSync(this.dir,{recursive:true});}
 file(session){if(!/^(?:local|[a-f0-9]{32})$/.test(session))throw new Error('AGENT_SESSION');return path.join(this.dir,session+'.json');}
 read(session){const file=this.file(session);if(!fs.existsSync(file))return {revision:0,messages:[]};return JSON.parse(fs.readFileSync(file,'utf8'));}
 append(session,role,content,origin){if(!['user','assistant','error'].includes(role)||!['pc','kakao'].includes(origin))throw new Error('AGENT_MESSAGE');const value=this.read(session);value.messages.push({id:randomUUID(),role,content:String(content).slice(0,50000),origin,created:Date.now()});value.messages=value.messages.slice(-100);value.revision++;const file=this.file(session),tmp=file+'.'+randomUUID()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value),{mode:0o600});fs.renameSync(tmp,file);return value;}
 history(session){return this.read(session).messages.filter(m=>['user','assistant'].includes(m.role)).map(({role,content})=>({role,content}));}
}
module.exports={AgentConversations};
