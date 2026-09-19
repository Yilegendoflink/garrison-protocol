import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {NATIVE_DATA} from '../dist/runtime-data.js';

// 装备效果 key 的覆盖登记表。原表里每件装备只给一个效果 key（+黑板数值），
// 客户端要么按 key 逐条实现，要么走通用数值通道；两者都没有的必须在下面登记，
// 免得「装了没反应」只能靠玩家一个个发现（拟态物质就是这么漏的）。
// 通用通道：stats() 里的 char_attribute_mul / env_gbuff* 直接读黑板数值。
const GENERIC=/^(char_attribute_mul$|env_gbuff)/;
// 已知尚未实现（都带明确原因），实现后要从这里删掉——删了不实现测试会挂。
const PENDING={
 equip_round_start_upgrade_char:'博士投影：下个回合开始时销毁并把携带者晋升为精锐（跨回合结算，尚未接入）',
 char_dynamic_ability_new:'耶拉冈德之泪／骑士戒律／叙拉古正装：动态能力（含同时装备另一件时的追加效果），尚未接入',
 equip_with_another_gain_coin_when_gain_char:'天师古鼎：按本回合获得干员数叠攻速、与炎国短刀联动给资金，尚未接入'
};
// 只看逻辑模块：runtime-data／protocol-data／catalog 是烘进去的原表数据，里面当然有这些 key。
const sources=()=>fs.readdirSync('dist').filter(f=>f.endsWith('.js')&&!/bundle/.test(f)&&(f.startsWith('native-')||['protocol.js','strategy.js','garrison.js'].includes(f))).map(f=>fs.readFileSync('dist/'+f,'utf8')).join('\n');
const quoted=key=>[`'${key}'`,`"${key}"`,'`'+key+'`'];

test('装备效果 key 要么实现、要么登记为待补齐（不能有静默失效的装备）',()=>{
 const src=sources();
 const keys=new Map();
 for(const it of Object.values(NATIVE_DATA.season.trapChessDataDict)){
  if(it.itemType!=='EQUIP')continue;
  const desc=(NATIVE_DATA.season.effectInfoDataDict[it.effectId]?.effectDesc||'').replace(/<[^>]+>/g,'');
  const name=NATIVE_DATA.season.effectInfoDataDict[it.effectId]?.effectName||it.chessId;
  for(const row of NATIVE_DATA.season.effectBuffInfoDataDict[it.effectId]||[]){
   if(GENERIC.test(row.key))continue;
   if(!keys.has(row.key))keys.set(row.key,{name,desc});
  }
 }
 const missing=[...keys].filter(([key])=>!quoted(key).some(p=>src.includes(p))).map(([key,v])=>[key,v]);
 const unregistered=missing.filter(([key])=>!(key in PENDING)).map(([key,v])=>`${key}（${v.name}）`);
 assert.deepEqual(unregistered,[],'这些装备效果 key 既没有实现也没有登记');
 const stale=Object.keys(PENDING).filter(key=>!missing.some(([k])=>k===key));
 assert.deepEqual(stale,[],'这些 key 已经实现（或不再出现），请把它们从 PENDING 里删掉');
 assert.equal(PENDING.use_equip_reward_char_chess,undefined,'拟态物质已实现，不应再留在待补齐表里');
});
