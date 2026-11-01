// UCWARE Delphi clients. This is deliberately independent of CBE and ULTARI.
export default {
  family:'ucware-delphi',
  stores:{
    notes:{table:'tbl_message',owner:'msg_owner_id',id:'msg_key',date:'msg_send_date',
      fields:{id:'msg_key',owner:'msg_owner_id',senderId:'msg_send_id',sender:'msg_send_name',date:'msg_send_date',subject:'msg_subject',searchText:'msg_srh_content',content:'msg_content',attachments:'msg_file_list',recipients:'msg_recv_name',readDate:'msg_read_date',direction:'msg_kind'},search:['msg_subject','msg_srh_content','msg_send_name']},
    chats:{table:'tbl_chat',owner:'chat_owner_id',id:'chat_key',date:'chat_end_date',
      fields:{id:'chat_key',roomId:'room_key',owner:'chat_owner_id',subject:'chat_subject',date:'chat_end_date',participants:'chat_entry_names',content:'chat_content'},search:['chat_subject','chat_entry_names','chat_content']},
    contacts:{table:'tbl_users',owner:'user_owner_id',id:'user_id',date:'user_name',
      fields:{id:'user_id',owner:'user_owner_id',name:'user_name',department:'user_company_dept',company:'user_company',officePhone:'user_tel_office',email:'user_email'},search:['user_name','user_company_dept','user_company']}
  },
  databaseNames:['msg_data.db','msg_data_user.db','chat_data.db','chat_data_user.db','user_data.db','chat_room.db'],
  limitations:['Local cached records only; server synchronization is not established.','Binary rich-text payloads remain opaque unless their text encoding is identified.','Authenticated live search and transmission have not been verified.']
};
