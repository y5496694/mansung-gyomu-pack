// ULTARI AtMessenger7. Names recovered from the installed GOE/GBeeTALK builds.
export default {
  family:'ultari-atmessenger7',
  stores:{
    notes:{table:'tblMessage',owner:'sOwnerId',id:'sMsgId',date:'sDate',
      fields:{id:'sMsgId',owner:'sOwnerId',senderId:'sSenderId',sender:'sSenderName',date:'sDate',subject:'sSubject',content:'sContent',attachments:'sAttach',recipients:'sReceivers',readFlag:'cRead',direction:'cIsSend'},search:['sSubject','sContent','sSenderName']},
    chats:{table:'tblChatRoomInfo',owner:'sOwnerId',id:'sRoomId',date:'sLastTalkDate',
      fields:{id:'sRoomId',owner:'sOwnerId',subject:'sRoomName',date:'sLastTalkDate',participants:'sUserNames',preview:'sLastTalkContent'},search:['sRoomName','sUserNames','sLastTalkContent']},
    chatMessages:{table:'tblChatContent',owner:'sOwnerId',id:'sChatId',date:'sTalkDate',
      fields:{id:'sChatId',roomId:'sRoomId',owner:'sOwnerId',senderId:'sTalkerId',sender:'sTalkerName',date:'sTalkDate',content:'sTalkerContent'},search:['sTalkerName','sTalkerContent']}
  },
  databaseNames:['@Talk.db','Recover.db'],
  limitations:['Local cached records only; server synchronization is not established.','Roster and transmission protocols have not been verified.']
};
