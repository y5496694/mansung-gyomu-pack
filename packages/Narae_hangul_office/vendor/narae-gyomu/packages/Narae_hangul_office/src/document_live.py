"""Observe HWP/HWPX documents and bind only the chosen owned Hangul PID."""
import hashlib
import json
from pathlib import Path
import sys

import pythoncom
import win32com.client
from win32com.client import dynamic
import win32gui
import win32process
import win32api
import win32con
import win32event


def native_handle(kind, app, item, filename):
    matches, expected = [], "hwp.exe"
    # Resolve handles from this exact ROT application. Title-only matching is
    # ambiguous for duplicate filenames and can lose off-screen test windows.
    try:
        handles=[int(app.XHwpWindows.Item(i).WindowHandle) for i in range(app.XHwpWindows.Count)]
        handles=[h for h in handles if win32gui.IsWindow(h) and win32gui.IsWindowVisible(h)]
        if len(handles)==1:return handles[0]
    except (pythoncom.com_error,AttributeError,TypeError,ValueError):
        pass
    name = Path(filename).name.lower()
    stem = Path(name).stem
    def visit(hwnd, _):
        title = win32gui.GetWindowText(hwnd).lower()
        if not win32gui.IsWindowVisible(hwnd) or not (name in title or title.startswith(stem+" ")):
            return
        try:
            pid = win32process.GetWindowThreadProcessId(hwnd)[1]
            handle = win32api.OpenProcess(0x410, False, pid)
            try:
                executable = win32process.GetModuleFileNameEx(handle, 0)
            finally:
                handle.Close()
            if Path(executable).name.lower() == expected and "\\hnc\\" in executable.lower():
                matches.append(hwnd)
        except Exception:
            pass
    win32gui.EnumWindows(visit, None)
    return matches[0] if len(matches) == 1 else None


def running_apps(include_hidden=False):
    rot, context = pythoncom.GetRunningObjectTable(), pythoncom.CreateBindCtx(0)
    for moniker in rot:
        try:
            if not moniker.GetDisplayName(context, None).startswith("!HwpObject."):
                continue
            application = dynamic.Dispatch(rot.GetObject(moniker).QueryInterface(pythoncom.IID_IDispatch))
            if include_hidden or any(application.XHwpWindows.Item(i).Visible for i in range(application.XHwpWindows.Count)):
                yield "hwp", application
        except pythoncom.com_error:
            pass


def documents():
    for kind, app in running_apps():
        try:
            collection = app.XHwpDocuments
            for index in range(int(collection.Count)):
                item = collection.Item(index)
                filename = str(item.FullName or "")
                if not filename or not Path(filename).is_absolute() or Path(filename).suffix.lower() not in {".hwp", ".hwpx"}:
                    continue
                try:
                    # Application.Path observes the caret document without activation.
                    is_active = str(app.Path).lower() == filename.lower()
                except (pythoncom.com_error, AttributeError):
                    is_active = False
                hwnd = native_handle(kind, app, item, filename)
                extra = {}
                if kind == "hwp":
                    try:
                        extra["modified"] = bool(item.Modified)
                    except (pythoncom.com_error, AttributeError):
                        extra["modified"] = None
                if kind == "hwp" and is_active:
                    try:
                        selected = tuple(app.GetSelectedPos())
                        if len(selected) == 7 and selected[0]:
                            from hwp_native import selected_text
                            guard = win32event.CreateMutex(None, False, "Local\\NaraeOffice.HwpAutomation.v1")
                            state = win32event.WaitForSingleObject(guard, 0)
                            acquired = state in (win32event.WAIT_OBJECT_0, win32event.WAIT_ABANDONED)
                            try:
                                value = selected_text(app) if acquired else ""
                            finally:
                                if acquired:
                                    win32event.ReleaseMutex(guard)
                                win32api.CloseHandle(guard)
                            extra["selected_region"] = {"format": "hwp", "type": "text", "selected_text": value[:10000],
                                                        "truncated": len(value) > 10000, "content_deferred": not acquired, "start": selected[1:4], "end": selected[4:7]}
                        ctrl = app.CurSelectedCtrl
                        if ctrl is not None:
                            extra["selected_region"] = {"format": "hwp", "type": "control", "ctrl_type": "table" if ctrl.CtrlID == "tbl" else "image" if ctrl.UserDesc == "그림" else ctrl.CtrlID}
                    except (pythoncom.com_error, AttributeError, TypeError):
                        pass
                yield kind, item, {"format": kind, "file_name": Path(filename).name, "local_path": filename,
                                   "document_id": hashlib.sha256(filename.lower().encode()).hexdigest()[:20],
                                   "is_active_document": is_active,"is_active_in_application":is_active, "is_foreground": bool(hwnd and win32gui.GetForegroundWindow() == hwnd), "hwnd": hwnd,
                                   "pid": win32process.GetWindowThreadProcessId(hwnd)[1] if hwnd and win32gui.IsWindow(hwnd) else None, **extra}
        except (pythoncom.com_error, AttributeError):
            continue


def run(request):
    if request.get('action') not in {'list','open_hwp','hwp_cancel_selection','activate','place_windows','close'}:
        raise ValueError('한글 HWP/HWPX 문서 상태만 지원합니다.')
    if request.get('path') and Path(request['path']).suffix.lower() not in {'.hwp','.hwpx'}:
        raise ValueError('한글 HWP/HWPX 문서만 지원합니다.')
    if request.get('action')=='place_windows' and request.get('format')!='hwp':raise ValueError('한글 편집창만 배치할 수 있습니다.')
    if request["action"] == "open_hwp":
        target = str(Path(request["path"]).resolve())
        matches=[]
        for kind, app in running_apps(include_hidden=True):
            if kind != "hwp":
                continue
            collection = app.XHwpDocuments
            for index in range(collection.Count):
                item = collection.Item(index)
                if str(item.FullName).lower() == target.lower():
                    matches.append((app,item))
        if len(matches)>1:raise ValueError('같은 경로가 한글에 여러 번 열려 있습니다. 중복 사본을 확인하세요.')
        if matches:
            app,item=matches[0]
            if not any(app.XHwpWindows.Item(i).Visible for i in range(app.XHwpWindows.Count)):
                raise ValueError('이 문서가 숨겨진 한글 자동화 창에 이미 열려 있습니다. 해당 작업을 끝낸 뒤 다시 여세요. 중복 사본은 만들지 않았습니다.')
            item.SetActive_XHwpDocument()
            return {"status": "success", "opened": True, "already_open": True}
        # A saved-file edit closes the old file to release its disk lock. If
        # that was the user's last tab, reuse this exact now-empty application
        # instead of leaving its blank tab behind and starting a second app.
        reuse_pid=request.get('reuse_pid')
        if type(reuse_pid) is int and reuse_pid>0:
            for _,candidate in running_apps(include_hidden=True):
                windows=candidate.XHwpWindows
                if not windows.Count:continue
                hwnd=int(windows.Item(0).WindowHandle)
                if win32process.GetWindowThreadProcessId(hwnd)[1]!=reuse_pid:continue
                docs=candidate.XHwpDocuments
                if docs.Count!=1 or str(docs.Item(0).FullName) or bool(docs.Item(0).Modified) or not bool(candidate.IsEmpty):break
                if not candidate.Open(target,'HWPX' if Path(target).suffix.lower()=='.hwpx' else 'HWP',''):
                    raise ValueError('편집한 문서를 원래 한글 창에 다시 열지 못했습니다.')
                if str(Path(str(candidate.Path)).resolve()).lower()!=target.lower():
                    raise ValueError('원래 한글 창의 문서가 요청한 경로와 다릅니다.')
                return {"status":"success","opened":True,"reused_empty_pid":reuse_pid}
        # Bind the chosen owned server instead of a global COM registration.
        # This never replaces a document in the existing user application.
        from hwp_app import open_owned_document,close_app
        app,owned_process,open_attempts = open_owned_document(target)
        transferred = False
        try:
            app.XHwpWindows.Item(0).Visible = False
            window=app.XHwpWindows.Item(0)
            if request.get("background"):
                hwnd=int(window.WindowHandle)
                win32gui.SetWindowLong(hwnd,win32con.GWL_EXSTYLE,win32gui.GetWindowLong(hwnd,win32con.GWL_EXSTYLE)|0x08000000|0x00000080)
                win32gui.SetWindowPos(hwnd,0,-32000,-32000,1100,800,win32con.SWP_NOACTIVATE|win32con.SWP_NOZORDER)
            window.Visible = True
            if request.get("background"):
                win32gui.SetWindowPos(hwnd,0,-32000,-32000,1100,800,win32con.SWP_NOACTIVATE|win32con.SWP_NOZORDER)
            transferred = True
            return {"status": "success", "opened": True, "owned_pid": owned_process.pid,"open_attempts":open_attempts}
        finally:
            if not transferred:
                close_app(app,owned_process)
    if request["action"] == "hwp_cancel_selection":
        from hwp_native import application_for
        app, doc = application_for(request["path"])
        app.HAction.Run("Cancel")
        return {"success": True, "saved": False}
    if request["action"] == "activate":
        target = str(Path(request["path"]).resolve()).lower()
        matches = [(kind, item, info) for kind, item, info in documents() if str(Path(info["local_path"]).resolve()).lower() == target]
        if len(matches) == 1:
            kind, item, info = matches[0]
            item.SetActive_XHwpDocument()
            return {"success": True, "local_path": info["local_path"]}
        raise ValueError("활성화할 한컴 문서가 없거나 여러 개로 식별됩니다.")
    if request["action"] == "place_windows":
        hwnd, inline_hwnd = int(request["document_hwnd"]), int(request["inline_hwnd"])
        known = [info for _, _, info in documents()]
        if not any(info["hwnd"] == hwnd and info["format"] == request["format"] for info in known):
            raise ValueError("현재 한컴 문서 창을 확인할 수 없습니다.")
        if not win32gui.IsWindow(inline_hwnd) or win32process.GetWindowThreadProcessId(inline_hwnd)[1] != int(request["inline_pid"]):
            raise ValueError("나래 오피스 창이 요청과 다릅니다.")
        area = win32api.GetMonitorInfo(win32api.MonitorFromWindow(hwnd, 2))["Work"]
        left, top, right, bottom = area
        side = max(450, (right-left)//4)
        if right-left < 900:
            return {"success": True, "skipped": True, "reason": "WORK_AREA_TOO_SMALL"}
        rects = [(hwnd, left, top, right-left-side, bottom-top), (inline_hwnd, right-side, top, side, bottom-top)]
        for window, x, y, width, height in rects:
            if win32gui.IsIconic(window) or win32gui.GetWindowPlacement(window)[1] == win32con.SW_SHOWMAXIMIZED:
                win32gui.ShowWindow(window, win32con.SW_RESTORE)
            win32gui.SetWindowPos(window, 0, x, y, width, height, win32con.SWP_NOACTIVATE | win32con.SWP_NOZORDER)
        return {"success": True, "documentRect": win32gui.GetWindowRect(hwnd), "inlineRect": win32gui.GetWindowRect(inline_hwnd)}
    if request["action"] == "list":
        items = [info for _, _, info in documents()]
        selected = {kind: next((item.get("selected_region") for item in items if item["format"] == kind and item["is_active_document"]), None) for kind in ("hwp", "word", "excel")}
        return {"open_document_list": items, "selected_region_by_format": selected,
                "primary_active_format": next((item["format"] for item in items if item["is_active_document"]), None),
                "selection_supported": False, "selection_supported_by_format": {"hwp": True, "word": False, "excel": False}, "provider": "hancom-running-documents"}
    if request["action"] == "close":
        target = str(Path(request["path"]).resolve()).lower()
        matches = [(kind, item, info) for kind, item, info in documents() if str(Path(info["local_path"]).resolve()).lower() == target]
        if len(matches) != 1:
            raise ValueError("열린 문서를 하나로 식별하지 못했습니다. 열린 문서 목록을 다시 조회하세요.")
        kind, item, info = matches[0]
        owned_app = None
        if kind=="hwp" and type(request.get("quit_owned_pid")) is int and request["quit_owned_pid"]>0 and request["quit_owned_pid"]==info.get("pid"):
            from hwp_native import application_for
            owned_app,_ = application_for(info["local_path"])
        saving = request.get("with_save", True)
        if saving:
            if bool(item.Modified) and not item.Save(True):
                raise ValueError("한글 문서를 저장하지 못해 닫지 않았습니다.")
        item.Close(False)
        owned_closed=False
        if owned_app is not None:
            docs=owned_app.XHwpDocuments
            if docs.Count<=1 and bool(owned_app.IsEmpty) and all(not str(docs.Item(i).FullName) and not bool(docs.Item(i).Modified) for i in range(docs.Count)):
                handle=win32api.OpenProcess(0x100001,False,info["pid"])
                try:
                    try:owned_app.Quit()
                    except pythoncom.com_error:pass
                    if win32event.WaitForSingleObject(handle,2000)==win32event.WAIT_TIMEOUT:
                        win32api.TerminateProcess(handle,0)
                    owned_closed=True
                finally:win32api.CloseHandle(handle)
        return {"status": "success", "local_path": info["local_path"], "with_save": saving, "provider": "hancom-running-documents", "owned_application_closed": owned_closed}
    raise ValueError("지원하지 않는 문서 상태 요청입니다.")


if __name__ == "__main__":
    pythoncom.CoInitialize()
    try:
        print(json.dumps({"ok": True, "data": run(json.load(sys.stdin))}, ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        sys.exit(1)
    finally:
        pythoncom.CoUninitialize()
