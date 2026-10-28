const value={ok:true,data:{text:'한글·한국어🙂'.repeat(20000)}};
const bytes=Buffer.from(JSON.stringify(value)),cut=Buffer.byteLength('{"ok":true,"data":{"text":"')+1;
process.stdout.write(bytes.subarray(0,cut));setTimeout(()=>process.stdout.write(bytes.subarray(cut)),20);
