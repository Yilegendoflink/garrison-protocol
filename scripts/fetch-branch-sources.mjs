import fs from 'node:fs/promises';
const pages=[];for(const title of ['分支一览','分支特性信息/data']){
 const response=await fetch('https://prts.wiki/api.php?'+new URLSearchParams({action:'parse',page:title,prop:'wikitext|revid',format:'json'}),{signal:AbortSignal.timeout(45000)});
 if(!response.ok)throw Error('PRTS HTTP '+response.status);const json=await response.json();if(json.error)throw Error(json.error.info);
 pages.push({title:json.parse.title,revision:json.parse.revid,wikitext:json.parse.wikitext['*']});
}
await fs.mkdir('artifacts/research',{recursive:true});await fs.writeFile('artifacts/research/prts-branches.json',JSON.stringify(pages,null,2));console.log(pages.map(p=>p.title+' @ '+p.revision).join('\n'));
