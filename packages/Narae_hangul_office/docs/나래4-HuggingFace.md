# 나래4 v1 Hugging Face 공개 — 2026-11-01

[inhow/Narae4-Qwen3.5-2B-Office-LoRA-v1](https://huggingface.co/inhow/Narae4-Qwen3.5-2B-Office-LoRA-v1)에 공개했다. 2026-11-02 판단기를 추가한 고정 revision은 `9710629d49829edf462680278b94f282b8b5b480`이다. 가중치·모델 카드·라이선스·해시·공개 평가 요약 14개 파일을 올리고 서버 크기·LFS SHA256을 검사했으며, 공개 주소에서 GGUF 어댑터를 다시 받아 해시 일치를 확인했다.

공개 파일은 약 3.05GB이다. 실제 학습한 v1의 GGUF 어댑터와 PEFT Safetensors, 어댑터 설정, 변경하지 않은 Qwen Q4_K_M 본체와 F16 시각 프로젝터, d1 Q4_K_M 판단기를 포함한다. 학습한 파라미터는 638,976개, 텐서는 14개, optimizer update는 16회다. 후속 v2 후보를 채택하거나 새 학습을 수행한 공개가 아니다.

본체와 프로젝터는 원본 Unsloth 저장소의 동일 해시 파일이며 Qwen의 Apache-2.0 원문과 출처를 유지한다. LiquidAI/d1-2B 판단기도 테스트에 사용한 원본과 동일한 해시로 함께 배포한다. 판단기에는 `D1-LICENSE`의 LFM Open License v1.0이 별도로 적용되며, 모델 카드와 `COMPONENT_LICENSES.md`에 파일별 라이선스를 표시했다. 판단기는 사전학습 원본을 사용했고 나래에서 추가 학습하지 않았다. 이 구성은 공동 학습 sparse MoE가 아니다.

## 설치

오피스 preview.25 이상에서 설정 → AI 연결 → 로컬 AI → 나래4 설치를 사용한다. `resources/local-models.json`의 네 구성요소 모두 같은 공개 저장소와 revision으로 고정했으며, 본체·어댑터·프로젝터·판단기 네 파일을 함께 받고 각각 크기와 SHA256을 검사한다. 실행할 때 필요한 판단기만 선택적으로 호출한다. 기존 PC에 설치한 가중치는 변경하지 않는다. 라이선스와 실행기 조건은 모델 카드를 따른다.

2026-11-02 기본 AI를 나래4로 지정했다. 새 설치는 로컬 나래4가 선택되며, 로컬 모델 목록에 나래1·2·3·4를 표시하고 나래4에 ‘기본 모델’을 표시한다. 기존에 명시한 모델·클라우드·외부 로컬 서버 선택은 보존한다. 미설치 모델을 선택했다는 이유로 자동 다운로드하거나 설치 완료로 표시하지 않는다.

## 재배포

Python `huggingface_hub`가 있는 배포 환경과 등록된 로컬 Hugging Face 로그인으로 다음 스크립트를 사용한다. 토큰을 명령 인자나 대화에 넣지 않는다.

```powershell
python scripts/publish-narae4.py --namespace inhow --prepare-only
python scripts/publish-narae4.py --namespace inhow --update-catalog
```

`--models`, `--training`, `--staging`으로 로컬 폴더를 지정할 수 있다. 기본 저장 위치는 D:\Codex이다. 공개 파일은 명시한 허용 목록으로 제한하고 학습 보고서·내보내기·실제 파일의 해시를 대조한다. 실제 학교 문서·세션·스크린샷·대화·인증정보·실서비스 로그는 포함하지 않는다.

모델 단독 홀드아웃 7/8 전후 동일과 실행기를 포함한 품의 시험 20단계 성공을 별도로 기재했다. 최근 실행기 보완은 가중치 개선 성과로 계산하지 않는다. 원본 학습 기록은 [학습·실행 검증](나래4-검증.md), 품의 실행 검증은 [학교회계](school-accounting.md)를 따른다.
