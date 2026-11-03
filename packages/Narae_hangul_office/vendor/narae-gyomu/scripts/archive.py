"""Make a ZIP64 portable pack and verified sub-2GB release volumes."""
import hashlib,json,sys,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
source=Path(sys.argv[1]).resolve()
out=Path('D:/Codex/outputs/narae-gyomu-v0.1.0-preview.1');out.mkdir(parents=True,exist_ok=True)
archive=out/'NaraeGyomu-0.1.0-win-x64.zip'
if archive.exists():raise SystemExit('Existing archive preserved')
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=1,allowZip64=True) as z:
    for p in sorted(source.rglob('*')):
        if p.is_file():z.write(p,p.relative_to(source).as_posix())
size=1500*1024*1024
parts=[]
with archive.open('rb') as stream:
    index=1
    while True:
        first=stream.read(8*1024*1024)
        if not first:break
        name=archive.name+f'.part{index:02d}';file=out/name;digest=hashlib.sha256();written=0
        with file.open('xb') as target:
            block=first
            while block:
                target.write(block);digest.update(block);written+=len(block)
                if written>=size:break
                block=stream.read(min(8*1024*1024,size-written))
        parts.append({'name':name,'bytes':written,'sha256':digest.hexdigest()});index+=1
manifest={'version':'0.1.0-preview.1','archive':archive.name,'archive_bytes':archive.stat().st_size,
    'archive_sha256':hashlib.file_digest(archive.open('rb'),'sha256').hexdigest(),'parts':parts,
    'models_included':['narae1','narae2','narae3'],'format':'ZIP64 split byte stream; concatenate parts before extracting',
    'data_included':False,'weights_included':True}
(out/'release-manifest.json').write_bytes((json.dumps(manifest,indent=2)+'\n').encode())
print(json.dumps(manifest),flush=True)
