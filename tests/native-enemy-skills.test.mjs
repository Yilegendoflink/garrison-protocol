import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';
import {NativeBattle} from '../dist/native-battle.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {applyStatus} from '../dist/status.js';
import {dealDamage,applyLoss,commitExit,enemyWineBuffs} from '../dist/native-effects.js';
import {changeEnemySp} from '../dist/native-enemy-skills.js';

function arena(){
 const g=new NativeSession(NATIVE_DATA,{seed:42});g.s.funds=100;assert.ok(g.perform('buy',0));
 const unit=g.s.units[0];let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(unit.uid,x,y))placed=g.deploy(unit.uid,x,y,0);
 assert.ok(placed);assert.ok(g.perform('start'));const b=g.battle;
 b.s.queue=[];b.s.enemies=[];b.s.limit=1000;const ally=b.s.units[0];b.s.units=[];
 const events=[],emit=b.emit.bind(b);b.emit=(kind,row)=>{events.push({kind,...row,time:b.s.time});emit(kind,row);};
 return {b,g,ally,events};
}
function spawn(b,id,x=3,y=3,raw=NATIVE_DATA.enemies[id]){
 raw??=NATIVE_DATA.enemyDependencies[id];
 const origin=b.map.origin,spot={col:origin.col+x,row:origin.row-y};
 b.level={...b.level,routes:[{motionMode:raw.motion,startPosition:spot,endPosition:spot,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...b.level.enemyProfiles,[id]:raw}};
 b.spawn({id,route:0});return b.s.enemies.at(-1);
}
function advance(b,seconds){for(let i=0;i<Math.round(seconds*30);i++)b.step();}
function addAlly(b,ally,x,y){ally.x=x;ally.y=y;ally.deployed=true;ally.hp=ally.maxHp;applyStatus(ally,'disarm',600);b.s.units.push(ally);}

test('重弩蓄力1.4秒后只命中射线首个单位，迷彩可挡箭且眩晕可抵抗',()=>{
 const {b,ally}=arena(),e=spawn(b,'enemy_1404_msnip',2,3);addAlly(b,ally,6,3);const near=structuredClone(ally);near.uid+=100;near.x=4;near.statusResistance=.5;applyStatus(near,'camouflage',60);b.s.units.push(near);e.atk=1;
 const hits=[];b.hurt=(u,source)=>hits.push(u.uid);advance(b,2);assert.ok(e.enemyCast?.crossShot);assert.equal(e.invisible,false);advance(b,1.3);assert.equal(hits.length,0);advance(b,.1);
 assert.deepEqual(hits,[near.uid]);assert.ok(Math.abs(near.statuses.find(s=>s.kind==='stun').remaining-(2.5-1/30))<1e-8);assert.equal(ally.statuses.some(s=>s.kind==='stun'),false);
 advance(b,.6);assert.equal(e.enemyCast,null);assert.equal(e.formInvisible,true);assert.ok(Math.abs(e.enemySkills[0].nextAt-12)<.04);
});

test('重弩阻挡时不触发直击，斜线范围外无目标时不触发',()=>{
 const {b,ally}=arena(),e=spawn(b,'enemy_1404_msnip');addAlly(b,ally,3,3);e.atk=1;advance(b,3);assert.equal(e.enemySkills[0].used,false);assert.ok(!e.enemyCast);
 ally.x=5;ally.y=5;advance(b,3);assert.ok(!e.enemyCast);assert.equal(e.enemySkills[0].used,false);
});

test('重弩直击方向跨JSON保留，原目标移走时命中后来进入该射线的单位',()=>{
 const {b,g,ally}=arena(),e=spawn(b,'enemy_1404_msnip',2,3);addAlly(b,ally,6,3);e.atk=1;advance(b,2.5);
 const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);const target=restored.s.units[0];target.y=5;const next=structuredClone(target);next.uid+=100;next.x=4;next.y=3.4;restored.s.units.push(next);
 const hits=[];restored.hurt=u=>hits.push(u.uid);advance(restored,.9);assert.deepEqual(hits,[next.uid]);
});

test('重弩蓄力被沉默中断后不射击，恢复隐匿且只开始一次8秒冷却',()=>{
 const {b,ally}=arena(),e=spawn(b,'enemy_1404_msnip',2,3);addAlly(b,ally,6,3);advance(b,2.5);applyStatus(e,'silence',20);b.step();const end=e.enemySkills[0].nextAt;assert.equal(e.enemyCast,null);assert.equal(e.formInvisible,true);
 const hits=[];b.hurt=u=>hits.push(u.uid);advance(b,3);assert.equal(hits.length,0);assert.equal(e.enemySkills[0].nextAt,end);
});

const iceBugRaw=Object.values(NATIVE_DATA.levels).map(l=>l.enemyProfiles?.enemy_1067_snslime).find(Boolean);
const chaliceRaw=Object.values(NATIVE_DATA.levels).map(l=>l.enemyProfiles?.enemy_1430_lrrook).find(Boolean);

test('魂灵圣杯按伤害结算后保留5%，余量由圣杯承担真实伤害，重叠圣杯不重复保护',()=>{
 const {b}=arena(),a=spawn(b,'enemy_1430_lrrook',3,3,chaliceRaw),c=spawn(b,'enemy_1430_lrrook',3,3,chaliceRaw),target=spawn(b,'enemy_1007_slime',4,3);a.canAttack=c.canAttack=target.canAttack=false;b.step();target.def=100;target.res=50;
 const hp=target.hp,ahp=a.hp,chp=c.hp;dealDamage(b,{target,amount:200,type:'physical'});assert.equal(hp-target.hp,5);assert.equal(ahp-a.hp,95);assert.equal(c.hp,chp);
 const before=target.hp,next=a.hp;dealDamage(b,{target,amount:200,type:'arts'});assert.equal(before-target.hp,5);assert.equal(next-a.hp,95);assert.equal(a.res,30,'承担伤害不再扣一次圣杯法抗');
});

test('圣杯分摊在次数护盾/屏障之后，真实伤害可分摊，生命流失与斩杀标记绕过',()=>{
 const {b}=arena(),cup=spawn(b,'enemy_1430_lrrook',3,3,chaliceRaw),target=spawn(b,'enemy_1007_slime',4,3);target.shield=60;const chp=cup.hp,hp=target.hp;
 dealDamage(b,{target,value:100,type:'true'});assert.equal(hp-target.hp,2);assert.equal(chp-cup.hp,38);target.barriers=[{charges:1}];const before=cup.hp;dealDamage(b,{target,value:100,type:'true'});assert.equal(cup.hp,before);
 const thp=target.hp;applyLoss(b,{target,amount:10});dealDamage(b,{target,value:10,type:'true',execution:true});assert.equal(thp-target.hp,20);assert.equal(cup.hp,before);
});

test('圣杯消失/死亡或离开圆形范围立即失效，飞行与孤立目标不被保护，存档维持单一来源',()=>{
 const {b,g}=arena(),cup=spawn(b,'enemy_1430_lrrook',3,3,chaliceRaw),target=spawn(b,'enemy_1007_slime',4,3);cup.canAttack=target.canAttack=false;b.step();dealDamage(b,{target,value:100,type:'true'});assert.equal(target.chaliceUid,cup.uid);
 const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);const c=restored.s.enemies.find(e=>e.uid===cup.uid),t=restored.s.enemies.find(e=>e.uid===target.uid);let hp=c.hp;dealDamage(restored,{target:t,value:100,type:'true'});assert.equal(hp-c.hp,95);
 for(const mode of ['hidden','outside','air','isolated']){c.hidden=mode==='hidden';t.x=mode==='outside'?5:4;t.y=mode==='outside'?5:3;t.flying=mode==='air';t.isolated=mode==='isolated';hp=c.hp;const before=t.hp;dealDamage(restored,{target:t,value:10,type:'true'});assert.equal(before-t.hp,10);assert.equal(c.hp,hp);}
 c.hidden=false;t.isolated=false;t.flying=false;commitExit(restored,{target:c});hp=t.hp;dealDamage(restored,{target:t,value:10,type:'true'});assert.equal(hp-t.hp,10);
});
const iceBreakerRaw=Object.values(NATIVE_DATA.levels).map(l=>l.enemyProfiles?.enemy_1069_icebrk_2).find(Boolean);

test('破冰者在命中时对冻结目标按300%攻击扣防，冻结不解除阻挡且解冻后恢复',()=>{
 const {b,ally}=arena(),e=spawn(b,'enemy_1069_icebrk_2',3,3,iceBreakerRaw);addAlly(b,ally,3,3);b.map=structuredClone(b.map);b.map.grid[3][3].heightType='LOWLAND';e.atk=e.baseAtk=200;
 const stats=b.stats.bind(b);b.stats=u=>({...stats(u),def:100,maxHp:100000});ally.hp=ally.maxHp=100000;
 const damage=[],hurt=b.hurt.bind(b);b.hurt=(u,source,opts)=>{const hp=u.hp;hurt(u,source,opts);damage.push(hp-u.hp);};b.step();assert.ok(e.action);applyStatus(ally,'frozen',2,{frostSide:'enemy'});applyStatus(e,'silence',30);advance(b,1);
 assert.equal(e.block,ally.uid);assert.deepEqual(damage,[500]);assert.equal(e.atk,200);advance(b,3);assert.equal(damage[1],100);assert.equal(e.atk,200);
});

test('破冰者只对冻结增伤，寒冷无加成；倍率取黑板且不因多层冻结叠乘',()=>{
 const {b,ally}=arena(),e=spawn(b,'enemy_1069_icebrk_2',3,3,iceBreakerRaw);addAlly(b,ally,3,3);e.atk=100;
 applyStatus(ally,'cold',10,{frostSide:'enemy'});assert.equal(b.enemyAttackDamage(e,1,ally),100);
 applyStatus(ally,'cold',10,{frostSide:'enemy'});applyStatus(ally,'frozen',10,{source:999});assert.equal(b.enemyAttackDamage(e,1,ally),300);
 e.enemyTalent['atkup.atk_scale']=2.5;assert.equal(b.enemyAttackDamage(e,1,ally),250);ally.statuses=[];assert.equal(b.enemyAttackDamage(e,1,ally),100);
});

test('破冰者与冻结目标跨存档保留阻挡与条件倍率，眩晕仍会解除阻挡',()=>{
 const {b,g,ally}=arena(),e=spawn(b,'enemy_1069_icebrk_2',3,3,iceBreakerRaw);addAlly(b,ally,3,3);b.map=structuredClone(b.map);b.map.grid[3][3].heightType='LOWLAND';e.atk=1;applyStatus(ally,'frozen',10,{frostSide:'enemy'});b.step();
 const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);restored.step();const enemy=restored.s.enemies[0],target=restored.s.units[0];assert.equal(enemy.block,target.uid);assert.equal(restored.enemyAttackDamage(enemy,1,target),3);
 applyStatus(target,'stun',10);restored.step();assert.equal(enemy.block,null);
});

test('关卡冰爆虫死亡1秒后半径1.65爆炸，命中迷彩地面单位但不对空，并施加敌方寒冷',()=>{
 const {b,ally}=arena();addAlly(b,ally,4.5,3);applyStatus(ally,'camouflage',60);ally.statusResistance=.5;
 const air=structuredClone(ally);air.uid+=100;air.x=3;air.flying=true;b.s.units.push(air);b.s.queue.push({id:'enemy_1007_slime',route:0,at:100});
 const e=spawn(b,'enemy_1067_snslime',3,3,iceBugRaw);e.atk=1;const hits=[];b.hurt=(u,source,opts)=>hits.push({uid:u.uid,atk:source.atk,...opts});commitExit(b,{target:e});advance(b,.9);assert.equal(hits.length,0);advance(b,.1);
 assert.equal(hits.length,1);assert.equal(hits[0].uid,ally.uid);assert.equal(hits[0].atk,2);assert.equal(hits[0].sourceLess,true);assert.equal(hits[0].cause,'extra');assert.equal(ally.statuses.find(s=>s.kind==='cold').frostSide,'enemy');assert.equal(ally.statuses.find(s=>s.kind==='cold').remaining,5);
});

test('冰爆虫两次死亡寒冷转冻结，延迟爆炸可跨JSON，死亡点外的单位不受控制',()=>{
 const {b,g,ally}=arena();addAlly(b,ally,4,3);const far=structuredClone(ally);far.uid+=100;far.x=5;far.y=5;b.s.units.push(far);b.s.queue.push({id:'enemy_1007_slime',route:0,at:100});
 for(let i=0;i<2;i++){const e=spawn(b,'enemy_1067_snslime',3,3,iceBugRaw);e.atk=1;commitExit(b,{target:e});}advance(b,.5);
 const saved=JSON.parse(JSON.stringify(b.s)),restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,saved);assert.ok(restored);advance(restored,.5);assert.ok(restored.s.units[0].statuses.some(s=>s.kind==='frozen'&&s.frostSide==='enemy'));assert.ok(!restored.s.units[1].statuses.some(s=>s.kind==='cold'||s.kind==='frozen'));
 saved.enemyProjectiles[0].cold=-1;assert.equal(NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,saved),null);
});

test('冰爆虫沉默或漏怪不爆炸，坠落死亡仍触发且不重复排队',()=>{
 for(const reason of ['silence','leak','fall']){
  const {b}=arena(),e=spawn(b,'enemy_1067_snslime',3,3,iceBugRaw);if(reason==='silence')applyStatus(e,'silence',10);
  commitExit(b,{target:e,reason:reason==='silence'?'death':reason});commitExit(b,{target:e});assert.equal(b.s.enemyProjectiles.length,reason==='fall'?1:0);
 }
});

function deathEyeArena(){
 const scene=arena(),{b,ally}=scene,e=spawn(b,'enemy_1275_dwlock_2',3,3);addAlly(b,ally,4,3);e.atk=e.baseAtk=1;
 for(let i=0;i<600&&!e.deathEye;i++)b.step();assert.ok(e.deathEye);return {...scene,e};
}

test('死亡之眼期间沉默反制，八次持续伤害后终结，24秒CD从施法完成开始',()=>{
 const {b,e,ally}=deathEyeArena(),end=e.deathEye.endsAt;assert.equal(e.immunities.silence,true);assert.equal(applyStatus(e,'silence',30),false);
 const before=b.s.logicLog.filter(x=>x.type==='damage'&&x.cause==='dot'&&x.sourceUid===e.uid).length;advance(b,8.1);
 const hits=b.s.logicLog.filter(x=>x.type==='damage'&&x.cause==='dot'&&x.sourceUid===e.uid);assert.equal(hits.length-before,8);assert.equal(e.deathEye,null);assert.equal(e.enemyCast,null);assert.ok(!e.immunities.silence);assert.ok(ally.elemental.necrosis>0);
 assert.ok(Math.abs(e.enemySkills[0].nextAt-(end+24))<.04);assert.equal(applyStatus(e,'silence',1),true);
});

test('死亡之眼受眩晕或缴械中断不结算终结凋亡，恢复沉默可施加并进入冷却',()=>{
 for(const control of ['stun','disarm']){
  const {b,e,ally}=deathEyeArena();advance(b,1);const injury=ally.elemental?.necrosis||0;applyStatus(e,control,3);b.step();const stopped=b.s.time;
  assert.equal(e.deathEye,null);assert.equal(e.enemyCast,null);assert.ok(!e.immunities.silence);assert.ok(Math.abs(e.enemySkills[0].nextAt-stopped-24)<1e-8);assert.equal(ally.elemental?.necrosis||0,injury);
 }
});

test('死亡之眼引导存档保留沉默反制与目标代次，同UID再部署立即断开',()=>{
 const {b,g,e}=deathEyeArena();advance(b,2);const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);const caster=restored.s.enemies[0],target=restored.s.units[0];assert.equal(applyStatus(caster,'silence',10),false);
 target.deployGen++;const hp=target.hp;restored.step();assert.equal(caster.deathEye,null);assert.equal(caster.enemyCast,null);assert.ok(!caster.immunities.silence);assert.equal(target.hp,hp);
});

test('死亡之眼在启动前摇失去目标也终止，不能锁上再部署的同UID',()=>{
 const {b,ally}=arena(),e=spawn(b,'enemy_1275_dwlock_2');addAlly(b,ally,4,3);e.atk=1;
 for(let i=0;i<600&&!e.enemyCast;i++)b.step();assert.ok(e.action);assert.equal(e.deathEye,undefined);assert.equal(e.immunities.silence,true);
 ally.deployGen++;b.step();assert.equal(e.action,null);assert.equal(e.enemyCast,null);assert.ok(!e.deathEye);assert.ok(!e.immunities.silence);
});

function crownArena(){
 const scene=arena(),{b,ally}=scene,e=spawn(b,'enemy_1502_crowns');e.atk=1;advance(b,15);
 b.map=structuredClone(b.map);for(let x=2;x<=7;x++)Object.assign(b.map.grid[3][x],{heightType:'LOWLAND',passableMask:'ALL',obstacle:false});
 e.route=[{kind:'move',x:3,y:3},{kind:'move',x:4,y:3},{kind:'move',x:5,y:3},{kind:'move',x:7,y:3,checkpointIndex:1},{kind:'wait',x:7,y:3,time:600}];e.cmd=1;e.cmdLeft=null;addAlly(b,ally,3,3);return {...scene,e};
}

test('弑君者阻挡后闪现：0.5秒前摇、精确1.5格、1秒保护与触发即开始15秒CD',()=>{
 const {b,e}=crownArena();b.step();const start=b.s.time;assert.ok(e.crownBlink);assert.equal(e.block,null);assert.equal(e.invulnerable,true);assert.equal(e.shiftImmune,true);assert.equal(e.unblockable,true);assert.equal(e.enemySkills[0].nextAt,start+15);
 const hp=e.hp;dealDamage(b,{target:e,amount:100,type:'true'});assert.equal(e.hp,hp);advance(b,14/30);assert.equal(e.x,3);advance(b,1/30);assert.equal(e.x,4.5);assert.equal(e.y,3);assert.equal(e.invulnerable,true);
 advance(b,.5);assert.equal(e.crownBlink,null);assert.equal(e.invulnerable,false);assert.equal(e.shiftImmune,false);assert.equal(e.unblockable,false);assert.ok(e.x>=4.5,'不退回被跨过的寻路展开点');
});

test('弑君者闪现前摇存档恢复，落点占有者不阻止传送，保护结束仍可再次阻挡',()=>{
 const {b,g,e,ally}=crownArena();b.step();advance(b,.3);const copy=structuredClone(ally);copy.uid+=100;copy.x=4.5;b.s.units.push(copy);
 const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);const crown=restored.s.enemies[0];advance(restored,.2);assert.equal(crown.x,4.5);assert.equal(crown.block,null);
 advance(restored,.6);assert.equal(crown.block,copy.uid);assert.equal(crown.enemySkills[0].used,true);assert.equal(restored.s.events.filter(e=>e.type==='move'&&e.mode==='blink').length,1);
});

test('弑君者不可通行落点不传送且不获无敌，仍消费CD和给予1秒不可阻挡',()=>{
 const {b,e}=crownArena();b.map.grid[3][5].passableMask='FLY_ONLY';applyStatus(e,'root',10);b.step();assert.equal(e.enemySkills[0].used,true);assert.equal(e.unblockable,true);assert.equal(!!e.invulnerable,false);advance(b,1.1);assert.equal(e.x,3);assert.equal(e.unblockable,false);
});

test('弑君者闪现受沉默限制，未阻挡不释放，未就绪也不释放',()=>{
 const {b,e,ally}=crownArena();applyStatus(e,'silence',1);advance(b,.5);assert.equal(e.enemySkills[0].used,false);e.statuses=[];ally.x=0;applyStatus(e,'root',10);advance(b,.5);assert.equal(e.enemySkills[0].used,false);
 ally.x=e.x;e.enemySkills[0].nextAt=b.s.time+2;e.attackCooldown=0;b.step();assert.equal(e.enemySkills[0].used,false);
});

test('弑君者按原始路径点方向跨过绕路展开点，落地重新寻路且不修改共享路线',()=>{
 const {b,e}=crownArena(),route=[{kind:'move',x:3,y:3},{kind:'move',x:3,y:4},{kind:'move',x:4,y:4},{kind:'move',x:5,y:4},{kind:'move',x:7,y:3,checkpointIndex:1},{kind:'wait',x:7,y:3,time:600}];e.route=route;e.cmd=1;const before=JSON.stringify(route);
 b.step();advance(b,.5);assert.equal(e.x,4.5);assert.equal(e.y,3);assert.equal(e.route[e.cmd].y,3);assert.ok(e.route[e.cmd].x>e.x);assert.equal(JSON.stringify(route),before);assert.notEqual(e.route,route);assert.ok(e.route.some(p=>p.checkpointIndex===1));
});

test('弑君者直线跨过原始检查点后跳过对应停驻，保留下一检查点',()=>{
 const {b,e}=crownArena();e.route=[{kind:'move',x:3,y:3},{kind:'move',x:4,y:3,checkpointIndex:1},{kind:'wait',x:4,y:3,time:600,checkpointIndex:2},{kind:'move',x:7,y:3,checkpointIndex:3},{kind:'wait',x:7,y:3,time:600}];e.cmd=1;
 b.step();advance(b,.5);assert.equal(e.x,4.5);assert.equal(e.lastCheckpoint,2);assert.equal(e.route[e.cmd].kind,'move');assert.ok(e.route.slice(e.cmd).some(p=>p.checkpointIndex===3));assert.equal(e.route.slice(e.cmd).some(p=>p.checkpointIndex===2),false);
});

test('弑君者斜向闪现跨过近检查点时，跳过此前的绕行格与该点停驻',()=>{
 const {b,e}=crownArena();Object.assign(b.map.grid[4][4],{passableMask:'ALL',obstacle:false});e.route=[{kind:'move',x:3,y:3},{kind:'move',x:3,y:4},{kind:'move',x:4,y:4,checkpointIndex:1},{kind:'wait',x:4,y:4,time:600,checkpointIndex:2},{kind:'move',x:7,y:3,checkpointIndex:3}];e.cmd=1;
 b.step();advance(b,.5);assert.ok(Math.abs(e.x-(3+1.5/Math.SQRT2))<1e-8);assert.equal(e.lastCheckpoint,2);assert.equal(e.route.slice(e.cmd).some(p=>p.kind==='wait'),false);assert.ok(e.route.slice(e.cmd).some(p=>p.checkpointIndex===3));
});

test('弑君者停驻时没有行动目标则使用最近实际移动方向',()=>{
 const {b,e,ally}=crownArena();ally.x=0;b.step();const x=e.x;assert.ok(x>3);assert.equal(e.moveDirection.x,1);
 e.route=[{kind:'wait',x:e.x,y:e.y,time:600}];e.cmd=0;e.cmdLeft=null;ally.x=e.x;e.attackCooldown=0;b.step();advance(b,.5);assert.ok(Math.abs(e.x-x-1.5)<1e-8);
});

test('弑君者前摇内落点变成不可通行时不传送，保护按原期限结束',()=>{
 const {b,e}=crownArena();b.step();b.map.grid[3][5].passableMask='NONE';applyStatus(e,'root',10);advance(b,.5);assert.equal(e.x,3);assert.equal(e.invulnerable,true);advance(b,.5);assert.equal(e.invulnerable,false);assert.equal(e.unblockable,false);
});

test('弑君者落地后原检查点不可达时停留，存档后通路恢复才重新接路',()=>{
 const {b,g,e}=crownArena();for(const [x,y]of [[6,3],[7,2],[7,4],[8,3]])if(b.map.grid[y]?.[x])b.map.grid[y][x].passableMask='NONE';
 b.step();advance(b,1.1);assert.equal(e.x,4.5);assert.ok(e.crownRejoin);assert.equal(e.formHold,true);assert.equal(e.invulnerable,false);
 const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);const crown=restored.s.enemies[0];advance(restored,.2);assert.equal(crown.x,4.5);
 restored.map.grid[3][6].passableMask='ALL';restored.step();assert.equal(crown.crownRejoin,null);assert.equal(crown.formHold,false);assert.ok(crown.x>4.5);
});

test('暴鸰等待技能初始CD且只投弹一次，九格溅射包含迷彩，结束后移速翻倍而非普通攻击',()=>{
 const {b,ally}=arena(),e=spawn(b,'enemy_1040_bombd',3,3);e.atk=e.baseAtk=100;
 addAlly(b,ally,4,3);const splash=structuredClone(ally),outside=structuredClone(ally);splash.uid+=100;splash.x=5;splash.y=4;outside.uid+=101;outside.x=6;
 applyStatus(splash,'camouflage',600);b.s.units.push(splash,outside);applyStatus(e,'silence',60);
 const hits=[];b.resolveEnemyStrike=(enemy,target)=>hits.push(target.uid);const speed=e.speed;
 advance(b,.9);assert.equal(e.enemyCast,undefined);assert.equal(hits.length,0);advance(b,.2);assert.equal(e.enemyCast?.bomb,true);
 advance(b,2);assert.deepEqual(hits.sort((a,b)=>a-b),[ally.uid,splash.uid].sort((a,b)=>a-b));assert.equal(e.speed,speed*2);assert.equal(e.canAttack,false);assert.equal(e.attackCount,0);
 advance(b,10);assert.equal(hits.length,2);assert.equal(e.enemySkills[0].used,true);
});

test('暴鸰无目标不消耗弹头，前摇受控取消但可重试；技能存档只结算一次',()=>{
 const {b,ally}=arena(),e=spawn(b,'enemy_1040_bombd');advance(b,2);assert.equal(e.enemySkills[0].used,false);
 addAlly(b,ally,4,3);b.step();assert.equal(e.enemyCast.bomb,true);applyStatus(e,'stun',.5);b.step();assert.equal(e.enemyCast,null);assert.equal(e.enemySkills[0].used,false);assert.equal(e.formHold,false);
 advance(b,1.1);assert.equal(e.enemyCast.bomb,true);
 const restored=NativeBattle.restore(NATIVE_DATA,b.economy,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);
 const shots=[];restored.resolveEnemyStrike=(enemy,target)=>shots.push(target.uid);advance(restored,10);assert.equal(shots.length,1);assert.equal(restored.s.enemies[0].enemySkills[0].used,true);assert.equal(restored.s.enemies[0].attackCount,0);
});

test('咸鳞汁携桶三倍速度且不普攻，阻挡后280%强击只一次并留下30秒区域',()=>{
 const {b,ally}=arena(),e=spawn(b,'enemy_10044_wintun');b.map=structuredClone(b.map);b.map.grid[3][3].heightType='LOWLAND';
 assert.equal(e.speed,e.baseSpeed*3);assert.equal(e.canAttack,false);advance(b,1);assert.equal(e.enemySkills[0].used,false);
 const strikes=[];b.resolveEnemyStrike=(enemy,target,packet)=>strikes.push({uid:target.uid,scale:packet.scale});addAlly(b,ally,3,3);b.step();
 assert.equal(e.wineCarrying,false);assert.equal(e.speed,e.baseSpeed);assert.equal(e.canAttack,true);assert.deepEqual(strikes,[{uid:ally.uid,scale:2.8}]);
 const zones=b.s.logicEffects.filter(f=>f.values?.enemyWineBuff);assert.equal(zones.length,1);assert.equal(zones[0].radius,2);assert.equal(zones[0].endsAt-zones[0].startedAt,30);
 advance(b,4);assert.equal(b.s.logicEffects.filter(f=>f.values?.enemyWineBuff).length,1);assert.equal(strikes.filter(s=>s.scale===2.8).length,1);assert.ok(e.attackCount>0);
});

test('咸鳞汁沉默期间失桶但不开技，解除后即使已脱离阻挡也消费一次技能且不生成区域',()=>{
 const {b,ally}=arena(),e=spawn(b,'enemy_10044_wintun');b.map=structuredClone(b.map);b.map.grid[3][3].heightType='LOWLAND';
 addAlly(b,ally,3,3);applyStatus(e,'silence',2);b.step();assert.equal(e.wineCarrying,false);assert.equal(e.enemySkills[0].used,false);
 ally.x=8;ally.y=5;advance(b,3);assert.equal(e.enemySkills[0].used,true);assert.equal(b.s.logicEffects.filter(f=>f.values?.enemyWineBuff).length,0);
});

test('品尝区域只给地面敌人攻速/物理闪避，同名取最高，来源死亡/读档后持续，离开或到期失效',()=>{
 const {b,ally}=arena(),e=spawn(b,'enemy_10044_wintun');b.map=structuredClone(b.map);b.map.grid[3][3].heightType='LOWLAND';
 addAlly(b,ally,3,3);b.resolveEnemyStrike=()=>{};b.step();const fx=b.s.logicEffects.find(f=>f.values?.enemyWineBuff);b.s.logicEffects.push({...structuredClone(fx),id:b.s.settle.nextEffectId++});
 const ground=spawn(b,'enemy_1007_slime',4,3),fly=spawn(b,'enemy_1005_yokai',4,3);ground.isolated=true;ground.canAttack=false;
 assert.deepEqual(enemyWineBuffs(b,ground),{attackSpeed:100,physicalDodge:.8});assert.deepEqual(enemyWineBuffs(b,fly),{attackSpeed:0,physicalDodge:0});
 b.economy.random=()=>.5;let hp=ground.hp;assert.equal(dealDamage(b,{target:ground,value:10,type:'physical',cause:'attack'}).total,0);assert.equal(ground.hp,hp);
 assert.equal(dealDamage(b,{target:ground,value:10,type:'arts',cause:'attack'}).total,10);assert.equal(dealDamage(b,{target:ground,value:10,type:'physical',cause:'dot'}).total,10);
 ground.x=6;assert.equal(dealDamage(b,{target:ground,value:10,type:'physical',cause:'attack'}).total,10);ground.x=4;
 commitExit(b,{target:e,reason:'knockdown'});b.step();assert.equal(enemyWineBuffs(b,ground).attackSpeed,100);
 const restored=NativeBattle.restore(NATIVE_DATA,b.economy,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);const copy=restored.s.enemies.find(x=>x.uid===ground.uid);assert.equal(enemyWineBuffs(restored,copy).attackSpeed,100);
 restored.s.time=fx.endsAt;assert.deepEqual(enemyWineBuffs(restored,copy),{attackSpeed:0,physicalDodge:0});
});

test('品尝区域攻速实际缩短普通攻击间隔，不被通用光环每帧刷新覆盖',()=>{
 const {b,ally}=arena(),e=spawn(b,'enemy_10044_wintun');b.map=structuredClone(b.map);b.map.grid[3][3].heightType='LOWLAND';
 addAlly(b,ally,3,3);b.resolveEnemyStrike=()=>{};const attacks=[],record=b.recordEnemyAttack.bind(b);b.recordEnemyAttack=(enemy,special)=>{attacks.push(b.s.time);record(enemy,special);};
 advance(b,8);assert.ok(attacks.length>=3);assert.ok(Math.abs(attacks[1]-attacks[0]-e.interval/2)<1/30);assert.ok(Math.abs(attacks[2]-attacks[1]-e.interval/2)<1/30);
});

test('简饲源石虫严格低于半血才逃跑，沉默阻止触发，三秒后移速与阻挡恢复且不重复',()=>{
 const {b}=arena(),e=spawn(b,'enemy_10001_trslim');const speed=e.baseSpeed;e.hp=e.maxHp*.5;b.step();assert.equal(e.runUntil,undefined);
 e.hp--;applyStatus(e,'silence',1);b.step();assert.equal(e.runUntil,undefined);advance(b,1);assert.ok(e.runUntil>b.s.time);assert.equal(e.speed,speed*2.5);assert.equal(e.unblockable,true);
 const restored=NativeBattle.restore(NATIVE_DATA,b.economy,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);const r=restored.s.enemies[0];advance(restored,3.1);assert.equal(r.speed,speed);assert.equal(r.unblockable,false);assert.equal(r.runUntil,null);
 r.hp=r.maxHp;restored.step();r.hp=r.maxHp*.1;advance(restored,12);assert.equal(r.speed,speed);assert.equal(r.runUntil,null);assert.equal(r.enemySkills[0].used,true);
});

test('圣堂剑士无攻击目标也每6秒消耗一发弹药，零自然回复且耗尽后停止成长',()=>{
 const {b}=arena(),e=spawn(b,'enemy_10087_hlchgr');const atk=e.atk,speed=e.speed;
 assert.equal(e.sp,5);advance(b,5.9);assert.equal(e.enhanceStacks,undefined);
 applyStatus(e,'silence',60);advance(b,.1);assert.equal(e.sp,4);assert.equal(e.enhanceStacks,1);
 assert.equal(e.atk,atk*1.2);assert.equal(e.speed,speed*1.2);
 advance(b,30);assert.equal(e.sp,0);assert.equal(e.enhanceStacks,5);assert.equal(e.atk,atk*2);
 changeEnemySp(e,99);assert.equal(e.sp,5);advance(b,30);assert.equal(e.enhanceStacks,10);assert.equal(e.sp,0);
});

test('黑云只抓取范围内普通飞行敌人，4秒后吞噬补弹，全弹发射耗尽实际弹药',()=>{
 const {b,ally,events}=arena(),cloud=spawn(b,'enemy_9009_acfort',1,1);
 const drones=[0,1,2,3].map(i=>spawn(b,'enemy_1005_yokai',1+i*.2,2));
 const elite=spawn(b,'enemy_1112_emppnt',1,2);assert.equal(elite.enemyRank,'ELITE');
 const ground=spawn(b,'enemy_1007_slime',1,2),far=spawn(b,'enemy_1005_yokai',9,5);
 advance(b,5);assert.equal(cloud.enemyCast.victims.length,3);assert.equal(cloud.sp,0);
 advance(b,3.9);assert.ok(drones.every(e=>e.hp>0));advance(b,.1);
 assert.equal(drones.filter(e=>e.hp<=0).length,3);assert.equal(cloud.sp,3);
 assert.ok(elite.hp>0&&ground.hp>0&&far.hp>0);assert.equal(b.s.kills,3);
 cloud.atk=1;addAlly(b,ally,8,1);advance(b,.1);
 assert.equal(cloud.sp,0);assert.equal(events.filter(e=>e.kind==='hit'&&e.uid===ally.uid).length,3);
 assert.ok(events.some(e=>e.kind==='enemy-skill-start'&&e.skill==='FireWeapon'));
});

test('黑云吞噬被沉默打断或死亡时解除受害者标记，不补弹也不击杀',()=>{
 for(const exit of ['silence','death']){
  const {b}=arena(),cloud=spawn(b,'enemy_9009_acfort'),victim=spawn(b,'enemy_1005_yokai',3,4);
  advance(b,5);assert.equal(victim.swallowedBy,cloud.uid);
  if(exit==='silence')applyStatus(cloud,'silence',10);else commitExit(b,{target:cloud});
  advance(b,.1);assert.equal(victim.swallowedBy,undefined);assert.ok(victim.hp>0);assert.equal(cloud.sp,0);
 }
});

test('战车使用初始满SP开炮，普通攻击回SP但不产生额外污染圈',()=>{
 const {b,ally}=arena(),e=spawn(b,'enemy_1272_nhtank',3,3);addAlly(b,ally,4,3);e.atk=1;
 assert.equal(e.sp,2);advance(b,1.5);assert.equal(e.sp,0);
 assert.equal(b.s.logicEffects.filter(f=>f.kind==='field').length,1);
 const before=b.s.logicEffects.length;b.resolveEnemyStrike(e,ally,{});b.resolveEnemyAttackEffects(e,ally);
 assert.equal(e.sp,1);assert.equal(b.s.logicEffects.length,before);
});

test('战车两型只选低地非飞行目标，技能100%而阻挡普通攻击200%',()=>{
 for(const id of ['enemy_1272_nhtank','enemy_1272_nhtank_2']){
  const {b,ally}=arena(),e=spawn(b,id,3,3);addAlly(b,ally,4,3);b.map=structuredClone(b.map);e.atk=e.baseAtk=100;
  b.map.grid[3][4].heightType='HIGHLAND';advance(b,2);assert.equal(e.sp,2);assert.equal(e.attackCount,0);
  b.map.grid[3][4].heightType='LOWLAND';ally.flying=true;advance(b,2);assert.equal(e.attackCount,0);
  ally.flying=false;ally.x=3;const hits=[];b.hurt=(_u,source)=>{if(source.uid===e.uid)hits.push(source.atk);};advance(b,1.5);assert.equal(hits[0],100);
  advance(b,4.5);assert.equal(hits[1],200);assert.equal(e.sp,1);assert.equal(b.s.logicEffects.filter(f=>f.kind==='field').length,1);
 }
});

test('战车污染施法失去目标退还2SP，不把眩晕中断误作退款',()=>{
 for(const reason of ['retreat','hidden','stun']){
  const {b,ally}=arena(),e=spawn(b,'enemy_1272_nhtank');addAlly(b,ally,4,3);b.map=structuredClone(b.map);b.map.grid[3][4].heightType='LOWLAND';b.step();assert.ok(e.enemyCast);assert.equal(e.sp,0);
  if(reason==='retreat'){ally.deployed=false;ally.deployAt=100;}else if(reason==='hidden')applyStatus(ally,'invisible',10);else applyStatus(e,'stun',10);
  b.step();assert.equal(e.enemyCast,null);assert.equal(e.sp,reason==='stun'?0:2);assert.equal(b.s.logicEffects.filter(f=>f.kind==='field').length,0);
 }
});

test('战车污染圈半径1.7，覆盖不可选高台和飞行单位，不误用2.2的索敌半径',()=>{
 const {b,ally}=arena(),e=spawn(b,'enemy_1272_nhtank');addAlly(b,ally,4,3);b.map=structuredClone(b.map);b.map.grid[3][4].heightType='LOWLAND';e.atk=1;advance(b,1.5);e.canAttack=false;
 const zone=b.s.logicEffects.find(f=>f.kind==='field');assert.equal(zone.radius,1.7);ally.targetable=false;ally.flying=true;ally.x=6;let hp=ally.hp;advance(b,1);assert.equal(ally.hp,hp);
 ally.x=5;ally.y=4;b.map.grid[4][5].heightType='HIGHLAND';hp=ally.hp;advance(b,1);assert.equal(hp-ally.hp,25);
});

test('战车施法存档保留目标部署代次，同UID重新部署时退款而不追射',()=>{
 const {b,g,ally}=arena(),e=spawn(b,'enemy_1272_nhtank');addAlly(b,ally,4,3);b.map=structuredClone(b.map);b.map.grid[3][4].heightType='LOWLAND';b.step();assert.equal(e.sp,0);
 const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);const target=restored.s.units[0],tank=restored.s.enemies[0];target.deployGen++;
 restored.step();assert.equal(tank.sp,2);assert.equal(tank.enemyCast,null);assert.equal(restored.s.logicEffects.filter(f=>f.kind==='field').length,0);
});

test('攻击击杀目标仍回复敌方SP，技能命中不当成普通攻击回点',()=>{
 const {b,ally}=arena(),e=spawn(b,'enemy_1183_mlasrt');ally.hp=0;
 b.resolveEnemyAttackEffects(e,ally);assert.equal(e.sp,1);
 b.resolveEnemyAttackEffects(e,ally,{extra:{prefab:'PowerAttack'}});assert.equal(e.sp,1);
});

test('受击回复走伤害入口且持续伤害不回点，自动回复与上限独立',()=>{
 const {b}=arena(),raw=structuredClone(NATIVE_DATA.enemies.enemy_1007_slime);
 raw.spData={spType:'INCREASE_WHEN_TAKEN_DAMAGE',initSp:0,maxSp:2,increment:1};
 const e=spawn(b,'taken',3,3,raw);
 dealDamage(b,{target:e,value:1,cause:'attack'});assert.equal(e.sp,1);
 dealDamage(b,{target:e,value:1,cause:'dot'});assert.equal(e.sp,1);
 dealDamage(b,{target:e,value:1,cause:'attack'});assert.equal(e.sp,2);
 e.enemySp={type:'INCREASE_WITH_TIME',max:3,increment:1};e.sp=0;advance(b,2);assert.ok(Math.abs(e.sp-2)<1e-8);
 advance(b,2);assert.equal(e.sp,3);
});

test('冷却与SP必须同时满足，多技能优先级保留，未知技能不伪装成普攻特效',()=>{
 const {b}=arena(),raw=structuredClone(NATIVE_DATA.enemies.enemy_1183_mlasrt);
 raw.skills=[{prefabKey:'PowerAttack',priority:0,initCooldown:10,cooldown:10,spCost:1,blackboard:[]},{prefabKey:'StunAttack',priority:2,initCooldown:0,cooldown:3,spCost:1,blackboard:[]},{prefabKey:'NotImplemented',priority:9,initCooldown:0,cooldown:0,spCost:0,blackboard:[]}];
 const e=spawn(b,'priority',3,3,raw),target={hp:10,x:3,y:3};e.sp=2;
 assert.equal(e.enemySkills.length,3);assert.equal(b.enemySpecialReady(e,target).prefab,'StunAttack');
 e.enemySkills[1].nextAt=5;assert.equal(b.enemySpecialReady(e,target),null);
 advance(b,10);assert.equal(b.enemySpecialReady(e,target).prefab,'PowerAttack');
 e.sp=0;assert.equal(b.enemySpecialReady(e,target),null);
});

test('战斗JSON存档保留敌方SP、独立CD、圣堂剑士下一次触发时间',()=>{
 const {b,g}=arena(),e=spawn(b,'enemy_10087_hlchgr');advance(b,7);
 const saved=JSON.parse(JSON.stringify(b.s));
 const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,saved);assert.ok(restored);
 const after=restored.s.enemies.find(x=>x.uid===e.uid);assert.equal(after.sp,4);assert.equal(after.nextEnhanceAt,12);
 advance(restored,5);assert.equal(after.sp,3);assert.equal(after.enhanceStacks,2);
});

test('枯朽萃聚使徒首放10秒，完成施法后生成三只飞行枯朽之种',()=>{
 const {b}=arena(),parent=spawn(b,'enemy_1321_wdarft');advance(b,10.6);
 assert.equal(b.s.enemies.length,1);advance(b,.1);
 const children=b.s.enemies.filter(e=>e.id==='enemy_1269_nhfly');assert.equal(children.length,3);
 assert.deepEqual(children.map(e=>e.x),[parent.x,parent.x-1,parent.x+1]);assert.ok(children.every(e=>e.flying));
 assert.equal(parent.enemySkills.find(s=>s.prefab==='BornBugs').nextAt,20.7);
});

test('术师快艇死亡延迟召唤不会提前清场，待生成队列经JSON存档保留',()=>{
 const {b,g}=arena(),parent=spawn(b,'enemy_1162_magmot');commitExit(b,{target:parent});advance(b,.4);
 assert.equal(b.s.finished,false);assert.equal(b.s.pendingEnemySpawns.length,1);assert.equal(b.s.enemies.length,0);
 const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);
 advance(restored,.4);assert.equal(restored.s.enemies.length,1);assert.equal(restored.s.enemies[0].id,'enemy_1161_tidmag');assert.equal(restored.s.enemies[0].flying,false);
});

test('枯朽之种完成一次攻击后自毁，缺省属性不会生成NaN',()=>{
 const {b,ally}=arena();addAlly(b,ally,3,3);const seed=spawn(b,'enemy_1269_nhfly',3,4);seed.atk=1;
 assert.equal(seed.def,0);assert.equal(seed.res,0);advance(b,.5);assert.equal(seed.hp,0);assert.equal(b.s.kills,1);
});

test('拷打者死亡生成血珀，无祭坛时每秒流失10%生命且不移动不阻挡',()=>{
 const {b}=arena(),parent=spawn(b,'enemy_1364_spnaxe_2');commitExit(b,{target:parent});b.step();
 const blood=b.s.enemies.filter(e=>e.id==='enemy_1367_dseed');assert.equal(blood.length,2);
 assert.ok(blood.every(e=>e.formHold&&e.unblockable&&!e.canAttack));const first=blood[0],hp=first.hp,x=first.x;
 advance(b,1);assert.equal(first.hp,hp*.9);assert.equal(first.x,x);
});

test('用户范围豁免搭桥：两种船工保留隐匿/普攻和原表，但不运行BuildBridge且允许随机入池',()=>{
 for(const id of ['enemy_10042_prtrop','enemy_10042_prtrop_2']){
  const {b}=arena(),e=spawn(b,id),raw=NATIVE_DATA.enemies[id];
  assert.ok(raw.skills.some(s=>s.prefabKey==='BuildBridge'),'原表资料保留');assert.deepEqual(raw.enemyBehavior.ignoredSkillPrefabs,['BuildBridge']);
  assert.equal(e.specialSkill,null);assert.equal(e.enemySkills.length,0);assert.equal(e.canAttack,true);assert.equal(e.formInvisible,true);assert.equal(e.randomPoolEligible,true);
  assert.match(NATIVE_DATA.enemyIndex.find(x=>x.id===id).desc,/搭桥属于关卡场地机制/);advance(b,1);assert.equal(e.enemyCast,undefined);
 }
});
