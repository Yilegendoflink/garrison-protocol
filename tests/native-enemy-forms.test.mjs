import test from 'node:test';import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';import {NativeBattle} from '../dist/native-battle.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';import {dealDamage,applyHeal,moveActor,commitExit} from '../dist/native-effects.js';import {applyStatus} from '../dist/status.js';

function arena(id,{raw=NATIVE_DATA.enemies[id]}={}){
 const g=new NativeSession(NATIVE_DATA,{seed:42});g.s.funds=100;assert.ok(g.perform('buy',0));const unit=g.s.units[0];let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(unit.uid,x,y))placed=g.deploy(unit.uid,x,y,0);
 assert.ok(placed);assert.ok(g.perform('start'));const b=g.battle,ally=b.s.units[0];b.s.units=[];b.s.queue=[];b.s.enemies=[];b.s.limit=1000;
 b.map=structuredClone(b.map);b.map.grid[3][3].heightType='LOWLAND';const o=b.map.origin,p={col:o.col+3,row:o.row-3};
 b.level={...b.level,routes:[{motionMode:'WALK',startPosition:p,endPosition:p,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...b.level.enemyProfiles,[id]:raw}};b.spawn({id,route:0});
 return {b,g,e:b.s.enemies[0],ally};
}
function advance(b,t){for(let i=0;i<Math.round(t*30);i++)b.step();}
function strike(b,e,type){return dealDamage(b,{target:e,value:1e6,type,cause:'attack'});}
function addAlly(b,u,x=3,y=3){u.x=x;u.y=y;u.deployed=true;u.hp=u.maxHp;applyStatus(u,'disarm',600);b.s.units.push(u);}

test('转译基底取消伤害，物法分别计数，第四次物理伤害只启动一次转换',()=>{
 const {b,e}=arena('enemy_10081_mpplai'),hp=e.hp,atk=e.baseAtk;
 for(let i=0;i<3;i++){assert.equal(strike(b,e,'physical').cancelled,true);strike(b,e,'arts');}
 strike(b,e,'true');assert.equal(e.hp,hp);assert.equal(e.enemyForm,'original');assert.deepEqual(e.formDamageCounts,{physical:3,arts:3});
 strike(b,e,'physical');assert.equal(e.enemyForm,'transforming');const until=e.enemyFormUntil;strike(b,e,'arts');assert.equal(e.enemyFormUntil,until);
 advance(b,1.9);assert.equal(e.hp,hp);assert.equal(e.enemyForm,'transforming');advance(b,.1);
 assert.equal(e.enemyForm,'avenger');assert.equal(e.maxHp,hp+4000*b.combatScale.hp);assert.equal(e.baseAtk,atk+500*b.combatScale.atk);assert.equal(e.ranged,false);
 assert.equal(b.s.kills,0);assert.equal(e.immunities.stun,false);
});

test('寻仇者形态低血增攻可逆，回复过半后恢复正常攻击力',()=>{
 const {b,e}=arena('enemy_10081_mpplai');for(let i=0;i<4;i++)strike(b,e,'physical');advance(b,2);
 e.hp=e.maxHp*.4;b.step();assert.equal(e.atk,e.baseAtk*2);applyHeal(b,{source:e,target:e,amount:e.maxHp});b.step();assert.equal(e.atk,e.baseAtk);
});

test('转译基底第四次法术伤害变术师，双目标法术攻击使用新属性',()=>{
 const {b,e,ally}=arena('enemy_10081_mpplai');for(let i=0;i<4;i++)strike(b,e,'arts');advance(b,2);
 assert.equal(e.enemyForm,'caster');assert.equal(e.damageType,'arts');assert.equal(e.ranged,true);assert.equal(e.enemyAttack.targets,2);
 addAlly(b,ally,3,4);const other=structuredClone(ally);other.uid+=100;other.x=4;other.y=3;b.s.units.push(other);
 const seen=[],hurt=b.hurt.bind(b);b.hurt=(u,source,opts)=>{seen.push([u.uid,source.damageType]);hurt(u,source,opts);};advance(b,1.4);
 assert.equal(new Set(seen.map(x=>x[0])).size,2);assert.ok(seen.every(x=>x[1]==='arts'));
});

test('原始形态被阻挡触发幽灵形态，转换期间不可阻挡且不攻击',()=>{
 const {b,e,ally}=arena('enemy_10081_mpplai');addAlly(b,ally);b.step();assert.equal(e.enemyForm,'transforming');assert.equal(e.nextEnemyForm,'ghost');assert.equal(e.block,null);
 assert.equal(e.canAttack,false);advance(b,2);assert.equal(e.enemyForm,'ghost');assert.equal(e.unblockable,true);assert.equal(e.canAttack,false);assert.equal(e.enemyFormUntil,null);
});

test('转译基底原始态免疫控制和推动，转换中JSON读档不重置倒计时',()=>{
 const {b,g,e}=arena('enemy_10081_mpplai');assert.equal(applyStatus(e,'stun',5),false);assert.equal(moveActor(b,e,{x:2,y:3},'推动'),false);
 for(let i=0;i<4;i++)strike(b,e,'physical');advance(b,1);
 const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);advance(restored,1);
 assert.equal(restored.s.enemies[0].enemyForm,'avenger');assert.equal(restored.s.enemies[0].shiftImmune,false);
});

test('守墓石像首次击倒回满血变石像，10秒后飞行法术攻击，击倒数只结算最后一次',()=>{
 const {b,e}=arena('enemy_1172_dugago'),def=e.baseDef,res=e.res;
 assert.equal(e.ranged,false);strike(b,e,'true');assert.equal(e.enemyForm,'stone');assert.equal(e.hp,e.maxHp);assert.equal(b.s.kills,0);
 assert.equal(e.def,def+800);assert.equal(e.res,res+30);assert.equal(e.unblockable,true);assert.equal(e.canAttack,false);
 assert.equal(moveActor(b,e,{x:2,y:3},'推动'),false);advance(b,9.9);assert.equal(e.enemyForm,'stone');advance(b,.1);
 assert.equal(e.enemyForm,'flying');assert.equal(e.flying,true);assert.equal(e.damageType,'arts');assert.equal(e.ranged,true);assert.equal(e.def,def);assert.equal(e.res,res);
 strike(b,e,'true');assert.equal(e.hp,0);assert.equal(b.s.kills,1);
});

test('石像转换期仍可被击倒，不能再度重生；破碎标记阻止初次重生',()=>{
 const first=arena('enemy_1172_dugago_2');strike(first.b,first.e,'true');strike(first.b,first.e,'true');assert.equal(first.e.hp,0);assert.equal(first.b.s.kills,1);
 const crushed=arena('enemy_1172_dugago');crushed.e.pillarBrokenUntil=crushed.b.s.time+1;strike(crushed.b,crushed.e,'true');assert.equal(crushed.e.hp,0);assert.equal(crushed.b.s.kills,1);
});

test('掠海漂移体近地悬浮不被阻挡，控制后永久转爬行且只进行阻挡攻击',()=>{
 const {b,e,ally}=arena('enemy_2025_syufo');addAlly(b,ally);b.step();assert.equal(e.flying,true);assert.equal(e.block,null);assert.equal(e.shiftImmune,true);
 applyStatus(e,'root',2);b.step();assert.equal(e.enemyForm,'hovering','束缚不能误当成缚地');
 applyStatus(e,'stun',.1);b.step();assert.equal(e.enemyForm,'crawling');assert.equal(e.flying,false);assert.equal(e.ranged,false);assert.equal(e.shiftImmune,false);
 assert.ok(e.statuses.some(s=>s.kind==='stun'&&s.remaining>=.49));advance(b,1);assert.equal(e.enemyForm,'crawling');assert.equal(e.flying,false);
});

test('喷气人被阻挡后按冷却升空，起飞减速、飞行加速与降落窗口分别结束',()=>{
 const {b,e,ally}=arena('enemy_2004_balloon');e.atk=e.baseAtk=1;addAlly(b,ally);
 for(let i=0;i<300&&e.enemyForm!=='flying';i++)b.step();assert.equal(e.enemyForm,'flying');
 assert.equal(e.flying,true);assert.equal(e.unblockable,true);assert.equal(e.canAttack,false);assert.ok(Math.abs(e.speed-e.baseSpeed*.15)<1e-9);
 advance(b,1.6);assert.equal(e.speed,e.baseSpeed*1.5);advance(b,5.4);
 assert.equal(e.enemyForm,'landing');assert.equal(e.flying,false);assert.equal(e.unblockable,true);assert.equal(e.speed,e.baseSpeed*.1);
 advance(b,1.4);assert.equal(e.enemyForm,'ground');assert.equal(e.unblockable,e.baseUnblockable);assert.equal(e.speed,e.baseSpeed);
});

test('飞行中的喷气人JSON恢复后继续剩余持续时间，不重置加速或冷却',()=>{
 const {b,g,e,ally}=arena('enemy_2004_balloon');e.atk=e.baseAtk=1;addAlly(b,ally);
 for(let i=0;i<300&&e.enemyForm!=='flying';i++)b.step();advance(b,3);
 const until=e.enemyFormUntil,next=e.enemySkills[0].nextAt,restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);
 const saved=restored.s.enemies[0];assert.equal(saved.enemyFormUntil,until);assert.equal(saved.enemySkills[0].nextAt,next);
 advance(restored,4);assert.equal(saved.enemyForm,'landing');
});

function parrot(mode=0,checkpoint=0){const raw=structuredClone(NATIVE_DATA.enemies.enemy_10045_parrot);raw.talentBlackboard.find(r=>r.key==='Mode.mode').value=mode;raw.talentBlackboard.find(r=>r.key==='ThrowEnemy.checkpoint').value=checkpoint;return arena('enemy_10045_parrot',{raw});}

test('本期吉兆飞鳞默认不携水手，首次受伤5秒三倍移速，切模式清增益',()=>{
 const {b,e}=parrot();assert.equal(e.enemyForm,'hovering');assert.equal(e.flying,true);assert.equal(e.groundNavigation,true);assert.equal(e.parrotHasPassenger,false);
 dealDamage(b,{target:e,value:1,type:'true'});assert.equal(e.speed,e.baseSpeed*3);advance(b,5.1);assert.equal(e.speed,e.baseSpeed);
 dealDamage(b,{target:e,value:1,type:'true'});assert.equal(e.speed,e.baseSpeed,'首次触发不能反复刷新');
 commitExit(b,{target:e});assert.equal(b.s.pendingEnemySpawns.length,0);
 const second=parrot();dealDamage(second.b,{target:second.e,value:1,type:'true'});applyStatus(second.e,'stun',.1);second.b.step();assert.equal(second.e.speed,second.e.baseSpeed);assert.equal(second.e.enemyForm,'grounded');
});

test('吉兆飞鳞受控落地8秒后起飞，冻结结束触发失温坠落',()=>{
 const {b,e}=parrot();applyStatus(e,'stun',.1);b.step();assert.equal(e.enemyForm,'grounded');assert.equal(e.flying,false);assert.equal(e.unblockable,true);
 advance(b,1);applyStatus(e,'frozen',10);advance(b,7.1);assert.equal(e.enemyForm,'hovering');assert.equal(e.flying,true,'自晕结束先恢复近地悬浮，即使仍冻结');
 advance(b,3);assert.equal(e.enemyForm,'grounded');assert.equal(e.flying,false);assert.ok(e.statuses.some(s=>s.kind==='stun'&&s.remaining>7));
});

test('搬运模式落地释放一次水手，随后死亡不重复释放，延迟队列可存档',()=>{
 const {b,g,e}=parrot(1,0);assert.equal(e.parrotHasPassenger,true);applyStatus(e,'stun',.1);b.step();assert.equal(e.parrotHasPassenger,false);assert.equal(b.s.pendingEnemySpawns.length,1);
 commitExit(b,{target:e});assert.equal(b.s.pendingEnemySpawns.length,1);const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);advance(restored,1);
 assert.equal(restored.s.enemies.filter(a=>a.id==='enemy_10043_sailor').length,1);
});

test('搬运飞鳞在配置的原始路径点释放，checkpoint=0禁用自动释放，沉默不阻止投放',()=>{
 const configured=parrot(1,1);applyStatus(configured.e,'silence',30);advance(configured.b,.3);
 assert.equal(configured.e.lastCheckpoint,1);assert.equal(configured.e.parrotHasPassenger,false);assert.equal(configured.e.enemyForm,'hovering');assert.equal(configured.b.s.pendingEnemySpawns.length,1);
 advance(configured.b,.5);assert.equal(configured.b.s.enemies.filter(e=>e.id==='enemy_10043_sailor').length,1);
 const disabled=parrot(1,0);advance(disabled.b,2);assert.equal(disabled.e.parrotHasPassenger,true);assert.equal(disabled.b.s.pendingEnemySpawns.length,0);
 commitExit(disabled.b,{target:disabled.e});assert.equal(disabled.b.s.pendingEnemySpawns.length,1);
});
