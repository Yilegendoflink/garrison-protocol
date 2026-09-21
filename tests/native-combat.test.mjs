import test from 'node:test';import assert from 'node:assert/strict';
import {remainingDistance,compareOperatorTargets,resolveBlocks,compileRoute,advanceEnemy,scheduleStrikes,dueStrikes,enemyBehaviorProfile,enemyShouldHoldPosition,enemyTargetInRange,ENEMY_MOVEMENT_POLICIES} from '../dist/native-combat.js';
import {emitEvent,skillFlow} from '../dist/native-combat.js';
import {recent,attackVisual} from '../dist/native-fx.js';
import {NativeSession} from '../dist/native-session.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {applyStatus} from '../dist/status.js';
import {addEffect,tickLogic,dispatch} from '../dist/native-effects.js';
import {createTrainingDummy} from '../dist/benchmark.js';

function liveBattle(){
 const g=new NativeSession(NATIVE_DATA,{seed:42});g.s.funds=100;assert.ok(g.perform('buy',0));const unit=g.s.units[0];
 let placed=false;for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(unit.uid,x,y))placed=g.deploy(unit.uid,x,y,0);
 assert.ok(placed);assert.ok(g.perform('start'));const b=g.battle;b.s.queue=[];b.s.enemies=[];b.deploy(b.s.units[0]);return b;
}
test('attack visuals distinguish branch behaviors instead of damage color alone',()=>{
 const cases=[[{branch:'fighter'},'punch'],[{branch:'instructor'},'thrust'],[{branch:'sword'},'slash'],[{style:'block-count'},'sweep'],[{ranged:true,branch:'reaperrange'},'scatter'],[{ranged:true,style:'all'},'area'],[{ranged:true,style:'splash'},'artillery'],[{returns:true},'return'],[{branch:'funnel'},'drone'],[{branch:'mystic'},'stored'],[{enemy:true,ranged:true},'enemy-shot']];
 for(const [input,want]of cases)assert.equal(attackVisual(input),want);
});
test('native chain effects connect actual targets and never emit a splash circle',()=>{
 const b=liveBattle(),u=b.s.units[0];b.hit=()=>{};const enemies=[0,1,2].map(i=>({uid:100+i,x:i,y:0,hp:100,statuses:[]}));b.s.enemies=enemies;b.s.events=[];
 b.impactNativeAttack(u,enemies[0],{style:'chain',amount:1,type:'arts',antiAir:true});
 const links=b.s.events.filter(e=>e.type==='chain');assert.equal(links.length,2);assert.equal(links[0].x,0);assert.equal(links[0].targetX,1);assert.equal(links[1].targetX,2);assert.equal(b.s.events.some(e=>e.type==='impact'),false);
});
test('healing and aftershock effects originate from actual combat events',()=>{
 const b=liveBattle(),u=b.s.units[0];u.hp-=10;b.s.events=[];b.heal(u,u,5);const heal=b.s.events.find(e=>e.type==='heal');assert.ok(heal);assert.equal(heal.targetX,u.x);
 const enemy={uid:100,x:u.x+1,y:u.y,hp:1000,statuses:[]};b.s.enemies=[enemy];b.hit=()=>{};
 b.impactNativeAttack(u,enemy,{style:'aftershock',radius:.9,type:'physical',amount:1,antiAir:true});
 assert.equal(b.s.events.some(e=>e.type==='aftershock'),false);b.s.time+=2/30;for(const packet of dueStrikes(b.s))b.deliverStrike(packet);
 assert.equal(b.s.events.filter(e=>e.type==='aftershock').length,1);
});
test('休谟斯策略在地面干员技能结束后给相邻干员回复技力',()=>{const b=liveBattle(),source=b.s.units[0],ally=structuredClone(source);source.x=1;source.y=1;source.deployed=true;ally.uid=source.uid+100;ally.x=2;ally.y=1;ally.deployed=true;ally.hp=ally.maxHp;ally.sp=0;b.s.units.push(ally);const profile=b.profile.bind(b);b.profile=u=>u===source?{...profile(u),position:'MELEE'}:profile(u);b.s.band='band_humus';dispatch(b,'skill-end',{target:source});assert.equal(ally.sp,3);});
test('桑葚策略给最右侧单位按攻击概率添加一次护盾层',()=>{const b=liveBattle(),u=b.s.units[0],enemy={uid:100,x:u.x+1,y:u.y,hp:1000,maxHp:1000,statuses:[]};b.s.enemies=[enemy];b.s.band='band_mberry';b.economy.random=()=>0;dispatch(b,'battle-start',{target:null});dispatch(b,'after-damage',{source:u,target:enemy,result:{total:10},cause:'attack',event:{eventId:1,attackId:null}});assert.equal(u.barriers.filter(x=>x.charges>0).length,1);});
test('native spawn uses route origin and target-lock ranged attacks hold position',()=>{
 const b=liveBattle(),u=b.s.units[0];const origin={col:b.map.origin.col+u.x+1,row:b.map.origin.row-u.y};
 b.level={routes:[{motionMode:'FLY',startPosition:origin,endPosition:{col:origin.col+2,row:origin.row},checkpoints:[]}],enemyProfiles:{probe:{name:'probe',motion:'FLY',applyWay:'RANGED',rangeRadius:3,attributes:{maxHp:100000,atk:1,moveSpeed:1,baseAttackTime:1,def:0,magicResistance:0},enemyBehavior:{movementPolicy:ENEMY_MOVEMENT_POLICIES.STOP_ON_TARGET}}}};
 b.spawn({id:'probe',route:0});const enemy=b.s.enemies[0],x=enemy.x;assert.equal(x,u.x+1);
 for(let i=0;i<30;i++)b.step();assert.equal(enemy.x,x);assert.ok(b.s.events.some(e=>e.type==='hit'));
 enemy.hidden=true;enemy.action={left:1,target:u.uid};const hp=u.hp;b.step();assert.equal(enemy.action,null);assert.equal(u.hp,hp);
 b.s.enemies=[];b.level={routes:[{motionMode:'FLY',startPosition:origin,endPosition:{col:origin.col+4,row:origin.row},checkpoints:[]}],enemyProfiles:{runner:{name:'runner',motion:'FLY',applyWay:'RANGED',rangeRadius:3,attributes:{maxHp:1e12,atk:1,moveSpeed:1,baseAttackTime:1,def:0,magicResistance:0},enemyBehavior:{movementPolicy:ENEMY_MOVEMENT_POLICIES.ALWAYS_MOVE_ATTACK}}}};b.spawn({id:'runner',route:0});const runner=b.s.enemies[0],runnerX=runner.x;for(let i=0;i<6;i++)b.step();assert.ok(runner.x>runnerX,'移动中攻击敌人不能因目标存在而站桩');
 b.s.enemies=[];b.level={routes:[{motionMode:'FLY',startPosition:origin,endPosition:{col:origin.col+8,row:origin.row},checkpoints:[]}],enemyProfiles:{defaultRanged:{name:'defaultRanged',motion:'FLY',applyWay:'RANGED',rangeRadius:3,attributes:{maxHp:1e12,atk:1,moveSpeed:1,baseAttackTime:1,def:0,magicResistance:0}}}};b.spawn({id:'defaultRanged',route:0});const defaultRanged=b.s.enemies[0],defaultX=defaultRanged.x;for(let i=0;i<30;i++)b.step();assert.equal(defaultRanged.movementPolicy,ENEMY_MOVEMENT_POLICIES.STOP_WHILE_ATTACKING);assert.ok(defaultRanged.x>defaultX,'普通远程敌人应在攻击完成后继续前进');
});
test('enemy movement policies distinguish target acquisition from attack movement',()=>{
 const target={uid:9,x:2,y:0,hp:100,maxHp:100};
 const base={x:0,y:0,range:3,route:[{kind:'move',x:4,y:0}],cmd:0,block:null,action:null,hp:1};
 assert.equal(enemyTargetInRange(base,target),true);
 assert.equal(enemyShouldHoldPosition({...base,movementPolicy:ENEMY_MOVEMENT_POLICIES.ALWAYS_MOVE_ATTACK},{target,now:0}),false);
 assert.equal(enemyShouldHoldPosition({...base,movementPolicy:ENEMY_MOVEMENT_POLICIES.STOP_ON_TARGET},{target,now:0}),true);
 assert.equal(enemyShouldHoldPosition({...base,movementPolicy:ENEMY_MOVEMENT_POLICIES.STOP_WHILE_ATTACKING},{target,now:0}),false);
 assert.equal(enemyShouldHoldPosition({...base,movementPolicy:ENEMY_MOVEMENT_POLICIES.STOP_WHILE_ATTACKING,action:{left:1,target:9}},{target,now:0}),true);
 assert.equal(enemyShouldHoldPosition({...base,movementPolicy:ENEMY_MOVEMENT_POLICIES.BURST_THEN_MOVE,burstShots:3,burstFired:1},{target,now:0}),true);
 assert.equal(enemyShouldHoldPosition({...base,movementPolicy:ENEMY_MOVEMENT_POLICIES.BURST_THEN_MOVE,burstShots:3,burstFired:3},{target,now:0}),false);
});
test('enemy behavior profiles infer documented move-and-attack and scheduled stances',()=>{
 assert.equal(enemyBehaviorProfile({description:'不停止移动的四向攻击'}).movementPolicy,ENEMY_MOVEMENT_POLICIES.ALWAYS_MOVE_ATTACK);
 assert.equal(enemyBehaviorProfile({ability:[{text:'周期性停止移动，并为范围内敌人充能'}]}).movementPolicy,ENEMY_MOVEMENT_POLICIES.SCHEDULED_STOP);
 assert.equal(enemyBehaviorProfile({ability:[{text:'攻击数次后进行蓄力攻击'}]}).movementPolicy,ENEMY_MOVEMENT_POLICIES.BURST_THEN_MOVE);
 assert.equal(enemyBehaviorProfile({applyWay:'RANGED',description:'攻击为三连击'}).movementPolicy,ENEMY_MOVEMENT_POLICIES.BURST_THEN_MOVE);
 assert.equal(enemyBehaviorProfile({applyWay:'RANGED',description:'攻击为三连击'}).burstShots,3);
 assert.equal(enemyBehaviorProfile({applyWay:'RANGED',description:'普通远程攻击'}).movementPolicy,ENEMY_MOVEMENT_POLICIES.STOP_WHILE_ATTACKING);
 assert.equal(enemyBehaviorProfile({applyWay:'RANGED',description:'需要锁定目标后停留',enemyBehavior:{movementPolicy:ENEMY_MOVEMENT_POLICIES.STOP_ON_TARGET}}).movementPolicy,ENEMY_MOVEMENT_POLICIES.STOP_ON_TARGET);
});
test('集团军重型火炮只在开火动作期间停留',()=>{
 const profile=enemyBehaviorProfile(NATIVE_DATA.enemies.enemy_10122_uacann_2);assert.equal(profile.movementPolicy,ENEMY_MOVEMENT_POLICIES.STOP_WHILE_ATTACKING);assert.equal(profile.attackWhileMoving,false);
});
test('最终木桩占据右上方两列三行并可作为范围判定目标',()=>{
 const dummy=createTrainingDummy(1,9,1);assert.deepEqual(dummy.area,{left:9,right:10,top:0,bottom:2});
 const b=liveBattle(),u=b.s.units[0];b.range=()=>[{x:10,y:2}];assert.equal(b.inside(u,dummy),true);b.range=()=>[{x:5,y:3}];assert.equal(b.inside(u,dummy),false);
});
test('enemy behavior profiles expose common attack counters, elements, explosions and auras',()=>{
 const profile=enemyBehaviorProfile({description:'攻击2次后，下一次攻击会晕眩；攻击额外造成神经损伤；死亡后会产生爆炸',skills:[{spCost:2,blackboard:[{key:'stun',value:3}]}],talentBlackboard:[{key:'epdamage.attack@ep_damage_ratio',value:.15},{key:'boom.atk_scale',value:2}]});
 assert.equal(profile.attackStunEvery,3);assert.equal(profile.attackStunDuration,3);assert.equal(profile.attackElement,'neural');assert.equal(profile.attackElementScale,.15);assert.deepEqual(profile.deathExplosion,{type:'physical',scale:2,radius:1,requiresFire:false});
 const aura=enemyBehaviorProfile({description:'为周围敌军提供防御力加成',talentBlackboard:[{key:'defup.def',value:300},{key:'defup.range_radius',value:2.5}]});assert.deepEqual(aura.aura,{def:300,damageResistance:0,radius:2.5});
 const scheduled=enemyBehaviorProfile({enemyBehavior:{movementPolicy:ENEMY_MOVEMENT_POLICIES.SCHEDULED_STOP,stanceInterval:10,stanceDuration:3}});assert.equal(scheduled.stanceInterval,10);assert.equal(scheduled.stanceDuration,3);
 const phase=enemyBehaviorProfile({description:'生命值降至一半以下时，移动速度提升且不可阻挡一段时间',skills:[{blackboard:[{key:'move_speed',value:1.5},{key:'block_free_time',value:3}]}]});assert.equal(phase.lowHpRatio,.5);assert.equal(phase.lowHpMoveMultiplier,1.5);assert.equal(phase.lowHpUnblockTime,3);assert.equal(phase.initialUnblockable,false);
 const hidden=enemyBehaviorProfile({description:'隐匿，与我方同行列时进行直击'});assert.equal(hidden.initialInvisible,true);
 const special=enemyBehaviorProfile({description:'首次攻击时造成溅射伤害',talentBlackboard:[{key:'AOEAttack.atk_scale',value:1.5}],skills:[{prefabKey:'AOEAttack',spCost:1,blackboard:[{key:'atk_scale',value:1.5}]}]});assert.equal(special.specialSkill.prefab,'AOEAttack');assert.equal(special.specialAtkScale,1.5);assert.equal(special.firstAttackSplash,true);
 const cross=enemyBehaviorProfile({description:'与我方处于同一直线上时进行直击',skills:[{prefabKey:'CrossAttack',cooldown:8,initCooldown:2,blackboard:[{key:'stun',value:5}]}]});assert.equal(cross.specialSkill.prefab,'CrossAttack');
 const refract=enemyBehaviorProfile({talentBlackboard:[{key:'refracting.magic_resistance',value:70}]});assert.equal(refract.magicResistanceBonus,70);
 const polluted=enemyBehaviorProfile({description:'只攻击地面单位，数次攻击后，下次攻击释放污染秽蚀，近战攻击造成更高伤害',talentBlackboard:[{key:'Empty.attack@chuang_atk_scale',value:2}],skills:[{prefabKey:'PollutedRangedAtk',spCost:2,blackboard:[{key:'polluted_damage_low',value:50}]}]});assert.equal(polluted.specialSkill.prefab,'PollutedRangedAtk');assert.equal(polluted.meleeAttackScale,2);assert.equal(polluted.pollutedDamage,50);assert.equal(polluted.randomPoolEligible,true);
});
test('ranged enemies resume route after a temporary attack-only action',()=>{
 const e={x:0,y:0,hp:1,route:[{kind:'move',x:2,y:0}],cmd:0,speed:1,statuses:[],block:null,action:{left:1,target:9},movementPolicy:ENEMY_MOVEMENT_POLICIES.STOP_WHILE_ATTACKING};
 advanceEnemy(e,.5,null,enemyShouldHoldPosition(e,{target:{uid:9,x:1,y:0,hp:1},now:0}));
 assert.equal(e.x,0);
 e.action=null;
 advanceEnemy(e,.5,null,enemyShouldHoldPosition(e,{target:{uid:9,x:1,y:0,hp:1},now:.5}));
 assert.equal(e.x,.5);
});
test('native enemy common effects apply stun, elemental injury and death explosion once',()=>{
 const b=liveBattle(),u=b.s.units[0];u.x=1;u.y=1;const enemy={uid:500,x:1,y:1,hp:100,maxHp:100,atk:100,attackStunEvery:1,attackStunDuration:2,attackElement:'neural',attackElementScale:.2,deathExplosion:{type:'physical',scale:1,radius:1},enemyDeathHandled:false};
 b.resolveEnemyAttackEffects(enemy,u);assert.ok(u.statuses.some(s=>s.kind==='stun'));assert.equal(u.elemental.neural,20);
 u.statuses=[];enemy.attackCount=0;enemy.skillAttackCount=0;applyStatus(enemy,'silence',2);b.resolveEnemyAttackEffects(enemy,u);assert.equal(u.statuses.some(s=>s.kind==='stun'),false);assert.equal(u.elemental.neural,40);
 const hp=u.hp;enemy.hp=0;b.resolveEnemyDeath(enemy);assert.equal(u.hp<hp,true);const after=u.hp;b.resolveEnemyDeath(enemy);assert.equal(u.hp,after);
});
test('native enemy special attacks consume their trigger and reveal invisible attackers',()=>{
 const b=liveBattle(),u=b.s.units[0],target={uid:12,x:1,y:1,hp:100};b.s.time=2;
 const aoe={uid:700,x:0,y:0,hp:100,specialSkill:{prefab:'AOEAttack',spCost:1,bb:{atk_scale:1.5}},specialAtkScale:1.5,firstAttackSplash:true,firstAttackUsed:false,skillAttackCount:0};assert.equal(b.enemySpecialReady(aoe,target).prefab,'AOEAttack');aoe.firstAttackUsed=true;assert.equal(b.enemySpecialReady(aoe,target),null);
 const hidden={uid:701,atk:100,damageType:'physical',invisible:true,specialSkill:{prefab:'InvisibleCombat'},specialAtkScale:2,block:u.uid};let scale=0;b.hurt=(_u,e)=>{scale=e.atk/100;};b.resolveEnemyStrike(hidden,u,{});assert.equal(scale,2);assert.equal(hidden.invisible,false);assert.ok(hidden.invisibleRecoverAt>0);
});
test('enemy partner auras couple guard and blade behavior without leaking to distant allies',()=>{
 const b=liveBattle(),u=b.s.units[0];u.x=0;u.y=0;const guard={uid:800,name:'深池伙友卫队',x:0,y:0,hp:100,baseDef:0,baseRes:0,def:0,res:0};const blade={uid:801,name:'深池伙友影刃精英',x:1,y:0,hp:100,baseDef:0,baseRes:0,def:0,res:0};b.s.enemies=[guard,blade];b.refreshEnemyAuras();assert.equal(u.enemyAttackSpeedMod,-30);assert.equal(blade.attackIntervalMod,-1.3);const distant={...u,uid:999,x:5,y:5,deployed:true,hp:100};b.s.units.push(distant);b.refreshEnemyAuras();assert.equal(distant.enemyAttackSpeedMod,0);
});
test('DeathEye channel locks a target, ticks arts damage, then bursts necrosis',()=>{
 const b=liveBattle(),u=b.s.units[0];u.x=0;u.y=0;const enemy={uid:900,x:0,y:1,hp:1000,maxHp:1000,atk:100,range:2.5,specialSkill:{prefab:'DeathEye',bb:{hit_duration:2,hit_interval:1,atk_scale:.4,ep_damage_ratio:2}},deathEye:null,stanceUntil:0};b.s.enemies=[enemy];b.s.time=1;assert.equal(b.startEnemyDeathEye(enemy,u),true);b.s.time=1;b.tickEnemyDeathEye();assert.ok(enemy.deathEye);const hp=u.hp;b.s.time=2;b.tickEnemyDeathEye();assert.ok(u.hp<hp);b.s.time=3;b.tickEnemyDeathEye();assert.equal(enemy.deathEye,null);assert.ok(u.elemental?.necrosis>0||b.s.events.some(e=>e.type==='element'));assert.ok(b.s.events.some(e=>e.type==='enemy-skill-end'));
});
test('PollutedRangedAtk creates a persistent allied damage zone after its charged attack',()=>{
 const b=liveBattle(),u=b.s.units[0];u.x=0;u.y=0;const enemy={uid:901,x:0,y:1,hp:1000,atk:100};b.s.enemies=[enemy];addEffect(b,{kind:'zone',sourceUid:enemy.uid,talentOrSkillId:'polluted-test',x:u.x,y:u.y,radius:1.7,interval:1,nextAt:1,endsAt:10,trackArea:true,trackSide:'ally',values:{dot:true,type:'true'},snapshot:{damage:50},refKind:'owner',persistAfterSourceGone:true});b.s.time=1;tickLogic(b,1);assert.ok(u.hp< u.maxHp);b.s.time=11;tickLogic(b,1);assert.equal(b.s.logicEffects.length,0);const hp=u.hp;b.s.time=12;tickLogic(b,1);assert.equal(u.hp,hp);
});
test('native enemy low-health phase changes movement once and restores it after its window',()=>{
 const b=liveBattle();const e={uid:500,x:0,y:0,hp:50,maxHp:100,atk:1,baseAtk:1,def:0,res:0,baseDef:0,baseRes:0,speed:1,baseSpeed:1,interval:1,attackSpeed:100,regen:0,canAttack:false,ranged:false,range:0,damageType:'physical',flying:false,route:[{kind:'move',x:0,y:0},{kind:'move',x:6,y:0}],cmd:0,cmdLeft:null,block:null,hidden:false,invisible:false,untargetable:false,unblockable:false,statuses:[],immunities:{},movementPolicy:ENEMY_MOVEMENT_POLICIES.ALWAYS_MOVE_ATTACK,lowHpRatio:.5,lowHpMoveMultiplier:2,lowHpUnblockTime:1,lowHpTriggered:false,stallTimeout:2,attackCooldown:0,action:null,burstUntil:0,stanceUntil:0};b.s.enemies=[e];b.step();assert.equal(e.lowHpTriggered,true);assert.equal(e.speed,2);assert.equal(e.unblockable,true);for(let i=0;i<31;i++)b.step();assert.equal(e.unblockable,false);
});
test('native mode multipliers remain independent of skill percentages',()=>{
 const b=liveBattle(),u=b.s.units[0],original=b.profile(u);b.rows={};b.s.band='band_dusk';b.s.units.push({...u,uid:999});
 b.profile=()=>({...original,branch:'fighter',attributes:{...original.attributes,atk:100},activeTalents:[],garrisons:[],skill:{blackboard:[{key:'atk',value:1}]}});u.skillLeft=10;u.source.equipment=[];
 assert.equal(b.stats(u).atk,260);assert.ok(b.stats(u).parts.some(p=>p.src==='策略·夕'&&p.layer==='mul'));
});
test('explicit skill flow overrides and description changes do not alter reset policy',()=>{
 const base={spData:{spCost:10,spType:'INCREASE_WITH_TIME'},duration:0,description:'立即回复'};
 assert.equal(skillFlow(base).resetAttack,false);assert.equal(skillFlow({...base,combatFlow:{resetAttack:true}}).resetAttack,true);
});

test('compiled routes preserve spawn and teleport distance',()=>{
 const route=compileRoute({startPosition:{col:0,row:0},endPosition:{col:4,row:0}},to,false,bfs);
 assert.deepEqual(route[0],{kind:'move',x:0,y:0});
 assert.equal(remainingDistance({x:0,y:0,cmd:0,route:[{kind:'appear',x:100,y:0},{kind:'move',x:101,y:0}]}),1);
});
test('nonmovement checkpoint placeholder positions never create extra paths',()=>{
 const route=compileRoute({startPosition:{col:10,row:0},endPosition:{col:11,row:0},checkpoints:[{type:'DISAPPEAR',position:{col:0,row:0}},{type:'WAIT_FOR_SECONDS',time:2,position:{col:0,row:0}},{type:'APPEAR_AT_POS',position:{col:10,row:0}}]},to,false,bfs);
 assert.equal(route.some(s=>s.kind==='move'&&s.x===0),false);
});
test('waiting and movement share one time budget in both directions',()=>{
 const unit=route=>({hp:1,route,cmd:0,x:0,y:0,speed:1,statuses:[]});
 const a=unit([{kind:'wait',time:.05},{kind:'move',x:1,y:0}]);advanceEnemy(a,.1);assert.ok(Math.abs(a.x-.05)<1e-9);
 const b=unit([{kind:'move',x:.05,y:0},{kind:'wait',time:.1},{kind:'move',x:1,y:0}]);advanceEnemy(b,.1);assert.ok(Math.abs(b.cmdLeft-.05)<1e-9);
});
test('attack holds movement; disappearing clears an attack and reappears after wait',()=>{
 const e={hp:1,route:[{kind:'move',x:1,y:0}],cmd:0,x:0,y:0,speed:1,statuses:[]};
 advanceEnemy(e,.1,null,true);assert.equal(e.x,0);
 e.route=[{kind:'disappear'},{kind:'wait',time:.2},{kind:'appear',x:3,y:0},{kind:'move',x:4,y:0}];e.action={target:1};
 advanceEnemy(e,.1);assert.equal(e.hidden,true);assert.equal(e.action,null);
 advanceEnemy(e,.2);assert.equal(e.hidden,false);assert.ok(Math.abs(e.x-3.1)<1e-9);
});
test('combat event kind survives damage metadata and reaches renderer',()=>{
 const s={time:1};for(const kind of ['attack','impact','hit'])emitEvent(s,kind,{type:'physical'});
 assert.deepEqual(s.events.map(e=>e.type),['attack','impact','hit']);assert.equal(recent(s.events,1,'hit').length,1);
 assert.equal(s.events[2].damageType,'physical');assert.equal(s.events[2].id,3);
});
test('delayed impacts cannot be delivered in the current frame',()=>{
 const s={time:0};scheduleStrikes(s,1,{delay:2/30});assert.equal(dueStrikes(s).length,0);s.time=2/30;assert.equal(dueStrikes(s).length,1);
});

const to=p=>({x:p.col,y:p.row});
const bfs=(from,dest)=>from.x===dest.x&&from.y===dest.y?[]:[dest];

test('remaining distance uses leftover segment, not node count',()=>{
 const short={route:[{kind:'move',x:0,y:0},{kind:'move',x:2,y:0}],cmd:0,x:0,y:0,uid:1};
 const long={route:[{kind:'move',x:0,y:1},{kind:'move',x:5,y:1}],cmd:0,x:0,y:1,uid:2};
 assert.ok(remainingDistance(short)<remainingDistance(long));
 const a={...short,x:1.5},b={...long,x:.2,uid:3};
 assert.ok(remainingDistance(a)<remainingDistance(b));
 const ranked=[b,a].sort((x,y)=>compareOperatorTargets(x,y,0,null,'MELEE'));
 assert.equal(ranked[0].uid,a.uid);
});

test('fastshot keeps air priority over remaining distance',()=>{
 const near={route:[{kind:'move',x:0,y:0},{kind:'move',x:1,y:0}],cmd:0,x:0,y:0,uid:1,flying:false};
 const farAir={route:[{kind:'move',x:0,y:1},{kind:'move',x:8,y:1}],cmd:0,x:0,y:1,uid:2,flying:true};
 const ranked=[near,farAir].sort((a,b)=>compareOperatorTargets(a,b,0,'air','RANGED'));
 assert.equal(ranked[0].uid,2);
});

test('blocking keeps the current pair instead of reshuffling each pass',()=>{
 const units=[{uid:1,x:0,y:0,hp:1,deployed:true,statuses:[]}];
 const a={uid:2,x:0,y:0,hp:1,flying:false,block:1,blockCost:1,statuses:[]};
 const b={uid:3,x:0,y:0,hp:1,flying:false,block:null,blockCost:1,statuses:[]};
 resolveBlocks(units,[b,a],()=>1);
 assert.equal(a.block,1);assert.equal(b.block,null);
 units[0].hp=0;resolveBlocks(units,[a,b],()=>1);
 assert.equal(a.block,null);
});

test('wait checkpoints consume time instead of being skipped',()=>{
 const route=compileRoute({startPosition:{col:0,row:0},endPosition:{col:2,row:0},checkpoints:[{type:'MOVE',position:{col:1,row:0}},{type:'WAIT_FOR_SECONDS',time:.5,position:{col:0,row:0}}]},to,false,bfs);
 const e={hp:1,route,cmd:0,cmdLeft:null,x:0,y:0,speed:10,statuses:[],block:null,hidden:false};
 let left=.5;while(left>0&&e.cmd<e.route.length){advanceEnemy(e,.05);left-=.05;}
 assert.equal(e.x,1);assert.ok(e.route.some(s=>s.kind==='wait'));
 assert.ok(e.cmdLeft>0||e.route[e.cmd]?.kind==='wait'||e.x>=1);
});

test('multi-hit strikes are queued on later frames',()=>{
 const s={time:0,strikes:[]};scheduleStrikes(s,3,{owner:1});
 assert.equal(dueStrikes(s).length,1);assert.equal(s.strikes.length,2);
 s.time=2/30;assert.equal(dueStrikes(s).length,1);
});

// 用户 2026-09-19 口径：每回合无论漏怪多少，生命最多扣 10 点（ROUND_LEAK_CAP）。
// 只限扣血，漏失真值照旧进战报与 s.lastBattle.leaks。
test('每回合漏怪掉血上限 10 点：漏失真值留档，扣血按上限',()=>{
 const b=liveBattle(),g=b.economy;
 b.s.queue=[{id:'noop',at:1e9,route:0,cost:0}];
 g.s.hp=g.s.maxHp=23;
 b.s.leaks=23;b.finish('complete');
 assert.equal(b.s.result.leaks,23,'战斗记录保留真实漏失数');
 g.finishCurrentBattle();
 assert.equal(g.s.hp,13,'单回合最多掉 10 点血');
 assert.equal(g.s.lastBattle.leaks,23,'战报里的漏失数同样不被截断');
 assert.equal(g.s.lastBattle.loss,10,'结算演出读的就是这个上限后的扣血值');
});
// 判负条件也用上限后的值：上限救得回来的回合不会因为漏失数超过当前生命就提前结束。
test('漏失判负按上限后的扣血算，不是按原始漏失数',()=>{
 const b=liveBattle(),g=b.economy;
 b.s.queue=[{id:'noop',at:1e9,route:0,cost:0}];   // 场上留一条排队项，避免「清场」提前结束
 g.s.hp=23;b.s.leaks=12;b.step();
 assert.equal(b.s.finished,false,'漏失 12 按上限只算 10 点，生命 23 不该判负');
 g.s.hp=8;b.s.leaks=23;b.step();
 assert.equal(b.s.finished,true,'上限 10 点已超过当前生命 8 点，才结束战斗');
});
