import {paintDominion,dominionCell,tickDeepWater,tickSandStorm} from './native-environment.js';
import {tickEnemyParasites,parasiteElementMultiplier,spreadParasiteElement,detachEnemyParasites} from './native-enemy-parasite.js';
import {advanceEnemyFear} from './native-enemy-fear.js';
import {initEnemyTransport,tickEnemyTransport,syncPassengerPositions,unloadEnemyTransport} from './native-enemy-transport.js';
import {enemyFormShiftEnded,initEnemyForm,enemyFormBeforeDamage,tickEnemyForm,enemyFormStats,enemyPhaseDamageMultiplier,enemyFormFatal,enemyFormAfterDamage,enemyFormHealthChanged,releaseParrotPassenger} from './native-enemy-forms.js';
import {enemyAttackTargets,enemyAttackTargetCount,releaseEnemyAttack,deliverEnemyAttack,tickEnemyProjectiles} from './native-enemy-attacks.js';
import {liberateEnemyPrisoners,enemyKnightExit,enemyTraitBeforeStrike,refreshEnemyMudrockShield,enemyTraitDamageDealt,tickEnemyAttackContinuity,enemyConditionalAttackMultiplier,tickPompeiiExplosion,enemyConditionalAttackSpeed,tickEnemyNeurotoxin,enemyFacingAfterMove,enemyFacingDamageMultiplier,tickEnemyLancer,consumeEnemyLancerRush,initEnemyTraits,refreshEnemyTraitStats,tickEnemyTraits,enemyTraitAfterDamage,enemyTraitBeforeAttack,enemyTraitOnHit,enemyTraitAfterAttack,enemyTraitOnDeath,enemyNearbyExit,enemyStealAmmo,syncEnemyConcealMarker,applyEnemyTraitAuras} from './native-enemy-traits.js';
import {checkWEnrage,initEnemySkills,enemySpEvent,selectEnemyAttackSkill,beginEnemySkill,endEnemySkill,tickEnemySkills,cancelEnemyCast} from './native-enemy-skills.js';
import {branchBehavior,branchTrait,skillAntiAir} from './native-branches.js';
import {equipmentStatMods,equipGenericExcluded,equipMagicPenetration,equipWeakness} from './native-equipment.js';
import {nativeWavePlan} from './native-waves.js';
import {damage,applyDamage,recoverHP,attackTiming,FPS} from './combat.js';
import {applyStatus,tickStatuses,permissions,statusAttributeChanges,isIsolated} from './status.js';
import {blackboard,skillPolicy,shouldAutoSkill,ROUND_LEAK_CAP} from './protocol.js';
import {createTrainingDummy,dummySummary} from './benchmark.js';
import {usesSp,spTypeOf,skillKind,ammoCount,initSpOf,gainSp,tickTimeSp} from './native-sp.js';
import {containsTarget} from './targeting.js';
import {remainingDistance,compareOperatorTargets,compareEnemyTargets,resolveBlocks,compileRoute,advanceEnemy,skillFlow,combineStat,emitEvent,pruneEvents,scheduleStrikes,dueStrikes,windupSeconds,TENTATIVE_PROJECTILE_SPEED,enemyBehaviorProfile,enemyTargetValid,enemyTargetInRange,enemyShouldHoldPosition,enemySpecialTraitId,enemyBleedingTraitId,ENEMY_MOVEMENT_POLICIES} from './native-combat.js';
import {skillWidensRange,rangeGeometry} from './protocol.js';
import {operatorRegistry,attackModifier,attackPenetration,coinCapFor,coinGainAtSkillStart,grantCoins,spendCoins,moduleCostData,tokenCostFor} from './native-operator-effects.js';
import {enemyWineBuffs,ensureBattleShape,migrateBattle,validateBattle,dealDamage,applyHeal,applyRegen,applyLoss,applyElementDamage,addEffect,commitExit,reviveActor,tickLogic,effectStatMods,dispatch,newAttackId,attackableAllies,getActor,blockingActors,alliedActors,operatorSkillConfig,moveActor,teleportActor,canRelocateTo,nearbySpots,spawnSummon,grantGuard,chebyshev} from './native-effects.js';

export class NativeBattle {
 constructor(data,economy,map,turn,{restore=false}={}){
  this.data=data;this.economy=economy;this.map=map;this.turn=turn;this.operatorRegistry=operatorRegistry(data);
  this.rows=economy.bonds();this.layers=economy.s.bondLayers;this.garrisonCounters=new Map();this.zoneHitWindow=new Map();
  if(restore)return;
  this.s={elementRulesVersion:1,frame:0,time:0,cost:20,costInitial:20,costMin:0,costMax:99,costRecoveryInterval:1,costRecoveryClock:0,enemyCostRecoveryMultiplier:1,enemyRespawnTimeMultiplier:1,mlyssFirstRhineDiscountUsed:false,bondLateranoAmmoStacks:0,bondEgirReviveCount:0,bondYanGuardiansSpawned:false,units:[],enemies:[],projectiles:[],queue:[],damage:{},leaks:0,kills:0,finished:false,benchmark:!!turn.isBossTurn,limit:turn.isBossTurn?turn.bossTurnHpReduceTime:turn.normalPhaseTime,effects:[],events:[],strikes:[],banner:null,nextId:100000};
  this.s.band=economy.s.bandId;this.s.banner={text:'作战开始',life:1.6};
  const sources=economy.s.units.filter(u=>u.position).sort((a,b)=>a.position.y-b.position.y||a.position.x-b.position.x);
  this.s.units=sources.map((u,i)=>{const p=this.profile(u),a=p.attributes,skill=p.skill,costData=moduleCostData(p);return {uid:u.uid,id:u.charId,chessId:u.chessId,source:u,x:u.position.x,y:u.position.y,dir:u.dir,hp:a.maxHp,maxHp:a.maxHp,baseCost:a.cost||0,deploymentCost:0,lastDeploymentCost:0,redeployPenalty:0,waitingCost:false,runtimeCost:costData.runtimeCost,runtimeCostActive:costData.runtimeCostActive,runtimeCostUsed:false,refundRatio:costData.refundRatio,refundIgnoresCap:costData.refundIgnoresCap,chargerKillCost:costData.chargerKillCost,merchantCost:costData.merchantCost,merchantInterval:costData.merchantInterval,sp:initSpOf(skill),spCd:0,spLock:0,coins:0,deployed:false,deployAt:0,down:0,skillLeft:0,skillCount:0,ammo:0,ammoMax:0,attackCooldown:0,action:null,statuses:[],immunities:{stun:a.stunImmune,silence:a.silenceImmune,frozen:a.frozenImmune,sleep:a.sleepImmune,levitate:a.levitateImmune,fear:a.fearedImmune,terror:a.fearedImmune,tremble:a.palsyImmune,root:a.attractImmune},shield:0,barriers:[],shieldLayers:[],damage:0,healing:0,lastAttack:0,lastSkill:-999,counters:{},buffs:[],deployGen:0,exitLife:null};});
  ensureBattleShape(this.s);dispatch(this,'battle-start',{target:null});for(const u of this.s.units)this.deploy(u);this.spawnPreparedSummons();
  if(this.s.benchmark){this.s.enemies=[createTrainingDummy(this.s.nextId++,9,1)];this.s.total=1;}else this.prepareWaves(turn);
  // 入场的血量在同一次 deploy 里已经按 stats 设过；这里如果无脑刷回满值，
  // 会把「部署后立即流失生命」这类入场被动（如宴 S2）的结果覆盖掉，所以只补没走过入场的单位。
  for(const u of this.s.units){const stats=this.stats(u);u.maxHp=stats.maxHp;if(!u.deployed)u.hp=stats.maxHp;}
 }
 spawnPreparedSummons(){
  for(const card of this.economy.s.summonCards||[]){if(!card.position)continue;const owner=this.s.units.find(u=>u.uid===card.ownerUid);if(!owner)continue;let token=null;
   if(card.type==='vigil-wolf')token=spawnSummon(this,owner,{type:'vigil-wolf',name:'狼群',x:card.position.x,y:card.position.y,targetable:true,canBlock:true,canAttack:true,blockCnt:2,lives:2,nextLifeAt:this.s.time+25,occupiesTile:true,preparedCard:true});
   if(card.type==='mlyss-fluid')token=spawnSummon(this,owner,{type:'mlyss-fluid',name:'流形',x:card.position.x,y:card.position.y,synthetic:true,targetable:true,canBlock:true,canAttack:true,occupiesTile:true,persistAfterSourceGone:true,preparedCard:true});
   if(card.type==='silent-drone')token=spawnSummon(this,owner,{type:'silent-drone',name:'医疗无人机',x:card.position.x,y:card.position.y,targetable:false,healable:false,canBlock:false,canAttack:false,canHeal:true,device:true,maxHp:1,atk:this.stats(owner).atk,duration:10,persistAfterSourceGone:true,healScale:.5,preparedCard:true});
   if(card.type==='skadi2-seaborn')token=spawnSummon(this,owner,{type:'skadi2-seaborn',tokenId:'token_10017_skadi2_dedant',name:'海嗣',x:card.position.x,y:card.position.y,targetable:true,canBlock:true,canAttack:true,occupiesTile:true,duration:30,persistAfterSourceGone:false,preparedCard:true});
   if(card.type==='cathy-device'){const anchor=this.s.units.filter(v=>v.uid!==owner.uid).sort((a,b)=>Math.hypot(a.x-card.position.x,a.y-card.position.y)-Math.hypot(b.x-card.position.x,b.y-card.position.y))[0];token=spawnSummon(this,owner,{type:'cathy-device',name:'支援装置',x:card.position.x,y:card.position.y,targetable:false,healable:false,canBlock:false,anchorUid:anchor?.uid,occupiesTile:false,device:true,preparedCard:true});if(token&&anchor){token.nextShieldAt=this.s.time;token.shieldId='cathy-'+token.uid;token.shieldCap=this.stats(owner).maxHp*.2;}}
   if(token){token.tacticalCardUid=card.uid;token.dir=card.dir??owner.dir;}
  }
 }
 attachRuntime(){
  this.rows=this.economy.bonds();this.layers=this.economy.s.bondLayers;this.s.band=this.economy.s.bandId;for(const u of this.s.units){const p=this.profile(u),d=moduleCostData(p);u.runtimeCost??=d.runtimeCost;u.runtimeCostActive??=d.runtimeCostActive;u.runtimeCostUsed??=Boolean(u.deployCount||u.deployed);u.refundRatio??=d.refundRatio;u.refundIgnoresCap??=d.refundIgnoresCap;u.chargerKillCost??=d.chargerKillCost;u.merchantCost??=d.merchantCost;u.merchantInterval??=d.merchantInterval;}
  if(this.s.benchmark){this.combatScale={atk:1,hp:1,moveSpeed:1};return;}
  const plan=nativeWavePlan(this.data,this.turn,this.economy.s.waveRoster);this.level=plan.level;this.combatScale=plan.scale||{atk:1,hp:1,moveSpeed:1};for(const e of this.s.enemies){const raw=this.level.enemyProfiles[e.id]||this.data.enemies[e.id]||this.data.enemyDependencies?.[e.id];if(raw){initEnemySkills(e,raw,this.s.time);initEnemyTraits(this,e,raw,{restore:true});initEnemyForm(this,e);initEnemyTransport(e);}}
 }
 static restore(data,economy,map,turn,saved){
  try{const b=new NativeBattle(data,economy,map,turn,{restore:true});
  const migrated=migrateBattle(saved);if(validateBattle(migrated,b))return null;
  b.s=migrated;b.attachRuntime();return b;}catch{return null;}
 }
 enemyFacingDamageMultiplier(target,source,type){return enemyFacingDamageMultiplier(target,source,type);}
 enemyPhaseDamageMultiplier(target,type){return enemyPhaseDamageMultiplier(target,type);}
 onActorShiftEnd(target){enemyFormShiftEnded(this,target);}
 enemyOutgoingDamageMultiplier(enemy){return enemy?.id==='enemy_1509_mousek'&&enemy.hp>0&&enemy.hp<enemy.maxHp*Number(enemy.enemyTalent['enrage.hp_ratio'])?Number(enemy.enemyTalent['enrage.damage_scale']):1;}
 dominionAttackSpeed(actor){return actor.deployed&&actor.hp>0&&!actor.hidden?dominionCell(this,actor)?.attackSpeed||0:0;}
 onActorMoved(actor){paintDominion(this,actor);}
 enemyAttackTiming(e){return attackTiming(Math.max(.1,e.interval+(e.attackIntervalMod||0)),Math.max(10,Math.min(600,(e.attackSpeed+enemyConditionalAttackSpeed(e)+(e.attackSpeedMod||0)+(e.operatorAttackSpeedMod||0)+enemyWineBuffs(this,e).attackSpeed+statusAttributeChanges(e).attackSpeed)*(e.waterAttackSpeedScale??1))),windupSeconds(Math.max(.1,e.interval+(e.attackIntervalMod||0))));}
 enemyAttackDamage(enemy,scale=1,target=null){return enemy.atk*scale*(enemy.id==='enemy_2048_smgrd'&&dominionCell(this,target)?Number(enemy.enemyTalent['DamageUp.atk_scale']):1)*enemyConditionalAttackMultiplier(enemy,target)*(enemy.waterAttackMultiplier??1)*(1+Math.min(0,statusAttributeChanges(enemy).attack||0));}
 enemyDamageDealt(enemy,opts,result){enemyTraitDamageDealt(this,enemy,result);}
 liberatePrisoners(){liberateEnemyPrisoners(this);}
 refreshMudrockShield(enemy,bb){refreshEnemyMudrockShield(this,enemy,bb);}
 enemyHealthChanged(enemy){checkWEnrage(this,enemy);enemyFormHealthChanged(this,enemy);}
 enemyBeforeDamage(target,opts){return enemyFormBeforeDamage(this,target,opts);}
 enemySkillTargets(enemy,options=null){return enemyAttackTargets(this,options?{...enemy,ranged:options.ranged??enemy.ranged,range:options.range??enemy.range,enemyAttack:{...enemy.enemyAttack,groundOnly:options.groundOnly??enemy.enemyAttack?.groundOnly,ignoreBlock:options.ignoreBlock??enemy.enemyAttack?.ignoreBlock}}:enemy);}
 enemyElementMultiplier(target){return parasiteElementMultiplier(this,target);}
 onElementBurst(payload){spreadParasiteElement(this,payload);}
 onActorExit(target,info){enemyKnightExit(this,target);detachEnemyParasites(this,target);if(target.enemyFormKind==='parrot')releaseParrotPassenger(this,target);unloadEnemyTransport(this,target);enemyNearbyExit(this,target,info);}
 enemyDamageReceived(enemy,opts,result){checkWEnrage(this,enemy);enemyFormAfterDamage(this,enemy,result);enemyTraitAfterDamage(this,enemy,opts,result);if(result.total>0&&opts.cause!=='dot'&&opts.cause!=='loss')enemySpEvent(enemy,'INCREASE_WHEN_TAKEN_DAMAGE');}
 profile(u){if(u.kind==='summon')return {branch:'summon',profession:'TOKEN',position:'MELEE',attributes:{...u,magicResistance:u.res||0},garrisons:[],trait:null,talents:[]};const row=this.data.profiles[u.chessId],selected=row?.skillChoices?.[u.source?.skillIndex??u.skillIndex],profile=selected?{...row,...selected}:row,extra=u.extraGarrisonIds?.map(id=>this.data.season.garrisonDataDict[id]).filter(Boolean)||[];return extra.length?{...profile,garrisons:[...(profile.garrisons||[]),...extra]}:profile;}
 skillActive(u){return u.skillLeft>0||u.ammo>0;}skillTimeLeft(sk){if(!sk)return 0;const text=String(sk.description||''),duration=sk.duration;if(/可以在下列状态和初始状态间切换/.test(text)||/持续时间无限/.test(text))return 1e9;if(typeof duration==='number'&&duration>0)return duration;if(duration!==-1)return 0;const finite=Number(blackboard(sk.blackboard).duration);return Number.isFinite(finite)&&finite>0?finite:0;}
 behavior(u){
  const active=this.skillActive(u),base=branchBehavior(this.profile(u),active);
  // 技能级的对空覆盖（PRTS 技能备注）：持续技在生效期内替换分支默认值；
  // 瞬时技/被动技没有「生效期」，它们的伤害就在开启那一帧结算，所以窗口只到当前时刻。
  const armed=u.skillAir;
  const override=armed&&armed.count===u.skillCount&&(active||this.s.time<=armed.until)?armed.value:null;
  return override==null?base:{...base,antiAir:override};
 }
  canHeal(target,source=null){
  if(!target?.deployed||target.hp<=0||target.isolated||target.downed||target.healable===false||(target.unhealable&&source?.uid!==target.uid))return false;
  const noExternal=this.behavior(target).noExternalHealing,selfException=noExternal&&source?.uid===target.uid;
  return selfException||(!noExternal&&!target.unhealable&&!target.statuses?.some(s=>s.kind==='healingBlocked'));
 }
 elementInjury(target){const value=target.elemental??target.elementInjury;return typeof value==='number'?Math.max(0,value):Math.max(0,...Object.values(value||{}).map(n=>Number(n)||0));}
  healingTargets(u,allowFull=false){const element=this.behavior(u).elementHealing,locked=u.papyrsTargetUid;return alliedActors(this.s).filter(v=>(locked==null||!this.skillActive(u)||v.uid===locked)&&this.canHeal(v,u)&&this.inside(u,v)&&(allowFull||v.hp<v.maxHp||(element&&this.elementInjury(v)>0))).sort((a,b)=>{const la=(this.profile(u).charId==='char_4042_lumen'&&(this.profile(u).skillIndex??u.source?.skillIndex)===2?Number((a.statuses||[]).some(s=>['stun','frozen','sleep','fear','root','silence'].includes(s.kind))):0),lb=(this.profile(u).charId==='char_4042_lumen'&&(this.profile(u).skillIndex??u.source?.skillIndex)===2?Number((b.statuses||[]).some(s=>['stun','frozen','sleep','fear','root','silence'].includes(s.kind))):0);return lb-la||(this.profile(u).charId==='char_4114_harold'?this.elementInjury(b)-this.elementInjury(a):a.hp/a.maxHp-b.hp/b.maxHp)||(element?this.elementInjury(b)-this.elementInjury(a):0)||a.uid-b.uid;});}
 inNamedRange(center,target,id){const range=this.data.ranges[id];return (range?.grids||[]).some(g=>{let x=g.col,y=-g.row;for(let i=0;i<(center.dir||0);i++)[x,y]=[-y,x];return Math.abs(center.x+x-target.x)<=.5&&Math.abs(center.y+y-target.y)<=.5;});}
  heal(source,target,amount,origin=source){
  if(!this.canHeal(target,source)||!Number.isFinite(amount)||amount<=0)return 0;
  const behavior=this.behavior(source),trait=branchTrait(this.profile(source));if(source.id==='char_4114_harold'&&this.skillActive(source)&&this.elementInjury(target)>target.maxHp*.5)amount*=Number(blackboard(this.profile(source).skill?.blackboard).trait_scale)||2;if(target.id==='char_1026_gvial2')amount*=target.hp/target.maxHp<.5?1.4:1.2;if(behavior.farHealRange&&!this.inNamedRange(source,target,behavior.farHealRange))amount*=trait.values.heal_scale??.8;if(behavior.healsDuringSkill&&this.skillActive(source))amount*=trait.values.heal_scale??.75;if(source.pendingHealBonus&&(!source.pendingHealBonus.requiresBelowHalf||target.hp/target.maxHp<.5)){amount+=target.maxHp*source.pendingHealBonus.ratio;source.pendingHealBonus=null;}
  if(source.pendingHealScale&&source.pendingHealScale>0){amount*=source.pendingHealScale;source.pendingHealScale=null;}
  const healed=applyHeal(this,{source,target,amount,origin});if(healed>0)this.cureHealCurableEffects(target);return healed;
 }
 healElements(source,target,amount){
  if(!this.canHeal(target,source)||amount<=0)return;let restored=0;const injury=target.elemental??target.elementInjury;if(typeof injury==='number'){restored=Math.min(injury,amount);target.elemental=injury-restored;}else if(injury){const [type,value]=Object.entries(injury).sort((a,b)=>(Number(b[1])||0)-(Number(a[1])||0))[0]||[];if(type){restored=Math.min(Number(value)||0,amount);injury[type]=(Number(value)||0)-restored;if(injury[type]<=0){target.elemental={};target.elementalType=null;target.elementalStartedAt=null;target.elementalBatch=null;}}}source.elementHealing=(source.elementHealing||0)+restored;
 }
 regenerate(source,target,amount){return applyRegen(this,{source,target,amount});}
 updateBranch(u,dt){
  const p=this.profile(u),behavior=this.behavior(u),trait=branchTrait(p).values,active=this.skillActive(u);
  if(p.branch==='librator'){if(u.branchSkillActive&&!active)u.branchCharge=0;if(!active)u.branchCharge=Math.min(trait.max_stack_cnt??40,(u.branchCharge||0)+dt);}
  u.branchSkillActive=active;
  if(p.branch==='merchant'){
   const interval=Math.max(.1,Number(u.merchantInterval||trait.interval)||3),fee=Math.abs(Number(u.merchantCost||trait.cost)||0);
   if(u.merchantDeployGen!==u.deployGen){u.merchantDeployGen=u.deployGen;u.merchantNextFeeAt=this.s.time+interval;}
   while(fee>0&&u.deployed&&u.hp>0&&this.s.time+1e-9>=u.merchantNextFeeAt){
   if(!this.spendCost(fee,{considerNegativeCost:true})){commitExit(this,{target:u,reason:'merchant-fee'});break;}
    const buyer=(p.activeTalents||[]).find(t=>/特性消耗费用时获得.*金币/.test(t.description||'')),skillIndex=p.skillIndex??u.source?.skillIndex,skillEnabled=active||(u.id==='char_1033_swire2'&&skillIndex<2);if(skillEnabled&&buyer){grantCoins(u,1,coinCapFor(p));const bb=blackboard(buyer.blackboard),max=Number(bb.max_stack_cnt)||0;if(max>0)u.merchantTalentStacks=Math.min(max,(u.merchantTalentStacks||0)+1);}
    this.emit('fee',{uid:u.uid,x:u.x,y:u.y,amount:fee,source:'merchant-trait'});u.merchantNextFeeAt+=interval;
   }
  }
  if(behavior.hpDrain)applyLoss(this,{target:u,amount:u.maxHp*(trait.hp_ratio??behavior.hpDrain)*dt,source:u,minHp:1});
  if(behavior.kind==='regeneration'){
   const bb=active?blackboard(p.skill?.blackboard):{},replaced=active&&(p.skill?.description||'').includes('特性变为');
   if(!replaced){const ratio=bb['attack@atk_to_hp_recovery_ratio']??trait['attack@atk_to_hp_recovery_ratio']??.1;const amount=this.stats(u).atk*ratio*dt;for(const ally of this.s.units)if(this.inside(u,ally))this.regenerate(u,ally,amount);}
  }
  if(u.pendingSelfHeals){const due=u.pendingSelfHeals.filter(h=>h.at<=this.s.time);u.pendingSelfHeals=u.pendingSelfHeals.filter(h=>h.at>this.s.time);for(const h of due)this.heal(u,u,h.amount);}
 }
 selfHealAfterDamage(u){
  if(!u.deployed||u.hp<=0)return;const behavior=this.behavior(u),amount=branchTrait(this.profile(u)).values.value||0;
  if(behavior.selfHealing==='musha')this.heal(u,u,amount);
  if(behavior.selfHealing==='reaper'){
   if(this.s.time-(u.reaperWindowStart??-999)>=.05){u.reaperWindowStart=this.s.time;u.reaperWindowCount=0;}
   if((u.reaperWindowCount||0)>=Math.max(0,this.stats(u).blockCnt))return;u.reaperWindowCount=(u.reaperWindowCount||0)+1;
   const at=Math.max(this.s.time,u.nextSelfHealAt||0);u.nextSelfHealAt=at+.12;if(at<=this.s.time)this.heal(u,u,amount);else (u.pendingSelfHeals??=[]).push({at,amount});
  }
 }
 branchAttackScale(u,target){
  const p=this.profile(u),behavior=this.behavior(u),trait=branchTrait(p),bb=trait.values;let scale=1;
  if(behavior.rangedPenalty&&target.block!==u.uid&&!(this.skillActive(u)&&(/不再降低|不降低/.test(p.skill?.description||'')||(p.charId==='char_172_svrash'&&(p.skillIndex??u.source?.skillIndex)===2))))scale*=bb.atk_scale??.8;
  if(behavior.unblockedBonus&&target.block!==u.uid)scale*=bb.atk_scale??1.2;
  if(behavior.frontScale&&this.inNamedRange(u,target,trait.rangeId||'1-3'))scale*=bb.atk_scale??1.5;
  if(behavior.magazine)scale*=bb.atk_scale??1.2;return scale;
 }
 releaseNativeAttack(u,action){
  const p=this.profile(u),behavior=this.behavior(u),trait=branchTrait(p).values,kind=action.kind||behavior.kind;
  if(kind==='heal'){
   if(behavior.style==='heal-chain'){
    let target=this.s.units.find(v=>v.uid===action.targets[0]&&this.canHeal(v,u)),power=action.amount;const visited=new Set(),extraChains=this.skillActive(u)?Number(blackboard(this.profile(u).skill?.blackboard)['attack@chain.extra_value'])||0:0,max=(trait['attack@chain.max_target']??3)+extraChains;let origin=u;
    for(let i=0;target&&i<max;i++){visited.add(target.uid);this.heal(u,target,power,origin);origin=target;const prev=target;target=alliedActors(this.s).filter(v=>!visited.has(v.uid)&&this.canHeal(v,u)&&this.inNamedRange({x:prev.x,y:prev.y,dir:0},v,behavior.jumpRange)).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp||b.deployAt-a.deployAt||a.uid-b.uid)[0];power*=trait['attack@chain.atk_scale']??.75;}
   }else for(const id of action.targets){const target=this.s.units.find(v=>v.uid===id);if(!target)continue;this.heal(u,target,action.amount);if(behavior.elementHealing)this.healElements(u,target,action.amount*(trait.ep_heal_ratio??.5));}
   this.emit('attack',{uid:u.uid,x:u.x,y:u.y,kind:'heal',type:'healing',style:behavior.style,skill:this.skillActive(u)});return 1;
  }
  let released=0;for(const id of action.targets){const target=this.s.enemies.find(e=>e.uid===id&&e.hp>0);if(!target)continue;const ranged=p.position==='RANGED'||(['lord','agent','hookmaster','shotprotector','fortress'].includes(p.branch)&&target.block!==u.uid);
   const hits=Math.max(1,action.hits||1);u.lockId=id;
   const wide=this.wideAttack(u);scheduleStrikes(this.s,hits,{owner:u.uid,target:id,x:u.x,y:u.y,amount:action.amount*this.branchAttackScale(u,target),baseAmount:action.baseAmount??action.amount,energyScale:action.energyScale??1,type:action.type,skill:!!action.enhanced||this.skillActive(u),style:behavior.style,radius:behavior.radius||0,antiAir:behavior.antiAir,ownerDeployment:u.deployAt,ranged,branch:p.branch,wide,returns:!!behavior.returnProjectile,storedEnergy:id===action.targets[0]?(action.storedEnergy||0):0,drone:!!behavior.drone});for(let extra=0;extra<(action.extraProjectiles||0);extra++)scheduleStrikes(this.s,1,{owner:u.uid,target:id,x:u.x,y:u.y,amount:action.amount*this.branchAttackScale(u,target),baseAmount:action.baseAmount??action.amount,energyScale:action.energyScale??1,type:action.type,skill:!!action.enhanced||this.skillActive(u),style:behavior.style,radius:behavior.radius||0,antiAir:behavior.antiAir,ownerDeployment:u.deployAt,ranged,branch:p.branch,wide,returns:!!behavior.returnProjectile,drone:!!behavior.drone});
   released+=hits;
  }this.emit('attack',{uid:u.uid,x:u.x,y:u.y,kind:'damage',targetX:this.s.enemies.find(e=>e.uid===action.targets[0])?.x,targetY:this.s.enemies.find(e=>e.uid===action.targets[0])?.y,type:action.type,style:behavior.style,skill:this.skillActive(u),radius:behavior.radius||0});return released;
 }
 deliverStrike(packet){
  if(packet.enemyAttack){deliverEnemyAttack(this,packet);return;}
  const u=this.s.units.find(x=>x.uid===packet.owner);if(!u)return;
  if(packet.effectOnly){this.emit('aftershock',{x:packet.x,y:packet.y,radius:packet.radius,type:packet.type});return;}
  if(packet.aftershock){const target=this.s.enemies.find(e=>e.uid===packet.target&&e.hp>0&&!e.hidden);if(target)this.hit(u,target,packet.amount,packet.type,{skill:packet.skill});return;}
  if(!u.deployed||u.hp<=0||packet.ownerDeployment!==u.deployAt||!permissions(u).attack)return;
  const target=this.s.enemies.find(e=>e.uid===packet.target&&e.hp>0);if(!target)return;
  this.emit('strike',{uid:u.uid,x:u.x,y:u.y,targetX:target.x,targetY:target.y,branch:packet.branch,style:packet.style,ranged:packet.ranged,hit:packet.hit,type:packet.type,wide:!!packet.wide});
  const shot={...packet,startX:packet.x,startY:packet.y,speed:TENTATIVE_PROJECTILE_SPEED,returning:false};
  if(packet.ranged){this.s.projectiles.push(shot);if(packet.returns)u.pendingReturns=(u.pendingReturns||0)+1;}
  else this.impactNativeAttack(u,target,shot);
  if(packet.hit===0&&packet.storedEnergy)for(let n=0;n<packet.storedEnergy;n++)this.s.projectiles.push({owner:u.uid,target:target.uid,x:u.x,y:u.y,amount:packet.baseAmount*Number(packet.energyScale||1),type:'arts',speed:TENTATIVE_PROJECTILE_SPEED,style:'single',branch:'mystic',antiAir:true,ownerDeployment:u.deployAt});
  if(packet.drone&&packet.hit===0){const trait=branchTrait(this.profile(u)).values;u.droneScale=u.droneTarget===target.uid?Math.min(trait.max_atk_scale??1.1,(u.droneScale??.2)+(trait.delta_atk_scale??.15)):(trait.init_atk_scale??.2);u.droneTarget=target.uid;const count=Math.max(1,u.floatUnits||1);for(let n=0;n<count;n++)this.s.projectiles.push({owner:u.uid,target:target.uid,x:u.x,y:u.y,amount:packet.amount*u.droneScale,type:'arts',speed:TENTATIVE_PROJECTILE_SPEED,style:'single',branch:'funnel',antiAir:true,ownerDeployment:u.deployAt});}
 }
 impactNativeAttack(u,target,packet){
  const p=this.profile(u);if(p.charId==='char_1047_halo2'&&packet.skill)packet.style='chain';const trait=branchTrait(p).values,eligible=e=>e.hp>0&&!e.invulnerable&&!permissions(e).sleeping&&(packet.antiAir||!e.flying||e.uid===target.uid);
  if(packet.style==='chain'){
   const visited=new Set();let victim=target,power=packet.amount;const max=trait['attack@max_target']??3;let origin={x:target.x,y:target.y};
   for(let i=0;victim&&i<max;i++){visited.add(victim.uid);if(i>0)this.emit('chain',{x:origin.x,y:origin.y,targetX:victim.x,targetY:victim.y,type:packet.type});origin={x:victim.x,y:victim.y};this.hit(u,victim,power,packet.type,{skill:packet.skill});applyStatus(victim,'sluggish',trait['attack@sluggish']??.5,{source:u.uid});const previous=victim;victim=this.s.enemies.filter(e=>eligible(e)&&!visited.has(e.uid)&&Math.hypot(e.x-previous.x,e.y-previous.y)<=1.7).sort((a,b)=>Math.hypot(a.x-previous.x,a.y-previous.y)-Math.hypot(b.x-previous.x,b.y-previous.y)||(a.progress||0)-(b.progress||0))[0];power*=(packet.skill||this.skillActive(u))&&/不再降低伤害|不再降低/.test(p.skill?.description||'')?1:.85;}return;
  }
  const splash=packet.style==='splash'||packet.style==='aftershock'||packet.style==='hammer'||(packet.style==='fortress'&&target.block!==u.uid);
  const victims=splash?this.s.enemies.filter(e=>eligible(e)&&Math.hypot(e.x-target.x,e.y-target.y)<=packet.radius):[target];
  for(const e of victims){const scale=packet.style==='hammer'&&e.uid!==target.uid?(trait['attack@atk_scale_2']??.5):1;this.hit(u,e,packet.amount*scale,packet.type,{skill:packet.skill});}
  if(packet.style==='aftershock')scheduleStrikes(this.s,1,{owner:u.uid,effectOnly:true,x:target.x,y:target.y,radius:packet.radius,type:packet.type,delay:2/30});
  if(packet.style==='aftershock')for(const e of victims)if(e.hp>0)scheduleStrikes(this.s,1,{owner:u.uid,target:e.uid,amount:packet.amount*(trait['attack@append_atk_scale']??.5),type:packet.type,skill:packet.skill,aftershock:true,delay:2/30});
  this.emit('impact',{x:target.x,y:target.y,radius:splash?packet.radius||0:0,style:packet.style,type:packet.type});
 }
 advanceNativeProjectiles(dt){
  const packets=this.s.projectiles;this.s.projectiles=[];for(const packet of packets){const u=this.s.units.find(u=>u.uid===packet.owner);if(!u)continue;
   if(packet.returning){if(!u.deployed||packet.ownerDeployment!==u.deployAt)continue;const dx=u.x-packet.x,dy=u.y-packet.y,d=Math.hypot(dx,dy);if(d<=packet.speed*dt){u.pendingReturns=Math.max(0,(u.pendingReturns||0)-1);continue;}packet.x+=dx/d*packet.speed*dt;packet.y+=dy/d*packet.speed*dt;this.s.projectiles.push(packet);continue;}
   const target=this.s.enemies.find(e=>e.uid===packet.target&&e.hp>0);if(!target){if(packet.returns){packet.returning=true;this.s.projectiles.push(packet);}continue;}
   const dx=target.x-packet.x,dy=target.y-packet.y,d=Math.hypot(dx,dy);if(d<=packet.speed*dt){packet.x=target.x;packet.y=target.y;this.impactNativeAttack(u,target,packet);if(packet.returns){packet.returning=true;this.s.projectiles.push(packet);}}else{packet.x+=dx/d*packet.speed*dt;packet.y+=dy/d*packet.speed*dt;this.s.projectiles.push(packet);}
  }
 }
 emit(type,extra={}){emitEvent(this.s,type,extra);}
 params(id){const b=this.data.season.bondInfoDict[id];return blackboard(this.data.season.effectBuffInfoDataDict[b?.effectId]?.find(e=>e.key==='env_gbuff_new')?.blackboard);}
 owns(u,id){const own=this.economy.ownBonds(u.source);return own.includes(id)||(own.includes('maniShip')&&this.data.common.bondInfoDict[id]?.isPower&&this.rows[id]?.active);}
 on(id){return !!this.rows[id]?.active;}
 stats(u){
  const mouseSandScale=(u.statuses||[]).filter(s=>s.kind==='mouseSandWeak').reduce((v,s)=>Math.min(v,s.value),1);
  if(u.kind==='summon')return {...u,atk:u.atk*(1+(u.sandAttackRatio||0))*mouseSandScale,attackSpeed:Math.max(10,Math.min(600,u.attackSpeed+this.dominionAttackSpeed(u))),magicResistance:u.res||0,tauntLevel:0,parts:[]};
  const p=this.profile(u),base={...p.attributes},l=this.layers,has=id=>this.on(id)&&this.owns(u,id),parts=[];
  let atk=u.sandAttackRatio||0,hp=0,def=0,as=0;const muls={atk:[],maxHp:[],def:[]};
  const note=(stat,layer,v,src)=>{if(v)parts.push({stat,layer,v,src});};
  const ratio=(stat,v,src)=>{if(!v)return;if(src.startsWith('盟约')||src.startsWith('策略')||src==='装备'||src==='部署加攻'||src==='击倒加攻'){muls[stat].push(1+v);note(stat,'mul',1+v,src);return;}if(stat==='atk')atk+=v;else if(stat==='maxHp')hp+=v;else def+=v;note(stat,'ratio',v,src);};
  const mul=(stat,v,src)=>{if(!Number.isFinite(v)||v===1)return;muls[stat].push(v);note(stat,'mul',v,src);};
  if(has('yanShip')){const b=this.params('yanShip'),v=b.base_atk+b.atk_per_stack*(l.yanShip||0);ratio('atk',v,'盟约·炎');}
  if(has('egirShip')){const b=this.params('egirShip'),v=b.base_max_hp+b.max_hp_per_stack*(l.egirShip||0);ratio('maxHp',v,'盟约·阿戈尔');}
  if(this.on('steadShip')){const b=this.params('steadShip'),v=b.base_max_hp+b.max_hp_per_stack*(l.steadShip||0);ratio('maxHp',v,'盟约·坚守');}
  if(this.on('deputShip')){const b=this.params('deputShip'),v=b.base_def+b.def_per_stack*(l.deputShip||0);ratio('def',v,'盟约·助力');base.respawnTime*=.7;}
  if(this.on('preciShip')&&(has('preciShip')||(this.rows.preciShip.count>=3&&p.position==='RANGED'))){const b=this.params('preciShip'),v=b.base_atk+b.atk_per_stack*(l.preciShip||0);ratio('atk',v,'盟约·精准');}
  if(has('soloShip')){ratio('atk',.6,'盟约·独行');ratio('maxHp',.6,'盟约·独行');}
  if(this.on('suntShip')&&p.isGolden)ratio('atk',.3,'盟约·绝技');
  if(this.on('raidShip')&&(l.raidShip||0)>=50){as+=50;note('attackSpeed','add',50,'盟约·突袭');}
  if(has('siracusaShip')){const b=this.params('siracusaShip');if(this.s.time-u.deployAt<b.base_duration+b.duration_per_stack*(l.siracusaShip||0)){const v=b.base_attack_speed+b.attack_speed_per_stack*(l.siracusaShip||0);as+=v;note('attackSpeed','add',v,'盟约·叙拉古');}}
  if(this.on('skillfulShip')){const radius=(l.skillfulShip||0)>=40?1.42:1.01;if(this.s.units.some(v=>v.deployed&&v.hp>0&&this.owns(v,'skillfulShip')&&Math.hypot(u.x-v.x,u.y-v.y)<radius)){const v=10+(l.skillfulShip||0);as+=v;note('attackSpeed','add',v,'盟约·灵巧');}}
  if(this.on('sargonShip')&&this.owns(u,'sargonShip')){u.sargonBuffs=(u.sargonBuffs||[]).filter(x=>x.endsAt>this.s.time);const b=this.params('sargonShip'),count=Math.min(Number(b.max_buff_stack_cnt)||25,u.sargonBuffs.length);as+=count*(Number(b.base_attack_speed)||12);if(this.rows.sargonShip.count>=6)ratio('atk',count*(Number(b.base_atk)||.12),'盟约·萨尔贡');}
  if(this.on('lateranoShip')&&this.owns(u,'lateranoShip')&&this.rows.lateranoShip.count>=6){const b=this.params('lateranoShip');ratio('atk',Math.min(Number(b.max_atk_for_consume)||2,(this.s.bondLateranoAmmoStacks||0)*(Number(b.atk_per_consume)||.04)),'盟约·拉特兰');}
  if(u.egirBorrowAtk>0)base.atk+=u.egirBorrowAtk;
  if(u.egirBorrowBlock>0)base.blockCnt=Math.max(base.blockCnt||0,u.egirBorrowBlock);
  if(u.raidBuffUntil>this.s.time){const b=this.params('raidShip');ratio('atk',Number(b.base_atk||.25)+Number(b.atk_per_stack||.01)*(l.raidShip||0),'盟约·突袭');ratio('maxHp',Number(b.base_max_hp||.25)+Number(b.max_hp_per_stack||.01)*(l.raidShip||0),'盟约·突袭');}if(u.garrisonDeployBuff&&this.s.time<u.garrisonDeployBuff.endsAt){base.atk+=u.garrisonDeployBuff.atk||0;base.maxHp+=u.garrisonDeployBuff.maxHp||0;note('atk','add',u.garrisonDeployBuff.atk||0,'部署卫戍');note('maxHp','add',u.garrisonDeployBuff.maxHp||0,'部署卫戍');}
  base.spRecoveryPerSec=p.attributes.spRecoveryPerSec??1;
  // 卫戍常驻加成。字段来源一律看原表 blackboard：
  //  char_attribute_mul        攻/生（+防）乘算
  //  attr_common_global_buff   技力自然恢复（古米，定值）
  //  attrByBond                每个盟约分别 ⌊层数/divide_num⌋ 后相加，作用到 atk/max_hp/def/攻速/回血/技力回复
  //  respawnTimeByBond         再部署时间按层数乘算
  //  env_gbuff_* + atk_per_stack 走同一套 stacks
  for(const g of p.garrisons){const b=blackboard(g.blackboard);
   if(g.battleRuneKey==='char_attribute_mul'){mul('atk',b.atk??1,'卫戍');mul('maxHp',b.max_hp??1,'卫戍');if(b.def)mul('def',b.def,'卫戍');}
   if(g.battleRuneKey==='env_gbuff_new_with_verify'&&b.bond_id&&b.atk_per_stack)ratio('atk',b.atk_per_stack*this.garrisonStacks(b.bond_id,b),'卫戍');
   if(b.key==='act1autochess_gar_eff_respawnTimeByBond'&&b.bond_id){const stacks=this.garrisonStacks(b.bond_id,b);if(stacks)base.respawnTime*=Math.max(0,1+Number(b.respawn_time||0)*stacks);if(stacks)note('respawnTime','mul',1+Number(b.respawn_time||0)*stacks,'卫戍');}
   if(b.key==='act1autochess_gar_eff_attrByBond'&&b.bond_id){const stacks=this.garrisonStacks(b.bond_id,b);
    if(stacks){const atkBonus=Number(b.atk||0)*stacks,hpBonus=Number(b.max_hp||0)*stacks,defBonus=Number(b.def||0)*stacks,asBonus=Number(b.attack_speed||0)*stacks,hpRec=Number(b.hp_recovery_per_sec||0)*stacks,spRec=Number(b.sp_recovery_per_sec||0)*stacks;
     if(atkBonus)ratio('atk',atkBonus,'卫戍');if(hpBonus)ratio('maxHp',hpBonus,'卫戍');if(defBonus)ratio('def',defBonus,'卫戍');
     if(asBonus){as+=asBonus;note('attackSpeed','add',asBonus,'卫戍');}
     if(hpRec){base.hpRecoveryPerSec=(base.hpRecoveryPerSec||0)+hpRec;note('hpRecoveryPerSec','add',hpRec,'卫戍');}
     if(spRec){base.spRecoveryPerSec+=spRec;note('spRecoveryPerSec','add',spRec,'卫戍');}}}
   if(b.sp_recovery_per_sec&&b.key!=='act1autochess_gar_eff_attrByBond')base.spRecoveryPerSec+=b.sp_recovery_per_sec;
  }
  for(const item of u.source.equipment){const record=this.data.season.trapChessDataDict[item.chessId];for(const effect of this.data.season.effectBuffInfoDataDict[record?.effectId]||[]){const b=blackboard(effect.blackboard);if(effect.key==='char_attribute_mul'){mul('atk',b.atk??1,'装备');mul('maxHp',b.max_hp??1,'装备');mul('def',b.def??1,'装备');}else if(effect.key.startsWith('env_gbuff')&&!equipGenericExcluded(b.key)){ratio('atk',b.atk||0,'装备');ratio('maxHp',b.max_hp||0,'装备');ratio('def',b.def||0,'装备');as+=b.attack_speed||0;base.magicResistance+=b.magic_resistance||0;base.spRecoveryPerSec+=b.sp_recovery_per_sec||0;}}}equipmentStatMods(this,u,{ratio,note,base,addAttackSpeed:value=>{as+=value;}});
  if(has('victoriaShip')&&this.rows.victoriaShip.count>=6)for(const i of u.source.equipment)ratio('atk',this.data.season.trapChessDataDict[i.chessId].isGolden?.8:.5,'盟约·维多利亚');
  if(this.s.units.some(v=>v.deployed&&v.hp>0&&v.id==='char_172_svrash'&&(this.profile(v).activeTalents||[]).some(t=>t.name==='领袖')))base.respawnTime*=.9;
  for(const talent of p.activeTalents||[]){const value=Number(blackboard(talent.blackboard).respawn_time);if(Number.isFinite(value))base.respawnTime+=value;}
  const band=this.s.band,count=Object.values(this.rows).filter(b=>b.active).length;
  if(band==='band_amiya'&&count>=3){const n=count>=5?.4:count===4?.3:.2;ratio('atk',n,'策略·阿米娅');ratio('maxHp',n,'策略·阿米娅');}
  if(band==='band_dusk'&&this.s.units.filter(v=>v.id===u.id).length>1)ratio('atk',.3,'策略·夕');
  if(band==='band_ioleta'&&p.isGolden){const n=this.s.units.filter(v=>this.profile(v).isGolden).length*.1;ratio('atk',n,'策略·伊奥莱塔');ratio('maxHp',n,'策略·伊奥莱塔');}
  ratio('atk',u.deathBuff||0,'击倒加攻');ratio('atk',u.deploymentBuff||0,'部署加攻');
  if(u.skillLeft>0||u.ammo>0){const b=blackboard(p.skill?.blackboard),cfg=operatorSkillConfig(this,u),skillText=p.skill?.description||'';ratio('atk',b.atk??cfg.bb.atk??0,'技能');const maxHpValue=Number(b.max_hp??cfg.bb.maxHp??0);if(maxHpValue){if(/生命上限[^，；。]*%/.test(skillText))ratio('maxHp',maxHpValue,'技能');else{base.maxHp+=maxHpValue;note('maxHp','add',maxHpValue,'技能');}}ratio('def',b.def??cfg.bb.def??0,'技能');base.magicResistance+=b.magic_resistance??cfg.bb.magicResistance??0;as+=b.attack_speed??cfg.bb.attackSpeed??0;base.baseAttackTime=Math.max(.1,base.baseAttackTime+(b.base_attack_time||0));}
  if(p.charId==='char_440_pinecn'&&(p.skillIndex??u.source?.skillIndex)===1&&this.skillActive(u)){const b=blackboard(p.skill?.blackboard),keys=['a','b','c','d'],key=keys[Math.min(3,Math.max(0,(u.pineSkillUses||1)-1))],bonus=Number(b[`pinecn_s_2[${key}].atk`])||0;ratio('atk',bonus,'松果·电能过载');}
  if(u.talentSpRecoveryUntil>this.s.time)base.spRecoveryPerSec+=u.talentSpRecovery||0;
  if(u.wildmaneAspdUntil>this.s.time)as+=u.wildmaneAspd||0;
  if(u.gravelDefBuff&&this.s.time<u.gravelDefBuff.endsAt){const left=Math.max(0,Math.min(1,(u.gravelDefBuff.endsAt-this.s.time)/u.gravelDefBuff.duration));ratio('def',(u.gravelDefBuff.ratio||0)*left,'砾·影袭');}
  if(u.warfarinBuff&&this.s.time<u.warfarinBuff.endsAt)ratio('atk',Number(u.warfarinBuff.atk)||0,'华法琳·不稳定血浆');
  if(u.angelBlessing){ratio('atk',Number(u.angelBlessing.atk)||0,'能天使·天使的祝福');ratio('maxHp',Number(u.angelBlessing.maxHp)||0,'能天使·天使的祝福');}
  if(u.vendlaBuff&&this.s.time<u.vendlaBuff.endsAt)base.tauntLevel+=(Number(u.vendlaBuff.taunt)||1);
  if(p.charId==='char_337_utage'){const talent=(p.activeTalents||[]).find(t=>t.name==='认真模式');if(talent){const bb=blackboard(talent.blackboard),floor=Number(bb.min_hp_ratio)||.3,progress=Math.max(0,Math.min(1,(1-(u.hp/u.maxHp||0))/(1-floor)));as+=Math.max(0,Number(bb.min_attack_speed)||100)*progress;note('attackSpeed','conditional',Math.max(0,Number(bb.min_attack_speed)||100)*progress,'宴·认真模式');}}
  if(p.charId==='char_430_fartth'){const focus=(p.activeTalents||[]).find(t=>t.name==='凝神'),bb=focus&&blackboard(focus.blackboard);if(focus&&this.s.time-(u.lastDamagedAt??u.deployAt??0)>=Number(bb.delay||10))ratio('atk',Number(bb.atk)||.15,'远牙·凝神');if(this.skillActive(u)&&(p.activeTalents||[]).some(t=>t.name==='屏息'))base.tauntLevel=Math.min(base.tauntLevel??0,-1);}
  if(p.charId==='char_1028_texas2'){const idx=p.skillIndex??u.source?.skillIndex,bb=blackboard(p.skill?.blackboard);if(idx===0)ratio('atk',Number(bb.atk)||.4,'缄默德克萨斯·部署被动');if(idx===1){ratio('atk',Number(bb.atk)||.3,'缄默德克萨斯·部署被动');u.passiveArts=true;}}
  if(p.charId==='char_1028_texas2'){const talent=(p.activeTalents||[]).find(t=>t.name==='德克萨斯剑术');if(talent&&!u.texas2Killed)as+=Number(blackboard(talent.blackboard).attack_speed)||8;const tradition=(p.activeTalents||[]).find(t=>t.name==='德克萨斯传统');if(tradition)ratio('atk',Number(blackboard(tradition.blackboard).atk)||.2,'缄默德克萨斯·传统');}
  if(p.charId==='char_373_lionhd'){const talent=(p.activeTalents||[]).find(t=>t.name==='破片杀伤');if(talent){const bb=blackboard(talent.blackboard),count=this.s.enemies.filter(e=>e.hp>0&&!e.hidden&&this.inside(u,e,true)).length;ratio('atk',Math.min(Number(bb.max_valid_stack_cnt)||5,count)*(Number(bb.atk)||.04),'莱恩哈特·破片杀伤');}}
  if(p.charId==='char_4122_grabds'&&this.skillActive(u)&&this.s.time>=(u.grabdsSleepUntil||Infinity))as+=Number(blackboard(p.skill?.blackboard).attack_speed)||90;
  if(p.charId==='char_4146_nymph'&&u.nymphStacks)ratio('atk',Math.min(10,u.nymphStacks)*(Number((p.activeTalents||[]).find(t=>t.name==='窥心钥')?.blackboard?.find?.(x=>x.key==='atk')?.value)||.02),'妮芙·窥心钥');
  if(p.charId==='char_4056_titi'){const talent=(p.activeTalents||[]).find(t=>t.name==='勇气的报偿');if(talent&&this.s.units.some(v=>v.deployed&&v.hp>0&&/minos|sargon/i.test(String(this.profile(v).groupId||this.profile(v).faction||''))&&v.hp/v.maxHp>Number(blackboard(talent.blackboard).hp_ratio||.5)))as+=Number(blackboard(talent.blackboard).attack_speed)||20;}
  if(p.charId==='char_1032_excu2'&&this.skillActive(u)&&(p.skillIndex??u.source?.skillIndex)===2){const bb=blackboard(p.skill?.blackboard),used=Math.max(0,(u.ammoMax||0)-(u.ammo||0));ratio('atk',Math.min(Number(bb['attack@max_stack_cnt'])||30,used)*(Number(bb['attack@atk'])||.04),'圣约送葬人·弹药叠层');}
  if(p.charId==='char_4087_ines'&&this.skillActive(u)&&(p.skillIndex??u.source?.skillIndex)===1)as+=u.inesStealAt||0;
  if(p.charId==='char_4196_reckpr'&&u.reckprAspdUntil>this.s.time)as+=Number((p.activeTalents||[]).find(t=>t.name==='学成于聚')?.blackboard?.find?.(x=>x.key==='attack_speed')?.value)||16;
  if(p.charId==='char_1047_halo2'&&u.haloStacks){const bb=(p.activeTalents||[]).find(t=>t.name==='数据建模')?.blackboard||[];const v=Number(bb.find(x=>x.key==='attack_speed')?.value)||1;as+=Math.min(Number(bb.find(x=>x.key==='max_stack_cnt')?.value)||18,u.haloStacks)*v;}
  if(p.charId==='char_4082_qiubai'&&u.qiubaiStacks)as+=u.qiubaiStacks*(Number(blackboard(p.skill?.blackboard).attack_speed)||13);
  if(p.charId==='char_4058_pepe'&&u.pepeStacks)ratio('atk',u.pepeStacks*(Number(blackboard(p.skill?.blackboard).attack_atk)||.1),'佩佩·叠层');
  if(p.charId==='char_4058_pepe'&&u.pepeSkillUses){const v=Number(blackboard(p.skill?.blackboard).attack_speed_extra)||20;as+=u.pepeSkillUses*v;}
  if(p.charId==='char_341_sntlla'&&u.talentStacks){const t=(p.activeTalents||[]).find(x=>x.name==='生于冰寒'),bb=t&&blackboard(t.blackboard);if(t){u.statusResistance=Math.max(u.statusResistance||0,Math.max(0,Math.min(1,-Number(bb.one_minus_status_resistance)||.5)));}}
  if(p.charId==='char_472_pasngr'){const t=(p.activeTalents||[]).find(x=>x.name==='孤卒'),bb=t&&blackboard(t.blackboard);if(t&&!this.s.enemies.some(e=>e.hp>0&&Math.max(Math.abs(e.x-u.x),Math.abs(e.y-u.y))<=4))ratio('atk',Number(bb.atk)||.08,'异客·孤卒');}
  if(p.charId==='char_1019_siege2'){const talent=(p.activeTalents||[]).find(t=>t.name==='诸王的叹息'),bb=talent&&blackboard(talent.blackboard);if(talent){const nearby=this.s.units.filter(v=>v.deployed&&v.hp>0&&v.uid!==u.uid&&Math.max(Math.abs(v.x-u.x),Math.abs(v.y-u.y))<=8).length;ratio('atk',nearby*(Number(bb.atk)||.05),'维娜·诸王的叹息');}if(this.skillActive(u)&&(p.skillIndex??u.source?.skillIndex)===1&&this.s.units.filter(v=>v.deployed&&v.hp>0&&Math.max(Math.abs(v.x-u.x),Math.abs(v.y-u.y))<=1).length>=2)base.spRecoveryPerSec+=Number(blackboard(p.skill?.blackboard).sp_recovery_per_sec)||.2;}
  if(p.charId==='char_1020_reed2'&&this.skillActive(u)&&(p.skillIndex??u.source?.skillIndex)===2)ratio('atk',Number(blackboard(p.skill?.blackboard)['reed2_skil_3[switch_mode].atk'])||.25,'焰影苇草·灼痕模式');
  if(p.charId==='char_4039_horn'&&this.skillActive(u)&&(p.skillIndex??u.source?.skillIndex)===2)ratio('atk',Number(blackboard(p.skill?.blackboard)['horn_s_3[overload_start].atk'])||.5,'号角·过载');
  if(p.charId==='char_391_rosmon'&&u.rosmonPartner)ratio('atk',.08,'迷迭香·感知稳定');
  if(u.thornDefBuffUntil>this.s.time)base.def+=Number(u.thornDefBuff)||0;
  if(p.charId==='char_4148_philae'&&u.philaeElementBoost&&this.skillActive(u))ratio('atk',Number(blackboard(p.skill?.blackboard).atk)||.8,'菲莱·元素反击');
  if(p.charId==='char_4145_ulpia'&&u.ulpiaKills){const t=(p.activeTalents||[]).find(x=>x.name==='血脉的哺养'),bb=t&&blackboard(t.blackboard);if(t){base.maxHp+=u.ulpiaKills*(Number(bb.max_hp)||120);base.atk+=u.ulpiaKills*(Number(bb.atk)||30);}}
  if(p.charId==='char_437_mizuki'){const talent=(p.activeTalents||[]).find(t=>t.name==='反移情');if(talent&&this.s.enemies.some(e=>e.hp>0&&!e.hidden&&e.maxHp>0&&e.hp/e.maxHp<=(Number(blackboard(talent.blackboard).hp_ratio)||.5)&&this.inside(u,e,true)))ratio('atk',Number(blackboard(talent.blackboard).atk)||.1,'水月·反移情');}
  if(p.charId==='char_1012_skadi2'){const talent=(p.activeTalents||[]).find(t=>t.name==='捕食习性');if(talent){const bb=blackboard(talent.blackboard),deep=this.s.units.some(v=>v.uid!==u.uid&&v.deployed&&v.hp>0&&this.profile(v).bonds?.includes('egirShip')&&this.inside(u,v,true));ratio('atk',Number(bb[deep?'skadi2_t_2[atk][2].atk':'skadi2_t_2[atk][1].atk'])|| (deep?.15:.06),'浊心斯卡蒂·捕食习性');}}
  if(p.charId==='char_1026_gvial2'){const blocked=this.s.enemies.filter(e=>e.hp>0&&e.block===u.uid).length,bonus=.1+.04*blocked;ratio('atk',bonus,'百炼嘉维尔·战地巨斧');ratio('def',bonus,'百炼嘉维尔·战地巨斧');}
  if(p.charId==='char_4013_kjera'){const talent=(p.activeTalents||[]).find(t=>t.name==='低眉');if(talent){const bb=blackboard(talent.blackboard),ground=(this.range(u,true)||[]).filter(g=>this.map.grid[g.y]?.[g.x]?.heightType!=='HIGHLAND').length;if(ground>=Number(bb.cnt||2))ratio('atk',Math.max(0,Number(bb['kjera_t_1[high].atk'])||.16)-Number(bb.atk||.1),'耶拉·低眉');}}
  if(p.charId==='char_2015_dusk'&&(u.duskTalentStacks||0)>0){const talent=(p.activeTalents||[]).find(t=>t.name==='化境');if(talent)ratio('atk',Math.min(Number(blackboard(talent.blackboard).max_stack_cnt)||15,u.duskTalentStacks)*(Number(blackboard(talent.blackboard).atk)||.02),'夕·化境');}
  if(this.skillActive(u)&&/阻挡数变为\s*0/.test(p.skill?.description||''))base.blockCnt=0;
  if(p.charId==='char_431_ashlok'){const talent=(p.activeTalents||[]).find(t=>t.name==='炮术研习');if(talent){const bb=blackboard(talent.blackboard),radius=Number(bb.cnt)||4;let ground=true;for(let y=Math.max(0,u.y-radius);y<=Math.min(this.map.rows-1,u.y+radius)&&ground;y++)for(let x=Math.max(0,u.x-radius);x<=Math.min(this.map.cols-1,u.x+radius);x++){const tile=this.map.grid[y]?.[x];if(tile?.heightType==='HIGHLAND')ground=false;}if(ground&&Number(bb['ashlok_t_1.atk'])>Number(bb.atk||0))ratio('atk',Number(bb['ashlok_t_1.atk'])-Number(bb.atk||0),'灰毫·炮术研习');}}
  if(p.charId==='char_4026_vulpis'&&this.skillActive(u)&&(p.skillIndex??u.source?.skillIndex)===2){const attackSpeed=Number(blackboard(p.skill?.blackboard).attack_speed)||0,duration=Number(p.skill?.duration)||10,progress=Math.max(0,Math.min(1,u.skillLeft/duration));as-=attackSpeed;as+=attackSpeed*progress;}
  if(p.charId==='char_498_inside'&&this.skillActive(u)&&(p.skillIndex??u.source?.skillIndex)===1)base.tauntLevel=Math.min(base.tauntLevel??0,-1);
  if(p.charId==='char_491_humus'&&this.skillActive(u)&&(p.skillIndex??u.source?.skillIndex)===1){const b=blackboard(p.skill?.blackboard),hpRatio=u.maxHp>0?u.hp/u.maxHp:0,peak2=Number(b['humus_s_2[peak_2].peak_performance.hp_ratio'])||.8,peak1=Number(b['humus_s_2[peak_1].peak_performance.hp_ratio'])||.5,bonus=hpRatio>peak2?Number(b['humus_s_2[peak_2].peak_performance.atk'])||0:hpRatio>peak1?Number(b['humus_s_2[peak_1].peak_performance.atk'])||0:0;ratio('atk',bonus,'休谟斯·精力充沛');}
  const branch=branchBehavior(p,this.skillActive(u)),trait=branchTrait(p).values;if(p.branch==='merchant'){const buyer=(p.activeTalents||[]).find(t=>/特性消耗费用时获得.*金币/.test(t.description||''));if(buyer){const bb=blackboard(buyer.blackboard);ratio('atk',(Number(bb.atk)||0)*(u.merchantTalentStacks||0),'大买家');}}if(p.branch==='phalanx'&&!this.skillActive(u)){ratio('def',trait.def??2,'法阵');base.magicResistance+=trait.magic_resistance??20;}if(p.branch==='librator'){ratio('atk',(trait.atk??2)*Math.min(1,Math.floor(u.branchCharge||0)/(trait.max_stack_cnt??40)),'解放者');if(!this.skillActive(u))base.blockCnt=0;}if(branch.blockZeroDuringSkill&&this.skillActive(u))base.blockCnt=0;if(branch.taunt!==undefined)base.tauntLevel=Math.min(base.tauntLevel??0,branch.taunt);
  const status=statusAttributeChanges(u);as+=status.attackSpeed;ratio('atk',status.attack||0,'状态');ratio('def',status.defense||0,'状态');base.magicResistance+=(status.resistance||0)+(status.magicResistance||0);
  for(const e of this.economy.s.operatorModifiers||[])for(const[k,v]of Object.entries(blackboard(e.blackboard))){const key={max_hp:'maxHp',atk:'atk',def:'def'}[k];if(key)mul(key,v,'全局修正');}
  const extra=effectStatMods(this,u);atk+=extra.ratio.atk||0;hp+=extra.ratio.maxHp||0;def+=extra.ratio.def||0;as+=extra.attackSpeed;base.magicResistance+=(extra.magicResistance||0)+(extra.add.magicResistance||0);base.spRecoveryPerSec+=extra.spRecoveryPerSec;base.blockCnt=Math.max(0,(base.blockCnt||0)+(extra.add.blockCnt||0));base.tauntLevel=(base.tauntLevel||0)+(extra.add.tauntLevel||0);parts.push(...extra.parts);
  const skillBlackboard=(u.skillLeft>0||u.ammo>0)?blackboard(p.skill?.blackboard):{};if(Object.hasOwn(skillBlackboard,'block_cnt')){const value=Number(skillBlackboard.block_cnt)||0;base.blockCnt=Math.max(0,/阻挡数[^，；。\n]*\+/.test(p.skill?.description||'')?base.blockCnt+value:value);}base.tauntLevel+=(skillBlackboard.taunt_level??0);
  const a={...base,atk:combineStat(base.atk,extra.add.atk||0,atk,muls.atk,extra.finalAdd.atk||0),maxHp:combineStat(base.maxHp,extra.add.maxHp||0,hp,muls.maxHp,extra.finalAdd.maxHp||0),def:combineStat(base.def,extra.add.def||0,def,muls.def,extra.finalAdd.def||0),attackSpeed:Math.max(10,Math.min(600,base.attackSpeed+as+(u.enemyAttackSpeedMod||0)+this.dominionAttackSpeed(u))),parts};
  a.respawnTime*=u.sandRespawnMultiplier??1;a.def=Math.max(0,a.def-(u.corrosionDefLoss||0));
  a.atk*=mouseSandScale;return a;
 }
 // ── 卫戍（干员特质）通用工具 ───────────────────────────────────────────────
 // 多盟约口径（用户 2026-09-19 确认）：bond_id 用逗号列出多个盟约时，**每个盟约分别**
 // ⌊层数/divide_num⌋ 后相加；「核心盟约每叠加 N 层」的 8 项列表就是全部核心盟约，直接求和。
 garrisonStacks(bondIds,bb){const div=Math.max(1,Math.floor(Number(bb?.divide_num)||1));return String(bondIds||'').split(',').filter(Boolean).reduce((sum,id)=>sum+Math.floor((this.layers[id]||0)/div),0);}
 // 给谁加层：bond_by_id（列出的盟约）／bond_self（自身所属的盟约）／
 // bond_actived_maxstack（已激活盟约中层数最多的那一个，并列随机取一个）。
 garrisonBonds(u,bb){
  const type=bb.bond_type||'bond_by_id';
  if(type==='bond_self')return this.economy.ownBonds(u.source);
  if(type==='bond_actived_maxstack'){const rows=this.economy.bonds();const ids=Object.keys(rows).filter(id=>rows[id].active&&!this.data.season.bondInfoDict[id].noStack);if(!ids.length)return[];const max=Math.max(...ids.map(id=>this.layers[id]||0));return[this.economy.pick(ids.filter(id=>(this.layers[id]||0)===max))];}
  return String(bb.bond_id||'').split(',').filter(Boolean);
 }
 // 每次加多少层：by_count（定值）／by_charcount_samerow（×同一行干员数，含自身）／by_charlevel（= 干员阶数）
 garrisonAmount(u,bb){const type=bb.bond_add_type||'by_count',multi=Number(bb.bond_add_count??1);
  if(type==='by_charlevel')return Number(u.source?.rank??this.profile(u).rank??1);
  if(type==='by_charcount_samerow')return multi*this.s.units.filter(v=>(v.deployed||v.source?.position)&&v.y===u.y).length;
  return multi;
 }
 // 每波计数箱：键 uid:garrisonId:event，battle 对象每波重建，所以「每场作战至多 N 层」天然按波重置。
 garrisonCounter(key,delta=1){const next=(this.garrisonCounters.get(key)||0)+delta;this.garrisonCounters.set(key,next);return next;}
 // range_id → 该干员按朝向覆盖的格子（「自身周围4格」= x-5、「身前一格」= 1-1、「自身」= 0-1）。
 garrisonRangeTiles(owner,rangeId){const grids=this.data.ranges?.[rangeId]?.grids;if(!grids?.length)return[{x:owner.x,y:owner.y}];return grids.map(g=>{let x=Number(g.col)||0,y=-(Number(g.row)||0);for(let i=0;i<(owner.dir||0);i++)[x,y]=[-y,x];return{x:owner.x+x,y:owner.y+y};});}
 garrisonInRange(owner,rangeId,target){return this.garrisonRangeTiles(owner,rangeId).some(t=>t.x===target.x&&t.y===target.y);}
 // 卫戍里的伤害乘算（只改伤害，不改命中与伤害类型判定）：
 //  attack_enemy        攻击带 check_tag（seamonster／drone）的敌人时「攻击力提升至 N 倍」
 //  ab_damageScaleByBond 打束缚/停顿目标时，每个盟约分别 ⌊层数/divide_num⌋ 后相加的增伤
 garrisonDamageScale(u,e){
  let scale=1;const tags=[...(e.tags||[]),...(e.categories||[]),...(e.enemyTags||[]),...(this.data.enemies[e.id]?.enemyTags||[])];
  for(const g of this.profile(u).garrisons||[]){
   if(!g||g.eventType!=='IN_BATTLE')continue;const b=blackboard(g.blackboard),key=b.key||'';
   if(key==='act1autochess_gar_eff_attack_enemy'){const tag=String(b.check_tag||'');if(tag&&tags.includes(tag))scale*=Number(b.atk)||1;}
   else if(key==='act2autochess_gar_eff_ab_damageScaleByBond'){
    const held=e.statuses?.some(s=>s.kind==='root'||s.kind==='sluggish');
    if(held){const stacks=this.garrisonStacks(b.bond_id,b);if(stacks)scale*=1+Number(b.damage_scale_per_stack||0)*stacks;}
   }
  }
  return scale;
 }
 range(u,skill=false){return this.rangeWithSkill(u,skill).cells;}
 // forceSkill=true 时无视当前是否开技，一律按技能范围算：自动释放要看的是「开技后能不能打到」。
 rangeWithSkill(u,skill=false,forceSkill=false){const p=this.profile(u),useSkill=(skill||forceSkill)&&p.skill?.rangeId,r=useSkill?this.data.ranges[p.skill.rangeId]:p.range;let grids=r?.grids||[{row:0,col:1}];if(p.branch==='fortress'&&!grids.some(g=>g.row===0&&g.col===0))grids=grids.concat({row:0,col:0});return {skill:useSkill,rangeId:useSkill?p.skill.rangeId:p.rangeId,cells:grids.map(g=>{let x=g.col,y=-g.row;for(let i=0;i<u.dir;i++)[x,y]=[-y,x];return{x:u.x+x,y:u.y+y};})};}
 inside(u,e,skill=(u.skillLeft>0||u.ammo>0)){if(e.hidden)return false;const cells=this.range(u,skill);if(e.trainingDummy&&e.area){for(const cell of cells)if(cell.x>=e.area.left&&cell.x<=e.area.right&&cell.y>=e.area.top&&cell.y<=e.area.bottom)return true;return false;}return containsTarget(cells.map(g=>[g.x,g.y]),e);}
 // 自动释放专用：技能开启后这次攻击能不能真的打到它。
 // 与 targets() 的区别是范围强制用技能范围，且不要求「当前就能选中」（飞行单位在开技前可能不可选）。
 skillWouldHitTarget(u,p){
  const cfg=operatorSkillConfig(this,u),behavior=this.behavior(u);
  const sleepOk=cfg.canTargetSleep||behavior.kind==='damage-heal'||p.charId==='char_4056_titi'||(p.charId==='char_423_blemsh'&&(p.activeTalents||[]).some(t=>/优先攻击.*沉睡/.test(t.description||'')));
  const cells=this.rangeWithSkill(u,false,true).cells;
  if(!cells.length)return false;
  const canReach=e=>{
   if(e.trainingDummy&&e.area)return cells.some(cell=>cell.x>=e.area.left&&cell.x<=e.area.right&&cell.y>=e.area.top&&cell.y<=e.area.bottom);
   return containsTarget(cells.map(g=>[g.x,g.y]),e);
  };
  return this.s.enemies.some(e=>e.hp>0&&!e.hidden&&!e.invulnerable&&!e.untargetable&&
   (!e.invisible||cfg.canSeeHidden||e.block!=null)&&
   (e.block===u.uid||(!e.flying||behavior.antiAir))&&
   (sleepOk||!permissions(e).sleeping)&&
   canReach(e));
 }
 // 当前是否处于「范围扩大」状态：技能 rangeId 与常态 rangeId 不同即为真。纯显示标记，不参与命中判定。
 wideAttack(u){return this.wideSkillKind(this.profile(u),u.skillIndex??u.source?.skillIndex??null)!==null;}
 // none=未扩大范围；burst=瞬时自身 AoE；sweep=持续范围强化；passive=入场自动释放的大范围技能
 wideSkillKind(p,skillIndex=null){const skill=skillIndex!=null?(p?.skillChoices?.[skillIndex]?.skill??p?.skill):p?.skill;if(!skill?.rangeId||!p?.rangeId||skill.rangeId===p.rangeId)return null;if(skill.skillType==='PASSIVE')return 'passive';return Number(skill.duration)>0?'sweep':'burst';}
 wideKind(u){return this.wideSkillKind(this.profile(u),u.skillIndex??u.source?.skillIndex??null);}
 // 特效层用：取该单位当前生效范围的几何（技能激活且有 rangeId 时用技能范围，否则用常态范围）
 rangeGeometry(u){const p=this.profile(u);const sid=(u.skillLeft>0||u.ammo>0)&&p.skill?.rangeId?p.skill.rangeId:p.rangeId;return rangeGeometry(this.data,sid);}
 targets(u){const behavior=this.behavior(u),p=this.profile(u),cfg=operatorSkillConfig(this,u),sleepOk=cfg.canTargetSleep||behavior.kind==='damage-heal'||p.charId==='char_4056_titi'||(p.charId==='char_423_blemsh'&&(p.activeTalents||[]).some(t=>/优先攻击.*沉睡/.test(t.description||'')));if(p.charId==='char_291_aglina'&&!this.skillActive(u))return [];if(p.charId==='char_245_cello'&&!this.skillActive(u))return [];let targets=this.s.enemies.filter(e=>e.hp>0&&!e.hidden&&(!e.invisible||cfg.canSeeHidden||e.block!=null)&&!e.invulnerable&&!e.untargetable&&(sleepOk||!permissions(e).sleeping)&&(e.block===u.uid||((!e.flying||behavior.antiAir)&&(!behavior.airOnlyIdle||this.skillActive(u)||e.flying)&&this.inside(u,e))));if(p.charId==='char_391_rosmon'&&(p.skillIndex??u.source?.skillIndex)===2&&this.skillActive(u))targets=targets.filter(e=>e.block!=null);if(p.charId==='char_1019_siege2'&&(p.skillIndex??u.source?.skillIndex)===2&&this.skillActive(u))targets=targets.filter(e=>e.block!=null);if(p.charId==='char_4193_lemuen'){const wanted=targets.filter(e=>e.wantedByLemuen);if(wanted.length)targets=wanted;}if(u.floatTarget!=null){const locked=targets.find(e=>e.uid===u.floatTarget);if(locked)targets=[locked];else u.floatTarget=null;}
  if(p.charId==='char_430_fartth'&&(p.skillIndex??u.source?.skillIndex)===2&&this.skillActive(u)){const dir=[[1,0],[0,-1],[-1,0],[0,1]][u.dir||0];targets=this.s.enemies.filter(e=>e.hp>0&&!e.hidden&&(!e.invisible||e.block!=null)&&!e.invulnerable&&!e.untargetable&&((e.y===u.y&&dir[0]!==0&&Math.sign(e.x-u.x)===dir[0])||(e.x===u.x&&dir[1]!==0&&Math.sign(e.y-u.y)===dir[1])));}
  const talentTargetRule=(p.activeTalents||[]).some(t=>/不以束缚状态的敌人为攻击目标/.test(t.description||''))?'rooted':null;
  // 索敌规则是「优先」不是「只能」：过滤后一个都不剩时必须回退到原目标集。
  // 否则「不以束缚状态的敌人为攻击目标」（深靛）和「优先攻击使用远程武器的敌人」（隐现）
  // 这类规则会在场上没有符合条件的目标时把候选清空，表现为干员完全不攻击。
  const prefer=predicate=>{const hit=targets.filter(predicate);if(hit.length)targets=hit;};
  if(cfg.targetRule==='blocked')prefer(e=>e.block!=null);else if(cfg.targetRule==='unblocked')prefer(e=>e.block==null);else if(cfg.targetRule==='ranged')prefer(e=>e.ranged||e.canAttack&&e.range>0);else if(cfg.targetRule==='air')prefer(e=>e.flying);else if(cfg.targetRule==='lowHp')prefer(e=>e.maxHp>0&&e.hp/e.maxHp<=.8);else if(talentTargetRule==='rooted')prefer(e=>permissions(e).rooted||e.statuses?.some(s=>s.kind==='root'));
  targets.sort((a,b)=>{if(p.charId==='char_423_blemsh'&&(p.activeTalents||[]).some(t=>/优先攻击.*沉睡/.test(t.description||''))){const sleeping=Number(permissions(b).sleeping)-Number(permissions(a).sleeping);if(sleeping)return sleeping;}if(cfg.targetRule==='maxHp')return b.maxHp-a.maxHp||b.hp-a.hp;if(cfg.targetRule==='minHp')return a.hp/a.maxHp-b.hp/b.maxHp;if(cfg.targetRule==='random')return (a.uid*1103515245%2147483647)-(b.uid*1103515245%2147483647);return compareOperatorTargets(a,b,u.uid,behavior.priority,p.position);});return targets;}
 prepareWaves(turn){const plan=nativeWavePlan(this.data,turn,this.economy.s.waveRoster);this.level=plan.level;this.s.queue=plan.queue;this.s.total=plan.total;this.combatScale=plan.scale||{atk:1,hp:1,moveSpeed:1};if(this.economy.s.bandId==='band_ducklord'&&turn.round>=5&&this.s.queue.length){const targets=['enemy_2002_bearmi_2','enemy_2034_sythef_2','enemy_2085_skzjxd_2','enemy_2001_duckmi_2'],ground=this.s.queue.filter(q=>this.level.routes[q.route]?.motionMode!=='FLY'),count=Math.min(2,Math.floor(this.economy.random()*3));for(let i=0;i<count&&ground.length;i++){if(this.economy.random()<.6)continue;const q=ground.splice(Math.floor(this.economy.random()*ground.length),1)[0];q.id=targets[Math.floor(this.economy.random()*targets.length)];q.ducklord=true;}}const bounty=this.economy.s.pendingBounty;if(bounty){const route=(this.level.routes||[]).findIndex(r=>r.motionMode!=='FLY'),baseAt=this.s.queue.reduce((n,q)=>Math.max(n,q.at||0),0);for(let i=0;i<bounty.count;i++)this.s.queue.push({id:bounty.enemyId,at:baseAt+1.5+i*1.2,route:route<0?0:route,cost:0,bountyReward:bounty.coin});this.s.total=this.s.queue.length;this.economy.s.pendingBounty=null;}}
 tileWalkable(x,y){return x>=0&&y>=0&&x<this.map.cols&&y<this.map.rows&&Boolean(this.map.grid[y]?.[x])&&this.map.grid[y][x].passableMask!=='FLY_ONLY'&&this.map.grid[y][x].passableMask!=='NONE';}
 path(route,flying){
  const to=p=>({x:p.col-this.map.origin.col,y:this.map.origin.row-p.row});
  const walk=p=>this.tileWalkable(p.x,p.y);
  const bfs=(from,dest)=>{
   if(flying)return from.x===dest.x&&from.y===dest.y?[]:[dest];
   const key=p=>p.x+','+p.y,queue=[from],seen=new Map([[key(from),null]]),cost=new Map([[key(from),0]]),closed=new Set();
   const dirs=route.allowDiagonalMove?[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]:[[1,0],[-1,0],[0,1],[0,-1]];
   while(queue.length){queue.sort((a,b)=>cost.get(key(a))-cost.get(key(b)));const p=queue.shift(),pk=key(p);if(closed.has(pk))continue;closed.add(pk);if(pk===key(dest))break;
    for(const [dx,dy]of dirs){const q={x:p.x+dx,y:p.y+dy},qk=key(q);if(!walk(q)||closed.has(qk)||(dx&&dy&&(!walk({x:p.x+dx,y:p.y})||!walk({x:p.x,y:p.y+dy}))))continue;const next=cost.get(pk)+Math.hypot(dx,dy);if(next<(cost.get(qk)??Infinity)){cost.set(qk,next);seen.set(qk,p);queue.push(q);}}
   }
   if(!seen.has(key(dest)))return null;const segment=[];let p=dest;while(p&&key(p)!==key(from)){segment.unshift(p);p=seen.get(key(p));}return segment;
  };
  return compileRoute(route,to,!flying,bfs);
 }
  spawn(q,placement=null){const raw=this.level.enemyProfiles[q.id]||this.data.enemies[q.id]||this.data.enemyDependencies?.[q.id];if(!raw)throw Error('缺少敌人数据 '+q.id);const a={...raw.attributes};for(const e of this.economy.s.enemyModifiers||[])for(const[k,v]of Object.entries(blackboard(e.blackboard))){const key={max_hp:'maxHp',atk:'atk',def:'def',magic_resistance:'magicResistance'}[k];if(key)a[key]=e.key.endsWith('_mul')?a[key]*v:a[key]+v;}const scale=this.s.benchmark?{atk:1,hp:1,moveSpeed:1}:this.combatScale||{atk:1,hp:1,moveSpeed:1},flying=placement?(placement.flying??raw.motion==='FLY'):(raw.motion==='FLY'||this.level.routes[q.route].motionMode==='FLY'),route=placement?.route||this.path(this.level.routes[q.route],flying),pos=placement?{x:placement.x,y:placement.y}:route[0],cmd=Number.isInteger(placement?.cmd)?placement.cmd:0,behavior=enemyBehaviorProfile(raw),initialShield=behavior.initialShield,baseResistance=Number(a.magicResistance)||0,countHp=behavior.hitCountHp?Math.max(1,Math.floor(Number(raw.attributes?.maxHp)||a.maxHp)):a.maxHp*scale.hp;this.s.enemies.push({uid:this.s.nextId++,id:q.id,name:raw.name,tags:raw.tags||raw.categories||[],categories:raw.categories||[],x:pos.x,y:pos.y,hp:countHp,maxHp:countHp,baseMaxHp:countHp,atk:a.atk*scale.atk,baseAtk:a.atk*scale.atk,weight:a.massLevel??0,blockCost:a.blockCnt||1,baseDef:Number(a.def)||0,baseRes:baseResistance,def:Number(a.def)||0,res:baseResistance,damageResistance:0,elementResistance:Number(a.epDamageResistance)||0,elementDamageResistance:(Number(a.epResistance)||0)/100,speed:(a.moveSpeed||0)*scale.moveSpeed,baseSpeed:(a.moveSpeed||0)*scale.moveSpeed,interval:a.baseAttackTime||1,attackSpeed:a.attackSpeed||100,regen:a.hpRecoveryPerSec||0,canAttack:raw.applyWay!=='NONE',baseCanAttack:raw.applyWay!=='NONE',ranged:raw.applyWay==='RANGED'||raw.applyWay==='ALL',range:raw.rangeRadius||0,damageType:(raw.description||'').includes('法术')?'arts':'physical',flying,route,routeDiagonal:placement?.routeDiagonal??!!this.level.routes[q.route??0]?.allowDiagonalMove,cmd,cmdLeft:null,segment:0,progress:remainingDistance({route,cmd,x:pos.x,y:pos.y}),block:null,hidden:false,invisible:behavior.initialInvisible,baseInvisible:behavior.initialInvisible,formInvisible:behavior.initialInvisible,untargetable:false,formHold:false,revivePhase:null,revivePhaseUntil:0,unblockable:behavior.initialUnblockable,baseUnblockable:behavior.initialUnblockable,leak:raw.lifePointReduce??1,costEffects:raw.costEffects||[],statuses:[],immunities:{stun:a.stunImmune,silence:a.silenceImmune,frozen:a.frozenImmune,sleep:a.sleepImmune,levitate:a.levitateImmune,fear:a.fearedImmune,terror:a.terrorImmune,tremble:a.palsyImmune,root:a.attractImmune},shield:initialShield,shieldLayers:initialShield?[{id:'enemy-initial-shield',remaining:initialShield,max:initialShield}]:[],barriers:[],deployGen:0,exitLife:null,attackCooldown:0,action:null,movementPolicy:behavior.movementPolicy,attackWhileMoving:behavior.attackWhileMoving,burstShots:behavior.burstShots,burstDuration:behavior.burstDuration,burstCooldown:behavior.burstCooldown,stanceInterval:behavior.stanceInterval,stanceDuration:behavior.stanceDuration,attackStunEvery:behavior.attackStunEvery,attackStunDuration:behavior.attackStunDuration,attackElement:behavior.attackElement,attackElementScale:behavior.attackElementScale,deathExplosion:behavior.deathExplosion,aura:behavior.aura,randomPoolEligible:behavior.randomPoolEligible,complexity:behavior.complexity,specialSkill:behavior.specialSkill,specialAtkScale:behavior.specialAtkScale,firstAttackSplash:behavior.firstAttackSplash,meleeAttackScale:behavior.meleeAttackScale,pollutedDamage:behavior.pollutedDamage,lowHpRatio:behavior.lowHpRatio,lowHpAttackMultiplier:behavior.lowHpAttackMultiplier,lowHpMoveMultiplier:behavior.lowHpMoveMultiplier,lowHpUnblockTime:behavior.lowHpUnblockTime,burstFired:0,burstUntil:0,stanceUntil:0,nextStanceAt:this.s.time+(behavior.stanceInterval||0),lastProgressAt:this.s.time,stallTime:0,lastAttackAt:-Infinity,attackCount:0,skillAttackCount:0,specialReady:false,firstAttackUsed:false,invisibleRecoverAt:null,nextSkillAt:behavior.specialSkill&&Number.isFinite(behavior.specialSkill.initCooldown)&&behavior.specialSkill.initCooldown>=0?this.s.time+behavior.specialSkill.initCooldown:Infinity,lowHpTriggered:false,enemyDeathHandled:false,bountyReward:q.bountyReward,
  attackZone:behavior.attackZone||null,selfField:behavior.selfField||null,deathZone:behavior.deathZone||null,bleeding:behavior.bleeding||null,statusResistance:Number(behavior.statusResistance)||0,hitCountHp:!!behavior.hitCountHp,hitCountTypes:behavior.hitCountTypes||null,spriteScale:Number(behavior.spriteScale)||1,deadSpawn:behavior.deadSpawn||null,revive:behavior.revive||null,daggers:behavior.daggers?behavior.daggers.count:0,daggerAtkAdd:behavior.daggers?behavior.daggers.atkAdd:0,daggerPerAttack:behavior.daggers?behavior.daggers.perAttack||1:1,daggersUsed:0,taunt:Number(a.tauntLevel)||0});initEnemySkills(this.s.enemies.at(-1),raw,this.s.time);initEnemyTraits(this,this.s.enemies.at(-1),raw);initEnemyForm(this,this.s.enemies.at(-1));initEnemyTransport(this.s.enemies.at(-1));paintDominion(this,this.s.enemies.at(-1));}
  refreshEnemyAuras(){
   for(const u of alliedActors(this.s))u.enemyAttackSpeedMod=0;
   const live=this.s.enemies.filter(e=>e.hp>0);
   for(const e of live){e.def=e.baseDef??e.def;e.res=e.baseRes??e.res;e.damageResistance=0;e.attackSpeedMod=0;e.attackIntervalMod=0;e.enemyDefAura=0;refreshEnemyTraitStats(e);enemyFormStats(e);}
   for(const source of live.filter(e=>!e.hidden&&e.aura&&!permissions(e).silenced))for(const target of live)if(target!==source&&!target.hidden&&!isIsolated(target)&&Math.hypot(source.x-target.x,source.y-target.y)<=source.aura.radius){target.enemyDefAura=Math.max(target.enemyDefAura,source.aura.def||0);target.damageResistance=Math.max(target.damageResistance,source.aura.damageResistance||0);}
   for(const e of live)e.def+=e.enemyDefAura;
   const guards=live.filter(e=>!e.hidden&&['enemy_1174_duholy','enemy_1174_duholy_2'].includes(e.id)),blades=live.filter(e=>!e.hidden&&['enemy_1175_dushdo','enemy_1175_dushdo_2'].includes(e.id));
   for(const guard of guards)if(blades.some(blade=>Math.hypot(guard.x-blade.x,guard.y-blade.y)<=guard.range+1e-9))for(const u of attackableAllies(this.s))if(Math.hypot(guard.x-u.x,guard.y-u.y)<=Number(guard.enemyTalent?.['traitAbility.range_radius'])+1e-9)u.enemyAttackSpeedMod=Math.min(u.enemyAttackSpeedMod||0,Number(guard.enemyTalent?.['traitAbility.attack_speed'])||0);
   for(const blade of blades)if(guards.some(guard=>Math.hypot(guard.x-blade.x,guard.y-blade.y)<=blade.range+1e-9))blade.attackIntervalMod=Number(blade.enemyTalent?.['traitAbility.base_attack_time'])||0;
   applyEnemyTraitAuras(this);
  }
  enemySpecialReady(enemy,target){if(enemy.enemySkills)return selectEnemyAttackSkill(this,enemy,target);const skill=enemy?.specialSkill;if(!skill||!target||skill.prefab==='stuncombat'||skill.prefab==='InvisibleCombat'||skill.prefab==='InvisibleShield'||skill.prefab==='Flame')return null;if(skill.prefab==='AOEAttack'&&enemy.firstAttackUsed)return null;if(skill.prefab==='CrossAttack'&&Math.abs(enemy.x-target.x)>1e-6&&Math.abs(enemy.y-target.y)>1e-6)return null;if(skill.prefab==='DeathEye'&&enemy.deathEye)return null;const first=enemy.firstAttackSplash&&!enemy.firstAttackUsed,countReady=skill.spCost>0&&(enemy.skillAttackCount||0)>=skill.spCost,cooldownReady=skill.spCost===0&&Number.isFinite(skill.cooldown)&&skill.cooldown>=0&&this.s.time>=(enemy.nextSkillAt??Infinity);if(!first&&!countReady&&!cooldownReady)return null;return {prefab:skill.prefab,scale:enemy.specialAtkScale||1,radius:Number(skill.bb?.range_radius)||1,splash:first||skill.prefab==='AOEAttack',stun:Number(skill.bb?.stun)||0,type:skill.prefab==='CrossAttack'?'arts':null,noDirectAttack:skill.prefab==='DeathEye',polluted:skill.prefab==='PollutedRangedAtk'};}
  resolveEnemyStrike(enemy,target,action={}){if(enemyStealAmmo(this,enemy,target))return;enemyTraitBeforeStrike(this,enemy,target,action);const baseAtk=enemy.atk,baseType=enemy.damageType,hasDagger=Boolean(enemy.canAttack&&enemy.daggers>0),dagger=hasDagger?1+(Number(enemy.daggerAtkAdd)||0):1,rush=consumeEnemyLancerRush(enemy);let scale=Number(action.special?.scale??action.scale)||1;if(enemy.block!==target.uid&&Number(enemy.enemyTalent?.['Attack.attack@ranged_atk_scale'])>0)scale*=Number(enemy.enemyTalent['Attack.attack@ranged_atk_scale']);if(enemy.specialSkill?.prefab==='InvisibleCombat'){if((enemy.invisibleStrikeReady??enemy.invisible)&&enemy.block===target.uid&&!permissions(enemy).silenced){scale*=enemy.specialAtkScale||1;enemy.invisibleStrikeReady=false;}enemy.formInvisible=false;enemy.invisible=false;enemy.invisibleCombatWasActive=false;enemy.invisibleRecoverAt=this.s.time+6;}enemy.atk=baseAtk*scale*dagger;if(action.special?.type||action.type)enemy.damageType=action.special?.type||action.type;this.hurt(target,enemy,{attackId:action.attackId,parentEventId:action.parentEventId,damageAmount:action.amount,defPenetration:action.special?.defPenetration,cause:action.cause??'attack'});if(rush){enemy.damageType='physical';this.hurt(target,enemy,{damageAmount:rush,cause:'extra',attackId:action.attackId,parentEventId:action.parentEventId});}enemy.atk=enemy.deathGrowthStacks!=null?enemy.baseAtk*(1+enemy.deathGrowthStacks*Number(enemy.enemyTalent['Attack.atk'])):baseAtk;enemy.damageType=baseType;if(hasDagger){const used=Math.max(1,Math.floor(Number(enemy.daggerPerAttack)||1));enemy.daggers=Math.max(0,enemy.daggers-used);enemy.daggersUsed=(enemy.daggersUsed||0)+used;if(enemy.daggers===0)enemy.attackCooldown=0;}if(!action.suppressAttackZone&&enemy.attackZone&&(!enemy.enemySkills?.some(s=>s.prefab==='PollutedRangedAtk')||action.special?.polluted))this.addEnemyGroundZone(enemy,enemy.attackZone,{x:target.x,y:target.y,follow:!!enemy.attackZone.follow,attackId:action.attackId??null});}
  startEnemyDeathEye(enemy,target){const skill=enemy.specialSkill;if(!skill||!target)return false;const duration=Number(skill.bb?.hit_duration)||8,interval=Math.max(0.5,Number(skill.bb?.hit_interval)||1);enemy.deathEye={targetUid:target.uid,targetDeployGen:target.deployGen,endsAt:this.s.time+duration,nextAt:this.s.time,interval,damageScale:Number(skill.bb?.atk_scale)||.4,elementScale:Number(skill.bb?.ep_damage_ratio)||2,radius:Math.max(1,Number(enemy.range)||2.5)};enemy.stanceUntil=enemy.deathEye.endsAt;this.emit('enemy-skill-start',{uid:enemy.uid,x:enemy.x,y:enemy.y,skill:'DeathEye',targetUid:target.uid,endsAt:enemy.deathEye.endsAt});return true;}
  tickEnemyDeathEye(){for(const enemy of this.s.enemies){const channel=enemy.deathEye;if(!channel)continue;const target=getActor(this.s,channel.targetUid);if(enemy.hp<=0||!enemyTargetValid(target)||target.deployed===false||(channel.targetDeployGen!=null&&target.deployGen!==channel.targetDeployGen)||!permissions(enemy).skill||!permissions(enemy).attack){enemy.deathEye=null;enemy.stanceUntil=0;endEnemySkill(this,enemy);continue;}if(this.s.time<channel.endsAt){while(this.s.time+1e-9>=channel.nextAt&&channel.nextAt<channel.endsAt-1e-9){dealDamage(this,{source:enemy,target,amount:this.enemyAttackDamage(enemy,channel.damageScale),type:'arts',cause:'dot'});channel.nextAt+=channel.interval;}continue;}for(const ally of attackableAllies(this.s))if(Math.abs(Math.round(ally.x)-Math.round(target.x))+Math.abs(Math.round(ally.y)-Math.round(target.y))<=1)applyElementDamage(this,{source:enemy,target:ally,amount:enemy.atk*channel.elementScale,type:'necrosis',cause:'skill'});this.emit('enemy-skill-end',{uid:enemy.uid,x:enemy.x,y:enemy.y,skill:'DeathEye',targetUid:target.uid});enemy.deathEye=null;enemy.stanceUntil=0;endEnemySkill(this,enemy);}}
  // 清明（enemy_1209_sfden）的 InvisibleShield：每 cooldown 秒给半径内的**其他**敌人上隐匿，自身不含。
  // 这是独立计时的自施法技能，生效期间动态维护圆形范围内的其他敌人；离场/离开范围立即撤掉对应来源。
  // 不跟普通攻击绑定，所以放在每帧的敌人结算里，而不是走 enemySpecialReady
  // 的「攻击附带特殊效果」分支（那条分支要求有攻击目标，清明在行进途中不开火就会漏触发）。
  // 时长取技能黑板 duration（当前 5 秒；天赋黑板另有 InvisibleShield.duration=3，不是这个技能的时长）；
  // 原表没有独立半径字段，取敌人自身 rangeRadius（清明为 2 格）。
  tickEnemyInvisibleShield(){
   const active=[];
   for(const enemy of this.s.enemies){
    const skill=enemy.specialSkill;if(!skill||skill.prefab!=='InvisibleShield'||enemy.hp<=0)continue;
    if(enemy.hidden&&enemy.invisibleShieldUntil!=null&&this.s.time>=enemy.invisibleShieldUntil)enemy.invisibleShieldPermanent=true;
    if(!enemy.hidden&&this.s.time>=(enemy.nextSkillAt??Infinity)&&permissions(enemy).skill){
     const cooldown=Number(skill.cooldown)>0?Number(skill.cooldown):15,duration=Number(skill.bb?.duration)>0?Number(skill.bb.duration):3;
     enemy.nextSkillAt=this.s.time+cooldown;enemy.invisibleShieldUntil=this.s.time+duration;
     const row=enemy.enemySkills?.find(s=>s.prefab==='InvisibleShield');if(row)row.nextAt=enemy.nextSkillAt;
     this.emit('enemy-skill',{uid:enemy.uid,x:enemy.x,y:enemy.y,skill:'InvisibleShield',duration});
    }
    if(!enemy.hidden&&(enemy.invisibleShieldPermanent||enemy.invisibleShieldUntil>this.s.time))active.push({enemy,radius:Number(skill.bb?.range_radius)||Number(enemy.range)||1.8,remaining:enemy.invisibleShieldPermanent?1:enemy.invisibleShieldUntil-this.s.time});
   }
   for(const target of this.s.enemies){
    const sources=active.filter(a=>a.enemy!==target&&target.hp>0&&!target.hidden&&Math.hypot(a.enemy.x-target.x,a.enemy.y-target.y)<=a.radius);
    target.statuses=(target.statuses||[]).filter(s=>!s.enemyInvisibleAura||sources.some(a=>a.enemy.uid===s.source));
    for(const source of sources){
     applyStatus(target,'invisible',source.remaining,{source:source.enemy.uid,resistible:false});
     const row=target.statuses.find(s=>s.kind==='invisible'&&s.source===source.enemy.uid);if(row){row.enemyInvisibleAura=true;row.remaining=source.remaining;}
    }
    tickStatuses(target,0);
   }
  }
  recordEnemyAttack(enemy,special=null){enemy.attackCount=(enemy.attackCount||0)+1;enemy.skillAttackCount=(enemy.skillAttackCount||0)+1;if(!special)enemySpEvent(enemy,'INCREASE_WHEN_ATTACK');}
  resolveEnemyAttackEffects(enemy,target,{count=true,extra=null}={}){if(!enemy||!target)return;if(count)this.recordEnemyAttack(enemy,extra);if(target.hp<=0)return;enemyTraitOnHit(this,enemy,target);const skillAllowed=permissions(enemy).skill&&!permissions(enemy).silenced;if(skillAllowed&&extra?.stun>0&&!extra.stunBeforeDamage)applyStatus(target,'stun',extra.stun,{source:enemy.uid,resistible:false});if(skillAllowed&&!enemy.enemySkills&&enemy.attackStunEvery>0&&enemy.attackStunDuration>0&&enemy.attackCount%enemy.attackStunEvery===0)applyStatus(target,'stun',enemy.attackStunDuration,{source:enemy.uid,resistible:false});if(enemy.attackElement&&enemy.attackElementScale>0)applyElementDamage(this,{source:enemy,target,amount:enemy.atk*enemy.attackElementScale,type:enemy.attackElement,cause:'attack'});if(enemy.bleeding&&skillAllowed)this.applyEnemyBleeding(enemy,target);}
  // 逐腐兽的流血：命中后周期性受到法术伤害，目标接受治疗时解除（治疗钩子在 heal 里）。
  applyEnemyBleeding(enemy,target){const spec=enemy.bleeding,trait=enemyBleedingTraitId(enemy);if(!spec||!target||target.hp<=0)return false;const interval=Math.max(.1,Number(spec.interval)||1);addEffect(this,{kind:'dot',sourceUid:enemy.uid,targetUid:target.uid,talentOrSkillId:trait,interval,nextAt:this.s.time+interval,endsAt:this.s.time+(Number(spec.duration)||10),values:{type:'arts',damage:Number(spec.damage)||0,minHp:1},snapshot:{damage:Number(spec.damage)||0},refKind:'owner',persistAfterSourceGone:true});this.emit('enemy-ability',{uid:enemy.uid,x:enemy.x,y:enemy.y,ability:'bleeding',targetUid:target.uid});return true;}
  // 我方受到治疗时解除「治疗可解除」的敌方持续伤害（目前只有逐腐兽的流血）。
  cureHealCurableEffects(target){for(const fx of this.s.logicEffects||[])if(fx.kind==='dot'&&fx.targetUid===target?.uid&&String(fx.talentOrSkillId||'').endsWith('-bleeding')){fx.endsAt=this.s.time;}}
  // 敌方持续伤害区域统一入口：射击落点、跟随自身的常驻光环、死亡后留下的毒雾都走这里。
  addEnemyGroundZone(source,spec,{x,y,follow=false,cleanupWithSource=false,attackId=null,key=null}={}){if(!source||!spec||!(Number(spec.damage)>0||Number(spec.atkScale)>0||Number(spec.elementScale)>0))return null;const interval=Math.max(.1,Number(spec.interval)||1),duration=Number(spec.duration),radius=Number(spec.radius)||1;const row=addEffect(this,{kind:'field',sourceUid:source.uid,sourceDeployGen:source.deployGen,x,y,followUid:follow?source.uid:null,radius,interval,nextAt:this.s.time+interval,endsAt:Number.isFinite(duration)&&duration>0?this.s.time+duration:null,talentOrSkillId:key||enemySpecialTraitId(source),sharedStack:!!key,values:{shape:spec.shape,ignoreTargetability:!!spec.ignoreTargetability,damage:Number(spec.damage)||0,damageHigh:Number.isFinite(spec.damageHigh)?spec.damageHigh:null,atkScale:Number(spec.atkScale)||0,damageType:spec.damageType||'true',elementScale:Number(spec.elementScale)||0,elementType:spec.elementType||null},trackSide:'ally',trackArea:true,refKind:cleanupWithSource?'live':'owner',persistAfterSourceGone:!cleanupWithSource,attackId,
   // 产生者的攻击力在创建时就留档：死亡圈的产生者会随死亡离场，之后仍要按它生前的攻击力结算。
   sourceAtk:Number.isFinite(Number(source.atk))?Number(source.atk):0});if(row)this.emit('enemy-skill',{uid:source.uid,x:row.x??x,y:row.y??y,skill:spec.trigger||'ground-zone',radius:row.radius,endsAt:row.endsAt});return row;}
  // 常驻范围（如深溟巢涌者）：敌人活着时它自己就是区域中心，每秒结算一次。
  ensureEnemySelfField(enemy){if(!enemy?.selfField||enemy.hp<=0)return;const trait=enemySpecialTraitId(enemy);if((this.s.logicEffects||[]).some(fx=>fx.kind==='field'&&fx.talentOrSkillId===trait))return;this.addEnemyGroundZone(enemy,enemy.selfField,{x:enemy.x,y:enemy.y,follow:true,cleanupWithSource:true});}
  // 敌方地面区域对同一个我方单位**只结算一层**：一个间隔窗内多次命中只保留伤害最高的一次，
  // 后面命中的更高伤害只补差额（用户 2026-09-19 口径：圈重叠取最高，不叠加）。
  // 窗口按区域自己的 interval 取（0.9 倍是给反复累加留的浮点余量，不能让同一片圈的下一次结算
  // 落回窗口里被自己吞掉），至少 0.45 秒。
  // 不同圈的下一次结算时间会因为创建时刻不同而错开，所以用时间窗而不是「同一帧去重」。
  applyEnemyZoneDamage(ally,amount,type,at,window){
   // 用「区域排定的结算时刻」而不是当前帧时间做窗口戳：大步推进时同一帧会补好几拍，
   // 若按帧时间记账这些拍会被压成一次，白白少算。
   const span=Number.isFinite(window)&&window>0?window:.45;
   const now=Number.isFinite(at)?at:this.s.time,prev=this.zoneHitWindow.get(ally.uid),fresh=prev&&now-prev.at<span;
   if(fresh&&amount<=prev.amount)return false;
   const delta=fresh?Math.max(0,amount-prev.amount):amount;
   this.zoneHitWindow.set(ally.uid,{at:now,amount:fresh?Math.max(prev.amount,amount):amount});
   if(delta>0)this.hurt(ally,{atk:delta,damageType:type||'true'});
   return true;
  }
  // 区域结算：1 秒一次，与其它周期效果共用同一套伤害入口（护盾、闪避、元素损伤都按常规处理）。
  tickEnemyGroundZones(){for(const fx of (this.s.logicEffects||[]).slice()){if(fx.kind!=='field'||fx.nextAt==null)continue;if(fx.endsAt!=null&&this.s.time>=fx.endsAt){fx.nextAt=null;continue;}if(this.s.time+1e-9<fx.nextAt)continue;
    if(fx.followUid!=null){const owner=getActor(this.s,fx.followUid);if(owner&&owner.hp>0){fx.x=owner.x;fx.y=owner.y;}}
    // 一次调用可能跨过多个结算点（快照恢复或大步推进），按 interval 补齐。
    while(fx.nextAt!=null&&this.s.time+1e-9>=fx.nextAt&&(fx.endsAt==null||fx.nextAt<=fx.endsAt+1e-9)){
     const source=getActor(this.s,fx.sourceUid),values=fx.values||{};
     // 产生者还活着就用它当前的攻击力（伤害随攻击力变化），已经离场就用创建时留档的 sourceAtk
     // （毒雾 = 攻击力的 15%，敌人被击倒后原本会算成 0）。
     const liveAtk=source&&Number.isFinite(Number(source.atk))?Number(source.atk):null;
     const sourceAtk=liveAtk??(Number(fx.sourceAtk)||0);
     for(const ally of (values.ignoreTargetability?alliedActors(this.s).filter(a=>a.deployed&&a.hp>0):attackableAllies(this.s))){if((values.shape==='circle'?Math.hypot(fx.x-ally.x,fx.y-ally.y):chebyshev(fx,ally))>fx.radius+1e-9)continue;
      const fixed=values.damageHigh!=null&&this.map.grid[Math.round(ally.y)]?.[Math.round(ally.x)]?.heightType==='HIGHLAND'?values.damageHigh:values.damage;
      const base=values.atkScale>0?sourceAtk*values.atkScale:fixed;
      if(base>0)this.applyEnemyZoneDamage(ally,base,values.damageType,fx.nextAt,Math.max(.45,(Number(fx.interval)||1)*.9));
      if(values.elementScale>0&&values.elementType&&sourceAtk>0)applyElementDamage(this,{source,target:ally,amount:sourceAtk*values.elementScale,type:values.elementType,cause:'dot'});
     }
     fx.nextAt+=Math.max(.1,Number(fx.interval)||1);
    }
   }}
  resolveEnemyDeath(enemy,source=null){if(!enemy||enemy.enemyDeathHandled)return;enemy.enemyDeathHandled=true;const effect=enemy.deathExplosion;if(effect&&(!effect.silenceable||!permissions(enemy).silenced)&&(!effect.requiresFire||enemy.onFire)){if(effect.delay>0){this.s.enemyProjectiles.push({owner:enemy.uid,startedAt:this.s.time,impactAt:this.s.time+effect.delay,startX:enemy.x,startY:enemy.y,targetX:enemy.x,targetY:enemy.y,radius:effect.radius,amount:this.enemyAttackDamage(enemy,effect.scale),type:effect.type,groundOnly:!!effect.groundOnly,cold:effect.cold,attackId:null});}else for(const target of attackableAllies(this.s).filter(u=>(!effect.groundOnly||!u.flying)&&Math.hypot(u.x-enemy.x,u.y-enemy.y)<=effect.radius))dealDamage(this,{source:enemy,target,amount:enemy.atk*effect.scale,type:effect.type,cause:'extra',skipHooks:true});this.emit('enemy-ability',{uid:enemy.uid,x:enemy.x,y:enemy.y,ability:'death-explosion',radius:effect.radius,type:effect.type});}
   // 死亡区域（污秽／毒雾）：以死亡位置为中心留一片持续伤害区；死亡爆炸与区域可以同时存在。
   if(enemy.deathZone&&(!enemy.deathZone.silenceable||!permissions(enemy).silenced)){const zone=enemy.deathZone,at=zone.trigger==='death-target'&&source&&source.hp>0?{x:source.x,y:source.y}:{x:enemy.x,y:enemy.y},radius=Number(zone.radius)||1;
    // 污染秽蚀不需要选中目标即可生成；后来进入区域的单位仍会受到伤害。
    if(zone.alwaysGenerate||attackableAllies(this.s).some(a=>Math.max(Math.abs(a.x-at.x),Math.abs(a.y-at.y))<=radius)){this.addEnemyGroundZone(enemy,zone,{...at,follow:!!zone.follow,key:`zone-death-${at.x},${at.y}`});this.emit('enemy-ability',{uid:enemy.uid,x:at.x,y:at.y,ability:'death-zone',radius,damage:Number(zone.damage)||0,atkScale:Number(zone.atkScale)||0});}}}
 onEnemyDeath(enemy,info={}){
  if(!enemy||enemy.enemyDeathHandled)return;
  cancelEnemyCast(this,enemy);
  this.resolveEnemyDeath(enemy,info.killer??null);
  this.deadSpawnFragments(enemy,info);enemyTraitOnDeath(this,enemy,info);
 }
 queueEnemySpawn(q,placement,delay=0){this.s.pendingEnemySpawns??=[];this.s.pendingEnemySpawns.push({q,placement,at:this.s.time+Math.max(0,delay)});}
 flushEnemySpawns(){const rows=this.s.pendingEnemySpawns||[];this.s.pendingEnemySpawns=rows.filter(row=>row.at>this.s.time+1e-9);for(const row of rows)if(row.at<=this.s.time+1e-9)this.spawn(row.q,row.placement);}
 // 解压缩：因坠落／漏怪以外的原因死亡后，以自身为中心 1.0 边长正方形范围内随机位置、
 // 以自身路径召唤 N 个碎片敌人（cnt_add=-1 的沉沙按已消耗的断刃扣减，至少 1 个）。
 deadSpawnFragments(enemy,{reason}={}){
  const spec=enemy.deadSpawn;
  if(!spec||!spec.enemyKey||!enemy.route?.length)return;
  if(reason==='leak'||reason==='fall')return;
  if(!(this.data.enemies[spec.enemyKey]||this.level.enemyProfiles?.[spec.enemyKey]))return;
  const count=Math.max(1,Math.floor(spec.cnt+(spec.cntAdd||0)*(enemy.daggersUsed||0)));
  const cmd=Number.isInteger(enemy.cmd)?enemy.cmd:0;
  for(let i=0;i<count;i++){
   const spot=this.fragmentSpot(enemy);
   this.queueEnemySpawn({id:spec.enemyKey},{x:spot.x,y:spot.y,route:enemy.route,cmd},this.economy.random()*.7);
  }
  this.emit('enemy-ability',{uid:enemy.uid,x:enemy.x,y:enemy.y,ability:'dead-spawn',enemyKey:spec.enemyKey,count});
 }
 // PRTS：以死亡位置为中心、边长1的正方形内连续随机取点，不扩成相邻九格中心。
 fragmentSpot(enemy){
  return {x:enemy.x+this.economy.random()-.5,y:enemy.y+this.economy.random()-.5};
 }
 // 再生：被击倒时不退场，原地进入重生状态；第二形态再被击倒即为真正死亡。
 fatalHook(target){
  if(!target||!this.s.enemies?.includes(target))return false;
  if(enemyFormFatal(this,target))return true;
  const revive=target.revive;
  if(!revive||target.revivePhase)return false;
  target.revivePhase='rebirth';target.revivePhaseUntil=this.s.time+1;
  target.hp=Math.max(1,target.hp);
  target.action=null;target.block=null;target.formHold=true;
  target.invulnerable=true;target.unblockable=true;target.canAttack=false;
  target.reviveShiftImmune=!!target.shiftImmune;target.shiftImmune=true;
  this.emit('enemy-phase',{uid:target.uid,x:target.x,y:target.y,phase:'rebirth',form:revive.formName});
  return true;
 }
 tickEnemyRevive(e){
  if(!e.revivePhase||this.s.time<e.revivePhaseUntil)return;
  if(e.revivePhase==='rebirth')this.enterReviveForm(e);else this.exitReviveForm(e);
 }
 enterReviveForm(e){
  const revive=e.revive;if(!revive)return;
  e.revivePhase='form';e.revivePhaseUntil=this.s.time+revive.interval;
  e.invulnerable=false;e.formHold=false;e.block=null;e.action=null;
  e.shiftImmune=!!e.reviveShiftImmune;
  e.unblockable=!!revive.unblockable;
  e.formInvisible=!!revive.invisible;
  e.invisible=!!revive.invisible;
  e.hitCountHp=true;e.hitCountTypes=null;
  e.maxHp=Math.max(1,Math.floor(revive.hitCount));e.hp=e.maxHp;
  e.canAttack=!!e.baseCanAttack&&!revive.noAttack;
  if(Number(revive.guardLayers)>0){
   const layers=Math.floor(revive.guardLayers),radius=Number(revive.guardRadius)||1.8;
   for(const other of this.s.enemies)if(other!==e&&other.hp>0&&Math.max(Math.abs(other.x-e.x),Math.abs(other.y-e.y))<=radius){const id=`revive-guard-${e.uid}-${other.uid}`;other.barriers=(other.barriers||[]).filter(g=>g.id!==id);grantGuard(this,other,{charges:layers,types:['physical','arts'],sourceUid:e.uid,id});}
   this.emit('enemy-ability',{uid:e.uid,x:e.x,y:e.y,ability:'revive-guard',layers,radius});
  }
  this.emit('enemy-phase',{uid:e.uid,x:e.x,y:e.y,phase:'revive-form',form:revive.formName,hitCount:e.maxHp});
 }
 exitReviveForm(e){
  e.revivePhase=null;e.revivePhaseUntil=0;
  e.hitCountHp=false;e.hitCountTypes=null;
  e.maxHp=e.baseMaxHp||e.maxHp;e.hp=e.maxHp;
  e.canAttack=!!e.baseCanAttack;
  e.formInvisible=false;
  e.invisible=!!e.baseInvisible;
  e.unblockable=!!e.baseUnblockable;
  e.invulnerable=false;e.formHold=false;
  e.enemyDeathHandled=false;
  this.emit('enemy-phase',{uid:e.uid,x:e.x,y:e.y,phase:'revive-revert',form:e.revive?.formName});
 }
 // 卫戍事件：只有原表 `act*autochess_gar_event_*` 这类键是事件驱动（`gar_eff_*` 是常驻/伤害类，见 stats()/hit()）。
 // kill/skill/deploy/selfdead 由本人触发；ammo 由「消耗弹药的单位」触发，但层数记在**持有特质的干员**头上
 // （莫斯提马 = 自身周围4格的干员消耗弹药），范围取 blackboard.range_id。
 // 计数一律走 garrisonCounters（battle 每波重建 → 「每场作战至多 N 层」按波重置）。
 event(u,event){return this.garrisonEvent(u,event,{actor:u,used:1});}
 garrisonEvent(owner,event,{actor=owner,used=1}={}){
  const p=this.profile(owner);
  for(const g of p.garrisons||[]){
   if(!g||g.eventType!=='IN_BATTLE')continue;const b=blackboard(g.blackboard),key=b.key||'';
   if(!/gar_event_/.test(key))continue;
   let match=false,step=1;
   if(event==='kill')match=/selfkillenemy/.test(key);
   else if(event==='skill')match=/useskill/.test(key);
   else if(event==='deploy')match=/onstart|born|deploy/.test(key);
   else if(event==='selfdead')match=/selfdead/.test(key);
   else if(event==='ammo'){match=/consume_ammo/.test(key);if(match){if(actor!==owner&&!this.garrisonInRange(owner,b.range_id||'0-1',actor))continue;step=Math.max(1,Math.floor(used));}}
   if(!match||!this.garrisonConditionOk(owner,b))continue;
   this.applyGarrisonGrant(owner,g,b,event,{step});
  }
 }
 // 概率 → 计数 → 每波上限 → 加层（含魔王【…】给身前一格的追加层数）。
 applyGarrisonGrant(owner,g,b,eventKey,{step=1,prob=1}={}){
  if(prob<1&&this.economy.random()>=prob)return false;
  const id=g.id+':'+eventKey,count=this.garrisonCounter(id,step),threshold=Math.max(1,Math.floor(Number(b.check_cnt||b.consume_count)||1));
  if(count%threshold)return false;
  const limit=Number(b.max_cnt||b.max_count||b.max_trigger_count)||Infinity;if(count/threshold>limit)return false;
  let grant=this.garrisonAmount(owner,b);
  const maxTotal=Number(b.max_add_count_per_battle),appliedKey=id+':applied',applied=this.garrisonCounters.get(appliedKey)||0;
  if(Number.isFinite(maxTotal))grant=Math.max(0,Math.min(grant,maxTotal-applied));
  if(!grant)return false;
  let extra=0;
  for(const w of this.s.units){
   if(w===owner||!(w.deployed||w.source?.position)||w.hp<=0)continue;
   for(const wg of this.profile(w).garrisons||[]){const wb=blackboard(wg.blackboard);if(wb.key!=='act1autochess_gar_event_addition_cnt')continue;if(this.garrisonInRange(w,wb.range_id||'1-1',owner))extra+=Number(wb.extra_cnt)||0;}
  }
  for(const bond of this.garrisonBonds(owner,b))this.economy.addLayers(bond,grant+extra);
  if(Number.isFinite(maxTotal))this.garrisonCounters.set(appliedKey,applied+grant);
  return true;
 }
 // 状态类卫戍：敌人进入冻结（初雪/银灰，以及凛御银灰转发出去的 garrison_29，check_ab_flag=16）
 // 与「范围内有敌人或干员进入沉睡或晕眩」（缇缇）。「范围内」= 持有者的攻击范围。
 // 缇缇的注记「同一单位每 0.05 秒仅能叠 1 次」按 (持有者, 特质) 节流。
 garrisonStatusEvent(actor,kind){
  if(!actor)return;
  for(const owner of this.s.units){
   if(owner.hp<=0)continue;const gs=this.profile(owner).garrisons;if(!gs?.length)continue;
   if(!this.range(owner).some(c=>c.x===actor.x&&c.y===actor.y))continue;
   for(const g of gs){
    if(!g||g.eventType!=='IN_BATTLE')continue;const b=blackboard(g.blackboard),key=b.key||'';
    let prob=1;
    if(key==='act1autochess_gar_event_enemy_abflag_inrange'){
     if(kind!=='frozen')continue;
     const flag=Number(b.check_ab_flag)||0;if(flag&&flag!==16)continue;
     prob=Number.isFinite(Number(b.prob))?Number(b.prob):1;
    }else if(key==='act2autochess_gar_event_allyenemy_sleepstun_inrange'){
     if(!(kind==='sleep'||kind==='stun'))continue;
     this.garrisonStatusAt??=new Map();const tkey=owner.uid+':'+g.id;
     if(this.s.time-(this.garrisonStatusAt.get(tkey)??-Infinity)<0.05)continue;
     this.garrisonStatusAt.set(tkey,this.s.time);
    }else continue;
    this.applyGarrisonGrant(owner,g,b,'status:'+kind,{prob});
   }
  }
 }
 // 每帧末尾对「本帧新出现的冻结/沉睡/晕眩」派发一次，覆盖技能、状态区、敌人技能等所有施加路径。
 tickGarrisonStatusEvents(){
  this.garrisonStatusSeen??=new Map();
  const check=actor=>{
   const kinds=new Set((actor.statuses||[]).map(s=>s.kind)),seen=this.garrisonStatusSeen.get(actor.uid);
   // 第一次见到某个单位时也照常判定：新出现的单位如果一上来就带冻结/沉睡/晕眩，同样算「进入」。
   for(const kind of kinds)if((kind==='frozen'||kind==='sleep'||kind==='stun')&&(!seen||!seen.has(kind)))this.garrisonStatusEvent(actor,kind);
   this.garrisonStatusSeen.set(actor.uid,kinds);
  };
  for(const u of this.s.units)if(u.hp>0)check(u);
  for(const e of this.s.enemies)if(e.hp>0)check(e);
 }
 // 战斗内 conditionkey：只支持原表出现的三种（同一行/同一列 N 人、本人需在场）；计数含自身。
 garrisonConditionOk(u,b){const key=b.conditionkey;if(!key)return true;const need=Math.max(1,Math.floor(Number(b.check_count)||1)),board=this.s.units.filter(v=>v.deployed||v.source?.position);
  if(key==='character_target_inboard')return!!(u.deployed||u.source?.position);
  if(key==='character_same_row')return board.filter(v=>v.y===u.y).length>=need;
  if(key==='character_same_col')return board.filter(v=>v.x===u.x).length>=need;
  return true;
 }
 // 弹药消耗：所有持有 consume_ammo 特质的干员都收一次事件，范围由 range_id 判定（自身/身前一格/周围4格）。
 garrisonAmmoEvent(actor,used){for(const owner of this.s.units){if(owner.hp<=0)continue;const gs=this.profile(owner).garrisons;if(!gs?.length)continue;this.garrisonEvent(owner,'ammo',{actor,used});}}
  reserveUnits(predicate=()=>true){return this.s.units.filter(u=>!u.deployed&&u.hp>0&&predicate(u));}
  adjustReserveCost(delta,{predicate=()=>true,limit=1}={}){const value=Number(delta);if(!Number.isFinite(value)||!value)return [];const rows=this.reserveUnits(predicate).sort((a,b)=>a.y-b.y||a.x-b.x||a.uid-b.uid).slice(0,Math.max(0,limit));for(const u of rows)u.costRealtimeDelta=(u.costRealtimeDelta||0)+value;return rows;}
  swapReserveBaseCosts(predicate=()=>true){const rows=this.reserveUnits(predicate).sort((a,b)=>(a.baseCostOverride??a.baseCost??0)-(b.baseCostOverride??b.baseCost??0)||a.uid-b.uid);if(rows.length<2)return false;const first=rows[0],last=rows.at(-1),a=first.baseCostOverride??first.baseCost,b=last.baseCostOverride??last.baseCost;first.baseCostOverride=b;last.baseCostOverride=a;return true;}
  deploymentCost(u){const p=this.profile(u),base=Math.max(0,Number(u.baseCostOverride??u.baseCost??p.attributes.cost)||0),runtime=!u.runtimeCostUsed&&u.runtimeCostActive?Number(u.runtimeCost)||0:0;let baseDelta=Number(u.costBaseDelta||0)+Number(u.wildmaneCostDelta||0),realtime=Number(u.costRealtimeDelta)||0;if(u.id==='char_237_gravel')baseDelta-=1;for(const source of this.s.units.filter(v=>v.deployed&&v.hp>0)){const sp=this.profile(source);if(source.id==='char_249_mlyss'&&p.groupId==='rhine'&&sp.activeTalents?.some(t=>/莱茵生命.*部署费用/.test(t.description||''))){baseDelta-=2;if(!this.s.mlyssFirstRhineDiscountUsed&&u.id!=='char_249_mlyss')baseDelta-=1;}}const multiplier=Math.pow(1.5,Math.min(2,Math.max(0,Number(u.redeployPenalty)||0)));return Math.max(0,Math.floor((base+baseDelta)*multiplier+realtime+runtime));}
  deploy(u,{reentry=false}={}){if(reentry){const cost=this.deploymentCost(u);if(cost>0&&!this.spendCost(cost,{considerNegativeCost:true}))return false;u.deploymentCost=cost;u.lastDeploymentCost=cost;u.refundCap=Math.max(0,Math.floor(Number(u.baseCostOverride??u.baseCost)||0)+(Number(u.costBaseDelta)||0));u.refundEligible=true;u.waitingCost=false;}u.runtimeCostUsed=true;u.corrosionDefLoss=0;u.elementBurstUntil=0;u.elementalMax=1000;u.elemental={};u.elementalType=null;u.elementalBatch=null;u.wildmaneCostDelta=0;if(u.id!=='char_249_mlyss'&&this.s.mlyssFirstRhineDiscountUsed===false&&this.profile(u).groupId==='rhine'&&this.s.units.some(v=>v.id==='char_249_mlyss'&&v.deployed&&v.hp>0))this.s.mlyssFirstRhineDiscountUsed=true;u.hornBuff=null;u.etlchiSaved=false;u.sbellRevived=false;u.pasngrNext=null;u.cetsyrNextShare=0;u.svashCostAt=0;u.svashCostRemaining=0;u.svashCostHandled=false;u.etlchiCandles=[];u.pendingAttackHits=0;u.invulnerableUntil=0;u.mudrokSleepUntil=0;u.mudrokAwake=false;u.mudrokS1=null;u.titiSleepUid=null;u.titiSleepState={};u.lumenEmergencyAt=-Infinity;u.blaze2AnchorUid=null;u.ulpiaKills=0;u.nymphStacks=0;u.nymphNextAt=0;u.haloStacks=0;u.haloStay={};u.qiubaiNext=null;u.blkkgtNext=null;u.pepeStacks=0;u.pepeSkillUses=0;u.pepeKillSp=0;u.excu2Targets=[];u.lemuenTargets=[];u.lemuenNextAt=0;u.lemuenWanted={};u.whitwNextAt=0;u.whitwTalentStage=0;u.kjeraNextAt=0;u.siege2Next=null;u.siege2Marks={};u.duskNext=null;u.archetNext=null;u.inesStealAt=0;u.surtrS1=false;u.lockHp=null;u.damageProtection=null;u.returnPosition=null;u.helmetMaxHpBonus=0;u.raidGrenadeUntil=0;u.equipUndeadUsed=false;u.equipCamoUsed=false;u.equipSaltBlocked=0;u.m3Revives=0;u.trenchReflectAt=-Infinity;u.equipHitStacks=0;u.equipSkillUses=0;u.equipAspdStacks=0;u.equipAmmoRestores=0;u.kazimierzFlagAt=null;u.compassSkillEnd=false;u.knightDecreeUntil=0;u.equipRetreatAtSkillEnd=false;u.yaleNextAt=null;u.familyBadgeAtk=0;u.familyBadgeAt=0;u.familyBadgeBonus=0;u.familyBadgePaid=false;u.pendingAttackHeal=null;u.pendingAttackSelfHeal=null;u.pendingHealBonus=null;u.pendingHealScale=null;u.papyrsShieldScale=null;u.skillDisarmUntil=null;u.focusHealAfter=null;u.focusHeal=false;u.statusResistance=0;u.skillEndHealRatio=0;u.talentSpRecoveryUntil=0;u.talentSpRecovery=0;u.pineSkillUses=0;u.philaeNextAt=0;u.philaeElementBoost=false;u.elementDamageResistance=0;u.downed=false;u.blazeDownUsed=false;u.healable=true;u.energy=0;u.talentTime=0;u.talentAmmoTimers={};u.talentAmmoFlags={};u.talentAmmoBonus=0;u.merchantDeployGen=null;u.merchantNextFeeAt=null;u.merchantTalentStacks=0;u.wildmaneAspdUntil=0;u.gravelDefBuff=null;u.physicalEvadeOnce=false;u.physicalEvadeUntil=0;u.physicalEvadeProb=0;u.skillEvasionProb=0;u.vulpisMarks={};u.vulpisKilled=false;u.hainiTalentScale=1;u.kroosHits=0;u.kroosQuad=false;u.aromaSeen={};u.aromaPending=null;u.texas2Killed=false;u.duskTalentStacks=0;u.aromaLevitateSeen={};u.aromaLevitateFired={};u.shield=0;u.shieldLayers=[];u.barriers=[];u.deployed=true;u.deployCount=(u.deployCount||0)+1;u.deployGen=(u.deployGen||0)+1;u.exitLife=null;u.branchCharge=0;u.branchSkillActive=false;u.pendingReturns=0;u.energy=0;u.magazine=branchTrait(this.profile(u)).values.value??8;u.pendingSelfHeals=[];u.droneTarget=null;u.droneScale=0;u.reaperWindowStart=-999;u.reaperWindowCount=0;u.nextSelfHealAt=0;u.hp=u.maxHp=this.stats(u).maxHp;u.sp=initSpOf(this.profile(u).skill);u.spCd=0;u.spLock=0;u.ammo=0;u.ammoMax=0;u.lockId=null;if(this.on('soloShip')&&this.owns(u,'soloShip'))u.sp+=15;u.deployAt=this.s.time;this.event(u,'deploy');this.emit('deploy',{uid:u.uid,x:u.x,y:u.y});dispatch(this,'deploy',{target:u});}
  activate(u){const p=this.profile(u),sk=p.skill,cfg=operatorSkillConfig(this,u);if(!sk||!permissions(u).skill||(!usesSp(sk)&&!cfg.coinCost))return;const b=blackboard(sk.blackboard),cost=this.spCost(u),kind=skillKind(sk)||(cfg.coinCost?'instant':null),flow=skillFlow(sk),passiveCoinSkill=sk.skillType==='PASSIVE'&&u.coinSkillEnabled,openingCoins=passiveCoinSkill?0:coinGainAtSkillStart(this,u),coinCap=coinCapFor(p);if(cfg.coinCost&&(u.coins||0)+openingCoins<cfg.coinCost)return;if(u.sp<cost||(usesSp(sk)&&sk.skillType!=='AUTO'&&this.s.time-u.lastSkill<3))return;if(kind==='instant'&&sk.skillType==='AUTO'&&(u.action||u.attackCooldown>0))return;if(flow.resetAttack){u.action=null;u.attackCooldown=0;}if(openingCoins)grantCoins(u,openingCoins,coinCap);if(cfg.coinCost&&!spendCoins(u,cfg.coinCost))return;u.sp=Math.max(0,Math.trunc(u.sp)-cost);u.lastSkill=this.s.time;u.skillCount++;const skillAir=skillAntiAir(p.charId,p.skillIndex??u.source?.skillIndex);u.skillAir=skillAir==null?null:{value:skillAir,count:u.skillCount,until:this.s.time+(Number(sk.duration)>0?Number(sk.duration):0)};const lateranoBonus=this.on('lateranoShip')&&this.owns(u,'lateranoShip')?this.params('lateranoShip'):null,baseAmmo=ammoCount(sk),bondAmmo=lateranoBonus?Math.max(0,Math.floor(baseAmmo*(Number(lateranoBonus.base_ammo_percent||0)+Number(lateranoBonus.ammo_percent_per_stack||0)*(this.layers.lateranoShip||0)))):0;u.ammo=kind==='ammo'?baseAmmo+cfg.ammoBonus+(u.talentAmmoBonus||0)+bondAmmo+(p.charId==='char_1032_excu2'?Math.min(4,this.s.units.filter(v=>v.deployed&&v.hp>0&&this.profile(v)?.bonds?.includes('lateranoShip')).length):0):0;u.ammoMax=u.ammo;u.ammoPerAttack=cfg.ammoPerAttack;u.skillLeft=kind==='ammo'?0:this.skillTimeLeft(sk);if(kind==='instant'){const t=attackTiming(this.stats(u).baseAttackTime,this.stats(u).attackSpeed,windupSeconds(this.stats(u).baseAttackTime,p.attackWindup));u.spLock=t.seconds;}this.event(u,'skill');this.emit('skill-start',{uid:u.uid,kind,name:sk.name,x:u.x,y:u.y,wide:this.wideAttack(u),wideKind:this.wideKind(u)});if(dispatch(this,'skill-start',{target:u}))return;if(kind==='instant'&&sk.skillType==='AUTO'&&spTypeOf(sk)==='INCREASE_WHEN_ATTACK'){u.enhanced=true;return;}if(kind==='instant'){const targets=this.targets(u);if(p.branch!=='incantationmedic'&&/回复.*生命|治疗/.test(sk.description||'')){for(const v of this.healingTargets(u))this.heal(u,v,this.stats(u).atk*(cfg.bb.healScale??b.heal_scale??b.atk_scale??1));}else if(cfg.atkScale!=null||b.atk_scale){for(const e of targets.slice(0,cfg.multiTarget===Infinity?targets.length:(cfg.multiTarget??b.max_target??999)))for(let hit=0;hit<Math.max(1,cfg.hits||1);hit++)this.hit(u,e,this.stats(u).atk*(cfg.atkScale??b.atk_scale??1),this.baseDamageType(u),{skill:true});}if(b.stun||cfg.bb.stun)for(const e of targets){if(applyStatus(e,'stun',b.stun??cfg.bb.stun,{source:u.uid}))this.emit('control',{uid:e.uid,kind:'stun',x:e.x,y:e.y});}}}
 deactivate(u){const p=this.profile(u),sk=p.skill;if(!sk||!this.skillActive(u))return false;const idx=sk.skillIndex??u.source?.skillIndex;if(u.id==='char_1033_swire2'&&idx===2){const cfg=operatorSkillConfig(this,u),coins=Math.max(0,Math.trunc(u.coins||0));for(let i=0;i<coins;i++){const targets=this.targets(u);if(!targets.length)break;const target=targets[Math.floor(this.economy.random()*targets.length)];this.hit(u,target,this.stats(u).atk*(cfg.atkScale||1),'physical');moveActor(this,target,u,sk.description||'');}u.coins=0;}if(u.id==='char_4039_horn'&&idx===1&&u.ammo>0){const cfg=operatorSkillConfig(this,u),targets=this.targets(u);for(let i=0;i<u.ammo;i++)for(const target of targets)this.hit(u,target,this.stats(u).atk*(Number(cfg.bb['attack@s2.atk_scale'])||1.6),'physical',{skill:true});u.hp=Math.max(1,u.hp-u.maxHp*(Number(cfg.bb['attack@s2.hp_ratio'])||.6));u.ammo=0;}u.skillLeft=0;u.ammo=0;u.action=null;this.emit('skill-end',{uid:u.uid,x:u.x,y:u.y});dispatch(this,'skill-end',{target:u});return true;}
 spCost(u){const p=this.profile(u),base=p.skill?.spData.spCost||0;return this.on('suntShip')&&this.rows.suntShip.count>=5&&p.isGolden?Math.floor(base*.7):base;}
 gainCost(amount){const value=Number(amount);if(!Number.isFinite(value)||value<=0)return 0;const before=this.s.cost;this.s.cost=Math.min(this.s.costMax,before+value);const gained=this.s.cost-before;if(gained>0)this.emit('cost-gain',{amount:gained,total:this.s.cost});return gained;}
  spendCost(amount,{allowDebt=false,considerNegativeCost=false}={}){const value=Number(amount);if(!Number.isFinite(value)||value<=0)return false;const next=this.s.cost-value;if(next<this.s.costMin)return false;const debtAllowed=allowDebt||(considerNegativeCost&&this.s.costMin<0);if(!debtAllowed&&next<0)return false;this.s.cost=next;this.emit('cost-spend',{amount:value,total:this.s.cost});return true;}
  refreshEnemyCostEffects(){let recovery=1,respawn=1;for(const enemy of this.s.enemies)for(const effect of enemy.costEffects||[]){if(Number.isFinite(Number(effect.costRecoveryMultiplier)))recovery*=Number(effect.costRecoveryMultiplier);if(Number.isFinite(Number(effect.respawnTimeMultiplier)))respawn*=Number(effect.respawnTimeMultiplier);}this.s.enemyCostRecoveryMultiplier=Math.max(0,recovery);this.s.enemyRespawnTimeMultiplier=Math.max(0,respawn);return {recovery,respawn};}
  respawnTime(u){return this.stats(u).respawnTime*Math.max(0,this.s.enemyRespawnTimeMultiplier??1);}
  costRecoveryMultiplier(){let multiplier=1;for(const u of this.s.units)if(u.deployed&&u.hp>0)for(const talent of this.profile(u).activeTalents||[]){const bb=blackboard(talent.blackboard),value=Number(bb.delta_cost_increase_time);if(Number.isFinite(value)&&value>0)multiplier*=value;}return multiplier;}
  tickCost(dt){const base=this.s.costRecoveryInterval;if(!Number.isFinite(base)||base<=0||this.s.cost>=this.s.costMax)return 0;const multiplier=this.costRecoveryMultiplier()*Math.max(0,Number(this.s.enemyCostRecoveryMultiplier??1));if(multiplier<=0)return 0;const interval=base/multiplier;this.s.costRecoveryClock+=Math.max(0,Number(dt)||0);let gained=0;while(this.s.costRecoveryClock+1e-9>=interval&&this.s.cost<this.s.costMax){this.s.costRecoveryClock-=interval;gained+=this.gainCost(this.s.cost<0?.5:1);}return gained;}
  baseDamageType(u){const p=this.profile(u),description=p.skill?.description||'',configured=operatorSkillConfig(this,u).damageType,active=this.skillActive(u)||u.enhanced||u.passiveArts;if(active&&configured)return configured;if(active&&description.includes('真实伤害'))return 'true';if(active&&/变为.*法术|造成法术/.test(description))return 'arts';return this.behavior(u).damageType;}
  hit(u,e,amount,type,opts={}){if(e.hp<=0||e.hidden||e.invulnerable||permissions(e).sleeping)return;const skill=!!opts.skill||this.skillActive(u),p=this.profile(u),pen=attackPenetration(this,u,e),enemyStatus=statusAttributeChanges(e);let penetrationRatio=this.on('preciShip')&&this.rows.preciShip.count>=3&&(this.owns(u,'preciShip')||p.position==='RANGED')?.3:0;penetrationRatio=Math.max(penetrationRatio,pen.ratio,equipMagicPenetration(this,u));const physical=damage({amount,type:'physical',defense:Math.max(0,e.def+(enemyStatus.defense||0)-pen.fixed),penetrationRatio}),arts=damage({amount,type:'arts',resistance:Math.max(0,e.res+(enemyStatus.resistance||0)+(enemyStatus.magicResistance||0)-Number(pen.magicFixed||0)),penetrationRatio});if(p.charId==='char_1014_nearl2'&&(p.skillIndex??u.source?.skillIndex)===2&&type!=='true'&&(e.block===u.uid||this.s.summons.some(x=>x.type==='nearl2-sun'&&x.ownerUid===u.uid&&e.block===x.uid)))type='true';if(type!=='true'&&(this.s.band==='band_chen'||p.garrisons.some(g=>blackboard(g.blackboard).key==='act1autochess_gar_eff_chaos')||equipWeakness(this,u)))type=physical>=arts?'physical':'arts';let value=type==='physical'?physical:type==='arts'?arts:amount;
  if(this.on('victoriaShip')&&this.owns(u,'victoriaShip')&&u.source.equipment.length)value*=1.25+.008*(this.layers.victoriaShip||0);
  if(this.on('kjeragShip')&&this.owns(u,'kjeragShip'))value*=e.statuses.some(s=>s.kind==='cold'||s.kind==='frozen')?1.35+.01*(this.layers.kjeragShip||0):1.25;
  if(this.on('emptyShip')&&this.owns(u,'emptyShip'))value*=p.isGolden?1.4:1.2;
  if(type==='arts'&&e.artsWeak)value*=1+e.artsWeak.value;
  value=attackModifier(this,u,e,value);
  if(type!=='true'&&e.damageResistance>0)value*=Math.max(0,1-e.damageResistance);
  if(e.fragile)value*=e.fragile;
  const garrisonScale=this.garrisonDamageScale(u,e);
  if(garrisonScale!==1)value*=garrisonScale;
  u.lastAttackId=u.lastAttackId||newAttackId(this);
  const result=dealDamage(this,{source:u,target:e,value,type,cause:skill?'skill':'attack',attackId:u.lastAttackId,skill});
  if(!result)return;
  if(!opts.bondExtra&&this.on('kazimierzShip')&&this.rows.kazimierzShip.count>=6&&this.owns(u,'kazimierzShip')&&e.block!==u.uid)dealDamage(this,{source:u,target:e,amount:this.stats(u).atk*(Number(this.params('kazimierzShip').pure_atk_scale)||.3),type:'true',cause:'extra',skipHooks:true});
  if(!opts.bondExtra&&this.on('siracusaShip')&&this.owns(u,'siracusaShip')){const b=this.params('siracusaShip'),inWindow=this.s.time<(u.siracusaInvisibleUntil||-Infinity)||(u.siracusaExposureUntil||-Infinity)>this.s.time;if(inWindow&&this.economy.random()<Number(b.prob||.03)){dealDamage(this,{source:u,target:e,amount:Number(b.base_damage||5000)+Number(b.damage_per_stack||50)*(this.layers.siracusaShip||0),type:'true',cause:'extra',skipHooks:true});applyStatus(e,'fear',Number(b.fear)||3,{source:u.uid,resistible:false});}}
  if(e.hp<=0)this.resolveEnemyDeath(e,u);
  if(p.charId==='char_1026_gvial2'&&(p.skillIndex??u.source?.skillIndex)===0&&this.skillActive(u)&&result.potentialHpDamage>0)this.heal(u,u,result.potentialHpDamage*(Number(blackboard(p.skill?.blackboard).heal_scale)||.35));
  if(u.pendingAttackHeal&&!u.pendingAttackHeal.used){const ally=alliedActors(this.s).filter(v=>v.deployed&&v.hp>0&&this.canHeal(v,u)&&Math.hypot(v.x-u.x,v.y-u.y)<=1.5&&(!u.pendingAttackHeal.requiresBelow||v.hp/v.maxHp<.7)&&(v.uid!==u.uid||u.hp<u.maxHp)).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp||a.uid-b.uid)[0];if(ally){this.heal(u,ally,this.stats(u).atk*u.pendingAttackHeal.scale);u.pendingAttackHeal.used=true;u.pendingAttackHeal=null;}}
  const healingDamage=result.blocked?0:Math.max(0,value-result.shield);if(p.branch==='incantationmedic'&&healingDamage>0&&u.deployed&&u.hp>0){const target=this.healingTargets(u)[0];if(target)this.heal(u,target,healingDamage*(branchTrait(p).values.scale??.5));}if(!result.blocked&&value>0)this.selfHealAfterDamage(u);if(p.branch==='slower'&&healingDamage>0)applyStatus(e,'sluggish',branchTrait(p).values.sluggish??.8,{source:u.uid});
  if(type==='arts'&&this.on('arcaneShip')&&this.owns(u,'arcaneShip'))e.artsWeak={value:this.rows.arcaneShip.count>=3&&e.hp/e.maxHp<.5?.68+.014*(this.layers.arcaneShip||0):.2+.01*(this.layers.arcaneShip||0),until:this.s.time+3};
 }
 hurt(u,e,{attackId=null,parentEventId=null,sourceLess=false,damageAmount=null,cause='attack',defPenetration=null}={}){const p=this.profile(u),skillIndex=p.skillIndex??u.source?.skillIndex;if(u.id==="char_311_mudrok"&&u.invulnerableUntil>this.s.time)return;if(u.id==="char_1032_excu2"&&skillIndex===1&&this.skillActive(u)&&e.damageType==="physical"&&this.economy.random()<Number(blackboard(p.skill?.blackboard).prob||0)){u.ammo=Math.min(u.ammoMax||Infinity,(u.ammo||0)+Number(blackboard(p.skill?.blackboard).recover_cnt||1));return;}let evade=this.behavior(u).evasion,evadeProb=branchTrait(p).values.prob??evade;if(u.physicalEvadeOnce&&e.damageType==='physical'){u.physicalEvadeOnce=false;evade=1;evadeProb=1;}else if(u.physicalEvadeUntil>this.s.time&&['physical'].includes(e.damageType)){evade=1;evadeProb=u.physicalEvadeProb||0;}else if(u.skillEvasionProb>0&&this.skillActive(u)&&['physical','arts'].includes(e.damageType)){evade=1;evadeProb=u.skillEvasionProb;}const tippiTalent=(p.activeTalents||[]).find(t=>t.name==='片场工作指南'),tippiQuiet=tippiTalent&&this.s.time-(u.lastDamagedAt??u.deployAt??0)>=Number(blackboard(tippiTalent.blackboard).stack_time||9);if(tippiQuiet&&e.damageType!=='true'){u.lastDamagedAt=this.s.time;this.s.effects.push({x:u.x,y:u.y,text:'闪避',life:.5,type:'evade'});this.emit('hit',{uid:u.uid,x:u.x,y:u.y,type:'evade'});return;}if(u.id==='char_420_flamtl'&&u.flamFollowUp==null)u.flamFollowUp=false;const flamAura=this.s.units.some(v=>v.deployed&&v.hp>0&&v.id==='char_420_flamtl'&&(this.profile(v).activeTalents||[]).some(t=>t.name==='红松骑士团团长')&&Array.isArray(this.profile(u).bonds)&&this.profile(u).bonds.includes('kazimierzShip'));if(flamAura&&e.damageType!=='true'&&this.economy.random()<.22){if(u.id==='char_420_flamtl')u.flamFollowUp=true;this.s.effects.push({x:u.x,y:u.y,text:'闪避',life:.5,type:'evade'});this.emit('hit',{uid:u.uid,x:u.x,y:u.y,type:'evade'});return;}const mountainTalent=p.charId==='char_264_f12yin'&&(p.activeTalents||[]).find(t=>t.name==='强壮肉体'),mountainProb=mountainTalent?Number(blackboard(mountainTalent.blackboard).prob)||.15:0;if(mountainProb>0&&e.damageType==='physical'&&this.economy.random()<mountainProb){this.s.effects.push({x:u.x,y:u.y,text:'闪避',life:.5,type:'evade'});this.emit('hit',{uid:u.uid,x:u.x,y:u.y,type:'evade'});return;}const lapSkill=(p.charId==='char_140_whitew'&&(skillIndex??0)===0&&this.skillActive(u)),lapProb=lapSkill?Number(blackboard(p.skill.blackboard).prob):0;if(lapProb>0&&e.damageType==='physical'&&this.economy.random()<lapProb){this.s.effects.push({x:u.x,y:u.y,text:'抵挡',life:.5,type:'block'});this.emit('hit',{uid:u.uid,x:u.x,y:u.y,type:'block'});return;}const armor=(p.activeTalents||[]).find(t=>t.name==='战术装甲'),armorProb=armor?Number(blackboard(armor.blackboard).prob):0;if(armorProb>0&&this.economy.random()<armorProb){this.s.effects.push({x:u.x,y:u.y,text:'抵挡',life:.5,type:'block'});this.emit('hit',{uid:u.uid,x:u.x,y:u.y,type:'block'});return;}if(evade&&['physical','arts'].includes(e.damageType)&&this.economy.random()<evadeProb){if(u.id==='char_420_flamtl')u.flamFollowUp=true;this.s.effects.push({x:u.x,y:u.y,text:'闪避',life:.5,type:'evade'});this.emit('hit',{uid:u.uid,x:u.x,y:u.y,type:'evade'});return;}let value=damage({amount:e.atk,type:e.damageType,defense:this.stats(u).def,resistance:this.stats(u).magicResistance});if(this.on('emptyShip'))value*=.8;
  const enemyAttack=Number.isFinite(damageAmount)?damageAmount:this.enemyAttackDamage(e,1,u);value=damage({amount:enemyAttack,type:e.damageType,defense:this.stats(u).def*(1-(defPenetration??(e.block===u.uid?e.enemyBlockedDefPenetration:null)??e.enemyDefPenetration??0)),resistance:this.stats(u).magicResistance});if(this.on('emptyShip'))value*=.8;if(u.damageResistance>0)value*=Math.max(0,1-u.damageResistance);const titi=this.s.units.find(v=>v.id==='char_4056_titi'&&v.deployed&&v.hp>0&&this.skillActive(v)&&(this.profile(v).skillIndex??v.source?.skillIndex)===2);if(titi&&u.id!==titi.id&&u.hp-value<=0){u.hp=1;applyStatus(u,'sleep',Math.max(1,titi.skillLeft||5),{source:titi.uid,resistible:false});return;}if(u.id==='char_4064_mlynar'&&this.s.enemies.filter(x=>x.hp>0&&Math.max(Math.abs(x.x-u.x),Math.abs(x.y-u.y))<=1).length>=3)value*=.85;const rmixerIndex=p.skillIndex??u.source?.skillIndex,rmixerBB=rmixerIndex===1?blackboard(p.skill?.blackboard):null;if(p.charId==='char_4194_rmixer'&&this.skillActive(u)&&rmixerIndex===1&&rmixerBB&&u.ammo>=Number(rmixerBB.ammo_cost||25)&&u.hp-value<=1){u.ammo-=Number(rmixerBB.ammo_cost||25);u.hp=1;this.emit('hit',{uid:u.uid,x:u.x,y:u.y,type:'guard'});return;}dealDamage(this,{source:sourceLess?null:e,target:u,value,type:e.damageType,cause,attackId,parentEventId});u.lastDamagedAt=this.s.time;if(cause==='attack'&&spTypeOf(this.profile(u).skill)==='INCREASE_WHEN_TAKEN_DAMAGE')gainSp(u,this.profile(u).skill,undefined,this.spCost(u));
 }
  tickBondIdle(u,dt){
   if(!this.on('raidShip')||!this.owns(u,'raidShip')||!u.deployed||u.hp<=0)return;
   const p=this.profile(u),skill=p.skill,cost=this.spCost(u),hasTarget=this.targets(u).length>0;
   if(hasTarget){u.raidIdleSince=null;return;}
   u.raidIdleSince??=this.s.time;
   if(this.s.time-u.raidIdleSince<10&&!(cost>0&&u.sp>=cost))return;
   const enemy=this.s.enemies.filter(e=>e.hp>0&&!e.hidden&&!e.flying).sort((a,b)=>a.progress-b.progress||a.uid-b.uid)[0];if(!enemy)return;/* ponytail: nearest ground target is the deterministic fallback until the full server target selector is available. */
   // 落点在敌人周围找：先四向、再逐圈外扩（nearbySpots），一直找到棋盘边界。
   // 候选格必须「能部署该干员且没被别的干员／占格子的召唤物占了」；只找 3 圈在满编阵型里
   // 会找不到落点而整个效果静默不触发，所以这里按距离枚举整张棋盘，取最近的那个空位。
   let landed=false;
   const reach=Math.max(this.map.rows||1,this.map.cols||1)+1;
   for(const spot of nearbySpots(enemy,{maxRadius:reach})){
    if(Math.round(u.x)===spot.x&&Math.round(u.y)===spot.y)continue;
    if(!canRelocateTo(this,u,spot.x,spot.y))continue;
    if(!teleportActor(this,u,{...spot,source:u,mode:'raid-redeploy'}))continue;
    landed=true;break;
   }
   if(landed){u.raidBuffUntil=this.s.time+10;u.raidIdleSince=this.s.time;u.lastAttack=this.s.time;this.emit('bond-raid',{uid:u.uid,x:u.x,y:u.y,targetUid:enemy.uid});}
  }
  step(){
  if(this.s.finished)return;if(this.s.settle.fault)throw Error('战斗结算异常');if(!this.s.settle.queue.length){this.s.settle.byId={};this.s.settle.consumed=[];}const dt=1/FPS;this.s.frame++;this.s.time=this.s.frame/FPS;while(this.s.queue.length&&this.s.queue[0].at<=this.s.time)this.spawn(this.s.queue.shift());this.refreshEnemyCostEffects();this.tickCost(dt);
  for(const e of this.s.enemies){tickStatuses(e,dt);this.tickEnemyRevive(e);tickEnemyForm(this,e);tickEnemySkills(this,e,dt);tickEnemyTraits(this,e,dt);if(e.palsyCharges>0&&e.statusResistance>0&&this.s.time>=(e.palsyDecayAt||0)){e.palsyCharges--;e.palsyDecayAt=this.s.time+5;}if(e.artsWeak?.until<this.s.time)e.artsWeak=null;if(e.hp>0&&e.regen>0)e.hp=Math.min(e.maxHp,e.hp+e.regen*dt);if(e.hp>0&&!e.lowHpTriggered&&e.lowHpRatio>0&&e.hp/e.maxHp<=e.lowHpRatio){e.lowHpTriggered=true;if(e.lowHpAttackMultiplier>0)e.atk=e.baseAtk*e.lowHpAttackMultiplier;if(e.lowHpMoveMultiplier>0)e.speed=e.baseSpeed*e.lowHpMoveMultiplier;if(e.lowHpUnblockTime>0){e.unblockable=true;e.unblockableUntil=this.s.time+e.lowHpUnblockTime;}this.emit('enemy-phase',{uid:e.uid,x:e.x,y:e.y,phase:'low-hp'});}if(e.unblockableUntil!=null&&this.s.time>=e.unblockableUntil)e.unblockable=false;}tickEnemyNeurotoxin(this);tickDeepWater(this);tickSandStorm(this);tickEnemyTransport(this);this.refreshEnemyAuras();this.tickEnemyDeathEye();this.tickEnemyInvisibleShield();this.flushEnemySpawns();
  for(const u of this.s.units){
   const previousStatuses=new Set((u.statuses||[]).map(v=>v.kind));tickStatuses(u,dt);for(const status of u.statuses||[])if(!previousStatuses.has(status.kind))dispatch(this,'status-applied',{source:null,target:u,status});const wasSkill=this.skillActive(u);u.skillLeft=Math.max(0,u.skillLeft-dt);u.spLock=Math.max(0,(u.spLock||0)-dt);if(u.focusHealAfter!=null&&this.s.time>=u.focusHealAfter)u.focusHeal=true;
   if(wasSkill&&!this.skillActive(u)){u.action=null;this.emit('skill-end',{uid:u.uid,x:u.x,y:u.y});dispatch(this,'skill-end',{target:u});}
   if(!u.deployed){if(u.hp<=0){u.down=Math.max(0,u.down-dt);if(u.down===0)this.deploy(u,{reentry:true});}else if(this.s.time>=u.deployAt)this.deploy(u);continue;}if(u.downed){u.action=null;u.skillLeft=0;u.hp=Math.min(u.maxHp,u.hp+u.maxHp*(u.blazeRegen||.03)*dt);if(u.hp>=u.maxHp-1e-9)reviveActor(this,u,{hpRatio:1,stunDuration:u.blazeStun||5,reason:'blaze-revive'});continue;}if(u.hp<=0)continue;
   if(u.id==='char_420_flamtl'&&u.flamFollowUp){const follow=this.targets(u).filter(e=>e.block===u.uid);for(const e of follow)this.hit(u,e,this.stats(u).atk,'physical',{skill:true});u.flamFollowUp=false;}
   this.tickBondIdle(u,dt);this.updateBranch(u,dt);if(!u.deployed||u.hp<=0)continue;const p=this.profile(u),skill=p.skill;let stats=this.stats(u),behavior=this.behavior(u);
   if(u.maxHp!==stats.maxHp){u.hp=u.hp/u.maxHp*stats.maxHp;u.maxHp=stats.maxHp;}recoverHP(u,(stats.hpRecoveryPerSec||0)*dt);
   const cost=this.spCost(u),blocking=this.s.enemies.some(e=>e.hp>0&&e.block===u.uid);
   tickTimeSp(u,skill,dt,stats.spRecoveryPerSec??1,{requiresBlock:!!behavior.spRequiresBlock,blocking,cost});
   let targets=this.targets(u),heals=this.healingTargets(u),healer=behavior.kind==='heal'||u.focusHeal;
   const policy=skillPolicy(this.data.common,{id:u.id,profession:p.profession,branch:p.branch},p.skillIndex).skillTriggerType;
   // 自动释放的判定口径：只要「技能开启后能打到」任何敌人就该开。因此这里用的是技能范围（不是当前范围）
   // 预判，包含飞行敌人、召唤物、以及未被阻挡的目标；被阻挡只是让单位可选，不是唯一条件。
   const canHitAfterSkill=this.skillWouldHitTarget(u,p);
   const readyByTargets=healer?heals.length>0:(targets.length>0||canHitAfterSkill);
   const skillReady=skill?.skillType==='AUTO'?u.sp>=cost&&readyByTargets:shouldAutoSkill({policy,ready:u.sp>=cost,deployed:u.deployed,now:this.s.time,lastOperation:u.lastSkill,initialDeployment:u.deployAt,hasTarget:readyByTargets,hasAnyTarget:this.s.enemies.length>0,hasEnemyInInitialRange:targets.length>0,hasEnemyInSkillRange:canHitAfterSkill,wasDamaged:this.s.time-(u.lastDamagedAt??-999)<.1});
   if(skill?.skillType==='PASSIVE'&&u.coinSkillEnabled&&(skill.skillIndex??u.source?.skillIndex)===1&&u.coins>0&&targets.length)this.activate(u);
   if(skill&&skill.skillType!=='PASSIVE'&&!u.enhanced&&!this.skillActive(u)&&skillReady)this.activate(u);
   stats=this.stats(u);behavior=this.behavior(u);healer=behavior.kind==='heal'||u.focusHeal;u.branchSkillActive=this.skillActive(u);
   targets=this.targets(u);heals=this.healingTargets(u);u.attackCooldown=Math.max(0,u.attackCooldown-1);
   if(u.action&&((u.action.kind==='heal'&&!healer)||(u.action.kind==='damage'&&healer))){u.action=null;u.attackCooldown=0;}
   const cookingPause=this.skillActive(u)&&(skill?.description||'').includes('停止攻击')&&(u.skillDisarmUntil==null||this.s.time<u.skillDisarmUntil);if(!permissions(u).attack||!behavior.attack||cookingPause){u.action=null;continue;}
   if(u.action&&--u.action.left<=0){const action=u.action;u.action=null;
    if(action.kind==='reload')u.magazine=Math.min(branchTrait(p).values.value??8,(u.magazine??0)+1);
    else if(action.kind==='charge')u.energy=Math.min(branchTrait(p).values.times??3,(u.energy||0)+1);
   else{u.lastAttackId=newAttackId(this);const released=this.releaseNativeAttack(u,action);if(released>0){if(behavior.magazine)u.magazine=Math.max(0,u.magazine-1);if(behavior.storage)u.energy=Math.max(0,(u.energy||0)-(action.storedEnergy||0));}u.lastAttack=this.s.time;if(spTypeOf(skill)==='INCREASE_WHEN_ATTACK'&&!action.enhanced)gainSp(u,skill,undefined,cost);if(u.ammo>0){const lumenSelective=u.id==='char_4042_lumen'&&((u.source?.skillIndex??this.profile(u).skillIndex)===2)&&!((action.targets||[]).some(id=>{const e=this.s.units.find(v=>v.uid===id);return e?.statuses?.some(s=>['stun','frozen','sleep','fear','root','silence'].includes(s.kind));}));const used=lumenSelective?0:Math.min(u.ammo,u.ammoPerAttack||1);if(used>0){u.ammo-=used;this.garrisonAmmoEvent(u,used);dispatch(this,'ammo',{source:u,target:u,used});this.emit('ammo',{uid:u.uid,x:u.x,y:u.y,ammo:u.ammo,used});}if(u.ammo===0&&!u.skillLeft){this.emit('skill-end',{uid:u.uid,x:u.x,y:u.y});dispatch(this,'skill-end',{target:u});}}}
   }
   if(u.action||u.attackCooldown>0||(behavior.returnProjectile&&u.pendingReturns>0))continue;
   const trait=branchTrait(p).values;
   if(behavior.magazine){u.magazine??=trait.value??8;if(u.magazine<=0||(!targets.length&&u.magazine<(trait.value??8))){u.action={kind:'reload',left:Math.max(1,Math.round(p.attributes.baseAttackTime*FPS))};continue;}}
   if(behavior.storage&&!targets.length&&(u.energy||0)<(trait.times??3)){const t=attackTiming(stats.baseAttackTime,stats.attackSpeed,windupSeconds(stats.baseAttackTime,p.attackWindup));u.attackCooldown=t.frames;u.action={kind:'charge',left:t.windupFrames};continue;}
   const active=this.skillActive(u)||u.enhanced,bb=active?blackboard(skill?.blackboard):{},cfg=operatorSkillConfig(this,u),defaultCount=behavior.style==='all'?this.s.enemies.length:behavior.style==='block-count'?Math.max(1,stats.blockCnt):behavior.targets||1;
   const talentCount=(p.activeTalents||[]).some(t=>/同时攻击两个目标/.test(t.description||''))?2:1,skillIndex=skill?.skillIndex??u.source?.skillIndex,skillExtra=(p.charId==='char_1019_siege2'&&active&&(skillIndex===1||skillIndex===2))?1:0,blockAll=(p.charId==='char_311_mudrok'&&active&&skillIndex===2)?Math.max(1,stats.blockCnt):0,count=cfg.multiTarget===Infinity?999:Math.max(blockAll,talentCount+skillExtra,cfg.multiTarget??bb.max_target??defaultCount),chosen=(healer?heals:targets).slice(0,count);if(u.coinSkillEnabled&&skillIndex===0&&u.coins>0&&!healer){const ally=alliedActors(this.s).filter(v=>v.deployed&&v.hp>0&&this.canHeal(v,u)&&v.hp/v.maxHp<.7&&Math.max(Math.abs(v.x-u.x),Math.abs(v.y-u.y))<=1).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp||a.uid-b.uid)[0];if(ally&&spendCoins(u,1))u.pendingAttackHeal={scale:cfg.bb.healScale??bb.heal_scale??.25,requiresBelow:true};}
   if(chosen.length){const timing=attackTiming(stats.baseAttackTime,stats.attackSpeed,windupSeconds(stats.baseAttackTime,p.attackWindup));u.attackCooldown=timing.frames;const hits=u.id==='char_1021_kroos2'&&u.kroosQuad?4:u.id==='char_427_vigil'&&skillIndex===2?3:(cfg.hits??bb['attack@times']??bb.hit_count??bb.times??behavior.hits??1);u.lockId=chosen[0].uid;u.action={kind:healer?'heal':'damage',left:timing.windupFrames,targets:chosen.map(e=>e.uid),amount:stats.atk*(cfg.atkScale??bb.atk_scale??1),baseAmount:stats.atk,hits:Math.max(1,Math.min(12,hits)),extraProjectiles:behavior.returnProjectile?cfg.extraProjectiles||0:0,type:this.baseDamageType(u),enhanced:!!u.enhanced,storedEnergy:behavior.storage?(u.energy||0):0,energyScale:behavior.storage?(cfg.atkScale??bb.atk_scale??1):1};u.enhanced=false;}
  }
  tickLogic(this,dt);
  this.tickGarrisonStatusEvents();
  this.tickEnemyGroundZones();
  resolveBlocks(blockingActors(this),this.s.enemies,u=>{
   // 高台上的干员不阻挡：推击手／钩索师能部署到高台（allowsHighlandPlacement），站上去就只打不挡。
   if(this.map.grid[u.y]?.[u.x]?.heightType==='HIGHLAND')return 0;
   return u.kind==='summon'?u.blockCnt||0:this.stats(u).blockCnt||0;
  });
  tickEnemyParasites(this);
  for(const e of this.s.enemies)tickPompeiiExplosion(this,e,dt);
  for(const e of this.s.enemies)tickEnemyLancer(this,e);
  for(const e of this.s.enemies){if(e.hp<=0||e.trainingDummy||e.carriedBy!=null)continue;tickEnemyForm(this,e);this.ensureEnemySelfField(e);tickEnemySkills(this,e,0);let control=permissions(e);const alive=attackableAllies(this.s);
   if(Number(e.burstUntil)>0&&this.s.time>=e.burstUntil)e.burstUntil=0;if(e.invisibleRecoverAt!=null&&this.s.time>=e.invisibleRecoverAt&&!e.action){e.formInvisible=true;e.invisible=true;e.invisibleRecoverAt=null;}
   if(e.movementPolicy===ENEMY_MOVEMENT_POLICIES.SCHEDULED_STOP){if(Number(e.stanceUntil)>0&&this.s.time>=e.stanceUntil)e.stanceUntil=0;if(!e.stanceUntil&&e.stanceInterval>0&&e.stanceDuration>0&&this.s.time>=e.nextStanceAt){e.stanceUntil=this.s.time+e.stanceDuration;e.nextStanceAt=this.s.time+e.stanceInterval;this.emit('enemy-stance',{uid:e.uid,x:e.x,y:e.y,until:e.stanceUntil});}}
   syncEnemyConcealMarker(e);
   const attackTargets=enemyAttackTargets(this,e,alive),target=attackTargets[0];e.attackCooldown=Math.max(0,e.attackCooldown-1);
   if(e.palsyCharges>0&&e.action&&(e.action.left<=1||this.s.time-(e.action.startedAt??this.s.time)>=2)){e.palsyCharges--;cancelEnemyCast(this,e);e.action=null;applyStatus(e,'tremble',.5,{source:'element-neural',resistible:false});control=permissions(e);}
   if((!control.attack||e.hidden||(e.action?.special?.index!=null&&(!control.skill||control.silenced)))&&e.action){cancelEnemyCast(this,e);e.action=null;}if(e.action&&--e.action.left<=0){const action=e.action,u=getActor(this.s,action.target);e.action=null;if(u&&u.hp>0||(action.targets||[]).some(id=>getActor(this.s,id)?.hp>0)){const special=action.special;if(special?.prefab==='DeathEye'){this.startEnemyDeathEye(e,u);}else{releaseEnemyAttack(this,e,action);if(special?.polluted){this.emit('enemy-skill',{uid:e.uid,x:u.x,y:u.y,skill:'PollutedRangedAtk',targetUid:u.uid});}}if(special){if(special.index!=null&&special.prefab!=='DeathEye'&&!e.enemyCast?.multiAttack)endEnemySkill(this,e);if(e.specialSkill?.spCost>0)e.skillAttackCount=0;e.nextSkillAt=this.s.time+(Number(e.specialSkill?.cooldown)>0?Number(e.specialSkill.cooldown):Infinity);e.firstAttackUsed=true;}e.lastAttackAt=this.s.time;if(e.movementPolicy===ENEMY_MOVEMENT_POLICIES.BURST_THEN_MOVE&&e.burstShots>0){e.burstFired=(e.burstFired||0)+1;if(e.burstFired>=e.burstShots){e.burstFired=0;e.burstUntil=this.s.time+(e.burstCooldown||0);}}}else if(action.special?.index!=null)cancelEnemyCast(this,e,{lostTarget:true});enemyTraitAfterAttack(this,e);}
   tickEnemyAttackContinuity(this,e,target);const special=control.skill&&!control.silenced?this.enemySpecialReady(e,target):null,specialOnly=Boolean(e.specialSkill?.prefab==='CrossAttack'&&e.range<=0),meleeScale=e.block===target?.uid&&e.meleeAttackScale>0?e.meleeAttackScale:1,preparedSpecial=special&&!special.polluted&&meleeScale!==1?{...special,scale:special.scale*meleeScale}:special;if(e.hp>0&&target&&e.canAttack&&control.attack&&!e.enemyCast&&!e.action&&!e.attackCooldown&&!Number(e.burstUntil)&&(!specialOnly||special)){if(e.movementPolicy===ENEMY_MOVEMENT_POLICIES.BURST_THEN_MOVE&&e.burstTarget!==target.uid){e.burstTarget=target.uid;e.burstFired=0;}enemyTraitBeforeAttack(this,e);const t=this.enemyAttackTiming(e);e.attackCooldown=t.frames;if(special?.index!=null)beginEnemySkill(this,e,e.enemySkills[special.index]);e.action={startedAt:this.s.time,left:t.windupFrames,target:target.uid,targetDeployGen:target.deployGen,ranged:e.ranged&&e.block!==target.uid,targets:attackTargets.slice(0,preparedSpecial?.targets??enemyAttackTargetCount(e)).map(t=>t.uid),special:preparedSpecial,scale:meleeScale,attackId:newAttackId(this)};}
   const hold=e.formHold||!!(e.enemyCast?.holdsPosition||e.enemyCast?.victims||e.enemyCast?.spawn||e.enemyCast?.channel||e.enemyCast?.charge)||enemyShouldHoldPosition(e,{target:specialOnly&&!special?null:target,now:this.s.time}),beforeX=e.x,beforeY=e.y,beforeCmd=e.cmd,beforeHidden=e.hidden;const fearMove=advanceEnemyFear(this,e,dt);let escaped=fearMove??advanceEnemy(e,dt,kind=>this.emit(kind,{uid:e.uid,x:e.x,y:e.y}),hold);paintDominion(this,e);enemyFacingAfterMove(this,e,beforeX);const progressed=e.cmd!==beforeCmd||Math.hypot(e.x-beforeX,e.y-beforeY)>1e-7||e.hidden!==beforeHidden;if(progressed){e.lastProgressAt=this.s.time;e.stallTime=0;}else if(!hold&&!e.block&&e.speed>0&&permissions(e).move&&e.route?.[e.cmd]?.kind==='move'){e.stallTime=(e.stallTime||0)+dt;if(e.stallTime>=(e.stallTimeout||2)){e.action=null;e.stanceUntil=0;e.burstUntil=0;e.stallTime=0;this.emit('enemy-recover',{uid:e.uid,x:e.x,y:e.y,reason:'movement-stall'});escaped=advanceEnemy(e,dt,kind=>this.emit(kind,{uid:e.uid,x:e.x,y:e.y}),false);}}
   if(escaped){this.s.leaks+=e.leak;e.escaped=true;commitExit(this,{target:e,reason:'leak'});this.emit('leak',{uid:e.uid,x:e.x,y:e.y,leak:e.leak});this.s.banner={text:'漏怪 −'+e.leak,life:1.4};}
  }
  syncPassengerPositions(this);
  for(const packet of dueStrikes(this.s))this.deliverStrike(packet);
  this.advanceNativeProjectiles(dt);tickEnemyProjectiles(this);
  if(this.s.banner){this.s.banner.life-=dt;if(this.s.banner.life<=0)this.s.banner=null;}
  this.s.effects=this.s.effects.filter(e=>(e.life-=dt)>0);this.s.enemies=this.s.enemies.filter(e=>e.hp>0);pruneEvents(this.s);this.flushEnemySpawns();
  if(this.s.benchmark){if(this.s.time>=this.s.limit)this.finish('timeout');}else if((!this.s.queue.length&&!this.s.enemies.length&&!this.s.pendingEnemySpawns?.length)||this.s.time>=this.s.limit||Math.min(ROUND_LEAK_CAP,this.s.leaks)>=this.economy.s.hp)this.finish('complete');
 }
 finish(reason='manual'){if(this.s.finished)return;this.s.finished=true;this.s.result=this.s.benchmark?dummySummary(this.s.enemies[0],this.s.time,reason):{kind:'battle',elapsed:this.s.time,kills:this.s.kills,leaks:this.s.leaks+(this.s.time>=this.s.limit?this.s.enemies.reduce((n,e)=>n+e.leak,0):0),units:this.s.units.map(u=>({uid:u.uid,id:u.id,damage:u.damage,healing:u.healing})),totalDamage:Object.values(this.s.damage).reduce((a,b)=>a+b,0)};}
}
