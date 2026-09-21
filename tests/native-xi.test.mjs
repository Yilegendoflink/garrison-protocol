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
 const id='enemy_1517_xi',o=b.map.origin,p={col:o.col+3,row:o.row-3};b.level={...b.level,routes:[{motionMode:'WALK',startPosition:p,endPosition:p,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...b.level.enemyProfiles,[id]:NATIVE_DATA.enemies[id]}};b.spawn({id,route:0});
 return {b,g,e:b.s.enemies[0],units:b.s.units};
}
function advance(b,t){for(let i=0;i<Math.round(t*30);i++)b.step();}
function fatal(b,e){dealDamage(b,{target:e,value:e.maxHp*10,type:'true'});}

function shieldArena(second=false){
 const scene=arena([[5,3],[5,4],[6,5]]),{b,e}=scene;e.atk=e.baseAtk=10;
 if(second){fatal(b,e);advance(b,15.1);e.atk=10;}
 e.action=null;e.attackCooldown=0;b.s.strikes=[];const skill=e.enemySkills.find(s=>s.prefab===(second?'ShieldBurstReborn':'ShieldBurst'));skill.nextAt=b.s.time;b.step();assert.ok(e.enemyCast?.xiBurst);return {...scene,skill};
}

test('自在两阶段蓄盾取本期2500/3000，14.33秒后600%/800%爆发且不对空',()=>{
 for(const second of [false,true]){
  const {b,e,units,skill}=shieldArena(second);assert.equal(e.shield,second?3000:2500);assert.equal(e.shiftImmune,true);units[1].flying=true;const hits=[];b.hurt=(u,source,opts)=>hits.push([u.uid,source.atk,opts.cause]);
  advance(b,14.3);assert.equal(hits.length,0);advance(b,1/30);assert.deepEqual(hits,[[units[0].uid,second?80:60,'splash']]);assert.ok(e.enemyCast);
  advance(b,.7);assert.equal(e.enemyCast,null);assert.equal(e.shield,0);assert.equal(e.shiftImmune,false);assert.ok(Math.abs(skill.nextAt-(b.s.time+70))<.05);
 }
});

test('物理/法术击破自在蓄力屏障会打断，真实伤害穿过屏障且不以破盾取消技能',()=>{
 for(const type of ['physical','arts','true']){
  const {b,e}=shieldArena(),hp=e.hp;dealDamage(b,{target:e,value:2500,type});b.step();
  if(type==='true'){assert.equal(e.shield,2500);assert.equal(e.hp,hp-2500);assert.ok(e.enemyCast?.xiBurst);}else{assert.equal(e.hp,hp);assert.equal(e.enemyCast,null);assert.equal(e.shiftImmune,false);const hits=[];b.hurt=u=>hits.push(u.uid);e.canAttack=false;advance(b,15);assert.deepEqual(hits,[]);}
 }
});

test('自在蓄力存档保留护盾/剩余时间，重生取消旧技能而不取消重生失衡免疫',()=>{
 const {b,g,e}=shieldArena();advance(b,10);const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);const hits=[];restored.hurt=u=>hits.push(u.uid);advance(restored,4.4);assert.equal(hits.length,2);advance(restored,1);assert.equal(restored.s.enemies[0].enemyCast,null);
 fatal(b,e);assert.equal(e.enemyForm,'rebirth');assert.equal(e.enemyCast,null);assert.equal(e.shiftImmune,true);assert.equal(e.shield,0);advance(b,5);assert.equal(e.enemyForm,'second');assert.equal(e.shiftImmune,false);
});

test('自在首次致命伤5秒重生，二阶段仅加攻5%及10秒无敌，跨JSON不重复加攻',()=>{
 const {b,g,e}=arena(),atk=e.baseAtk;fatal(b,e);assert.equal(e.enemyForm,'rebirth');assert.equal(b.s.kills,0);advance(b,2);
 const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);const xi=restored.s.enemies[0];advance(restored,3);assert.equal(xi.enemyForm,'second');assert.equal(xi.atk,atk*1.05);assert.equal(xi.hp,xi.maxHp);assert.equal(xi.invulnerable,true);advance(restored,10.1);assert.equal(xi.invulnerable,false);assert.equal(xi.atk,atk*1.05);fatal(restored,xi);assert.equal(restored.s.kills,1);
});

test('自在普攻按半径2.5索敌而非十字全场，无法以飞行单位为目标',()=>{
 const {b,e,units}=arena([[6,3],[4,4]]);units[1].flying=true;const hits=[];b.hurt=u=>hits.push(u.uid);advance(b,18);assert.deepEqual(hits,[]);units[1].flying=false;advance(b,1.5);assert.deepEqual(hits,[units[1].uid]);assert.equal(e.specialSkill,null);
});

test('自在二阶段重复攻击优先不同目标，只有一名时重复两次，整轮只记一次攻击',()=>{
 for(const positions of [[[4,3],[4,4]],[[4,3]]]){
  const {b,e,units}=arena(positions);fatal(b,e);advance(b,5);const hits=[];b.hurt=(u,source)=>hits.push([u.uid,source.damageType]);advance(b,1.7);assert.equal(hits.length,2);assert.equal(new Set(hits.map(h=>h[0])).size,units.length);assert.ok(hits.every(h=>h[1]==='arts'));assert.equal(e.attackCount,1);
 }
});

test('自在重复攻击的第二段跨存档继续，不追伤重新部署后的原UID',()=>{
 const {b,g,e,units:[u]}=arena([[4,3]]);fatal(b,e);advance(b,5);for(let i=0;i<90&&!b.s.strikes.length;i++)b.step();assert.equal(b.s.strikes.length,1);
 const saved=JSON.parse(JSON.stringify(b.s)),restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,saved);assert.ok(restored);const hits=[];restored.hurt=u=>hits.push(u.uid);advance(restored,.3);assert.deepEqual(hits,[u.uid]);
 const redeployed=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,saved);redeployed.s.units[0].deployGen++;let count=0;redeployed.hurt=()=>count++;advance(redeployed,.3);assert.equal(count,0);
});
