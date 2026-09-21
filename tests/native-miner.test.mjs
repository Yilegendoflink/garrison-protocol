import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';
import {NativeBattle} from '../dist/native-battle.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {dealDamage,commitExit,applyHeal,applyElementDamage,alliedActors,attackableAllies} from '../dist/native-effects.js';
import {applyStatus,statusAttributeChanges} from '../dist/status.js';

function arena(positions=[]){
 const g=new NativeSession(NATIVE_DATA,{seed:42});g.s.funds=100;const shop=Object.values(NATIVE_DATA.season.charShopChessDatas).find(s=>!s.isHidden&&NATIVE_DATA.profiles[s.chessId]?.profession==='MEDIC');g.gain(shop.chessId);g.s.rewardPending=null;g.s.rewardQueue=[];const u=g.s.units[0];let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(u.uid,x,y))placed=g.deploy(u.uid,x,y,0);
 assert.ok(placed);assert.ok(g.perform('start'));const b=g.battle,template=b.s.units[0];b.s.queue=[];b.s.enemies=[];b.s.logicEffects=[];b.s.limit=1000;b.map=structuredClone(b.map);
 const stats=b.stats.bind(b);b.stats=a=>({...stats(a),maxHp:50000,def:1000,magicResistance:0,blockCnt:3});
 b.s.units=positions.map(([x,y],i)=>{const a=structuredClone(template);a.uid+=i*100;a.x=x;a.y=y;a.deployed=true;a.hp=a.maxHp=50000;applyStatus(a,'disarm',600);applyStatus(a,'skillLock',600);b.map.grid[y][x].heightType='LOWLAND';return a;});
 const id='enemy_10127_rkmbst_2',o=b.map.origin,p={col:o.col+3,row:o.row-3};b.level={...b.level,routes:[{motionMode:'WALK',startPosition:p,endPosition:p,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...b.level.enemyProfiles,[id]:NATIVE_DATA.enemies[id]}};b.spawn({id,route:0});
 return {b,g,e:b.s.enemies[0],units:b.s.units};
}
function advance(b,t){for(let i=0;i<Math.round(t*30);i++)b.step();}
function fatal(b,e){dealDamage(b,{target:e,value:e.maxHp*10,type:'true'});}




const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,a+' != '+b);
function miner(b,x=3.5,y=3,route=null){return b.spawn({id:'enemy_3010_mcreep'},{x,y,route:route||[{kind:'move',x:7,y:3},{kind:'wait',x:7,y:3,time:600}],cmd:0});}

test('真实矿工从生成入口创建为中立NPC，不被普通干员攻击/治疗/光环选中，仍能被敌方攻击',()=>{
 const {b,e,units:[u]}=arena([[5,3]]);e.canAttack=false;const m=miner(b);b.step();assert.equal(m.neutral,true);assert.equal(m.maxHp,3000);assert.equal(m.atk,500);assert.equal(m.taunt,-1);assert.ok(!b.s.enemies.includes(m));assert.ok(!alliedActors(b.s).includes(m));assert.ok(attackableAllies(b.s).includes(m));assert.ok(!b.targets(u).includes(m));assert.ok(!b.healingTargets(u,true).includes(m));m.hp=1000;assert.equal(applyHeal(b,{source:u,target:m,amount:100}),0);const hp=m.hp;b.resolveEnemyStrike(e,m);assert.ok(m.hp<hp);
});
test('真实矿工参与交战并自主攻击裂兽，指定来源物理伤害实际消耗专属屏障',()=>{
 const {b,e}=arena();e.canAttack=false;const m=miner(b),shield=e.shield;advance(b,1);assert.equal(b.s.minerEngagements.length,1);close(e.shield,shield-(m.atk-e.def));const logs=b.s.logicLog.filter(r=>r.type==='damage'&&r.sourceUid===m.uid&&r.targetUid===e.uid);assert.equal(logs.length,1,'不能再被通用召唤攻击循环重复结算');advance(b,6.1);assert.equal(e.shield,0);assert.equal(e.taunt,0);assert.equal(b.s.kills,0);
});
test('矿工沿显式路线行进并在终点离场，不扣生命或增加敌人歼灭数',()=>{
 const {b,e}=arena();e.canAttack=false;e.x=8;e.y=4;e.route=[{kind:'wait',x:8,y:4,time:600}];e.cmd=0;const m=miner(b,2,3,[{kind:'move',x:3,y:3}]);const leaks=b.s.leaks;advance(b,.5);assert.ok(m.x>2&&m.x<3);advance(b,1.1);assert.equal(b.s.summons.includes(m),false);assert.equal(b.s.leaks,leaks);assert.equal(b.s.kills,0);
});
test('矿工无视不可选中但不攻击飞行目标，中立单位不受元素损伤',()=>{
 const {b,e}=arena();e.canAttack=false;e.untargetable=true;const m=miner(b);advance(b,1);assert.ok(e.shield<e.maxHp*.05);const shield=e.shield;e.flying=true;advance(b,4);assert.equal(e.shield,shield);const hp=m.hp;const result=applyElementDamage(b,{source:e,target:m,amount:2000,type:'neural'});assert.equal(result.added,0);assert.equal(m.hp,hp);
});
test('矿工按医疗干员有效范围每秒自疗50%当前攻击力，多个医疗独立结算',()=>{
 const {b,e,units}=arena([[4,3],[3,4]]);e.canAttack=false;e.x=8;e.y=4;e.route=[{kind:'wait',x:8,y:4,time:600}];e.cmd=0;const m=miner(b,3,3,[{kind:'wait',x:3,y:3,time:600}]);m.waiting=true;m.hp=1;units[0].dir=2;units[1].dir=3;for(const u of units)assert.equal(b.inside(u,m),true);const amount=units.reduce((n,u)=>n+b.stats(u).atk*.5,0);advance(b,1);close(m.hp,Math.min(3000,1+amount));applyStatus(m,'healingBlocked',2);const hp=m.hp;advance(b,1);close(m.hp,hp);
});
test('矿工恐惧期间每秒受到200真实伤害，状态和攻击前摇跨JSON恢复',()=>{
 const {b,g,e}=arena();e.canAttack=false;e.x=8;e.y=4;e.route=[{kind:'wait',x:8,y:4,time:600}];e.cmd=0;const m=miner(b,3,3,[{kind:'wait',x:3,y:3,time:600}]);applyStatus(m,'fear',2.2,{source:e.uid});advance(b,1.1);assert.equal(m.hp,2800);const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);advance(restored,1.2);assert.equal(restored.s.summons[0].hp,2600);
 const next=arena();next.e.canAttack=false;const active=miner(next.b);advance(next.b,.4);const copy=NativeBattle.restore(NATIVE_DATA,next.g,next.b.map,next.b.turn,JSON.parse(JSON.stringify(next.b.s)));assert.ok(copy);advance(copy,.6);const logs=copy.s.logicLog.filter(r=>r.type==='damage'&&r.sourceUid===active.uid);assert.equal(logs.length,1);
});

test('矿工不享受我方盟约全局减伤，敌方地面区域仍能命中中立NPC',()=>{
 const {b,e}=arena();e.canAttack=false;const m=miner(b);const originalOn=b.on.bind(b);b.on=id=>id==='emptyShip'||originalOn(id);const hp=m.hp;b.hurt(m,{atk:100,damageType:'true'});close(hp-m.hp,100);b.addEnemyGroundZone(e,{damage:100,damageType:'true',radius:2,shape:'circle',interval:1,duration:10,ignoreTargetability:true},{x:m.x,y:m.y});const after=m.hp;advance(b,1.1);assert.ok(m.hp<=after-100);
});
