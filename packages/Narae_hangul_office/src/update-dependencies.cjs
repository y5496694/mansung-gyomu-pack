'use strict';
const fs=require('node:fs');
function dependencyPlan(file){const value=JSON.parse(fs.readFileSync(file,'utf8'));delete value.version;if(value.packages?.[''])delete value.packages[''].version;return JSON.stringify(value);}
module.exports={dependencyPlan};
if(require.main===module)process.stdout.write(dependencyPlan(process.argv[2]));
