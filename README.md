# 만승팩 · Mansung Pack

**나래한글 + 나래교무 업무포털 + 충북소통메신저를 한 번에 내려받고 설치하는 통합 팩입니다.**

각 도구는 원본 저장소에서 계속 개발합니다. 만승팩은 세 원본의 최신 `main`을 자동으로 가져와 `packages/`에 묶습니다. ZIP에도 실제 소스와 템플릿이 모두 포함됩니다.

| 구성 | 원본 | 설치되는 스킬 |
| --- | --- | --- |
| 나래한글 | [narae_hangul](https://github.com/y5496694/narae_hangul) | `narae-hangul` |
| 나래교무 업무포털 | [narae_gyomoo_portal](https://github.com/y5496694/narae_gyomoo_portal) | 업무포털·나이스·에듀파인·WXS, 4개 |
| 충북소통메신저 | [CBE_CLI](https://github.com/y5496694/CBE_CLI) | `cbe-messenger` |

## 내려받기와 설치

[만승팩 ZIP 다운로드](https://github.com/y5496694/mansung-pack/archive/refs/heads/main.zip) 후 압축을 풀거나, Git으로 받습니다.

```powershell
git clone https://github.com/y5496694/mansung-pack.git
Set-Location mansung-pack
.\install.ps1
```

Windows와 Python 3.10 이상이 필요합니다. 기본 설치 위치는 `CODEX_HOME/skills`, 해당 환경변수가 없으면 사용자 폴더의 `.codex/skills`입니다. 설치 후 새 대화에서 스킬을 사용합니다.

```text
나래한글로 이 한글 문서의 표 내용을 고쳐줘.
나래교무로 에듀파인 문서등록대장을 검색해 줘.
충북소통메신저에서 읽지 않은 쪽지를 보여줘.
```

다른 위치에 설치하려면 `./install.ps1 -SkillsDirectory 'D:\my-skills'`를 사용합니다. 이 옵션은 스킬 파일을 복사하는 위치만 지정하며 다른 에이전트의 등록 형식을 변환하지 않습니다.

기존 파일과 내용이 같으면 건너뛰고, 교체하는 기존 파일은 스킬 폴더 밖의 `skill-backups/mansung-날짜/`에 백업합니다. 기존의 `narae-gyomu-work-portal/references/portal.json`은 로컬 교육청 설정으로 보존합니다. 배포본에 없는 기존 사용자 파일은 삭제하지 않습니다.

### 기능별 실행 환경

설치 명령은 스킬 파일을 배치합니다. 각 기능의 실행 환경은 별도로 준비합니다.

- **소통메신저:** Node.js 22.19 이상과 본인 계정으로 로그인된 충북소통메신저가 필요합니다. npm 의존성은 없습니다.
- **업무포털:** 브라우저 컨트롤이 연결된 브라우저와 학교 업무 시스템이 필요합니다. WXS는 설치된 클라이언트와 `pywin32`가 필요하며, 원본의 [설치 안내](packages/narae_gyomoo_portal/README.md#설치)를 따릅니다.
- **한글:** 사용하는 경로에 따라 한컴오피스·Python 라이브러리가 필요합니다. [나래한글 안내](packages/narae_hangul/README.md)와 설치된 스킬의 `references/hancom.md`를 확인합니다.

원본 도구의 지원 범위와 검증 상태는 각각의 README와 SKILL.md를 따릅니다.

## 업데이트

### GitHub의 만승팩

GitHub Actions가 **매시간 17분**에 원본 세 저장소의 최신 `main` 커밋을 확인합니다. 변경이 있으면 가져온 파일과 설치 경로를 검사한 뒤 만승팩에 자동 커밋합니다. Actions의 **Sync upstream packages → Run workflow**로 즉시 실행할 수도 있습니다.

GitHub의 예약 실행은 지연될 수 있습니다. 공개 저장소에 60일간 활동이 없으면 예약 작업이 비활성화될 수 있으므로, 장기 미사용 후에는 Actions 상태를 확인합니다. [GitHub 예약 실행 안내](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

원본 코드는 `packages/`에서 직접 수정하지 않고 해당 원본 저장소에서 수정합니다. 다음 동기화는 원본 내용으로 교체합니다. 아직 원본에 커밋·푸시하지 않은 PC의 변경은 포함되지 않습니다.

### PC에 설치한 스킬

```powershell
.\update.ps1
```

이 명령은 원본의 최신 `main`을 직접 받아 설치본까지 갱신합니다. Git으로 받았거나 ZIP으로 받은 폴더 모두에서 사용할 수 있습니다. 로컬 폴더의 `packages/`와 버전 기록도 갱신하므로 Git 사용자는 변경 상태를 확인합니다. 만승팩 자체의 설치·갱신 스크립트 변경은 `git pull --ff-only` 또는 새 ZIP 다운로드로 먼저 받습니다.

GitHub 저장소가 갱신돼도 PC의 설치본이 저절로 바뀌지는 않습니다. 기본 구성은 이 업데이트 명령을 실행할 때 PC에 반영합니다.

## 버전과 출처 확인

`pack.json`은 구성할 저장소·브랜치·설치 경로를 지정합니다. `sources.lock.json`은 실제로 가져온 커밋 주소와 파일 내용의 SHA-256을 기록합니다. 텍스트 개행은 LF로 환산해 Windows의 개행 변환을 허용합니다.

```powershell
python scripts/validate.py
python -m unittest discover -s tests -v
```

동기화 과정은 원본 코드를 실행하지 않습니다. 원본 스킬의 설치 경로·동일 이름 충돌·파일 해시를 검사하고, 임시 폴더에서 설치·업데이트·백업·설정 보존을 시험합니다. 학교 시스템 로그인이나 메시지 전송을 수행하지 않습니다. 각 도구의 모든 기능을 검증하는 통합 시험은 아닙니다.

## 구성

```text
mansung-pack/
├─ packages/              원본 세 저장소의 소스·문서·템플릿
├─ scripts/               통합 동기화·검사·설치
├─ tests/                 설치·업데이트 검사
├─ .github/workflows/     자동 동기화
├─ pack.json              구성 목록
├─ sources.lock.json      반영된 원본 커밋·해시
├─ install.ps1            스킬 일괄 설치
└─ update.ps1             원본 최신 코드로 설치본 갱신
```

각 구성 요소의 라이선스·출처 고지는 원본 폴더에 유지합니다. 만승팩 전체에 하나의 라이선스를 일괄 적용하지 않습니다. 자세한 내용은 [출처 안내](NOTICE.md)를 확인하세요.
