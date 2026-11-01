# REA 카카오톡 분석 기록

Windows CLI 0.5.0의 분석·구현 근거입니다. 대상은 로컬에 설치된 Windows 카카오톡 **26.9.0.5337 / PE32+ AMD64**입니다. 도구는 [morluto/rea](https://github.com/morluto/rea)의 npm `rea-agents` 6.8.0, Node 24.22.1, Rizin 0.9.1과 Frida입니다. 분석일은 2026-10-29, 시간대는 Asia/Seoul입니다.

아래 식별자와 주소는 분석한 실행 파일에 대한 기록입니다. 공개 문서에는 실제 사용자·방 이름·대화·캡처·첨부 경로와 내용을 포함하지 않습니다.

## 0.6.0 사진·파일 전송 추가 검증 (2026-10-30)

Windows 26.9.0.5337/x64에서 사진과 일반 파일의 첨부 미리보기 생성, 소유 대화방 대조, OCR 제목·전송 버튼 검사와 취소 후 창 복구를 확인했습니다. 사용자에게 명시적으로 승인받은 사진 한 장을 설치된 0.6.0 CLI로 실제 제출한 뒤 같은 대화방의 첨부 목록과 캡처에 새 사진 한 건이 표시됨을 확인했습니다. 전경 창은 유지되었습니다. 일반 파일은 미리보기와 취소까지만 실검증했습니다. 기본 전송 결과는 `submitted_unconfirmed`이며 서버 전달·상대 수신을 확정하지 않습니다.

사진은 대상 입력창의 Ctrl+V 핸들러에 동기 메시지를 보내 `CF_DIB` 미리보기를 생성합니다. 비동기 키 메시지의 문자 변환으로 입력란에 글자가 남을 수 있는 경로를 피하고 원래 초안이 같은지 재검사합니다. 파일은 96 DPI에서 검증한 파일 버튼으로 시작하고, 해당 대화방이 소유한 `GetOpenFileNameW` 호출 한 곳에 선택 경로를 반환합니다.

전송 미리보기는 화면 밖에서 비활성 표시하고 렌더링 완료를 기다립니다. 제목·파일 이름과 하단 버튼은 확대·이진화한 로컬 Windows OCR로 확인합니다. 검사 동안에도 Frida의 프로세스 한정 활성화 방지 경계를 유지하며, 검증 실패 시 새 미리보기의 닫기 버튼으로 취소합니다. 파일 이름이 잘리거나 다른 배율·버전의 UI는 검증 실패로 처리합니다. 실제 사용자 자료는 저장소에 포함하지 않습니다.

`CF_DIB` 형식은 [Microsoft의 표준 클립보드 형식 문서](https://learn.microsoft.com/en-us/windows/win32/dataxchg/standard-clipboard-formats)를 참조했습니다.

## 초기 관찰 근거

| 질문 | 관찰 | REA Evidence |
| --- | --- | --- |
| 분석 대상 식별 | 파일 버전 26.9.0.5337, 31,691,368 bytes, PE32+ AMD64 | `ev_aa8a05b12da0192efb6b338956d51dc405ad5134f213d00e3a73dcff9465be3c` |
| 파일 보호 구조 | `.vm_sec`, `.themida`, `.boot` 섹션이 존재. 지정 UI 문자열의 정적 검색은 결과 없음 | `ev_8e00290dacae34c54caba36ba4109f135afbb0e5c947b57ad515b2a46e132b05` |
| 실행 중인 앱 구조 | Frida가 `KakaoTalk.exe`, x64, 이미지 베이스 `0x140000000`을 반환 | `ev_13392033d60daa89fe53b38c2c7b0d6823bad7cb75f924b8991c879d33887f1c` |
| 입력창 선택 | `RICHEDIT50W`, control ID 1006, visible=true | 같은 런타임 Evidence |
| 대화 목록 선택 | `EVA_VH_ListControl_Dblclk`, control ID 100, visible=true | 같은 런타임 Evidence |
| 런타임 문자열 | `EVA_Window_Dblclk` RVA `0x2e6be48`, `RICHEDIT50W` RVA `0x271fa40`, `ChatRoomListView` RVA `0x295bfb8` 및 `0x295c1e0` | 같은 런타임 Evidence |
| 관찰 연결 해제 | `cleanup_error=null`, `messages_truncated=false` | 같은 런타임 Evidence |

정적 파일 SHA256은 `5207ec0edffefdc4303fe0fbdf0bc3eaa584af61ffbc0bb1c15e1734e9ca9f5e`입니다. 초기 런타임 Evidence의 subject는 null이며 실행 파일 digest가 직접 연결되어 있지 않습니다. 선택한 PID와 모듈 이름으로 연결했으며 정적·런타임 바이트의 동일성을 증명한 것은 아닙니다.

Rizin은 큰 영역의 기본 문자열 검사 한도 경고도 반환했습니다. 따라서 정적 검색 결과가 비었다는 사실만으로 문자열이나 기능이 없다고 판단하지 않았습니다. 보호 해제나 전체 내부 프로토콜 복원, 전체 프로그램의 Ghidra 디컴파일은 수행하지 않았습니다.

## 0.5.0의 백그라운드 동작

`background_driver.mjs`가 REA에 포함된 Frida 런타임으로 대상 `KakaoTalk.exe`에 연결하고, `background_agent.js`를 작업 동안만 로드합니다. 창의 클래스·제목뿐 아니라 소유 프로세스와 PID도 검사합니다. 입력란은 관찰한 ID 1006, 대화 목록은 ID 100으로 고릅니다.

전역 키보드·마우스 입력을 발생시키는 대신 대상 컨트롤에 메시지를 보내고, 해당 카카오톡 프로세스 내부에서만 포커스·활성 창·수정키 상태를 일시적으로 가상화합니다. 새로 만들어지는 대상 창의 표시·위치를 제어해 사용자가 작업하던 전경 창을 유지합니다. 완료·오류 경로에서 스크립트 해제와 Frida 분리를 시도하며, 연결 해제 오류와 전경 유지 여부를 결과에 남깁니다.

`read`, `messages`, `search`는 백그라운드에서 대화 목록의 로드된 내용을 복사합니다. 클립보드 시퀀스가 예상과 다르면 잘못된 내용을 읽지 않도록 중단합니다. 이 방식도 클립보드는 바꾸며, 전체 대화 DB나 아직 로드되지 않은 과거 메시지를 조회하는 방식은 아닙니다.

`send`는 기존 초안을 보존하고 입력 후 내용을 다시 읽어 확인한 뒤 제출합니다. 방 제목·대상·입력이 달라졌거나 모달창이 작업을 막으면 진행하지 않습니다. 결과 `submitted_unconfirmed`는 제출 관찰이며 서버 전달·상대 수신을 증명하지 않습니다.

## 닫힌 방의 검색과 대상 검증

REA 런타임 관찰에서 `ChatRoomListView_`, `ChatRoomListCtrl_`, `SearchListCtrl_`와 검색 Edit 컨트롤을 확인했습니다. 검색 목록은 그려진 표시 이름을 일반 Win32 텍스트 조회로 제공하지 않아 결과의 실제 화면을 별도로 읽어야 했습니다.

구현은 채팅 검색어를 설정한 뒤 `PrintWindow`로 메인 창을 캡처하고, `Windows.Media.Ocr`로 표시 이름과 단어 좌표를 로컬에서 읽습니다. 설치된 한국어 인식기를 우선 사용하며 Windows PowerShell 5의 WinRT 비동기 브리지를 숨김 실행합니다. OCR 과정에는 앱 제어·클라우드 전송·모델 또는 언어팩 다운로드가 없습니다.

요청 문자열과 일치하는 결과를 한 개로 식별한 경우에만 그 행을 선택합니다. 짧은 검색어가 더 긴 표시 이름을 찾더라도 그 표시 이름을 canonical 제목으로 삼고, 실제로 열린 창의 제목과 완전히 같은지 다시 검사합니다. 검색어가 바뀌었거나 결과가 없거나 여러 개이거나 창 제목이 다르면 중단합니다. 작업 후 이전 검색어를 복원합니다. 이 검색·제목 검증 흐름은 실제 Windows 앱에서 확인했습니다.

OCR은 잘못 인식할 수 있으므로 후보를 임의로 고르거나 이름을 추정하지 않습니다. 해당 카카오톡 버전의 검색 결과 배치와 표시 상태에 의존하며, 결과를 하나로 검증하지 못하면 사용자가 정확한 표시 이름을 지정해야 합니다.

## 첨부파일과 저장창 경계

`attachments`는 복사된 로드 대화의 사진·파일 표시를 분류합니다. `capture`는 대상 창의 PNG를 `PrintWindow`로 저장합니다. 캡처 이미지는 사진·문서 원본이 아니며 이를 원본 첨부라고 보고하지 않습니다.

REA로 확인한 PE의 `GetSaveFileNameW` 경계에서 선택한 저장 경로를 반환하도록 구현했습니다. 기본 다운로드는 **저장 모달창을 만들지 않고** 카카오톡 자체의 원본 저장 동작을 이어 갑니다. 대상 방의 사진 썸네일 또는 해당 사진 뷰어의 저장 동작을 사용합니다. Windows x64의 `OPENFILENAMEW` 구조와 관찰한 카카오톡 구현에 의존합니다.

현재 검증한 Windows 버전에서 사진 원본 파일의 생성·크기 안정화·SHA256과 전경 창 유지를 실제로 확인했습니다. 이 검증이 모든 파일 형식이나 다른 카카오톡 버전에서의 성공을 뜻하지는 않습니다.

파일 첨부는 `download --kind file --at X Y`로 **첨부의 저장 버튼**을 지정합니다. 좌표는 대상 방을 `capture`한 이미지의 왼쪽 위 기준이며, 대화 영역 밖의 좌표를 거부합니다. 파일 이름 표시나 임의의 본문 위치를 저장 버튼으로 추정하지 않습니다.

이미 열린 저장창은 방·프로세스 소유 관계를 검사한 뒤 경로 입력과 고유한 저장 버튼을 확인해 먼저 완료합니다. 완료를 확인하지 못한 상태에서 다른 작업으로 넘어가지 않습니다. 새 다운로드의 기본 방식과 기존 저장창 복구 방식은 별도 경로입니다. 동일한 파일은 덮어쓰지 않으며 지정한 출력 폴더 밖의 결과도 거부합니다.

## 로컬 분석과 macOS

`analyze`는 로컬 파일의 MIME·용량·SHA256과 제한된 텍스트를 반환합니다. 이미지 검증·경로 제공, PDF 텍스트와 첫 3쪽 미리보기, DOCX/HWPX XML 텍스트, XLSX 셀·저장 수식을 지원합니다. 잘린 출력·부분 추출·미지원 형식을 구분하며 매크로·수식·첨부 코드·외부 링크를 실행하지 않습니다. 실제 이미지 의미 해석은 반환된 이미지를 열어 보는 어시스턴트의 후속 작업입니다.

`macos/`는 별도의 JXA/System Events Accessibility 어댑터입니다. 앱 활성화·최상단 전환·전역 키 입력 없이 AX 트리 읽기, 고유 입력란과 Send AXPress를 통한 명시적 제출, 이미 열린 소유 Save sheet 처리와 공통 로컬 분석을 구현했습니다. **모의 AX 테스트와 소스 검사만 수행했으며 실제 macOS 권한·카카오톡 호환성은 미검증입니다.** Windows 후킹·닫힌 방 OCR 검색·저장 API 경계를 macOS에 그대로 적용했다고 주장하지 않습니다.

## 검증과 보관

Ubuntu 24.04.5/WSL2를 별도로 준비해 공통 첨부 분석과 Linux 테스트 131개를 실제 Linux Python에서 통과했습니다. Wine 9.0 및 공식 WineHQ 11.0의 x64 실행기로 Windows Python 3.11.9·pywin32·Pillow와 Wine 에이전트 호출을 확인했습니다. 인증된 전용 Xvfb/Openbox 화면과 PNG 캡처도 확인했습니다. WSLg가 파일 시스템 소켓을 만들지 못해도 연결되는 경우가 있어, 가상 화면 준비 검사는 `xdpyinfo`의 실제 접속으로 바꿨습니다. Wine 첫 초기화의 Mono/Gecko 설치 팝업은 초기화 subprocess에서만 비활성화하고, 완료 후 앱을 시작합니다. 완료된 prefix에서는 불필요한 `wineboot -u` 갱신을 반복하지 않습니다.

카카오톡 26.9.0.5337/x64는 Wine 9에서 Themida의 `Wrong DLL present` 오류로 로그인 전에 막혔고, Wine 11만 적용한 새 prefix에서도 창이 확인되지 않았습니다. Wine 11에 네이티브 Visual C++ 14.50.35710.0의 `msvcp140`, `msvcp140_1`, `msvcp140_2`, `vcruntime140`, `vcruntime140_1`, `concrt140`을 적용한 뒤 **실제 카카오톡 초기 약관 화면이 렌더링되는 것을 확인했습니다.**

이후 공식 WineHQ 11.0의 amd64/i386 패키지와 새 prefix에서 Microsoft 공식 재배포 원본 14.51.36247.0으로 다시 확인했습니다. Burn 설치 EXE 직접 실행은 page fault로 실패했습니다. 배포 설치기는 이를 실행하지 않고 `native_crt.py`와 `cabextract`로 여섯 AMD64 DLL만 추출·검증해 카카오톡 폴더에 배치합니다. 이 경로로도 실제 초기 약관 화면과 Wine 에이전트 진단이 정상 동작했습니다. Windows PC의 런타임 DLL을 복사할 필요가 없습니다. 검사한 Microsoft 원본 SHA256은 `843068991daaa1f73ad9f6239bce4d0f6a07a51f18c37ea2a867e9beca71295c`입니다. CAB에서 네이티브 CRT를 추출하는 기존 호환 처리도 [Winetricks 소스](https://github.com/Winetricks/winetricks/blob/master/src/winetricks)의 `load_vcrun2026`에서 확인할 수 있습니다.

새 테스트 prefix에서도 카카오톡 실행 파일의 버전 26.9.0.5337과 SHA256이 위 Windows 분석 원본과 같음을 확인했습니다. 전용 wineserver를 포함한 종료와 재시작 후 앱 창 진단도 실제 환경에서 확인했습니다. 전체 Windows 회귀 게이트는 272개 테스트와 개인정보 점검을 통과했습니다. 프로그램·런타임 바이너리와 계정 데이터는 공개 저장소에 배포하지 않습니다.

초기 화면에서 실제 Wine 에이전트가 `ok=true`, `main_window_found=true`, `ready_for_chats=false`, `login_state=setup_or_login_required`를 반환하는 것도 확인했습니다. 약관 승인이나 계정 로그인·모바일 인증은 수행하지 않았으며, Linux에서 로그인 후 대화 조회·전송 성공을 주장하지 않습니다. 설치 스크립트 전체의 새 서버 설치와 다른 Wine·카카오톡 조합까지 검증한 것은 아닙니다.

Windows에서는 백그라운드 대화 복사, 검색 결과의 전체 방 제목 검증, 저장창 없는 사진 원본 저장을 실제 앱으로 확인했습니다. macOS의 실제 앱 호환성과 Ubuntu Wine에서의 카카오 계정 로그인·전송은 아직 검증하지 않았습니다.

`linux/`는 Ubuntu 서버 자체에서 카카오톡을 실행하는 Wine/Xvfb 어댑터입니다. 전용 prefix·가상 화면·Xauthority를 사용하고, Wine 안의 Windows Python 에이전트와 호스트 Python CLI가 로컬 JSON으로 통신합니다. 외부 Windows PC나 SSH 실행에 의존하지 않습니다. 에이전트는 실제 Wine의 `wine_get_version`과 격리 플래그를 모두 검사하며 네이티브 Windows에서 실행하면 앱 제어 전에 거부합니다.

검색 결과는 호스트의 한국어/영어 Tesseract로 읽고 제목을 다시 확인합니다. Win32 포커스·복사·입력·저장 모달은 전용 가상 화면 안에서만 처리합니다. 명령 전체를 프로세스 간 lock으로 직렬화하고, 저장 완료·크기 안정화·SHA256 및 원본 파일 경로를 검증합니다. Wine의 특정 카카오톡 버전 호환성과 계정 로그인 성공은 단위 테스트로 증명할 수 없습니다. 실제 검증 결과를 확인해야 하며, 인증 없는 설치·실행 상태를 로그인 성공이라고 보고하지 않습니다.

회귀 테스트는 합성 데이터·임시 파일과 모의 Win32/AX 호출을 사용합니다. 실제 앱 검증 자료에는 개인 정보가 포함될 수 있으므로 공개 저장소에 넣지 않습니다. 원본 REA Evidence와 작업 자료는 Git에서 제외된 `work/`에 보관합니다.

`scripts/rea-kakao.ps1`은 초기 정적 분석을 재현하고, `-Runtime`은 `scripts/rea-observe.js`의 읽기 관찰을 수행한 뒤 해제합니다. 이 관찰 스크립트는 메시지 본문·방 이름을 수집하거나 입력·전송·후킹을 수행하지 않습니다. 실제 기본 CLI의 일시적 후킹은 `background_agent.js`에 있습니다. 재실행 시 Evidence ID는 달라질 수 있습니다.

기반 프로젝트의 DB·키 복구 기능은 유지합니다. 이번 UI·첨부 REA 검증을 근거로 모든 로컬 DB가 복호화되거나 전체 메시지 본문이 조회된다고 주장하지 않습니다.

기반 CLI는 [Lee-SiHyeon/kakaocli-win](https://github.com/Lee-SiHyeon/kakaocli-win), MIT입니다. Windows OCR API는 [Microsoft 문서](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine.recognizeasync)에 설명되어 있습니다.

## 현재 계정의 나와의 채팅 식별 (0.6.2)

기존 로컬 DB 중 수정 시간이 가장 최신인 파일이 현재 로그인 계정이라는 가정을 제거했습니다. 현재 카카오톡 소유 창과 실행 파일을 확인한 뒤 그 프로세스의 디스크 파일 핸들만 조회하고, 유일한 chatListInfo.edb와 MemoChat 종류를 연결합니다. 본인 방과 프로세스 생성 시각·계정 파일의 지문을 바인딩합니다. 일반 self-room/send-self에서 메모리 키 복구를 시작하지 않습니다.

메타데이터 조회는 DuplicateHandle의 DUPLICATE_SAME_ACCESS만 사용하며 원본 핸들을 닫지 않습니다. 로컬 복제 핸들을 모두 닫고, 파이프·소켓은 파일명 조회에서 제외합니다. Windows 내부 핸들 자료 형식이 다르거나 권한·개수 한도·계정 식별이 불확실하면 전송하지 않습니다. 합성 파일을 현재 검사 프로세스에서 열어 실제 Windows API가 그 파일 한 개를 식별하는 것을 시험했습니다. 이 시험은 실제 계정의 메시지 발송 성공을 뜻하지 않습니다.

참고: [DuplicateHandle](https://learn.microsoft.com/en-us/windows/win32/api/handleapi/nf-handleapi-duplicatehandle), [GetFileType](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfiletype), [GetFinalPathNameByHandleW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfinalpathnamebyhandlew), [System Informer의 시스템 핸들 자료 정의](https://github.com/winsiderss/systeminformer/blob/master/phnt/include/ntexapi.h). 내부 형식은 Windows x64 호환 범위에서만 사용합니다.
