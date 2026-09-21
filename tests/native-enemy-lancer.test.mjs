import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';
import {NativeBattle} from '../dist/native-battle.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {applyStatus} from '../dist/status.js';

function arena(){
 const g=new NativeSession(NATIVE_DATA,{seed:42});g.s.funds=100;assert.ok(g.perform('buy',0));const unit=g.s.units[0];let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(unit.uid,x,y))placed=g.deploy(unit.uid,x,y,0);
 assert.ok(placed);assert.ok(g.perform('start'));const b=g.battle,ally=b.s.units[0];b.s.units=[];b.s.queue=[];b.s.enemies=[];b.s.limit=1000;b.s.logicEffects=[];
 b.map=structuredClone(b.map);b.map.grid[3][3].heightType='LOWLAND';
 const raw=NATIVE_DATA.enemies.enemy_1072_dlancer,o=b.map.origin,p={col:o.col+3,row:o.row-3};
 b.level={...b.level,routes:[{motionMode:'WALK',startPosition:p,endPosition:p,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...b.level.enemyProfiles,enemy_1072_dlancer:raw}};b.spawn({id:'enemy_1072_dlancer',route:0});const e=b.s.enemies[0];
 const stats=b.stats.bind(b);b.stats=u=>({...stats(u),maxHp:50000,def:50,blockCnt:3});
 ally.x=3;ally.y=3;ally.deployed=true;ally.deployAt=0;ally.hp=ally.maxHp=50000;ally.statuses=[];applyStatus(ally,'disarm',600);applyStatus(ally,'skillLock',600);
 return {b,e,ally};
}
function advance(b,seconds){for(let i=0;i<Math.round(seconds*30);i++)b.step();}
function near(a,b){assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);}

test('穿刺手未阻挡即可叠加，原地等待也每0.5秒线性加速，25次封顶',()=>{
 const {b,e}=arena(),speed=e.baseSpeed;advance(b,.5);assert.equal(e.lancerRush.stacks,1);near(e.speed,speed*1.5);
 advance(b,.5);assert.equal(e.lancerRush.stacks,2);near(e.speed,speed*2);near(e.x,3);near(e.y,3);
 advance(b,15);assert.equal(e.lancerRush.stacks,25);near(e.speed,speed*13.5);
});

test('穿刺手晕眩/束缚清空加速，结束后重新叠层；停顿降低移速但不清层，冻结不误当晕眩',()=>{
 for(const kind of ['stun','root']){
  const {b,e}=arena();advance(b,1);applyStatus(e,kind,.4);advance(b,.1);assert.equal(e.lancerRush.active,false);assert.equal(e.lancerRush.stacks,0);near(e.speed,e.baseSpeed);
  advance(b,.9);assert.ok(e.lancerRush.stacks>=1);assert.ok(e.lancerRush.stacks<=2);
 }
 const {b,e}=arena();advance(b,1);applyStatus(e,'frozen',1);applyStatus(e,'sluggish',2);advance(b,.5);assert.equal(e.lancerRush.stacks,3);
});

test('穿刺手首击独立计算两次防御，附加伤害用出手时受停顿影响的速度，持续阻挡不重复冲锋',()=>{
 const {b,e,ally}=arena();e.atk=e.baseAtk=100;advance(b,2);b.s.units.push(ally);applyStatus(e,'sluggish',10);applyStatus(e,'attackDown',10,{value:-.5});
 const calls=[],hurt=b.hurt.bind(b);b.hurt=(u,source,opts={})=>{const hp=u.hp;hurt(u,source,opts);calls.push({cause:opts.cause||'attack',amount:opts.damageAmount,damage:hp-u.hp,attackId:opts.attackId});};
 advance(b,6);assert.ok(calls.length>=3);const extra=calls.filter(c=>c.cause==='extra');assert.equal(extra.length,1);assert.equal(extra[0].attackId,calls[0].attackId);
 near(calls[0].damage,2.5);near(extra[0].damage,Math.max(extra[0].amount*.05,extra[0].amount-50));
 // 阻挡后的出手前仍可能获得下一层；按实际出手所在层，而不是阻挡瞬间缓存。
 const scaled=extra[0].amount/(e.baseSpeed*.2*600);assert.ok(scaled>=3&&scaled<=4);near(e.speed,e.baseSpeed);assert.equal(e.lancerRush.active,false);
 ally.x=8;advance(b,.7);assert.equal(e.lancerRush.active,true);assert.ok(e.lancerRush.stacks>0);
});

test('穿刺手加速计时可跨JSON恢复，所有叠层参数和冲锋倍率读黑板',()=>{
 const {b,e,ally}=arena();e.enemyTalent['rush.dlancer_t[trigger].interval']=.2;e.enemyTalent['rush.dlancer_t[trigger].trig_cnt']=3;e.enemyTalent['rush.dlancer_t[trigger].move_speed']=.1;e.enemyTalent['firstattack.atk_scale']=123;
 advance(b,.3);assert.equal(e.lancerRush.stacks,1);
 const restored=NativeBattle.restore(NATIVE_DATA,b.economy,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);const copy=restored.s.enemies[0];advance(restored,.5);assert.equal(copy.lancerRush.stacks,3);near(copy.speed,copy.baseSpeed*1.3);
 const stats=restored.stats.bind(restored);restored.stats=u=>({...stats(u),blockCnt:3});restored.s.units.push(ally);let amount;restored.hurt=(u,source,opts={})=>{if(opts.cause==='extra')amount=opts.damageAmount;};advance(restored,1.5);near(amount,copy.baseSpeed*1.3*123);
});

test('穿刺手出生即被阻挡时不凭空获得冲锋伤害',()=>{
 const {b,e,ally}=arena();b.s.units.push(ally);const causes=[];b.hurt=(u,source,opts={})=>causes.push(opts.cause||'attack');advance(b,6);
 assert.ok(causes.length>=2);assert.ok(causes.every(c=>c==='attack'));assert.equal(e.lancerRush.stacks,0);assert.equal(e.lancerRush.active,false);
});
