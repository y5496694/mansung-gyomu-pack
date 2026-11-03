# Third-party components

나래 한글 오피스의 앱 코드는 MIT 라이선스입니다. 외부 구성 요소의 원 저작권과 라이선스는 유지합니다. 한컴오피스 실행 파일·보안 모듈·설치 글꼴·사용자 문서는 배포하지 않습니다.

| Component | License / source |
| --- | --- |
| Narae Hangul engine | MIT, Copyright (c) 2026 인호우. https://github.com/y5496694/narae_hangul — source commit c4ad1460e6b0ead94f7d13814ead8f948470e4fa. `vendor/NARAE_LICENSE` retained. |
| Electron, Node.js, Chromium | MIT and bundled third-party notices. https://github.com/electron/electron — Electron's LICENSE and LICENSES.chromium.html remain in an installed runtime. |
| PySide6, Shiboken6, Qt | LGPL-3.0 / GPL / commercial, per module. Official wheels are downloaded by pip and dynamically loaded from the replaceable virtual environment. https://code.qt.io/cgit/pyside/pyside-setup.git/ and https://download.qt.io/official_releases/QtForPython/ |
| Python | PSF license. https://www.python.org/ |
| pywin32 | Original PSF-derived license. https://github.com/mhammond/pywin32 |
| pypdfium2 / PDFium | Apache-2.0 or BSD-3-Clause (wrapper), BSD-style PDFium and its bundled notices. https://github.com/pypdfium2-team/pypdfium2 |
| pypdf | BSD-3-Clause. https://github.com/py-pdf/pypdf |
| Pillow | HPND. https://github.com/python-pillow/Pillow |
| FontTools | MIT and additional component notices. https://github.com/fonttools/fonttools |
| olefile | BSD-style. https://github.com/decalage2/olefile |
| PyCryptodome | Public domain and BSD-2-Clause. https://www.pycryptodome.org/ |
| lxml | BSD-3-Clause and bundled library notices. https://lxml.de/ |
| cryptography | Apache-2.0 / BSD-3-Clause and bundled notices. https://github.com/pyca/cryptography |
| Anthropic ant CLI | Official unchanged binary 2.3.0 downloaded by the installer; its LICENSE and LICENSE-MIT are retained beside it. https://github.com/anthropics/anthropic-cli/releases/tag/v2.3.0 |

The source archive does not bundle Electron, Python wheels or ant executables. The installer fetches their original distributions and retains their licensing files. Installed Python dependencies are ordinary replaceable modules under `runtime/python/Lib/site-packages`. This application does not statically link Qt or restrict replacement/debugging of its libraries. The entire application source and installation scripts are provided.

## Bundled office integrations

`vendor/narae-gyomu` includes the pinned Narae gyomu orchestrator and original source for CBE_CLI, Narae browser and Narae gyomu portal. Their original LICENSE, notices and source-lock files are retained beside the code. `OFFICE_VENDOR_LOCK.json` records the copied bytes; nested `sources.lock.json` identifies upstream source versions. No school credentials, messages, proprietary messenger or office binaries are distributed. Playwright Core (Apache-2.0) uses an installed compatible browser for the isolated browser integration. See the preserved component notices for their respective authors and terms.

본 제품은 한컴의 HWP 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다. 공개 문서: https://www.store.hancom.com/support/downloadCenter/hwpOwpml

## 선택 설치 로컬 AI

llama.cpp CPU runtime b11960: https://github.com/ggml-org/llama.cpp · MIT. 공식 배포 ZIP과 실행 파일의 SHA256을 검사해 별도로 설치합니다.

모델 가중치는 앱 소스와 별도이며 각 원본 조건을 따릅니다. 나래1·3은 Qwen Apache-2.0, 나래2는 EXAONE 1.1 NC 연구·평가용입니다. 원문 이용조건은 resources/model-licenses 및 각 Hugging Face 모델 저장소의 LICENSE에 유지합니다. 앱의 MIT가 모델 이용조건을 대체하지 않습니다.

나래4는 Qwen3.5-2B 본체와 Office LoRA(Apache-2.0), 별도로 호출되는 LiquidAI/d1-2B 판단기(LFM Open License v1.0)를 사용합니다. 두 모델의 가중치를 합친 sparse MoE는 아닙니다. 각 원문은 resources/model-licenses/Narae4-LICENSE.txt에 유지합니다.

`vendor/kakao-cli` and `vendor/narae-messenger-cli` preserve the MIT-licensed upstream sources and LICENSE files. `vendor/MESSENGER_LOCK.json` pins their commits and SHA256 hashes. The messenger applications, personal messages, captured screens and credential stores are not distributed. Native inspection can use a separately installed REA/Frida runtime; that runtime is not included in these source snapshots.

## 나래톡 서비스 아이콘

`ui/assets/cbe.png`와 `ui/assets/kakao.png`는 각각 이 PC에 설치된 충북소통메신저(CBE Talk)와 카카오톡 실행 파일에서 추출한 원본 서비스 식별 아이콘입니다. 각 서비스의 권리는 해당 권리자에게 있으며 제휴나 서비스 제공 주체를 뜻하지 않습니다. 설치된 CLI 친구 식별에 사용합니다.

나래 무비 메이커 친구 아이콘은 y5496694/narae-movie-maker의 assets/icons/narae.svg (6773dfe5e2af71a33a7f9e3f6c1ef1d365a72e0f)에서 가져왔습니다. 해당 저장소의 MIT LICENSE와 NOTICE를 따릅니다. 선택 설치 기능은 각 원본 저장소·공식 CLI 배포본을 SHA-256으로 확인하며 포함된 원본 라이선스를 함께 보관합니다.


지역 메신저 아이콘(ui/assets/messenger-{goe,gbe,jbe,kwe,gne,jje}.png)은 각 설치된 공식 프로그램의 앱 식별 아이콘입니다. 나래톡의 해당 CLI 친구를 식별하기 위해 사용하며 해당 제품 상표와 아이콘 권리는 원 권리자에게 있습니다. 교육청 메신저 프로그램·설치 파일·개인 캐시는 배포물에 포함하지 않습니다.
