"""Export the real Qwen3.5 adapter and verify every GGUF tensor against SFT."""
import hashlib,json,re,subprocess,sys
from pathlib import Path
import numpy as np
from safetensors.numpy import load_file
ROOT=Path(__file__).resolve().parents[1];ALIAS='Narae4-Qwen3.5-2B-Office-Bench-LoRA-v3'
def sha(p):
    with Path(p).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
report=json.loads((ROOT/'outputs'/ALIAS/'training-report.json').read_text('utf8'))
assert report['actual_weight_training'] and report['optimizer_steps']==48 and report['tensors_changed']==14
source=ROOT/'outputs'/ALIAS/'adapter/adapter_model.safetensors';assert sha(source)==report['adapter_sha256']
folder=ROOT/'exports';folder.mkdir(exist_ok=True);target=folder/(ALIAS+'-f32.gguf');converter=Path('D:/Codex/tools/llama.cpp/convert_lora_to_gguf.py')
with (ROOT/'logs/convert.log').open('wb') as log:subprocess.run([sys.executable,'-X','utf8',str(converter),'--base',report['base']['destination'],'--outtype','f32','--outfile',str(target),str(source.parent)],stdout=log,stderr=log,check=True)
sys.path.insert(0,'D:/Codex/tools/llama.cpp/gguf-py');from gguf import GGUFReader
reader=GGUFReader(target);assert reader.fields['general.architecture'].contents()=='qwen35'
assert reader.fields['adapter.lora.alpha'].contents()==32
mapping={'q_proj':'attn_q','k_proj':'attn_k','v_proj':'attn_v','o_proj':'attn_output','gate_proj':'ffn_gate','up_proj':'ffn_up','down_proj':'ffn_down'};expected={}
for name,value in load_file(source).items():
    layer=re.search(r'\.layers\.(\d+)\.',name).group(1);projection,side=re.search(r'\.('+'|'.join(mapping)+r')\.lora_([AB])\.',name).groups();key=f'blk.{layer}.{mapping[projection]}.weight.lora_{side.lower()}';assert key not in expected;expected[key]=value
actual={t.name:t.data for t in reader.tensors};assert expected.keys()==actual.keys() and len(actual)==14
for key in expected:assert np.array_equal(expected[key],actual[key]),key
out={'model':ALIAS,'tensor_count':14,'all_tensors_bitwise_equal':True,'source_sha256':sha(source),'export_sha256':sha(target),'export_bytes':target.stat().st_size,'rank':16,'alpha':32,'converter_sha256':sha(converter),'scope':'Frozen BF16 training base versus Q4_K_M runtime is a quantization difference; runtime evaluation required.'}
(folder/'verification.json').write_text(json.dumps(out,indent=2),'utf8');print(json.dumps(out))
