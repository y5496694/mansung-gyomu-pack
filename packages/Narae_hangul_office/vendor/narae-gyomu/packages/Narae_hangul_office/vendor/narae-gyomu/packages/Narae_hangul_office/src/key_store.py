"""Current-user Windows DPAPI key storage; credentials travel only over stdin/stdout."""
import base64
import json
import os
from pathlib import Path
import sys
import uuid
import re
import win32crypt

HEADER=b'NARAE-DPAPI-1\0'

def read(home,slot='gpt-key'):
    file=home/'data'/(slot+'.bin')
    if not file.is_file():return ''
    blob=file.read_bytes()
    if blob.startswith(HEADER):
        return win32crypt.CryptUnprotectData(blob[len(HEADER):],None,None,None,0)[1].decode('utf-8')
    if blob.startswith((b'v10',b'v11')):
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        # Electron's old ciphertext depends on a Chromium profile key. Try
        # only this app's own prior profiles and keep the old file unchanged.
        states=list((home/'cache').glob('session-*/Local State'))+list((home/'data').glob('profile-*/Local State'))
        for state in states:
            try:
                encoded=json.loads(state.read_text('utf-8'))['os_crypt']['encrypted_key']
                protected=base64.b64decode(encoded)
                if not protected.startswith(b'DPAPI'):continue
                key=win32crypt.CryptUnprotectData(protected[5:],None,None,None,0)[1]
                return AESGCM(key).decrypt(blob[3:15],blob[15:],None).decode('utf-8')
            except Exception:continue
        raise ValueError('저장된 GPT 키를 읽을 수 없습니다. GPT 설정에서 키를 다시 저장하세요.')
    return win32crypt.CryptUnprotectData(blob,None,None,None,0)[1].decode('utf-8')

def run(request):
    home=Path(request['home']).resolve()
    slot=request.get('slot','gpt-key')
    if not re.fullmatch('[a-z][a-z0-9-]{0,48}',slot):raise ValueError('잘못된 저장소')
    if request['action']=='protect_directory':
        import win32api,win32security,ntsecuritycon
        folder=Path(request['path']).resolve()
        if not folder.is_relative_to(home/'cache') or not folder.name.startswith('oauth-ant-'):raise ValueError('잘못된 임시 경로')
        token=win32security.OpenProcessToken(win32api.GetCurrentProcess(),win32security.TOKEN_QUERY)
        sid=win32security.GetTokenInformation(token,win32security.TokenUser)[0]
        acl=win32security.ACL();flags=win32security.OBJECT_INHERIT_ACE|win32security.CONTAINER_INHERIT_ACE
        for allowed in [sid,win32security.CreateWellKnownSid(win32security.WinLocalSystemSid)]:acl.AddAccessAllowedAceEx(win32security.ACL_REVISION,flags,ntsecuritycon.FILE_ALL_ACCESS,allowed)
        win32security.SetNamedSecurityInfo(str(folder),win32security.SE_FILE_OBJECT,win32security.DACL_SECURITY_INFORMATION|win32security.PROTECTED_DACL_SECURITY_INFORMATION,None,None,acl,None)
        return {'protected':True}
    if request['action']=='read':return {'key':read(home,slot)}
    if request['action']=='write':
        key=request['key']
        if not isinstance(key,str) or not key:raise ValueError('API 키를 입력하세요.')
        file=home/'data'/(slot+'.bin');file.parent.mkdir(parents=True,exist_ok=True)
        encrypted=HEADER+win32crypt.CryptProtectData(key.encode('utf-8'),'Narae Office GPT',None,None,None,0)
        temporary=file.with_name('.gpt-key-'+uuid.uuid4().hex+'.tmp')
        try:temporary.write_bytes(encrypted);os.replace(temporary,file)
        finally:temporary.unlink(missing_ok=True)
        return {'saved':True}
    raise ValueError('지원하지 않는 키 저장 작업입니다.')

if __name__=='__main__':
    try:print(json.dumps({'ok':True,**run(json.load(sys.stdin))},ensure_ascii=False))
    except Exception:
        print(json.dumps({'ok':False,'error':'Windows 사용자 키 저장소를 읽거나 저장하지 못했습니다. GPT 설정에서 키를 다시 저장하세요.'},ensure_ascii=False));sys.exit(1)
