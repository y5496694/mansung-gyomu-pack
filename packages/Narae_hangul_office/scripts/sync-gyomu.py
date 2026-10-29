"""Import an immutable, verified narae-gyomu commit (never runtime/local files)."""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import subprocess
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=Path)
parser.add_argument('--ref', default='origin/main')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1] / 'vendor/narae-gyomu'
lock_path = root / 'OFFICE_VENDOR_LOCK.json'
old = json.loads(lock_path.read_text(encoding='utf-8'))

def destination(name):
    relative = PurePosixPath(name)
    if relative.is_absolute() or '..' in relative.parts or '\\' in name:
        raise ValueError('Unsafe source path')
    result = root / relative
    # Git attribute policy belongs to the parent app, not its frozen vendors.
    return result.with_name(result.name + '.upstream') if result.name == '.gitattributes' else result

for name, expected in old['files'].items():
    if hashlib.sha256(destination(name).read_bytes()).hexdigest() != expected:
        raise ValueError('Local vendor edits must be reviewed first: ' + name)
commit = subprocess.check_output(['git','rev-parse',args.ref],cwd=args.source,text=True).strip()
remote = subprocess.check_output(['git','remote','get-url','origin'],cwd=args.source,text=True).strip()
if remote.removesuffix('.git') != old['repository']:
    raise ValueError('The source repository does not match the existing vendor')
archive = subprocess.check_output(['git','archive','--format=zip',commit],cwd=args.source)
files = {}
with zipfile.ZipFile(io.BytesIO(archive)) as snapshot:
    for item in snapshot.infolist():
        if item.is_dir():
            continue
        name = item.filename
        if name not in old['files'] and not name.startswith(('src/','skills/','packages/')):
            continue
        data = snapshot.read(item)
        output = destination(name)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(data)
        files[name] = hashlib.sha256(data).hexdigest()
for name in old['files'].keys() - files.keys():
    destination(name).unlink()
lock = {'repository':old['repository'],'commit':commit,'files':files}
lock_path.write_bytes((json.dumps(lock,ensure_ascii=False,indent=2)+'\n').encode('utf-8'))
print(json.dumps({'repository':lock['repository'],'commit':commit,'files':len(files)}))
