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
 const id='enemy_1516_jakill',o=b.map.origin,p={col:o.col+3,row:o.row-3};b.level={...b.level,routes:[{motionMode:'WALK',startPosition:p,endPosition:p,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...b.level.enemyProfiles,[id]:NATIVE_DATA.enemies[id]}};b.spawn({id,route:0});
 return {b,g,e:b.s.enemies[0],units:b.s.units};
}
function advance(b,t){for(let i=0;i<Math.round(t*30);i++)b.step();}
function fatal(b,e){dealDamage(b,{target:e,value:e.maxHp*10,type:'true'});}

test('杰斯顿首次致命伤进入4秒重生，切形态清SP解放囚犯并一次性应用本期属性',()=>{
 const {b,e}=arena();b.spawn({id:'enemy_1116_liprr',route:0});const prisoner=b.s.enemies.at(-1),atk=e.baseAtk,def=e.baseDef,speed=e.baseSpeed,interval=e.interval;
 assert.equal(e.res,e.baseRes+50);assert.equal(e.damageType,'arts');assert.equal(e.ranged,true);e.sp=3;fatal(b,e);assert.equal(e.enemyForm,'rebirth');assert.equal(b.s.kills,0);assert.equal(e.hp,e.maxHp);assert.equal(e.invulnerable,true);assert.equal(moveActor(b,e,{x:2,y:3},'推动'),false);
 advance(b,3.9);assert.equal(prisoner.prisonReleased,false);assert.equal(e.sp,3);advance(b,.1);assert.equal(e.enemyForm,'assassin');assert.equal(e.sp,0);assert.equal(prisoner.prisonReleased,true);
 assert.equal(e.baseAtk,atk+700*e.jesseltonAtkScale);assert.equal(e.baseDef,def+1000);assert.equal(e.baseSpeed,speed+.3*e.jesseltonMoveScale);assert.equal(e.interval,interval-1.5);assert.equal(e.res,e.baseRes);assert.equal(e.damageType,'physical');assert.equal(e.ranged,false);
 const finalAtk=e.atk;advance(b,1);assert.equal(e.atk,finalAtk);fatal(b,e);assert.equal(e.hp,0);assert.equal(b.s.kills,1);
});

test('狱警三次普通攻击回复3SP，下一次钢铁风暴仅选两个合法地面目标并眩晕',()=>{
 const {b,e,units}=arena([[3,2],[4,3],[2,3],[3,4]]);e.atk=1;units[2].flying=true;units[3].id='trap_025_prison';const skills=[];const emit=b.emit.bind(b);b.emit=(kind,row)=>{if(kind==='enemy-skill-start')skills.push(row.skill);emit(kind,row);};
 advance(b,11);assert.equal(e.sp,3);advance(b,3);assert.ok(skills.includes('ironsandstorm'));assert.equal(skills.includes('armorpiercing'),false);assert.equal(e.sp,0);
 assert.equal(units[0].statuses.some(s=>s.kind==='stun'),true);assert.equal(units[1].statuses.some(s=>s.kind==='stun'),true);assert.equal(units[2].statuses.some(s=>s.kind==='stun'),false);assert.equal(units[3].statuses.some(s=>s.kind==='stun'),false);
});

test('杀手技能仅接敌触发，消耗一次3SP造成两次60%穿防，不污染后续普通攻击',()=>{
 const {b,e,units}=arena([[3,3]]);fatal(b,e);advance(b,4);e.atk=e.baseAtk=1000;e.action=null;e.attackCooldown=0;e.sp=3;b.economy.random=()=>.999;const u=units[0],hits=[],hurt=b.hurt.bind(b);
 b.hurt=(target,source,opts)=>{const hp=target.hp;hurt(target,source,opts);hits.push({damage:hp-target.hp,penetration:opts.defPenetration});};
 advance(b,1.2);assert.equal(e.sp,0);assert.equal(hits.length,2);assert.ok(hits.every(h=>h.damage===600&&h.penetration===.6));assert.equal(e.enemyCast,null);
 advance(b,3);assert.ok(hits.some(h=>h.penetration==null&&h.damage===50));
});

test('重生过程JSON恢复不重复击倒/叠加属性，第二形态与技能数组继续保存',()=>{
 const {b,g,e}=arena();fatal(b,e);advance(b,2);const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);const copy=restored.s.enemies[0];assert.equal(copy.enemyForm,'rebirth');advance(restored,2.1);assert.equal(copy.enemyForm,'assassin');assert.equal(copy.sp,0);assert.equal(restored.s.kills,0);
 const again=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(restored.s)));assert.ok(again);assert.equal(again.s.enemies[0].baseAtk,copy.baseAtk);assert.equal(again.s.enemies[0].enemySkills.length,2);
});

test('杀手未接敌不释放穿刺，二连击第一段后撤退重部署不会被旧第二段追击',()=>{
 const {b,e,units}=arena([[7,3]]);fatal(b,e);advance(b,4);e.sp=3;advance(b,1);assert.ok(e.enemyCast==null);assert.equal(e.sp,3);
 const u=units[0];u.x=3;u.y=3;e.action=null;e.attackCooldown=0;let hits=0;const hurt=b.hurt.bind(b);b.economy.random=()=>.999;
 b.hurt=(target,source,opts)=>{hurt(target,source,opts);if(opts.defPenetration===.6){hits++;if(hits===1){commitExit(b,{target:u,reason:'retreat'});b.deploy(u);applyStatus(u,'disarm',600);applyStatus(u,'skillLock',600);}}};
 advance(b,1.5);assert.equal(hits,1);assert.equal(e.enemyCast,null);assert.equal(e.sp,0);
});
