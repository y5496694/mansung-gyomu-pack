"""Freeze four user-owned GitHub source snapshots, without local runtime data."""
import argparse,hashlib,json,shutil,subprocess,tempfile,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
PROJECTS=['narae_browser','Narae_hangul_office','CBE_CLI','narae_gyomoo_portal']
TMP=Path(tempfile.gettempdir())
parser=argparse.ArgumentParser()
parser.add_argument('--only',nargs='+',choices=PROJECTS,default=PROJECTS)
parser.add_argument('--update',action='store_true')
parser.add_argument('--source',action='append',default=[],metavar='NAME=PATH',help='Explicit local clone for a named source')
args=parser.parse_args()
overrides=dict(value.split('=',1) for value in args.source)
if set(overrides)-set(PROJECTS):parser.error('Unknown source override')
lock=json.loads((ROOT/'sources.lock.json').read_text('utf-8-sig')) if args.update else {'schema':1,'sources':[]}
for name in args.only:
    repo=Path(overrides[name]).resolve() if name in overrides else ROOT.parent/name
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo).decode().strip()
    remote=subprocess.check_output(['git','remote','get-url','origin'],cwd=repo).decode().strip()
    target=ROOT/'packages'/name
    if target.is_symlink() or target.resolve().parent!=(ROOT/'packages').resolve():raise ValueError('Invalid snapshot path')
    if target.exists() and not args.update:raise SystemExit(f'Existing snapshot preserved: {target}')
    if target.exists():
        old=next((s for s in lock['sources'] if s['name']==name),None)
        if not old:raise ValueError('Existing folder has no source manifest: '+name)
        for relative,expected in old['files'].items():
            if hashlib.sha256((target/relative).read_bytes()).hexdigest()!=expected:raise ValueError('Local snapshot changes: '+relative)
    with tempfile.TemporaryDirectory(dir=TMP) as temp:
        archive=Path(temp)/'source.zip'
        stage=Path(temp)/'snapshot';stage.mkdir()
        subprocess.run(['git','archive','--format=zip','--output',str(archive),commit],cwd=repo,check=True)
        with zipfile.ZipFile(archive) as source:
            for item in source.infolist():
                dest=(stage/item.filename).resolve()
                if not dest.is_relative_to(stage.resolve()):raise ValueError(item.filename)
            source.extractall(stage)
        if target.exists():shutil.rmtree(target)
        shutil.copytree(stage,target)
    files={p.relative_to(target).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(target.rglob('*')) if p.is_file()}
    lock['sources']=[s for s in lock['sources'] if s['name']!=name]
    lock['sources'].append({'name':name,'repository':remote.removesuffix('.git'),'commit':commit,'files':files})
    print(name,commit,len(files),flush=True)
if 'Narae_hangul_office' in args.only:
    retired=ROOT/'packages/narae_hangul'
    old=next((s for s in lock['sources'] if s['name']=='narae_hangul'),None)
    if old and retired.exists():
        if retired.is_symlink() or retired.resolve().parent!=(ROOT/'packages').resolve():raise ValueError('Invalid retired path')
        for relative,expected in old['files'].items():
            if hashlib.sha256((retired/relative).read_bytes()).hexdigest()!=expected:raise ValueError('Local retired snapshot changes: '+relative)
        shutil.rmtree(retired)
    lock['sources']=[s for s in lock['sources'] if s['name']!='narae_hangul']
(ROOT/'sources.lock.json').write_bytes((json.dumps(lock,ensure_ascii=False,indent=2)+'\n').encode())
