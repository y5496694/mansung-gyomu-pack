'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const archive=require('../src/messenger-archive.cjs'),{reviewState,summaryEvidence}=require('../src/edufine-review.cjs'),{evidenceReport}=require('../src/evidence-report.cjs'),{neisTask,neisStep}=require('../src/neis-task.cjs');
test('chat body search excludes a room-name-only hit without skipping either room body',async()=>{
 const directory=fs.mkdtempSync('D:/Codex/tmp/chat-body-bench-'),read=[];
 try{const result=await archive.scan({from:'2039-04-30',to:'2039-10-31',kinds:['chat'],query:'가상교육'},{directory,call:async a=>a[1]==='list'?{items:[{id:'name-only',title:'가상교육'},{id:'body-only',title:'일반'}]}:(read.push(a[2]),{items:[{id:a[2]+'-m',sender:'가상담당',date:'2039-05-01',text:a[2]==='name-only'?'일반 안내':'가상교육은 2039-11-06까지 제출'}]})});assert.equal(result.complete,true);assert.equal(result.recordsRead,2);assert.deepEqual(read,['name-only','body-only']);assert.deepEqual(result.items.map(m=>m.roomId),['body-only']);}
 finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('an authentication-blocked first circulation advances to the observed next page and stays unconfirmed',()=>{
 const observed=[{name:'gyomu_wxs_read',args:{operation:'result',id:'blocked'},value:{expected_title:'인증 대기 문서',document:{status:'authentication_required',closed:false}}}],screen={text:'총 2건 / 1/2페이지',elements:[{documentTitle:true,label:'인증 대기 문서',ref:'doc'},{label:'다음 페이지',ref:'next'}]};
 const state=reviewState({summary:true,allCirculation:true},observed,screen,true);assert.equal(state.nextPage,'next');assert.match(state.footer,/1건 인증 대기·본문 미확인/);assert.match(state.footer,/공문 0건/);assert(!state.receipt);
});
test('document summaries retain the same-title observed status and approver, separately from body facts',()=>{
 const observed=[{name:'gyomu_browser',args:{action:'snapshot'},value:{tableData:[{headers:['제목','결재상태','현재결재자'],rows:[['가상 계획','검토중','가상부장']],hasMore:false}]}},{name:'gyomu_wxs_read',args:{operation:'result',id:'doc'},value:{expected_title:'가상 계획',document:{body:{body_read:true,text:'2039-11-12까지 회신',hasMore:false},closed:true}}}];
 const report=evidenceReport(summaryEvidence(observed)),text=report.render([]);for(const expected of ['목록:','결재상태: 검토중','현재결재자: 가상부장','본문:','2039-11-12'])assert(text.includes(expected));
 observed[0].value.tableData[0].rows[0][0]='다른 계획';assert(!evidenceReport(summaryEvidence(observed)).render([]).includes('가상부장'));
});
const tool={name:'gyomu_browser',parameters:{type:'object',properties:{action:{enum:['snapshot','click','fill','select']}}}},pair=(a,v,id)=>[{type:'function_call',name:'gyomu_browser',arguments:JSON.stringify(a),call_id:id},{type:'function_call_output',call_id:id,output:JSON.stringify(v)}];
function dutyScreen(){return {title:'나이스',elements:[{tag:'input',label:'성명',ref:'person',value:'가상민'},{tag:'input',label:'조회일자',ref:'date',value:'2039-05-04'},{tag:'select',label:'소속',ref:'org',value:'fixture',options:[{text:'가상학교',value:'fixture',selected:true}]},{tag:'button',label:'조회',ref:'query'}],tableData:[]};}
test('coded select values use the actual selected display text and do not repeat selection',()=>{
 const task=neisTask('나이스 가상민 선생님의 2039-05-04 복무 확인. 소속 "가상학교"'),s=dutyScreen(),step=neisStep(task,pair({action:'snapshot'},s,'s'),[tool]);assert.deepEqual(step.tools[0].parameters.properties.action.enum,['click']);assert.deepEqual(step.tools[0].parameters.properties.ref.enum,['query']);
});
test('queried duty rows with a wrong organization or date cannot be reported as the requested result',()=>{
 for(const [organization,date,expected]of [['다른학교','2039-05-04',/소속.*일치하지/],['가상학교','2039-05-05',/일자.*일치하지/]]){const task=neisTask('나이스 가상민 선생님의 2039-05-04 복무 확인. 소속 "가상학교"'),s=dutyScreen(),result={...s,tableData:[{headers:['소속','성명','일자','복무'],rows:[[organization,'가상민',date,'조퇴']],hasMore:false}]},step=neisStep(task,[...pair({action:'snapshot'},s,'s'),...pair({action:'click',ref:'query'},result,'q')],[tool]);assert.match(step.receipt,expected);assert(!step.receipt.includes('확인한 결과'));}
});
test('real school browser labels exclude wrapped select option text',async()=>{
 const {OfficeSchoolBrowser}=await import('../src/school-browser.mjs'),browser=new OfficeSchoolBrowser();
 try{await browser.start({headed:false});await browser.context.route('**/*',route=>new URL(route.request().url()).hostname==='fixture.test'?route.fulfill({contentType:'text/html;charset=utf-8',body:'<meta charset="utf-8"><label>소속<select><option value="a">다른학교</option><option value="b">가상학교</option></select></label>'}):route.abort('blockedbyclient'));const s=await browser.execute({action:'open',url:'https://fixture.test/'}),select=s.elements.find(e=>e.tag==='select');assert.equal(select.label,'소속');assert.equal(select.options.length,2);assert.equal(select.options[0].text,'다른학교');}
 finally{await browser.browser?.close();}
});
