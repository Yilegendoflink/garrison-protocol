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
 assert.deepEqual({r:die.radius,d:die.duration,i:die.interval,dmg:die.damage,atk:die.atkScale},{r:2,d:8,i:0.5,dmg:100,atk:0});
 const bleed=profiles('enemy_1270_nhstlk').bleeding;
 assert.deepEqual({dmg:bleed.damage,d:bleed.duration,cure:bleed.cureOnHeal},{dmg:100,d:10,cure:true});
 assert.equal(profiles('enemy_1270_nhstlk_2').bleeding.damage,150,'精英逐腐兽的流血伤害更高');
 const toxic=profiles('enemy_9006_actoxi').deathZone;
 assert.deepEqual({r:toxic.radius,d:toxic.duration,i:toxic.interval,atk:toxic.atkScale,dmg:toxic.damage,trigger:toxic.trigger},{r:0.8,d:8,i:0.5,atk:0,dmg:100,trigger:'death-target'});
});

test('所有死亡留下的持续伤害圈统一 100 点 / 0.5 秒（不再按攻击力结算）',()=>{
 // 死亡圈的中心在敌人死掉的那一刻就没了，按攻击力百分比结算会算出 0，所以统一成固定值；
 // 这条门禁扫描原表里所有 trigger 为 death／death-target 的区域，避免以后新增敌人漏改。
 const death=Object.entries(NATIVE_DATA.enemies).filter(([,e])=>['death','death-target'].includes(e?.enemyBehavior?.deathZone?.trigger));
 assert.ok(death.length>=2,'原表里应当有死亡区域类敌人');
 for(const [id,e] of death){
  const zone=e.enemyBehavior.deathZone;
  assert.equal(zone.damage,100,`${id} 的死亡圈伤害`);
  assert.equal(zone.interval,0.5,`${id} 的死亡圈结算间隔`);
  assert.equal(Number(zone.atkScale)||0,0,`${id} 的死亡圈不应再按攻击力结算`);
  assert.ok(zone.duration>0&&zone.radius>0,`${id} 的死亡圈保留原表半径与时长`);
 }
 // 常驻光环与开火燃烧走的是 attackZone／selfField，数值不能被这次改动波及。
 assert.equal(profiles('enemy_10122_uacann_2').attackZone.damage,150);
 assert.equal(profiles('enemy_1272_nhtank').attackZone.damage,50);
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
test('深溟巢涌者死亡后常驻区域清理，死亡区域仍按 duration 保留',()=>{
 const b=liveBattle(),u=b.s.units[0],enemy=spawnEnemy(b,'enemy_1234_dsubrl',u.x,u.y+1);b.ensureEnemySelfField(enemy);assert.equal(zones(b).length,1);enemy.hp=0;b.s.time+=1/30;tickLogic(b,1/30);assert.equal(zones(b).length,0);
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
 assert.equal(zone.radius,2);assert.equal(zone.values.damage,100);assert.equal(zone.values.damageType,'true');
 assert.equal(zone.interval,0.5,'死亡圈每 0.5 秒结算一次');
 u.maxHp=999999;u.hp=999999;
 const hp=u.hp;
 b.s.time+=1.1;b.tickEnemyGroundZones();
 assert.equal(u.hp,hp-200,'1.1 秒里按 0.5 秒一拍共结算两拍，一拍 100');
 // 同一地点再死一只只刷新同一片区域，不叠第二圈（否则加成混合下就是一地粉红）
 const again=spawnEnemy(b,'enemy_1267_nhpbr',u.x,u.y+1);
 b.resolveEnemyDeath(again);
 assert.equal(zones(b).length,1,'同一地点重复死亡只保留一圈');
});

test('错相重叠的多个死亡圈对同一个干员只结算一层（不因层叠翻倍）',()=>{
 const b=liveBattle(),u=b.s.units[0];
 u.maxHp=999999;u.hp=999999;
 // 两圈圆心不重合、创建时刻相差 0.25 秒，结算相位因此错开，必须靠时间窗去重。
 const first=spawnEnemy(b,'enemy_1267_nhpbr',u.x,u.y+1);
 b.resolveEnemyDeath(first);
 b.s.time+=0.25;
 const second=spawnEnemy(b,'enemy_1267_nhpbr',u.x+1,u.y);
 b.resolveEnemyDeath(second);
 assert.equal(zones(b).length,2,'两处不同位置的死亡各留一圈');
 // 从首个结算点起跨 1.5 秒：每 0.5 秒只有一圈生效，共 4 拍；若层数直接相加会是 7 拍 700。
 const start=b.s.time+0.5,hp=u.hp;
 b.s.time=start+1.5;b.tickEnemyGroundZones();
 assert.equal(hp-u.hp,400,'重叠层只按一层结算');
 // 伤害更高的一层在同一时间窗内只补差额，不会因为是后到的就被整个吞掉。
 b.s.logicEffects=[];b.zoneHitWindow.clear();
 const src=spawnEnemy(b,'enemy_1272_nhtank',u.x+1,u.y+1);
 b.addEnemyGroundZone(src,{radius:2,interval:0.5,duration:5,damage:100,damageType:'true'},{x:u.x,y:u.y});
 b.s.time+=0.2;
 b.addEnemyGroundZone(src,{radius:2,interval:0.5,duration:5,damage:150,damageType:'true'},{x:u.x,y:u.y});
 const hp2=u.hp;b.s.time+=0.5;b.tickEnemyGroundZones();
 assert.equal(hp2-u.hp,150,'同一窗内 100 + 更高的 150 只补 50');
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
 assert.equal(zone.radius,0.8);assert.equal(zone.values.damage,100);assert.equal(Number(zone.values.atkScale)||0,0);
 assert.equal(zone.values.damageType,'arts');
 const hp=u.hp;
 b.s.time+=0.5;b.tickEnemyGroundZones();
 const one=hp-u.hp;assert.ok(one>0,'毒雾持续结算');
 b.s.time+=0.6;b.tickEnemyGroundZones();
 assert.equal(u.hp,hp-one*2,'毒雾每 0.5 秒固定 100 点，不再依赖已经消失的攻击力');
});
