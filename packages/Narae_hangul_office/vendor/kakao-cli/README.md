# kakao-cli 0.6.0

Windows 10/11의 실행 중인 PC 카카오톡을 로컬 CLI로 조회하고 메시지와 첨부파일을 처리합니다. `read`, `messages`, `search`, `send`, `download`는 기본적으로 백그라운드에서 동작합니다. 별도 [macOS 전용 버전](macos/README.md)도 포함하며, 실제 macOS 카카오톡에서는 아직 검증하지 않았습니다.

Linux/Ubuntu 서버에서는 [linux/](linux/README.md)의 자체 실행형을 사용합니다. 서버 내부의 전용 Wine 환경과 Xvfb 가상 화면에서 카카오톡 자체를 실행하므로 외부 Windows PC와 SSH가 필요하지 않습니다. Windows 카카오톡을 Wine으로 실행하는 호환 방식이며, 최초 계정 인증과 해당 Wine 버전의 호환성 확인이 필요합니다.

**Ubuntu 24.04.5/WSL2에서 Wine 11과 네이티브 Visual C++ 런타임을 적용해 카카오톡 26.9.0.5337의 실제 초기 약관 화면 구동을 확인했습니다. 최초 계정 로그인·모바일 인증은 사용자가 진행해야 하며, 로그인 후 대화 조회·전송은 아직 실검증 전입니다.**

이 버전은 [morluto/rea](https://github.com/morluto/rea) 6.8.0과 Frida로 Windows 카카오톡 **26.9.0.5337 / x64**를 분석·검증했습니다. 내부 컨트롤과 API에 의존하므로 다른 카카오톡 버전에서 같은 동작을 보장하지 않습니다. [분석 근거와 검증 범위](ANALYSIS.md)를 확인하세요. 카카오와 제휴된 프로젝트가 아닙니다.

## 설치

Windows에서는 Python 3.10 이상, 로그인된 PC 카카오톡, REA 6.8.0의 Frida 런타임이 필요합니다.

```powershell
git clone https://github.com/y5496694/kakao-cli.git
cd kakao-cli
Set-ExecutionPolicy -Scope Process Bypass
./install.ps1
./.venv/Scripts/python.exe -m pip install -e '.[analysis]'
```

REA 런타임이 별도로 설치되어 있다면 아래 환경변수로 실행 파일을 지정합니다. 경로는 각 설치 위치에 맞게 바꾸세요.

```powershell
$env:KAKAOCLI_REA_NODE = (Get-Command node).Source
$env:KAKAOCLI_REA_ENTRY = (Resolve-Path './tools/rea/node_modules/rea-agents/scripts/rea.mjs').Path
./kakaocli.cmd doctor --json
```

`KAKAOCLI_REA_ENTRY`는 설치한 `rea-agents`의 `scripts/rea.mjs` 경로입니다. REA 자체는 [공식 저장소](https://github.com/morluto/rea)의 설치 방법을 따르세요. 백그라운드 런타임이 없으면 작업을 실패로 반환합니다.

이미지 검증·캡처에는 Pillow, PDF 텍스트·미리보기에는 pypdf와 PyMuPDF, XLSX 추출에는 openpyxl을 사용합니다. Windows OCR은 설치된 Windows 언어 인식기를 사용하며 새 모델이나 언어팩을 다운로드하지 않습니다.

## 대화 조회와 메시지 전송

```powershell
./kakaocli.cmd rooms --json
./kakaocli.cmd open '예시 채팅방' --exact --json
./kakaocli.cmd messages '예시 채팅방' --exact --limit 30 --json
./kakaocli.cmd search '예시 채팅방' '회의' --exact --json
./kakaocli.cmd send '예시 채팅방' --message-file './message.txt' --dry-run --json
# 사용자가 지정한 상대와 문안으로 실제 전송
./kakaocli.cmd send '예시 채팅방' --message-file './message.txt' --yes --json
```

닫힌 방은 카카오톡의 채팅 목록 검색으로 찾습니다. 검색 결과를 창 캡처와 로컬 Windows OCR로 읽고, 요청과 일치하는 표시 제목을 **한 개로 확인한 경우에만** 해당 결과를 엽니다. 열린 창의 실제 제목이 그 표시 제목과 완전히 같은지 다시 검사합니다. 짧은 이름이 더 긴 표시 이름에 포함된 경우에도 이 과정을 거치며, 후보가 여러 개이거나 OCR·창 제목 검증이 실패하면 임의로 전송하지 않습니다. 사용 전 방이 이미 독립 창으로 열려 있어야 하는 것은 아닙니다.

검색과 방 열기는 카카오톡 내부 상태를 바꿀 수 있지만, 기본 동작은 현재 작업 중인 앱의 포커스나 최상단 창을 바꾸지 않도록 구현했습니다. 전역 키보드·마우스 입력 대신 해당 카카오톡 프로세스의 컨트롤 메시지와 일시적인 가상 입력 상태를 사용하고, 작업 후 Frida 연결과 후킹을 해제합니다. 지원되는 결과에는 `background`와 `foreground_unchanged`가 포함됩니다.

- `read`, `messages`, `search`는 현재 UI에 로드된 대화만 읽습니다. `coverage=loaded_ui_only`, `complete_history=false`이며 전체 과거 기록 검색을 뜻하지 않습니다.
- 백그라운드 대화 복사도 Windows 클립보드를 변경합니다. 다른 앱이 동시에 클립보드를 바꾸면 읽기를 중단합니다.
- `--message-file`과 `--stdin`은 UTF-8 다중행 문안을 받습니다. 기존 초안을 덮어쓰지 않고 입력한 내용을 다시 읽어 확인합니다.
- `--dry-run`은 메시지를 입력하거나 제출하지 않습니다. 비대화형 실제 전송에는 `--yes`가 필요합니다.
- `submitted_unconfirmed`는 카카오톡 입력란에 대한 제출을 확인했다는 뜻입니다. 서버 전달이나 상대방 수신을 확정하지 않습니다. 불명확한 실패나 타임아웃 뒤에는 자동으로 재전송하지 마세요.
- 같은 이름의 대상이 여러 개이거나 저장 모달창이 작업을 막으면 먼저 해당 상태를 해결해야 합니다.
- `--json`은 하위 명령 앞뒤에 사용할 수 있습니다.

## 사진과 파일 보내기 (Windows)

```powershell
./kakaocli.cmd send-image '확인된 방 제목' './photo.png' --dry-run --json
./kakaocli.cmd send-image '확인된 방 제목' './photo.png' --yes --json
./kakaocli.cmd send-file '확인된 방 제목' './document.pdf' --dry-run --json
./kakaocli.cmd send-file '확인된 방 제목' './document.pdf' --yes --json
```

한 번에 로컬 사진 한 장 또는 파일 한 개를 보냅니다. `--dry-run`은 대상·파일·SHA256만 확인하며 클립보드나 첨부 미리보기를 바꾸지 않습니다. 실제 전송에는 기존 `send`와 같은 확인 절차와 `--yes`를 적용합니다.

사진은 `CF_DIB` 클립보드와 대상 입력창의 Ctrl+V 처리로 미리보기를 엽니다. 사진 전송은 클립보드를 변경합니다. 파일은 확인된 파일 첨부 버튼과 `GetOpenFileNameW` 경로 반환을 사용하므로 파일 선택창을 띄우지 않습니다. 카카오톡의 전송 미리보기는 화면 밖에서 확인하며 전경 창을 유지합니다.

전송 전에 소유 프로세스·대화방·새 미리보기·제목·버튼과 원본 해시를 확인합니다. 파일은 표시된 파일 이름도 대조합니다. 기존 메시지 초안을 바꾸지 않으며, 확인 실패 시 이번 작업의 미리보기만 닫습니다. `submitted_unconfirmed`는 전송 버튼과 미리보기 닫힘을 관찰한 결과입니다. 서버 전달·상대 수신 확인이 아니며, 오류·타임아웃 뒤에는 대화를 읽어 상태를 확인한 후 판단해야 합니다.

현재 검증 대상은 Windows 카카오톡 26.9.0.5337/x64입니다. 파일 첨부 버튼은 96 DPI 배율에서 지원하며 다른 배율은 거부합니다. 파일 이름이 잘리거나 OCR로 정확히 확인되지 않으면 전송하지 않습니다. `send-image`는 정지 이미지에 사용하고 애니메이션 원본은 `send-file`로 지정합니다. macOS/Linux 어댑터에는 이 명령을 추가하지 않았습니다.

## 사진과 파일 받기

`attachments`는 로드된 대화에서 사진·파일 표시를 찾습니다. `capture`는 대상 창을 `PrintWindow`로 캡처하며 현재 화면의 전경 창을 바꾸지 않습니다. 캡처는 첨부 원본 파일과 구분되는 화면 이미지입니다.

```powershell
./kakaocli.cmd attachments '예시 채팅방' --limit 20 --json
./kakaocli.cmd capture '예시 채팅방' --output './work/chat.png' --json

# 캡처에서 확인한 사진 썸네일 좌표를 사용
./kakaocli.cmd download '예시 채팅방' --at 180 240 --kind image --output-dir './downloads' --json

# 파일은 첨부의 '저장' 버튼 좌표를 사용
./kakaocli.cmd download '예시 채팅방' --at 260 340 --kind file --output-dir './downloads' --json

# 해당 방의 사진 뷰어가 이미 열려 있는 경우
./kakaocli.cmd download '예시 채팅방' --viewer --output-dir './downloads' --json

# 이전 작업에서 이미 열린, 해당 방 소유의 저장창부터 완료
./kakaocli.cmd download '예시 채팅방' --dialog --output-dir './downloads' --json
```

`--at X Y`는 `capture`로 만든 **대상 방 창 이미지의 왼쪽 위 기준 픽셀 좌표**입니다. 위 좌표는 문법 예시이며 실제 캡처에서 항목을 확인해 지정해야 합니다. 파일의 제목이나 본문이 아니라 해당 첨부의 저장 버튼을 지정합니다. 좌표가 대화 영역을 벗어나면 거부합니다.

기본 다운로드는 카카오톡이 `GetSaveFileNameW`를 호출하는 지점에서 지정한 로컬 경로를 반환합니다. **새 저장 모달창을 열지 않으며**, 카카오톡 자체가 그 경로에 첨부 원본을 저장합니다. 검증한 Windows 버전에서 사진 원본 저장과 전경 창 유지를 실제로 확인했습니다. 화면 캡처를 원본 사진이라고 대신 저장하지 않습니다.

기존 저장창이 남아 있으면 소유 프로세스·대화방과 입력란·저장 버튼을 확인해 먼저 처리합니다. 동일한 파일 이름은 덮어쓰지 않습니다. `saved=true`를 반환하기 전에 파일 생성·크기 안정화와 SHA256을 확인하며, 완료를 확인하지 못하면 오류를 반환합니다. 만료되거나 다운로드할 수 없는 첨부, 지원하지 않는 저장 경로에서는 실패할 수 있습니다.

저장 위치를 생략하면 CLI 데이터 폴더 아래의 새 다운로드 폴더를 사용합니다. `KAKAOCLI_DATA_DIR`로 데이터 위치를 지정하거나 `--output-dir`로 작업별 폴더를 선택할 수 있습니다. 개인 대화·캡처·첨부는 GitHub에 업로드하지 않습니다.

## 받은 첨부 분석

```powershell
./kakaocli.cmd analyze './downloads/photo.jpg' --json
./kakaocli.cmd analyze './downloads/document.pdf' --output-dir './work/pdf-review' --max-chars 20000 --json
```

| 형식 | 반환 내용 | 범위 |
| --- | --- | --- |
| PNG/JPEG/GIF/WebP 등 | 파일 검증·크기·프레임 수·이미지 절대경로 | 실제 사진 해석은 어시스턴트가 이미지를 열어 수행 |
| PDF | 추출 텍스트·페이지 수, 요청 시 첫 3쪽 PNG | 텍스트는 최대 200쪽; 스캔본은 이미지 검토 필요 |
| TXT/CSV/JSON 등 | UTF-8·BOM UTF-16·CP949 텍스트 | 지정한 문자 수까지 추출 |
| DOCX/HWPX | 문서 XML의 텍스트 | 원래 시각 배치와 내부 그림은 분석하지 않음 |
| XLSX | 시트·셀·저장된 수식 | 수식 실행·재계산, 차트·내부 그림 추출 없음 |

`analyze`는 절대경로, MIME, 용량, SHA256, 추출 범위(`coverage`), 잘림(`truncated`), 부분 성공·오류 정보를 제공합니다. 이미지 경로와 PDF 미리보기는 어시스턴트가 직접 확인할 수 있습니다. 지원하지 않는 형식은 `unsupported`로 반환하며 바이너리를 임의로 글자로 변환하지 않습니다. 매크로·첨부 코드 실행, 외부 링크 가져오기, 클라우드 업로드는 하지 않습니다. 이 명령 자체가 사진 의미 해석이나 OCR을 수행했다고 보고하지 않습니다.

## macOS 전용 버전

[macos/README.md](macos/README.md)에 별도 설치·사용법이 있습니다. `macos/kakao`는 Python과 JXA/System Events의 Accessibility를 사용하며 Win32 코드나 Windows DB 복호화 기능에 의존하지 않습니다.

기본 동작에서 앱 활성화·최상단 전환·전역 키 입력을 요청하지 않습니다. 이미 열린 방의 AX 텍스트와 첨부 표시를 읽고, 고유한 입력란과 Send 버튼이 있는 경우에만 명시적 `--yes`로 제출합니다. 이미 열린 카카오톡 소유 저장창 처리와 공통 로컬 첨부 분석도 제공합니다.

**macOS 버전은 모의 AX 단위 테스트와 소스 검사만 수행했습니다. 실제 Mac의 권한과 카카오톡 AX 구조는 미검증입니다.** Windows의 닫힌 방 OCR 검색이나 `GetSaveFileNameW` 저장 방식을 macOS에서도 지원한다고 주장하지 않습니다. 손쉬운 사용·System Events 자동화 권한은 사용자가 직접 허용해야 합니다.

## Ubuntu 서버 자체 실행

Ubuntu의 자체 Wine 버전 설치·로그인·서비스 관리는 [linux/README.md](linux/README.md)를 따릅니다.

```bash
bash linux/install.sh --install-system
kakao-local runtime start
kakao-local runtime screenshot --output "$HOME/kakao-login.png"
kakao-local messages '확인된 방 제목' --limit 30 --json
```

카카오톡 설치와 최초 모바일 인증이 필요합니다. 서버의 전용 Xvfb 화면에서 저장 모달창을 처리하며, 첨부 원본은 같은 Ubuntu 서버에 저장합니다. 계정 로그인·전송의 실환경 검증 범위는 `ANALYSIS.md`에 기록합니다.

## 로컬 DB 기능

기반 프로젝트의 DB·키 관련 명령도 유지합니다. 일반 대화 조회·전송·첨부 저장에는 DB 키 복구가 필요하지 않습니다.

```powershell
./kakaocli.cmd key-status --json
./kakaocli.cmd recover-key --json
./kakaocli.cmd friends --contains '예시' --json
./kakaocli.cmd chat-rooms --contains '예시' --json
./kakaocli.cmd export-room-contacts '예시 채팅방' --exact --output './contacts.csv' --json
./kakaocli.cmd db-schema --json
```

`friends`와 `chat-rooms`는 메타데이터 조회이며 메시지 본문 전체를 읽는 기능이 아닙니다. 복구한 키는 Windows DPAPI로 보호하고 원문을 출력하지 않습니다. DB별 키가 다를 수 있으며 모든 DB의 복호화를 보장하지 않습니다. 연락처 CSV·DB·복구 키·개인 진단 자료는 공개 저장소에 포함하지 마세요.

## REA 분석과 검증

```powershell
./scripts/rea-kakao.ps1
./scripts/rea-kakao.ps1 -Runtime
./.venv/Scripts/python.exe -m pytest tests macos/tests linux/tests -q
./scripts/verify.ps1
```

`rea-kakao.ps1 -Runtime`은 컨트롤 클래스·ID와 정해진 프로그램 문자열을 관찰하고 연결을 해제하는 재현 스크립트입니다. 기본 백그라운드 CLI가 사용하는 일시적인 프로세스 후킹은 별도의 `background_agent.js`에 구현되어 있습니다.

회귀 테스트에는 합성 데이터와 모의 Win32/AX 호출을 사용합니다. 로컬 실제 앱 검증 결과·이미지·개인 대화는 `work/` 등 Git 제외 경로에만 보관합니다. 공개 전에는 스크립트 검사와 함께 스테이징된 변경에 비밀정보와 개인 자료가 없는지 확인하세요.

## 출처

기반 코드와 MIT 라이선스는 [Lee-SiHyeon/kakaocli-win](https://github.com/Lee-SiHyeon/kakaocli-win)을 유지합니다. 초기 Win32 창 탐색은 [rime10221/kakao_MCP](https://github.com/rime10221/kakao_MCP)의 공개 구현을 참고했습니다.

SQLCipher 키 검증은 [공식 설계 문서](https://www.zetetic.net/sqlcipher/design/)와 [verify.c](https://github.com/sqlcipher/sqlcipher-tools/blob/master/verify.c)를 따릅니다. Windows OCR은 [Windows.Media.Ocr](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine.recognizeasync)을 사용합니다.

## 나래 오피스 나와의 채팅 연동 (0.6.2)

`self-room --json`은 이미 등록된 로컬 보안 키로 채팅 종류가 `MemoChat`인 방을 유일하게 확인합니다. `send-self --message-file 결과.txt --dry-run --json`과 `--yes`로 동일한 방에 결과를 제출합니다. 이 명령들은 키를 새로 복구하지 않습니다. 키가 없거나 본인 방을 확정하지 못하면 전송하지 않습니다. 일반 전송 때문에 메모리 키 복구를 자동 시작하지 않습니다.

`capture-main --output 새이미지.png --json`은 메인 창만 캡처합니다. 트레이에 숨겨져 있으면 활성화 없이 화면 밖에서 잠시 렌더링하고 원래 위치와 숨김 상태를 복원합니다. 기존 파일을 덮어쓰지 않습니다. 메인 창 존재는 계정 로그인·나와의 채팅 확인을 뜻하지 않습니다.

나와의 채팅은 단순히 가장 최근 캐시를 고르지 않습니다. 검증한 현재 카카오톡 프로세스가 열고 있는 chatListInfo.edb 한 개를 파일 핸들 메타데이터로 확인하고, 그 DB의 MemoChat을 읽습니다. 계정 파일을 확인하지 못하거나 여러 계정이 열려 있으면 중단합니다. self-room의 account_binding을 send-self --expected-self 값에 넣으면 확인 후 계정·방이 바뀐 경우 보내지 않습니다. 이 확인은 프로세스 메모리나 암호 키를 읽지 않으며 새 키를 복구하지 않습니다.
