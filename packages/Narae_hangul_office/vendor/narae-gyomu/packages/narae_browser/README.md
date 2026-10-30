# 나래 브라우저 · Narae Browser

**로컬 소형 모델과 나래 시리즈 도구가 함께 사용하는 독립형 브라우저 컨트롤 CLI.**

Chrome/Edge를 실제로 조작하고, 페이지를 짧은 JSON으로 읽습니다. Hermes·특정 AI 제공자·브라우저 확장에 종속되지 않습니다. CLI만 쓰면 모델도 필요 없습니다.

## 설치

필수: **Node.js 20 이상**, 설치된 **Chrome 또는 Edge**. Linux/macOS에서는 실행 파일을 자동으로 찾지 못하면 `NARAE_BROWSER_EXECUTABLE`로 지정합니다.

```bash
git clone https://github.com/y5496694/narae_browser.git
cd narae_browser
npm ci
npm link
narae-browser doctor
```

전역 링크가 싫으면 `node bin/narae-browser.mjs ...`로 실행해도 됩니다. Windows에서는 저장소의 `narae-browser.cmd`도 쓸 수 있습니다. npm에는 별도 게시하지 않으며 GitHub 소스를 설치합니다.

## 브라우저를 직접 제어하기

```bash
narae-browser open https://news.naver.com/section/105 --session work
narae-browser snapshot --session work --limit 35 --chars 1200
narae-browser read --session work --chars 3000
narae-browser screenshot artifacts/news.png --session work
narae-browser close --session work
```

반환되는 `elements`의 **실제 ref**를 다음 명령에 넣습니다. 아래 `s3/e7`은 형식 예시이며 그대로 사용하면 안 됩니다.

```bash
narae-browser click s3/e7 --session work
narae-browser fill s6/e2 "검색어" --session work
narae-browser press Enter --session work
```

- `open`, `click`, `back`, `snapshot`은 페이지 상태와 ref 목록을 돌려줍니다.
- **새 snapshot·이동·입력 뒤에는 이전 ref를 폐기**합니다. 만료된 ref는 `STALE_REF` 오류이며 다른 요소를 대신 누르지 않습니다.
- `fill`, `select`, `press`, `scroll`, `wait`, `tabs`, `tab`도 지원합니다. 전체 계약은 `narae-browser schema`로 확인합니다.
- `read --selector '#dic_area' --chars 5000 --offset 0`처럼 본문 범위를 지정할 수 있습니다.
- 지정한 본문 선택자가 없으면 `SELECTOR_NOT_FOUND` 오류를 반환합니다. 빈 본문을 성공으로 처리하지 않으며, `serve`에서도 해당 줄에 `ok:false`를 반환합니다.
- `--headed`는 **새 세션을 시작할 때** 브라우저 창을 띄웁니다. 기존 headless 세션은 먼저 `close`해야 합니다.
- ref는 축약 DOM 관찰 결과입니다. 완전한 접근성 트리·화면 픽셀 인식이나 캔버스 내부 객체 인식은 아닙니다.

## 이미 열린 Chrome 연결

전용 창을 새로 여는 대신 사용 중인 Chrome/Edge의 탭과 로그인 상태를 이어 쓸 수 있습니다. `narae-browser extension`이 안내하는 공식 Playwright 확장을 한 번 설치한 뒤 실행합니다.

```powershell
narae-browser attach --session work
# 확장 연결 화면에서 제어할 기존 웹 탭 선택
narae-browser snapshot --session work
narae-browser tabs --session work
narae-browser tab 0 --session work
narae-browser close --session work
```

`close`와 유휴 종료는 연결만 해제하며 사용자 Chrome·탭·로그인 상태를 닫거나 삭제하지 않습니다. 기존 탭 선택이 취소되거나 확장이 없으면 오류를 반환하며 별도 창으로 자동 전환하지 않습니다. Edge는 `--browser msedge`, 특정 프로필은 `--profile "Profile 1"`로 지정합니다. 다른 방식으로 실행 중인 같은 세션은 먼저 `close`합니다.

확장에서 제공한 연결 토큰은 `PLAYWRIGHT_MCP_EXTENSION_TOKEN` 환경 변수로 재사용합니다. Windows에서는 다음처럼 사용자 환경 변수에 한 번 저장할 수 있습니다. 입력한 값은 화면에 표시되지 않습니다.

```powershell
$extensionCredential = Read-Host "Playwright 확장 토큰" -AsSecureString
[Environment]::SetEnvironmentVariable('PLAYWRIGHT_MCP_EXTENSION_TOKEN', [System.Net.NetworkCredential]::new('', $extensionCredential).Password, 'User')
narae-browser doctor
narae-browser attach --session work
```

프로세스 환경 변수를 우선 사용하고, Windows에서 값이 없으면 저장된 사용자 환경 변수를 읽으므로 이미 실행 중인 호출 앱에서도 사용할 수 있습니다. `doctor`의 `extensionTokenConfigured`는 설정 여부만 표시합니다. 토큰은 저장소·명령 인자·세션 JSON에 넣지 않습니다. 토큰을 지우려면 `[Environment]::SetEnvironmentVariable('PLAYWRIGHT_MCP_EXTENSION_TOKEN', $null, 'User')`를 실행합니다.

나래가 연 연결 안내 탭은 첫 `open` 요청의 작업 탭으로 재사용합니다. 연결 대기 중에는 이전 사용자 탭으로 돌아가며, `close`는 작업 웹 탭을 보존하고 남은 나래 연결 안내 탭만 닫습니다. 끊어진 나래 연결의 안내 탭도 다음 연결 때 정리합니다. 다른 클라이언트의 연결·승인 대기와 일반 작업 탭은 보존합니다. Chrome과 공식 확장이 최초 연결 화면을 잠깐 여는 동작은 남습니다.

토큰으로 연결한 확장 작업 공간에 처음에는 탭이 없을 수 있습니다. 이때 `attach`는 빈 탭 목록으로 연결을 유지합니다. `open URL --session work`를 실행하면 기존 Chrome 프로필에 탭을 열어 그 프로필의 로그인 상태를 이어 씁니다.

이미 디버깅 연결을 허용한 로컬 브라우저에는 `attach --connection cdp --cdp-endpoint http://127.0.0.1:9222 --session work`도 지원합니다. 이 명령은 Chrome을 재실행하거나 일반 프로필의 디버깅 설정을 바꾸지 않습니다. 기본 뉴스·읽기 전용 agent 실행은 전용 세션을 유지합니다.

## 확인창·팝업이 있는 업무

`dialog`, `frames`·`frame`, `check`·`uncheck`·`hover`를 지원합니다. `snapshot`은 `--selector`, `--filter`, `--offset`으로 관찰 범위를 좁힐 수 있습니다. [확인창·팝업·프레임 실행 절차](docs/dialogs-and-portal.md)에 기존 Chrome 재연결, 문서 회수·의견작성 팝업, Nexacro 메뉴와 정확한 확인창 처리 예제가 있습니다.

클릭 결과가 `actionPending:true`이면 클릭을 반복하지 않고 `dialog`의 실제 ID와 원문을 지정해 같은 확인창을 처리합니다. 연결 설정은 같은 세션의 `connection.json`에 보관하며 유휴 종료 뒤에도 기존 Chrome 방식을 유지합니다. 토큰·쿠키·인증 URL은 이 설정에 보관하지 않습니다. 열린 확인창은 유휴 종료하지 않으며, 완료 여부는 실제 서버 목록으로 확인합니다.

## 테스트 목표: 네이버 뉴스 3개 요약

로컬 Ollama가 실행 중인 환경에서:

```bash
ollama pull qwen3:0.6b
narae-browser news --count 3 --provider ollama --model qwen3:0.6b --output artifacts/news.json --evidence-dir artifacts/evidence
```

실제 작업 순서:

1. Chrome에서 네이버 IT/과학 뉴스 목록을 엽니다.
2. 목록에 노출된 **서로 다른 기사 URL 3개**를 고릅니다. 네이버 전체 최신 순위라는 의미는 아닙니다.
3. 각 기사를 열어 실제 본문과 제목·언론사·게시 시간을 읽습니다.
4. 모델이 핵심 문장 번호를 고릅니다. 실행기가 번호와 중복 여부를 검증하고 **원문 문장을 직접 가져와 발췌 요약**을 만듭니다.
5. 출처 URL, 근거 구절, 읽은 본문 길이와 SHA-256, 실제 모델 호출 토큰 수를 JSON으로 남깁니다.
6. 작업 세션은 종료합니다. `--evidence-dir`를 지정했을 때만 읽은 본문을 로컬 파일로 보관합니다.

**0.6B 기본 모드는 자유 서술형 요약이 아닙니다.** 작은 모델이 없는 날짜나 인용문을 만드는 일을 줄이려고 문장 선택에만 추론을 씁니다. 선택 문장 자체가 원문에 있는지는 보장하지만, 선택 품질이나 원래 기사의 사실성까지 보장하지는 않습니다. 더 큰 모델로 직접 문장을 쓰게 하려면 `--summary-mode abstractive`를 명시합니다. 이 모드도 인용 구절이 실제 본문에 있는지 검증하나, 요약의 모든 의미를 자동 검증하는 것은 아닙니다.

모델 없이 수집 경로만 확인할 때는 `news --count 3 --extractive`를 사용합니다. 이때는 본문 앞부분을 돌려주고 `mode: source-excerpt`, `model: null`로 표시합니다. AI 요약으로 표시하지 않습니다.

분야는 `--section`으로 지정합니다: 정치 `100`, 경제 `101`, 사회 `102`, 생활/문화 `103`, 세계 `104`, IT/과학 `105`.

## 작은 모델이 직접 명령을 고르는 agent (실험적)

**현재 PC의 0.6B 자유 자율 탐색은 완료 검증을 통과하지 못했습니다.** 초기 시험은 `AGENT_STEP_LIMIT`으로 실패했고, 후속 시험은 RAM 부족으로 중단했습니다. 아래는 실행법 예시일 뿐이며, 검증된 뉴스 수집 기능으로 쓸 때는 위의 `news` 명령을 사용하세요. 안정된 외부 로컬 추론 서버가 있다면 명시적으로 연결해 별도 검증할 수 있습니다.

```bash
narae-browser agent "https://news.naver.com/section/105 를 열고 실제 본문을 읽어 주요 제목을 설명해 줘" --hosts news.naver.com,n.news.naver.com --provider ollama --model qwen3:0.6b --max-steps 12 --output artifacts/agent.json
```

모델은 `open → read/click/snapshot → finish` 중 다음 명령을 JSON으로 선택합니다. 함수 호출 전용으로 학습된 모델일 필요는 없습니다. Ollama에는 JSON Schema를 전달하고 4,096 컨텍스트·thinking 비활성화·짧은 출력을 사용합니다. 컨텍스트에는 최근 관찰과 짧은 읽기 메모만 남깁니다.

- 허용 호스트를 **반드시** 지정합니다. 모델은 폼 입력·키 입력·파일 쓰기·임의 JS·셸 실행을 할 수 없습니다.
- 실제 `read` 성공 전에는 완료를 받지 않습니다. 단계 한도를 넘기면 실패와 실행 trace를 반환합니다.
- 임의 목표를 스스로 수행하는 기능은 모델 능력에 크게 좌우됩니다. `news`의 고정 수집 절차와 **자율 탐색 성공을 구분**합니다. `news` 결과의 `autonomousNavigation`은 `false`입니다.
- `agent` 최종 답변의 의미 정확성은 자동 보장하지 않습니다. `sourceNotes`·trace·출처를 확인하세요.

### 다른 로컬 추론 서버

```bash
narae-browser news --count 3 --provider openai --base-url http://127.0.0.1:8080/v1 --model YOUR_MODEL
```

OpenAI 호환 서버는 Chat Completions와 JSON Schema 응답을 지원해야 합니다. Ollama native와 달리 해당 서버의 컨텍스트·추론 옵션은 서버 설정을 따릅니다. llama.cpp/LM Studio 같은 로컬 API를 연결하는 어댑터를 제공하지만, 실제 서버별 동작은 별도 확인해야 합니다. 외부 API로 자동 우회하지 않습니다.

응답에 모델 ID가 있으면 두 provider 모두 요청한 ID와 대조하고, 다르면 `MODEL_IDENTITY`로 중단합니다. API의 모델 ID 확인과 실제 가중치·LoRA 파일 확인은 별도입니다. 학습 어댑터는 추론 서버에서 로드하고 파일 해시와 활성 어댑터를 확인해야 합니다.

환경 변수: `NARAE_MODEL_PROVIDER`, `NARAE_MODEL_BASE_URL`, `NARAE_MODEL`, 필요하면 `NARAE_MODEL_API_KEY`. API 키는 CLI 인자로 받지 않습니다. 모델이 로컬인지 여부는 **사용자가 지정한 endpoint**에 달려 있습니다.

## 나래 도구·외부 에이전트 연결

모델이 만든 JSON을 그대로 실행할 수 있습니다.

```bash
narae-browser run examples/read-page.json --session job
```

단일 명령은 `run -`의 표준입력으로, 여러 명령은 `{ "steps": [...] }` 또는 배열로 전달합니다. 실패한 배치는 이전에 수행한 명령을 되돌리지 않으며 오류의 `details.completed`를 확인해야 합니다. **변경 명령이 섞인 배치를 통째로 자동 재실행하지 마세요.**

프로세스 하나를 유지하는 JSONL 모드:

```bash
narae-browser serve --session model
```

표준입력 한 줄에 `{"action":"open","url":"https://example.com"}` 같은 JSON 명령을 보내면, 표준출력 한 줄에 JSON 결과가 옵니다. 함수 호출 API가 없는 모델도 이 계약을 사용할 수 있습니다. 기본 성공 형식은 `{"ok":true,"data":...}`, 실패는 `{"ok":false,"error":{"code":"...","message":"..."}}`입니다. 단일 명령 실패의 종료 코드는 1이고, `serve`는 줄별 오류를 반환하면서 계속 실행합니다.

`SKILL.md`를 모델의 도구 설명으로 읽히고 `narae-browser schema` 계약과 함께 사용하세요. 일반 `run/serve`는 **호출자가 신뢰된 CLI 직접 조작 모드**입니다. 모델에게 무제한 전달하는 대신 `agent`의 허용 명령/호스트 경계를 적용해야 합니다.

## 세션·보안 범위

- 브라우저는 별도 프로세스와 격리된 익명 컨텍스트입니다. 평소 Chrome 프로필·비밀번호·로그인을 가져오지 않습니다.
- CLI 호출 간 브라우저 상태는 유지하되, `close`나 5분 유휴 종료 후에는 쿠키·탭을 디스크에서 복원하지 않습니다.
- daemon은 `127.0.0.1`의 임의 포트만 사용합니다. 무작위 bearer token, JSON 요청, Origin 차단, 요청 크기 제한과 직렬 실행을 적용합니다. 인터넷에 브라우저 제어 포트를 공개하지 않습니다.
- 기본 상태 경로는 `~/.narae-browser/`이며 `NARAE_BROWSER_HOME`으로 바꿀 수 있습니다. **토큰 파일과 상태 폴더는 공개·커밋하지 마세요.** Windows는 사용자 폴더 ACL, POSIX는 사용자 전용 모드를 사용합니다.
- 같은 OS 사용자로 악성 코드를 실행할 수 있는 상대까지 방어하는 샌드박스는 아닙니다. 에이전트 호스트 제한도 사이트 자체의 부작용·프롬프트 인젝션을 완전히 막는 보장은 아닙니다. 읽기 전용은 허용 명령과 이동 요청에 대한 제한입니다.
- CAPTCHA 우회·브라우저 보안 해제·임의 `eval`은 제공하지 않습니다. 로그인·결제·삭제 작업은 별도 승인·안전 설계 없이 자동화하지 마세요.
- 보관한 원문·스크린샷에는 개인정보나 저작물이 포함될 수 있습니다. 필요한 범위만 저장하고 사이트 이용 조건과 접근 제한을 준수하세요.

## 개발·검증

```bash
npm test
npm run test:e2e
npm run format:check
npm pack --dry-run
```

단위 테스트는 실제 모델의 성능 검증이 아닙니다. 모델 어댑터 단위 테스트는 명시적인 로컬 fixture 응답을 사용합니다. E2E는 실제 Chrome과 로컬 테스트 페이지에서 별도 CLI 프로세스 간 입력·클릭·복원·참조 만료·인증·호스트 제한·스크린샷을 확인합니다. 네이버와 로컬 모델을 사용하는 운영 스모크는 `news` 명령으로 별도 실행하며, 네이버 페이지 변경/차단과 모델 미기동은 그대로 실패로 보고합니다.

MIT License.
