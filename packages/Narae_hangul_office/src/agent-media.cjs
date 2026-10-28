const fs=require('node:fs');
const MAX_IMAGE_BYTES=10*1024*1024;
function identifyImage(bytes){
 if(!bytes.length||bytes.length>MAX_IMAGE_BYTES)throw new Error('이미지는 10MB 이하의 파일을 선택하세요.');
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if(['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString()))return 'image/gif';
 if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return 'image/webp';
 throw new Error('지원되는 실제 이미지 형식은 PNG, JPEG, GIF, WebP입니다.');
}
function readImage(file){const bytes=fs.readFileSync(file);return {mimeType:identifyImage(bytes),base64:bytes.toString('base64')};}
function imageContent(image){
 const bytes=Buffer.from(image.base64,'base64'),mimeType=identifyImage(bytes);
 if(image.mimeType!==mimeType)throw new Error('이미지 데이터와 형식이 일치하지 않습니다.');
 return {type:'input_image',image_url:`data:${mimeType};base64,${bytes.toString('base64')}`,detail:'auto'};
}
module.exports={identifyImage,readImage,imageContent,MAX_IMAGE_BYTES};
