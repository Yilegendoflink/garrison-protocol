import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_DATA as data} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {NativeBattle} from '../dist/native-battle.js';
import {weeklyChallengeAt,weeklyChallengeSnapshot,weeklyBountyRules,validateWeeklyChallengeSchedule} from '../dist/native-challenges.js';
import {bountyOption,BOUNTY_SLUG,replaceWaveWithBounty} from '../dist/native-bounty.js';
import {buildPhasePlan,baseFunding,INFINITE_FUNDS} from '../dist/protocol.js';
import {commitExit} from '../dist/native-effects.js';
import {renderDecisionChoice} from '../dist/native-choices.js';

const entry=data.weeklyChallenges.entries.find(e=>e.challengeId==='bounty-takeover');
const weeklyChallenge=weeklyChallengeSnapshot(entry,Date.parse(entry.startsAt));
const make=options=>new NativeSession(data,{seed:42,bondBan:{bonds:[]},weeklyChallenge,...options});
function choose(g,index=1){const offer=g.s.roundDecisions[index];assert.ok(offer);assert.equal(g.perform('decision',offer.id),true);return offer;}
function start(g){assert.equal(g.perform('start'),true);assert.equal(g.s.phase,'battle');return g.battle;}
function killNext(b){const q=b.s.queue.shift();b.spawn(q);const enemy=b.s.enemies.at(-1);enemy.hp=0;commitExit(b,{target:enemy,reason:'death'});return enemy;}

test('下一期在 10 月 14 日至 21 日生效，与本周快照互不影响',()=>{
 assert.deepEqual(validateWeeklyChallengeSchedule(data.weeklyChallenges),[]);
 const start=Date.parse(entry.startsAt),end=Date.parse(entry.endsAt);
 assert.equal(weeklyChallengeAt(data.weeklyChallenges,start-1).challengeId,'deep-sea-era');
 assert.equal(weeklyChallengeAt(data.weeklyChallenges,start).challengeId,'bounty-takeover');
 assert.equal(weeklyChallengeAt(data.weeklyChallenges,end-1).challengeId,'bounty-takeover');
 assert.equal(weeklyChallengeAt(data.weeklyChallenges,end),null);
 assert.equal(weeklyBountyRules(weeklyChallenge).rewardMultiplier,3);
 assert.equal(weeklyBountyRules(data.weeklyChallenges.entries[0]),null);
 const normal=new NativeSession(data,{seed:42});assert.equal(normal.s.phase,'prep');
});

test('所有大厅难度从首轮起每轮只选择一次悬赏，原决策回合不会额外触发',()=>{
 for(const modeId of Object.keys(data.season.modeDataDict).filter(id=>id!=='mode_training_1')){
  const g=make({modeId});
  const turns=buildPhasePlan(data,modeId).filter(t=>!t.isConditional);
  for(const turn of turns){
   assert.equal(g.s.round,turn.round,modeId);assert.equal(g.s.phase,'decision');
   assert.equal(g.s.roundDecisionType,'bounty');assert.equal(g.s.roundDecisions.length,3);
   const original=structuredClone(g.s.roundDecisions);g.prepareRoundDecision();assert.deepEqual(g.s.roundDecisions,original);
   assert.equal(g.s.roundDecisionPool,turn.round<=7?'early':'late');
   const offer=choose(g);assert.equal(g.s.phase,'prep');assert.equal(g.s.weeklyBounty.enemyId,offer.enemyId);
   assert.equal(g.perform('decision',offer.id),false);g.startPreparation();assert.equal(g.s.phase,'prep');
   g.s.phase='intermission';assert.equal(g.advanceRound(),true);
  }
  assert.equal(g.s.phase,'finished');
 }
});

test('整轮替换保持数量、出场时间和红门，预览与实战使用同一队列',()=>{
 for(const map of data.maps.filter(m=>m.weight>0)){
  const g=make({mapId:map.stageId}),before=structuredClone(g.prepareDoorWaveQueue().queue),offer=choose(g);
  const preview=structuredClone(g.prepareDoorWaveQueue().queue);
  assert.equal(preview.length,before.length);assert.deepEqual(preview.map(q=>[q.at,q.door]),before.map(q=>[q.at,q.door]));
  assert.ok(preview.every(q=>q.id===offer.enemyId&&q.bountyReward===offer.coin));
  assert.deepEqual(start(g).s.queue,preview);
 }
 const routes=[{motionMode:'FLY',door:0},{motionMode:'WALK',door:0},{motionMode:'WALK',door:1},{motionMode:'FLY',door:1}],queue=[{id:'old',at:2,route:0,door:0},{id:'old',at:6,route:3,door:1}];
 const result=replaceWaveWithBounty(data,queue,routes,{enemyId:BOUNTY_SLUG,coin:0},r=>r.door);
 assert.deepEqual(result.map(q=>q.route),[1,2]);assert.equal(queue[0].id,'old');
});

test('完美三倍结算、漏失取消、零奖金和存档续战不重复发奖',()=>{
 const completed=make(),target=choose(completed),battle=start(completed),count=battle.s.queue.length;
 while(battle.s.queue.length)killNext(battle);completed.tick();assert.equal(completed.s.phase,'intermission');assert.equal(battle.s.bountyEarned,target.coin*count*3);
 for(const leaks of [0,1]){
  let g=make();const offer=choose(g),b=start(g);
  const first=killNext(b);commitExit(b,{target:first,reason:'death'});killNext(b);
  assert.equal(b.s.bountyPending,offer.coin*2);assert.equal(g.s.nextRoundBonus,0);
  g=NativeSession.restore(data,JSON.parse(JSON.stringify(g.snapshot())));assert.ok(g);
  assert.equal(g.battle.s.bountyPending,offer.coin*2);g.battle.s.leaks=leaks;g.battle.finish('complete');g.finishCurrentBattle();
  const earned=leaks?0:offer.coin*2*3;
  assert.equal(g.battle.s.bountyEarned,earned);assert.equal(g.s.nextRoundBonus,earned);
  assert.equal(g.s.history.at(-1).bountyEarned,earned);g.finishCurrentBattle();assert.equal(g.s.nextRoundBonus,earned);
  g.advanceRound();assert.equal(g.s.phase,'decision');choose(g);assert.equal(g.s.funds,baseFunding(2)+earned);
 }
 const zero=make();zero.s.round=8;zero.s.roundDecisions=[];zero.prepareRoundDecision();choose(zero,2);
 assert.equal(zero.s.weeklyBounty.coin,0);const b=start(zero);killNext(b);b.finish('complete');zero.finishCurrentBattle();assert.equal(zero.s.nextRoundBonus,0);
 const cat=make({cat:true});choose(cat);const cb=start(cat);killNext(cb);cb.finish('complete');cat.finishCurrentBattle();cat.advanceRound();choose(cat);assert.equal(cat.s.funds,INFINITE_FUNDS);
 const timeout=make();choose(timeout);const tb=start(timeout);killNext(tb);tb.spawn(tb.s.queue.shift());tb.s.time=tb.s.limit;tb.finish('timeout');timeout.finishCurrentBattle();assert.ok(timeout.s.history.at(-1).leaks>0);assert.equal(tb.s.bountyEarned,0);
 const unspawned=make();choose(unspawned);const ub=start(unspawned);killNext(ub);ub.s.time=ub.s.limit;ub.finish('timeout');unspawned.finishCurrentBattle();assert.equal(ub.s.bountyEarned,0,'超时不能因未出场目标尚未记为漏失而获奖');
});

test('最终回合只替换 30 名增援，Boss 本体保留；失败与漏失不发赏金',()=>{
 for(const bossId of ['boss_4','boss_5','boss_7'])for(const outcome of ['perfect','leak','timeout']){
  const g=make({finalBossId:bossId}),turn=buildPhasePlan(data,g.s.modeId).filter(t=>t.isBossTurn&&!t.isConditional).at(-1);
  g.s.round=turn.round;g.s.phase='prep';g.s.roundDecisions=[];g.startPreparation();const offer=choose(g,2);
  // 用非零、简单目标核对终局奖金，正常候选仍在前一测试中覆盖。
  const target=bountyOption(data,'enemy_10084_hlegle');assert.ok(target&&target.coin>0);
  g.s.weeklyBounty={round:turn.round,enemyId:target.enemyId,coin:target.coin};
  const preview=structuredClone(g.prepareDoorWaveQueue().queue);assert.equal(preview.length,30);
  const b=start(g);assert.equal(b.s.finalBossId,bossId);assert.ok(b.s.enemies.some(e=>e.finalBoss));
  assert.ok(b.s.queue.every(q=>q.id===target.enemyId));assert.deepEqual(b.s.queue,preview);assert.equal(offer.coin,0);
  killNext(b);b.s.leaks=outcome==='leak'?1:0;b.finish(outcome==='timeout'?'timeout':'boss-killed');g.finishCurrentBattle();
  assert.equal(g.s.phase,'finished');assert.equal(b.s.bountyEarned,outcome==='perfect'?target.coin*3:0);
  assert.equal(g.s.funds,outcome==='perfect'?target.coin*3:0);
 }
});

test('选择前后读档保留候选与目标，文案准确显示替换及三倍规则',()=>{
 const g=make(),offers=structuredClone(g.s.roundDecisions),before=NativeSession.restore(data,g.snapshot());assert.ok(before);assert.deepEqual(before.s.roundDecisions,offers);
 const selected=choose(before),after=NativeSession.restore(data,before.snapshot());assert.ok(after);
 assert.equal(after.s.phase,'prep');assert.deepEqual(after.s.weeklyBounty,before.s.weeklyBounty);
 after.startPreparation();assert.equal(after.s.phase,'prep');assert.ok(after.prepareDoorWaveQueue().queue.every(q=>q.id===selected.enemyId));
 const bad=structuredClone(after.snapshot());bad.s.weeklyBounty.coin=999;assert.equal(NativeSession.restore(data,bad),null);
 const html=renderDecisionChoice(data,offers,1,{type:'bounty',bountyRules:weeklyBountyRules(weeklyChallenge)});
 assert.match(html,/每回合固定一次/);assert.match(html,/最终 Boss 保留本体/);assert.match(html,/非完美无赏金/);assert.match(html,new RegExp(`完美通关每只获得 ${offers[0].coin*3}`));
 assert.doesNotMatch(html,/额外加入本轮|本次随机抽取/);
});
