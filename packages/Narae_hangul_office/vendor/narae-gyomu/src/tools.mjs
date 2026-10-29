import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {APP, HOME, DATA, TMP, OUTPUTS, Fault, readJSON, writeJSON, outputPath} from './paths.mjs';
import {run, digest} from './process.mjs';
import {SchoolBrowser} from './school-browser.mjs';
import {browserPath} from '../packages/narae_browser/src/browser.mjs';
import {WxsCapture} from './wxs-capture.mjs';

const hangulRoot = path.join(APP, 'packages/Narae_hangul_office/skills/narae-hangul-office');
const officeRoot = () => process.env.NARAE_OFFICE_ROOT || readJSON(path.join(process.env.CODEX_HOME||path.join(process.env.USERPROFILE||'.','.codex'),'skills/narae-hangul-office/runtime.json'),{}).officeRoot || path.join(process.env.LOCALAPPDATA||'.','Programs/NaraeHangulOffice');
const portalRoot = path.join(APP, 'packages/narae_gyomoo_portal/skills');
const cbeEntry = path.join(APP, 'packages/CBE_CLI/cli.mjs');
const wxsEntry = path.join(portalRoot, 'wxs-cli/scripts/wxs_cli.py');
const skillPaths = {
  overview: path.join(APP, 'skills/narae-gyomu/SKILL.md'),
  portal: path.join(portalRoot, 'narae-gyomu-work-portal/SKILL.md'),
  neis: path.join(portalRoot, 'narae-gyomu-neis/SKILL.md'),
  edufine: path.join(portalRoot, 'narae-gyomu-edufine/SKILL.md'),
  wxs: path.join(portalRoot, 'wxs-cli/SKILL.md'),
  hangul: path.join(hangulRoot, 'SKILL.md'),
  'hangul-jobs': path.join(hangulRoot, 'references/jobs.md'),
  cbe: path.join(APP, 'packages/CBE_CLI/skills/cbe-messenger/SKILL.md'),
};

export class Tools {
  constructor(models, {headed = true, subprocess = run} = {}) {
    this.models = models; this.headed = headed; this.subprocess = subprocess;
    this.browser = null; this.pending = new Map(); this.approvedFiles = new Map();
    this.people = new Map(); this.jobs = new Map();
    this.windows = new Set();
    this.viewers = new Set();
    this.python = path.resolve(HOME, readJSON(path.join(HOME, 'runtime.json')).python);
    this.pythonEnv={LOCALAPPDATA:path.join(DATA,'native/Local'),APPDATA:path.join(DATA,'native/Roaming')};
    this.captures=new WxsCapture({python:this.python,entry:wxsEntry,directory:path.join(DATA,'jobs/wxs-reads'),env:this.pythonEnv});
    this.attachmentReads=new Map();
  }
  register(files) {
    return files.map(file => {
      const absolute = path.resolve(file);
      const stat = fs.statSync(absolute);
      if (!stat.isFile()) throw new Fault('FILE_REQUIRED', '파일을 선택하세요: ' + absolute);
      const item = {path: absolute, name: path.basename(absolute), bytes: stat.size};
      this.approvedFiles.set(absolute.toLowerCase(), item); return item;
    });
  }
  input(file) {
    const absolute = path.resolve(file || '');
    if (!this.approvedFiles.has(absolute.toLowerCase()) &&
        !absolute.startsWith(OUTPUTS + path.sep))
      throw new Fault('FILE_NOT_ATTACHED', '이 파일은 첨부하거나 CLI --file로 먼저 지정하세요: ' + absolute);
    if (!fs.existsSync(absolute)) throw new Fault('FILE_MISSING', '파일이 없습니다: ' + absolute);
    return absolute;
  }
  async cbe(args, signal) {return this.subprocess(process.execPath, [cbeEntry, ...args, '--json'], {signal});}
  async wxs(args, signal) {return this.subprocess(this.python, ['-s', '-X', 'utf8', wxsEntry, ...args], {signal,env:this.pythonEnv});}
  async nativeJob(job, signal) {
    const id = crypto.randomUUID(), file = path.join(TMP, `hangul-${id}.json`), result = path.join(TMP, `hangul-${id}-result.json`);
    writeJSON(file, job);
    const response = await this.subprocess(this.python, ['-s','-X','utf8',path.join(hangulRoot,'scripts/narae.py'),
      'run', file, '--result', result], {signal, timeout:300000});
    if(response.success!==true)throw new Fault('HANGUL_PROTOCOL','나래 한글 오피스의 성공 JSON을 받지 못했습니다.',response);
    if(response.textDetailsLoaded===false)throw new Fault('NATIVE_READ_REQUIRED','변경 추적 문서는 나래 한글 오피스 live-read로 현재 한글 내용을 확인하세요.',response);
    if(job.action==='create'||job.action==='edit')return {...response,artifacts:{document:response.path},modeled_content_verified:response.modeledContentVerified};
    return response;
  }
  documentFiles(value) {
    if(!value || typeof value!=='object')return;
    for(const [key,item] of Object.entries(value)) {
      if(key==='path' && typeof item==='string')value[key]=this.input(item);
      else if(item && typeof item==='object')this.documentFiles(item);
    }
  }
  windowId(hwnd) {
    let id;try{id=BigInt(hwnd).toString();}catch{throw new Fault('WXS_WINDOW','windows에서 확인한 HWND를 지정하세요.');}
    if(!this.windows.has(id))throw new Fault('WXS_WINDOW_NOT_OBSERVED','먼저 wxs windows로 현재 창을 확인하세요.');
    return String(hwnd);
  }
  async browserCall(args) {
    if (!this.browser) {
      this.browser = new SchoolBrowser();
      try {await this.browser.start({headed: this.headed});}
      catch (e) {this.browser = null; throw e;}
    }
    return this.browser.execute(args);
  }
  pendingAction(kind, args, preview) {
    const id = crypto.randomUUID();
    const action = {id, kind, args: structuredClone(args), preview, status: 'prepared', created: new Date().toISOString()};
    this.pending.set(id, action);
    writeJSON(path.join(DATA, 'jobs', `pending-${id}.json`), action);
    return {pendingId: id, kind, preview, performed: false, message: '미리보기를 준비했습니다. 적용하려면 화면에서 확인하세요.'};
  }
  cbeSendArgs(a) {
    if (!['note','chat','group'].includes(a.kind)) throw new Fault('INVALID_KIND', '쪽지·대화 유형을 선택하세요.');
    if (!Array.isArray(a.recipient_ids) || !a.recipient_ids.length) throw new Fault('RECIPIENT_REQUIRED', '조회한 수신자 ID가 필요합니다.');
    for (const id of a.recipient_ids) if (!this.people.has(id)) throw new Fault('RECIPIENT_NOT_OBSERVED', '검색 결과에서 수신자를 먼저 확인하세요: ' + id);
    if (new Set(a.recipient_ids).size !== a.recipient_ids.length) throw new Fault('DUPLICATE_RECIPIENT', '수신자가 중복됐습니다.');
    const argv = [a.kind === 'note' ? 'notes' : 'chats', a.kind === 'group' ? 'create' : 'send', '--to', a.recipient_ids.join(',')];
    if (a.kind === 'chat' && a.recipient_ids.length !== 1) throw new Fault('SINGLE_RECIPIENT', '1:1 대화는 수신자 한 명을 지정하세요.');
    if (a.body) argv.push('--text', a.body);
    if (a.title) argv.push('--title', a.title);
    for (const file of a.files || []) argv.push('--file', this.input(file));
    if (!a.body && !a.files?.length) throw new Fault('EMPTY_MESSAGE', '본문이나 첨부파일이 필요합니다.');
    return argv;
  }
  async confirm(id, signal) {
    const action = this.pending.get(id);
    if (!action || action.status !== 'prepared') throw new Fault('ACTION_USED', '이 미리보기는 없거나 이미 처리됐습니다. 중복 실행하지 않습니다.');
    action.status = 'executing'; writeJSON(path.join(DATA,'jobs',`pending-${id}.json`),action);
    try {
      let result;
      if (action.kind === 'cbe') result = await this.cbe(this.cbeSendArgs(action.args), signal);
      else if (action.kind === 'wxs-draft') {
        if(await digest(action.args.file)!==action.args.configSha256)throw new Fault('PREVIEW_CHANGED','미리보기 이후 설정이 바뀌었습니다. 새로 준비하세요.');
        result = await this.wxs(['draft','--hwnd',action.args.hwnd,'--config',action.args.file,'--apply'],signal);
      }
      else if (action.kind === 'wxs-save') result = await this.wxs(['save-draft','--hwnd',action.args.hwnd,'--expected-title',action.args.expected_title,'--name',action.args.name,'--apply'],signal);
      if (action.kind === 'cbe' && (result.sent !== true || result.verified !== true))
        throw new Fault('SEND_NOT_VERIFIED', '전송 완료가 확인되지 않았습니다. 같은 메시지를 다시 보내지 마세요.', result);
      action.status = 'completed'; action.result = result;
      return {ok: true, kind: action.kind, result};
    } catch (e) {action.status = 'uncertain'; action.error = e.message; throw e;}
    finally {writeJSON(path.join(DATA,'jobs',`pending-${id}.json`),action);}
  }
  async call(name, a = {}, {signal} = {}) {
    if (signal?.aborted) throw new Fault('CANCELLED', '작업을 중단했습니다.');
    if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Fault('ARGUMENTS', '인자는 JSON 객체로 지정하세요.');
    switch (name) {
      case 'system.status': {
        let browser;
        try {browser = browserPath();} catch {browser = null;}
        return {models: this.models.status(), outputs: OUTPUTS, data: DATA,
          components: {browser: {installed: Boolean(browser), executable: browser, open: Boolean(this.browser)},
            hangul: {installed: fs.existsSync(this.python)&&fs.existsSync(path.join(officeRoot(),'src/cli.cjs')), engine: officeRoot(), requires:'한컴오피스 한글 + 나래 한글 오피스 설치.cmd'},
            cbe: {installed: fs.existsSync(cbeEntry), requires: '충북소통메신저 실행·로그인'},
            portal: {installed: fs.existsSync(wxsEntry), requires: '브라우저에서 직접 로그인'}},
          pending: [...this.pending.values()].filter(p => p.status === 'prepared').map(p => ({id: p.id,kind: p.kind,preview: p.preview}))};
      }
      case 'skill.read': {
        let file = skillPaths[a.area];
        if (!file) throw new Fault('UNKNOWN_SKILL', '공개 schema의 영역을 선택하세요.');
        if (a.document) {
          const root = path.dirname(file), candidate = path.resolve(root,a.document);
          if(!candidate.startsWith(root+path.sep) || !/\.(md|json)$/i.test(candidate)) throw new Fault('SKILL_PATH','선택한 스킬 안의 공개 참조문서를 지정하세요.');
          file=candidate;
        }
        const text = fs.readFileSync(file, 'utf8'), offset = Math.max(0, Number(a.offset || 0));
        return {area: a.area, text: text.slice(offset, offset + 5000), nextOffset: offset + 5000,
          hasMore: text.length > offset + 5000, totalChars: text.length};
      }
      case 'portal.open': {
        const config = readJSON(path.join(DATA, 'portal.json'), readJSON(path.join(portalRoot, 'narae-gyomu-work-portal/references/portal.json')));
        const url = config.portal_url;
        if (!/^https:\/\//.test(url)) throw new Fault('PORTAL_URL', '교육청 업무포털의 확인된 HTTPS 주소가 필요합니다.');
        if (this.browser) {
          const tabs = await this.browserCall({action:'tabs'}), host = new URL(url).hostname;
          const existing = tabs.tabs.find(t => {try {return new URL(t.url).hostname === host;} catch {return false;}});
          if (existing) return this.browserCall({action:'tab',index:existing.index});
        }
        return this.browserCall({action:'open',url});
      }
      case 'browser': return this.browserCall(a);
      case 'cbe.search': {
        const result = await this.cbe(['users','search',a.name,'--scope',a.scope || 'auto','--page',String(a.page || 1),'--limit','100'],signal);
        for (const person of result.items || []) this.people.set(person.id, person);
        return result;
      }
      case 'cbe.notes': {
        if (!['list','read'].includes(a.operation)) throw new Fault('OPERATION', 'list 또는 read를 지정하세요.');
        const args = ['notes',a.operation];
        if (a.operation === 'read') args.push(a.id,'--type',a.box === 'sent' ? 'S' : 'R');
        else {args.push('--box',a.box || 'received','--page',String(a.page || 1),'--limit',String(a.limit || 30)); if(a.search) args.push('--search',a.search,'--search-type','content');}
        return this.cbe(args,signal);
      }
      case 'cbe.chats': {
        if (!['list','read'].includes(a.operation)) throw new Fault('OPERATION', 'list 또는 read를 지정하세요.');
        const args = ['chats',a.operation];
        if(a.operation === 'read') args.push(a.id); else if(a.search) args.push('--search',a.search);
        args.push('--page',String(a.page || 1),'--limit',String(a.limit || 30));
        return this.cbe(args,signal);
      }
      case 'cbe.prepare': {
        const args = this.cbeSendArgs(a);
        const dry = await this.cbe([...args,'--dry-run'],signal);
        return this.pendingAction('cbe',a,{recipients:a.recipient_ids.map(id => this.people.get(id)),
          title:a.title || '',body:a.body,files:a.files || [],kind:a.kind,dryRun:dry});
      }
      case 'hangul.inspect': {
        const input = this.input(a.path);
        if (!/\.hwpx?$/i.test(input)) throw new Fault('HANGUL_FORMAT', 'HWP 또는 HWPX 파일을 선택하세요.');
        const full = await this.nativeJob({schema:1,action:'inspect',input},signal);
        const offset = Math.max(0, Number(a.offset || 0)), limit = Math.min(40, Math.max(1, Number(a.limit || 20)));
        const paragraphs = (full.paragraphs || []).slice(offset, offset + limit).map(p => ({id:p.id,text:p.text,editable_text:p.editable_text}));
        return {success:full.success,input:full.input,input_sha256:full.input_sha256,format:full.format,
          counts:full.counts,paragraphs,tables:(full.tables || []).slice(0,20),warnings:full.warnings,
          offset,nextOffset:offset+limit,hasMore:full.paragraphs.length>offset+limit,input_unchanged:full.input_unchanged};
      }
      case 'hangul.view': {
        const file=this.input(a.path);
        if(!/\.hwpx?$/i.test(file))throw new Fault('HANGUL_FORMAT','HWP 또는 HWPX 파일을 선택하세요.');
        return this.nativeJob({schema:1,action:'open',input:file},signal);
      }
      case 'hangul.create': {
        if (!a.body?.trim()) throw new Fault('EMPTY_BODY', '문서 본문이 비었습니다. 저장 전에 내용을 입력하세요.');
        const format = a.format || 'hwpx';
        if (!['hwp','hwpx'].includes(format)) throw new Fault('HANGUL_FORMAT','hwp 또는 hwpx를 선택하세요.');
        const output = outputPath(a.filename, '.' + format);
        if (!output.toLowerCase().endsWith('.'+format)) throw new Fault('FORMAT_EXTENSION', '파일 확장자와 형식을 맞추세요.');
        return this.nativeJob({schema:1,action:'create',format,output,blocks:[
          {type:'paragraph',text:a.title || '',text_style:{font:'맑은 고딕',size:16,bold:true},paragraph_style:{align:'CENTER'}},
          ...a.body.split(/\r?\n/).map(text => ({type:'paragraph',text,text_style:{font:'맑은 고딕',size:11}}))]},signal);
      }
      case 'hangul.edit': {
        const input = this.input(a.path), output = outputPath(a.filename);
        if (!Array.isArray(a.operations) || !a.operations.length) throw new Fault('EDIT_OPERATIONS','편집 작업을 지정하세요.');
        if(!a.expected_input_sha256)throw new Fault('HANGUL_HASH','직전 inspect의 input_sha256을 지정하세요.');
        return this.nativeJob({schema:1,action:'edit',input,output,expected_input_sha256:a.expected_input_sha256,operations:a.operations},signal);
      }
      case 'hangul.run': {
        const job = structuredClone(a.job);
        if (!job || !['inspect','create','edit'].includes(job.action)) throw new Fault('HANGUL_ACTION','inspect/create/edit 작업만 지원합니다.');
        if(job.input) job.input = this.input(job.input);
        if(job.overwrite_output || job.overwrite_source)throw new Fault('OVERWRITE_UNSUPPORTED','이 팩에서는 원본·기존 출력 덮어쓰기를 지원하지 않습니다.');
        if(job.action !== 'inspect') job.output = outputPath(job.output ? path.basename(job.output) : undefined, '.'+(job.format || 'hwpx'));
        if(job.preview) throw new Fault('PREVIEW_PATH','미리보기 파일은 뷰어에서 별도로 내보내세요.');
        this.documentFiles(job.blocks);this.documentFiles(job.operations);
        return this.nativeJob(job,signal);
      }
      case 'wxs': {
        if (!['doctor','windows','inspect','text','attachments','draft-status'].includes(a.operation)) throw new Fault('WXS_OPERATION','지원하는 WXS 조회 명령을 선택하세요.');
        const args = [a.operation]; if(a.hwnd) args.push('--hwnd',this.windowId(a.hwnd));
        if(!['doctor','windows'].includes(a.operation) && !a.hwnd) throw new Fault('WXS_WINDOW','windows로 확인한 HWND를 지정하세요.');
        const result=await this.wxs(args,signal);
        if(a.operation==='windows')for(const window of result.windows || [])this.windows.add(BigInt(window.hwnd).toString());
        return result;
      }
      case 'wxs.read': {
        if(a.operation==='prepare')return this.captures.prepare(a.expected_title,signal);
        if(a.operation==='open')return this.captures.prepare(a.expected_title,signal,this.windowId(a.hwnd));
        if(a.operation!=='result')throw new Fault('WXS_OPERATION','prepare, open 또는 result를 선택하세요.');
        const result=this.captures.result(a.id,a);
        for(const file of result.document?.attachments?.files||[])if(file.exported&&file.path)this.register([file.path]);
        return result;
      }
      case 'wxs.attachment': {
        const file=this.input(a.path),hash=await digest(file);let cached=this.attachmentReads.get(file);
        if(cached&&cached.hash!==hash)throw new Fault('ATTACHMENT_CHANGED','조회 중 첨부가 변경되었습니다. 원본과 새 작업을 확인하세요.');
        if(!cached){
          const directory=path.join(DATA,'jobs','attachment-'+crypto.randomUUID());
          try{await this.subprocess(this.python,['-s','-X','utf8',path.join(portalRoot,'wxs-cli/scripts/attachment_reader.py'),file,'--out-dir',directory],{signal,env:this.pythonEnv,timeout:300000});}catch(error){if(!fs.existsSync(path.join(directory,'result.json')))throw error;}
          cached={hash,result:readJSON(path.join(directory,'result.json'))};this.attachmentReads.set(file,cached);
        }
        const full=cached.result,offset=Math.max(0,Number(a.offset||0)),chars=Math.min(12000,Math.max(100,Number(a.chars||4000))),text=full.text||'';
        return {path:file,sha256:hash,status:full.status,reader:full.reader,text:text.slice(offset,offset+chars),offset,totalChars:text.length,nextOffset:offset+chars,hasMore:text.length>offset+chars,source_unchanged:full.source_unchanged,content_reviewed:false,needs_visual_review:full.needs_visual_review||false,visual_pages:full.visual_pages||[],warnings:full.warnings||[],...(full.error?{error:full.error}:{})};
      }
      case 'wxs.prepare': {
        this.windowId(a.hwnd);
        const config=structuredClone(a.config);
        if(config.body_file)config.body_file=this.input(config.body_file);
        if(config.attachments)config.attachments=config.attachments.map(file=>this.input(file));
        const file = path.join(TMP,`wxs-${crypto.randomUUID()}.json`); writeJSON(file,config);
        const plan = await this.wxs(['draft','--hwnd',a.hwnd,'--config',file],signal);
        return this.pendingAction('wxs-draft',{hwnd:a.hwnd,file,configSha256:await digest(file)},plan);
      }
      case 'wxs.save': {
        this.windowId(a.hwnd);
        const plan = await this.wxs(['save-draft','--hwnd',a.hwnd,'--expected-title',a.expected_title,'--name',a.name],signal);
        return this.pendingAction('wxs-save',a,plan);
      }
      case 'files.list': return {directory:OUTPUTS,files:fs.readdirSync(OUTPUTS).map(name => {
        const file=path.join(OUTPUTS,name),stat=fs.statSync(file);return {name,path:file,bytes:stat.size,modified:stat.mtime.toISOString()};
      }).filter(f => fs.statSync(f.path).isFile())};
      default: throw new Fault('UNKNOWN_TOOL', '공개 schema에 없는 도구입니다: ' + name);
    }
  }
  async close() {for(const child of this.viewers)child.kill();this.viewers.clear();await this.browser?.browser?.close(); this.browser = null;}
}
