// End-to-end CLI protocol and actual Hancom round trips on synthetic documents.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),home=fs.mkdtempSync(path.join(os.tmpdir(),'narae-cli-')),cli=path.join(root,'src/cli.cjs');
const {NativeDocuments}=require('../src/native-documents.cjs'),native=new NativeDocuments(home,require('../src/runtime-python.cjs').resolvePython(root));
let index=0;const job=req=>{const file=path.join(home,'job-'+(++index)+'.json'),result=path.join(home,'result-'+index+'.json');fs.writeFileSync(file,JSON.stringify(req));const p=spawnSync(process.execPath,[cli,'run',file,'--result',result],{cwd:os.tmpdir(),encoding:'utf8',env:{...process.env,NARAE_OFFICE_HOME:home},timeout:180000,windowsHide:true});assert(!p.error,p.error?.message);const value=JSON.parse(p.stdout);assert.deepEqual(JSON.parse(fs.readFileSync(result,'utf8')),value);assert.equal(p.status,value.success?0:1);return value;};
(async()=>{try{const results=[];for(const ext of ['hwpx','hwp']){
 const file=path.join(home,'한글 CLI 문서.'+ext),created=job({schema:1,action:'create',output:path.basename(file),blocks:[{type:'paragraph',text:'CLI 원래 내용'},{type:'table',columns_mm:[60,80],rows:[[{text:'표 제목'},{text:'표 본문'}]]}]});assert(created.success,created.error);
 const read=job({action:'inspect',input:path.basename(file)});assert(read.success,read.error);assert.equal(read.tables.length,1);const paragraph=read.paragraphs.find(p=>p.text==='CLI 원래 내용');assert(paragraph);
 const rejected=job({action:'edit',input:file,expected_input_sha256:'stale',operations:[{op:'set_text',target:paragraph.id,text:'금지'}]});assert.equal(rejected.success,false);
 const edited=job({action:'edit',input:file,expected_input_sha256:read.input_sha256,operations:[{op:'set_text',target:paragraph.id,text:'CLI 수정 내용'}]});assert(edited.success,edited.error);assert(fs.existsSync(edited.backup));
 const after=job({action:'inspect',input:file});assert(after.paragraphs.some(p=>p.text==='CLI 수정 내용'));
 await native.openFile(file,{background:true});const snapshot=await native.list(),pid=snapshot.open_document_list.find(d=>d.local_path.toLowerCase()===file.toLowerCase()).pid;
 const live=job({action:'live-read',input:file});assert(live.success,live.error);
 const changed=job({action:'live-edit',input:file,liveRevision:live.liveRevision,operations:[{op:'replace_text',text:'CLI 수정 내용',replacement:'CLI 한컴 수정 완료',expected_count:1,occurrence:0}]});assert(changed.success,changed.error);assert(changed.saved);
 const saved=job({action:'inspect',input:file});const disk=job({action:'edit',input:file,expected_input_sha256:saved.hash,operations:[{op:'set_text',target:saved.paragraphs.find(p=>p.text==='CLI 한컴 수정 완료').id,text:'열린 문서 갱신 완료'}]});assert(disk.success,disk.error);assert.equal(disk.native_document_reopened,true);
 const current=await native.list();assert.equal(current.open_document_list.find(d=>d.local_path.toLowerCase()===file.toLowerCase()).pid,pid);
 await native.closeFile(file,true);
 const pdf=path.join(home,'출력.'+ext+'.pdf'),exported=job({action:'export',input:file,output:pdf});assert(exported.success,exported.error);assert.equal(exported.pages,1);assert(fs.existsSync(pdf));assert.equal(job({action:'inspect',input:file}).hash,disk.hash);
 results.push({format:ext,create:true,read:true,fileEdit:true,backup:true,staleHashRefused:true,liveEdit:true,samePidAfterFileEdit:true,pdf:true});
 }console.log(JSON.stringify({passed:true,home,results}));}finally{const snapshot=await native.list().catch(()=>({open_document_list:[]}));for(const item of snapshot.open_document_list)if(item.local_path.startsWith(home))await native.closeFile(item.local_path,true).catch(()=>{});native.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
