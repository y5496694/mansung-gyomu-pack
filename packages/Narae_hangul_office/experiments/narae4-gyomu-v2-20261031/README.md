# 나래4 교무 추가 학습 v2

기존 Qwen3.5-2B Office LoRA v1을 이어서 실제 CPU LoRA SFT를 수행하는 재현 자료다. 프롬프트·스킬·실행기 수정과 가중치 학습을 별도로 기록한다. 실제 학교 자료, 다른 Codex 세션의 원문, 인증정보는 데이터셋에 포함하지 않는다.

학습은 새 교무 예시 32개와 v1 TRAIN 유지 예시 8개, 검증은 8개다. 평가 16개는 같은 8개 업무 유형에서 학습에 쓰지 않은 가상 날짜·제목·ID·경로를 사용한다. 새로운 업무 유형에 대한 일반화 시험이나 실제 학교 성공률이 아니다. 데이터셋의 관찰은 필요한 필드를 담은 합성 도구 응답이다. 상용 서비스에 시험 메시지·기안·복무를 입력하지 않는다.

업무 유형은 쪽지 본문 순차 조회, 진행 문서 열람 준비, 저장 첨부의 이어 읽기, 기안 임시저장, 연가 날짜 입력, 변경 추적 한글 현재 본문 읽기, 첨부 미확인 요약, 목록의 결재 상태·현재 결재자 요약이다. 기존 문서·이미지·산술의 v1 평가 8개도 별도로 유지한다.

학습 설정은 v1의 마지막 전체 attention 블록(23번), rank 16, alpha 32, trainable 638,976개, AdamW 5e-5, accumulation 4, 2 epoch, optimizer update 20회다. `PeftModel.from_pretrained(..., is_trainable=True)`로 v1 어댑터에서 이어 학습한다. [공식 PEFT API](https://huggingface.co/docs/peft/en/package_reference/peft_model)에 해당 설정이 설명되어 있다. 첫 23개 블록은 BF16으로 고정·캐시하며 마지막 블록·출력 헤드·LoRA는 CPU backward를 위해 FP32다. 입력 임베딩과 헤드의 dtype 별칭만 분리하며 출력 헤드는 학습하지 않는다. MRoPE·인과 마스크의 전체/캐시 loss 일치 및 미래 토큰 불변성을 검사한다. 시각 인코더와 d1 판단기는 학습하지 않는다.

실제 실행 폴더는 `D:/Codex/training/narae4-gyomu-v2-20261031-r2`다. 처음 만든 실행의 첨부 fixture 형식이 실제 CLI와 달라 수정하고 r2로 다시 고정했다. r2의 기준 평가를 마친 뒤 학습을 시작했으며, 이전 형식의 평가 점수는 비교에 쓰지 않는다. 기준 모델의 직접 판단 점수는 5/16이다. 이 평가는 실행기의 제한된 단일 후보 선택을 우회하므로 자동화 흐름 시험 점수와 다르다.

추가 학습 20회와 HF→GGUF 14개 텐서의 비트 단위 일치 검증을 완료했다. 검증 loss는 0.4483→0.3976으로 줄었지만 직접 교무 평가가 5/16→4/16, 기존 문서 평가가 과거 v1 7/8에서 v2 6/8로 낮아졌다. **v2는 기본 모델로 채택하지 않는다. 설치된 나래4 Office LoRA v1을 유지한다.** 새 CLI·업무 흐름·스킬 수정은 기존 나래4에서 별도로 검증한다. 자료와 평가 결과는 `results`에 보존한다.

## 재현

먼저 v1 재현 절차로 베이스와 v1 HF 어댑터를 준비한다. 베이스 파일은 `base-manifest.json`, 시작 어댑터는 `datasets/manifest.json`의 SHA256과 일치해야 한다. Windows CPU PyTorch·Transformers·PEFT 환경에서 새 D: 실행 폴더를 지정한다.

```powershell
node experiments/narae4-gyomu-v2-20261031/build.cjs D:/Codex/training/narae4-gyomu-reproduction
node D:/Codex/training/narae4-gyomu-reproduction/scripts/evaluate.cjs baseline
python -X utf8 D:/Codex/training/narae4-gyomu-reproduction/scripts/train.py
python -X utf8 D:/Codex/training/narae4-gyomu-reproduction/scripts/export.py
node D:/Codex/training/narae4-gyomu-reproduction/scripts/evaluate.cjs trained
node D:/Codex/training/narae4-gyomu-reproduction/scripts/evaluate.cjs trained --retention
node D:/Codex/training/narae4-gyomu-reproduction/scripts/workflows.cjs --installed
```

실제 학습은 수십 분 걸린다. 기존 실행·어댑터·데이터셋을 덮어쓰지 않는다. 재현 실행의 데이터 해시를 공개된 데이터와 대조하고 기준 평가가 끝난 뒤 optimizer를 실행한다. 실제 학습 보고서에는 변경된 14개 텐서의 L2, 시작/종료 loss, optimizer 횟수, 환경 버전, 어댑터 SHA256이 기록된다. export는 HF 어댑터와 GGUF 14개 텐서가 비트 단위로 일치하는지 검사한다. BF16 학습 본체와 Q4_K_M 추론 본체의 차이는 별도 런타임 평가로 확인한다.

가중치는 이 소스 배포에 포함하지 않는다. 비교 점수와 기능 검증, 설치된 모델 선택은 결과 보고서에 기록하며 합성 통과를 실제 학교 열람·상신 성공으로 안내하지 않는다.

`workflows.cjs --installed`는 실제 설치된 나래4 가중치를 사용한다. 학교 관찰은 가상 도구 응답이며 한글 문서 생성·수정과 그림 입력은 실제 엔진을 사용한다. `--only`는 쉼표로 구분한 특정 사례를 다시 검증한다. 별도 후보의 흐름 시험은 `--installed` 없이 실행해 고유 후보 폴더에 원본 가중치와 새 어댑터를 연결하며 기본 설치를 덮어쓰지 않는다. `tests/neis-model.cjs`는 `NARAE_REAL_MODEL_ROOT`, `NARAE_EVAL_MODEL_ID=narae4`로 같은 설치 가중치를 실제 로컬 가상 나이스 화면에서 검증한다. `NARAE_EVAL_LEAVE_KIND=연가`는 연가, 기본은 조퇴다. 모든 사이트 요청을 가상 호스트에서 처리하고 외부 요청은 차단한다.
