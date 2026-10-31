const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),destination='D:/Codex/models/Qwen3.5-2B-HF';
const office='D:/Codex/workspaces/Narae_hangul_office';
require(office+'/src/network-trust.cjs').useSystemTrust();
const {download}=require(office+'/src/verified-download.cjs');
const metadata=JSON.parse(fs.readFileSync(path.join(root,'base-metadata.json'),'utf8').replace(/^\uFEFF/,''));
async function main(){
 fs.mkdirSync(destination,{recursive:true});const files=[];
 for(const item of metadata.siblings.filter(s=>/\.(json|jinja|txt|safetensors)$/.test(s.rfilename)||/^(LICENSE|README.md)$/.test(s.rfilename))){
  const url=`https://huggingface.co/Qwen/Qwen3.5-2B/resolve/${metadata.sha}/${item.rfilename}`,file=path.join(destination,item.rfilename);
  if(item.lfs){const spec={bytes:item.size,sha256:item.lfs.sha256};let last=0;await download(url,file,spec,{progress(received,total){if(Date.now()-last>15000||received===total){console.log(JSON.stringify({file:item.rfilename,percent:Math.round(received/total*100)}));last=Date.now();}}});files.push({path:item.rfilename,...spec});}
  else {const response=await fetch(url);if(!response.ok)throw Error(`Download ${item.rfilename}: ${response.status}`);const data=Buffer.from(await response.arrayBuffer());if(data.length!==item.size)throw Error('File size mismatch');fs.writeFileSync(file,data);files.push({path:item.rfilename,bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')});}
 }
 fs.writeFileSync(path.join(root,'download-manifest.json'),JSON.stringify({repo:'Qwen/Qwen3.5-2B',revision:metadata.sha,destination,files},null,2));
 console.log('Verified original base downloaded.');
}main().catch(e=>{console.error(e);process.exitCode=1;});
