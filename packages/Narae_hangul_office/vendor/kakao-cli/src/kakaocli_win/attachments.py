"""Scoped attachment acquisition; never activate windows or inject global input."""
from __future__ import annotations

import ctypes
import hashlib
import math
import os
import re
import time
import uuid
from datetime import datetime
from pathlib import Path

from . import backend as b
from .transcript import parse_transcript


def _room(name):
    from .background import ensure_room
    window = ensure_room(name, exact=True)
    b._assert_room_title(window)
    return window


def _windows(pid):
    rows = []
    def collect(hwnd, _):
        process = b._window_process(hwnd)
        if process and process[0] == pid:
            rows.append(hwnd)
    b.win32gui.EnumWindows(collect, None)
    return rows


def _viewer(hwnd, window):
    title = b.win32gui.GetWindowText(hwnd)
    return bool(re.fullmatch(re.escape(window.title) + r"\s+\d{4}-\d{2}-\d{2}", title))


def _owned_by_room(hwnd, window):
    seen = set()
    while hwnd and hwnd not in seen:
        seen.add(hwnd)
        if hwnd == window.hwnd or _viewer(hwnd, window):
            process = b._window_process(hwnd)
            return bool(process and process[0] == window.pid)
        hwnd = b.win32gui.GetWindow(hwnd, b.win32con.GW_OWNER)
    return False


def _save_dialogs(window):
    return [h for h in _windows(window.pid)
            if b.win32gui.GetClassName(h) == '#32770'
            and b.win32gui.GetWindowText(h) in {'다른 이름으로 저장', 'Save As'}
            and _owned_by_room(h, window)]


def _only(items, message):
    if len(items) != 1:
        raise b.KakaoError(message)
    return items[0]


def _data_root():
    default = Path('D:/Codex/apps/kakao-cli') if Path('D:/Codex').is_dir() else Path.home() / '.kakao-cli'
    return Path(os.environ.get('KAKAOCLI_DATA_DIR', str(default)))


def _sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def _capture(hwnd, destination):
    """PrintWindow captures the selected window without changing foreground."""
    from PIL import Image
    import win32ui
    left, top, right, bottom = b.win32gui.GetWindowRect(hwnd)
    width, height = right-left, bottom-top
    if width <= 0 or height <= 0:
        raise b.KakaoError('캡처 대상 창의 크기가 유효하지 않습니다.')
    dc = b.win32gui.GetWindowDC(hwnd)
    source = win32ui.CreateDCFromHandle(dc)
    target = source.CreateCompatibleDC()
    bitmap = win32ui.CreateBitmap()
    try:
        bitmap.CreateCompatibleBitmap(source, width, height)
        target.SelectObject(bitmap)
        print_window = ctypes.windll.user32.PrintWindow
        print_window.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint]
        if not print_window(hwnd, target.GetSafeHdc(), 2):
            raise b.KakaoError('백그라운드 창 캡처에 실패했습니다. 창을 활성화하지 않았습니다.')
        info = bitmap.GetInfo()
        pixels = bitmap.GetBitmapBits(True)
        picture = Image.frombuffer('RGB', (info['bmWidth'], info['bmHeight']), pixels, 'raw', 'BGRX', 0, 1)
        destination.parent.mkdir(parents=True, exist_ok=True)
        picture.save(destination, 'PNG')
    finally:
        b.win32gui.DeleteObject(bitmap.GetHandle())
        target.DeleteDC()
        source.DeleteDC()
        b.win32gui.ReleaseDC(hwnd, dc)
    return [left, top, right, bottom]


def capture_room(room, *, output=None, scroll=None):
    window = _room(room)
    dialogs = _save_dialogs(window)
    if scroll:
        if dialogs:
            raise b.KakaoError('기존 저장 팝업을 먼저 완료하세요.')
        if scroll not in {'up','down','top','bottom'}:
            raise b.KakaoError('스크롤 방향이 유효하지 않습니다.')
        from .background import run_action
        run_action(window.title,'scroll',direction=scroll)
    hwnd = _only(dialogs, '저장 팝업이 여러 개입니다.') if dialogs else window.hwnd
    destination = Path(output).expanduser().resolve() if output else _data_root() / 'captures' / (uuid.uuid4().hex + '.png')
    if destination.exists():
        raise b.KakaoError('캡처 출력 파일이 이미 존재합니다.')
    foreground = b.win32gui.GetForegroundWindow()
    rect = _capture(hwnd, destination)
    return {'room': window.title, 'path': str(destination), 'rect': rect,
            'background': True, 'foreground_unchanged': foreground == b.win32gui.GetForegroundWindow(),
            'save_dialog_open': bool(dialogs), 'window': hex(hwnd)}


def list_attachments(room, *, limit=50, interactive=False):
    if limit < 1:
        raise b.KakaoError('limit은 1 이상이어야 합니다.')
    window, text = b.read_visible(room, exact=True, interactive=interactive)
    records = []
    for record in parse_transcript(text):
        line = record.text.strip()
        image = re.fullmatch(r'사진(?:\s+(\d+)장)?', line)
        if image or line.startswith('파일: '):
            row = record.to_dict()
            row.update(kind='image' if image else 'file', count=int(image.group(1) or 1) if image else 1,
                       filename=None if image else line[len('파일: '):].strip())
            records.append(row)
    return {'room': window.title, 'coverage': 'loaded_ui_only', 'complete_history': False,
            'attachment_count': len(records), 'attachments': records[-limit:]}


def _destination(original, kind, directory, filename):
    original = original.replace('\\', '/').rsplit('/', 1)[-1].strip('"')
    name = filename or original
    if not name or name in {'.','..'} or re.search(r'[\\/:*?"<>|\x00-\x1f]', name):
        raise b.KakaoError('저장 파일 이름이 유효하지 않습니다.')
    if kind == 'image' and not Path(name).suffix:
        name += '.jpg'
    folder = Path(directory).expanduser().resolve() if directory else _data_root() / 'downloads' / (datetime.now().strftime('%Y%m%d-%H%M%S-') + uuid.uuid4().hex[:8])
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    if path.exists():
        raise b.KakaoError('같은 이름의 파일이 이미 있어 덮어쓰지 않았습니다.')
    return path


def _save_pending(window, dialog, *, kind, output_directory, filename, timeout):
    # App-modal Save As must be completed before touching any chat controls.
    if not _owned_by_room(dialog, window):
        raise b.KakaoError('저장 팝업의 소유 대화방이 일치하지 않습니다.')
    edits = [h for h in b.enum_children(dialog) if b.win32gui.GetClassName(h) == 'Edit' and b.win32gui.GetDlgCtrlID(h) in {1001, 1148}]
    edit = _only(edits, '저장 팝업의 파일 이름 입력창을 식별하지 못했습니다.')
    original = b._read_input_text(edit)
    path = _destination(original, kind, output_directory, filename)
    button = b.win32gui.GetDlgItem(dialog, 1)
    if not button or not any(s in b.win32gui.GetWindowText(button).casefold() for s in ['저장', 'save']):
        raise b.KakaoError('저장 버튼을 확인하지 못했습니다. 팝업을 유지했습니다.')
    foreground = b.win32gui.GetForegroundWindow()
    b.win32gui.SendMessage(edit, b.win32con.WM_SETTEXT, 0, str(path))
    if b._read_input_text(edit) != str(path):
        raise b.KakaoError('저장 경로 확인에 실패했습니다. 저장하지 않았습니다.')
    b.win32gui.PostMessage(button, b.win32con.BM_CLICK, 0, 0)
    deadline, previous, stable = time.monotonic()+timeout, -1, 0
    while time.monotonic() < deadline:
        size = path.stat().st_size if path.is_file() else 0
        stable = stable+1 if size > 0 and size == previous else 0
        previous = size
        if stable >= 3 and not b.win32gui.IsWindow(dialog):
            return {'saved': True, 'room': window.title, 'path': str(path), 'filename': path.name,
                    'bytes': size, 'sha256': _sha256(path),
                    'kind': kind, 'background': True, 'save_dialog_closed': True,
                    'foreground_unchanged': foreground == b.win32gui.GetForegroundWindow()}
        time.sleep(.1)
    raise b.KakaoError('저장 완료를 확인하지 못했습니다. 다음 작업을 시작하지 마세요. 저장 팝업과 파일 상태를 먼저 확인하세요.')


def download_attachment(room, *, point=None, mode='viewer', kind='image', output_directory=None,
                        filename=None, timeout=20.0, interactive=False):
    if kind not in {'image','file'} or mode not in {'viewer','dialog','point'} or not math.isfinite(timeout) or timeout <= 0:
        raise b.KakaoError('첨부 저장 인자가 유효하지 않습니다.')
    window = _room(room)
    dialogs = _save_dialogs(window)
    if dialogs:
        if mode == 'point':
            raise b.KakaoError('기존 저장 팝업이 있습니다. --dialog로 먼저 완료하세요.')
        return _save_pending(window, _only(dialogs, '저장 팝업이 여러 개입니다.'), kind=kind,
                             output_directory=output_directory, filename=filename, timeout=timeout)
    if mode == 'dialog':
        raise b.KakaoError('이 대화방 소유의 저장 팝업이 열려 있지 않습니다.')
    from .background import run_action
    if filename and (filename in {'.','..'} or re.search(r'[\\/:*?"<>|\x00-\x1f]',filename)):
        raise b.KakaoError('저장 파일 이름이 유효하지 않습니다.')
    folder = Path(output_directory).expanduser().resolve() if output_directory else _data_root() / 'downloads' / (datetime.now().strftime('%Y%m%d-%H%M%S-')+uuid.uuid4().hex[:8])
    folder.mkdir(parents=True,exist_ok=True)
    if filename and (folder/filename).exists():
        raise b.KakaoError('같은 이름의 파일이 이미 있어 덮어쓰지 않았습니다.')
    result = run_action(window.title,'download',timeout=timeout,point=list(point) if point else None,
                        kind=kind,output_directory=str(folder),filename=filename)
    path=Path(result['path']).resolve()
    if path.parent!=folder.resolve():
        raise b.KakaoError('저장 결과가 지정 폴더를 벗어났습니다.')
    deadline,previous,stable=time.monotonic()+timeout,-1,0
    while time.monotonic()<deadline:
        size=path.stat().st_size if path.is_file() else 0
        stable=stable+1 if size>0 and size==previous else 0
        previous=size
        if stable>=3:
            return {**result,'saved':True,'room':window.title,'path':str(path),'filename':path.name,
                    'bytes':size,'sha256':_sha256(path),'kind':kind,
                    'save_dialog_opened':False}
        time.sleep(.1)
    raise b.KakaoError('저장 경로는 전달했지만 파일 완료를 확인하지 못했습니다. 자동으로 재시도하지 마세요.')
