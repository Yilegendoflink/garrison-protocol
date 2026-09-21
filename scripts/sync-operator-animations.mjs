import fs from 'node:fs/promises';
import path from 'node:path';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {ANIMATION_ROOT,sha256,readJson,writeJson,localPath,candidateBindings,validatePack,verifyFiles} from './operator-animation-db.mjs';
import {INSPECTOR,loadSpineInspector} from './inspect-operator-spine.mjs';

const args=process.argv.slice(2),offline=args.includes('--offline');
for(const arg of args)if(arg!=='--offline'&&!arg.startsWith('--snapshot='))throw Error('Unknown argument: '+arg);
const snapshot=args.find(a=>a.startsWith('--snapshot='))?.slice(11)||new Date().toISOString().slice(0,10)+'-operators';
if(!/^[\w-]+$/.test(snapshot))throw Error('Invalid snapshot');
const root=path.join(ANIMATION_ROOT,'prts',snapshot);
await fs.mkdir(root,{recursive:true});
let nextRequest=0;
async function request(url) {
  for(let attempt=0;attempt<4;attempt++) {
    await new Promise(r=>setTimeout(r,Math.max(0,nextRequest-Date.now())));nextRequest=Date.now()+100;
    try {
      const r=await fetch(url,{headers:{'User-Agent':'GarrisonProtocolAnimationDatabase/1.0 (PRTS local research)'},signal:AbortSignal.timeout(45000)});
      if(r.status===429||r.status>=500){await r.arrayBuffer();await new Promise(resolve=>setTimeout(resolve,Math.max(Number(r.headers.get('retry-after'))||0,2**attempt)*1000));continue;}
      if(!r.ok)throw Error('HTTP '+r.status+' '+url);return r;
    }catch(e){if(attempt===3)throw e;}
  }
  throw Error('Retries exhausted: '+url);
}
const inspect=await loadSpineInspector({offline,request});
let inventory;
try{inventory=await readJson(path.join(root,'inventory.json'));}catch(e){
  if(e.code!=='ENOENT'||offline)throw e;
  const operators=[...new Map(Object.values(NATIVE_DATA.profiles).map(p=>[p.charId,{id:p.charId,name:p.name}])).values()].sort((a,b)=>a.id.localeCompare(b.id));
  inventory={schemaVersion:1,startedAt:new Date().toISOString(),scope:'Current native runtime operators; default battle front/back only. No enemies, skins or base-building models.',runtimeSha256:sha256(await fs.readFile('dist/runtime-data.js')),gameSource:NATIVE_DATA.source,operators};
  await writeJson(path.join(root,'inventory.json'),inventory);
}
// A named snapshot is resumable and immutable at the source-file level.
async function cached(file,url) {
  const target=localPath(root,file),receipt=target+'.source.json';
  try {
    const [bytes,source]=await Promise.all([fs.readFile(target),readJson(receipt)]);
    if(source.url!==url||sha256(bytes)!==source.sha256)throw Error('Cache integrity mismatch: '+file);
    return {bytes,source};
  }catch(e){if(e.code!=='ENOENT'||offline)throw e;}
  const bytes=Buffer.from(await(await request(url)).arrayBuffer());
  const source={url,retrievedAt:new Date().toISOString(),sha256:sha256(bytes),bytes:bytes.length};
  await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target+'.tmp',bytes);await fs.rename(target+'.tmp',target);await writeJson(receipt,source);
  return {bytes,source};
}
function sourceUrl(base,file) {
  const url=new URL(file,base),prefix=new URL(base);
  if(url.protocol!=='https:'||!['torappu.prts.wiki','static.prts.wiki'].includes(url.hostname)||url.origin!==prefix.origin||!url.pathname.startsWith(prefix.pathname))throw Error('Invalid PRTS asset URL: '+url);
  return url.href;
}
function pngDimensions(bytes) {
  if(bytes.length<24||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Texture is not PNG');
  return {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
}
const operators=[],failures=[];
for(const [i,entry] of inventory.operators.entries()) {
  try {
    if(!/^char_[\w]+$/.test(entry.id))throw Error('Invalid PRTS operator ID');
    const metaUrl='https://torappu.prts.wiki/assets/char_spine/'+entry.id+'/meta.json';
    const metaFile='sources/'+entry.id+'.json',meta=await cached(metaFile,metaUrl),config=JSON.parse(meta.bytes.toString('utf8'));
    const defaults=config.skin?.['默认'];if(!defaults)throw Error('Missing default skin');
    const op={...entry,gameId:entry.id,source:{wiki:'https://prts.wiki/w/'+encodeURIComponent(entry.name),metadata:{file:metaFile,...meta.source}},models:{}};
    for(const [label,view] of Object.entries(defaults)) {
      const direction=label.includes('正面')||label==='战斗'?'front':label.includes('背面')?'back':null;if(!direction)continue;
      if(op.models[direction])throw Error('Duplicate model view: '+direction);
      const prefix=config.prefix.replace('https://static.prts.wiki/spine/','https://static.prts.wiki/spine38/');
      const base=sourceUrl(prefix,view.file),folder='assets/'+entry.id+'/'+direction+'/';
      const atlas=await cached(folder+'model.atlas',base+'.atlas'),skeleton=await cached(folder+'model.skel',base+'.skel');
      const text=atlas.bytes.toString('utf8'),pages=text.trim().split(/\r?\n\s*\r?\n/).map(block=>block.split(/\r?\n/)[0].trim());
      const textures=[],dimensions={};
      for(const page of pages) {
        localPath('.',page);if(!page.endsWith('.png'))throw Error('Unsupported texture: '+page);
        const file=folder+page,texture=await cached(file,sourceUrl(base.slice(0,base.lastIndexOf('/')+1),page)),size=pngDimensions(texture.bytes);
        dimensions[page]=size;textures.push({file,...texture.source,...size});
      }
      const parsed=inspect(skeleton.bytes,text,dimensions);
      op.models[direction]={format:'spine',sourceLabel:label,sourceConfig:view,skeleton:{file:folder+'model.skel',...skeleton.source},atlas:{file:folder+'model.atlas',...atlas.source},textures,...parsed,bindings:candidateBindings(parsed.animations),visualVerified:false};
    }
    if(!op.models.front)throw Error('No default battle front model');
    operators.push(op);
    console.log('Operator animations '+(i+1)+'/'+inventory.operators.length+': '+entry.name);
  }catch(e){failures.push({id:entry.id,name:entry.name,error:e.message});console.error(entry.name+': '+e.message);}
}
await writeJson(path.join(root,'acquisition-report.json'),{requested:inventory.operators.length,collected:operators.length,failures});
if(failures.length)throw Error('Incomplete snapshot; latest NOT updated. Resume with --snapshot='+snapshot);
const pack={schemaVersion:1,id:'prts:alliance-lower-operators',provider:'prts',snapshot,scope:inventory.scope,inspector:INSPECTOR,operators};
const errors=validatePack(pack);if(errors.length)throw Error(errors.join('\n'));
const verified=await verifyFiles(pack,root);if(verified.errors.length)throw Error(verified.errors.join('\n'));
await writeJson(path.join(root,'database.json'),pack);
const models=operators.flatMap(o=>Object.values(o.models));
const manifest={schemaVersion:1,snapshot,operators:operators.length,models:models.length,animations:models.reduce((n,m)=>n+m.animations.length,0),assetFiles:verified.files,visualVerified:0,files:{}};
async function collect(dir,relative='') {
  for(const entry of (await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
    const file=relative+entry.name;if(entry.isDirectory())await collect(path.join(dir,entry.name),file+'/');
    else if(file!=='manifest.json'&&!file.endsWith('.tmp'))manifest.files[file]=sha256(await fs.readFile(path.join(dir,entry.name)));
  }
}
await collect(root);await writeJson(path.join(root,'manifest.json'),manifest);
await writeJson(path.join(ANIMATION_ROOT,'prts/latest.json'),{snapshot,path:snapshot+'/database.json'});
console.log(JSON.stringify({...manifest,files:Object.keys(manifest.files).length}));
