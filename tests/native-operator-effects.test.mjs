import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {operatorRegistry,skillConfig,statMods} from '../dist/native-operator-effects.js';
import {openBattle,deployNow,enemy,byId,reps} from './effects-harness.mjs';
import {dealDamage,applyElementDamage,operatorSkillConfig,tickLogic} from '../dist/native-effects.js';
import {moveActor} from '../dist/native-effects.js';
import {applyStatus,tickStatuses} from '../dist/status.js';

test('every fixed operator has an adapter entry and every skill resolves a safe config',()=>{
 const registry=operatorRegistry(NATIVE_DATA);
 const fixed=NATIVE_DATA.operatorScope?.operators||[];
 if(fixed.length)for(const op of fixed)assert.ok(registry[op.charId],op.name);
 const profiles=Object.values(NATIVE_DATA.profiles).filter(p=>p?.charId);
 assert.ok(registry&&Object.keys(registry).length>=112);
 let skills=0;
 for(const p of profiles)for(const choice of p.skillChoices||[]){const cfg=skillConfig({...p,skill:choice.skill});assert.ok(Number.isFinite(cfg.atkScale));assert.ok(Number.isFinite(cfg.hits));assert.ok(cfg.multiTarget!==undefined);skills++;}
 assert.ok(skills>=283);
});

test('generic talent stat extraction only applies direct stat text and exposes sources',()=>{
 const b={profile:u=>u.profile,data:NATIVE_DATA};
 const u={id:'char_199_yak',deployed:true,hp:1,profile:{name:'角峰',activeTalents:[{name:'雪原卫士',description:'法术抗性+15',blackboard:[{key:'magic_resistance',value:15}]}]}};
 const mods=statMods(b,u);assert.equal(mods.add.magicResistance,15);assert.equal(mods.parts[0].src,'角峰·雪原卫士');
 const conditional={...u,profile:{name:'测试',activeTalents:[{name:'条件',description:'受到攻击时攻击力提升至150%',blackboard:[{key:'atk_scale',value:1.5}]}]}};
 assert.equal(statMods(b,conditional).ratio.atk,0);
});

test('individual skill adapters map namespaced values, status and battle resources',()=>{
 const {b}=openBattle({name:'德克萨斯',chessId:'chess_char_1_08_b',skillIndex:1});deployNow(b);
 const u=byId(b,'char_102_texas'),e=enemy(b,{x:u.x,y:u.y,hp:100000,res:0}),funds=b.s.cost;
 u.sp=b.spCost(u);b.activate(u);
 assert.ok(e.hp<100000);assert.ok(e.statuses.some(s=>s.kind==='stun'));assert.ok(b.s.cost>funds);
});

test('probability talent multiplier changes the current hit without recursive extra damage',()=>{
 const {b}=openBattle({name:'跃跃',chessId:'chess_char_1_09_b'});deployNow(b);
 const u=byId(b,'char_4100_caper'),e=enemy(b,{hp:1000,def:0}),original=b.profile.bind(b);
 b.profile=actor=>actor===u?{...original(actor),activeTalents:[{name:'戏耍随心',description:'攻击时，25%几率当次攻击的攻击力提升至150%',blackboard:[{key:'prob',value:.25},{key:'talent_scale',value:1.5}]}]}:original(actor);
 b.economy.random=()=>0;
 dealDamage(b,{source:u,target:e,amount:100,type:'true',cause:'attack'});
 assert.equal(e.hp,850);assert.equal(b.s.logicLog.filter(x=>x.type==='damage').length,1);
});

test('duration skills with periodic damage create a timed logic zone',()=>{
 // 莫斯提马 S2「荒时之锁」有专属圈 mostma-s2（挂攻击范围）。通用 skill-zone 兜底已收窄成白名单
 // （只有浊心斯卡蒂 S3 与深靛 S2），见 docs/SKILL_RANGE_AUDIT_2026-09-22.md 与 tests/native-podego-bottle.test.mjs。
 const {b}=openBattle({name:'莫斯提马',chessId:'chess_char_4_02_b',skillIndex:1});deployNow(b);
 const u=byId(b,'char_213_mostma'),e=enemy(b,{x:u.x+1,y:u.y,hp:10000,res:0});u.sp=b.spCost(u)+1;b.activate(u);
 assert.equal(b.s.logicEffects.some(x=>x.talentOrSkillId.startsWith('skill-zone:')),false,'通用兜底圈不该再出现');
 const zone=b.s.logicEffects.find(x=>x.talentOrSkillId==='mostma-s2');
 assert.ok(zone);assert.equal(zone.rangeUid,u.uid);assert.ok(e.statuses.some(s=>s.kind==='stun'));const hp=e.hp;for(let i=0;i<35;i++)b.step();assert.ok(e.hp<hp);
});

test('skill target rules alter acquisition without changing the shared priority engine',()=>{
 const {b}=openBattle({name:'隐现',chessId:'chess_char_1_01_b',skillIndex:1});deployNow(b);const u=b.s.units[0];
 const ranged=enemy(b,{x:u.x+1,y:u.y,ranged:true,range:3}),melee=enemy(b,{x:u.x,y:u.y+1,ranged:false,range:0});
 assert.equal(b.targets(u)[0].uid,ranged.uid);assert.ok(b.targets(u).every(e=>e.ranged||e.canAttack&&e.range>0));
});

test('status flags and bounded push/pull share the simulation state',()=>{
 const {b}=openBattle({name:'隐现',chessId:'chess_char_1_01_b',skillIndex:0});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y});
 applyStatus(e,'invisible',1e3,{source:u.uid,resistible:false});assert.equal(e.invisible,true);assert.equal(b.targets(u).length,0);e.revealed=true;e.block=u.uid;assert.equal(b.targets(u).length,1);tickStatuses(e,1e3);assert.equal(e.invisible,false);
 const before=e.x;assert.equal(moveActor(b,e,u,'推开'),true);assert.equal(e.x,before+1);assert.equal(moveActor(b,e,u,'拉向'),true);assert.equal(e.x,before);
});

test('element damage only keeps one type and same-frame damage keeps the larger accumulation',()=>{
 const {b}=openBattle({name:'焰影苇草',chessId:'chess_char_6_08_b'});deployNow(b);const u=b.s.units[0],e=enemy(b,{hp:20000});
 const a=applyElementDamage(b,{source:u,target:e,amount:400,type:'burn'});assert.equal(a.burst,false);assert.equal(e.elemental.burn,400);
 const neural=applyElementDamage(b,{source:u,target:e,amount:120,type:'neural'});assert.equal(neural.burst,false);assert.equal(neural.immune,true);assert.equal(e.elemental.neural,undefined);assert.equal(e.elemental.burn,400);
 const c=applyElementDamage(b,{source:u,target:e,amount:600,type:'burn'});assert.equal(c.burst,true);assert.equal(e.elemental.burn||0,0);assert.equal(e.elementBurst,1);assert.equal(b.s.logicLog.filter(x=>x.type==='element').length,2);
 const e2=enemy(b,{hp:20000}),first=applyElementDamage(b,{source:u,target:e2,amount:400,type:'burn'}),higher=applyElementDamage(b,{source:u,target:e2,amount:600,type:'neural'});assert.equal(first.added,400);assert.equal(higher.added,200);assert.equal(e2.elementalType,'neural');assert.equal(e2.elemental.neural,600);assert.equal(applyElementDamage(b,{source:u,target:e2,amount:100,type:'burn'}).immune,true);
});

test('shield and lock fields are discoverable from skill blackboards',()=>{
 const {b}=openBattle({name:'新约能天使',chessId:'chess_char_6_13_b',skillIndex:1});deployNow(b);const u=b.s.units[0];
 const cfg=operatorSkillConfig(b,u);assert.ok(cfg.description.includes('屏障'));assert.equal(cfg.bb.shield_max_hp_ratio,2);
});

test('resource adapter preserves named ammo consumption instead of assuming one shot',()=>{
 const {b}=openBattle({name:'新约能天使',chessId:'chess_char_6_13_b',skillIndex:2});deployNow(b);const u=b.s.units[0];u.sp=b.spCost(u);b.activate(u);
 assert.equal(u.ammo,50);assert.equal(u.ammoPerAttack,5);
 const cfg=operatorSkillConfig(b,u);assert.equal(cfg.ammoPerAttack,5);
});

test('runtime contains the pinned summon token catalogue for later per-operator adapters',()=>{
 assert.ok(Object.keys(NATIVE_DATA.tokens||{}).length>=60);
 for(const token of ['token_10000_silent_healrb','token_10015_dusk_drgn','token_10019_nearl2_sword','token_10028_vigil_wolf','token_10041_cathy_catsld'])assert.equal(NATIVE_DATA.tokens[token].kind,'summon');
});

test('area skill adapters retain both enemy damage and ally regeneration channels',()=>{
 const {b}=openBattle({chessId:'chess_char_5_15_b',skillIndex:1});deployNow(b);const u=b.s.units[0];u.sp=b.spCost(u);b.activate(u);
 const zones=b.s.logicEffects.filter(f=>f.sourceUid===u.uid);assert.ok(zones.some(f=>f.values?.dot&&f.trackArea));assert.ok(zones.some(f=>f.values?.hot&&f.trackArea));assert.ok(zones.every(f=>f.endsAt===null));
});

test('generic periodic zone is allow-listed: 塞雷娅 S3/流明 S1 不再有兜底伤害圈，友军不会被打',()=>{
 // 通用兜底圈只留给核对过的技能（浊心斯卡蒂 S3、深靛 S2），并在文案写「范围内」时挂施法者的攻击范围。
 // 塞雷娅 S3「钙质化」只有回血/易伤/减速，本来就没有周期伤害——此前兜底圈会打友军（2026-09-22 修的）。
 const saria=openBattle([{chessId:'chess_char_5_11_b',skillIndex:2},{chessId:'chess_char_1_20_b',skillIndex:1}]);deployNow(saria.b);
 const su=byId(saria.b,'char_202_demkni'),ally=byId(saria.b,'char_107_liskam');
 ally.hp=ally.maxHp-300;su.sp=saria.b.spCost(su);saria.b.activate(su);
 assert.equal(saria.b.s.logicEffects.some(f=>String(f.talentOrSkillId||'').startsWith('skill-zone:char_202_demkni')),false,'塞雷娅 S3 没有周期伤害，不该建兜底圈');
 const sariaZone=saria.b.s.logicEffects.find(f=>f.talentOrSkillId==='saria-s3');
 assert.equal(sariaZone?.rangeUid,su.uid,'专属圈按攻击范围');
 const allyHp=ally.hp;for(let i=0;i<35;i++)saria.b.step();assert.ok(ally.hp>=allyHp,'友军不会被自己的圈打到');
 // 流明 S1 写的是「友方每秒受到…治疗效果」，压根不是伤害：不该给治疗技挂一个打敌人的周期圈。
 const lumen=openBattle([{...reps.operators.lumen,skillIndex:0},reps.operators.yak]);deployNow(lumen.b);
 const lu=byId(lumen.b,'char_4042_lumen'),luAlly=byId(lumen.b,'char_199_yak');
 luAlly.x=lu.x+1;luAlly.y=lu.y;luAlly.hp=luAlly.maxHp-60;lu.sp=lumen.b.spCost(lu)+2;lumen.b.activate(lu);lumen.b.heal(lu,luAlly,8);
 assert.ok(!lumen.b.s.logicEffects.some(f=>String(f.talentOrSkillId||'').startsWith('skill-zone:')),'纯治疗文案不建周期伤害圈');
 assert.ok(lumen.b.s.logicEffects.some(f=>f.kind==='hot'),'治疗通道照旧');
 const luHp=luAlly.hp;for(let i=0;i<35;i++)lumen.b.step();assert.ok(luAlly.hp>=luHp);
 // 白名单内的两个技能照旧建圈，且按「范围内」挂攻击范围
 const skadi=openBattle({chessId:'chess_char_6_04_b',skillIndex:2});deployNow(skadi.b);
 const sk=skadi.b.s.units[0];sk.sp=skadi.b.spCost(sk)+2;sk.lastSkill=-Infinity;skadi.b.activate(sk);
 const skZone=skadi.b.s.logicEffects.find(f=>String(f.talentOrSkillId||'').startsWith('skill-zone:char_1012_skadi2'));
 assert.ok(skZone,'浊心斯卡蒂 S3 保留通用圈');assert.equal(skZone.rangeUid,sk.uid,'「范围内」＝她自己的攻击范围');assert.equal(skZone.trackSide,'enemy');
 const indigo=openBattle({chessId:'chess_char_1_17_b',skillIndex:1});deployNow(indigo.b);
 const ig=indigo.b.s.units[0];ig.sp=indigo.b.spCost(ig)+2;ig.lastSkill=-Infinity;indigo.b.activate(ig);
 const igZone=indigo.b.s.logicEffects.find(f=>String(f.talentOrSkillId||'').startsWith('skill-zone:char_469_indigo'));
 assert.ok(igZone,'深靛 S2 保留通用圈');assert.equal(igZone.values.requiresStatus,'root','只打处于束缚状态的敌人');
});

test('timed ammo talents grant their bonus once and feed the next activation',()=>{
 const {b}=openBattle({chessId:'chess_char_1_01_b',skillIndex:1});deployNow(b);const u=b.s.units[0];
 for(let i=1;i<=600;i++){b.s.time=i/30;tickLogic(b,1/30);}
 assert.equal(u.talentAmmoBonus,3);u.sp=b.spCost(u);b.activate(u);assert.equal(u.ammo,17);
});
