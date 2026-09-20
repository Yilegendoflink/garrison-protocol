import test from 'node:test';import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';import {NATIVE_DATA} from '../dist/runtime-data.js';
import {applyDamage} from '../dist/combat.js';
import {applyElementDamage,grantGuard} from '../dist/native-effects.js';
import {enemySprite,FORM_SPRITE_TINTS} from '../dist/protocol.js';
import {FORM_TINT_STYLE,drawEnemyPhase,formTintedImage} from '../dist/native-fx.js';

// 解压缩类敌人（频次词条）第三批：原表 DeadSpawn（死亡后生成碎片）与 Revive[Trigger]（再生），
// 以及碎片依赖的「特殊生命值机制」（血条数值 = 需要击倒的伤害次数）。
// 数值与文案全部来自原表 blackboard 与图鉴 ability 文本，见 DECOMPRESS_ENEMY_PLAN.md。
const profiles=id=>NATIVE_DATA.enemies[id].enemyBehavior;

function liveSession({deploy=true}={}){
 const g=new NativeSession(NATIVE_DATA,{seed:17});
 g.s.funds=100;g.s.rewardPending=null;g.s.rewardQueue=[];
 const unit=g.gain(Object.values(NATIVE_DATA.season.charShopChessDatas).find(s=>s.charId&&!s.isHidden).chessId);
 g.s.rewardPending=null;g.s.rewardQueue=[];
 let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(unit.uid,x,y))placed=g.deploy(unit.uid,x,y,0);
 assert.ok(placed,'干员需要落场');
 assert.ok(g.perform('start'),g.lastError||'开战失败');
 const b=g.battle;b.s.queue=[];b.s.enemies=[];b.s.limit=1e9;
 if(deploy)b.deploy(b.s.units[0]);else{b.s.units[0].deployed=false;b.s.units[0].deployAt=Infinity;b.s.units[0].action=null;}
 return {g,b};
}
function liveBattle(opts){return liveSession(opts).b;}
function spawnEnemy(b,id,x,y){
 const origin=b.map.origin||{col:0,row:0};
 // 起点与终点同格 + 一个长等待指令：既能用 step() 推进时间，又不会让敌人走到终点漏怪。
 const spot={col:x+origin.col,row:origin.row-y};
 b.level={...(b.level||{}),routes:[{motionMode:'WALK',startPosition:spot,endPosition:spot,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...(b.level?.enemyProfiles||{}),[id]:NATIVE_DATA.enemies[id]}};
 b.spawn({id,route:0});
 return b.s.enemies.at(-1);
}
// 测试里的敌人位置是手写的，不一定落在可行走地块上；碎片是按「可行走格」挑位置的，
// 所以要先找一个真正的可行走格来放父体。
function walkableSpot(b,x,y){
 for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)if(b.tileWalkable(x+dx,y+dy))return {x:x+dx,y:y+dy};
 assert.fail('附近没有可行走地块');
}

// ── 第一批：特殊生命值机制 ────────────────────────────────────────────────

test('特殊生命值机制：成功受到伤害只掉 1 点，不论伤害多少',()=>{
 const target={hp:2,maxHp:2,hitCountHp:true,hitCountTypes:null,shield:0,shieldLayers:[],barriers:[]};
 const first=applyDamage(target,5000,{type:'physical'});
 assert.equal(first.hp,1,'5000 点伤害也只掉 1 点');
 assert.equal(target.hp,1);
 const second=applyDamage(target,1,{type:'physical'});
 assert.equal(second.hp,1);
 assert.equal(target.hp,0,'第 2 次伤害才击倒');
});

test('特殊生命值机制：类型不符的伤害完全不降低生命值',()=>{
 const target={hp:4,maxHp:4,hitCountHp:true,hitCountTypes:['arts','true'],shield:0,shieldLayers:[],barriers:[]};
 applyDamage(target,9999,{type:'physical'});
 assert.equal(target.hp,4,'青瓷茶器只接受法术或真实伤害');
 applyDamage(target,9999,{type:'arts'});
 assert.equal(target.hp,3);
 applyDamage(target,9999,{type:'true'});
 assert.equal(target.hp,2);
});

test('次数血条按原表推导：碎片按描述拿次数与类型限定，普通敌人不带头',()=>{
 assert.equal(profiles('enemy_1196_msfyin').hitCountHp,true,'木制瑞印需要 2 次伤害击倒');
 assert.equal(profiles('enemy_1196_msfyin').hitCountTypes,null);
 assert.deepEqual(profiles('enemy_1204_msfhu').hitCountTypes,['arts','true'],'青瓷茶器限定法术或真实');
 assert.deepEqual(profiles('enemy_1204_msfhu_2').hitCountTypes,['arts','true']);
 assert.equal(profiles('enemy_1195_sfyin').hitCountHp,false,'解压缩父体不是次数血条');
 assert.equal(profiles('enemy_1288_duskls').hitCountHp,false);
});

test('碎片体型按比例缩小，再生形态靠形态缩放变小（不写 spriteScale）',()=>{
 assert.ok(profiles('enemy_1196_msfyin').spriteScale<1,'锅碗瓢盆小怪的立绘要缩小');
 assert.equal(profiles('enemy_1204_msfhu').spriteScale,profiles('enemy_1196_msfyin').spriteScale);
 assert.equal(profiles('enemy_1195_sfyin').spriteScale,1,'解压缩父体保持原尺寸');
 assert.equal(profiles('enemy_1288_duskls').spriteScale,1,'再生敌人保持原尺寸');
 const b=liveBattle({deploy:false}),u=b.s.units[0];
 const shard=spawnEnemy(b,'enemy_1196_msfyin',u.x+1,u.y);
 assert.ok(shard.spriteScale<1);
 const soldier=spawnEnemy(b,'enemy_1288_duskls',u.x+2,u.y+1);
 b.hit(u,soldier,999999,'physical');
 for(let i=0;i<31;i++)b.step();
 assert.equal(soldier.hitCountHp,true,'余烬确实用的是次数血条');
 assert.equal(soldier.spriteScale,1,'形态切换不写生成时的 spriteScale');
 assert.equal(enemySprite(soldier).scale,0.6,'变小由渲染层的形态缩放负责（revive.sprite）');
});

test('碎片实例：一次大伤害只掉一格，元素损伤不算「伤害」',()=>{
 const b=liveBattle(),u=b.s.units[0];
 const seal=spawnEnemy(b,'enemy_1196_msfyin',u.x+1,u.y);
 assert.equal(seal.hitCountHp,true);
 assert.equal(seal.hp,2);
 b.hit(u,seal,99999,'physical');
 assert.equal(seal.hp,1,'一次攻击只击破一次');
 assert.equal(seal.hp>0,true);
 applyElementDamage(b,{source:u,target:seal,amount:500,type:'burn'});
 assert.equal(seal.hp,1,'灼燃损伤是损伤不是伤害，不减次数');
 b.hit(u,seal,99999,'physical');
 assert.equal(seal.hp,0,'第二次伤害击倒');
});

test('碎片实例：青瓷茶器免疫物理，法术与真实各算一次',()=>{
 const b=liveBattle(),u=b.s.units[0];
 const ware=spawnEnemy(b,'enemy_1204_msfhu',u.x+1,u.y);
 b.hit(u,ware,5000,'physical');
 assert.equal(ware.hp,4,'物理伤害不计数');
 b.hit(u,ware,5000,'arts');assert.equal(ware.hp,3);
 b.hit(u,ware,5000,'true');assert.equal(ware.hp,2);
 b.hit(u,ware,5000,'arts');assert.equal(ware.hp,1);
 b.hit(u,ware,5000,'arts');assert.equal(ware.hp,0);
});

test('被屏障全额吸收的伤害不算受到伤害',()=>{
 const b=liveBattle(),u=b.s.units[0];
 const seal=spawnEnemy(b,'enemy_1196_msfyin',u.x+1,u.y);
 grantGuard(b,seal,{charges:1,id:'test-guard'});
 b.hit(u,seal,9999,'physical');
 assert.equal(seal.hp,2,'护盾替它挡下了这一击');
 assert.equal(seal.barriers.length,0,'护盾层数被消耗');
 b.hit(u,seal,9999,'physical');
 assert.equal(seal.hp,1);
});

// ── 第二批：DeadSpawn ────────────────────────────────────────────────────

test('解压缩参数来自原表：个数、碎片 key 与断刃扣减',()=>{
 assert.deepEqual(profiles('enemy_1195_sfyin').deadSpawn,{enemyKey:'enemy_1196_msfyin',cnt:2,cntAdd:0});
 assert.deepEqual(profiles('enemy_1197_sfshu_2').deadSpawn,{enemyKey:'enemy_1198_msfshu_2',cnt:3,cntAdd:0});
 assert.deepEqual(profiles('enemy_1199_sfjin').deadSpawn,{enemyKey:'enemy_1200_msfjin',cnt:1,cntAdd:0});
 assert.deepEqual(profiles('enemy_1207_sfji').deadSpawn,{enemyKey:'enemy_1208_msfji',cnt:4,cntAdd:-1});
 assert.deepEqual(profiles('enemy_1207_sfji').daggers,{count:4,atkAdd:0.7,perAttack:1});
 assert.deepEqual(profiles('enemy_1207_sfji_2').daggers,{count:4,atkAdd:0.8,perAttack:1},'新硎用 AtkUp.atk 的写法');
});

test('磨砻被击倒后按原表生成 2 个木制瑞印，落在自身或相邻可行走格并沿用自身路径',()=>{
 const b=liveBattle(),u=b.s.units[0];
 const spot=walkableSpot(b,Math.round(u.x)+2,Math.round(u.y));
 const parent=spawnEnemy(b,'enemy_1195_sfyin',spot.x,spot.y);
 const before=b.s.enemies.length;
 b.hit(u,parent,99999,'physical');
 assert.equal(parent.hp,0);
 assert.equal(b.s.enemies.length,before,'生成的碎片要等同一帧的总控刷出，避免在遍历敌人时改动数组');
 b.flushEnemySpawns();
 const shards=b.s.enemies.filter(e=>e.id==='enemy_1196_msfyin');
 assert.equal(shards.length,2);
 assert.equal(b.s.enemies.length,before+2);
 for(const shard of shards){
  assert.equal(shard.hitCountHp,true,'碎片带次数血条');
  assert.equal(shard.unblockable,true,'碎片无法被阻挡');
  assert.equal(shard.canAttack,false,'碎片不攻击');
  assert.equal(shard.route,parent.route,'以自身路径召唤');
  assert.ok(Math.max(Math.abs(shard.x-parent.x),Math.abs(shard.y-parent.y))<=1.001,'落在 1.0 边长正方形对应的格子内');
  assert.ok(b.tileWalkable(Math.round(shard.x),Math.round(shard.y)),'碎片落在可行走地块上');
 }
});

test('身观只生成 1 个青铜镜，并带嘲讽等级',()=>{
 const b=liveBattle(),u=b.s.units[0];
 const parent=spawnEnemy(b,'enemy_1199_sfjin',u.x+1,u.y);
 assert.equal(parent.taunt,1,'tauntLevel 要落到运行时的 taunt');
 b.hit(u,parent,999999,'physical');
 b.flushEnemySpawns();
 const shards=b.s.enemies.filter(e=>e.id==='enemy_1200_msfjin');
 assert.equal(shards.length,1);
 assert.equal(shards[0].maxHp,30,'青铜镜需要 30 次伤害击倒');
});

test('漏怪不算死亡，不触发解压缩',()=>{
 const b=liveBattle(),u=b.s.units[0];
 const leaked=spawnEnemy(b,'enemy_1195_sfyin',u.x+1,u.y);
 leaked.hp=0;
 b.onEnemyDeath(leaked,{reason:'leak'});
 b.flushEnemySpawns();
 assert.equal(b.s.enemies.filter(e=>e.id==='enemy_1196_msfyin').length,0,'走到保护点不算死亡');
 const killed=spawnEnemy(b,'enemy_1195_sfyin',u.x+1,u.y+1);
 b.hit(u,killed,99999,'physical');
 b.flushEnemySpawns();
 assert.equal(b.s.enemies.filter(e=>e.id==='enemy_1196_msfyin').length,2,'正常击倒才生成');
});

test('死亡类能力覆盖全部死因：非干员来源的击杀同样解压缩',()=>{
 const b=liveBattle(),u=b.s.units[0];
 const zoneKill=spawnEnemy(b,'enemy_1197_sfshu',u.x+1,u.y);
 zoneKill.hp=0;
 b.onEnemyDeath(zoneKill,{reason:'knockdown'}); // 统一入口，不再只在干员攻击路径里处理
 b.flushEnemySpawns();
 assert.equal(b.s.enemies.filter(e=>e.id==='enemy_1198_msfshu').length,3,'俗心生成 3 个小说卷轴');
});

test('碎片计入待处理目标：父体是最后一个敌人时战斗不结束',()=>{
 const b=liveBattle(),u=b.s.units[0];
 const parent=spawnEnemy(b,'enemy_1195_sfyin',u.x+1,u.y);
 b.s.queue=[];
 b.hit(u,parent,99999,'physical');
 assert.equal(b.s.finished,false);
 b.step();
 const shards=b.s.enemies.filter(e=>e.hp>0&&e.id==='enemy_1196_msfyin');
 assert.equal(shards.length,2,'碎片刷出后仍然占着待处理目标');
 assert.equal(b.s.finished,false,'剩下碎片时不能判战斗结束');
 for(const shard of shards){b.hit(u,shard,9999,'physical');b.hit(u,shard,9999,'physical');}
 b.step();
 assert.equal(b.s.enemies.filter(e=>e.hp>0).length,0);
 assert.equal(b.s.finished,true,'碎片清完后才结束');
});

test('沉沙的断刃：持有期间攻击力 +70%、每次成功攻击消耗 1 个，未消耗的断刃决定碎片数',()=>{
 const b=liveBattle(),u=b.s.units[0];
 const parent=spawnEnemy(b,'enemy_1207_sfji',u.x+1,u.y);
 assert.equal(parent.daggers,4);
 assert.equal(parent.daggerAtkAdd,0.7);
 const base=parent.atk;
 let seenAtk=0;const origHurt=b.hurt.bind(b);
 b.hurt=(target,enemy)=>{if(target===u)seenAtk=enemy.atk;return origHurt(target,enemy);};
 b.resolveEnemyStrike(parent,u,{});
 assert.equal(parent.daggers,3,'一次成功攻击消耗 1 个断刃');
 assert.equal(parent.daggersUsed,1);
 assert.ok(Math.abs(seenAtk-base*1.7)<1e-6,'有断刃时这一击按 +70% 攻击力结算');
 b.resolveEnemyStrike(parent,u,{});
 assert.equal(parent.daggers,2);
 parent.daggers=0;parent.daggersUsed=4;seenAtk=0;
 b.resolveEnemyStrike(parent,u,{});
 assert.equal(seenAtk,base,'断刃耗尽后攻击力回落');
 b.hit(u,parent,999999,'physical');
 b.flushEnemySpawns();
 assert.equal(b.s.enemies.filter(e=>e.id==='enemy_1208_msfji').length,1,'断刃耗尽时至少生成 1 个铜矛头');
});

test('沉沙未消耗断刃时按剩余个数生成碎片',()=>{
 const b=liveBattle(),u=b.s.units[0];
 const parent=spawnEnemy(b,'enemy_1207_sfji',u.x+1,u.y);
 b.hit(u,parent,999999,'physical');
 b.flushEnemySpawns();
 assert.equal(b.s.enemies.filter(e=>e.id==='enemy_1208_msfji').length,4,'一个断刃都没用时生成 4 个');
});

// ── 第三批：再生（Revive） ───────────────────────────────────────────────

test('再生参数来自原表：次数血条、间隔、隐蔽与护盾层数',()=>{
 assert.deepEqual(profiles('enemy_1288_duskls').revive,{hitCount:5,interval:10,formName:'怨恨的余烬',invisible:true,noAttack:true,unblockable:false,guardLayers:0,guardRadius:1.8,sprite:{avatar:null,scale:0.6,tint:'ember'}});
 assert.deepEqual(profiles('enemy_1292_duskld').revive,{hitCount:10,interval:10,formName:'贪欲的火灰',invisible:true,noAttack:true,unblockable:false,guardLayers:0,guardRadius:1.8,sprite:{avatar:null,scale:0.6,tint:'ember'}});
 const puppet=profiles('enemy_9010_acpupp').revive;
 assert.equal(puppet.hitCount,15,'blackboard 的 prop_max_hp 为准（图鉴文案的 30 与数据不一致）');
 assert.equal(puppet.interval,15);
 assert.equal(puppet.unblockable,true,'再生状态不可被阻挡');
 assert.equal(puppet.invisible,false,'再生状态没有隐匿');
 assert.equal(puppet.noAttack,false,'再生状态仍然会攻击');
 assert.equal(puppet.guardLayers,5,'Aura.max_damage_block_cnt');
});

test('aura.* 是自身条件而不是发给周围敌人的光环',()=>{
 // 逐火护卫的 aura.damage_resistance=0.5 是「附近有燃烧芦苇丛时自身减伤」，
 // 之前被当成长驻减伤光环发给周围所有敌人。
 assert.equal(profiles('enemy_1292_duskld').aura,null);
 assert.equal(profiles('enemy_1288_duskls').aura,null);
 assert.equal(profiles('enemy_1017_defdrn').aura.def,300,'defup.* 才是真的给友军加防');
});

test('逐火战士被击倒后进入 1s 重生状态，再变余烬：次数血条、隐匿、不攻击',()=>{
 const b=liveBattle({deploy:false}),u=b.s.units[0];
 const soldier=spawnEnemy(b,'enemy_1288_duskls',u.x+2,u.y);
 const kills=b.s.kills;
 b.hit(u,soldier,999999,'physical');
 assert.equal(soldier.hp,1,'被击倒不直接死亡');
 assert.equal(b.s.kills,kills,'还没有真的退场');
 assert.equal(soldier.revivePhase,'rebirth');
 assert.equal(soldier.invulnerable,true,'重生状态无敌');
 assert.equal(soldier.unblockable,true);
 assert.equal(soldier.formHold,true,'重生状态不移动');
 assert.equal(soldier.canAttack,false);
 for(let i=0;i<31;i++)b.step();
 assert.equal(soldier.revivePhase,'form','1s 后进入余烬形态');
 assert.equal(soldier.maxHp,5,'基础最大生命值临时变为 5');
 assert.equal(soldier.hp,5);
 assert.equal(soldier.hitCountHp,true);
 assert.equal(soldier.invisible,true,'余烬获得隐匿');
 assert.equal(soldier.canAttack,false,'余烬不进行攻击');
 assert.equal(soldier.invulnerable,false);
 assert.equal(soldier.unblockable,false);
 assert.equal(soldier.enemyDeathHandled,false);
});

test('余烬在 10s 内未被击倒则变回战士形态并回满血，可再次再生',()=>{
 const b=liveBattle({deploy:false}),u=b.s.units[0];
 const soldier=spawnEnemy(b,'enemy_1288_duskls',u.x+2,u.y);
 const maxHp=soldier.maxHp;
 b.hit(u,soldier,999999,'physical');
 for(let i=0;i<31;i++)b.step();
 assert.equal(soldier.revivePhase,'form');
 for(let i=0;i<301;i++)b.step();
 assert.equal(soldier.revivePhase,null,'10s 后回到初始形态');
 assert.equal(soldier.maxHp,maxHp);
 assert.equal(soldier.hp,maxHp,'恢复所有生命');
 assert.equal(soldier.hitCountHp,false);
 assert.equal(soldier.invisible,false);
 assert.equal(soldier.canAttack,true);
 assert.equal(soldier.enemyDeathHandled,false,'回满血后可以再次再生');
 b.hit(u,soldier,999999,'physical');
 assert.equal(soldier.revivePhase,'rebirth','第二次击倒仍然会再生');
});

test('余烬形态被击倒才是真死，且只算一次击杀',()=>{
 const b=liveBattle({deploy:false}),u=b.s.units[0];
 const soldier=spawnEnemy(b,'enemy_1288_duskls',u.x+2,u.y);
 const kills=b.s.kills;
 b.hit(u,soldier,999999,'physical');
 for(let i=0;i<31;i++)b.step();
 assert.equal(soldier.hp,5);
 for(let i=0;i<5;i++)b.hit(u,soldier,99999,'physical');
 assert.equal(soldier.hp,0,'余烬 5 次伤害击倒');
 b.step();
 assert.equal(b.s.kills,kills+1,'真正死亡时才算击杀');
 assert.equal(b.s.enemies.some(e=>e.uid===soldier.uid),false,'退场');
});

test('余烬的隐匿：未被阻挡时无法索敌，被阻挡时可以攻击',()=>{
 const b=liveBattle({deploy:false}),u=b.s.units[0];
 const soldier=spawnEnemy(b,'enemy_1288_duskls',u.x,u.y+1);
 b.hit(u,soldier,999999,'physical');
 for(let i=0;i<31;i++)b.step();
 assert.equal(b.targets(u).some(e=>e.uid===soldier.uid),false,'隐匿且未被阻挡时不能被索敌');
 soldier.block=u.uid;
 assert.equal(b.targets(u).some(e=>e.uid===soldier.uid),true,'被阻挡后可以打');
});

test('重生状态不移动：holding 由 formHold 生效',()=>{
 const b=liveBattle({deploy:false}),u=b.s.units[0];
 const soldier=spawnEnemy(b,'enemy_1288_duskls',u.x+2,u.y);
 b.hit(u,soldier,999999,'physical');
 assert.equal(soldier.formHold,true);
 // 换一条「下一格就是终点」的短路线，走一步就能看出有没有位移（终点带等待指令，不会漏怪）
 soldier.route=[{kind:'move',x:soldier.x+1,y:soldier.y},{kind:'wait',x:soldier.x+1,y:soldier.y,time:600}];
 soldier.cmd=0;soldier.speed=1;soldier.baseSpeed=1;
 const before=soldier.x;
 b.step();
 assert.equal(soldier.x,before,'重生状态原地不动');
 for(let i=0;i<31;i++)b.step();
 assert.equal(soldier.revivePhase,'form');
 soldier.cmd=0;soldier.cmdLeft=null;
 soldier.route=[{kind:'move',x:soldier.x+1,y:soldier.y},{kind:'wait',x:soldier.x+1,y:soldier.y,time:600}];
 const movingFrom=soldier.x;
 b.step();
 assert.ok(soldier.x>movingFrom,'余烬形态恢复移动');
});

test('假想敌：再生进入再生状态时给半径内其他敌人 5 层物法护盾',()=>{
 const b=liveBattle({deploy:false}),u=b.s.units[0];
 const boss=spawnEnemy(b,'enemy_9010_acpupp',u.x+2,u.y);
 const near=spawnEnemy(b,'enemy_1195_sfyin',u.x+2,u.y+1);
 const far=spawnEnemy(b,'enemy_1195_sfyin',u.x+9,u.y);
 b.hit(u,boss,99999999,'physical');
 assert.equal(boss.revivePhase,'rebirth');
 for(let i=0;i<31;i++)b.step();
 assert.equal(boss.revivePhase,'form');
 assert.equal(boss.maxHp,15);assert.equal(boss.hitCountHp,true);
 assert.equal(boss.canAttack,true,'再生状态仍然会攻击');
 const guards=near.barriers.filter(g=>String(g.id).startsWith('revive-guard-'));
 assert.equal(guards.length,1);
 assert.equal(guards[0].charges,5);
 assert.deepEqual(guards[0].types,['physical','arts']);
 assert.equal(far.barriers.filter(g=>String(g.id).startsWith('revive-guard-')).length,0,'半径 1.8 之外不给护盾');
 // 护盾只挡物理与法术，每次消耗 1 层
 const hpBefore=near.hp;
 b.hit(u,near,500,'physical');
 assert.equal(near.hp,hpBefore,'护盾挡下物理伤害');
 assert.equal(near.barriers[0].charges,4);
 b.hit(u,near,500,'true');
 assert.equal(near.hp,hpBefore-500,'真实伤害不被次数护盾抵挡');
 assert.equal(near.barriers[0].charges,4,'真实伤害不消耗层数');
 // 再次进入再生状态时按来源刷新层数，不会和上一轮叠成 10 层
 boss.revivePhaseUntil=b.s.time;b.step();
 assert.equal(boss.revivePhase,null,'计时到点后回到初始形态');
 b.hit(u,boss,99999999,'physical');
 assert.equal(boss.revivePhase,'rebirth');
 for(let i=0;i<31;i++)b.step();
 assert.equal(boss.revivePhase,'form');
 const refreshed=near.barriers.filter(g=>String(g.id).startsWith('revive-guard-'));
 assert.equal(refreshed.length,1,'同一来源只保留一层');
 assert.equal(refreshed[0].charges,5);
});

// ── 第四批补充：形态视觉（再生没有独立立绘） ──────────────────────────────
// 原表只有 Revive[Trigger].prop_max_hp/interval，形态名只写在文案里；游戏与 PRTS 都没有形态的
// 独立立绘（`<敌人页>/spine` 只有一个 asset，模型图集里也没有余烬／傀儡专用图块），原作用的是
// 同一套模型换动作。所以形态视觉＝本体头像 + 形态专属缩放 + 色调，登记在 `revive.sprite`。

test('形态视觉全表门禁：每个再生敌人都有 sprite，色调都有对应画法',()=>{
 for(const kind of FORM_SPRITE_TINTS)assert.ok(FORM_TINT_STYLE[kind]?.fill,`色调 ${kind} 在 native-fx 里没有画法`);
 const revived=Object.entries(NATIVE_DATA.enemies).filter(([,e])=>e.enemyBehavior?.revive);
 assert.equal(revived.length,4,'当前可再生的敌人是逐火战士／精锐战士／逐火护卫／假想敌：再生');
 for(const [id,e] of revived){
  const sprite=e.enemyBehavior.revive.sprite;
  assert.ok(sprite,`${id} 缺 revive.sprite 登记（形态会画得和本体一模一样）`);
  assert.ok(sprite.avatar===null||NATIVE_DATA.assets[sprite.avatar],`${id} 指定的形态头像必须在 assets 清单里，否则会退化成橙色圆圈`);
  assert.ok(Number(sprite.scale)>0&&Number(sprite.scale)<=1,`${id} 的形态缩放应在 (0,1]：${sprite.scale}`);
  assert.ok(FORM_SPRITE_TINTS.includes(sprite.tint),`${id} 的形态色调未登记：${sprite.tint}`);
 }
});

test('形态切换改立绘：余烬变小并压灰烬色调，回退后恢复本体',()=>{
 const b=liveBattle({deploy:false}),u=b.s.units[0];
 const soldier=spawnEnemy(b,'enemy_1288_duskls',u.x+2,u.y);
 assert.deepEqual(enemySprite(soldier),{key:'enemy_1288_duskls',scale:1,tint:null},'初始形态就是本体立绘');
 b.hit(u,soldier,999999,'physical');
 assert.deepEqual(enemySprite(soldier),{key:'enemy_1288_duskls',scale:1,tint:null},'1s 重生期仍是本体');
 for(let i=0;i<31;i++)b.step();
 assert.deepEqual(enemySprite(soldier),{key:'enemy_1288_duskls',scale:.6,tint:'ember'},'余烬形态变小并压灰烬色调');
 for(let i=0;i<301;i++)b.step();
 assert.deepEqual(enemySprite(soldier),{key:'enemy_1288_duskls',scale:1,tint:null},'10s 后复原回本体立绘');
});

test('傀儡形态按幻紫色调，且不借 hitCountHp 推缩放',()=>{
 const b=liveBattle({deploy:false}),u=b.s.units[0];
 const boss=spawnEnemy(b,'enemy_9010_acpupp',u.x+2,u.y);
 b.hit(u,boss,99999999,'physical');
 for(let i=0;i<31;i++)b.step();
 assert.equal(boss.revivePhase,'form');
 assert.deepEqual(enemySprite(boss),{key:'enemy_9010_acpupp',scale:.6,tint:'puppet'});
});

test('碎片不吃形态缩放：生成时的 spriteScale 才是唯一依据',()=>{
 const b=liveBattle(),u=b.s.units[0];
 const parent=spawnEnemy(b,'enemy_1195_sfyin',u.x+1,u.y);
 b.hit(u,parent,999999,'physical');
 b.flushEnemySpawns();
 const fragment=b.s.enemies.find(e=>e.id==='enemy_1196_msfyin');
 assert.ok(fragment,'木制瑞印应当已生成');
 assert.equal(fragment.hitCountHp,true,'碎片本身就是次数血条敌人');
 assert.deepEqual(enemySprite(fragment),{key:'enemy_1196_msfyin',scale:.6,tint:null},'碎片的 0.6 来自生成时，不叠加形态色调');
});

test('存档恢复后仍处于余烬形态，形态视觉不丢',()=>{
 const {g,b}=liveSession({deploy:false}),u=b.s.units[0];
 const soldier=spawnEnemy(b,'enemy_1288_duskls',u.x+2,u.y);
 b.hit(u,soldier,999999,'physical');
 for(let i=0;i<31;i++)b.step();
 assert.equal(soldier.revivePhase,'form');
 const back=NativeSession.restore(NATIVE_DATA,g.snapshot());
 const restored=back.battle.s.enemies.find(e=>e.uid===soldier.uid);
 assert.ok(restored,'恢复后敌人还在');
 assert.equal(restored.revivePhase,'form','形态本身跟着存档走');
 assert.deepEqual(enemySprite(restored),{key:'enemy_1288_duskls',scale:.6,tint:'ember'},'恢复后依然画余烬立绘');
});

test('形态切换有表现：画形态名与剩余次数，过期不画',()=>{
 const ops=[];
 const c={globalCompositeOperation:'',lineCap:'',strokeStyle:'',fillStyle:'',lineWidth:1,font:'',textAlign:'',
  save(){},restore(){},setLineDash(){},createLinearGradient(){return{addColorStop(){}}},createRadialGradient(){return{addColorStop(){}}},
  fillRect(){},strokeRect(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},quadraticCurveTo(){},
  stroke(){ops.push({op:'stroke',style:this.strokeStyle});},arc(){},ellipse(){ops.push({op:'ellipse',style:this.strokeStyle});},fill(){},translate(){},rotate(){},drawImage(){},
  fillText(text){ops.push({op:'text',text,style:this.fillStyle});}};
 const point=(x,y)=>({x:x*10,y:y*10}),Z={r:{width:800,height:520},tw:64,th:52,ox:0,oy:0};
 const events=[{type:'enemy-phase',phase:'revive-form',form:'怨恨的余烬',hitCount:5,t:10,x:2,y:3,uid:7}];
 const draw=extra=>({s:{time:10.5,units:[],enemies:[{uid:7,x:2,y:3}],events},...extra});
 assert.equal(drawEnemyPhase(c,point,Z,draw()),true,'形态切换要画出来');
 assert.ok(ops.some(o=>o.op==='text'&&o.text==='怨恨的余烬 ×5'),'浮字要带形态名与剩余次数');
 assert.ok(ops.some(o=>o.op==='ellipse'),'要有一圈形态光环');
 // 过期事件不再画（事件只在 s.events 里留 4 秒）
 assert.equal(drawEnemyPhase(c,point,Z,{s:{time:16,units:[],enemies:[],events}}),false);
 // 减少动效模式仍画环与文字（只是不画灰烬粒）
 const reduced=[];
 const rc={...c,fillText(text){reduced.push(text);}};
 assert.equal(drawEnemyPhase(rc,point,Z,draw(),{reduceFx:true}),true);
 assert.deepEqual(reduced,['怨恨的余烬 ×5']);
 assert.equal(drawEnemyPhase(c,point,Z,{s:{time:10.5,units:[],enemies:[],events:[]}}),false,'没有事件时不画');
});

test('灰烬色调在离屏画布上按 source-atop 压色，图没解码完就原样返回',()=>{
 const calls=[];   // node 里没有 document，这里塞一个最小实现把压色路径跑起来
 const previous=globalThis.document;
 globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({drawImage(){calls.push('draw');},fillRect(){calls.push('fill');},
  set globalCompositeOperation(v){calls.push('op:'+v);},get globalCompositeOperation(){return '';},fillStyle:''})})};
 try{
  const image={complete:true,naturalWidth:64,naturalHeight:64,src:'assets/prts/enemy_1288_duskls.png'};
  const tinted=formTintedImage(image,'ember');
  assert.notEqual(tinted,image,'登记过的色调要返回压色后的离屏画布');
  assert.equal(tinted.complete,true);
  assert.equal(tinted.naturalWidth,64,'要补上 Image 接口，隐匿马赛克才能复用同一张图');
  assert.deepEqual(calls,['draw','op:source-atop','fill']);
  assert.equal(formTintedImage({complete:false,naturalWidth:0,src:'assets/prts/other.png'},'ember').complete,false,'没解码完就原样返回，下一帧再试');
  assert.equal(formTintedImage(image,'unregistered'),image,'未登记的色调不压色');
 }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
