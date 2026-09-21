import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';
import {NativeBattle} from '../dist/native-battle.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {dealDamage,commitExit,addDamageRedirect,grantShield} from '../dist/native-effects.js';
import {applyStatus,statusAttributeChanges} from '../dist/status.js';

function arena(positions=[]){
 const g=new NativeSession(NATIVE_DATA,{seed:42});g.s.funds=100;assert.ok(g.perform('buy',0));const u=g.s.units[0];let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(u.uid,x,y))placed=g.deploy(u.uid,x,y,0);
 assert.ok(placed);assert.ok(g.perform('start'));const b=g.battle,template=b.s.units[0];b.s.queue=[];b.s.enemies=[];b.s.logicEffects=[];b.s.limit=1000;b.map=structuredClone(b.map);
 const stats=b.stats.bind(b);b.stats=a=>({...stats(a),maxHp:50000,def:1000,magicResistance:0,blockCnt:3});
 b.s.units=positions.map(([x,y],i)=>{const a=structuredClone(template);a.uid+=i*100;a.x=x;a.y=y;a.deployed=true;a.hp=a.maxHp=50000;applyStatus(a,'disarm',600);applyStatus(a,'skillLock',600);b.map.grid[y][x].heightType='LOWLAND';return a;});
 const id='enemy_10127_rkmbst_2',o=b.map.origin,p={col:o.col+3,row:o.row-3};b.level={...b.level,routes:[{motionMode:'WALK',startPosition:p,endPosition:p,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...b.level.enemyProfiles,[id]:NATIVE_DATA.enemies[id]}};b.spawn({id,route:0});
 return {b,g,e:b.s.enemies[0],units:b.s.units};
}
function advance(b,t){for(let i=0;i<Math.round(t*30);i++)b.step();}
function fatal(b,e){dealDamage(b,{target:e,value:e.maxHp*10,type:'true'});}



const miner={id:'enemy_3010_mcreep',uid:900001,hp:100};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,a+' != '+b);

test('裂兽出生5%生命屏障仅吸收矿工物理伤害，其他来源物法减半，真伤与矿工法术绕过',()=>{
 const {b,e}=arena();b.step();const shield=e.maxHp*.05;close(e.shield,shield);let hp=e.hp;
 dealDamage(b,{target:e,amount:1000,type:'physical'});close(hp-e.hp,(1000-e.def)*.5);close(e.shield,shield);hp=e.hp;
 dealDamage(b,{target:e,value:500,type:'arts'});close(hp-e.hp,250);hp=e.hp;
 dealDamage(b,{target:e,value:100,type:'true'});close(hp-e.hp,100);hp=e.hp;
 dealDamage(b,{source:miner,target:e,value:100,type:'physical'});close(e.hp,hp);close(e.shield,shield-100);
 dealDamage(b,{source:miner,target:e,value:100,type:'arts'});close(hp-e.hp,100);close(e.shield,shield-100);
 const wrong={...miner,id:'char_000_fake',name:'矿工游击队'};hp=e.hp;dealDamage(b,{source:wrong,target:e,value:100,type:'physical'});close(hp-e.hp,50);close(e.shield,shield-100);
});
test('专属屏障破除同帧解除嘲讽/攻速/恐惧沉睡免疫与减伤，额外普通屏障不能延续能力',()=>{
 const {b,e}=arena();b.step();assert.equal(e.taunt,1);assert.equal(b.enemyAttackTiming(e).frames,45);assert.equal(applyStatus(e,'fear',3),false);assert.equal(applyStatus(e,'sleep',3),false);const hp=e.hp;
 grantShield(b,e,{id:'other',amount:100,types:['physical']});dealDamage(b,{source:miner,target:e,value:e.maxHp*.05+10,type:'physical'});close(e.hp,hp);close(e.shield,90);assert.equal(e.taunt,0);assert.equal(b.enemyAttackTiming(e).frames,90);assert.equal(e.immunities.fear,false);assert.equal(e.immunities.sleep,false);
 dealDamage(b,{target:e,value:100,type:'arts'});close(hp-e.hp,100);assert.equal(applyStatus(e,'fear',3),true);b.step();assert.equal(e.taunt,0);
});
test('裂兽指定来源屏障溢出正确入血，破盾与未破盾状态跨存档且不重复生成',()=>{
 const {b,g,e}=arena();b.step();dealDamage(b,{source:miner,target:e,value:100,type:'physical'});let restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);const beast=restored.s.enemies[0];close(beast.shield,e.shield);assert.deepEqual(beast.shieldLayers[0].absorbSourceIds,['enemy_3010_mcreep']);const hp=beast.hp;dealDamage(restored,{source:miner,target:beast,value:beast.shield+70,type:'physical'});close(hp-beast.hp,70);restored.step();assert.equal(beast.taunt,0);
 restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(restored.s)));assert.ok(restored);restored.step();assert.equal(restored.s.enemies[0].shield,0);assert.equal(restored.s.enemies[0].taunt,0);
});
test('裂兽未阻挡时只攻击指定NPC，被普通干员阻挡时仍能攻击阻挡者',()=>{
 const {b,e,units:[u]}=arena([[4,3]]);const hp=u.hp;advance(b,2);assert.equal(u.hp,hp);assert.equal(e.action,null);const npc={uid:900001,id:miner.id,kind:'summon',type:'test',x:4,y:3,hp:10000,maxHp:10000,atk:0,def:0,res:0,attackSpeed:100,deployed:true,canAttack:false,statuses:[]};b.s.summons.push(npc);advance(b,1);assert.ok(npc.hp<10000);assert.equal(u.hp,hp);
 npc.deployed=false;u.x=3;e.action=null;e.attackCooldown=0;advance(b,1);assert.equal(e.block,u.uid);assert.ok(u.hp<hp);
});
test('裂兽屏障天赋不可沉默，生命和增益数值读取本期数据',()=>{
 const {b,e}=arena();applyStatus(e,'silence',20);b.step();assert.equal(e.taunt,1);assert.equal(b.enemyAttackTiming(e).frames,45);e.enemyTalent['M0Shield.damage_resistance']=.75;e.enemyTalent['M0Shield.attack_speed']=50;const hp=e.hp;dealDamage(b,{target:e,value:100,type:'physical'});close(hp-e.hp,25);assert.equal(b.enemyAttackTiming(e).frames,60);
});
test('预计算伤害分摊回原目标不重复减免，接收方仍按自己的规则结算',()=>{
 const {b,e}=arena();const id='enemy_1251_lysyta';b.level.enemyProfiles[id]=NATIVE_DATA.enemies[id];b.spawn({id,route:0});const other=b.s.enemies.at(-1);b.step();addDamageRedirect(b,e,{id:'share',targetUid:other.uid,ratio:.5,mode:'share'});const hp=e.hp,otherHp=other.hp;dealDamage(b,{target:e,value:1000,type:'physical'});close(hp-e.hp,250);close(otherHp-other.hp,250);
});
