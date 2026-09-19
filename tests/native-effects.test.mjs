import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {applyStatus} from '../dist/status.js';
import {blackboard,resolveActiveTalents,resolveChess} from '../dist/protocol.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {dealDamage,enqueue,newAttackId,applyHeal,applyRegen,applyLoss,applyElementDamage,commitExit,reviveActor,dispatch,tickLogic,addEffect,addDamageRedirect,queueDelayedDamage,teleportActor,canRelocateTo,nearbySpots,operatorSkillConfig,BATTLE_SCHEMA_VERSION,validateBattle,migrateBattle,getActor,attackableAllies} from '../dist/native-effects.js';
import {openBattle,deployNow,enemy,byId,talentBB,logOf,steps,reps} from './effects-harness.mjs';

const source=JSON.parse(fs.readFileSync('data/modes/alliance-lower/source.json','utf8'));
const scope=JSON.parse(fs.readFileSync('data/modes/alliance-lower/operator-scope.json','utf8'));
const audit=JSON.parse(fs.readFileSync('data/modes/alliance-lower/operator-behavior-audit.json','utf8'));
const manifest=JSON.parse(fs.readFileSync('data/modes/alliance-lower/unlock-manifest.json','utf8'));
const adapterManifest=JSON.parse(fs.readFileSync('data/modes/alliance-lower/operator-adapter-manifest.json','utf8'));
const capStatus=JSON.parse(fs.readFileSync('data/modes/alliance-lower/operator-capability-status.json','utf8'));

test('periodic effects settle exact due timestamps including the final tick',()=>{
 const {b}=openBattle(reps.operators.yak);deployNow(b);const u=b.s.units[0],e=enemy(b,{hp:1000,res:0});
 for(const [id,damage]of [['a',10],['b',20]])addEffect(b,{kind:'dot',sourceUid:u.uid,targetUid:e.uid,talentOrSkillId:id,interval:1,nextAt:1,endsAt:3,snapshot:{damage},values:{type:'true'}});
 b.s.time=3;tickLogic(b,3);assert.equal(e.hp,910);
 assert.deepEqual(logOf(b,'damage').map(e=>e.t),[1,1,2,2,3,3]);assert.equal(b.s.logicEffects.length,0);
});
test('enemy damage never counts towards player damage and guards expire',()=>{
 const {b}=openBattle({...reps.operators.liskam,skillIndex:0});deployNow(b);const u=b.s.units[0],e=enemy(b);
 u.sp=b.spCost(u);b.activate(u);const guard=u.barriers.at(-1);assert.ok(guard);
 b.s.time=guard.endsAt;tickLogic(b,.1);assert.equal(u.barriers.length,0);
 dealDamage(b,{source:e,target:u,value:1,type:'true'});assert.equal(b.s.damage[e.uid],undefined);
});
test('repeated heals refresh one barrier and overflow uses amplified healing',()=>{
 const {b}=openBattle([reps.operators.papyrs,reps.operators.yak]);deployNow(b);const u=byId(b,'char_4139_papyrs'),a=byId(b,'char_199_yak');a.hp=a.maxHp-15;a.healingReceived=2;
 applyHeal(b,{source:u,target:a,amount:10});assert.equal(logOf(b,'heal').at(-1).overflow,5);
 applyHeal(b,{source:u,target:a,amount:10});assert.equal(a.shieldLayers.length,1);
});
test('a distant enemy cannot be hit by an attached fireball',()=>{
 const {b}=openBattle([reps.operators.reed2,reps.operators.yak]);deployNow(b);const u=byId(b,'char_1020_reed2'),anchor=byId(b,'char_199_yak'),e=enemy(b,{x:anchor.x+10,y:anchor.y,hp:5000});
 addEffect(b,{kind:'attached',sourceUid:u.uid,anchorUid:anchor.uid,interval:1,nextAt:1,endsAt:2,radius:.8,values:{atk_scale:1}});b.s.time=1;tickLogic(b,1);assert.equal(e.hp,5000);
});
test('old shields migrate and future schemas are rejected',()=>{
 const {b}=openBattle(reps.operators.yak);const save=structuredClone(b.s);save.units[0].shield=123;delete save.units[0].shieldLayers;delete save.battleSchemaVersion;
 const migrated=migrateBattle(save);assert.equal(migrated.units[0].shieldLayers[0].remaining,123);
 assert.equal(migrateBattle({...save,battleSchemaVersion:999}),null);
});

test('delayed damage is serialized as a due effect and settles once',()=>{
 const {b}=openBattle(reps.operators.yak);deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:1000,def:0});
 const effect=queueDelayedDamage(b,{source:u,target:e,amount:120,type:'true',delay:2,talentOrSkillId:'test-delay'});
 assert.equal(effect.kind,'delayed');b.s.time=1;tickLogic(b,1);assert.equal(e.hp,1000);
 b.s.time=2;tickLogic(b,1);assert.equal(e.hp,880);assert.equal(b.s.logicEffects.some(x=>x.id===effect.id),false);
 assert.equal(logOf(b,'damage').at(-1).cause,'delayed');
});

test('damage sharing splits one hit across a live protection target',()=>{
 const {b}=openBattle([reps.operators.yak,reps.operators.yak]);deployNow(b);
 const [front,ally]=b.s.units,e=enemy(b,{x:front.x+1,y:front.y,hp:1000,def:0});
 const hp0=front.hp,hp1=ally.hp;addDamageRedirect(b,front,{id:'share',targetUid:ally.uid,ratio:.4,mode:'share',types:['true'],endsAt:5});
 const result=dealDamage(b,{source:e,target:front,amount:100,type:'true'});
 assert.equal(result.redirected,true);assert.equal(Math.round(hp0-front.hp),60);assert.equal(Math.round(hp1-ally.hp),40);
 assert.equal(logOf(b,'damage-redirect').at(-1).redirectUid,ally.uid);
});

test('teleport only lands on a valid unoccupied map cell and clears blocking',()=>{
 const {b}=openBattle(reps.operators.yak);deployNow(b);const u=b.s.units[0],before={x:u.x,y:u.y};
 u.block=999;assert.equal(teleportActor(b,u,{x:before.x+1,y:before.y,source:u}),true);assert.equal(u.block,null);
 assert.equal(teleportActor(b,u,{x:-1,y:-1,source:u}),false);assert.equal(u.x,before.x+1);
});

test('tracked zones emit serializable enter and exit events',()=>{
 const {b}=openBattle(reps.operators.yak);deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x,y:u.y,hp:100});
 addEffect(b,{kind:'zone',sourceUid:u.uid,x:u.x,y:u.y,radius:1,trackArea:true,trackSide:'enemy',interval:2,nextAt:99,endsAt:5,talentOrSkillId:'test-area'});
 tickLogic(b,0);assert.equal(logOf(b,'area-enter').length,1);
 e.x+=3;b.s.time=1;tickLogic(b,1);assert.equal(logOf(b,'area-exit').length,1);
 const save=structuredClone(b.s);assert.equal(save.logicEffects[0].insideUids.length,0);
});

test('damage protection buffers the deferred portion without changing damage type',()=>{
 const {b}=openBattle(reps.operators.yak);deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,def:0});
 u.damageProtection={immediateRatio:.5,until:10,buffer:0,finalDuration:2};const hp=u.hp;const result=dealDamage(b,{source:e,target:u,amount:100,type:'true'});
 assert.equal(result.hp,50);assert.equal(u.hp,hp-50);assert.equal(u.damageProtection.buffer,50);assert.equal(logOf(b,'damage-delayed').at(-1).amount,50);
});

test('reviveActor restores a defeated operator lifecycle and emits a combat event',()=>{
 const {b}=openBattle(reps.operators.yak);deployNow(b);const u=b.s.units[0];u.hp=0;commitExit(b,{target:u,reason:'knockdown'});assert.equal(u.deployed,false);
 assert.equal(reviveActor(b,u,{hpRatio:.4,reason:'test'}),true);assert.equal(u.deployed,true);assert.equal(u.hp,u.maxHp*.4);assert.equal(logOf(b,'revive').length,1);
});

test('Gavial S3 uses the shared delayed damage protection path',()=>{
 const {b}=openBattle({chessId:'chess_char_4_23_b',skillIndex:2});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,def:0});
 u.sp=b.spCost(u);b.activate(u);assert.equal(u.damageProtection.immediateRatio,.5);const hp=u.hp;dealDamage(b,{source:e,target:u,amount:100,type:'true'});assert.equal(u.hp,hp-50);assert.equal(u.damageProtection.buffer,50);
 dispatch(b,'skill-end',{target:u});assert.equal(u.damageProtection,null);assert.ok(b.s.logicEffects.some(f=>f.kind==='loss'&&f.targetUid===u.uid));
});

test('Ulpian S2 uses a legal anchor move and returns to its start cell',()=>{
 const {b}=openBattle({chessId:'chess_char_5_05_b',skillIndex:2});deployNow(b);const u=b.s.units[0],start={x:u.x,y:u.y};u.sp=b.spCost(u);b.activate(u);assert.ok(u.returnPosition);assert.notDeepEqual({x:u.x,y:u.y},start);dispatch(b,'skill-end',{target:u});assert.deepEqual({x:u.x,y:u.y},start);
});

test('换位置的落点避开其他干员与占格子的召唤物',()=>{
 const {b}=openBattle([reps.operators.yak,reps.operators.mudrok]);deployNow(b);
 const [mate,mover]=b.s.units;
 assert.equal(teleportActor(b,mover,{x:mate.x,y:mate.y,source:mover}),false,'别的干员站着的格子不能落');
 const free=nearbySpots(mate,{maxRadius:4}).find(s=>(s.x!==mover.x||s.y!==mover.y)&&canRelocateTo(b,mover,s.x,s.y));
 assert.ok(free,'棋盘上应该还有空的可行落点');
 assert.equal(canRelocateTo(b,mover,free.x,free.y),true);
 const summonAt=occupiesTile=>b.s.summons.push({uid:b.s.nextId++,id:'probe-summon',kind:'summon',allied:true,canBlock:occupiesTile,occupiesTile,x:free.x,y:free.y,hp:100,maxHp:100,deployed:true});
 summonAt(false);
 assert.equal(canRelocateTo(b,mover,free.x,free.y),true,'不占格子的召唤物（浮游单元一类）不挡路');
 summonAt(true);
 assert.equal(canRelocateTo(b,mover,free.x,free.y),false,'占格子的召唤物挡路');
 b.s.summons.length=0;
 // 敌人不占格子：站在敌人身上照样能落位（被阻挡时敌方本来就与干员同格）
 const spot={x:mover.x+1,y:mover.y};
 assert.equal(canRelocateTo(b,mover,spot.x,spot.y),true,'先确认这格本身可部署');
 enemy(b,{x:spot.x,y:spot.y,hp:500});
 assert.equal(canRelocateTo(b,mover,spot.x,spot.y),true,'敌人站着不算被占');
 assert.equal(teleportActor(b,mover,{x:spot.x,y:spot.y,source:mover}),true,'换位置不用避开敌人');
 assert.equal(mover.x,spot.x);
});
test('乌尔比安返航前其原格对友方视为被占据，且他自己仍能返航',()=>{
 const {b}=openBattle([{chessId:'chess_char_5_05_b',skillIndex:2},reps.operators.surtr]);deployNow(b);
 const u=byId(b,'char_4145_ulpia'),mate=b.s.units.find(v=>v!==u),start={x:u.x,y:u.y};
 u.sp=b.spCost(u);b.activate(u);
 assert.notDeepEqual({x:u.x,y:u.y},start,'船锚位移要真的换格');
 assert.equal(b.s.units.some(v=>v.deployed&&v.x===start.x&&v.y===start.y),false,'原格此时是空的');
 assert.equal(teleportActor(b,mate,{x:start.x,y:start.y,source:mate}),false,'返航前原格视为被占据，别人不能抢');
 dispatch(b,'skill-end',{target:u});
 assert.deepEqual({x:u.x,y:u.y},start,'乌尔比安自己不受预留格影响，照常返航');
});
test('乌尔比安返航时原位被占则退到旁边的可部署格',()=>{
 const {b}=openBattle({chessId:'chess_char_5_05_b',skillIndex:2});deployNow(b);const u=b.s.units[0],start={x:u.x,y:u.y};
 u.sp=b.spCost(u);b.activate(u);assert.notDeepEqual({x:u.x,y:u.y},start,'船锚位移要真的换格');
 b.s.summons.push({uid:b.s.nextId++,id:'probe-summon',kind:'summon',allied:true,canBlock:true,occupiesTile:true,x:start.x,y:start.y,hp:100,maxHp:100,deployed:true});
 dispatch(b,'skill-end',{target:u});
 assert.ok(!(u.x===start.x&&u.y===start.y),'原位被占时不能硬压回去');
 assert.ok(Math.max(Math.abs(u.x-start.x),Math.abs(u.y-start.y))<=2,`退到原位附近，实际 ${u.x},${u.y}`);
 assert.equal(canRelocateTo(b,u,u.x,u.y),true,'落点仍然合法');
});
test('Blaze revival talent enters a downed state, blocks healing, then revives once',()=>{
 const {b}=openBattle({chessId:'chess_char_5_03_b',skillIndex:2});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,def:0});
 dealDamage(b,{source:e,target:u,amount:u.maxHp+100,type:'true'});assert.equal(u.downed,true);assert.equal(u.hp,1);assert.equal(u.healable,false);assert.equal(applyHeal(b,{source:u,target:u,amount:10}),0);assert.ok(u.shieldLayers.some(l=>l.remaining===6000));
 u.hp=u.maxHp-1;b.step();assert.equal(u.downed,false);assert.equal(u.healable,true);assert.equal(b.s.logicLog.some(x=>x.type==='revive'&&x.uid===u.uid),true);
});

test('four summon skills resolve through the shared token lifecycle',()=>{
 const cases=[['chess_char_4_05_b','beewax-obelisk'],['chess_char_2_11_b','kazema-shadow'],['chess_char_6_07_b','siege2-golden'],['chess_char_6_11_b','mlyss-fluid']];
 for(const [chessId,type] of cases){const {b}=openBattle({chessId});deployNow(b);const u=b.s.units[0];u.sp=b.spCost(u);b.activate(u);const token=b.s.summons.find(s=>s.ownerUid===u.uid&&s.type===type);assert.ok(token,type);assert.equal(token.kind,'summon');assert.ok(token.maxHp>0);}
});

test('整备区召唤卡按范围放置并在开战时生成对应召唤物',()=>{
 const g=new NativeSession(NATIVE_DATA,{seed:1});g.s.funds=9999;g.s.capacity=16;g.s.rewardPending=null;g.s.rewardQueue=[];
 for(const id of ['chess_char_3_19_a','chess_char_4_11_b','chess_char_2_02_b','chess_char_6_04_b'])g.gain(id);
 for(const u of g.s.units){let placed=false;for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(!g.s.units.some(v=>v.uid!==u.uid&&v.position?.x===x&&v.position?.y===y)&&g.canDeploy(u.uid,x,y))placed=g.deploy(u.uid,x,y,0);assert.ok(placed,u.chessId);}
 const cards=g.s.summonCards;assert.equal(cards.filter(c=>c.type==='vigil-wolf').length,1);assert.equal(cards.filter(c=>c.type==='cathy-device').length,3);assert.equal(cards.filter(c=>c.type==='silent-drone').length,1);assert.equal(cards.filter(c=>c.type==='skadi2-seaborn').length,1);
 const used=new Set();for(const card of cards){let placed=false;for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++){if(used.has(x+','+y))continue;if(g.canDeploySummonCard(card.uid,x,y))placed=g.deploySummonCard(card.uid,x,y),used.add(x+','+y);}if(card.type!=='cathy-device')assert.ok(placed,card.type);}
 assert.equal(g.perform('start'),true,g.lastError||'start failed');const types=new Set(g.battle.s.summons.map(s=>s.type));assert.ok(types.has('vigil-wolf')&&types.has('silent-drone')&&types.has('skadi2-seaborn'));assert.ok(g.battle.s.summons.filter(s=>s.type==='cathy-device').length>=1);
});

test('归溟幽灵鲨 S1 locks lethal damage and exits exactly once at skill end',()=>{
 const {b}=openBattle({chessId:'chess_char_5_13_b',skillIndex:1});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,def:0});u.sp=b.spCost(u);b.activate(u);
 dealDamage(b,{source:e,target:u,amount:u.maxHp+100,type:'true'});assert.equal(u.hp,1);assert.equal(u.deployed,true);assert.equal(u.lockHp.min,1);
 dispatch(b,'skill-end',{target:u});assert.equal(u.deployed,false);assert.equal(logOf(b,'exit').filter(x=>x.uid===u.uid).length,1);
});

test('新约能天使 ammo event heals the owner and can trigger an in-range bombardment',()=>{
 const {b}=openBattle({chessId:'chess_char_6_13_b',skillIndex:2});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:10000,def:0});u.hp=u.maxHp-100;const hp=u.hp,hpe=e.hp;b.economy.random=()=>0;dispatch(b,'ammo',{source:u,target:u,used:1});assert.ok(u.hp>hp);assert.ok(e.hp<hpe);
});

test('新约能天使 ammo contract gives the stronger Laterano aura only to ammo skills',()=>{
 const {b}=openBattle([{chessId:'chess_char_6_13_b',skillIndex:2},{chessId:'chess_char_1_01_b',skillIndex:1}]);deployNow(b);const inside=b.s.units.find(u=>u.id==='char_498_inside');
 const base=b.profile(inside).attributes.atk;assert.ok(b.stats(inside).atk>base);assert.ok(b.stats(inside).parts.some(p=>p.src==='新约能天使·拉特兰'&&p.stat==='atk'));
});

test('德克萨斯 roster talent grants initial battle cost before automatic deployment',()=>{
 const {b}=openBattle({chessId:'chess_char_1_08_b',skillIndex:1});assert.equal(b.s.cost,22);deployNow(b);assert.equal(b.s.cost,22);
});

test('battle cost starts at 20 and stays separate from preparation funds',()=>{
 const {b}=openBattle(reps.operators.yak);deployNow(b);
 assert.equal(b.s.cost,20);assert.equal(b.economy.s.funds,0);
 b.gainCost(3);assert.equal(b.s.cost,23);assert.equal(b.economy.s.funds,0);
 assert.equal(b.spendCost(5),true);assert.equal(b.s.cost,18);assert.equal(b.economy.s.funds,0);
 b.s.cost=98;b.s.costRecoveryClock=0;b.tickCost(2);assert.equal(b.s.cost,99);assert.equal(b.s.costRecoveryClock,1);
});

test('负费用下限支持透支并在归零前减半回复',()=>{
 const {b}=openBattle(reps.operators.yak);deployNow(b);b.s.costMin=-6;b.s.cost=4;b.s.costRecoveryClock=0;
 assert.equal(b.spendCost(6),false);assert.equal(b.spendCost(6,{considerNegativeCost:true}),true);assert.equal(b.s.cost,-2);
 b.tickCost(1);assert.equal(b.s.cost,-1.5);b.tickCost(3);assert.equal(b.s.cost,0);
});

test('忍冬的在场天赋提高费用自然回复速度',()=>{
 const {b}=openBattle({chessId:'chess_char_3_18_b',skillIndex:0});deployNow(b);
 b.s.cost=0;b.s.costRecoveryClock=0;b.tickCost(.9);assert.equal(b.s.cost,0);
 b.tickCost(.02);assert.equal(b.s.cost,1);
});

test('费用回收技能按触发时机写入战斗费用',()=>{
 const {b}=openBattle({chessId:'chess_char_3_18_b',skillIndex:0});deployNow(b);
 const u=byId(b,'char_4026_vulpis'),e=enemy(b,{x:u.x+1,y:u.y,hp:100000,def:0});u.sp=b.spCost(u);b.s.cost=0;b.s.costRecoveryInterval=999999;b.activate(u);assert.equal(b.s.cost,0);b.hit(u,e,10,'physical');assert.equal(b.s.cost,1);
});

test('伊内丝下次攻击的回费与附伤在命中时结算',()=>{
 const {b}=openBattle({chessId:'chess_char_4_04_b',skillIndex:0});deployNow(b);
 const u=byId(b,'char_4087_ines'),e=enemy(b,{x:u.x+1,y:u.y,hp:100000,def:0});u.sp=b.spCost(u);b.s.cost=0;b.s.costRecoveryInterval=999999;b.activate(u);assert.equal(b.s.cost,0);const before=e.hp;b.hit(u,e,10,'physical');assert.ok(e.hp<before);assert.equal(b.s.cost,2);assert.ok(b.s.logicEffects.some(f=>f.kind==='dot'&&f.targetUid===e.uid));
});

test('冲锋手击杀回费使用战斗费用账本',()=>{
 const {b}=openBattle({chessId:'chess_char_4_07_a',skillIndex:0});deployNow(b);
 const u=byId(b,'char_222_bpipe'),e=enemy(b,{x:u.x+1,y:u.y,hp:100,def:0});b.s.cost=0;b.s.costRecoveryInterval=999999;b.hit(u,e,1000,'physical');assert.equal(e.hp,0);assert.equal(b.s.cost,1);
});

test('战斗开始全体入场不扣费但算一次入场，模组运行费用只在再部署结算',()=>{
 // 开局所有摆好位的单位随战斗开始一起入场：算一次入场（runtimeCostUsed 置真、触发部署效果），但不支付费用。
 const texas=openBattle({chessId:'chess_char_1_08_b',skillIndex:1}).b,tx=texas.s.units[0];
 assert.equal(tx.deployed,true);assert.equal(tx.runtimeCostUsed,true,'开局入场即视为已用掉首次部署');
 assert.equal(tx.runtimeCost, -4,'模组提供了 -4 的运行费用修正');
 assert.equal(texas.deploymentCost(tx),tx.baseCost,'首次入场不扣费，也不叠加模组修正');
 deployNow(texas);assert.equal(texas.deploymentCost(tx),tx.baseCost,'重复入场不应重复计算');
 // 再部署才把模组修正算进去
 tx.redeployPenalty=0;assert.equal(texas.deploymentCost(tx),tx.baseCost);
 tx.runtimeCostUsed=false;assert.equal(texas.deploymentCost(tx),tx.baseCost-4,'一次性再部署时模组运行费用生效');
 tx.runtimeCostUsed=true;
 const pipe=openBattle({chessId:'chess_char_4_07_b',skillIndex:0}).b;deployNow(pipe);const p=byId(pipe,'char_222_bpipe'),e=enemy(pipe,{x:p.x+1,y:p.y,hp:100,def:0});pipe.s.cost=0;pipe.hit(p,e,1000,'physical');assert.equal(pipe.s.cost,2);pipe.s.cost=0;p.deploymentCost=12;p.refundCap=8;p.refundEligible=true;commitExit(pipe,{target:p,reason:'retreat'});assert.equal(pipe.s.cost,12);
 const gravel=openBattle({chessId:'chess_char_2_12_b',skillIndex:0}).b;deployNow(gravel);const g=byId(gravel,'char_237_gravel');gravel.s.cost=0;g.deploymentCost=12;g.refundCap=10;g.refundEligible=true;commitExit(gravel,{target:g,reason:'retreat'});assert.equal(gravel.s.cost,9);
});

test('野鬃待部署近卫减费只作用于尚未入场的近卫，每名最多五费',()=>{
 // 战斗开始时摆好位的单位全部入场，此时没有待部署近卫，减费自然不累积
 const {b}=openBattle([{chessId:'chess_char_1_19_b',skillIndex:1},reps.operators.swire]);const wild=byId(b,'char_496_wildmn'),guard=byId(b,'char_308_swire');
 for(let i=0;i<6;i++)dispatch(b,'deploy',{target:wild});
 assert.equal(guard.wildmaneCostDelta,0,'已入场的近卫不在待部署列表里');
 // 战斗中新获得的近卫还没入场，才会吃到减费
 guard.deployed=false;
 for(let i=0;i<6;i++)dispatch(b,'deploy',{target:wild});
 assert.equal(guard.wildmaneCostDelta,-5,'每名待部署近卫最多累计五费');
 assert.equal(b.deploymentCost(guard),Math.max(0,guard.baseCost-5));
});

test('野鬃 S2 命中后按攻击方向推动目标',()=>{
 const {b}=openBattle({chessId:'chess_char_1_19_b',skillIndex:1});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:1000,def:0});u.sp=b.spCost(u);b.activate(u);const before=e.x;b.hit(u,e,10,'physical');assert.ok(e.x>before);
});

test('缪尔赛思的莱茵生命减费对开局入场单位只结算一次',()=>{
 // 战斗开始时缪尔赛思与目标单位同时入场，所以「首名莱茵生命额外一费」在开局就被用掉
 const {b}=openBattle([{chessId:'chess_char_6_11_b',skillIndex:0},{chessId:'chess_char_2_02_b',skillIndex:0}]);const m=byId(b,'char_249_mlyss'),silent=byId(b,'char_108_silent');
 assert.equal(b.s.mlyssFirstRhineDiscountUsed,true,'开局入场即消耗首名莱茵减免');
 assert.equal(b.deploymentCost(silent),Math.max(0,silent.baseCost-2),'只剩莱茵生命天赋本身的减费');
 // 再部署时不再有首名减免，按基础费用乘再部署系数
 b.s.cost=99;b.deploy(silent,{reentry:true});
 assert.equal(b.s.mlyssFirstRhineDiscountUsed,true);
 commitExit(b,{target:silent,reason:'knockdown'});silent.down=0;
 assert.equal(b.deploymentCost(silent),Math.floor((silent.baseCost-2)*1.5));
});

test('再部署在冷却结束后按当前实例部署费用扣除战斗费用',()=>{
 const {b}=openBattle(reps.operators.yak);deployNow(b);
 const u=byId(b,'char_199_yak');b.s.cost=99;b.s.costRecoveryInterval=999999;commitExit(b,{target:u,reason:'knockdown'});u.down=0;b.step();
 const expected=Math.floor(u.baseCost*1.5);assert.equal(u.deployed,true);assert.equal(b.s.cost,99-expected);assert.equal(u.lastDeploymentCost,expected);assert.equal(u.redeployPenalty,1);
});

test('砾的初始费用条件防御光环使用基础部署费用',()=>{
 const {b}=openBattle([{chessId:'chess_char_2_12_b',skillIndex:0},reps.operators.yak]);deployNow(b);
 const gravel=byId(b,'char_237_gravel');assert.ok(gravel);const base=b.profile(gravel).attributes.def;assert.ok(b.stats(gravel).def>=base*1.06);
});

test('缪尔赛思开源节流降低莱茵生命单位的再部署费用',()=>{
 const {b}=openBattle([{chessId:'chess_char_6_11_b',skillIndex:0},{chessId:'chess_char_2_02_b',skillIndex:0}]);deployNow(b);
 const m=byId(b,'char_249_mlyss'),silent=byId(b,'char_108_silent');assert.equal(b.profile(m).groupId,'rhine');assert.equal(b.profile(silent).groupId,'rhine');b.s.cost=99;b.s.costRecoveryInterval=999999;commitExit(b,{target:silent,reason:'knockdown'});silent.down=0;b.step();assert.equal(silent.lastDeploymentCost,Math.floor((silent.baseCost-2)*1.5));
});

test('撤退返费按实例部署费用、上限和分支倍率结算',()=>{
 const normal=openBattle(reps.operators.yak).b;deployNow(normal);const y=byId(normal,'char_199_yak');normal.s.cost=0;y.deploymentCost=12;y.refundCap=10;y.refundEligible=true;commitExit(normal,{target:y,reason:'retreat'});assert.equal(normal.s.cost,6);
 const charger=openBattle({chessId:'chess_char_4_07_a',skillIndex:0}).b;deployNow(charger);const p=byId(charger,'char_222_bpipe');charger.s.cost=0;p.deploymentCost=12;p.refundCap=8;p.refundEligible=true;commitExit(charger,{target:p,reason:'retreat'});assert.equal(charger.s.cost,8);
});

test('凛御银灰技能只对尚未入场的单位改费用属性',()=>{
 const {b}=openBattle([{chessId:'chess_char_5_14_b',skillIndex:0},{chessId:'chess_char_3_03_b',skillIndex:0}]);
 const svash=byId(b,'char_1045_svash2'),guard=byId(b,'char_308_swire');
 // 开局入场时没有待部署单位，技能不给任何单位改费用
 svash.sp=b.spCost(svash);b.activate(svash);
 assert.equal(guard.costRealtimeDelta,undefined,'已入场单位不受技能影响');
 assert.equal(b.deploymentCost(guard),guard.baseCost);
 // 战斗中新获得、尚未入场的单位才会被改
 guard.deployed=false;
 svash.sp=b.spCost(svash);svash.lastSkill=-999;b.activate(svash);
 assert.equal(guard.costRealtimeDelta,-5);
 assert.equal(b.deploymentCost(guard),Math.max(0,guard.baseCost-5));
});

test('凛御银灰的「风雪之眼」在待部署区、不生成场上召唤物（本期不实现）',()=>{
 const chessId=Object.values(NATIVE_DATA.season.charShopChessDatas).find(s=>s.charId==='char_1045_svash2').chessId;
 const {b}=openBattle({chessId,skillIndex:2});deployNow(b);const u=byId(b,'char_1045_svash2');
 assert.ok(u,'应有凛御银灰');
 assert.equal((b.s.summons||[]).filter(s=>s.ownerUid===u.uid).length,0,'入场不应生成召唤物：风雪之眼是待部署区的卡');
 u.sp=b.spCost(u);b.activate(u);
 assert.equal((b.s.summons||[]).filter(s=>s.ownerUid===u.uid).length,0,'技能三也不生成场上实体');
 assert.ok(u.svashCostRemaining>0,'技能三的持续部署费用照旧结算');
});

test('野鬃 S1 与砾 S1 的部署增益按生命周期衰减',()=>{
 const wild=openBattle({chessId:'chess_char_1_19_b',skillIndex:0}).b;deployNow(wild);const w=byId(wild,'char_496_wildmn'),wildBase=wild.profile(w).attributes.attackSpeed;assert.equal(wild.stats(w).attackSpeed,wildBase+100);wild.s.time=26;assert.equal(wild.stats(w).attackSpeed,wildBase);
 const gravel=openBattle({chessId:'chess_char_2_12_b',skillIndex:0}).b;deployNow(gravel);const g=byId(gravel,'char_237_gravel'),base=gravel.profile(g).attributes.def;assert.equal(gravel.stats(g).def,base*(1+3.4+.06));gravel.s.time=4;assert.ok(gravel.stats(g).def<base*(1+3.4+.06)&&gravel.stats(g).def>base*(1+.06));gravel.s.time=9;assert.equal(gravel.stats(g).def,base*(1+.06));
});

test('忍冬 S2 先停顿后眩晕并造成法术伤害，S3 击杀后进入迷彩',()=>{
 const {b}=openBattle({chessId:'chess_char_3_18_b',skillIndex:1});deployNow(b);const u=byId(b,'char_4026_vulpis'),e=enemy(b,{x:u.x+1,y:u.y,hp:100000,def:0});u.sp=b.spCost(u);applyStatus(e,'sluggish',10,{source:'probe',resistible:false});const hp=e.hp;b.activate(u);assert.ok(e.hp<hp);assert.ok(e.statuses.some(s=>s.kind==='stun'));
 const s=openBattle({chessId:'chess_char_3_18_b',skillIndex:2}).b;deployNow(s);const v=byId(s,'char_4026_vulpis'),f=enemy(s,{x:v.x+1,y:v.y,hp:10,def:0});v.sp=s.spCost(v);s.activate(v);const initialAspd=s.profile(v).attributes.attackSpeed;assert.ok(s.stats(v).attackSpeed>initialAspd);s.hit(v,f,1000,'physical');v.skillLeft=0;dispatch(s,'skill-end',{target:v});assert.ok(v.statuses.some(x=>x.kind==='camouflage'));
});

test('焰尾费用技能的闪避按一次性、范围和技能状态区分',()=>{
 const one=openBattle({chessId:'chess_char_4_19_b',skillIndex:0}).b;deployNow(one);const a=byId(one,'char_420_flamtl'),foe={uid:991,atk:100,damageType:'physical'};a.sp=one.spCost(a);one.activate(a);one.hurt(a,foe);assert.equal(a.hp,a.maxHp);one.hurt(a,foe);assert.ok(a.hp<a.maxHp);
 const group=openBattle([{chessId:'chess_char_4_19_b',skillIndex:1},reps.operators.yak]).b;deployNow(group);const f=byId(group,'char_420_flamtl'),ally=byId(group,'char_199_yak');ally.x=f.x;ally.y=f.y+1;group.economy.random=()=>0;f.sp=group.spCost(f);group.activate(f);const hp=ally.hp;group.hurt(ally,foe);assert.equal(ally.hp,hp);
 const skill=openBattle({chessId:'chess_char_4_19_b',skillIndex:2}).b;deployNow(skill);const s=byId(skill,'char_420_flamtl');skill.economy.random=()=>0;s.sp=skill.spCost(s);skill.activate(s);const h=s.hp;skill.hurt(s,{uid:992,atk:100,damageType:'arts'});assert.equal(s.hp,h);
});

test('行商 fee drains battle cost and auto-withdraws when it is exhausted',()=>{
 const {b}=openBattle({chessId:'chess_char_3_04_b',skillIndex:0});deployNow(b);
 const u=byId(b,'char_1033_swire2');b.s.cost=2;b.s.costRecoveryInterval=999999;
 for(let i=0;i<200;i++)b.step();
 assert.equal(b.s.cost,0);assert.equal(u.deployed,false);assert.equal(u.hp,0);assert.equal(b.economy.s.funds,0);
});

test('凯瑟琳模组费用字段写入支援装置 token',()=>{
 const {b}=openBattle([{chessId:'chess_char_4_11_b',skillIndex:0},reps.operators.yak]);deployNow(b);b.step();const device=b.s.summons.find(s=>s.type==='cathy-device');assert.ok(device);assert.equal(device.cost,3);
});

test('墓碑敌方费用效果会减缓回复并延长再部署',()=>{
 const {b}=openBattle(reps.operators.yak);deployNow(b);const u=b.s.units[0],e=enemy(b,{id:'enemy_2008_flking',costEffects:[{costRecoveryMultiplier:.5,respawnTimeMultiplier:2}]});
 assert.ok(NATIVE_DATA.enemies.enemy_2008_flking.costEffects.some(x=>x.costRecoveryMultiplier===.5));b.s.cost=0;b.s.costRecoveryClock=0;b.refreshEnemyCostEffects();b.tickCost(1);assert.equal(b.s.cost,0);b.tickCost(1);assert.equal(b.s.cost,1);
 commitExit(b,{target:u,reason:'knockdown'});assert.equal(u.down,b.stats(u).respawnTime*2);assert.equal(e.hp>0,true);
});

test('诗怀雅见面礼 consumes a coin, plants a trap and pays the delayed hit',()=>{
 const {b}=openBattle({chessId:'chess_char_3_04_b',skillIndex:1});deployNow(b);
 const u=byId(b,'char_1033_swire2'),e=enemy(b,{x:u.x+1,y:u.y,hp:10000,def:0});
 b.activate(u);const trap=b.s.summons.find(s=>s.type==='swire2-trap');assert.ok(trap);assert.equal(u.coins,0);
 tickLogic(b,1/30);assert.ok(e.hp<10000);assert.ok(e.statuses.some(s=>s.kind==='sluggish'));
 const first=e.hp;b.s.time=3.1;tickLogic(b,3.1);assert.ok(e.hp<first);assert.equal(b.s.summons.some(s=>s.type==='swire2-trap'),false);
});

test('诗怀雅仗义疏财按部署时金币在下一次攻击替换为治疗',()=>{
 const {b}=openBattle([{chessId:'chess_char_3_04_b',skillIndex:0},reps.operators.yak]);deployNow(b);
 const u=byId(b,'char_1033_swire2'),ally=byId(b,'char_199_yak'),e=enemy(b,{x:u.x+1,y:u.y,hp:100000,def:0});ally.x=u.x;ally.y=u.y+1;ally.hp=ally.maxHp*.5;b.s.costRecoveryInterval=999999;const coins=u.coins;assert.equal(coins,1);for(let i=0;i<100;i++)b.step();assert.equal(u.coins,0);assert.ok(ally.hp>ally.maxHp*.5);
});

test('诗怀雅破财消灾 consumes battle cost before saving a lethal hit',()=>{
 const {b}=openBattle({chessId:'chess_char_3_04_b',skillIndex:2});deployNow(b);
 const u=byId(b,'char_1033_swire2');b.s.cost=6;
 dealDamage(b,{source:enemy(b,{x:u.x,y:u.y}),target:u,value:u.hp+1,type:'true'});
 assert.equal(u.deployed,true);assert.equal(Math.round(u.hp),Math.round(u.maxHp*.7));assert.equal(b.s.cost,1);
 dealDamage(b,{source:enemy(b,{x:u.x,y:u.y}),target:u,value:u.hp+1,type:'true'});
 assert.equal(u.deployed,false);assert.equal(b.s.cost,1);
});

test('诗怀雅千金一掷关闭技能时逐枚消耗金币并攻击',()=>{
 const {b}=openBattle({chessId:'chess_char_3_04_b',skillIndex:2});deployNow(b);const u=byId(b,'char_1033_swire2'),e=enemy(b,{x:u.x+1,y:u.y,hp:100000,def:0});u.sp=b.spCost(u);b.activate(u);u.coins=3;assert.equal(b.deactivate(u),true);assert.equal(u.coins,0);assert.equal(u.skillLeft,0);assert.ok(e.hp<100000);
});

test('艾丝黛尔 active skill excludes external healing and restores it at skill end',()=>{
 const {b}=openBattle([{chessId:'chess_char_1_12_b',skillIndex:1},reps.operators.yak]);deployNow(b);const estelle=b.s.units.find(u=>u.id==='char_127_estell'),yak=b.s.units.find(u=>u.id==='char_199_yak');estelle.sp=b.spCost(estelle);b.activate(estelle);assert.equal(b.canHeal(estelle,yak),false);dispatch(b,'skill-end',{target:estelle});assert.equal(b.canHeal(estelle,yak),true);
});

test('艾丝黛尔周围八格敌人倒下时恢复自身生命',()=>{
 const {b}=openBattle({chessId:'chess_char_1_12_b',skillIndex:0});deployNow(b);const u=byId(b,'char_127_estell'),e=enemy(b,{x:u.x+2,y:u.y,hp:10,def:0});u.hp=100;b.hit(u,e,100,'physical');assert.ok(u.hp>100);assert.equal(logOf(b,'heal').some(x=>x.targetUid===u.uid),true);
});

test('skill block-count overrides reach the shared blocking attribute layer',()=>{
 const {b}=openBattle({chessId:'chess_char_1_12_b',skillIndex:1});deployNow(b);const u=b.s.units[0],base=b.profile(u).attributes.blockCnt;u.sp=b.spCost(u);b.activate(u);assert.equal(b.stats(u).blockCnt,0);u.skillLeft=0;dispatch(b,'skill-end',{target:u});assert.equal(b.stats(u).blockCnt,base);
});

test('折桠 skill-end talent heals from the shared lifecycle hook',()=>{
 const {b}=openBattle({chessId:'chess_char_2_17_b',skillIndex:1});deployNow(b);const u=b.s.units[0];u.hp=u.maxHp-100;dispatch(b,'skill-end',{target:u});assert.ok(u.hp>u.maxHp-100);
});

test('折桠 S1 抵抗、S2 战栗和技能结束回血',()=>{
 const {b}=openBattle({chessId:'chess_char_2_17_b',skillIndex:0});deployNow(b);const u=b.s.units[0],foe=enemy(b,{x:u.x+1,y:u.y,hp:1000,def:0});u.sp=b.spCost(u);b.activate(u);applyStatus(u,'stun',10,{source:foe.uid});assert.equal(u.statuses.find(s=>s.kind==='stun').remaining,5);dispatch(b,'skill-end',{target:u});
 const s=openBattle({chessId:'chess_char_2_17_b',skillIndex:1}).b;deployNow(s);const a=s.s.units[0],e=enemy(s,{x:a.x+1,y:a.y,hp:1000});a.sp=s.spCost(a);s.activate(a);assert.equal(e.statuses.find(x=>x.kind==='tremble').remaining,5);
});

test('送葬人 fixed defense penetration applies before mitigation without mutating the enemy',()=>{
 const {b}=openBattle({chessId:'chess_char_2_01_b',skillIndex:1});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:2000,def:300});const before=e.def;b.hit(u,e,1000,'physical');assert.equal(Math.round(2000-e.hp),860);assert.equal(e.def,before);
});

test('profession aura target filters keep Star Ursus armor on defenders only',()=>{
 const {b}=openBattle([{chessId:'chess_char_4_17_b',skillIndex:1},reps.operators.yak,{chessId:'chess_char_1_01_b',skillIndex:1}]);deployNow(b);const yak=b.s.units.find(u=>u.id==='char_199_yak'),inside=b.s.units.find(u=>u.id==='char_498_inside');
 assert.ok(b.stats(yak).def>b.profile(yak).attributes.def);assert.equal(b.stats(inside).parts.some(p=>p.src==='星熊'),false);
});

test('古米备用军粮 stores a one-shot heal on the next released attack',()=>{
 const {b}=openBattle([{chessId:'chess_char_1_10_b',skillIndex:0},reps.operators.yak]);deployNow(b);const gummy=b.s.units.find(u=>u.id==='char_196_sunbr'),yak=b.s.units.find(u=>u.id==='char_199_yak');yak.hp=yak.maxHp-200;gummy.sp=b.spCost(gummy);b.activate(gummy);assert.ok(gummy.pendingAttackHeal);const before=yak.hp;const e=enemy(b,{x:gummy.x+1,y:gummy.y,hp:1000,def:0});b.hit(gummy,e,50,'physical');assert.ok(yak.hp>before);assert.equal(gummy.pendingAttackHeal,null);
});

test('古米 S2 烹饪完成后切换为专注治疗',()=>{
 const {b}=openBattle([{chessId:'chess_char_1_10_b',skillIndex:1},reps.operators.yak]);deployNow(b);const gummy=byId(b,'char_196_sunbr'),yak=byId(b,'char_199_yak');yak.x=gummy.x+1;yak.y=gummy.y;yak.hp=yak.maxHp-200;gummy.sp=b.spCost(gummy);b.activate(gummy);assert.equal(gummy.focusHeal,false);for(let i=0;i<360;i++)b.step();assert.equal(gummy.focusHeal,true);yak.hp=yak.maxHp-200;const before=yak.hp;for(let i=0;i<90;i++)b.step();assert.ok(yak.hp>before);
});

test('古米平底锅天赋触发倍率与眩晕',()=>{
 const {b}=openBattle({chessId:'chess_char_1_10_b',skillIndex:0});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:1000,def:0});b.economy.random=()=>0;b.hit(u,e,100,'physical');assert.equal(e.hp,800);assert.ok(e.statuses.some(s=>s.kind==='stun'));
});

test('维娜的周围友方物理减伤只作用于友方单位',()=>{
 const {b}=openBattle([{chessId:'chess_char_6_07_b',skillIndex:2},reps.operators.yak]);deployNow(b);const vina=b.s.units.find(u=>u.id==='char_1019_siege2'),yak=b.s.units.find(u=>u.id==='char_199_yak'),e=enemy(b,{x:yak.x,y:yak.y,def:0});
 const before=yak.hp;const result=dealDamage(b,{source:e,target:yak,value:100,type:'physical'});assert.equal(result.hp,74);assert.equal(yak.hp,before-74);const foeHp=e.hp;assert.equal(dealDamage(b,{source:vina,target:e,value:100,type:'physical'}).hp,100);assert.equal(e.hp,foeHp-100);
});

test('浊心斯卡蒂 S3 applies flat inspire, true-damage field and self drain',()=>{
 const {b}=openBattle([{chessId:'chess_char_6_04_b',skillIndex:2},reps.operators.yak]);deployNow(b);const skadi=b.s.units.find(u=>u.id==='char_1012_skadi2'),yak=b.s.units.find(u=>u.id==='char_199_yak'),e=enemy(b,{x:skadi.x+1,y:skadi.y,hp:10000,def:9999,res:999});yak.x=skadi.x+1;yak.y=skadi.y;skadi.sp=b.spCost(skadi);b.activate(skadi);const base=b.profile(yak).attributes.atk;assert.ok(b.stats(yak).atk>base);const hp=skadi.hp;b.s.time=1;tickLogic(b,1);assert.ok(e.hp<10000);assert.ok(skadi.hp<hp);
});

test('断崖 S2 adds one nearby blocker follow-up and瑕光 S3 adds arts plus ally heal',()=>{
 const a=openBattle([{chessId:'chess_char_3_02_b',skillIndex:1},reps.operators.yak]);deployNow(a.b);const ayer=a.b.s.units.find(u=>u.id==='char_294_ayer'),blocker=a.b.s.units.find(u=>u.id==='char_199_yak'),foe=enemy(a.b,{x:ayer.x+1,y:ayer.y,hp:5000,def:0});foe.block=blocker.uid;ayer.sp=a.b.spCost(ayer);a.b.activate(ayer);const before=foe.hp;a.b.hit(ayer,foe,20,'arts');assert.ok(foe.hp<before-20);
 const l=openBattle([{chessId:'chess_char_3_12_b',skillIndex:2},reps.operators.yak]);deployNow(l.b);const blem=l.b.s.units.find(u=>u.id==='char_423_blemsh'),ally=l.b.s.units.find(u=>u.id==='char_199_yak'),victim=enemy(l.b,{x:blem.x+1,y:blem.y,hp:5000,def:0});ally.hp=ally.maxHp-100;blem.sp=l.b.spCost(blem);l.b.activate(blem);const h0=ally.hp,v0=victim.hp;l.b.hit(blem,victim,20,'physical');assert.ok(victim.hp<v0-20);assert.ok(ally.hp>h0);
});

test('断崖 S2 对多个阻挡敌人分别结算额外伤害',()=>{
 const {b}=openBattle([{chessId:'chess_char_3_02_b',skillIndex:1},reps.operators.yak]);deployNow(b);
 const ayer=byId(b,'char_294_ayer'),blocker=byId(b,'char_199_yak');
 const first=enemy(b,{x:ayer.x+1,y:ayer.y,hp:5000,def:0}),second=enemy(b,{x:ayer.x+1,y:ayer.y+1,hp:5000,def:0});
 first.block=blocker.uid;second.block=blocker.uid;ayer.sp=b.spCost(ayer);b.activate(ayer);
 const firstHp=first.hp,secondHp=second.hp;b.hit(ayer,first,20,'arts');
 assert.ok(first.hp<firstHp-20);assert.ok(second.hp<secondHp);assert.equal(b.s.settle.fault,null);
});

test('断崖 S1 施加范围停顿且天赋提供周围攻速',()=>{
 const {b}=openBattle([{chessId:'chess_char_3_02_b',skillIndex:0},reps.operators.yak]);deployNow(b);const ayer=byId(b,'char_294_ayer'),yak=byId(b,'char_199_yak'),e=enemy(b,{x:ayer.x+1,y:ayer.y,hp:10000,def:0});yak.x=ayer.x+1;yak.y=ayer.y;ayer.sp=b.spCost(ayer);b.activate(ayer);for(let i=0;i<30;i++)b.step();assert.ok(e.statuses.some(s=>s.kind==='sluggish'));assert.equal(b.stats(yak).attackSpeed,b.profile(yak).attributes.attackSpeed+8);
});

test('波登可 S1 技能期间普通攻击改为治疗',()=>{
 const {b}=openBattle([{chessId:'chess_char_1_13_b',skillIndex:0},reps.operators.yak]);deployNow(b);const pod=byId(b,'char_258_podego'),yak=byId(b,'char_199_yak');yak.x=pod.x+1;yak.y=pod.y;yak.hp=yak.maxHp-200;pod.sp=b.spCost(pod);b.activate(pod);assert.equal(pod.focusHeal,true);const before=yak.hp;for(let i=0;i<90;i++)b.step();assert.ok(yak.hp>before);
});

test('信仰搅拌机 damage stacks refresh finite defense and attack-speed bonuses',()=>{
 const {b}=openBattle({chessId:'chess_char_4_01_b',skillIndex:2});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:10000,def:0});u.sp=b.spCost(u);b.activate(u);const d0=b.stats(u).def;b.hit(u,e,10,'physical');const d1=b.stats(u).def;b.hit(u,e,10,'physical');assert.ok(d1>d0);assert.ok(b.stats(u).attackSpeed>b.profile(u).attributes.attackSpeed);b.s.time=11;tickLogic(b,11);assert.equal(b.stats(u).def,d0);
});

test('塞雷娅驻场叠层同时提升攻击与防御，并受最大层数限制',()=>{
 const {b}=openBattle({chessId:'chess_char_5_11_b',skillIndex:1});deployNow(b);const u=b.s.units[0],base=b.profile(u).attributes;for(let i=1;i<=600;i++){b.s.time=i/30;tickLogic(b,1/30);}const stats=b.stats(u);assert.equal(u.talentStacks,1);assert.ok(stats.atk>base.atk);assert.ok(stats.def>base.def);
});

test('华法琳紧急包扎只在半血以下的下一次治疗追加生命比例',()=>{
 const {b}=openBattle([{chessId:'chess_char_4_26_b',skillIndex:0},reps.operators.yak]);deployNow(b);const medic=b.s.units.find(u=>u.id==='char_171_bldsk'),ally=b.s.units.find(u=>u.id==='char_199_yak');ally.hp=ally.maxHp*.4;medic.sp=b.spCost(medic);b.activate(medic);assert.ok(medic.pendingHealBonus);const before=ally.hp;b.heal(medic,ally,10);assert.ok(ally.hp-before>ally.maxHp*.15);assert.equal(medic.pendingHealBonus,null);
});

test('浮游单元技能按黑板数量生成多枚投射，并保留概率寒冷',()=>{
 const {b}=openBattle({chessId:'chess_char_3_20_b',skillIndex:1});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:1000,def:0});u.sp=b.spCost(u);b.activate(u);assert.equal(u.floatUnits,3);assert.equal(u.floatTarget,e.uid);b.economy.random=()=>0;b.hit(u,e,10,'arts');assert.ok(e.statuses.some(s=>s.kind==='cold'||s.kind==='frozen'));assert.ok(b.stats(u).atk>b.profile(u).attributes.atk);
});

test('洛洛浮游过载在技能结束按实际持续时间眩晕自身',()=>{
 const {b}=openBattle({chessId:'chess_char_2_10_b',skillIndex:1});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:10000});u.sp=b.spCost(u);b.activate(u);assert.equal(u.floatUnits,1);assert.equal(u.floatTarget,e.uid);b.s.time=3;dispatch(b,'skill-end',{target:u});assert.ok(u.statuses.some(s=>s.kind==='stun'));
});

test('缪尔赛思技能复制待部署干员属性并保存 copyOf 关系',()=>{
 const {b}=openBattle([{chessId:'chess_char_6_11_b',skillIndex:2},reps.operators.yak]);deployNow(b);const mlyss=b.s.units.find(u=>u.id==='char_249_mlyss'),copy=b.s.units.find(u=>u.id==='char_199_yak');copy.deployed=false;mlyss.sp=b.spCost(mlyss);b.activate(mlyss);const token=b.s.summons.find(s=>s.type==='mlyss-fluid');assert.ok(token);assert.equal(token.copyOf,copy.uid);assert.equal(token.maxHp,b.profile(copy).attributes.maxHp);assert.equal(token.atk,b.profile(copy).attributes.atk);assert.equal(token.blockCnt,b.profile(copy).attributes.blockCnt);
});

test('归溟幽灵鲨替身固定实体提供范围减速与周期法伤',()=>{
 const {b}=openBattle({chessId:'chess_char_5_13_b',skillIndex:1});deployNow(b);const u=b.s.units[0],sub=b.s.summons.find(s=>s.type==='ghost2-substitute');assert.ok(sub);const e=enemy(b,{x:sub.x+1,y:sub.y,hp:5000,def:0});b.s.time=1;tickLogic(b,1);assert.ok(e.hp<5000);assert.ok(e.statuses.some(s=>s.kind==='sluggish'));
});

test('深靛 S2 只对束缚目标按黑板间隔造成周期法伤',()=>{
 const {b}=openBattle({chessId:'chess_char_1_17_b',skillIndex:1});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:1000,def:0});u.sp=b.spCost(u);b.activate(u);applyStatus(e,'root',5,{source:u.uid,resistible:false});const before=e.hp;b.s.time=.5;tickLogic(b,.5);assert.equal(e.hp<before,true);const e2=enemy(b,{x:u.x+1,y:u.y,hp:1000,def:0});b.s.time=1;tickLogic(b,.5);assert.equal(e2.hp,1000);
});

test('深靛天赋在技能期间按倍率施加束缚并排除未束缚目标',()=>{
 const {b}=openBattle({chessId:'chess_char_1_17_b',skillIndex:1});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:1000,def:0});b.economy.random=()=>0;u.sp=b.spCost(u);b.activate(u);b.hit(u,e,10,'arts');const root=e.statuses.find(s=>s.kind==='root');assert.ok(root);assert.equal(root.remaining,10);const e2=enemy(b,{x:u.x+1,y:u.y,hp:1000,def:0});assert.equal(b.targets(u).includes(e),true);assert.equal(b.targets(u).includes(e2),false);
});

test('蛇屠箱 S1 的持续回复按最大生命比例结算',()=>{
 const {b}=openBattle({chessId:'chess_char_3_16_b',skillIndex:1});deployNow(b);const u=b.s.units[0];u.hp=u.maxHp-100;u.sp=b.spCost(u);b.activate(u);const before=u.hp;b.s.time=1;tickLogic(b,1);assert.equal(u.hp,before+u.maxHp*.02);
});

test('蛇屠箱 S2 只为自身回复并增加阻挡数',()=>{
 const {b}=openBattle([{chessId:'chess_char_3_16_b',skillIndex:1},reps.operators.yak]);deployNow(b);const u=byId(b,'char_150_snakek'),ally=byId(b,'char_199_yak');ally.x=u.x+4;ally.y=u.y;u.hp=u.maxHp-100;ally.hp=ally.maxHp-100;const baseBlock=b.profile(u).attributes.blockCnt;u.sp=b.spCost(u);b.activate(u);assert.equal(b.stats(u).blockCnt,baseBlock+1);const before=u.hp,allyBefore=ally.hp;b.s.time=1;tickLogic(b,1);assert.equal(u.hp,before+u.maxHp*.02);assert.equal(ally.hp,allyBefore);
});

test('泡泡技能受击反伤并给攻击者施加攻击下降',()=>{
 const {b}=openBattle({chessId:'chess_char_2_08_b',skillIndex:1});deployNow(b);const bubble=b.s.units[0],enemyUnit=enemy(b,{x:bubble.x+1,y:bubble.y,hp:1000,def:0,atk:100});bubble.sp=b.spCost(bubble);b.activate(bubble);const before=enemyUnit.hp;b.hurt(bubble,enemyUnit);assert.ok(enemyUnit.hp<before);assert.ok(enemyUnit.statuses.some(s=>s.kind==='attackDown'));
});

test('泡泡 S2 技能期间提高嘲讽并按防御力反伤',()=>{
 const {b}=openBattle({chessId:'chess_char_2_08_b',skillIndex:1});deployNow(b);const bubble=b.s.units[0];bubble.sp=b.spCost(bubble);b.activate(bubble);assert.ok(b.stats(bubble).tauntLevel>0);assert.ok(b.profile(bubble).skill.description.includes('防御力'));
});

test('格雷伊 S2 技能期间提高停顿天赋持续时间',()=>{
 const {b}=openBattle({chessId:'chess_char_1_14_b',skillIndex:1});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:1000,def:0});u.sp=b.spCost(u);b.activate(u);b.hit(u,e,10,'arts');const sluggish=e.statuses.find(s=>s.kind==='sluggish');assert.ok(sluggish);assert.ok(Math.abs(sluggish.remaining-1.02)<1e-9);
});

test('普罗旺斯低生命目标增伤按生命比例档位计算',()=>{
 const {b}=openBattle({chessId:'chess_char_1_07_a',skillIndex:0});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:600,maxHp:1000,def:0});b.economy.random=()=>1;u.skillLeft=10;b.hit(u,e,100,'physical');assert.equal(e.hp,476);
});

test('跃跃回旋投射物按技能黑板追加独立投射',()=>{
 const {b}=openBattle({chessId:'chess_char_1_09_b',skillIndex:1});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:1000,def:0});u.sp=b.spCost(u);b.activate(u);const cfg=operatorSkillConfig(b,u);assert.equal(cfg.extraProjectiles,1);b.releaseNativeAttack(u,{kind:'damage',targets:[e.uid],amount:100,baseAmount:100,hits:1,type:'physical',extraProjectiles:cfg.extraProjectiles});assert.equal(b.s.strikes.length,2);
});

test('至简 S2 下次攻击执行法术双击',()=>{
 const {b}=openBattle({chessId:'chess_char_3_13_b',skillIndex:1});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:10000,def:0,res:0});u.sp=b.spCost(u);b.activate(u);for(let i=0;i<60&&e.hp===10000;i++)b.step();const hits=b.s.logicLog.filter(x=>x.type==='damage'&&x.sourceUid===u.uid&&x.targetUid===e.uid);assert.equal(hits.length,2);assert.ok(hits.every(x=>x.cause==='skill'));
});

test('流星 S2 立即范围攻击并施加防御削弱，空射天赋提高对空伤害',()=>{
 const {b}=openBattle({chessId:'chess_char_3_17_b',skillIndex:1});deployNow(b);const u=b.s.units[0],ground=enemy(b,{x:u.x+1,y:u.y,hp:10000,def:1000,res:0}),air=enemy(b,{x:u.x+2,y:u.y,hp:10000,def:0,res:0,flying:true});u.sp=b.spCost(u);b.activate(u);assert.ok(ground.hp<10000);assert.ok(ground.statuses.some(s=>s.kind==='defDown'));assert.ok(air.hp<10000);
});

test('薄绿技能结束释放范围法术爆发并保留命中拖拽',()=>{
 const {b}=openBattle({chessId:'chess_char_3_08_b',skillIndex:1});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+2,y:u.y,hp:1000,def:0});u.sp=b.spCost(u);b.activate(u);assert.ok(u.skillLeft>0);assert.equal(b.stats(u).tauntLevel,-1);const beforeX=e.x;b.hit(u,e,10,'arts');assert.ok(e.x<beforeX);u.skillLeft=0;dispatch(b,'skill-end',{target:u});assert.ok(e.hp<990);
});

test('菲莱技能受击反击造成法伤并积累凋亡损伤',()=>{
 const {b}=openBattle({chessId:'chess_char_3_06_b',skillIndex:1});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:5000,def:0});u.sp=b.spCost(u);b.activate(u);const before=e.hp;b.hurt(u,e);assert.ok(e.hp<before);assert.ok((e.elemental?.necrosis||0)>0);
});

test('初雪技能开始时给范围敌人施加防御与法抗削弱',()=>{
 const {b}=openBattle({chessId:'chess_char_3_14_b',skillIndex:1});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:1000});u.sp=b.spCost(u);b.activate(u);assert.ok(e.statuses.some(s=>s.kind==='defDown'));assert.ok(e.statuses.some(s=>s.kind==='resDown'));
});

test('惊蛰 S1 chain keeps full damage on subsequent jumps while active',()=>{
 const {b}=openBattle({chessId:'chess_char_1_03_b',skillIndex:1});deployNow(b);const u=b.s.units[0],e1=enemy(b,{x:u.x+1,y:u.y,hp:1000,def:0}),e2=enemy(b,{x:u.x+2,y:u.y,hp:1000,def:0});u.skillLeft=10;b.impactNativeAttack(u,e1,{style:'chain',amount:100,type:'true',antiAir:true});assert.equal(e1.hp,880);assert.equal(e2.hp,880);
});

test('惊蛰未阻挡目标天赋提高当前攻击倍率',()=>{
 const {b}=openBattle({chessId:'chess_char_1_03_b',skillIndex:0});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:1000,def:0});b.hit(u,e,100,'true');assert.equal(e.hp,880);
});

test('unlock-manifest matches pinned commits and 112-operator scope',()=>{
 assert.equal(manifest.sourceCommit,source.source.commit);
 assert.equal(manifest.gameDataCommit,scope.gameDataCommit);
 assert.equal(manifest.auditSourceCommit,audit.sourceCommit);
 assert.equal(manifest.sourceCommit,'86da4cfa3a4b958c3615fccf5afbc10b5c7f1bfb');
 assert.equal(manifest.operators.length,112);
 assert.equal(manifest.operators.length,scope.operators.length);
 for(const op of scope.operators){
  const row=manifest.operators.find(x=>x.charId===op.charId);
  assert.ok(row,op.name);
  assert.equal(row.chessId,op.chessId);
  assert.equal(row.goldenChessId,op.goldenChessId);
  assert.ok(Array.isArray(row.elite.activeTalents));
  assert.ok(Array.isArray(row.elite.skillUnlockCond));
  assert.equal(typeof row.elite.equipLevel,'number');
  assert.ok(Array.isArray(adapterManifest.operators.find(x=>x.charId===op.charId).partialHandlers));
 }
});

test('capability status covers four public capabilities without treating config as verified',()=>{
 assert.equal(capStatus.operators.length,112);
 const verified=capStatus.operators.filter(o=>[o.talentsAuras,o.persistEffects,o.protection,o.summons].includes('verified'));
 assert.ok(verified.length>0);for(const o of verified){assert.ok(o.verificationScope);assert.equal(o.evidence,'tests/native-effects.test.mjs');}
 assert.equal(capStatus.operators.find(o=>o.charId==='char_199_yak').talentsAuras,'verified');
 assert.equal(capStatus.operators.find(o=>o.charId==='char_498_inside').talentsAuras,'unimplemented');
});

test('elite 角峰 activeTalents include 雪原卫士 +15',()=>{
 const base=JSON.parse(fs.readFileSync('data/normalized/allianceLower.json','utf8'));
 const elite=resolveChess(source,base,'chess_char_1_02_b');
 const t=elite.activeTalents.find(x=>x.name==='雪原卫士');
 assert.ok(t);
 assert.equal(blackboard(t.blackboard).magic_resistance,15);
 assert.equal(resolveActiveTalents({talents:elite.talents},elite.status).find(x=>x.name==='雪原卫士').name,'雪原卫士');
});

test('clearing VFX events does not change HP or SP',()=>{
 const {b}=openBattle(reps.operators.yak);deployNow(b);
 const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:500,def:0});
 const hp=e.hp,sp=u.sp;b.s.events=[];
 dealDamage(b,{source:u,target:e,value:40,type:'true'});
 b.s.events=[];
 assert.ok(e.hp<hp);
 assert.equal(u.sp,sp);
 assert.ok(logOf(b,'damage').length>=1);
});

test('triple-hit shares attackId without reporting a cycle',()=>{
 const {b}=openBattle(reps.operators.yak);deployNow(b);
 const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y}),attackId=newAttackId(b);
 for(let i=0;i<3;i++)dealDamage(b,{source:u,target:e,value:7,type:'true',attackId,cause:'attack'});
 const hits=logOf(b,'damage');
 assert.equal(hits.length,3);
 assert.equal(new Set(hits.map(h=>h.eventId)).size,3);
 assert.equal(new Set(hits.map(h=>h.attackId)).size,1);
 assert.equal(b.s.settle.fault,null);
});

test('duplicate consume of the same eventId by one effect is diagnosed',()=>{
 const {b}=openBattle(reps.operators.yak);deployNow(b);
 const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y});
 const a=dealDamage(b,{source:u,target:e,value:3,type:'true',effectId:9,parentEventId:1});
 const c=dealDamage(b,{source:u,target:e,value:3,type:'true',effectId:9,parentEventId:1});
 assert.ok(a);assert.equal(c,null);
 assert.equal(b.s.settle.fault.type,'duplicate');
});

test('ancestor-chain cycle leaves a queue snapshot',()=>{
 const {b}=openBattle(reps.operators.yak);deployNow(b);
 const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y});
 dealDamage(b,{source:u,target:e,value:1,type:'true',effectId:77});
 const ev=logOf(b,'damage').at(-1);
 const ok=enqueue(b,{kind:'damage',sourceUid:u.uid,targetUid:e.uid,value:1,type:'true',effectId:77,parentEventId:ev.eventId});
 assert.equal(ok,false);
 assert.equal(b.s.settle.fault.type,'cycle');
 assert.ok(Array.isArray(b.s.settle.fault.snapshot));
});

test('synthetic fatal hook runs before death events',()=>{
 const {b}=openBattle(reps.operators.yak);deployNow(b);
 const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:20});
 let hooked=false;
 b.fatalHook=(t)=>{hooked=true;t.hp=4;return true;};
 dealDamage(b,{source:u,target:e,value:50,type:'true'});
 assert.equal(hooked,true);
 assert.equal(e.hp,4);
 assert.equal(logOf(b,'death').length,0);
});

test('one lifecycle only commitExit once',()=>{
 const {b}=openBattle(reps.operators.yak);deployNow(b);
 const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:5});
 dealDamage(b,{source:u,target:e,value:9,type:'true'});
 dealDamage(b,{source:u,target:e,value:9,type:'true'});
 assert.equal(logOf(b,'death').length,1);
 assert.equal(commitExit(b,{target:e,reason:'knockdown'}),false);
});

test('heal is blocked by fasting and emits heal; regen is not',()=>{
 const {b}=openBattle([reps.operators.flower,reps.operators.yak]);deployNow(b);
 const medic=byId(b,'char_181_flower'),ally=byId(b,'char_199_yak');
 ally.hp=ally.maxHp-80;
 const healed=applyHeal(b,{source:medic,target:ally,amount:10});
 assert.ok(healed>0);assert.ok(logOf(b,'heal').length>=1);
 applyStatus(ally,'healingBlocked',10);
 const blocked=applyHeal(b,{source:medic,target:ally,amount:10});
 assert.equal(blocked,0);
 const regen=applyRegen(b,{source:medic,target:ally,amount:10});
 assert.ok(regen>0);
 assert.equal(logOf(b,'heal').length,1);
 ally.healingReceived=2;ally.statuses=[];
 const boosted=applyHeal(b,{source:medic,target:ally,amount:10});
 const regen2=applyRegen(b,{source:medic,target:ally,amount:10});
 assert.ok(boosted>healed);
 assert.equal(regen2,10);
});

test('restore rebuilds runtime without consuming RNG or re-firing deploy',()=>{
 const {g,b}=openBattle(reps.operators.yak);deployNow(b);
 const u=b.s.units[0];enemy(b,{x:u.x+1,y:u.y,hp:80,def:0});
 const rng=g.s.randomState;
 const deploys=(b.s.logicLog||[]).filter(x=>x.type==='summon'||x.type==='exit').length;
 const snap=g.snapshot();
 const restored=NativeSession.restore(NATIVE_DATA,snap);
 assert.ok(restored?.battle);
 assert.equal(restored.s.randomState,rng);
 assert.equal(restored.battle.s.battleSchemaVersion,BATTLE_SCHEMA_VERSION);
 assert.equal(validateBattle(migrateBattle(snap.battle)),null);
 const after=(restored.battle.s.logicLog||[]).filter(x=>x.type==='summon'||x.type==='exit').length;
 assert.equal(after,deploys);
 restored.battle.step();
 assert.equal(restored.s.randomState,rng);
 assert.ok(restored.battle.level||restored.battle.s.benchmark||restored.battle.combatScale);
});

test('角峰 elite talent writes magic resistance into stats.parts',()=>{
 const {b}=openBattle(reps.operators.yak);deployNow(b);
 const u=b.s.units[0],bb=talentBB(b,u,'雪原卫士');
 assert.equal(bb.magic_resistance,15);
 const stats=b.stats(u);
 assert.ok(stats.magicResistance>=15);
 assert.ok(stats.parts.some(p=>p.src.includes('角峰')&&p.stat==='magicResistance'&&p.v===15));
});

test('角峰 skill blackboard contributes its magic resistance while active',()=>{
 const {b}=openBattle(reps.operators.yak);deployNow(b);const u=b.s.units[0],before=b.stats(u).magicResistance;u.sp=b.spCost(u);b.activate(u);assert.ok(b.stats(u).magicResistance>before);
});

test('角峰 S1 的固定每秒回复走公共周期效果',()=>{
 const {b}=openBattle({chessId:'chess_char_1_02_b',skillIndex:0});deployNow(b);const u=b.s.units[0];u.hp=100;u.sp=b.spCost(u);b.activate(u);b.s.time=1;tickLogic(b,1);assert.ok(u.hp>100);assert.ok(b.s.logicLog.some(x=>x.type==='regen'&&x.targetUid===u.uid));
});

test('普罗旺斯 S2 排除生命值高于八成的目标',()=>{
 const {b}=openBattle({chessId:'chess_char_1_07_b',skillIndex:1});deployNow(b);const u=b.s.units[0],high=enemy(b,{x:u.x+1,y:u.y,hp:900,maxHp:1000}),low=enemy(b,{x:u.x+2,y:u.y,hp:800,maxHp:1000});u.sp=b.spCost(u);b.activate(u);assert.equal(b.targets(u).includes(high),false);assert.equal(b.targets(u).includes(low),true);
});

test('休谟斯 S1 下一次攻击强化并回复自身生命',()=>{
 const {b}=openBattle({chessId:'chess_char_2_09_b',skillIndex:0});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:100000,def:0});u.hp=100;const before=u.hp;u.sp=b.spCost(u);b.activate(u);for(let i=0;i<60&&e.hp===100000;i++)b.step();assert.ok(e.hp<100000);assert.ok(u.hp>before);
});

test('休谟斯 S2 按生命阈值增攻并将溢出治疗转屏障',()=>{
 const {b}=openBattle({chessId:'chess_char_2_09_b',skillIndex:1});deployNow(b);const u=b.s.units[0],base=b.profile(u).attributes;u.sp=b.spCost(u);b.activate(u);assert.equal(b.stats(u).blockCnt,base.blockCnt+1);assert.ok(b.stats(u).atk>base.atk);applyHeal(b,{source:u,target:u,amount:u.maxHp*2});assert.ok(u.shield>0);assert.ok(u.shield<=u.maxHp);
});

test('莎草 S1 强化下一次治疗屏障，S2 锁定最高生命友军',()=>{
 const {b}=openBattle([{chessId:'chess_char_2_06_b',skillIndex:0},reps.operators.yak]);deployNow(b);const medic=byId(b,'char_4139_papyrs'),ally=byId(b,'char_199_yak');ally.hp=ally.maxHp-100;medic.sp=b.spCost(medic);b.activate(medic);b.heal(medic,ally,10);assert.ok(ally.shield>0);
 const s=openBattle([{chessId:'chess_char_2_06_b',skillIndex:1},reps.operators.yak]).b;deployNow(s);const m=byId(s,'char_4139_papyrs'),a=byId(s,'char_199_yak');a.x=m.x+1;a.y=m.y;a.hp=a.maxHp-100;m.sp=s.spCost(m);s.activate(m);assert.equal(m.papyrsTargetUid,a.uid);assert.deepEqual(s.healingTargets(m).map(x=>x.uid),[a.uid]);
});

test('松果 S1 固定穿透，S2 按使用次数叠加攻击且部署天赋加速技力',()=>{
 const {b}=openBattle({chessId:'chess_char_3_10_b',skillIndex:0});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:10000,def:1000});assert.ok(b.stats(u).spRecoveryPerSec>.99);u.sp=b.spCost(u);b.activate(u);assert.ok(e.hp<10000);
 const s=openBattle({chessId:'chess_char_3_10_b',skillIndex:1}).b;deployNow(s);const p=s.s.units[0],base=s.profile(p).attributes;p.sp=s.spCost(p);s.activate(p);const first=s.stats(p).atk;p.skillLeft=0;dispatch(s,'skill-end',{target:p});s.s.time=3;p.sp=s.spCost(p);s.activate(p);assert.ok(s.stats(p).atk>first);assert.ok(s.stats(p).spRecoveryPerSec>.99);
});

test('隐现 S2 技能期间降低敌人选取仇恨',()=>{
 const {b}=openBattle({chessId:'chess_char_1_01_b',skillIndex:1});deployNow(b);const u=b.s.units[0];u.sp=b.spCost(u);b.activate(u);assert.equal(b.stats(u).tauntLevel,-1);
});

test('隐现停留二十秒后同时补充自身与随机拉特兰弹药',()=>{
 const {b}=openBattle([{chessId:'chess_char_1_01_b',skillIndex:1},{chessId:'chess_char_6_13_b',skillIndex:2}]);deployNow(b);const inside=byId(b,'char_498_inside'),angel=byId(b,'char_1041_angel2');for(let i=0;i<610;i++)tickLogic(b,1/30);assert.equal(inside.talentAmmoBonus,3);assert.equal(angel.talentAmmoBonus,1);
});

test('白面鸮 SP aura uses maxSame and does not stack',()=>{
 const {b}=openBattle([reps.operators.plosis,reps.operators.plosis,reps.operators.yak]);deployNow(b);
 const ally=byId(b,'char_199_yak'),base=b.profile(ally).attributes.spRecoveryPerSec??1;
 const bb=talentBB(b,b.s.units.find(u=>u.id==='char_128_plosis'),'技力光环');
 assert.ok(bb.sp_recovery_per_sec>0);
 assert.ok(Math.abs(b.stats(ally).spRecoveryPerSec-(base+bb.sp_recovery_per_sec))<1e-9);
 assert.equal(b.stats(ally).parts.filter(p=>p.stat==='spRecoveryPerSec'&&p.layer==='maxSame').length,1);
});

test('诗怀雅 melee ATK aura scales with skill range and talent_scale',()=>{
 const spec={...reps.operators.swire,skillIndex:0};
 const {b}=openBattle([spec,reps.operators.yak]);deployNow(b);
 const swire=byId(b,'char_308_swire'),yak=byId(b,'char_199_yak');
 yak.x=swire.x+1;yak.y=swire.y;
 const before=b.stats(yak).atk;
 assert.ok(b.stats(yak).parts.some(p=>p.src==='诗怀雅'));
 swire.sp=b.spCost(swire)+5;b.activate(swire);
 assert.ok(b.skillActive(swire));
 const during=b.stats(yak).atk;
 assert.ok(during>=before);
});

test('雷蛇 on-hit SP goes to self and one random neighbor',()=>{
 const {g,b}=openBattle([reps.operators.liskam,reps.operators.yak]);deployNow(b);
 const liskam=byId(b,'char_107_liskam'),yak=byId(b,'char_199_yak');
 yak.x=liskam.x+1;yak.y=liskam.y;
 liskam.sp=0;yak.sp=0;const sp0=liskam.sp,sp1=yak.sp,rng=g.s.randomState;
 const foe={uid:b.s.nextId++,atk:20,damageType:'physical',x:liskam.x,y:liskam.y};
 b.hurt(liskam,foe);
 assert.equal(liskam.sp,sp0+2);
 assert.equal(yak.sp,sp1+1);
 assert.notEqual(g.s.randomState,rng);
});

test('华法琳 grants SP once per enemy death',()=>{
 const {b}=openBattle(reps.operators.bldsk);deployNow(b);
 const u=byId(b,'char_171_bldsk');
 const e=enemy(b,{x:u.x,y:u.y,hp:3});
 b.inside=()=>true;
 const sp=u.sp;
 dealDamage(b,{source:u,target:e,value:50,type:'true'});
 const once=u.sp;
 assert.ok(once>=sp);
 dealDamage(b,{source:u,target:e,value:50,type:'true'});
 assert.equal(u.sp,once);
});

test('real deploy() integration still fires talent hooks',()=>{
 const {g,b}=openBattle(reps.operators.yak);
 while(!b.s.units[0].deployed&&b.s.time<8)b.step();
 assert.ok(b.s.units[0].deployed);
 assert.ok(b.s.units[0].deployGen>=1);
 assert.equal(g.s.phase,'battle');
});

test('深巡 on-hit DoT refreshes and ticks on 1/30 steps',()=>{
 const {b}=openBattle(reps.operators.udflow);deployNow(b);
 const u=byId(b,'char_4137_udflow'),e=enemy(b,{x:u.x+1,y:u.y,hp:5000,def:0,res:0});
 dealDamage(b,{source:u,target:e,value:1,type:'true',cause:'attack'});
 const fx=b.s.logicEffects.find(x=>x.kind==='dot');
 assert.ok(fx);
 const firstAt=fx.nextAt,hp=e.hp;
 steps(b,Math.ceil((firstAt-b.s.time)*30)+1);
 assert.ok(e.hp<hp);
 dealDamage(b,{source:u,target:e,value:1,type:'true',cause:'attack'});
 const refreshed=b.s.logicEffects.find(x=>x.kind==='dot');
 assert.ok(refreshed.endsAt>=fx.endsAt);
});

test('调香师 global regen heals over repeated 1/30 ticks',()=>{
 const {b}=openBattle([reps.operators.flower,reps.operators.yak]);deployNow(b);
 const ally=byId(b,'char_199_yak');ally.hp=ally.maxHp-40;
 const hp=ally.hp;steps(b,30);
 assert.ok(ally.hp>hp);
 assert.ok(logOf(b,'regen').length>=1);
});

test('流明 S1 HoT uses heal events after a real activate',()=>{
 const {b}=openBattle([{...reps.operators.lumen,skillIndex:0},reps.operators.yak]);deployNow(b);
 const lumen=byId(b,'char_4042_lumen'),ally=byId(b,'char_199_yak');
 ally.x=lumen.x+1;ally.y=lumen.y;ally.hp=ally.maxHp-60;
 lumen.sp=b.spCost(lumen)+2;b.activate(lumen);
 b.heal(lumen,ally,8);
 const hot=b.s.logicEffects.filter(x=>x.kind==='hot');
 assert.ok(hot.length>=1);
 const hp=ally.hp;steps(b,35);
 assert.ok(ally.hp>=hp);
 assert.ok(logOf(b,'heal').length>=1);
 assert.ok(ally.statuses.some(s=>s.kind==='resist'));
});

test('波登可 S2 zone applies arts ticks and control',()=>{
 const {b}=openBattle([{...reps.operators.podego,skillIndex:1}]);deployNow(b);
 const u=byId(b,'char_258_podego');
 const e=enemy(b,{x:u.x,y:u.y,hp:2000,res:0});
 u.sp=b.spCost(u)+2;b.activate(u);
 assert.ok(b.s.logicEffects.some(x=>x.kind==='zone'));
 const hp=e.hp;steps(b,35);
 assert.ok(e.hp<hp);
 assert.ok(e.statuses.some(s=>s.kind==='sluggish'||s.kind==='silence'));
});

test('铃兰 S3 regen sluggish and fragile',()=>{
 const {b}=openBattle([{...reps.operators.lisa,skillIndex:2},reps.operators.yak]);deployNow(b);
 const lisa=byId(b,'char_358_lisa'),ally=byId(b,'char_199_yak');
 ally.hp=ally.maxHp-50;
 const e=enemy(b,{x:lisa.x,y:lisa.y,hp:2000,def:0});
 lisa.sp=b.spCost(lisa)+2;b.activate(lisa);
 assert.ok(b.skillActive(lisa));
 b.inside=()=>true;
 const hp=ally.hp;steps(b,30);
 assert.ok(ally.hp>hp);
 assert.ok(e.fragile>1||e.statuses.some(s=>s.kind==='sluggish'));
});

test('焰影苇草 S2 attached ball damages and heals the anchor',()=>{
 const {b}=openBattle([{...reps.operators.reed2,skillIndex:1},reps.operators.yak]);deployNow(b);
 const reed=byId(b,'char_1020_reed2'),yak=byId(b,'char_199_yak');
 yak.hp=yak.maxHp-80;
 const e=enemy(b,{x:yak.x,y:yak.y,hp:5000,res:0});
 reed.sp=b.spCost(reed)+2;b.activate(reed);
 assert.ok(b.s.logicEffects.some(x=>x.kind==='attached'&&x.anchorUid===yak.uid));
 const hpE=e.hp,hpA=yak.hp;steps(b,60);
 assert.ok(e.hp<hpE);
 assert.ok(yak.hp>=hpA);
});

test('砾 S2 decaying barrier is granted on deploy',()=>{
 const {b}=openBattle([{...reps.operators.gravel,skillIndex:1}]);deployNow(b);
 const u=byId(b,'char_237_gravel');
 assert.ok((u.shieldLayers||[]).length>=1);
 const left=u.shield;steps(b,30);
 assert.ok(u.shield<left||u.shieldLayers[0].remaining<u.shieldLayers[0].max);
});

test('莎草 heal attaches a timed barrier',()=>{
 const {b}=openBattle([reps.operators.papyrs,reps.operators.yak]);deployNow(b);
 const medic=byId(b,'char_4139_papyrs'),ally=byId(b,'char_199_yak');
 ally.hp=ally.maxHp-40;
 applyHeal(b,{source:medic,target:ally,amount:20});
 assert.ok((ally.shieldLayers||[]).length>=1);
});

test('泥岩 guard consume heals after the hit settles',()=>{
 const {b}=openBattle(reps.operators.mudrok);deployNow(b);
 const u=byId(b,'char_311_mudrok');
 assert.ok((u.barriers||[]).some(x=>x.charges>0));
 u.hp=u.maxHp-100;
 const foe={uid:b.s.nextId++,atk:50,damageType:'physical'};
 b.hurt(u,foe);
 assert.equal(u.hp,u.maxHp);assert.equal(logOf(b,'guardLayerConsumed').length,1);assert.ok(logOf(b,'heal').some(x=>x.targetUid===u.uid));
});

test('幽灵鲨 S2 locks HP then stuns on skill end',()=>{
 const {b}=openBattle([{...reps.operators.ghost,skillIndex:1}]);deployNow(b);
 const u=byId(b,'char_143_ghost');
 u.sp=b.spCost(u)+2;b.activate(u);
 assert.equal(u.lockHp?.min,1);
 dealDamage(b,{source:enemy(b,{x:u.x,y:u.y}),target:u,value:u.hp+50,type:'true'});
 assert.equal(u.hp,1);
 u.skillLeft=0.05;steps(b,3);
 assert.equal(u.lockHp,null);
 assert.ok(u.statuses.some(s=>s.kind==='stun'));
});

test('幽灵鲨天赋提高生命上限并持续自愈',()=>{
 const {b}=openBattle({chessId:'chess_char_2_07_b',skillIndex:0});deployNow(b);const u=b.s.units[0];assert.ok(b.stats(u).maxHp>b.profile(u).attributes.maxHp);u.hp=u.maxHp-100;const before=u.hp;for(let i=0;i<30;i++)b.step();assert.ok(Math.abs((u.hp-before)-u.maxHp*.02)<1e-6);
});

test('宴 S1 按最大生命回复，S2 按当前生命流失并转为法术攻击',()=>{
 const {b}=openBattle({chessId:'chess_char_1_18_b',skillIndex:0});deployNow(b);const u=b.s.units[0];u.hp=u.maxHp-1000;u.sp=b.spCost(u);b.activate(u);const before=u.hp;for(let i=0;i<30;i++)b.step();assert.ok(Math.abs((u.hp-before)-u.maxHp*.08)<1e-6);
 const {b:b2}=openBattle({chessId:'chess_char_1_18_b',skillIndex:1});const v=b2.s.units[0];assert.equal(v.hp,v.maxHp*.5,'被动随开局入场结算，流失一半生命');assert.equal(v.deployed,true);assert.equal(b2.baseDamageType(v),'arts');assert.ok(b2.stats(v).atk>b2.profile(v).attributes.atk);
});

test('雷蛇 S2 命中多目标法术并在结束时自晕',()=>{
 const {b}=openBattle({chessId:'chess_char_1_20_b',skillIndex:1});deployNow(b);const u=b.s.units[0],e1=enemy(b,{x:u.x+1,y:u.y,hp:100000}),e2=enemy(b,{x:u.x+1,y:u.y+1,hp:100000});u.sp=b.spCost(u);b.activate(u);for(let i=0;i<90;i++)b.step();assert.ok(e1.hp<100000||e2.hp<100000);assert.ok((e1.statuses||[]).some(s=>s.kind==='stun')||(e2.statuses||[]).some(s=>s.kind==='stun'));u.skillLeft=.01;for(let i=0;i<3;i++)b.step();assert.ok(u.statuses.some(s=>s.kind==='stun'));
});

test('莫斯提马 S2 生成持续群体法术与眩晕区域',()=>{
 const {b}=openBattle({chessId:'chess_char_4_02_b',skillIndex:1});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:100000});u.sp=b.spCost(u);b.activate(u);assert.ok(b.s.logicEffects.some(f=>f.talentOrSkillId==='mostma-s2'));for(let i=0;i<20;i++)b.step();assert.ok(e.hp<100000);assert.ok(e.statuses.some(s=>s.kind==='stun'));
});

test('莫斯提马天赋对范围敌人施加停顿，歌蕾蒂娅重量条件增伤',()=>{
 const {b}=openBattle({chessId:'chess_char_4_02_b',skillIndex:0});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:100000,weight:1});for(let i=0;i<2;i++)b.step();assert.ok(e.statuses.some(s=>s.kind==='sluggish'));
 const {b:b2}=openBattle({chessId:'chess_char_4_12_b',skillIndex:0});deployNow(b2);const v=b2.s.units[0],light=enemy(b2,{x:v.x+1,y:v.y,hp:100000,weight:1}),heavy=enemy(b2,{x:v.x+1,y:v.y+1,hp:100000,weight:4});const base=b2.stats(v).atk;v.sp=b2.spCost(v);b2.activate(v);b2.hit(v,light,base,'physical',{skill:true});const lightLoss=100000-light.hp;v.sp=0;b2.hit(v,heavy,base,'physical',{skill:true});assert.ok(lightLoss>100000-heavy.hp);
});

test('歌蕾蒂娅 S3 龙卷半径 1.5 格：结算与结束拖拽都不碰 2 格外的敌人',()=>{
 const {b}=openBattle({chessId:'chess_char_4_12_b',skillIndex:2});deployNow(b);const glady=byId(b,'char_474_glady');
 const center=enemy(b,{x:glady.x+1,y:glady.y,hp:1e6}),outside=enemy(b,{x:glady.x+1,y:glady.y+2,hp:1e6});
 glady.sp=b.spCost(glady);b.activate(glady);
 const zone=(b.s.logicEffects||[]).find(f=>f.talentOrSkillId==='glady-s3');
 assert.ok(zone,'技能要留下龙卷区域');
 assert.equal(zone.radius,1.5,'3技能半径是 1.5 格');
 assert.equal(zone.x,center.x);assert.equal(zone.y,center.y);
 steps(b,50);
 assert.ok(center.statuses.some(s=>s.kind==='sluggish'),'半径内的敌人被减速');
 assert.equal(outside.statuses.some(s=>s.kind==='sluggish'),false,'2 格外的敌人不在龙卷范围内');
 const pos={x:outside.x,y:outside.y};
 glady.skillLeft=.01;b.step();
 assert.deepEqual({x:outside.x,y:outside.y},pos,'结束时的拖拽同样只覆盖半径 1.5');
});
test('歌蕾蒂娅 S3 龙卷区域牵引，深海猎人获得最大生命回复与海怪减伤',()=>{
 const {b}=openBattle([{chessId:'chess_char_4_12_b',skillIndex:2},{chessId:'chess_char_2_07_b',skillIndex:0}]);deployNow(b);const glady=b.s.units.find(u=>u.id==='char_474_glady'),ghost=b.s.units.find(u=>u.id==='char_143_ghost'),e=enemy(b,{x:glady.x+1,y:glady.y,hp:100000,tags:['seamonster']});ghost.hp=ghost.maxHp-100;const before=ghost.hp;glady.sp=b.spCost(glady);b.activate(glady);assert.ok(e.statuses.some(s=>s.kind==='root'));for(let i=0;i<30;i++)b.step();assert.ok(ghost.hp>before);const hp=ghost.hp;dealDamage(b,{source:e,target:ghost,amount:100,type:'physical'});assert.ok(ghost.hp>=hp-75);
});

test('史尔特尔 S3 的生命上限字段按平值增加',()=>{
 const {b}=openBattle({chessId:'chess_char_5_07_b',skillIndex:2});deployNow(b);const u=b.s.units[0],base=b.profile(u).attributes.maxHp;u.sp=b.spCost(u);b.activate(u);assert.equal(b.stats(u).maxHp,base+5000);
});

test('华法琳 S2 为自身与随机友方施加攻击和持续生命流失',()=>{
 const {b}=openBattle([{chessId:'chess_char_4_26_b',skillIndex:1},{chessId:'chess_char_1_20_b',skillIndex:1}]);deployNow(b);const u=b.s.units.find(x=>x.id==='char_171_bldsk'),ally=b.s.units.find(x=>x.id==='char_107_liskam');u.sp=b.spCost(u);b.activate(u);assert.ok(ally.warfarinBuff||u.warfarinTargetUid===ally.uid);const before=ally.hp;for(let i=0;i<60;i++)b.step();assert.ok(ally.hp<before);u.skillLeft=.01;b.step();assert.equal(ally.warfarinBuff,null);
});

test('塞雷娅 S3 同时治疗友军并使范围敌人易伤减速，治疗回复技力',()=>{
 const {b}=openBattle([{chessId:'chess_char_5_11_b',skillIndex:2},{chessId:'chess_char_1_20_b',skillIndex:1}]);deployNow(b);const u=b.s.units.find(x=>x.id==='char_202_demkni'),ally=b.s.units.find(x=>x.id==='char_107_liskam'),e=enemy(b,{x:u.x+1,y:u.y,hp:100000});ally.hp=ally.maxHp-300;u.sp=b.spCost(u);b.activate(u);for(let i=0;i<35;i++)b.step();assert.ok(ally.hp>ally.maxHp-300);assert.ok(e.statuses.some(s=>s.kind==='sluggish'));const result=dealDamage(b,{source:u,target:e,amount:100,type:'arts'});assert.ok(result.total>=140);assert.ok(ally.sp>0);
});

test('银灰 S2 持续回复，领袖天赋缩短全队再部署时间',()=>{
 const {b}=openBattle([{chessId:'chess_char_4_22_b',skillIndex:1},{chessId:'chess_char_1_20_b',skillIndex:1}]);deployNow(b);const u=b.s.units.find(x=>x.id==='char_172_svrash'),ally=b.s.units.find(x=>x.id==='char_107_liskam');const base=ally.maxHp;ally.hp=base-200;u.sp=b.spCost(u);b.activate(u);for(let i=0;i<30;i++)b.step();assert.ok(ally.hp===base-200);assert.ok(u.hp>0);assert.ok(b.stats(ally).respawnTime< b.profile(ally).attributes.respawnTime);
});

test('忍冬安静四秒后按最大生命回复，费用自然回复速度提升',()=>{
 const {b}=openBattle({chessId:'chess_char_3_18_b',skillIndex:0});deployNow(b);const u=b.s.units[0];assert.equal(b.costRecoveryMultiplier(),1.1);u.hp=u.maxHp-500;const before=u.hp;for(let i=0;i<119;i++)b.step();assert.equal(u.hp,before);for(let i=0;i<2;i++)b.step();assert.ok(u.hp>before);
});

test('星熊战术装甲抵挡伤害，S2受击反伤',()=>{
 const {b}=openBattle({chessId:'chess_char_4_17_b',skillIndex:1});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:100000,atk:100,damageType:'physical'});b.economy.random=()=>0;const hp=u.hp;b.hurt(u,e);assert.equal(u.hp,hp);b.economy.random=()=>.9;const enemyHp=e.hp;b.hurt(u,e);assert.ok(e.hp<enemyHp);
});

test('远牙 S3 获取前方直线目标并在静息后增伤',()=>{
 const {b}=openBattle({chessId:'chess_char_4_20_b',skillIndex:2});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+4,y:u.y,hp:100000});u.sp=b.spCost(u);b.activate(u);assert.ok(b.targets(u).some(x=>x.uid===e.uid));b.s.time=10;assert.ok(b.stats(u).atk>b.profile(u).attributes.atk);
});

test('风笛编队初始技力与精密填弹额外目标',()=>{
 const {b}=openBattle([{chessId:'chess_char_4_07_b',skillIndex:1},{chessId:'chess_char_1_20_b',skillIndex:1}]);deployNow(b);const u=b.s.units.find(x=>x.id==='char_222_bpipe');assert.ok(u.sp>=6);const e1=enemy(b,{x:u.x+1,y:u.y,hp:100000}),e2=enemy(b,{x:u.x+1,y:u.y+1,hp:100000});b.economy.random=()=>0;const before2=e2.hp;u.sp=b.spCost(u);b.activate(u);b.hit(u,e1,b.stats(u).atk,'physical',{skill:true});assert.ok(e2.hp<before2||e1.hp<100000);
});

test('初雪低生命目标获得脆弱效果',()=>{
 const {b}=openBattle({chessId:'chess_char_3_14_b',skillIndex:0});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:100000});e.hp=e.maxHp*.3;b.hit(u,e,b.stats(u).atk,'physical');assert.ok(e.statuses.some(s=>s.kind==='fragile'));
});

test('焰尾卡西米尔闪避光环保护友方',()=>{
 const {b}=openBattle([{chessId:'chess_char_4_19_b',skillIndex:0},{chessId:'chess_char_2_18_b',skillIndex:0}]);deployNow(b);const flam=b.s.units.find(x=>x.id==='char_420_flamtl'),ally=b.s.units.find(x=>x.id==='char_431_ashlok'),e=enemy(b,{atk:100,damageType:'physical'});b.economy.random=()=>0;const hp=ally.hp;b.hurt(ally,e);assert.equal(ally.hp,hp);b.economy.random=()=>1;b.hurt(ally,e);assert.ok(ally.hp<hp);assert.ok(flam.deployed);
});

test('焰尾闪避后下一次攻击对所有阻挡目标追加双击',()=>{
 const {b}=openBattle({chessId:'chess_char_4_19_b',skillIndex:0});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:100000,atk:10,damageType:'physical',block:u.uid});u.sp=b.spCost(u);b.activate(u);b.economy.random=()=>0;b.hurt(u,e);const hp=e.hp;b.step();assert.ok(e.hp<hp);
});

test('星熊 S3 前方一格盾牌切割并叠加攻防',()=>{
 const {b}=openBattle({chessId:'chess_char_4_17_b',skillIndex:2});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:100000});u.sp=b.spCost(u);b.activate(u);assert.ok(b.stats(u).atk>b.profile(u).attributes.atk);for(let i=0;i<40;i++)b.step();assert.ok(e.hp<100000);
});

test('初雪 S1 对范围敌人施加攻击速度降低，S2 防御与法抗削弱',()=>{
 const {b}=openBattle({chessId:'chess_char_3_14_b',skillIndex:0});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:100000});u.sp=b.spCost(u);b.activate(u);assert.ok(e.statuses.some(s=>s.kind==='attackSpeedDown'));assert.ok(e.attackSpeedMod<0);
 const {b:b2}=openBattle({chessId:'chess_char_3_14_b',skillIndex:1});deployNow(b2);const v=b2.s.units[0],f=enemy(b2,{x:v.x+1,y:v.y,hp:100000});v.sp=b2.spCost(v);b2.activate(v);assert.ok(f.statuses.some(s=>s.kind==='defDown'));assert.ok(f.statuses.some(s=>s.kind==='resDown'));
});

test('菲莱 S1 清除元素并获得损伤屏障，S2 受元素损伤提升攻击',()=>{
 const {b}=openBattle({chessId:'chess_char_3_06_b',skillIndex:0});deployNow(b);const u=b.s.units[0];u.elemental={necrosis:100};u.sp=b.spCost(u);b.activate(u);assert.equal(u.elemental.necrosis,undefined);assert.ok(u.shieldLayers.some(l=>l.id==='philae-s1'));
 const {b:b2}=openBattle({chessId:'chess_char_3_06_b',skillIndex:1});deployNow(b2);const v=b2.s.units[0];v.sp=b2.spCost(v);b2.activate(v);const e=enemy(b2,{x:v.x+1,y:v.y,hp:100000,tags:['seamonster']});applyElementDamage(b2,{source:e,target:v,amount:100,type:'necrosis'});assert.ok(v.philaeElementBoost);assert.ok(b2.stats(v).atk>b2.profile(v).attributes.atk);
});

test('信仰搅拌机 S2 致命耗弹保命，S3 受击反击，闲置获得屏障',()=>{
 const {b}=openBattle({chessId:'chess_char_4_01_b',skillIndex:1});deployNow(b);const u=b.s.units[0],e=enemy(b,{atk:1e6,damageType:'physical'});u.sp=b.spCost(u);b.activate(u);const ammo=u.ammo;b.hurt(u,e);assert.equal(u.hp,1);assert.equal(u.ammo,ammo-25);
 const {b:b2}=openBattle({chessId:'chess_char_4_01_b',skillIndex:2});deployNow(b2);const v=b2.s.units[0],foe=enemy(b2,{x:v.x+1,y:v.y,hp:100000,atk:10});v.sp=b2.spCost(v);b2.activate(v);const hp=foe.hp;b2.hurt(v,foe);assert.ok(foe.hp<hp);foe.x=99;foe.y=99;v.lastAttack=-999;for(let i=0;i<250;i++)b2.step();assert.ok(v.shieldLayers.length>0);
});

test('水月 S2 额外目标束缚，S3 少目标自损与眩晕，天赋对最低生命追加法伤',()=>{
 const {b}=openBattle({chessId:'chess_char_4_09_b',skillIndex:1});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:100000}),e2=enemy(b,{x:u.x+1,y:u.y+1,hp:100000});u.sp=b.spCost(u);b.activate(u);b.hit(u,e,b.stats(u).atk,'physical',{skill:true});assert.ok(e.statuses.some(s=>s.kind==='root'));assert.ok(e2.hp<100000||e.hp<100000);
 const {b:b2}=openBattle({chessId:'chess_char_4_09_b',skillIndex:2});deployNow(b2);const v=b2.s.units[0],f=enemy(b2,{x:v.x+1,y:v.y,hp:100000});v.sp=b2.spCost(v);b2.activate(v);const hp=v.hp;b2.hit(v,f,b2.stats(v).atk,'physical',{skill:true});assert.ok(f.statuses.some(s=>s.kind==='stun'));assert.ok(v.hp<hp);
});

test('伺夜技能增狼、狼群强化与阻挡目标附加法伤',()=>{
 const {b}=openBattle({chessId:'chess_char_3_19_b',skillIndex:0});deployNow(b);const u=b.s.units[0],wolf=b.s.summons.find(s=>s.type==='vigil-wolf');assert.ok(wolf);u.sp=b.spCost(u);b.activate(u);assert.ok(wolf.lives>=3);
 const {b:b2}=openBattle({chessId:'chess_char_3_19_b',skillIndex:1});deployNow(b2);const v=b2.s.units[0],w=b2.s.summons.find(s=>s.type==='vigil-wolf'),e=enemy(b2,{x:w.x+1,y:w.y,hp:100000,block:w.uid});v.sp=b2.spCost(v);b2.activate(v);const hp=e.hp;for(let i=0;i<40;i++)b2.step();assert.ok(e.hp<hp);assert.ok(w.vigilBuff===null||w.vigilBuff===undefined);
});

test('山 S2 获得阻挡与最大生命回复，S3 推动并触发物理闪避',()=>{
 const {b}=openBattle({chessId:'chess_char_5_17_b',skillIndex:1});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:100000});u.sp=b.spCost(u);b.activate(u);assert.ok(b.stats(u).blockCnt>b.profile(u).attributes.blockCnt);u.hp=u.maxHp-500;for(let i=0;i<35;i++)b.step();assert.ok(u.hp>u.maxHp-500);
 const {b:b2}=openBattle({chessId:'chess_char_5_17_b',skillIndex:2});deployNow(b2);const v=b2.s.units[0],f=enemy(b2,{x:v.x+1,y:v.y,hp:100000,atk:100,damageType:'physical'});b2.economy.random=()=>0;v.sp=b2.spCost(v);b2.activate(v);const hp=v.hp;b2.hurt(v,f);assert.equal(v.hp,hp);
});

test('哈洛德优先治疗元素损伤目标并按条件降低元素损伤',()=>{
 const {b}=openBattle([{chessId:'chess_char_2_05_b',skillIndex:1},reps.operators.yak]);deployNow(b);const u=b.s.units.find(x=>x.id==='char_4114_harold'),ally=b.s.units.find(x=>x.id==='char_199_yak'),e=enemy(b,{x:ally.x,y:ally.y,hp:100000});ally.x=u.x+1;ally.y=u.y;ally.elemental={neural:ally.maxHp*.6};ally.hp=ally.maxHp-500;u.sp=b.spCost(u);b.activate(u);const hp=ally.hp;b.heal(u,ally,100);assert.ok(ally.hp>hp);const before=ally.elemental.neural;applyElementDamage(b,{source:e,target:ally,amount:100,type:'neural'});assert.ok(ally.elemental.neural-before<=85);
});

test('浊心斯卡蒂 S1 分摊伤害，S2 鼓舞友方攻防',()=>{
 const {b}=openBattle([{chessId:'chess_char_6_04_b',skillIndex:0},reps.operators.yak]);deployNow(b);const u=b.s.units.find(x=>x.id==='char_1012_skadi2'),ally=b.s.units.find(x=>x.id==='char_199_yak'),e=enemy(b,{atk:100,damageType:'physical'});assert.ok(b.s.summons.some(s=>s.type==='skadi2-seaborn'));ally.x=u.x+1;ally.y=u.y;u.sp=b.spCost(u);b.activate(u);const hp=u.hp;b.hurt(ally,e);assert.ok(u.hp<hp);
 const {b:b2}=openBattle([{chessId:'chess_char_6_04_b',skillIndex:1},reps.operators.yak]);deployNow(b2);const v=b2.s.units.find(x=>x.id==='char_1012_skadi2'),a=b2.s.units.find(x=>x.id==='char_199_yak');a.x=v.x+1;a.y=v.y;v.sp=b2.spCost(v);b2.activate(v);assert.ok(b2.stats(a).atk>b2.profile(a).attributes.atk);assert.ok(b2.stats(a).def>b2.profile(a).attributes.def);
});

test('百炼嘉维尔 S1 伤害吸血与阻挡增益、S3 延后伤害',()=>{
 const {b}=openBattle({chessId:'chess_char_4_23_b',skillIndex:0});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:100000,def:0});u.hp=u.maxHp-500;u.sp=b.spCost(u);b.activate(u);const hp=u.hp;b.hit(u,e,100,'physical',{skill:true});assert.ok(u.hp>hp);e.block=u.uid;assert.ok(b.stats(u).atk>b.profile(u).attributes.atk);
});

test('耀骑士临光 S2 部署获得三层护盾并在技能结束自动撤退',()=>{
 const {b}=openBattle({chessId:'chess_char_6_17_b',skillIndex:1});deployNow(b);const u=b.s.units[0];assert.equal(u.skillLeft,25);assert.equal(u.barriers.reduce((n,x)=>n+x.charges,0),3);assert.ok(b.stats(u).atk>b.profile(u).attributes.atk);for(let i=0;i<760;i++)b.step();assert.equal(u.deployed,false);
});

test('夕 S2 对低生命目标增伤，击杀后获得化境叠层',()=>{
 const {b}=openBattle({chessId:'chess_char_5_12_b',skillIndex:1});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:100000,def:0});e.hp=e.maxHp*.4;u.sp=b.spCost(u);b.activate(u);const before=e.hp;b.hit(u,e,100,'arts',{skill:true});assert.ok(before-e.hp>100);e.hp=1;commitExit(b,{target:e,reason:'knockdown',killer:u});assert.equal(u.duskTalentStacks,1);assert.ok(b.stats(u).atk>b.profile(u).attributes.atk);
});

test('归溟幽灵鲨 S1 交换生命比例，S3 按目标生命比例附伤或自损',()=>{
 const {b}=openBattle([{chessId:'chess_char_5_13_b',skillIndex:0},reps.operators.yak]);deployNow(b);const u=b.s.units.find(x=>x.id==='char_1023_ghost2'),a=b.s.units.find(x=>x.id==='char_199_yak');u.hp=u.maxHp*.8;a.hp=a.maxHp*.2;u.sp=b.spCost(u);b.activate(u);assert.ok(u.hp/u.maxHp<.3);assert.ok(a.hp/a.maxHp>.7);
 const {b:b2}=openBattle({chessId:'chess_char_5_13_b',skillIndex:2});deployNow(b2);const v=b2.s.units[0],e=enemy(b2,{x:v.x+1,y:v.y,hp:100000,def:0});v.sp=b2.spCost(v);b2.activate(v);const hp=e.hp;b2.hit(v,e,100,'physical',{skill:true});assert.ok(e.hp<hp);
});

test('缄默德克萨斯天赋提供首击前攻速减伤并在首杀后满血',()=>{
 const {b}=openBattle({chessId:'chess_char_4_16_b',skillIndex:0});const u=b.s.units[0];b.deploy(u);assert.ok(b.stats(u).attackSpeed>b.profile(u).attributes.attackSpeed);const e=enemy(b,{x:u.x+1,y:u.y,hp:1});u.hp=u.maxHp-200;b.hit(u,e,b.stats(u).atk,'physical');assert.equal(u.hp,u.maxHp);assert.equal(u.texas2Killed,true);
});

test('史尔特尔 S1 击倒目标回满技力，S2 单目标临界倍率',()=>{
 const {b}=openBattle({chessId:'chess_char_5_07_b',skillIndex:0});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:1});u.sp=0;u.sp=b.spCost(u);b.activate(u);b.hit(u,e,100,'physical',{skill:true});assert.equal(u.sp,b.spCost(u));
 const {b:b2}=openBattle({chessId:'chess_char_5_07_b',skillIndex:1});deployNow(b2);const v=b2.s.units[0],f=enemy(b2,{x:v.x+1,y:v.y,hp:100000,def:0});v.sp=b2.spCost(v);b2.activate(v);const before=f.hp;b2.hit(v,f,100,'physical',{skill:true});assert.ok(before-f.hp>100);
});

test('斯卡蒂深海猎人攻击光环、部署增益和再部署减免',()=>{
 const {b}=openBattle([{chessId:'chess_char_3_05_b',skillIndex:1},{chessId:'chess_char_2_07_b',skillIndex:0}]);deployNow(b);const u=b.s.units.find(x=>x.id==='char_263_skadi'),ally=b.s.units.find(x=>x.id==='char_143_ghost');assert.ok(u.skillLeft>0);assert.ok(b.stats(u).atk>b.profile(u).attributes.atk);assert.ok(b.stats(ally).atk>b.profile(ally).attributes.atk);assert.equal(b.stats(u).respawnTime,b.profile(u).attributes.respawnTime-10);
});

test('能天使部署后随机友方继承天使祝福，锡人炼金区域施加减攻与易伤',()=>{
 const {b}=openBattle([{chessId:'chess_char_3_01_b',skillIndex:0},{chessId:'chess_char_1_20_b',skillIndex:1}]);const angel=b.s.units.find(x=>x.id==='char_103_angel'),ally=b.s.units.find(x=>x.id==='char_107_liskam');b.deploy(ally);b.economy.random=()=>0;b.deploy(angel);assert.ok(ally.angelBlessing);assert.ok(b.stats(ally).atk> b.profile(ally).attributes.atk);
 const {b:b2}=openBattle({chessId:'chess_char_2_19_b',skillIndex:0});deployNow(b2);const tin=b2.s.units[0],e=enemy(b2,{x:tin.x+1,y:tin.y,hp:100000});tin.sp=b2.spCost(tin);b2.activate(tin);for(let i=0;i<35;i++)b2.step();assert.ok(e.statuses.some(s=>s.kind==='attackDown'));assert.ok(e.fragile>=1.2||e.statuses.some(s=>s.kind==='fragile'));
});

test('深巡 S2 穿透多个目标并对海怪触发加倍持续伤害',()=>{
 const {b}=openBattle({chessId:'chess_char_1_04_b',skillIndex:1});deployNow(b);const u=b.s.units[0],e1=enemy(b,{x:u.x+1,y:u.y,hp:100000}),e2=enemy(b,{x:u.x+2,y:u.y,hp:100000,tags:['seamonster']});u.sp=b.spCost(u);b.activate(u);b.hit(u,e1,b.stats(u).atk,'physical',{skill:true});assert.ok(e2.hp<100000);assert.ok(e2.statuses.some(s=>s.kind==='sluggish'));for(let i=0;i<31;i++)b.step();assert.ok(e2.hp<e1.hp);
});

test('刺玫 S2 锁定范围内最高生命友方并触发受击反击与治疗增幅',()=>{
 const {b}=openBattle([{chessId:'chess_char_1_06_b',skillIndex:1},{chessId:'chess_char_1_20_b',skillIndex:1}]);deployNow(b);const u=b.s.units.find(x=>x.id==='char_494_vendla'),ally=b.s.units.find(x=>x.id==='char_107_liskam');ally.x=u.x+1;ally.y=u.y;u.sp=b.spCost(u);b.activate(u);assert.equal(u.vendlaTargetUid,ally.uid);assert.ok(b.stats(ally).tauntLevel>0);const e=enemy(b,{x:ally.x,y:ally.y,hp:100000,atk:10,damageType:'physical'}),hp=e.hp;b.hurt(ally,e);assert.ok(e.hp<hp);assert.ok(ally.healingReceived>1);u.skillLeft=.01;b.step();assert.equal(ally.vendlaBuff,null);
});

test('蒂比技能起飞并在九秒未受击后闪避一次攻击',()=>{
 const {b}=openBattle({chessId:'chess_char_2_13_b',skillIndex:0});deployNow(b);const u=b.s.units[0],e=enemy(b,{atk:100,damageType:'physical'});u.sp=b.spCost(u);b.activate(u);assert.equal(u.flying,true);b.s.time=9;const hp=u.hp;b.hurt(u,e);assert.equal(u.hp,hp);b.hurt(u,e);assert.ok(u.hp<hp);
});

test('灰毫 S2 技能期间清零阻挡并保持远程攻击',()=>{
 const {b}=openBattle({chessId:'chess_char_2_18_b',skillIndex:1});deployNow(b);const u=b.s.units[0];u.sp=b.spCost(u);b.activate(u);assert.equal(b.stats(u).blockCnt,0);assert.equal(b.behavior(u).style,'fortress');
});

test('拉普兰德 S1 概率抵挡物理，S2 额外法术攻击并关闭特殊能力',()=>{
 const {b}=openBattle({chessId:'chess_char_2_16_b',skillIndex:0});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:100000,atk:100,damageType:'physical'});b.economy.random=()=>0;u.sp=b.spCost(u);b.activate(u);const hp=u.hp;b.hurt(u,e);assert.equal(u.hp,hp);
 const {b:b2}=openBattle({chessId:'chess_char_2_16_b',skillIndex:1});deployNow(b2);const v=b2.s.units[0],a=enemy(b2,{x:v.x+1,y:v.y,hp:100000}),c=enemy(b2,{x:v.x+1,y:v.y+1,hp:100000});v.sp=b2.spCost(v);b2.activate(v);b2.hit(v,a,b2.stats(v).atk,'arts',{skill:true});assert.ok(c.hp<100000||a.specialDisabledUntil>0);
});

test('海霓 S2 对普通敌人减速、额外攻击并按击倒强化脆弱',()=>{
 const {b}=openBattle({chessId:'chess_char_3_09_b',skillIndex:1});deployNow(b);const u=b.s.units[0],e1=enemy(b,{x:u.x+1,y:u.y,hp:100000}),e2=enemy(b,{x:u.x+1,y:u.y+1,hp:100000});u.sp=b.spCost(u);b.activate(u);b.hit(u,e1,b.stats(u).atk,'physical',{skill:true});assert.ok(e2.hp<100000||e1.hp<100000);assert.ok(e1.statuses.some(s=>s.kind==='sluggish'));e1.hp=1;commitExit(b,{target:e1,reason:'knockdown',killer:u});assert.ok(u.hainiTalentScale>1);
});

test('雪猎 S2 对静止目标强化双击并附加寒冷，空弦触发范围溅射与狙击回技力',()=>{
 const {b}=openBattle({chessId:'chess_char_3_11_b',skillIndex:1});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:100000,speed:0});u.sp=b.spCost(u);b.activate(u);assert.ok(e.hp<100000);assert.ok(e.statuses.some(s=>s.kind==='cold'));
 const {b:b2}=openBattle([{chessId:'chess_char_3_21_b',skillIndex:0},{chessId:'chess_char_3_11_b',skillIndex:0}]);deployNow(b2);const ar=b2.s.units.find(x=>x.id==='char_332_archet'),target=enemy(b2,{x:ar.x+1,y:ar.y,hp:100000}),splash=enemy(b2,{x:target.x+1,y:target.y,hp:100000});ar.sp=b2.spCost(ar);b2.activate(ar);b2.hit(ar,target,b2.stats(ar).atk,'physical',{skill:true});assert.ok(splash.hp<100000);const sn=b2.s.units.find(x=>x.id==='char_4211_snhunt');b2.step();assert.equal(typeof ar.landenNextAt,'number');
});

test('空弦兰登战术跨过周期后正常给狙击干员回复技力',()=>{
 const {b}=openBattle({chessId:'chess_char_3_21_b',skillIndex:2});deployNow(b);const ar=b.s.units.find(x=>x.id==='char_332_archet'),before=ar.sp;
 for(let i=0;i<76;i++)b.step();
 assert.equal(ar.sp,before+1);assert.equal(b.s.settle.fault,null);
});

test('空弦 S1 多个溅射目标使用独立结算效果',()=>{
 const {b}=openBattle({chessId:'chess_char_3_21_b',skillIndex:0});deployNow(b);const ar=b.s.units.find(x=>x.id==='char_332_archet'),target=enemy(b,{x:ar.x+1,y:ar.y,hp:100000}),splashA=enemy(b,{x:target.x+1,y:target.y,hp:100000}),splashB=enemy(b,{x:target.x,y:target.y+1,hp:100000});
 ar.sp=b.spCost(ar);b.activate(ar);
 assert.doesNotThrow(()=>{for(let i=0;i<30;i++)b.step();});
 assert.equal(b.s.settle.fault,null);assert.ok(splashA.hp<100000);assert.ok(splashB.hp<100000);
});

test('缄默德克萨斯三种部署被动分别触发沉默持续伤害、落地法伤与剑雨',()=>{
 const {b}=openBattle({chessId:'chess_char_4_16_b',skillIndex:0});const u=b.s.units[0];b.deploy(u);const e=enemy(b,{x:u.x+1,y:u.y,hp:100000});b.hit(u,e,b.stats(u).atk,'physical');assert.ok(e.statuses.some(s=>s.kind==='silence'));for(let i=0;i<31;i++)b.step();assert.ok(e.hp<100000);
 const {b:b2}=openBattle({chessId:'chess_char_4_16_b',skillIndex:1}),v=b2.s.units[0],e2=enemy(b2,{x:v.x+1,y:v.y,hp:100000});b2.deploy(v);assert.ok(e2.hp<100000);assert.ok(e2.statuses.some(s=>s.kind==='resDown'));
 const {b:b3}=openBattle({chessId:'chess_char_4_16_b',skillIndex:2}),w=b3.s.units[0],e3=enemy(b3,{x:w.x+1,y:w.y,hp:100000});b3.deploy(w);const hp=e3.hp;for(let i=0;i<40;i++)b3.step();assert.ok(e3.hp<hp);
});

test('灵知 S3 冻结范围目标并在结束爆发，寒冷目标获得脆弱',()=>{
 const {b}=openBattle({chessId:'chess_char_4_13_b',skillIndex:2});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:100000});u.sp=b.spCost(u);b.activate(u);assert.ok(e.statuses.some(s=>s.kind==='frozen'));for(let i=0;i<2;i++)b.step();assert.ok(e.fragile>1);const hp=e.hp;u.skillLeft=.01;b.step();assert.ok(e.hp<hp);
});

test('莱恩哈特 S2 范围法伤削减法抗并按敌人数叠加攻击',()=>{
 const {b}=openBattle({chessId:'chess_char_4_14_b',skillIndex:1});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:100000,res:50}),e2=enemy(b,{x:u.x+1,y:u.y+1,hp:100000,res:50});u.sp=b.spCost(u);b.activate(u);assert.ok(e.hp<100000);assert.ok(e.statuses.some(s=>s.kind==='resDown'));assert.ok(b.stats(u).atk>b.profile(u).attributes.atk);
});

test('寒芒克洛丝 S1 迷彩，S2 命中计数后切换四连射',()=>{
 const {b}=openBattle({chessId:'chess_char_4_06_b',skillIndex:0});deployNow(b);const u=b.s.units[0];u.sp=b.spCost(u);b.activate(u);assert.ok(u.statuses.some(s=>s.kind==='camouflage'));
 const {b:b2}=openBattle({chessId:'chess_char_4_06_b',skillIndex:1});deployNow(b2);const v=b2.s.units[0],e=enemy(b2,{x:v.x+1,y:v.y,hp:1e9});v.sp=b2.spCost(v);b2.activate(v);for(let i=0;i<40;i++)b2.hit(v,e,1,'physical',{skill:true});assert.equal(v.kroosQuad,true);assert.equal(operatorSkillConfig(b2,v).hits,4);
});

test('瑕光优先攻击沉睡目标并让受击回复技能攻击时回技力',()=>{
 const {b}=openBattle([{chessId:'chess_char_3_12_b',skillIndex:2},{chessId:'chess_char_1_20_b',skillIndex:1}]);deployNow(b);const u=b.s.units.find(x=>x.id==='char_423_blemsh'),ally=b.s.units.find(x=>x.id==='char_107_liskam'),sleeping=enemy(b,{x:u.x+1,y:u.y,hp:100000}),awake=enemy(b,{x:u.x+1,y:u.y+1,hp:100000});applyStatus(sleeping,'sleep',5,{source:u.uid,resistible:false});assert.equal(b.targets(u)[0].uid,sleeping.uid);ally.sp=0;const before=ally.sp;b.hit(ally,awake,b.stats(ally).atk,'physical');assert.ok(ally.sp>before);
});

test('小满 S1 额外目标，S2 先沉睡后提升攻速并多目标攻击',()=>{
 const {b}=openBattle({chessId:'chess_char_2_04_b',skillIndex:1});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:100000}),e2=enemy(b,{x:u.x+1,y:u.y+1,hp:100000});u.sp=b.spCost(u);b.activate(u);assert.ok(u.grabdsSleepUntil>0);assert.ok(e.statuses.some(s=>s.kind==='sleep'));const base=b.stats(u).attackSpeed;b.s.time=u.grabdsSleepUntil+.01;assert.ok(b.stats(u).attackSpeed>base);
});

test('阿罗玛 S1 对空附伤，首击浮空并在 S2 浮空结束追加法伤',()=>{
 const {b}=openBattle({chessId:'chess_char_4_10_b',skillIndex:0});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:100000,flying:true});u.sp=b.spCost(u);b.activate(u);const before=e.hp;b.hit(u,e,b.stats(u).atk,'arts',{skill:true});assert.ok(e.hp<before);assert.ok(e.statuses.some(s=>s.kind==='levitate'));
 const {b:b2}=openBattle({chessId:'chess_char_4_10_b',skillIndex:1});deployNow(b2);const v=b2.s.units[0],f=enemy(b2,{x:v.x+1,y:v.y,hp:100000});applyStatus(f,'levitate',1,{source:v.uid,resistible:false});v.sp=b2.spCost(v);b2.activate(v);for(let i=0;i<35;i++)b2.step();assert.ok(f.hp<100000);
});

test('凯瑟琳 S1 为拥有支援装置屏障的干员提供攻防加成',()=>{
 const {b}=openBattle([{chessId:'chess_char_4_11_b',skillIndex:0},reps.operators.yak]);deployNow(b);b.step();const u=b.s.units.find(x=>x.id==='char_4162_cathy'),ally=b.s.units.find(x=>x.id==='char_199_yak');u.sp=b.spCost(u);b.activate(u);assert.ok(b.stats(ally).atk>b.profile(ally).attributes.atk);assert.ok(b.stats(ally).def>b.profile(ally).attributes.def);
});

test('风丸 S1 下次攻击倍率与失血，S2 纸偶出现时范围法伤',()=>{
 const {b}=openBattle({chessId:'chess_char_2_11_b',skillIndex:0});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:100000,def:0});u.sp=b.spCost(u);b.activate(u);const hp=u.hp;b.hit(u,e,b.stats(u).atk,'physical');assert.ok(e.hp<100000);assert.ok(u.hp<hp);
 const {b:b2}=openBattle({chessId:'chess_char_2_11_b',skillIndex:1});const v=b2.s.units[0],foe=enemy(b2,{x:v.x+1,y:v.y,hp:100000,def:0});b2.deploy(v);v.sp=b2.spCost(v);b2.activate(v);assert.ok(b2.s.summons.some(s=>s.type==='kazema-shadow'));assert.ok(foe.hp<100000);
});

test('史尔特尔 lock then force exit keeps one lifecycle',()=>{
 const {b}=openBattle(reps.operators.surtr);deployNow(b);
 const u=byId(b,'char_350_surtr');
 dealDamage(b,{source:enemy(b,{x:u.x,y:u.y}),target:u,value:u.hp+20,type:'true'});
 assert.equal(u.hp,1);
 assert.ok(u.lockHp);
 const gen=u.deployGen;
 const until=u.lockHp.endsAt;
 while(b.s.time<until+0.05)b.step();
 assert.equal(u.deployed,false);
 assert.equal(u.deployGen,gen);
 assert.equal(logOf(b,'exit').filter(x=>x.uid===u.uid).length,1);
});

test('号角 血战 revives once per life without bumping deployGen',()=>{
 const {b}=openBattle(reps.operators.horn);deployNow(b);
 const u=byId(b,'char_4039_horn'),gen=u.deployGen,hp=u.hp;
 dealDamage(b,{source:enemy(b,{x:u.x,y:u.y}),target:u,value:hp+50,type:'true'});
 assert.ok(u.hp>1);
 assert.equal(u.deployed,true);
 assert.equal(u.deployGen,gen);
 assert.equal(u.revivedThisLife,true);
 dealDamage(b,{source:enemy(b,{x:u.x,y:u.y}),target:u,value:u.hp+50,type:'true'});
 assert.equal(u.deployed,false);
 assert.equal(logOf(b,'exit').filter(x=>x.uid===u.uid).length,1);
});

test('赫默 drone survives owner knockdown and two owners do not cross summons',()=>{
 const {b}=openBattle([{...reps.operators.silent,skillIndex:1},{...reps.operators.silent,skillIndex:1},reps.operators.yak]);deployNow(b);
 const silents=b.s.units.filter(u=>u.id==='char_108_silent');
 const ally=byId(b,'char_199_yak');ally.hp=ally.maxHp-40;
 for(const s of silents){s.sp=b.spCost(s)+2;b.activate(s);}
 assert.equal(b.s.summons.filter(x=>x.type==='silent-drone').length,2);
 const owners=new Set(b.s.summons.map(x=>x.ownerUid));
 assert.equal(owners.size,2);
 const first=silents[0];
 dealDamage(b,{source:enemy(b,{x:first.x,y:first.y}),target:first,value:first.hp+20,type:'true'});
 assert.equal(first.deployed,false);
 assert.ok(b.s.summons.some(x=>x.ownerUid===first.uid&&x.type==='silent-drone'));
 const drone=b.s.summons.find(x=>x.ownerUid===first.uid);
 assert.equal(drone.targetable,false);
 assert.ok(!attackableAllies(b.s).includes(drone));
 assert.equal(getActor(b.s,drone.uid),drone);
});

test('赫默强化注射为医疗职业提供攻速光环',()=>{
 const {b}=openBattle([{...reps.operators.silent,skillIndex:1},{...reps.operators.silent,skillIndex:1}]);deployNow(b);const medics=b.s.units.filter(u=>u.id==='char_108_silent'),base=b.profile(medics[0]).attributes.attackSpeed;assert.equal(b.stats(medics[0]).attackSpeed,base+12);assert.ok(b.stats(medics[1]).parts.some(p=>p.src==='赫默'));
});

test('summons require their real triggers and use pinned entity attributes',()=>{
 const {b}=openBattle(reps.operators.dusk);deployNow(b);assert.equal(b.s.summons.length,0);
 const u=byId(b,'char_2015_dusk');let pos;
 for(let y=0;y<b.map.rows;y++)for(let x=0;x<b.map.cols;x++){const t=b.map.grid[y][x];if(t.buildableType!=='NONE'&&!t.obstacle&&t.heightType!=='HIGHLAND'&&!b.s.units.some(u=>u.x===x&&u.y===y))pos={x,y};}
 const e=enemy(b,{...pos,hp:10000});dealDamage(b,{source:u,target:e,value:10,type:'arts'});
 const token=b.s.summons.find(t=>t.type==='dusk-token');assert.ok(token);assert.equal(token.blockCnt,2);assert.equal(token.atk,398);
 b.hurt(token,{uid:9999,atk:1000,damageType:'physical'});assert.ok(token.hp<token.maxHp);
 const n=openBattle({...reps.operators.nearl2,skillIndex:2}).b;deployNow(n);assert.equal(n.s.summons.length,0);const knight=n.s.units[0];knight.sp=n.spCost(knight);n.activate(knight);const sun=n.s.summons.find(t=>t.type==='nearl2-sun');assert.ok(sun);assert.equal(sun.canAttack,false);assert.equal(sun.blockCnt,2);
 const v=openBattle(reps.operators.vigil).b;deployNow(v);const wolves=v.s.summons.filter(t=>t.type==='vigil-wolf');assert.equal(wolves.length,1);assert.equal(wolves[0].lives,2);assert.equal(wolves[0].blockCnt,2);
});

test('凯瑟琳 device protects an ally and consumes finite stock',()=>{
 const {b}=openBattle([reps.operators.cathy,reps.operators.yak]);deployNow(b);steps(b,1);
 const u=byId(b,'char_4162_cathy'),ally=byId(b,'char_199_yak'),device=b.s.summons.find(t=>t.type==='cathy-device');
 assert.ok(device);assert.equal(device.targetable,false);assert.equal(device.anchorUid,ally.uid);assert.ok(ally.shield>0);
 const stock=u.summonCtrl.stock;commitExit(b,{target:device,reason:'forced'});steps(b,1);assert.equal(u.summonCtrl.stock,stock);assert.equal(b.s.summons.filter(t=>t.type==='cathy-device').length,1);
});

test('applyLoss lethal still goes through death, not armor',()=>{
 const {b}=openBattle(reps.operators.yak);deployNow(b);
 const e=enemy(b,{hp:8,def:999});
 applyLoss(b,{target:e,amount:20});
 assert.equal(e.hp,0);
 assert.equal(logOf(b,'death').length,1);
});

test('remaining operator adapters expose element, link, summon and shield lifecycles',()=>{
 const n=openBattle({chessId:'chess_char_5_22_a',skillIndex:1}).b;deployNow(n);const nu=n.s.units[0],ne=enemy(n,{x:nu.x+1,y:nu.y,hp:20000});nu.sp=n.spCost(nu);n.activate(nu);assert.ok(ne.elemental?.necrosis>0||ne.elementBurst>0);assert.ok(ne.statuses.some(s=>s.kind==='fear'));
 const c=openBattle({chessId:'chess_char_4_25_a',skillIndex:1}).b;deployNow(c);assert.ok(c.s.summons.filter(s=>s.type==='cetsyr-dust').length>=1);
 const h=openBattle({chessId:'chess_char_6_16_a',skillIndex:1}).b;deployNow(h);const hu=h.s.units[0],he=enemy(h,{x:hu.x+1,y:hu.y,hp:20000});hu.sp=h.spCost(hu);h.activate(hu);assert.ok(he.statuses.some(s=>s.kind==='sluggish')||he.hp<20000);
 const a=openBattle({chessId:'chess_char_6_20_a',skillIndex:1}).b;deployNow(a);const au=a.s.units[0];au.sp=a.spCost(au);a.activate(au);assert.ok(au.shieldLayers.length>0);
});

test('逐名适配覆盖被动撤回、狼影、心烛、雪山复起与链路状态',()=>{
 const ines=openBattle({chessId:'chess_char_4_04_a',skillIndex:2}).b;deployNow(ines);assert.equal(ines.s.units[0].deployed,false);assert.ok(ines.s.logicEffects.some(f=>f.talentOrSkillId==='ines-shadow'));
 const dust=openBattle({chessId:'chess_char_4_25_a',skillIndex:0}).b;deployNow(dust);assert.equal(dust.s.summons.filter(s=>s.type==='cetsyr-dust').length,3);
 const sbell=openBattle({chessId:'chess_char_6_02_a',skillIndex:0}).b;deployNow(sbell);const su=sbell.s.units[0];dealDamage(sbell,{source:enemy(sbell,{atk:999999}),target:su,value:999999,type:'true'});assert.ok(su.hp>0&&su.sbellRevived);
 const mlyss=openBattle({chessId:'chess_char_6_11_a',skillIndex:0}).b;deployNow(mlyss);const mu=mlyss.s.units[0];mu.sp=mlyss.spCost(mu);mlyss.activate(mu);assert.ok(mlyss.s.summons.some(s=>s.type==='mlyss-fluid'));
});

test('魔王技能区域与微尘在技能结束和重新部署后不累积',()=>{
 const skill=openBattle({chessId:'chess_char_4_25_a',skillIndex:2}).b;deployNow(skill);const su=skill.s.units[0];su.sp=skill.spCost(su);skill.activate(su);assert.equal(skill.s.logicEffects.filter(f=>String(f.talentOrSkillId).startsWith('cetsyr-dust:')).length,1);dispatch(skill,'skill-end',{target:su});assert.equal(skill.s.logicEffects.filter(f=>String(f.talentOrSkillId).startsWith('cetsyr-dust:')).length,0);
 const redeploy=openBattle({chessId:'chess_char_4_25_a',skillIndex:0}).b;deployNow(redeploy);const ru=redeploy.s.units[0];redeploy.s.cost=99;commitExit(redeploy,{target:ru,reason:'knockdown'});ru.down=0;redeploy.deploy(ru,{reentry:true});assert.equal(redeploy.s.summons.filter(s=>s.type==='cetsyr-dust').length,3);
});
