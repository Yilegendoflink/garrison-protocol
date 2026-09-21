// 显式重生成默认配置；普通 build 只校验，不重写玩家编辑或默认 JSON。
import fs from 'node:fs/promises';
import {NATIVE_DATA as data} from '../dist/runtime-data.js';
const path='data/modes/alliance-lower/default-wave-table.json';
const table=JSON.parse(await fs.readFile(path,'utf8'));
const {entries}=JSON.parse(await fs.readFile('data/prts/enemy-activities.json','utf8'));
const {themes}=JSON.parse(await fs.readFile('data/modes/alliance-lower/wave-theme-rules.json','utf8'));
const activity=id=>entries[id]?.activities[0];
for(const [type,tiers] of Object.entries(table.types))for(const [tier,pack] of Object.entries(tiers))for(const slot of pack.templates){
 const theme=themes.find(t=>t.type===type&&t.activities.includes(slot.activity));
 if(!theme)throw Error(`缺少主题: ${type}/${slot.activity}`);
 const eligible=(data.season.enemyInfoDict[type]||[]).filter(id=>data.enemies[id]?.enemyBehavior?.randomPoolEligible===true&&theme.activities.includes(activity(id)));
 // 每次从原活动核心重建，避免重复执行时累加补员。
 const existing=slot.pool.filter(id=>eligible.includes(id)&&activity(id)===slot.activity);
 const candidates=eligible.filter(id=>!existing.includes(id)).sort((a,b)=>Number(activity(b)===slot.activity)-Number(activity(a)===slot.activity)||(table.costs[a]??Infinity)-(table.costs[b]??Infinity)||a.localeCompare(b));
 if(Number(tier)>=2){
  while(existing.length<4&&candidates.length)existing.push(candidates.shift());
  if(existing.length<4)throw Error(`主题可用敌人不足4种: ${theme.name}`);
  slot.minKinds=4;
 }else delete slot.minKinds;
 if(existing.some(id=>!Number.isFinite(table.costs[id])))throw Error(`缺少敌人难度: ${slot.name}`);
 slot.pool=existing;slot.theme=theme.id;
 slot.name=existing.some(id=>activity(id)!==slot.activity)?`${slot.activity} · ${theme.name}`:slot.activity;
 slot.budget=Math.max(slot.budget,Math.max(...existing.map(id=>table.costs[id]))*(slot.maxCount||1));
}
await fs.writeFile(path,JSON.stringify(table,null,2)+'\n');
console.log('已按活动核心与相近主题重新生成默认模板');
