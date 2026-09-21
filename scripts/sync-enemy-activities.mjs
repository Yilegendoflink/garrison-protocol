// 显式刷新资料；普通 npm run build 只读本地快照，不访问 PRTS。
import fs from 'node:fs/promises';
const catalog=JSON.parse(await fs.readFile('data/modes/alliance-lower/catalog.json','utf8'));
const prts=JSON.parse(await fs.readFile('data/prts/snapshots/2026-09-12-prts/enemies.json','utf8'));
const results={};let offset=0;
do{
 const url=new URL('https://prts.wiki/api.php');
 url.search=new URLSearchParams({action:'ask',query:`[[分类:敌人]]|?登场活动|limit=500|offset=${offset}`,format:'json'});
 const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error(`PRTS HTTP ${response.status}`);
 const json=await response.json();if(!json.query?.results)throw Error('PRTS 缺少查询结果');
 Object.assign(results,json.query.results);offset=json['query-continue-offset'];
}while(offset);
const entries={};
for(const e of catalog.enemies){
 const source=prts.find(p=>p.name===e.name)?.source.url;
 const title=source?decodeURIComponent(new URL(source).pathname.slice(3)):e.name;
 const row=results[title]||results[e.name],activities=row?.printouts?.['登场活动'];
 if(activities?.length!==1)throw Error(`需要人工核对活动: ${e.id} ${e.name}`);
 entries[e.id]={name:e.name,activities,url:new URL(row.fullurl,'https://prts.wiki').href};
}
await fs.writeFile('data/prts/enemy-activities.json',JSON.stringify({source:'https://prts.wiki/w/模板:敌人导航',retrievedAt:new Date().toISOString(),property:'登场活动',entries},null,2)+'\n');
console.log(`PRTS 登场活动: ${Object.keys(entries).length} 条`);
