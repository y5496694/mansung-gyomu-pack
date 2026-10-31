import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';

export function officeRoot(env=process.env) {
  const registered=path.join(env.CODEX_HOME||path.join(os.homedir(),'.codex'),'skills/narae-hangul-office/runtime.json');
  let saved;if(!env.NARAE_OFFICE_ROOT)try{saved=JSON.parse(fs.readFileSync(registered,'utf8').replace(/^\uFEFF/,'' )).officeRoot;}catch(error){if(error.code!=='ENOENT')throw error;}
  const candidates=env.NARAE_OFFICE_ROOT?[env.NARAE_OFFICE_ROOT]:[saved,'D:/Codex/apps/NaraeHangulOffice',path.join(env.LOCALAPPDATA||path.join(os.homedir(),'AppData/Local'),'Programs/NaraeHangulOffice')].filter(Boolean);
  const root=candidates.find(p=>fs.existsSync(path.join(p,'src/agent-cli.cjs'))&&fs.existsSync(path.join(p,'src/cli.cjs')));
  if(!root)throw new Error('나래4 CLI가 있는 나래 한글 오피스로 업데이트하세요. 별도 위치는 NARAE_OFFICE_ROOT로 지정합니다.');
  return path.resolve(root);
}
export async function runOffice(args,{env=process.env,spawnImpl=spawn,node=process.execPath}={}) {
  const root=officeRoot(env),managed=path.join(root,'runtime/node/node.exe'),executable=fs.existsSync(managed)?managed:node;
  return new Promise((resolve,reject)=>{const child=spawnImpl(executable,[path.join(root,'src/cli.cjs'),...args],{windowsHide:true,stdio:'inherit',env});child.once('error',reject);child.once('close',code=>resolve(Number.isInteger(code)?code:1));});
}
