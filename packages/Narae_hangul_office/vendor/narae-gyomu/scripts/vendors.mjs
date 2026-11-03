import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {APP,readJSON} from '../src/paths.mjs';
let count=0;
for(const source of readJSON(path.join(APP,'sources.lock.json')).sources) {
  const root=path.join(APP,'packages',source.name);
  for(const [name,expected] of Object.entries(source.files)) {
    const actual=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex');
    if(actual!==expected)throw new Error('Upstream snapshot changed: '+source.name+'/'+name);
    count++;
  }
}
console.log(JSON.stringify({verified:true,sources:4,files:count}));
