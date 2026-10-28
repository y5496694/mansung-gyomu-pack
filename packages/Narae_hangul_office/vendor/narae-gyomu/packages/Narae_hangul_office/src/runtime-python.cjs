const fs=require('node:fs'),path=require('node:path');
function resolvePython(root){return process.env.NARAE_OFFICE_PYTHON||[path.join(root,'runtime/python/python.exe'),path.join(root,'.venv/Scripts/python.exe')].find(file=>fs.existsSync(file))||path.join(root,'runtime/python/python.exe');}
function pythonEnvironment(home,extra={}){const env={...process.env};for(const key of Object.keys(env))if(/^PYTHON(HOME|PATH|USERBASE|STARTUP)$/i.test(key))delete env[key];return {...env,PYTHONNOUSERSITE:'1',PYTHONUTF8:'1',NARAE_OFFICE_HOME:home,TEMP:path.join(home,'cache'),TMP:path.join(home,'cache'),...extra};}
module.exports={resolvePython,pythonEnvironment};
