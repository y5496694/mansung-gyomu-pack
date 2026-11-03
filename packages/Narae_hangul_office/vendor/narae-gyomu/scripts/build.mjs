import fs from 'node:fs';
import path from 'node:path';
import {APP,readJSON} from '../src/paths.mjs';
const out=path.resolve(process.argv[2] || path.join(APP,'dist/NaraeGyomu-0.1.0-win-x64'));
if(fs.existsSync(out))throw new Error('Existing build preserved. Choose a new output folder: '+out);
fs.mkdirSync(out,{recursive:true});
const electron=path.join(APP,'node_modules/electron/dist');
if(!fs.existsSync(path.join(electron,'electron.exe')))throw new Error('Run node node_modules/electron/install.js first.');
fs.cpSync(electron,out,{recursive:true});
fs.renameSync(path.join(out,'electron.exe'),path.join(out,'NaraeGyomu.exe'));
fs.unlinkSync(path.join(out,'resources/default_app.asar'));
const core=path.join(out,'resources/app');fs.mkdirSync(core,{recursive:true});
for(const name of ['src','web','bin','desktop','packages','skills','licenses','docs','verification'])
  if(fs.existsSync(path.join(APP,name)))fs.cpSync(path.join(APP,name),path.join(core,name),{recursive:true});
for(const name of ['package.json','sources.lock.json','SKILL.md','README.md','LICENSE','THIRD_PARTY_NOTICES.md'])
  if(fs.existsSync(path.join(APP,name)))fs.copyFileSync(path.join(APP,name),path.join(core,name));
fs.mkdirSync(path.join(core,'node_modules'),{recursive:true});
fs.cpSync(path.join(APP,'node_modules/playwright-core'),path.join(core,'node_modules/playwright-core'),{recursive:true});
for(const name of ['models','runtime'])fs.cpSync(path.join(APP,name),path.join(out,name),{recursive:true});
fs.copyFileSync(path.join(APP,'runtime.json'),path.join(out,'runtime.json'));
// Runtime DLLs distributed in the PySide wheel accompany the native model executable.
const vc=path.join(APP,'runtime/python/Lib/site-packages/PySide6');
for(const name of ['msvcp140.dll','msvcp140_1.dll','msvcp140_2.dll','vcruntime140.dll','vcruntime140_1.dll','concrt140.dll'])
  if(fs.existsSync(path.join(vc,name)))fs.copyFileSync(path.join(vc,name),path.join(out,'runtime/llama',name));
const cli='@echo off\r\nsetlocal\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"%~dp0NaraeGyomu.exe" "%~dp0resources\\app\\bin\\narae-gyomu.mjs" %*\r\n';
fs.writeFileSync(path.join(out,'narae-gyomu.cmd'),cli);
fs.writeFileSync(path.join(out,'나래교무 시작.cmd'),'@echo off\r\nstart "" "%~dp0NaraeGyomu.exe"\r\n');
fs.copyFileSync(path.join(APP,'scripts/install.ps1'),path.join(out,'install.ps1'));
for(const name of ['README.md','THIRD_PARTY_NOTICES.md'])if(fs.existsSync(path.join(APP,name)))fs.copyFileSync(path.join(APP,name),path.join(out,name));
fs.writeFileSync(path.join(out,'나래교무_시작안내.txt'),[
  '나래교무 0.1.0 · 로컬 미리보기','',
  '1. NaraeGyomu.exe 또는 나래교무 시작.cmd를 실행합니다.',
  '2. 나래1 / 나래2 / 나래3 중 하나를 활성화합니다. 모델 가중치가 이 팩 안에 있습니다.',
  '3. 대화창에서 명령하거나 + 버튼으로 업무 파일을 선택합니다.',
  '4. 포털은 별도로 열린 브라우저에서, CBE는 기존 앱에서 본인이 로그인합니다.',
  '5. HWP/HWPX 작성 결과는 화면의 작성 파일에서 확인합니다.',
  'CLI 등록과 외부 AI용 스킬 설치: PowerShell에서 .\\install.ps1',
  'CLI 바로 사용: .\\narae-gyomu.cmd doctor',
  '',
  '나래2(EXAONE)는 연구·평가용 이용조건을 따릅니다. 상세 조건은 licenses/models에 있습니다.',
  '모의 벤치 성능은 낮으며 복잡한 업무를 자동 완수한다고 보장하지 않습니다.',
  '자료·대화·출력·캐시 기본 위치: D:\\Codex\\narae-gyomu-data',
  '상신·결재는 명시적 요청과 현재 문서·결재선 검증 후 처리합니다. 공문 실제 발송은 지원하지 않습니다.',
].join('\r\n'),'utf8');
console.log(JSON.stringify({built:out,models:readJSON(path.join(out,'models/catalog.json')).models.map(m=>m.id)}));
