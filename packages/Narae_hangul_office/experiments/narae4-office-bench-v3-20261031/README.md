# 나래4 오피스 기초 벤치 추가 학습 v3

다른 작업에서 정한 오피스 기초 10과제 계약을 이어받은 실제 LoRA 가중치 학습이다. 포털 로그인 실행기·스킬 수정, 직접 모델 판단 평가, 실행기를 포함한 자동화 평가, 실학교 업무 합격을 구분한다. 기초 계약의 모든 변형·검사를 통과해야 합격이며, 합성 시험만으로 배포 합격을 선언하지 않는다.

학습 데이터는 기존 교무 예시 40개와 새 예시 24개다. 검증은 16개, 고정 직접 평가 32개, 기존 능력 유지 평가는 8개다. 모두 가상 자료이며 실제 학교 메시지·다른 대화의 원문·인증서·계좌정보를 포함하지 않는다. 새 예시는 등록 보안 문서 로그인, 인증 결과 불확실 시 중복 제출 방지, 6개월 쪽지·대화 원문 탐색, 대화 본문 검색, 현재 소속의 유일한 수신자에게 원문 전송 준비, 공람 다음 페이지, 특정 날짜 다른 사람 복무, 출장의 실제 관찰 필드 입력을 다룬다. 출장 최종 상신 구현이나 전체 업무 성공을 학습 정답으로 꾸미지 않는다.

학습·검증·평가는 알려진 업무 유형 안에서 가상 값과 표현을 나눈 제한된 시험이다. 새 업무 유형으로의 일반화, 장기 계획 능력 또는 Codex와 같은 능력의 검증이 아니다. 처음 준비한 실행에서 로그인 예시 2종의 학습·검증 입력 중복을 가중치 갱신 전에 발견해 중지했다. 현재 자료는 입력 분리를 검사한 r2 실행이다. 고정된 평가 답을 학습이나 체크포인트 선택에 쓰지 않는다.

기존 v1 어댑터에서 이어 학습하며, 성능이 낮아져 채택하지 않은 v2 어댑터를 시작점으로 쓰지 않는다. Qwen3.5-2B의 마지막 전체 attention 블록 23번에 rank 16, alpha 32 LoRA를 적용한다. 학습 파라미터는 638,976개, AdamW 2e-5, accumulation 4, 3 epoch, optimizer update 48회다. 앞의 23개 블록은 BF16으로 고정하고 입력별 특징을 캐시한다. 마지막 블록·출력 헤드는 CPU backward를 위해 FP32이며 출력 헤드는 학습하지 않는다. 전체/캐시 loss 일치, 미래 토큰 불변성, 모든 학습 텐서의 유한한 gradient와 변경을 검사한다. 시각 인코더와 d1 판단기는 학습하지 않는다.

최종 epoch 체크포인트를 사전에 고정해 사용한다. 검증 loss 감소만으로 채택하지 않으며, 평가 32개와 기존 능력 8개를 같은 추론 설정으로 v1·v3에 각각 실행한다. 직접 평가는 결정 규칙이나 제한된 단일 후보 실행기를 우회한다. 실행기를 포함한 기존 합성 벤치 결과와 합산하지 않는다. HF→GGUF 변환은 14개 LoRA 텐서가 비트 단위로 같은지 검사한다. BF16 학습 본체와 Q4_K_M 추론 본체의 차이는 실제 추론 평가로 확인한다.

실제 학습 48회와 14개 텐서의 변경, HF→GGUF 비트 단위 일치 검증을 완료했다. 실행 시간은 약 28.9분이며 검증 loss는 0.4364→0.3998이다. 직접 판단 평가는 **v1 9/32 → v3 8/32**, 기존 16개 교무 문제는 **5/16 → 4/16**, 기존 능력 유지는 **7/8 → 7/8**이다. 로그인 결과가 불확실할 때 반복하지 않는 직접 판단 2개도 모두 실패했다. **v3는 기본 모델로 채택하지 않으며 v1을 유지한다.**

공통 로그인 모듈의 세션당 1회 제한과 실제 에이전트의 미확인 결과 중지 경로는 별도로 검증했다. 원시 모델이 재시도를 선택하더라도 이 실행 경로에서는 인증 제출을 반복하지 않는다.

후보를 사용한 고정 업무 실행기 포함 5개 흐름은 5/5다. 별도 실제 도구 흐름은 6/7로, 한글 문서 생성 및 시각만 바꾼 뒤 본문·서식 보존 확인은 통과했으나 그림 분석은 `read_image`를 반복해 중단됐다. 고정 단계의 보정이 포함된 흐름 점수를 직접 모델 판단과 합산하지 않는다. 낮은 loss만으로 업무 판단 능력이 좋아졌다고 결론 내릴 수 없다. 결과 원문과 실행 중 어댑터 확인, 실제 문서 재열람 증거는 [결과 요약](results/summary.json), [실제 도구 흐름](results/workflow-summary.json), [문서 검증](results/native-evidence.json)에 있다.

실학교 기초 10과제는 전체 합격하지 않았으며 `fullTenTaskPass:false`, `releasePassed:false`다. 상용 서비스에 시험 메시지·기안·복무를 입력하지 않았다. 가중치와 캐시는 Git에 넣지 않는다.

## 재현

베이스와 v1 시작 어댑터를 공개 해시에 맞춰 준비한 뒤 Windows CPU PyTorch·Transformers·PEFT 환경에서 실행한다. 데이터셋과 평가 파일은 바이트 해시로 검증한다. `build.cjs`는 비어 있는 D: 폴더에 실행 자료를 복사한다. 기본 경로가 다르면 시작 어댑터·베이스 경로를 환경변수로 지정한다. 기존 가중치와 실행을 덮어쓰지 않는다.

```powershell
node experiments/narae4-office-bench-v3-20261031/build.cjs D:/Codex/training/narae4-v3-reproduction
node D:/Codex/training/narae4-v3-reproduction/scripts/evaluate.cjs baseline
node D:/Codex/training/narae4-v3-reproduction/scripts/evaluate.cjs baseline --retention
python -X utf8 D:/Codex/training/narae4-v3-reproduction/scripts/train.py
python -X utf8 D:/Codex/training/narae4-v3-reproduction/scripts/export.py
node D:/Codex/training/narae4-v3-reproduction/scripts/evaluate.cjs trained
node D:/Codex/training/narae4-v3-reproduction/scripts/evaluate.cjs trained --retention
node D:/Codex/training/narae4-v3-reproduction/scripts/workflows.cjs
node experiments/narae4-office-bench-v3-20261031/report.cjs D:/Codex/training/narae4-v3-reproduction
```

`workflows.cjs`는 별도 후보 설치에서 실제 나래4 가중치와 HWPX 생성·수정·그림 분석을 사용한다. 학교 화면·쪽지·공문 응답은 가상 자료다. 기존 5개 기초 에이전트 흐름은 `NARAE_BENCH_CANDIDATE`에 내보낸 GGUF 절대 경로, `NARAE_BENCH_ALIAS`에 후보 이름을 지정하고 `experiments/narae-office-basic-10-20261031/run.cjs`로 실행한다. 두 시험 모두 기존 모델을 덮어쓰지 않으며 전체 10과제 실환경 합격과 구분한다.

학습과 추론 서버를 동시에 시작하지 않는다. 각 평가 실행기는 자신의 서버만 종료하며 사용자의 다른 모델 프로세스를 종료하지 않는다. 실제 실행의 스크립트·파일 해시와 환경 버전은 결과 보고서에 보존한다.
