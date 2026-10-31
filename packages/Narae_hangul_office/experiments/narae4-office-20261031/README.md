# 나래4 CPU 학습 재현

이 폴더의 32개 학습 대화와 3개 검증 대화는 합성 자료입니다. 나래3 TRAIN 자료의 7가지 업무 유형과 현재 오피스 도구 계약을 사용합니다. 실제 학교 문서·메시지·학생 정보·인증정보를 포함하지 않습니다. 이전 대화를 줄일 때 ID·경로를 관찰한 맥락이 사라지지 않도록 앞선 도구 결과를 모두 보존했습니다. 최초 ref와 창 핸들도 합성 관찰로 제공합니다.

기준 PC는 Windows x64, i5-13500, RAM 16GB, 전용 GPU 없음입니다. 학습 스크립트는 앞 23개 블록을 BF16으로 동결하고 마지막 블록·출력 헤드·LoRA를 FP32로 계산합니다. 전체 계산과 캐시 계산의 손실 일치 및 미래 토큰 교란 검사를 통과한 후 2에포크, 16개 optimizer update를 실행합니다. 시각 인코더와 d1 판단기 가중치는 학습하지 않습니다.

## 실행

새 실행 폴더를 준비합니다. 이미 있는 실행을 덮어쓰지 않습니다.

```powershell
node experiments/narae4-office-20261031/prepare.cjs D:/Codex/training/narae4-office-reproduction
node D:/Codex/training/narae4-office-reproduction/scripts/download-base.cjs
```

학습에는 Qwen3.5를 지원하는 Windows CPU PyTorch/Transformers/PEFT 환경이 필요합니다. 실제 실행 버전은 학습 결과 보고서에 기록합니다. 이 PC의 학습 환경을 사용하는 예:

```powershell
& D:/Codex/training/narae-sft-20261019/venv/Scripts/python.exe -X utf8 D:/Codex/training/narae4-office-reproduction/scripts/train.py
```

모델 원본은 고정된 Hugging Face revision에서 받아 SHA256을 검사합니다. 캐시와 임시 파일도 실행 폴더 아래에 둡니다. 학습은 CPU 전처리에 시간이 걸리며, 앞부분의 피처를 캐시한 뒤 불필요한 동결 레이어를 해제합니다. `outputs/Narae4-Qwen3.5-2B-Office-LoRA-v1/status.json`과 `events.jsonl`에서 실제 단계를 확인합니다. `training-report.json`에 optimizer update·변경된 텐서·손실·가중치 해시가 있어야 학습 완료입니다.

`export.py`는 이 PC의 llama.cpp 변환기를 사용하고, 저장한 14개 LoRA 텐서와 GGUF 텐서를 비트 단위로 대조합니다. 변환기 경로·해시는 실행 결과에 기록합니다. BF16/FP32 학습과 Q4_K_M 추론의 차이 때문에 GGUF를 실행해 별도로 평가해야 합니다.

`heldout.cjs`는 앱의 실제 도구 명세와 로컬 계획기 형식으로 합성 다음 행동을 평가합니다. 본체 학습 전과 후를 같은 입력으로 비교합니다. 이 평가는 새로운 학교 환경에서의 전체 업무 자율 성공률을 뜻하지 않습니다. 실제 한글 엔진과 실제 에듀파인 조회의 검증 기록을 별도로 확인하세요.

이 폴더에는 모델 가중치·사용자 세션·실서비스 실행 기록을 넣지 않습니다. 학습 자료의 해시는 `datasets/manifest.json`에 있습니다. 앱 연결 방식과 한계는 [나래4 구조](../../docs/나래4-구조.md)를 따릅니다.
