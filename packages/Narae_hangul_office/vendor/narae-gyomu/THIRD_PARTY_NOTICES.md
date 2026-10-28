# 구성요소 출처·이용조건

- 네 사용자 소유 원본 저장소와 커밋: `sources.lock.json`. 원본의 LICENSE·README·소스 헤더를 packages/에 그대로 보관합니다. 업무포털 원본은 별도 코드 라이선스를 지정하지 않았으며, 이 통합 코드의 MIT 조건이 원본의 권리를 확장하지 않습니다.
- 만승교무팩은 영역별 업무 분기·스킬 설치 구조의 참고 자료입니다. 원본 여섯 도구를 이 프로그램에 추가했다고 주장하지 않습니다.
- 나래1 기반 Qwen3-0.6B와 나래3 기반 Qwen3-4B-Instruct-2507: Apache-2.0. 학습된 어댑터와 양자화 원본은 models/catalog.json에 구분합니다. 원본 모델명을 지우지 않습니다.
- 나래2: EXAONE AI Model License Agreement 1.1-NC. 연구·평가 범위이며 `EXAONE`으로 시작하는 실제 파생 모델 이름을 사용합니다. 모델·파생물·출력의 이용 제한은 `licenses/models/EXAONE-3.5-LICENSE.txt`를 따릅니다.
- llama.cpp CPU 실행기: runtime/llama/LICENSE 및 LICENSE-LLVM-OpenMP, 원본 source.json. 배포본의 DLL과 라이선스를 함께 보관합니다.
- Electron: 배포본의 LICENSE·LICENSES.chromium.html과 구성요소 고지를 보관합니다.
- Playwright Core: resources/app/node_modules/playwright-core의 LICENSE·NOTICE.
- Python 3.13.5: python.org의 Windows embeddable 배포본 및 runtime/python/LICENSE.txt. venv·ensurepip는 같은 버전 표준 라이브러리에서 추가했습니다. ._pth에 팩 안의 모듈 경로를 명시하고 사용자 site-packages를 제외하는 -s로 실행합니다.
- PySide6·Shiboken6·Qt 및 Python 의존성: runtime/python/Lib/site-packages의 dist-info 라이선스와 패키지 라이선스를 포함합니다. PySide 배포에 동봉된 Microsoft runtime DLL을 모델 실행기에도 배치했습니다. 각 원래 조건을 유지합니다.

통합 코드의 라이선스와 모델·외부 런타임의 이용조건은 서로 다릅니다. 실제 계정·인증서·WXS Client·충북소통메신저 본체와 한컴오피스는 동봉하지 않습니다.
