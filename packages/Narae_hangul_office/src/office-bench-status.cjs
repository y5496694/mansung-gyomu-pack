'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {contract,readRun}=require('./office-benchmark.cjs');
const requirements={
 portal:'등록한 보안 문서로 업무포털에 로그인하고 나이스·K-에듀파인의 실제 업무 화면까지 확인합니다. 인증정보를 노출하지 않습니다.',
 archive:'달력 기준 6개월의 받은·보낸 쪽지와 모든 대화방 본문을 끝까지 탐색합니다. 제출 후보의 출처·기한·제출처와 변경·취소를 보존합니다.',
 search:'쪽지와 대화에서 각각 본문 내용을 검색합니다. 모든 해당 페이지를 읽고 의미·기한·제출처·변경 사항과 확인 범위를 설명합니다.',
 send:'현재 이름·소속으로 유일한 대상을 확인해 요청한 원문을 쪽지와 대화로 각각 전송합니다. 서버 기록을 확인하고 중복 전송하지 않습니다.',
 draft:'실제 기안 양식과 제목·본문·정렬·결재선·공개 범위·첨부 서버 사본을 확인합니다. 화면을 검수하고 상신 후 서버 목록에서 같은 문서를 확인합니다.',
 progress:'현재 계정이 처리할 문서만 전 페이지 확인합니다. 모든 본문·첨부를 읽고 문서별 내용·상태·현재 결재자를 설명합니다.',
 circulation:'지정 기간의 공람대기와 공람완료 두 목록을 전 페이지 확인합니다. 모든 본문·첨부를 문서별로 설명하고 미확인은 따로 표시합니다.',
 duty:'현재 권한으로 대상의 이름·소속을 확인하고 정확한 날짜로 복무를 조회합니다. 결과를 전 페이지 읽고 근거와 확인 범위를 설명합니다.',
 trip:'출장 유형·기간·시각·목적지·목적·교통·여비·현재 결재선을 확인합니다. 최종 확인창을 거쳐 상신하고 신청 목록을 재조회합니다.',
 leave:'연가와 조퇴를 각각 검증합니다. 요청한 기간·시각·사유·종류·현재 결재선을 확인하고 최종 확인창과 신청 목록까지 대조합니다.'
};
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const directory=home=>path.join(home,'data/office-bench');
function register(file,{home}){
 file=path.resolve(file);const grade=readRun(file),dir=directory(home);fs.mkdirSync(dir,{recursive:true});
 const record={file,sha256:sha(file),importedAt:new Date().toISOString()};
 fs.writeFileSync(path.join(dir,grade.environment+'.json'),JSON.stringify(record,null,2));return status({home});
}
function status({home}){
 const records={};
 for(const environment of contract.environments){
  const saved=path.join(directory(home),environment+'.json');if(!fs.existsSync(saved))continue;
  try{const record=JSON.parse(fs.readFileSync(saved,'utf8'));if(sha(record.file)!==record.sha256)throw Error('불러온 뒤 실행 기록이 변경됐습니다.');const grade=readRun(record.file);if(grade.environment!==environment)throw Error('검증 환경이 바뀌었습니다.');records[environment]={...record,grade};}catch(error){records[environment]={error:error.message};}
 }
 const tasks=contract.tasks.map(task=>({...task,requirement:requirements[task.id],...Object.fromEntries(contract.environments.map(environment=>{const result=records[environment]?.grade?.results.find(r=>r.id===task.id);return [environment,result?{status:result.passed?'passed':'incomplete',...result}:{status:'unverified'}];}))}));
 return {contract:contract.id,model:contract.model,requiredTasks:contract.requiredTasks,rule:contract.rule,releasePassed:records.live?.grade?.releasePassed===true,passedLiveTasks:tasks.filter(t=>t.live.status==='passed').length,tasks,records};
}
const tool={type:'function',name:'gyomu_office_benchmark',description:'나래오피스 필수 업무 10개와 모의·실환경 검증 상태를 읽습니다. 미검증은 통과가 아니며 학교 업무를 실행하지 않습니다.',parameters:{type:'object',properties:{},additionalProperties:false}};
function receipt(value){if(!Array.isArray(value?.tasks)||value.tasks.length!==10)return '필수 벤치 기록을 읽지 못했습니다. 전체 통과 여부는 미확인입니다.';const label=s=>({passed:'통과',incomplete:'미완료',unverified:'미검증'}[s]||'미검증');return '나래오피스 필수 업무 벤치 10개\n'+value.tasks.map(t=>t.number+'. '+t.title+' · 모의 '+label(t.synthetic?.status)+' / 실환경 '+label(t.live?.status)).join('\n')+'\n\n'+(value.releasePassed?'실환경 필수 10개 전체 합격이 확인됐습니다.':'실환경 필수 10개 전체 합격은 미확인입니다. 부분 시험·프로그램 회귀시험 수를 전체 합격으로 계산하지 않습니다.');}
module.exports={status,register,tool,receipt};
