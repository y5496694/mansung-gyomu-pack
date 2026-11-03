"""Publish the adopted Narae4 v1 weights with explicit component provenance."""
import argparse
import hashlib
import json
import os
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / 'resources/local-models.json'
RUNTIME_COMMIT = '6d732d5e3b69e8598014cf2904fb27ff112050d4'
INSTALL_COMMIT = 'b9d03f5671c4821a24fd50b31d6452aec03f97ae'


def sha(file):
    digest = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def read(file):
    return json.loads(file.read_text('utf-8-sig'))


def write_json(file, value):
    file.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', 'utf-8')


def verified_stage(source, target, expected_hash, expected_bytes=None):
    if source.is_symlink() or not source.is_file():
        raise ValueError('A regular source weight file is required')
    if expected_bytes is not None and source.stat().st_size != expected_bytes:
        raise ValueError('Source weight size mismatch: ' + source.name)
    if sha(source) != expected_hash:
        raise ValueError('Source weight hash mismatch: ' + source.name)
    if target.exists():
        if target.is_symlink() or target.stat().st_size != source.stat().st_size or sha(target) != expected_hash:
            raise ValueError('Changed staging file preserved: ' + target.name)
    else:
        try:
            os.link(source, target)
        except OSError:
            shutil.copy2(source, target)
    return {'path': target.name, 'bytes': target.stat().st_size, 'sha256': expected_hash}


def prepare(model_directory, training_directory, stage, namespace):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*', namespace):
        raise ValueError('Invalid Hugging Face namespace')
    catalog = read(CATALOG)
    model = next(m for m in catalog['models'] if m['id'] == 'narae4')
    experiment = ROOT / 'experiments/narae4-office-20261031'
    summary = read(experiment / 'results/summary.json')
    training = read(experiment / 'results/training-report.json')
    export = read(training_directory / 'exports/verification.json')
    original = read(training_directory / 'exports/model-manifest.json')
    if (model['alias'] != summary['model'] or training['model'] != model['alias']
            or not training['actual_weight_training'] or training['optimizer_steps'] != model['optimizerUpdates']
            or not export['all_tensors_bitwise_equal'] or export['export_sha256'] != model['adapter']['sha256']
            or export['source_sha256'] != training['adapter_sha256']):
        raise ValueError('The adopted model, training report and export verification must agree')
    stage.mkdir(parents=True, exist_ok=True)
    repo_id = namespace + '/' + model['alias']
    files = []
    for role in ('base', 'adapter', 'projector', 'decision'):
        spec = model[role]
        if any(spec[k] != original[role][k] for k in ('path', 'bytes', 'sha256')):
            raise ValueError('A component differs from the tested v1 export manifest')
        files.append({**verified_stage(model_directory / (role + '.gguf'), stage / spec['path'], spec['sha256'], spec['bytes']), 'role': role, 'license': 'lfm1.0' if role == 'decision' else 'apache-2.0'})
    adapter = training_directory / 'outputs' / model['alias'] / 'adapter'
    files.append({**verified_stage(adapter / 'adapter_model.safetensors', stage / 'adapter_model.safetensors', training['adapter_sha256']), 'role': 'peft-adapter'})
    config_source = adapter / 'adapter_config.json'
    config = read(config_source)
    base_revision = read(experiment / 'base-metadata.json')['sha']
    if (config['base_model_name_or_path'] != model['upstream'] or config['revision'] != base_revision
            or config['r'] != 16 or config['lora_alpha'] != 32):
        raise ValueError('PEFT adapter configuration does not match the trained v1 model')
    files.append({**verified_stage(config_source, stage / 'adapter_config.json', sha(config_source)), 'role': 'peft-config'})
    # Retain original licenses for the separately licensed components.
    license_source = Path(training['base']['destination']) / 'LICENSE'
    license_spec = next(f for f in training['base']['files'] if f['path'] == 'LICENSE')
    if sha(license_source) != license_spec['sha256']:
        raise ValueError('Original Qwen license does not match the pinned training base')
    (stage / 'LICENSE').write_bytes(license_source.read_bytes())
    from huggingface_hub import hf_hub_download
    decision = original['decision']
    decision_license = Path(hf_hub_download(decision['repoId'], 'LICENSE', revision=decision['revision'], token=False))
    (stage / 'D1-LICENSE').write_bytes(decision_license.read_bytes())
    (stage / 'NOTICE').write_text(
        'Qwen3.5-2B: Copyright 2026 Alibaba Cloud. Apache-2.0.\n'
        'GGUF base and visual projector: unmodified files from unsloth/Qwen3.5-2B-GGUF, revision '
        + original['base']['revision'] + '.\n'
        'Narae4 Office LoRA v1: actual LoRA weight modifications by inhow, 2026.\n'
        'Only the last full-attention block (layer 23) was adapted.\n'
        'LiquidAI/d1-2B: unmodified pretrained Q4_K_M by Liquid AI, Inc.; '
        'LFM Open License v1.0, revision ' + decision['revision'] + '.\n', 'utf-8')
    (stage / 'COMPONENT_LICENSES.md').write_text(
        '# Component licenses\n\n'
        'The Qwen-derived weights, projector and Narae4 LoRA files in this repository use [Apache-2.0](LICENSE).\n\n'
        'The included pretrained `d1-2B-Q4_K_M.gguf` decision companion is an unchanged copy from '
        '[LiquidAI/d1-2B-GGUF](https://huggingface.co/LiquidAI/d1-2B-GGUF/tree/' + decision['revision'] + '). '
        'Its [LFM Open License v1.0](D1-LICENSE) applies separately. It is not Apache-2.0.\n\n'
        'This package contains separately routed models; no merged or jointly trained MoE weights are claimed.\n\n'
        'The Narae Office application uses MIT; that does not replace either model license.\n', 'utf-8')
    runtime_commit = RUNTIME_COMMIT
    evaluation = {
        'weightTraining': {k: training[k] for k in ['actual_weight_training', 'optimizer_steps', 'trainable_parameters', 'tensors_changed', 'train_dialogues', 'validation_dialogues', 'epochs', 'lora_rank', 'lora_alpha', 'vision_tower_trained', 'decision_model_trained', 'initial_loss', 'final_loss', 'versions']},
        'ggufExport': {k: export[k] for k in ['tensor_count', 'all_tensors_bitwise_equal', 'source_sha256', 'export_sha256', 'rank', 'alpha']},
        'heldoutNextAction': summary['heldout'],
        'runtimeIntegration': {'sourceCommit': runtime_commit, 'applicationVersion': '0.13.0-preview.24', 'date': '2026-11-01', 'syntheticOwnedRequisition': {'steps': 20, 'seconds': 131.296, 'serverSaveReadback': True, 'attachmentBytesAndSha256': True, 'deletedAndAbsentOnServerQuery': True, 'approvalSubmitted': False}, 'interpretation': 'A single end-to-end runtime/controller integration test; not a model-only autonomous benchmark or new weight training.'},
        'privateSchoolDataIncluded': False,
    }
    write_json(stage / 'evaluation-summary.json', evaluation)
    manifest = {'schema': 1, 'id': model['id'], 'alias': model['alias'], 'repoId': repo_id,
                'baseModel': {'repoId': model['upstream'], 'revision': base_revision},
                'actualWeightTraining': True, 'adapterStrength': model['strength'], 'files': files,
                'ggufProvenance': {k: original[k] for k in ('base', 'projector', 'decision')},
                'optionalDecisionCompanion': {**decision, 'bundled': True, 'trainedByNarae': False, 'license': 'LFM Open License v1.0'},
                'architecture': 'Separately routed vision-language model and optional decision companion; not jointly trained sparse MoE.',
                'runtimeSource': 'https://github.com/y5496694/Narae_hangul_office/tree/' + runtime_commit}
    write_json(stage / 'model-manifest.json', manifest)
    table = '\n'.join('| ' + f['path'] + ' | ' + str(f['bytes']) + ' | `' + f['sha256'] + '` |' for f in files)
    card = f'''---
language: [ko, en]
license: other
license_name: apache-2.0-and-lfm1.0-components
license_link: https://huggingface.co/{repo_id}/blob/main/COMPONENT_LICENSES.md
library_name: peft
pipeline_tag: image-text-to-text
base_model: Qwen/Qwen3.5-2B
base_model_relation: adapter
tags: [gguf, lora, narae4, qwen3_5, tool-calling, experimental]
---
# 나래4 / {model['alias']}

Korean office agent model for **Narae Hangul Office**. This is the adopted,
actually weight-trained **v1 LoRA**, with GGUF inference files and the original
PEFT adapter. Recent school-accounting automation is an application/runtime
improvement; it is not a new weight-trained v2 model.

## 구성 / Components

- Main model: [Qwen/Qwen3.5-2B](https://huggingface.co/Qwen/Qwen3.5-2B).
- Quantized base and F16 visual projector: unmodified files from
  [unsloth/Qwen3.5-2B-GGUF](https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/tree/{original['base']['revision']}).
- Trained component: Office LoRA v1, strength **1.0**, last full-attention block 23.
- Included decision companion: `d1-2B-Q4_K_M.gguf`, an unchanged copy from
  [LiquidAI/d1-2B-GGUF](https://huggingface.co/LiquidAI/d1-2B-GGUF/tree/{decision['revision']}).
  The pretrained companion has its own [LFM Open License v1.0](D1-LICENSE).
  All four runtime files are included so a download contains the tested setup.
- Visual encoder/projector and decision companion weights were **not trained by Narae**.
- The application routes components when needed. This is **not a jointly trained sparse MoE**.

## 실제 학습 / Actual training

| Item | Recorded result |
|---|---|
| Synthetic training / validation dialogues | 32 / 3 |
| Epochs / optimizer updates | 2 / 16 |
| Trainable parameters / changed tensors | 638,976 / 14 |
| LoRA rank / alpha | 16 / 32 |
| Validation loss before / after | 1.570969 / 1.550289 |
| Fixed held-out next-action score before / after | 7/8 / 7/8 |

The held-out accuracy did not improve. Later v2 candidates were not adopted.
The GGUF adapter's 14 tensors were checked bit-for-bit against the saved trained
adapter. Frozen BF16 training versus Q4_K_M inference is a quantization difference.
Training scripts and synthetic dataset hashes are in the
[reproduction folder](https://github.com/y5496694/Narae_hangul_office/tree/{runtime_commit}/experiments/narae4-office-20261031).

## 사용 / Use

For one-click installation of all four files, use Narae Hangul Office
**preview.25 or later**. The [preview.25 application source](https://github.com/y5496694/Narae_hangul_office/tree/{INSTALL_COMMIT})
includes the pinned download catalog. Select **나래4** in the local AI settings
and install its verified files. New installations select Narae4 by default;
existing explicit AI choices are preserved.
The application verifies SHA256, the loaded model alias and the actual LoRA.
Tool execution, Hangul/Windows integration and authenticated school UI access
require the application and the user's own local setup; weights alone do not
provide those tools or authorization.

For llama.cpp, download the GGUF base and adapter and always load both:

```sh
llama-server --model Qwen3.5-2B-Q4_K_M.gguf --lora Narae4-Qwen3.5-2B-Office-LoRA-v1-f32.gguf --alias Narae4-Qwen3.5-2B-Office-LoRA-v1 --host 127.0.0.1 --ctx-size 8192 --gpu-layers 0 --jinja
```

Add `--mmproj mmproj-F16.gguf --no-mmproj-offload` for image input.
Use a llama.cpp build supporting Qwen3.5 and its visual projector. The PEFT
adapter pins the original Qwen base revision in `adapter_config.json`; the full
Transformers base is not included. See the
[runtime and workflow guide](https://github.com/y5496694/Narae_hangul_office/blob/{runtime_commit}/docs/school-accounting.md).

## 실행 검증과 한계 / Evaluation and limitations

On 2026-11-01 the v1 model with the preview.24 runtime completed one explicitly
authorized synthetic 1-won requisition cycle: enter, choose an observed budget,
enter an item, attach original bytes, save, reopen from a server query, verify
attachment bytes/SHA256, delete, and verify absence in a fresh query. It took
20 tool stages and 131.296 seconds; the test record was deleted. Approval
submission and actual purchasing/payment were not performed. This measures
the **model plus bounded runtime/controller**, not free-form model-only autonomy.

Earlier synthetic document/vision smoke tests and the above single integration
run do not establish general school-work accuracy. Missing budget choices,
ambiguous document identities and uncertain writes stop the workflow. Current
financial approval submission, arbitrary existing-record deletion, multiple
budgets and complete virtualized-grid traversal are not validated capabilities.
See `evaluation-summary.json` for the distinct training and runtime evidence.

No real school documents, student/staff identities, portal screenshots, sessions,
credentials, private conversations or live execution logs are included.

## 파일 / Files

| File | Bytes | SHA256 |
|---|---:|---|
{table}

## 라이선스 / License

The Qwen-derived files and Narae LoRA use **Apache-2.0**;
retain [LICENSE](LICENSE) and [NOTICE](NOTICE). The included LiquidAI companion
uses **LFM Open License v1.0** in [D1-LICENSE](D1-LICENSE).
See [COMPONENT_LICENSES.md](COMPONENT_LICENSES.md) for the file-specific terms.
The application's MIT license does not replace the model licenses.
'''
    (stage / 'README.md').write_text(card, 'utf-8')
    allowed = {f['path'] for f in files} | {'README.md', 'LICENSE', 'D1-LICENSE', 'NOTICE', 'COMPONENT_LICENSES.md', 'model-manifest.json', 'evaluation-summary.json'}
    (stage / 'SHA256SUMS').write_text(''.join(sha(stage / name) + '  ' + name + '\n' for name in sorted(allowed)), 'utf-8')
    allowed.add('SHA256SUMS')
    return repo_id, allowed


def publish(args):
    from huggingface_hub import HfApi, get_token, hf_hub_download
    api = HfApi()
    if args.prepare_only:
        if not args.namespace:
            raise ValueError('--namespace is required for prepare-only')
        namespace = args.namespace
    else:
        if not get_token():
            raise ValueError('Local Hugging Face login required; never pass a token in chat or arguments')
        identity = api.whoami()['name']
        namespace = args.namespace or identity
        if namespace != identity:
            raise ValueError('Use the authenticated personal namespace')
    repo_id, allowed = prepare(args.models.resolve(), args.training.resolve(), args.staging.resolve(), namespace)
    from huggingface_hub import ModelCard
    ModelCard.load(args.staging / 'README.md').validate()
    if args.prepare_only:
        return {'prepared': True, 'repoId': repo_id, 'files': sorted(allowed), 'uploaded': False}
    api.create_repo(repo_id=repo_id, repo_type='model', private=False, exist_ok=True)
    commit = api.upload_folder(repo_id=repo_id, folder_path=str(args.staging), allow_patterns=sorted(allowed),
                               commit_message='Publish adopted Narae4 v1 LoRA and verified GGUF components')
    remote = {f.rfilename: f for f in api.model_info(repo_id, revision=commit.oid, files_metadata=True).siblings}
    # LFS SHA256 is the server's recorded weight content hash. Verify small
    # public artifacts by downloading at the immutable publication revision.
    for name in sorted(allowed):
        local = args.staging / name
        info = remote.get(name)
        if not info or info.size != local.stat().st_size:
            raise ValueError('Published file size mismatch: ' + name)
        if info.lfs:
            if info.lfs.sha256 != sha(local):
                raise ValueError('Published LFS hash mismatch: ' + name)
        else:
            copy = Path(hf_hub_download(repo_id, name, revision=commit.oid, token=False))
            if sha(copy) != sha(local):
                raise ValueError('Published public file hash mismatch: ' + name)
    adapter = read(CATALOG)['models']
    model = next(m for m in adapter if m['id'] == 'narae4')
    copy = Path(hf_hub_download(repo_id, model['adapter']['path'], revision=commit.oid, token=False))
    if sha(copy) != model['adapter']['sha256']:
        raise ValueError('Public adapter readback failed')
    if args.update_catalog:
        catalog = read(CATALOG)
        entry = next(m for m in catalog['models'] if m['id'] == 'narae4')
        entry.update(repoId=repo_id, revision=commit.oid)
        for role in ('base', 'adapter', 'projector', 'decision'):
            entry[role].update(repoId=repo_id, revision=commit.oid)
        write_json(CATALOG, catalog)
    return {'uploaded': True, 'repoId': repo_id, 'revision': commit.oid, 'publicUrl': 'https://huggingface.co/' + repo_id,
            'verifiedFiles': len(allowed), 'publicAdapterReadbackVerified': True, 'catalogUpdated': args.update_catalog}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--models', type=Path, default=Path('D:/Codex/models/narae-office/narae4'))
    parser.add_argument('--training', type=Path, default=Path('D:/Codex/training/narae4-office-20261031'))
    parser.add_argument('--staging', type=Path, default=Path('D:/Codex/models/huggingface-publish/narae4-v1'))
    parser.add_argument('--namespace')
    parser.add_argument('--prepare-only', action='store_true')
    parser.add_argument('--update-catalog', action='store_true')
    args = parser.parse_args()
    print(json.dumps(publish(args), ensure_ascii=False, indent=2))
