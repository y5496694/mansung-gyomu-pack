'use strict';
const fs=require('node:fs'),path=require('node:path');
const appId='Inhow.NaraeHangulOffice';
function apply({app,window,shell,root,executable=process.execPath,platform=process.platform}){
 if(platform!=='win32')return {updated:0};
 const icon=path.join(root,'ui/assets/narae-office.ico');
 app.setAppUserModelId(appId);window.setIcon(icon);window.setAppDetails({appId,appIconPath:icon,appIconIndex:0,relaunchCommand:'"'+executable+'" "'+root+'"',relaunchDisplayName:'나래 한글 오피스'});
 const folders=[app.getPath('desktop'),path.join(app.getPath('appData'),'Microsoft/Windows/Start Menu/Programs'),path.join(app.getPath('appData'),'Microsoft/Internet Explorer/Quick Launch/User Pinned/TaskBar')];let updated=0;
 for(const folder of folders){if(!fs.existsSync(folder))continue;for(const name of fs.readdirSync(folder).filter(name=>name.toLowerCase().endsWith('.lnk'))){const file=path.join(folder,name);try{const link=shell.readShortcutLink(file),args=link.args?.trim();if(path.resolve(link.target).toLowerCase()!==path.resolve(executable).toLowerCase()||![root,'"'+root+'"'].includes(args))continue;if(shell.writeShortcutLink(file,'update',{icon,iconIndex:0,appUserModelId:appId,description:'나래 한글 오피스 · 나래한글 엔진 기반'}))updated++;}catch{}}}
 return {appId,icon,updated};
}
module.exports={apply,appId};
