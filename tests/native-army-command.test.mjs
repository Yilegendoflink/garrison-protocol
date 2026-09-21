import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';
import {NativeBattle} from '../dist/native-battle.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {dealDamage,commitExit,addDamageRedirect,grantShield} from '../dist/native-effects.js';
import {applyStatus,statusAttributeChanges} from '../dist/status.js';

function arena(positions=[],id='enemy_10124_uashld_2'){
 const g=new NativeSession(NATIVE_DATA,{seed:42});g.s.funds=100;assert.ok(g.perform('buy',0));const u=g.s.units[0];let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(u.uid,x,y))placed=g.deploy(u.uid,x,y,0);
 assert.ok(placed);assert.ok(g.perform('start'));const b=g.battle,template=b.s.units[0];b.s.queue=[];b.s.enemies=[];b.s.logicEffects=[];b.s.limit=1000;b.map=structuredClone(b.map);
 const stats=b.stats.bind(b);b.stats=a=>({...stats(a),maxHp:50000,def:1000,magicResistance:0,blockCnt:3});
 b.s.units=positions.map(([x,y],i)=>{const a=structuredClone(template);a.uid+=i*100;a.x=x;a.y=y;a.deployed=true;a.hp=a.maxHp=50000;applyStatus(a,'disarm',600);applyStatus(a,'skillLock',600);b.map.grid[y][x].heightType='LOWLAND';return a;});
 const o=b.map.origin,p={col:o.col+3,row:o.row-3};b.level={...b.level,routes:[{motionMode:'WALK',startPosition:p,endPosition:p,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...b.level.enemyProfiles,[id]:NATIVE_DATA.enemies[id]}};b.spawn({id,route:0});
 return {b,g,e:b.s.enemies[0],units:b.s.units};
}
function advance(b,t){for(let i=0;i<Math.round(t*30);i++)b.step();}
function fatal(b,e){dealDamage(b,{target:e,value:e.maxHp*10,type:'true'});}




function command(b,id='enemy_10125_uacomd_2'){b.spawn({id,route:0});const e=b.s.enemies.at(-1);e.x=0;e.y=0;e.route=[{kind:'wait',x:0,y:0,time:600}];e.cmd=0;e.canAttack=false;return e;}
function npc(b,id='enemy_3010_mcreep'){const e={uid:b.s.nextId++,id,kind:'summon',type:'test',x:4,y:3,hp:10000,maxHp:10000,atk:0,def:0,res:0,attackSpeed:100,deployed:true,canAttack:false,statuses:[]};b.s.summons.push(e);return e;}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,a+' != '+b);

test('集团军指令由两型指挥员在场产生，中坚盾卫仅物法减伤40%，沉默与多来源不改变倍率',()=>{
 const {b,e}=arena();const source=command(b),other=command(b,'enemy_10125_uacomd');applyStatus(source,'silence',100);applyStatus(other,'silence',100);b.step();assert.equal(b.enemyHasArmyOrder(e),true);let hp=e.hp;
 for(const type of ['physical','arts']){dealDamage(b,{target:e,value:100,type});close(hp-e.hp,60);hp=e.hp;}dealDamage(b,{target:e,value:100,type:'true'});close(hp-e.hp,100);
 commitExit(b,{target:source});assert.equal(b.enemyHasArmyOrder(e),true);commitExit(b,{target:other});hp=e.hp;dealDamage(b,{target:e,value:100,type:'physical'});close(hp-e.hp,100,'最后来源退场后同帧撤销');
});
test('指令不覆盖飞行/孤立/隐藏目标，来源隐藏或不存在时不生效',()=>{
 const {b,e}=arena();b.step();assert.equal(b.enemyHasArmyOrder(e),false);const source=command(b);b.step();for(const field of ['flying','isolated','hidden']){e[field]=true;assert.equal(b.enemyHasArmyOrder(e),false);e[field]=false;}source.hidden=true;assert.equal(b.enemyHasArmyOrder(e),false);source.hidden=false;assert.equal(b.enemyHasArmyOrder(e),true);assert.equal(b.enemyHasArmyOrder(source),false,'指挥员自身不在指定受益名单');
});
test('受指令火炮优先有效矿工，无来源回退仇恨排序，迷彩/飞行矿工不成为目标',()=>{
 const {b,e,units:[u]}=arena([[4,3]],'enemy_10122_uacann_2');const miner=npc(b);u.deployAt=100;const hits=[];b.hurt=(target)=>hits.push(target.uid);b.step();assert.equal(e.action?.target,u.uid);e.action=null;e.attackCooldown=0;const source=command(b);b.step();assert.equal(e.action?.target,miner.uid);advance(b,b.enemyAttackTiming(e).windupFrames/30+.1);assert.ok(hits.includes(miner.uid));
 for(const field of ['invisible','flying']){miner[field]=true;assert.equal(b.enemySkillTargets(e)[0].uid,u.uid);miner[field]=false;}commitExit(b,{target:source});assert.equal(b.enemySkillTargets(e)[0].uid,u.uid);
});
test('中坚盾卫未阻挡不攻击普通干员，可选指定NPC，被阻挡仍攻击阻挡者',()=>{
 const {b,e,units:[u]}=arena([[4,3]]);b.step();assert.equal(e.action,null);const miner=npc(b);e.attackCooldown=0;b.step();assert.equal(e.action?.target,miner.uid);miner.deployed=false;e.action=null;e.attackCooldown=0;u.x=3;b.step();assert.equal(e.block,u.uid);assert.equal(e.action?.target,u.uid);
});
test('指令来源和条件跨JSON恢复，深池方阵指挥官不能冒充集团军来源',()=>{
 const {b,g,e}=arena();const source=command(b);b.step();let restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);const guard=restored.s.enemies.find(v=>v.uid===e.uid);assert.equal(restored.enemyHasArmyOrder(guard),true);const restoredSource=restored.s.enemies.find(v=>v.uid===source.uid);commitExit(restored,{target:restoredSource});restored.s.enemies=restored.s.enemies.filter(v=>v.hp>0);restored.spawn({id:'enemy_1169_duphlx_2',route:0});assert.equal(restored.enemyHasArmyOrder(guard),false);assert.equal(NATIVE_DATA.enemies.enemy_10125_uacomd_2,undefined,'依赖编入不应扩充随机池目录');
});
