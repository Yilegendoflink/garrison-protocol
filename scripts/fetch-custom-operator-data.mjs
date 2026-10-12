// 固定提交的扩展原表：只采克莱门莎及直接依赖，不更新历史基础包。
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const commit='e8588a82074bf695aa3849959037dd2de7e6e5cf';
const root='https://api.github.com/repos/Kengxxiao/ArknightsGameData/contents/zh_CN/gamedata/excel/';
const receipts={};
const read=async name=>{const url=root+name+'?ref='+commit,response=await fetch(url,{headers:{'Accept':'application/vnd.github.raw+json','User-Agent':'GarrisonCustomOperators/1.0'},signal:AbortSignal.timeout(45000)});if(!response.ok)throw Error(name+' HTTP '+response.status);const raw=await response.text();receipts[name]={url,sha256:crypto.createHash('sha256').update(raw).digest('hex')};return JSON.parse(raw);};
const [characters,skills,ranges]=await Promise.all(['character_table.json','skill_table.json','range_table.json'].map(read));
const ids=['char_4231_clemnt',...Object.keys(characters).filter(id=>id.startsWith('token_')&&id.includes('clemnt'))];
const entities={},selectedSkills={},selectedRanges={};
for(const id of ids){const c=characters[id];if(!c)throw Error('Missing '+id);entities[id]={id,name:c.name,kind:id.startsWith('token_')?'summon':'operator',rarity:Number(c.rarity.split('_').at(-1)),profession:c.profession,branch:c.subProfessionId,position:c.position,description:c.description,phases:c.phases,skillRefs:c.skills,talents:c.talents,trait:c.trait,potentials:c.potentialRanks,favor:c.favorKeyFrames,token:c.displayTokenDict,groupId:c.groupId,teamId:c.teamId,source:{commit,table:'character_table.json'}};
 for(const ref of c.skills||[]){const s=skills[ref.skillId];if(!s)throw Error('Missing '+ref.skillId);selectedSkills[ref.skillId]=s;for(const l of s.levels)if(l.rangeId)selectedRanges[l.rangeId]=ranges[l.rangeId];}
 for(const p of c.phases||[])if(p.rangeId)selectedRanges[p.rangeId]=ranges[p.rangeId];
 for(const t of c.talents||[])for(const c of t.candidates||[])if(c.rangeId)selectedRanges[c.rangeId]=ranges[c.rangeId];
}
if(Object.values(selectedRanges).some(r=>!r))throw Error('Missing range dependency');
const pack={schemaVersion:1,source:{commit,receipts,retrievedAt:new Date().toISOString()},entities,skills:selectedSkills,ranges:selectedRanges};
await fs.writeFile('data/modes/alliance-lower/custom-operator-data.json',JSON.stringify(pack,null,2)+'\n');
console.log(JSON.stringify({commit,entities:ids,skills:Object.keys(selectedSkills),ranges:Object.keys(selectedRanges)}));
