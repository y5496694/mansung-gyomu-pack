"""Assemble verified actual learned models and a portable Windows Python runtime."""
import hashlib,json,shutil,subprocess,sys,urllib.request,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
BENCH=ROOT.parent/'narae_bench'
def load(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def sha(p):
    with p.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
def copy(source,target,expected=None):
    source=Path(source);target.parent.mkdir(parents=True,exist_ok=True)
    if expected:assert sha(source)==expected,str(source)
    if not target.exists():shutil.copyfile(source,target)
    assert sha(target)==(expected or sha(source)),str(target)
    return {'path':target.relative_to(ROOT).as_posix(),'sha256':sha(target),'bytes':target.stat().st_size}

models=[]
v1=load(BENCH/'reports/model-comparison-20261019/serving/narae1.json')['identity']
v2base=load(BENCH/'reports/model-comparison-20261019/serving/narae2.json')['identity']
v2=load(Path('D:/Codex/training/narae-tool-sft-v2-20261019/exports/verification.json'))['verification'][1]
v3=load(Path('D:/Codex/models/Narae3/model.json'))
entries=[
    ('narae1','나래1','Narae1-Qwen3-0.6B-SFT-v1','0.6B','Qwen/Qwen3-0.6B',v1['file'],v1['sha256'],v1['adapter']['file'],v1['adapter']['export_sha256'],'Apache-2.0',156),
    ('narae2','나래2','EXAONE-Narae2-2.4B-Tool-SFT-v2','2.4B','LGAI-EXAONE/EXAONE-3.5-2.4B-Instruct',v2base['file'],v2base['sha256'],v2['file'],v2['export_sha256'],'EXAONE-1.1-NC',260),
    ('narae3','나래3','Narae3-Qwen3-4B-LoRA-v1','4B','Qwen/Qwen3-4B-Instruct-2507',v3['base']['file'],v3['base']['sha256'],v3['adapter']['file'],v3['adapter']['sha256'],'Apache-2.0',41),
]
for id,label,alias,size,upstream,base,bhash,adapter,ahash,license,steps in entries:
    folder=ROOT/'models'/id
    models.append({'id':id,'label':label,'alias':alias,'size':size,'upstream':upstream,
        'base':copy(base,folder/'base.gguf',bhash),'adapter':copy(adapter,folder/'adapter.gguf',ahash),
        'strength':1,'actualWeightTraining':True,'optimizerUpdates':steps,'license':license,
        'researchOnly':id=='narae2','experimental':True,
        'note':{'narae1':'경량 · SFT v1','narae2':'EXAONE · 연구·평가용','narae3':'Qwen · LoRA v1'}[id]})
    print('model assembled',id,flush=True)
(ROOT/'models').mkdir(exist_ok=True)
(ROOT/'models/catalog.json').write_bytes((json.dumps({'schema':1,'default':'narae2','models':models},ensure_ascii=False,indent=2)+'\n').encode())
llama=ROOT/'runtime/llama';llama.mkdir(parents=True,exist_ok=True)
for p in Path('D:/Codex/tools/llama-b11669-win-cpu').iterdir():
    if p.suffix=='.dll' or p.name in ('llama-server.exe','LICENSE-LLVM-OpenMP','source.json'):copy(p,llama/p.name)
copy(Path('D:/Codex/tools/llama.cpp/LICENSE'),llama/'LICENSE')
runtime={'schema':1,'llama':{'path':'runtime/llama/llama-server.exe','sha256':sha(llama/'llama-server.exe')},
         'python':'runtime/python/python.exe'}
(ROOT/'runtime.json').write_bytes((json.dumps(runtime,indent=2)+'\n').encode())
lic=ROOT/'licenses/models';lic.mkdir(parents=True,exist_ok=True)
copy(Path('D:/Codex/training/narae-sft-20261019/models/base-0.6b/LICENSE'),lic/'Qwen3-0.6B-LICENSE.txt')
copy(Path('D:/Codex/training/narae-sft-20261019/models/base-2.4b/LICENSE'),lic/'EXAONE-3.5-LICENSE.txt')
copy(Path('D:/Codex/models/Narae3/LICENSE'),lic/'Qwen3-4B-LICENSE.txt')

python=ROOT/'runtime/python'
python.mkdir(parents=True,exist_ok=True)
download=Path('D:/Codex/downloads/python-3.13.5-embed-amd64.zip')
if not download.exists():urllib.request.urlretrieve('https://www.python.org/ftp/python/3.13.5/python-3.13.5-embed-amd64.zip',download)
if not (python/'python.exe').exists():
    with zipfile.ZipFile(download) as archive:archive.extractall(python)
(python/'python313._pth').write_bytes(('python313.zip\n.\nLib\nLib/site-packages\n'+
    '../../packages/narae_gyomoo_portal/skills/wxs-cli/scripts\n'+
    '../../resources/app/packages/narae_gyomoo_portal/skills/wxs-cli/scripts\nimport site\n').encode('utf8'))
# The upstream wrapper imports venv even for run/doctor; the embedded stdlib omits it.
stdlib=Path(getattr(sys,'_base_executable',sys.executable)).parent/'Lib'
for module in ('venv','ensurepip'):
    if not (python/'Lib'/module).exists():shutil.copytree(stdlib/module,python/'Lib'/module)
target=python/'Lib/site-packages'
if not (target/'PySide6').exists():
    subprocess.run([getattr(sys,'_base_executable',sys.executable),'-m','pip','install','--target',str(target),
        'PySide6==6.12.0','olefile>=0.47,<1','fonttools==4.66.1','pycryptodome==3.23.0','pypdf==6.13.0',
        'Pillow>=11,<13','pywin32==312'],check=True)
subprocess.run([str(python/'python.exe'),'-s','-c','import PySide6,olefile,fontTools,Crypto,pypdf,PIL,win32com.client,site; assert not site.ENABLE_USER_SITE; print("portable Python ready")'],check=True)
reader_probe=subprocess.run([str(python/'python.exe'),'-s','-c','import pypdfium2,openpyxl,xlrd,docx,pptx'],capture_output=True)
if reader_probe.returncode:
    subprocess.run([getattr(sys,'_base_executable',sys.executable),'-m','pip','install','--target',str(target),
        'pypdfium2>=5.12,<6','openpyxl==3.1.5','xlrd==2.0.2','python-docx==1.2.0','python-pptx==1.0.2'],check=True)
subprocess.run([str(python/'python.exe'),'-s','-c','import pypdfium2,openpyxl,xlrd,docx,pptx; print("attachment readers ready")'],check=True)
print('portable models and runtime ready',flush=True)
