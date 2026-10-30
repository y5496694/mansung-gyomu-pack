const path=require('node:path');
const documents=new Set(['.hwp','.hwpx']);
const images=new Set(['.png','.jpg','.jpeg','.gif','.webp','.bmp']);
function isDocument(file){return typeof file==='string'&&documents.has(path.extname(file).toLowerCase());}
function assertDocument(file){if(!isDocument(file))throw new Error('나래 오피스는 한글 HWP/HWPX 문서만 지원합니다.');return file;}
function isReference(file){return isDocument(file)||images.has(path.extname(file).toLowerCase())||['.txt','.md'].includes(path.extname(file).toLowerCase());}
function assertReference(file){if(!isReference(file))throw new Error('한글 HWP/HWPX와 한글 작업에 사용할 그림·텍스트 자료만 선택할 수 있습니다.');return file;}
const supportedTool=name=>!/^word_|^excel_/.test(name);
module.exports={isDocument,assertDocument,isReference,assertReference,supportedTool};
