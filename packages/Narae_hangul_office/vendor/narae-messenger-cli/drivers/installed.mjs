import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {accounts,openStore,verifyOwner,queryStore,families} from './local-store.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
export const profiles=JSON.parse(fs.readFileSync(path.join(root,'profiles.json'),'utf8'));
export function installation(profile,directory){
  const installDir=path.resolve(directory||'D:/Codex/apps/regional-messengers/'+profile.installDirectory);
  const executable=path.join(installDir,profile.executable),config=path.join(installDir,profile.config.file);
  if(!fs.existsSync(executable)||!fs.existsSync(config))return {installed:false,verified:false,installDir,reason:'제품별 설치 파일 또는 설정 파일이 없습니다.'};
  const sha256=createHash('sha256').update(fs.readFileSync(executable)).digest('hex');
  const text=new TextDecoder(profile.config.encoding).decode(fs.readFileSync(config));
  const line=text.split(/\r?\n/).find(line=>line.trim().startsWith(profile.config.key+'='));
  const configuredProduct=line?.slice(line.indexOf('=')+1).trim();
  const verified=configuredProduct===profile.config.value&&sha256===profile.sha256;
  return {installed:true,verified,installDir,executable,sha256,configuredProduct,reason:verified?null:'지역 제품 설정 또는 실행 파일이 분석한 버전과 다릅니다. 재분석이 필요합니다.'};
}
export function runInstalled(region,operation,args,{home}={}){
  const profile=profiles[region.id];if(!profile)throw Error('이 제품 전용 드라이버가 없습니다.');
  args=[...args];const take=key=>{const i=args.indexOf(key);if(i<0)return undefined;const value=args[i+1];if(value===undefined||value.startsWith('--'))throw Error(key+' 값이 필요합니다.');args.splice(i,2);return value;};
  const observed=installation(profile,take('--install-dir'));
  const directory=path.join(home,region.id);fs.mkdirSync(directory,{recursive:true});const bindingFile=path.join(directory,'stores.json');
  const saved=fs.existsSync(bindingFile)?JSON.parse(fs.readFileSync(bindingFile,'utf8')):{region:region.id,stores:{}};
  if(saved.region!==region.id)throw Error('다른 교육청의 저장소 연결은 사용하지 않습니다.');
  const kind=take('--kind')||'notes';
  if(operation==='status'){
    if(args.length)throw Error('status 인자를 확인하세요.');
    return {region:region.region,adapter:profile.family,...observed,liveTested:false,authenticated:null,localKinds:Object.keys(families[profile.family].stores),boundKinds:Object.keys(saved.stores),sendVerified:false,limitations:families[profile.family].limitations};
  }
  if(!observed.verified)throw Error(observed.reason);
  const database=take('--database'),owner=take('--owner');
  if(operation==='accounts'){
    if(!database||args.length)throw Error('accounts --database 실제DB --kind notes/chats/contacts를 사용하세요.');
    return {region:region.region,kind,source:'local-cache',accounts:accounts(path.resolve(database),profile.family,kind)};
  }
  if(operation==='bind-store'){
    if(!database||!owner||args.length)throw Error('bind-store --kind 종류 --database 실제DB --owner 실제계정이 필요합니다.');
    const store=openStore(path.resolve(database),profile.family,kind);
    try{verifyOwner(store,owner);saved.stores[kind]={database:store.real,owner,executableSha256:observed.sha256,regionAttribution:'explicit-database-selection',boundAt:new Date().toISOString()};}finally{store.close();}
    const temporary=bindingFile+'.tmp';fs.writeFileSync(temporary,JSON.stringify(saved,null,2),{mode:0o600});fs.renameSync(temporary,bindingFile);
    return {bound:true,region:region.region,kind,owner,authenticated:null,source:'local-cache'};
  }
  const query=take('--query')||'',id=take('--id'),roomId=take('--room-id'),limit=Number(take('--limit')||30),offset=Number(take('--offset')||0);
  if(args.length||!['notes','note','chats','chat','chat-messages','contacts'].includes(operation))throw Error('status/accounts/bind-store/notes/note/chats/chat/chat-messages/contacts 명령을 사용하세요.');
  if(database||owner)throw Error('조회는 먼저 연결한 저장소·계정만 사용합니다. bind-store로 명시하여 연결하세요.');
  const actualKind=({notes:'notes',note:'notes',chats:'chats',chat:'chats','chat-messages':'chatMessages',contacts:'contacts'})[operation];
  if(['note','chat'].includes(operation)&&!id)throw Error('단일 기록에는 정확한 --id가 필요합니다.');
  const binding=saved.stores[actualKind];if(!binding)throw Error(actualKind+' 저장소를 bind-store로 연결하세요. 실제 비충북 계정 캐시는 아직 확인되지 않았습니다.');
  if(binding.executableSha256!==observed.sha256)throw Error('연결 후 설치 버전이 변경됐습니다.');
  return {region:region.region,...queryStore(binding.database,profile.family,actualKind,{owner:binding.owner,query,id,roomId,limit,offset})};
}
