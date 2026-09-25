// 装备合成的口径（用户 2026-09-23）：
// 「当未进阶的装备在干员身上时，若再获得相同未进阶装备，合成的新装备需要直接出现在手牌而不是在干员身上。」
// 附带的材料选取口径：材料优先从整备区（手牌）取，整备区不够时才动干员身上那件——
// 手牌里已经凑得齐两件时不该把干员的装备扒下来（旧实现不仅扒，还多收走一件材料）。
// 两条路径（Base `NativeEconomy` 与游戏实际使用的 `NativeSession`）必须完全一致，所以下面按类各跑一遍。
import test from 'node:test';import assert from 'node:assert/strict';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {NativeEconomy} from '../dist/native-economy.js';
import {NativeSession} from '../dist/native-session.js';
import {NO_BOND_BAN} from './no-bond-ban.mjs';

const BASE='chess_item_3_04_e_a',ELITE='chess_item_3_04_e_b';      // 炎国短刀：upgradeNum 2
const NEVER='chess_item_4_01_e_a',NEVER_ELITE='chess_item_4_01_e_b';// upgradeNum 100＝实际不合成
const hand=g=>g.s.items.map(i=>i.chessId);
const worn=u=>u.equipment.map(i=>i.chessId);

function session(Class){
 // 两个类的构造签名不同：NativeSession 收 options 对象，NativeEconomy 收 (data,modeId,options)。
 const g=Class===NativeEconomy
  ?new NativeEconomy(NATIVE_DATA,'mode_single_normal',{bandId:'band_bldsk',seed:11})
  :new NativeSession(NATIVE_DATA,{bondBan:NO_BOND_BAN,seed:11,bandId:'band_bldsk'});
 g.s.funds=9999;g.s.capacity=16;g.s.rewardPending=null;g.s.rewardQueue=[];
 return g;
}
function addUnit(g,charId){
 const p=Object.values(NATIVE_DATA.profiles).find(x=>x?.charId===charId);
 const u=g.gain(p.chessId);g.s.rewardPending=null;g.s.rewardQueue=[];
 return u;
}
// 直接塞进整备区/装备位：这样能精确摆放材料，不会在摆放阶段就触发合成。
// （`equip` 只定义在 NativeSession 上，而两个类都要测，所以装备位也直接写。）
function stock(g,chessId){const item={uid:++g.s.seq,chessId};g.s.items.push(item);return item;}
function wear(g,u,chessId){const item={uid:++g.s.seq,chessId};u.equipment.push(item);g.refreshEquipmentBonds?.(u);return item;}

for(const [label,Class] of [['NativeSession',NativeSession],['NativeEconomy',NativeEconomy]]){
 test(`${label}：干员身上一件 + 新获得一件 → 进阶装备进整备区，干员身上那件被收走`,()=>{
  const g=session(Class),u=addUnit(g,'char_143_ghost');
  wear(g,u,BASE);
  assert.deepEqual(worn(u),[BASE]);
  const merged=g.gainItem(BASE);
  assert.equal(merged.chessId,ELITE,'两件未进阶合成进阶装备');
  assert.deepEqual(hand(g),[ELITE],'进阶装备出现在整备区');
  assert.deepEqual(worn(u),[],'干员身上那件是材料，被收走');
  assert.equal(g.s.items.some(i=>i.chessId===BASE),false,'没有残留的未进阶装备');
 });

 test(`${label}：整备区已有一件时优先用整备区材料，不扒干员的装备`,()=>{
  const g=session(Class),u=addUnit(g,'char_143_ghost');
  wear(g,u,BASE);stock(g,BASE);                  // 身上 1 ＋ 整备区 1
  const merged=g.gainItem(BASE);                 // 整备区变 2
  assert.equal(merged.chessId,ELITE);
  assert.deepEqual(hand(g),[ELITE]);
  assert.deepEqual(worn(u),[BASE],'整备区够两件时不动干员的装备');
 });

 test(`${label}：一次获取会连续合成，多出来的进阶装备同样进整备区`,()=>{
  const g=session(Class),a=addUnit(g,'char_143_ghost'),b=addUnit(g,'char_494_vendla');
  stock(g,BASE);wear(g,a,BASE);wear(g,b,BASE);    // 整备区 1 ＋ 身上 2
  g.gainItem(BASE);                              // 整备区变 2 → 4 件材料合成 2 件进阶
  assert.deepEqual(hand(g),[ELITE,ELITE],'两件进阶装备都在整备区');
  assert.deepEqual(worn(a),[]);assert.deepEqual(worn(b),[]);
 });

 test(`${label}：upgradeNum 100 的道具不合成，进阶装备本身也不再合成`,()=>{
  const g=session(Class);
  g.gainItem(NEVER);g.gainItem(NEVER);
  assert.deepEqual(hand(g),[NEVER,NEVER],'upgradeNum 100 ＝ 只累积、不合成');
  g.gainItem(NEVER_ELITE);g.gainItem(NEVER_ELITE);
  assert.deepEqual(hand(g),[NEVER,NEVER,NEVER_ELITE,NEVER_ELITE],'进阶装备没有 upgradeChessId，保持原样');
 });

 test(`${label}：干员身上一件、整备区空时，进阶装备也不会留在干员身上（回归 2026-09-23 报的问题）`,()=>{
  const g=session(Class),u=addUnit(g,'char_143_ghost');
  wear(g,u,BASE);
  const merged=g.gainItem(BASE);
  assert.equal(u.equipment.includes(merged),false,'合成结果不能挂在干员身上');
  assert.ok(g.s.items.includes(merged),'合成结果必须在整备区');
 });
}

test('商店买进第二件（buyItem → gainItem）同样走合成，进阶装备出现在整备区',()=>{
 const g=session(NativeSession),u=addUnit(g,'char_143_ghost');
 wear(g,u,BASE);                                 // 干员身上穿着未进阶装备
 g.s.itemOffers=[BASE];
 assert.equal(g.perform('buyItem',0),true,g.lastError||'购买应当成功');
 assert.deepEqual(hand(g),[ELITE],'合成出的进阶装备在整备区');
 assert.deepEqual(worn(u),[],'干员身上那件被当作材料收走');
});
