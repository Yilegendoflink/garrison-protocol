import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';
import {NativeBattle} from '../dist/native-battle.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {applyStatus} from '../dist/status.js';
import {dealDamage,commitExit} from '../dist/native-effects.js';
import {changeEnemySp} from '../dist/native-enemy-skills.js';

function arena(){
 const g=new NativeSession(NATIVE_DATA,{seed:42});g.s.funds=100;assert.ok(g.perform('buy',0));
 const unit=g.s.units[0];let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(unit.uid,x,y))placed=g.deploy(unit.uid,x,y,0);
 assert.ok(placed);assert.ok(g.perform('start'));const b=g.battle;
 b.s.queue=[];b.s.enemies=[];b.s.limit=1000;const ally=b.s.units[0];b.s.units=[];
 const events=[],emit=b.emit.bind(b);b.emit=(kind,row)=>{events.push({kind,...row,time:b.s.time});emit(kind,row);};
 return {b,g,ally,events};
}
function spawn(b,id,x=3,y=3,raw=NATIVE_DATA.enemies[id]){
 raw??=NATIVE_DATA.enemyDependencies[id];
 const origin=b.map.origin,spot={col:origin.col+x,row:origin.row-y};
 b.level={...b.level,routes:[{motionMode:raw.motion,startPosition:spot,endPosition:spot,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...b.level.enemyProfiles,[id]:raw}};
 b.spawn({id,route:0});return b.s.enemies.at(-1);
}
function advance(b,seconds){for(let i=0;i<Math.round(seconds*30);i++)b.step();}
function addAlly(b,ally,x,y){ally.x=x;ally.y=y;ally.deployed=true;ally.hp=ally.maxHp;applyStatus(ally,'disarm',600);b.s.units.push(ally);}

test('圣堂剑士无攻击目标也每6秒消耗一发弹药，零自然回复且耗尽后停止成长',()=>{
 const {b}=arena(),e=spawn(b,'enemy_10087_hlchgr');const atk=e.atk,speed=e.speed;
 assert.equal(e.sp,5);advance(b,5.9);assert.equal(e.enhanceStacks,undefined);
 applyStatus(e,'silence',60);advance(b,.1);assert.equal(e.sp,4);assert.equal(e.enhanceStacks,1);
 assert.equal(e.atk,atk*1.2);assert.equal(e.speed,speed*1.2);
 advance(b,30);assert.equal(e.sp,0);assert.equal(e.enhanceStacks,5);assert.equal(e.atk,atk*2);
 changeEnemySp(e,99);assert.equal(e.sp,5);advance(b,30);assert.equal(e.enhanceStacks,10);assert.equal(e.sp,0);
});

test('黑云只抓取范围内普通飞行敌人，4秒后吞噬补弹，全弹发射耗尽实际弹药',()=>{
 const {b,ally,events}=arena(),cloud=spawn(b,'enemy_9009_acfort',1,1);
 const drones=[0,1,2,3].map(i=>spawn(b,'enemy_1005_yokai',1+i*.2,2));
 const elite=spawn(b,'enemy_1112_emppnt',1,2);assert.equal(elite.enemyRank,'ELITE');
 const ground=spawn(b,'enemy_1007_slime',1,2),far=spawn(b,'enemy_1005_yokai',9,5);
 advance(b,5);assert.equal(cloud.enemyCast.victims.length,3);assert.equal(cloud.sp,0);
 advance(b,3.9);assert.ok(drones.every(e=>e.hp>0));advance(b,.1);
 assert.equal(drones.filter(e=>e.hp<=0).length,3);assert.equal(cloud.sp,3);
 assert.ok(elite.hp>0&&ground.hp>0&&far.hp>0);assert.equal(b.s.kills,3);
 cloud.atk=1;addAlly(b,ally,8,1);advance(b,.1);
 assert.equal(cloud.sp,0);assert.equal(events.filter(e=>e.kind==='hit'&&e.uid===ally.uid).length,3);
 assert.ok(events.some(e=>e.kind==='enemy-skill-start'&&e.skill==='FireWeapon'));
});

test('黑云吞噬被沉默打断或死亡时解除受害者标记，不补弹也不击杀',()=>{
 for(const exit of ['silence','death']){
  const {b}=arena(),cloud=spawn(b,'enemy_9009_acfort'),victim=spawn(b,'enemy_1005_yokai',3,4);
  advance(b,5);assert.equal(victim.swallowedBy,cloud.uid);
  if(exit==='silence')applyStatus(cloud,'silence',10);else commitExit(b,{target:cloud});
  advance(b,.1);assert.equal(victim.swallowedBy,undefined);assert.ok(victim.hp>0);assert.equal(cloud.sp,0);
 }
});

test('战车使用初始满SP开炮，普通攻击回SP但不产生额外污染圈',()=>{
 const {b,ally}=arena(),e=spawn(b,'enemy_1272_nhtank',3,3);addAlly(b,ally,4,3);e.atk=1;
 assert.equal(e.sp,2);advance(b,1.5);assert.equal(e.sp,0);
 assert.equal(b.s.logicEffects.filter(f=>f.kind==='field').length,1);
 const before=b.s.logicEffects.length;b.resolveEnemyStrike(e,ally,{});b.resolveEnemyAttackEffects(e,ally);
 assert.equal(e.sp,1);assert.equal(b.s.logicEffects.length,before);
});

test('攻击击杀目标仍回复敌方SP，技能命中不当成普通攻击回点',()=>{
 const {b,ally}=arena(),e=spawn(b,'enemy_1183_mlasrt');ally.hp=0;
 b.resolveEnemyAttackEffects(e,ally);assert.equal(e.sp,1);
 b.resolveEnemyAttackEffects(e,ally,{extra:{prefab:'PowerAttack'}});assert.equal(e.sp,1);
});

test('受击回复走伤害入口且持续伤害不回点，自动回复与上限独立',()=>{
 const {b}=arena(),raw=structuredClone(NATIVE_DATA.enemies.enemy_1007_slime);
 raw.spData={spType:'INCREASE_WHEN_TAKEN_DAMAGE',initSp:0,maxSp:2,increment:1};
 const e=spawn(b,'taken',3,3,raw);
 dealDamage(b,{target:e,value:1,cause:'attack'});assert.equal(e.sp,1);
 dealDamage(b,{target:e,value:1,cause:'dot'});assert.equal(e.sp,1);
 dealDamage(b,{target:e,value:1,cause:'attack'});assert.equal(e.sp,2);
 e.enemySp={type:'INCREASE_WITH_TIME',max:3,increment:1};e.sp=0;advance(b,2);assert.ok(Math.abs(e.sp-2)<1e-8);
 advance(b,2);assert.equal(e.sp,3);
});

test('冷却与SP必须同时满足，多技能优先级保留，未知技能不伪装成普攻特效',()=>{
 const {b}=arena(),raw=structuredClone(NATIVE_DATA.enemies.enemy_1183_mlasrt);
 raw.skills=[{prefabKey:'PowerAttack',priority:0,initCooldown:10,cooldown:10,spCost:1,blackboard:[]},{prefabKey:'StunAttack',priority:2,initCooldown:0,cooldown:3,spCost:1,blackboard:[]},{prefabKey:'NotImplemented',priority:9,initCooldown:0,cooldown:0,spCost:0,blackboard:[]}];
 const e=spawn(b,'priority',3,3,raw),target={hp:10,x:3,y:3};e.sp=2;
 assert.equal(e.enemySkills.length,3);assert.equal(b.enemySpecialReady(e,target).prefab,'StunAttack');
 e.enemySkills[1].nextAt=5;assert.equal(b.enemySpecialReady(e,target),null);
 advance(b,10);assert.equal(b.enemySpecialReady(e,target).prefab,'PowerAttack');
 e.sp=0;assert.equal(b.enemySpecialReady(e,target),null);
});

test('战斗JSON存档保留敌方SP、独立CD、圣堂剑士下一次触发时间',()=>{
 const {b,g}=arena(),e=spawn(b,'enemy_10087_hlchgr');advance(b,7);
 const saved=JSON.parse(JSON.stringify(b.s));
 const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,saved);assert.ok(restored);
 const after=restored.s.enemies.find(x=>x.uid===e.uid);assert.equal(after.sp,4);assert.equal(after.nextEnhanceAt,12);
 advance(restored,5);assert.equal(after.sp,3);assert.equal(after.enhanceStacks,2);
});

test('枯朽萃聚使徒首放10秒，完成施法后生成三只飞行枯朽之种',()=>{
 const {b}=arena(),parent=spawn(b,'enemy_1321_wdarft');advance(b,10.6);
 assert.equal(b.s.enemies.length,1);advance(b,.1);
 const children=b.s.enemies.filter(e=>e.id==='enemy_1269_nhfly');assert.equal(children.length,3);
 assert.deepEqual(children.map(e=>e.x),[parent.x,parent.x-1,parent.x+1]);assert.ok(children.every(e=>e.flying));
 assert.equal(parent.enemySkills.find(s=>s.prefab==='BornBugs').nextAt,20.7);
});

test('术师快艇死亡延迟召唤不会提前清场，待生成队列经JSON存档保留',()=>{
 const {b,g}=arena(),parent=spawn(b,'enemy_1162_magmot');commitExit(b,{target:parent});advance(b,.4);
 assert.equal(b.s.finished,false);assert.equal(b.s.pendingEnemySpawns.length,1);assert.equal(b.s.enemies.length,0);
 const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);
 advance(restored,.4);assert.equal(restored.s.enemies.length,1);assert.equal(restored.s.enemies[0].id,'enemy_1161_tidmag');assert.equal(restored.s.enemies[0].flying,false);
});

test('枯朽之种完成一次攻击后自毁，缺省属性不会生成NaN',()=>{
 const {b,ally}=arena();addAlly(b,ally,3,3);const seed=spawn(b,'enemy_1269_nhfly',3,4);seed.atk=1;
 assert.equal(seed.def,0);assert.equal(seed.res,0);advance(b,.5);assert.equal(seed.hp,0);assert.equal(b.s.kills,1);
});

test('拷打者死亡生成血珀，无祭坛时每秒流失10%生命且不移动不阻挡',()=>{
 const {b}=arena(),parent=spawn(b,'enemy_1364_spnaxe_2');commitExit(b,{target:parent});b.step();
 const blood=b.s.enemies.filter(e=>e.id==='enemy_1367_dseed');assert.equal(blood.length,2);
 assert.ok(blood.every(e=>e.formHold&&e.unblockable&&!e.canAttack));const first=blood[0],hp=first.hp,x=first.x;
 advance(b,1);assert.equal(first.hp,hp*.9);assert.equal(first.x,x);
});

test('用户范围豁免搭桥：两种船工保留隐匿/普攻和原表，但不运行BuildBridge且允许随机入池',()=>{
 for(const id of ['enemy_10042_prtrop','enemy_10042_prtrop_2']){
  const {b}=arena(),e=spawn(b,id),raw=NATIVE_DATA.enemies[id];
  assert.ok(raw.skills.some(s=>s.prefabKey==='BuildBridge'),'原表资料保留');assert.deepEqual(raw.enemyBehavior.ignoredSkillPrefabs,['BuildBridge']);
  assert.equal(e.specialSkill,null);assert.equal(e.enemySkills.length,0);assert.equal(e.canAttack,true);assert.equal(e.formInvisible,true);assert.equal(e.randomPoolEligible,true);
  assert.match(NATIVE_DATA.enemyIndex.find(x=>x.id===id).desc,/搭桥属于关卡场地机制/);advance(b,1);assert.equal(e.enemyCast,undefined);
 }
});
