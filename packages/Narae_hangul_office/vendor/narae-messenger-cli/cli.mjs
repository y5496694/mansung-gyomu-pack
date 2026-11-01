#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {profiles,runInstalled,installation} from './drivers/installed.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
export const regions=JSON.parse(fs.readFileSync(path.join(root,'regions.json'),'utf8'));
export function resolveRegion(value){const r=regions.find(r=>[r.id,r.region,r.label].includes(value));if(!r)throw Error('17개 교육청 중 --region 지역을 지정하세요.');return r;}
function native(request){return new Promise((resolve,reject)=>{const child=execFile('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(root,'uia.ps1')],{windowsHide:true,timeout:20000,maxBuffer:2*1024*1024,encoding:'utf8'},(error,stdout)=>{try{const value=JSON.parse(stdout.replace(/^\uFEFF/,''));if(error||value.error)throw Error(value.error||'UIA 조회 실패');resolve(value);}catch(e){reject(e);}});child.stdin.end(JSON.stringify(request));});}
export async function run(argv,{home=process.env.NARAE_MESSENGER_HOME||'D:/Codex/narae-data/messengers',invoke=native}={}){
 const args=[...argv],take=key=>{const index=args.indexOf(key);if(index<0)return null;const value=args[index+1];if(!value)throw Error(key+' 값이 필요합니다.');args.splice(index,2);return value;},region=resolveRegion(take('--region')||'충북');
 const operation=args.shift()||'status';
 if(operation==='regions')return {regions};
 if(operation==='cbe'){if(region.id!=='cbe')throw Error('충북 이외 지역에 CBE 세션을 재사용하지 않습니다.');await (await import('./vendor/cbe/cli.mjs')).run(args);return undefined;}
 if(operation==='status'&&region.id==='cbe'){const {Messenger}=await import('./vendor/cbe/messenger.mjs'),client=await Messenger.connect();try{return {region:region.region,adapter:'cbe',liveTested:true,result:await client.status()};}finally{client.close();}}
 if(profiles[region.id]&&['status','accounts','bind-store','notes','note','chats','chat','chat-messages','contacts'].includes(operation))return runInstalled(region,operation,args,{home});
 const directory=path.join(home,region.id);fs.mkdirSync(directory,{recursive:true});const config=path.join(directory,'binding.json'),binding=fs.existsSync(config)?JSON.parse(fs.readFileSync(config,'utf8')):null;
 if(operation==='discover')return invoke({operation:'discover'});
 if(operation==='bind'){const hwnd=take('--hwnd'),pid=Number(take('--pid'));if(args.length||!/^0x[0-9a-f]+$/i.test(hwnd||'')||!Number.isSafeInteger(pid)||pid<=0)throw Error('실제 메신저 창의 --pid PID --hwnd 0x창핸들이 필요합니다.');const observed=await invoke({operation:'inspect',pid,hwnd});if(profiles[region.id]&&(!installation(profiles[region.id],path.dirname(observed.executable)).verified||observed.sha256!==profiles[region.id].sha256))throw Error('선택 교육청의 분석한 제품과 실제 창의 설치물이 다릅니다.');const record={pid,hwnd,executable:observed.executable,sha256:observed.sha256};fs.writeFileSync(config,JSON.stringify(record,null,2));return {bound:true,region:region.region,adapter:'uia',liveTested:false,...record};}
 if(operation==='status')return {region:region.region,adapter:region.adapter,liveTested:false,bound:Boolean(binding),message:binding?'현재 바인딩은 inspect로 실행 중인 앱과 다시 대조합니다.':'해당 지역 메신저를 설치·로그인하고 실제 PID와 창을 bind해야 합니다. 충북 세션을 대신 사용하지 않습니다.'};
 if(operation==='analyze'){const target=take('--path'),output=take('--output');if(!target||!output||args.length||!path.isAbsolute(target)||!path.isAbsolute(output))throw Error('REA 분석은 실제 설치 폴더 --path와 새 근거 파일 --output의 절대 경로가 필요합니다.');return new Promise((resolve,reject)=>execFile(process.env.NARAE_REA_NODE||'D:/Codex/tools/node-v24.22.1/node.exe',[process.env.NARAE_REA_ENTRY||'D:/Codex/tools/rea-6.8.0/node_modules/rea-agents/scripts/rea.mjs','inspect-desktop-application',target,'--detail','summary','--evidence_output',output,'--json'],{windowsHide:true,timeout:120000,maxBuffer:1024*1024},(e,out)=>e?reject(Error('REA 분석 실패: '+e.code)):resolve(JSON.parse(out))));}
 if(!binding)throw Error('선택한 지역의 실제 메신저 창을 먼저 bind하세요.');
 if(profiles[region.id]&&(!installation(profiles[region.id],path.dirname(binding.executable)).verified||binding.sha256!==profiles[region.id].sha256))throw Error('UIA 연결의 지역 제품 또는 버전이 다릅니다.');
 if(operation==='inspect'){if(args.length)throw Error('inspect는 추가 인자를 받지 않습니다.');const observed=await invoke({operation:'inspect',...binding});const id=randomUUID();const snapshot={...observed,id,region:region.id};fs.writeFileSync(path.join(directory,id+'.json'),JSON.stringify(snapshot,null,2),{mode:0o600});return snapshot;}
 const id=take('--snapshot'),ref=take('--ref'),expectedTitle=take('--expect-title'),messageFile=take('--message-file'),button=take('--button');const yes=args.includes('--yes');if(yes)args.splice(args.indexOf('--yes'),1);if(args.length||!(/^[a-f0-9-]{36}$/i.test(id||'')))throw Error('직전 inspect의 --snapshot ID와 실제 --ref를 사용하세요.');
 const snapshot=JSON.parse(fs.readFileSync(path.join(directory,id+'.json'),'utf8'));if(snapshot.region!==region.id||snapshot.sha256!==binding.sha256)throw Error('메신저 지역 또는 설치 파일이 바뀌었습니다.');
 if(!['read','fill','send'].includes(operation))throw Error('regions/status/bind/inspect/read/fill/send/analyze/cbe 명령을 사용하세요.');
 if(operation!=='read'&&!yes)throw Error('명시한 변경에는 --yes가 필요합니다.');const message=messageFile?fs.readFileSync(path.resolve(messageFile),'utf8').replace(/^\uFEFF/,''):undefined;if(operation!=='read'&&(!message?.trim()||message.length>12000))throw Error('1~12000자 UTF-8 --message-file이 필요합니다.');
 const attempt=path.join(directory,id+'-'+operation+'.attempt');if(operation!=='read')fs.writeFileSync(attempt,createHash('sha256').update(message).digest('hex'),{flag:'wx'});
 return invoke({operation,...binding,snapshot,ref,button,expectedTitle,message});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))run(process.argv.slice(2)).then(value=>{if(value!==undefined)process.stdout.write(JSON.stringify(value,null,2)+'\n');}).catch(e=>{process.stdout.write(JSON.stringify({error:e.message})+'\n');process.exitCode=1;});
