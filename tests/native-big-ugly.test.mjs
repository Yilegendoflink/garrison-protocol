import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';
import {NativeBattle} from '../dist/native-battle.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {dealDamage,moveActor,commitExit} from '../dist/native-effects.js';
import {applyStatus} from '../dist/status.js';

function arena(positions=[]){
 const g=new NativeSession(NATIVE_DATA,{seed:42});g.s.funds=100;assert.ok(g.perform('buy',0));const u=g.s.units[0];let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(u.uid,x,y))placed=g.deploy(u.uid,x,y,0);
 assert.ok(placed);assert.ok(g.perform('start'));const b=g.battle,template=b.s.units[0];b.s.queue=[];b.s.enemies=[];b.s.logicEffects=[];b.s.limit=1000;b.map=structuredClone(b.map);
 const stats=b.stats.bind(b);b.stats=a=>({...stats(a),maxHp:50000,def:1000,magicResistance:0,blockCnt:3});
 b.s.units=positions.map(([x,y],i)=>{const a=structuredClone(template);a.uid+=i*100;a.x=x;a.y=y;a.deployed=true;a.hp=a.maxHp=50000;applyStatus(a,'disarm',600);applyStatus(a,'skillLock',600);b.map.grid[y][x].heightType='LOWLAND';return a;});
 const id='enemy_1512_mcmstr',o=b.map.origin,p={col:o.col+3,row:o.row-3};b.level={...b.level,routes:[{motionMode:'WALK',startPosition:p,endPosition:p,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...b.level.enemyProfiles,[id]:NATIVE_DATA.enemies[id]}};b.spawn({id,route:0});
 return {b,g,e:b.s.enemies[0],units:b.s.units};
}
function advance(b,t){for(let i=0;i<Math.round(t*30);i++)b.step();}
function fatal(b,e){dealDamage(b,{target:e,value:e.maxHp*10,type:'true'});}

test('丑东西初始可阻挡，近战300%；未阻挡九格100%溅射可波及飞行但不优先对空',()=>{
 const melee=arena([[3,3],[4,3]]),hits=[];melee.e.atk=100;melee.b.hurt=(u,e)=>hits.push([u.uid,e.atk]);advance(melee.b,1.5);assert.equal(melee.e.block,melee.units[0].uid);assert.deepEqual(hits,[[melee.units[0].uid,300]]);
 const ranged=arena([[5,3],[5,4],[6,5]]);ranged.e.atk=100;ranged.units[1].flying=true;ranged.units[2].flying=true;const shots=[];ranged.b.hurt=(u,e,opts)=>shots.push([u.uid,e.atk,opts.cause]);advance(ranged.b,1.5);assert.deepEqual(shots,[[ranged.units[0].uid,100,'attack'],[ranged.units[1].uid,100,'splash']]);
});

test('首次致命伤不击倒，2.17秒后自爆一次，半径3内150%物理与可抵抗16秒眩晕',()=>{
 const {b,e,units}=arena([[5,3],[6,5]]);e.atk=100;units[0].statusResistance=.5;fatal(b,e);assert.equal(e.enemyForm,'rebirth');assert.equal(b.s.kills,0);const hits=[];b.hurt=(u,source)=>hits.push([u.uid,source.atk]);advance(b,2.1);assert.equal(hits.length,0);advance(b,.1);assert.deepEqual(hits,[[units[0].uid,150]]);assert.ok(units[0].statuses.find(s=>s.kind==='stun').remaining>7.9);advance(b,1);assert.equal(hits.length,1);
});

test('大祭司沿用实体，10秒转场属性只加一次、不可阻挡不攻击，每秒受1300无来源真实伤害',()=>{
 const {b,e,units:[u]}=arena([[3,3]]),uid=e.uid,def=e.baseDef,res=e.baseRes,speed=e.baseSpeed;fatal(b,e);advance(b,10);assert.equal(e.uid,uid);assert.equal(b.s.enemies.length,1);assert.equal(e.enemyForm,'priest');assert.equal(e.baseDef,def+200);assert.equal(e.baseRes,res+30);assert.equal(e.baseSpeed,speed+.7);assert.equal(e.canAttack,false);assert.equal(e.unblockable,true);
 const hp=e.hp;advance(b,2);assert.equal(hp-e.hp,2600);assert.equal(e.baseDef,def+200);assert.ok(b.s.logicLog.some(row=>row.type==='damage'&&row.targetUid===uid&&row.sourceUid==null&&row.cause==='dot'));advance(b,30);assert.equal(b.s.kills,1);assert.equal(b.s.finished,true);
});

test('自爆前和大祭司阶段均可存档恢复，不重炸、不重复加防或重置掉血周期',()=>{
 const {b,g,e}=arena([[5,3]]);fatal(b,e);advance(b,1);const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);let hits=0;restored.hurt=()=>hits++;advance(restored,1.2);assert.equal(hits,1);advance(restored,7.8);const priest=restored.s.enemies[0];assert.equal(priest.enemyForm,'priest');
 advance(restored,.5);const hp=priest.hp,def=priest.def,second=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(restored.s)));assert.ok(second);advance(second,.5);assert.equal(second.s.enemies[0].hp,hp-1300);assert.equal(second.s.enemies[0].def,def);
});
