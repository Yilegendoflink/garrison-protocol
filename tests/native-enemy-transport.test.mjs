import test from 'node:test';import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';import {NativeBattle} from '../dist/native-battle.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';import {commitExit,dealDamage,applyLoss} from '../dist/native-effects.js';import {applyStatus} from '../dist/status.js';
import {unloadEnemyTransport} from '../dist/native-enemy-transport.js';

function arena(){
 const g=new NativeSession(NATIVE_DATA,{seed:42});g.s.funds=100;assert.ok(g.perform('buy',0));const unit=g.s.units[0];let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(unit.uid,x,y))placed=g.deploy(unit.uid,x,y,0);
 assert.ok(placed);assert.ok(g.perform('start'));const b=g.battle;b.s.units=[];b.s.queue=[];b.s.enemies=[];b.s.limit=1000;return {b,g};
}
function spawn(b,id,x=3,y=3){const o=b.map.origin,p={col:o.col+x,row:o.row-y},raw=NATIVE_DATA.enemies[id];b.level={...b.level,routes:[{motionMode:raw.motion,startPosition:p,endPosition:p,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...b.level.enemyProfiles,[id]:raw}};b.spawn({id,route:0});const e=b.s.enemies.at(-1);e.route=[{kind:'wait',time:600},{kind:'move',x:7,y:3}];e.cmd=0;return e;}
function advance(b,t){for(let i=0;i<Math.round(t*30);i++)b.step();}

test('木驮兽只装载范围内非机械非领袖地面敌人，上限5且满载速度不低于0.1',()=>{
 const {b}=arena(),carrier=spawn(b,'enemy_10159_mntrjn'),fly=spawn(b,'enemy_1005_yokai'),machine=spawn(b,'enemy_1254_lypa_2'),boss=spawn(b,'enemy_1500_skulsr'),far=spawn(b,'enemy_1007_slime',4,3);
 assert.ok(machine.enemyTags.includes('machine'));const ground=Array.from({length:6},()=>spawn(b,'enemy_1007_slime'));b.step();
 assert.equal(carrier.transport.passengers.length,5);assert.equal(carrier.speed,.1);assert.equal(carrier.canAttack,false);assert.equal(carrier.unblockable,true);
 assert.ok(ground.slice(0,5).every(e=>e.hidden&&e.carriedBy===carrier.uid));assert.equal(ground[5].hidden,false);
 for(const e of [fly,machine,boss,far])assert.equal(e.carriedBy,undefined);
});

test('被装载者保留生命技力，不沿原路径移动，不作为击倒；载具移动时同步乘客位置',()=>{
 const {b}=arena(),carrier=spawn(b,'enemy_10159_mntrjn'),rider=spawn(b,'enemy_1183_mlasrt');rider.hp-=12;rider.sp=2;const hp=rider.hp;
 b.step();carrier.route=[{kind:'move',x:6,y:3}];carrier.cmd=0;const cmd=rider.cmd;advance(b,1);
 assert.equal(rider.cmd,cmd);assert.equal(rider.hp,hp);assert.equal(rider.sp,2);assert.equal(b.s.kills,0);assert.equal(rider.x,carrier.x);assert.equal(rider.y,carrier.y);
 assert.equal(dealDamage(b,{target:rider,value:999,type:'true'}),null,'消失期间不能被伤害选中');
});

test('载具死亡卸载原实体，木驮兽乘客继承剩余路线并跳过停驻',()=>{
 const {b}=arena(),carrier=spawn(b,'enemy_10159_mntrjn'),rider=spawn(b,'enemy_1007_slime');b.step();const uid=rider.uid,nextId=b.s.nextId;
 commitExit(b,{target:carrier});assert.equal(rider.uid,uid);assert.equal(b.s.nextId,nextId);assert.equal(b.s.kills,1);assert.equal(rider.hidden,false);assert.equal(rider.carriedBy,null);
 assert.ok(Math.abs(rider.x-carrier.x)<=.2&&Math.abs(rider.y-carrier.y)<=.2);assert.deepEqual(rider.route,carrier.route);assert.equal(rider.cmd,1);
 const x=rider.x;b.step();assert.ok(rider.x>x);assert.equal(b.s.finished,false);
});

test('越长尘占4阻挡，卸客保留乘客原路径，禁用装载后不重新上车',()=>{
 const {b}=arena(),carrier=spawn(b,'enemy_1302_ymtro_2'),rider=spawn(b,'enemy_1007_slime');rider.route=[{kind:'wait',time:600},{kind:'move',x:1,y:3}];
 assert.equal(carrier.blockCost,4);b.step();assert.equal(rider.hidden,true);
 unloadEnemyTransport(b,carrier,{disable:true});assert.equal(rider.x,3);assert.equal(rider.y,3);assert.equal(rider.route[1].x,1);assert.equal(rider.cmd,1);
 b.step();assert.equal(rider.hidden,false);assert.equal(carrier.transport.disabled,true);
});

test('晕眩期间不能载客，控制结束恢复；满载关系跨JSON保存且孤儿乘客存档被拒绝',()=>{
 const {b,g}=arena(),carrier=spawn(b,'enemy_10159_mntrjn'),rider=spawn(b,'enemy_1007_slime');applyStatus(carrier,'stun',1);advance(b,.5);assert.equal(rider.hidden,false);
 advance(b,.6);assert.equal(rider.hidden,true);const saved=JSON.parse(JSON.stringify(b.s)),restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,saved);assert.ok(restored);
 const c=restored.s.enemies.find(e=>e.uid===carrier.uid),p=restored.s.enemies.find(e=>e.uid===rider.uid);assert.equal(p.carriedBy,c.uid);commitExit(restored,{target:c});assert.equal(p.hidden,false);
 saved.enemies=saved.enemies.filter(e=>e.uid!==carrier.uid);assert.equal(NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,saved),null);
});

test('载具漏怪也卸载乘客，不把上车乘客静默删除',()=>{
 const {b}=arena(),carrier=spawn(b,'enemy_10159_mntrjn'),rider=spawn(b,'enemy_1007_slime');b.step();
 carrier.route=[{kind:'move',x:carrier.x,y:carrier.y}];carrier.cmd=0;b.step();
 assert.equal(carrier.hp,0);assert.equal(rider.hidden,false);assert.equal(rider.carriedBy,null);assert.equal(b.s.kills,0);assert.ok(b.s.leaks>=1);
});

test('乘客在消失期间因生命流失退场，载具立刻释放格数并能保存恢复',()=>{
 const {b,g}=arena(),carrier=spawn(b,'enemy_10159_mntrjn'),rider=spawn(b,'enemy_1007_slime');b.step();assert.equal(carrier.transport.passengers.length,1);
 applyLoss(b,{target:rider,amount:rider.hp});assert.equal(carrier.transport.passengers.length,0);assert.equal(carrier.speed,carrier.baseSpeed);
 assert.ok(NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s))));
});
