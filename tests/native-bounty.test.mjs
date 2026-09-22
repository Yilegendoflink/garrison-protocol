import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_DATA as data} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {NativeBattle} from '../dist/native-battle.js';
import {BOUNTY_FIRST_ROUND,BOUNTY_INTERVAL,BOUNTY_SLUG,bountyOption,bountyOffers,bountyRoundActive} from '../dist/native-bounty.js';
import {renderBountyChoice,renderDecisionChoice} from '../dist/native-choices.js';
import {buildPhasePlan,INFINITE_FUNDS} from '../dist/protocol.js';
import {commitExit} from '../dist/native-effects.js';

// 回合悬赏只在悬赏回合存在（第 2、4、6… 回合）。测试统一用这个助手把会话推进到悬赏回合，
// 免得每条用例都自己算节奏。
function sessionAtBountyRound(options={},round=BOUNTY_FIRST_ROUND){
 const g=new NativeSession(data,options);
 g.s.round=round;g.s.lastPrepRound=null;g.s.rewardPending=null;g.s.rewardQueue=[];
 assert.ok(bountyRoundActive(round),`第 ${round} 回合应当是悬赏回合`);
 assert.ok(g.ensureRoundBounty(),`第 ${round} 回合应当生成回合悬赏`);
 return g;
}
const turnOf=round=>buildPhasePlan(data,'mode_single_normal').find(t=>t.round===round);

test('four distinct bounties always include 1 and 4; slug alone pays zero',()=>{
 let slugSeen=false;
 for(let seed=0;seed<500;seed++){
  const ids=bountyOffers(data,seed),offers=ids.map(id=>bountyOption(data,id));
  assert.equal(ids.length,4);assert.equal(new Set(ids).size,4);assert.deepEqual(bountyOffers(data,seed),ids);
  assert.ok(offers.some(o=>o.coin===1));assert.ok(offers.some(o=>o.coin===4));
  for(const o of offers){assert.ok(o.coin>=0&&o.coin<=4);assert.equal(o.count,1);assert.equal(data.enemies[o.enemyId].enemyBehavior.randomPoolEligible,true);if(o.coin===0){assert.equal(o.enemyId,BOUNTY_SLUG);slugSeen=true;}}
 }
 assert.equal(slugSeen,true);
});

test('回合悬赏从第 2 回合开始每隔一个回合出现一次，不是每回合都弹',()=>{
 assert.equal(bountyRoundActive(0),false);assert.equal(bountyRoundActive(1),false);
 assert.equal(bountyRoundActive(2),true);assert.equal(bountyRoundActive(3),false);
 assert.equal(bountyRoundActive(4),true);assert.equal(bountyRoundActive(5),false);
 assert.equal(bountyRoundActive(6),true);
 assert.equal(bountyRoundActive(2.5),false);assert.equal(bountyRoundActive('3'),false);
 const g=new NativeSession(data,{seed:42});
 assert.equal(g.s.round,1);
 assert.equal(g.s.roundBounty??null,null,'第 1 回合不该有回合悬赏');
 for(const round of [2,3,4,5,6]){
  g.s.round=round;g.s.lastPrepRound=null;g.s.rewardPending=null;
  const row=g.ensureRoundBounty();
  if(bountyRoundActive(round)){
   assert.ok(row,`第 ${round} 回合应当有悬赏`);
   assert.equal(row.round,round);assert.equal(row.offers.length,4);assert.equal(row.selected,null);
  }else{
   assert.equal(row,null,`第 ${round} 回合不该有悬赏`);
   assert.notEqual(g.s.roundBounty?.round,round,'非悬赏回合不能新生成记录');
  }
 }
 // 木桩／Boss 阶段照旧没有悬赏
 const boss=buildPhasePlan(data,g.s.modeId).find(t=>t.isBossTurn);
 g.s.round=boss.round;assert.equal(g.ensureRoundBounty(),null);
});

test('per-round choice is stable, immutable once selected, saved and separate from promotion rewards',()=>{
 const g=sessionAtBountyRound({seed:42}),offers=g.s.roundBounty.offers.slice(),rng=g.s.randomState;
 g.ensureRoundBounty();assert.equal(g.s.randomState,rng);assert.deepEqual(g.s.roundBounty.offers,offers);
 assert.equal(g.perform('roundBounty','invalid'),false);
 const reward={kind:'item',offers:['test'],choice:1};g.s.rewardPending=reward;
 assert.equal(g.perform('roundBounty',offers[0]),true);assert.deepEqual(g.s.rewardPending,reward);
 assert.equal(g.perform('roundBounty',offers[1]),false);
 const restored=NativeSession.restore(data,JSON.parse(JSON.stringify(g.snapshot())));assert.ok(restored);assert.deepEqual(restored.s.roundBounty,g.s.roundBounty);
 const bad=g.snapshot();bad.s=structuredClone(bad.s);bad.s.roundBounty.offers[1]=bad.s.roundBounty.offers[0];assert.equal(NativeSession.restore(data,bad),null);
 const old=g.snapshot();old.s=structuredClone(old.s);delete old.s.roundBounty;assert.ok(NativeSession.restore(data,old).s.roundBounty,'悬赏回合里丢掉记录的旧存档应当补回');
 g.s.rewardPending=null;g.s.phase='intermission';assert.equal(g.advanceRound(),true);assert.equal(g.s.round,3);
 assert.equal(g.s.roundBounty?.round,2,'非悬赏回合保留上一轮记录，不重新生成');
 g.s.phase='intermission';assert.equal(g.advanceRound(),true);assert.equal(g.s.round,4);
 assert.equal(g.s.roundBounty.round,4);assert.equal(g.s.roundBounty.selected,null);assert.equal(g.s.roundBounty.offers.length,4);
});

test('bounty target spawns once, pays once on death, never on leak; slug pays zero',()=>{
 for(const coin of [0,1,4])for(const leak of [false,true]){
  const g=sessionAtBountyRound({seed:42,cat:coin===4}),turn=turnOf(g.s.round);
  let offers;for(let seed=0;seed<100;seed++){offers=bountyOffers(data,seed);if(offers.some(id=>bountyOption(data,id).coin===coin))break;}
  g.s.roundBounty.offers=offers;const id=offers.find(id=>bountyOption(data,id).coin===coin);assert.ok(g.perform('roundBounty',id));
  const b=new NativeBattle(data,g,g.map,turn),targets=b.s.queue.filter(q=>q.bountyReward!==undefined);assert.equal(targets.length,1);assert.equal(targets[0].bountyReward,coin);assert.ok(targets[0].at<=40);
  const raw=b.enemyRaw(id);assert.equal(b.level.routes[targets[0].route].motionMode,raw.motion==='FLY'?'FLY':'WALK');
  b.spawn(targets[0]);const enemy=b.s.enemies.at(-1),before=g.s.nextRoundBonus;
  commitExit(b,{target:enemy,reason:leak?'leak':'death'});commitExit(b,{target:enemy,reason:leak?'leak':'death'});
  assert.equal(g.s.nextRoundBonus-before,leak?0:coin);assert.equal(b.s.bountyEarned||0,leak?0:coin);
  g.s.phase='prep';g.s.lastPrepRound=null;const funds=g.s.funds;g.startPreparation();assert.equal(g.s.funds,g.s.cat?INFINITE_FUNDS:funds+(leak?0:coin));assert.equal(g.s.nextRoundBonus,0);
 }
});

test('item bounty also offers four options, zero survives, reward queue is preserved',()=>{
 const g=new NativeSession(data,{seed:8}),u=g.gain(g.s.offers[0]),item=g.gainItem('chess_item_6_03_m');
 assert.equal(g.equip(item.uid,u.uid),true);assert.equal(g.s.rewardPending.offers.length,4);
 const offers=g.s.rewardPending.offers.map(id=>bountyOption(data,id));assert.ok(offers.some(o=>o.coin===1));assert.ok(offers.some(o=>o.coin===4));
 g.s.rewardPending.offers=bountyOffers(data,0);if(!g.s.rewardPending.offers.includes(BOUNTY_SLUG))g.s.rewardPending.offers.push(BOUNTY_SLUG);
 const next={tier:2};g.s.rewardQueue=[next];assert.ok(g.chooseBounty(BOUNTY_SLUG));assert.equal(g.s.pendingBounty.coin,0);assert.equal(g.s.rewardPending,next);
});

test('round and item bounties coexist and restoring battle does not enqueue them twice',()=>{
 const g=sessionAtBountyRound({seed:42}),id=g.s.roundBounty.offers[0];assert.ok(g.perform('roundBounty',id));
 const extra=bountyOption(data,g.s.roundBounty.offers[1]);g.s.pendingBounty={enemyId:extra.enemyId,count:1,coin:extra.coin};
 g.s.phase='battle';g.battle=new NativeBattle(data,g,g.map,turnOf(g.s.round));
 assert.equal(g.battle.s.queue.filter(q=>q.bountyReward!==undefined).length,2);assert.equal(g.s.pendingBounty,null);
 const restored=NativeSession.restore(data,JSON.parse(JSON.stringify(g.snapshot())));assert.ok(restored);
 assert.deepEqual(restored.battle.s.queue,g.battle.s.queue);assert.equal(restored.s.roundBounty.selected,id);
});

test('bounty and decision share dynamic choice markup, with safe rich-text content',()=>{
 const bounty=renderBountyChoice(data,bountyOffers(data,42),1);assert.equal((bounty.match(/class="native-choice-card /g)||[]).length,4);assert.match(bounty,/data-choice-kind="bounty"/);assert.match(bounty,/下轮到账/);
 const decision=renderDecisionChoice(data,Object.keys(data.season.effectInfoDataDict).slice(0,3),5);assert.equal((decision.match(/class="native-choice-card /g)||[]).length,3);assert.match(decision,/data-choice-kind="decision"/);assert.match(decision,/机变决策/);
});
