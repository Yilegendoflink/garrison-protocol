import test from 'node:test';import assert from 'node:assert/strict';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {NativeEconomy} from '../dist/native-economy.js';
import {baseFunding,BASE_FUNDS_START,BASE_FUNDS_CAP,shopTerms,INFINITE_FUNDS} from '../dist/protocol.js';
import {runStrategyEvent} from '../dist/strategy.js';

// 经济系统口径（用户 2026-09-22）：
//   ① 开局 4 资金，之后每回合默认多获取 1，默认收入上限 11；
//   ② 效果／策略／装备发的额外资金不受上限限制（只有默认回合收入这一条路走 baseFunding→setFunds）；
//   ③ 商店升级原价（2–6 级）5／8／11／12／13；每经过一回合当前升级费用 -1，直到 0；升级后按新等级原价重新开始。
const MODE='mode_single_normal';
const newGame=options=>new NativeEconomy(NATIVE_DATA,MODE,{seed:3,...options});
// 走一遍「开战 → 结算 → 下一回合」。这里只关心默认收入这一条路径，所以跳过决策／奖励类结算，
// 免得策略与决策发的额外资金混进「默认收入」的断言。
function advance(g){
 if(g.s.phase==='decision')g.s.phase='prep';
 g.s.rewardPending=null;
 assert.equal(g.beginBattle(),true,'开战失败');
 g.finishBattle({success:true});
 assert.equal(g.nextRound([]),true,'进入下一回合失败');
 if(g.s.phase==='decision')g.s.phase='prep';
}
function spyFunding(g){
 const calls=[],original=g.setFunds.bind(g);
 g.setFunds=value=>{calls.push(value);return original(value);};
 return calls;
}

test('默认收入：开局 4，每回合 +1，上限 11',()=>{
 assert.equal(BASE_FUNDS_START,4);assert.equal(BASE_FUNDS_CAP,11);
 const expect={1:4,2:5,3:6,4:7,5:8,6:9,7:10,8:11,9:11,12:11,15:11};
 for(const [round,funds] of Object.entries(expect))assert.equal(baseFunding(Number(round)),funds,`第 ${round} 回合默认收入`);
 assert.throws(()=>baseFunding(0),/Invalid round/);
 assert.throws(()=>baseFunding(1.5),/Invalid round/);
 const g=newGame();
 assert.equal(g.s.round,1);
 assert.equal(g.s.funds,4,'开局 4 资金');
 const calls=spyFunding(g);
 for(let round=2;round<=12;round++){
  advance(g);
  assert.equal(g.s.round,round);
  assert.equal(calls.at(-1),baseFunding(round),`第 ${round} 回合按默认收入重置`);
  assert.equal(g.s.funds,baseFunding(round));
 }
});

test('额外获取不受 11 上限限制',()=>{
 const g=newGame();
 g.s.funds=BASE_FUNDS_CAP;
 g.addFunds(4);
 assert.equal(g.s.funds,15,'addFunds 直接加到上限之上');
 // 走一条真实效果路径：远见每 10 层发 2 资金（bond_layer_gain_coin → addFunds）
 const shops=Object.values(NATIVE_DATA.season.charShopChessDatas).filter(s=>s.charId&&NATIVE_DATA.season.charChessDataDict[s.chessId].bondIds.includes('visiShip'));
 const members=[...new Map(shops.map(s=>[s.charId,s])).values()].slice(0,2);
 g.s.funds=BASE_FUNDS_CAP;
 g.s.units=members.map((s,i)=>({uid:++g.s.seq,chessId:s.chessId,charId:s.charId,rank:s.chessLevel,position:{x:i,y:0},dir:0,equipment:[]}));
 g.addLayers('visiShip',10);
 assert.equal(g.s.funds,BASE_FUNDS_CAP+2,'盟约发的资金也要越过上限');
});

test('升级原价（2–6 级）＝5／8／11／12／13，来自原表 initialUpgradePrice',()=>{
 const table=NATIVE_DATA.season.shopLevelDataDict[MODE];
 assert.deepEqual([1,2,3,4,5].map(level=>table[level].initialUpgradePrice),[5,8,11,12,13],'原表就是这组数，客户端不额外改写');
 for(const [level,cost] of [[1,5],[2,8],[3,11],[4,12],[5,13]])assert.equal(shopTerms(NATIVE_DATA,MODE,level,0).upgradeCost,cost,`升到 ${level+1} 级`);
 assert.equal(shopTerms(NATIVE_DATA,MODE,6,0).upgradeCost,null,'6 级封顶');
 const g=newGame();
 assert.equal(g.terms().upgradeCost,5);
 g.s.funds=5;
 assert.equal(g.upgrade(),true);
 assert.equal(g.s.level,2);
 assert.equal(g.s.funds,0,'按 5 资金扣费');
});

test('每经过一回合当前升级费用 -1，直到 0；升级后按新等级原价重来',()=>{
 const g=newGame();
 const cost=()=>g.terms().upgradeCost;
 assert.equal(cost(),5);
 const seen=[];
 for(let round=2;round<=9;round++){advance(g);seen.push(cost());}
 assert.deepEqual(seen,[4,3,2,1,0,0,0,0],'逐回合 -1 并在 0 停住');
 // 升级后 discount 清零：新等级按原价，再逐回合 -1
 const fresh=newGame();
 advance(fresh);advance(fresh);advance(fresh);
 assert.equal(fresh.terms().upgradeCost,2,'5 - 3 回合折扣');
 fresh.s.funds=10;
 assert.equal(fresh.upgrade(),true);
 assert.equal(fresh.s.level,2);
 assert.equal(fresh.s.discount,0,'升级后折扣清零');
 assert.equal(fresh.terms().upgradeCost,8,'新等级原价');
 advance(fresh);
 assert.equal(fresh.terms().upgradeCost,7);
});

test('海猫模式的无限资金不被默认收入上限影响',()=>{
 const g=newGame({cat:true});
 assert.equal(g.s.funds,INFINITE_FUNDS);
 g.setFunds(baseFunding(9));
 assert.equal(g.s.funds,INFINITE_FUNDS);
 advance(g);
 assert.equal(g.s.funds,INFINITE_FUNDS,'回合重置后仍是无限');
});

test('策略「把整备资金顶到 N」的基数同样走 baseFunding（含 11 上限）',()=>{
 const band=Object.values(NATIVE_DATA.season.bandDataListDict).find(b=>NATIVE_DATA.season.effectBuffInfoDataDict[b.effectId]?.some(r=>r.key==='give_coin_in_round'));
 assert.ok(band,'要有一个用 give_coin_in_round 的策略');
 const data={...NATIVE_DATA,season:{...NATIVE_DATA.season,effectBuffInfoDataDict:{...NATIVE_DATA.season.effectBuffInfoDataDict}}};
 data.season.effectBuffInfoDataDict[band.effectId]=NATIVE_DATA.season.effectBuffInfoDataDict[band.effectId].map(row=>row.key==='give_coin_in_round'?{...row,blackboard:(row.blackboard||[]).map(x=>x.key==='round'?{...x,valueStr:'10',value:10}:x.key==='coin'?{...x,valueStr:'11',value:11}:x)}:row);
 const c={data,s:{bandId:band.bandId,round:10,funds:baseFunding(10)},addFunds(value){this.s.funds+=value;return this.s.funds;}};
 runStrategyEvent(c,'prep');
 assert.equal(c.s.funds,11,'顶到 11：基数按封顶后的 11 算，不能按 round+3=13 算');
});
