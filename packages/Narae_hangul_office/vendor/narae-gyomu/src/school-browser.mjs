// Extend the frozen Narae browser engine with school iframe/form observations.
import {BrowserEngine, bound, Fault} from '../packages/narae_browser/src/browser.mjs';

export class SchoolBrowser extends BrowserEngine {
  constructor() {super(); this.frame = null;}
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
    const result = await this.scope().evaluate(({limit, chars, offset, filter, version}) => {
      const visible = e => {const s = getComputedStyle(e), r = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;};
      const nodes = [...document.querySelectorAll('a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[contenteditable=true]')];
      const elements = [];
      for (const e of nodes) {
        if (!visible(e)) continue;
        const tag = e.tagName.toLowerCase(), type = e.getAttribute('type') || '';
        const label = (e.getAttribute('aria-label') || e.labels?.[0]?.innerText || e.getAttribute('placeholder') ||
          e.innerText || e.getAttribute('title') || e.getAttribute('name') || '').replace(/\s+/g, ' ').trim().slice(0, 180);
        if (filter && !label.includes(filter)) continue;
        const ref = `${version}/e${elements.length + 1}`;
        e.setAttribute('data-narae-ref', ref);
        elements.push({ref, role: e.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'input' ? 'textbox' : tag),
          label, tag, type, disabled: Boolean(e.disabled),
          ...(tag === 'a' ? {href: e.href} : {}),
          ...(['input', 'textarea', 'select'].includes(tag) ? {value: type === 'password' ? '[비밀번호]' : e.value} : {}),
          ...(['checkbox', 'radio'].includes(type) ? {checked: e.checked} : {}),
          ...(tag === 'select' ? {options: [...e.options].map(o => ({text: o.text, value: o.value, selected: o.selected}))} : {})});
      }
      return {url: location.href, title: document.title, text: (document.body?.innerText || '').slice(0, chars),
        elements: elements.slice(offset, offset + limit), totalElements: elements.length,
        hasMore: elements.length > offset + limit, nextOffset: offset + limit};
    }, {version, limit: bound(args.limit, 1, 100, 35), chars: bound(args.chars, 100, 12000, 2000),
      offset: bound(args.offset, 0, 10000, 0), filter: args.filter || ''});
    for (const entry of result.elements) this.refs.set(entry.ref, entry);
    return {version, frameIndex: this.page.frames().indexOf(this.scope()), ...result, untrusted: true};
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
      if (/^(?:최종\s*)?(?:상신|결재올림|결재\s*승인|공람\s*확인|공람\s*완료|발송|전송|삭제|승인)$/.test(entry.label.trim()))
        throw new Fault('UNSUPPORTED_FINAL_ACTION', '이 최종 처리는 자동화 범위에 없습니다. 화면에서 직접 처리하세요.');
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
