import test from 'node:test';import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';
import {NativeBattle} from '../dist/native-battle.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {dealDamage,applyLoss,commitExit,addDamageRedirect,grantGuard,grantShield,applyHeal,revealEnemy,enemyWineBuffs} from '../dist/native-effects.js';
import {applyStatus,isIsolated} from '../dist/status.js';

function arena(){
 const g=new NativeSession(NATIVE_DATA,{seed:42});g.s.funds=100;assert.ok(g.perform('buy',0));const unit=g.s.units[0];let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(unit.uid,x,y))placed=g.deploy(unit.uid,x,y,0);
 assert.ok(placed);assert.ok(g.perform('start'));const b=g.battle,ally=b.s.units[0];b.s.units=[];b.s.enemies=[];b.s.queue=[];b.s.limit=1000;
 return {b,ally};
}
function spawn(b,id,x=3,y=3){const raw=NATIVE_DATA.enemies[id],o=b.map.origin,p={col:o.col+x,row:o.row-y};b.level={...b.level,routes:[{motionMode:raw.motion,startPosition:p,endPosition:p,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...b.level.enemyProfiles,[id]:raw}};b.spawn({id,route:0});return b.s.enemies.at(-1);}
function advance(b,seconds){for(let i=0;i<Math.round(seconds*30);i++)b.step();}
function addAlly(b,u,x,y){u.x=x;u.y=y;u.hp=u.maxHp;u.deployed=true;applyStatus(u,'disarm',600);b.s.units.push(u);}

test('寻仇者半血及以下增攻，治疗跨线即时恢复，反复跨线不叠加且不受沉默影响',()=>{
 const {b}=arena(),e=spawn(b,'enemy_1025_reveng');const atk=e.baseAtk;
 e.hp=e.maxHp*.5;b.step();assert.equal(e.atk,atk*2);applyStatus(e,'silence',60);b.step();assert.equal(e.atk,atk*2);
 e.hp=e.maxHp*.5+1;b.step();assert.equal(e.atk,atk);e.hp=e.maxHp*.4;b.step();assert.equal(e.atk,atk*2);advance(b,1);assert.equal(e.atk,atk*2);
 const restored=NativeBattle.restore(NATIVE_DATA,b.economy,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);const r=restored.s.enemies[0];r.hp=r.maxHp;restored.step();assert.equal(r.atk,atk);
});

test('两种圆仔均不攻击/不可阻挡，按左右干员人数转向，忽略可选性且并列维持方向',()=>{
 for(const id of ['enemy_2085_skzjxd','enemy_2085_skzjxd_2']){
  const {b,ally}=arena(),e=spawn(b,id);addAlly(b,ally,4,3);b.step();assert.equal(e.facingX,1);assert.equal(e.unblockable,true);assert.equal(e.canAttack,false);
  const left=structuredClone(ally),hidden=structuredClone(ally);left.uid+=100;left.x=2;hidden.uid+=101;hidden.x=1;hidden.untargetable=true;hidden.hidden=true;b.s.units.push(left,hidden);b.step();assert.equal(e.facingX,-1);
  hidden.deployed=false;hidden.deployAt=Infinity;b.step();assert.equal(e.facingX,-1);left.deployed=false;left.deployAt=Infinity;b.step();assert.equal(e.facingX,1);
  ally.x=e.x;ally.y=e.y;b.step();assert.equal(e.block,null);assert.equal(e.attackCount,0);
 }
});

test('圆仔正面物理/法术与DOT减伤，背面、真实、元素及无来源伤害不误减',()=>{
 const {b,ally}=arena(),e=spawn(b,'enemy_2085_skzjxd');addAlly(b,ally,4,3);b.step();
 const hit=(source,type,cause='attack',amount=false)=>dealDamage(b,{source,target:e,...(amount?{amount:100}:{value:100}),type,cause}).total;
 for(const type of ['physical','arts'])assert.ok(Math.abs(hit(ally,type)-20)<1e-8);
 assert.ok(Math.abs(hit(ally,'arts','dot',true)-10)<1e-8,'先计算50法抗，再按正面乘0.2');
 for(const type of ['true','elemental'])assert.equal(hit(ally,type),100);
 assert.equal(hit(null,'physical'),100);ally.x=2;assert.equal(hit(ally,'physical'),100,'命中按来源当前所在侧判断');
});

test('圆仔朝向与倒走炫耀计时随JSON保留，演出不产生伤害或技能消耗',()=>{
 const {b,ally}=arena(),e=spawn(b,'enemy_2085_skzjxd');addAlly(b,ally,4,3);e.route=[{kind:'move',x:3,y:3},{kind:'move',x:-100,y:3}];e.cmd=0;b.step();
 assert.equal(e.facingX,1);assert.equal(e.walkingBackward,true);assert.ok(e.nextShowAt>29);
 const restored=NativeBattle.restore(NATIVE_DATA,b.economy,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);const copy=restored.s.enemies[0];assert.equal(copy.facingX,1);assert.equal(copy.nextShowAt,e.nextShowAt);
 const shows=[],emit=restored.emit.bind(restored);restored.emit=(kind,row)=>{if(row.form==='炫耀')shows.push(row);emit(kind,row);};advance(restored,30.1);
 assert.equal(shows.length,1);assert.equal(copy.attackCount,0);assert.equal(copy.enemySkills.find(s=>s.prefab==='Show').used,false);
 restored.s.units[0].x=-200;restored.step();assert.equal(copy.facingX,-1);assert.equal(copy.walkingBackward,false);assert.equal(copy.nextShowAt,null);
});

test('祭司学徒死亡治疗按当前攻击力与原表倍率结算，圆形范围含飞行敌人、不治疗我方或消失目标',()=>{
 const {b,ally}=arena();addAlly(b,ally,3,3);ally.hp-=100;const alliedHp=ally.hp,source=spawn(b,'enemy_10156_mncrer');source.atk=200;
 const ground=spawn(b,'enemy_1025_reveng',4,3),air=spawn(b,'enemy_1005_yokai',3,4),far=spawn(b,'enemy_1025_reveng',4,4),hidden=spawn(b,'enemy_1025_reveng',3,3);
 for(const e of [ground,air,far,hidden]){e.maxHp=e.hp=5000;e.hp-=2000;}hidden.hidden=true;
 commitExit(b,{target:source,reason:'knockdown'});
 assert.equal(ground.hp,4000);assert.equal(air.hp,4000);assert.equal(far.hp,3000);assert.equal(hidden.hp,3000);assert.equal(ally.hp,alliedHp);
 assert.equal(source.healing,2000);assert.equal(commitExit(b,{target:source}),false);assert.equal(ground.hp,4000);
});

test('祭司死亡治疗受沉默/禁疗限制，漏怪不触发，坠落仍触发且不超过生命上限',()=>{
 for(const mode of ['silence','blocked','leak','fall']){
  const {b}=arena(),source=spawn(b,'enemy_10156_mncrer'),target=spawn(b,'enemy_1025_reveng',4,3);source.atk=100;target.hp=target.maxHp-100;
  if(mode==='silence')applyStatus(source,'silence',60);if(mode==='blocked')applyStatus(target,'healingBlocked',60);
  const hp=target.hp;commitExit(b,{target:source,reason:mode==='leak'||mode==='fall'?mode:'knockdown'});
  assert.equal(target.hp,mode==='fall'?target.maxHp:hp,mode);
 }
});

test('真实step持续伤害击倒祭司也治疗一次，攻击弱化同步降低死亡治疗量',()=>{
 const {b}=arena(),source=spawn(b,'enemy_10156_mncrer'),target=spawn(b,'enemy_1025_reveng',4,3);source.atk=100;source.hp=1;target.hp=target.maxHp-1000;const hp=target.hp;
 applyStatus(source,'attackDown',60,{value:-.5});
 b.s.logicEffects.push({id:b.s.settle.nextEffectId++,kind:'dot',sourceUid:null,targetUid:source.uid,interval:1,nextAt:b.s.time+1,endsAt:b.s.time+2,values:{damage:10,type:'true'},snapshot:{damage:10},refKind:'owner',persistAfterSourceGone:true});
 advance(b,1.1);assert.equal(source.hp,0);assert.equal(target.hp,hp+250);advance(b,1);assert.equal(target.hp,hp+250);
});

test('两种孽生者待命不普攻，受伤后五倍移速且只跳过当前停驻，重复受伤不重复加速',()=>{
 for(const id of ['enemy_1439_dslntf','enemy_1439_dslntf_2']){
  const {b}=arena(),e=spawn(b,id);b.step();assert.equal(e.canAttack,false);assert.equal(e.neuroCombat,false);assert.equal(e.route[e.cmd].kind,'wait');const cmd=e.cmd,speed=e.speed;
  dealDamage(b,{target:e,value:1,type:'true'});assert.equal(e.neuroCombat,true);assert.equal(e.canAttack,true);assert.equal(e.speed,speed*5);assert.equal(e.cmd,cmd+1);assert.equal(e.cmdLeft,null);
  dealDamage(b,{target:e,value:1,type:'true'});assert.equal(e.speed,speed*5);assert.equal(e.cmd,cmd+1);
 }
});

test('护盾抵消/治疗/生命流失不误触发临战，真实step的DOT伤害会触发',()=>{
 const {b}=arena(),e=spawn(b,'enemy_1439_dslntf');grantGuard(b,e,{charges:1,types:['physical'],id:'test-neuro'});
 dealDamage(b,{target:e,value:100,type:'physical'});assert.equal(e.neuroCombat,false);
 applyLoss(b,{target:e,amount:10});assert.equal(e.neuroCombat,false);applyHeal(b,{source:e,target:e,amount:5});assert.equal(e.neuroCombat,false);
 b.s.logicEffects.push({id:b.s.settle.nextEffectId++,kind:'dot',sourceUid:null,targetUid:e.uid,interval:1,nextAt:b.s.time+1,endsAt:b.s.time+2,values:{damage:1,type:'true'},snapshot:{damage:1},refKind:'owner',persistAfterSourceGone:true});
 advance(b,1.1);assert.equal(e.neuroCombat,true);assert.equal(e.speed,e.baseSpeed*5);
});

test('孽生者神经毒素用本期5%/10%倍率与圆形范围，同名取最高，无视迷彩和不可选',()=>{
 const {b,ally}=arena(),normal=spawn(b,'enemy_1439_dslntf'),elite=spawn(b,'enemy_1439_dslntf_2');normal.atk=elite.atk=100;
 addAlly(b,ally,4,3);applyStatus(ally,'camouflage',60);ally.untargetable=true;const far=structuredClone(ally);far.uid+=100;far.x=5;far.y=5;b.s.units.push(far);
 advance(b,.5);assert.equal(ally.elemental?.neural||0,0);dealDamage(b,{target:normal,value:1,type:'true'});dealDamage(b,{target:elite,value:1,type:'true'});
 // 测试保持两名来源静止，让圈内/圈外断言只取决于半径和叠加规则。
 normal.route=elite.route=[{kind:'wait',time:600}];normal.cmd=elite.cmd=0;normal.cmdLeft=elite.cmdLeft=null;
 advance(b,1.1);assert.equal(ally.elemental.neural,10);assert.equal(far.elemental?.neural||0,0);
 commitExit(b,{target:elite});advance(b,1);assert.equal(ally.elemental.neural,15);commitExit(b,{target:normal});b.step();assert.equal(ally.neurotoxinNextAt,null);
});

test('临战与目标毒素计时跨JSON继续，控制不额外关闭天赋，离开范围清理定时',()=>{
 const {b,ally}=arena(),e=spawn(b,'enemy_1439_dslntf');e.atk=100;addAlly(b,ally,4,3);dealDamage(b,{target:e,value:1,type:'true'});applyStatus(e,'stun',60);advance(b,.6);
 const restored=NativeBattle.restore(NATIVE_DATA,b.economy,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);const source=restored.s.enemies[0],target=restored.s.units[0];assert.equal(source.neuroCombat,true);assert.equal(source.speed,source.baseSpeed*5);
 advance(restored,.5);assert.equal(target.elemental.neural,5);target.x=9;restored.step();assert.equal(target.neurotoxinNextAt,null);advance(restored,1);assert.equal(target.elemental.neural,5);
});

test('竞演者与爵士的隐匿孤立阻止同阵营治疗，阻挡和反隐立即解除，恢复隐匿后再生效',()=>{
 for(const id of ['enemy_10031_cnvsld','enemy_10034_cnvsax']){
  const {b,ally}=arena(),e=spawn(b,id),healer=spawn(b,'enemy_1007_slime',7,3);e.hp-=1000;assert.equal(isIsolated(e),true);assert.equal(applyHeal(b,{source:healer,target:e,amount:10}),0);
  b.map=structuredClone(b.map);b.map.grid[3][3].heightType='LOWLAND';addAlly(b,ally,3,3);advance(b,.1);assert.equal(e.block,ally.uid);assert.equal(isIsolated(e),false);assert.equal(applyHeal(b,{source:healer,target:e,amount:10}),10);
  ally.x=8;advance(b,.1);assert.equal(isIsolated(e),true);revealEnemy(b,e,1);advance(b,.1);assert.equal(isIsolated(e),false);assert.equal(applyHeal(b,{source:healer,target:e,amount:10}),10);advance(b,1.1);assert.equal(isIsolated(e),true);
 }
});

test('孤立排除普通友方光环，但不变成对立阵营伤害免疫，不影响明确忽略孤立的品尝区域',()=>{
 const {b,ally}=arena(),e=spawn(b,'enemy_10031_cnvsld');spawn(b,'enemy_1017_defdrn',4,3);addAlly(b,ally,6,3);b.step();assert.equal(e.def,e.baseDef);assert.equal(isIsolated(e),true);
 assert.equal(dealDamage(b,{source:ally,target:e,value:10,type:'arts',cause:'dot'}).total,10);
 b.s.logicEffects.push({id:b.s.settle.nextEffectId++,kind:'zone',sourceUid:null,x:3,y:3,radius:2,endsAt:b.s.time+10,values:{enemyWineBuff:true,attackSpeed:100,physicalDodge:.8},refKind:'owner'});
 assert.deepEqual(enemyWineBuffs(b,e),{attackSpeed:100,physicalDodge:.8});revealEnemy(b,e,1);advance(b,.1);assert.equal(e.def,e.baseDef+300);
});

test('孤立竞演者不被同阵营载具装载，反隐解除孤立后恢复装载资格',()=>{
 const {b}=arena(),e=spawn(b,'enemy_10031_cnvsld'),carrier=spawn(b,'enemy_10159_mntrjn');b.step();assert.equal(e.carriedBy,undefined);assert.equal(carrier.transport.passengers.length,0);
 revealEnemy(b,e,2);advance(b,.1);assert.equal(e.carriedBy,carrier.uid);assert.deepEqual(carrier.transport.passengers,[e.uid]);
});

test('敌方泥岩本期5500屏障只吸收法术，物理/真实/元素伤害不消耗，并有沉睡免疫',()=>{
 const {b}=arena(),e=spawn(b,'enemy_1511_mdrock');assert.equal(e.shield,5500);assert.deepEqual(e.shieldLayers[0].types,['arts']);assert.equal(e.maxHp,e.baseMaxHp*1.5);assert.equal(applyStatus(e,'sleep',5),false);
 const hp=e.hp;for(const type of ['physical','true','elemental'])dealDamage(b,{target:e,value:100,type});assert.equal(e.shield,5500);assert.equal(e.hp,hp-300);
 dealDamage(b,{target:e,value:100,type:'arts'});assert.equal(e.shield,5400);assert.equal(e.hp,hp-300);
});

test('泥岩破盾移除生命上限增益，17秒刷新恢复，重复刷新替换而不叠屏障或生命',()=>{
 const {b}=arena(),e=spawn(b,'enemy_1511_mdrock');e.hp=e.maxHp*.5;dealDamage(b,{target:e,value:5500,type:'arts'});assert.equal(e.shield,0);assert.equal(e.maxHp,e.baseMaxHp);assert.equal(e.hp,e.maxHp*.5);
 advance(b,16.9);assert.equal(e.shield,0);advance(b,.1);assert.equal(e.shield,5500);assert.equal(e.maxHp,e.baseMaxHp*1.5);assert.equal(e.hp,e.maxHp*.5);
 const max=e.maxHp,hp=e.hp;advance(b,17);assert.equal(e.shield,5500);assert.equal(e.shieldLayers.filter(l=>l.id==='mudrock-arts').length,1);assert.equal(e.maxHp,max);assert.equal(e.hp,hp);
});

test('泥岩增益只认自身法术屏障，其他屏障不延续增益，读档不再乘一次生命上限',()=>{
 const {b}=arena(),e=spawn(b,'enemy_1511_mdrock');grantShield(b,e,{id:'other',amount:100});dealDamage(b,{target:e,value:5500,type:'arts'});assert.equal(e.shield,100);assert.equal(e.maxHp,e.baseMaxHp);
 advance(b,17);dealDamage(b,{target:e,value:1000,type:'arts'});const restored=NativeBattle.restore(NATIVE_DATA,b.economy,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);const copy=restored.s.enemies[0];assert.equal(copy.maxHp,e.maxHp);assert.equal(copy.hp,e.hp);assert.equal(copy.shield,e.shield);assert.deepEqual(copy.shieldLayers.find(l=>l.id==='mudrock-arts').types,['arts']);
});

test('骑士同伴死亡或漏怪均狂暴且只加一次，不发生误推导的自身死亡爆炸',()=>{
 for(const [id,partner]of [['enemy_1513_dekght','enemy_1513_dekght_2'],['enemy_1513_dekght_2','enemy_1513_dekght']])for(const reason of ['knockdown','leak']){
  const {b,ally}=arena();addAlly(b,ally,3,3);const e=spawn(b,id),other=spawn(b,partner),hp=ally.hp;
  assert.equal(e.deathExplosion,null);assert.equal(other.deathExplosion,null);commitExit(b,{target:other,reason});assert.equal(e.knightRage,true);assert.equal(e.speed,e.baseSpeed*2.5);assert.equal(ally.hp,hp,'伙伴退场不是死亡炸弹');
  commitExit(b,{target:other,reason});assert.equal(e.speed,e.baseSpeed*2.5);
  const restored=NativeBattle.restore(NATIVE_DATA,b.economy,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);assert.equal(restored.s.enemies.find(x=>x.uid===e.uid).knightRage,true);
 }
});

test('折射被沉默取消法抗，解除沉默后恢复，连续帧不重复叠加',()=>{
 const {b}=arena(),e=spawn(b,'enemy_1166_dusbr');assert.equal(e.res,e.baseRes+70);
 advance(b,1);assert.equal(e.res,e.baseRes+70);applyStatus(e,'silence',1);b.step();assert.equal(e.res,e.baseRes);
 advance(b,1);assert.equal(e.res,e.baseRes+70);
});
test('镜膜初始双倍生命，沉默永久移除生命加成但法抗可恢复',()=>{
 const {b}=arena(),e=spawn(b,'enemy_9011_acrefr'),hp=e.baseMaxHp;
 assert.equal(e.maxHp,hp*2);applyStatus(e,'silence',1);b.step();assert.equal(e.maxHp,hp);assert.equal(e.res,e.baseRes);
 advance(b,1);assert.equal(e.maxHp,hp);assert.equal(e.res,e.baseRes+70);
});
test('护障/御4不重复叠加，圆形范围与沉默生效；方阵只对同族逐个叠防',()=>{
 const {b}=arena(),target=spawn(b,'enemy_1007_slime',3,3),far=spawn(b,'enemy_1007_slime',5,5);
 const guards=[spawn(b,'enemy_1017_defdrn',3,3),spawn(b,'enemy_1017_defdrn',3,3)];
 const barriers=[spawn(b,'enemy_1355_mrfly',3,3),spawn(b,'enemy_1355_mrfly_2',3,3)];
 b.step();assert.equal(target.def,target.baseDef+300);assert.equal(target.res,target.baseRes+30);assert.equal(far.def,far.baseDef);assert.equal(far.res,far.baseRes);
 for(const e of [...guards,...barriers])applyStatus(e,'silence',5);b.step();assert.equal(target.def,target.baseDef);assert.equal(target.res,target.baseRes);
 const a=spawn(b,'enemy_1169_duphlx',3,3),c=spawn(b,'enemy_1169_duphlx_2',3,3),d=spawn(b,'enemy_1169_duphlx',3,3);
 b.step();assert.equal(a.def,a.baseDef+400);assert.equal(c.def,c.baseDef+400);assert.equal(target.def,target.baseDef);
 applyStatus(a,'silence',5);b.step();assert.equal(d.def,d.baseDef+400,'方阵互助不是可沉默天赋');
});
test('防卫科的一层次数护盾只抵挡物理/法术，真实伤害不消耗',()=>{
 const {b}=arena(),e=spawn(b,'enemy_1249_lysdb_2'),hp=e.hp;
 dealDamage(b,{target:e,value:5,type:'true'});assert.equal(e.hp,hp-5);assert.equal(e.barriers[0].charges,1);
 dealDamage(b,{target:e,value:100,type:'arts'});assert.equal(e.hp,hp-5);assert.equal(e.barriers[0]?.charges||0,0);
 dealDamage(b,{target:e,value:7,type:'physical'});assert.equal(e.hp,hp-12);
});
test('弧光镜卫受伤后才降低双抗，第二层起生效，状态跨帧保留且层数封顶',()=>{
 const {b}=arena(),e=spawn(b,'enemy_1329_cbshld');const def=e.def,res=e.res;
 dealDamage(b,{target:e,value:1});assert.equal(e.def,def);
 dealDamage(b,{target:e,value:1});assert.equal(e.def,def-100);assert.equal(e.res,res-4);
 b.step();assert.equal(e.def,def-100);for(let i=0;i<100;i++)dealDamage(b,{target:e,value:1});assert.equal(e.armorLossStacks,80);assert.equal(e.def,0);
});
test('重犯在第四次攻击前解放全场囚犯，取消禁锢属性并启用各自增益',()=>{
 const {b,ally}=arena();let spot;
 for(let y=0;y<b.map.rows&&!spot;y++)for(let x=0;x<b.map.cols&&!spot;x++)if(b.map.grid[y][x].heightType==='LOWLAND'&&b.tileWalkable(x,y))spot={x,y};
 assert.ok(spot);addAlly(b,ally,spot.x,spot.y);
 const boss=spawn(b,'enemy_1121_lifbos',spot.x,spot.y),strong=spawn(b,'enemy_1119_vofsd',spot.x+3,spot.y),boxer=spawn(b,'enemy_1118_lidbox_2',spot.x+3,spot.y);
 boss.atk=boss.baseAtk=1;strong.canAttack=false;boxer.canAttack=false;
 const strikes=[],hurt=b.hurt.bind(b);b.hurt=(u,e)=>{strikes.push({released:e.prisonReleased,atk:e.atk});hurt(u,e);};
 advance(b,19);assert.ok(strikes.length>=4);assert.equal(strikes[2].released,false);assert.equal(strikes[3].released,true);assert.equal(strikes[3].atk,1.5);
 assert.equal(boss.def,boss.baseDef);assert.equal(strong.prisonReleased,true);assert.equal(strong.res,strong.baseRes+40);assert.equal(boxer.enemyDefPenetration,.8);
 strong.hp-=300;advance(b,1);assert.ok(Math.abs(strong.hp-(strong.maxHp-150))<1e-6);
});
test('狂暴宿主持续失血，鸭爵受伤加速，隐形弩手出生带隐匿',()=>{
 const {b}=arena(),rager=spawn(b,'enemy_1062_rager_2'),duck=spawn(b,'enemy_2001_duckmi'),hidden=spawn(b,'enemy_1019_jshoot');const hp=rager.hp;
 assert.equal(hidden.formInvisible,true);advance(b,1);assert.equal(rager.hp,hp-500);
 dealDamage(b,{target:duck,value:1});assert.equal(duck.speed,duck.baseSpeed*5);
});
test('巢涌者与鼎沸真实step造成法术伤害和元素损伤，不额外普通攻击且免疫停顿',()=>{
 for(const [id,type]of [['enemy_1234_dsubrl','neural'],['enemy_10054_cjhot','burn']]){
  const {b,ally}=arena();addAlly(b,ally,3,3);const e=spawn(b,id,3,3);e.atk=100;const hp=ally.hp;
  assert.equal(e.canAttack,false);assert.equal(applyStatus(e,'sluggish',5),false);advance(b,1.1);
  assert.ok(ally.hp<hp,id+'必须在真实step内结算法术场');assert.ok(ally.elemental?.[type]>0);assert.equal(e.attackCount,0);
 }
});

test('逐腐兽流血重复命中刷新同一效果且不能致死',()=>{
 const {b,ally}=arena();addAlly(b,ally,3,3);const e=spawn(b,'enemy_1270_nhstlk',5,3);e.canAttack=false;
 ally.hp=20;b.applyEnemyBleeding(e,ally);advance(b,.5);b.applyEnemyBleeding(e,ally);
 assert.equal(b.s.logicEffects.filter(f=>f.kind==='dot').length,1);advance(b,2);
 assert.equal(ally.hp,1);assert.equal(ally.deployed,true);
});

test('污染死亡圈使用原表低地50/高地25伤害，常驻场存档可以恢复',()=>{
 const {b,ally}=arena();b.map=structuredClone(b.map);addAlly(b,ally,3,3);
 const high=structuredClone(ally);high.uid+=100;high.x=4;b.s.units.push(high);
 b.map.grid[3][3].heightType='LOWLAND';b.map.grid[3][4].heightType='HIGHLAND';
 const e=spawn(b,'enemy_1267_nhpbr',3,3);spawn(b,'enemy_1234_dsubrl',8,3);
 const lowHp=ally.hp,highHp=high.hp;commitExit(b,{target:e});advance(b,1.1);
 assert.equal(lowHp-ally.hp,50);assert.equal(highHp-high.hp,25);
 assert.ok(NativeBattle.restore(NATIVE_DATA,b.economy,b.map,b.turn,JSON.parse(JSON.stringify(b.s))));
});

test('死亡之眼终结凋亡仅覆盖目标和相邻四格，不波及对角',()=>{
 const {b,ally}=arena();addAlly(b,ally,3,3);
 const neighbor=structuredClone(ally);neighbor.uid+=100;neighbor.x=4;
 const diagonal=structuredClone(ally);diagonal.uid+=200;diagonal.x=4;diagonal.y=4;b.s.units.push(neighbor,diagonal);
 const e=spawn(b,'enemy_1275_dwlock_2',5,3);e.canAttack=false;e.atk=10;
 b.startEnemyDeathEye(e,ally);advance(b,8.1);
 assert.ok(ally.elemental.necrosis>0);assert.ok(neighbor.elemental.necrosis>0);assert.equal(diagonal.elemental?.necrosis||0,0);
});

test('拷打者周围敌人因持续流失退场时治疗并叠攻，同一次退场不重复触发',()=>{
 const {b}=arena(),e=spawn(b,'enemy_1364_spnaxe_2'),victim=spawn(b,'enemy_1007_slime',3,4);
 const base=e.atk;e.hp=e.maxHp*.5;applyLoss(b,{target:victim,amount:victim.hp});
 assert.equal(e.deathGrowthStacks,1);assert.equal(e.atk,base*1.1);assert.equal(e.hp,e.maxHp*.65);
 commitExit(b,{target:victim});assert.equal(e.deathGrowthStacks,1);
 const far=spawn(b,'enemy_1007_slime',5,5);commitExit(b,{target:far});assert.equal(e.deathGrowthStacks,1);
 for(let i=0;i<18;i++)commitExit(b,{target:spawn(b,'enemy_1007_slime',3,4)});
 assert.equal(e.deathGrowthStacks,15);assert.equal(e.atk,base*2.5);
});

test('拷打者响应我方撤退但排除召唤物，击杀当次取得的增攻不会被伤害临时倍率覆盖',()=>{
 const {b,ally}=arena();addAlly(b,ally,3,3);const e=spawn(b,'enemy_1364_spnaxe_2'),base=e.baseAtk;
 const summon={uid:900001,kind:'summon',x:3,y:3,hp:1,maxHp:1,deployed:true};b.s.summons.push(summon);commitExit(b,{target:summon});assert.equal(e.deathGrowthStacks,undefined);
 ally.hp=1;e.block=ally.uid;b.resolveEnemyStrike(e,ally,{});assert.equal(e.deathGrowthStacks,1);assert.equal(e.atk,base*1.1);
 const next=structuredClone(ally);next.uid+=100;next.hp=next.maxHp;next.deployed=true;next.exitLife=null;b.s.units.push(next);
 commitExit(b,{target:next,reason:'retreat'});assert.equal(e.deathGrowthStacks,2);
});

test('清明隐匿为动态圆形光环，沉默不阻止施法，晚进入和离开实时更新',()=>{
 const {b}=arena(),source=spawn(b,'enemy_1209_sfden'),target=spawn(b,'enemy_1007_slime',6,3);
 applyStatus(source,'silence',30);advance(b,5.1);assert.equal(target.invisible,false);
 target.x=4;b.step();assert.equal(target.invisible,true);
 target.x=5;target.y=5;b.step();assert.equal(target.invisible,false,'方形边角在圆形半径2外');
 target.x=4;target.y=3;b.step();assert.equal(target.invisible,true);
 commitExit(b,{target:source});b.step();assert.equal(target.invisible,false,'来源死亡立即失去这一来源的光环');
});

test('重叠隐匿光环分别追踪来源，失去其中一位施法者不会清掉另一位',()=>{
 const {b}=arena(),a=spawn(b,'enemy_1209_sfden'),c=spawn(b,'enemy_1209_sfden'),target=spawn(b,'enemy_1007_slime',4,3);
 advance(b,5.1);assert.equal(target.statuses.filter(s=>s.enemyInvisibleAura).length,2);
 commitExit(b,{target:a});b.step();assert.equal(target.invisible,true);assert.equal(target.statuses.filter(s=>s.enemyInvisibleAura).length,1);
 commitExit(b,{target:c});b.step();assert.equal(target.invisible,false);
});

test('山海众被反隐后仍保留破隐强击，消费一次，反隐期间不会重新取得标记',()=>{
 const {b,ally}=arena();addAlly(b,ally,3,3);const e=spawn(b,'enemy_1299_ymkilr');e.canAttack=false;e.block=ally.uid;
 e.revealed=true;e.revealUntil=100;e.invisible=false;
 const values=[];b.hurt=(_u,source)=>values.push(source.atk);const base=e.atk;
 b.resolveEnemyStrike(e,ally);b.resolveEnemyStrike(e,ally);assert.deepEqual(values,[base*2,base]);
 advance(b,6.1);assert.equal(e.invisibleStrikeReady,false);
 e.x=6;e.block=null;e.revealUntil=null;e.revealed=false;b.step();assert.equal(e.invisibleStrikeReady,true);
});

test('萨科塔之眼夺取弹药时不造成伤害，耗尽触发技能结束，无弹药时正常攻击',()=>{
 const {b,ally}=arena();addAlly(b,ally,3,3);const e=spawn(b,'enemy_10084_hlegle',3,4);e.atk=100;
 ally.ammo=ally.ammoMax=2;ally.skillLeft=0;const hp=ally.hp;
 b.resolveEnemyStrike(e,ally);assert.equal(ally.ammo,1);assert.equal(ally.hp,hp);
 b.resolveEnemyStrike(e,ally);assert.equal(ally.ammo,0);assert.equal(ally.hp,hp);assert.ok(b.s.events.some(x=>x.type==='skill-end'&&x.uid===ally.uid));
 b.resolveEnemyStrike(e,ally);assert.ok(ally.hp<hp);
});

test('清明在消失期间光环到期的PRTS特殊分支：再出现后持续生效，来源死亡仍清除',()=>{
 const {b}=arena(),source=spawn(b,'enemy_1209_sfden'),target=spawn(b,'enemy_1007_slime',4,3);
 advance(b,5.1);assert.equal(target.invisible,true);source.hidden=true;advance(b,5.1);
 assert.equal(target.invisible,false);assert.equal(source.invisibleShieldPermanent,true);
 source.hidden=false;b.step();assert.equal(target.invisible,true);
 commitExit(b,{target:source});b.step();assert.equal(target.invisible,false);
});

test('灼藤50秒蓄满首次增攻，首击九格溅射与25%灼燃，之后恢复单体20%灼燃',()=>{
 const {b,ally}=arena(),e=spawn(b,'enemy_10067_ftsjc'),base=e.baseAtk;e.canAttack=false;advance(b,25);assert.equal(e.atk,base*2);advance(b,25);assert.equal(e.atk,base*3);
 b.map=structuredClone(b.map);b.map.grid[3][3].heightType='LOWLAND';addAlly(b,ally,3,3);const other=structuredClone(ally);other.uid+=100;other.x=4;other.y=4;b.s.units.push(other);
 const stats=b.stats.bind(b);b.stats=u=>({...stats(u),maxHp:1e6});for(const u of b.s.units)u.hp=u.maxHp=1e6;
 const hits=[],hurt=b.hurt.bind(b);b.hurt=(u,source,opts)=>{hits.push([u.uid,source.atk]);hurt(u,source,opts);};e.canAttack=true;
 for(let i=0;i<180&&!e.powSpent;i++)b.step();assert.equal(e.powSpent,true);assert.deepEqual(hits.slice(0,2),[[ally.uid,base*3],[other.uid,base*3]]);
 assert.equal(e.atk,base);assert.equal(e.attackElementScale,.2);assert.equal(e.enemyAttack,null);assert.ok(other.elemental.burn>0);
 hits.length=0;advance(b,5);assert.ok(hits.length>0);assert.ok(hits.every(([uid,atk])=>uid===ally.uid&&atk===base));
});

test('卷心籽只被近距离地面点燃，点燃死亡0.4秒后爆炸，未点燃死亡不炸',()=>{
 const {b,ally}=arena(),fire=spawn(b,'enemy_10067_ftsjc'),seed=spawn(b,'enemy_10065_ftzlc',4,3);fire.canAttack=false;seed.canAttack=false;advance(b,.2);assert.ok(!seed.onFire);
 seed.x=3.4;advance(b,.2);assert.equal(seed.onFire,true);seed.atk=10;addAlly(b,ally,3,3);const hp=ally.hp;
 commitExit(b,{target:seed});assert.equal(b.s.enemyProjectiles.length,1);advance(b,.3);assert.equal(ally.hp,hp);advance(b,.1);assert.ok(ally.hp<hp);
 const cold=spawn(b,'enemy_10065_ftzlc',7,3);commitExit(b,{target:cold});assert.equal(b.s.enemyProjectiles.length,0);
 const air=spawn(b,'enemy_10065_ftzlc',3,3);air.flying=true;air.canAttack=false;advance(b,.3);assert.ok(!air.onFire);
});

test('烹泉/沏虹死亡同时爆炸、减速和解压缩，攻速减益按来源独立叠加并可抵抗',()=>{
 const {b,ally}=arena();addAlly(b,ally,3,3);ally.statusResistance=.5;const other=structuredClone(ally);other.uid+=100;other.x=4;other.statusResistance=0;b.s.units.push(other);
 const a=spawn(b,'enemy_1203_sfhu'),c=spawn(b,'enemy_1203_sfhu_2');a.atk=c.atk=1;const base=b.stats(ally).attackSpeed,hp=ally.hp;
 commitExit(b,{target:a});commitExit(b,{target:c});commitExit(b,{target:a});b.flushEnemySpawns();
 assert.ok(ally.hp<hp);assert.equal(ally.statuses.filter(s=>s.kind==='attackSpeedDown').length,2);assert.equal(b.stats(ally).attackSpeed,Math.max(10,base-90));
 assert.equal(b.s.pendingEnemySpawns.length,8);advance(b,.7);assert.equal(b.s.enemies.filter(e=>e.id==='enemy_1204_msfhu'||e.id==='enemy_1204_msfhu_2').length,8);
 advance(b,7.6);assert.equal(b.stats(ally).attackSpeed,base);assert.equal(other.statuses.filter(s=>s.kind==='attackSpeedDown').length,2);
 advance(b,8);assert.equal(other.statuses.filter(s=>s.kind==='attackSpeedDown').length,0);
});

test('高能源石虫爆炸延迟1秒且不对空，近圈飞行单位不受伤',()=>{
 const {b,ally}=arena();addAlly(b,ally,3,3);const air=structuredClone(ally);air.uid+=100;air.flying=true;b.s.units.push(air);
 const bomb=spawn(b,'enemy_1021_bslime'),keeper=spawn(b,'enemy_1007_slime',8,3);keeper.canAttack=false;bomb.atk=10;
 const hp=ally.hp,airHp=air.hp;commitExit(b,{target:bomb});advance(b,.9);assert.equal(ally.hp,hp);advance(b,.1);
 assert.ok(ally.hp<hp);assert.equal(air.hp,airHp);
});

test('重装侦察兵被默认干员伤害时暴露来源，召唤物/无来源/沉默反例不触发，致命DOT仍触发',()=>{
 const {b,ally}=arena();addAlly(b,ally,3,3);const e=spawn(b,'enemy_1402_tgshd_2',4,3);e.canAttack=false;
 dealDamage(b,{target:e,value:1,type:'true'});assert.equal(ally.statuses.some(s=>s.kind==='exposed'),false);
 dealDamage(b,{source:{uid:900001,kind:'summon',ownerUid:ally.uid,hp:100},target:e,value:1,type:'true'});assert.equal(ally.statuses.some(s=>s.kind==='exposed'),false);
 applyStatus(e,'silence',1);dealDamage(b,{source:ally,target:e,value:1,type:'true'});assert.equal(ally.statuses.some(s=>s.kind==='exposed'),false);
 advance(b,1.1);dealDamage(b,{source:ally,target:e,value:e.hp,type:'true',cause:'dot'});
 const status=ally.statuses.find(s=>s.kind==='exposed');assert.ok(status);assert.equal(status.remaining,5);assert.equal(status.value,1.2);
});

test('远眺死亡在圆形范围内施加8秒暴露，包含不可选单位，沉默可阻断',()=>{
 const {b,ally}=arena();addAlly(b,ally,3,3);const token={uid:900001,kind:'summon',deployed:true,hp:100,x:3,y:4,targetable:false,statuses:[]};b.s.summons.push(token);
 const far=structuredClone(ally);far.uid+=100;far.x=5;far.y=5;b.s.units.push(far);
 const first=spawn(b,'enemy_1407_hummbd');applyStatus(first,'silence',5);commitExit(b,{target:first});assert.equal(ally.statuses.some(s=>s.kind==='exposed'),false);
 const second=spawn(b,'enemy_1407_hummbd');commitExit(b,{target:second});
 assert.equal(ally.statuses.find(s=>s.kind==='exposed').remaining,8);assert.equal(token.statuses.find(s=>s.kind==='exposed').remaining,8);assert.equal(far.statuses.some(s=>s.kind==='exposed'),false);
});

test('暴露对预计算伤害、技能和DOT均增伤20%，同名不叠加，到期恢复',()=>{
 const {b,ally}=arena();addAlly(b,ally,3,3);const keeper=spawn(b,'enemy_1007_slime',8,3);keeper.canAttack=false;
 applyStatus(ally,'exposed',1,{source:1,value:1.2,resistible:false});applyStatus(ally,'exposed',1,{source:2,value:1.2,resistible:false});
 const hp=ally.hp;dealDamage(b,{target:ally,value:100,type:'true',cause:'attack'});dealDamage(b,{target:ally,amount:100,type:'true',cause:'skill'});dealDamage(b,{target:ally,amount:100,type:'true',cause:'dot'});
 assert.equal(hp-ally.hp,360);advance(b,1.1);const before=ally.hp;dealDamage(b,{target:ally,value:100,type:'true'});assert.equal(before-ally.hp,100);
});

test('暴露在延期保护前生效，分摊回原目标不会再次放大',()=>{
 const {b,ally}=arena();addAlly(b,ally,3,3);const other=structuredClone(ally);other.uid+=100;b.s.units.push(other);
 applyStatus(ally,'exposed',30,{source:1,value:1.2,resistible:false});ally.damageProtection={until:99,immediateRatio:.5,buffer:0};let hp=ally.hp;
 dealDamage(b,{target:ally,value:100,type:'true'});assert.equal(hp-ally.hp,60);assert.equal(ally.damageProtection.buffer,60);
 ally.damageProtection=null;addDamageRedirect(b,ally,{targetUid:other.uid,ratio:.5});hp=ally.hp;const otherHp=other.hp;
 dealDamage(b,{target:ally,value:100,type:'true'});assert.equal(hp-ally.hp,60);assert.equal(otherHp-other.hp,60);
});
