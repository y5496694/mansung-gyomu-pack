---
name: narae-hangul
description: 기존 나래한글 이름으로 요청된 HWP/HWPX 문서 읽기·작성·수정을 나래 한글 오피스 CLI로 연결하는 호환 진입점.
---

# 나래한글 호환 진입점

한컴오피스 한글과 나래 한글 오피스를 설치한다. [나래 한글 오피스 스킬](../narae-hangul-office/SKILL.md)을 읽고 새 CLI로 작업한다. 이 폴더의 `scripts/narae.py run job.json --result result.json`도 같은 오피스 CLI를 실행한다. 구 독립 엔진 실행이나 과거의 무손실·표시 동일성 보장은 적용하지 않는다.

작업 JSON은 [새 작업 명세](references/jobs.md)를 따른다. 편집에는 최신 `expected_input_sha256`, 열린 한글 편집에는 `liveRevision`이 필수다. 기존 호환 이름은 남기되 실제 실행기는 `Narae_hangul_office`다.
