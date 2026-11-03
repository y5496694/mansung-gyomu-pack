'use strict';
class TalkNotifications{
 constructor({Notification,enabled,focused,open,icon}){Object.assign(this,{Notification,enabled,focused,open,icon});this.active=new Set();}
 show(id,title,body){if(!this.enabled()||this.focused(id)||!this.Notification.isSupported())return false;const notification=new this.Notification({title,body:String(body).slice(0,160),icon:this.icon,silent:false});this.active.add(notification);notification.on('click',()=>this.open(id));notification.on('close',()=>this.active.delete(notification));notification.show();return true;}
 clear(){for(const item of this.active)item.close();this.active.clear();}
}
module.exports={TalkNotifications};
