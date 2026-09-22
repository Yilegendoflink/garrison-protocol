import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';
import {NativeBattle} from '../dist/native-battle.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {dealDamage,commitExit,applyHeal,applyElementDamage,alliedActors,attackableAllies} from '../dist/native-effects.js';
import {applyStatus,statusAttributeChanges,permissions} from '../dist/status.js';
import {NO_BOND_BAN} from './no-bond-ban.mjs';

function arena(positions=[]){
 const g=new NativeSession(NATIVE_DATA,{bondBan:NO_BOND_BAN,seed:42});g.s.funds=100;const shop=Object.values(NATIVE_DATA.season.charShopChessDatas).find(s=>!s.isHidden&&NATIVE_DATA.profiles[s.chessId]?.profession==='MEDIC');g.gain(shop.chessId);g.s.rewardPending=null;g.s.rewardQueue=[];const u=g.s.units[0];let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(u.uid,x,y))placed=g.deploy(u.uid,x,y,0);
 assert.ok(placed);assert.ok(g.perform('start'));const b=g.battle,template=b.s.units[0];b.s.queue=[];b.s.enemies=[];b.s.logicEffects=[];b.s.limit=1000;b.map=structuredClone(b.map);
 const stats=b.stats.bind(b);b.stats=a=>({...stats(a),maxHp:50000,def:1000,magicResistance:0,blockCnt:3});
 b.s.units=positions.map(([x,y],i)=>{const a=structuredClone(template);a.uid+=i*100;a.x=x;a.y=y;a.deployed=true;a.hp=a.maxHp=50000;applyStatus(a,'disarm',600);applyStatus(a,'skillLock',600);b.map.grid[y][x].heightType='LOWLAND';return a;});
 const id='enemy_10127_rkmbst_2',o=b.map.origin,p={col:o.col+3,row:o.row-3};b.level={...b.level,routes:[{motionMode:'WALK',startPosition:p,endPosition:p,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...b.level.enemyProfiles,[id]:NATIVE_DATA.enemies[id]}};b.spawn({id,route:0});
 return {b,g,e:b.s.enemies[0],units:b.s.units};
}
function advance(b,t){for(let i=0;i<Math.round(t*30);i++)b.step();}
function fatal(b,e){dealDamage(b,{target:e,value:e.maxHp*10,type:'true'});}





function camp(b,x=2,y=3,skill){return b.spawnMineCamp({x,y,route:[{kind:'move',x,y},{kind:'move',x:7,y},{kind:'wait',x:7,y,time:600}],skill});}
function safe(scene){const {e}=scene;e.canAttack=false;e.x=8;e.y=5;e.route=[{kind:'wait',x:8,y:5,time:600}];e.cmd=0;return scene;}
const miners=(b,c)=>b.s.summons.filter(s=>s.type==='neutral-miner'&&s.campUid===c.uid);

test('矿道每15秒尝试集结，待命最多3人，满额失败不积压生成次数',()=>{
 const {b}=safe(arena()),c=camp(b);advance(b,14.9);assert.equal(miners(b,c).length,0);advance(b,.1);assert.equal(miners(b,c).length,1);advance(b,45);assert.equal(miners(b,c).length,3);commitExit(b,{target:miners(b,c)[0]});advance(b,1);assert.equal(miners(b,c).length,2);advance(b,14);assert.equal(miners(b,c).length,3);
});
test('协同指令消耗15SP，出击解除既有自缚，切回待命不召回已出击者',()=>{
 const {b,g}=safe(arena()),c=camp(b);assert.equal(g.perform('mineCommand',c.uid),false);advance(b,15.1);const m=miners(b,c)[0];assert.equal(permissions(m).move,false);assert.equal(permissions(m).attack,true);assert.equal(m.statuses.some(s=>s.kind==='root'),false);assert.equal(g.perform('mineCommand',c.uid),true);assert.equal(c.sp,0);assert.equal(m.waiting,false);advance(b,15.1);assert.equal(g.perform('mineCommand',c.uid),true);assert.equal(c.mineMode,'waiting');assert.ok(miners(b,c).every(m=>!m.waiting));advance(b,15);assert.ok(miners(b,c).some(m=>m.waiting));
});
test('总上限5名按矿道分别计数，来源身份不占用干员召唤物所有权',()=>{
 const {b,g}=safe(arena()),a=camp(b),c=camp(b,2,4);advance(b,15.1);assert.equal(g.perform('mineCommand',a.uid),true);advance(b,90);assert.equal(miners(b,a).length,5);assert.equal(miners(b,c).length,3);assert.ok(miners(b,a).every(m=>m.ownerUid==null&&m.campUid===a.uid));
});
test('待命仅禁止移动，仍会攻击范围内敌人，恐惧不能绕过自缚移动',()=>{
 const {b,e}=arena();e.canAttack=false;e.x=3;e.y=3;const c=camp(b,2,3);advance(b,16);const m=miners(b,c)[0];assert.equal(m.waiting,true);assert.equal(m.x,2);assert.ok(e.shield<e.maxHp*.05);applyStatus(m,'fear',2,{source:e.uid});const x=m.x,y=m.y;advance(b,1);assert.equal(m.x,x);assert.equal(m.y,y);
});
test('矿道配置与SP/周期跨存档，恢复不会重复集结；战斗路径绕开在场矿道地块',()=>{
 const {b,g}=safe(arena()),c=camp(b);assert.equal(b.tileWalkable(c.x,c.y),false);advance(b,14.5);const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);advance(restored,1);const copy=restored.s.summons.find(s=>s.uid===c.uid);assert.equal(miners(restored,copy).length,1);assert.equal(restored.mineCampReady(copy),true);assert.equal(copy.nextMinerAt,30);commitExit(restored,{target:copy});assert.equal(restored.tileWalkable(c.x,c.y),b.map.grid[c.y][c.x].passableMask!=='FLY_ONLY'&&b.map.grid[c.y][c.x].passableMask!=='NONE');
});
test('矿道间隔和人数上限来自历史技能黑板，非法位置/空路线不能创建',()=>{
 const {b}=safe(arena()),skill=structuredClone(NATIVE_DATA.mineCamp.skill);for(const row of skill.blackboard){if(row.key==='talent@interval')row.value=2;if(row.key==='talent@max_mcreep_near_count')row.value=1;}const c=camp(b,2,3,skill);advance(b,10);assert.equal(miners(b,c).length,1);assert.throws(()=>b.spawnMineCamp({x:2,y:3,route:[]}),/显式矿工路线/);
});
