import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {readTemplates,selectBattleTemplates,operatorRecord,enemyRecord,summarize,rangeRecord} from './prts-parser.mjs';
const ROOT=path.resolve('data/prts');
const args=process.argv.slice(2),offline=args.includes('--offline');
const snapshotArg=args.find(x=>x.startsWith('--snapshot='))?.slice(11);
const snapshot=snapshotArg||new Date().toISOString().replace(/[:.]/g,'-');
if(!/^[\w-]+$/.test(snapshot))throw Error('Invalid snapshot name');
const dir=path.join(ROOT,'snapshots',snapshot),sourceDir=path.join(dir,'source');await fs.mkdir(sourceDir,{recursive:true});
const json=async(p,v)=>{const temp=p+'.tmp';await fs.writeFile(temp,JSON.stringify(v,null,2)+'\n');await fs.rename(temp,p);};
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
const categories=['干员','专属干员','敌人','召唤物'];
let nextRequest=0;
async function api(params){
 const url='https://prts.wiki/api.php?'+new URLSearchParams({format:'json',formatversion:'2',maxlag:'5',...params});
 for(let attempt=0;attempt<5;attempt++){
  await new Promise(r=>setTimeout(r,Math.max(0,nextRequest-Date.now())));nextRequest=Date.now()+600;
  try{const r=await fetch(url,{headers:{'User-Agent':'GarrisonProtocolDatabase/0.1 (PRTS read-only; local research)'},signal:AbortSignal.timeout(45000)});
   if(r.status===429||r.status>=500){nextRequest=Date.now()+Math.max(Number(r.headers.get('retry-after'))||0,2**attempt)*1000;continue;}
   if(!r.ok)throw Error('HTTP '+r.status);const j=await r.json();if(j.error){if(['maxlag','ratelimited'].includes(j.error.code)){nextRequest=Date.now()+2**attempt*1000;continue;}throw Error(JSON.stringify(j.error));}return j;
  }catch(error){if(attempt===4)throw error;nextRequest=Date.now()+2**attempt*1000;}
 }
 throw Error('PRTS request retries exhausted');
}
let inventory;
try{inventory=JSON.parse(await fs.readFile(path.join(dir,'inventory.json'),'utf8'));}catch(error){if(error.code!=='ENOENT'||offline)throw error;
 const entries=new Map(),counts={},startedAt=new Date().toISOString();
 for(const category of categories){let continuation={},seen=new Set();do{const data=await api({action:'query',list:'categorymembers',cmtitle:'分类:'+category,cmnamespace:'0',cmlimit:'500',...continuation});for(const p of data.query.categorymembers){seen.add(p.pageid);const e=entries.get(p.pageid)||{...p,categories:[]};e.categories.push(category);entries.set(p.pageid,e);}continuation=data.continue;}while(continuation);counts[category]=seen.size;console.log(category+': '+seen.size);}
 inventory={startedAt,catalogCompletedAt:new Date().toISOString(),counts,pages:[...entries.values()].sort((a,b)=>a.pageid-b.pageid)};await json(path.join(dir,'inventory.json'),inventory);
}
const known=new Set((await fs.readdir(sourceDir)).filter(p=>p.endsWith('.json')).map(p=>Number(p.slice(0,-5))));
const refreshCategory=args.find(x=>x.startsWith('--refresh-category='))?.slice(19);
const pending=inventory.pages.filter(p=>!known.has(p.pageid)||(refreshCategory&&p.categories.includes(refreshCategory)));if(offline&&pending.length)throw Error('Offline snapshot is incomplete: '+pending.length+' pages');
for(let i=0;i<pending.length;i+=25){const batch=pending.slice(i,i+25);const data=await api({action:'query',pageids:batch.map(p=>p.pageid).join('|'),prop:'revisions',rvslots:'main',rvprop:'ids|timestamp|content'});const received=new Set();
 for(const page of data.query.pages){const revision=page.revisions?.[0];if(!revision||typeof revision.slots?.main?.content!=='string')throw Error('Missing readable revision: '+page.title);const content=revision.slots.main.content,parsed=readTemplates(content);if(parsed.unbalanced)console.log('Template warning: '+page.title);
  const record={pageid:page.pageid,title:page.title,categories:batch.find(p=>p.pageid===page.pageid).categories,revisionId:revision.revid,revisionAt:revision.timestamp,retrievedAt:new Date().toISOString(),contentHash:hash(content),templateNames:parsed.templates.map(t=>t.name),unbalanced:parsed.unbalanced,templates:selectBattleTemplates(parsed.templates)};
  await json(path.join(sourceDir,page.pageid+'.json'),record);received.add(page.pageid);
 }
 if(batch.some(p=>!received.has(p.pageid)))throw Error('API omitted a requested page');
 console.log('Pages '+Math.min(i+25,pending.length)+'/'+pending.length+' (cached '+known.size+')');
}
const pages=await Promise.all(inventory.pages.map(p=>fs.readFile(path.join(sourceDir,p.pageid+'.json'),'utf8').then(JSON.parse)));
const operators=pages.filter(p=>p.categories.includes('干员')||p.categories.includes('专属干员')).map(operatorRecord);
const enemies=pages.filter(p=>p.categories.includes('敌人')).map(enemyRecord);
const summons=pages.filter(p=>p.categories.includes('召唤物')).map(p=>({id:'prts:summon:'+p.pageid,name:p.title,pageId:p.pageid,revisionId:p.revisionId,sourceFile:'source/'+p.pageid+'.json',sourceUrl:'https://prts.wiki/index.php?oldid='+p.revisionId,ownerNames:p.templates.find(t=>t.name==='召唤物信息')?.fields['持有者']||null,simulationReady:false,templates:p.templates}));
let rangeSources;
try{rangeSources=JSON.parse(await fs.readFile(path.join(dir,'range-sources.json'),'utf8'));}catch(error){if(error.code!=='ENOENT'||offline)throw error;
 const index=[];let continuation={};do{const data=await api({action:'query',list:'allpages',apnamespace:'274',apprefix:'Range/',aplimit:'500',...continuation});index.push(...data.query.allpages);continuation=data.continue;}while(continuation);
 rangeSources=[];for(let i=0;i<index.length;i+=25){const data=await api({action:'query',pageids:index.slice(i,i+25).map(p=>p.pageid).join('|'),prop:'revisions',rvslots:'main',rvprop:'ids|timestamp|content'});for(const p of data.query.pages){const r=p.revisions?.[0];if(!r)throw Error('Missing range revision: '+p.title);rangeSources.push({pageid:p.pageid,title:p.title,revisionId:r.revid,revisionAt:r.timestamp,content:r.slots.main.content});}}
 await json(path.join(dir,'range-sources.json'),rangeSources);console.log('Range definitions '+rangeSources.length);
}
const ranges=rangeSources.map(rangeRecord);await json(path.join(dir,'ranges.json'),ranges);
const report=summarize(operators,enemies,summons,inventory);report.collected.ranges=ranges.length;report.issues.unresolved.rangeDisplayGeometry=ranges.filter(r=>!r.displayCells).map(r=>r.id);
const rangeIds=new Set(ranges.map(r=>r.id));report.issues.unresolved.operatorRangeReferences=operators.flatMap(o=>o.phases.filter(p=>p.rangeId&&!rangeIds.has(p.rangeId)).map(p=>({operator:o.id,phase:p.phase,rangeId:p.rangeId})));
await json(path.join(dir,'operators.json'),operators);await json(path.join(dir,'enemies.json'),enemies);await json(path.join(dir,'summons.json'),summons);await json(path.join(dir,'coverage.json'),report);
const manifest={schemaVersion:1,snapshot,source:'PRTS MediaWiki API',sourceBase:'https://prts.wiki',acquisitionStart:inventory.startedAt,acquisitionEnd:pages.map(p=>p.retrievedAt).sort().at(-1),builtAt:new Date().toISOString(),catalogCounts:inventory.counts,counts:report.collected,scope:'Current PRTS catalog; not a historical game-version snapshot',licenseReference:'https://prts.wiki/w/PRTS:关于',files:{},sourceFiles:{}};
for(const file of ['inventory.json','operators.json','enemies.json','summons.json','coverage.json','ranges.json','range-sources.json'])manifest.files[file]=hash(await fs.readFile(path.join(dir,file)));
for(const p of pages)manifest.sourceFiles['source/'+p.pageid+'.json']=hash(await fs.readFile(path.join(sourceDir,p.pageid+'.json')));
await json(path.join(dir,'manifest.json'),manifest);await json(path.join(ROOT,'latest.json'),{snapshot,path:'snapshots/'+snapshot});console.log(JSON.stringify(report.collected));console.log('Snapshot: '+dir);
