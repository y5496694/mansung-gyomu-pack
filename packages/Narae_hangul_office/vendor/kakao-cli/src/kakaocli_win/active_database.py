"""Identify the current account by the selected Kakao process's open DB file.

No key recovery, process-memory reading or database-content scanning occurs here.
Only local duplicates of that verified process's disk-file handles are queried.
"""
from __future__ import annotations
import ctypes
from ctypes import wintypes
import hashlib
import struct
from pathlib import Path
from .backend import KakaoError, find_main_window, _window_process, require_windows


class HandleEntry(ctypes.Structure):
    _fields_ = [('object', ctypes.c_void_p), ('pid', ctypes.c_size_t),
                ('handle', ctypes.c_size_t), ('access', wintypes.ULONG),
                ('trace', wintypes.USHORT), ('kind', wintypes.USHORT),
                ('attributes', wintypes.ULONG), ('reserved', wintypes.ULONG)]


def unique_chat_list(paths):
    candidates = {str(Path(p).resolve()).casefold(): Path(p).resolve()
                  for p in paths if Path(p).name.casefold() == 'chatlistinfo.edb'}
    if len(candidates) != 1:
        raise KakaoError('현재 카카오톡 계정의 열린 채팅 DB를 유일하게 확인하지 못했습니다. 본인 계정 로그인을 확인하세요.')
    return next(iter(candidates.values()))


def current_account():
    require_windows()
    if ctypes.sizeof(ctypes.c_void_p) != 8:
        raise KakaoError('현재 계정 확인은 Windows x64에서 지원합니다.')
    main = find_main_window()
    if not main or _window_process(main.hwnd) != (main.pid, main.executable):
        raise KakaoError('실행 중인 카카오톡 소유 창을 확인하지 못했습니다.')
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    nt = ctypes.WinDLL('ntdll')
    query = nt.NtQuerySystemInformation
    query.argtypes = [wintypes.ULONG, ctypes.c_void_p, wintypes.ULONG, ctypes.POINTER(wintypes.ULONG)]
    query.restype = ctypes.c_long
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.DuplicateHandle.argtypes = [wintypes.HANDLE, wintypes.HANDLE, wintypes.HANDLE, ctypes.POINTER(wintypes.HANDLE), wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.DuplicateHandle.restype = wintypes.BOOL
    kernel.GetFileType.argtypes = [wintypes.HANDLE]
    kernel.GetFileType.restype = wintypes.DWORD
    kernel.GetFinalPathNameByHandleW.argtypes = [wintypes.HANDLE, wintypes.LPWSTR, wintypes.DWORD, wintypes.DWORD]
    kernel.GetFinalPathNameByHandleW.restype = wintypes.DWORD
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
    size = 1024 * 1024
    while size <= 64 * 1024 * 1024:
        buffer = ctypes.create_string_buffer(size)
        needed = wintypes.ULONG()
        status = query(64, buffer, size, ctypes.byref(needed))
        if status == 0:
            break
        if status != -1073741820:
            raise KakaoError('현재 카카오톡 계정의 파일 핸들을 확인하지 못했습니다. 전송하지 않았습니다.')
        size = max(size * 2, needed.value + 65536)
    else:
        raise KakaoError('계정 확인의 핸들 조회 한도를 넘었습니다.')
    count = struct.unpack_from('Q', buffer)[0]
    if count * ctypes.sizeof(HandleEntry) + 16 > size:
        raise KakaoError('Windows 파일 핸들 자료 형식이 다릅니다.')
    process = kernel.OpenProcess(0x1040, False, main.pid)  # DUP_HANDLE + QUERY_LIMITED_INFORMATION
    if not process:
        raise KakaoError('현재 카카오톡 계정 확인 권한이 없습니다.')
    paths = []
    try:
        times = [wintypes.FILETIME() for _ in range(4)]
        if not kernel.GetProcessTimes(process, *(ctypes.byref(v) for v in times)):
            raise KakaoError('현재 카카오톡 실행 세션을 확인하지 못했습니다.')
        creation = times[0].dwLowDateTime + (times[0].dwHighDateTime << 32)
        examined = 0
        for index in range(count):
            entry = HandleEntry.from_buffer(buffer, 16 + index * ctypes.sizeof(HandleEntry))
            if entry.pid != main.pid:
                continue
            examined += 1
            if examined > 20000:
                raise KakaoError('카카오톡 계정 파일 조회 한도를 넘었습니다.')
            duplicate = wintypes.HANDLE()
            if not kernel.DuplicateHandle(process, entry.handle, kernel.GetCurrentProcess(), ctypes.byref(duplicate), 0, False, 2):
                continue
            try:
                if kernel.GetFileType(duplicate) != 1:  # Never query pipes or sockets.
                    continue
                text = ctypes.create_unicode_buffer(32768)
                length = kernel.GetFinalPathNameByHandleW(duplicate, text, len(text), 0)
                if 0 < length < len(text):
                    value = text.value
                    if value.startswith('\\\\?\\'):
                        value = value[4:]
                    if Path(value).name.casefold() == 'chatlistinfo.edb':
                        paths.append(value)
            finally:
                kernel.CloseHandle(duplicate)
    finally:
        kernel.CloseHandle(process)
    if _window_process(main.hwnd) != (main.pid, main.executable):
        raise KakaoError('계정 확인 중 카카오톡 실행 세션이 바뀌었습니다.')
    database = unique_chat_list(paths)
    binding = hashlib.sha256(f'{main.pid}\0{creation}\0{str(database).casefold()}'.encode()).hexdigest()
    return {'database': database, 'binding': binding}
