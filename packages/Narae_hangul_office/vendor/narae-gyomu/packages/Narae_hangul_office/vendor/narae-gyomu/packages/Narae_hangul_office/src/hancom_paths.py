"""Find installed Hangul versions without creating or registering COM apps."""
import os,re
from pathlib import Path

def valid(file):return file.is_file() and file.name.lower()=='hwp.exe'
def rank(file):
    year=re.search(r'Office[\s_-]*(20\d{2})',str(file),re.I)
    if year:return int(year[1])*1000
    version=re.search(r'HOffice(\d+)',str(file),re.I)
    return int(version[1]) if version else 0
def discover_executable():
    override=os.environ.get('NARAE_HWP_EXE')
    if override:
        file=Path(override).resolve()
        if not valid(file):raise ValueError('NARAE_HWP_EXE 경로에서 Hwp.exe를 찾을 수 없습니다.')
        return file
    files=[]
    for base in [os.environ.get('ProgramFiles(x86)',r'C:\Program Files (x86)'),os.environ.get('ProgramFiles',r'C:\Program Files')]:
        queue=[(Path(base)/'Hnc',0)]
        while queue:
            folder,depth=queue.pop(0);file=folder/'Hwp.exe'
            if valid(file):files.append(file)
            if depth>=3:continue
            try:
                for child in folder.iterdir():
                    if child.is_dir() and not child.is_symlink() and re.match(r'^(Office|HOffice|Hwp)' if depth==0 else r'^(HOffice|Hwp|Bin)',child.name,re.I):queue.append((child,depth+1))
            except OSError:pass
    import winreg
    for hive in [winreg.HKEY_CURRENT_USER,winreg.HKEY_LOCAL_MACHINE]:
        for view in [winreg.KEY_WOW64_32KEY,winreg.KEY_WOW64_64KEY]:
            try:
                with winreg.OpenKey(hive,r'SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Hwp.exe',0,winreg.KEY_READ|view) as key:
                    file=Path(os.path.expandvars(winreg.QueryValueEx(key,'')[0]).strip('"'))
                    if valid(file):files.append(file)
            except OSError:pass
    if not files:raise ValueError('한컴오피스 한글을 먼저 설치하고 한 번 실행하세요.')
    return sorted(set(files),key=lambda file:(rank(file),str(file)),reverse=True)[0].resolve()
