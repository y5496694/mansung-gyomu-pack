'use strict';
const fields={token:'PLAYWRIGHT_MCP_EXTENSION_TOKEN',browser:'PLAYWRIGHT_MCP_BROWSER',profile:'PLAYWRIGHT_MCP_PROFILE_DIR_NAME'};
function normalize(values){
 if(!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).some(key=>!Object.values(fields).includes(key)))throw new Error('지원하는 브라우저 연결 환경 변수만 입력하세요.');
 const result={};for(const [key,value]of Object.entries(values)){if(typeof value!=='string'||value.length>4096||/[\r\n\0]/.test(value))throw new Error('브라우저 연결 환경 변수 값을 확인하세요.');if(value.trim())result[key]=value.trim();}
 if(result[fields.token]&&/\s/.test(result[fields.token]))throw new Error('확장 토큰에는 공백을 넣지 마세요.');
 if(result[fields.browser]&&!['chrome','msedge'].includes(result[fields.browser]))throw new Error('Chrome 또는 Edge를 선택하세요.');
 if(result[fields.profile]&&!/^(?:Default|Profile \d+)$/.test(result[fields.profile]))throw new Error('프로필 경로의 마지막 이름(Default 또는 Profile 번호)을 입력하세요.');
 return result;
}
class BrowserEnvironment{
 constructor(store){this.store=store;}
 environment(){const raw=this.store.get();return normalize(raw?JSON.parse(raw):{});}
 state(inherited={}){const saved=this.environment(),stored=Boolean(saved[fields.token]),available=stored||Boolean(inherited[fields.token]);return {hasToken:available,hasStoredToken:stored,tokenSource:stored?'office':available?'environment':'none',browser:saved[fields.browser]||'',profile:saved[fields.profile]||''};}
 save(patch={}){if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(key=>!['token','browser','profile','clearToken'].includes(key)))throw new Error('브라우저 연결 환경 변수 설정을 확인하세요.');const before=this.environment(),next={...before};
  if(patch.clearToken===true)delete next[fields.token];
  if(patch.token!==undefined){if(typeof patch.token!=='string')throw new Error('확장 토큰 값을 확인하세요.');let value=patch.token.trim().replace(/^(?:export\s+)?PLAYWRIGHT_MCP_EXTENSION_TOKEN\s*=\s*/,'');if(/^(["']).*\1$/.test(value))value=value.slice(1,-1);if(value)next[fields.token]=value;}
  for(const key of ['browser','profile'])if(patch[key]!==undefined){if(patch[key]==='')delete next[fields[key]];else next[fields[key]]=patch[key];}
  const value=normalize(next),changed=JSON.stringify(value)!==JSON.stringify(before);if(changed){if(Object.keys(value).length)this.store.set(JSON.stringify(value));else this.store.remove();}return {changed,...this.state()};
 }
}
module.exports={BrowserEnvironment,normalize,fields};
