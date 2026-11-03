const {app,BrowserWindow,ipcMain,dialog,shell}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const ROOT=app.getAppPath();
const HOME=process.env.NARAE_GYOMU_HOME || (app.isPackaged?path.dirname(app.getPath('exe')):ROOT);
const DATA=process.env.NARAE_GYOMU_DATA || 'D:/Codex/narae-gyomu-data';
for(const part of ['ui','tmp','logs','crashes'])fs.mkdirSync(path.join(DATA,part),{recursive:true});
app.setPath('userData',path.join(DATA,'ui'));app.setPath('temp',path.join(DATA,'tmp'));
app.setPath('logs',path.join(DATA,'logs'));app.setPath('crashDumps',path.join(DATA,'crashes'));
app.commandLine.appendSwitch('disk-cache-dir',path.join(DATA,'ui/cache'));
app.setName('나래교무');
let window,origin,token,owned=false;
const stateFile=path.join(DATA,'daemon.json');
const readState=()=>{try{return JSON.parse(fs.readFileSync(stateFile,'utf8'));}catch{return {};}};
async function api(route,data){
  const response=await fetch(origin+'/api/'+route,{method:data===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
  const json=await response.json();if(!json.ok)throw new Error(json.error?.message || '연결 실패');return json.data;
}
async function start(){
  let state=readState();origin='http://127.0.0.1:'+state.port;token=state.token;
  try{const status=await api('status');if(status.pid===state.pid){if((status.home || state.home)!==HOME)throw new Error('다른 설치 폴더의 나래교무 실행기를 먼저 종료하세요.');return;}}catch(e){if(e.message.includes('다른 설치'))throw e;}
  const log=fs.openSync(path.join(DATA,'logs/backend.log'),'a');
  const child=spawn(process.execPath,[path.join(ROOT,'src/server.mjs')],{windowsHide:true,detached:false,stdio:['ignore',log,log],env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NARAE_GYOMU_HOME:HOME,NARAE_GYOMU_DATA:DATA,TEMP:path.join(DATA,'tmp'),TMP:path.join(DATA,'tmp')}});
  fs.closeSync(log);owned=true;
  for(let i=0;i<200;i++){
    await new Promise(r=>setTimeout(r,100));state=readState();origin='http://127.0.0.1:'+state.port;token=state.token;
    try{if((await api('status')).pid===child.pid)return;}catch{}
    if(child.exitCode!==null)break;
  }
  throw new Error('실행기를 시작하지 못했습니다. '+path.join(DATA,'logs/backend.log'));
}
const lock=app.requestSingleInstanceLock();
if(!lock)app.quit();else{
  app.on('second-instance',()=>{window?.show();window?.focus();});
  app.whenReady().then(async()=>{
    try{
      await start();
      ipcMain.handle('app-info',()=>({name:app.getName(),version:app.getVersion(),electron:process.versions.electron,packaged:app.isPackaged,userData:app.getPath('userData')}));
      ipcMain.handle('choose-files',async()=>{const result=await dialog.showOpenDialog(window,{title:'업무에 사용할 파일 선택',properties:['openFile','multiSelections']});return result.canceled?[]:result.filePaths;});
      ipcMain.handle('open-output',async(_event,file)=>{
        const files=await api('tools/call',{tool:'files.list',args:{}});
        if(!files.files.some(f=>path.resolve(f.path)===path.resolve(file)) || !/\.(hwpx?|pdf|png|txt)$/i.test(file))throw new Error('작성 파일 목록에서 선택하세요.');
        return shell.openPath(file);
      });
      window=new BrowserWindow({width:1260,height:860,minWidth:940,minHeight:660,title:'나래교무',backgroundColor:'#f6f4f8',show:process.env.NARAE_GYOMU_TEST_HIDDEN!=='1',
        autoHideMenuBar:true,webPreferences:{preload:path.join(ROOT,'desktop/preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
      window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==origin)event.preventDefault();});
      await window.loadURL(origin+'/#'+token);
    }catch(e){dialog.showErrorBox('나래교무 실행 오류',e.message);app.quit();}
  });
  app.on('window-all-closed',async()=>{if(owned)try{await api('shutdown',{});}catch{}app.quit();});
}
