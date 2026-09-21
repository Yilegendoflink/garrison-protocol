import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';
import {NativeBattle} from '../dist/native-battle.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {dealDamage,moveActor,commitExit,applyLoss} from '../dist/native-effects.js';
import {applyStatus,permissions} from '../dist/status.js';
import {gainSp,spBlocked} from '../dist/native-sp.js';

function arena(positions=[],{blink=false}={}){
 const g=new NativeSession(NATIVE_DATA,{seed:42});g.s.funds=100;assert.ok(g.perform('buy',0));const u=g.s.units[0];let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(u.uid,x,y))placed=g.deploy(u.uid,x,y,0);
 assert.ok(placed);assert.ok(g.perform('start'));const b=g.battle,template=b.s.units[0];b.s.queue=[];b.s.enemies=[];b.s.logicEffects=[];b.s.limit=1000;b.map=structuredClone(b.map);
 const stats=b.stats.bind(b);b.stats=a=>({...stats(a),maxHp:50000,def:1000,magicResistance:0,blockCnt:3});
 b.s.units=positions.map(([x,y],i)=>{const a=structuredClone(template);a.uid+=i*100;a.x=x;a.y=y;a.deployed=true;a.hp=a.maxHp=50000;applyStatus(a,'disarm',600);applyStatus(a,'skillLock',600);b.map.grid[y][x].heightType='LOWLAND';return a;});
 const id='enemy_1525_blkswb',o=b.map.origin,p={col:o.col+3,row:o.row-3};b.level={...b.level,routes:[{motionMode:'WALK',startPosition:p,endPosition:p,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...b.level.enemyProfiles,[id]:NATIVE_DATA.enemies[id]}};b.spawn({id,route:0});
 // 非速杀场景单独隔离该技能，避免初始就绪的闪现改变受测位置。
 if(!blink)for(const skill of b.s.enemies[0].enemySkills)if(skill.prefab.startsWith('Blink')){skill.initCooldown=1000000;skill.nextAt=1000000;}
 return {b,g,e:b.s.enemies[0],units:b.s.units};
}
function advance(b,t){for(let i=0;i<Math.round(t*30);i++)b.step();}
function fatal(b,e){dealDamage(b,{target:e,value:e.maxHp*10,type:'true'});}

function blinkArena(second=false){
 const scene=arena([[3,3]],{blink:true}),{b,e}=scene;e.atk=e.baseAtk=1000;
 if(second){applyStatus(e,'forcedDisarm',20,{resistible:false});fatal(b,e);advance(b,5);e.statuses=e.statuses.filter(s=>s.kind!=='forcedDisarm');}
 for(const skill of e.enemySkills)if(skill.prefab.startsWith('Circle'))skill.nextAt=1000000;
 for(let x=3;x<=7;x++)Object.assign(b.map.grid[3][x],{passableMask:'ALL',obstacle:false});
 e.route=[{kind:'move',x:3,y:3},{kind:'move',x:4,y:3},{kind:'move',x:7,y:3,checkpointIndex:1},{kind:'wait',x:7,y:3,time:600}];e.cmd=1;e.cmdLeft=null;e.attackCooldown=0;return scene;
}

test('锏速杀0.3秒后打原阻挡者，0.5秒完成1.5格传送，1秒不可阻挡且30秒CD',()=>{
 const {b,e,units:[u]}=blinkArena(),hits=[];b.hurt=(target,source)=>hits.push([target.uid,source.atk]);b.step();const start=b.s.time;assert.ok(e.crownBlink?.degen);assert.equal(e.invulnerable,true);assert.equal(e.block,null);
 advance(b,.2);assert.equal(hits.length,0);advance(b,.1);assert.deepEqual(hits,[[u.uid,1500]]);advance(b,.2);assert.ok(b.s.events.some(event=>event.type==='move'&&event.mode==='blink'&&event.x===4.5));assert.equal(e.invulnerable,false);assert.equal(e.unblockable,true);assert.ok(Math.abs(e.enemySkills[1].nextAt-start-30)<1e-8);
 advance(b,.5);assert.equal(e.unblockable,false);
});

test('锏第二形态速杀双段，同UID再部署不追击，前摇存档不重复伤害',()=>{
 const {b,g,e,units:[u]}=blinkArena(true);b.step();advance(b,.1);const saved=JSON.parse(JSON.stringify(b.s)),restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,saved);assert.ok(restored);const hits=[];restored.hurt=(target,source)=>hits.push([target.uid,source.atk]);advance(restored,.2);assert.deepEqual(hits,[[u.uid,1500],[u.uid,1500]]);advance(restored,.3);assert.equal(hits.length,2);assert.equal(restored.s.enemies[0].invulnerable,true,'重生后的原有10秒无敌应保留');
 const redeployed=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,saved);redeployed.s.units[0].deployGen++;const staleHits=[];redeployed.hurt=u=>staleHits.push(u.uid);advance(redeployed,.4);assert.deepEqual(staleHits,[]);
});

test('速杀目的地不可通行时仍追击和不可阻挡，不生成额外闪现无敌',()=>{
 const {b,e}=blinkArena();b.map.grid[3][5].passableMask='NONE';applyStatus(e,'root',10);const hits=[];b.hurt=u=>hits.push(u.uid);b.step();assert.equal(!!e.invulnerable,false);advance(b,.3);assert.equal(hits.length,1);assert.equal(e.x,3);advance(b,.7);assert.equal(e.unblockable,false);
});

test('速杀期间进入重生清除旧追击，不让旧恢复字段解除重生保护',()=>{
 const {b,e}=blinkArena();b.step();applyLoss(b,{target:e,amount:e.maxHp*2});assert.equal(e.enemyForm,'rebirth');assert.equal(e.crownBlink,null);const hits=[];b.hurt=u=>hits.push(u.uid);advance(b,1.1);assert.equal(hits.length,0);assert.equal(e.invulnerable,true);assert.equal(e.unblockable,true);
});

test('锏同优先级技能同时就绪时按随机流二选一，不释放另一形态技能',()=>{
 for(const roll of [0,.99]){
  const {b,e}=arena([[3,3]],{blink:true});e.block=b.s.units[0].uid;for(const skill of e.enemySkills)skill.nextAt=0;b.economy.random=()=>roll;b.step();
  if(roll===0){assert.equal(e.enemyCast?.index,0);assert.ok(!e.crownBlink);}else{assert.ok(e.crownBlink?.degen);assert.equal(e.enemySkills[1].used,true);}
  assert.equal(e.enemySkills[2].used,false);assert.equal(e.enemySkills[3].used,false);
 }
});

test('锏第一形态15秒后肆虐风雪，圆形范围可命中飞行及迷彩，结束开始15秒CD',()=>{
 const {b,e,units}=arena([[4,3],[4,4],[5,5]]);units[1].flying=true;applyStatus(units[1],'camouflage',60);e.atk=2000;const hits=[];b.hurt=(u,source)=>hits.push([u.uid,source.atk]);
 advance(b,14.9);assert.equal(e.enemyCast,undefined);advance(b,.2);assert.equal(e.enemyCast?.degenCircle,true);assert.equal(e.enemyCast.index,0);assert.equal(hits.length,0);
 for(let i=0;i<90&&e.enemyCast;i++)b.step();assert.deepEqual(hits,[[units[0].uid,2000],[units[1].uid,2000]]);assert.ok(Math.abs(e.enemySkills[0].nextAt-b.s.time-15)<1e-8);assert.equal(e.enemySkills[2].used,false);
});

test('锏第二形态肆虐风雪双段普通伤害，穿防只对阻挡者生效且不重复套用',()=>{
 const {b,e,units:[blocker,other]}=arena([[3,3],[4,3]]);e.atk=1000;fatal(b,e);advance(b,5);e.attackCooldown=100000;
 advance(b,15.1);e.attackCooldown=0;e.action=null;b.s.strikes=[];const hits=[],hurt=b.hurt.bind(b);b.hurt=(u,source,opts)=>{const hp=u.hp;hurt(u,source,opts);hits.push([u.uid,hp-u.hp]);};b.step();assert.equal(e.enemyCast?.index,2);
 for(let i=0;i<90&&e.enemyCast;i++)b.step();assert.deepEqual(hits,[[blocker.uid,400],[other.uid,50],[blocker.uid,400],[other.uid,50]]);assert.equal(e.atk,1000);
});

test('肆虐风雪无目标时保持就绪，施法存档不重复伤害，缴械中断不命中',()=>{
 const {b,g,e}=arena([[5,5]]);advance(b,16);assert.equal(e.enemySkills[0].used,false);b.s.units[0].x=4;b.s.units[0].y=3;b.step();assert.ok(e.enemyCast?.degenCircle);
 const saved=JSON.parse(JSON.stringify(b.s)),restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,saved);assert.ok(restored);const hits=[];restored.hurt=u=>hits.push(u.uid);advance(restored,2);assert.equal(hits.length,1);advance(restored,1);assert.equal(hits.length,1);
 const interrupted=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,saved);applyStatus(interrupted.s.enemies[0],'disarm',3);interrupted.step();assert.equal(interrupted.s.enemies[0].enemyCast,null);assert.equal(interrupted.s.enemies[0].formHold,false);
});

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
