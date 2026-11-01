# 나래 지역 메신저 CLI 0.2

충북 CBE, ULTARI AtMessenger7, UCWARE Delphi를 별도 드라이버로 처리합니다. 경기·경북·전북·강원·경남·제주 공식 설치물을 실제 설치하고 REA로 분석했습니다. 각 제품의 설정과 실행 파일 SHA-256을 함께 확인합니다.

| 지역 | 실제 제품·업체 | 전용 조회 |
| --- | --- | --- |
| 충북 | 기존 CBE CLI | 기존 연결·쪽지·사용자·첨부 명령 |
| 경기·경북·전북 | GOE·GBeeTALK·JBEdu Messenger+ / ULTARI | 로컬 쪽지·대화방·대화 행 |
| 강원·경남·제주 | 이음·아이좋아·제주교육청 메신저 / UCWARE | 로컬 쪽지·보관 대화·개인 주소록 |

비충북 조회는 사용자 제공 표준 SQLite 캐시를 읽습니다. 새 설치에는 계정 캐시가 없습니다. 지역별 로그인·서버 검색·전송·원격 첨부 다운로드는 아직 실검증하지 못했습니다. 다른 10개 지역은 전용 구현이 없습니다. [확인 범위](ANALYSIS.md)를 확인하세요.

Node 22.19 이상이 필요합니다. 기본 설치 경로는 D:/Codex/apps/regional-messengers/제품ID, 작업 자료는 D:/Codex/narae-data/messengers입니다. 다른 설치 경로는 매 명령에 --install-dir로 지정합니다.

```powershell
node cli.mjs --region 경기 status
node cli.mjs --region 경기 accounts --kind notes --database 'D:/Codex/work/GOE캐시.db'
node cli.mjs --region 경기 bind-store --kind notes --database 'D:/Codex/work/GOE캐시.db' --owner '실제캐시계정'
node cli.mjs --region 경기 notes --query '연수' --limit 20
node cli.mjs --region 경기 note --id '실제쪽지키'
node cli.mjs --region 제주 accounts --kind contacts --database 'D:/Codex/work/user_data.db'
node cli.mjs --region 제주 bind-store --kind contacts --database 'D:/Codex/work/user_data.db' --owner '실제캐시계정'
node cli.mjs --region 제주 contacts --query '교사이름'
node cli.mjs --region 충북 cbe notes list --box received --json
```

status.localKinds에 있는 종류만 연결합니다. 조회는 연결한 정확한 지역·DB 경로·계정으로 한정합니다. 같은 키로 여러 기록이 있으면 임의 선택하지 않습니다. 제품·실행 파일·스키마가 바뀌면 재분석이 필요합니다. DB 읽기 전용 트랜잭션을 사용하며 읽음 표시를 갱신하지 않습니다. 바이너리 서식 본문을 해독하지 못하면 opaque-binary와 해시를 반환합니다. 첨부 필드는 원래 메타데이터이며 다운로드 결과가 아닙니다.

[제품별 프로필](drivers/profiles.json)에는 여섯 설치물의 해시·REA 근거 ID·실제 테이블 열과 바이트 위치가 있습니다. research/rebuild-profiles.py는 설치물과 REA 근거 해시를 대조하여 재생성합니다. analyze 명령의 디렉터리 헤더 관찰만으로 내부 프로토콜 분석이 끝났다고 하지 않습니다.

UIA discover/bind/inspect/read/fill/send는 별도의 수동 관찰 수단입니다. 실제 snapshot/ref, 비어 있는 편집 항목, 문안 파일과 --yes를 사용합니다. send에는 전송 버튼 ref와 방 전체 제목이 필요하며 결과는 submitted_unconfirmed입니다. 결과 불명 전송은 재시도하지 않습니다. 전용 제품은 UIA에서도 제품 설정과 해시를 확인합니다.

설치기·공급사 실행 파일·PDB·쪽지·연락처·인증정보는 배포하지 않습니다. CBE 원본 MIT 라이선스는 vendor/cbe에 보존합니다. npm test는 합성 캐시 회귀 검증이며 비충북 실계정 시험이 아닙니다.
