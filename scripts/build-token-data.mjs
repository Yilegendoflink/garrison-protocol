import fs from 'node:fs/promises';
const runtime=JSON.parse((await fs.readFile('dist/runtime-data.js','utf8')).match(/export const NATIVE_DATA = ([\s\S]+);\s*$/)[1]);
const base=JSON.parse(await fs.readFile('data/normalized/allianceLower.json','utf8'));
runtime.tokens=Object.fromEntries(Object.entries(base.entities).filter(([,entity])=>entity?.kind==='summon'));
const output='// Generated historical mode runtime data.\nexport const NATIVE_DATA = '+JSON.stringify(runtime)+';\n';
let last;for(let attempt=0;attempt<4;attempt++){try{await fs.writeFile('dist/runtime-data.js',output);last=null;break;}catch(error){last=error;if(!['EBUSY','EPERM','UNKNOWN'].includes(error.code))throw error;await new Promise(resolve=>setTimeout(resolve,100*(attempt+1)));}}if(last)throw last;
console.log('Native token runtime: '+Object.keys(runtime.tokens).length+' entities');
