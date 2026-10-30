# 공통 CLI

실제 명령과 Schema는 `narae-gyomu schema`가 기준이다. 현재 폴더와 관계없이 설치한 실행기를 호출한다. 인용부호·여러 줄·한글을 보존하려면 `--args-file`을 사용한다.

```powershell
narae-gyomu tool call system.status --args '{}'
narae-gyomu tool call skill.read --args '{"area":"portal"}'
narae-gyomu tool call portal.open --args '{}'
narae-gyomu tool call browser --args '{"action":"snapshot"}'
narae-gyomu tool call browser --args '{"action":"frames"}'
```

입력 파일을 먼저 지정하고 나래한글로 읽는다.

```powershell
# inspect-job.json: {"path":"D:\\업무\\문서.hwpx"}
narae-gyomu tool call hangul.inspect --args-file inspect-job.json --file 'D:\업무\문서.hwpx'
# create-job.json: {"title":"연수 안내","body":"확정한 본문","format":"hwpx","filename":"연수안내.hwpx"}
narae-gyomu tool call hangul.create --args-file create-job.json
```

출력은 `status`의 outputs 폴더다. `hangul.edit`는 실제 inspect 결과의 문단 ID와 작업 JSON을 사용해 새 파일을 만든다. HWP와 HWPX 각각 생성·보존 편집은 지원하지만, 형식 간 변환을 지원한다고 가정하지 않는다.

```powershell
narae-gyomu tool call cbe.search --args '{"name":"사용자가 지정한 이름","scope":"auto"}'
narae-gyomu tool call cbe.notes --args '{"operation":"list","box":"unread","page":1}'
narae-gyomu tool call wxs --args '{"operation":"windows"}'
```

`chat "요청" --file FILE --json`은 선택한 실제 로컬 모델의 실행 기록을 반환한다. `--conversation ID`는 이전 대화를 잇고, `cancel`은 현재 모델 작업을 중단한다. `models stop`은 AI만 종료하며 도구 CLI는 계속 쓸 수 있다. `shutdown`은 공통 실행기를 종료한다.

CLI·화면은 인증된 같은 localhost API를 사용한다. API 접속 정보는 로컬 data 폴더의 daemon.json에 있으므로 공개하거나 모델 프롬프트에 넣지 않는다. 외부 AI 연동은 이 CLI를 우선 사용한다.
