// Deterministic reporting of a verified, single-step result. This is not model prose.
export function confirmedAnswer(request, tool, data) {
  if(tool === 'system.status' && data.components && /도구|설치|연결|상태/.test(request) &&
      !/만들|작성|수정|쪽지|대화|검색|열어|포털에/.test(request)) {
    const names={browser:'나래 브라우저',hangul:'나래 한글',cbe:'CBE CLI',portal:'나래교무포털'};
    const rows=Object.entries(data.components).map(([key,value])=>`${names[key]}: ${value.installed?'설치 확인':'실행 환경 확인 필요'}`);
    return rows.join('\n')+'\n\n포털·CBE의 실제 로그인 상태는 해당 업무를 조회할 때 확인합니다.\n작성 파일 저장 위치: '+data.outputs;
  }
  if(tool === 'hangul.create' && data.success && data.artifacts?.document && !/보내|전송|첨부해|이어서|그다음|그 다음/.test(request))
    return '문서 파일을 만들었습니다.\n'+data.artifacts.document+
      (data.modeled_content_verified?'\n나래한글 엔진에서 저장한 내용을 다시 읽어 대조했습니다.':'\n세부 서식은 파일을 열어 확인하세요.');
  if(tool === 'portal.open' && data.url && /(?:포털|포탈).*열어/.test(request) && !/이어서|조회|검색|작성|신청/.test(request))
    return '업무포털을 나래 브라우저에서 열었습니다.\n'+data.url+'\n해당 창에서 직접 로그인한 뒤 업무를 지시하세요. 로그인 완료는 아직 확인하지 않았습니다.';
  return null;
}
