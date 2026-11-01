"""Send one local image or file through a verified KakaoTalk preview."""
from __future__ import annotations

import ctypes
import io
import json
import sys
import tempfile
import time
import uuid
from pathlib import Path

from . import backend as b
from .attachments import _capture, _sha256


def attachment_source(path, kind):
    if kind not in {'image', 'file'}:
        raise b.KakaoError('첨부 종류가 유효하지 않습니다.')
    source = Path(path).expanduser().resolve()
    if not source.is_file() or not source.stat().st_size:
        raise b.KakaoError('비어 있지 않은 로컬 파일을 지정하세요.')
    metadata = {'path': str(source), 'filename': source.name,
                'bytes': source.stat().st_size, 'sha256': _sha256(source), 'kind': kind}
    if kind == 'image':
        from PIL import Image, UnidentifiedImageError
        try:
            with Image.open(source) as picture:
                picture.verify()
            with Image.open(source) as picture:
                metadata.update(width=picture.width, height=picture.height)
                if getattr(picture, 'n_frames', 1) != 1:
                    raise b.KakaoError('움직이는 이미지는 send-file로 원본을 보내세요.')
        except (OSError, UnidentifiedImageError, Image.DecompressionBombError) as error:
            raise b.KakaoError('이미지 파일을 확인하지 못했습니다.') from error
    return metadata


def _target(room):
    from .background import ensure_room
    window = ensure_room(room, exact=True)
    handles = [h for h in b.enum_children(window.hwnd)
               if b.win32gui.GetDlgCtrlID(h) == b.MESSAGE_INPUT_ID
               and 'RICHEDIT' in b.win32gui.GetClassName(h).upper()]
    if len(handles) != 1:
        raise b.KakaoError('메시지 입력창을 하나로 식별하지 못했습니다.')
    b._assert_process_target(handles[0], root=window.hwnd, pid=window.pid)
    b._assert_room_title(window)
    b._assert_window_enabled(window.hwnd)
    return window


def preview_attachment(room, path, *, kind):
    metadata = attachment_source(path, kind)
    window = _target(room)
    return {'dry_run': True, 'submitted': False, 'target_ready': True,
            'room': window.title, 'attachment': metadata}


def _image_clipboard(source):
    from PIL import Image
    import win32clipboard
    with Image.open(source) as picture:
        with io.BytesIO() as buffer:
            picture.convert('RGB').save(buffer, 'BMP')
            data = buffer.getvalue()[14:]
    win32clipboard.OpenClipboard()
    try:
        win32clipboard.EmptyClipboard()
        win32clipboard.SetClipboardData(b.win32con.CF_DIB, data)
    finally:
        win32clipboard.CloseClipboard()
    return ctypes.windll.user32.GetClipboardSequenceNumber()


def _file_button(window):
    """Use the paper icon position in the verified 96-DPI Windows build."""
    # The file icon is 88 logical pixels from the left, 25 from the bottom.
    # Fail on an unknown DPI/layout rather than pressing an unrelated control.
    dpi = ctypes.windll.user32.GetDpiForWindow(window.hwnd)
    if dpi != 96 or window.width < 350 or window.height < 450:
        raise b.KakaoError('파일 첨부 버튼의 화면 배율·배치를 검증하지 못했습니다.')
    return [88, b.win32gui.GetClientRect(window.hwnd)[3] - 25]


def send_attachment(room, path, *, kind):
    from .background import run_action
    metadata = attachment_source(path, kind)
    window = _target(room)
    sequence = _image_clipboard(metadata['path']) if kind == 'image' else None
    if _sha256(Path(metadata['path'])) != metadata['sha256']:
        raise b.KakaoError('전송 준비 중 원본 파일이 바뀌었습니다.')
    root = Path('D:/Codex/tmp') if Path('D:/Codex/tmp').is_dir() else None
    with tempfile.TemporaryDirectory(prefix='kakao-outgoing-', dir=root) as folder:
        result = run_action(window.title, 'attachment-send', timeout=35, kind=kind,
                            source_path=metadata['path'], clipboard_sequence=sequence,
                            source_sha256=metadata['sha256'],
                            file_button=_file_button(window) if kind == 'file' else None,
                            python_executable=sys.executable, preview_directory=folder)
    result.pop('preview_path', None)
    return {**result, 'attachment': metadata}


def inspect_preview(request):
    from .windows_ocr import ocr_image
    hwnd, owner = int(request['preview'], 16), int(request['room_hwnd'], 16)
    b._assert_process_target(hwnd, root=hwnd, pid=request['pid'])
    if b.win32gui.GetWindow(hwnd, b.win32con.GW_OWNER) != owner:
        raise b.KakaoError('첨부 미리보기의 소유 대화방이 다릅니다.')
    if request.get('source_sha256') and _sha256(Path(request['source_path'])) != request['source_sha256']:
        raise b.KakaoError('전송 전 원본 파일이 바뀌었습니다.')
    bounds = b.win32gui.GetWindowRect(hwnd)
    if bounds[0] > -16000 or bounds[1] > -16000:
        raise b.KakaoError('첨부 미리보기의 백그라운드 위치를 확인하지 못했습니다.')
    foreground = b.win32gui.GetForegroundWindow()
    b.win32gui.ShowWindow(hwnd, b.win32con.SW_SHOWNOACTIVATE)
    b.win32gui.RedrawWindow(hwnd, None, None, 0x185)
    time.sleep(.5)
    if foreground != b.win32gui.GetForegroundWindow():
        raise b.KakaoError('검증 중 전경 창이 바뀌어 전송하지 않았습니다.')
    path = Path(request['preview_directory']) / (uuid.uuid4().hex + '.png')
    from PIL import Image
    deadline = time.monotonic() + 6
    while True:
        rect = _capture(hwnd, path)
        with Image.open(path) as picture:
            minimum, maximum = picture.convert('L').getextrema()
        if maximum-minimum > 30:
            break
        if time.monotonic() >= deadline:
            raise b.KakaoError('첨부 미리보기 화면이 그려지지 않아 전송하지 않았습니다.')
        time.sleep(.3)
    enlarged = path.with_stem(path.stem + '-ocr')
    with Image.open(path) as picture:
        picture.resize((picture.width*2, picture.height*2)).save(enlarged)
    observation = ocr_image(enlarged)
    text = ''.join(observation['text'].split())
    if request['kind'] == 'image':
        if '클립보드이미지전송' not in text:
            raise b.KakaoError('사진 전송 미리보기 제목을 확인하지 못했습니다.')
    else:
        if '파일전송' not in text or Path(request['source_path']).name.replace(' ', '') not in text:
            raise b.KakaoError('파일 전송 미리보기에서 파일 이름을 확인하지 못했습니다.')
    button_image = path.with_stem(path.stem + '-button')
    with Image.open(path) as picture:
        button_top = round(picture.height * .65)
        strip = picture.crop((0, button_top, picture.width, picture.height)).convert('L')
        strip.point(lambda value: 255 if value > 220 else 0).resize((strip.width*4, strip.height*4)).save(button_image)
    button_observation = ocr_image(button_image)
    buttons = [line for line in button_observation['lines']
               if ''.join(line['text'].split()) in {'전송', '1개전송'}
               and line['words']]
    if len(buttons) != 1:
        raise b.KakaoError('첨부 미리보기의 전송 버튼을 하나로 확인하지 못했습니다.')
    words = buttons[0]['words']
    left, top = min(w['x'] for w in words), min(w['y'] for w in words)
    right = max(w['x']+w['width'] for w in words)
    bottom = max(w['y']+w['height'] for w in words)
    return {'verified': True, 'preview_path': str(path), 'width': rect[2]-rect[0],
            'height': rect[3]-rect[1],
            'point': [round((left+right)/8), button_top+round((top+bottom)/8)]}


if __name__ == '__main__':
    try:
        print(json.dumps(inspect_preview(json.load(sys.stdin)), ensure_ascii=True))
    except Exception as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=True))
        sys.exit(1)


