import {spawn} from 'node:child_process';
import fs from 'node:fs';
import {Fault} from './paths.mjs';

export function run(exe, args, {env = {}, cwd, timeout = 120000, maxBytes = 8 * 1024 * 1024, signal} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {cwd, windowsHide: true, shell: false,
      env: {...process.env, ...env}, stdio: ['ignore', 'pipe', 'pipe']});
    let out = [], err = [], bytes = 0, failure;
    const abort = () => {failure = new Fault('CANCELLED', '작업을 중단했습니다. 변경 여부는 실행 기록에서 확인하세요.'); child.kill();};
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, {once: true});
    const timer = setTimeout(() => {failure = new Fault('TOOL_TIMEOUT', '도구 응답 시간이 지났습니다. 자동으로 재실행하지 않습니다.'); child.kill();}, timeout);
    function collect(list, chunk) {
      bytes += chunk.length;
      if (bytes > maxBytes) {failure = new Fault('OUTPUT_TOO_LARGE', '도구 출력이 너무 큽니다. 범위를 줄여 조회하세요.'); child.kill();}
      else list.push(chunk);
    }
    child.stdout.on('data', b => collect(out, b)); child.stderr.on('data', b => collect(err, b));
    child.on('error', error => {failure = error;});
    child.on('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (failure) return reject(failure);
      const stdout = Buffer.concat(out).toString('utf8').trim(), stderr = Buffer.concat(err).toString('utf8').trim();
      let data;
      try {data = JSON.parse(stdout);} catch {
        try {data = JSON.parse(stderr);} catch {data = {stdout: stdout.slice(0, 8000), stderr: stderr.slice(0, 3000)};}
      }
      if (code !== 0 || data.ok === false || data.success === false)
        return reject(new Fault(data.error?.code || 'TOOL_FAILED', typeof data.error === 'string' ? data.error : data.error?.message || stderr || '도구 실행에 실패했습니다.', data));
      resolve(data);
    });
  });
}
export async function digest(file) {
  const {createHash} = await import('node:crypto');
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
