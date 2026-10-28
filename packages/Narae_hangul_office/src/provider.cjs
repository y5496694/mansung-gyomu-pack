require('./network-trust.cjs').useSystemTrust();
const {endpoints}=require('./connection-settings.cjs');
function endpoint(settings,credential,models=false){
 const provider=credential?.provider||settings.provider||'openai',mode=credential?.mode||settings.connectionMode||'api';
 const url=new URL(mode==='oauth'?endpoints[provider]:(settings.endpoint||endpoints[provider]));
 if(url.username||url.password||(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw new Error('AI 주소는 HTTPS 또는 로컬 서버 주소를 사용하세요.');
 if(models)url.pathname=url.pathname.replace(/\/(responses|messages)\/?$/,'/models');return url;
}
function headers(settings,credential,apiKey){
 const provider=credential?.provider||settings.provider||'openai',token=credential?.accessToken||apiKey;if(!token)throw new Error('AI 계정 로그인 또는 API 키를 먼저 연결하세요.');
 const result={'Content-Type':'application/json',Authorization:'Bearer '+token};
 if(provider==='anthropic'){result['anthropic-version']='2023-06-01';const workspace=credential?.workspaceId||settings.anthropicWorkspace;if(workspace){if(!/^wrkspc_[A-Za-z0-9]+$/.test(workspace))throw new Error('Claude 워크스페이스 ID를 확인하세요.');result['anthropic-workspace-id']=workspace;}}
 return result;
}
function signalFor(signal,timeout){return AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(timeout)]);}
function openaiOAuthBody(body){
 const result={...body,store:false,stream:true};
 for(const key of ['background','conversation','max_output_tokens','max_tool_calls','metadata','moderation','multi_agent','prompt','prompt_cache_retention','safety_identifier','temperature','top_logprobs','top_p','truncation','user','previous_response_id'])delete result[key];
 const input=Array.isArray(body.input)?body.input:[{role:'user',content:String(body.input||'')}],functions=(body.tools||[]).filter(tool=>['function','custom'].includes(tool.type));
 result.input=functions.length?[{type:'additional_tools',role:'developer',tools:functions},...input]:input;
 result.tools=(body.tools||[]).filter(tool=>!['function','custom'].includes(tool.type));
 if(result.tools.some(tool=>tool.type!=='web_search'))throw new Error('ChatGPT OAuth는 이 호스팅 도구를 지원하지 않습니다. 이미지 생성 등은 OpenAI API 연결을 선택하세요.');
 return result;
}
async function streamResponse(response){
 if(!response.body)throw new Error('AI 스트림이 비어 있습니다.');let buffer='',size=0,completed,decoder=new TextDecoder();
 const consume=frame=>{const data=frame.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(!data||data==='[DONE]')return;let event;try{event=JSON.parse(data);}catch{throw new Error('AI 스트림 이벤트를 읽지 못했습니다.');}
  if(['response.failed','response.incomplete','error'].includes(event.type))throw new Error(event.response?.error?.message||event.error?.message||'AI 응답이 완료되지 않았습니다.');
  if(event.type==='response.completed'){if(!event.response||!Array.isArray(event.response.output)||(event.response.status&&event.response.status!=='completed'))throw new Error('완료된 AI 응답이 잘못되었습니다.');completed=event.response;}
 };
 for await(const chunk of response.body){size+=chunk.length;if(size>32*1024*1024)throw new Error('AI 응답이 너무 큽니다.');buffer+=decoder.decode(chunk,{stream:true});let match;while((match=/\r?\n\r?\n/.exec(buffer))){consume(buffer.slice(0,match.index));buffer=buffer.slice(match.index+match[0].length);}}
 buffer+=decoder.decode();if(buffer.trim())consume(buffer);if(!completed)throw new Error('AI 스트림이 완료 확인 없이 종료되었습니다. 변경 결과를 성공으로 처리하지 않았습니다.');return completed;
}
function contentBlocks(content){
 if(typeof content==='string')return [{type:'text',text:content}];
 return (content||[]).map(part=>{if(['input_text','output_text','text'].includes(part.type))return {type:'text',text:part.text};if(part.type==='input_image'){const match=part.image_url?.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/);if(!match)throw new Error('Claude에는 지원하는 형식의 로컬 그림만 전달하세요.');return {type:'image',source:{type:'base64',media_type:match[1],data:match[2]}};}throw new Error('Claude가 지원하지 않는 입력입니다: '+part.type);});
}
function anthropicBody(body,model){
 const messages=[],seen=new Set();const append=(role,content)=>{if(!content.length)return;const prior=messages.at(-1);if(prior?.role===role)prior.content.push(...content);else messages.push({role,content});};
 const input=Array.isArray(body.input)?body.input:[{role:'user',content:String(body.input||'')}];
 for(const item of input){
  if(item._anthropicContent){append('assistant',structuredClone(item._anthropicContent));for(const block of item._anthropicContent)if(block.type==='tool_use')seen.add(block.id);}
  else if(item.type==='function_call'){if(!seen.has(item.call_id)){append('assistant',[{type:'tool_use',id:item.call_id,name:item.name,input:JSON.parse(item.arguments||'{}')}]);seen.add(item.call_id);}}
  else if(item.type==='function_call_output'){let error=false;try{const result=JSON.parse(item.output);error=Boolean(result.error||result.isError);}catch{}append('user',[{type:'tool_result',tool_use_id:item.call_id,content:typeof item.output==='string'?item.output:JSON.stringify(item.output),...(error?{is_error:true}:{})}]);}
  else if(item.role==='user'||item.role==='assistant')append(item.role,contentBlocks(item.content));
  else if(item.type==='reasoning')continue;
  else throw new Error('Claude 대화 변환을 지원하지 않는 항목입니다: '+item.type);
 }
 const tools=(body.tools||[]).map(tool=>{if(tool.type==='function')return {name:tool.name,description:tool.description,input_schema:tool.parameters};if(tool.type==='web_search')return {type:'web_search_20250305',name:'web_search',max_uses:5};throw new Error('Claude가 지원하지 않는 호스팅 도구입니다: '+tool.type);});
 return {model,max_tokens:8192,messages,...(body.instructions?{system:body.instructions}:{}),...(tools.length?{tools,tool_choice:{type:'auto',disable_parallel_tool_use:true}}:{})};
}
function anthropicResult(result){
 if(['max_tokens','pause_turn','refusal'].includes(result.stop_reason))throw new Error('Claude 응답이 완료되지 않았습니다 ('+result.stop_reason+'). 작업 범위를 나눠 다시 요청하세요.');
 if(!Array.isArray(result.content))throw new Error('Claude 응답을 읽지 못했습니다.');
 const output=[{type:'message',role:'assistant',content:result.content.filter(x=>x.type==='text').map(x=>({type:'output_text',text:x.text})),_anthropicContent:result.content}];
 for(const item of result.content){if(item.type==='tool_use')output.push({type:'function_call',call_id:item.id,name:item.name,arguments:JSON.stringify(item.input)});
  if(item.type==='web_search_tool_result'){if(!Array.isArray(item.content))throw new Error('Claude 웹 검색을 완료하지 못했습니다.');output.push({type:'web_search_call',action:{sources:item.content.filter(x=>x.type==='web_search_result').map(x=>({url:x.url,title:x.title}))}});}}
 return {output,usage:result.usage};
}
async function requestResponse({settings,apiKey,credential,signal,body,timeout=180000}){
 if(!settings.model?.trim())throw new Error('연결 설정에서 사용할 AI 모델을 선택하세요.');const provider=credential?.provider||settings.provider||'openai',oauth=(credential?.mode||settings.connectionMode)==='oauth';
 const data=provider==='anthropic'?anthropicBody(body,settings.model.trim()):{...(oauth?openaiOAuthBody(body):body),model:settings.model.trim(),store:false};
 const response=await fetch(endpoint(settings,credential),{method:'POST',headers:headers(settings,credential,apiKey),body:JSON.stringify(data),redirect:'error',signal:signalFor(signal,timeout)});
 if(response.ok&&oauth&&provider==='openai')return streamResponse(response);
 let result;try{result=await response.json();}catch{throw new Error('AI 응답을 읽지 못했습니다 ('+response.status+').');}if(!response.ok)throw new Error(result.error?.message||'AI 연결 오류 ('+response.status+')');return provider==='anthropic'?anthropicResult(result):result;
}
async function listModels({settings,apiKey,credential,signal}){
 const response=await fetch(endpoint(settings,credential,true),{headers:headers(settings,credential,apiKey),redirect:'error',signal:signalFor(signal,20000)});let result;try{result=await response.json();}catch{throw new Error('모델 목록을 읽지 못했습니다.');}if(!response.ok)throw new Error(result.error?.message||'모델 목록을 가져오지 못했습니다 ('+response.status+').');
 const oauth=credential?.mode==='oauth'&&credential.provider==='openai',items=oauth?result.models:result.data;
 if(!Array.isArray(items))throw new Error('계정이 반환한 모델 목록 형식을 확인하세요.');return items.filter(item=>!oauth||item.visibility==='list').map(item=>({id:item.slug||item.id,name:item.display_name||item.slug||item.id})).filter(item=>typeof item.id==='string'&&item.id.length>0);
}
function responseText(result){return (result.output||[]).filter(item=>item.type==='message').flatMap(item=>item.content||[]).filter(item=>item.type==='output_text').map(c=>c.text).join('\n');}
module.exports={requestResponse,responseText,listModels,openaiOAuthBody,anthropicBody,anthropicResult,streamResponse};
