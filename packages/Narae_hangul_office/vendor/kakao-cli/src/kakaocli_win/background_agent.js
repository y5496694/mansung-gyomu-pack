// Transient, process-local virtual input. No global keyboard/mouse injection.
if(Process.pointerSize!==8)throw Error('The background runtime supports the REA-verified x64 KakaoTalk build only');
const user = Process.getModuleByName('user32.dll');
const callbacks = [];
const api = (name, result, args) => new NativeFunction(user.getExportByName(name), result, args);
const enumWindows = api('EnumWindows','int',['pointer','pointer']);
const enumChildren = api('EnumChildWindows','int',['pointer','pointer','pointer']);
const getTextLength = api('GetWindowTextLengthW','int',['pointer']);
const getText = api('GetWindowTextW','int',['pointer','pointer','int']);
const getClass = api('GetClassNameW','int',['pointer','pointer','int']);
const getId = api('GetDlgCtrlID','int',['pointer']);
const getWindowPid = api('GetWindowThreadProcessId','uint',['pointer','pointer']);
const getOwner = api('GetWindow','pointer',['pointer','uint']);
const isWindow = api('IsWindow','int',['pointer']);
const isEnabled = api('IsWindowEnabled','int',['pointer']);
const isVisible = api('IsWindowVisible','int',['pointer']);
const post = api('PostMessageW','int',['pointer','uint','pointer','pointer']);
const setText = api('SetWindowTextW','int',['pointer','pointer']);
const sendMessage = api('SendMessageW','pointer',['pointer','uint','pointer','pointer']);
const getForeground = api('GetForegroundWindow','pointer',[]);
const setPosition = api('SetWindowPos','int',['pointer','pointer','int','int','int','int','uint']);
const showWindow = api('ShowWindow','int',['pointer','int']);
const clipboardSeq = api('GetClipboardSequenceNumber','uint32',[]);
const originalForeground = getForeground();
const sleep = ms => new Promise(resolve=>setTimeout(resolve, ms));
const text = hwnd => { const length = getTextLength(hwnd); if (length < 0 || length > 1000000) throw Error('Control text exceeds read limit'); const buf=Memory.alloc((length+2)*2); getText(hwnd,buf,length+2); return buf.readUtf16String(); };
const className = hwnd => { const buf=Memory.alloc(1024); getClass(hwnd,buf,512); return buf.readUtf16String(); };
function controlText(hwnd) {const length=sendMessage(hwnd,0xE,ptr(0),ptr(0)).toInt32();if(length<0||length>1000000)throw Error('Control text read limit');const buf=Memory.alloc((length+2)*2);sendMessage(hwnd,0xD,ptr(length+2),buf);return buf.readUtf16String();}
function richText(hwnd) {
  const lengthInfo=Memory.alloc(8);lengthInfo.writeU32(2);lengthInfo.add(4).writeU32(1200);
  const length=sendMessage(hwnd,0x45f,lengthInfo,ptr(0)).toInt32();
  if(length<0||length>1000000)throw Error('RichEdit text exceeds read limit');
  const buffer=Memory.alloc((length+2)*2),info=Memory.alloc(32);info.writeU32((length+2)*2);info.add(4).writeU32(0);info.add(8).writeU32(1200);info.add(16).writePointer(ptr(0));info.add(24).writePointer(ptr(0));
  const copied=sendMessage(hwnd,0x45e,info,buffer).toInt32();
  if(copied<0||copied>length)throw Error('RichEdit text readback failed');
  return buffer.readUtf16String(copied);
}
function inProcess(h) {const pid=Memory.alloc(4);getWindowPid(h,pid);return pid.readU32()===Process.id;}
function windows(parent=null) { const items=[]; const cb=new NativeCallback(h=>{if(inProcess(h))items.push(h);return 1;},'int',['pointer','pointer']); if(parent)enumChildren(parent,cb,ptr(0));else enumWindows(cb,ptr(0)); return items; }
function unique(items, label) { if(items.length!==1)throw Error(label+': expected one match, found '+items.length); return items[0]; }
function byPrefix(parent, prefix) { return unique(windows(parent).filter(h=>text(h).startsWith(prefix)),prefix); }
function input(parent) { return unique(windows(parent).filter(h=>getId(h)===1006 && /RICHEDIT/i.test(className(h))),'Message input'); }
function transcript(parent) { return unique(windows(parent).filter(h=>getId(h)===100 && className(h)==='EVA_VH_ListControl_Dblclk'),'Transcript'); }
function rooms(name) { return windows().filter(h=>className(h)==='EVA_Window_Dblclk' && text(h)===name && windows(h).some(c=>getId(c)===1006 && /RICHEDIT/i.test(className(c)))); }
function viewers(name) { const prefix=name+' '; return windows().filter(h=>text(h).startsWith(prefix) && /^\d{4}-\d{2}-\d{2}$/.test(text(h).slice(prefix.length))); }
function scopeOwner(h) { const seen=new Set(); while(!h.isNull()&&!seen.has(String(h))) { seen.add(String(h)); if(scoped.has(String(h)))return true;h=getOwner(h,4); } return false; }
function dialogs() { return windows().filter(h=>className(h)==='#32770' && scopeOwner(h)); }
let virtualRoot=ptr(config.root||0), virtualFocus=ptr(config.target||config.root||0), ctrl=false, active=true;
const scoped=new Set([String(virtualRoot),...(config.scoped||[])]);
const created=new Map();
const initialWindows=new Set(windows().map(String));
const windowStyle=api('GetWindowLongW','long',['pointer','int']);
function newlyOwned(h) {
  if(created.has(String(h)))return true;
  if(!initialWindows.has(String(h))&&inProcess(h)&&!(windowStyle(h,-16)&0x40000000)) {
    created.set(String(h),{h,x:100,y:100});scoped.add(String(h));return true;
  }
  return false;
}
let saveRequest=null,saveRequestError=null;
let attachmentPreview=null,filePickerError=null;
const replacedAddresses=new Set();
function replaceAddress(addr, ret, args, handler, alias=false) {
  if(replacedAddresses.has(String(addr)))return;
  const original=new NativeFunction(addr,ret,args);
  const cb=new NativeCallback((...v)=>handler(original,...v),ret,args);
  try {Interceptor.replace(addr,cb);} catch(error) {
    // Frida follows forwarding jumps: a win32u export can already be covered
    // by its user32 wrapper even when the exported addresses differ.
    if(alias&&error.message.includes('already replaced'))return;
    throw Error('Background hook '+DebugSymbol.fromAddress(addr)+': '+error.message);
  }
  callbacks.push(cb);replacedAddresses.add(String(addr));
}
function replace(name, ret, args, handler) {replaceAddress(user.getExportByName(name),ret,args,handler);}
for(const name of ['GetKeyState','GetAsyncKeyState'])replace(name,'int16',['int'],(orig,vk)=>active&&[0x10,0x11,0x12,0xa0,0xa1,0xa2,0xa3,0xa4,0xa5].includes(vk)?(ctrl&&[0x11,0xa2,0xa3].includes(vk)?-32768:0):orig(vk));
replace('GetForegroundWindow','pointer',[],orig=>active?virtualRoot:orig());
replace('GetActiveWindow','pointer',[],orig=>active?virtualRoot:orig());
replace('GetFocus','pointer',[],orig=>active?virtualFocus:orig());
replace('SetForegroundWindow','int',['pointer'],(orig,h)=>active?0:orig(h));
replace('BringWindowToTop','int',['pointer'],(orig,h)=>active?0:orig(h));
replace('SetActiveWindow','pointer',['pointer'],(orig,h)=>active?ptr(0):orig(h));
replace('SetFocus','pointer',['pointer'],(orig,h)=>active?virtualFocus:orig(h));
replace('ShowWindow','int',['pointer','int'],(orig,h,n)=>{
  newlyOwned(h);
  if(active&&scoped.has(String(h))&&!created.has(String(h)))return isVisible(h);
  if(active&&created.has(String(h))) { setPosition(h,ptr(1),-32000,-32000,0,0,0x11);return orig(h,n===0?0:4); }
  return orig(h,n);
});
replace('SetWindowPos','int',['pointer','pointer','int','int','int','int','uint'],(orig,h,z,x,y,w,ht,flags)=>{
  newlyOwned(h);
  if(active&&created.has(String(h)))return orig(h,ptr(1),-32000,-32000,w,ht,(flags|0x10)&~2);
  if(active&&scoped.has(String(h)))return orig(h,z,x,y,w,ht,flags|0x14);
  return orig(h,z,x,y,w,ht,flags);
});
// Common-dialog internals may call win32u directly rather than the exported
// user32 wrappers. Cover the final show/position boundary for new owned windows.
const win32u=Process.findModuleByName('win32u.dll');
if(win32u) {
  for(const name of ['NtUserShowWindow','NtUserSetWindowPos']) {
    const address=win32u.findExportByName(name);if(!address)continue;
    if(name==='NtUserShowWindow') {
      replaceAddress(address,'int',['pointer','int'],(orig,h,n)=>{if(active&&newlyOwned(h)){setPosition(h,ptr(1),-32000,-32000,0,0,0x11);return orig(h,n===0?0:4);}if(active&&scoped.has(String(h)))return isVisible(h);return orig(h,n);},true);
    } else {
      const args=['pointer','pointer','int','int','int','int','uint'];
      replaceAddress(address,'int',args,(orig,h,z,x,y,w,ht,f)=>active&&newlyOwned(h)?orig(h,ptr(1),-32000,-32000,w,ht,(f|0x10)&~2):orig(h,z,x,y,w,ht,active&&scoped.has(String(h))?f|0x14:f),true);
    }
  }
}
Interceptor.attach(user.getExportByName('CreateWindowExW'),{
  onEnter(args) { this.owned=active && !(args[3].toUInt32()&0x40000000); if(this.owned) {this.x=args[4].toInt32();this.y=args[5].toInt32();args[0]=ptr(args[0].toUInt32()|0x08000000);args[3]=ptr(args[3].toUInt32()&~0x10000000);args[4]=ptr(-32000);args[5]=ptr(-32000);} },
  onLeave(h) {if(this.owned&&!h.isNull()){created.set(String(h),{h,x:this.x,y:this.y});scoped.add(String(h));setPosition(h,ptr(1),-32000,-32000,0,0,0x11);}}
});
// REA observed GetSaveFileNameW in this executable's PE imports. Supply the
// chosen destination at that API boundary, so no Save As window is created.
if(config.op==='download') {
  const comdlg=Process.getModuleByName('comdlg32.dll');
  const address=comdlg.getExportByName('GetSaveFileNameW');
  const original=new NativeFunction(address,'int',['pointer']);
  const callback=new NativeCallback(ofn=>{
    if(!active)return original(ofn);
    const owner=ofn.add(8).readPointer();
    if(!scopeOwner(owner))return 0;
    const buffer=ofn.add(48).readPointer(),capacity=ofn.add(56).readU32();
    const originalFilename=buffer.isNull()?'':buffer.readUtf16String();
    let filename=config.filename||originalFilename.split(/[\\/]/).pop()||'attachment';
    const defaultExtension=ofn.add(104).readPointer();
    if(!filename.includes('.')&&!defaultExtension.isNull())filename+='.'+defaultExtension.readUtf16String();
    if(/[\\/:*?"<>|\x00-\x1f]/.test(filename)||filename==='.'||filename==='..'){saveRequestError='Invalid attachment filename';return 0;}
    const destination=config.destination||(config.output_directory?.replace(/[\\/]$/,'')+'\\'+filename);
    if(!destination||buffer.isNull()||destination.length+1>capacity)return 0;
    const attributes=new NativeFunction(Process.getModuleByName('kernel32.dll').getExportByName('GetFileAttributesW'),'uint32',['pointer']);
    if(attributes(Memory.allocUtf16String(destination))!==0xffffffff){saveRequestError='Destination file already exists; no overwrite performed';return 0;}
    buffer.writeUtf16String(destination);
    const slash=Math.max(destination.lastIndexOf('\\'),destination.lastIndexOf('/'));
    const dot=destination.lastIndexOf('.');
    ofn.add(100).writeU16(slash+1);
    ofn.add(102).writeU16(dot>slash?dot+1:0);
    const titleBuffer=ofn.add(64).readPointer(),titleCapacity=ofn.add(72).readU32();
    const basename=destination.slice(slash+1);
    if(!titleBuffer.isNull()&&basename.length+1<=titleCapacity)titleBuffer.writeUtf16String(basename);
    saveRequest={saved_path_requested:true,path:destination,original_filename:originalFilename,dialog_bypassed:true};
    return 1;
  },'int',['pointer']);
  callbacks.push(callback);Interceptor.replace(address,callback);
}
if(config.op==='attachment-send'&&config.kind==='file') {
  const address=Process.getModuleByName('comdlg32.dll').getExportByName('GetOpenFileNameW');
  replaceAddress(address,'int',['pointer'],(original,ofn)=>{
    if(!active)return original(ofn);
    if(!ofn.add(8).readPointer().equals(ptr(config.root))){filePickerError='File picker owner does not match the chat';return 0;}
    const buffer=ofn.add(48).readPointer(),capacity=ofn.add(56).readU32(),path=config.source_path;
    if(!path||buffer.isNull()||path.length+1>capacity){filePickerError='Attachment path exceeds file picker capacity';return 0;}
    buffer.writeUtf16String(path);
    const slash=Math.max(path.lastIndexOf('\\'),path.lastIndexOf('/')),dot=path.lastIndexOf('.');
    ofn.add(100).writeU16(slash+1);ofn.add(102).writeU16(dot>slash?dot+1:0);
    return 1;
  });
}
async function key(h,vk,control=false) {virtualFocus=h;ctrl=control;post(h,0x100,ptr(vk),ptr(1));post(h,0x101,ptr(vk),ptr('0xc0000001'));await sleep(100);ctrl=false;}
function point(h,message,x,y) {const packed=((y&0xffff)<<16)|(x&0xffff);post(h,message,ptr(message===0x201||message===0x203?1:0),ptr(packed>>>0));}
async function openRoom() {
  const found=rooms(config.room); if(found.length) {const h=unique(found,'Exact room title');scoped.add(String(h));return h;}
  const main=unique(windows().filter(h=>className(h)==='EVA_Window_Dblclk'&&['카카오톡','KakaoTalk'].includes(text(h))),'KakaoTalk main window');
  scoped.add(String(main));virtualRoot=main;virtualFocus=main;
  if(!isEnabled(main)||dialogs().length)throw Error('A modal popup blocks KakaoTalk; complete it first');
  const chatView=byPrefix(main,'ChatRoomListView_');
  const list=byPrefix(chatView,'ChatRoomListCtrl_');
  virtualFocus=list;
  const edit=unique(windows(chatView).filter(h=>className(h)==='Edit'&&getId(h)===100),'Chat search edit');
  const previous=text(edit);
  try {
    setText(edit,Memory.allocUtf16String(config.room));await sleep(350);
    const results=byPrefix(chatView,'SearchListCtrl_');
    await key(edit,0x0d);
    for(let i=0;i<15;i++){const matches=rooms(config.room);if(matches.length)return unique(matches,'Exact opened room');await sleep(100);}
    throw Error('Search did not open a chat with the exact requested title');
  } finally {setText(edit,Memory.allocUtf16String(previous));}
}
async function copy(room) {virtualRoot=room;virtualFocus=transcript(room);if(!isEnabled(room)||dialogs().length)throw Error('A modal popup blocks the chat');const seq=clipboardSeq();await key(virtualFocus,65,true);await key(virtualFocus,67,true);for(let i=0;i<15;i++){if(clipboardSeq()!==seq)return {hwnd:String(room),clipboard_sequence:clipboardSeq()};await sleep(50);}throw Error('Background copy did not update clipboard');}
async function saveDialog(dialog) {
  const edit=unique(windows(dialog).filter(h=>className(h)==='Edit'&&[1001,1148].includes(getId(h))),'Save filename');
  const original=controlText(edit), destination=config.destination;
  if(!destination)return {dialog:String(dialog),original_filename:original};
  const button=unique(windows(dialog).filter(h=>getId(h)===1&&className(h)==='Button'&&/저장|save/i.test(text(h))),'Save button');
  sendMessage(edit,0xC,ptr(0),Memory.allocUtf16String(destination));await sleep(120);
  if(controlText(edit)!==destination)throw Error('Save filename readback failed: '+JSON.stringify(controlText(edit)));
  post(button,0xF5,ptr(0),ptr(0));
  for(let i=0;i<config.timeout*10-10;i++){if(!isWindow(dialog))return {saved:true,path:destination,original_filename:original};await sleep(100);}
  throw Error('Save dialog did not close before deadline');
}
async function run() {
  if(config.op==='search-probe') {
    const main=unique(windows().filter(h=>className(h)==='EVA_Window_Dblclk'&&['카카오톡','KakaoTalk'].includes(text(h))),'main');
    scoped.add(String(main));virtualRoot=main;
    const view=byPrefix(main,'ChatRoomListView_');
    const edit=unique(windows(view).filter(h=>className(h)==='Edit'&&getId(h)===100),'Search edit');
    const previous=controlText(edit);setText(edit,Memory.allocUtf16String(config.query??config.room));await sleep(300);
    return {main:String(main),previous_search:previous,search:controlText(edit),controls:windows(view).map(h=>({hwnd:String(h),class_name:className(h),id:getId(h),text:text(h),visible:!!isVisible(h)}))};
  }
  if(config.op==='open-selected') {
    const main=unique(windows().filter(h=>className(h)==='EVA_Window_Dblclk'&&['카카오톡','KakaoTalk'].includes(text(h))),'main');scoped.add(String(main));virtualRoot=main;
    const view=byPrefix(main,'ChatRoomListView_'),list=byPrefix(view,'SearchListCtrl_');
    const edit=unique(windows(view).filter(h=>className(h)==='Edit'&&getId(h)===100),'Search edit');
    if(controlText(edit)!==config.query)throw Error('Search changed after verification; no row opened');
    const rect=Memory.alloc(16),mainRect=Memory.alloc(16);api('GetWindowRect','int',['pointer','pointer'])(list,rect);api('GetWindowRect','int',['pointer','pointer'])(main,mainRect);
    const x=config.point[0]+mainRect.readS32()-rect.readS32(),y=config.point[1]+mainRect.add(4).readS32()-rect.add(4).readS32();virtualFocus=list;
    if(x<0||y<0||x>=rect.add(8).readS32()-rect.readS32()||y>=rect.add(12).readS32()-rect.add(4).readS32())throw Error('Search row point is outside result list');
    point(list,0x201,x,y);point(list,0x202,x,y);point(list,0x203,x,y);point(list,0x202,x,y);
    for(let i=0;i<20;i++){const found=rooms(config.expected_title);if(found.length)return {hwnd:String(unique(found,'Verified room title')),title:config.expected_title};await sleep(100);}
    throw Error('Opened title did not match the OCR-verified result; no message sent');
  }
  if(config.op==='save-dialog'){const pending=unique(dialogs(),'Owned save dialog');return saveDialog(pending);}
  const room=await openRoom();virtualRoot=room;scoped.add(String(room));
  if(text(room)!==config.room)throw Error('Room title verification failed');
  if(config.op==='open')return {hwnd:String(room),title:text(room)};
  if(config.op==='read')return copy(room);
  if(config.op==='attachment-send') {
    if(!isEnabled(room)||dialogs().length)throw Error('A modal popup blocks the chat');
    if(windows().some(h=>className(h)==='EVA_Window_Dblclk'&&getOwner(h,4).equals(room)&&isVisible(h)))throw Error('An existing chat popup must be completed first');
    const edit=input(room);virtualFocus=edit;
    const draft=richText(edit);
    if(config.kind==='image') {
      if(clipboardSeq()!==config.clipboard_sequence||!api('IsClipboardFormatAvailable','int',['uint'])(8))throw Error('Image clipboard changed before attachment paste');
    }
    if(config.kind==='file') {
      point(room,0x201,config.file_button[0],config.file_button[1]);point(room,0x202,config.file_button[0],config.file_button[1]);
    }
    else {ctrl=true;sendMessage(edit,0x100,ptr(86),ptr(1));sendMessage(edit,0x101,ptr(86),ptr('0xc0000001'));ctrl=false;}
    await sleep(500);
    if(filePickerError)throw Error(filePickerError);
    if(richText(edit)!==draft)throw Error('Draft changed after paste; no confirmation submitted');
    attachmentPreview=unique(windows().filter(h=>!initialWindows.has(String(h))&&className(h)==='EVA_Window_Dblclk'&&getOwner(h,4).equals(room)),'New attachment preview');
    const decisionPromise=new Promise(resolve=>recv('attachment-decision',message=>resolve(message.payload)));
    send({event:'attachment-preview',preview:String(attachmentPreview),room_hwnd:String(room),pid:Process.id});
    const decision=await decisionPromise;
    if(decision.error)throw Error(decision.error);
    if(!isWindow(attachmentPreview)||!inProcess(attachmentPreview)||!getOwner(attachmentPreview,4).equals(room)||className(attachmentPreview)!=='EVA_Window_Dblclk')throw Error('Attachment preview owner changed');
    virtualRoot=attachmentPreview;scoped.add(String(attachmentPreview));
    if(!decision?.verified||text(room)!==config.room||richText(edit)!==draft)throw Error('Attachment target or draft changed before confirmation');
    const rect=Memory.alloc(16);api('GetWindowRect','int',['pointer','pointer'])(attachmentPreview,rect);
    if(decision.width!==rect.add(8).readS32()-rect.readS32()||decision.height!==rect.add(12).readS32()-rect.add(4).readS32())throw Error('Attachment preview geometry changed');
    if(config.preview_only)return {prepared:true,room:text(room),kind:config.kind,preview_path:decision.preview_path};
    if(!isVisible(attachmentPreview)||!decision.point?.every(Number.isFinite)||decision.point[0]<0||decision.point[0]>=decision.width||decision.point[1]<decision.height*.65||decision.point[1]>=decision.height)throw Error('Attachment send button is outside the verified preview');
    virtualFocus=attachmentPreview;
    point(attachmentPreview,0x201,decision.point[0],decision.point[1]);point(attachmentPreview,0x202,decision.point[0],decision.point[1]);
    for(let i=0;i<30;i++) {
      if(!isWindow(attachmentPreview)||!isVisible(attachmentPreview))return {submitted:true,delivery_confirmed:false,status:'submitted_unconfirmed',room:text(room),kind:config.kind,preview_path:decision.preview_path};
      await sleep(100);
    }
    throw Error('Attachment confirmation did not close; delivery unknown, do not retry automatically');
  }
  if(config.op==='scroll') {
    const keys={up:0x21,down:0x22,top:0x24,bottom:0x23};
    if(!(config.direction in keys))throw Error('Invalid scroll direction');
    if(!isEnabled(room)||dialogs().length)throw Error('A modal popup blocks the chat');
    await key(transcript(room),keys[config.direction],['top','bottom'].includes(config.direction));
    await sleep(200);return {hwnd:String(room),direction:config.direction};
  }
  if(config.op==='send') {
    if(!isEnabled(room)||dialogs().length)throw Error('A modal popup blocks the chat');
    const edit=input(room);virtualFocus=edit;
    if(text(edit))throw Error('기존 초안이 있어 전송하지 않았습니다.');
    if(!config.message?.trim())throw Error('Empty message');
    setText(edit,Memory.allocUtf16String(config.message));
    if(text(edit).replace(/\r\n?/g,'\n')!==config.message.replace(/\r\n?/g,'\n'))throw Error('Input readback failed; no Enter sent');
    if(text(room)!==config.room)throw Error('Room title changed; no Enter sent');
    await key(edit,13);await sleep(200);
    if(text(edit))throw Error('Input remains after Enter; delivery unknown, do not retry automatically');
    return {hwnd:String(room),submitted:true,delivery_confirmed:false};
  }
  if(config.op==='download') {
    let pending=dialogs();if(pending.length)return saveDialog(unique(pending,'Owned save dialog'));
    let viewer;
    if(config.point) {
      const list=transcript(room);virtualFocus=list;
      const rect=Memory.alloc(16);api('GetWindowRect','int',['pointer','pointer'])(list,rect);
      const roomRect=Memory.alloc(16);api('GetWindowRect','int',['pointer','pointer'])(room,roomRect);
      const x=config.point[0]+roomRect.readS32()-rect.readS32(),y=config.point[1]+roomRect.add(4).readS32()-rect.add(4).readS32();
      if(x<0||y<0||x>=rect.add(8).readS32()-rect.readS32()||y>=rect.add(12).readS32()-rect.add(4).readS32())throw Error('Attachment point is outside transcript');
      point(list,0x201,x,y);point(list,0x202,x,y);
      if(config.kind!=='file'){point(list,0x203,x,y);point(list,0x202,x,y);}
      await sleep(350);
      if(saveRequest)return saveRequest;
      if(saveRequestError)throw Error(saveRequestError);
      if(config.kind==='file')throw Error('No file Save action was triggered at the selected point');
    }
    viewer=unique(viewers(config.room),'Photo viewer');scoped.add(String(viewer));virtualRoot=viewer;virtualFocus=viewer;
    await key(viewer,0x53,true);
    for(let i=0;i<50;i++){if(saveRequest)return saveRequest;if(saveRequestError)throw Error(saveRequestError);pending=dialogs();if(pending.length)throw Error('Unexpected save dialog: background boundary was not intercepted');await sleep(100);}
    throw Error('Attachment save dialog did not appear');
  }
  throw Error('Unsupported background operation');
}
run().then(result=>finish(true,result)).catch(error=>finish(false,null,error.message));
async function finish(ok,result,error) {
  const restore=[];
  if(attachmentPreview&&isWindow(attachmentPreview)) {
    const rect=Memory.alloc(16);api('GetClientRect','int',['pointer','pointer'])(attachmentPreview,rect);
    point(attachmentPreview,0x201,rect.add(8).readS32()-15,14);point(attachmentPreview,0x202,rect.add(8).readS32()-15,14);
    await sleep(200);
  }
  for(const {h,x,y} of created.values()) {
    if(!isWindow(h))continue;
    if(attachmentPreview?.equals(h))continue;
    const cls=className(h);
    if(cls==='#32770'||viewers(config.room).some(v=>v.equals(h)))post(h,0x10,ptr(0),ptr(0));
    else {showWindow(h,0);restore.push({h,x,y});}
  }
  await sleep(100);active=false;
  for(const {h,x,y} of restore)if(isWindow(h))setPosition(h,ptr(1),x===-2147483648?100:x,y===-2147483648?100:y,0,0,0x15);
  const foreground_unchanged=originalForeground.equals(getForeground());
  send({event:'done',ok,result:result?{...result,background:true,foreground_unchanged}:undefined,error});
}
