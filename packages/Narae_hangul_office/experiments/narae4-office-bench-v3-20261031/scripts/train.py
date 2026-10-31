"""Real CPU LoRA SFT of the final full-attention decoder block.

Freeze and cache 23 BF16 decoder blocks. Compute the suffix/head in FP32 for
AVX2 CPU backward. Preserve causal masks and MRoPE. Vision stays frozen.
"""
import os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
for key,folder in {'HF_HOME':'cache/hf','HF_HUB_CACHE':'cache/hf/hub','TORCH_HOME':'cache/torch','TEMP':'tmp','TMP':'tmp'}.items():
    (ROOT/folder).mkdir(parents=True,exist_ok=True);os.environ[key]=str(ROOT/folder)
os.environ['TOKENIZERS_PARALLELISM']='false'
import argparse,ctypes,gc,hashlib,importlib.metadata,json,math,random,time,traceback
import torch
from torch.nn import functional as F
from transformers import AutoTokenizer,Qwen3_5ForConditionalGeneration
from peft import PeftModel
torch.set_num_threads(6);torch.set_num_interop_threads(1)
BASE=Path('D:/Codex/models/Qwen3.5-2B-HF');ALIAS='Narae4-Qwen3.5-2B-Office-Bench-LoRA-v3'
def sha(p):
    with Path(p).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def dump(p,v):
    p=Path(p);p.parent.mkdir(parents=True,exist_ok=True);t=p.with_suffix('.tmp');t.write_text(json.dumps(v,ensure_ascii=False,indent=2),'utf8');t.replace(p)
def rows(split):return [json.loads(x) for x in (ROOT/'data'/f'{split}.jsonl').read_text('utf8').splitlines() if x]
class Memory(ctypes.Structure):
    _fields_=[('cb',ctypes.c_ulong),('faults',ctypes.c_ulong)]+[(n,ctypes.c_size_t) for n in ['peak_rss','rss','peak_paged','paged','peak_nonpaged','nonpaged','pagefile','peak_pagefile','private']]
ctypes.windll.kernel32.GetCurrentProcess.restype=ctypes.c_void_p
ctypes.windll.psapi.GetProcessMemoryInfo.argtypes=[ctypes.c_void_p,ctypes.POINTER(Memory),ctypes.c_ulong]
def memory():
    m=Memory();m.cb=ctypes.sizeof(m)
    ctypes.windll.psapi.GetProcessMemoryInfo(ctypes.windll.kernel32.GetCurrentProcess(),ctypes.byref(m),m.cb)
    return {'peak_rss_bytes':m.peak_rss,'rss_bytes':m.rss,'private_bytes':m.private}
def encode(tokenizer,row):
    # Qwen3.5 templates can rewrite historical assistant thinking. Locate the
    # final assistant target by rendering its prompt independently and verifying
    # exact prefix equality; never label user or tool observations.
    messages=row['messages'];assert messages[-1]['role']=='assistant'
    prompt=tokenizer.apply_chat_template(messages[:-1],tokenize=False,add_generation_prompt=True,enable_thinking=False)
    target=messages[-1]['content']+tokenizer.eos_token
    text=tokenizer.apply_chat_template(messages,tokenize=False,add_generation_prompt=False,enable_thinking=False)
    assert text.startswith(prompt) and text[len(prompt):]==target+'\n',row['id']
    e=tokenizer(text,add_special_tokens=False,return_offsets_mapping=True);ids=e['input_ids']
    if len(ids)>4096:raise ValueError(f"No truncation: {row['id']} has {len(ids)} tokens")
    labels=[-100]*len(ids);start=len(prompt);end=start+len(target)
    positions=[i for i,(a,b) in enumerate(e['offset_mapping']) if a>=start and b<=end and b>a]
    assert tokenizer.decode([ids[i] for i in positions])==target
    for i in positions:labels[i]=ids[i]
    return torch.tensor([ids]),torch.tensor([labels])
def fp32(value):
    if torch.is_tensor(value):return value.float() if value.is_floating_point() else value
    if isinstance(value,tuple):return tuple(fp32(v) for v in value)
    if isinstance(value,list):return [fp32(v) for v in value]
    if isinstance(value,dict):return {k:fp32(v) for k,v in value.items()}
    return value
def cast_suffix(module,args,kwargs):return fp32(args),fp32(kwargs)
class Capture(Exception):pass
class Run:
    def __init__(self,pilot):
        self.pilot=pilot;self.started=time.monotonic();self.out=ROOT/'outputs'/ALIAS;self.out.mkdir(parents=True,exist_ok=True);self.cache=ROOT/'cache/features';self.cache.mkdir(parents=True,exist_ok=True);self.step=0
    def emit(self,stage,**v):
        event={'stage':stage,'seconds':round(time.monotonic()-self.started,3),**memory(),**v};print(json.dumps(event),flush=True)
        with (self.out/'events.jsonl').open('a',encoding='utf8') as f:f.write(json.dumps(event)+'\n')
        dump(self.out/'status.json',event)
    def parts(self):
        base=self.model.get_base_model();return base.model.language_model,base.lm_head
    def capture(self,ids):
        text,_=self.parts();record={}
        def hook(module,args,kwargs):
            kwargs=dict(kwargs);hidden=args[0] if args else kwargs.pop('hidden_states');record.update(hidden=hidden.detach().clone(),kwargs=kwargs);raise Capture()
        handle=text.layers[23].register_forward_pre_hook(hook,with_kwargs=True)
        try:
            with torch.no_grad():
                try:text(input_ids=ids,use_cache=False)
                except Capture:pass
                else:raise RuntimeError('Prefix capture failed')
        finally:handle.remove()
        return record
    def loss(self,record):
        text,head=self.parts();hidden=text.layers[23](record['hidden'],**record['kwargs']);hidden=text.norm(hidden)
        labels=record['labels'][:,1:];valid=labels.ne(-100)
        return F.cross_entropy(head(hidden[:,:-1][valid]).float(),labels[valid])
    def full_loss(self,ids,labels):
        text,head=self.parts();hidden=text(input_ids=ids,use_cache=False).last_hidden_state;targets=labels[:,1:];valid=targets.ne(-100)
        return F.cross_entropy(head(hidden[:,:-1][valid]).float(),targets[valid])
    def mean(self,paths):
        with torch.no_grad():return sum(float(self.loss(torch.load(p,weights_only=True))) for p in paths)/len(paths)
    def run(self):
        torch.manual_seed(719);random.seed(719)
        manifest=json.loads((ROOT/'download-manifest.json').read_text('utf8'))
        assert manifest['revision']=='15852e8c16360a2fea060d615a32b45270f8a8fc'
        for f in manifest['files']:
            if f['path'].endswith('.safetensors') or f['path'] in ['config.json','tokenizer.json','chat_template.jinja']:assert sha(BASE/f['path'])==f['sha256']
        self.tokenizer=AutoTokenizer.from_pretrained(BASE,local_files_only=True)
        training=rows('train');validation=rows('validation');encoded={r['id']:encode(self.tokenizer,r) for r in training+validation}
        dataset=json.loads((ROOT/'data/manifest.json').read_text('utf8'))
        for name,digest in dataset['files'].items():assert sha(ROOT/'data'/name)==digest
        assert sha(ROOT/'evaluation/heldout-cases.json')==dataset['heldoutSha256']
        assert sha(Path(dataset['startingAdapter'])/'adapter_model.safetensors')==dataset['startingAdapterSha256']
        frozen={'base_revision':manifest['revision'],'data':dataset,'dtype':'BF16 frozen prefix; FP32 suffix/head/LoRA','layers':[23],'rank':16,'alpha':32,'learning_rate':2e-5,'epochs':3,'optimizer_steps':48,'seed':719,'train_script_sha256':sha(__file__)}
        dump(self.out/'frozen-profile.json',frozen)
        self.emit('loading-bf16-base',token_counts={k:v[0].numel() for k,v in encoded.items()})
        base=Qwen3_5ForConditionalGeneration.from_pretrained(BASE,local_files_only=True,dtype=torch.bfloat16,device_map={'':'cpu'},attn_implementation='sdpa')
        base.config.use_cache=False;base.config.text_config.use_cache=False
        # Text SFT never invokes the frozen image encoder; do not retain its
        # weights in this memory-limited training process. Runtime uses the
        # original separately verified mmproj unchanged.
        base.model.visual=torch.nn.Identity();gc.collect()
        self.model=PeftModel.from_pretrained(base,dataset['startingAdapter'],is_trainable=True,local_files_only=True);self.model.eval();del base
        self.model.peft_config['default'].base_model_name_or_path='Qwen/Qwen3.5-2B'
        self.model.peft_config['default'].revision=manifest['revision']
        text,head=self.parts()
        text.layers[23].float();text.norm.float()
        # Break only the frozen output-head alias: input embedding remains BF16.
        head.weight=torch.nn.Parameter(head.weight.detach().float(),requires_grad=False)
        text.layers[23].register_forward_pre_hook(cast_suffix,with_kwargs=True)
        params=[p for p in self.model.parameters() if p.requires_grad]
        self.emit('adapter-initialized',trainable_parameters=sum(p.numel() for p in params),trainable_tensors=len(params))
        ids,labels=encoded[training[0]['id']];record=self.capture(ids);record['labels']=labels
        with torch.no_grad():
            full=float(self.full_loss(ids,labels));cached=float(self.loss(record));assert abs(full-cached)<1e-5,(full,cached)
            changed=ids.clone();position=ids.shape[1]-3;changed[0,position]=(changed[0,position]+7)%self.tokenizer.vocab_size
            other=self.capture(changed);text,_=self.parts()
            before=text.norm(text.layers[23](record['hidden'],**record['kwargs']))
            after=text.norm(text.layers[23](other['hidden'],**other['kwargs']))
            causal_diff=float((before[:,:position]-after[:,:position]).abs().max());assert causal_diff<1e-5,causal_diff
        self.emit('prefix-equivalence-verified',full_loss=full,cached_loss=cached,future_token_max_diff=causal_diff)
        start=time.monotonic();loss=self.loss(record);loss.backward();assert all(p.grad is not None and torch.isfinite(p.grad).all() for p in params)
        self.emit('backward-pilot-passed',loss=float(loss.detach()),backward_seconds=time.monotonic()-start)
        self.model.zero_grad(set_to_none=True)
        if self.pilot:return
        paths={}
        for split,data in [('train',training),('validation',validation)]:
            paths[split]=[]
            for i,row in enumerate(data):
                ids,labels=encoded[row['id']];target=self.cache/(row['id']+'.pt')
                encoded_sha=hashlib.sha256(ids.numpy().tobytes()).hexdigest()
                if not target.exists():
                    feature=self.capture(ids);feature.update(labels=labels,encoded_sha256=encoded_sha,base_revision=manifest['revision']);torch.save(feature,target)
                else:
                    feature=torch.load(target,weights_only=True);assert feature['encoded_sha256']==encoded_sha and feature['base_revision']==manifest['revision'] and torch.equal(feature['labels'],labels)
                paths[split].append(target);self.emit('cached-frozen-prefix',split=split,completed=i+1,total=len(data))
        text,_=self.parts()
        for i in range(23):text.layers[i]=torch.nn.Identity()
        self.model.get_base_model().model.visual=torch.nn.Identity();text.embed_tokens=torch.nn.Identity();gc.collect()
        before={n:p.detach().clone() for n,p in self.model.named_parameters() if p.requires_grad}
        initial={'train':self.mean(paths['train']),'validation':self.mean(paths['validation'])};self.emit('initial-loss',**initial)
        assert len(training)==64 and len(validation)==16
        optimizer=torch.optim.AdamW(params,lr=2e-5,weight_decay=.01);steps=48;accumulation=4;losses=[]
        for epoch in range(3):
            order=list(paths['train']);random.Random(719+epoch).shuffle(order)
            for i,p in enumerate(order):
                loss=self.loss(torch.load(p,weights_only=True));assert torch.isfinite(loss);losses.append(float(loss.detach()));(loss/accumulation).backward()
                if (i+1)%accumulation==0:
                    norm=float(torch.nn.utils.clip_grad_norm_(params,1));assert math.isfinite(norm);optimizer.step();optimizer.zero_grad(set_to_none=True);self.step+=1
                    for group in optimizer.param_groups:group['lr']=2e-5*(.1+.9*.5*(1+math.cos(math.pi*self.step/steps)))
                    self.model.save_pretrained(self.out/f'checkpoint-{self.step}',safe_serialization=True,save_embedding_layers=False)
                    self.emit('optimizer-update',epoch=epoch+1,step=self.step,loss=sum(losses[-4:])/4,gradient_norm=norm)
        final={'train':self.mean(paths['train']),'validation':self.mean(paths['validation'])}
        adapter=self.out/'adapter';self.model.save_pretrained(adapter,safe_serialization=True,save_embedding_layers=False)
        changed={n:float((p.detach()-before[n]).norm()) for n,p in self.model.named_parameters() if p.requires_grad}
        assert self.step==48 and all(v>0 for v in changed.values())
        assert sha(adapter/'adapter_model.safetensors')!=dataset['startingAdapterSha256']
        report={'model':ALIAS,'actual_weight_training':True,'base':manifest,'optimizer_steps':self.step,'epochs':3,'train_dialogues':64,'validation_dialogues':16,'lora_rank':16,'lora_alpha':32,'layers':[23],'vision_tower_trained':False,'decision_model_trained':False,'dtype':frozen['dtype'],'trainable_parameters':sum(p.numel() for p in params),'tensors_changed':len(changed),'tensor_l2_changes':changed,'initial_loss':initial,'final_loss':final,'prefix_equivalence':{'full_loss':full,'cached_loss':cached,'future_token_max_diff':causal_diff},'adapter_sha256':sha(adapter/'adapter_model.safetensors'),'seconds':time.monotonic()-self.started,'dataset':dataset,'versions':{p:importlib.metadata.version(p) for p in ['torch','transformers','peft','safetensors']},'scripts_sha256':{p.name:sha(p) for p in (ROOT/'scripts').glob('*') if p.is_file()}}
        dump(self.out/'training-report.json',report);self.emit('training-complete',optimizer_steps=self.step,initial_loss=initial,final_loss=final,adapter_sha256=report['adapter_sha256'])
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--pilot',action='store_true');a=parser.parse_args();run=Run(a.pilot)
    try:run.run()
    except BaseException as e:run.emit('failed',error=str(e));raise
