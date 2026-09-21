import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';
import {NativeBattle} from '../dist/native-battle.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {dealDamage,commitExit} from '../dist/native-effects.js';
import {applyStatus} from '../dist/status.js';

function arena(positions=[],id='enemy_2016_csphtm'){
 const g=new NativeSession(NATIVE_DATA,{seed:42});g.s.funds=100;assert.ok(g.perform('buy',0));const u=g.s.units[0];let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(u.uid,x,y))placed=g.deploy(u.uid,x,y,0);
 assert.ok(placed);assert.ok(g.perform('start'));const b=g.battle,template=b.s.units[0];b.s.queue=[];b.s.enemies=[];b.s.logicEffects=[];b.s.limit=1000;b.map=structuredClone(b.map);
 const stats=b.stats.bind(b);b.stats=a=>({...stats(a),maxHp:50000,def:100,magicResistance:0,blockCnt:3});
 b.s.units=positions.map(([x,y],i)=>{const a=structuredClone(template);a.uid+=i*100;a.x=x;a.y=y;a.deployed=true;a.hp=a.maxHp=50000;applyStatus(a,'disarm',600);applyStatus(a,'skillLock',600);b.map.grid[y][x].heightType='LOWLAND';return a;});
 const o=b.map.origin,p={col:o.col+3,row:o.row-3};b.level={...b.level,routes:[{motionMode:'WALK',startPosition:p,endPosition:p,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...b.level.enemyProfiles,[id]:Object.values(NATIVE_DATA.levels).map(l=>l.enemyProfiles?.[id]).find(Boolean)}};b.spawn({id,route:0});
 return {b,g,e:b.s.enemies[0],units:b.s.units};
}
function advance(b,t){for(let i=0;i<Math.round(t*30);i++)b.step();}
function fatal(b,e){dealDamage(b,{target:e,value:e.maxHp*10,type:'true'});}



const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,a+' != '+b);
function blinkScene(){
 const scene=arena([[3,3]]),{b,e}=scene;e.canAttack=false;for(let x=2;x<=7;x++)Object.assign(b.map.grid[3][x],{heightType:'LOWLAND',passableMask:'ALL',obstacle:false});e.route=[{kind:'move',x:3,y:3},{kind:'move',x:7,y:3,checkpointIndex:1},{kind:'wait',x:7,y:3,time:600}];e.cmd=1;e.enemySkills.find(s=>s.prefab==='aoe').nextAt=1000;e.enemySkills.find(s=>s.prefab==='blink').nextAt=0;return scene;
}

test('卢西恩和幻影使用本期20%穿防、20%未阻挡物法闪避，真伤和阻挡绕过闪避',()=>{
 for(const id of ['enemy_2016_csphtm','enemy_2017_csphts']){
  const {b,e}=arena([],id);e.canAttack=false;b.step();assert.equal(e.enemyDefPenetration,.2);assert.equal(e.enemyUnblockedDodge,.2);assert.equal(e.attackElementScale,.12);b.economy.random=()=>.19;let hp=e.hp;
  for(const type of ['physical','arts']){assert.equal(dealDamage(b,{target:e,value:100,type}).evaded,true);assert.equal(e.hp,hp);}
  dealDamage(b,{target:e,value:100,type:'true'});assert.equal(e.hp,hp-100);hp=e.hp;e.block=123;dealDamage(b,{target:e,value:100,type:'physical'});assert.equal(e.hp,hp-100);
  e.block=null;b.economy.random=()=>.2;hp=e.hp;dealDamage(b,{target:e,value:100,type:'arts'});assert.equal(e.hp,hp-100);
 }
});
test('两型范围技能按5秒首放/10秒CD，圆形2格无视迷彩并区分主目标和溅射',()=>{
 for(const id of ['enemy_2016_csphtm','enemy_2017_csphts']){
  const {b,e,units}=arena([[4,3],[3,5],[5,5]],id);e.canAttack=false;applyStatus(units[0],'camouflage',60);applyStatus(units[1],'camouflage',60);advance(b,4.9);assert.ok(e.enemyCast==null);const hp=units.map(u=>u.hp);advance(b,1.2);
  const amount=Math.max(e.atk*.8-80,e.atk*.8*.05);near(hp[0]-units[0].hp,amount);near(hp[1]-units[1].hp,amount);near(hp[2]-units[2].hp,0);near(units[0].elemental.neural,e.atk*.2);near(units[1].elemental.neural,e.atk*.2);
  const logs=b.s.logicLog.filter(l=>l.type==='damage'&&l.sourceUid===e.uid);assert.equal(logs.filter(l=>l.cause==='attack').length,1);assert.equal(logs.filter(l=>l.cause==='splash').length,1);const skill=e.enemySkills.find(s=>s.prefab==='aoe');assert.ok(skill.nextAt>15&&skill.nextAt<16);assert.equal(e.enemyCast,null);
 }
});
test('幻影普攻穿防20%且附带12%神经损伤，不误用技能的20%',()=>{
 const {b,e,units:[u]}=arena([[3,3]],'enemy_2017_csphts');b.step();const hp=u.hp;advance(b,1);near(hp-u.hp,e.atk-80);near(u.elemental.neural,e.atk*.12);
});
test('卢西恩成功闪现1.5格后在起点生成本期幻影，0.5秒保护与1秒不可阻挡分别结束',()=>{
 const {b,e}=blinkScene(),route=structuredClone(e.route);b.step();const started=b.s.time;assert.equal(e.invulnerable,true);assert.equal(e.shiftImmune,true);assert.equal(e.enemySkills.find(s=>s.prefab==='blink').nextAt,started+15);advance(b,14/30);assert.equal(b.s.enemies.length,1);advance(b,1/30);
 const child=b.s.enemies.find(x=>x.id==='enemy_2017_csphts');assert.ok(child);near(child.x,3);near(child.y,3);assert.deepEqual(child.route,route);assert.equal(child.cmd,1);assert.equal(child.baseAtk,200*b.combatScale.atk);assert.ok(e.x>=4.5);assert.equal(e.invulnerable,false);assert.equal(e.shiftImmune,false);assert.equal(e.unblockable,true);advance(b,.5);assert.equal(e.unblockable,false);assert.equal(b.s.enemies.filter(x=>x.id===child.id).length,1);
 fatal(b,e);b.step();assert.equal(b.s.finished,false,'幻影仍在场，不能清场');
});
test('卢西恩闪现起始/前摇后落点不可通行都不生成幻影，仍消耗CD',()=>{
 for(const later of [false,true]){const {b,e}=blinkScene();applyStatus(e,'root',30);if(!later)b.map.grid[3][5].passableMask='NONE';b.step();if(later)b.map.grid[3][5].passableMask='NONE';advance(b,1.1);assert.equal(e.x,3);assert.equal(b.s.enemies.length,1);assert.equal(e.invulnerable,false);assert.equal(e.unblockable,false);assert.equal(e.enemySkills.find(s=>s.prefab==='blink').used,true);}
});
test('闪现前摇跨存档只生成一次幻影，AOE优先级高于闪现且无目标不空放',()=>{
 const {b,g,e}=blinkScene();b.step();advance(b,.2);const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);advance(restored,.9);assert.equal(restored.s.enemies.filter(e=>e.id==='enemy_2017_csphts').length,1);
 const scene=blinkScene();scene.e.enemySkills.find(s=>s.prefab==='aoe').nextAt=0;scene.b.step();assert.equal(scene.e.enemyCast?.phantomAoe,true);assert.equal(scene.e.crownBlink,undefined);
 const empty=arena();empty.e.canAttack=false;advance(empty.b,20);assert.equal(empty.e.enemySkills.some(s=>s.used),false);
});
test('幻影范围施法可被控制打断，取消后不残留停移或伤害，10秒冷却从中断开始',()=>{
 const {b,e,units:[u]}=arena([[4,3]],'enemy_2017_csphts');e.canAttack=false;advance(b,5.1);assert.equal(e.enemyCast?.phantomAoe,true);const hp=u.hp;applyStatus(e,'stun',1);b.step();assert.equal(e.enemyCast,null);assert.equal(e.formHold,false);advance(b,1);assert.equal(u.hp,hp);assert.ok(e.enemySkills[0].nextAt>15);
});
