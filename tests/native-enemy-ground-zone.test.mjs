import test from 'node:test';import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';import {NATIVE_DATA} from '../dist/runtime-data.js';
import {enemyBehaviorProfile} from '../dist/native-combat.js';
import {tickLogic} from '../dist/native-effects.js';

// 持续伤害范围第一批（DOT 词条）：集团军重型火炮、深溟巢涌者、萨卡兹枯朽（战士/战车）、
// 逐腐兽、假想敌：蚀裂。数值全部来自原表 blackboard，测试只核对「原表写了的那些数」。
function liveBattle(){
 const g=new NativeSession(NATIVE_DATA,{seed:11});
 g.s.funds=100;g.s.rewardPending=null;g.s.rewardQueue=[];
 const unit=g.gain(Object.values(NATIVE_DATA.season.charShopChessDatas).find(s=>s.charId&&!s.isHidden).chessId);
 g.s.rewardPending=null;g.s.rewardQueue=[];
 let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(unit.uid,x,y))placed=g.deploy(unit.uid,x,y,0);
 assert.ok(placed,'干员需要落场');
 assert.ok(g.perform('start'),g.lastError||'开战失败');
 const b=g.battle;b.s.queue=[];b.s.enemies=[];b.s.limit=1e9;b.deploy(b.s.units[0]);
 return b;
}
function spawnEnemy(b,id,x,y){
 // 路线坐标是地图坐标，需要按地图原点反算，否则敌人会被放到棋盘外。
 const origin=b.map.origin||{col:0,row:0};
 b.level={...(b.level||{}),routes:[{motionMode:'WALK',startPosition:{col:x+origin.col,row:origin.row-y},endPosition:{col:x+origin.col,row:origin.row-y},checkpoints:[]}],enemyProfiles:{...(b.level?.enemyProfiles||{}),[id]:NATIVE_DATA.enemies[id]}};
 b.spawn({id,route:0});
 return b.s.enemies.at(-1);
}
function zones(b){return (b.s.logicEffects||[]).filter(f=>f.kind==='field');}
const profiles=id=>NATIVE_DATA.enemies[id].enemyBehavior;

test('持续伤害范围的参数全部来自原表：六类敌人各自的区域字段',()=>{
 const artillery=profiles('enemy_10122_uacann_2').attackZone;
 assert.deepEqual({r:artillery.radius,d:artillery.duration,i:artillery.interval,dmg:artillery.damage},{r:1,d:3,i:1,dmg:150});
 const tank=profiles('enemy_1272_nhtank').attackZone;
 assert.deepEqual({r:tank.radius,d:tank.duration,dmg:tank.damage},{r:2.2,d:10,dmg:50});
 const nest=profiles('enemy_1234_dsubrl').selfField;
 assert.equal(nest.radius,1.6);assert.equal(nest.elementScale,0.05);assert.equal(nest.elementType,'neural');
 assert.equal(nest.atkScale,0,'原表没有常驻法术伤害的倍率，不能凭空给一个');
 const die=profiles('enemy_1267_nhpbr').deathZone;
 assert.deepEqual({r:die.radius,d:die.duration,dmg:die.damage},{r:2,d:8,dmg:50});
 const bleed=profiles('enemy_1270_nhstlk').bleeding;
 assert.deepEqual({dmg:bleed.damage,d:bleed.duration,cure:bleed.cureOnHeal},{dmg:100,d:10,cure:true});
 assert.equal(profiles('enemy_1270_nhstlk_2').bleeding.damage,150,'精英逐腐兽的流血伤害更高');
 const toxic=profiles('enemy_9006_actoxi').deathZone;
 assert.deepEqual({r:toxic.radius,d:toxic.duration,atk:toxic.atkScale,trigger:toxic.trigger},{r:0.8,d:8,atk:0.15,trigger:'death-target'});
});

test('集团军重型火炮开火后留下燃烧区域，按原表数值持续结算',()=>{
 const b=liveBattle(),u=b.s.units[0];
 const enemy=spawnEnemy(b,'enemy_10122_uacann_2',u.x,u.y+1);
 assert.equal(b.enemySpecialReady(enemy,u),null,'原表没有技能预制体，这一批只做常驻普攻');
 assert.equal(zones(b).length,0);
 b.resolveEnemyStrike(enemy,u,{});
 const zone=zones(b)[0];
 assert.ok(zone,'开火后应当留下一片区域');
 assert.equal(zone.radius,1);assert.equal(zone.values.damage,150);assert.equal(zone.values.damageType,'true');
 assert.equal(Math.round(zone.endsAt-b.s.time),3);
 const hp=u.hp;
 b.s.time+=1.1;b.tickEnemyGroundZones();
 assert.equal(u.hp,hp-150,'区域内每秒扣原表的 150 点');
 b.s.time+=10;b.tickEnemyGroundZones();
 assert.equal(u.hp,hp-150,'区域过期后不再结算');
});

test('深溟巢涌者是跟随自身的法术+神经损伤光环，抵抗用来减半可抵抗状态',()=>{
 const b=liveBattle(),u=b.s.units[0];
 const enemy=spawnEnemy(b,'enemy_1234_dsubrl',u.x,u.y+1);
 assert.equal(enemy.statusResistance,0.5,'原表 one_minus_status_resistance=-0.5 即 50% 抵抗');
 b.ensureEnemySelfField(enemy);
 const field=zones(b)[0];
 assert.ok(field,'存活时应当有常驻区域');
 assert.equal(field.values.damage,0);assert.equal(field.values.elementScale,0.05);assert.equal(field.values.elementType,'neural');
 assert.equal(field.followUid,enemy.uid);
 const injury=()=>Number(u.elemental?.neural||0);
 assert.equal(injury(),0);
 b.s.time+=1.1;b.tickEnemyGroundZones();
 assert.ok(injury()>0,'光环每秒叠加神经损伤');
 b.s.time+=1;b.tickEnemyGroundZones();
 assert.equal(zones(b).length,1,'同一个敌人只保留一片常驻区域');
});
test('萨卡兹枯朽战士被击倒后留下污染区域，只结算原表半径内的我方',()=>{
 const b=liveBattle(),u=b.s.units[0];
 const enemy=spawnEnemy(b,'enemy_1267_nhpbr',u.x+3,u.y);
 b.resolveEnemyDeath(enemy);
 assert.equal(zones(b).length,0,'半径 2 之外不留区域');
 b.s.logicEffects=[];
 const near=spawnEnemy(b,'enemy_1267_nhpbr',u.x,u.y+1);
 b.resolveEnemyDeath(near);
 const zone=zones(b)[0];
 assert.ok(zone,'击倒后应当留下污染区域');
 assert.equal(zone.radius,2);assert.equal(zone.values.damage,50);assert.equal(zone.values.damageType,'true');
 const hp=u.hp;
 b.s.time+=1.1;b.tickEnemyGroundZones();
 assert.ok(u.hp<hp,'区域内的干员持续掉血');
});

test('逐腐兽的流血是吸血式持续伤害，接受治疗后立即解除',()=>{
 const b=liveBattle(),u=b.s.units[0];
 const enemy=spawnEnemy(b,'enemy_1270_nhstlk',u.x,u.y+1);
 b.resolveEnemyAttackEffects(enemy,u);
 const dot=(b.s.logicEffects||[]).find(f=>f.kind==='dot');
 assert.ok(dot,'命中后挂上流血');
 assert.equal(dot.snapshot.damage,100);assert.equal(dot.values.type,'arts');
 assert.equal(Math.round(dot.endsAt-b.s.time),10);
 u.hp=u.hp-500;b.s.time=dot.nextAt;tickLogic(b,1/30);
 assert.ok(u.hp<u.maxHp);
 u.hp=Math.max(1,u.hp-200);b.s.time=dot.nextAt;const healed=b.heal(u,u,50);
 assert.ok(healed>0,'治疗要真的生效，解除钩子才成立');
 assert.equal(dot.endsAt,b.s.time,'流血被标记为立即结束');
 tickLogic(b,1/30);
 assert.equal((b.s.logicEffects||[]).some(f=>f.kind==='dot'),false,'治疗后流血解除');
});

test('假想敌：蚀裂只在被击倒时留下毒雾，不是常驻光环',()=>{
 const b=liveBattle(),u=b.s.units[0];
 const enemy=spawnEnemy(b,'enemy_9006_actoxi',u.x,u.y+1);
 assert.equal(enemy.selfField,null,'同一条「持续对周围造成」的文本不能当成常驻光环');
 b.ensureEnemySelfField(enemy);
 assert.equal(zones(b).length,0);
 b.resolveEnemyDeath(enemy,u);
 const zone=zones(b)[0];
 assert.ok(zone,'被击倒后留下毒雾');
 assert.equal(zone.radius,0.8);assert.equal(zone.values.atkScale,0.15);assert.equal(zone.values.damage,0);
 const hp=u.hp;
 b.s.time+=1.1;b.tickEnemyGroundZones();
 assert.ok(u.hp<hp,'毒雾按攻击力的 15% 持续结算');
});
