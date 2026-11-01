import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import ultari from './ultari.mjs';
import ucware from './ucware.mjs';

export const families={'ultari-atmessenger7':ultari,'ucware-delphi':ucware};
const quote=name=>'"'+name.replaceAll('"','""')+'"';
export function definition(family,kind){const result=families[family]?.stores[kind];if(!result)throw Error('이 제품에서 확인되지 않은 저장소 종류입니다: '+kind);return result;}
export function openStore(file,family,kind){
  const spec=definition(family,kind),real=fs.realpathSync(file),stat=fs.statSync(real);
  if(!stat.isFile())throw Error('실제 로컬 DB 파일을 지정하세요.');
  const fd=fs.openSync(real,'r');let header;
  try{header=Buffer.alloc(16);fs.readSync(fd,header,0,16,0);}finally{fs.closeSync(fd);}
  if(!header.equals(Buffer.from('SQLite format 3\0')))throw Error('표준 SQLite 캐시가 아닙니다. 암호화·독자 형식은 해독 지원으로 표시하지 않습니다.');
  const db=new DatabaseSync(real,{readOnly:true,allowExtension:false});
  try{
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=1500; BEGIN;');
    const table=db.prepare('SELECT name FROM sqlite_master WHERE type=? AND name=?').get('table',spec.table);
    if(!table)throw Error('선택 제품의 실제 테이블이 없습니다: '+spec.table);
    const columns=db.prepare('PRAGMA table_info('+quote(spec.table)+')').all().map(row=>row.name);
    const required=[...new Set([spec.owner,spec.id,spec.date,...Object.values(spec.fields),...spec.search])];
    if(required.some(column=>!columns.includes(column)))throw Error('설치물 분석과 다른 캐시 스키마입니다. 지원하지 않는 필드를 추측하지 않습니다.');
    return {db,spec,real,columns,close(){db.close();}};
  }catch(error){db.close();throw error;}
}
export function accounts(file,family,kind){const s=openStore(file,family,kind);try{return s.db.prepare('SELECT '+quote(s.spec.owner)+' AS owner, COUNT(*) AS cachedRecords FROM '+quote(s.spec.table)+' GROUP BY '+quote(s.spec.owner)+' ORDER BY '+quote(s.spec.owner)+' LIMIT 101').all();}finally{s.close();}}
export function verifyOwner(store,owner){if(typeof owner!=='string'||!owner.trim()||owner.length>256)throw Error('실제 캐시의 정확한 --owner 값이 필요합니다.');if(!store.db.prepare('SELECT 1 FROM '+quote(store.spec.table)+' WHERE '+quote(store.spec.owner)+'=? LIMIT 1').get(owner))throw Error('지정 계정의 캐시 기록이 없습니다. 다른 계정으로 대체하지 않습니다.');}
function content(value,maxLength){
  if(value===null||value===undefined)return null;
  if(typeof value==='string')return {format:'stored-text',text:value.slice(0,maxLength),truncated:value.length>maxLength};
  if(value instanceof Uint8Array){const bytes=Buffer.from(value);const base={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
    try{const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))return {...base,format:'utf-8',text:text.slice(0,maxLength),truncated:text.length>maxLength};}catch{}
    return {...base,format:'opaque-binary',text:null};
  }
  throw Error('확인되지 않은 본문 자료형입니다.');
}
export function queryStore(file,family,kind,{owner,query='',id,roomId,limit=30,offset=0}={}){
  if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0||offset>100000)throw Error('limit 1~100, offset 0~100000 범위를 사용하세요.');
  if(typeof query!=='string'||query.length>1000)throw Error('검색어는 1000자 이내입니다.');
  const s=openStore(file,family,kind);try{
    verifyOwner(s,owner);const {spec,db}=s;
    const where=[quote(spec.owner)+'=?'],values=[owner];
    if(id!==undefined){where.push(quote(spec.id)+'=?');values.push(String(id));}
    if(roomId!==undefined){if(!spec.fields.roomId)throw Error('이 저장소는 대화방별 행 조회를 지원하지 않습니다.');where.push(quote(spec.fields.roomId)+'=?');values.push(String(roomId));}
    if(query){where.push('('+spec.search.map(name=>quote(name)+" LIKE ? ESCAPE '\\'").join(' OR ')+')');const term='%'+query.replace(/[\\%_]/g,c=>'\\'+c)+'%';values.push(...spec.search.map(()=>term));}
    const select=Object.entries(spec.fields).map(([alias,name])=>quote(name)+' AS '+quote(alias)).join(',');
    const sql='SELECT '+select+' FROM '+quote(spec.table)+' WHERE '+where.join(' AND ')+' ORDER BY '+quote(spec.date)+' DESC, '+quote(spec.id)+' DESC LIMIT ? OFFSET ?';
    const raw=db.prepare(sql).all(...values,limit+1,offset),more=raw.length>limit;
    if(id!==undefined&&raw.length>1)throw Error('같은 계정·키로 여러 기록이 있습니다. 단일 쪽지로 확정하지 않습니다.');
    const records=raw.slice(0,limit).map(row=>{const value={...row};if('content'in value)value.content=content(value.content,id===undefined?1000:65536);if('attachments'in value)value.attachments={format:'native-metadata',storedValue:value.attachments,downloadSupported:false};return value;});
    return {family,kind,owner,source:'local-cache',serverSynchronized:false,marksRead:false,database:s.real,records,nextOffset:more?offset+limit:null};
  }finally{s.close();}
}
