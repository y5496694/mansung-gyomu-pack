// Extend the frozen Narae browser engine with school iframe/form observations.
import {BrowserEngine, bound, Fault} from '../packages/narae_browser/src/browser.mjs';
import {createHash} from 'node:crypto';

function finalDOM(element) {
  const visible = e => {const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
  const dialogs = [...document.querySelectorAll('dialog[open],[role=dialog],[aria-modal=true]')].filter(visible);
  const root = element?.closest?.('[role=dialog],dialog,[aria-modal=true]') || dialogs.at(-1) || document.body;
  return {text: root.innerText, fields: [...root.querySelectorAll('input:not([type=password]):not([type=file]):not([type=hidden]),textarea,select')]
    .map(e => [e.id,e.name,e.type,e.value,Boolean(e.checked),Boolean(e.disabled)])};
}
const finalDigest = state => createHash('sha256').update(JSON.stringify(state)).digest('hex');

function selectedDocumentsDOM() {
  if (!/\/retrieveSanctnProgrsDocList\.do$/.test(location.pathname)) return [];
  return [...document.querySelectorAll('tr')].filter(row=>row.querySelector('input[type=checkbox]:checked')).map(row=>{
    const identifiers=new Set();
    for(const element of row.querySelectorAll('a[onclick],input[type=checkbox]')) {
      const value=element.getAttribute('onclick') || element.value || '';
      for(const id of value.match(/\b[A-Z][A-Z0-9]{17,31}\b/g) || [])identifiers.add(id);
    }
    return {text:row.innerText.replace(/\s+/g,' ').trim(),documentIds:[...identifiers]};
  }).filter(row=>row.documentIds.length);
}

export function finalOperation(label) {
  const name = label.replace(/\s+/g, '').replace(/[.!…]+$/, '');
  if (/^(?:최종)?(?:상신|결재올림)(?:하기)?$/.test(name)) return 'submit';
  if (/^(?:최종)?(?:결재|결재승인|승인)(?:하기)?$/.test(name)) return 'approve';
  if (/^(?:기안)?회수(?:하기)?$/.test(name)) return 'withdraw';
  if (/^(?:최종)?(?:공람확인|공람완료|발송|전송|삭제)(?:하기|합니다|요청)?$/.test(name)) return 'unsupported';
  return null;
}

export class SchoolBrowser extends BrowserEngine {
  constructor() {super(); this.frame = null; this.finalAttempts = new Set();}
  installFinalDialogs() {
    const watch = page => {
      page.removeAllListeners('dialog');
      page.on('dialog', async dialog => {
        const auth = this.finalAuthorization;
        const accepted = Boolean(auth && auth.page === page && !auth.dialog && dialog.type() === 'confirm' &&
          auth.text && dialog.message() === auth.text && !/삭제|발송|전송|반려|인증|암호|서명/.test(dialog.message()) &&
          (auth.operation === 'submit' ? /상신|결재올림/ : auth.operation === 'withdraw' ? /회수/ : /결재|승인/).test(dialog.message()));
        if (auth && auth.page === page && !auth.dialog) auth.dialog = {type:dialog.type(),message: dialog.message(), accepted};
        await (accepted ? dialog.accept() : dialog.dismiss()).catch(() => {});
      });
    };
    this.context.on('page', watch);
    for (const page of this.context.pages()) watch(page);
  }
  async start(options) {const result = await super.start(options); this.installFinalDialogs(); return result;}
  async withFinalState(result) {return {...result,finalState:finalDigest(await this.scope().evaluate(finalDOM))};}
  async finalClick(command, entry, operation) {
    if (operation === 'unsupported') throw new Fault('UNSUPPORTED_FINAL_ACTION', '발송·삭제·공람 처리는 이번 지원 범위가 아닙니다.');
    if (command.confirmFinalAction !== true || !command.expectedDocument?.trim() ||
        command.expectedLabel !== entry.label || command.expectedUrl !== this.scope().url() || !command.expectedState)
      throw new Fault('FINAL_ACTION_CONFIRMATION_REQUIRED', '명시적 상신·결재 요청 후 confirmFinalAction, expectedDocument, expectedLabel, expectedUrl을 지정하세요.');
    const {locator} = this.ref(command.ref);
    if (finalDigest(await locator.evaluate(finalDOM)) !== command.expectedState)
      throw new Fault('FINAL_ACTION_TARGET_CHANGED', '미리보기 이후 문서·입력값·결재선이 바뀌었습니다. 다시 확인하세요.');
    const current = await locator.evaluate(e => ({label: (e.getAttribute('aria-label') || e.innerText || e.value || e.getAttribute('title') || '').replace(/\s+/g, ' ').trim(),
      disabled: Boolean(e.disabled) || e.getAttribute('aria-disabled') === 'true',
      text: (e.closest('[role=dialog],dialog') || document.body).innerText}));
    if (current.disabled || current.label !== entry.label || !current.text.includes(command.expectedDocument))
      throw new Fault('FINAL_ACTION_TARGET_CHANGED', '현재 문서·버튼·입력 내용을 다시 확인하세요.');
    if (operation === 'withdraw') {
      const selected=await this.scope().evaluate(selectedDocumentsDOM);
      if(!command.expectedDocumentId || selected.length!==1 || !selected[0].text.includes(command.expectedDocument) ||
          !selected[0].documentIds.includes(command.expectedDocumentId))
        throw new Fault('WITHDRAW_TARGET_REQUIRED','문서진행에서 선택한 한 건의 제목과 실제 문서 ID를 대조하세요.');
    }
    const key = JSON.stringify([this.scope().url(), operation, command.expectedDocumentId || command.expectedDocument]);
    if (this.finalAttempts.has(key)) throw new Fault('FINAL_ACTION_ALREADY_ATTEMPTED', '이미 시도한 처리입니다. 서버 상태를 확인하고 중복 실행하지 마세요.');
    this.finalAttempts.add(key);
    const auth = {page: this.page, operation, text: command.confirmationText};
    this.finalAuthorization = auth;
    try {
      await locator.click({noWaitAfter: true});
      this.invalidate();
      const result = await this.snapshot(command);
      // A dismissed native confirm proves cancellation, not a successful submission.
      if (auth.dialog?.type === 'confirm' && !auth.dialog.accepted) this.finalAttempts.delete(key);
      return {...result, finalAction: {operation, attempted: true, completed: false,
        verificationRequired: true, ...(auth.dialog ? {nativeDialog: auth.dialog} : {})}};
    } finally {this.finalAuthorization = null;}
  }
  scope() {
    if (this.frame?.isDetached()) this.frame = null;
    return this.frame || this.page.mainFrame();
  }
  ref(value) {
    const entry = this.refs.get(value);
    if (!entry) throw new Fault('STALE_REF', 'snapshot을 새로 읽고 현재 ref를 사용하세요.');
    return {entry, locator: this.scope().locator(`[data-narae-ref="${value}"]`)};
  }
  async snapshot(args = {}) {
    const version = 's' + ++this.serial;
    this.refs.clear();
    const result = await this.scope().evaluate(({limit, chars, offset, filter, version, selector}) => {
      const visible = e => {const s = getComputedStyle(e), r = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;};
      const nodes = [...document.querySelectorAll(selector || 'a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[role=treeitem],[role=tab],[role=menuitem],[role=gridcell],[role=option],[role=combobox],[role=checkbox],[role=radio],[class*="tree" i],[contenteditable=true]')];
      const elements = [];
      for (const e of nodes) {
        if (!visible(e)) continue;
        const tag = e.tagName.toLowerCase(), type = e.getAttribute('type') || '';
        const label = (e.getAttribute('aria-label') || (/^(button|submit)$/.test(type) ? e.value : '') || e.labels?.[0]?.innerText || e.getAttribute('placeholder') ||
          e.innerText || e.getAttribute('title') || e.getAttribute('name') || '').replace(/\s+/g, ' ').trim().slice(0, 180);
        if (filter && !label.includes(filter)) continue;
        const ref = `${version}/e${elements.length + 1}`;
        e.setAttribute('data-narae-ref', ref);
        elements.push({ref, role: e.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'input' ? 'textbox' : tag),
          label, tag, type, id: e.id || '', classes: e.className?.baseVal ?? String(e.className || ''),
          disabled: Boolean(e.disabled) || e.getAttribute('aria-disabled') === 'true',
          ...(e.hasAttribute('aria-expanded') ? {expanded: e.getAttribute('aria-expanded') === 'true'} : {}),
          ...(e.hasAttribute('aria-selected') ? {selected: e.getAttribute('aria-selected') === 'true'} : {}),
          ...(tag === 'a' ? {href: e.href} : {}),
          ...(['input', 'textarea', 'select'].includes(tag) ? {value: type === 'password' ? '[비밀번호]' : e.value} : {}),
          ...(['checkbox', 'radio'].includes(type) ? {checked: e.checked} : {}),
          ...(tag === 'select' ? {options: [...e.options].map(o => ({text: o.text, value: o.value, selected: o.selected}))} : {})});
      }
      return {url: location.href, title: document.title, text: (document.body?.innerText || '').slice(0, chars),
        elements: elements.slice(offset, offset + limit), totalElements: elements.length,
        hasMore: elements.length > offset + limit, nextOffset: offset + limit};
    }, {version, limit: bound(args.limit, 1, 100, 35), chars: bound(args.chars, 100, 12000, 2000),
      offset: bound(args.offset, 0, 10000, 0), filter: args.filter || '', selector: args.selector || ''});
    for (const entry of result.elements) this.refs.set(entry.ref, entry);
    return this.withFinalState({version, frameIndex: this.page.frames().indexOf(this.scope()), ...result,
      selectedDocuments:await this.scope().evaluate(selectedDocumentsDOM),untrusted: true});
  }
  async read(args = {}) {
    return this.scope().evaluate(({chars, offset, selector}) => {
      const el = selector ? document.querySelector(selector) : document.querySelector('main,article,[role=main]') || document.body;
      if (!el) return {error: 'SELECTOR_NOT_FOUND', text: '', untrusted: true};
      const text = (el.innerText || '').trim();
      return {url: location.href, title: document.title, text: text.slice(offset, offset + chars), offset,
        totalChars: text.length, truncated: text.length > offset + chars, untrusted: true};
    }, {chars: bound(args.chars, 100, 20000, 5000), offset: bound(args.offset, 0, 1000000, 0), selector: args.selector || null});
  }
  async execute(command) {
    if (['open', 'back', 'tab'].includes(command.action)) this.frame = null;
    if (command.action === 'frames') return {frames: await Promise.all(this.page.frames().map(async (f, index) =>
      ({index, name: f.name(), url: f.url(), active: f === this.scope()})))};
    if (command.action === 'frame') {
      const frames = this.page.frames();
      this.frame = frames[bound(command.index, 0, frames.length - 1, 0)];
      this.invalidate(); return this.snapshot(command);
    }
    if (command.action === 'click') {
      const {entry} = this.ref(command.ref);
      const navigation = /^(treeitem|tab|menuitem)$/.test(entry.role);
      const operation = navigation ? null : finalOperation(entry.label);
      if (operation) return this.finalClick(command, entry, operation);
    }
    if (['expand', 'collapse'].includes(command.action)) {
      const {entry, locator} = this.ref(command.ref);
      const wanted = command.action === 'expand';
      if (entry.role !== 'treeitem' || typeof entry.expanded !== 'boolean' || entry.disabled)
        throw new Fault('TREE_ITEM_REQUIRED', '현재 snapshot에서 펼침 상태가 확인된 활성 treeitem을 지정하세요.');
      if (entry.expanded !== wanted) {
        await locator.press(wanted ? 'ArrowRight' : 'ArrowLeft');
        try {
          await this.scope().locator(`[data-narae-ref="${entry.ref}"][aria-expanded="${wanted}"]`).waitFor({state:'visible',timeout:12000});
        } catch {
          throw new Fault('TREE_STATE_NOT_CONFIRMED', '메뉴 펼침 상태가 확인되지 않았습니다. 새 snapshot을 확인하세요.');
        }
      }
      this.invalidate(); return this.snapshot(command);
    }
    if (command.action === 'press' && !['Tab', 'Shift+Tab', 'Escape', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].includes(command.key))
      throw new Fault('UNSUPPORTED_KEY', '현재 자동 키 입력은 이동·선택·닫기 키만 지원합니다. 검색 버튼의 실제 ref를 사용하세요.');
    if (['check', 'uncheck'].includes(command.action)) {
      const {locator} = this.ref(command.ref);
      await locator.setChecked(command.action === 'check'); this.invalidate(); return this.snapshot(command);
    }
    if (command.action === 'wait' && command.selector) {
      await this.scope().locator(command.selector).first().waitFor({state: 'visible', timeout: 12000});
      return {ready: true};
    }
    return super.execute(command);
  }
}
