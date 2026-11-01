from __future__ import annotations

import ctypes
import os
import subprocess
import time
from ctypes import wintypes
from dataclasses import asdict, dataclass
from pathlib import Path

WIN32_ERRORS: tuple[type[Exception], ...] = ()

if os.name == "nt":
    import pywintypes
    import win32api
    import win32con
    import win32gui
    import win32process

    WIN32_ERRORS = (pywintypes.error,)

    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        ctypes.windll.user32.SetProcessDPIAware()


CHAT_CLASS = "EVA_Window_Dblclk"
INPUT_CLASSES = {"RICHEDIT50W", "RichEdit50W", "RichEditD2DPT"}
MESSAGE_INPUT_ID = 1006
TRANSCRIPT_ID = 100
TRANSCRIPT_CLASS = "EVA_VH_ListControl_Dblclk"


class KakaoError(RuntimeError):
    pass


@dataclass(frozen=True)
class WindowInfo:
    hwnd: int
    title: str
    class_name: str
    width: int
    height: int
    visible: bool
    kind: str
    pid: int | None = None
    executable: str | None = None

    def to_dict(self) -> dict:
        data = asdict(self)
        data["hwnd"] = hex(self.hwnd)
        return data


def require_windows() -> None:
    if os.name != "nt":
        raise KakaoError("kakaocli-win은 Windows에서만 실행할 수 있습니다.")


def enum_children(hwnd: int) -> list[int]:
    children: list[int] = []
    win32gui.EnumChildWindows(hwnd, lambda child, _: children.append(child), None)
    return children


def _input_handles(hwnd: int) -> list[int]:
    candidates = [
        child
        for child in enum_children(hwnd)
        if win32gui.IsWindowVisible(child)
        and (
            win32gui.GetClassName(child) in INPUT_CLASSES
            or "RICHEDIT" in win32gui.GetClassName(child).upper()
        )
    ]
    verified = [child for child in candidates if win32gui.GetDlgCtrlID(child) == MESSAGE_INPUT_ID]
    return verified or candidates


def _transcript_handle(hwnd: int) -> int:
    candidates = [
        child for child in enum_children(hwnd)
        if win32gui.IsWindowVisible(child)
        and win32gui.GetClassName(child) == TRANSCRIPT_CLASS
        and win32gui.GetDlgCtrlID(child) == TRANSCRIPT_ID
    ]
    if len(candidates) != 1:
        raise KakaoError("대화 목록 컨트롤을 하나로 식별하지 못했습니다. `kakaocli inspect --room 방이름`을 실행하세요.")
    return candidates[0]


def classify_window(hwnd: int, title: str, class_name: str) -> str:
    if class_name != CHAT_CLASS:
        return "other"
    if _input_handles(hwnd):
        return "chat"
    return "main" if title in {"", "카카오톡", "KakaoTalk"} else "popup"


def _window_process(hwnd: int) -> tuple[int, str] | None:
    """Resolve the owning executable, rather than trusting a window title/class."""
    try:
        pid = win32process.GetWindowThreadProcessId(hwnd)[1]
        handle = win32api.OpenProcess(0x1000, False, pid)
        try:
            path = ctypes.create_unicode_buffer(32768)
            size = wintypes.DWORD(len(path))
            query = ctypes.windll.kernel32.QueryFullProcessImageNameW
            query.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
            query.restype = wintypes.BOOL
            if not query(int(handle), 0, path, ctypes.byref(size)):
                return None
            if Path(path.value).name.casefold() != "kakaotalk.exe":
                return None
            return pid, path.value
        finally:
            handle.Close()
    except Exception:
        return None


def list_windows() -> list[WindowInfo]:
    require_windows()
    result: list[WindowInfo] = []

    def callback(hwnd: int, _: object) -> None:
        try:
            class_name = win32gui.GetClassName(hwnd)
            title = win32gui.GetWindowText(hwnd)
            if "EVA" not in class_name and "카카오톡" not in title and "KakaoTalk" not in title:
                return
            process = _window_process(hwnd)
            if process is None:
                return
            left, top, right, bottom = win32gui.GetWindowRect(hwnd)
            result.append(
                WindowInfo(
                    hwnd=hwnd,
                    title=title,
                    class_name=class_name,
                    width=max(0, right - left),
                    height=max(0, bottom - top),
                    visible=bool(win32gui.IsWindowVisible(hwnd)),
                    kind=classify_window(hwnd, title, class_name),
                    pid=process[0],
                    executable=process[1],
                )
            )
        except Exception:
            return

    win32gui.EnumWindows(callback, None)
    return sorted(result, key=lambda item: (item.kind, item.title, item.hwnd))


def list_rooms() -> list[WindowInfo]:
    return [
        window
        for window in list_windows()
        if window.kind == "chat" and window.visible and window.title.strip()
    ]


def find_main_window() -> WindowInfo | None:
    candidates = [
        window
        for window in list_windows()
        if window.kind == "main" and window.width > 0 and window.height > 0
    ]
    return max(candidates, key=lambda item: item.width * item.height, default=None)


def find_room(room: str, *, exact: bool = False) -> WindowInfo | None:
    needle = room.casefold().strip()
    if not needle:
        raise KakaoError("채팅방 이름은 비어 있을 수 없습니다.")
    matches = []
    for window in list_rooms():
        title = window.title.casefold().strip()
        if (exact and title == needle) or (not exact and needle in title):
            matches.append(window)
    if len(matches) > 1:
        names = ", ".join(repr(item.title) for item in matches)
        hint = "동일한 제목의 창을 하나만 열어 두세요." if exact else "--exact를 사용하세요."
        raise KakaoError(f"채팅방 이름이 여러 개와 일치합니다: {names}. {hint}")
    return matches[0] if matches else None


def _focus(hwnd: int) -> None:
    root = win32gui.GetAncestor(hwnd, win32con.GA_ROOT) or hwnd
    _assert_window_enabled(root)
    win32gui.ShowWindow(root, win32con.SW_SHOW)
    win32gui.ShowWindow(root, win32con.SW_RESTORE)
    current_tid = win32api.GetCurrentThreadId()
    target_tid = win32process.GetWindowThreadProcessId(hwnd)[0]
    attached = False
    try:
        if current_tid != target_tid:
            attached = bool(ctypes.windll.user32.AttachThreadInput(current_tid, target_tid, True))
        ctypes.windll.user32.BringWindowToTop(root)
        ctypes.windll.user32.SetForegroundWindow(root)
        ctypes.windll.user32.SetFocus(hwnd)
    finally:
        if attached:
            ctypes.windll.user32.AttachThreadInput(current_tid, target_tid, False)
    _wait_for_focus(hwnd, root=root)


def _press(vk: int, modifiers: tuple[int, ...] = ()) -> None:
    for modifier in modifiers:
        win32api.keybd_event(modifier, 0, 0, 0)
    win32api.keybd_event(vk, 0, 0, 0)
    win32api.keybd_event(vk, 0, win32con.KEYEVENTF_KEYUP, 0)
    for modifier in reversed(modifiers):
        win32api.keybd_event(modifier, 0, win32con.KEYEVENTF_KEYUP, 0)


def _focused_handle(hwnd: int) -> int:
    class GuiThreadInfo(ctypes.Structure):
        _fields_ = [
            ("cbSize", wintypes.DWORD),
            ("flags", wintypes.DWORD),
            ("hwndActive", wintypes.HWND),
            ("hwndFocus", wintypes.HWND),
            ("hwndCapture", wintypes.HWND),
            ("hwndMenuOwner", wintypes.HWND),
            ("hwndMoveSize", wintypes.HWND),
            ("hwndCaret", wintypes.HWND),
            ("rcCaret", wintypes.RECT),
        ]

    info = GuiThreadInfo(cbSize=ctypes.sizeof(GuiThreadInfo))
    tid = win32process.GetWindowThreadProcessId(hwnd)[0]
    if not ctypes.windll.user32.GetGUIThreadInfo(tid, ctypes.byref(info)):
        raise KakaoError("입력 포커스를 확인하지 못했습니다. 전송하지 않았습니다.")
    return int(info.hwndFocus or 0)


def _assert_process_target(hwnd: int, *, root: int | None = None, pid: int | None = None) -> int:
    actual_root = win32gui.GetAncestor(hwnd, win32con.GA_ROOT) or hwnd
    root = actual_root if root is None else root
    process = _window_process(root)
    child_process = _window_process(hwnd)
    if (
        actual_root != root
        or process is None
        or child_process is None
        or child_process[0] != process[0]
        or (pid is not None and process[0] != pid)
    ):
        raise KakaoError("입력 대상이 카카오톡 창인지 확인하지 못했습니다. 전송하지 않았습니다.")
    return root


def _assert_target(hwnd: int, *, root: int | None = None, pid: int | None = None) -> None:
    root = _assert_process_target(hwnd, root=root, pid=pid)
    if win32gui.GetForegroundWindow() != root or _focused_handle(hwnd) != hwnd:
        raise KakaoError("카카오톡 입력 대상의 포커스가 바뀌었습니다. 전송하지 않았습니다.")


def _assert_window_enabled(hwnd: int) -> None:
    if not win32gui.IsWindowEnabled(hwnd):
        raise KakaoError("카카오톡 창에 모달 대화상자가 열려 있습니다. 저장 또는 닫기를 먼저 완료하세요.")


def _wait_for_focus(hwnd: int, *, root: int, timeout: float = 0.8) -> None:
    """Allow activation to settle before any input, without reissuing input."""
    deadline = time.monotonic() + timeout
    stable_since: float | None = None
    while True:
        _assert_process_target(hwnd, root=root)
        _assert_window_enabled(root)
        now = time.monotonic()
        foreground = win32gui.GetForegroundWindow() == root
        focused = hwnd == root or _focused_handle(hwnd) == hwnd
        if foreground and focused:
            stable_since = now if stable_since is None else stable_since
            if now - stable_since >= 0.05:
                return
        else:
            stable_since = None
        if now >= deadline:
            raise KakaoError("카카오톡 대상 창의 포커스가 안정되지 않았습니다. 입력하지 않았습니다.")
        time.sleep(min(0.025, deadline - now))


def _assert_room_title(window: WindowInfo) -> None:
    if win32gui.GetWindowText(window.hwnd) != window.title:
        raise KakaoError("대상 채팅방의 제목이 바뀌었습니다. 전송하지 않았습니다.")


def _read_input_text(hwnd: int) -> str:
    # GetWindowText cannot read another process's edit control reliably.
    # WM_GETTEXT is a system message, so Windows marshals its text buffer.
    length = win32gui.SendMessage(hwnd, win32con.WM_GETTEXTLENGTH, 0, 0)
    if length < 0 or length > 1_000_000:
        raise KakaoError("입력창의 기존 초안을 안전하게 확인하지 못했습니다.")
    buffer = ctypes.create_unicode_buffer(max(1024, length + 2))
    read = ctypes.windll.user32.SendMessageW
    read.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    read.restype = ctypes.c_ssize_t
    copied = read(hwnd, win32con.WM_GETTEXT, len(buffer), ctypes.addressof(buffer))
    if copied < 0 or (length and not copied) or copied >= len(buffer) - 1:
        raise KakaoError("입력창의 기존 초안을 안전하게 확인하지 못했습니다.")
    return buffer.value


def _ensure_empty_input(hwnd: int) -> None:
    if _read_input_text(hwnd):
        raise KakaoError("입력창에 기존 초안이 있습니다. 직접 보관하거나 지운 뒤 다시 실행하세요.")


def _same_text(actual: str, expected: str) -> bool:
    # RichEdit may expose LF, CRLF, or CR for the same displayed line breaks.
    return actual.replace("\r\n", "\n").replace("\r", "\n") == expected.replace("\r\n", "\n").replace("\r", "\n")


def _set_text(hwnd: int, text: str) -> bool:
    _assert_target(hwnd)
    _ensure_empty_input(hwnd)
    win32gui.SendMessage(hwnd, win32con.WM_SETTEXT, 0, text)
    actual = _read_input_text(hwnd)
    if _same_text(actual, text):
        return True
    if actual:
        return False

    # Recent KakaoTalk RichEdit controls can reject WM_SETTEXT while still
    # accepting the normal RichEdit replace-selection operation.
    _assert_target(hwnd)
    _ensure_empty_input(hwnd)
    win32gui.SendMessage(hwnd, win32con.EM_REPLACESEL, True, text)
    actual = _read_input_text(hwnd)
    if _same_text(actual, text):
        return True
    if actual:
        return False

    # Never select-all and overwrite a draft. A fallback may type only into an
    # empty, verified control; accepted key events alone do not confirm text.
    _assert_target(hwnd)
    _ensure_empty_input(hwnd)
    if not _send_unicode_input(text):
        return False
    return _same_text(_read_input_text(hwnd), text)


def _send_unicode_input(text: str) -> bool:
    """Type Unicode text through SendInput without touching the clipboard."""
    ulong_ptr = ctypes.c_ulonglong if ctypes.sizeof(ctypes.c_void_p) == 8 else ctypes.c_ulong

    class KeyboardInput(ctypes.Structure):
        _fields_ = [
            ("wVk", ctypes.c_ushort),
            ("wScan", ctypes.c_ushort),
            ("dwFlags", ctypes.c_ulong),
            ("time", ctypes.c_ulong),
            ("dwExtraInfo", ulong_ptr),
        ]

    class MouseInput(ctypes.Structure):
        _fields_ = [
            ("dx", ctypes.c_long),
            ("dy", ctypes.c_long),
            ("mouseData", ctypes.c_ulong),
            ("dwFlags", ctypes.c_ulong),
            ("time", ctypes.c_ulong),
            ("dwExtraInfo", ulong_ptr),
        ]

    class HardwareInput(ctypes.Structure):
        _fields_ = [
            ("uMsg", ctypes.c_ulong),
            ("wParamL", ctypes.c_ushort),
            ("wParamH", ctypes.c_ushort),
        ]

    class InputUnion(ctypes.Union):
        _fields_ = [
            ("ki", KeyboardInput),
            ("mi", MouseInput),
            ("hi", HardwareInput),
        ]

    class Input(ctypes.Structure):
        _anonymous_ = ("union",)
        _fields_ = [("type", ctypes.c_ulong), ("union", InputUnion)]

    key_events = []
    encoded = text.encode("utf-16-le")
    for offset in range(0, len(encoded), 2):
        unit = int.from_bytes(encoded[offset : offset + 2], "little")
        key_events.append(Input(1, InputUnion(ki=KeyboardInput(0, unit, 0x0004, 0, 0))))
        key_events.append(Input(1, InputUnion(ki=KeyboardInput(0, unit, 0x0006, 0, 0))))
    if not key_events:
        return True
    inputs = (Input * len(key_events))(*key_events)
    sent = ctypes.windll.user32.SendInput(len(inputs), inputs, ctypes.sizeof(Input))
    return sent == len(inputs)


def _resolve_room(room: str, *, exact: bool) -> WindowInfo:
    existing = find_room(room, exact=exact)
    if existing:
        return existing

    from .background import ensure_room

    return ensure_room(room, exact=exact)


def open_room(room: str, *, exact: bool = False, timeout: float = 3.0, interactive: bool = False) -> WindowInfo:
    window = _resolve_room(room, exact=exact)
    if interactive:
        _focus(window.hwnd)
    return window


def _prepare_send(room: str, *, exact: bool = True) -> tuple[WindowInfo, int]:
    """Resolve and inspect the target without focusing or changing its draft."""
    window = _resolve_room(room, exact=exact)
    inputs = [
        hwnd for hwnd in _input_handles(window.hwnd)
        if win32gui.GetDlgCtrlID(hwnd) == MESSAGE_INPUT_ID
    ]
    if len(inputs) != 1:
        raise KakaoError("메시지 입력창(ID 1006)을 하나로 식별하지 못했습니다.")
    input_hwnd = inputs[0]
    _assert_process_target(input_hwnd, root=window.hwnd, pid=window.pid)
    _ensure_empty_input(input_hwnd)
    _assert_room_title(window)
    return window, input_hwnd


def preview_send(room: str, *, exact: bool = True) -> dict:
    window, input_hwnd = _prepare_send(room, exact=exact)
    return {
        "target_ready": True,
        "draft_present": False,
        "target": window.to_dict(),
        "input_hwnd": hex(input_hwnd),
    }


def send_message(room: str, message: str, *, exact: bool = True, interactive: bool = False) -> WindowInfo:
    if not message.strip() or "\x00" in message:
        raise KakaoError("빈 메시지는 전송할 수 없습니다.")
    if not interactive:
        from .background import send_message as background_send

        return background_send(room, message, exact=exact)
    window, input_hwnd = _prepare_send(room, exact=exact)
    _focus(input_hwnd)
    _assert_target(input_hwnd, root=window.hwnd, pid=window.pid)
    _ensure_empty_input(input_hwnd)
    _assert_room_title(window)
    if not _set_text(input_hwnd, message):
        raise KakaoError("메시지 입력에 실패했습니다. 전송하지 않았습니다.")
    _assert_target(input_hwnd, root=window.hwnd, pid=window.pid)
    if not _same_text(_read_input_text(input_hwnd), message):
        raise KakaoError("입력 내용이 전송 직전에 바뀌었습니다. 전송하지 않았습니다.")
    _assert_room_title(window)
    _press(win32con.VK_RETURN)
    time.sleep(0.2)
    remaining = _read_input_text(input_hwnd)
    if remaining:
        raise KakaoError("Enter 입력 후에도 메시지가 남아 있습니다. 전송 여부를 직접 확인하세요.")
    return window


def read_visible(room: str, *, exact: bool = False, timeout: float = 1.5, interactive: bool = False) -> tuple[WindowInfo, str]:
    if not interactive:
        from .background import read_visible as background_read

        return background_read(room, exact=exact, timeout=timeout)
    import win32clipboard

    window = open_room(room, exact=exact)
    target = _transcript_handle(window.hwnd)
    _focus(target)
    _assert_target(target, root=window.hwnd, pid=window.pid)
    sequence = ctypes.windll.user32.GetClipboardSequenceNumber()
    _press(ord("A"), (win32con.VK_CONTROL,))
    _assert_target(target, root=window.hwnd, pid=window.pid)
    _press(ord("C"), (win32con.VK_CONTROL,))

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if ctypes.windll.user32.GetClipboardSequenceNumber() != sequence:
            break
        time.sleep(0.05)
    else:
        raise KakaoError("화면의 대화 내용을 복사하지 못했습니다.")

    try:
        win32clipboard.OpenClipboard()
        text = win32clipboard.GetClipboardData(win32con.CF_UNICODETEXT)
    except Exception as exc:
        raise KakaoError("클립보드에서 대화 텍스트를 읽지 못했습니다.") from exc
    finally:
        try:
            win32clipboard.CloseClipboard()
        except Exception:
            pass
    return window, text.strip()


def inspect_tree(room: str | None = None) -> list[dict]:
    window = find_room(room) if room else find_main_window()
    if not window:
        raise KakaoError("검사할 카카오톡 창을 찾지 못했습니다.")
    rows = []
    for child in enum_children(window.hwnd):
        left, top, right, bottom = win32gui.GetWindowRect(child)
        rows.append(
            {
                "hwnd": hex(child),
                "class_name": win32gui.GetClassName(child),
                "control_id": win32gui.GetDlgCtrlID(child),
                "text": win32gui.GetWindowText(child),
                "visible": bool(win32gui.IsWindowVisible(child)),
                "rect": [left, top, right, bottom],
            }
        )
    return rows


def find_executable() -> Path | None:
    require_windows()
    candidates = [
        Path(os.environ.get("ProgramFiles(x86)", "")) / "Kakao" / "KakaoTalk" / "KakaoTalk.exe",
        Path(os.environ.get("ProgramFiles", "")) / "Kakao" / "KakaoTalk" / "KakaoTalk.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Kakao" / "KakaoTalk" / "KakaoTalk.exe",
    ]
    return next((path for path in candidates if path.is_file()), None)


def start_kakaotalk() -> Path:
    executable = find_executable()
    if not executable:
        raise KakaoError("KakaoTalk.exe를 찾지 못했습니다. PC 카카오톡을 먼저 설치하세요.")
    subprocess.Popen([str(executable)], close_fds=True)
    return executable


def doctor() -> dict:
    require_windows()
    executable = find_executable()
    windows = list_windows()
    main = find_main_window()
    rooms = list_rooms()
    return {
        "ok": bool(main),
        "platform": os.name,
        "executable": str(executable) if executable else None,
        "installed": executable is not None,
        "running": bool(windows),
        "main_window_found": main is not None,
        "open_rooms": [room.title for room in rooms],
        "next": (
            "준비 완료"
            if main
            else "PC 카카오톡을 설치하고 로그인한 뒤 메인 창을 열어 두세요."
        ),
    }
