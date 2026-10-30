const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {randomBytes,randomUUID,createHash}=require('node:crypto');
const {KeyStore}=require('./key-store.cjs'),{locked}=require('./oauth-lock.cjs'),{verifyIdentity,equal,ISSUER}=require('./oidc.cjs');
const RESOURCE='https://api.openai.com/v1',SCOPES='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
class OAuth{
 constructor({home,python,openBrowser,fetch=(...args)=>global.fetch(...args),store,anthropicProfile}){this.home=home;this.openBrowser=openBrowser;this.fetch=fetch;this.store=store||new KeyStore(home,python,'oauth-credentials');this.lock=path.join(home,'data/oauth.lock');this.anthropicProfile=anthropicProfile||require('./anthropic-login.cjs').withProfile;this.pending=null;}
 read(){const value=this.store.get();return value?JSON.parse(value):{version:1,hostId:null,selected:{},accounts:[]};}
 write(value){this.store.set(JSON.stringify(value));}
 state(){const data=this.read();return {pending:this.pending?.provider||null,selected:data.selected,profiles:data.accounts.map(a=>({id:a.id,provider:a.provider,email:a.email||'',label:a.email?a.email+' · '+(a.label||'ChatGPT'):a.label||'등록된 ChatGPT 계정',connected:Boolean(a.tokens?.access_token||a.cliProfile)&&!a.needsLogin,sharing:a.provider==='anthropic'||Boolean(a.tokens?.scopes?.includes('chatgpt.tokens.use.direct')),needsLogin:Boolean(a.needsLogin),expiresAt:a.tokens?.expiresAt||null}))};}
 ready(provider){const data=this.read(),account=data.accounts.find(a=>a.id===data.selected[provider]&&a.provider===provider);return Boolean(account&&(provider==='anthropic'?account.cliProfile:account.tokens?.access_token&&account.tokens.scopes.includes('chatgpt.tokens.use.direct'))&&!account.needsLogin);}
 async json(url,options={},signal){const response=await this.fetch(url,{...options,redirect:'error',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(15000)])});let result;try{result=await response.json();}catch{throw new Error('계정 서버의 응답을 읽지 못했습니다.');}if(!response.ok){const error=new Error('계정 연결 요청에 실패했습니다 ('+response.status+'). 다시 로그인하거나 계정 권한을 확인하세요.');error.oauthCode=typeof result.error==='string'?result.error:result.error?.code;throw error;}return result;}
 async token(form,signal){return this.json(ISSUER+'/api/accounts/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(form).toString()},signal);}
 async login({provider='openai',profileId}={}){
  if(!['openai','anthropic'].includes(provider))throw new Error('지원하지 않는 AI 제공자입니다.');if(this.pending)throw new Error('진행 중인 계정 연결을 먼저 마치거나 취소하세요.');
  const controller=new AbortController();this.pending={provider,controller};
  try{return provider==='openai'?await this.loginOpenAI(profileId,controller.signal):await this.loginClaude(profileId,controller.signal);}finally{if(this.pending?.controller===controller)this.pending=null;}
 }
 cancel(){this.pending?.controller.abort();return true;}
 async loginOpenAI(profileId,signal){
  const account=await locked(this.lock,async()=>{const data=this.read();if(!data.hostId)data.hostId='urn:uuid:'+randomUUID();const found=profileId?data.accounts.find(a=>a.id===profileId&&a.provider==='openai'):null;if(profileId&&!found)throw new Error('선택한 계정 등록을 찾을 수 없습니다.');this.write(data);return {...found,hostId:data.hostId};});
  const state=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');let server,timer,callbackUri,consumed=false;
  const callback=new Promise((resolve,reject)=>{
   server=http.createServer((req,res)=>{res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'none'");
    if(req.method!=='GET'||req.url.length>32768){res.writeHead(405);res.end('허용되지 않은 요청');return;}
    const url=new URL(req.url,callbackUri);if(url.pathname!=='/auth/callback'){res.writeHead(404);res.end('Not found');return;}
    if(!equal(url.searchParams.get('state'),state)||['state','code','client_id','error'].some(key=>url.searchParams.getAll(key).length>1)){res.writeHead(400);res.end('로그인 상태 확인 실패');return;}
    if(consumed){res.writeHead(409);res.end('이미 처리한 로그인 응답입니다.');return;}consumed=true;
    if(url.searchParams.has('error')){res.writeHead(400);res.end('계정 연결이 승인되지 않았습니다. 앱으로 돌아가세요.');reject(new Error('ChatGPT 연결이 승인되지 않았습니다.'));return;}
    const clientId=url.searchParams.get('client_id')||account.clientId,code=url.searchParams.get('code');
    if(!code||!clientId||clientId==='dynamic_agent_client'||(account.clientId&&clientId!==account.clientId)){res.writeHead(400);res.end('로그인 등록 확인 실패');reject(new Error('ChatGPT 계정 등록 정보가 일치하지 않습니다.'));return;}
    res.end('ChatGPT 승인을 받았습니다. 나래 오피스로 돌아가 연결 결과를 확인하세요.');resolve({clientId,code});
   });server.maxConnections=8;server.headersTimeout=5000;server.requestTimeout=5000;
   server.once('error',()=>reject(new Error('로컬 로그인 콜백을 열지 못했습니다.')));
   signal.addEventListener('abort',()=>reject(new Error('계정 연결을 취소했습니다.')),{once:true});timer=setTimeout(()=>reject(new Error('계정 연결 시간이 지났습니다. 다시 시도하세요.')),300000);
  });void callback.catch(()=>{});
  try{
   await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});callbackUri='http://127.0.0.1:'+server.address().port+'/auth/callback';
   const params=new URLSearchParams({client_id:account.clientId||'dynamic_agent_client',ext_agent_host_id:account.hostId,response_type:'code',redirect_uri:callbackUri,scope:SCOPES,resource:RESOURCE,state,nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')});
   if(!account.clientId)params.set('agent_name_hint','나래 한글 오피스');else{if(account.tokens?.id_token)params.set('id_token_hint',account.tokens.id_token);if(account.email)params.set('login_hint',account.email);}
   const browser=Promise.resolve().then(()=>this.openBrowser(ISSUER+'/api/accounts/authorize?'+params)).catch(()=>{throw new Error('로그인 브라우저를 열지 못했습니다. 기본 브라우저 설정을 확인하세요.');});
   const [,accepted]=await Promise.all([browser,callback]);if(signal.aborted)throw new Error('계정 연결을 취소했습니다.');
   const id=account.id||randomUUID();await locked(this.lock,async()=>{const data=this.read();if(!data.accounts.some(a=>a.id===id))data.accounts.push({id,provider:'openai',clientId:accepted.clientId,label:'ChatGPT '+(data.accounts.filter(a=>a.provider==='openai').length+1)});this.write(data);});
   const tokens=await this.token({grant_type:'authorization_code',client_id:accepted.clientId,code:accepted.code,code_verifier:verifier,redirect_uri:callbackUri,resource:RESOURCE},signal);
   const identity=await verifyIdentity(tokens.id_token,{clientId:accepted.clientId,nonce,subject:account.subject,fetchJson:url=>this.json(url,{},signal)});
   const credentials=this.credentials(tokens);if(signal.aborted)throw new Error('계정 연결을 취소했습니다.');
   await locked(this.lock,async()=>{const data=this.read(),existing=data.accounts.find(a=>a.provider==='openai'&&a.clientId===accepted.clientId&&a.subject);if(existing&&existing.subject!==identity.subject)throw new Error('저장된 ChatGPT 등록과 계정이 일치하지 않습니다.');const target=existing||data.accounts.find(a=>a.id===id);Object.assign(target,identity,{tokens:credentials,needsLogin:false});if(target.id!==id)data.accounts=data.accounts.filter(a=>a.id!==id);data.selected.openai=target.id;this.write(data);});return this.state();
  }finally{clearTimeout(timer);server?.closeAllConnections();server?.close();}
 }
 credentials(tokens,previous){if(!tokens.access_token||tokens.token_type?.toLowerCase()!=='bearer'||!Number.isFinite(tokens.expires_in)||tokens.expires_in<=0)throw new Error('계정 서버가 유효한 토큰 정보를 반환하지 않았습니다.');return {access_token:tokens.access_token,refresh_token:tokens.refresh_token||previous?.refresh_token,id_token:tokens.id_token||previous?.id_token,scopes:typeof tokens.scope==='string'?tokens.scope.split(/\s+/):previous?.scopes||[],expiresAt:Date.now()+tokens.expires_in*1000,earliestRefreshAt:tokens.earliest_refresh_at};}
 async loginClaude(profileId,signal){
  return locked(this.lock,async()=>{const data=this.read(),account=profileId?data.accounts.find(a=>a.id===profileId&&a.provider==='anthropic'):null;if(profileId&&!account)throw new Error('선택한 Claude Console 등록을 찾을 수 없습니다.');
   const {profile}=await this.anthropicProfile({home:this.home,store:this.store,profile:account?.cliProfile,openBrowser:this.openBrowser,signal},async run=>{await run(['auth','login','--no-browser','--timeout','5m'],{login:true});await run(['auth','print-credentials','--access-token']);});
   if(signal.aborted)throw new Error('계정 연결을 취소했습니다.');const target=account||{id:randomUUID(),provider:'anthropic',label:'Claude Console '+(data.accounts.filter(a=>a.provider==='anthropic').length+1)};if(!account)data.accounts.push(target);target.cliProfile=profile;target.needsLogin=false;data.selected.anthropic=target.id;this.write(data);return this.state();
  });
 }
 async select(provider,id){if(this.pending)throw new Error('계정 연결이 진행 중입니다.');return locked(this.lock,async()=>{const data=this.read();if(!data.accounts.some(a=>a.provider===provider&&a.id===id))throw new Error('선택한 계정 등록을 찾을 수 없습니다.');data.selected[provider]=id;this.write(data);return this.state();});}
 async credential(provider,id){
  return locked(this.lock,async()=>{const data=this.read(),account=data.accounts.find(a=>a.provider===provider&&a.id===(id||data.selected[provider]));if(!account||account.needsLogin)throw new Error('AI 연결 설정에서 계정으로 로그인하세요.');
   if(provider==='anthropic'){
    if(!account.cliProfile)throw new Error('Claude Console 계정을 연결하세요.');const updated=await this.anthropicProfile({home:this.home,store:this.store,profile:account.cliProfile,openBrowser:this.openBrowser},run=>run(['auth','print-credentials','--access-token']));
    if(!updated.result||/\s/.test(updated.result))throw new Error('Claude Console 토큰을 확인하지 못했습니다.');account.cliProfile=updated.profile;this.write(data);const config=JSON.parse(updated.profile['configs/narae.json']||'{}');return {provider,mode:'oauth',accessToken:updated.result,profileId:account.id,workspaceId:config.workspace_id||config.workspaceId||undefined};
   }
   if(!account.tokens?.access_token)throw new Error('ChatGPT 계정을 연결하세요.');
   const earliest=typeof account.tokens.earliestRefreshAt==='number'?(account.tokens.earliestRefreshAt>1e12?account.tokens.earliestRefreshAt:account.tokens.earliestRefreshAt*1000):Date.parse(account.tokens.earliestRefreshAt);
   if(account.tokens.expiresAt<Date.now()+60000&&(!Number.isFinite(earliest)||Date.now()>=earliest||Date.now()>=account.tokens.expiresAt)){
    if(!account.tokens.refresh_token)throw new Error('ChatGPT 로그인을 갱신하세요.');let tokens;
    try{tokens=await this.token({grant_type:'refresh_token',client_id:account.clientId,refresh_token:account.tokens.refresh_token,resource:RESOURCE});}catch(error){if(error.oauthCode==='invalid_grant'){delete account.tokens;account.needsLogin=true;this.write(data);}throw error;}
    if(tokens.id_token)await verifyIdentity(tokens.id_token,{clientId:account.clientId,subject:account.subject,fetchJson:url=>this.json(url)});
    account.tokens=this.credentials(tokens,account.tokens);this.write(data);
   }
   if(!account.tokens.scopes.includes('chatgpt.tokens.use.direct'))throw new Error('ChatGPT 요금제 사용을 허용하지 않았습니다. 계정을 다시 연결하고 사용 권한을 승인하세요.');
   return {provider,mode:'oauth',accessToken:account.tokens.access_token,profileId:account.id};
  });
 }
 async logout(provider,id){
  if(this.pending)throw new Error('진행 중인 계정 연결을 먼저 취소하세요.');return locked(this.lock,async()=>{const data=this.read(),account=data.accounts.find(a=>a.provider===provider&&a.id===(id||data.selected[provider]));if(!account)return {state:this.state(),remoteRevoked:true};let remoteRevoked=false;
   try{if(provider==='openai'&&account.tokens?.refresh_token){const metadata=await this.json(ISSUER+'/.well-known/openid-configuration');if(new URL(metadata.revocation_endpoint).origin!==ISSUER)throw new Error('잘못된 해제 주소');for(let attempt=0;attempt<3;attempt++){const response=await this.fetch(metadata.revocation_endpoint,{method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:account.tokens.refresh_token,token_type_hint:'refresh_token',client_id:account.clientId}).toString(),signal:AbortSignal.timeout(5000)});if(response.ok){remoteRevoked=true;break;}if(response.status<500)break;await new Promise(resolve=>setTimeout(resolve,100*(attempt+1)));}}else if(provider==='anthropic'&&account.cliProfile){await this.anthropicProfile({home:this.home,store:this.store,profile:account.cliProfile,openBrowser:this.openBrowser},run=>run(['auth','logout']));}}
   catch{}delete account.tokens;delete account.cliProfile;account.needsLogin=true;if(data.selected[provider]===account.id)delete data.selected[provider];this.write(data);return {state:this.state(),remoteRevoked,message:remoteRevoked?'계정 연결을 해제했습니다.':'이 컴퓨터의 연결을 해제했습니다. 서버의 권한 해제는 확인하지 못했으므로 계정의 연결 앱 설정에서 확인하세요.'};
  });
 }
}
module.exports={OAuth,RESOURCE,SCOPES};
