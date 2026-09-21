import test from 'node:test';import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';import {NATIVE_DATA} from '../dist/runtime-data.js';
import {enemyBehaviorProfile} from '../dist/native-combat.js';
import {tickLogic,commitExit} from '../dist/native-effects.js';
import {applyStatus} from '../dist/status.js';

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

test('持续伤害范围参数来自原表及显式PRTS覆盖：六类敌人各自的区域字段',()=>{
 const artillery=profiles('enemy_10122_uacann_2').attackZone;
 assert.deepEqual({r:artillery.radius,d:artillery.duration,i:artillery.interval,dmg:artillery.damage},{r:1,d:3,i:1,dmg:150});
 const tank=profiles('enemy_1272_nhtank').attackZone;
 assert.deepEqual({r:tank.radius,d:tank.duration,dmg:tank.damage},{r:2.2,d:10,dmg:50});
 const nest=profiles('enemy_1234_dsubrl').selfField;
 assert.equal(nest.radius,1.6);assert.equal(nest.elementScale,0.05);assert.equal(nest.elementType,'neural');
 assert.equal(nest.atkScale,1,'PRTS明确每秒攻击力100%法术伤害，来源登记在enemy-behavior-overrides');
 const die=profiles('enemy_1267_nhpbr').deathZone;
 assert.deepEqual({r:die.radius,d:die.duration,i:die.interval,dmg:die.damage,atk:Number(die.atkScale)||0},{r:2,d:8,i:1,dmg:50,atk:0});
 const bleed=profiles('enemy_1270_nhstlk').bleeding;
 assert.deepEqual({dmg:bleed.damage,d:bleed.duration,cure:bleed.cureOnHeal},{dmg:100,d:10,cure:true});
 assert.equal(profiles('enemy_1270_nhstlk_2').bleeding.damage,150,'精英逐腐兽的流血伤害更高');
 const toxic=profiles('enemy_9006_actoxi').deathZone;
 assert.deepEqual({r:toxic.radius,d:toxic.duration,i:toxic.interval,atk:toxic.atkScale,dmg:toxic.damage,trigger:toxic.trigger},{r:0.8,d:8,i:1,atk:0.15,dmg:0,trigger:'death-target'});
});

test('死亡圈数值照原表：要么固定伤害、要么产生者攻击力的百分比，两者必居其一',()=>{
 // 污染秽蚀是固定伤害（PollutedDie.polluted_damage_low=50），毒雾是攻击力的 15%（1.damage_atk_scale）；
 // 这条门禁扫描原表里所有 trigger 为 death／death-target 的区域，避免以后新增敌人漏改。
 // 攻击力百分比的那一类必须能在产生者死亡后继续结算——由 native-battle 创建区域时留档 sourceAtk 保证，
 // 运行时行为见下面「蚀裂」的用例。
 const death=Object.entries(NATIVE_DATA.enemies).filter(([,e])=>['death','death-target'].includes(e?.enemyBehavior?.deathZone?.trigger));
 assert.ok(death.length>=2,'原表里应当有死亡区域类敌人');
 for(const [id,e] of death){
  const zone=e.enemyBehavior.deathZone,flat=Number(zone.damage)>0,scaled=Number(zone.atkScale)>0;
  assert.notEqual(flat,scaled,`${id} 的死亡圈必须且只能有一种伤害口径`);
  assert.equal(zone.interval,1,`${id} 的死亡圈按原表每秒结算一次`);
  assert.ok(zone.duration>0&&zone.radius>0,`${id} 的死亡圈保留原表半径与时长`);
 }
 assert.equal(profiles('enemy_1267_nhpbr').deathZone.damage,50,'污染秽蚀是原表的固定伤害');
 assert.equal(profiles('enemy_9006_actoxi').deathZone.atkScale,0.15,'毒雾是原表的攻击力百分比');
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
 assert.equal(zone.radius,1);assert.equal(zone.values.damage,150);assert.equal(zone.values.damageType,'arts','PRTS燃烧区域为法术持续伤害');
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
 assert.equal(zones(b).length,1,'无人处死亡也留下污染，后来进入的我方仍可能受伤');
 b.s.logicEffects=[];
 const near=spawnEnemy(b,'enemy_1267_nhpbr',u.x,u.y+1);
 b.resolveEnemyDeath(near);
 const zone=zones(b)[0];
 assert.ok(zone,'击倒后应当留下污染区域');
 assert.equal(zone.radius,2);assert.equal(zone.values.damage,50);assert.equal(zone.values.damageType,'true');
 assert.equal(zone.interval,1,'死亡圈按原表每秒结算一次');
 u.maxHp=999999;u.hp=999999;
 const hp=u.hp;
 b.s.time+=1.1;b.tickEnemyGroundZones();
 assert.equal(u.hp,hp-50,'1.1 秒里结算一拍，一拍是原表的 50 点');
 b.s.time+=1;b.tickEnemyGroundZones();
 assert.equal(u.hp,hp-100,'再过一秒又一拍');
 // 同一地点再死一只只刷新同一片区域，不叠第二圈（否则加成混合下就是一地粉红）
 const again=spawnEnemy(b,'enemy_1267_nhpbr',u.x,u.y+1);
 b.resolveEnemyDeath(again);
 assert.equal(zones(b).length,1,'同一地点重复死亡只保留一圈');
});

test('污染死亡圈无人时生成，后来进入的不可选迷彩飞行单位受伤，圆形角落不误命中',()=>{
 const b=liveBattle(),u=b.s.units[0];u.x=0;u.y=0;applyStatus(u,'disarm',60);b.s.queue.push({id:'enemy_1007_slime',route:0,at:100});
 const e=spawnEnemy(b,'enemy_1267_nhpbr',3,3);commitExit(b,{target:e});assert.equal(zones(b).length,1);
 const advance=n=>{for(let i=0;i<Math.round(n*30);i++)b.step();};advance(1.1);
 u.x=5;u.y=5;let hp=u.hp;advance(1);assert.equal(u.hp,hp,'方形角落在半径2的圆形外');
 u.x=4;u.y=3;u.targetable=false;u.flying=true;applyStatus(u,'camouflage',30);b.map=structuredClone(b.map);b.map.grid[3][4].heightType='LOWLAND';hp=u.hp;advance(1);assert.equal(hp-u.hp,50);
 b.map.grid[3][4].heightType='HIGHLAND';hp=u.hp;advance(1);assert.equal(hp-u.hp,25);
 advance(5);hp=u.hp;advance(1);assert.equal(u.hp,hp,'区域到期后停止伤害');
});

test('枯朽战士两型沉默死亡不留污染，坠落仍留，漏怪不留',()=>{
 for(const id of ['enemy_1267_nhpbr','enemy_1267_nhpbr_2']){
  const b=liveBattle(),e=spawnEnemy(b,id,3,3);applyStatus(e,'silence',10);commitExit(b,{target:e});assert.equal(zones(b).length,0);
  const fall=spawnEnemy(b,id,3,3);commitExit(b,{target:fall,reason:'fall'});assert.equal(zones(b).length,1);b.s.logicEffects=[];
  const leak=spawnEnemy(b,id,3,3);commitExit(b,{target:leak,reason:'leak'});assert.equal(zones(b).length,0);
 }
});

test('错相重叠的多个死亡圈对同一个干员只结算最高的一层（不因层叠翻倍）',()=>{
 const b=liveBattle(),u=b.s.units[0];
 u.maxHp=999999;u.hp=999999;
 // 两圈圆心不重合、创建时刻相差 0.25 秒，结算相位因此错开，必须靠时间窗去重。
 const first=spawnEnemy(b,'enemy_1267_nhpbr',u.x,u.y+1);
 b.resolveEnemyDeath(first);
 b.s.time+=0.25;
 const second=spawnEnemy(b,'enemy_1267_nhpbr',u.x+1,u.y);
 b.resolveEnemyDeath(second);
 assert.equal(zones(b).length,2,'两处不同位置的死亡各留一圈');
 // 从首个结算点起跨 3 秒：每 1 秒只有一圈生效，共 3 拍；若层数直接相加会是 5 拍 250。
 const start=b.s.time+1,hp=u.hp;
 b.s.time=start+2.1;b.tickEnemyGroundZones();
 assert.equal(hp-u.hp,150,'重叠层只按最高的一层结算');
 // 伤害更高的一层在同一时间窗内只补差额，不会因为是后到的就被整个吞掉。
 b.s.logicEffects=[];b.zoneHitWindow.clear();
 const src=spawnEnemy(b,'enemy_1272_nhtank',u.x+1,u.y+1);
 b.addEnemyGroundZone(src,{radius:2,interval:1,duration:5,damage:50,damageType:'true'},{x:u.x,y:u.y});
 b.s.time+=0.2;
 b.addEnemyGroundZone(src,{radius:2,interval:1,duration:5,damage:150,damageType:'true'},{x:u.x,y:u.y});
 const hp2=u.hp;b.s.time+=1;b.tickEnemyGroundZones();
 assert.equal(hp2-u.hp,150,'同一窗内 50 + 更高的 150 只补 100');
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
 assert.equal(zone.radius,0.8);assert.equal(zone.values.damage,0);assert.equal(zone.values.atkScale,0.15);
 assert.equal(zone.values.damageType,'arts');
 assert.equal(zone.interval,1,'毒雾按原表每秒结算一次');
 // 产生者已经死了，攻击力必须留档在区域上，否则「攻击力的 15%」会算成 0。
 assert.equal(zone.sourceAtk,enemy.atk,'毒雾记下产生者死亡时的攻击力');
 assert.ok(zone.sourceAtk>0);
 // 真正死亡时敌人会从场上移除，圈必须只靠留档的攻击力继续结算。
 b.s.enemies=b.s.enemies.filter(x=>x!==enemy);
 const hp=u.hp;
 b.s.time+=1.1;b.tickEnemyGroundZones();
 const one=hp-u.hp;assert.ok(one>0,'产生者离场后毒雾仍然结算');
 b.s.time+=1;b.tickEnemyGroundZones();
 assert.equal(u.hp,hp-one*2,'每秒一跳，数值与首跳相同');
});

test('毒雾走真实死亡入口时也留档产生者攻击力，并落在击杀者所在格',()=>{
 const b=liveBattle(),u=b.s.units[0];
 u.maxHp=999999;u.hp=999999;
 const enemy=spawnEnemy(b,'enemy_9006_actoxi',u.x,u.y+1);
 commitExit(b,{target:enemy,reason:'knockdown',killer:u}); // 真实死亡入口：击杀者是我们的干员
 const zone=zones(b)[0];
 assert.ok(zone,'真实死亡路径也要留下毒雾');
 assert.equal(zone.x,u.x);assert.equal(zone.y,u.y,'毒雾落在击杀者所在格');
 assert.equal(zone.sourceAtk,enemy.atk,'建圈时就记下产生者攻击力');
 b.s.enemies=b.s.enemies.filter(x=>x!==enemy); // 敌人已从场上移除
 const hp=u.hp;
 b.s.time+=1.1;b.tickEnemyGroundZones();
 assert.ok(hp-u.hp>0,'产生者离场后仍按留档的攻击力结算');
});

test('毒雾伤害跟随产生者的攻击力：同一种敌人攻击力翻倍，圈里每秒掉的血也翻倍',()=>{
 const perTick=atk=>{
  const b=liveBattle(),u=b.s.units[0];
  u.maxHp=999999;u.hp=999999;
  const enemy=spawnEnemy(b,'enemy_9006_actoxi',u.x,u.y+1);
  enemy.atk=atk; // 战斗中的实际攻击力（含词条与加成）
  b.resolveEnemyDeath(enemy,u);
  b.s.enemies=b.s.enemies.filter(x=>x!==enemy); // 敌人已离场，只剩圈
  const zone=zones(b)[0];
  const hp=u.hp;
  b.s.time+=1.1;b.tickEnemyGroundZones();
  return {zone,dealt:hp-u.hp};
 };
 const weak=perTick(200),strong=perTick(400);
 assert.equal(weak.zone.sourceAtk,200);
 assert.equal(strong.zone.sourceAtk,400);
 assert.ok(weak.dealt>0);
 assert.ok(Math.abs(strong.dealt-weak.dealt*2)<1,`攻击力 400 的毒雾应当约为 200 的两倍（${strong.dealt} vs ${weak.dealt}）`);
});

// 这条走**真实 step()**：通用周期调度（native-effects.tickLogic）不能把 kind:'field' 的 nextAt 吃掉。
// 以前 tickLogic 会先把 field 排到 due 并推进 nextAt（settlePeriodic 没有 field 分支，什么都不做），
// 于是 native-battle.tickEnemyGroundZones 永远看不到到期的圈——表现就是圈画得出来、一点血都不掉。
// 旧的用例都直接调 tickEnemyGroundZones，所以全绿却没挡住这个 bug；这里必须经过 step()。
test('敌方地面区域在真实 step() 里也会结算（死亡圈与开火燃烧区）',()=>{
 const b=liveBattle(),u=b.s.units[0];
 u.maxHp=999999;u.hp=999999;
 // 留一只不参与战斗的木桩，避免清场把战斗提前结束
 b.s.enemies.push({uid:999999,id:'probe',name:'probe',x:-8,y:-8,hp:1e12,maxHp:1e12,atk:0,def:0,res:0,statuses:[],hidden:true,invulnerable:true,untargetable:true,block:null,leak:0,interval:1,attackSpeed:100,attackCooldown:0,action:null,flying:false,trainingDummy:true,canAttack:false,speed:0,route:null,cmd:0,deployed:true,progress:0});
 b.step();
 // ① 死亡圈（固定伤害）：真实死亡入口建圈，然后只走 step()
 const die=spawnEnemy(b,'enemy_1267_nhpbr',u.x+1,u.y);die.speed=0;
 commitExit(b,{target:die,reason:'knockdown',killer:u});
 assert.equal(zones(b).length,1,'击倒后留圈');
 const hp0=u.hp;
 for(let i=0;i<95;i++)b.step();
 assert.equal(hp0-u.hp,150,'3 秒里每秒 50 点，一拍都不能少');
 // ② 开火燃烧区：同一条 field 通道，同样必须由 step() 结算
 b.s.logicEffects=[];
 const arty=spawnEnemy(b,'enemy_10122_uacann_2',u.x,u.y+1);arty.speed=0;arty.canAttack=false;
 b.resolveEnemyStrike(arty,u,{});
 assert.equal(zones(b).length,1,'开火后留燃烧区');
 const hp1=u.hp;
 for(let i=0;i<35;i++)b.step();
 assert.ok(hp1-u.hp>=150,`燃烧区在真实循环里也要结算，实际掉 ${Math.round(hp1-u.hp)}`);
});
