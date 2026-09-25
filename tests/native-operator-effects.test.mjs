import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveActiveTalents} from '../dist/protocol.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {operatorRegistry,skillConfig,statMods} from '../dist/native-operator-effects.js';
import {openBattle,deployNow,enemy,byId,reps,blackboard} from './effects-harness.mjs';
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
 // 引星棘刺 S2「解构涌潮」：炼金单元同时带「每秒法术伤害」与「友方每秒回复」两条通道，
 // 回复走 `values.regen`（加生命回复速度，不受治疗加成/禁疗影响），并且时长有限（projectile_delay_time + 天赋延长）。
 const {b}=openBattle({chessId:'chess_char_5_15_b',skillIndex:1});deployNow(b);const u=b.s.units[0];u.sp=b.spCost(u);b.activate(u);
 const zones=b.s.logicEffects.filter(f=>f.sourceUid===u.uid);assert.ok(zones.some(f=>f.values?.dot&&f.trackArea),'每秒伤害通道');assert.ok(zones.some(f=>f.values?.regen&&f.trackArea),'友方每秒回复通道');assert.ok(zones.every(f=>Number.isFinite(f.endsAt)),'炼金单元有存活时长，不是常驻圈');
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

test('天赋附带的元素损伤只认显式元素比例键：焰影苇草「灼痕」的 1.15 是法术脆弱，不是灼燃',()=>{
 // 同一次排查里发现的同型错误：天赋版兜底把 `damage_scale`／`elementScale` 也当元素比例，
 // 焰影苇草「灼痕」的 damage_scale:1.15 因此被当成灼燃损伤，**每次攻击**都挂 115% 攻击力的灼燃。
 const source=readFileSync(new URL('../dist/native-operator-effects.js',import.meta.url),'utf8');
 assert.match(source,/const talentElement=Number\(bb\.ep_damage_ratio\?\?bb\.element_damage_scale\)/,'天赋元素比例只认 ep_damage_ratio／element_damage_scale');
 assert.ok(!/talentElement=Number\([^)\n]*\?\?bb\.damage_scale/.test(source),'不能把 damage_scale（法术脆弱倍率）当元素比例');
 assert.ok(!/talentElement=Number\([^)\n]*\?\?bb\.ep_damage_scale/.test(source),'烛煌的 ep_damage_scale 属于「熔点引爆」专属结算，不能进通用天赋表');
 const reed=openBattle([{chessId:'chess_char_6_08_a'}]);deployNow(reed.b);
 const ru=byId(reed.b,'char_1020_reed2'),re=enemy(reed.b,{x:ru.x+1,y:ru.y,hp:1e5});
 reed.b.hit(ru,re,10,'arts');
 assert.deepEqual(re.elemental||{},{} ,'灼痕不是元素损伤');
 assert.ok((re.statuses||[]).some(s=>s.kind==='burn'),'「灼痕」标记状态照旧');
 // 通用天赋元素通道的既有用户必须继续生效：塑心「无词哀歌」、盟约·辅助干员「迭代元素」
 const cello=openBattle([{chessId:'chess_char_6_09_a'}]);deployNow(cello.b);
 const cu=byId(cello.b,'char_245_cello'),ce=enemy(cello.b,{x:cu.x+1,y:cu.y,hp:1e5});
 cello.b.hit(cu,ce,10,'arts');
 assert.ok((ce.elemental?.necrosis||0)>0,'塑心天赋仍按 ep_damage_ratio 挂凋亡损伤');
 const pith=openBattle([{chessId:'chess_char_1_15_a'}]);deployNow(pith.b);
 const pu=byId(pith.b,'char_616_pithst');
 assert.ok(pu,'盟约·辅助干员在名册里');
 const pp=pith.b.profile(pu),pt=(pp.activeTalents||resolveActiveTalents({talents:pp.talents},pp.status,{modulePhase:pp.modulePhase})).find(t=>t.name==='迭代元素');
 const pe=enemy(pith.b,{x:pu.x+1,y:pu.y,hp:1e5});pith.b.hit(pu,pe,10,'arts');
 const bar=Object.values(pe.elemental||{}).reduce((n,v)=>n+v,0);
 // 类型归属未定价：文案同时写了神经/灼燃/凋亡三种，通用通道按「凋亡＞神经＞灼燃」的先后来选，
 // 与 PRTS 的「神经损伤（优先）」不一致（见 docs/ELEMENT_DAMAGE_AUDIT_2026-09-22.md 待办）。这里只锁数值口径。
 assert.ok(Math.abs(bar-pith.b.stats(pu).atk*Number(blackboard(pt.blackboard).ep_damage_ratio))<1e-6,'「迭代元素」仍挂元素损伤');
});
test('烛煌的攻击不再凭空累计灼燃损伤：普通攻击／S2／S3 都不挂元素，元素只在区域与 S3 条件分支里',()=>{
 // 2026-09-22 用户报「烛煌的攻击不知道为什么能累计灼烧」。根因是 native-operator-effects 里那条
 // 「技能文案里出现 灼燃／凋亡／元素伤害 就按 atkScale 给每次攻击挂元素」的通用兜底：烛煌 S2 的元素属于
 // 「灼烧地段」（经过的敌人每秒），S3 的元素只在目标处于灼燃爆发期间，都不是每次攻击的附属效果。
 // 现在兜底只对 GENERIC_ELEMENT_SKILLS 生效，且已核对过的技能一律不得进表。
 const source=readFileSync(new URL('../dist/native-operator-effects.js',import.meta.url),'utf8');
 assert.match(source,/GENERIC_ELEMENT_SKILLS\.has\(source\.id\+'#'\+/,'通用元素兜底必须走白名单');
 const list=/const GENERIC_ELEMENT_SKILLS=new Set\(\[([^\]]*)\]\)/.exec(source);
 assert.ok(list,'通用元素白名单必须存在');
 for(const id of ['char_1040_blaze2','char_4146_nymph','char_4148_philae','char_245_cello'])assert.ok(!list[1].includes(id),id+' 已有专属实现，不得进通用元素白名单');
 // 常态普通攻击：六次攻击后一点灼燃都不该有
 const plain=openBattle([{chessId:'chess_char_5_03_a'}]);deployNow(plain.b);
 const pu=byId(plain.b,'char_1040_blaze2'),pe=enemy(plain.b,{x:pu.x+1,y:pu.y,hp:1e5});
 for(let i=0;i<6;i++)plain.b.hit(pu,pe,10,'arts');
 assert.deepEqual(pe.elemental||{},{} ,'常态攻击不挂灼燃');
 // S3「众恶的焚场」是弹药型技能，攻击仍然是普通攻击——同样不该挂元素
 const s3=openBattle([{chessId:'chess_char_5_03_a',skillIndex:2}]);deployNow(s3.b);
 const u3=byId(s3.b,'char_1040_blaze2'),e3=enemy(s3.b,{x:u3.x+1,y:u3.y,hp:1e5});
 u3.sp=s3.b.spCost(u3);s3.b.activate(u3);u3.ammo=99;
 for(let i=0;i<6;i++)s3.b.hit(u3,e3,10,'arts');
 assert.deepEqual(e3.elemental||{},{} ,'S3 的攻击不挂灼燃（只有灼燃爆发期间才有额外元素伤害）');
 // S2「沸血燎原」：攻击挂的是「灼烧地段」这个圈，圈里每秒才结算元素损伤
 const s2=openBattle([{chessId:'chess_char_5_03_a',skillIndex:1}]);deployNow(s2.b);
 const u2=byId(s2.b,'char_1040_blaze2'),e2=enemy(s2.b,{x:u2.x+1,y:u2.y,hp:1e5});
 u2.sp=s2.b.spCost(u2);s2.b.activate(u2);u2.ammo=99;
 for(let i=0;i<6;i++)s2.b.hit(u2,e2,10,'arts');
 assert.deepEqual(e2.elemental||{},{} ,'S2 的攻击本身不挂灼燃');
 const zone=s2.b.s.logicEffects.find(f=>String(f.talentOrSkillId||'').startsWith('blaze2-s2-'));
 assert.ok(zone,'S2 要在目标脚下留下灼烧地段');
 assert.equal(zone.values.elementOffDamage,true,'「相当于法术伤害的30%」＝按这一次伤害算，不是按攻击力算');
 for(let i=0;i<35;i++)s2.b.step();
 assert.ok(Math.abs((e2.elemental.burn||0)-zone.snapshot.damage*zone.values.elementScale)<1e-6,'地段挂的灼燃＝该次法术伤害×30%');
});
test('烛煌 S3「众恶的焚场」的额外元素伤害只在目标处于灼燃爆发期间结算',()=>{
 const {b}=openBattle([{chessId:'chess_char_5_03_a',skillIndex:2}]);deployNow(b);
 const u=byId(b,'char_1040_blaze2'),e=enemy(b,{x:u.x+1,y:u.y,hp:1e5});
 u.sp=b.spCost(u);b.activate(u);u.ammo=99;
 const scale=Number(operatorSkillConfig(b,u).bb['attack@atk_scale'])||.6,atk=b.stats(u).atk;
 b.s.logicLog.length=0;b.hit(u,e,10,'arts');
 assert.equal((b.s.logicLog||[]).filter(x=>x.type==='damage'&&x.cause==='extra').length,0,'目标没在灼燃爆发期就不追加元素伤害');
 e.elementBurstUntil=b.s.time+10;e.elementBurstType='burn';
 b.s.logicLog.length=0;b.hit(u,e,10,'arts');
 const extra=(b.s.logicLog||[]).filter(x=>x.type==='damage'&&x.cause==='extra');
 assert.equal(extra.length,1,'灼燃爆发期追加一次元素伤害');
 assert.ok(Math.abs(extra[0].hp-atk*scale)<1e-6,'追加量＝攻击力×'+(scale*100)+'%');
});
test('烛煌天赋「熔点引爆」：敌人灼燃爆发时造成元素伤害并自回血，S3 期间补弹药，其他元素爆发不触发',()=>{
 const open=skillIndex=>{const s=openBattle([{chessId:'chess_char_5_03_a',skillIndex}]);deployNow(s.b);const u=byId(s.b,'char_1040_blaze2'),e=enemy(s.b,{x:5,y:5,hp:1e5});const p=s.b.profile(u);const talent=(p.activeTalents||resolveActiveTalents({talents:p.talents},p.status,{modulePhase:p.modulePhase})).find(t=>t.name==='熔点引爆');return {s,u,e,bb:blackboard(talent.blackboard)};};
 // 不开技：灼燃爆发 → 对爆发的敌人按天赋黑板的 ep_damage_scale 造成元素伤害，并按 hp_ratio 回自己的血
 const a=open(0);a.u.hp=Math.round(a.u.maxHp*.5);const atk=a.s.b.stats(a.u).atk,hp0=a.u.hp;
 applyElementDamage(a.s.b,{source:a.u,target:a.e,amount:1200,type:'burn'});
 const extra=(a.s.b.s.logicLog||[]).filter(x=>x.type==='damage'&&x.cause==='extra'&&x.sourceUid===a.u.uid);
 assert.equal(extra.length,1,'天赋要在敌人灼燃爆发时立刻出手');
 assert.ok(Math.abs(extra[0].hp-atk*a.bb.ep_damage_scale)<1e-6,'伤害＝攻击力×'+a.bb.ep_damage_scale);
 assert.ok(Math.abs((a.u.hp-hp0)-a.u.maxHp*a.bb.hp_ratio)<1e-6,'回血＝最大生命×'+a.bb.hp_ratio);
 assert.ok(!a.u.ammo,'没开 S3 不该补弹药');
 // 凋亡损伤爆发（不是灼燃）不触发
 const b2=open(0);const h0=b2.e.hp;applyElementDamage(b2.s.b,{source:b2.u,target:b2.e,amount:1200,type:'necrosis'});
 assert.equal((b2.s.b.s.logicLog||[]).filter(x=>x.type==='damage'&&x.cause==='extra'&&x.sourceUid===b2.u.uid).length,0,'只有灼燃爆发才触发');
 assert.equal(b2.e.hp,h0,'凋亡爆发不由天赋结算');
 // S3 弹药型技能期间：按技能黑板的 ammo_recover 补弹药
 const c=open(2);c.u.sp=c.s.b.spCost(c.u);c.s.b.activate(c.u);c.u.ammo=5;
 applyElementDamage(c.s.b,{source:c.u,target:c.e,amount:1200,type:'burn'});
 assert.equal(c.u.ammo,5+Number(operatorSkillConfig(c.s.b,c.u).bb.ammo_recover),'S3 期间灼燃爆发补弹药');
});
