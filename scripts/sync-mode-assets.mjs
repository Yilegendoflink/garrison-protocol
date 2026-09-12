import {collectModeEnemies} from './mode-enemy-ids.mjs';
import fs from 'node:fs/promises';import crypto from 'node:crypto';
const source=JSON.parse(await fs.readFile('data/modes/alliance-lower/source.json','utf8')),base=JSON.parse(await fs.readFile('data/normalized/allianceLower.json','utf8'));
const root='dist/assets/prts';await fs.mkdir(root,{recursive:true});
const requested=new Map();const add=(id,title,kind)=>requested.set(id,{id,title:'File:'+title,kind});
for(const s of Object.values(source.season.charShopChessDatas))if(s.charId&&base.entities[s.charId])add(s.charId,'头像_'+base.entities[s.charId].name+'.png','operator');
for(const {id} of collectModeEnemies(source))if(base.enemies[id])add(id,'头像_敌人_'+base.enemies[id].codex.name.trim()+'.png','enemy');
for(const s of Object.values(source.season.bandDataListDict))add(s.bandId,'卫戍协议：盟约_策略发起人_'+source.common.bandDataDict[s.bandId].bandName+'.png','strategy');
const request=async u=>{const r=await fetch(u,{signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error('HTTP '+r.status+' '+u);return r;};
const normalize=t=>t.replace(/^(File|文件):/,'').replaceAll('_',' ');const existing=JSON.parse(await fs.readFile(root+'/manifest.json','utf8').catch(()=>'{"assets":{}}'));const manifest={schemaVersion:1,sourcePage:'https://prts.wiki/w/卫戍协议：盟约_下半',sourceCommit:source.source.commit,assets:{...existing.assets},missing:[]};const list=[...requested.values()];
for(let start=0;start<list.length;start+=40){const batch=list.slice(start,start+40);const response=await(await request('https://prts.wiki/api.php?'+new URLSearchParams({action:'query',prop:'imageinfo',iiprop:'url|sha1|size|mime',titles:batch.map(x=>x.title).join('|'),format:'json',formatversion:'2'}))).json();const pages=response.query?.pages;if(!pages)throw Error(JSON.stringify(response.error));
 const jobs=batch.map(item=>({item,page:pages.find(p=>normalize(p.title)===normalize(item.title))}));
 for(let i=0;i<jobs.length;i+=4)await Promise.all(jobs.slice(i,i+4).map(async({item,page})=>{const info=page?.imageinfo?.[0];if(!info||!['image/png','image/jpeg'].includes(info.mime)){manifest.missing.push(item);return;}const file=item.id+(info.mime==='image/png'?'.png':'.jpg');let bytes;try{bytes=await fs.readFile(root+'/'+file);}catch{}if(!bytes||crypto.createHash('sha1').update(bytes).digest('hex')!==info.sha1){bytes=Buffer.from(await(await request(info.url)).arrayBuffer());if(crypto.createHash('sha1').update(bytes).digest('hex')!==info.sha1)throw Error('Asset hash mismatch '+item.id);await fs.writeFile(root+'/'+file,bytes);}manifest.assets[item.id]={...item,file:'assets/prts/'+file,url:info.url,sourcePage:info.descriptionurl,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),sha1:info.sha1,width:info.width,height:info.height};}));
 await fs.writeFile(root+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');console.log('PRTS assets '+Math.min(start+40,list.length)+'/'+list.length);
}
console.log(JSON.stringify({downloaded:Object.keys(manifest.assets).length,missing:manifest.missing}));
