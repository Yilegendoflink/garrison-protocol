import {branchBehavior,branchTrait} from './native-branches.js';
import {nativeWavePlan} from './native-waves.js';
import {damage,applyDamage,recoverHP,attackTiming,FPS} from './combat.js';
import {applyStatus,tickStatuses,permissions,statusAttributeChanges} from './status.js';
import {blackboard,skillPolicy,shouldAutoSkill} from './protocol.js';
import {createTrainingDummy,dummySummary} from './benchmark.js';
import {usesSp,spTypeOf,skillKind,ammoCount,initSpOf,gainSp,tickTimeSp} from './native-sp.js';
import {containsTarget} from './targeting.js';
import {remainingDistance,compareOperatorTargets,compareEnemyTargets,resolveBlocks,compileRoute,advanceEnemy,skillFlow,combineStat,emitEvent,pruneEvents,scheduleStrikes,dueStrikes,windupSeconds,TENTATIVE_PROJECTILE_SPEED} from './native-combat.js';
import {operatorRegistry,attackModifier,attackPenetration,coinCapFor,coinGainAtSkillStart,grantCoins,spendCoins,moduleCostData,tokenCostFor} from './native-operator-effects.js';
import {ensureBattleShape,migrateBattle,validateBattle,dealDamage,applyHeal,applyRegen,applyLoss,commitExit,reviveActor,tickLogic,effectStatMods,dispatch,newAttackId,attackableAllies,getActor,blockingActors,alliedActors,operatorSkillConfig,moveActor} from './native-effects.js';

export class NativeBattle {
 constructor(data,economy,map,turn,{restore=false}={}){
  this.data=data;this.economy=economy;this.map=map;this.turn=turn;this.operatorRegistry=operatorRegistry(data);
  this.rows=economy.bonds();this.layers=economy.s.bondLayers;
  if(restore)return;
  this.s={frame:0,time:0,cost:20,costInitial:20,costMin:0,costMax:99,costRecoveryInterval:1,costRecoveryClock:0,enemyCostRecoveryMultiplier:1,enemyRespawnTimeMultiplier:1,mlyssFirstRhineDiscountUsed:false,units:[],enemies:[],projectiles:[],queue:[],damage:{},leaks:0,kills:0,finished:false,benchmark:!!turn.isBossTurn,limit:turn.isBossTurn?turn.bossTurnHpReduceTime:turn.normalPhaseTime,effects:[],events:[],strikes:[],banner:null,nextId:100000};
  this.s.band=economy.s.bandId;this.s.banner={text:'作战开始',life:1.6};
  const sources=economy.s.units.filter(u=>u.position).sort((a,b)=>a.position.y-b.position.y||a.position.x-b.position.x);
  this.s.units=sources.map((u,i)=>{const p=this.profile(u),a=p.attributes,skill=p.skill,costData=moduleCostData(p);return {uid:u.uid,id:u.charId,chessId:u.chessId,source:u,x:u.position.x,y:u.position.y,dir:u.dir,hp:a.maxHp,maxHp:a.maxHp,baseCost:a.cost||0,deploymentCost:0,lastDeploymentCost:0,redeployPenalty:0,waitingCost:false,runtimeCost:costData.runtimeCost,runtimeCostActive:costData.runtimeCostActive,runtimeCostUsed:false,refundRatio:costData.refundRatio,refundIgnoresCap:costData.refundIgnoresCap,chargerKillCost:costData.chargerKillCost,merchantCost:costData.merchantCost,merchantInterval:costData.merchantInterval,sp:initSpOf(skill),spCd:0,spLock:0,coins:0,deployed:false,deployAt:3+i*.18,down:0,skillLeft:0,skillCount:0,ammo:0,ammoMax:0,attackCooldown:0,action:null,statuses:[],immunities:{stun:a.stunImmune,silence:a.silenceImmune,frozen:a.frozenImmune,sleep:a.sleepImmune,levitate:a.levitateImmune,fear:a.fearedImmune,terror:a.fearedImmune,tremble:a.palsyImmune,root:a.attractImmune},shield:0,barriers:[],shieldLayers:[],damage:0,healing:0,lastAttack:0,lastSkill:-999,counters:{},buffs:[],deployGen:0,exitLife:null};});
  ensureBattleShape(this.s);dispatch(this,'battle-start',{target:null});
  if(this.s.benchmark){this.s.enemies=[createTrainingDummy(this.s.nextId++,5,3)];this.s.total=1;}else this.prepareWaves(turn);
  for(const u of this.s.units){const stats=this.stats(u);u.hp=u.maxHp=stats.maxHp;}
 }
 attachRuntime(){
  this.rows=this.economy.bonds();this.layers=this.economy.s.bondLayers;this.s.band=this.economy.s.bandId;for(const u of this.s.units){const p=this.profile(u),d=moduleCostData(p);u.runtimeCost??=d.runtimeCost;u.runtimeCostActive??=d.runtimeCostActive;u.runtimeCostUsed??=Boolean(u.deployCount||u.deployed);u.refundRatio??=d.refundRatio;u.refundIgnoresCap??=d.refundIgnoresCap;u.chargerKillCost??=d.chargerKillCost;u.merchantCost??=d.merchantCost;u.merchantInterval??=d.merchantInterval;}
  if(this.s.benchmark){this.combatScale={atk:1,hp:1,moveSpeed:1};return;}
  const plan=nativeWavePlan(this.data,this.turn,this.economy.s.waveRoster);this.level=plan.level;this.combatScale=plan.scale||{atk:1,hp:1,moveSpeed:1};
 }
 static restore(data,economy,map,turn,saved){
  try{const b=new NativeBattle(data,economy,map,turn,{restore:true});
  const migrated=migrateBattle(saved);if(validateBattle(migrated,b))return null;
  b.s=migrated;b.attachRuntime();return b;}catch{return null;}
 }
 profile(u){if(u.kind==='summon')return {branch:'summon',profession:'TOKEN',position:'MELEE',attributes:{...u,magicResistance:u.res||0},garrisons:[],trait:null,talents:[]};const row=this.data.profiles[u.chessId];const selected=row?.skillChoices?.[u.source?.skillIndex??u.skillIndex];return selected?{...row,...selected}:row;}
 skillActive(u){return u.skillLeft>0||u.ammo>0;}
 behavior(u){return branchBehavior(this.profile(u),this.skillActive(u));}
  canHeal(target,source=null){
  if(!target?.deployed||target.hp<=0||target.isolated||target.downed||target.healable===false||(target.unhealable&&source?.uid!==target.uid))return false;
  const noExternal=this.behavior(target).noExternalHealing,selfException=noExternal&&source?.uid===target.uid;
  return selfException||(!noExternal&&!target.unhealable&&!target.statuses?.some(s=>s.kind==='healingBlocked'));
 }
 elementInjury(target){const value=target.elemental??target.elementInjury;return typeof value==='number'?Math.max(0,value):Object.values(value||{}).reduce((sum,n)=>sum+Math.max(0,n||0),0);}
 healingTargets(u,allowFull=false){const element=this.behavior(u).elementHealing,locked=u.papyrsTargetUid;return alliedActors(this.s).filter(v=>(locked==null||!this.skillActive(u)||v.uid===locked)&&this.canHeal(v,u)&&this.inside(u,v)&&(allowFull||v.hp<v.maxHp||(element&&this.elementInjury(v)>0))).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp||(element?this.elementInjury(b)-this.elementInjury(a):0)||a.uid-b.uid);}
 inNamedRange(center,target,id){const range=this.data.ranges[id];return (range?.grids||[]).some(g=>{let x=g.col,y=-g.row;for(let i=0;i<(center.dir||0);i++)[x,y]=[-y,x];return Math.abs(center.x+x-target.x)<=.5&&Math.abs(center.y+y-target.y)<=.5;});}
 heal(source,target,amount,origin=source){
  if(!this.canHeal(target,source)||!Number.isFinite(amount)||amount<=0)return 0;
  const behavior=this.behavior(source),trait=branchTrait(this.profile(source));if(behavior.farHealRange&&!this.inNamedRange(source,target,behavior.farHealRange))amount*=trait.values.heal_scale??.8;if(behavior.healsDuringSkill&&this.skillActive(source))amount*=trait.values.heal_scale??.75;if(source.pendingHealBonus&&(!source.pendingHealBonus.requiresBelowHalf||target.hp/target.maxHp<.5)){amount+=target.maxHp*source.pendingHealBonus.ratio;source.pendingHealBonus=null;}
  if(source.pendingHealScale&&source.pendingHealScale>0){amount*=source.pendingHealScale;source.pendingHealScale=null;}
  return applyHeal(this,{source,target,amount,origin});
 }
 healElements(source,target,amount){
  if(!this.canHeal(target,source)||amount<=0)return;let restored=0;const injury=target.elemental??target.elementInjury;if(typeof injury==='number'){restored=Math.min(injury,amount);target.elemental=injury-restored;}else if(injury){for(const key of Object.keys(injury)){const n=Math.min(Math.max(0,injury[key]),amount);injury[key]-=n;restored+=n;}}source.elementHealing=(source.elementHealing||0)+restored;
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
  if(behavior.rangedPenalty&&target.block!==u.uid&&!(this.skillActive(u)&&/不再降低|不降低/.test(p.skill?.description||'')))scale*=bb.atk_scale??.8;
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
   scheduleStrikes(this.s,hits,{owner:u.uid,target:id,x:u.x,y:u.y,amount:action.amount*this.branchAttackScale(u,target),baseAmount:action.baseAmount??action.amount,type:action.type,skill:!!action.enhanced||this.skillActive(u),style:behavior.style,radius:behavior.radius||0,antiAir:behavior.antiAir,ownerDeployment:u.deployAt,ranged,branch:p.branch,returns:!!behavior.returnProjectile,storedEnergy:id===action.targets[0]?(action.storedEnergy||0):0,drone:!!behavior.drone});for(let extra=0;extra<(action.extraProjectiles||0);extra++)scheduleStrikes(this.s,1,{owner:u.uid,target:id,x:u.x,y:u.y,amount:action.amount*this.branchAttackScale(u,target),baseAmount:action.baseAmount??action.amount,type:action.type,skill:!!action.enhanced||this.skillActive(u),style:behavior.style,radius:behavior.radius||0,antiAir:behavior.antiAir,ownerDeployment:u.deployAt,ranged,branch:p.branch,returns:!!behavior.returnProjectile,drone:!!behavior.drone});
   released+=hits;
  }this.emit('attack',{uid:u.uid,x:u.x,y:u.y,kind:'damage',targetX:this.s.enemies.find(e=>e.uid===action.targets[0])?.x,targetY:this.s.enemies.find(e=>e.uid===action.targets[0])?.y,type:action.type,style:behavior.style,skill:this.skillActive(u),radius:behavior.radius||0});return released;
 }
 deliverStrike(packet){
  const u=this.s.units.find(x=>x.uid===packet.owner);if(!u)return;
  if(packet.effectOnly){this.emit('aftershock',{x:packet.x,y:packet.y,radius:packet.radius,type:packet.type});return;}
  if(packet.aftershock){const target=this.s.enemies.find(e=>e.uid===packet.target&&e.hp>0&&!e.hidden);if(target)this.hit(u,target,packet.amount,packet.type,{skill:packet.skill});return;}
  if(!u.deployed||u.hp<=0||packet.ownerDeployment!==u.deployAt||!permissions(u).attack)return;
  const target=this.s.enemies.find(e=>e.uid===packet.target&&e.hp>0);if(!target)return;
  this.emit('strike',{uid:u.uid,x:u.x,y:u.y,targetX:target.x,targetY:target.y,branch:packet.branch,style:packet.style,ranged:packet.ranged,hit:packet.hit,type:packet.type});
  const shot={...packet,startX:packet.x,startY:packet.y,speed:TENTATIVE_PROJECTILE_SPEED,returning:false};
  if(packet.ranged){this.s.projectiles.push(shot);if(packet.returns)u.pendingReturns=(u.pendingReturns||0)+1;}
  else this.impactNativeAttack(u,target,shot);
  if(packet.hit===0&&packet.storedEnergy)for(let n=0;n<packet.storedEnergy;n++)this.s.projectiles.push({owner:u.uid,target:target.uid,x:u.x,y:u.y,amount:packet.baseAmount??packet.amount,type:'arts',speed:TENTATIVE_PROJECTILE_SPEED,style:'single',branch:'mystic',antiAir:true,ownerDeployment:u.deployAt});
  if(packet.drone&&packet.hit===0){const trait=branchTrait(this.profile(u)).values;u.droneScale=u.droneTarget===target.uid?Math.min(trait.max_atk_scale??1.1,(u.droneScale??.2)+(trait.delta_atk_scale??.15)):(trait.init_atk_scale??.2);u.droneTarget=target.uid;const count=Math.max(1,u.floatUnits||1);for(let n=0;n<count;n++)this.s.projectiles.push({owner:u.uid,target:target.uid,x:u.x,y:u.y,amount:packet.amount*u.droneScale,type:'arts',speed:TENTATIVE_PROJECTILE_SPEED,style:'single',branch:'funnel',antiAir:true,ownerDeployment:u.deployAt});}
 }
 impactNativeAttack(u,target,packet){
  const p=this.profile(u),trait=branchTrait(p).values,eligible=e=>e.hp>0&&!e.invulnerable&&!permissions(e).sleeping&&(packet.antiAir||!e.flying||e.uid===target.uid);
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
  if(u.kind==='summon')return {...u,magicResistance:u.res||0,tauntLevel:0,parts:[]};
  const p=this.profile(u),base={...p.attributes},l=this.layers,has=id=>this.on(id)&&this.owns(u,id),parts=[];
  let atk=0,hp=0,def=0,as=0;const muls={atk:[],maxHp:[],def:[]};
  const note=(stat,layer,v,src)=>{if(v)parts.push({stat,layer,v,src});};
  const ratio=(stat,v,src)=>{if(!v)return;if(src.startsWith('盟约')||src.startsWith('策略')||src==='装备'||src==='部署加攻'||src==='击倒加攻'){muls[stat].push(1+v);note(stat,'mul',1+v,src);return;}if(stat==='atk')atk+=v;else if(stat==='maxHp')hp+=v;else def+=v;note(stat,'ratio',v,src);};
  const mul=(stat,v,src)=>{if(!Number.isFinite(v)||v===1)return;muls[stat].push(v);note(stat,'mul',v,src);};
  if(has('yanShip')){const b=this.params('yanShip'),v=b.base_atk+b.atk_per_stack*(l.yanShip||0);ratio('atk',v,'盟约·炎国');}
  if(has('egirShip')){const b=this.params('egirShip'),v=b.base_max_hp+b.max_hp_per_stack*(l.egirShip||0);ratio('maxHp',v,'盟约·阿戈尔');}
  if(this.on('steadShip')){const b=this.params('steadShip'),v=b.base_max_hp+b.max_hp_per_stack*(l.steadShip||0);ratio('maxHp',v,'盟约·坚毅');}
  if(this.on('deputShip')){const b=this.params('deputShip'),v=b.base_def+b.def_per_stack*(l.deputShip||0);ratio('def',v,'盟约·代行');base.respawnTime*=.7;}
  if(this.on('preciShip')&&(has('preciShip')||(this.rows.preciShip.count>=3&&p.position==='RANGED'))){const b=this.params('preciShip'),v=b.base_atk+b.atk_per_stack*(l.preciShip||0);ratio('atk',v,'盟约·精密');}
  if(has('soloShip')){ratio('atk',.6,'盟约·独行');ratio('maxHp',.6,'盟约·独行');}
  if(this.on('suntShip')&&p.isGolden)ratio('atk',.3,'盟约·萨米');
  if(this.on('raidShip')&&(l.raidShip||0)>=50){as+=50;note('attackSpeed','add',50,'盟约·游击');}
  if(has('siracusaShip')){const b=this.params('siracusaShip');if(this.s.time-u.deployAt<b.base_duration+b.duration_per_stack*(l.siracusaShip||0)){const v=b.base_attack_speed+b.attack_speed_per_stack*(l.siracusaShip||0);as+=v;note('attackSpeed','add',v,'盟约·叙拉古');}}
  if(this.on('skillfulShip')){const radius=(l.skillfulShip||0)>=40?1.42:1.01;if(this.s.units.some(v=>v.deployed&&v.hp>0&&this.owns(v,'skillfulShip')&&Math.hypot(u.x-v.x,u.y-v.y)<radius)){const v=10+(l.skillfulShip||0);as+=v;note('attackSpeed','add',v,'盟约·技巧');}}
  base.spRecoveryPerSec=p.attributes.spRecoveryPerSec??1;
  for(const g of p.garrisons){const b=blackboard(g.blackboard);if(g.battleRuneKey==='char_attribute_mul'){mul('atk',b.atk??1,'卫戍');mul('maxHp',b.max_hp??1,'卫戍');}if(g.battleRuneKey==='env_gbuff_new_with_verify'&&b.bond_id&&b.atk_per_stack)ratio('atk',b.atk_per_stack*(l[b.bond_id]||0),'卫戍');if(b.sp_recovery_per_sec)base.spRecoveryPerSec+=b.sp_recovery_per_sec;}
  for(const item of u.source.equipment){const record=this.data.season.trapChessDataDict[item.chessId];for(const effect of this.data.season.effectBuffInfoDataDict[record?.effectId]||[]){const b=blackboard(effect.blackboard);if(effect.key==='char_attribute_mul'){mul('atk',b.atk??1,'装备');mul('maxHp',b.max_hp??1,'装备');mul('def',b.def??1,'装备');}else if(effect.key.startsWith('env_gbuff')){ratio('atk',b.atk||0,'装备');ratio('maxHp',b.max_hp||0,'装备');ratio('def',b.def||0,'装备');as+=b.attack_speed||0;base.magicResistance+=b.magic_resistance||0;base.spRecoveryPerSec+=b.sp_recovery_per_sec||0;}}}
  if(has('victoriaShip')&&this.rows.victoriaShip.count>=6)for(const i of u.source.equipment)ratio('atk',this.data.season.trapChessDataDict[i.chessId].isGolden?.8:.5,'盟约·维多利亚');
  const band=this.s.band,count=Object.values(this.rows).filter(b=>b.active).length;
  if(band==='band_amiya'&&count>=3){const n=count>=5?.4:count===4?.3:.2;ratio('atk',n,'策略·阿米娅');ratio('maxHp',n,'策略·阿米娅');}
  if(band==='band_dusk'&&this.s.units.filter(v=>v.id===u.id).length>1)ratio('atk',.3,'策略·夕');
  if(band==='band_ioleta'&&p.isGolden){const n=this.s.units.filter(v=>this.profile(v).isGolden).length*.1;ratio('atk',n,'策略·伊奥莱塔');ratio('maxHp',n,'策略·伊奥莱塔');}
  ratio('atk',u.deathBuff||0,'击倒加攻');ratio('atk',u.deploymentBuff||0,'部署加攻');
  if(u.skillLeft>0||u.ammo>0){const b=blackboard(p.skill?.blackboard),cfg=operatorSkillConfig(this,u);ratio('atk',b.atk??cfg.bb.atk??0,'技能');ratio('maxHp',b.max_hp??cfg.bb.maxHp??0,'技能');ratio('def',b.def??cfg.bb.def??0,'技能');base.magicResistance+=b.magic_resistance??cfg.bb.magicResistance??0;as+=b.attack_speed??cfg.bb.attackSpeed??0;base.baseAttackTime=Math.max(.1,base.baseAttackTime+(b.base_attack_time||0));}
  if(p.charId==='char_440_pinecn'&&(p.skillIndex??u.source?.skillIndex)===1&&this.skillActive(u)){const b=blackboard(p.skill?.blackboard),keys=['a','b','c','d'],key=keys[Math.min(3,Math.max(0,(u.pineSkillUses||1)-1))],bonus=Number(b[`pinecn_s_2[${key}].atk`])||0;ratio('atk',bonus,'松果·电能过载');}
  if(u.talentSpRecoveryUntil>this.s.time)base.spRecoveryPerSec+=u.talentSpRecovery||0;
  if(u.wildmaneAspdUntil>this.s.time)as+=u.wildmaneAspd||0;
  if(u.gravelDefBuff&&this.s.time<u.gravelDefBuff.endsAt){const left=Math.max(0,Math.min(1,(u.gravelDefBuff.endsAt-this.s.time)/u.gravelDefBuff.duration));ratio('def',(u.gravelDefBuff.ratio||0)*left,'砾·影袭');}
  if(p.charId==='char_4026_vulpis'&&this.skillActive(u)&&(p.skillIndex??u.source?.skillIndex)===2){const attackSpeed=Number(blackboard(p.skill?.blackboard).attack_speed)||0,duration=Number(p.skill?.duration)||10,progress=Math.max(0,Math.min(1,u.skillLeft/duration));as-=attackSpeed;as+=attackSpeed*progress;}
  if(p.charId==='char_498_inside'&&this.skillActive(u)&&(p.skillIndex??u.source?.skillIndex)===1)base.tauntLevel=Math.min(base.tauntLevel??0,-1);
  if(p.charId==='char_491_humus'&&this.skillActive(u)&&(p.skillIndex??u.source?.skillIndex)===1){const b=blackboard(p.skill?.blackboard),hpRatio=u.maxHp>0?u.hp/u.maxHp:0,peak2=Number(b['humus_s_2[peak_2].peak_performance.hp_ratio'])||.8,peak1=Number(b['humus_s_2[peak_1].peak_performance.hp_ratio'])||.5,bonus=hpRatio>peak2?Number(b['humus_s_2[peak_2].peak_performance.atk'])||0:hpRatio>peak1?Number(b['humus_s_2[peak_1].peak_performance.atk'])||0:0;ratio('atk',bonus,'休谟斯·精力充沛');}
  const branch=branchBehavior(p,this.skillActive(u)),trait=branchTrait(p).values;if(p.branch==='merchant'){const buyer=(p.activeTalents||[]).find(t=>/特性消耗费用时获得.*金币/.test(t.description||''));if(buyer){const bb=blackboard(buyer.blackboard);ratio('atk',(Number(bb.atk)||0)*(u.merchantTalentStacks||0),'大买家');}}if(p.branch==='phalanx'&&!this.skillActive(u)){ratio('def',trait.def??2,'法阵');base.magicResistance+=trait.magic_resistance??20;}if(p.branch==='librator'){ratio('atk',(trait.atk??2)*Math.min(1,Math.floor(u.branchCharge||0)/(trait.max_stack_cnt??40)),'解放者');if(!this.skillActive(u))base.blockCnt=0;}if(branch.blockZeroDuringSkill&&this.skillActive(u))base.blockCnt=0;if(branch.taunt!==undefined)base.tauntLevel=Math.min(base.tauntLevel??0,branch.taunt);
  const status=statusAttributeChanges(u);as+=status.attackSpeed;ratio('atk',status.attack||0,'状态');ratio('def',status.defense||0,'状态');base.magicResistance+=(status.resistance||0)+(status.magicResistance||0);
  for(const e of this.economy.s.operatorModifiers||[])for(const[k,v]of Object.entries(blackboard(e.blackboard))){const key={max_hp:'maxHp',atk:'atk',def:'def'}[k];if(key)mul(key,v,'全局修正');}
  const extra=effectStatMods(this,u);atk+=extra.ratio.atk||0;hp+=extra.ratio.maxHp||0;def+=extra.ratio.def||0;as+=extra.attackSpeed;base.magicResistance+=(extra.magicResistance||0)+(extra.add.magicResistance||0);base.spRecoveryPerSec+=extra.spRecoveryPerSec;base.blockCnt=Math.max(0,(base.blockCnt||0)+(extra.add.blockCnt||0));base.tauntLevel=(base.tauntLevel||0)+(extra.add.tauntLevel||0);parts.push(...extra.parts);
  const skillBlackboard=(u.skillLeft>0||u.ammo>0)?blackboard(p.skill?.blackboard):{};if(Object.hasOwn(skillBlackboard,'block_cnt')){const value=Number(skillBlackboard.block_cnt)||0;base.blockCnt=Math.max(0,/阻挡数[^，；。\n]*\+/.test(p.skill?.description||'')?base.blockCnt+value:value);}base.tauntLevel+=(skillBlackboard.taunt_level??0);
  const a={...base,atk:combineStat(base.atk,extra.add.atk||0,atk,muls.atk,extra.finalAdd.atk||0),maxHp:combineStat(base.maxHp,extra.add.maxHp||0,hp,muls.maxHp,extra.finalAdd.maxHp||0),def:combineStat(base.def,extra.add.def||0,def,muls.def,extra.finalAdd.def||0),attackSpeed:Math.max(10,Math.min(600,base.attackSpeed+as)),parts};
  return a;
 }
 range(u,skill=false){const p=this.profile(u),r=skill&&p.skill?.rangeId?this.data.ranges[p.skill.rangeId]:p.range;let grids=r?.grids||[{row:0,col:1}];if(p.branch==='fortress'&&!grids.some(g=>g.row===0&&g.col===0))grids=grids.concat({row:0,col:0});return grids.map(g=>{let x=g.col,y=-g.row;for(let i=0;i<u.dir;i++)[x,y]=[-y,x];return{x:u.x+x,y:u.y+y};});}
 inside(u,e,skill=(u.skillLeft>0||u.ammo>0)){if(e.hidden)return false;return containsTarget(this.range(u,skill).map(g=>[g.x,g.y]),e);}
 targets(u){const behavior=this.behavior(u),p=this.profile(u),cfg=operatorSkillConfig(this,u),sleepOk=cfg.canTargetSleep||behavior.kind==='damage-heal';let targets=this.s.enemies.filter(e=>e.hp>0&&!e.hidden&&(!e.invisible||cfg.canSeeHidden||e.block===u.uid)&&!e.invulnerable&&!e.untargetable&&(sleepOk||!permissions(e).sleeping)&&(e.block===u.uid||((!e.flying||behavior.antiAir)&&(!behavior.airOnlyIdle||this.skillActive(u)||e.flying)&&this.inside(u,e))));
  const talentTargetRule=(p.activeTalents||[]).some(t=>/不以束缚状态的敌人为攻击目标/.test(t.description||''))?'rooted':null;
  if(cfg.targetRule==='blocked')targets=targets.filter(e=>e.block!=null);else if(cfg.targetRule==='unblocked')targets=targets.filter(e=>e.block==null);else if(cfg.targetRule==='ranged')targets=targets.filter(e=>e.ranged||e.canAttack&&e.range>0);else if(cfg.targetRule==='air')targets=targets.filter(e=>e.flying);else if(cfg.targetRule==='lowHp')targets=targets.filter(e=>e.maxHp>0&&e.hp/e.maxHp<=.8);else if(talentTargetRule==='rooted')targets=targets.filter(e=>permissions(e).rooted||e.statuses?.some(s=>s.kind==='root'));
  targets.sort((a,b)=>{if(cfg.targetRule==='maxHp')return b.maxHp-a.maxHp||b.hp-a.hp;if(cfg.targetRule==='minHp')return a.hp/a.maxHp-b.hp/b.maxHp;if(cfg.targetRule==='random')return (a.uid*1103515245%2147483647)-(b.uid*1103515245%2147483647);return compareOperatorTargets(a,b,u.uid,behavior.priority,p.position);});return targets;}
 prepareWaves(turn){const plan=nativeWavePlan(this.data,turn,this.economy.s.waveRoster);this.level=plan.level;this.s.queue=plan.queue;this.s.total=plan.total;this.combatScale=plan.scale||{atk:1,hp:1,moveSpeed:1};}
 path(route,flying){
  const to=p=>({x:p.col-this.map.origin.col,y:this.map.origin.row-p.row});
  const walk=p=>p.x>=0&&p.y>=0&&p.x<this.map.cols&&p.y<this.map.rows&&this.map.grid[p.y][p.x].passableMask!=='FLY_ONLY'&&this.map.grid[p.y][p.x].passableMask!=='NONE';
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
  spawn(q){const raw=this.level.enemyProfiles[q.id]||this.data.enemies[q.id];if(!raw)throw Error('缺少敌人数据 '+q.id);const a={...raw.attributes};for(const e of this.economy.s.enemyModifiers||[])for(const[k,v]of Object.entries(blackboard(e.blackboard))){const key={max_hp:'maxHp',atk:'atk',def:'def',magic_resistance:'magicResistance'}[k];if(key)a[key]=e.key.endsWith('_mul')?a[key]*v:a[key]+v;}const scale=this.s.benchmark?{atk:1,hp:1,moveSpeed:1}:this.combatScale||{atk:1,hp:1,moveSpeed:1},flying=raw.motion==='FLY'||this.level.routes[q.route].motionMode==='FLY',route=this.path(this.level.routes[q.route],flying),pos=route[0];this.s.enemies.push({uid:this.s.nextId++,id:q.id,name:raw.name,x:pos.x,y:pos.y,hp:a.maxHp*scale.hp,maxHp:a.maxHp*scale.hp,atk:a.atk*scale.atk,weight:a.massLevel??0,blockCost:a.blockCnt||1,def:a.def,res:a.magicResistance,speed:(a.moveSpeed||0)*scale.moveSpeed,interval:a.baseAttackTime||1,attackSpeed:a.attackSpeed||100,regen:a.hpRecoveryPerSec||0,canAttack:raw.applyWay!=='NONE',ranged:raw.applyWay==='RANGED',range:raw.rangeRadius||0,damageType:(raw.description||'').includes('法术')?'arts':'physical',flying,route,cmd:0,cmdLeft:null,segment:0,progress:remainingDistance({route,cmd:0,x:pos.x,y:pos.y}),block:null,hidden:false,untargetable:false,leak:raw.lifePointReduce??1,costEffects:raw.costEffects||[],statuses:[],immunities:{stun:a.stunImmune,silence:a.silenceImmune,frozen:a.frozenImmune,sleep:a.sleepImmune,levitate:a.levitateImmune,fear:a.fearedImmune,terror:a.fearedImmune,tremble:a.palsyImmune,root:a.attractImmune},shield:0,shieldLayers:[],barriers:[],deployGen:0,exitLife:null,attackCooldown:0,action:null});}
 event(u,event){
  const p=this.profile(u);for(const g of p.garrisons){if(g.eventType!=='IN_BATTLE'||g.effectType!=='ADD_BOND')continue;const b=blackboard(g.blackboard),key=b.key||'',match=event==='kill'?/selfkillenemy/.test(key):event==='skill'?/skill/.test(key):event==='deploy'?/born|deploy/.test(key):event==='ammo'?/consume_ammo/.test(key):false;if(!match)continue;const id=g.id+':'+event;u.counters[id]=(u.counters[id]||0)+1;const threshold=b.check_cnt||b.consume_count||1;if(u.counters[id]%threshold)continue;const limit=b.max_cnt||b.max_count||b.max_trigger_count||Infinity;if(u.counters[id]/threshold>limit)continue;const bonds=b.bond_id?String(b.bond_id).split(','):this.economy.ownBonds(u.source);for(const bond of bonds)this.economy.addLayers(bond,b.bond_add_type==='by_charlevel'?p.rank:(b.bond_add_count??1));}
 }
  reserveUnits(predicate=()=>true){return this.s.units.filter(u=>!u.deployed&&u.hp>0&&predicate(u));}
  adjustReserveCost(delta,{predicate=()=>true,limit=1}={}){const value=Number(delta);if(!Number.isFinite(value)||!value)return [];const rows=this.reserveUnits(predicate).sort((a,b)=>a.y-b.y||a.x-b.x||a.uid-b.uid).slice(0,Math.max(0,limit));for(const u of rows)u.costRealtimeDelta=(u.costRealtimeDelta||0)+value;return rows;}
  swapReserveBaseCosts(predicate=()=>true){const rows=this.reserveUnits(predicate).sort((a,b)=>(a.baseCostOverride??a.baseCost??0)-(b.baseCostOverride??b.baseCost??0)||a.uid-b.uid);if(rows.length<2)return false;const first=rows[0],last=rows.at(-1),a=first.baseCostOverride??first.baseCost,b=last.baseCostOverride??last.baseCost;first.baseCostOverride=b;last.baseCostOverride=a;return true;}
  deploymentCost(u){const p=this.profile(u),base=Math.max(0,Number(u.baseCostOverride??u.baseCost??p.attributes.cost)||0),runtime=!u.runtimeCostUsed&&u.runtimeCostActive?Number(u.runtimeCost)||0:0;let baseDelta=Number(u.costBaseDelta||0)+Number(u.wildmaneCostDelta||0),realtime=Number(u.costRealtimeDelta)||0;if(u.id==='char_237_gravel')baseDelta-=1;for(const source of this.s.units.filter(v=>v.deployed&&v.hp>0)){const sp=this.profile(source);if(source.id==='char_249_mlyss'&&p.groupId==='rhine'&&sp.activeTalents?.some(t=>/莱茵生命.*部署费用/.test(t.description||''))){baseDelta-=2;if(!this.s.mlyssFirstRhineDiscountUsed&&u.id!=='char_249_mlyss')baseDelta-=1;}}const multiplier=Math.pow(1.5,Math.min(2,Math.max(0,Number(u.redeployPenalty)||0)));return Math.max(0,Math.floor((base+baseDelta)*multiplier+realtime+runtime));}
  deploy(u,{reentry=false}={}){if(reentry){const cost=this.deploymentCost(u);if(cost>0&&!this.spendCost(cost,{considerNegativeCost:true}))return false;u.deploymentCost=cost;u.lastDeploymentCost=cost;u.refundCap=Math.max(0,Math.floor(Number(u.baseCostOverride??u.baseCost)||0)+(Number(u.costBaseDelta)||0));u.refundEligible=true;u.waitingCost=false;}u.runtimeCostUsed=true;u.wildmaneCostDelta=0;if(u.id!=='char_249_mlyss'&&this.s.mlyssFirstRhineDiscountUsed===false&&this.profile(u).groupId==='rhine'&&this.s.units.some(v=>v.id==='char_249_mlyss'&&v.deployed&&v.hp>0))this.s.mlyssFirstRhineDiscountUsed=true;u.hornBuff=null;u.lockHp=null;u.damageProtection=null;u.returnPosition=null;u.pendingAttackHeal=null;u.pendingAttackSelfHeal=null;u.pendingHealBonus=null;u.pendingHealScale=null;u.papyrsShieldScale=null;u.skillDisarmUntil=null;u.focusHealAfter=null;u.focusHeal=false;u.statusResistance=0;u.skillEndHealRatio=0;u.talentSpRecoveryUntil=0;u.talentSpRecovery=0;u.pineSkillUses=0;u.philaeNextAt=0;u.downed=false;u.blazeDownUsed=false;u.healable=true;u.talentTime=0;u.talentAmmoTimers={};u.talentAmmoFlags={};u.talentAmmoBonus=0;u.merchantDeployGen=null;u.merchantNextFeeAt=null;u.merchantTalentStacks=0;u.wildmaneAspdUntil=0;u.gravelDefBuff=null;u.physicalEvadeOnce=false;u.physicalEvadeUntil=0;u.physicalEvadeProb=0;u.skillEvasionProb=0;u.vulpisMarks={};u.vulpisKilled=false;u.shield=0;u.shieldLayers=[];u.barriers=[];u.deployed=true;u.deployCount=(u.deployCount||0)+1;u.deployGen=(u.deployGen||0)+1;u.exitLife=null;u.branchCharge=0;u.branchSkillActive=false;u.pendingReturns=0;u.energy=0;u.magazine=branchTrait(this.profile(u)).values.value??8;u.pendingSelfHeals=[];u.droneTarget=null;u.droneScale=0;u.reaperWindowStart=-999;u.reaperWindowCount=0;u.nextSelfHealAt=0;u.hp=u.maxHp=this.stats(u).maxHp;u.sp=initSpOf(this.profile(u).skill);u.spCd=0;u.spLock=0;u.ammo=0;u.ammoMax=0;u.lockId=null;if(this.on('soloShip')&&this.owns(u,'soloShip'))u.sp+=15;u.deployAt=this.s.time;this.event(u,'deploy');this.emit('deploy',{uid:u.uid,x:u.x,y:u.y});dispatch(this,'deploy',{target:u});if(this.on('kazimierzShip'))for(const v of this.s.units)if(this.owns(v,'kazimierzShip'))v.deploymentBuff=Math.min(.5+.01*(this.layers.kazimierzShip||0),(v.deploymentBuff||0)+.2);}
  activate(u){const p=this.profile(u),sk=p.skill,cfg=operatorSkillConfig(this,u);if(!sk||!permissions(u).skill||(!usesSp(sk)&&!cfg.coinCost))return;const b=blackboard(sk.blackboard),cost=this.spCost(u),kind=skillKind(sk)||(cfg.coinCost?'instant':null),flow=skillFlow(sk),passiveCoinSkill=sk.skillType==='PASSIVE'&&u.coinSkillEnabled,openingCoins=passiveCoinSkill?0:coinGainAtSkillStart(this,u),coinCap=coinCapFor(p);if(cfg.coinCost&&(u.coins||0)+openingCoins<cfg.coinCost)return;if(u.sp<cost||(usesSp(sk)&&sk.skillType!=='AUTO'&&this.s.time-u.lastSkill<3))return;if(kind==='instant'&&sk.skillType==='AUTO'&&(u.action||u.attackCooldown>0))return;if(flow.resetAttack){u.action=null;u.attackCooldown=0;}if(openingCoins)grantCoins(u,openingCoins,coinCap);if(cfg.coinCost&&!spendCoins(u,cfg.coinCost))return;u.sp=Math.max(0,Math.trunc(u.sp)-cost);u.lastSkill=this.s.time;u.skillCount++;u.ammo=kind==='ammo'?ammoCount(sk)+cfg.ammoBonus+(u.talentAmmoBonus||0):0;u.ammoMax=u.ammo;u.ammoPerAttack=cfg.ammoPerAttack;u.skillLeft=kind==='duration'?(sk.duration<0?1e9:sk.duration):0;if(kind==='instant'){const t=attackTiming(this.stats(u).baseAttackTime,this.stats(u).attackSpeed,windupSeconds(this.stats(u).baseAttackTime,p.attackWindup));u.spLock=t.seconds;}this.event(u,'skill');this.emit('skill-start',{uid:u.uid,kind,name:sk.name,x:u.x,y:u.y});if(dispatch(this,'skill-start',{target:u}))return;if(kind==='instant'&&sk.skillType==='AUTO'&&spTypeOf(sk)==='INCREASE_WHEN_ATTACK'){u.enhanced=true;return;}if(kind==='instant'){const targets=this.targets(u);if(p.branch!=='incantationmedic'&&/回复.*生命|治疗/.test(sk.description||'')){for(const v of this.healingTargets(u))this.heal(u,v,this.stats(u).atk*(cfg.bb.healScale??b.heal_scale??b.atk_scale??1));}else if(cfg.atkScale!=null||b.atk_scale){for(const e of targets.slice(0,cfg.multiTarget===Infinity?targets.length:(cfg.multiTarget??b.max_target??999)))for(let hit=0;hit<Math.max(1,cfg.hits||1);hit++)this.hit(u,e,this.stats(u).atk*(cfg.atkScale??b.atk_scale??1),this.baseDamageType(u),{skill:true});}if(b.stun||cfg.bb.stun)for(const e of targets){if(applyStatus(e,'stun',b.stun??cfg.bb.stun,{source:u.uid}))this.emit('control',{uid:e.uid,kind:'stun',x:e.x,y:e.y});}}}
 deactivate(u){const p=this.profile(u),sk=p.skill;if(!sk||!this.skillActive(u))return false;const idx=sk.skillIndex??u.source?.skillIndex;if(u.id==='char_1033_swire2'&&idx===2){const cfg=operatorSkillConfig(this,u),coins=Math.max(0,Math.trunc(u.coins||0));for(let i=0;i<coins;i++){const targets=this.targets(u);if(!targets.length)break;const target=targets[Math.floor(this.economy.random()*targets.length)];this.hit(u,target,this.stats(u).atk*(cfg.atkScale||1),'physical');moveActor(this,target,u,sk.description||'');}u.coins=0;}u.skillLeft=0;u.ammo=0;u.action=null;this.emit('skill-end',{uid:u.uid,x:u.x,y:u.y});dispatch(this,'skill-end',{target:u});return true;}
 spCost(u){const p=this.profile(u),base=p.skill?.spData.spCost||0;return this.on('suntShip')&&this.rows.suntShip.count>=5&&p.isGolden?Math.floor(base*.7):base;}
 gainCost(amount){const value=Number(amount);if(!Number.isFinite(value)||value<=0)return 0;const before=this.s.cost;this.s.cost=Math.min(this.s.costMax,before+value);const gained=this.s.cost-before;if(gained>0)this.emit('cost-gain',{amount:gained,total:this.s.cost});return gained;}
  spendCost(amount,{allowDebt=false,considerNegativeCost=false}={}){const value=Number(amount);if(!Number.isFinite(value)||value<=0)return false;const next=this.s.cost-value;if(next<this.s.costMin)return false;const debtAllowed=allowDebt||(considerNegativeCost&&this.s.costMin<0);if(!debtAllowed&&next<0)return false;this.s.cost=next;this.emit('cost-spend',{amount:value,total:this.s.cost});return true;}
  refreshEnemyCostEffects(){let recovery=1,respawn=1;for(const enemy of this.s.enemies)for(const effect of enemy.costEffects||[]){if(Number.isFinite(Number(effect.costRecoveryMultiplier)))recovery*=Number(effect.costRecoveryMultiplier);if(Number.isFinite(Number(effect.respawnTimeMultiplier)))respawn*=Number(effect.respawnTimeMultiplier);}this.s.enemyCostRecoveryMultiplier=Math.max(0,recovery);this.s.enemyRespawnTimeMultiplier=Math.max(0,respawn);return {recovery,respawn};}
  respawnTime(u){return this.stats(u).respawnTime*Math.max(0,this.s.enemyRespawnTimeMultiplier??1);}
  costRecoveryMultiplier(){let multiplier=1;for(const u of this.s.units)if(u.deployed&&u.hp>0)for(const talent of this.profile(u).activeTalents||[]){const bb=blackboard(talent.blackboard),value=Number(bb.delta_cost_increase_time);if(Number.isFinite(value)&&value>0)multiplier*=value;}return multiplier;}
  tickCost(dt){const base=this.s.costRecoveryInterval;if(!Number.isFinite(base)||base<=0||this.s.cost>=this.s.costMax)return 0;const multiplier=this.costRecoveryMultiplier()*Math.max(0,Number(this.s.enemyCostRecoveryMultiplier??1));if(multiplier<=0)return 0;const interval=base/multiplier;this.s.costRecoveryClock+=Math.max(0,Number(dt)||0);let gained=0;while(this.s.costRecoveryClock+1e-9>=interval&&this.s.cost<this.s.costMax){this.s.costRecoveryClock-=interval;gained+=this.gainCost(this.s.cost<0?.5:1);}return gained;}
  baseDamageType(u){const p=this.profile(u),description=p.skill?.description||'',configured=operatorSkillConfig(this,u).damageType,active=this.skillActive(u)||u.enhanced;if(active&&configured)return configured;if(active&&description.includes('真实伤害'))return 'true';if(active&&/变为.*法术|造成法术/.test(description))return 'arts';return this.behavior(u).damageType;}
  hit(u,e,amount,type,opts={}){if(e.hp<=0||e.hidden||e.invulnerable||permissions(e).sleeping)return;const skill=!!opts.skill||this.skillActive(u),p=this.profile(u),pen=attackPenetration(this,u,e),enemyStatus=statusAttributeChanges(e);let penetrationRatio=this.on('preciShip')&&this.rows.preciShip.count>=3&&(this.owns(u,'preciShip')||p.position==='RANGED')?.3:0;penetrationRatio=Math.max(penetrationRatio,pen.ratio);const physical=damage({amount,type:'physical',defense:Math.max(0,e.def+(enemyStatus.defense||0)-pen.fixed),penetrationRatio}),arts=damage({amount,type:'arts',resistance:Math.max(0,e.res+(enemyStatus.resistance||0)+(enemyStatus.magicResistance||0)),penetrationRatio});if(type!=='true'&&(this.s.band==='band_chen'||p.garrisons.some(g=>blackboard(g.blackboard).key==='act1autochess_gar_eff_chaos')))type=physical>=arts?'physical':'arts';let value=type==='physical'?physical:type==='arts'?arts:amount;
  if(this.on('victoriaShip')&&this.owns(u,'victoriaShip')&&u.source.equipment.length)value*=1.25+.008*(this.layers.victoriaShip||0);
  if(this.on('kjeragShip')&&this.owns(u,'kjeragShip'))value*=e.statuses.some(s=>s.kind==='cold'||s.kind==='frozen')?1.35+.01*(this.layers.kjeragShip||0):1.25;
  if(this.on('emptyShip')&&this.owns(u,'emptyShip'))value*=p.isGolden?1.4:1.2;
  if(type==='arts'&&e.artsWeak)value*=1+e.artsWeak.value;
  value=attackModifier(this,u,e,value);
  if(e.fragile)value*=e.fragile;
  u.lastAttackId=u.lastAttackId||newAttackId(this);
  const result=dealDamage(this,{source:u,target:e,value,type,cause:skill?'skill':'attack',attackId:u.lastAttackId,skill});
  if(!result)return;
  if(u.pendingAttackHeal&&!u.pendingAttackHeal.used){const ally=alliedActors(this.s).filter(v=>v.deployed&&v.hp>0&&this.canHeal(v,u)&&Math.hypot(v.x-u.x,v.y-u.y)<=1.5&&(!u.pendingAttackHeal.requiresBelow||v.hp/v.maxHp<.7)&&(v.uid!==u.uid||u.hp<u.maxHp)).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp||a.uid-b.uid)[0];if(ally){this.heal(u,ally,this.stats(u).atk*u.pendingAttackHeal.scale);u.pendingAttackHeal.used=true;u.pendingAttackHeal=null;}}
  const healingDamage=result.blocked?0:Math.max(0,value-result.shield);if(p.branch==='incantationmedic'&&healingDamage>0&&u.deployed&&u.hp>0){const target=this.healingTargets(u)[0];if(target)this.heal(u,target,healingDamage*(branchTrait(p).values.scale??.5));}if(!result.blocked&&value>0)this.selfHealAfterDamage(u);if(p.branch==='slower'&&healingDamage>0)applyStatus(e,'sluggish',branchTrait(p).values.sluggish??.8,{source:u.uid});
  if(type==='arts'&&this.on('arcaneShip')&&this.owns(u,'arcaneShip'))e.artsWeak={value:this.rows.arcaneShip.count>=3&&e.hp/e.maxHp<.5?.68+.014*(this.layers.arcaneShip||0):.2+.01*(this.layers.arcaneShip||0),until:this.s.time+3};
 }
 hurt(u,e){const p=this.profile(u),skillIndex=p.skillIndex??u.source?.skillIndex;let evade=this.behavior(u).evasion,evadeProb=branchTrait(p).values.prob??evade;if(u.physicalEvadeOnce&&e.damageType==='physical'){u.physicalEvadeOnce=false;evade=1;evadeProb=1;}else if(u.physicalEvadeUntil>this.s.time&&['physical'].includes(e.damageType)){evade=1;evadeProb=u.physicalEvadeProb||0;}else if(u.skillEvasionProb>0&&this.skillActive(u)&&['physical','arts'].includes(e.damageType)){evade=1;evadeProb=u.skillEvasionProb;}if(evade&&['physical','arts'].includes(e.damageType)&&this.economy.random()<evadeProb){this.s.effects.push({x:u.x,y:u.y,text:'闪避',life:.5,type:'evade'});this.emit('hit',{uid:u.uid,x:u.x,y:u.y,type:'evade'});return;}let value=damage({amount:e.atk,type:e.damageType,defense:this.stats(u).def,resistance:this.stats(u).magicResistance});if(this.on('emptyShip'))value*=.8;
  const enemyAttack=e.atk*(1+Math.min(0,statusAttributeChanges(e).attack||0));value=damage({amount:enemyAttack,type:e.damageType,defense:this.stats(u).def,resistance:this.stats(u).magicResistance});if(this.on('emptyShip'))value*=.8;dealDamage(this,{source:e,target:u,value,type:e.damageType,cause:'attack'});u.lastDamagedAt=this.s.time;if(spTypeOf(this.profile(u).skill)==='INCREASE_WHEN_TAKEN_DAMAGE')gainSp(u,this.profile(u).skill,undefined,this.spCost(u));
 }
  step(){
  if(this.s.finished)return;if(this.s.settle.fault)throw Error('战斗结算异常');if(!this.s.settle.queue.length){this.s.settle.byId={};this.s.settle.consumed=[];}const dt=1/FPS;this.s.frame++;this.s.time=this.s.frame/FPS;while(this.s.queue.length&&this.s.queue[0].at<=this.s.time)this.spawn(this.s.queue.shift());this.refreshEnemyCostEffects();this.tickCost(dt);
  for(const e of this.s.enemies){tickStatuses(e,dt);if(e.artsWeak?.until<this.s.time)e.artsWeak=null;}
  for(const u of this.s.units){
   tickStatuses(u,dt);const wasSkill=this.skillActive(u);u.skillLeft=Math.max(0,u.skillLeft-dt);u.spLock=Math.max(0,(u.spLock||0)-dt);if(u.focusHealAfter!=null&&this.s.time>=u.focusHealAfter)u.focusHeal=true;
   if(wasSkill&&!this.skillActive(u)){u.action=null;this.emit('skill-end',{uid:u.uid,x:u.x,y:u.y});dispatch(this,'skill-end',{target:u});}
   if(!u.deployed){if(u.hp<=0){u.down=Math.max(0,u.down-dt);if(u.down===0)this.deploy(u,{reentry:true});}else if(this.s.time>=u.deployAt)this.deploy(u);continue;}if(u.downed){u.action=null;u.skillLeft=0;u.hp=Math.min(u.maxHp,u.hp+u.maxHp*(u.blazeRegen||.03)*dt);if(u.hp>=u.maxHp-1e-9)reviveActor(this,u,{hpRatio:1,stunDuration:u.blazeStun||5,reason:'blaze-revive'});continue;}if(u.hp<=0)continue;
   this.updateBranch(u,dt);if(!u.deployed||u.hp<=0)continue;const p=this.profile(u),skill=p.skill;let stats=this.stats(u),behavior=this.behavior(u);
   if(u.maxHp!==stats.maxHp){u.hp=u.hp/u.maxHp*stats.maxHp;u.maxHp=stats.maxHp;}recoverHP(u,(stats.hpRecoveryPerSec||0)*dt);
   const cost=this.spCost(u),blocking=this.s.enemies.some(e=>e.hp>0&&e.block===u.uid);
   tickTimeSp(u,skill,dt,stats.spRecoveryPerSec??1,{requiresBlock:!!behavior.spRequiresBlock,blocking,cost});
   let targets=this.targets(u),heals=this.healingTargets(u),healer=behavior.kind==='heal'||u.focusHeal;
   const policy=skillPolicy(this.data.common,{id:u.id,profession:p.profession,branch:p.branch},p.skillIndex).skillTriggerType;
   const skillReady=skill?.skillType==='AUTO'?u.sp>=cost&&(healer?heals.length>0:targets.length>0):shouldAutoSkill({policy,ready:u.sp>=cost,deployed:u.deployed,now:this.s.time,lastOperation:u.lastSkill,initialDeployment:u.deployAt,hasTarget:healer?heals.length>0:targets.length>0,hasAnyTarget:this.s.enemies.length>0,hasEnemyInInitialRange:targets.length>0,hasEnemyInSkillRange:this.s.enemies.some(e=>e.hp>0&&this.inside(u,e,true)),wasDamaged:this.s.time-(u.lastDamagedAt??-999)<.1});
   if(skill?.skillType==='PASSIVE'&&u.coinSkillEnabled&&(skill.skillIndex??u.source?.skillIndex)===1&&u.coins>0&&targets.length)this.activate(u);
   if(skill&&skill.skillType!=='PASSIVE'&&!u.enhanced&&!this.skillActive(u)&&skillReady)this.activate(u);
   stats=this.stats(u);behavior=this.behavior(u);healer=behavior.kind==='heal'||u.focusHeal;u.branchSkillActive=this.skillActive(u);
   targets=this.targets(u);heals=this.healingTargets(u);u.attackCooldown=Math.max(0,u.attackCooldown-1);
   if(u.action&&((u.action.kind==='heal'&&!healer)||(u.action.kind==='damage'&&healer))){u.action=null;u.attackCooldown=0;}
   const cookingPause=this.skillActive(u)&&(skill?.description||'').includes('停止攻击')&&(u.skillDisarmUntil==null||this.s.time<u.skillDisarmUntil);if(!permissions(u).attack||!behavior.attack||cookingPause){u.action=null;continue;}
   if(u.action&&--u.action.left<=0){const action=u.action;u.action=null;
    if(action.kind==='reload')u.magazine=Math.min(branchTrait(p).values.value??8,(u.magazine??0)+1);
    else if(action.kind==='charge')u.energy=Math.min(branchTrait(p).values.times??3,(u.energy||0)+1);
   else{u.lastAttackId=newAttackId(this);const released=this.releaseNativeAttack(u,action);if(released>0){if(behavior.magazine)u.magazine=Math.max(0,u.magazine-1);if(behavior.storage)u.energy=Math.max(0,(u.energy||0)-(action.storedEnergy||0));}u.lastAttack=this.s.time;if(spTypeOf(skill)==='INCREASE_WHEN_ATTACK'&&!action.enhanced)gainSp(u,skill,undefined,cost);if(u.ammo>0){const used=Math.min(u.ammo,u.ammoPerAttack||1);u.ammo-=used;this.event(u,'ammo');dispatch(this,'ammo',{source:u,target:u,used});this.emit('ammo',{uid:u.uid,x:u.x,y:u.y,ammo:u.ammo,used});if(u.ammo===0&&!u.skillLeft){this.emit('skill-end',{uid:u.uid,x:u.x,y:u.y});dispatch(this,'skill-end',{target:u});}}}
   }
   if(u.action||u.attackCooldown>0||(behavior.returnProjectile&&u.pendingReturns>0))continue;
   const trait=branchTrait(p).values;
   if(behavior.magazine){u.magazine??=trait.value??8;if(u.magazine<=0||(!targets.length&&u.magazine<(trait.value??8))){u.action={kind:'reload',left:Math.max(1,Math.round(p.attributes.baseAttackTime*FPS))};continue;}}
   if(behavior.storage&&!targets.length&&(u.energy||0)<(trait.times??3)){const t=attackTiming(stats.baseAttackTime,stats.attackSpeed,windupSeconds(stats.baseAttackTime,p.attackWindup));u.attackCooldown=t.frames;u.action={kind:'charge',left:t.windupFrames};continue;}
   const active=this.skillActive(u)||u.enhanced,bb=active?blackboard(skill?.blackboard):{},cfg=operatorSkillConfig(this,u),defaultCount=behavior.style==='all'?this.s.enemies.length:behavior.style==='block-count'?Math.max(1,stats.blockCnt):behavior.targets||1;
   const count=cfg.multiTarget===Infinity?999:(cfg.multiTarget??bb.max_target??defaultCount),chosen=(healer?heals:targets).slice(0,count),skillIndex=skill?.skillIndex??u.source?.skillIndex;if(u.coinSkillEnabled&&skillIndex===0&&u.coins>0&&!healer){const ally=alliedActors(this.s).filter(v=>v.deployed&&v.hp>0&&this.canHeal(v,u)&&v.hp/v.maxHp<.7&&Math.max(Math.abs(v.x-u.x),Math.abs(v.y-u.y))<=1).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp||a.uid-b.uid)[0];if(ally&&spendCoins(u,1))u.pendingAttackHeal={scale:cfg.bb.healScale??bb.heal_scale??.25,requiresBelow:true};}
   if(chosen.length){const timing=attackTiming(stats.baseAttackTime,stats.attackSpeed,windupSeconds(stats.baseAttackTime,p.attackWindup));u.attackCooldown=timing.frames;const hits=cfg.hits??bb['attack@times']??bb.hit_count??bb.times??behavior.hits??1;u.lockId=chosen[0].uid;u.action={kind:healer?'heal':'damage',left:timing.windupFrames,targets:chosen.map(e=>e.uid),amount:stats.atk*(cfg.atkScale??bb.atk_scale??1),baseAmount:stats.atk,hits:Math.max(1,Math.min(12,hits)),extraProjectiles:behavior.returnProjectile?cfg.extraProjectiles||0:0,type:this.baseDamageType(u),enhanced:!!u.enhanced,storedEnergy:behavior.storage?(u.energy||0):0};u.enhanced=false;}
  }
  tickLogic(this,dt);
  resolveBlocks(blockingActors(this),this.s.enemies,u=>u.kind==='summon'?u.blockCnt||0:this.stats(u).blockCnt||0);
  for(const e of this.s.enemies){if(e.hp<=0||e.trainingDummy)continue;const control=permissions(e),alive=attackableAllies(this.s);
   const target=e.hidden?null:e.block?alive.find(u=>u.uid===e.block):e.ranged?alive.filter(u=>!permissions(u).sleeping&&Math.hypot(u.x-e.x,u.y-e.y)<=e.range).sort((a,b)=>compareEnemyTargets({tauntLevel:a.kind==='summon'?0:this.stats(a).tauntLevel,deployAt:a.deployAt||0,uid:a.uid},{tauntLevel:b.kind==='summon'?0:this.stats(b).tauntLevel,deployAt:b.deployAt||0,uid:b.uid}))[0]:null;e.attackCooldown=Math.max(0,e.attackCooldown-1);
   if(!control.attack||e.hidden)e.action=null;if(e.action&&--e.action.left<=0){const u=getActor(this.s,e.action.target);e.action=null;if(u&&u.hp>0){this.emit('strike',{uid:e.uid,x:e.x,y:e.y,targetX:u.x,targetY:u.y,ranged:e.ranged,enemy:true,type:e.damageType,style:'single'});this.hurt(u,e);}}if(target&&e.canAttack&&control.attack&&!e.action&&!e.attackCooldown){const t=attackTiming(e.interval,e.attackSpeed,windupSeconds(e.interval));e.attackCooldown=t.frames;e.action={left:t.windupFrames,target:target.uid};}
   if(advanceEnemy(e,dt,kind=>this.emit(kind,{uid:e.uid,x:e.x,y:e.y}),!!target||!!e.action)){this.s.leaks+=e.leak;e.escaped=true;commitExit(this,{target:e,reason:'leak'});this.emit('leak',{uid:e.uid,x:e.x,y:e.y,leak:e.leak});this.s.banner={text:'漏怪 −'+e.leak,life:1.4};}
  }
  for(const packet of dueStrikes(this.s))this.deliverStrike(packet);
  this.advanceNativeProjectiles(dt);
  if(this.s.banner){this.s.banner.life-=dt;if(this.s.banner.life<=0)this.s.banner=null;}
  this.s.effects=this.s.effects.filter(e=>(e.life-=dt)>0);this.s.enemies=this.s.enemies.filter(e=>e.hp>0);pruneEvents(this.s);
  if(this.s.benchmark){if(this.s.time>=this.s.limit)this.finish('timeout');}else if((!this.s.queue.length&&!this.s.enemies.length)||this.s.time>=this.s.limit||this.s.leaks>=this.economy.s.hp)this.finish('complete');
 }
 finish(reason='manual'){if(this.s.finished)return;this.s.finished=true;this.s.result=this.s.benchmark?dummySummary(this.s.enemies[0],this.s.time,reason):{kind:'battle',elapsed:this.s.time,kills:this.s.kills,leaks:this.s.leaks+(this.s.time>=this.s.limit?this.s.enemies.reduce((n,e)=>n+e.leak,0):0),units:this.s.units.map(u=>({uid:u.uid,id:u.id,damage:u.damage,healing:u.healing})),totalDamage:Object.values(this.s.damage).reduce((a,b)=>a+b,0)};}
}
