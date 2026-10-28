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

llama.cpp CPU runtime b11669: https://github.com/ggml-org/llama.cpp · MIT. 공식 배포 ZIP과 실행 파일의 SHA256을 검사해 별도로 설치합니다.

모델 가중치는 앱 소스와 별도이며 각 원본 조건을 따릅니다. 나래1·3은 Qwen Apache-2.0, 나래2는 EXAONE 1.1 NC 연구·평가용입니다. 원문 이용조건은 resources/model-licenses 및 각 Hugging Face 모델 저장소의 LICENSE에 유지합니다. 앱의 MIT가 모델 이용조건을 대체하지 않습니다.
