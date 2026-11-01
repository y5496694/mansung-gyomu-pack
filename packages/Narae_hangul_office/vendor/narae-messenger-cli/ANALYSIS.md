# 설치물 기반 확인 범위

2026-11-01. 공식 배포 설치기의 Windows Authenticode 유효 여부를 확인한 뒤 실제 설치했다. 해시·REA 근거·테이블 열·바이트 위치는 drivers/profiles.json에 고정한다. 아래 버전은 설치기 버전이다.

| 지역 | 제품·업체 | 버전 | 확인한 구조 |
| --- | --- | --- | --- |
| 경기 | GOE / ULTARI | 7.0.2 | NSIS, 32비트 MFC, sqlite3.dll, tblMessage/tblChatRoomInfo/tblChatContent |
| 경북 | GBeeTALK / ULTARI | 7.0.2 | MFC, 경기와 다른 실행 파일·제품 설정, 별도 테이블 확인 |
| 전북 | JBEdu Messenger+ / ULTARI | 7.0.2 | 공식 20260 ZIP, MFC, 별도 테이블·실행 파일·MAP/PDB 포함 |
| 강원 | 이음(EUM) / UCWARE | 678 | 2026-07-10 게시 설치기, Delphi, tbl_message/tbl_chat/tbl_users |
| 경남 | 아이좋아 / UCWARE | 706 | Inno, Delphi, 제품별 테이블 확인 |
| 제주 | 교육청 메신저 / UCWARE | 746 | Inno, Delphi 폼·분리 DB·테이블 확인 |

공식 배포 근거:

- [경기 안내에서 연결한 공급사](https://ultari.co.kr/goe/)
- [경북 설치물](https://www.gbe.kr/us/na/ntt/selectNttInfo.do?mi=6355&bbsId=2508&nttSn=1370718)
- [전북 제품·다운로드](https://www.jbedu.kr/index.jbedu?menuCd=DOM_000000513001000000)
- [강원 최신 설치물](https://www.gwe.go.kr/main/bbs/view.do?bbsSn=53811&key=bTIzMDcyMTExOTkyNzQ%3D)
- [경남 설치물·매뉴얼](https://hyedu.gne.go.kr/hyedu/na/ntt/selectNttInfo.do?nttSn=2509524)
- [제주 설치물](https://www.jje.go.kr/index.jje?menuCd=DOM_000000109003000000)

REA 6.8.0 execute-rizin-command로 각 실행 파일의 PE·import·문자열을 분석했다. 설치 파일의 실제 테이블 선언에서 열·바이트 위치를 추출하여 드라이버와 대조했다. 제주 inspect-pe-resources에서 TFM_UCWARE_MAIN/TFM_UCW_SEND_MSG/TFM_UCW_RECV_MSG 폼을, inspect-native-exports에서 ucwaredb.dll의 SQLite API를 확인했다. 경기 DB 경로 문자열의 코드 참조와 fcn.00606b60의 Rizin pseudocode도 수집했다. 정적 pseudocode는 실행 관찰이 아니다.

추가 근거 ID:

- 경기 경로 함수: ev_7a3bba30a753d4286aee6027969babca0db9a7ad974fdc2432c3c7b7a57c1668
- 제주 폼: ev_5ca52e46b41e62af4f707df41d993ec82f3ff16471df9c943f152c7164c2aa0a
- 제주 DB export: ev_5a15ee18276024b8b85b0f4332f396af56512d83f7057b63c9e12cb40f8fd241

처음 설치기 두 개만 관찰한 inspect-desktop-application 헤더 결과는 내부 구현 근거로 사용하지 않는다. 제주 전체 문자열 첫 수집은 출력 상한에 걸려 불완전했으며, 완료된 별도 import·section-string·resource·선택 바이트 관찰을 사용했다. 원본 Evidence는 개인 D 드라이브에 보관한다.

ULTARI 설치기가 기존 설치 경로를 재사용하여 경기/경북 파일이 한 경로에 섞이는 현상을 확인했다. 제품별 디렉터리로 분리하고 경기 원본 해시를 복원했다. 이번 설치로 생긴 자동 시작 링크만 D 드라이브에 보관했다. 공유 레지스트리 키나 실행 파일 이름 하나로 지역을 판단하지 않는다.

미완료 항목:

- 여섯 지역 실계정 로그인·서버 통신·실 쪽지·연락처·첨부 읽기/전송. 자동 승인 검토가 GOE·제주 클라이언트 실행 명령을 거부하여 실행 화면도 검증하지 못했다. 새 설치에 지역 계정 캐시는 없다. 합성 캐시 검증을 실제 업무 성공으로 집계하지 않는다.
- UCWARE 개인 주소록 tbl_users는 전체 서버 조직도가 아니다. 독자 바이너리 rich-text와 원격 첨부 다운로드는 미검증이다.
- 인천 공식 fmx 다운로드는 __IsProhibit=true, 빈 파일 URL과 로그인·다운로드 권한 필요 상태를 반환했다. 파일 URL을 추측하지 않았다.
- 부산·전남은 운영 근거만 확인했으며 공개 설치물 미확보다. 광주·울산·세종은 현재 배포물/버전 미확인이다. 서울·대구·대전·충남은 현재 통일 제품과 설치물부터 미확인이다. 이 10개 지역은 전용 구현으로 집계하지 않는다.
- 실제 학교 업무 시험은 충북만 한다. 카카오톡 CLI도 지역 메신저 전용 구현으로 계산하지 않는다.
