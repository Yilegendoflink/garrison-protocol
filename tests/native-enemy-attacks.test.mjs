import test from 'node:test';import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';
import {NativeBattle} from '../dist/native-battle.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {applyStatus,statusAttributeChanges,permissions} from '../dist/status.js';
import {commitExit,revealEnemy,grantGuard,dealDamage,applyLoss} from '../dist/native-effects.js';
import {drawEnemyProjectiles} from '../dist/native-fx.js';

function arena(id,{x=3,y=3,positions=[[3,3]]}={}){
 const g=new NativeSession(NATIVE_DATA,{seed:42});g.s.funds=100;assert.ok(g.perform('buy',0));const unit=g.s.units[0];let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(unit.uid,x,y))placed=g.deploy(unit.uid,x,y,0);
 assert.ok(placed);assert.ok(g.perform('start'));const b=g.battle,template=b.s.units[0];b.s.queue=[];b.s.enemies=[];b.s.limit=1000;
 b.map=structuredClone(b.map);b.s.units=positions.map(([x,y],i)=>{const u=structuredClone(template);u.uid+=i*100;u.x=x;u.y=y;u.deployed=true;u.deployAt=i===0?100:0;applyStatus(u,'disarm',600);b.map.grid[y][x].heightType='LOWLAND';return u;});
 const raw=NATIVE_DATA.enemies[id],o=b.map.origin,spot={col:o.col+x,row:o.row-y};
 b.level={...b.level,routes:[{motionMode:raw.motion,startPosition:spot,endPosition:spot,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...b.level.enemyProfiles,[id]:raw}};
 b.spawn({id,route:0});const enemy=b.s.enemies[0];enemy.atk=enemy.baseAtk=1;
 const strikes=[],emit=b.emit.bind(b);b.emit=(kind,row)=>{if(kind==='strike'&&row.enemy)strikes.push({...row,time:b.s.time});emit(kind,row);};
 return {b,g,enemy,allies:b.s.units,strikes};
}
function advance(b,s){for(let i=0;i<Math.round(s*30);i++)b.step();}

test('碎骨未阻挡发射26%九格榴弹，飞行单位只能被溅射，命中后减防5秒',()=>{
 const {b,enemy,allies}=arena('enemy_1500_skulsr',{x:3,y:5,positions:[[3,3],[4,4],[5,3]]});allies[1].flying=true;allies[0].deployAt=100;allies[0].statusResistance=.5;
 const hits=[];b.hurt=(u,e,opts)=>hits.push({uid:u.uid,atk:e.atk,cause:opts.cause,defense:b.stats(u).def});const before=b.stats(allies[0]).def;
 advance(b,1.1);assert.deepEqual(hits.map(h=>h.uid),allies.slice(0,2).map(u=>u.uid));assert.ok(hits.every(h=>h.atk===.26));assert.equal(hits[1].cause,'splash');assert.equal(hits[0].defense,before);
 assert.equal(allies[0].statuses.find(s=>s.kind==='defDown').value,-.5);assert.ok(allies[0].statuses.find(s=>s.kind==='defDown').remaining>4.8);assert.equal(allies[2].statuses.some(s=>s.kind==='defDown'),false);
 enemy.canAttack=false;advance(b,5.1);assert.equal(b.stats(allies[0]).def,before);
});

test('碎骨被阻挡改为全倍率单体，不产生榴弹减防，只有飞行目标时不开火',()=>{
 const {b,enemy,allies}=arena('enemy_1500_skulsr',{positions:[[3,3],[4,3]]}),hits=[];b.hurt=(u,e)=>hits.push([u.uid,e.atk]);advance(b,1.1);
 assert.deepEqual(hits,[[allies[0].uid,1]]);assert.ok(allies.every(u=>!u.statuses.some(s=>s.kind==='defDown')));
 const air=arena('enemy_1500_skulsr',{x:3,y:5,positions:[[3,3]]});air.allies[0].flying=true;advance(air.b,4);assert.equal(air.enemy.attackCount,0);
});

test('碎骨严格半血以下增攻且回血恢复，存档保留榴弹减防剩余时长',()=>{
 const {b,g,enemy,allies:[u]}=arena('enemy_1500_skulsr',{x:3,y:5,positions:[[3,3]]});enemy.hp=enemy.maxHp*.5;assert.equal(b.enemyAttackDamage(enemy),1);
 enemy.hp--;assert.equal(b.enemyAttackDamage(enemy),1.5);advance(b,1.1);const left=u.statuses.find(s=>s.kind==='defDown').remaining;enemy.hp=enemy.maxHp;assert.equal(b.enemyAttackDamage(enemy),1);enemy.canAttack=false;
 const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);assert.equal(restored.enemyAttackDamage(restored.s.enemies[0]),1);advance(restored,left+.1);assert.equal(restored.s.units[0].statuses.some(s=>s.kind==='defDown'),false);
});

test('澪普通与强化攻击均二连击，按一次攻击回复SP，技能直到末击才结束',()=>{
 const {b,enemy,strikes}=arena('enemy_10118_ymgprc');advance(b,1.1);
 assert.equal(strikes.length,2);assert.equal(enemy.attackCount,1);assert.equal(enemy.sp,1);
 enemy.sp=3;enemy.attackCooldown=0;advance(b,.94);assert.equal(enemy.sp,0);assert.ok(enemy.enemyCast?.multiAttack);
 advance(b,.2);assert.equal(strikes.length,4);assert.equal(enemy.enemyCast,null);assert.equal(enemy.sp,0);
});

test('自制投石机一次攻击三次命中，相隔0.3秒，读档保留尚未发生的命中',()=>{
 const {b,g,enemy,strikes}=arena('enemy_10162_mnctpt',{x:3,y:4});advance(b,2.2);
 assert.equal(strikes.length,1);assert.equal(b.s.strikes.filter(s=>s.enemyAttack).length,2);assert.equal(enemy.attackCount,1);
 const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);
 const before=restored.s.units[0].hp;advance(restored,.6);assert.ok(restored.s.units[0].hp<before);
 assert.equal(restored.s.strikes.filter(s=>s.enemyAttack).length,0);assert.equal(restored.s.enemies[0].attackCount,1);
 advance(b,.6);assert.equal(strikes.length,3);assert.ok(Math.abs(strikes[1].time-strikes[0].time-.3)<.04);
});

test('多连击在首击后受控制，不继续造成后续命中',()=>{
 const {b,enemy,strikes}=arena('enemy_10162_mnctpt',{x:3,y:4});advance(b,2.2);assert.equal(strikes.length,1);
 applyStatus(enemy,'stun',3);advance(b,1);assert.equal(strikes.length,1);
});

test('骨刺未暴露时同时攻击3个目标，被阻挡后退回单目标',()=>{
 const free=arena('enemy_9008_acbunn',{x:3,y:4,positions:[[2,3],[3,2],[4,3]]});advance(free.b,1.4);
 assert.equal(free.enemy.block,null);assert.equal(free.strikes.length,3);assert.equal(free.enemy.attackCount,1);
 const blocked=arena('enemy_9008_acbunn',{positions:[[3,3],[2,3],[4,3]]});advance(blocked.b,1.4);
 assert.ok(blocked.enemy.block!=null);assert.equal(blocked.strikes.length,1);
});

test('控潮术师普通攻击溅射以目标为中心，仅覆盖相邻四格且附加侵蚀',()=>{
 const {b,allies,enemy}=arena('enemy_1161_tidmag',{x:3,y:5,positions:[[3,3],[4,3],[4,4]]});
 const hp=allies.map(u=>u.hp);advance(b,1);
 assert.ok(allies[0].hp<hp[0]);assert.ok(allies[1].hp<hp[1]);assert.equal(allies[2].hp,hp[2]);
 assert.ok(allies[0].elemental.corrosion>0&&allies[1].elemental.corrosion>0);assert.equal(allies[2].elemental?.corrosion||0,0);assert.equal(enemy.attackCount,1);
});

test('火炮溅射伤害多个目标，但一发炮弹仅留下一个燃烧区',()=>{
 const {b,allies}=arena('enemy_10122_uacann_2',{x:3,y:5,positions:[[3,3],[4,3],[4,4]]});const hp=allies.map(u=>u.hp);
 advance(b,2);assert.ok(allies[0].hp<hp[0]);assert.ok(allies[1].hp<hp[1]);assert.equal(allies[2].hp,hp[2]);
 assert.equal(b.s.logicEffects.filter(f=>f.kind==='field').length,1);
});

test('独轮车玩具普通攻击选择两个不同目标',()=>{
 const {b,enemy,strikes}=arena('enemy_10018_sgrobh',{x:3,y:4,positions:[[3,3],[2,4],[4,4]]});advance(b,1.6);
 assert.equal(strikes.length,2);assert.equal(new Set(strikes.map(s=>s.targetX+','+s.targetY)).size,2);assert.equal(enemy.attackCount,1);
});

test('自行炮先锁最大生命目标所在九格，再逐次轰炸其中生命比例最高者',()=>{
 const {b,enemy,allies}=arena('enemy_1273_stmgun_2',{x:3,y:5,positions:[[3,3],[4,3]]});
 const stats=b.stats.bind(b);b.stats=u=>({...stats(u),maxHp:u.uid===allies[0].uid?2000:1000});
 advance(b,9.9);allies[0].hp=100;allies[1].hp=1000;for(let i=0;i<180&&!enemy.enemyCast;i++)b.step();const castAt=b.s.time;
 assert.equal(enemy.enemyCast?.channel,'cannon');assert.deepEqual([enemy.enemyCast.x,enemy.enemyCast.y],[3,3]);
 assert.equal(applyStatus(enemy,'stun',3),false,'施法期间临时免疫眩晕');
 const hits=[],hurt=b.hurt.bind(b);b.hurt=(u,e)=>{hits.push({uid:u.uid,type:e.damageType,atk:e.atk});hurt(u,e);};
 advance(b,.5);assert.equal(hits[0].uid,allies[1].uid);assert.equal(hits[0].type,'arts');assert.equal(hits[0].atk,.55);
 allies[0].hp=2000;allies[1].hp=1;advance(b,.5);assert.equal(hits[1].uid,allies[0].uid);
 advance(b,5);assert.equal(hits.length,10);assert.equal(enemy.enemyCast,null);assert.ok(Math.abs(enemy.enemySkills[0].nextAt-(castAt+31))<.04);
 assert.equal(applyStatus(enemy,'stun',1),true,'施法结束恢复原免疫属性');
});

test('爵士乐手隐匿时不普攻不施法，被反隐后引导灼燃，沉默立即中断',()=>{
 const {b,enemy,allies,strikes}=arena('enemy_10034_cnvsax',{x:3,y:4,positions:[[3,3]]});
 advance(b,6);assert.ok(enemy.enemyCast==null);assert.equal(strikes.length,0);
 enemy.revealed=true;enemy.revealUntil=b.s.time+20;advance(b,.1);assert.equal(enemy.enemyCast?.channel,'jazz');
 const hp=allies[0].hp;advance(b,.5);assert.ok(allies[0].hp<hp);assert.ok(allies[0].elemental.burn>0);
 applyStatus(enemy,'silence',3);b.step();assert.equal(enemy.enemyCast,null);const stopped=allies[0].hp;advance(b,1);assert.equal(allies[0].hp,stopped);
});

test('爵士首次切模式前CD照常走，恢复隐匿取消引导并暂停后续CD，读档后继续剩余冷却',()=>{
 const {b,g,enemy}=arena('enemy_10034_cnvsax',{x:3,y:4,positions:[[3,3]]});advance(b,6);assert.equal(enemy.enemySkills[0].nextAt,3);
 revealEnemy(b,enemy,1);advance(b,.1);assert.equal(enemy.enemyCast?.channel,'jazz');advance(b,1.1);assert.equal(enemy.enemyCast,null);assert.equal(enemy.jazzCounterMode,false);
 const remaining=enemy.enemySkills[0].nextAt-b.s.time;advance(b,5);assert.ok(Math.abs(enemy.enemySkills[0].nextAt-b.s.time-remaining)<.04);
 const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);const e=restored.s.enemies[0];revealEnemy(restored,e,20);advance(restored,remaining-.2);assert.equal(e.enemyCast,null);advance(restored,.4);assert.equal(e.enemyCast?.channel,'jazz');
});

test('庞贝四目标普攻为法术且不对空，每个目标获得一份灼烧',()=>{
 const {b,enemy,allies,strikes}=arena('enemy_1050_lslime',{positions:[[3,3],[2,3],[4,3],[3,2],[3,4],[2,2]]});allies.at(-1).flying=true;
 advance(b,1.6);assert.equal(enemy.damageType,'arts');assert.equal(strikes.length,4);assert.ok(strikes.every(s=>s.type==='arts'));const burns=b.s.logicEffects.filter(f=>f.talentOrSkillId==='pompeii-burn');assert.equal(burns.length,4);assert.equal(burns.some(f=>f.targetUid===allies.at(-1).uid),false);
});

test('庞贝灼烧重复命中只刷新时长，不重置0.33秒节奏或叠加，来源死亡后继续且不回受击SP',()=>{
 const {b,enemy,allies}=arena('enemy_1050_lslime');enemy.canAttack=false;const u=allies[0],profile=b.profile.bind(b);
 b.profile=v=>v===u?{...profile(v),skill:{...profile(v).skill,spData:{spType:'INCREASE_WHEN_TAKEN_DAMAGE',spCost:100,initSp:0,increment:1}}}:profile(v);u.sp=0;
 b.resolveEnemyAttackEffects(enemy,u,{count:false});const burn=b.s.logicEffects.find(f=>f.talentOrSkillId==='pompeii-burn');assert.equal(burn.sourceUid,null);const hp=u.hp,res=b.stats(u).magicResistance;
 advance(b,.2);b.resolveEnemyAttackEffects(enemy,u,{count:false});assert.equal(b.s.logicEffects.filter(f=>f.talentOrSkillId==='pompeii-burn').length,1);assert.equal(burn.nextAt,.33);assert.ok(Math.abs(burn.endsAt-10.2)<1e-8);
 advance(b,.14);assert.ok(Math.abs(hp-u.hp-20*(1-res/100))<1e-6);assert.equal(u.sp,0);
 b.spawn({id:'enemy_1007_slime',route:0});b.s.enemies.at(-1).canAttack=false;commitExit(b,{target:enemy});const before=u.hp;advance(b,.34);assert.ok(u.hp<before);assert.equal(u.sp,0);
});

test('庞贝阻挡爆炸在指定控制期间暂停、脱离阻挡清零，固定伤害不吃自身攻击倍率',()=>{
 const {b,enemy,allies}=arena('enemy_1050_lslime',{positions:[[3,3],[4,3],[4,4]]});enemy.canAttack=false;allies[1].flying=true;const hits=[];b.hurt=(u,e,opts={})=>{if(opts.cause==='extra')hits.push({uid:u.uid,amount:opts.damageAmount});};
 advance(b,9.8);assert.equal(hits.length,0);applyStatus(enemy,'stun',2);advance(b,1.9);assert.equal(hits.length,0);advance(b,.4);assert.deepEqual(hits,[{uid:allies[0].uid,amount:1000}]);
 advance(b,3);allies[0].x=6;b.step();assert.equal(enemy.pompeiiBlockClock,0);allies[0].x=3;advance(b,9.9);assert.equal(hits.length,1);advance(b,.2);assert.equal(hits.length,2);
});

test('庞贝缴械不暂停独立爆炸，阻挡计时跨JSON恢复',()=>{
 const {b,g,enemy}=arena('enemy_1050_lslime');enemy.canAttack=false;applyStatus(enemy,'disarm',60);advance(b,6);
 const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);let blasts=0;restored.hurt=(u,e,opts={})=>{if(opts.cause==='extra')blasts++;};advance(restored,3.9);assert.equal(blasts,0);advance(restored,.2);assert.equal(blasts,1);
});

test('庞贝低于半血才获得40攻速，真实攻击间隔缩短，回血后可逆且不逐帧叠加',()=>{
 const {b,enemy,allies}=arena('enemy_1050_lslime');const stats=b.stats.bind(b);b.stats=u=>({...stats(u),maxHp:50000});allies[0].hp=50000;
 enemy.hp=enemy.maxHp*.49;const times=[],record=b.recordEnemyAttack.bind(b);b.recordEnemyAttack=(e,s)=>{times.push(b.s.time);record(e,s);};b.hurt=()=>{};advance(b,8);assert.ok(times.length>=3);assert.ok(Math.abs(times[1]-times[0]-2.5)<.04);
 enemy.hp=enemy.maxHp*.5;advance(b,12);assert.ok(Math.abs(times.at(-1)-times.at(-2)-3.5)<.04);
});

test('囚犯禁锢攻速修正不会被干员光环调度清空，前三次攻击保持原表间隔',()=>{
 const {b,enemy}=arena('enemy_1116_liprr'),times=[],record=b.recordEnemyAttack.bind(b);b.recordEnemyAttack=(e,s)=>{times.push(b.s.time);record(e,s);};b.hurt=()=>{};
 const expected=enemy.interval*100/(enemy.attackSpeed+Number(enemy.enemyTalent['confinement.attack_speed']));advance(b,expected*2+2);assert.ok(times.length>=3);assert.ok(Math.abs(times[1]-times[0]-expected)<.04);assert.ok(Math.abs(times[2]-times[1]-expected)<.04);
});

test('遗弃者造成伤害后才加层，当次不用新倍率，次数护盾抵消不加层，最高28层',()=>{
 const {b,enemy,allies}=arena('enemy_2005_axetro'),u=allies[0];const stats=b.stats.bind(b);b.stats=a=>({...stats(a),def:0,maxHp:100000});u.hp=100000;enemy.atk=enemy.baseAtk=100;b.economy.random=()=>.999;
 grantGuard(b,u,{charges:1,types:['physical'],id:'axetro-test'});b.hurt(u,enemy);assert.equal(enemy.axetroStacks,0);
 let hp=u.hp;b.hurt(u,enemy);assert.equal(hp-u.hp,100);assert.equal(enemy.axetroStacks,1);hp=u.hp;b.hurt(u,enemy);assert.ok(Math.abs(hp-u.hp-107)<1e-6);assert.equal(enemy.axetroStacks,2);
 for(let i=0;i<40;i++)b.hurt(u,enemy);assert.equal(enemy.axetroStacks,28);hp=u.hp;b.hurt(u,enemy);assert.ok(Math.abs(hp-u.hp-296)<1e-6);
});

test('遗弃者保持攻击状态时慢速间隔不误清层，控制满4秒才清空，随后能重新叠加',()=>{
 const {b,enemy,allies}=arena('enemy_2005_axetro'),u=allies[0];const stats=b.stats.bind(b);b.stats=a=>({...stats(a),def:0,maxHp:100000});u.hp=100000;b.economy.random=()=>.999;
 enemy.atk=100;b.hurt(u,enemy);enemy.interval=6;advance(b,5);assert.ok(enemy.axetroStacks>0);
 applyStatus(enemy,'stun',6);b.step();advance(b,3.9);assert.ok(enemy.axetroStacks>0);advance(b,.2);assert.equal(enemy.axetroStacks,0);advance(b,2);enemy.attackCooldown=0;advance(b,2.5);assert.ok(enemy.axetroStacks>0);
});

test('遗弃者不对空，无目标时清层；叠层与脱战计时可跨JSON恢复',()=>{
 const {b,g,enemy,allies}=arena('enemy_2005_axetro',{positions:[[3,1]]}),u=allies[0];u.flying=true;advance(b,5);assert.equal(enemy.attackCount,0);assert.equal(enemy.axetroStacks,0);
 u.flying=false;b.hurt(u,enemy);assert.equal(enemy.axetroStacks,1);u.x=9;b.step();advance(b,2);
 const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);const e=restored.s.enemies[0];assert.equal(e.axetroStacks,1);advance(restored,1.8);assert.equal(e.axetroStacks,1);advance(restored,.3);assert.equal(e.axetroStacks,0);
});

test('遗弃者叠层攻速实际缩短攻击周期，沉默不禁用不可沉默天赋',()=>{
 const {b,enemy,allies}=arena('enemy_2005_axetro'),u=allies[0],stats=b.stats.bind(b);b.stats=a=>({...stats(a),def:0,maxHp:100000});u.hp=100000;enemy.atk=1;b.economy.random=()=>.999;applyStatus(enemy,'silence',60);
 for(let i=0;i<28;i++)b.hurt(u,enemy);assert.equal(enemy.axetroStacks,28);const times=[],record=b.recordEnemyAttack.bind(b);b.recordEnemyAttack=(e,s)=>{times.push(b.s.time);record(e,s);};advance(b,4);assert.ok(times.length>=3);assert.ok(Math.abs(times[1]-times[0]-3/2.4)<.04);
});

test('W按本期9秒初始CD安装单目标C4，3.2秒后只炸标记目标，20秒冷却从施法结束算',()=>{
 const {b,enemy,allies}=arena('enemy_1504_cqbw',{positions:[[3,4],[4,3],[2,3]]});enemy.canAttack=false;allies[2].flying=true;allies[2].deployAt=200;
 const hits=[];b.hurt=(u,e)=>hits.push({uid:u.uid,atk:e.atk});advance(b,8.9);assert.equal(enemy.enemyCast,undefined);advance(b,.1);assert.deepEqual(enemy.enemyCast.c4Targets.map(t=>t.uid),[allies[0].uid]);assert.equal(enemy.formHold,true);
 advance(b,3.1);assert.equal(hits.length,0);advance(b,.1);assert.deepEqual(hits,[{uid:allies[0].uid,atk:1.8}]);assert.equal(enemy.formHold,false);assert.ok(Math.abs(enemy.enemySkills[0].nextAt-(b.s.time+20))<1e-6);
});

test('W首次严格低于半血立即清技能CD，之后最多标记3人且可对空，回血不撤销也不再次清CD',()=>{
 const {b,enemy,allies}=arena('enemy_1504_cqbw',{positions:[[3,4],[4,3],[2,3],[3,2]]});enemy.canAttack=false;allies[3].flying=true;allies[3].deployAt=200;
 enemy.hp=enemy.maxHp*.5;b.step();assert.equal(enemy.wEnraged,undefined);applyLoss(b,{target:enemy,amount:1});assert.equal(enemy.wEnraged,true);assert.equal(enemy.enemySkills[0].nextAt,b.s.time);
 b.step();assert.equal(enemy.enemyCast.c4Targets.length,3);assert.ok(enemy.enemyCast.c4Targets.some(t=>t.uid===allies[3].uid));b.hurt=()=>{};advance(b,3.3);const next=enemy.enemySkills[0].nextAt;
 enemy.hp=enemy.maxHp;dealDamage(b,{target:enemy,value:enemy.maxHp*.6,type:'true'});assert.equal(enemy.enemySkills[0].nextAt,next);assert.equal(enemy.wEnraged,true);assert.equal(enemy.enemyAttack.groundOnly,true);
});

test('W受控或死亡中断施法时立即引爆一次，不等原截止时间，也不重复炸',()=>{
 for(const mode of ['stun','death']){
  const {b,enemy}=arena('enemy_1504_cqbw',{positions:[[3,4]]});enemy.canAttack=false;let hits=0;b.hurt=()=>hits++;advance(b,9.5);
  if(mode==='stun')applyStatus(enemy,'stun',5);else commitExit(b,{target:enemy});b.step();assert.equal(hits,1,mode);assert.equal(enemy.enemyCast,null);assert.equal(enemy.formHold,false);advance(b,4);assert.equal(hits,1,mode);
 }
});

test('C4标记随JSON保存且绑定部署代次，不追炸撤退后重部署的同UID',()=>{
 const {b,g,enemy,allies}=arena('enemy_1504_cqbw',{positions:[[3,4]]});enemy.canAttack=false;advance(b,10);
 const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);let hits=0;restored.hurt=()=>hits++;advance(restored,2.3);assert.equal(hits,1);
 const u=allies[0];commitExit(b,{target:u,reason:'retreat'});b.deploy(u);applyStatus(u,'disarm',60);let reentryHits=0;b.hurt=()=>reentryHits++;advance(b,2.3);assert.equal(reentryHits,0);assert.equal(enemy.enemyCast,null);
});

test('W施法期间跨半血保留清冷却效果，当前一枚结算后即可改装三枚',()=>{
 const {b,enemy,allies}=arena('enemy_1504_cqbw',{positions:[[3,4],[4,3],[2,3]]});enemy.canAttack=false;b.hurt=()=>{};advance(b,10);const current=enemy.enemyCast;assert.equal(current.c4Targets.length,1);
 dealDamage(b,{target:enemy,value:enemy.maxHp*.6,type:'true'});assert.equal(current.c4CooldownReset,true);advance(b,2.3);assert.ok(enemy.enemyCast);assert.notEqual(enemy.enemyCast,current);assert.equal(enemy.enemyCast.c4Targets.length,allies.length);
});

test('敌方泥岩有效出手即叠攻，当次受益，最多六层，同一攻击ID不重复加层',()=>{
 const {b,enemy,allies}=arena('enemy_1511_mdrock'),u=allies[0],stats=b.stats.bind(b);b.stats=a=>({...stats(a),def:0,maxHp:100000});u.hp=100000;enemy.atk=enemy.baseAtk=100;b.economy.random=()=>.999;
 for(let i=1;i<=7;i++){const hp=u.hp;b.resolveEnemyStrike(enemy,u,{attackId:i});assert.ok(Math.abs(hp-u.hp-100*(1+.6*Math.min(i,6)))<1e-6);}
 assert.equal(enemy.mudrockStacks,6);b.resolveEnemyStrike(enemy,u,{attackId:7});assert.equal(enemy.mudrockStacks,6);
});

test('泥岩屏障在场时真实攻速增加50，破盾后周期恢复且控制时不刷新',()=>{
 const {b,enemy}=arena('enemy_1511_mdrock'),times=[],record=b.recordEnemyAttack.bind(b);b.recordEnemyAttack=(e,s)=>{times.push(b.s.time);record(e,s);};b.hurt=()=>{};advance(b,8);assert.ok(times.length>=3);assert.ok(Math.abs(times[1]-times[0]-3)<.04);
 dealDamage(b,{target:enemy,value:5500,type:'arts'});advance(b,8);assert.ok(Math.abs(times.at(-1)-times.at(-2)-4.5)<.04);applyStatus(enemy,'disarm',30);advance(b,2);assert.equal(enemy.shield,0);enemy.statuses=[];enemy.action=null;b.step();assert.equal(enemy.shield,5500);
});

test('墓碑未阻挡时40%远程九格溅射，可溅射飞行但不以其为主目标；被阻挡后全倍率单体',()=>{
 const ranged=arena('enemy_2008_flking',{x:3,y:4,positions:[[3,3],[4,3],[2,3],[5,3]]});ranged.allies[1].flying=true;ranged.allies[1].deployAt=200;
 const hits=[];ranged.b.hurt=(u,e)=>hits.push({uid:u.uid,atk:e.atk});advance(ranged.b,1.5);assert.deepEqual(hits.map(h=>h.uid).sort((a,b)=>a-b),ranged.allies.slice(0,3).map(a=>a.uid).sort((a,b)=>a-b));assert.ok(hits.every(h=>h.atk===.4));assert.deepEqual([ranged.strikes[0].targetX,ranged.strikes[0].targetY],[3,3]);
 const melee=arena('enemy_2008_flking',{positions:[[3,3],[4,3]]}),close=[];melee.b.hurt=(u,e)=>close.push({uid:u.uid,atk:e.atk});advance(melee.b,1.5);assert.deepEqual(close,[{uid:melee.allies[0].uid,atk:1}]);assert.equal(melee.strikes[0].ranged,false);
});

test('墓碑屏障10秒首刷、30秒周期，按当前最大生命10%替换并吸收全类型',()=>{
 const {b,enemy}=arena('enemy_2008_flking');enemy.canAttack=false;advance(b,9.9);assert.equal(enemy.shield,0);advance(b,.1);assert.equal(enemy.shield,enemy.maxHp*.1);
 let remaining=enemy.shield;for(const type of ['physical','arts','true','elemental']){const hp=enemy.hp;dealDamage(b,{target:enemy,value:10,type});remaining-=10;assert.equal(enemy.shield,remaining);assert.equal(enemy.hp,hp);}
 advance(b,30);assert.equal(enemy.shield,enemy.maxHp*.1);assert.equal(enemy.shieldLayers.filter(l=>l.id==='tombstone-shield').length,1);
});

test('墓碑不产生原地图费用/再部署削弱，旧存档误挂效果在恢复时清理',()=>{
 const {b,g,enemy,allies}=arena('enemy_2008_flking');enemy.canAttack=false;assert.deepEqual(enemy.costEffects,[]);b.refreshEnemyCostEffects();assert.equal(b.s.enemyCostRecoveryMultiplier,1);assert.equal(b.s.enemyRespawnTimeMultiplier,1);
 const respawn=b.stats(allies[0]).respawnTime;assert.equal(b.respawnTime(allies[0]),respawn);
 enemy.costEffects=[{costRecoveryMultiplier:.5,respawnTimeMultiplier:2}];const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);assert.deepEqual(restored.s.enemies[0].costEffects,[]);restored.refreshEnemyCostEffects();assert.equal(restored.s.enemyCostRecoveryMultiplier,1);
});

test('腐败骑士22秒后蓄力4秒，300%主伤害与十字溅射共用一次出手',()=>{
 const {b,enemy,allies}=arena('enemy_1513_dekght',{positions:[[3,3],[4,3],[4,4]]});enemy.canAttack=false;const hits=[];b.hurt=(u,e)=>hits.push({uid:u.uid,atk:e.atk,type:e.damageType});
 advance(b,21.9);assert.equal(enemy.enemyCast,undefined);advance(b,.1);assert.equal(enemy.enemyCast?.knightCharge,true);advance(b,3.9);assert.equal(hits.length,0);advance(b,.1);
 assert.deepEqual(hits,[{uid:allies[0].uid,atk:3,type:'physical'},{uid:allies[1].uid,atk:3,type:'physical'}]);assert.equal(enemy.enemyCast,null);assert.ok(Math.abs(enemy.enemySkills[0].nextAt-48)<.04);
});

test('腐败骑士蓄力受控会取消，目标脱离阻挡不隔空命中；中途存档继续剩余时间',()=>{
 const {b,g,enemy,allies}=arena('enemy_1513_dekght');enemy.canAttack=false;b.hurt=()=>{};advance(b,23);const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);let restoredHits=0;restored.hurt=()=>restoredHits++;advance(restored,3.1);assert.equal(restoredHits,1);
 applyStatus(enemy,'stun',1);b.step();assert.equal(enemy.enemyCast,null);assert.equal(enemy.formHold,false);
 enemy.enemySkills[0].nextAt=b.s.time;advance(b,1.1);assert.equal(enemy.enemyCast?.knightCharge,true);allies[0].x=8;let hits=0;b.hurt=()=>hits++;advance(b,4.1);assert.equal(hits,0);
});

test('凋零骑士普攻为法术，同伴退场后实际伤害与攻速增加且移速为2.5倍',()=>{
 const {b,enemy,allies}=arena('enemy_1513_dekght_2',{x:3,y:4,positions:[[3,3]]}),u=allies[0],stats=b.stats.bind(b);b.stats=a=>({...stats(a),def:0,magicResistance:0,maxHp:50000});u.hp=50000;b.economy.random=()=>.999;
 b.spawn({id:'enemy_1513_dekght',route:0});const partner=b.s.enemies.at(-1);commitExit(b,{target:partner});assert.equal(enemy.damageType,'arts');assert.equal(enemy.speed,enemy.baseSpeed*2.5);
 const before=u.hp;b.hurt(u,enemy);assert.ok(Math.abs(before-u.hp-1.8)<1e-6);const times=[],record=b.recordEnemyAttack.bind(b);b.recordEnemyAttack=(e,s)=>{times.push(b.s.time);record(e,s);};advance(b,6);assert.ok(times.length>=3);assert.ok(Math.abs(times[1]-times[0]-2)<.04);
});

test('凋零骑士三目标爆炸箭在2.5秒后分别十字爆炸，重叠区域可受到不同箭的伤害',()=>{
 const {b,enemy,allies}=arena('enemy_1513_dekght_2',{x:3,y:4,positions:[[3,3],[2,3],[4,3],[3,2]]});enemy.canAttack=false;const hits=[];b.hurt=(u,e,opts={})=>hits.push({uid:u.uid,amount:opts.damageAmount,type:e.damageType});
 advance(b,22);const arrows=b.s.logicEffects.filter(f=>f.values?.knightBomb);assert.equal(arrows.length,3);assert.ok(arrows.every(f=>f.snapshot.damage===1.6));advance(b,2.4);assert.equal(hits.length,0);advance(b,.1);assert.ok(hits.length>3);assert.ok(hits.every(h=>h.type==='arts'&&h.amount===1.6));assert.ok(hits.filter(h=>h.uid===allies[0].uid).length>=2);assert.equal(b.s.logicEffects.filter(f=>f.values?.knightBomb).length,0);
});

test('爆炸箭读档保留命中标记，来源死亡仍爆炸，已撤退目标的旧标记不追随再部署',()=>{
 const {b,g,enemy,allies}=arena('enemy_1513_dekght_2',{x:3,y:4,positions:[[3,3],[2,3]]});enemy.canAttack=false;advance(b,23);
 const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);restored.spawn({id:'enemy_1007_slime',route:0});restored.s.enemies.at(-1).canAttack=false;commitExit(restored,{target:restored.s.enemies[0]});const hits=[];restored.hurt=(u,e,opts)=>hits.push(opts);advance(restored,1.6);assert.ok(hits.length>0);assert.ok(hits.every(h=>h.sourceLess));
 for(const u of allies){commitExit(b,{target:u,reason:'retreat'});b.deploy(u);applyStatus(u,'disarm',60);}let stale=0;b.hurt=()=>stale++;advance(b,1.6);assert.equal(stale,0);
});

test('迷路巨像未被阻挡也会独立投石，选择最近未晕眩目标而非部署仇恨，先眩晕再伤害',()=>{
 const {b,enemy,allies}=arena('enemy_2003_rockman',{positions:[[5,3],[3,4],[4,4]]});applyStatus(allies[1],'stun',60);allies[2].statusResistance=.5;
 const hits=[];b.hurt=(u,e)=>hits.push({uid:u.uid,atk:e.atk,stun:u.statuses.find(s=>s.kind==='stun')?.remaining});advance(b,12.9);assert.equal(hits.length,0);advance(b,.1);assert.equal(enemy.action?.target,allies[2].uid);
 advance(b,2);assert.equal(hits.length,1);assert.equal(hits[0].uid,allies[2].uid);assert.equal(hits[0].atk,.7);assert.ok(hits[0].stun>12.4&&hits[0].stun<=12.5);assert.ok(allies[2].statuses.find(s=>s.kind==='stun').remaining<12.5,'不能被伤害后通用眩晕分支覆盖成25秒');
 enemy.enemySkills[0].nextAt=b.s.time;b.step();assert.equal(enemy.action?.target,allies[0].uid);
});

test('迷路巨像全体候选已晕眩时保持技能就绪，出现有效目标立即尝试；只投技能、不进行远程普攻',()=>{
 const {b,enemy,allies,strikes}=arena('enemy_2003_rockman',{positions:[[3,4]]});applyStatus(allies[0],'stun',60);advance(b,20);assert.equal(enemy.enemySkills[0].used,false);assert.equal(enemy.enemySkills[0].nextAt,13);assert.equal(strikes.length,0);
 allies[0].statuses=allies[0].statuses.filter(s=>s.kind!=='stun');b.step();assert.equal(enemy.action?.special.prefab,'StunAttack');advance(b,2);assert.equal(strikes.length,1);assert.equal(enemy.ranged,false);
});

test('迷路巨像投石前摇停步，控制中断不发伤害，动作存档恢复后只命中一次',()=>{
 const {b,g,enemy,allies}=arena('enemy_2003_rockman',{positions:[[4,3]]});enemy.enemySkills[0].nextAt=0;enemy.route=[{kind:'move',x:3,y:3},{kind:'move',x:3,y:6},{kind:'wait',time:600}];enemy.cmd=0;b.step();const x=enemy.x,y=enemy.y;advance(b,.2);assert.equal(enemy.x,x);assert.equal(enemy.y,y);
 const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);let hits=0;restored.hurt=()=>hits++;advance(restored,2);assert.equal(hits,1);
 applyStatus(enemy,'stun',1);b.step();assert.equal(enemy.action,null);assert.equal(enemy.enemyCast,null);assert.equal(allies[0].statuses.some(s=>s.kind==='stun'),false);assert.ok(enemy.enemySkills[0].nextAt>b.s.time+12.9);
});

test('纠缠藤蔓两次普攻回满2SP，第三次技能消耗一次并施加可被抵抗缩短的15秒眩晕',()=>{
 const {b,enemy,allies}=arena('enemy_2052_smgia');allies[0].statusResistance=.5;const stuns=[];b.hurt=(u,e)=>{const stun=u.statuses.find(s=>s.kind==='stun');if(stun)stuns.push(stun.remaining);};
 advance(b,4.1);assert.equal(enemy.sp,2);assert.equal(stuns.length,0);advance(b,3);assert.equal(enemy.sp,0);assert.equal(stuns.length,1);assert.ok(stuns[0]>7.4&&stuns[0]<=7.5);assert.equal(enemy.attackCount,3);
});

test('陷落雪祀普通攻击逐跳找1.6半径内不同目标，三跳衰减并施加寒冷，只计一次普通攻击',()=>{
 const {b,enemy,allies}=arena('enemy_2050_smsha',{x:3,y:4,positions:[[5,4],[6,4],[7,4],[5,2]]});allies[2].flying=true;enemy.enemySp={type:'INCREASE_WHEN_ATTACK',max:10,increment:1};enemy.sp=0;
 applyStatus(enemy,'silence',60);const hits=[];b.hurt=(u,e)=>hits.push({uid:u.uid,atk:e.atk,type:e.damageType,cold:u.statuses.some(s=>s.kind==='cold')});advance(b,1.7);
 assert.deepEqual(hits.map(h=>h.uid),allies.slice(0,3).map(u=>u.uid));[1,.85,.85*.85].forEach((v,i)=>assert.ok(Math.abs(hits[i].atk-v)<1e-9));assert.ok(hits.every(h=>h.type==='arts'&&h.cold));assert.equal(enemy.attackCount,1);assert.equal(enemy.sp,1);
});

test('雪祀连续攻击施加敌方冻结并续冻，真实法术伤害不误吃减15法抗',()=>{
 const {b,enemy,allies:[u]}=arena('enemy_2050_smsha');enemy.interval=1;const res=b.stats(u).magicResistance;
 const durations=[],hurt=b.hurt.bind(b);b.hurt=(target,e,opts)=>{const frozen=target.statuses.find(s=>s.kind==='frozen');if(frozen)durations.push(frozen.remaining);hurt(target,e,opts);};
 advance(b,3.2);assert.ok(durations.length>=2);assert.ok(durations.every(n=>n===4.5));assert.equal(b.stats(u).magicResistance,res);assert.equal(statusAttributeChanges(u).resistance,0);assert.equal(permissions(u).skill,false);
 const hp=u.hp;dealDamage(b,{source:enemy,target:u,amount:100,type:'arts',cause:'skill'});assert.ok(Math.abs(hp-u.hp-100*(1-res/100))<1e-6);
});

test('两类寒冷在实战与JSON恢复中保持独立，来源退场后敌方冻结仍正常到期',()=>{
 const {b,g,enemy,allies:[u]}=arena('enemy_2050_smsha');enemy.interval=1;applyStatus(u,'cold',10,{source:u.uid,resistible:false});advance(b,.5);
 assert.equal(u.statuses.filter(s=>s.kind==='cold').length,2);assert.equal(u.statuses.some(s=>s.kind==='frozen'),false);advance(b,1);
 assert.ok(u.statuses.some(s=>s.kind==='frozen'&&s.frostSide==='enemy'));assert.ok(u.statuses.some(s=>s.kind==='cold'&&s.frostSide==='ally'));
 b.s.queue.push({id:'enemy_1007_slime',route:0,at:100});commitExit(b,{target:enemy});
 const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);const copy=restored.s.units[0];
 advance(restored,1);assert.equal(permissions(copy).skill,false);assert.equal(statusAttributeChanges(copy).resistance,0);
 advance(restored,4);assert.equal(copy.statuses.some(s=>s.kind==='frozen'),false);assert.ok(copy.statuses.some(s=>s.kind==='cold'&&s.frostSide==='ally'));
});

test('乌顶巨角卢鲁阻挡后优先蓄力，6.6秒才命中，8秒结束技能',()=>{
 const {b,enemy,allies}=arena('enemy_10144_xdelk_2');b.step();const started=b.s.time;
 assert.equal(enemy.enemyCast?.charge,true);const hp=allies[0].hp;advance(b,6.5);assert.equal(allies[0].hp,hp);
 advance(b,.1);assert.ok(allies[0].hp<hp);assert.equal(enemy.enemyCast.hitAttempted,true);
 advance(b,1.4);assert.equal(enemy.enemyCast,null);assert.equal(enemy.enemyLostUntil,undefined);assert.ok(Math.abs(enemy.enemySkills[0].nextAt-(started+28))<.04);
});

test('卢鲁蓄力遭眩晕中断进入4秒失落，失去目标则结束后失落5秒',()=>{
 const controlled=arena('enemy_10144_xdelk_2');controlled.b.step();applyStatus(controlled.enemy,'stun',1);controlled.b.step();
 assert.equal(controlled.enemy.enemyCast,null);assert.equal(controlled.enemy.canAttack,false);const end=controlled.enemy.enemyLostUntil;
 assert.ok(Math.abs(end-controlled.b.s.time-4)<1e-8);advance(controlled.b,3);assert.equal(controlled.enemy.canAttack,false);advance(controlled.b,1.1);assert.equal(controlled.enemy.canAttack,true);
 const escaped=arena('enemy_10144_xdelk_2');escaped.b.step();escaped.allies[0].x=8;escaped.allies[0].y=5;advance(escaped.b,8);
 assert.equal(escaped.enemy.enemyCast,null);assert.equal(escaped.enemy.canAttack,false);assert.ok(Math.abs(escaped.enemy.enemyLostUntil-escaped.b.s.time-5)<.04);
});

test('帝国炮火锁定发射时位置，3秒后爆炸；原目标移开能避开，后来进入者受伤',()=>{
 const {b,enemy,allies}=arena('enemy_1112_emppnt',{x:3,y:5,positions:[[3,3],[7,3]]});
 for(let i=0;i<600&&!b.s.enemyProjectiles.length;i++)b.step();assert.equal(b.s.enemyProjectiles.length,1);enemy.canAttack=false;
 const shot=b.s.enemyProjectiles[0],hp=allies.map(u=>u.hp);assert.equal(shot.targetX,3);assert.equal(shot.targetY,3);
 allies[0].x=7;allies[1].x=3;allies[1].y=4;advance(b,2.9);assert.deepEqual(allies.map(u=>u.hp),hp);
 advance(b,.1);assert.equal(allies[0].hp,hp[0]);assert.ok(allies[1].hp<hp[1]);assert.equal(b.s.enemyProjectiles.length,0);
});

test('帝国炮火发射者死亡不撤销已发射炮弹，命中使用缓存攻击力且没有来源uid',()=>{
 const {b,enemy,allies}=arena('enemy_1112_emppnt_2',{x:3,y:5});
 for(let i=0;i<600&&!b.s.enemyProjectiles.length;i++)b.step();const amount=b.s.enemyProjectiles[0].amount;
 enemy.atk=10000;b.s.queue.push({id:'enemy_1007_slime',route:0,at:100});commitExit(b,{target:enemy});
 const hits=[],hurt=b.hurt.bind(b);b.hurt=(u,e,opts)=>{hits.push({atk:e.atk,uid:e.uid});hurt(u,e,opts);};const hp=allies[0].hp;
 advance(b,3);assert.equal(b.s.enemies.length,0);assert.equal(hits.length,1);assert.equal(hits[0].atk,amount);assert.equal(hits[0].uid,undefined);assert.ok(allies[0].hp<hp);
});

test('位置炮弹跨JSON存档保留落点与剩余时间，非法数值存档拒绝恢复',()=>{
 const {b,g,enemy}=arena('enemy_1112_emppnt',{x:3,y:5});
 for(let i=0;i<600&&!b.s.enemyProjectiles.length;i++)b.step();enemy.canAttack=false;advance(b,1);
 const saved=JSON.parse(JSON.stringify(b.s)),restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,saved);assert.ok(restored);
 const hp=restored.s.units[0].hp;advance(restored,1.9);assert.equal(restored.s.units[0].hp,hp);advance(restored,.1);assert.ok(restored.s.units[0].hp<hp);
 saved.enemyProjectiles[0].amount=null;assert.equal(NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,saved),null);
});

test('位置炮弹轨迹/预警绘制不写战斗状态，减少特效时仍保留落点圈',()=>{
 const state={time:1,enemyProjectiles:[{startedAt:0,impactAt:3,startX:1,startY:1,targetX:3,targetY:3,radius:1.2,amount:10}]},before=JSON.stringify(state),ops=[];
 const c={save(){},restore(){},beginPath(){},ellipse(){ops.push('circle');},stroke(){},arc(){ops.push('shot');},fill(){}};
 assert.equal(drawEnemyProjectiles(c,(x,y)=>({x:x*20,y:y*10}),{tw:40,th:20},{s:state}),true);assert.deepEqual(ops,['circle','shot']);
 ops.length=0;drawEnemyProjectiles(c,(x,y)=>({x,y}),{tw:40,th:20},{s:state},{reduceFx:true});assert.deepEqual(ops,['circle']);assert.equal(JSON.stringify(state),before);
});

test('帝国炮火无来源伤害不会让荆棘对伪造攻击者进行反伤',()=>{
 const {b,enemy,allies}=arena('enemy_1112_emppnt',{x:3,y:5});
 const [chessId,p]=Object.entries(NATIVE_DATA.profiles).find(([,p])=>p.charId==='char_136_hsguma'),u=allies[0];
 u.id='char_136_hsguma';u.chessId=chessId;u.source={...u.source,charId:u.id,chessId,skillIndex:1};u.hp=u.maxHp=p.attributes.maxHp;b.economy.random=()=>.99;
 for(let i=0;i<600&&!b.s.enemyProjectiles.length;i++)b.step();enemy.canAttack=false;const hp=u.hp;advance(b,3);
 assert.ok(u.hp<hp);assert.equal(b.s.logicLog.some(x=>x.cause==='reflect'),false);assert.ok(b.s.logicLog.filter(x=>x.type==='damage').every(x=>Number.isFinite(x.hp)));
});
