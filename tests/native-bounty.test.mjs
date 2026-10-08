import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_DATA as data} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {NativeBattle} from '../dist/native-battle.js';
import {BOUNTY_SLUG,bountyOption,bountyOffers,bountyDecisionOffers} from '../dist/native-bounty.js';
import {ENEMY_KILL_COINS} from '../dist/native-wave-defaults.js';
import {renderBountyChoice,renderDecisionChoice} from '../dist/native-choices.js';
import {buildPhasePlan,singleDecisionRounds} from '../dist/protocol.js';
import {commitExit} from '../dist/native-effects.js';

const turnOf=(modeId,round)=>buildPhasePlan(data,modeId).find(t=>t.round===round);
function decisionSession(modeId,round,roll=0){
 const g=new NativeSession(data,{modeId,seed:42});g.s.round=round;g.s.phase='decision';g.s.lastPrepRound=null;g.s.rewardPending=null;g.random=()=>roll;g.prepareRoundDecision();return g;
}

test('original bounty table remains the only source for bounty offers and zero payout',()=>{
 for(let seed=0;seed<300;seed++){
  const ids=bountyOffers(data,seed),offers=ids.map(id=>bountyOption(data,id));
  assert.equal(ids.length,4);assert.equal(new Set(ids).size,4);assert.deepEqual(bountyOffers(data,seed),ids);
  assert.ok(offers.some(o=>o.coin===1));assert.ok(offers.some(o=>o.coin===4));
  for(const o of offers){assert.ok(o.coin>=0&&o.coin<=6);assert.equal(data.enemies[o.enemyId].enemyBehavior.randomPoolEligible,true);}
 }
 assert.equal(bountyOption(data,BOUNTY_SLUG).coin,0);
});

test('scheduled decisions use early pools first and later pools after that',()=>{
 assert.deepEqual(singleDecisionRounds(data.season.modeDataDict.mode_single_funny),[]);
 assert.deepEqual(singleDecisionRounds(data.season.modeDataDict.mode_single_normal),[5,8]);
 assert.deepEqual(singleDecisionRounds(data.season.modeDataDict.mode_single_hard),[3,8,10]);
 assert.deepEqual(singleDecisionRounds(data.season.modeDataDict.mode_single_abyss),[2,8,10]);
 for(let seed=0;seed<100;seed++){
  const early=bountyDecisionOffers(data,seed),late=bountyDecisionOffers(data,seed,{late:true});
  assert.equal(early.length,3);assert.equal(new Set(early.map(x=>x.enemyId)).size,3);
  assert.equal(data.enemies[early[0].enemyId].levelType,'ELITE');
  const eliteMax=Math.max(...Object.keys(ENEMY_KILL_COINS).filter(id=>data.enemies[id]?.levelType==='ELITE').map(id=>ENEMY_KILL_COINS[id].coin));assert.equal(early[0].coin,eliteMax);
  assert.ok(early.slice(1).every(x=>data.enemies[x.enemyId].levelType==='NORMAL'&&x.enemyId!==BOUNTY_SLUG));
  assert.equal(late.length,3);assert.ok(late.slice(0,2).every(x=>data.enemies[x.enemyId].levelType==='BOSS'));
  assert.deepEqual([late[2].enemyId,late[2].coin],[BOUNTY_SLUG,0]);
 }
});

test('a decision randomly selects one type and bounty targets join the next wave once',()=>{
 const g=decisionSession('mode_single_abyss',3,0);
 assert.equal(g.s.roundDecisionType,'bounty');assert.equal(g.s.roundDecisionPool,'early');assert.equal(g.s.roundDecisions.length,3);
 const selected=g.s.roundDecisions[0];assert.equal(g.perform('decision',selected.id),true);
 assert.equal(g.s.phase,'prep');assert.equal(g.s.pendingBounties.length,1);
 const b=new NativeBattle(data,g,g.map,turnOf(g.s.modeId,g.s.round)),targets=b.s.queue.filter(q=>q.bountyReward!==undefined);
 assert.equal(targets.length,selected.count);assert.ok(targets.every(q=>q.bountyReward===selected.coin&&q.at>Math.max(...b.s.queue.filter(q=>q.original).map(q=>q.at))));
 const before=g.s.nextRoundBonus;b.spawn(targets[0]);commitExit(b,{target:b.s.enemies.at(-1),reason:'death'});
 assert.equal(g.s.nextRoundBonus-before,selected.coin);
 g.s.phase='battle';g.battle=b;
 const restored=NativeSession.restore(data,JSON.parse(JSON.stringify({...g.snapshot(),battle:b.s})));
 assert.ok(restored);assert.deepEqual(restored.battle.s.queue,b.s.queue);
});

test('equipment decisions offer three distinct items from the pool for their decision phase',()=>{
 const early=decisionSession('mode_single_abyss',3,.5);
 assert.equal(early.s.roundDecisionType,'equipment');assert.equal(early.s.roundDecisionPool,'early');
 assert.equal(early.s.roundDecisions.length,3);assert.equal(new Set(early.s.roundDecisions.map(x=>x.itemId)).size,3);
 assert.ok(early.s.roundDecisions.every(x=>[1,2,3].includes(data.items.find(i=>i.id===x.itemId)?.rank)));
 const late=decisionSession('mode_single_hard',9,.5);
 assert.equal(late.s.roundDecisionType,'equipment');assert.equal(late.s.roundDecisionPool,'late');
 assert.equal(late.s.roundDecisions.length,3);assert.ok(late.s.roundDecisions.every(x=>[5,6].includes(data.items.find(i=>i.id===x.itemId)?.rank)));
 const choice=late.s.roundDecisions[0];assert.equal(late.perform('decision',choice.id),true);
 assert.ok(late.s.items.some(i=>i.chessId===choice.itemId));assert.equal(late.s.phase,'prep');
});

test('equipment-triggered bounty remains a separate item effect and preserves the reward queue',()=>{
 const g=new NativeSession(data,{seed:8}),u=g.gain(g.s.offers[0]),item=g.gainItem('chess_item_6_03_m');
 assert.equal(g.equip(item.uid,u.uid),true);assert.equal(g.s.rewardPending.offers.length,4);
 g.s.rewardPending.offers=[BOUNTY_SLUG];const next={tier:2};g.s.rewardQueue=[next];
 assert.ok(g.chooseBounty(BOUNTY_SLUG));assert.equal(g.s.pendingBounty.coin,0);assert.equal(g.s.rewardPending,next);
});

test('decision and item bounty views use the shared choice card layout',()=>{
 const bounty=renderBountyChoice(data,[BOUNTY_SLUG],1);assert.equal((bounty.match(/class="native-choice-card /g)||[]).length,1);assert.match(bounty,/data-choice-kind="bounty"/);
 const decision=renderDecisionChoice(data,[{id:'equipment:test',kind:'equipment',itemId:data.items[0].id}],5,{type:'equipment'});assert.equal((decision.match(/class="native-choice-card /g)||[]).length,1);assert.match(decision,/data-choice-kind="decision"/);assert.match(decision,/道具补给决策/);
});
