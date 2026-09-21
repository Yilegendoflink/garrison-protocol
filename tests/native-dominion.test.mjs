import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';
import {NativeBattle} from '../dist/native-battle.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {applyStatus} from '../dist/status.js';
import {commitExit,teleportActor} from '../dist/native-effects.js';
import {drawDominion} from '../dist/native-fx.js';

function arena(configure=()=>{},raw=NATIVE_DATA.enemies.enemy_2048_smgrd){
 const g=new NativeSession(NATIVE_DATA,{seed:42});g.s.funds=100;assert.ok(g.perform('buy',0));const unit=g.s.units[0];let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(unit.uid,x,y))placed=g.deploy(unit.uid,x,y,0);
 assert.ok(placed);assert.ok(g.perform('start'));const b=g.battle,ally=b.s.units[0];b.s.queue=[];b.s.enemies=[];b.s.units=[];b.s.logicEffects=[];b.s.limit=1000;b.map=structuredClone(b.map);delete b.map.environment;
 for(const row of b.map.grid)for(const t of row){t.heightType='LOWLAND';t.buildableType='ALL';t.obstacle=false;t.passableMask='ALL';}configure(b.map);
 const o=b.map.origin,p={col:o.col+3,row:o.row-3};b.level={...b.level,routes:[{motionMode:raw.motion,startPosition:p,endPosition:p,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...b.level.enemyProfiles,enemy_2048_smgrd:raw}};b.spawn({id:'enemy_2048_smgrd',route:0});const e=b.s.enemies[0];e.canAttack=false;
 return {b,g,e,ally};
}

test('国度使用本期x-4范围，只在可部署格生成，邻近可部署高台也被覆盖',()=>{
 const {b}=arena(map=>{map.grid[2][2].buildableType='NONE';map.grid[4][4].heightType='HIGHLAND';map.grid[4][4].buildableType='RANGED';});
 assert.equal(Object.keys(b.s.dominionCells).length,8);assert.equal(b.s.dominionCells['2,2'],undefined);assert.ok(b.s.dominionCells['4,4']);b.step();assert.equal(Object.keys(b.s.dominionCells).length,8);
});

test('进入新地面格即时生成国度并保留旧格，传送进入也触发，不修改地图本体',()=>{
 const {b,e}=arena(),map=structuredClone(b.map);e.route=[{kind:'move',x:3,y:3},{kind:'move',x:4,y:3},{kind:'move',x:5,y:3},{kind:'wait',time:600}];e.cmd=0;e.speed=30;
 b.step();assert.ok(b.s.dominionCells['5,2']);assert.ok(b.s.dominionCells['2,2']);b.step();assert.ok(b.s.dominionCells['6,2']);assert.deepEqual(b.map,map);
 assert.equal(teleportActor(b,e,{x:8,y:3}),true);assert.ok(b.s.dominionCells['9,4']);assert.ok(b.s.dominionCells['2,2']);
});

test('国度减攻速同名不叠加，只有邪魔利刃对区域内目标在扣防前使用250%攻击倍率',()=>{
 const {b,e,ally}=arena(),stats=b.stats.bind(b);b.stats=u=>({...stats(u),maxHp:50000,def:100});ally.x=3;ally.y=3;ally.deployed=true;ally.hp=ally.maxHp=50000;applyStatus(ally,'disarm',60);applyStatus(ally,'skillLock',60);b.s.units.push(ally);b.economy.random=()=>.999;e.atk=100;
 const covered=b.stats(ally).attackSpeed;ally.x=8;const outside=b.stats(ally).attackSpeed;assert.equal(outside-covered,50);ally.x=3;
 let hp=ally.hp;b.hurt(ally,e);assert.equal(hp-ally.hp,150);ally.x=8;hp=ally.hp;b.hurt(ally,e);assert.equal(hp-ally.hp,5);
 ally.x=3;b.spawn({id:'enemy_2048_smgrd',route:0});assert.equal(b.stats(ally).attackSpeed,covered);b.spawn({id:'enemy_1007_slime',route:0});const other=b.s.enemies.at(-1);other.atk=100;hp=ally.hp;b.hurt(ally,other);assert.equal(hp-ally.hp,5);
});

test('国度不随产生者退场消失，可跨JSON恢复，非法地块快照拒绝加载',()=>{
 const {b,g,e}=arena();commitExit(b,{target:e});b.step();const saved=JSON.parse(JSON.stringify(b.s)),restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,saved);assert.ok(restored);assert.deepEqual(restored.s.dominionCells,b.s.dominionCells);
 const invalid=structuredClone(saved);invalid.dominionCells['999,999']={x:999,y:999,attackSpeed:-50};assert.equal(NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,invalid),null);
});

test('飞行状态或站在高台的邪魔利刃不生成国度，普通敌人也不生成',()=>{
 const high=arena(map=>{map.grid[3][3].heightType='HIGHLAND';});assert.equal(high.b.s.dominionCells,undefined);
 const flying=arena(()=>{},{...NATIVE_DATA.enemies.enemy_2048_smgrd,motion:'FLY'});assert.equal(flying.b.s.dominionCells,undefined);
 const {b}=arena();b.s.dominionCells={};b.spawn({id:'enemy_1007_slime',route:0});assert.deepEqual(b.s.dominionCells,{});
});

test('国度绘制只读存档格子，不用特效帧驱动规则',()=>{
 const {b}=arena(),before=structuredClone(b.s),fills=[];const ctx={save(){},restore(){},fillRect(...args){fills.push(args);},strokeRect(){}};
 assert.equal(drawDominion(ctx,(x,y)=>({x:x*20,y:y*10}),{tw:20,th:10},b),true);assert.equal(fills.length,9);assert.deepEqual(b.s,before);
});
