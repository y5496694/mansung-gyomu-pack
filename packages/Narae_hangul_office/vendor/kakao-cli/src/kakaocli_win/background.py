"""Background Windows automation using the Frida runtime supplied with REA."""
from __future__ import annotations
import json
import math
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from . import backend as b


def _runtime():
    node = os.environ.get('KAKAOCLI_REA_NODE') or ('D:/Codex/tools/node-v24.22.1/node.exe' if Path('D:/Codex/tools/node-v24.22.1/node.exe').is_file() else shutil.which('node'))
    entry = os.environ.get('KAKAOCLI_REA_ENTRY','D:/Codex/tools/rea-6.8.0/node_modules/rea-agents/scripts/rea.mjs')
    if not node or not Path(entry).is_file():
        raise b.KakaoError('백그라운드 런타임이 없습니다. REA/Frida를 설치하고 KAKAOCLI_REA_NODE와 KAKAOCLI_REA_ENTRY를 설정하세요.')
    return node, str(Path(entry).resolve().parents[1])


def _any_room(room):
    if not room.strip():
        raise b.KakaoError('채팅방 이름은 비어 있을 수 없습니다.')
    matches = [w for w in b.list_windows() if w.title == room and w.class_name == b.CHAT_CLASS
               and any(b.win32gui.GetDlgCtrlID(c)==1006 for c in b.enum_children(w.hwnd))]
    if len(matches)>1:
        raise b.KakaoError('동일한 제목의 창이 여러 개입니다.')
    return matches[0] if matches else None


def run_action(room, op, *, timeout=20.0, **parameters):
    b.require_windows()
    if not room.strip() or not math.isfinite(timeout) or timeout <= 0:
        raise b.KakaoError('대상과 제한 시간이 유효하지 않습니다.')
    target = _any_room(room)
    main = b.find_main_window()
    window = target or main
    if not window:
        raise b.KakaoError('로그인한 카카오톡 메인 창을 찾지 못했습니다.')
    scoped = [hex(w.hwnd) for w in b.list_windows() if w.title == room or w.title.startswith(room+' ') or w.kind=='main']
    config = {'pid':window.pid,'root':hex(window.hwnd),'room':room,'op':op,'timeout':timeout,'scoped':scoped,**parameters}
    node, rea_root = _runtime()
    try:
        process = subprocess.run([node,str(Path(__file__).with_name('background_driver.mjs')),rea_root],
            input=json.dumps(config,ensure_ascii=True),capture_output=True,text=True,encoding='utf-8',
            timeout=timeout+20,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    except (OSError,subprocess.TimeoutExpired) as exc:
        raise b.KakaoError('백그라운드 작업 결과를 확인하지 못했습니다. 전송은 자동 재시도하지 마세요.') from exc
    try:
        payload=json.loads(process.stdout)
    except ValueError as exc:
        raise b.KakaoError('백그라운드 런타임의 응답을 읽지 못했습니다: '+process.stderr[-500:]) from exc
    if payload.get('cleanup_error'):
        raise b.KakaoError('백그라운드 연결 해제를 확인하지 못했습니다: '+payload['cleanup_error'])
    if not payload.get('ok'):
        raise b.KakaoError(payload.get('error') or '백그라운드 작업에 실패했습니다.')
    return payload['result']


def ensure_room(room, *, exact=True):
    if not exact:
        known=b.find_room(room,exact=False)
        if known:return known
    known=_any_room(room)
    if known:return known
    result=resolve_room(room)
    known=_any_room(result['title'])
    if not known or hex(known.hwnd)!=result['hwnd']:
        raise b.KakaoError('검색 후 대화방 제목을 검증하지 못했습니다.')
    return known


def resolve_room(query):
    """Resolve the rendered search row before opening it; never guess a recipient."""
    from .attachments import _capture
    from .windows_ocr import ocr_image, WindowsOcrError
    probe=run_action(query,'search-probe',query=query)
    tmp_root=Path('D:/Codex/tmp') if Path('D:/Codex/tmp').is_dir() else None
    previous=probe['previous_search']
    try:
        with tempfile.TemporaryDirectory(prefix='kakao-search-',dir=tmp_root) as folder:
            path=Path(folder)/'results.png'
            _capture(int(probe['main'],16),path)
            observation=ocr_image(path)
        normalized=lambda value: ''.join(value.casefold().split())
        candidates=[]
        for line in observation['lines']:
            words=[w for w in line['words'] if 55<=w['x']<observation['width']-65]
            title=' '.join(w['text'] for w in words).strip()
            if words and normalized(query) in normalized(title):
                left=min(w['x'] for w in words);top=min(w['y'] for w in words)
                right=max(w['x']+w['width'] for w in words);bottom=max(w['y']+w['height'] for w in words)
                if top>=60:candidates.append({'title':title,'point':[(left+right)/2,(top+bottom)/2]})
        if len(candidates)!=1:
            raise b.KakaoError('검색 결과에서 이름을 하나로 식별하지 못했습니다. 정확한 표시 이름을 지정하세요. 후보: '+', '.join(c['title'] for c in candidates))
        candidate=candidates[0]
        return run_action(query,'open-selected',query=query,expected_title=candidate['title'],point=candidate['point'])
    except WindowsOcrError as exc:
        raise b.KakaoError('백그라운드 검색 결과를 읽지 못했습니다: '+str(exc)) from exc
    finally:
        run_action(query,'search-probe',query=previous)


def read_visible(room, *, exact=True, timeout=1.5):
    import win32clipboard
    window=ensure_room(room,exact=exact)
    result=run_action(window.title,'read',timeout=max(timeout+2,5))
    if b.ctypes.windll.user32.GetClipboardSequenceNumber()!=result['clipboard_sequence']:
        raise b.KakaoError('복사 후 클립보드가 바뀌어 대화를 읽지 않았습니다.')
    try:
        win32clipboard.OpenClipboard()
        text=win32clipboard.GetClipboardData(b.win32con.CF_UNICODETEXT)
    finally:
        win32clipboard.CloseClipboard()
    return window,text.strip()


def send_message(room,message,*,exact=True):
    window=ensure_room(room,exact=exact)
    run_action(window.title,'send',message=message)
    return window
