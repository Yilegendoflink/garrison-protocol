import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {applyStatus} from '../dist/status.js';
import {blackboard,resolveActiveTalents,resolveChess} from '../dist/protocol.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {dealDamage,enqueue,newAttackId,applyHeal,applyRegen,applyLoss,commitExit,reviveActor,dispatch,tickLogic,addEffect,addDamageRedirect,queueDelayedDamage,teleportActor,BATTLE_SCHEMA_VERSION,validateBattle,migrateBattle,getActor,attackableAllies} from '../dist/native-effects.js';
import {openBattle,deployNow,enemy,byId,talentBB,logOf,steps,reps} from './effects-harness.mjs';

const source=JSON.parse(fs.readFileSync('data/modes/alliance-lower/source.json','utf8'));
const scope=JSON.parse(fs.readFileSync('data/modes/alliance-lower/operator-scope.json','utf8'));
const audit=JSON.parse(fs.readFileSync('data/modes/alliance-lower/operator-behavior-audit.json','utf8'));
const manifest=JSON.parse(fs.readFileSync('data/modes/alliance-lower/unlock-manifest.json','utf8'));
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

test('Blaze revival talent enters a downed state, blocks healing, then revives once',()=>{
 const {b}=openBattle({chessId:'chess_char_5_03_b',skillIndex:2});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,def:0});
 dealDamage(b,{source:e,target:u,amount:u.maxHp+100,type:'true'});assert.equal(u.downed,true);assert.equal(u.hp,1);assert.equal(u.healable,false);assert.equal(applyHeal(b,{source:u,target:u,amount:10}),0);assert.ok(u.shieldLayers.some(l=>l.remaining===6000));
 u.hp=u.maxHp-1;b.step();assert.equal(u.downed,false);assert.equal(u.healable,true);assert.equal(b.s.logicLog.some(x=>x.type==='revive'&&x.uid===u.uid),true);
});

test('four summon skills resolve through the shared token lifecycle',()=>{
 const cases=[['chess_char_4_05_b','beewax-obelisk'],['chess_char_2_11_b','kazema-shadow'],['chess_char_6_07_b','siege2-golden'],['chess_char_6_11_b','mlyss-fluid']];
 for(const [chessId,type] of cases){const {b}=openBattle({chessId});deployNow(b);const u=b.s.units[0];u.sp=b.spCost(u);b.activate(u);const token=b.s.summons.find(s=>s.ownerUid===u.uid&&s.type===type);assert.ok(token,type);assert.equal(token.kind,'summon');assert.ok(token.maxHp>0);}
});

test('归溟幽灵鲨 S1 locks lethal damage and exits exactly once at skill end',()=>{
 const {b}=openBattle({chessId:'chess_char_5_13_b',skillIndex:1});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,def:0});u.sp=b.spCost(u);b.activate(u);
 dealDamage(b,{source:e,target:u,amount:u.maxHp+100,type:'true'});assert.equal(u.hp,1);assert.equal(u.deployed,true);assert.equal(u.lockHp.min,1);
 dispatch(b,'skill-end',{target:u});assert.equal(u.deployed,false);assert.equal(logOf(b,'exit').length,1);
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
 const stock=u.summonCtrl.stock;commitExit(b,{target:device,reason:'forced'});steps(b,1);assert.equal(u.summonCtrl.stock,stock-1);
});

test('applyLoss lethal still goes through death, not armor',()=>{
 const {b}=openBattle(reps.operators.yak);deployNow(b);
 const e=enemy(b,{hp:8,def:999});
 applyLoss(b,{target:e,amount:20});
 assert.equal(e.hp,0);
 assert.equal(logOf(b,'death').length,1);
});
