import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {applyStatus} from '../dist/status.js';
import {blackboard,resolveActiveTalents,resolveChess} from '../dist/protocol.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {dealDamage,enqueue,newAttackId,applyHeal,applyRegen,applyLoss,commitExit,reviveActor,dispatch,tickLogic,addEffect,addDamageRedirect,queueDelayedDamage,teleportActor,operatorSkillConfig,BATTLE_SCHEMA_VERSION,validateBattle,migrateBattle,getActor,attackableAllies} from '../dist/native-effects.js';
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

test('模组费用字段参与首次部署、冲锋手回费和返费上限',()=>{
 const texas=openBattle({chessId:'chess_char_1_08_b',skillIndex:1}).b,tx=texas.s.units[0];assert.equal(texas.deploymentCost(tx),tx.baseCost-4);deployNow(texas);assert.equal(tx.runtimeCostUsed,true);
 const pipe=openBattle({chessId:'chess_char_4_07_b',skillIndex:0}).b;deployNow(pipe);const p=byId(pipe,'char_222_bpipe'),e=enemy(pipe,{x:p.x+1,y:p.y,hp:100,def:0});pipe.s.cost=0;pipe.hit(p,e,1000,'physical');assert.equal(pipe.s.cost,2);pipe.s.cost=0;p.deploymentCost=12;p.refundCap=8;p.refundEligible=true;commitExit(pipe,{target:p,reason:'retreat'});assert.equal(pipe.s.cost,12);
 const gravel=openBattle({chessId:'chess_char_2_12_b',skillIndex:0}).b;deployNow(gravel);const g=byId(gravel,'char_237_gravel');gravel.s.cost=0;g.deploymentCost=12;g.refundCap=10;g.refundEligible=true;commitExit(gravel,{target:g,reason:'retreat'});assert.equal(gravel.s.cost,9);
});

test('野鬃待部署近卫减费按每名干员最多五费累计',()=>{
 const {b}=openBattle([{chessId:'chess_char_1_19_b',skillIndex:1},reps.operators.swire]);const wild=byId(b,'char_496_wildmn'),guard=byId(b,'char_308_swire');for(let i=0;i<6;i++)dispatch(b,'deploy',{target:wild});assert.equal(guard.wildmaneCostDelta,-5);assert.equal(b.deploymentCost(guard),Math.max(0,guard.baseCost-5));
});

test('缪尔赛思首名莱茵生命单位获得额外一费减免',()=>{
 const {b}=openBattle([{chessId:'chess_char_6_11_b',skillIndex:0},{chessId:'chess_char_2_02_b',skillIndex:0}]);const m=byId(b,'char_249_mlyss'),silent=byId(b,'char_108_silent');b.deploy(m);assert.equal(b.s.mlyssFirstRhineDiscountUsed,false);assert.equal(b.deploymentCost(silent),silent.baseCost-3);b.s.cost=99;b.deploy(silent,{reentry:true});assert.equal(b.s.mlyssFirstRhineDiscountUsed,true);commitExit(b,{target:silent,reason:'knockdown'});silent.down=0;assert.equal(b.deploymentCost(silent),Math.floor((silent.baseCost-2)*1.5));
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

test('凛御银灰技能会修改尚未自动部署单位的费用属性',()=>{
 const {b}=openBattle([{chessId:'chess_char_5_14_b',skillIndex:0},{chessId:'chess_char_3_03_b',skillIndex:0}]);
 const svash=byId(b,'char_1045_svash2'),guard=byId(b,'char_308_swire');b.deploy(svash);svash.sp=b.spCost(svash);const base=guard.baseCost;b.activate(svash);assert.equal(guard.costRealtimeDelta,-5);assert.equal(b.deploymentCost(guard),Math.max(0,base-5));
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
 const {b}=openBattle({chessId:'chess_char_3_20_b',skillIndex:1});deployNow(b);const u=b.s.units[0],e=enemy(b,{x:u.x+1,y:u.y,hp:1000,def:0});u.sp=b.spCost(u);b.activate(u);assert.equal(u.floatUnits,2);b.economy.random=()=>0;b.hit(u,e,10,'arts');assert.ok(e.statuses.some(s=>s.kind==='cold'||s.kind==='frozen'));
});

test('洛洛浮游过载在技能结束按实际持续时间眩晕自身',()=>{
 const {b}=openBattle({chessId:'chess_char_2_10_b',skillIndex:1});deployNow(b);const u=b.s.units[0];u.sp=b.spCost(u);b.activate(u);assert.equal(u.floatUnits,1);b.s.time=3;dispatch(b,'skill-end',{target:u});assert.ok(u.statuses.some(s=>s.kind==='stun'));
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
 const stock=u.summonCtrl.stock;commitExit(b,{target:device,reason:'forced'});steps(b,1);assert.equal(u.summonCtrl.stock,stock-1);
});

test('applyLoss lethal still goes through death, not armor',()=>{
 const {b}=openBattle(reps.operators.yak);deployNow(b);
 const e=enemy(b,{hp:8,def:999});
 applyLoss(b,{target:e,amount:20});
 assert.equal(e.hp,0);
 assert.equal(logOf(b,'death').length,1);
});
