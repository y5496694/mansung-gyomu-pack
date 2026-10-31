'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{isDeepStrictEqual}=require('node:util');
// Every variant and check is mandatory. A fixture pass never becomes a live
// deployment pass. Evidence stays local; the distributable contains no account.
const tasks=[
 ['portal','보안 문서 로그인·나이스·에듀파인 진입',['both-systems'],['profile_safe','portal_authenticated','neis_screen','edufine_screen','no_secret_in_log']],
 ['archive','6개월 쪽지·대화 제출 후보 목록',['notes-and-chats'],['calendar_month_range','notes_all_pages','all_rooms_and_messages','bodies_read','source_ids_dates_senders','changes_and_cancellations','submission_candidates','coverage_complete']],
 ['search','특정 내용 탐색·설명',['note','chat'],['body_query','all_matching_pages','source_evidence','meaning_deadline_destination','changes_preserved','scope_disclosed']],
 ['send','특정 대상 쪽지·대화 전송',['note','chat'],['current_unique_recipient','requested_content','authorized_send','server_verified','no_duplicate']],
 ['draft','서식 준수 기안 상신',['template-submit'],['observed_template','body_fields_layout','visual_review','title_body_exact','route_and_disclosure','server_attachments','final_process','server_list_verified','no_duplicate']],
 ['progress','내가 처리 중인 문서 확인·설명',['assigned-to-me'],['current_account_scope','all_pages','all_bodies_attachments','status_approver','source_explanation']],
 ['circulation','공람 문서 모두 읽고 설명',['waiting-and-completed'],['explicit_period','both_folders','all_pages_counts','all_bodies','all_attachments','per_document_explanation','unconfirmed_not_complete']],
 ['duty','다른 사람 특정 날짜 복무 조회',['other-person-date'],['current_permission','unique_person_organization','exact_date_query','all_result_pages','source_result_explanation']],
 ['trip','나이스 출장 상신',['domestic-trip'],['exact_dates_times','destination_purpose','trip_type_transport_expenses','current_approval_route','final_confirmation','server_list_verified','no_duplicate']],
 ['leave','나이스 연가·조퇴 상신',['annual','early'],['exact_dates_times_reason','correct_leave_type','current_approval_route','final_confirmation','server_list_verified','no_duplicate']]
].map(([id,title,variants,checks],index)=>({number:index+1,id,title,variants,checks}));
const contract={schema:1,id:'narae-office-basic-10-v1',model:'narae4',requiredTasks:10,rule:'모든 과제의 모든 변형·검사를 통과해야 합격. 미지원·미검증·부분 성공·누락은 불합격.',environments:['synthetic','live'],releaseGate:'live',tasks};
function pointer(value,ptr){if(typeof ptr!=='string'||!ptr.startsWith('/'))throw new Error('증거 JSON Pointer가 필요합니다.');for(const part of ptr.slice(1).split('/').map(p=>p.replaceAll('~1','/').replaceAll('~0','~'))){if(value===null||typeof value!=='object'||!Object.hasOwn(value,part))throw new Error('증거 위치가 없습니다.');value=value[part];}return value;}
function grade(run,{base=process.cwd()}={}){
 if(run?.schema!==1||run.contract!==contract.id||!['synthetic','live'].includes(run.environment)||!Array.isArray(run.cases))throw new Error('벤치 계약·실행 환경·cases를 확인하세요.');
 const results=tasks.map(task=>{
  const variants=task.variants.map(variant=>{
   const found=run.cases.filter(c=>c.task===task.id&&c.variant===variant),record=found.length===1?found[0]:null;
   const checks=task.checks.map(id=>{
    const check=record?.checks?.[id];if(check?.passed!==true||!Array.isArray(check.evidence)||!check.evidence.length)return {id,passed:false,reason:check?.reason||'검증된 증거 없음'};
    try{for(const proof of check.evidence){const file=path.resolve(base,proof.file),bytes=fs.readFileSync(file);if(crypto.createHash('sha256').update(bytes).digest('hex')!==proof.sha256)throw new Error('증거 해시 불일치');const value=JSON.parse(bytes.toString('utf8'));if(!Object.hasOwn(proof,'expected')||!isDeepStrictEqual(pointer(value,proof.pointer),proof.expected))throw new Error('증거 원문 값 불일치');}return {id,passed:true};}catch(e){return {id,passed:false,reason:e.message};}
   });return {variant,passed:checks.every(c=>c.passed),checks};
  });return {number:task.number,id:task.id,title:task.title,passed:variants.every(v=>v.passed),variants};
 });
 return {schema:1,contract:contract.id,environment:run.environment,passed:results.every(t=>t.passed),releasePassed:run.environment==='live'&&results.every(t=>t.passed),passedTasks:results.filter(t=>t.passed).length,totalTasks:10,rule:contract.rule,results};
}
function readRun(file){file=path.resolve(file);return grade(JSON.parse(fs.readFileSync(file,'utf8')),{base:path.dirname(file)});}
module.exports={contract,grade,readRun,pointer};
