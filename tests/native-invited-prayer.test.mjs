import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';
import {NativeBattle} from '../dist/native-battle.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {dealDamage,commitExit,applyHeal} from '../dist/native-effects.js';
import {applyStatus,statusAttributeChanges} from '../dist/status.js';

function arena(positions=[]){
 const g=new NativeSession(NATIVE_DATA,{seed:42});g.s.funds=100;assert.ok(g.perform('buy',0));const u=g.s.units[0];let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(u.uid,x,y))placed=g.deploy(u.uid,x,y,0);
 assert.ok(placed);assert.ok(g.perform('start'));const b=g.battle,template=b.s.units[0];b.s.queue=[];b.s.enemies=[];b.s.logicEffects=[];b.s.limit=1000;b.map=structuredClone(b.map);
 const stats=b.stats.bind(b);b.stats=a=>({...stats(a),maxHp:50000,def:1000,magicResistance:0,blockCnt:3});
 b.s.units=positions.map(([x,y],i)=>{const a=structuredClone(template);a.uid+=i*100;a.x=x;a.y=y;a.deployed=true;a.hp=a.maxHp=50000;applyStatus(a,'disarm',600);applyStatus(a,'skillLock',600);b.map.grid[y][x].heightType='LOWLAND';return a;});
 const id='enemy_10085_hllevi_2',o=b.map.origin,p={col:o.col+3,row:o.row-3};b.level={...b.level,routes:[{motionMode:'WALK',startPosition:p,endPosition:p,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...b.level.enemyProfiles,[id]:Object.values(NATIVE_DATA.levels).map(l=>l.enemyProfiles?.[id]).find(Boolean)}};b.spawn({id,route:0});
 return {b,g,e:b.s.enemies[0],units:b.s.units};
}
function advance(b,t){for(let i=0;i<Math.round(t*30);i++)b.step();}
function fatal(b,e){dealDamage(b,{target:e,value:e.maxHp*10,type:'true'});}



const penalty=u=>u.statuses.filter(s=>s.source==='invited-prayer').reduce((n,s)=>n+s.value,0);
function clone(b){b.spawn({id:'enemy_10085_hllevi_2',route:0});return b.s.enemies.at(-1);}

test('昂首20秒首放/40秒循环，15秒全场地面减攻速，无视距离迷彩且不受抵抗缩短',()=>{
 const {b,e,units:[u]}=arena([[8,3]]);applyStatus(u,'camouflage',100);u.statusResistance=.5;advance(b,19.9);assert.equal(penalty(u),0);advance(b,.1);assert.equal(penalty(u),-30);assert.equal(e.canAttack,false);assert.equal(e.enemySkills[0].nextAt,60);advance(b,14.9);assert.equal(penalty(u),-30);advance(b,.2);assert.equal(penalty(u),0);advance(b,24.9);assert.equal(penalty(u),-30);
});
test('昂首祈祷不可对空，能影响地面召唤物，无目标仍开技并进入CD',()=>{
 const {b,e,units:[u]}=arena([[4,3]]);const ground={uid:900001,kind:'summon',type:'test',x:7,y:3,hp:100,maxHp:100,deployed:true,statuses:[],canAttack:false},air={...ground,uid:900002,flying:true,statuses:[]};b.s.summons.push(ground,air);u.flying=true;advance(b,20);assert.equal(penalty(u),0);assert.equal(penalty(ground),-30);assert.equal(penalty(air),0);
 const empty=arena();advance(empty.b,20);assert.equal(empty.e.enemySkills[0].used,true);assert.equal(empty.e.enemySkills[0].nextAt,60);
});
test('多只昂首只刷新同名祈祷，来源死亡不提前消失，后来入场不补领',()=>{
 const {b,e,units:[u]}=arena([[7,3]]);const other=clone(b);other.enemySkills[0].nextAt=25;advance(b,20);assert.equal(penalty(u),-30);advance(b,5);assert.equal(penalty(u),-30);assert.equal(u.statuses.filter(s=>s.source==='invited-prayer').length,1);
 const later=structuredClone(u);later.uid+=100;later.statuses=[];b.s.units.push(later);commitExit(b,{target:e});commitExit(b,{target:other});clone(b);advance(b,10.1);assert.equal(penalty(u),-30);assert.equal(penalty(later),0);advance(b,5);assert.equal(penalty(u),0);
});
test('沉默/眩晕期间昂首不发动祈祷，解除后就绪技能才释放',()=>{
 for(const kind of ['silence','stun']){const {b,e,units:[u]}=arena([[5,3]]);applyStatus(e,kind,21);advance(b,20);assert.equal(penalty(u),0);assert.equal(e.enemySkills[0].used,false);advance(b,1.1);assert.equal(penalty(u),-30);}
});
test('昂首严格首次低于半血触发5秒恐惧和150%移速，沉默不阻止，治疗后不重复触发',()=>{
 const {b,e}=arena();applyStatus(e,'silence',60);e.hp=e.maxHp*.5;b.step();assert.ok(!e.selfFearTriggered);dealDamage(b,{target:e,value:1,type:'true'});b.step();assert.equal(e.selfFearTriggered,true);assert.equal(e.staticRigid,true);assert.equal(e.speed,e.baseSpeed*1.5);assert.ok(e.statuses.some(s=>s.kind==='fear'));const x=e.x,y=e.y;advance(b,1);assert.ok(Math.hypot(e.x-x,e.y-y)>0,'静态刚体仍可通过恐惧自身移动');advance(b,4.1);assert.equal(e.speed,e.baseSpeed);assert.equal(e.statuses.some(s=>s.kind==='fear'),false);applyHeal(b,{source:e,target:e,amount:e.maxHp});dealDamage(b,{target:e,value:e.maxHp*.6,type:'true'});b.step();assert.equal(e.speed,e.baseSpeed);assert.equal(e.statuses.some(s=>s.kind==='fear'),false);
});
test('昂首技能CD和已授予祈祷持续时间跨存档，黑板改变效果量与时长',()=>{
 const {b,g,e,units:[u]}=arena([[4,3]]);e.enemySkills[0].bb.duration=6;e.enemySkills[0].bb.attack_speed=-42;advance(b,20);assert.equal(penalty(u),-42);const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);advance(restored,5);assert.equal(penalty(restored.s.units[0]),-42);advance(restored,1.1);assert.equal(penalty(restored.s.units[0]),0);assert.equal(restored.s.enemies[0].enemySkills[0].nextAt,60);
});
