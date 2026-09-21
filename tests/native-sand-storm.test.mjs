import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';
import {NativeBattle} from '../dist/native-battle.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {applyStatus} from '../dist/status.js';
import {commitExit} from '../dist/native-effects.js';
import {shelteredFromSand} from '../dist/native-environment.js';

function arena(){
 const g=new NativeSession(NATIVE_DATA,{seed:42});g.s.funds=100;assert.ok(g.perform('buy',0));const unit=g.s.units[0];let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(unit.uid,x,y))placed=g.deploy(unit.uid,x,y,0);
 assert.ok(placed);assert.ok(g.perform('start'));const b=g.battle,u=b.s.units[0];b.map=structuredClone(NATIVE_DATA.maps.find(m=>m.stageId==='act1autochess_m06'));b.s.enemies=[];b.s.queue=[];b.s.logicEffects=[];b.s.limit=2000;
 u.x=8;u.y=1;u.deployed=true;u.deployAt=0;applyStatus(u,'disarm',2000);applyStatus(u,'skillLock',2000);
 const id='enemy_1007_slime',raw=NATIVE_DATA.enemies[id],o=b.map.origin,p={col:o.col+8,row:o.row-1};b.level={...b.level,routes:[{motionMode:'WALK',startPosition:p,endPosition:p,checkpoints:[{type:'WAIT_FOR_SECONDS',time:2000}]}],enemyProfiles:{...b.level.enemyProfiles,[id]:raw}};b.spawn({id,route:0});const e=b.s.enemies[0];e.canAttack=false;
 return {b,g,u,e};
}
function advance(b,seconds){for(let i=0;i<Math.round(seconds*30);i++)b.step();}

test('本期m06只有启用的向下沙尘暴控制器，掩体按行列保护下风向而非全场',()=>{
 const map=NATIVE_DATA.maps.find(m=>m.stageId==='act1autochess_m06'),cfg=map.environment.sandStorm;
 assert.equal(cfg.direction,'DOWN');assert.equal(cfg.damage,100);assert.equal(cfg.interval,2);assert.equal(cfg.moveScale,.6);assert.equal(cfg.attackRatio,-.5);assert.equal(cfg.respawnMultiplier,1.5);assert.equal(cfg.duration,1500);
 assert.equal(shelteredFromSand(map,{x:4,y:1},'DOWN'),true);assert.equal(shelteredFromSand(map,{x:8,y:1},'DOWN'),false);
 for(const [dir,a,expected]of [['UP',{x:7,y:2},true],['LEFT',{x:2,y:0},true],['RIGHT',{x:9,y:3},true],['RIGHT',{x:9,y:1},false]])assert.equal(shelteredFromSand(map,a,dir),expected);
});

test('暴露单位每2秒受伤、减攻与延长再部署，进入掩体恢复且敌人不吃我方伤害',()=>{
 const {b,u,e}=arena(),atk=b.stats(u).atk,respawn=b.respawnTime(u),hp=u.hp,enemyHp=e.hp;b.step();
 assert.equal(u.sandExposed,true);assert.ok(b.stats(u).atk<atk);assert.equal(b.respawnTime(u),respawn*1.5);assert.equal(e.sandMoveScale,.6);
 advance(b,2);assert.equal(u.hp,hp-100);assert.equal(e.hp,enemyHp);
 u.x=4;u.y=1;b.step();const shelteredHp=u.hp;assert.equal(u.sandExposed,false);assert.equal(b.stats(u).atk,atk);assert.equal(b.respawnTime(u),respawn);advance(b,2.1);assert.equal(u.hp,shelteredHp);
});

test('沙尘暴减速进入实际移动；土石结构保护后恢复，不把普通工事误认成风沙掩体',()=>{
 const {b,e}=arena();b.s.units=[];e.route=[{kind:'move',x:8,y:1},{kind:'move',x:9,y:1}];e.cmd=0;const x=e.x;b.step();assert.ok(Math.abs(e.x-x-e.speed*.6/30)<1e-6);
 e.x=4;e.y=1;e.route=[{kind:'move',x:4,y:1},{kind:'move',x:4,y:2}];e.cmd=0;e.cmdLeft=null;b.step();assert.equal(e.sandMoveScale,1);assert.ok(Math.abs(e.y-1-e.speed/30)<1e-6);
 const fake={devices:[{id:'trap_1107_acblock',x:4,y:0}]};assert.equal(shelteredFromSand(fake,{x:4,y:1},'DOWN'),false);
});

test('风沙计时跨存档继续，结束/无控制器/最终木桩不残留环境修正',()=>{
 const {b,g,u}=arena();advance(b,1);const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);const copy=restored.s.units[0],hp=copy.hp;advance(restored,1.1);assert.equal(copy.hp,hp-100);
 restored.s.frame=1500*30;restored.s.time=1500;restored.step();assert.equal(copy.sandExposed,false);assert.equal(copy.sandAttackRatio,0);assert.equal(copy.sandRespawnMultiplier,1);
 delete b.map.environment;b.step();assert.equal(u.sandExposed,false);assert.equal(u.sandAttackRatio,0);
 const {b:c,u:v}=arena();c.s.benchmark=true;advance(c,2.1);assert.equal(v.sandExposed,false);assert.equal(v.sandNextAt,null);
});

test('风沙中退场按受影响时的再部署时间结算，后续离场状态刷新不改写已排定时间',()=>{
 const {b,u}=arena(),base=b.respawnTime(u);b.step();commitExit(b,{target:u,reason:'retreat'});assert.equal(u.downMax,base*1.5);b.step();assert.equal(u.sandRespawnMultiplier,1);assert.equal(u.downMax,base*1.5);
});
