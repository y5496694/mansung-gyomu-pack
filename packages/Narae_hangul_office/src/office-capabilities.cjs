'use strict';
const tools=[{type:'function',name:'gyomu_cron',description:'이 PC 나래오피스의 예약 작업 목록과 최근 실행 상태를 읽는다. 예약을 생성하거나 실행하지 않는다.',parameters:{type:'object',properties:{operation:{enum:['list']}},required:['operation'],additionalProperties:false}},{type:'function',name:'gyomu_school_settings',description:'저장된 교육청 지역과 업무포털 기본 주소를 읽는다. 인증정보는 반환하지 않는다.',parameters:{type:'object',properties:{operation:{enum:['status']}},required:['operation'],additionalProperties:false}}];
function execute(name,{home}){return name==='gyomu_cron'?new (require('./office-cron.cjs').OfficeCron)({home}).summary():require('./school-region.cjs').state(home);}
module.exports={tools,execute};
