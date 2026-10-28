"""Hold a Windows session mutex until the owning Node pipe closes."""
import sys
import win32api
import win32event

handle = win32event.CreateMutex(None, False, "Local\\NaraeOffice.HwpAutomation.v1")
acquired = False
try:
    state = win32event.WaitForSingleObject(handle, 30000)
    acquired = state in (win32event.WAIT_OBJECT_0, win32event.WAIT_ABANDONED)
    if not acquired:
        print("BUSY", flush=True)
        sys.exit(1)
    print("READY", flush=True)
    sys.stdin.read()
finally:
    if acquired:
        win32event.ReleaseMutex(handle)
    win32api.CloseHandle(handle)
