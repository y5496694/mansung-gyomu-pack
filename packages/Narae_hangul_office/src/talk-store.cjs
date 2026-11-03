'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const school=require('./school-region.cjs'),regionalMessengers=require('../vendor/narae-messenger-cli/regions.json');
const occupations=['교사','교육행정직','교육공무직','회사원','자영업','프리랜서','학생','기타'];
const schoolOccupations=['교사','교육행정직','교육공무직'];
const schoolFriends=new Set(['cbe','regional','portal','wxs','gyomu']);
function regionFor(value){return school.regions.find(r=>[r.region,r.id,r.label,r.label.replace(/교육청$/,'')].includes(String(value||'').trim()));}
function schoolPack(value){const region=regionFor(value?.region);if(!region||!schoolOccupations.includes(value?.occupation))return null;return {...region,messenger:region.id==='cbe'?'충북소통메신저':regionalMessengers.find(r=>r.id===region.id)?.messenger||region.region+' 교직원 메신저'};}
function profileOptions(){return {occupations,schoolOccupations,regions:school.regions.map(r=>({value:r.region,label:r.region,schoolLabel:r.label,portalUrl:r.portalUrl,messenger:r.id==='cbe'?'충북소통메신저':regionalMessengers.find(m=>m.id===r.id)?.messenger||r.region+' 교직원 메신저'}))};}
const definitions=[
 {id:'narae',name:'나래',description:'설치된 모든 도구를 함께 사용하는 나의 AI 친구',icon:'narae-original.png',cli:'전체 도구'},
 {id:'hangul',name:'나래한글',description:'한글 문서 읽기 · 작성 · 편집 · PDF',icon:'narae-office.png',cli:'나래한글 CLI'},
 {id:'cbe',name:'충북소통메신저',description:'교직원 검색 · 쪽지 · 대화',icon:'cbe.png',cli:'CBE CLI'},
 {id:'browser',name:'나래 브라우저',description:'웹·뉴스 검색 · 본문 읽기 · 요약·비교',icon:'browser.svg',cli:'나래 브라우저 CLI'},
 {id:'portal',name:'나래교무 업무포털',description:'나이스 · K-에듀파인 · 인증서 로그인',icon:'portal.svg',cli:'나래교무 포털 CLI'},
 {id:'wxs',name:'K-에듀파인 WXS',description:'공문 본문 · 첨부 · 기안',icon:'wxs.svg',cli:'WXS CLI'},
 {id:'kakao',name:'카카오톡',description:'카카오톡 CLI · 대화 조회·검색·전송',icon:'kakao.png',cli:'카카오톡 CLI'},
 {id:'gyomu',name:'나래교무',description:'통합 도구 상태 · 업무 스킬 · 기능 안내',icon:'narae-friend.svg',cli:'나래교무 CLI'},
 ...require('./talk-catalog.cjs').catalog.filter(f=>f.category!=='messenger').map(({id,name,description,icon,cli})=>({id,name,description,icon,cli,optional:true})),
 {id:'regional',name:'지역 소통메신저',description:'선택한 교육청의 메신저',icon:'messenger.svg',cli:'지역 메신저 CLI'}
];
for(const region of school.regions){const messenger=regionalMessengers.find(r=>r.id===region.id);definitions.push({id:'portal_'+region.id,kind:'portal',dynamic:true,region:region.region,name:'나래교무 포탈('+region.region+')',description:region.label+' · 나이스 · K-에듀파인 · WXS',icon:'portal.svg',cli:'나래교무 포털 CLI',portalUrl:region.portalUrl},{id:'messenger_'+region.id,kind:region.id==='cbe'?'cbe':'regional',dynamic:true,region:region.region,name:messenger.messenger,description:region.label+' · '+(region.id==='cbe'?'교직원 검색 · 쪽지 · 대화':messenger.support==='dedicated-driver-pending'?'전용 CLI 준비 중 · UIA 관찰':'로컬 캐시 조회 · 서버 전송 미검증'),icon:region.id==='cbe'?'cbe.png':require('./talk-catalog.cjs').catalog.find(f=>f.id==='messenger_'+region.id)?.icon||'messenger.svg',cli:region.id==='cbe'?'CBE CLI':'지역 메신저 CLI',support:messenger.support});}
const definition=id=>definitions.find(f=>f.id===id);
const common=name=>['gyomu_skill_read','gyomu_system_status'].includes(name);
function permits(friend,name){
 friend=definition(friend)?.kind||friend;
 if(friend==='narae')return true;
 if(common(name))return !['ezedu','hiclass','movie'].includes(friend)||name!=='gyomu_skill_read';
 if(friend==='hangul')return !name.startsWith('gyomu_');
 if(friend==='cbe')return name.startsWith('gyomu_cbe_')||name==='gyomu_messenger_archive';
 if(friend==='browser')return name==='gyomu_browser';
 if(friend==='portal')return /^gyomu_(browser|portal_|edufine_|neis_|wxs|office_|capabilit)/.test(name);
 if(friend==='ezedu')return ['gyomu_ezedu','gyomu_addon_read'].includes(name);
 if(friend==='hiclass')return ['gyomu_browser','gyomu_addon_read'].includes(name);
 if(friend==='movie')return ['gyomu_movie','gyomu_addon_read','read_image'].includes(name);
 if(friend==='wxs')return name.startsWith('gyomu_wxs');
 if(friend==='kakao')return name==='gyomu_kakao';
 if(friend==='regional')return ['gyomu_regional_messenger','gyomu_addon_read'].includes(name);
 if(friend==='gyomu')return /^gyomu_(office_|capabilit)/.test(name);
 return false;
}
function filterTools(friend,tools){if(!definitions.some(f=>f.id===friend))throw Error('친구를 찾을 수 없습니다.');return tools.filter(t=>permits(friend,t.name));}
function assertTool(friend,name,args={}){
 if(!permits(friend,name))throw Error('이 친구에게 연결되지 않은 도구입니다. 나래 친구에게 요청하세요.');
 const original=friend;friend=definition(friend)?.kind||friend;
 if(name==='gyomu_addon_read'&&friend!=='narae'&&args.id!==original)throw Error('이 친구의 사용 안내만 읽을 수 있습니다.');
 if(name==='gyomu_skill_read'&&friend!=='narae'){
  const scopes={hangul:['hangul','hangul-jobs'],cbe:['cbe'],browser:['overview'],portal:['overview','portal','neis','edufine','wxs'],wxs:['wxs'],kakao:['overview'],gyomu:['overview'],regional:['overview']};
  if(!scopes[friend]?.includes(args.area))throw Error('이 친구의 CLI 사용 안내만 읽을 수 있습니다.');
 }
}
function sessionFor(friend,channel='local',region){if(!definitions.some(f=>f.id===friend))throw Error('친구를 찾을 수 없습니다.');const scope=schoolFriends.has(friend)&&region&&region!=='충북'?':'+region:'';return friend==='narae'?channel:createHash('sha256').update('narae-talk:'+channel+':'+friend+scope).digest('hex').slice(0,32);}
function profile(value){
 if(!value||typeof value.name!=='string'||!value.name.trim()||value.name.trim().length>60)throw Error('이름을 1~60자로 입력하세요.');
 const result={};for(const key of ['name','occupation','region']){if(value[key]!==undefined&&typeof value[key]!=='string')throw Error('프로필은 글자로 입력하세요.');result[key]=(value[key]||'').trim();if(result[key].length>100)throw Error('프로필 항목은 100자 이내로 입력하세요.');}const region=regionFor(result.region);if(region)result.region=region.region;return result;
}
class TalkStore{
 constructor(home){this.home=home;this.file=path.join(home,'data/talk-profile.json');}
 read(){try{return profile(JSON.parse(fs.readFileSync(this.file,'utf8')));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
 syncRegion(value=this.read()){const region=regionFor(value?.region),file=path.join(this.home,'data/school-profile.json');if(region&&(!fs.existsSync(file)||school.state(this.home).region!==region.region))school.configure(this.home,region.region);}
 save(value){value=profile(value);const previous=this.read();if(value.occupation&&!occupations.includes(value.occupation)&&value.occupation!==previous?.occupation)throw Error('직업을 목록에서 선택하세요.');if(value.region&&!regionFor(value.region)&&value.region!==previous?.region)throw Error('지역을 목록에서 선택하세요.');fs.mkdirSync(path.dirname(this.file),{recursive:true});const tmp=this.file+'.'+randomUUID()+'.tmp',schoolFile=path.join(this.home,'data/school-profile.json'),oldSchool=fs.existsSync(schoolFile)?fs.readFileSync(schoolFile):null;try{this.syncRegion(value);fs.writeFileSync(tmp,JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(tmp,this.file);}catch(error){if(oldSchool)fs.writeFileSync(schoolFile,oldSchool);else fs.rmSync(schoolFile,{force:true});throw error;}finally{fs.rmSync(tmp,{force:true});}return value;}
 session(friend,channel='local'){return sessionFor(friend,channel,schoolPack(this.read())?.region);}
 canonical(id){const pack=schoolPack(this.read());return id==='portal'&&pack?'portal_'+pack.id:id==='cbe'?'messenger_cbe':id==='regional'&&pack?'messenger_'+pack.id:id;}
 friends(tools,installed=[],added=[]){const pack=schoolPack(this.read());const defaults=definitions.filter(f=>!f.dynamic&&!['wxs','gyomu'].includes(f.id)&&(!f.optional||installed.includes(f.id))).filter(f=>(!schoolFriends.has(f.id)||pack&&(f.id!=='cbe'||pack.id==='cbe')&&(f.id!=='regional'||pack.id!=='cbe'))&&(['narae','kakao'].includes(f.id)||filterTools(f.id,tools).some(t=>!common(t.name)))).map(f=>({...f,toolCount:filterTools(f.id,tools).filter(t=>!common(t.name)).length,...(schoolFriends.has(f.id)?{region:pack.region,portalUrl:pack.portalUrl,neisUrl:pack.neisUrl,edufineUrl:pack.edufineUrl}:{}),...(f.id==='portal'?{name:'나래교무 포탈('+pack.region+')',description:pack.label+' · 나이스 · K-에듀파인 · WXS'}:{}),...(f.id==='cbe'||f.id==='regional'?{name:pack.messenger,icon:definition('messenger_'+pack.id).icon,description:definition('messenger_'+pack.id).description}:{})}));return [...defaults,...added.filter(id=>!defaults.some(f=>this.canonical(f.id)===id)).map(definition).filter(f=>f?.dynamic)];}
}
// A one-time local copy preserves encrypted credentials without exposing them.
// Remote connectors are intentionally not copied: only one app may poll a bot.
function migrate(officeHome,talkHome){
 const marker=path.join(talkHome,'data/office-migration.json');if(fs.existsSync(marker))return;
 fs.mkdirSync(path.dirname(marker),{recursive:true});const copied=[];
 for(const name of ['settings.json','school-profile.json','local-ai.json','gpt-key.bin','claude-key.bin','oauth-credentials.bin','browser-extension-env.bin','agent','regional-messengers']){
  const source=path.join(officeHome,'data',name),target=path.join(talkHome,'data',name);if(fs.existsSync(source)&&!fs.existsSync(target)){fs.cpSync(source,target,{recursive:true});copied.push(name);}
 }
 // Reuse the existing model files; never download or duplicate the weights here.
 const config=path.join(talkHome,'data/local-ai.json');if(!fs.existsSync(config)&&fs.existsSync(path.join(officeHome,'models')))fs.writeFileSync(config,JSON.stringify({directory:path.join(officeHome,'models'),autoStart:false}));
 fs.writeFileSync(marker,JSON.stringify({at:new Date().toISOString(),copied},null,2));
}
// Call only after the predecessor app has stopped and its Office build has been
// updated to document-only mode. The old bytes remain available for rollback.
function handover(officeHome,talkHome){
 const marker=path.join(talkHome,'data/agent-handover.json');if(fs.existsSync(marker))return;
 migrate(officeHome,talkHome);const copied=[];
 for(const name of ['telegram-bot.bin','telegram.json','kakao-device.bin','kakao-jobs.json','office-cron.json','model-reliability.json']){const source=path.join(officeHome,'data',name),target=path.join(talkHome,'data',name);if(fs.existsSync(source)&&!fs.existsSync(target)){fs.copyFileSync(source,target);copied.push(name);}}
 fs.writeFileSync(marker,JSON.stringify({at:new Date().toISOString(),copied},null,2));return {copied};
}
module.exports={TalkStore,definitions,definition,permits,filterTools,assertTool,sessionFor,profile,migrate,handover,profileOptions,schoolPack};
