'use strict';
class TalkShell{
 constructor({window,app,Tray,Menu,icon,settings}){Object.assign(this,{window,settings});this.tray=new Tray(icon);this.tray.setToolTip('나래톡');this.tray.setContextMenu(Menu.buildFromTemplate([{label:'나래톡 열기',click:()=>this.show()},{type:'separator'},{label:'나래톡 종료',click:()=>app.quit()}]));this.tray.on('double-click',()=>this.show());window.on('close',event=>{if(!this.quitting&&settings().closeToTray){event.preventDefault();window.hide();}});}
 show(){if(this.window.isMinimized())this.window.restore();this.window.show();this.window.focus();}
 configure(value){return {closeToTray:value.closeToTray!==false,hangulShortcut:'',agentShortcut:''};}
 state(){return {mode:'full',warning:'',shortcuts:[]};}
 dispose(){this.quitting=true;this.tray.destroy();}
}
module.exports={TalkShell};
