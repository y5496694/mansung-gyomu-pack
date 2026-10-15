# 나래교무 기본 시간표 · narae_gyomoo_classtime

공개 Google Sheets의 학교 기본 시간표를 AI 에이전트가 해석하고, 현재 학년도·학기의 모든 학급을 JSON으로 저장해 HTML과 질의응답에서 함께 사용합니다.

학교마다 다른 표 배치와 가변 학년·반·교시를 지원합니다. 1~6학년이나 6교시에 고정되어 있지 않습니다. 처음 연결할 때 에이전트가 원본의 셀 배치를 해석합니다. 이후 과목 변경은 그 셀에서 다시 읽고, 학급이 추가되거나 배치가 바뀌면 AI 재해석을 요청합니다. 외부 AI API 키는 필요하지 않습니다.

## 설치

Python 3.10 이상이 필요하며 추가 패키지는 없습니다.

```powershell
git clone https://github.com/y5496694/narae_gyomoo_classtime.git
Set-Location narae_gyomoo_classtime
.\install.ps1
```

기본 설치 위치는 `CODEX_HOME/skills/narae-gyomu-classtime`, 환경변수가 없으면 사용자 폴더의 `.codex/skills/narae-gyomu-classtime`입니다. `-SkillsDirectory`로 다른 스킬 디렉터리를 지정할 수 있습니다. 새 대화에서 스킬을 사용합니다. [만승 교무팩](https://github.com/y5496694/mansung-gyomu-pack)에도 같은 원본이 포함됩니다.

## 사용

에이전트에게 학교 이름과 공개 링크를 주고 요청합니다.

```text
이 공개 시간표 링크를 우리 학교 기본 시간표로 연결하고 전체 학급을 조사해줘.
현재 학기 3학년 1반 목요일 3교시가 무슨 과목이야?
오늘 영어 수업이 있는 반을 알려줘.
시간표를 새로 조사하고 HTML로 보여줘.
```

각 질문 전에 원본을 새로 읽어 JSON과 HTML을 함께 갱신합니다. 원본 조회에 실패하면 마지막 확인 시각과 실패 사유를 표시합니다. 기본 시간표이므로 특정 날짜의 행사·휴업·임시 변경을 자동 추정하지 않습니다.

HTML은 설치 폴더의 **시간표 열기.cmd**를 실행하면 됩니다. 열 때와 5분마다 원본을 확인하며, 에이전트가 갱신한 JSON도 10초 내에 반영합니다. 서버가 켜져 있는 동안 동작합니다. `data/timetable.html`을 직접 열면 마지막 저장 사본을 볼 수 있습니다. 이 사본을 다시 열 때의 학기가 다르면 과거 자료임을 표시합니다. 브라우저만 실행 중인 상태에서는 새로운 표 양식을 AI가 독자적으로 해석하지 않으며, 에이전트에게 재조사를 요청하도록 안내합니다.

아래 **주간 과목별 시수**에서 과목을 누르면 버튼이 활성화되고 시간표의 해당 과목이 노란색으로 강조됩니다. 여러 과목을 동시에 선택할 수 있습니다. 다시 누르면 개별 해제되며 **강조 해제**로 선택을 모두 풀 수 있습니다. 같은 과목은 반 전환이나 원본 갱신 후에도 강조를 유지합니다.

학기 기준은 한국 시간으로 다음과 같습니다.

| 조회일 | 선택 학년도·학기 |
| --- | --- |
| 2026년 2~7월 | 2026학년도 1학기 |
| 2026년 8~12월 | 2026학년도 2학기 |
| 2027년 1월 | 2026학년도 2학기 |
| 2027년 2월 | 2027학년도 1학기 |

원본에 해당 학기 자료가 없으면 과거 자료를 현재 학기로 바꾸어 제공하지 않습니다. 빈칸은 미기재로 유지합니다.

## 저장 파일과 업데이트

| 파일 | 용도 | Git 포함 |
| --- | --- | --- |
| `sources.local.json` | 학교 이름·공개시트 링크 | 제외 |
| `mapping.local.json` | AI가 검토한 학기별 셀 배치 | 제외 |
| `data/current.json` | 현재 조회 기준 시간표, 원문·셀 근거·확인 시각 | 제외 |
| `data/timetable.html` | JSON으로 생성한 HTML 저장 사본 | 제외 |
| `data/source.snapshot.json`, `data/inspection.txt` | 원본 조사 자료 | 제외 |
| `data/2026-2.json` 등 | 마지막으로 조사한 학년도·학기별 시간표 | 제외 |

**실제 링크는 코드·README·예제·GitHub에 넣지 않습니다.** `sources.example.json`은 빈 예시입니다. 저장소에서 `git pull --ff-only`해도 무시된 로컬 설정과 데이터는 남습니다. 설치 프로그램과 만승 교무팩 업데이트도 배포 파일만 교체하고 이 로컬 파일을 유지합니다. 설치본과 Git 체크아웃은 별개이므로 사용하는 스킬 폴더 안의 설정을 기준으로 합니다.

업데이트:

```powershell
git pull --ff-only
.\install.ps1
```

CLI로 직접 실행할 수도 있습니다. 아래 명령은 같은 폴더에서 실행합니다.

```powershell
python scripts/timetable.py inspect
# 에이전트가 references/mapping.md에 따라 data/candidate.json 작성
python scripts/timetable.py accept data/candidate.json
python scripts/timetable.py refresh
python scripts/timetable.py query --grade 3 --class 1 --day 목 --period 3
python scripts/timetable.py query --date 2027-01-15 --subject 영어
python scripts/timetable.py serve --port 8765
```

처음 링크를 설정할 때는 `configure --school '학교명' --url '공개시트 링크'`를 사용합니다. 링크가 있는 실제 명령을 저장소 파일에 저장하지 않습니다. 1월과 2월의 원본 선택, 학급 추가, 다른 표 방향, 8교시, 갱신 실패 시 데이터 보존, 스크립트 삽입 문자열의 HTML 안전성을 자동 시험합니다.

```powershell
python -m unittest discover -s tests -v
```
