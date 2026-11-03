"""Import an immutable, clean narae-gyomu Git snapshot including its file metadata."""
import argparse,hashlib,json,os,shutil,stat,subprocess,tempfile,zipfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--source',required=True);args=parser.parse_args()
source=Path(args.source).resolve();target=root/'vendor/narae-gyomu';lockfile=target/'OFFICE_VENDOR_LOCK.json'
def git(*args):return subprocess.check_output(['git','-C',str(source),*args]).decode('utf8').strip()
if git('status','--porcelain'):raise ValueError('Commit upstream changes before importing')
if target.is_symlink() or target.resolve().parent!=(root/'vendor').resolve():raise ValueError('Unexpected vendor target')
old=json.loads(lockfile.read_text('utf8')) if lockfile.exists() else {'files':{}}
if old.get('repository') and git('remote','get-url','origin').removesuffix('.git')!=old['repository']:raise ValueError('Source repository does not match pinned vendor')
def destination(name):
    p=target/name
    if not p.resolve().is_relative_to(target.resolve()):raise ValueError('Unsafe snapshot path')
    return p.with_name(p.name+'.upstream') if p.name=='.gitattributes' else p
for name,digest in old['files'].items():
    p=destination(name)
    if not p.resolve().is_relative_to(target.resolve()):raise ValueError('Unsafe snapshot path')
    # A previous importer wrote active attribute files. Migrate only files
    # whose bytes match this lock; keep upstream Git policy inert in Office.
    legacy=target/name
    if legacy.name=='.gitattributes' and legacy.exists() and hashlib.sha256(legacy.read_bytes()).hexdigest()==digest:
        if p.exists() and hashlib.sha256(p.read_bytes()).hexdigest()!=digest:
            backup=Path('D:/Codex/tmp/vendor-metadata-backup')/old['commit']/name
            backup.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,backup)
        legacy.replace(p)
    if not p.exists():raise ValueError('Missing snapshot: '+name)
    if hashlib.sha256(p.read_bytes()).hexdigest()!=digest:raise ValueError('Modified snapshot: '+name)
commit=git('rev-parse','HEAD');tmp=Path(os.environ.get('NARAE_TMP','D:/Codex/tmp'));tmp.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(dir=tmp) as temporary:
    archive=Path(temporary)/'source.zip';stage=Path(temporary)/'source';stage.mkdir()
    subprocess.run(['git','-C',str(source),'archive','--format=zip','--output',str(archive),commit],check=True)
    with zipfile.ZipFile(archive) as z:
        for item in z.infolist():
            if not (stage/item.filename).resolve().is_relative_to(stage.resolve()) or stat.S_ISLNK(item.external_attr>>16):raise ValueError('Unsafe source entry')
        z.extractall(stage)
    files={p.relative_to(stage).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(stage.rglob('*')) if p.is_file()}
    for name in old['files']:
        if name not in files:destination(name).unlink()
    for name in files:
        output=destination(name);output.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(stage/name,output)
    lock={'repository':git('remote','get-url','origin').removesuffix('.git'),'commit':commit,'files':files}
    lockfile.write_bytes((json.dumps(lock,ensure_ascii=False,indent=2)+'\n').encode('utf8'))
print(json.dumps({'commit':commit,'files':len(files)}))
