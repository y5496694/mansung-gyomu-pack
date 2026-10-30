import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {HOME, DATA, Fault, readJSON, writeJSON} from './paths.mjs';
import {digest} from './process.mjs';

async function freePort() {
  const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export class Models {
  constructor({spawnModel = spawn, hash = digest} = {}) {
    this.catalog = readJSON(path.join(HOME, 'models/catalog.json'));
    this.runtime = readJSON(path.join(HOME, 'runtime.json'));
    this.active = null; this.child = null; this.loading = null; this.lastError = null;
    this.spawnModel = spawnModel; this.hash = hash; this.verified = new Map();
    this.config = readJSON(path.join(DATA, 'settings.json'), {selectedModel: this.catalog.default});
  }
  status() {
    return {selected: this.config.selectedModel, active: this.active?.id || null, loading: this.loading,
      error: this.lastError, models: this.catalog.models.map(m => ({id: m.id, label: m.label, size: m.size,
        upstream: m.upstream, alias: m.alias, note: m.note, researchOnly: m.researchOnly,
        actualWeightTraining: m.actualWeightTraining, license: m.license,
        installed: [m.base, m.adapter].every(f => fs.existsSync(path.join(HOME, f.path)))}))};
  }
  async check(file) {
    const absolute = path.join(HOME, file.path);
    if (!fs.existsSync(absolute)) throw new Fault('MODEL_MISSING', '팩에 모델 파일이 없습니다: ' + file.path);
    const stat = fs.statSync(absolute), key = `${stat.size}:${stat.mtimeMs}`;
    if (this.verified.get(absolute) !== key) {
      if (await this.hash(absolute) !== file.sha256) throw new Fault('MODEL_HASH', '모델 파일 검증에 실패했습니다: ' + file.path);
      this.verified.set(absolute, key);
    }
    return absolute;
  }
  async stop() {
    this.active = null;
    if (this.child) {
      const child = this.child; this.child = null;
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        let timer;
        await Promise.race([once(child, 'exit'), new Promise(resolve => {timer=setTimeout(resolve,10000);})]);
        clearTimeout(timer);
        if (child.exitCode === null && child.signalCode === null) {child.kill('SIGKILL'); await once(child, 'exit');}
      }
    }
  }
  async activate(id) {
    if (this.loading) throw new Fault('MODEL_BUSY', '모델을 전환하고 있습니다.');
    const model = this.catalog.models.find(m => m.id === id);
    if (!model) throw new Fault('UNKNOWN_MODEL', '나래1·나래2·나래3 중 하나를 선택하세요.');
    if (this.active?.id === id) return this.status();
    this.loading = id; this.lastError = null;
    try {
      await this.stop();
      const base = await this.check(model.base), adapter = await this.check(model.adapter);
      const exe = await this.check(this.runtime.llama), port = await freePort();
      this.url = `http://127.0.0.1:${port}`;
      const log = fs.openSync(path.join(DATA, 'logs', `model-${id}.log`), 'a');
      const child = this.spawnModel(exe, ['--model', base, '--lora', adapter, '--alias', model.alias,
        '--host', '127.0.0.1', '--port', String(port), '--threads', '6', '--threads-batch', '6',
        '--ctx-size', '8192', '--parallel', '1', '--batch-size', '512', '--ubatch-size', '128',
        '--cache-ram', '0', '--no-context-shift', '--no-warmup', '--no-webui', '--seed', '719',
        '--chat-template-kwargs', '{"enable_thinking":false}'],
      {windowsHide: true, stdio: ['ignore', log, log], cwd: HOME});
      fs.closeSync(log); this.child = child;
      let spawnError;
      child.on('error', e => {spawnError = e;});
      child.once('exit', () => {if (this.child === child) {this.child = null; this.active = null;}});
      const deadline = Date.now() + 180000;
      while (true) {
        if (spawnError) throw spawnError;
        if (child.exitCode !== null || child.signalCode !== null) throw new Fault('MODEL_START', 'AI 실행기가 종료됐습니다. 모델 로그를 확인하세요.');
        try {
          const health = await this.request('/health', undefined, undefined, 1500);
          if (health.status === 'ok') break;
        } catch {}
        if (Date.now() > deadline) throw new Fault('MODEL_START_TIMEOUT', 'AI를 시작하지 못했습니다. 로그에서 원인을 확인하세요.');
        await delay(250);
      }
      const loaded = await this.request('/lora-adapters');
      if (loaded.length !== 1 || path.resolve(loaded[0].path) !== path.resolve(adapter) || loaded[0].scale !== model.strength)
        throw new Fault('ADAPTER_IDENTITY', '선택한 학습 어댑터가 실제 실행기와 일치하지 않습니다.');
      const identities = await this.request('/v1/models');
      if (!identities.data.some(m => m.id === model.alias)) throw new Fault('MODEL_IDENTITY', '실행 중인 AI 이름이 일치하지 않습니다.');
      this.active = model; this.config.selectedModel = id;
      writeJSON(path.join(DATA, 'settings.json'), this.config);
      writeJSON(path.join(DATA, 'model-session.json'), {id, alias: model.alias, pid: child.pid,
        baseSha256: model.base.sha256, adapterSha256: model.adapter.sha256, loaded, started: new Date().toISOString()});
      return this.status();
    } catch (e) {this.lastError = e.message; await this.stop(); throw e;}
    finally {this.loading = null;}
  }
  async request(route, payload, signal, timeout = 120000) {
    const response = await fetch(this.url + route, {method: payload === undefined ? 'GET' : 'POST',
      headers: {'content-type': 'application/json'}, body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout)});
    if (!response.ok) throw new Fault('MODEL_API', `AI 응답 오류 ${response.status}: ${(await response.text()).slice(0, 600)}`);
    return response.json();
  }
  async complete(messages, schema, signal) {
    if (!this.active) await this.activate(this.config.selectedModel);
    const model = this.active;
    const response = await this.request('/v1/chat/completions', {model: model.alias, messages, temperature: 0,
      seed: 719, max_tokens: 1536, stream: false,
      response_format: {type: 'json_schema', json_schema: {name: 'narae_action', schema}}}, signal);
    if (response.model !== model.alias) throw new Fault('MODEL_IDENTITY', '요청과 다른 AI의 응답을 거부했습니다.');
    if (response.choices?.[0]?.finish_reason !== 'stop') throw new Fault('MODEL_INCOMPLETE', 'AI 응답이 길이 한도에서 잘렸습니다. 요청을 나누어 주세요.');
    return {content: response.choices[0].message.content, usage: response.usage, model: model.alias};
  }
}
