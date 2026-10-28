import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const portableRoot = path.resolve(APP, '../..');
export const HOME = path.resolve(process.env.NARAE_GYOMU_HOME ||
  (fs.existsSync(path.join(portableRoot,'runtime.json')) ? portableRoot : APP));
export const DATA = path.resolve(process.env.NARAE_GYOMU_DATA || 'D:/Codex/narae-gyomu-data');
export const OUTPUTS = path.join(DATA, 'outputs');
export const TMP = path.join(DATA, 'tmp');
export const DAEMON = path.join(DATA, 'daemon.json');
export function initialize() {
  for (const name of ['', 'outputs', 'tmp', 'logs', 'conversations', 'jobs', 'inputs', 'ui','native/Local','native/Roaming'])
    fs.mkdirSync(path.join(DATA, name), {recursive: true});
  Object.assign(process.env, {TEMP: TMP, TMP, TMPDIR: TMP, PYTHONUTF8: '1',
    PYTHONPYCACHEPREFIX: path.join(DATA, 'cache/python'), PYTHONNOUSERSITE: '1', QT_QPA_PLATFORM: 'offscreen',
    NARAE_BROWSER_HOME: path.join(DATA, 'browser'), PIP_CACHE_DIR: path.join(DATA, 'cache/pip')});
}
export function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) { if (fallback !== undefined && error.code === 'ENOENT') return fallback; throw error; }
}
export function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', {mode: 0o600});
  fs.renameSync(temp, file);
}
export class Fault extends Error {
  constructor(code, message, details) {super(message); this.code = code; this.details = details;}
}
export function failure(error) {
  return {ok: false, error: {code: error.code || 'FAILED', message: String(error.message),
    ...(error.details ? {details: error.details} : {})}};
}
export function outputPath(filename, extension = '.hwpx') {
  const name = filename || `문서-${Date.now()}${extension}`;
  if (path.basename(name) !== name || /[<>:"/\\|?*\x00-\x1f]/.test(name))
    throw new Fault('INVALID_FILENAME', '출력은 파일명으로 지정하세요. 저장 폴더: ' + OUTPUTS);
  const dest = path.join(OUTPUTS, name);
  if (fs.existsSync(dest)) throw new Fault('OUTPUT_EXISTS', '기존 파일을 보존했습니다. 새 파일명을 사용하세요: ' + name);
  return dest;
}
