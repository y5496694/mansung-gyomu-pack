"""Bind only the exact owned Hangul PID; never change COM registration."""
from pathlib import Path
import os
import subprocess
import time
import pythoncom
import win32process
from win32com.client import dynamic

def create_app(timeout=30):
    from hancom_paths import discover_executable
    executable=discover_executable()
    child=subprocess.Popen([str(executable),'-Automation'],creationflags=subprocess.CREATE_NO_WINDOW,
                           stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    rot,context=pythoncom.GetRunningObjectTable(),pythoncom.CreateBindCtx(0)
    deadline=time.monotonic()+timeout
    try:
        while time.monotonic()<deadline:
            for moniker in rot:
                if not moniker.GetDisplayName(context,None).startswith('!HwpObject.'):
                    continue
                try:
                    app=dynamic.Dispatch(rot.GetObject(moniker).QueryInterface(pythoncom.IID_IDispatch))
                    windows=app.XHwpWindows
                    if not windows.Count:
                        continue
                    hwnd=int(windows.Item(0).WindowHandle)
                    if win32process.GetWindowThreadProcessId(hwnd)[1]!=child.pid:
                        continue
                    windows.Item(0).Visible=False
                    # RegisterModule can return false on the 2024 server even
                    # when normal local Open is permitted. Observe Open itself.
                    for name in ('NaraeHangulFilePathChecker','FilePathCheckerModule','FilePathCheckerModuleExample'):
                        if app.RegisterModule('FilePathCheckDLL',name):
                            break
                    return app,child
                except (pythoncom.com_error,AttributeError,ValueError):
                    continue
            if child.poll() is not None:
                raise ValueError('선택한 한컴 한글 자동화 실행기가 종료되었습니다.')
            pythoncom.PumpWaitingMessages()
            time.sleep(.1)
        raise ValueError('선택한 한컴 한글 자동화 준비 시간이 초과되었습니다.')
    except Exception:
        if child.poll() is None:
            child.terminate()  # This exact owned process has no opened document.
        raise

def close_app(app,child):
    """Release the exact owned hidden server, including its idle class factory."""
    try:
        for index in range(app.XHwpWindows.Count):app.XHwpWindows.Item(index).Visible=False
        app.Clear(1)
        app.Quit()
    except (pythoncom.com_error,AttributeError):
        pass
    try:
        child.wait(timeout=2)
    except subprocess.TimeoutExpired:
        child.terminate()  # Popen retains the original Windows process handle.
        child.wait(timeout=5)


def open_owned_document(file,arguments=''):
    """Open in an exact owned server; retry only the observed startup fault.

    Hwp 2024 occasionally reports RPC_E_SERVERFAULT on its first Open after
    another automation class factory quits. Never retry a print/edit action,
    or close an application that was not created by this function.
    """
    file=Path(file).resolve()
    if not file.is_file():raise ValueError('한글 파일을 찾을 수 없습니다.')
    for attempt in range(2):
        app,child=create_app()
        try:
            if not app.Open(str(file),'HWPX' if file.suffix.lower()=='.hwpx' else 'HWP',arguments):
                raise ValueError('한글에서 원본 문서를 열지 못했습니다.')
            if Path(str(app.Path)).resolve()!=file:raise ValueError('열린 한글 문서가 요청한 파일과 다릅니다.')
            return app,child,attempt+1
        except pythoncom.com_error as error:
            close_app(app,child)
            if attempt==0 and error.hresult==-2147417851:
                pythoncom.PumpWaitingMessages();time.sleep(.3);continue
            raise
        except Exception:
            close_app(app,child);raise
