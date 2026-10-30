const endpoints={openai:'https://api.openai.com/v1/responses',anthropic:'https://api.anthropic.com/v1/messages'};
function normalize(raw,defaults={}){
 const provider=['openai','anthropic','local'].includes(raw.provider)?raw.provider:'openai',connectionMode=provider==='local'?'local':['oauth','api'].includes(raw.connectionMode)?raw.connectionMode:'oauth';
 const localSource=raw.localSource==='external'?'external':'managed',aiConnections=structuredClone(raw.aiConnections||{'openai:api':{endpoint:raw.endpoint||endpoints.openai,model:raw.model||''}});
 // Migrate the previously shared local slot to its known source without guessing the other source.
 if(aiConnections['local:local']&&!aiConnections['local:'+localSource])aiConnections['local:'+localSource]=structuredClone(aiConnections['local:local']);
 const selected=aiConnections[provider==='local'?'local:'+localSource:provider+':'+connectionMode]||{},browserExistingOptIn=raw.browserExistingOptIn===true&&raw.browserMode==='extension';
 return {...defaults,...raw,provider,connectionMode,aiConnections,model:selected.model||'',endpoint:connectionMode==='oauth'?endpoints[provider]:(selected.endpoint||endpoints[provider]||'http://127.0.0.1:11434/v1'),localSource,browserExistingOptIn,browserMode:browserExistingOptIn?'extension':'isolated'};
}
function update(current,request){
 const provider=request.provider??current.provider,connectionMode=provider==='local'?'local':request.connectionMode??(request.apiKey?.trim()?'api':current.connectionMode==='local'?'oauth':current.connectionMode);
 if(!['openai','anthropic','local'].includes(provider)||!['oauth','api','local'].includes(connectionMode)||provider!=='local'&&connectionMode==='local')throw new Error('AI 제공자와 연결 방식을 확인하세요.');
 const localSource=request.localSource===undefined?current.localSource:request.localSource==='external'?'external':'managed',aiConnections=structuredClone(current.aiConnections),id=provider==='local'?'local:'+localSource:provider+':'+connectionMode,selected=aiConnections[id]||{};
 const endpoint=connectionMode==='oauth'?endpoints[provider]:(request.endpoint??selected.endpoint??endpoints[provider]??'http://127.0.0.1:11434/v1');
 const url=new URL(endpoint);if(url.username||url.password||(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))))throw new Error('HTTPS 또는 로컬 서버 주소를 입력하세요.');
 const model=typeof request.model==='string'?request.model.trim():selected.model||'';
 if(provider==='local')require('./local-ai.cjs').loopback(endpoint);
 aiConnections[id]={endpoint:url.href,model};if(provider==='local')aiConnections['local:local']={...aiConnections[id]};return {...current,provider,connectionMode,aiConnections,endpoint:url.href,model,localSource,...(typeof request.anthropicWorkspace==='string'?{anthropicWorkspace:request.anthropicWorkspace.trim()}:{})};
}
function files(current){
 const {provider,connectionMode,aiConnections,anthropicWorkspace,...legacy}=current,openai=aiConnections['openai:api']||{};
 // Earlier releases read settings.json and gpt-key.bin as an OpenAI pair.
 // Keep that pair coherent; active Claude/OAuth choices live separately.
 return {legacy:{...legacy,endpoint:openai.endpoint||endpoints.openai,model:openai.model||''},ai:{provider,connectionMode,aiConnections,...(anthropicWorkspace?{anthropicWorkspace}:{})}};
}
module.exports={normalize,update,endpoints,files};
