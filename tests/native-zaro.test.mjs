import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';
import {NativeBattle} from '../dist/native-battle.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {dealDamage,moveActor,commitExit,addDamageRedirect,applyLoss} from '../dist/native-effects.js';
import {drawEnemyPhase} from '../dist/native-fx.js';
import {applyStatus,permissions,statusAttributeChanges} from '../dist/status.js';

function arena(positions=[]){
 const g=new NativeSession(NATIVE_DATA,{seed:42});g.s.funds=100;assert.ok(g.perform('buy',0));const u=g.s.units[0];let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(u.uid,x,y))placed=g.deploy(u.uid,x,y,0);
 assert.ok(placed);assert.ok(g.perform('start'));const b=g.battle,template=b.s.units[0];b.s.queue=[];b.s.enemies=[];b.s.logicEffects=[];b.s.limit=1000;b.map=structuredClone(b.map);
 const stats=b.stats.bind(b);b.stats=a=>({...stats(a),maxHp:50000,def:1000,magicResistance:0,blockCnt:3});
 b.s.units=positions.map(([x,y],i)=>{const a=structuredClone(template);a.uid+=i*100;a.x=x;a.y=y;a.deployed=true;a.hp=a.maxHp=50000;applyStatus(a,'disarm',600);applyStatus(a,'skillLock',600);b.map.grid[y][x].heightType='LOWLAND';return a;});
 const id='enemy_1535_wlfmster',o=b.map.origin,p={col:o.col+3,row:o.row-3};b.level={...b.level,routes:[{motionMode:'WALK',startPosition:p,endPosition:p,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...b.level.enemyProfiles,[id]:NATIVE_DATA.enemies[id]}};b.spawn({id,route:0});
 return {b,g,e:b.s.enemies[0],units:b.s.units};
}
function advance(b,t){for(let i=0;i<Math.round(t*30);i++)b.step();}
function fatal(b,e){dealDamage(b,{target:e,value:e.maxHp*10,type:'true'});}

test('溶血骇惧消耗55SP锁最多3人，线性递增生命流失，扎罗损失20%上限时解除并回点',()=>{
 const {b,e,units}=arena([[4,3],[3,4],[5,5],[7,3]]);e.atk=1;advance(b,55);assert.equal(e.zaroCage.targets.length,3);assert.ok(e.sp<.04);assert.equal(permissions(e).skill,false);
 const targets=e.zaroCage.targets.map(row=>units.find(u=>u.uid===row.uid)),hp=targets.map(t=>t.hp);for(const target of targets){assert.equal(statusAttributeChanges(target).attackSpeed,-70);assert.equal(permissions(target).retreat,false);}
 advance(b,10);targets.forEach((t,i)=>assert.ok(Math.abs(hp[i]-t.hp-t.maxHp*.0375*10)<.01));
 const sp=e.sp;applyLoss(b,{target:e,amount:e.maxHp*.2});assert.equal(e.zaroCage,null);assert.ok(Math.abs(e.sp-sp-15)<1e-8);assert.equal(permissions(e).skill,false);for(const target of targets){assert.equal(statusAttributeChanges(target).attackSpeed,0);assert.equal(permissions(target).retreat,true);}
 advance(b,7.1);assert.equal(permissions(e).skill,true);
});

test('骇惧目标死亡逐个解除，全部结束后7秒静默，重生清理所有绑定',()=>{
 const {b,e,units}=arena([[4,3],[3,4],[5,5]]);e.atk=1;e.sp=55;b.step();assert.ok(e.zaroCage);const targets=[...e.zaroCage.targets];
 commitExit(b,{target:units.find(u=>u.uid===targets[0].uid)});b.step();assert.equal(e.zaroCage.targets.length,2);assert.ok(e.sp>=5&&e.sp<5.1);
 fatal(b,e);assert.equal(e.enemyForm,'rebirth');assert.equal(e.zaroCage,null);for(const target of units.filter(u=>u.hp>0)){assert.equal(permissions(target).retreat,true);assert.equal(statusAttributeChanges(target).attackSpeed,0);}
});

test('骇惧绑定与累计时间跨JSON，旧目标再部署不会继续流失或重复退款',()=>{
 const {b,g,e,units:[u]}=arena([[4,3]]);e.atk=1;e.sp=55;b.step();advance(b,1);const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);const wolf=restored.s.enemies[0],target=restored.s.units[0];assert.equal(wolf.zaroCage.startedAt,e.zaroCage.startedAt);
 target.deployGen++;target.statuses=[];const sp=wolf.sp;restored.step();assert.equal(wolf.zaroCage,null);assert.ok(Math.abs(wolf.sp-sp-5-1/30)<1e-8);const after=wolf.sp;advance(restored,.2);assert.ok(Math.abs(wolf.sp-after-.2)<1e-8);assert.equal(permissions(target).retreat,true);
});

test('扎罗第一形态只减物理/法术30%，预计算和递归分摊不重复减伤',()=>{
 const {b,e,units:[u]}=arena([[5,5]]);e.def=e.res=0;let hp=e.hp;dealDamage(b,{target:e,amount:100,type:'physical'});assert.equal(hp-e.hp,70);hp=e.hp;dealDamage(b,{target:e,value:100,type:'arts'});assert.equal(hp-e.hp,70);hp=e.hp;dealDamage(b,{target:e,value:100,type:'true'});assert.equal(hp-e.hp,100);
 addDamageRedirect(b,e,{targetUid:u.uid,ratio:.5});hp=e.hp;const other=u.hp;dealDamage(b,{target:e,value:100,type:'physical'});assert.equal(hp-e.hp,35);assert.equal(other-u.hp,35);assert.equal(applyStatus(e,'stun',10),false);assert.equal(moveActor(b,e,{x:2,y:3},'推动'),false);
});

test('扎罗40秒重生逐渐回满血，第二形态加攻/缩间隔只应用一次并保持10秒无敌',()=>{
 const {b,g,e}=arena(),atk=e.baseAtk,interval=e.interval;fatal(b,e);assert.equal(e.enemyForm,'rebirth');assert.equal(e.hp,1);assert.equal(b.s.kills,0);advance(b,20);assert.ok(Math.abs(e.hp-e.maxHp*.5)<1e-6);
 const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);const wolf=restored.s.enemies[0];advance(restored,20);assert.equal(wolf.enemyForm,'second');assert.equal(wolf.hp,wolf.maxHp);assert.equal(wolf.atk,atk*1.5);assert.equal(wolf.interval,interval-1.5);assert.equal(wolf.range,1.25);assert.equal(wolf.enemyAttack.hits,2);assert.equal(wolf.invulnerable,true);assert.equal(wolf.shiftImmune,true);assert.equal(applyStatus(wolf,'stun',1),true);
 advance(restored,10.1);assert.equal(wolf.invulnerable,false);assert.equal(wolf.atk,atk*1.5);fatal(restored,wolf);assert.equal(restored.s.kills,1);
});

test('远古威慑仅重生/第二形态在1.5圆内生效，同名不叠加且来源死亡后清除',()=>{
 const {b,e,units:[near,far]}=arena([[4,4],[5,5]]);e.atk=1;b.step();assert.equal(near.enemyAttackSpeedMod,0);fatal(b,e);b.step();assert.equal(near.enemyAttackSpeedMod,-50);assert.equal(far.enemyAttackSpeedMod,0);
 b.spawn({id:e.id,route:0});const second=b.s.enemies.at(-1);fatal(b,second);b.step();assert.equal(near.enemyAttackSpeedMod,-50);advance(b,50.1);assert.equal(near.enemyAttackSpeedMod,-50);
 fatal(b,e);fatal(b,second);b.s.queue.push({id:'enemy_1007_slime',route:0,at:100});b.step();assert.equal(near.enemyAttackSpeedMod,0);
});

function secondPhase(scene){fatal(scene.b,scene.e);advance(scene.b,40);assert.equal(scene.e.enemyForm,'second');}
function ledger(b){b.s.bloodDebt={value:0,capacity:500,settlementUntil:0};return b.s.bloodDebt;}

test('扎罗怒嗥仅第二形态5秒后开始，不需要目标，持续5.5秒停移停攻且40秒CD从结束算',()=>{
 const scene=arena(),{b,e}=scene;advance(b,6);assert.equal(e.enemySkills.find(s=>s.prefab==='WildCalling').used,false);secondPhase(scene);const phaseAt=b.s.time;advance(b,4.9);assert.ok(!e.enemyCast);advance(b,.1);assert.equal(e.enemyCast?.wildCalling,true);assert.equal(e.formHold,true);const started=b.s.time,x=e.x,y=e.y;advance(b,5.4);assert.ok(e.enemyCast);assert.equal(e.x,x);assert.equal(e.y,y);advance(b,.1);assert.equal(e.enemyCast,null);assert.equal(e.formHold,false);assert.ok(Math.abs(e.enemySkills.find(s=>s.prefab==='WildCalling').nextAt-(started+5.5+40))<1e-8);assert.equal(b.s.bloodDebt,undefined,'无环境控制器时不凭空创建账簿');assert.ok(Math.abs(started-phaseAt-5)<1e-8);
});
test('扎罗在场每秒1点与怒嗥每秒35点进入独立账款接收端，不写自身SP或资金',()=>{
 const scene=arena(),{b,e}=scene;const account=ledger(b),funds=b.economy.s.funds;advance(b,2);assert.ok(Math.abs(account.value-2)<1e-8);assert.ok(Math.abs(e.sp-2)<1e-8);secondPhase(scene);account.value=0;advance(b,5);assert.equal(e.enemyCast?.wildCalling,true);const ownSp=e.sp,at=b.s.time;advance(b,5.5);assert.ok(Math.abs(account.value-(b.s.time-at+5+35*5))<1e-7);assert.equal(e.sp,ownSp,'持续施法阻止自身SP自然回复，账款增长不应灌入技能槽');assert.equal(b.economy.s.funds,funds);
});
test('清算时刻不触发怒嗥或增加账款，结束后可释放；账款只到容量上限',()=>{
 const scene=arena(),{b,e}=scene;secondPhase(scene);const account=ledger(b);account.settlementUntil=b.s.time+10;advance(b,9);assert.ok(!e.enemyCast);assert.equal(account.value,0);advance(b,1.1);assert.equal(e.enemyCast?.wildCalling,true);account.value=490;assert.equal(b.addBloodDebt(35),10);assert.equal(account.value,500);
});
test('怒嗥受眩晕打断，已入账不回滚，停止后续脉冲且从打断时开始CD',()=>{
 const scene=arena(),{b,e}=scene;secondPhase(scene);const account=ledger(b);advance(b,7.1);assert.equal(e.enemyCast?.wildCalling,true);assert.ok(account.value>70);const before=account.value;applyStatus(e,'stun',2);b.step();assert.equal(e.enemyCast,null);assert.equal(e.formHold,false);const next=e.enemySkills.find(s=>s.prefab==='WildCalling').nextAt;assert.ok(Math.abs(next-b.s.time-40)<1e-8);advance(b,3);assert.ok(Math.abs(account.value-before-3-1/30)<1e-7);
});
test('怒嗥脉冲时间与账款跨JSON恢复，不因一帧两次技能调度而重复入账',()=>{
 const scene=arena(),{b,g,e}=scene;secondPhase(scene);ledger(b);advance(b,6.4);const original=b.s.bloodDebt.value;const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);advance(b,2);advance(restored,2);assert.ok(Math.abs(b.s.bloodDebt.value-restored.s.bloodDebt.value)<1e-8);assert.ok(Math.abs(b.s.bloodDebt.value-original-72)<1e-7);const bad=JSON.parse(JSON.stringify(restored.s));bad.bloodDebt.value=501;assert.equal(NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,bad),null);
});

test('怒嗥剩余施法时间可见且绘制不改规则状态',()=>{
 const scene=arena(),{b,e}=scene;secondPhase(scene);advance(b,5);const before=JSON.stringify(b.s),labels=[],c={save(){},restore(){},fillText(t){labels.push(t);}};assert.equal(drawEnemyPhase(c,(x,y)=>({x,y}),{th:20},b,{reduceFx:true}),true);assert.deepEqual(labels,['狂暴怒嗥 5.5']);assert.equal(JSON.stringify(b.s),before);
});
