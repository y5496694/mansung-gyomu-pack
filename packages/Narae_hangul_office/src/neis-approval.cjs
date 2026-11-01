'use strict';
function approvalRoute(screen){
 const routes=[];
 for(const t of screen?.tableData||[]){if(t.hasMore)continue;const name=t.headers.findIndex(h=>/^(성명|이름|결재자|담당자)$/.test(h.replace(/\s/g,''))),role=t.headers.findIndex(h=>/^(결재구분|처리구분|결재유형|역할|구분)$/.test(h.replace(/\s/g,'')));if(name<0||role<0)continue;const rows=t.rows.map(r=>({name:r[name]?.trim(),role:r[role]?.trim()}));if(rows.length&&rows.every(r=>r.name&&/검토|협조|결재|전결|기안/.test(r.role))&&rows.some(r=>/결재|전결/.test(r.role)))routes.push(rows);}
 return routes.length===1?routes[0]:null;
}
module.exports={approvalRoute};
