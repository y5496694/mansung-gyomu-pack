'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const root='mainframe.WorkFrame.winId_SYNTHETIC_77.form',base=root+'.divWork.form.';
function fixture(){return `<!doctype html><meta charset="utf-8"><title>합성 품의 확인창</title><style>input,textarea,button{display:block;margin:4px;width:500px}textarea{height:50px}</style><script>
const root=${JSON.stringify(root)},base=root+'.divWork.form.';
function node(tag,id,text,parent=document.body){const e=document.createElement(tag);e.id=id;if(tag==='input'||tag==='textarea')e.value=text;else e.textContent=text;parent.appendChild(e);return e;}
function promptFor(op){const box=node('section',root.replace(/\\.form$/,'')+'.NAA0012.form','');node('textarea',box.id+'.txtMsgContent:textarea',op==='save'?'저장하시겠습니까?':'삭제하시겠습니까?',box);node('button',box.id+'.btnCancle','취소',box).onclick=()=>box.remove();node('button',box.id+'.btnOk','확인',box).onclick=async()=>{box.remove();await fetch('/synthetic/'+op,{method:'POST'});document.getElementById(base+'divMain.form.edtCnsulNo:input').value=op==='save'?'2036SYNTHETIC00007':'';const done=node('section',root.replace(/\\.form$/,'')+'.FAA0003.form','');node('textarea',done.id+'.txtMsgContent:textarea',op==='save'?'저장완료되었습니다.':'삭제완료되었습니다.',done);node('button',done.id+'.btnOk','확인',done).onclick=()=>done.remove();};}
window.onload=()=>{node('input',base+'divMain.form.edtCnsulNo:input','');node('input',base+'divMain.form.edtCnsulSj:input','합성 시험');node('button',base+'divAuth0.form.btnAuthR02','저장').onclick=()=>promptFor('save');node('button',base+'divAuth0.form.btnAuthR01','삭제').onclick=()=>promptFor('delete');};
</script>`;}
test('isolated finance bridge binds DOM digest, exact HTML prompts and one-use server operations',async()=>{
 const {OfficeSchoolBrowser}=await import('../src/school-browser.mjs'),b=new OfficeSchoolBrowser();let stored=false,saves=0,deletes=0;
 try{
  await b.start({headed:false});await b.page.route('**/*',async route=>{const p=new URL(route.request().url()).pathname;if(p==='/synthetic/save'){stored=true;saves++;return route.fulfill({json:{ok:true}});}if(p==='/synthetic/delete'){stored=false;deletes++;return route.fulfill({json:{ok:true}});}return route.fulfill({contentType:'text/html; charset=utf-8',body:fixture()});});
  await b.execute({action:'open',url:'https://klef.cbe.go.kr/synthetic-finance-only'});
  const observe=()=>b.execute({action:'requisition-observe',root});
  async function click(op,state){const s=await b.snapshot({selector:'[id='+JSON.stringify(base+(op==='save'?'divAuth0.form.btnAuthR02':'divAuth0.form.btnAuthR01'))+']'});return b.execute({action:'requisition-click',operation:op,root,ref:s.elements[0].ref,digest:state.digest,title:'합성 시험',number:op==='save'?'':'2036SYNTHETIC00007'});}
  async function acknowledge(r){let status;for(let i=0;i<30;i++){status=await b.execute({action:'requisition-status',id:r.id});if(status.nativeDialog)break;await new Promise(resolve=>setTimeout(resolve,30));}assert(status.nativeDialog);const d=status.nativeDialog;return b.execute({action:'requisition-confirm',id:r.id,dialogId:d.id,message:d.message});}
  const initial=await observe();await b.page.locator('[id='+JSON.stringify(base+'divMain.form.edtCnsulSj:input')+']').fill('변경된 합성 제목');await assert.rejects(click('save',initial),/달라졌/);assert.equal(saves,0);await b.page.locator('[id='+JSON.stringify(base+'divMain.form.edtCnsulSj:input')+']').fill('합성 시험');
  const savedState=await observe(),saved=await click('save',savedState);assert.equal(saved.serverVerified,false);assert.equal(saves,0);await acknowledge(saved);await acknowledge(saved);assert.equal(stored,true);assert.equal(saves,1);await assert.rejects(click('save',savedState));
  const deleted=await click('delete',await observe());await acknowledge(deleted);await acknowledge(deleted);assert.equal(stored,false);assert.equal(deletes,1);const trace=await b.execute({action:'requisition-status',id:deleted.id});assert(trace.networkCompleted.some(r=>r.path==='/synthetic/delete'&&r.method==='POST'&&r.status===200));
 }finally{await b.browser?.close();}
});
