import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {APP, HOME, DATA, OUTPUTS, DAEMON, initialize, Fault, failure, readJSON, writeJSON} from './paths.mjs';
import {Models} from './models.mjs';
import {Tools} from './tools.mjs';
import {Agent} from './agent.mjs';
import {tools as catalog} from './catalog.mjs';

export async function createApp({port = Number(process.env.NARAE_GYOMU_PORT || 18765), models, tools, headed = true} = {}) {
  initialize();
  const model = models || new Models(), adapters = tools || new Tools(model,{headed}), agent = new Agent(model,adapters);
  const token = crypto.randomBytes(32).toString('hex');
  let stopping = false, origin, operation = false;
  async function exclusive(action) {operation = true;try{return await action();}finally{operation=false;}}
  const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
  async function body(req) {
    let bytes = 0, chunks = [];
    for await (const chunk of req) {bytes+=chunk.length; if(bytes>2*1024*1024) throw new Fault('BODY_LIMIT','요청이 너무 큽니다.'); chunks.push(chunk);}
    try {return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');} catch {throw new Fault('JSON','요청 JSON이 올바르지 않습니다.');}
  }
  function json(res,status,value) {res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));}
  const server = http.createServer(async(req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    try {
      if(req.headers.host !== new URL(origin).host) throw new Fault('HOST','허용되지 않은 주소입니다.');
      const url = new URL(req.url,origin), pathname = url.pathname;
      if(pathname.startsWith('/api/')) {
        if(req.headers.authorization !== `Bearer ${token}`) return json(res,401,{ok:false,error:{code:'AUTH',message:'프로그램 연결이 만료됐습니다. 창을 다시 여세요.'}});
        if(req.headers.origin && req.headers.origin !== origin) throw new Fault('ORIGIN','허용되지 않은 요청 출처입니다.');
        if(req.method === 'GET' && pathname === '/api/status') return json(res,200,{ok:true,data:{version:'0.1.0',pid:process.pid,home:HOME,app:APP,busy:Boolean(agent.current)||operation,models:model.status(),outputs:OUTPUTS,data:DATA}});
        if(req.method === 'GET' && pathname === '/api/schema') return json(res,200,{ok:true,data:{name:'narae-gyomu',version:1,tools:catalog,protocol:'tool call NAME --args JSON; chat TEXT --file PATH'}});
        if(req.method === 'GET' && pathname === '/api/conversations') return json(res,200,{ok:true,data:agent.list()});
        if(req.method === 'GET' && /^\/api\/conversations\/[\da-f-]{36}$/.test(pathname)) return json(res,200,{ok:true,data:agent.conversation(pathname.split('/').at(-1))});
        if(req.method === 'GET' && /^\/api\/jobs\/[\da-f-]{36}$/.test(pathname)) {
          const id=pathname.split('/').at(-1),job=agent.jobs.get(id) || readJSON(path.join(DATA,'jobs',id+'.json'));
          return json(res,200,{ok:true,data:job});
        }
        if(req.method !== 'POST') return json(res,404,{ok:false,error:{code:'NOT_FOUND',message:'없는 API입니다.'}});
        const args=await body(req);
        if(pathname === '/api/cancel') {agent.cancel(); return json(res,200,{ok:true,data:{cancelRequested:true}});}
        if(pathname === '/api/shutdown') {json(res,200,{ok:true,data:{stopping:true}}); setImmediate(shutdown); return;}
        if(agent.current || model.loading || operation || stopping) throw new Fault('JOB_BUSY','작업 중입니다. 완료 또는 중단 후 다시 시도하세요.');
        if(pathname === '/api/models/activate') return json(res,200,{ok:true,data:await model.activate(args.id)});
        if(pathname === '/api/models/stop') {await exclusive(()=>model.stop());return json(res,200,{ok:true,data:model.status()});}
        if(pathname === '/api/files/register') return json(res,200,{ok:true,data:adapters.register(args.files || [])});
        if(pathname === '/api/chat') return json(res,202,{ok:true,data:agent.start(args.text,args)});
        if(pathname === '/api/tools/call') {
          if(!catalog.some(t => t.name === args.tool)) throw new Fault('UNKNOWN_TOOL','schema에 없는 도구입니다.');
          if(args.files) adapters.register(args.files);
          return json(res,200,{ok:true,data:await exclusive(()=>adapters.call(args.tool,args.args))});
        }
        if(pathname === '/api/pending/confirm') return json(res,200,{ok:true,data:await exclusive(()=>adapters.confirm(args.id))});
        return json(res,404,{ok:false,error:{code:'NOT_FOUND',message:'없는 API입니다.'}});
      }
      if(req.method !== 'GET') return json(res,405,{ok:false});
      const names = {'/':'index.html','/app.js':'app.js','/style.css':'style.css','/mark.svg':'mark.svg'};
      const name = names[pathname];
      if(!name) return json(res,404,{ok:false});
      res.writeHead(200,{'content-type':mime[path.extname(name)],'cache-control':'no-store'});
      fs.createReadStream(path.join(APP,'web',name)).pipe(res);
    } catch(e) {json(res,e.code === 'JOB_BUSY' || e.code === 'MODEL_BUSY' ? 409 : 400,failure(e));}
  });
  async function shutdown() {
    if(stopping) return; stopping=true; agent.cancel();
    while(agent.current) await new Promise(resolve => setTimeout(resolve,30));
    await model.stop();
    while(model.loading || operation) await new Promise(resolve => setTimeout(resolve,30));
    await adapters.close();
    await new Promise(resolve => server.close(resolve));
    const own=readJSON(DAEMON,{}); if(own.pid===process.pid && own.token===token) fs.unlinkSync(DAEMON);
  }
  await new Promise((resolve,reject) => {server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  origin='http://127.0.0.1:'+server.address().port;
  writeJSON(DAEMON,{pid:process.pid,port:server.address().port,token,home:HOME,app:APP,started:new Date().toISOString()});
  return {server,origin,token,models:model,tools:adapters,agent,shutdown};
}

if(process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const app=await createApp();
  process.stdout.write(JSON.stringify({ready:true,pid:process.pid,port:app.server.address().port})+'\n');
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,() => app.shutdown().then(() => process.exit(0)));
}
