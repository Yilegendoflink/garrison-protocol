import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_DATA as data} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {PreparationState,HAND_LIMIT,INFINITE_FUNDS} from '../dist/protocol.js';
import {weeklyChallengeAt,weeklyChallengeSnapshot,validateWeeklyChallengeSchedule} from '../dist/native-challenges.js';

const entries=data.weeklyChallenges.entries.filter(e=>e.challengeId==='tier-one-pair');
const base='chess_char_1_02_a',elite=data.season.charChessDataDict[base].upgradeChessId;
const weekly=entry=>weeklyChallengeSnapshot({...entry,timeZone:data.weeklyChallenges.timeZone},Date.parse(entry.startsAt));
const make=(entry=entries[0],options={})=>new NativeSession(data,{seed:42,bandId:'band_amiya',bondBan:{bonds:[]},weeklyChallenge:weekly(entry),...options});
const clearRewards=g=>{g.s.rewardPending=null;g.s.rewardQueue=[];};
function buy(g,id){g.s.offers=[id];assert.equal(g.perform('buy',0),true,g.lastError);}

test('补齐本周与下周，两期在周三零点衔接，旧挑战快照不变',()=>{
 assert.equal(entries.length,2);assert.deepEqual(validateWeeklyChallengeSchedule(data.weeklyChallenges),[]);
 assert.deepEqual(entries.map(e=>[e.startsAt,e.endsAt]),[
  ['2026-10-21T00:00:00+08:00','2026-10-28T00:00:00+08:00'],
  ['2026-10-28T00:00:00+08:00','2026-11-04T00:00:00+08:00']
 ]);
 const at=time=>weeklyChallengeAt(data.weeklyChallenges,Date.parse(time));
 assert.equal(at('2026-10-20T23:59:59+08:00').challengeId,'bounty-takeover');
 assert.equal(at('2026-10-26T12:00:00+08:00').id,entries[0].id);
 assert.equal(at(entries[0].endsAt).id,entries[1].id);
 assert.equal(at(entries[1].endsAt),null);
 for(const entry of entries){const g=make(entry);assert.deepEqual(g.operatorMergeRules(base),{count:2,bonusFunds:1});assert.equal(g.s.phase,'prep');}
 const old=make(data.weeklyChallenges.entries[0]);assert.deepEqual(old.operatorMergeRules(base),{count:3,bonusFunds:0});
});

test('所有Ⅰ阶干员两名合成，保留原晋升奖励并且每组合成只加1资金',()=>{
 const rows=Object.values(data.season.charShopChessDatas).filter(o=>o.chessLevel===1&&!o.isHidden&&o.charId);
 for(const entry of entries)for(const row of rows){
  const g=make(entry),id=row.chessId,next=data.season.charChessDataDict[id].upgradeChessId;
  assert.deepEqual(g.operatorMergeRules(id),{count:2,bonusFunds:1});
  // 基础状态隔离获得时特质，验证通用合成入口覆盖整个Ⅰ阶名册。
  const p=new PreparationState(data,'mode_single_normal');p.s.weeklyChallenge=weekly(entry);
  p.gain(id);assert.equal(p.s.units.length,1);const funds=p.s.funds;
  const unit=p.gain(id);assert.equal(unit.chessId,next,row.chessId);assert.equal(p.s.units.length,1);
  assert.equal(p.s.funds,funds+1);assert.equal(p.s.rewardPending.tier,2);
  assert.equal(p.mergeOperatorCopies(id),null);assert.equal(p.s.funds,funds+1);
 }
 const g=make();g.setFunds(20);buy(g,base);buy(g,base);assert.equal(g.s.units.length,1);assert.equal(g.s.units[0].chessId,elite);
 assert.equal(g.s.funds,20-g.price(base)*2+1);assert.ok(g.s.rewardPending?.offers?.length,'晋升仍可三选一');
});

test('Ⅱ至Ⅵ阶和普通模式仍需三名，不发额外金币；精锐和装备不受影响',()=>{
 for(const tier of [2,3,4,5,6]){
  const id=Object.values(data.season.charShopChessDatas).find(o=>o.chessLevel===tier&&!o.isHidden&&o.charId).chessId;
  const p=new PreparationState(data,'mode_single_normal');p.s.weeklyChallenge=weekly(entries[0]);p.gain(id);p.gain(id);
  assert.equal(p.s.units.length,2);assert.equal(p.s.funds,4);p.gain(id);assert.equal(p.s.units.length,1);assert.equal(p.s.funds,4);
 }
 const normal=new PreparationState(data,'mode_single_normal');normal.gain(base);normal.gain(base);assert.equal(normal.s.units.length,2);normal.gain(base);assert.equal(normal.s.units.length,1);assert.equal(normal.s.funds,4);
 const g=make();g.gain(elite);g.gain(elite);assert.equal(g.s.units.length,2);assert.equal(g.canMergeOnGain(elite),false);assert.equal(g.s.funds,4);
 const funds=g.s.funds;g.gainItem('chess_item_3_04_e_a');g.gainItem('chess_item_3_04_e_a');assert.equal(g.s.items.length,1);assert.equal(g.s.funds,funds);
});

test('满手可购买第二名Ⅰ阶同名干员并合成，其他卡仍受上限限制',()=>{
 for(const kind of ['session','base']){
  const g=kind==='session'?make():new PreparationState(data,'mode_single_normal');g.s.weeklyChallenge=weekly(entries[0]);g.setFunds(30);g.gain(base);
  g.s.items=Array.from({length:HAND_LIMIT-1},(_,i)=>({uid:++g.s.seq,chessId:'chess_item_3_04_e_a'}));
  assert.equal(g.handFull(),true);g.s.offers=['chess_char_1_03_a'];assert.equal(g.buy(0).code,'FULL_HAND');
  g.s.offers=[base];assert.equal(g.canMergeOnGain(base),true);assert.equal(g.buy(0).ok,true);
  assert.equal(g.handLength(),HAND_LIMIT);assert.equal(g.s.units[0].chessId,elite);
 }
});

test('合成保留阵地、装备及两份购买库存记录，读档跨周后仍按快照结算',()=>{
 let g=make();g.setFunds(30);const stock=g.s.stock[base];buy(g,base);const first=g.s.units[0];
 const cell=g.map.grid.flatMap((row,y)=>row.map((_,x)=>({x,y}))).find(p=>g.canDeploy(first.uid,p.x,p.y));assert.ok(cell);g.deploy(first.uid,cell.x,cell.y,2);
 const item=g.gainItem('chess_item_3_04_e_a');assert.equal(g.equip(item.uid,first.uid),true);
 const saved=JSON.parse(JSON.stringify(g.snapshot()));g=NativeSession.restore(data,saved);assert.ok(g);assert.equal(g.s.weeklyChallenge.id,entries[0].id);
 const before=g.s.funds;buy(g,base);const unit=g.s.units[0];assert.equal(unit.chessId,elite);assert.deepEqual(unit.position,cell);assert.equal(unit.dir,2);
 assert.equal(unit.equipment.length,0);assert.ok(g.s.items.some(i=>i.uid===item.uid));assert.deepEqual(unit.purchases,{[base]:2});assert.equal(g.s.stock[base],stock-2);
 assert.equal(g.s.funds,before-g.price(base)+1);clearRewards(g);assert.equal(g.sell(unit.uid),true);assert.equal(g.s.stock[base],stock);
 const cat=make(entries[1],{cat:true});buy(cat,base);buy(cat,base);assert.equal(cat.s.units[0].chessId,elite);assert.equal(cat.s.funds,INFINITE_FUNDS);
 const laterData={...data,weeklyChallenges:{...data.weeklyChallenges,entries:[]}};const resumed=NativeSession.restore(laterData,saved);assert.ok(resumed);buy(resumed,base);assert.equal(resumed.s.units[0].chessId,elite);
});
