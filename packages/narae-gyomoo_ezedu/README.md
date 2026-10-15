# 나래교무 이지에듀

이지에듀 투게더의 **일정 조회와 입력**을 Windows CLI로 처리하는 나래교무 스킬입니다. 앱에 저장된 로그인·학교·일정 게이트웨이 설정을 읽어 GUI 조작 없이 요청합니다.

## 실행

Windows와 Python 3.10 이상이 필요합니다. 외부 Python 패키지는 사용하지 않습니다. 이지에듀에서 로그인한 이력이 있고 일정 게이트웨이 모드가 활성화되어 있어야 합니다.

```powershell
git clone https://github.com/y5496694/narae-gyomoo_ezedu.git
cd narae-gyomoo_ezedu

# 오늘 일정
.\easyedu.cmd list

# 날짜별·기간별 조회
.\easyedu.cmd list --date 2026-10-15 --json
.\easyedu.cmd list --from 2026-10-15 --to 2026-10-21 --kind school --json

# 입력 내용 미리보기: 서버 요청 없음
.\easyedu.cmd add --date 2026-10-16 --title "협의회 15:00" --kind personal --dry-run

# 실제 입력: 실행하면 일정이 저장됩니다
.\easyedu.cmd add --date 2026-10-16 --title "협의회 15:00" --detail "장소: 회의실" --kind personal --json
```

래퍼 없이 Python 파일을 직접 실행할 수도 있습니다.

```powershell
python -X utf8 .\scripts\easyedu_schedule.py list --date 2026-10-15 --json
```

## 일정 종류

| 값 | 조회·입력 범위 |
| --- | --- |
| `personal` | 현재 로그인한 사용자의 개인 일정 |
| `school` | 학교 일정 |
| `group` | 앱의 대상자·소속 조건에 맞는 일정 조회 / 현재 소속 그룹에 입력 |
| `other` | 복무기타 일정 |
| `all` | 조회에서만 사용. 공휴일·국가절기를 포함한 표시 대상 일정 |

조회 기본값은 `all`, 입력 기본값은 `personal`입니다. 날짜를 생략한 조회는 한국시간 오늘을 사용합니다. `--from`과 `--to`는 함께 지정합니다.

입력 옵션은 `--date`, `--title`, `--detail`, `--assignee`, `--kind`, `--dry-run`입니다. 날짜·제목은 필수이며 시간은 제목이나 세부 내용에 적습니다. 반복 일정의 새 생성, 첨부, 쪽지·알림 발송, 수정·삭제는 포함하지 않습니다.

## Codex 스킬

이 저장소 자체가 `narae-gyomu-ezedu` 스킬 폴더입니다. `SKILL.md`, `agents/`, `scripts/`를 함께 유지하면 됩니다. 사용자에게 표시되는 이름은 **나래교무 이지에듀**입니다.

Codex의 개인 스킬 폴더에 설치하려면 다음과 같이 복제합니다. 이미 같은 폴더가 있다면 먼저 기존 내용을 확인하세요.

```powershell
git clone https://github.com/y5496694/narae-gyomoo_ezedu.git "$env:USERPROFILE\.codex\skills\narae-gyomu-ezedu"
```

설치 후 스킬이 로드된 새 대화에서 `$narae-gyomu-ezedu`를 지정하거나, “이지에듀에서 이번 주 일정 조회해 줘”처럼 요청합니다.

## 자동화 출력과 재시도

`--json`을 사용하면 조회는 `count`와 `events`, 입력은 `status`, `saved`, `event`를 반환합니다.

| 입력 status | 의미 |
| --- | --- |
| `preview` | 미리보기. 서버 요청 없음 |
| `exists` | 같은 일정이 있어 추가하지 않음 |
| `created` | 저장 ID를 받고 재조회까지 성공 |

같은 사용자의 날짜·유형·제목·세부 내용·담당자·소속이 같은 일정은 중복 입력을 건너뜁니다. 동시 실행 사이의 중복 방지를 보장하는 고유키는 없으므로 같은 입력을 병렬 실행하지 마세요. 저장 응답이 불확실하면 자동 재전송하지 않으며, 해당 날짜를 조회해 확인합니다.

종료 코드는 `0` 성공, `1` 설정·통신·처리 오류, `2` 명령 인자 오류입니다.

## 설정과 검증 범위

현재 Windows 사용자의 `HKCU\Software\EasyeduInfo\EasyeduTogether`에서 기존 설정을 읽습니다. 로그인 비밀번호는 읽지 않습니다. 인증키는 요청 시 메모리에서 사용하며 파일·출력에 기록하지 않습니다. 조회와 입력은 저장된 학교·로그인 사용자 범위로 제한합니다. 게이트웨이 모드가 꺼져 있으면 중단합니다.

2026-10-15에 날짜별 일정 5건, 일주일 학교 일정 23건의 실서버 조회를 확인했습니다. 저장 API는 `WHERE 1=0`을 붙여 **실제 변경 없이** 구문·필드·권한을 검증했고, 응답은 `ok=true, affected=0, insertId=0`이었습니다. 실제 일정 1건 등록 후 앱에 표시되는 것까지는 검증하지 않았습니다. 이미 열린 앱 화면의 즉시 갱신도 미검증입니다.

앱 내부 게이트웨이 방식이므로 앱·서버 변경 시 재검증이 필요합니다. 실제 일정 데이터, 인증정보, 원본 실행 파일과 분석용 복사본은 저장소에 포함하지 않습니다.

일정·통신 코드의 정적 분석에는 [REA](https://github.com/morluto/rea) 6.5.0을 사용했습니다. 원본이 REA의 128MiB 입력 제한을 초과해, 코드·메타데이터 위치를 유지하고 대용량 리소스를 제거한 분석 전용 복사본을 사용했습니다. 실행에는 REA가 필요하지 않습니다.

## 오프라인 검증

다음 검증은 서버에 연결하거나 실제 일정을 만들지 않습니다.

```powershell
python -X utf8 -m unittest discover -s tests -v
```
