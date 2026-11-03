'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {replaceFile}=require('./agent-conversations.cjs');
function dateKey(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw Error('올바른 날짜를 선택하세요.');return value;}
class TalkPersonal{
 constructor(home){this.file=path.join(home,'data/talk-personal.json');}
 read(){try{return {added:[],rooms:[],calendar:{},notifications:true,selfOpened:false,...JSON.parse(fs.readFileSync(this.file,'utf8'))};}catch(e){if(e.code==='ENOENT')return {added:[],rooms:[],calendar:{},notifications:true,selfOpened:false};throw e;}}
 save(value){fs.mkdirSync(path.dirname(this.file),{recursive:true});const tmp=this.file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify(value,null,2),{mode:0o600});replaceFile(tmp,this.file);}finally{fs.rmSync(tmp,{force:true});}return value;}
 addFriend(id){const value=this.read();value.added=[...new Set([...value.added,id])];this.save(value);}
 notifications(enabled){if(typeof enabled!=='boolean')throw Error('알림 상태를 확인하세요.');const value=this.read();value.notifications=enabled;this.save(value);return enabled;}
 openSelf(){const value=this.read();value.selfOpened=true;this.save(value);}
 room(title,members){if(typeof title!=='string'||!title.trim()||title.trim().length>60)throw Error('톡방 제목을 1~60자로 입력하세요.');if(!Array.isArray(members)||!members.length||members.length>40||members.some(m=>typeof m!=='string'))throw Error('대화할 친구를 선택하세요.');const value=this.read(),room={id:'room_'+randomUUID().replaceAll('-',''),name:title.trim(),members:[...new Set(members)],created:Date.now(),icon:'narae-talk.svg',cli:'선택한 친구의 도구',description:'선택한 친구 '+new Set(members).size+'명과 대화'};value.rooms.push(room);this.save(value);return room;}
 calendar(date){dateKey(date);const value=this.read(),counts=Object.fromEntries(Object.entries(value.calendar).filter(([,items])=>items.length).map(([day,items])=>[day,items.length]));return {date,items:value.calendar[date]||[],dates:Object.keys(counts),counts};}
 weekCalendar(date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date())){dateKey(date);const first=new Date(date+'T00:00:00Z');first.setUTCDate(first.getUTCDate()-(first.getUTCDay()+6)%7);const start=first.toISOString().slice(0,10);first.setUTCDate(first.getUTCDate()+6);const end=first.toISOString().slice(0,10),calendar=this.read().calendar,days=Object.keys(calendar).filter(day=>day>=start&&day<=end&&calendar[day].length).sort().map(date=>({date,items:calendar[date]}));return {start,end,days,total:days.reduce((sum,day)=>sum+day.items.length,0)};}
 addEvent(date,text){dateKey(date);if(typeof text!=='string'||!text.trim()||text.trim().length>1000)throw Error('일정을 1~1000자로 입력하세요.');const value=this.read(),event={id:randomUUID(),text:text.trim(),created:Date.now()};value.calendar[date]=[...(value.calendar[date]||[]),event];this.save(value);return this.calendar(date);}
 removeEvent(date,id){dateKey(date);const value=this.read();value.calendar[date]=(value.calendar[date]||[]).filter(item=>item.id!==id);this.save(value);return this.calendar(date);}
}
function session(id){return createHash('sha256').update('narae-talk:personal:'+id).digest('hex').slice(0,32);}
function memberFor(members,name,args){for(const id of members)try{require('./talk-store.cjs').assertTool(id,name,args);return id;}catch{}throw Error('이 톡방에 추가한 친구가 사용할 수 있는 도구가 아닙니다.');}
module.exports={TalkPersonal,dateKey,session,memberFor};
