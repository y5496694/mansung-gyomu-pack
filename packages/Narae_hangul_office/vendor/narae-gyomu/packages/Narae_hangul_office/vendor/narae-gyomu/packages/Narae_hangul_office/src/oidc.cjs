const {createPublicKey,verify,timingSafeEqual}=require('node:crypto');
const ISSUER='https://auth.openai.com';
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
async function verifyIdentity(token,{clientId,nonce,subject,fetchJson}){
 if(typeof token!=='string'||token.length>32768)throw new Error('로그인 ID 토큰이 없습니다.');
 const parts=token.split('.');if(parts.length!==3)throw new Error('로그인 ID 토큰 형식이 잘못되었습니다.');
 let header,claims;try{header=JSON.parse(Buffer.from(parts[0],'base64url'));claims=JSON.parse(Buffer.from(parts[1],'base64url'));}catch{throw new Error('로그인 ID 토큰을 읽지 못했습니다.');}
 if(header.alg!=='RS256'||typeof header.kid!=='string'||header.crit)throw new Error('지원하지 않는 ID 토큰 서명입니다.');
 const metadata=await fetchJson(ISSUER+'/.well-known/openid-configuration');
 if(metadata.issuer!==ISSUER||new URL(metadata.jwks_uri).origin!==ISSUER)throw new Error('로그인 발급자 정보가 일치하지 않습니다.');
 const {keys}=await fetchJson(metadata.jwks_uri),jwk=keys?.find(key=>key.kid===header.kid&&key.kty==='RSA'&&(!key.alg||key.alg==='RS256')&&(!key.use||key.use==='sig'));
 if(!jwk||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key:jwk,format:'jwk'}),Buffer.from(parts[2],'base64url')))throw new Error('로그인 ID 토큰 서명을 확인하지 못했습니다.');
 const now=Date.now()/1000,aud=Array.isArray(claims.aud)?claims.aud:[claims.aud];
 if(claims.iss!==ISSUER||!aud.includes(clientId)||(aud.length>1&&claims.azp!==clientId)||!Number.isFinite(claims.exp)||claims.exp<=now||(claims.nbf!==undefined&&(!Number.isFinite(claims.nbf)||claims.nbf>now+60))||typeof claims.sub!=='string'||!claims.sub)throw new Error('로그인 ID 토큰의 계정·대상·유효기간을 확인하세요.');
 if(nonce!==undefined&&!equal(claims.nonce,nonce))throw new Error('로그인 nonce가 일치하지 않습니다.');
 if(subject!==undefined&&claims.sub!==subject)throw new Error('선택한 ChatGPT 계정과 로그인한 계정이 다릅니다. 계정 추가를 사용하세요.');
 return {subject:claims.sub,email:typeof claims.email==='string'?claims.email:'',name:typeof claims.name==='string'?claims.name:''};
}
module.exports={verifyIdentity,equal,ISSUER};
