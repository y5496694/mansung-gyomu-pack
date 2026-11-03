"""Read-only PDF viewer observations; never terminate processes or change defaults."""
import ctypes
import time


def observe(name):
    import win32com.client
    import win32gui
    import win32process
    # Query only PDF applications. Do not expose other process command lines.
    service = win32com.client.GetObject('winmgmts:')
    processes = {int(p.ProcessId): str(p.Name) for p in service.ExecQuery(
        "SELECT ProcessId,Name FROM Win32_Process WHERE Name='Hpdf.exe' OR "
        "Name='Acrobat.exe' OR Name='AcroRd32.exe' OR Name='ezPDFReader.exe'")}
    visible, matching = set(), []

    def visit(hwnd, unused):
        pid = win32process.GetWindowThreadProcessId(hwnd)[1]
        if pid in processes and win32gui.IsWindowVisible(hwnd):
            title = win32gui.GetWindowText(hwnd)
            if title:
                visible.add(pid)
                if title == name or title.startswith(name + ' ') or title.startswith(name + ' -'):
                    matching.append({'hwnd': hwnd, 'pid': pid, 'application': processes[pid]})
    win32gui.EnumWindows(visit, None)
    class Memory(ctypes.Structure):
        _fields_ = [('length', ctypes.c_ulong), ('load', ctypes.c_ulong),
                    *[(key, ctypes.c_ulonglong) for key in ('total', 'available', 'total_page',
                       'available_page', 'total_virtual', 'available_virtual', 'extended')]]
    memory = Memory()
    memory.length = ctypes.sizeof(memory)
    memory_result = {}
    if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(memory)):
        memory_result = {'available_mb': memory.available // (1024 * 1024), 'load_percent': memory.load}
    return {'matching_windows': matching,
            'windowless_pdf_processes': [{'pid': pid, 'application': application}
                for pid, application in processes.items() if pid not in visible],
            'memory': memory_result}


def wait_for_viewer(name, observer=observe, timeout=3, sleep=time.sleep, clock=time.monotonic):
    deadline = clock() + timeout
    while True:
        state = observer(name)
        if state['matching_windows'] or clock() >= deadline:
            return {'viewer_window_detected': bool(state['matching_windows']),
                    'viewer_open_verified': False, 'viewer_diagnostics': state,
                    'next': 'Verify displayed PDF pages; no window can mean viewer startup/resource failure, not PDF corruption. Never kill all PDF processes.'}
        sleep(.2)
