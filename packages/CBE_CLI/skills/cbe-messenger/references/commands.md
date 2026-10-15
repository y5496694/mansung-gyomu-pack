# 명령과 운영 세부 사항

스킬 폴더의 `scripts/cli.mjs`를 Node로 호출한다. 아래 예제의 `$cbeEntry`는 그 파일의 절대 경로다. ID와 검색어·본문은 사용자 요청 및 조회 결과로 치환한다. 예제 자체는 메시지 전송 권한을 제공하지 않는다.

## 쪽지

```powershell
node $cbeEntry notes list --box received --limit 20 --json
node $cbeEntry notes list --box sent --page 2 --limit 20 --json
node $cbeEntry notes list --search '검색어' --search-type title --json
node $cbeEntry notes read NOTE_ID --type R --json
node $cbeEntry notes read NOTE_ID --type S --reserved --json
node $cbeEntry notes send --to USER_ID --title '제목' --text '사용자가 요청한 본문' --json
node $cbeEntry notes send --to USER_ID1,USER_ID2 --text '사용자가 요청한 본문' --dry-run --json
```

- `--box`: `all`, `received`, `sent`, `unread`, `important`, `self`, `reserved`。
- `--search-type`: `send`(보낸 사람, 기본값), `receive`(받는 사람), `title`, `content`。
- 본문 조회는 `text`, 첨부파일 메타데이터는 `files`에 반환한다. 파일 다운로드는 구현하지 않았다.
- 쪽지의 후속 페이지는 **첫 페이지 첫 행의 날짜**를 기준으로 한다. `--page 2`부터 `--offset`이 없으면 CLI가 첫 페이지를 조회해 기준값을 구한다. 동일 시점으로 페이지를 조회하려면 첫 페이지 JSON의 `offset`을 이후 호출에 넘기고 같은 `--limit`·검색 조건을 유지한다.

```powershell
$first = node $cbeEntry notes list --limit 20 --json | ConvertFrom-Json
node $cbeEntry notes list --page 2 --limit 20 --offset $first.offset --json
```

## 대화와 사용자

```powershell
node $cbeEntry chats list --search '이름 또는 방 이름' --limit 30 --json
node $cbeEntry chats list --box unread --json
node $cbeEntry chats read ROOM_ID --page 2 --limit 30 --json
node $cbeEntry users search '이름' --page 1 --limit 100 --json
node $cbeEntry users search '이름' --scope all --limit 100 --json
node $cbeEntry users search '이름' --scope my --json
node $cbeEntry users show USER_ID --json
node $cbeEntry memos list --json
```

- 대화방 `--box`: `all`, `unread`, `important`。
- 대화 메시지는 최신 순으로 반환한다. `items[].id`는 메시지 ID이고 최상위 `id`는 대화방 ID다.
- 앱과 같은 `contentsLength:500` 요청을 사용하므로 긴 메시지가 서버에서 잘릴 수 있다. 필요한 부분의 조회 한계를 알리고, 사용자 허락 없이 대화창을 띄워 보완하지 않는다.
- 이름 검색의 `--scope` 기본값은 `auto`다. `/pc/common/pageInitInfo`의 `WITH_USER_LIST`로 현재 계정의 내 조직 이름을 먼저 찾고, 일치 결과가 0명일 때만 전체 조직 검색을 수행한다. 전체 후보는 한 사람으로 임의 축약하지 않고 나열한다. `--scope all`은 바로 전체 조직, `--scope my`는 내 조직에서만 검색한다. 내 조직 조회가 실패하면 오류로 중단하며 전체 검색으로 조용히 바꾸지 않는다.
- 결과의 `scope`는 `my` 또는 `all`, `requestedScope`는 요청 범위, `fallback:true`는 자동으로 전체 검색으로 전환한 경우다. 내 조직 페이지가 비어도 전체 내 조직 일치 건수가 있으면 범위를 전환하지 않는다.
- 프로필은 일부 결과에서 학교 이름 없이 최하위 부서만 반환하므로 동명이인 구분에는 검색 결과의 전체 `department`를 우선한다. 내 조직 검색은 이름·소속 중심의 목록을 사용하므로 추가 직책·업무 정보가 필요하면 `users show`로 확인한다.
- 메모는 빈 목록 응답만 실사용으로 검증했다. 실제 메모가 있는 경우의 표시는 검증되지 않았다.

## 전송과 결과 확인

```powershell
node $cbeEntry chats send --to USER_ID --text '사용자가 요청한 본문' --json
node $cbeEntry chats create --to USER_ID1,USER_ID2 --title '업무 협의' --text '첫 메시지' --json
node $cbeEntry chats create --to USER_ID1,USER_ID2 --text '첫 메시지' --dry-run --json
node $cbeEntry notes send --to USER_ID --title '제목' --text '사용자가 요청한 본문' --json
```

`chats send`는 기존 1:1 방을 사용하며 없으면 첫 메시지와 함께 새 방을 만든다. `chats create`는 한 명이면 같은 규칙, 두 명 이상이면 새 그룹을 생성한다. `--to`에 본인을 포함하지 않는다. 첫 메시지는 필수이며 빈 방 생성·1:1 중복 생성은 지원하지 않는다. 그룹에만 `--title`을 지정할 수 있다. 생성 명령을 반복하면 새 그룹이 만들어지므로 결과가 불확실할 때 재실행하지 않는다.

앱의 `realtimeConect_view.sendMessageChat`를 한 번 호출하고 서버의 방 ID·유형·참여자 전체, 메시지 ID·발신자·원문을 검증한다. 정상 결과에는 `sent`, `verified`, `recipients`, `created`, `room`, `messageId`, `date`, `text`, `background`가 있다. `verified:true`는 서버 저장 기록과 일치했다는 뜻이다. 상대방 읽음은 확인하지 않는다. 비밀번호·쿠키·키는 저장하지 않는다.

`notes send`는 일반 텍스트 쪽지를 보낸다. 수신자 여러 명은 쉼표로 구분한다. 제목 미지정 시 첫 줄 앞 100자를 사용한다. 제목 100자·본문 10,000자까지 지원하며 CRLF·NBSP를 정규화한다. 첨부·예약·보안 전송은 미지원이다. 본인에게 보낼 때는 본인 ID만 지정한다. 앱 권한·금칙어·최대 수신자·서버의 실제 수신자 ID 목록을 확인한다. 추가 수신자 확인이 필요한 경우 `--dry-run`의 `requiresConfirmation:true`를 보고, 사용자 지시가 전체 대상·본문을 승인한 범위에서 `--confirm-many`를 사용한다.

쪽지는 쓰기 요청의 자동 재시도를 제거한 뒤 한 번 제출하고, 별도 상세·전체 수신자 조회로 ID·발신자·제목·본문·수신자를 검증한다. 결과에는 `noteId`가 있다. 실제 전송 후 확인 실패는 stderr JSON에 `sent:null`, `verified:false`, `retry:false`와 ID를 남긴다.

오류에 ID가 있거나 전송 실행 중 연결이 끊겼으면 결과가 불확실할 수 있다. 같은 명령을 자동 재실행하지 말고 `chats read ROOM_ID --json` 또는 `notes read NOTE_ID --type S --json`으로 확인한다. 불확실성을 알리고, 조회 범위가 부족하면 페이지를 더 확인한다. `--dry-run`은 전송·새 방 생성을 하지 않으며 `sent:false`다.

0.4.0의 새 방·쪽지 기능은 앱 코드 분석, 모의 전송, 실제 앱의 설정·권한·사전 점검과 검증용 기존 기록 조회를 확인했다. 실제 새 방 생성·쪽지 발송의 전체 과정은 아직 실사용 검증하지 않았다.

## GUI를 명시적으로 요청받았을 때

```powershell
node $cbeEntry open main --json
node $cbeEntry open note NOTE_ID --type R --json
node $cbeEntry open chat ROOM_ID --json
node $cbeEntry open profile USER_ID --json
node $cbeEntry compose --to USER_ID --json
```

이 명령들은 창을 연다. `compose`는 수신자를 지정한 쪽지 작성창만 열고 전송하지 않는다. `open main`과 `compose`는 실제 동작을 확인했고, 나머지 `open`은 앱 함수를 연결한 상태로 개별 명령의 창 열기는 실사용 검증하지 않았다.

## 연결·출력·검증

- Node.js 22.19 이상, Windows, 실행·로그인된 충북소통메신저가 필요하다.
- 기본 디버깅 주소 `127.0.0.1:9000`에서 **해당 앱의 메인 페이지**만 선택한다. 다른 포트를 실제로 확인했다면 `--port N`을 지정할 수 있다.
- `--page` 기본 1, `--limit` 기본 30·최대 100. `total:null`을 0으로 해석하지 않는다.
- `--json`은 stdout, 오류는 stderr와 종료코드 1. 성공 응답이 없으면 명령 성공을 추정하지 않는다.
- 앱 업데이트로 내부 함수·응답 형식이 바뀔 수 있다. 현재 지원되는 명령은 `--help`로 확인하고, 복구를 위해 역분석을 다시 해야 할 때는 사용자 작업 범위에 맞춰 별도 조사한다.
- 전체 기록·전체 검색 결과라는 요청은 반환된 건수와 페이지 범위를 확인한 후 보고한다.

점검은 전송 없이 수행한다:

```powershell
node $cbeEntry --help
node $cbeEntry status --json
node --test '스킬폴더\scripts\test.mjs'
```

동봉 테스트는 메신저 연결·전송을 모의 처리한다. 로컬 CLI 진입점, 대상 선택, 페이지 처리, 보안 쪽지 표시, 내 조직 우선 검색, 새 방·초대 패킷, 수신자 불일치 차단, 한 번 전송 후 서버 기록 검증, 쪽지 HTTP 오류 시 자동 재시도 차단, dry-run과 앱 전송 제한을 검사한다. 현재 버전은 30개 테스트를 포함한다.
