# 나래 한글 오피스

**나래한글 엔진 기반 · 한컴오피스 한글 연동 · 로컬 문서 작업 공간**

[나래한글 엔진](https://github.com/y5496694/narae_hangul)을 사용하는 Windows용 HWP/HWPX 문서 앱입니다. 기존 한글 문서를 읽고 본문·글자·문단 서식을 AI로 편집하거나, 새 문서·표·그림을 작성하고 PDF 사본을 만들 수 있습니다. 문서와 대화는 내 컴퓨터에 저장합니다. 앱 자체 로그인은 필요 없습니다.

![나래 한글 오피스의 문서 편집 화면](docs/images/app.png)

## 설치

1. Windows 10/11 x64에 **한컴오피스 한글이 먼저 설치되어 있어야 합니다.** 한 번 직접 실행해 초기 설정을 마칩니다. 한컴 프로그램·라이선스·글꼴은 이 저장소에 포함하지 않습니다.
2. 텔레그램·로컬 AI가 포함된 [0.13.0-preview.1 릴리스](https://github.com/y5496694/Narae_hangul_office/releases/tag/v0.13.0-preview.1)의 `Narae-Hangul-Office-0.13.0-preview.1-windows-x64.zip`을 내려받아 압축을 풉니다. 또는 이 저장소의 Code → Download ZIP을 사용합니다.
3. 폴더 안의 **`설치.cmd`를 한 번 실행**합니다. Node.js·Python·Electron·엔진 라이브러리·공식 Claude 로그인 도구·로컬 AI CPU 실행기를 앱 전용 폴더에 자동 설치합니다. **Node.js나 Python을 따로 설치할 필요가 없습니다.** 첫 설치에는 인터넷이 필요하며 관리자 권한은 필요 없습니다.
4. 바탕화면의 **나래 한글 오피스**를 실행합니다.

기본 설치 위치는 `%LOCALAPPDATA%\Programs\NaraeHangulOffice`, 데이터 위치는 `%LOCALAPPDATA%\NaraeHangulOffice`입니다. 설치 위치에 공백·한글이 있어도 사용할 수 있습니다. 다른 드라이브에 설치하려면:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -InstallRoot "D:\Apps\NaraeHangulOffice"
```

Node.js와 Python은 공식 배포 파일의 SHA256을 확인한 뒤 `runtime` 아래에 준비합니다. 시스템 PATH·기존 Python 설치·한글 COM 등록을 변경하지 않습니다. 라이브러리는 `runtime/python/Lib/site-packages`의 교체 가능한 일반 모듈입니다. 설치 스크립트·전체 소스·의존성 목록을 제공합니다.

## 한컴 버전 호환

설치된 Windows용 한글을 자동 탐색하고, 여러 버전이면 최신 버전을 우선합니다. 기존 파일은 원래 열린 한글 창을 재사용합니다.

| 한컴오피스 한글 | 확인 범위 |
| --- | --- |
| 2024 | 실제 HWP/HWPX 본문·서식 편집, 저장 후 재열기, PDF 출력 검증 |
| 2022 | 실제 HWP/HWPX 본문·서식 편집, 저장 후 재열기, PDF 출력 검증 |
| 2020·2018·기타 Windows 버전 | 설치 경로 자동 탐색 및 COM 연동 대상. 실제 해당 버전의 기능 호환성은 미검증 |

다른 버전의 동작은 한글 COM 자동화·HWPX·PDF 출력 지원 여부와 보안 정책에 따라 달라집니다. 미리보기·PDF 출력에는 해당 한컴의 PDF 출력 기능과 `Hancom PDF` 프린터가 필요합니다. 다른 버전이나 별도 설치 경로를 지정하려면 `NARAE_HWP_EXE`를 실제 `Hwp.exe` 경로로 설정하세요.

## AI 연결

**에이전트(실험) · 나래 카톡 미리보기:** [0.12.0-preview.2](https://github.com/y5496694/Narae_hangul_office/releases/tag/v0.12.0-preview.2)는 상단 에이전트 탭과 공식 나래 채널(`narae_bot`)에서 사용자별 같은 대화를 이어갑니다. CBE_CLI·나래 브라우저·나래교무 포탈·나래교무의 검증된 실행 소스·업무 스킬을 포함하며 현재 오피스 AI를 사용합니다. UID → 카톡 확인 코드 → PC 승인으로 연결하고, 문서 변경·브라우저 조작·CBE 발송 등은 별도 PC 승인이 필요합니다. 공식 챗봇 스킬·HTTPS 중계 설정과 서비스별 사용자 로그인이 필요합니다. 기존 와니·텔레그램과 일반 문서 대화는 별도로 유지합니다. 실제 학교 로그인·발송·공문 상신은 아직 검증하지 않았습니다. [연결·운영·검증 범위](docs/카카오톡-PC연결.md)를 먼저 읽어 주세요.

상단 **AI 연결 · 설정**을 엽니다. 기본값은 **ChatGPT / OpenAI → OAuth 계정 연결**입니다.

- **ChatGPT OAuth:** `Continue with ChatGPT`를 누르고 브라우저에서 계정의 사용 권한을 승인합니다. 계정에서 제공하는 모델을 불러와 선택하고 저장합니다. 권한·모델 제공 여부는 해당 계정에 따릅니다.
- **OpenAI API:** 연결 방식을 API 키로 바꾸고 Responses API 주소·모델 ID·키를 저장합니다. OAuth와 API 설정은 따로 유지합니다.
- **Claude OAuth:** 제공자를 Claude로 바꾸고 **Claude Console 계정 연결**을 선택합니다. 공식 `ant` CLI의 격리된 프로필로 로그인합니다. **Console은 API 사용량 과금이며 Claude Pro/Max 구독과 별개입니다.**
- **Claude API:** Claude → API 키에서 Messages API 주소·모델·키를 저장합니다.

계정을 추가·선택·연결 해제할 수 있습니다. OAuth 실패 시 API 키로 자동 대체 호출하지 않습니다. 토큰과 키는 Windows 사용자 DPAPI로 암호화합니다. 다른 PC에서는 계정에 다시 로그인하거나 API 키를 다시 저장하세요.

## 문서 작업

1. **문서 열기**로 HWP/HWPX를 선택합니다. 미리보기는 설치된 한글로 출력한 실제 문서 쪽입니다.
2. AI에게 “이 문서의 오탈자를 고쳐 줘”, “제목을 17pt 굵게 바꿔 줘”처럼 요청합니다. 기존 파일은 실제 한글 창을 재사용하며, 편집하려고 별도의 빈 문서를 남기지 않습니다.
3. **한글에서 열기**로 직접 편집하거나, **현재 내용**으로 현재 열린 문서의 텍스트를 확인할 수 있습니다.
4. **미리보기**로 저장한 최신 내용을 확인합니다. 자동 저장을 끈 경우에는 한글에서 먼저 저장하세요. **PDF 사본**은 작업 폴더에 새 이름으로 저장합니다.
5. **새 한글 문서**에서 HWP/HWPX를 만들 수 있습니다. 표·그림을 포함한 문서는 AI에게 형식과 내용을 함께 지정하세요.

기존 문서의 편집 전 사본은 데이터 폴더의 `backups` 또는 `data/backups`에 보관합니다. 파일을 직접 편집할 때는 최신 해시를, 열린 문서를 편집할 때는 최신 내용과 원문 후보 수를 확인합니다. 미저장 문서를 파일 엔진으로 덮어쓰지 않습니다. 변경 추적 문서는 현재 한글의 텍스트와 네이티브 동작으로 처리합니다. 일부 작업이 실패하면 완료 단계와 백업을 알립니다.

지원 범위와 문제 해결은 [사용 안내](docs/사용안내.md)를 참조하세요. 모든 한글 기능을 대체하는 앱은 아니며 한컴오피스 한글 설치가 필요합니다.

## 데이터와 개인정보

문서·대화·설정·백업은 로컬에 저장합니다. AI를 요청하면 선택한 문서 내용과 도구 결과가 연결한 OpenAI 또는 Anthropic 서버로 전송됩니다. 일반 로컬 사용은 앱 운영 서버를 경유하지 않습니다. **선택 기능인 카카오톡 PC 연결을 승인하면 원격 요청·답변·처리에 사용된 문서 내용이 카카오와 별도 중계 서버도 통과할 수 있습니다.** 중계에는 요청·결과를 최대 7일 보관하며 운영자가 접근할 수 있습니다. 학교 인증서·로그인 정보와 AI 자격은 PC에 둡니다. [개인정보 경계](docs/카카오톡-PC연결.md)를 확인하세요. API 키·OAuth 토큰·사용자 문서·대화·글꼴은 GitHub에 포함하지 않습니다. 데이터 폴더는 설정에서 열 수 있습니다.

## 개발

```powershell
npm ci
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm test
npm start
```

`scripts/install-ant.ps1`로 공식 Claude Console 로그인 도구를 설치할 수 있습니다. 기본 설치 프로그램은 이 단계를 자동 수행합니다. ChatGPT OAuth/API 사용에는 이 도구가 필요하지 않습니다.

위 명령은 개발자를 위한 수동 실행 방법입니다. 일반 사용자는 `설치.cmd`만 실행하면 됩니다. 실행 데이터 위치는 `NARAE_OFFICE_HOME`, Python 경로는 `NARAE_OFFICE_PYTHON`, 사용자 지정 한글 경로는 `NARAE_HWP_EXE` 환경 변수로 지정할 수 있습니다. 검증 로그·문서는 [검증 결과](docs/검증결과.md)에 기록합니다.

## 라이선스

앱 코드와 포함된 나래한글 엔진은 **MIT**입니다. 엔진 기준 버전은 `c4ad1460e6b0ead94f7d13814ead8f948470e4fa`이며 원 저작권·허가문을 유지합니다. 외부 라이브러리에는 각각의 라이선스가 적용됩니다. [LICENSE](LICENSE), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 참조하세요.

본 제품은 한컴의 HWP 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다. 한컴오피스 한글과 연동하는 별도 앱이며 한글과컴퓨터의 공식 제품은 아닙니다.

## AI 에이전트용 CLI · 스킬

설치하면 `narae-office.cmd`와 Codex용 `narae-hangul-office` 스킬도 함께 준비됩니다. 나래한글 독립 CLI는 별도 저장소와 `narae-hangul` 스킬로 유지합니다. CLI의 문서 작업에는 AI 로그인·API 키가 필요 없습니다. 외부 AI가 작업 JSON을 작성해 실행할 수 있습니다.

```powershell
& "$env:LOCALAPPDATA\Programs\NaraeHangulOffice\narae-office.cmd" doctor
& "$env:LOCALAPPDATA\Programs\NaraeHangulOffice\narae-office.cmd" run "D:\문서\작업.json" --result "D:\문서\결과.json"
```

[스킬 문서](skills/narae-hangul-office/SKILL.md) · [작업 JSON 명세와 예시](skills/narae-hangul-office/references/jobs.md). 별도 설치 위치는 `NARAE_OFFICE_ROOT`로 지정합니다. `install-skill` 명령으로 현재 설치 위치를 스킬에 다시 등록할 수 있습니다. 스킬 갱신 전 변경 파일을 백업하고, 새 채팅에서 발견됩니다.

## 0.11 CLI 개선과 독립성

나래한글 독립 CLI와 오피스 CLI를 별도로 유지합니다. 오피스 설치기는 narae-hangul-office 스킬만 설치합니다. 독립 CLI는 [narae_hangul](https://github.com/y5496694/narae_hangul)을 사용하세요. 긴 한국어 stdout의 UTF-8 버퍼 경계 깨짐을 수정했습니다. CLI inspect의 기본 응답은 compact이며 본문을 중복 반환하지 않습니다. --full은 이전 전체 서식 응답, --offset/--limit는 문단 범위를 반환하며 hasMore를 확인합니다.

## 텔레그램 · 나래AI 모델

상단 **텔레그램**에서 본인 봇을 연결해 문서 요청·첨부·결과 파일을 주고받을 수 있습니다. PC 승인과 개인 채팅 연결을 적용하며 기존 카카오톡 기능도 유지합니다.

**나래AI 모델**에서 **설치 → 사용**으로 실제 학습한 모델을 선택합니다. AI 실행기는 설치.cmd에서 자동 준비하며, 모델은 Hugging Face에서 필요할 때 받습니다. 로컬 AI는 계정·API 키 없이 문서·통합 에이전트에 연결됩니다. 기존 나래교무 모델 가져오기와 Ollama·LM Studio 등 외부 로컬 서버 연결도 제공합니다.

- [나래1 · 0.6B](https://huggingface.co/inhow/Narae1-Qwen3-0.6B-SFT-v1)
- [EXAONE 나래2 · 2.4B · 연구·평가용](https://huggingface.co/inhow/EXAONE-Narae2-2.4B-Tool-SFT-v2)
- [나래3 · 4B](https://huggingface.co/inhow/Narae3-Qwen3-4B-LoRA-v1)

[설치·연결·사용 방법과 검증 범위](docs/텔레그램과-나래AI.md). 나래AI는 실험 모델이며 사용자 작업의 정확성과 복잡한 업무의 자동 완수를 보장하지 않습니다.
