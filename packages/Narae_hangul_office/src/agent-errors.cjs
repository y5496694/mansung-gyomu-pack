'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const reasons={LOCAL_CONTEXT_LIMIT:'현재 화면과 대화가 모델이 한 번에 읽을 수 있는 범위를 넘었습니다. 필요한 메뉴만 조회하거나 새 대화에서 이어서 요청하세요.',LOCAL_AI_TIMEOUT:'로컬 AI 응답 시간이 초과되었습니다. 마지막 확인 화면에서 이어서 요청하세요.',LOCAL_AI_HTTP:'로컬 AI 서버가 요청을 처리하지 못했습니다. AI 연결 상태를 확인하세요.',LOCAL_REPEATED_ACTION:'같은 작업이 반복되어 중지했습니다. 마지막 확인 화면에서 이어서 요청하세요.',LOCAL_TOKENIZER:'로컬 모델의 문맥 크기를 확인하지 못했습니다.',LOCAL_RESPONSE_FORMAT:'로컬 AI의 작업 응답을 해석하지 못했습니다. 마지막 확인 화면에서 다시 요청하세요.',AGENT_FAILED:'요청을 완료하지 못했습니다. 마지막 확인 화면과 도구 오류를 확인하세요.'};
function failure(home,error,config={}){
 const code=Object.hasOwn(reasons,error.code)?error.code:/JSON|길이 한도|도구 선택/.test(error.message||'')?'LOCAL_RESPONSE_FORMAT':'AGENT_FAILED',id=randomUUID();
 // Diagnostics deliberately exclude prompts, page contents, arguments and server bodies.
 try{const dir=path.join(home,'logs');fs.mkdirSync(dir,{recursive:true});fs.appendFileSync(path.join(dir,'agent-errors.jsonl'),JSON.stringify({at:new Date().toISOString(),id,code,provider:config.provider,model:config.model})+'\n');}catch{}
 return reasons[code]+' 이미 실행한 변경은 유지됩니다.\n오류 코드: '+code+' · 기록: '+id;
}
module.exports={failure};
