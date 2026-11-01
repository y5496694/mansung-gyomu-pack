---
name: narae-regional-messenger
description: 지역 설정에 따라 설치물에서 분석한 ULTARI·UCWARE 전용 로컬 메신저 캐시를 조회한다. 충북 소통은 기존 CBE CLI로 연결한다.
---

오피스의 gyomu_regional_messenger를 사용할 때 먼저 status를 읽는다. CLI 직접 실행은 저장소의 `node cli.mjs --region 지역 명령`이다. 오피스 배포물에는 vendor/narae-messenger-cli/cli.mjs로 포함된다.

경기·경북·전북은 ULTARI, 강원·경남·제주는 UCWARE다. 제품 설정·SHA-256과 실제 테이블 열을 확인하는 별도 드라이버를 사용한다. 다른 지역을 충북 CLI로 대체하거나 공통 UIA 연결을 전용 프로토콜 지원이라고 하지 않는다.

사용자 제공 DB 사본의 accounts로 정확한 계정을 확인하고 bind-store(kind/database/owner)로 연결한 다음 조회한다. status.localKinds의 종류만 사용한다. notes/note/chats/chat/chat-messages/contacts는 연결한 계정의 캐시이며 서버 동기화·인증·수신 확인을 뜻하지 않는다. 읽음 표시를 변경하지 않는다. opaque-binary를 해독한 원문처럼 요약하지 않는다. 첨부 메타데이터는 다운로드 결과가 아니다.

실계정 업무 시험 지역은 충북이다. 비충북 전송·원격 첨부·독자 본문 인코딩은 미검증이다. 설치 파일과 지역 계정이 없는 제품을 완료 처리하지 않는다. 제품별 근거와 미완료 항목은 저장소의 ANALYSIS.md를 확인한다.
