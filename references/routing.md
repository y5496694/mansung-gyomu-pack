# 업무 분류 상세표

이 문서는 최상단 `SKILL.md`의 경로와 복합 요청 예시다. 설치본에서는 다른 스킬을 현재 skills 폴더의 형제 폴더에서 찾는다. 저장소에서는 다음 원본 스킬을 읽는다.

| 영역 | 저장소의 스킬 경로 |
| --- | --- |
| 이지에듀 | `packages/narae-gyomoo_ezedu/SKILL.md` |
| classtime | `packages/narae_gyomoo_classtime/SKILL.md` |
| 하이클래스 | `packages/narae_gyomoo_highclass/skills/narae-gyomu-hiclass/SKILL.md` |
| 나래 한글 오피스 (학교 문서 기본) | `packages/Narae_hangul_office/skills/narae-hangul-office/SKILL.md` |
| 독립 나래한글 CLI (사용자 지정) | `packages/narae_hangul/1_나래엔진/narae-hangul/SKILL.md` |
| CBE CLI | `packages/CBE_CLI/skills/cbe-messenger/SKILL.md` |
| 교무나래 포탈 | `packages/narae_gyomoo_portal/skills/narae-gyomu-work-portal/SKILL.md` |
| 나이스 / 에듀파인 / WXS | 위 포탈의 `skills/narae-gyomu-neis`, `skills/narae-gyomu-edufine`, `skills/wxs-cli` 각각의 `SKILL.md` |

## 요청 예시

| 요청 | 분류와 실행 |
| --- | --- |
| 오늘 일정 알려줘 / 이번 주 스케쥴 확인 | 이지에듀에서 실제 일정 조회 |
| 오늘 3학년 1반 3교시 뭐야 / 시간표 보여줘 | classtime에서 원본 재조회 |
| 오늘 행사와 3교시 수업 같이 알려줘 | 이지에듀 일정 + classtime 기본 시간표 |
| 이 한글 파일 읽어줘 / HWPX 표만 요약해줘 | 나래한글 `inspect` 실제 실행, 결과 근거로 요약 |
| 가정통신문 안내문 초안 써줘 | 하이클래스 스킬을 읽어 문안 준비, 게시하지 않음 |
| 가정통신문.hwpx 내용 읽고 학부모 공지 준비 | 나래한글로 파일 읽기 → 하이클래스로 공지 준비 |
| 가정통신문 HWPX 만들어 하이클래스에 올리기 직전까지 | 하이클래스 범위 확인 → 나래한글 파일 제작·검증 → 하이클래스 게시 직전 준비 |
| 학부모에게 연락해줘 | 하이클래스, 상대·내용·단계 확인 |
| 선생님에게 쪽지 / 대화 확인 / 교직원 연락 | CBE CLI |
| 공지사항을 김 선생님에게 쪽지로 전달 | 명시된 교직원 수신·쪽지 전달은 CBE CLI; 기존 학부모 공지를 찾는 단계가 있으면 하이클래스도 조회 |
| 공문 접수 확인 / 출장·결재 / 복무 신청 | 포탈 → 해당 하위 스킬, 지원 한계 확인 |
| 공문 첨부 HWP 읽고 기안 임시저장 | 포탈로 대상 공문 확인 → 나래한글로 첨부 파일 읽기 → 포탈/WXS로 지원되는 임시저장 |
| 기안문.hwp만 요약해줘 | 나래한글, 포탈에서 실제 기안하지 않음 |

“안내”가 팩 설치 안내를 뜻하거나 “한글”이 한국어를 뜻하는 문맥에는 학교 업무 도구를 실행하지 않는다. 이미 서비스가 명시된 요청은 그 지정과 대상·작업 단계를 함께 적용한다. 서비스가 없어서 실행할 수 없으면 설치·로그인 또는 필요한 대상 정보만 안내한다.
