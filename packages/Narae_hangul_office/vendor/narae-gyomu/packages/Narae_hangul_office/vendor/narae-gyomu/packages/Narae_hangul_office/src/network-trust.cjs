// Match the user's existing OS trust store while retaining TLS verification.
const tls=require('node:tls');let configured=false;
function useSystemTrust(){
 if(configured)return true;
 if(typeof tls.getCACertificates!=='function'||typeof tls.setDefaultCACertificates!=='function')return false;
 tls.setDefaultCACertificates([...new Set([...tls.getCACertificates('default'),...tls.getCACertificates('system')])]);configured=true;return true;
}
module.exports={useSystemTrust};
