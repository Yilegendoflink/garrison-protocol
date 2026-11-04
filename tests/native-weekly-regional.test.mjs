import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_DATA as data} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {NativeBattle} from '../dist/native-battle.js';
import {regionalBondRules,weeklyChallengeAt,weeklyChallengeSnapshot,validateWeeklyChallengeSchedule} from '../dist/native-challenges.js';
import {regionalAttack,regionalSkillStart,tickRegionalBonds,regionalBondDescription} from '../dist/native-weekly-bonds.js';
import {dispatch,addEffect,dealDamage,tickLogic} from '../dist/native-effects.js';
import {applyStatus,tickStatuses} from '../dist/status.js';
import {buildPhasePlan} from '../dist/protocol.js';
import {advanceEnemy} from '../dist/native-combat.js';

const entry=data.weeklyChallenges.entries.find(e=>e.challengeId==='regional-rework'),challenge=weeklyChallengeSnapshot(entry,Date.parse(entry.startsAt));
function arena(id='siracusaShip',count=6){
 const g=new NativeSession(data,{seed:42,weeklyChallenge:challenge,bondBan:{bonds:[]}});
 const ids=data.season.bondInfoDict[id].chessIdList.filter(x=>!data.season.charChessDataDict[x].isGolden).slice(0,count);
 for(const chessId of ids)g.gain(chessId);g.s.rewardPending=null;g.s.rewardQueue=[];
 for(const u of g.s.units){let ok=false;for(let y=0;y<7&&!ok;y++)for(let x=0;x<11&&!ok;x++)if(!g.s.units.some(v=>v.uid!==u.uid&&v.position?.x===x&&v.position?.y===y)&&g.canDeploy(u.uid,x,y))ok=g.deploy(u.uid,x,y,0);assert.ok(ok);}
 assert.ok(g.startBattle());const b=g.battle;b.s.queue=[];b.s.limit=99999;b.layers[id]=0;for(const u of b.s.units){u.deployed=true;u.hp=u.maxHp;}
 return {g,b,u:b.s.units[0]};
}
function enemy(b,x=2,y=2){const e={uid:b.s.nextId++,id:'test',x,y,hp:100000,maxHp:100000,def:0,res:0,statuses:[],shieldLayers:[],barriers:[],immunities:{},deployGen:0};b.s.enemies.push(e);return e;}
const tick=(b,time)=>{b.s.time=time;tickRegionalBonds(b,dealDamage);};

test('11月4日至18日连续两周，前后边界及旧快照隔离',()=>{
 assert.deepEqual(validateWeeklyChallengeSchedule(data.weeklyChallenges),[]);
 assert.equal(Date.parse(entry.endsAt)-Date.parse(entry.startsAt),14*86400000);
 assert.equal(weeklyChallengeAt(data.weeklyChallenges,Date.parse(entry.startsAt)-1).challengeId,'tier-one-pair');
 assert.equal(weeklyChallengeAt(data.weeklyChallenges,Date.parse(entry.startsAt)).challengeId,'regional-rework');
 assert.equal(weeklyChallengeAt(data.weeklyChallenges,Date.parse(entry.endsAt)),null);
 assert.equal(regionalBondRules(data.weeklyChallenges.entries[0]),null);
});
test('六名不同叙拉古触发随机状态，每攻击每目标一次，免疫有效，无旧隐匿',()=>{
 const {b,u}=arena();assert.equal(b.rows.siracusaShip.count,6);assert.ok(!u.siracusaInvisibleUntil);
 const e=enemy(b);b.economy.random=()=>0;u.lastAttackId=1;regionalAttack(b,u,e);assert.equal(e.statuses[0].kind,'stun');
 regionalAttack(b,u,e);assert.equal(e.statuses.length,1);e.statuses=[];regionalAttack(b,u,e);assert.equal(e.statuses.length,0);
 u.lastAttackId=2;e.immunities.stun=true;regionalAttack(b,u,e);assert.equal(e.statuses.length,0);
 e.immunities={};u.lastAttackId=3;b.economy.random=()=>.99;regionalAttack(b,u,e);assert.equal(e.statuses.length,0);
 b.rows.siracusaShip.count=5;u.lastAttackId=4;b.economy.random=()=>0;regionalAttack(b,u,e);assert.equal(e.statuses.length,0);
 b.rows.siracusaShip.count=6;b.layers.siracusaShip=100;u.lastAttackId=5;regionalAttack(b,u,e);assert.equal(e.statuses[0].remaining,4);
});
test('至少两种异常才共鸣，按层数每秒圆形真伤且不伤友军，不递归触发',()=>{
 const {b,u}=arena(),e=enemy(b),near=enemy(b,3,2),far=enemy(b,3,3);
 applyStatus(e,'root',10);applyStatus(e,'root',10,{source:2});tick(b,0);tick(b,1);assert.equal(e.hp,100000);
 applyStatus(e,'silence',10);b.layers.siracusaShip=10;tick(b,2);assert.equal(e.hp,99720);assert.equal(near.hp,99720);assert.equal(far.hp,100000);
 const health=u.hp;tick(b,2.5);assert.equal(e.hp,99720);assert.equal(u.hp,health);
 e.statuses=[];tick(b,3);assert.equal(e.hp,99720);
});
test('普攻与技能直接命中按攻击去重抽取状态，持续结算入口驱动共鸣',()=>{
 const {b,u}=arena();b.spawn({id:'enemy_1007_slime',route:0});const e=b.s.enemies.at(-1);e.hp=e.maxHp=100000;e.immunities={};
 b.economy.random=()=>0;u.lastAttackId=123;b.hit(u,e,1,'physical');assert.ok(e.statuses.some(s=>s.kind==='stun'));
 e.statuses=[];u.lastAttackId=124;b.hit(u,e,1,'arts',{skill:true});assert.ok(e.statuses.some(s=>s.kind==='stun'));e.statuses=[];
 applyStatus(e,'root',10);applyStatus(e,'silence',10);const hp=e.hp;b.s.time=0;tickLogic(b,1/30);b.s.time=1;tickLogic(b,1/30);assert.equal(e.hp,hp-200);
});
test('流沙按开技实际范围落格，重叠合并；五秒伤害和束缚，离开即清迟钝，飞行不受影响',()=>{
 const {b,u}=arena('sargonShip');b.range=()=>[{x:2,y:2},{x:3,y:2},{x:-1,y:2}];
 b.skillActive=()=>false;regionalSkillStart(b,u,addEffect);regionalSkillStart(b,u,addEffect);
 assert.equal(b.s.logicEffects.filter(f=>f.talentOrSkillId==='weekly-sargon-sand').length,1);
 const zone=b.s.logicEffects.find(f=>f.talentOrSkillId==='weekly-sargon-sand');assert.equal(zone.values.staticCells.length,2);
 const e=enemy(b),outside=enemy(b,4,2),fly=enemy(b);fly.flying=true;
 tick(b,0);assert.equal(e.statuses.find(s=>s.kind==='sluggish').value,.2);tick(b,4.9);assert.equal(e.hp,100000);
 tick(b,5);assert.equal(e.hp,99800);assert.ok(e.statuses.some(s=>s.kind==='root'&&s.remaining===1));assert.equal(outside.hp,100000);assert.equal(fly.hp,100000);
 e.x=4;tick(b,5.01);assert.ok(!e.statuses.some(s=>s.kind==='sluggish'));
 b.rows.sargonShip.count=5;regionalSkillStart(b,u,addEffect);tick(b,10);assert.equal(e.hp,99800);
});
test('技能期间仅其攻击范围的已有流沙强化，迟钝双倍且每秒额外法伤，结束恢复基础',()=>{
 const {b,u}=arena('sargonShip');b.range=()=>[{x:2,y:2},{x:3,y:2}];regionalSkillStart(b,u,addEffect);
 const e=enemy(b),other=enemy(b,3,2);b.layers.sargonShip=100;b.skillActive=v=>v===u;b.inside=(v,e)=>e.x===2;
 tick(b,0);assert.equal(e.statuses.find(s=>s.kind==='sluggish').value,.8);assert.equal(other.statuses.find(s=>s.kind==='sluggish').value,.4);
 tick(b,1);assert.equal(e.hp,99500);assert.equal(other.hp,100000);
 b.skillActive=()=>false;tick(b,2);assert.equal(e.hp,99500);assert.equal(e.statuses.find(s=>s.kind==='sluggish').value,.4);
});
test('流沙迟钝的层数与翻倍真正影响移动速度，普通迟钝保留原口径',()=>{
 const run=(value,source)=>{const e={hp:100,x:0,y:0,speed:1,baseSpeed:1,cmd:0,route:[{kind:'move',x:10,y:0}],statuses:[{kind:'sluggish',remaining:10,value,source}]};advanceEnemy(e,1,()=>{});return e.x;};
 assert.equal(run(.2,'weekly-sargon-sand'),.8);assert.equal(run(.4,'weekly-sargon-sand'),.6);assert.ok(Math.abs(run(.8,'weekly-sargon-sand')-.2)<1e-9);
 assert.equal(run(.2,123),.2);assert.equal(run(.2,'weekly-siracusa-123'),.8);
});
test('真实技能事件保留攻速上限，替换旧攻击加成；流沙与计时随战斗存档恢复',()=>{
 const {g,b,u}=arena('sargonShip');const atk=b.stats(u).atk;for(let i=0;i<30;i++)dispatch(b,'skill-start',{target:u});
 assert.equal(u.sargonBuffs.length,25);assert.equal(b.stats(u).atk,atk);assert.ok(b.s.logicEffects.some(f=>f.talentOrSkillId==='weekly-sargon-sand'));
 const restored=NativeSession.restore(data,JSON.parse(JSON.stringify(g.snapshot())));assert.ok(restored);
 assert.deepEqual(restored.battle.s.logicEffects,b.s.logicEffects);
 assert.match(regionalBondDescription(challenge,'sargonShip',100),/40.0%/);
 assert.match(regionalBondDescription(challenge,'siracusaShip',100),/1000 真实伤害/);
 const old=new NativeSession(data,{seed:42});assert.equal(regionalBondRules(old.s.weeklyChallenge),null);
});
