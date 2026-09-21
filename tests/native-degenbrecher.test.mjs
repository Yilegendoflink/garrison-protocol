import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';
import {NativeBattle} from '../dist/native-battle.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {dealDamage,moveActor,commitExit,applyLoss} from '../dist/native-effects.js';
import {applyStatus,permissions} from '../dist/status.js';
import {gainSp,spBlocked} from '../dist/native-sp.js';

function arena(positions=[]){
 const g=new NativeSession(NATIVE_DATA,{seed:42});g.s.funds=100;assert.ok(g.perform('buy',0));const u=g.s.units[0];let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(u.uid,x,y))placed=g.deploy(u.uid,x,y,0);
 assert.ok(placed);assert.ok(g.perform('start'));const b=g.battle,template=b.s.units[0];b.s.queue=[];b.s.enemies=[];b.s.logicEffects=[];b.s.limit=1000;b.map=structuredClone(b.map);
 const stats=b.stats.bind(b);b.stats=a=>({...stats(a),maxHp:50000,def:1000,magicResistance:0,blockCnt:3});
 b.s.units=positions.map(([x,y],i)=>{const a=structuredClone(template);a.uid+=i*100;a.x=x;a.y=y;a.deployed=true;a.hp=a.maxHp=50000;applyStatus(a,'disarm',600);applyStatus(a,'skillLock',600);b.map.grid[y][x].heightType='LOWLAND';return a;});
 const id='enemy_1525_blkswb',o=b.map.origin,p={col:o.col+3,row:o.row-3};b.level={...b.level,routes:[{motionMode:'WALK',startPosition:p,endPosition:p,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...b.level.enemyProfiles,[id]:NATIVE_DATA.enemies[id]}};b.spawn({id,route:0});
 return {b,g,e:b.s.enemies[0],units:b.s.units};
}
function advance(b,t){for(let i=0;i<Math.round(t*30);i++)b.step();}
function fatal(b,e){dealDamage(b,{target:e,value:e.maxHp*10,type:'true'});}

test('锏第二形态每25%血线压制，圆形范围内清技力并强制缴械/阻回10秒',()=>{
 const {b,e,units:[near,far]}=arena([[4,3],[5,5]]);e.atk=1;fatal(b,e);advance(b,15.1);near.sp=20;far.sp=20;near.statusResistance=.5;near.invulnerable=true;near.statuses=[];near.action={left:10};
 dealDamage(b,{target:e,value:e.maxHp*.25-1,type:'true'});assert.equal(near.sp,20);dealDamage(b,{target:e,value:1,type:'true'});
 assert.equal(e.degenPressureSteps,1);assert.equal(near.sp,0);assert.equal(far.sp,20);assert.equal(near.action,null);assert.equal(permissions(near).attack,false);assert.equal(spBlocked(near),true);assert.equal(near.statuses.find(s=>s.kind==='forcedDisarm').remaining,10);
 const skill={spData:{spType:'INCREASE_WITH_TIME',spCost:100,increment:1}};assert.equal(gainSp(near,skill,30),0);advance(b,10.1);assert.equal(spBlocked(near),false);assert.equal(permissions(near).attack,true);
});

test('锏一次跨越多条血线分别登记，生命流失触发，存档不重复清空新技力',()=>{
 const {b,g,e,units:[u]}=arena([[4,3]]);e.atk=1;fatal(b,e);advance(b,15.1);u.sp=20;applyLoss(b,{target:e,amount:e.maxHp*.51});assert.equal(e.degenPressureSteps,2);assert.equal(u.sp,0);
 const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);const enemy=restored.s.enemies[0],unit=restored.s.units[0];unit.sp=7;restored.step();assert.equal(unit.sp,7);assert.equal(enemy.degenPressureSteps,2);
 applyLoss(restored,{target:enemy,amount:1});assert.equal(unit.sp,7);assert.equal(enemy.degenPressureSteps,2);applyLoss(restored,{target:enemy,amount:enemy.maxHp*.25});assert.equal(enemy.degenPressureSteps,3);assert.equal(unit.sp,0);
});

test('锏第一形态不压制，第二形态压制覆盖不可选召唤物但不清其独立资源',()=>{
 const {b,e,units:[u]}=arena([[4,3]]);e.atk=1;u.sp=20;dealDamage(b,{target:e,value:e.maxHp*.3,type:'true'});assert.equal(u.sp,20);fatal(b,e);advance(b,15.1);
 const summon={uid:900001,kind:'summon',type:'test',hp:100,maxHp:100,x:3,y:4,deployed:true,targetable:false,statuses:[],sp:9};b.s.summons.push(summon);dealDamage(b,{target:e,value:e.maxHp*.25,type:'true'});assert.equal(summon.sp,9);assert.equal(permissions(summon).attack,false);assert.equal(spBlocked(summon),true);
});

test('锏首次致命伤进入5秒重生、回满生命，第二形态10秒无敌后才可被击倒',()=>{
 const {b,e}=arena();assert.equal(e.statusResistance,.5);fatal(b,e);assert.equal(e.enemyForm,'rebirth');assert.equal(e.hp,e.maxHp);assert.equal(b.s.kills,0);assert.equal(moveActor(b,e,{x:2,y:3},'推动'),false);
 advance(b,4.9);assert.equal(e.enemyForm,'rebirth');advance(b,.1);assert.equal(e.enemyForm,'second');assert.equal(e.invulnerable,true);assert.equal(e.formInvisible,true);assert.equal(e.enemyAttack.hits,2);
 const hp=e.hp;fatal(b,e);assert.equal(e.hp,hp);assert.ok(e.enemySkills.every(s=>Math.abs(s.nextAt-(5+s.initCooldown))<.04));
 advance(b,10);assert.equal(e.invulnerable,false);fatal(b,e);assert.equal(b.s.kills,1);assert.equal(e.hp,0);
});

test('锏穿防仅针对阻挡自身目标，第一形态20%、第二形态40%，二连击不叠加属性',()=>{
 const {b,e,units:[blocker,other]}=arena([[3,3],[4,3]]);e.atk=e.baseAtk=1000;b.step();const hp=blocker.hp;b.resolveEnemyStrike(e,blocker,{});assert.equal(hp-blocker.hp,200);
 const otherHp=other.hp;b.resolveEnemyStrike(e,other,{});assert.equal(otherHp-other.hp,50,'非阻挡目标只受5%保底伤害');
 fatal(b,e);advance(b,5);e.action=null;e.attackCooldown=0;b.s.strikes=[];const hits=[],hurt=b.hurt.bind(b);b.hurt=(u,source,opts)=>{const hp=u.hp;hurt(u,source,opts);hits.push([u.uid,hp-u.hp]);};advance(b,1.7);
 assert.deepEqual(hits,[[blocker.uid,400],[blocker.uid,400]]);assert.equal(e.atk,1000);assert.equal(e.enemyBlockedDefPenetration,.4);
});

test('锏重生及无敌计时可跨JSON，解除阻挡三秒后恢复第二形态隐匿',()=>{
 const {b,g,e,units:[u]}=arena([[3,3]]);fatal(b,e);advance(b,2);const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);const enemy=restored.s.enemies[0];advance(restored,3.1);assert.equal(enemy.enemyForm,'second');assert.equal(enemy.block,u.uid);
 restored.s.units[0].x=8;restored.step();assert.equal(enemy.formInvisible,false);advance(restored,2.8);assert.equal(enemy.formInvisible,false);advance(restored,.3);assert.equal(enemy.formInvisible,true);assert.equal(enemy.invulnerable,true);advance(restored,7);assert.equal(enemy.invulnerable,false);
});
