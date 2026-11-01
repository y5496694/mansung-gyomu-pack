import fs from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';

const request = JSON.parse(fs.readFileSync(0, 'utf8'));
const require = createRequire(import.meta.url);
let session, script, result, error, cleanup_error, verifier;
try {
  const modulePath = require.resolve('frida', {paths: [process.argv[2] || process.cwd()]});
  const frida = await import(pathToFileURL(modulePath).href);
  session = await frida.attach(request.pid);
  const source = fs.readFileSync(new URL('./background_agent.js', import.meta.url), 'utf8');
  script = await session.createScript('const config = '+JSON.stringify(request)+';\n'+source);
  let timer;
  const completion = new Promise(resolve => {
    timer = setTimeout(()=>resolve({ok:false,error:'Background operation deadline exceeded; do not retry a send without checking its outcome.'}), request.timeout * 1000);
    script.message.connect(message => {
      if (message.type === 'error') resolve({ok:false,error:message.description});
      if (message.type === 'send' && message.payload?.event === 'done') resolve(message.payload);
      if (message.type === 'send' && message.payload?.event === 'attachment-preview') {
        verifier=spawn(request.python_executable,['-m','kakaocli_win.outgoing'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
        let output='';
        const respond=payload=>{try {script.post({type:'attachment-decision',payload});} catch {}};
        verifier.stdout.on('data',chunk=>output+=chunk);
        verifier.on('error',failure=>respond({error:failure.message}));
        verifier.on('close',code=>{
          try {respond(code===0?JSON.parse(output):{error:JSON.parse(output).error||'Attachment verifier failed'});}
          catch {respond({error:'Attachment preview verification failed'});}
        });
        verifier.stdin.on('error',()=>{});
        verifier.stdin.end(JSON.stringify({...message.payload,kind:request.kind,source_path:request.source_path,source_sha256:request.source_sha256,preview_directory:request.preview_directory}));
      }
    });
    session.detached.connect(reason=>resolve({ok:false,error:'KakaoTalk instrumentation detached: '+reason}));
  });
  try { await script.load(); result = await completion; } finally { clearTimeout(timer); }
} catch (failure) { error = failure.message; }
finally {
  if(verifier&&verifier.exitCode===null)verifier.kill();
  try { if (script) await script.unload(); } catch (failure) { cleanup_error = failure.message; }
  try { if (session) await session.detach(); } catch (failure) { cleanup_error = [cleanup_error, failure.message].filter(Boolean).join('; '); }
}
process.stdout.write(JSON.stringify({ok: !error && result?.ok === true, result: result?.result, error: error || result?.error, cleanup_error})+'\n');
process.exitCode = error || cleanup_error || result?.ok !== true ? 1 : 0;
