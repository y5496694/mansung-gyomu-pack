# 실제 업무 흐름

## 업무포털

`skill.read {"area":"portal"}` → `portal.open {}` → 사용자 직접 로그인 → `browser snapshot/tabs/frames`로 실제 도착 시스템·학교 확인 → 해당 neis/edufine 절차를 읽고 현재 ref로 업무를 진행한다. 참조문서가 필요하면 `skill.read`의 document에 해당 스킬 안의 `references/이름.md`를 지정한다. 로그인 상태를 제목이나 URL만 보고 단정하지 않는다.

원본 브라우저 엔진 위에 iframe 선택·필터/페이지 관찰·입력값/체크 상태 확인을 보강했다. 직접 JS·셸 실행 도구는 없다. 초안·조회 요청은 미상신으로 끝낸다. 명시적인 최종 상신·결재 요청은 문서·결재선을 확인하고 confirmFinalAction:true, expectedDocument, expectedLabel, expectedUrl, expectedState(최신 snapshot.finalState)로 한 번 실행한다. 정확히 관찰한 확인창 문구만 수락하며 불명확하면 반복하지 않는다. 인증서·보안 프로그램·WXS Client는 사용자 PC에 정상 설치되어 있어야 한다.

메뉴 트리·탭·메뉴 항목·표 셀도 snapshot의 실제 ref로 선택한다. `expanded`가 확인된 treeitem은 `expand` 또는 `collapse`에 현재 ref를 전달해 펼치거나 접는다. 메뉴가 바뀌면 새 snapshot에서 하위 항목을 찾는다. 메뉴의 `결재`와 문서의 최종 결재 버튼을 구분하며 최종 처리 확인 절차는 그대로 따른다.

접근성 역할이 없는 트리 요소도 인식하며 각 ref의 `id`·`classes`를 확인할 수 있다. 기본 관찰 목록에서 빠진 요소는 `read`로 확인한 CSS `selector`를 `snapshot`에 전달해 관찰한 뒤 현재 ref를 사용한다. 선택자는 CSS 조회만 수행하며 페이지 JavaScript나 앱 내부 함수를 실행하지 않는다. 최종 처리 버튼의 승인 확인은 선택자 관찰에도 동일하게 적용된다.

문서 회수를 명시적으로 요청받으면 문서진행의 한 행을 선택하고 snapshot.selectedDocuments의 실제 문서 ID·제목을 대조한다. 회수 클릭에는 기존 최종 처리 확인 인자와 expectedDocumentId가 모두 필요하다. 첫 확인창은 취소해 문구를 관찰하고, 취소가 확인된 경우만 정확한 confirmationText로 이어간다. 처리 결과는 서버 목록에서 다시 조회하며 결과 불명 상태를 재시도하지 않는다.

## 문서

독립 파일은 첨부 → `hangul.inspect` → 문단·표와 예외·기한을 확인 → 요약 또는 새 출력의 편집/작성 → 실제 엔진의 success·artifacts·저장 검증을 확인한다. 긴 원문은 offset으로 더 읽는다. 모델에 전달되는 일부 결과가 전부라는 뜻은 아니다. 고급 표·그림 편집의 지원 범위와 한컴 COM 필요 여부는 원본 jobs/hancom 문서를 확인한다.

현재 편집기의 형식 간 변환은 지원하지 않는다. 뷰어에는 독립 조판 차이가 남아 있어 서식·쪽수·픽셀 정확성이 중요한 문서는 원본 도구의 검증 절차를 따른다.

## CBE

사용자 검색 → 소속·직책 구분 → 실제 ID 확정 → 원문/첨부 준비 → 미리보기 → 사용자 적용 → sent/verified 확인. 목록 한 페이지만 읽고 전체라고 하지 않는다. 전송 접수 후 확인 실패는 중복 전송으로 해결하지 않는다. 메신저 창은 조회·전송을 위해 임의로 앞으로 띄우지 않는다.

## WXS

`wxs windows` → 대상 HWND·제목 확인 → inspect/text/attachments → 원본 설정 JSON으로 `wxs.prepare` → 사용자 적용 → 다시 draft-status 확인. 임시저장은 `wxs.save`에서 확인한 이름으로 준비·적용한다. 임시저장을 상신·발송으로 보고하지 않는다.

초안의 실제 결재자·과제카드 후보는 `wxs.options`에 현재 `hwnd`, `expected_title`, `section:approval|task|disclosure`를 전달해 확인한다. `query`와 `offset`·`limit`으로 후보를 끝까지 확인한다. 같은 선택창은 반환된 `dialog_hwnd`로 재사용하며, 결재 후보 조회 후 `close:true`로 변경 없는 기안자 단독 선택창만 닫고 작성 계획을 준비한다. 후보 조회는 결재자를 추가하거나 저장하지 않는다.
