"""Publish only verified GGUF weights, adapters, cards and licenses to Hugging Face."""
import argparse,hashlib,json,os,tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def sha(file):
    digest=hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda:stream.read(8*1024*1024),b''):digest.update(chunk)
    return digest.hexdigest()

def publish(source,namespace=None,prepare_only=False,staging_root=None):
    catalog_path=ROOT/'resources/local-models.json'
    catalog=json.loads(catalog_path.read_text('utf-8'))
    api=None
    if not prepare_only:
        from huggingface_hub import HfApi,get_token
        if not get_token():raise ValueError('Hugging Face login required. Run hf auth login locally; do not put a token in chat.')
        api=HfApi();namespace=namespace or api.whoami()['name']
    import re
    if namespace and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*',namespace):raise ValueError('Invalid Hugging Face namespace')
    staging_root=Path(staging_root or os.environ.get('TEMP') or 'D:/Codex/tmp').resolve()
    staging_root.mkdir(parents=True,exist_ok=True)
    # The allowlist never includes training datasets, conversations or credentials.
    results=[]
    for model in catalog['models']:
        folder=staging_root/('narae-hf-'+model['id']);folder.mkdir(exist_ok=True)
        for key in ('base','adapter'):
            spec=model[key];file=source/'models'/model['id']/spec['path']
            if file.stat().st_size!=spec['bytes'] or sha(file)!=spec['sha256']:raise ValueError('Weight verification failed: '+str(file))
            target=folder/spec['path']
            if target.exists():
                if target.stat().st_size!=spec['bytes'] or sha(target)!=spec['sha256']:raise ValueError('Changed staging file preserved: '+str(target))
            else:
                try:os.link(file,target)
                except OSError:
                    import shutil
                    shutil.copy2(file,target)
        name={'narae1':'Qwen3-0.6B-LICENSE.txt','narae2':'EXAONE-3.5-LICENSE.txt','narae3':'Qwen3-4B-LICENSE.txt'}[model['id']]
        (folder/'LICENSE').write_bytes((ROOT/'resources/model-licenses'/name).read_bytes())
        license_id='other' if model['researchOnly'] else 'apache-2.0'
        special='\nlicense_name: exaone-1.1-nc\nlicense_link: LICENSE' if model['researchOnly'] else ''
        card=f'''---
language: [ko, en]
license: {license_id}{special}
base_model: {model['upstream']}
base_model_relation: adapter
tags: [gguf, lora, narae, experimental]
---
# {model['alias']}

Experimental Narae agent model. This release contains an upstream GGUF base and
the actual weight-trained GGUF LoRA adapter. Both files must be loaded together
with adapter strength {model['strength']}. It is not a prompt profile.

- Upstream: [{model['upstream']}](https://huggingface.co/{model['upstream']})
- Optimizer updates recorded in the original model manifest: {model['optimizerUpdates']}
- License: {model['license']}. {'Research and evaluation only; EXAONE original terms apply.' if model['researchOnly'] else 'Keep the upstream Apache-2.0 terms and attribution.'}
- Tool execution, document correctness and autonomous completion are not guaranteed.
- No training dataset, user document, credential or conversation is included.

Use Narae Hangul Office model settings to install and activate this model.
The app checks SHA256, the loaded model alias and the actual LoRA adapter.

| File | Bytes | SHA256 |
|---|---:|---|
'''
        for key in ('base','adapter'):
            spec=model[key];card+=f"| {spec['path']} | {spec['bytes']} | {spec['sha256']} |\n"
        (folder/'README.md').write_text(card,'utf-8')
        (folder/'model-manifest.json').write_text(json.dumps(model,ensure_ascii=False,indent=2),'utf-8')
        if api:
            repo=namespace+'/'+model['alias'];api.create_repo(repo_id=repo,repo_type='model',private=False,exist_ok=True)
            commit=api.upload_folder(repo_id=repo,folder_path=str(folder),allow_patterns=['base.gguf','adapter.gguf','README.md','LICENSE','model-manifest.json'],commit_message='Publish verified Narae GGUF base and trained adapter')
            model['repoId']=repo;model['revision']=commit.oid
            stage=catalog_path.with_suffix('.tmp');stage.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n','utf-8');stage.replace(catalog_path)
            results.append({'id':model['id'],'repoId':repo,'revision':commit.oid})
        else:results.append({'id':model['id'],'prepared':str(folder),'uploaded':False})
    return results

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True,help='Narae Gyomu folder containing models/narae1..3')
    parser.add_argument('--namespace')
    parser.add_argument('--prepare-only',action='store_true')
    parser.add_argument('--staging-root',type=Path)
    args=parser.parse_args()
    print(json.dumps(publish(args.source.resolve(),args.namespace,args.prepare_only,args.staging_root),ensure_ascii=False,indent=2))
