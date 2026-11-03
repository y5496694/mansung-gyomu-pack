'use strict';
// The portal repository owns the verified local DPAPI credential path.
const shared=require('../vendor/narae-gyomu/packages/narae_gyomoo_portal/skills/narae-gyomu-work-portal/scripts/portal-login.cjs');
const tool=structuredClone(shared.tool);tool.parameters.properties.operation.enum.push('ensure');tool.description+=' ensure는 포탈 친구의 업무 실행 전 로그인·요청 시스템을 확인하고 검증한 업무 창으로 연결한다. 보안 문서가 없으면 열린 창에서 직접 로그인을 요청한다.';
module.exports={...shared,tool};
