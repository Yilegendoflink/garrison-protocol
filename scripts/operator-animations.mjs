import fs from 'node:fs/promises';
import path from 'node:path';
import {ANIMATION_ROOT,readJson,sha256,localPath,validatePack,verifyFiles} from './operator-animation-db.mjs';

const args=process.argv.slice(2),[command='stats',query]=args.filter(a=>!a.startsWith('--'));
for(const a of args.filter(a=>a.startsWith('--')))if(!a.startsWith('--pack='))throw Error('Unknown argument: '+a);
const packArg=args.find(a=>a.startsWith('--pack='))?.slice(7);
let file;
if(packArg)file=path.resolve(packArg);
else {
  const latest=await readJson(path.join(ANIMATION_ROOT,'prts/latest.json'));
  if(!/^[\w-]+$/.test(latest.snapshot))throw Error('Invalid latest snapshot');
  file=localPath(path.join(ANIMATION_ROOT,'prts'),latest.snapshot+'/database.json');
}
const root=path.dirname(file),pack=await readJson(file),schemaErrors=validatePack(pack);
if(schemaErrors.length)throw Error(schemaErrors.join('\n'));
if(command==='validate') {
  const result=await verifyFiles(pack,root);
  if(pack.provider==='prts') {
    const manifest=await readJson(path.join(root,'manifest.json'));
    if(!manifest.files?.['database.json']||!manifest.files?.['inventory.json'])result.errors.push('Incomplete manifest');
    for(const [name,hash] of Object.entries(manifest.files||{})) {
      try{if(sha256(await fs.readFile(localPath(root,name)))!==hash)result.errors.push('Manifest hash mismatch: '+name);}
      catch(e){result.errors.push(name+': '+e.message);}
    }
    const inventory=await readJson(path.join(root,'inventory.json'));
    if(inventory.operators.length!==pack.operators.length||inventory.operators.some(o=>!pack.operators.some(p=>p.id===o.id)))result.errors.push('Inventory coverage mismatch');
    if(pack.operators.some(o=>!o.id.startsWith('char_')))result.errors.push('Non-operator in PRTS pack');
  }
  console.log(JSON.stringify({valid:!result.errors.length,pack:pack.id,operators:pack.operators.length,...result},null,2));
  if(result.errors.length)process.exitCode=1;
} else if(command==='stats') {
  const models=pack.operators.flatMap(o=>Object.values(o.models));
  const bindings=models.flatMap(m=>Object.values(m.bindings.states).concat(...Object.values(m.bindings.skills).map(Object.values)));
  console.log(JSON.stringify({pack:pack.id,snapshot:pack.snapshot||null,operators:pack.operators.length,models:models.length,animations:models.reduce((n,m)=>n+m.animations.length,0),versions:[...new Set(models.map(m=>m.spineVersion).filter(Boolean))],candidateBindings:bindings.filter(b=>b.status==='candidate').length,confirmedBindings:bindings.filter(b=>b.status==='confirmed').length,visualVerified:models.filter(m=>m.visualVerified).length},null,2));
} else if(command==='show'||command==='search') {
  if(!query)throw Error('Missing operator name/id');
  const rows=pack.operators.filter(o=>[o.id,o.name].some(v=>command==='show'?v===query:v.toLowerCase().includes(query.toLowerCase())));
  if(command==='show'&&rows.length!==1)throw Error('Expected one match; found '+rows.length);
  console.log(JSON.stringify(command==='show'?rows[0]:rows.map(o=>({id:o.id,name:o.name,views:Object.keys(o.models)})),null,2));
} else throw Error('Commands: stats, search NAME, show ID, validate; optional --pack=path/database.json');
