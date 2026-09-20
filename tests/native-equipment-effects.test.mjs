import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {NATIVE_DATA} from '../dist/runtime-data.js';

// 装备效果 key 的覆盖登记表。原表里每件装备只给一个效果 key（+黑板数值），
// 客户端要么按 key 逐条实现，要么走通用数值通道；两者都没有的必须在下面登记，
// 免得「装了没反应」只能靠玩家一个个发现（拟态物质就是这么漏的）。
// 通用通道：stats() 里的 char_attribute_mul / env_gbuff* 直接读黑板数值。
const GENERIC=/^(char_attribute_mul$|env_gbuff)/;
// 已知尚未实现（都带明确原因），实现后要从这里删掉——删了不实现测试会挂。
const PENDING={
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

// 第二道门禁：`env_gbuff*` 行里的**内层符文名**才是具体效果（例：催泪瓦斯的 prob 就写在这种行里）。
// 只查外层 key 会漏掉它们——催泪瓦斯正是这样在「已实现」的表里漏了一整轮。
const GENERIC_FIELDS=new Set(['atk','max_hp','def','attack_speed','magic_resistance','sp_recovery_per_sec','key']);
// 已知尚未实现的内层符文（催泪瓦斯的「麻痹」是层数制状态：本客户端没有麻痹层数与触发消费者，原表也不给时长）
const PENDING_RUNES={
 act1autochess_equip_acarm058_global_buff:'催泪瓦斯：攻击时有概率使目标获得一层麻痹（麻痹层数机制未接入）',
};
test('env_gbuff 行里的内层符文要么被逻辑引用、要么登记为待补齐',()=>{
 const src=sources();
 const runes=new Map();
 for(const it of Object.values(NATIVE_DATA.season.trapChessDataDict)){
  if(it.itemType!=='EQUIP')continue;
  const name=NATIVE_DATA.season.effectInfoDataDict[it.effectId]?.effectName||it.chessId;
  for(const row of season_rows(it)){
   const bb=Object.fromEntries((row.blackboard||[]).map(b=>[b.key,b.valueStr??b.value]));
   const rune=bb.key||row.key;
   const extra=Object.keys(bb).filter(k=>!GENERIC_FIELDS.has(k));
   if(!GENERIC.test(row.key)&&!extra.length)continue; // 非通用行由上面那条门禁管
   if(GENERIC.test(row.key)&&!extra.length)continue;   // 纯通用数值：没有内层效果
   if(!runes.has(rune))runes.set(rune,new Set());
   runes.get(rune).add(name);
  }
 }
 const missing=[...runes].filter(([rune])=>!quoted(rune).some(p=>src.includes(p))).map(([rune,names])=>[rune,[...names].join('/')]);
 const unregistered=missing.filter(([rune])=>!(rune in PENDING_RUNES));
 assert.deepEqual(unregistered.map(([r,v])=>`${r}（${v}）`),[],'这些内层符文既没有逻辑引用也没有登记');
 const stale=Object.keys(PENDING_RUNES).filter(rune=>!missing.some(([k])=>k===rune));
 assert.deepEqual(stale,[],'这些内层符文已经实现，请把它们从 PENDING_RUNES 里删掉');
});
function season_rows(it){return NATIVE_DATA.season.effectBuffInfoDataDict[it.effectId]||[];}
