import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {SchoolBrowser} from '../src/school-browser.mjs';

test('menu trees expose current refs and expand into selectable draft rows', async()=>{
  const site=http.createServer((_req,res)=>{
    res.setHeader('content-type','text/html;charset=utf-8');
    res.end(`<!doctype html><title>합성 메뉴 검증</title>
      <div role="tree"><div role="treeitem" tabindex="0" aria-label="기안" aria-expanded="false"
        onkeydown="if(event.key==='ArrowRight'||event.key==='ArrowLeft'){const open=event.key==='ArrowRight';setTimeout(()=>{this.setAttribute('aria-expanded',String(open));document.querySelector('#drafts').hidden=!open;},40)}">기안</div>
        <div id="drafts" hidden><div role="treeitem" tabindex="0" onclick="document.querySelector('#rows').hidden=false">임시저장</div></div>
        <div role="treeitem" aria-disabled="true" aria-expanded="false">사용 불가</div>
      </div>
      <div role="tab" onclick="document.querySelector('#result').textContent='탭 선택'">문서관리</div>
      <div role="menuitem" onclick="document.querySelector('#result').textContent='결재 메뉴 선택'">결재</div>
      <div class="GridCellTreeItemText" id="legacy-draft" onclick="document.querySelector('#result').textContent='일반 트리 메뉴 선택'">기안 메뉴</div>
      <div class="GridCellText" id="legacy-row" onclick="document.querySelector('#result').textContent='일반 문서 행 선택'">다른 합성 문서 QA-003</div>
      <div id="rows" hidden><div role="gridcell" onclick="document.querySelector('#result').textContent='합성 계획 QA-002 열림'">합성 계획 QA-002</div></div>
      <button>상신</button><p id="result">대기</p>`);
  });
  await new Promise(resolve=>site.listen(0,'127.0.0.1',resolve));
  const browser=new SchoolBrowser();
  try {
    await browser.start({headed:false});
    let view=await browser.execute({action:'open',url:'http://127.0.0.1:'+site.address().port});
    assert.equal(view.elements.some(e=>e.label==='임시저장'),false);
    const legacy=view.elements.find(e=>e.id==='legacy-draft');
    assert.equal(legacy.classes,'GridCellTreeItemText');
    view=await browser.execute({action:'click',ref:legacy.ref});
    assert.match(view.text,/일반 트리 메뉴 선택/);
    let selected=await browser.execute({action:'snapshot',selector:'#legacy-row'});
    assert.equal(selected.totalElements,1);
    selected=await browser.execute({action:'click',ref:selected.elements[0].ref});
    assert.match(selected.text,/일반 문서 행 선택/);
    view=await browser.execute({action:'snapshot'});
    assert.equal(view.elements.find(e=>e.label==='사용 불가').disabled,true);
    const old=view.elements.find(e=>e.label==='기안').ref;
    view=await browser.execute({action:'expand',ref:old});
    assert.equal(view.elements.find(e=>e.label==='기안').expanded,true);
    assert.ok(view.elements.find(e=>e.label==='임시저장'));
    await assert.rejects(browser.execute({action:'click',ref:old}),e=>e.code==='STALE_REF');
    view=await browser.execute({action:'click',ref:view.elements.find(e=>e.label==='임시저장').ref});
    view=await browser.execute({action:'click',ref:view.elements.find(e=>e.label==='합성 계획 QA-002').ref});
    assert.match(view.text,/합성 계획 QA-002 열림/);
    view=await browser.execute({action:'click',ref:view.elements.find(e=>e.role==='menuitem'&&e.label==='결재').ref});
    assert.match(view.text,/결재 메뉴 선택/);
    await assert.rejects(browser.execute({action:'click',ref:view.elements.find(e=>e.label==='상신').ref}),e=>e.code==='FINAL_ACTION_CONFIRMATION_REQUIRED');
    await assert.rejects(browser.execute({action:'expand',ref:view.elements.find(e=>e.label==='사용 불가').ref}),e=>e.code==='TREE_ITEM_REQUIRED');
    await assert.rejects(browser.execute({action:'expand',ref:view.elements.find(e=>e.label==='상신').ref}),e=>e.code==='TREE_ITEM_REQUIRED');
    view=await browser.execute({action:'collapse',ref:view.elements.find(e=>e.label==='기안').ref});
    assert.equal(view.elements.find(e=>e.label==='기안').expanded,false);
    assert.equal(view.elements.some(e=>e.label==='임시저장'),false);
  } finally {
    await browser.browser?.close();
    await new Promise(resolve=>site.close(resolve));
  }
});
