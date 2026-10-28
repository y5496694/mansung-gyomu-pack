const {spawn}=require('node:child_process'),path=require('node:path');
function runPython(python,home,script,input,signal){return new Promise((resolve,reject)=>{
 const child=spawn(python,[path.join(__dirname,script)],{windowsHide:true,env:require('./runtime-python.cjs').pythonEnvironment(home,{QT_QPA_PLATFORM:'offscreen'}),stdio:['pipe','pipe','pipe']});let output='',stderr='',settled=false;
 const abort=()=>child.kill(),timer=setTimeout(abort,180000);signal?.addEventListener('abort',abort,{once:true});
 child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
 child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>stderr=(stderr+chunk).slice(-4000));
 const done=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(result);};
 child.on('error',error=>done(error));child.on('close',()=>{try{const result=JSON.parse(output);if(!result.ok)throw new Error(result.error);done(null,result.data);}catch(error){done(new Error(output?error.message:stderr||'문서 실행기가 종료되었습니다. 상태를 다시 확인하세요.'));}});child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(input));
 });}
module.exports={runPython};
