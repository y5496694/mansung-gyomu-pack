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
- 본문 조회는 `text`, 첨부파일 ID·이름·크기·유효기간은 `files`에 반환한다. 아래 다운로드 명령으로 저장한다.
- 쪽지의 후속 페이지는 **첫 페이지 첫 행의 날짜**를 기준으로 한다. `--page 2`부터 `--offset`이 없으면 CLI가 첫 페이지를 조회해 기준값을 구한다. 동일 시점으로 페이지를 조회하려면 첫 페이지 JSON의 `offset`을 이후 호출에 넘기고 같은 `--limit`·검색 조건을 유지한다.

```powershell
$first = node $cbeEntry notes list --limit 20 --json | ConvertFrom-Json
node $cbeEntry notes list --page 2 --limit 20 --offset $first.offset --json
```

## 쪽지 첨부 다운로드

```powershell
node $cbeEntry notes download NOTE_ID --out-dir 'D:\Codex\downloads\cbe\작업폴더' --json
node $cbeEntry notes download NOTE_ID --attachment ATTACHMENT_ID --out-dir 'D:\Codex\downloads\cbe\작업폴더' --json
node $cbeEntry notes download NOTE_ID --type S --reserved --out-dir 'D:\Codex\downloads\cbe\작업폴더' --json
```

`ATTACHMENT_ID`는 `notes read`의 `files[].id`다. 생략 시 첨부 전체를 저장하며 `--out-dir`은 필수다. 현재 쪽지 첨부만 지원한다. `--file`은 업로드용 옵션이므로 다운로드에는 사용하지 않는다.

- 앱 안에서 다운로드 권한(P07)을 확인하고 인증된 GET을 수행한다. 자격증명이나 파일 서버 인증 URL은 결과에 포함하지 않는다.
- 유효기간 만료·삭제·보안·회수 첨부를 거절한다. 창을 열거나 받은 파일을 실행하지 않는다.
- 파일별 최대 256MiB, 기존 파일 덮어쓰기 금지. 중복된 원본 이름은 첨부 ID별로 다른 디렉터리에 받는다.
- `downloaded:true`, `verified:true`는 HTTP 응답·크기·수신 바이트와 저장 파일의 SHA-256 대조 성공을 뜻한다. 원격 서명 검증은 아니다.
- 일부 실패는 `partial:true`, `files`에 이미 저장한 목록, `retry:false`를 반환한다. 같은 폴더에 전체 다운로드를 반복하지 않고 미저장 첨부만 선택하거나 다른 폴더를 사용한다.
- 0.6.0은 총 55개 모의 테스트와 실제 쪽지 HWP·HWPX·XLSX 다운로드를 검증했다.

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

`chats send`는 기존 1:1 방을 사용하며 없으면 첫 메시지와 함께 새 방을 만든다. `chats create`는 한 명이면 같은 규칙, 두 명 이상이면 새 그룹을 생성한다. `--to`에 본인을 포함하지 않는다. 본문 또는 첨부파일은 필수이며 빈 방 생성·1:1 중복 생성은 지원하지 않는다. 그룹에만 `--title`을 지정할 수 있다. 생성 명령을 반복하면 새 그룹이 만들어지므로 결과가 불확실할 때 재실행하지 않는다.

앱의 `realtimeConect_view.sendMessageChat`를 한 번 호출하고 서버의 방 ID·유형·참여자 전체, 메시지 ID·발신자·원문을 검증한다. 정상 결과에는 `sent`, `verified`, `recipients`, `created`, `room`, `messageId`, `date`, `text`, `background`가 있다. `verified:true`는 서버 저장 기록과 일치했다는 뜻이다. 상대방 읽음은 확인하지 않는다. 비밀번호·쿠키·키는 저장하지 않는다.

`notes send`는 일반 텍스트 쪽지를 보낸다. 수신자 여러 명은 쉼표로 구분한다. 제목 미지정 시 첫 줄 앞 100자를 사용한다. 제목 100자·본문 10,000자까지 지원하며 CRLF·NBSP를 정규화한다. 첨부는 `--file "경로"`로 지정하며 여러 파일은 옵션을 반복한다. 본문 생략 시 파일만 보낼 수 있다. 예약·보안 전송은 미지원이다. 본인에게 보낼 때는 본인 ID만 지정한다. 앱 권한·금칙어·최대 수신자·서버의 실제 수신자 ID 목록을 확인한다. 추가 수신자 확인이 필요한 경우 `--dry-run`의 `requiresConfirmation:true`를 보고, 사용자 지시가 전체 대상·본문을 승인한 범위에서 `--confirm-many`를 사용한다.

쪽지는 쓰기 요청의 자동 재시도를 제거한 뒤 한 번 제출하고, 별도 상세·전체 수신자 조회로 ID·발신자·제목·본문·수신자를 검증한다. 결과에는 `noteId`가 있다. 실제 전송 후 확인 실패는 stderr JSON에 `sent:null`, `verified:false`, `retry:false`와 ID를 남긴다.

오류에 ID가 있거나 전송 실행 중 연결이 끊겼으면 결과가 불확실할 수 있다. 같은 명령을 자동 재실행하지 말고 `chats read ROOM_ID --json` 또는 `notes read NOTE_ID --type S --json`으로 확인한다. 불확실성을 알리고, 조회 범위가 부족하면 페이지를 더 확인한다. `--dry-run`은 전송·새 방 생성을 하지 않으며 `sent:false`다.

0.4.0의 새 방·쪽지 기능은 앱 코드 분석, 모의 전송, 실제 앱의 설정·권한·사전 점검과 검증용 기존 기록 조회를 확인했다. 실제 새 방 생성·쪽지 발송의 전체 과정은 아직 실사용 검증하지 않았다.

## 첨부파일

반복 가능한 `--file`로 로컬 파일을 지정합니다. 경로의 공백·한글·쉼표는 그대로 지원하며 파일 목록을 쉼표로 합치지 않습니다.

```powershell
cbe notes send --to "사용자ID" --title "회의 자료" --text "자료 확인 부탁드립니다." --file "C:\자료\회의 안내.pdf" --file "C:\자료\참석 명단.xlsx" --json
cbe chats send --to "사용자ID" --file "C:\자료\회의 안내.pdf" --json
cbe chats create --to "사용자ID1,사용자ID2" --title "자료방" --file "C:\자료\회의 안내.pdf" --json
cbe notes send --to "사용자ID" --file "C:\자료\회의 안내.pdf" --dry-run --json
```

본문 없이 파일만 보낼 수 있습니다. 쪽지는 앱의 기본 동작처럼 본문을 `내용없음`으로 채우고, 제목 생략 시 첫 파일명을 사용합니다. 대화는 본문이 있으면 본문 메시지 다음에 파일마다 별도 파일 메시지를 보냅니다. 새 그룹은 초대 메시지와 파일 메시지를 분리합니다.

앱의 첨부 권한(P04), 개수(P05), 파일별 MB 한도(P06), 확장자 제한(C19), 기존 방의 권한을 확인합니다. 폴더·존재하지 않는 파일·중복 경로·점검 후 변경된 파일은 차단합니다. `--dry-run`은 파일 접근과 제한을 점검하며 업로드 인증 발급·업로드·메시지 제출을 하지 않습니다.

쪽지는 파일을 모두 업로드한 뒤 한 번 제출합니다. 대화 파일마다 업로드 인증 ID를 파일 메시지 ID와 연결합니다. 서버에서 수신자, 파일명과 바이트 크기를 확인해야 성공합니다. JSON의 `files`에 첨부 목록을, 대화의 `messageIds`에 확인된 메시지 ID들을 반환합니다.

여러 파일 중 실패하면 자동 재전송하지 않습니다. 대화 오류의 `partial:true`, `messageIds`, `files`는 이미 확인된 전송, `pendingFile`은 실패 또는 확인 중인 파일입니다. 쪽지 업로드 중 실패하면 `sent:false`, `stage:upload`로 반환하고 쪽지를 제출하지 않습니다. 먼저 업로드된 파일은 서버에 남을 수 있습니다. 쪽지를 제출한 뒤 오류가 나면 `sent:null`로 처리합니다. 전체 명령을 다시 실행하기 전에 반환된 ID로 기록을 확인하세요.

0.5.0은 45개 모의 테스트와 실앱 권한·제한·업로드 인증·쪽지/대화 dry-run까지 확인했다. 실제 파일 업로드·메시지 발송의 전체 과정은 실사용 검증하지 않았다.

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

동봉 테스트는 메신저 연결·전송을 모의 처리한다. 로컬 CLI 진입점, 대상 선택, 페이지 처리, 보안 쪽지 표시, 내 조직 우선 검색, 새 방·초대 패킷, 수신자 불일치 차단, 한 번 전송 후 서버 기록 검증, 쪽지 HTTP 오류 시 자동 재시도 차단, dry-run과 앱 전송 제한을 검사한다. 현재 버전은 45개 테스트를 포함하며 첨부 바이트 보존·다중 파일·부분 실패·방별 권한도 검사한다.
