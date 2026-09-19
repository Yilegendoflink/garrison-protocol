import {applyDamage,recoverHP,damage} from './combat.js';
import {applyStatus,permissions} from './status.js';
import {blackboard,resolveActiveTalents,nativeAttributes} from './protocol.js';
import {gainSp} from './native-sp.js';
import {statMods,onEvent,operatorSkillStart,periodicMods,skillConfig,targetFilter,damageReductionFor,talentValues,grantCoins,coinCapFor,coinGainAtSkillStart,tokenCostFor} from './native-operator-effects.js';
import {FLIGHT_PRESETS,FLIGHT_MODES,stepFlight,faceTarget,setFlightVelocity,distanceBetween,ensureFlight,orbitStep,fanHeadings,randomPointInSquare} from './native-flight.js';

export const BATTLE_SCHEMA_VERSION=1;
export const EFFECT_KINDS=new Set(['dot','hot','regen','loss','delayed','zone','attached','aura','guard','barrier','lock','stat']);
export const ELEMENT_TYPES=new Set(['neural','burn','necrosis','corrosion','elemental']);
const QUEUE_CAP=256,ANCESTOR_CAP=32;

export function emptySettle(){return {nextEventId:1,nextAttackId:1,nextEffectId:1,nextSeq:1,queue:[],consumed:[],byId:{},fault:null};}
export function ensureBattleShape(s){
 s.battleSchemaVersion??=BATTLE_SCHEMA_VERSION;
 s.cost??=20;s.costInitial??=20;s.costMin??=0;s.costMax??=99;s.costRecoveryInterval??=1;s.costRecoveryClock??=0;s.enemyCostRecoveryMultiplier??=1;s.enemyRespawnTimeMultiplier??=1;s.mlyssFirstRhineDiscountUsed??=false;s.bondLateranoAmmoStacks??=0;s.bondEgirReviveCount??=0;s.bondYanGuardiansSpawned??=false;
 s.logicEffects??=[];s.summons??=[];s.logicLog??=[];
 s.settle={...emptySettle(),...s.settle,byId:s.settle?.byId||{}};
 s.settle.consumed=s.settle.consumed||[];s.settle.queue=s.settle.queue||[];
 for(const u of s.units||[]){u.deployGen??=0;u.baseCost??=null;u.deploymentCost??=0;u.lastDeploymentCost??=0;u.redeployPenalty??=0;u.waitingCost??=false;u.shieldLayers??=[];u.barriers??=[];u.damageRedirects??=[];u.exitLife=u.exitLife||null;}
 for(const e of s.enemies||[]){e.shieldLayers??=[];e.barriers??=[];e.damageRedirects??=[];}
 return s;
}
export function migrateBattle(saved){
 if(!saved||!Array.isArray(saved.units)||!Array.isArray(saved.enemies)||(saved.battleSchemaVersion??0)>BATTLE_SCHEMA_VERSION)return null;
 const s=structuredClone(saved);ensureBattleShape(s);s.battleSchemaVersion=BATTLE_SCHEMA_VERSION;
 for(const actor of [...s.units,...s.enemies,...s.summons])if(actor.shield>0&&!actor.shieldLayers.length)actor.shieldLayers=[{id:'legacy-'+actor.uid,remaining:actor.shield,max:actor.shield}];
 s.nextId=Math.max(s.nextId||100000,...[...s.units,...s.enemies,...s.summons].map(a=>a.uid+1));return s;
}
export function validateBattle(s,battle){
 if(!s||!Array.isArray(s.units)||!Array.isArray(s.enemies)||!Number.isFinite(s.time)||!Number.isFinite(s.frame)||!Number.isFinite(s.cost)||!Number.isFinite(s.costInitial)||!Number.isFinite(s.costMin)||!Number.isFinite(s.costMax)||!Number.isFinite(s.costRecoveryInterval)||!Number.isFinite(s.costRecoveryClock)||s.costRecoveryInterval<=0||s.costMin>s.costMax||s.cost<s.costMin)return 'invalid battle snapshot';
 const ids=new Set();
 for(const actor of [...s.units,...s.enemies,...(s.summons||[])]){
 if(!Number.isInteger(actor.uid)||ids.has(actor.uid))return 'duplicate or invalid uid';
 if(!Number.isFinite(actor.hp)||!Number.isFinite(actor.x)||!Number.isFinite(actor.y))return 'invalid actor values';
  for(const row of actor.damageRedirects||[])if(row.targetUid==null||!Number.isFinite(row.ratio)||row.ratio<0||row.ratio>1)return 'invalid damage redirect';
  ids.add(actor.uid);
 }
 for(const fx of s.logicEffects||[]){
  if(!EFFECT_KINDS.has(fx.kind))return 'unknown effect kind '+fx.kind;
  if(fx.endsAt!=null&&!Number.isFinite(fx.endsAt))return 'invalid effect time';
  if(fx.nextAt!=null&&!Number.isFinite(fx.nextAt))return 'invalid effect nextAt';
  if(fx.interval!=null&&(!Number.isFinite(fx.interval)||fx.interval<=0))return 'invalid effect interval';
  if(fx.refKind==='live'&&fx.sourceUid!=null&&!getActor(s,fx.sourceUid)&&!fx.persistAfterSourceGone)return 'missing live source';
  if(fx.refKind==='anchor'&&fx.anchorUid!=null&&!getActor(s,fx.anchorUid)&&fx.onAnchorGone!=='keep'&&fx.onAnchorGone!=='drop'){
   /* ownership/persist refs may omit a live source; missing anchors are dropped at tick */
  }
 }
 return null;
}

export function getActor(s,uid){
 if(uid==null)return null;
 return (s.units||[]).find(u=>u.uid===uid)||(s.summons||[]).find(u=>u.uid===uid)||(s.enemies||[]).find(e=>e.uid===uid)||null;
}
export function operators(s){return s.units||[];}
export function alliedActors(s){return [...(s.units||[]),...(s.summons||[]).filter(x=>x.allied!==false)];}
export function enemyActors(s){return (s.enemies||[]).filter(e=>e.hp>0);}
export function attackableAllies(s){return alliedActors(s).filter(u=>u.deployed&&u.hp>0&&u.targetable!==false);}
export function lifeKey(u){return u.uid+':'+(u.deployGen||0);}
export function chebyshev(a,b){return Math.max(Math.abs((a.x??0)-(b.x??0)),Math.abs((a.y??0)-(b.y??0)));}
export function activeTalentsOf(battle,u){
 const p=battle.profile(u);
 if(p?.activeTalents)return p.activeTalents.map(t=>({...t,values:blackboard(t.blackboard)}));
 return resolveActiveTalents({talents:p?.talents},p?.status,{modulePhase:p?.modulePhase}).map(t=>({...t,values:blackboard(t.blackboard)}));
}
export function operatorSkillConfig(battle,u){return skillConfig(battle.profile(u));}
function skillBB(battle,u){return blackboard(battle.profile(u)?.skill?.blackboard);}
function log(battle,type,payload){
 const rec={t:battle.s.time,type,...payload};
 battle.s.logicLog.push(rec);if(battle.s.logicLog.length>2048)battle.s.logicLog.splice(0,battle.s.logicLog.length-2048);
 return rec;
}
function nextEvent(battle,extra={}){
 const st=battle.s.settle,id=st.nextEventId++;
 const rec={eventId:id,parentEventId:extra.parentEventId??null,attackId:extra.attackId??null,effectId:extra.effectId??null,...extra};
 st.byId[id]=rec;return rec;
}
function ancestorCycle(st,parentEventId,effectId){
 let id=parentEventId,depth=0;const seen=new Set();
 while(id){
  if(seen.has(id)||++depth>ANCESTOR_CAP)return true;
  seen.add(id);
  const rec=st.byId[id];if(!rec)break;
  if(effectId!=null&&rec.effectId===effectId)return true;
  id=rec.parentEventId;
 }
 return false;
}
function consume(battle,effectId,eventId){
 const key=effectId+':'+eventId,st=battle.s.settle;
 if(st.consumed.includes(key)){st.fault={type:'duplicate',effectId,eventId};return false;}
 st.consumed.push(key);return true;
}
export function enqueue(battle,job){
 const st=battle.s.settle;
 if(st.queue.length>=QUEUE_CAP){st.fault={type:'queue',size:st.queue.length};return false;}
 if(job.effectId!=null&&ancestorCycle(st,job.parentEventId,job.effectId)){st.fault={type:'cycle',effectId:job.effectId,parentEventId:job.parentEventId,snapshot:st.queue.slice()};return false;}
 st.nextSeq=(st.nextSeq||0)+1;
 st.queue.push({seq:st.nextSeq,sourceUid:job.sourceUid??null,effectId:job.effectId??null,...job});
 return true;
}
export function drainQueue(battle){
 const st=battle.s.settle;
 if(battle.draining)return;
 battle.draining=true;
 let processed=0;
 try{while(st.queue.length){
  if(++processed>QUEUE_CAP){st.fault={type:'queue-drain',size:st.queue.length};break;}
  const job=st.queue.shift();
  if(job.kind==='damage')dealDamage(battle,job);
  else if(job.kind==='heal')applyHeal(battle,job);
  else if(job.kind==='regen')applyRegen(battle,job);
  else if(job.kind==='loss')applyLoss(battle,job);
  else if(job.kind==='status'){const t=getActor(battle.s,job.targetUid);if(t)applyStatus(t,job.status,job.duration,{source:job.sourceUid});}
 }}finally{battle.draining=false;}
 if(st.fault)throw Error('战斗结算异常：'+JSON.stringify(st.fault));
}

function minHpOf(target){
 if(target.lockHp?.min!=null)return target.lockHp.min;
 return 0;
}
export function commitExit(battle,{target,reason='knockdown',killer=null,event=null}){
 if(!target)return false;
 if(target.kind==='summon'){
  if(target.exitLife===lifeKey(target))return false;
  target.exitLife=lifeKey(target);target.hp=0;target.deployed=false;
  log(battle,'exit',{uid:target.uid,reason,kind:'summon',eventId:event?.eventId});
   if(target.type==='vigil-wolf'&&reason==='knockdown'){target.lives=0;target.blockCnt=0;target.targetable=false;}else{if(target.type==='skadi2-seaborn'){const owner=getActor(battle.s,target.ownerUid);if(owner)owner.summonRespawnAt=battle.s.time+25;}battle.s.summons=battle.s.summons.filter(x=>x.uid!==target.uid);}
  return true;
 }
 const isEnemy=!!battle.s.enemies.find(e=>e.uid===target.uid);
 if(isEnemy){
  if(target.exitLife===lifeKey(target))return false;
  target.exitLife=lifeKey(target);
  if(target.hp>0)target.hp=0;
  if(reason==='leak'){log(battle,'leak-exit',{uid:target.uid,eventId:event?.eventId});return true;}
  battle.s.kills++;
  const credit=killer?.kind==='summon'?getActor(battle.s,killer.ownerUid):killer;
  if(credit&&battle.s.units.includes(credit))battle.event?.(credit,'kill');
  log(battle,'death',{uid:target.uid,reason,killerUid:killer?.uid,x:target.x,y:target.y,eventId:event?.eventId});
  // 死亡类敌方能力（死亡爆炸／死亡区域／解压缩）统一在这里触发，覆盖全部死因
  // （干员击杀、持续伤害区域、额外伤害、生命流失），不再只在干员攻击路径里结算一次。
  if(typeof battle.onEnemyDeath==='function')battle.onEnemyDeath(target,{reason,killer,event});
  dispatch(battle,'enemy-death',{target,killer,reason,event});
  return true;
 }
 if(target.exitLife===lifeKey(target))return false;
 target.exitLife=lifeKey(target);
 if(target.kind!=='summon'&&target.deployed)target.redeployPenalty=Math.min(2,(target.redeployPenalty||0)+1);
 if(target.kind!=='summon'&&reason==='retreat'&&target.refundEligible&&target.deploymentCost>0){const profile=battle.profile(target),hasRefundRatio=target.refundRatio!=null&&Number.isFinite(Number(target.refundRatio)),rate=hasRefundRatio?Number(target.refundRatio):profile.branch==='charger'?1:profile.branch==='merchant'?0:.5,cap=target.refundIgnoresCap?target.deploymentCost:(target.refundCap??target.deploymentCost),refund=Math.floor(Math.min(target.deploymentCost*Math.max(0,rate),cap));if(refund>0)battle.gainCost?.(refund);target.refundEligible=false;}
 target.deployed=false;target.downed=false;target.action=null;target.skillLeft=0;target.ammo=0;
 if(reason==='knockdown'){target.hp=0;battle.event?.(target,'selfdead');}
 if(reason==='forced'||reason==='skill'||reason==='merchant-fee'){target.hp=0;target.down=battle.respawnTime?battle.respawnTime(target):battle.stats(target).respawnTime;target.downMax=target.down;}
 else{
  target.down=battle.respawnTime?battle.respawnTime(target):battle.stats(target).respawnTime;
  if(battle.s.band==='band_emperor')target.down*=.5;
  if(battle.s.band==='band_ermengard'&&(battle.s.revives||0)<3){battle.s.revives=(battle.s.revives||0)+1;target.down=0;}
  if(battle.on?.('indomShip')&&battle.profile(target).position==='MELEE'){const ib=battle.params?.('indomShip')||{};if(battle.economy.random()<(Number(ib.base_prob)||.18)+(Number(ib.prob_per_stack)||.004)*(battle.layers.indomShip||0))target.down=0;}
  target.downMax=target.down;
 }
 battle.emit('down',{uid:target.uid,x:target.x,y:target.y,down:target.down,reason});
 log(battle,'exit',{uid:target.uid,reason,deployGen:target.deployGen,eventId:event?.eventId});
 dispatch(battle,'exit',{target,reason,event});
 if(battle.s.band==='band_qalaisa')for(const v of battle.s.units)if(v.deployed)v.deathBuff=Math.min(2,(v.deathBuff||0)+.2);
 if(battle.s.band==='band_clementia'&&battle.owns?.(target,'egirShip'))battle.economy.addLayers('egirShip',battle.profile(target).rank);
 return true;
}

export function reviveActor(battle,target,{hpRatio=1,stunDuration=0,source=null,reason='revive'}={}){
 if(!target||target.kind==='summon'||target.exitLife===lifeKey(target)&&target.hp>0)return false;
 target.deployed=true;target.downed=false;target.down=0;target.exitLife=null;target.action=null;target.skillLeft=0;target.ammo=0;target.shieldLayers=[];target.shield=0;if(target.blazeDownUsed){target.healable=target.blazeHealable!==false;target.blazeHealable=null;target.blazeRegen=0;target.blazeStun=0;}target.hp=Math.max(1,Math.min(target.maxHp,target.maxHp*Math.max(0,Math.min(1,hpRatio))));battle.event?.(target,'deploy');bondDeploy(battle,target);
 log(battle,'revive',{uid:target.uid,sourceUid:source?.uid,reason,hp:target.hp});battle.emit('revive',{uid:target.uid,x:target.x,y:target.y,reason});dispatch(battle,'revive',{source,target,reason});
 if(stunDuration>0)for(const e of enemyActors(battle.s).filter(e=>chebyshev(e,target)<=1))applyStatus(e,'stun',stunDuration,{source:target.uid,resistible:false});
 return true;
}

function runFatal(battle,target,wouldDie,event){
 if(!wouldDie||target.exitLife===lifeKey(target))return false;
 if(target.type==='vigil-wolf'&&target.lives>1){target.lives--;target.blockCnt=target.lives;target.hp=target.maxHp;return true;}
 const downTalent=target.kind!=='summon'&&activeTalentsOf(battle,target).find(t=>t.name==='绝处重燃'||/被击倒时倒地/.test(t.description||''));
 if(downTalent&&!target.blazeDownUsed){
  const bb=downTalent.values||{};target.blazeDownUsed=true;target.downed=true;target.deployed=true;target.action=null;target.skillLeft=0;target.ammo=0;target.blazeHealable=target.healable!==false;target.healable=false;target.blazeRegen=Number(bb.hp_recovery_per_sec_by_max_hp_ratio)||.03;target.blazeStun=Number(bb.stun)||5;target.hp=1;grantShield(battle,target,{id:'blaze-down-'+target.uid,amount:Number(bb.dynamic)||6000,sourceUid:target.uid});log(battle,'fatal-down',{uid:target.uid,eventId:event.eventId});return true;
 }
 if(target.id==='char_4039_horn'&&!target.revivedThisLife){
  const t=activeTalentsOf(battle,target).find(x=>x.name==='血战');if(!t)return false;
  const bb=t.values;target.revivedThisLife=true;
  target.hornBuff={maxHpMul:1-(bb.max_hp??.5),attackSpeed:bb.attack_speed||0,def:bb.def||0};
  const stats=battle.stats(target);target.maxHp=stats.maxHp;target.hp=target.maxHp*(bb.hp_ratio??1);
  log(battle,'fatal-revive',{uid:target.uid,eventId:event.eventId});
  return true;
 }
 if(target.id==='char_1046_sbell2'&&!target.sbellRevived){const t=activeTalentsOf(battle,target).find(x=>x.name==='圣山的祝福');if(t){const bb=t.values||{};target.sbellRevived=true;target.hp=target.maxHp*(Number(bb.hp_ratio)||1);applyStatus(target,'frozen',Number(bb.freeze)||4,{source:target.uid,resistible:false});for(const e of enemyActors(battle.s).filter(e=>battle.inside(target,e,true)))applyStatus(e,'frozen',Number(bb.c2e_freeze)||8,{source:target.uid,resistible:false});log(battle,'fatal-revive',{uid:target.uid,eventId:event.eventId,kind:'sbell2'});return true;}}
 if(target.id==='char_350_surtr'&&!target.surtrLock){
  const t=activeTalentsOf(battle,target).find(x=>x.name==='余烬');if(!t)return false;
  target.lockHp={min:1,endsAt:battle.s.time+(t.values['surtr_t_2[withdraw].interval']??8),onEnd:'forced'};
  target.surtrLock=true;target.hp=Math.max(1,target.hp);
  log(battle,'fatal-lock',{uid:target.uid,eventId:event.eventId,until:target.lockHp.endsAt});
  return true;
 }
 if(target.id==='char_1033_swire2'){
  const t=activeTalentsOf(battle,target).find(x=>x.name==='破财消灾');
  if(t){const base=Math.abs(Number(t.values.cost)||5),times=target.merchantRescueCount||0,cost=base*Math.pow(Number(t.values.cost_multi)||2,times);if(battle.spendCost?.(cost,{considerNegativeCost:true})){target.merchantRescueCount=times+1;target.hp=target.maxHp*(Number(t.values.hp_ratio)||.7);log(battle,'fatal-cost-save',{uid:target.uid,cost,hp:target.hp,eventId:event.eventId});return true;}}
 }
 if(target.kind!=='summon'&&battle.s.units.includes(target)&&battle.on?.('egirShip')&&battle.rows?.egirShip?.count>=5&&battle.owns(target,'egirShip')&&!target.egirRevived&&((battle.s.bondEgirReviveCount||0)<3)){
  target.egirRevived=true;battle.s.bondEgirReviveCount=(battle.s.bondEgirReviveCount||0)+1;target.hp=Math.max(1,target.maxHp);target.deployed=true;target.downed=false;target.exitLife=null;target.down=0;target.action=null;target.skillLeft=0;target.ammo=0;log(battle,'bond-revive',{uid:target.uid,bond:'egirShip',count:battle.s.bondEgirReviveCount,eventId:event.eventId});return true;
 }
 if(typeof battle.fatalHook==='function')return battle.fatalHook(target,event);
 return false;
}

export function dealDamage(battle,opts){
 const source=opts.source||getActor(battle.s,opts.sourceUid);
 const target=opts.target||getActor(battle.s,opts.targetUid);
 if(!target||target.hp<=0||target.hidden||target.invulnerable)return null;
 const event=nextEvent(battle,{cause:opts.cause||'attack',attackId:opts.attackId??null,parentEventId:opts.parentEventId??null,effectId:opts.effectId??null,type:'damage'});
 const triggerId=opts.consumeEventId??opts.parentEventId;
 if(opts.effectId!=null&&triggerId!=null&&!consume(battle,opts.effectId,triggerId))return null;
 let value=opts.value;
 if(!Number.isFinite(value)){
  const stats=battle.s.units.includes(target)?battle.stats(target):target;
  const amount=opts.amount??(source?.atk??0);
  const type=opts.type||'physical';
  value=damage({amount,type,resistance:stats.res??stats.magicResistance??0,defense:stats.def||0});
  if(target.fragile)value*=target.fragile;
 }
 let type=opts.type||'physical';
 if(!Number.isFinite(opts.value)&&target.damageResistance>0)value*=Math.max(0,1-target.damageResistance);
 if(!opts.skipHooks&&opts.cause!=='dot'&&opts.cause!=='extra'&&opts.cause!=='reflect'){
  const before={source,target,value,type,event,cause:opts.cause};dispatch(battle,'before-damage',before);value=before.value;type=before.type;
 }
 const protection=target.damageProtection;
 if(!opts.skipProtection&&protection&&protection.until!=null&&battle.s.time<protection.until){
  const immediateRatio=Math.max(0,Math.min(1,Number(protection.immediateRatio??1)));
  const delayed=Math.max(0,value*(1-immediateRatio));
  if(delayed>0){protection.buffer=(protection.buffer||0)+delayed;log(battle,'damage-delayed',{eventId:event.eventId,targetUid:target.uid,amount:delayed,until:protection.until});}
  value*=immediateRatio;
 }
 if(!opts.skipBondStead&&value>0&&battle.on?.('steadShip')&&battle.rows?.steadShip?.count>=3&&battle.s.units.includes(target)&&!battle.owns(target,'steadShip')){
  const guards=battle.s.units.filter(u=>u.deployed&&u.hp>0&&battle.owns(u,'steadShip'));if(guards.length){const shared=value*.4,own=value-shared,common={source,type,cause:opts.cause,skill:opts.skill,attackId:opts.attackId,skipBondStead:true,skipRedirect:true,skipProtection:true,skipHooks:true};const ownResult=own>0?dealDamage(battle,{...common,target,value:own}):null;const parts=guards.map(receiver=>dealDamage(battle,{...common,target:receiver,value:shared/guards.length}));return {total:(ownResult?.total||0)+parts.reduce((n,r)=>n+(r?.total||0),0),hp:(ownResult?.hp||0)+parts.reduce((n,r)=>n+(r?.hp||0),0),shield:(ownResult?.shield||0)+parts.reduce((n,r)=>n+(r?.shield||0),0),blocked:!!(ownResult?.blocked&&parts.every(r=>r?.blocked)),potentialHpDamage:(ownResult?.potentialHpDamage||0)+parts.reduce((n,r)=>n+(r?.potentialHpDamage||0),0),redirected:true,bond:'stead',event};}
 }
 const reduction=damageReductionFor(battle,target,type,source);if(reduction>0)value*=1-reduction;
 const redirect=!opts.skipRedirect&&value>0?activeRedirect(battle,target,type):null;
 if(redirect){
  const receiver=getActor(battle.s,redirect.targetUid),ratio=Math.max(0,Math.min(1,Number(redirect.ratio??1)));
  if(receiver&&receiver!==target&&receiver.hp>0){
   const shared=value*ratio,own=redirect.mode==='redirect'?0:value-shared;
   const common={source,type,cause:opts.cause,skill:opts.skill,attackId:opts.attackId,parentEventId:event.eventId,skipRedirect:true,skipProtection:true,skipHooks:true};
   const ownResult=own>0?dealDamage(battle,{...common,target,value:own}):null;
   const sharedResult=shared>0?dealDamage(battle,{...common,target:receiver,value:shared}):null;
   log(battle,'damage-redirect',{eventId:event.eventId,sourceUid:source?.uid,targetUid:target.uid,redirectUid:receiver.uid,amount:value,shared,mode:redirect.mode||'share'});
   return {total:(ownResult?.total||0)+(sharedResult?.total||0),hp:(ownResult?.hp||0)+(sharedResult?.hp||0),shield:(ownResult?.shield||0)+(sharedResult?.shield||0),blocked:!!(ownResult?.blocked&&sharedResult?.blocked),potentialHpDamage:(ownResult?.potentialHpDamage||0)+(sharedResult?.potentialHpDamage||0),redirected:true,event};
  }
 }
 const floor=minHpOf(target);
 const result=applyDamage(target,value,{type,sourceId:source?.id,sourceUid:source?.uid,minHp:floor});
 if(result.consumedGuard){
  log(battle,'guardLayerConsumed',{uid:target.uid,guardId:result.consumedGuard.id,eventId:event.eventId,sourceUid:source?.uid});
  dispatch(battle,'guardLayerConsumed',{target,guard:result.consumedGuard,source,event});
 }
 for(const layer of result.depletedLayers||[]){
  log(battle,'barrierDepletedByDamage',{uid:target.uid,layerId:layer.id,eventId:event.eventId});
  dispatch(battle,'barrierDepletedByDamage',{target,layer,source,event});
 }
 result.potentialHpDamage=result.blocked?0:Math.max(0,value-result.shield);
 const wouldDie=target.hp<=0;
 if(wouldDie&&runFatal(battle,target,true,event)){/* still alive */}
 const credit=source?.kind==='summon'?getActor(battle.s,source.ownerUid):source;
 if(credit&&battle.s.units.includes(credit)&&battle.s.enemies.includes(target)){credit.damage=(credit.damage||0)+result.total;battle.s.damage[credit.uid]=(battle.s.damage[credit.uid]||0)+result.total;}
 battle.emit('hit',{uid:target.uid,x:target.x,y:target.y,type,amount:result.total,blocked:!!result.blocked,skill:!!opts.skill});
 if(result.blocked)battle.s.effects.push({x:target.x,y:target.y,text:'抵消',life:.5,type:'block'});
 log(battle,'damage',{eventId:event.eventId,parentEventId:event.parentEventId,attackId:event.attackId,cause:event.cause,sourceUid:source?.uid,targetUid:target.uid,hp:result.hp,shield:result.shield,blocked:!!result.blocked});
 if(target.hp<=0)commitExit(battle,{target,reason:opts.exitReason||'knockdown',killer:source,event});
 if(!opts.skipHooks)dispatch(battle,'after-damage',{source,target,result,type,event,cause:opts.cause||'attack',skill:!!opts.skill,effectId:opts.effectId});
 drainQueue(battle);
 return result;
}

export function applyHeal(battle,opts){
 const source=opts.source||getActor(battle.s,opts.sourceUid);
 const target=opts.target||getActor(battle.s,opts.targetUid);
 const origin=opts.origin||source;
 if(!source||(!opts.persistAfterSourceGone&&(!source.deployed||source.hp<=0))||!battle.canHeal(target,source)||!Number.isFinite(opts.amount)||opts.amount<=0)return 0;
 if(target.healable===false&&!opts.ignoreHealable)return 0;
 const event=nextEvent(battle,{cause:'heal',parentEventId:opts.parentEventId??null,effectId:opts.effectId??null,type:'heal'});
 const attempted=opts.amount*(target.healingReceived??1)*(source.healingMultiplier??1);
 const real=recoverHP(target,attempted);
 source.healing=(source.healing||0)+real;
 const overflow=Math.max(0,attempted-real);
 if(real>0){
  battle.emit('heal',{uid:source.uid,x:origin.x,y:origin.y,targetX:target.x,targetY:target.y,chain:origin!==source,amount:real,type:'healing'});
  battle.s.effects.push({x:target.x,y:target.y,text:'+'+Math.round(real),life:.6,type:'healing'});
 }
 log(battle,'heal',{eventId:event.eventId,sourceUid:source.uid,targetUid:target.uid,amount:real,overflow});
 dispatch(battle,'after-heal',{source,target,amount:real,overflow,event});
 return real;
}
export function applyRegen(battle,opts){
 const source=opts.source||getActor(battle.s,opts.sourceUid);
 const target=opts.target||getActor(battle.s,opts.targetUid);
 if(!target?.deployed||target.hp<=0||!Number.isFinite(opts.amount)||opts.amount<=0)return 0;
 const real=recoverHP(target,opts.amount);
 if(source)source.regeneration=(source.regeneration||0)+real;
 log(battle,'regen',{sourceUid:source?.uid,targetUid:target.uid,amount:real});
 return real;
}
export function applyLoss(battle,opts){
 const target=opts.target||getActor(battle.s,opts.targetUid);
 if(!target||target.hp<=0||!Number.isFinite(opts.amount)||opts.amount<=0)return 0;
 const event=nextEvent(battle,{cause:'loss',parentEventId:opts.parentEventId??null,effectId:opts.effectId??null,type:'loss'});
 const floor=Math.max(minHpOf(target),opts.minHp||0);
 const hp=Math.min(Math.max(0,target.hp-floor),opts.amount);
 target.hp-=hp;
 log(battle,'loss',{eventId:event.eventId,targetUid:target.uid,amount:hp});
 if(target.hp<=0&&!runFatal(battle,target,true,event))commitExit(battle,{target,reason:'knockdown',killer:opts.source||null,event});
 return hp;
}

function elementalState(target){
 const raw=target.elemental;
 if(raw&&typeof raw==='object'){
  const entries=Object.entries(raw).filter(([,value])=>Number(value)>0).sort((a,b)=>Number(b[1])-Number(a[1]));
  const type=target.elementalType&&Number(raw[target.elementalType])>0?target.elementalType:entries[0]?.[0];
  if(type){const value=Number(raw[type]);target.elementalType=type;target.elemental={[type]:value};return {type,value};}
 }
 if(Number(raw)>0){target.elementalType='elemental';target.elemental={elemental:Number(raw)};return {type:'elemental',value:Number(raw)};}
 target.elemental??={};target.elementalType=null;return {type:null,value:0};
}
export function applyElementDamage(battle,{source,target,amount,type='elemental',cause='element',parentEventId=null}={}){
 if(!target||target.hp<=0||!Number.isFinite(amount)||amount<=0||!ELEMENT_TYPES.has(type)||target.elementalImmune)return {added:0,burst:false};
 amount*=1+Math.max(0,Number(target.elementDamageTakenBonus)||0)+Math.max(0,Number(target.yanElementDamageTakenBonus)||0);let resistance=Math.max(0,Math.min(1,Number(target.elementDamageResistance)||0));for(const sourceUnit of battle.s.units.filter(u=>u.deployed&&u.hp>0)){const talents=battle.activeTalentsOf?battle.activeTalentsOf(sourceUnit):(battle.profile(sourceUnit)?.activeTalents||[]);for(const talent of talents){const bb=talentValues(talent),text=talent.description||'';if(!Number.isFinite(Number(bb.ep_damage_resistance))||!/元素损伤.*降低/.test(text))continue;if(!battle.inside(sourceUnit,target))continue;if(target.maxHp>0&&battle.elementInjury?.(target)>target.maxHp*.5)resistance=Math.max(resistance,Number(bb.ep_damage_resistance));}}amount*=1-resistance;
 const state=elementalState(target),limit=target.elementalMax??(target.elementalMax=target.maxHp),sameFrame=state.type&&target.elementalStartedAt===battle.s.time;
 if(state.type&&state.type!==type&&!sameFrame)return {added:0,burst:false,immune:true};
 let before=state.value,added=0,immune=false;
 if(!state.type||sameFrame){
  if(target.elementalBatchAt!==battle.s.time){target.elementalBatchAt=battle.s.time;target.elementalBatch={};}
  const batch=target.elementalBatch;batch[type]=(batch[type]||0)+amount;const winner=Object.entries(batch).sort((a,b)=>b[1]-a[1])[0][0];
  target.elementalStartedAt??=battle.s.time;target.elementalType=winner;immune=winner!==type;target.elemental={[winner]:Math.min(batch[winner],limit)};added=Math.max(0,target.elemental[winner]-before);before=target.elemental[winner];
 }else{
  added=Math.min(amount,Math.max(0,limit-before));target.elemental[type]=before+added;
 }
 if(immune&&added<=0)return {added:0,burst:false,immune:true};
 const event=nextEvent(battle,{cause,parentEventId,type:'element',sourceUid:source?.uid,targetUid:target.uid});log(battle,'element',{eventId:event.eventId,sourceUid:source?.uid,targetUid:target.uid,element:target.elementalType,amount:added,current:target.elemental[target.elementalType]||0,max:limit});
 if(target.id==='char_4148_philae'&&type==='necrosis'){gainSp(target,battle.profile(target).skill,2,battle.spCost(target));if(battle.skillActive?.(target)&&(target.source?.skillIndex??battle.profile(target).skillIndex)===1)target.philaeElementBoost=true;}
 let burst=false;if((target.elemental[target.elementalType]||0)>=limit){const burstType=target.elementalType;target.elemental={};target.elementalType=null;target.elementalStartedAt=null;target.elementalBatch=null;target.elementBurst=(target.elementBurst||0)+1;target.elementBurstUntil=battle.s.time+3;burst=true;dispatch(battle,'element-burst',{source,target,element:burstType,event});}
 return {added,burst,immune};
}

function activeRedirect(battle,target,type){
 const now=battle.s.time;
 target.damageRedirects??=[];
 target.damageRedirects=target.damageRedirects.filter(row=>row.endsAt==null||row.endsAt>now);
 return target.damageRedirects.find(row=>!row.types||row.types.includes(type)||row.types.includes('all'));
}

export function addDamageRedirect(battle,target,spec={}){
 if(!target||spec.targetUid==null||target.uid===spec.targetUid)return null;
 target.damageRedirects??=[];
 const row={id:spec.id||('redirect-'+battle.s.settle.nextEffectId++),targetUid:spec.targetUid,ratio:Math.max(0,Math.min(1,Number(spec.ratio??1))),mode:spec.mode==='redirect'?'redirect':'share',types:spec.types||null,endsAt:spec.endsAt??null,sourceUid:spec.sourceUid??null};
 target.damageRedirects=target.damageRedirects.filter(x=>x.id!==row.id);target.damageRedirects.push(row);log(battle,'damage-redirect-add',{uid:target.uid,redirectUid:row.targetUid,id:row.id,ratio:row.ratio,mode:row.mode,endsAt:row.endsAt});return row;
}

export function queueDelayedDamage(battle,spec={}){
 if(!Number.isFinite(Number(spec.amount))||Number(spec.amount)<=0)return null;
 const delay=Math.max(0,Number(spec.delay??0));
 return addEffect(battle,{kind:'delayed',sourceUid:spec.source?.uid??spec.sourceUid??null,sourceDeployGen:spec.source?.deployGen,talentOrSkillId:spec.talentOrSkillId||'delayed-damage',stackRule:'stack',targetUid:spec.target?.uid??spec.targetUid,interval:null,nextAt:battle.s.time+delay,endsAt:battle.s.time+delay,values:{amount:spec.amount,type:spec.type||'physical'},snapshot:{damage:spec.amount},refKind:spec.refKind||'owner',persistAfterSourceGone:!!spec.persistAfterSourceGone,parentEventId:spec.parentEventId??null});
}

export function addEffect(battle,fx){
 const id=battle.s.settle.nextEffectId++;
 const row={id,startedAt:battle.s.time,stacks:1,stackRule:'refresh',refKind:'owner',...fx};
 if(row.stackRule==='refresh'||row.stackRule==='maxSame'){
  const same=battle.s.logicEffects.find(e=>e.kind===row.kind&&e.talentOrSkillId===row.talentOrSkillId&&e.targetUid===row.targetUid&&(row.sharedStack||e.sourceUid===row.sourceUid));
  if(same){
   if(row.stackRule==='maxSame'){same.endsAt=Math.max(same.endsAt??0,row.endsAt??0);same.values=row.values;return same;}
   same.endsAt=row.endsAt;same.values=row.values;same.snapshot=row.snapshot;return same;
  }
 }
 battle.s.logicEffects.push(row);return row;
}
function aliveSource(battle,fx){const u=getActor(battle.s,fx.sourceUid);return fx.sourceUid==null||!!(u?.deployed&&u.hp>0&&(fx.sourceDeployGen==null||u.deployGen===fx.sourceDeployGen))||fx.persistAfterSourceGone;}
function dropEffect(battle,fx,reason){
 battle.s.logicEffects=battle.s.logicEffects.filter(e=>e!==fx);
 log(battle,'effect-end',{id:fx.id,kind:fx.kind,reason});
}

export function tickLogic(battle,dt){
 const now=battle.s.time;
 for(const u of [...battle.s.units,...(battle.s.summons||[])]){
  if(u.bondFragileUntil!=null&&now>=u.bondFragileUntil){u.bondFragileUntil=null;u.fragile=null;}
  if(u.elementDamageTakenUntil!=null&&now>=u.elementDamageTakenUntil){u.elementDamageTakenUntil=null;u.elementDamageTakenBonus=0;}
  u.barriers=(u.barriers||[]).filter(g=>{if(g.endsAt!=null&&now>=g.endsAt){log(battle,'expired',{uid:u.uid,guardId:g.id});return false;}return g.charges>0;});
  if(u.lockHp?.endsAt!=null&&now>=u.lockHp.endsAt){
   const end=u.lockHp.onEnd;u.lockHp=null;
   if(end==='forced'&&u.hp>0)commitExit(battle,{target:u,reason:'forced'});
  }
  for(const layer of u.shieldLayers||[]){
   if(layer.decayPerSec)layer.remaining=Math.max(0,layer.remaining-layer.decayPerSec*dt);
   if(layer.endsAt!=null&&now>=layer.endsAt){layer.remaining=0;log(battle,'expired',{uid:u.uid,layerId:layer.id});}
  }
  if(u.shieldLayers){u.shieldLayers=u.shieldLayers.filter(l=>l.remaining>1e-9);u.shield=u.shieldLayers.reduce((n,l)=>n+l.remaining,0);}
  if(u.damageRedirects)u.damageRedirects=u.damageRedirects.filter(row=>row.endsAt==null||row.endsAt>now);
 }
 for(const e of battle.s.enemies||[]){if(e.damageRedirects)e.damageRedirects=e.damageRedirects.filter(row=>row.endsAt==null||row.endsAt>now);if(e.bondFragileUntil!=null&&now>=e.bondFragileUntil){e.bondFragileUntil=null;e.fragile=null;}if(e.elementDamageTakenUntil!=null&&now>=e.elementDamageTakenUntil){e.elementDamageTakenUntil=null;e.elementDamageTakenBonus=0;}}
 for(const fx of battle.s.logicEffects.slice()){
  if(fx.refKind==='live'&&!aliveSource(battle,fx)&&!fx.persistAfterSourceGone){dropEffect(battle,fx,'source');continue;}
  if(fx.refKind==='anchor'&&fx.anchorUid!=null&&!getActor(battle.s,fx.anchorUid)){dropEffect(battle,fx,'anchor');continue;}
  if(fx.anchorUid){const a=getActor(battle.s,fx.anchorUid);if(a){fx.x=a.x;fx.y=a.y;}}
 }
 let scheduled=0;
 while(true){
  const due=battle.s.logicEffects.filter(f=>f.nextAt!=null&&f.nextAt<=now+1e-9&&(f.endsAt==null||f.nextAt<=f.endsAt+1e-9)).sort((a,b)=>a.nextAt-b.nextAt||a.id-b.id)[0];
  if(!due)break;if(++scheduled>10000)throw Error('周期效果队列超限');
  const at=due.nextAt;due.nextAt=due.interval>0?at+due.interval:null;
  battle.s.time=at;try{settlePeriodic(battle,due);}finally{battle.s.time=now;}
 }
 for(const fx of battle.s.logicEffects.slice())if(fx.endsAt!=null&&now>=fx.endsAt)dropEffect(battle,fx,'expired');
 updateAreas(battle);
 tickAuras(battle);
 for(const u of battle.s.units){periodicMods(battle,u,ctxFor(battle));bondPeriodic(battle,u);}
 tickSummons(battle,dt);
 tickWhitwEyes(battle,dt);
 syncReveals(battle);
}

// 反隐（隐匿免疫）：让目标身上的隐匿暂时失效，但不清除携带隐匿的 Buff；来源消失后自动恢复。
// 用「时间窗」而不是永久置位——原实现直接 e.revealed=true，敌人走出反隐范围也永远不会撤销。
export function revealEnemy(battle,target,hold=.3){
 if(!battle||!target)return;
 target.revealUntil=Math.max(Number(target.revealUntil)||0,battle.s.time+Math.max(.05,Number(hold)||.3));
}
// 伊内丝【影哨】：撤退后原地留下一个影哨，令「攻击范围内隐匿失效 + 移速-30%」继续生效，最多 1 个。
function placeInesSentry(battle,u){
 const geo=battle.rangeGeometry?.(u),cells=geo?.cells||[];
 const radius=Math.max(1,cells.reduce((m,g)=>Math.max(m,Math.abs(g.col),Math.abs(g.row)),0));
 const kept=(battle.s.revealSentries||[]).filter(s=>s.fromUid!==u.uid);
 battle.s.revealSentries=[...kept,{fromUid:u.uid,x:u.x,y:u.y,radius}].slice(-1);
}
function syncReveals(battle){
 const now=battle.s.time,enemies=battle.s.enemies||[];
 for(const sentry of battle.s.revealSentries||[]){
  if(sentry.endsAt!=null&&now>sentry.endsAt)continue;
  for(const e of enemies)if(e.hp>0&&!e.hidden&&Math.max(Math.abs(e.x-sentry.x),Math.abs(e.y-sentry.y))<=sentry.radius){
   revealEnemy(battle,e,.3);
   applyStatus(e,'sluggish',1,{source:sentry.fromUid,resistible:false});
  }
 }
 for(const e of enemies){
  if(Number(e.revealUntil)>now)e.revealed=true;
  else{e.revealed=false;e.revealUntil=null;}
 }
}

function ctxFor(battle){return {dealDamage,applyHeal,applyRegen,applyLoss,applyElementDamage,grantShield,addDamageRedirect,queueDelayedDamage,reviveActor,gainSp,addEffect,moveActor,teleportActor,canRelocateTo,projectSpot,nearbySpots,spawnSummon,spawnWhitwEyes,tickWhitwEyes,revealEnemy:(b,t,h)=>revealEnemy(b,t,h),log:(b,t,p)=>log(b,t,p)};}

function bondUnits(battle,id,{deployedOnly=false}={}){return battle.s.units.filter(u=>(!deployedOnly||u.deployed&&u.hp>0)&&battle.owns?.(u,id));}
function yanUnits(battle){return battle.s.units.filter(u=>battle.economy.ownBonds(u.source).includes('yanShip'));}
function bondParam(battle,id){return battle.params?.(id)||blackboard(battle.data.season.effectBuffInfoDataDict[battle.data.season.bondInfoDict[id]?.effectId]?.find(e=>e.key==='env_gbuff_new')?.blackboard);}
function yanThreat(e){return Number.isFinite(Number(e.threat))?Number(e.threat):Number.isFinite(Number(e.yanThreat))?Number(e.yanThreat):Number.isFinite(Number(e.progress))?-Number(e.progress):0;}
function yanCompare(a,b){return yanThreat(b)-yanThreat(a)||(b.leak||0)-(a.leak||0)||a.uid-b.uid;}
function yanTargets(battle,guardian,count=3){return enemyActors(battle.s).filter(e=>!e.hidden&&!e.untargetable).sort(yanCompare).slice(0,count);}
function yanTarget(battle,guardian){const target=yanTargets(battle,guardian,1)[0];if(target)return target;const cols=Math.max(1,battle.map?.cols||1),rows=Math.max(1,battle.map?.rows||1);guardian.yanAim={x:Math.floor(battle.economy.random()*cols),y:Math.floor(battle.economy.random()*rows)};return null;}
// 自由飞行用的连续坐标边界（不吸附到格心）与漫游目标点
function flightBounds(battle){const cols=Math.max(1,battle.map?.cols||1),rows=Math.max(1,battle.map?.rows||1);return {left:0,right:cols-1,top:0,bottom:rows-1};}
function yanWanderPoint(battle){const cols=Math.max(1,battle.map?.cols||1),rows=Math.max(1,battle.map?.rows||1);return {x:battle.economy.random()*cols,y:battle.economy.random()*rows};}
function yanDamage(battle,guardian,target,scale,cause='attack'){
 if(!target||target.hp<=0)return;
 // 只为表现层补一条弹道事件：炎佑走的是自己的攻击循环，不会发通用的 attack/strike 事件
 if(cause==='attack')battle.emit('yan-bolt',{uid:guardian.uid,x:guardian.x,y:guardian.y,targetUid:target.uid,targetX:target.x,targetY:target.y});
 dealDamage(battle,{source:guardian,target,amount:guardian.atk*scale,type:'arts',cause,skill:cause==='skill'});
 applyElementDamage(battle,{source:guardian,target,amount:guardian.atk*.2,type:'burn',cause});
}
function startYanSkill(battle,guardian){
 if(guardian.yanSkillUsed||guardian.yanSkillSp<guardian.yanSkillCost||permissions(guardian).silenced)return false;
 const target=yanTarget(battle,guardian);if(!target)return false;
 guardian.yanSkillUsed=true;guardian.yanSkillActive=true;guardian.yanSkillSp=0;guardian.yanSkillLeft=20;guardian.yanSkillTargetUid=target.uid;guardian.yanSkillNextAt=battle.s.time;
 battle.emit('skill-start',{uid:guardian.uid,kind:'duration',name:'祛恶之焰',x:guardian.x,y:guardian.y});return true;
}
function endYanSkill(battle,guardian,reason='complete'){
 if(!guardian.yanSkillActive)return;
 guardian.yanSkillActive=false;guardian.yanSkillLeft=0;guardian.yanSkillTargetUid=null;guardian.yanSkillNextAt=0;
 battle.emit('skill-end',{uid:guardian.uid,kind:'duration',name:'祛恶之焰',reason,x:guardian.x,y:guardian.y});
}
function tickYanSkill(battle,guardian,dt){
 if(!guardian.yanSkillActive)return false;
 if(permissions(guardian).silenced){endYanSkill(battle,guardian,'silence');return true;}
 guardian.yanSkillLeft=Math.max(0,guardian.yanSkillLeft-dt);
 while(guardian.yanSkillLeft>0&&battle.s.time+1e-9>=guardian.yanSkillNextAt){
  let target=getActor(battle.s,guardian.yanSkillTargetUid);if(!target||target.hp<=0||target.hidden||target.untargetable)target=yanTarget(battle,guardian);
  if(target){const victims=enemyActors(battle.s).filter(e=>!e.hidden&&!e.untargetable&&Math.hypot(e.x-target.x,e.y-target.y)<=1);for(const e of victims)yanDamage(battle,guardian,e,.6,'skill');}
  guardian.yanSkillNextAt+=1;
 }
 if(guardian.yanSkillLeft<=0)endYanSkill(battle,guardian,'complete');
 return true;
}
// 把一条卫戍特质发给目标。去重有两层：extra 数组内不重复，以及目标**本身**已经持有同一条时不再叠加
// （耀骑士临光那类「使自身和身前一格获得特质」的规则里，特质本体已经挂在她自己的 garrisons 上）。
// 召唤物不是干员，不接特质。
function addExtraGarrison(battle,target,id){
 if(!battle||!target||!id||target.kind==='summon'||target.hp<=0)return false;
 const own=(battle.data.profiles[target.chessId]?.garrisons||[]).some(g=>g?.id===id);
 if(own)return false;
 target.extraGarrisonIds??=[];
 if(target.extraGarrisonIds.includes(id))return false;
 target.extraGarrisonIds.push(id);return true;
}
// 「战斗开始时把特质送给别人」：目标由 battleRuneKey 决定（front / most_right / all），
// 是否限定盟约由 blackboard.check_bond_id 决定（不符合就不发，见 GARRISON_EFFECT_AUDIT.md 口径 5）；
// 「使自身和身前一格」这种把自己也写进描述的，才额外包含 owner。
function applyGarrisonTransfers(battle){
 const dirs=[[1,0],[0,1],[-1,0],[0,-1]];
 const alive=v=>(v.deployed||v.source?.position)&&v.hp>0;
 // 转发的特质只在**本波**有效：每波开战前先清掉上一波的授予（身前一格换人后不该残留）。
 for(const u of battle.s.units)u.extraGarrisonIds=[];
 for(const owner of battle.s.units){
  for(const g of battle.profile(owner).garrisons||[]){
   const bb=blackboard(g.blackboard),give=bb.give_garrison_id,bond=bb.check_bond_id;
   if(!give||!g.battleRuneKey)continue;
   const desc=String(g.description||g.garrisonDesc||'').replace(/<[^>]+>/g,'');
   const ok=v=>alive(v)&&(!bond||battle.owns(v,bond));
   let targets=[];
   if(g.battleRuneKey==='give_garrison_to_front'){
    const d=dirs[owner.dir||0],front=battle.s.units.find(v=>v!==owner&&alive(v)&&v.x===owner.x+d[0]&&v.y===owner.y+d[1]);
    if(desc.includes('自身'))targets.push(owner);
    if(front)targets.push(front);
   }else if(g.battleRuneKey==='give_garrison_to_most_right'){
    targets=battle.s.units.filter(v=>v!==owner&&alive(v)&&v.y===owner.y).sort((a,b)=>b.x-a.x||a.uid-b.uid).slice(0,1);
   }else if(g.battleRuneKey==='give_garrison_to_all'){
    targets=battle.s.units.filter(v=>v!==owner);
   }else continue;
   for(const target of [...new Set(targets)].filter(ok))addExtraGarrison(battle,target,give);
  }
 }
}
function bondBattleStart(battle){
 if(battle.s.bondApplied)return;battle.s.bondApplied=true;
 applyGarrisonTransfers(battle);
 const yan=yanUnits(battle);
 if(battle.on?.('yanShip')&&battle.rows?.yanShip?.count>=6&&yan.length){const b=bondParam(battle,'yanShip'),atk=yan.reduce((n,u)=>n+battle.stats(u).atk,0)*.3*(battle.rows.yanShip.count>=9?(Number(b.atk)||1.5):1),hp=yan.reduce((n,u)=>n+battle.stats(u).maxHp,0)*.3*(battle.rows.yanShip.count>=9?(Number(b.atk)||1.5):1),owner=yan[0];for(let i=0;i<(battle.rows.yanShip.count>=9?2:1);i++){const g=spawnSummon(battle,owner,{type:'yan-guardian',name:'炎佑',synthetic:true,canAttack:false,canBlock:false,occupiesTile:false,targetable:true,healable:false,isolated:true,flying:true,elementalImmune:true});if(g){g.atk=atk;g.maxHp=g.hp=Math.max(1,hp);g.interval=2.5;g.attackSpeed=100;g.range=2;g.yanRange=2;g.moveSpeed=1;g.motion='FLY';g.yanTargets=3;g.yanBurnScale=.2;g.yanVulnerability=.2;g.yanSkillSp=15;g.yanSkillCost=15;g.yanSkillUsed=false;g.yanSkillNextAt=0;g.yanSkillActive=false;g.yanSkillLeft=0;g.yanSkillTargetUid=null;g.damageResistance=Number(b.damage_resistance)||.9;}}battle.s.bondYanGuardiansSpawned=true;}
 const kj=bondUnits(battle,'kjeragShip');if(battle.on?.('kjeragShip')&&battle.rows?.kjeragShip?.count>=6&&kj.length){const b=bondParam(battle,'kjeragShip'),duration=Number(b['bond_eff_kjerag[storm].base_time'])||20;addEffect(battle,{kind:'zone',sourceUid:kj[0].uid,talentOrSkillId:'bond-kjerag-storm',x:kj[0].x,y:kj[0].y,radius:99,interval:Number(b['bond_eff_kjerag[storm].interval'])||25,nextAt:battle.s.time+(Number(b['bond_eff_kjerag[storm].interval'])||25),endsAt:null,trackSide:'enemy',values:{cold:duration+Number(b['bond_eff_kjerag[storm].time_per_stack']||0)*(battle.layers.kjeragShip||0)},snapshot:{},refKind:'owner',persistAfterSourceGone:true});}
 const egirs=bondUnits(battle,'egirShip').sort((a,b)=>(a.y??999)-(b.y??999)||(a.x??999)-(b.x??999));if(battle.on?.('egirShip')&&egirs.length){const b=bondParam(battle,'egirShip'),dirs=[[1,0],[0,1],[-1,0],[0,-1]];for(const u of egirs){const d=dirs[u.dir||0],front=battle.s.units.find(v=>v!==u&&v.x===u.x+d[0]&&v.y===u.y+d[1]);if(!front)continue;const fp=battle.profile(front),fa=fp?.attributes||{};u.egirBorrowAtk=Number(fa.atk)||0;u.egirBorrowBlock=Number(fa.blockCnt)||0;u.egirConsumedUid=front.uid;dealDamage(battle,{source:front,target:u,amount:Number(b.damage_value)||5000,type:'physical',cause:'bond',skipHooks:true});battle.economy.addLayers('egirShip',Number(front.source?.rank||1));}}
}
function bondDeploy(battle,u){
 if(!u||u.kind==='summon')return;
 if(battle.on?.('siracusaShip')&&battle.rows?.siracusaShip?.count>=6&&battle.owns(u,'siracusaShip')){const b=bondParam(battle,'siracusaShip'),duration=(Number(b.base_duration)||32)+(Number(b.duration_per_stack)||.4)*(battle.layers.siracusaShip||0);u.siracusaInvisibleUntil=battle.s.time+duration;u.siracusaExposureUntil=u.siracusaInvisibleUntil+(Number(b.end_duration)||10);applyStatus(u,'invisible',duration,{source:u.uid,resistible:false});}
 if(battle.on?.('kazimierzShip'))for(const v of battle.s.units)if(battle.owns(v,'kazimierzShip'))v.deploymentBuff=Math.min(.5+.01*(battle.layers.kazimierzShip||0),(v.deploymentBuff||0)+.2);
}
function bondSkillStart(battle,u){
 if(!u||u.kind==='summon'||!battle.on?.('sargonShip')||!battle.owns(u,'sargonShip'))return;const b=bondParam(battle,'sargonShip'),duration=battle.s.band==='band_narant'?(Number(b.base_power_time)||60)+(Number(b.power_time_per_stack)||0)*(battle.layers.sargonShip||0):(Number(b.base_time)||5)+(Number(b.time_per_stack)||.22)*(battle.layers.sargonShip||0);for(const target of bondUnits(battle,'sargonShip',{deployedOnly:true})){target.sargonBuffs??=[];target.sargonBuffs.push({endsAt:battle.s.time+duration});const max=Number(b.max_buff_stack_cnt)||25;if(target.sargonBuffs.length>max)target.sargonBuffs.splice(0,target.sargonBuffs.length-max);}}
function bondSkillEnd(battle,u){
 if(!u||u.kind==='summon'||u.bondSwiftLastEnd===u.skillCount)return;u.bondSwiftLastEnd=u.skillCount;if(battle.on?.('swiftShip')&&battle.owns(u,'swiftShip')){const b=bondParam(battle,'swiftShip'),prob=Math.min(1,(Number(b.base_prob)||.2)+(Number(b.prob_per_stack)||.0035)*(battle.layers.swiftShip||0));if(battle.economy.random()<prob)gainSp(u,battle.profile(u).skill,Number(b.normal_sp)||12,battle.spCost(u));if((battle.layers.swiftShip||0)>=Number(b.power_bond_stack_cnt||40)&&battle.economy.random()<prob)for(const target of battle.s.units.filter(v=>v.deployed&&v.hp>0))gainSp(target,battle.profile(target).skill,Number(b.power_sp)||15,battle.spCost(target));}}
function bondAmmo(battle,payload){if(!payload?.source||!battle.on?.('lateranoShip')||battle.rows?.lateranoShip?.count<6)return;const used=Math.max(0,Number(payload.used)||0),b=bondParam(battle,'lateranoShip'),cap=Math.ceil((Number(b.max_atk_for_consume)||2)/Math.max(.0001,Number(b.atk_per_consume)||.04));battle.s.bondLateranoAmmoStacks=Math.min(cap,(battle.s.bondLateranoAmmoStacks||0)+used);}
function bondExit(battle,u,reason){if(!u||u.kind==='summon'||reason!=='knockdown'||!battle.on?.('indomShip')||battle.rows?.indomShip?.count<3)return;const b=bondParam(battle,'indomShip');for(const target of battle.s.units.filter(v=>v.deployed&&v.hp>0))gainSp(target,battle.profile(target).skill,Number(b.sp)||5,battle.spCost(target));}
function bondAfterDamage(battle,payload){
 const {source,target,result,cause}=payload;if(!source||!target||!result||result.total<=0||cause==='extra'||cause==='reflect')return;
 if(battle.on?.('steadShip')&&battle.rows?.steadShip?.count>=3&&battle.s.units.includes(target)&&battle.owns(target,'steadShip')){const b=bondParam(battle,'steadShip');if((target.steadRetaliateAt||-Infinity)<=battle.s.time){target.steadRetaliateAt=battle.s.time+(Number(b['cd_duration'])||.2);if(source.hp>0)dealDamage(battle,{source:target,target:source,amount:Number(b.base_damage_value||850)+Number(b.damage_value_per_stack||10)*(battle.layers.steadShip||0),type:'arts',cause:'extra',skipHooks:true});source.fragile=Math.max(source.fragile||1,Number(b.damage_scale)||1.4);source.bondFragileUntil=battle.s.time+5;applyStatus(source,'fragile',5,{source:target.uid,value:Number(b.damage_scale)||1.4,resistible:false});}}
}
function bondPeriodic(battle,u){
 if(!u||u.kind==='summon'||!battle.on?.('kazimierzShip')||battle.rows?.kazimierzShip?.count<6||!battle.owns(u,'kazimierzShip')||!u.deployed||u.hp<=0)return;const b=bondParam(battle,'kazimierzShip'),interval=Math.max(.1,Number(b.damage_interval)||2);u.kazimierzNextAt??=battle.s.time+interval;while(battle.s.time+1e-9>=u.kazimierzNextAt){const blocked=battle.s.enemies.filter(e=>e.hp>0&&e.block===u.uid);if(blocked.length)for(const e of battle.s.enemies.filter(e=>e.hp>0&&!e.hidden&&Math.hypot(e.x-u.x,e.y-u.y)<=Number(b.range_radius||.8))) {dealDamage(battle,{source:u,target:e,amount:battle.stats(u).atk*(Number(b.damage_atk_scale)||1.2),type:'true',cause:'extra',skipHooks:true});applyStatus(e,'stun',Number(b.stun)||.1,{source:u.uid,resistible:false});}u.kazimierzNextAt+=interval;}}

function zoneActors(battle,fx,side){
 const cx=fx.x,cy=fx.y,r=fx.radius??1;
 const pool=side==='enemy'?enemyActors(battle.s):side==='all'?[...enemyActors(battle.s),...alliedActors(battle.s).filter(u=>u.deployed&&u.hp>0)]:alliedActors(battle.s).filter(u=>u.deployed&&u.hp>0);
 return pool.filter(a=>chebyshev({x:cx,y:cy},a)<=r);
}
function settlePeriodic(battle,fx){
 const source=getActor(battle.s,fx.sourceUid);
 if(fx.kind==='delayed'){
  const t=getActor(battle.s,fx.targetUid);if(t&&t.hp>0)dealDamage(battle,{source,target:t,amount:fx.snapshot?.damage??fx.values?.amount??0,type:fx.values?.type||'physical',cause:'delayed',effectId:fx.id,parentEventId:fx.parentEventId});
 }else if(fx.kind==='dot'){
  const t=getActor(battle.s,fx.targetUid);if(!t||t.hp<=0)return;
  const amount=fx.snapshot?.damage??fx.values?.damage??0;
  dealDamage(battle,{source,target:t,amount,type:fx.values?.type||'arts',cause:'dot',effectId:fx.id,parentEventId:null});
 }else if(fx.kind==='hot'){
  const t=getActor(battle.s,fx.targetUid);if(!t)return;
  applyHeal(battle,{source,target:t,amount:fx.snapshot?.heal??fx.values?.heal??0,effectId:fx.id,persistAfterSourceGone:fx.persistAfterSourceGone});
  if(fx.values?.elementRegen&&source)battle.healElements?.(source,t,fx.values.elementRegen);
 }else if(fx.kind==='regen'){
  const targets=fx.targetUid?[getActor(battle.s,fx.targetUid)]:alliedActors(battle.s).filter(u=>u.deployed&&u.hp>0);
  const amount=fx.snapshot?.regen??fx.values?.regen??0;
  for(const t of targets)if(t)applyRegen(battle,{source,target:t,amount});
 }else if(fx.kind==='loss'){
  const t=getActor(battle.s,fx.targetUid);if(t)applyLoss(battle,{target:t,amount:fx.values?.amount||0,source,effectId:fx.id});
 }else if(fx.kind==='zone'){
  if(fx.values?.dot)for(const e of zoneActors(battle,fx,fx.trackSide||'enemy'))if(!fx.values.requiresStatus||(e.statuses||[]).some(s=>s.kind===fx.values.requiresStatus)){dealDamage(battle,{source,target:e,amount:fx.snapshot?.damage??(source?battle.stats(source).atk:0)*(fx.values.atk_scale||1),type:fx.values?.type||'arts',cause:'dot',effectId:fx.id});if(fx.values.elementScale&&source)applyElementDamage(battle,{source,target:e,amount:battle.stats(source).atk*fx.values.elementScale,type:fx.values.elementType||'burn',cause:'dot',parentEventId:null});}
  if(fx.values?.elementScale&&!fx.values?.dot&&source)for(const e of zoneActors(battle,fx,'enemy'))applyElementDamage(battle,{source,target:e,amount:battle.stats(source).atk*fx.values.elementScale,type:fx.values.elementType||'burn',cause:'dot'});
  if(fx.values?.sluggish)for(const e of zoneActors(battle,fx,'enemy'))applyStatus(e,'sluggish',fx.interval||1,{source:source?.uid,resistible:false});
  if(fx.values?.cold)for(const e of zoneActors(battle,fx,'enemy'))applyStatus(e,'cold',fx.values.cold,{source:source?.uid,resistible:false});
  // Presentation marker for the 6-operator Kjerag storm: emitted once per periodic settlement so the
  // renderer can play a timed full-screen effect. It never changes damage, status or timing.
  if(fx.talentOrSkillId==='bond-kjerag-storm')battle.emit('ice-wind',{uid:fx.sourceUid,effectId:fx.id});
  if(fx.values?.attackDown)for(const e of zoneActors(battle,fx,'enemy'))applyStatus(e,'attackDown',fx.interval||1,{source:source?.uid,value:fx.values.attackDown,resistible:false});
  if(fx.values?.defDown)for(const e of zoneActors(battle,fx,'enemy'))applyStatus(e,'defDown',fx.interval||1,{source:source?.uid,value:fx.values.defDown,resistible:false});
  if(fx.values?.resDown)for(const e of zoneActors(battle,fx,'enemy'))applyStatus(e,'resDown',fx.interval||1,{source:source?.uid,value:fx.values.resDown,resistible:false});
  if(fx.values?.stun)for(const e of zoneActors(battle,fx,'enemy'))applyStatus(e,'stun',fx.values.stun,{source:source?.uid,resistible:false});
  if(fx.values?.pull&&source)for(const e of zoneActors(battle,fx,'enemy'))moveActor(battle,e,{x:fx.x,y:fx.y,uid:source.uid},'拖拽');
  if(fx.values?.fragile)for(const e of zoneActors(battle,fx,'enemy'))e.fragile=Math.max(e.fragile||1,Number(fx.values.fragile));
  if(fx.values?.silence)for(const e of zoneActors(battle,fx,'enemy'))applyStatus(e,'silence',fx.interval||1,{source:source?.uid,resistible:false});
  if(fx.values?.reveal)for(const e of zoneActors(battle,fx,'enemy'))revealEnemy(battle,e,(fx.interval||1)+.2);
  if(fx.values?.hot)for(const a of zoneActors(battle,fx,'ally'))applyHeal(battle,{source,target:a,amount:fx.values.hot,effectId:fx.id});
  if(fx.values?.elementRegen&&source)for(const a of zoneActors(battle,fx,'ally'))battle.healElements?.(source,a,fx.values.elementRegen);
  if(fx.values?.defBuff)for(const a of zoneActors(battle,fx,'ally')){a.thornDefBuff=Number(fx.values.defBuff);a.thornDefBuffUntil=battle.s.time+1.1;}
  if(fx.values?.regen)for(const a of zoneActors(battle,fx,'ally'))applyRegen(battle,{source,target:a,amount:fx.values.regen});
 }else if(fx.kind==='attached'){
  const anchor=getActor(battle.s,fx.anchorUid);if(!anchor?.deployed||anchor.hp<=0)return;
  const enemy=enemyActors(battle.s).filter(e=>!e.hidden&&!e.flying&&Math.hypot(e.x-anchor.x,e.y-anchor.y)<=(fx.radius??1)).sort((a,b)=>chebyshev(anchor,a)-chebyshev(anchor,b)||a.uid-b.uid)[0];
  if(enemy&&source){
   const result=dealDamage(battle,{source,target:enemy,amount:battle.stats(source).atk*(fx.values?.atk_scale||1),type:'arts',cause:'skill',effectId:fx.id,skill:true});
   if(result&&battle.profile(source).branch==='incantationmedic')applyHeal(battle,{source,target:anchor,amount:Math.max(0,result.potentialHpDamage)*(fx.values?.heal_ratio??.5)});
  }
 }else if(fx.kind==='guard'&&source){
  const u=source;u.barriers??=[];
  const n=(u.barriers.filter(b=>b.charges>0).reduce((s,b)=>s+b.charges,0));
  if(n<(fx.values?.max_times||3))u.barriers.push({id:'mudrok-'+fx.id+'-'+battle.s.time,charges:fx.values?.times||1,types:null,sourceUid:u.uid,listen:'guardLayerConsumed'});
 }
}

function updateAreas(battle){
 const now=battle.s.time;
 for(const fx of battle.s.logicEffects||[]){
  if(fx.kind!=='zone'||!fx.trackArea)continue;
 const side=fx.trackSide||'enemy',actors=side==='all'?([...enemyActors(battle.s),...attackableAllies(battle.s)]):zoneActors(battle,fx,side);
  const source=getActor(battle.s,fx.sourceUid);
  const current=new Set(actors.filter(a=>a.hp>0&&a.deployed!==false&&chebyshev({x:fx.x,y:fx.y},a)<=((fx.radius??1))).map(a=>a.uid));
  const previous=new Set(fx.insideUids||[]);
  for(const uid of current)if(!previous.has(uid)){const actor=getActor(battle.s,uid);const event=nextEvent(battle,{cause:'area-enter',type:'area',effectId:fx.id});log(battle,'area-enter',{eventId:event.eventId,effectId:fx.id,uid,sourceUid:fx.sourceUid,t:now});dispatch(battle,'area-enter',{source,target:actor,event,effect:fx});}
  for(const uid of previous)if(!current.has(uid)){const actor=getActor(battle.s,uid);const event=nextEvent(battle,{cause:'area-exit',type:'area',effectId:fx.id});log(battle,'area-exit',{eventId:event.eventId,effectId:fx.id,uid,sourceUid:fx.sourceUid,t:now});dispatch(battle,'area-exit',{source,target:actor,event,effect:fx});}
  fx.insideUids=[...current];
 }
}

function tickAuras(battle){
 for(const e of enemyActors(battle.s))e.fragile=e.bondFragileUntil>battle.s.time?1.4:null;
 for(const e of enemyActors(battle.s))e.yanElementDamageTakenBonus=0;
 for(const e of enemyActors(battle.s))e.attackSpeedMod=0;
 for(const source of battle.s.units.filter(u=>u.deployed&&u.hp>0&&u.id==='char_1039_thorn2')){const talent=activeTalentsOf(battle,source).find(t=>t.name==='视界'),bb=talent?.values||{};if(talent)for(const e of enemyActors(battle.s))e.attackSpeedMod-=Number(bb.attack_speed_enemy)||5;}
 for(const fx of battle.s.logicEffects||[])if(fx.kind==='zone'&&fx.values?.fragile&&(fx.endsAt==null||battle.s.time<fx.endsAt))for(const e of zoneActors(battle,fx,'enemy'))e.fragile=Math.max(e.fragile||1,Number(fx.values.fragile));
 for(const source of battle.s.summons.filter(s=>s.type==='yan-guardian'&&s.deployed&&s.hp>0))for(const e of enemyActors(battle.s))if(Math.hypot(source.x-e.x,source.y-e.y)<=1.5)e.yanElementDamageTakenBonus=Math.max(e.yanElementDamageTakenBonus||0,source.yanVulnerability||.2);
 for(const u of battle.s.units){
  if(!u.deployed||u.hp<=0)continue;
  const p=battle.profile(u),id=u.id;
  if(id==='char_358_lisa'&&battle.skillActive(u)&& (u.source?.skillIndex??p.skillIndex)===2){
   const scale=skillBB(battle,u)['attack@atk_to_hp_recovery_ratio']??.11;
   const regen=battle.stats(u).atk*scale*(1/30);
   for(const a of alliedActors(battle.s).filter(x=>x.deployed&&x.hp>0&&battle.inside(u,x,true)))applyRegen(battle,{source:u,target:a,amount:regen});
   const talent=activeTalentsOf(battle,u).find(t=>t.name==='画地为牢');
   const fragile=talent?.values.damage_scale||1.2;
   for(const e of enemyActors(battle.s).filter(e=>battle.inside(u,e,true))){
    applyStatus(e,'sluggish',1/15,{source:u.uid,resistible:false});
     e.fragile=Math.max(e.fragile||1,1+(fragile-1)*(skillBB(battle,u).scale_delta_to_one??1));
   }
  }
  if(id==='char_181_flower'){
   const t=activeTalentsOf(battle,u).find(x=>x.name==='熏衣香');if(!t)continue;
   const amount=battle.stats(u).atk*(t.values.atk_to_hp_recovery_ratio??.05)*(1/30);
    for(const a of alliedActors(battle.s).filter(x=>x.deployed&&x.hp>0&&x.regenerable!==false))applyRegen(battle,{source:u,target:a,amount});
  }
  if(id==='char_213_mostma')for(const e of enemyActors(battle.s).filter(e=>e.hp>0&&battle.inside(u,e,true)))applyStatus(e,'sluggish',1/15,{source:u.uid,resistible:false});
 if(id==='char_332_archet'){const talent=activeTalentsOf(battle,u).find(t=>t.name==='兰登战术');if(talent){const interval=Math.max(.1,Number(talent.values?.interval)||2.5);u.landenNextAt??=battle.s.time+interval;while(battle.s.time+1e-9>=u.landenNextAt){for(const ally of battle.s.units.filter(v=>v.deployed&&v.hp>0&&battle.profile(v)?.profession==='SNIPER'))gainSp(ally,battle.profile(ally).skill,Number(talent.values?.sp)||1,battle.spCost(ally));u.landenNextAt+=interval;}}}
  if(id==='char_206_gnosis'){const talent=activeTalentsOf(battle,u).find(t=>t.name==='坚冰'),bb=talent?.values||{};if(talent)for(const e of enemyActors(battle.s).filter(e=>e.hp>0&&battle.inside(u,e,true))){const frozen=e.statuses?.some(s=>s.kind==='frozen'),cold=e.statuses?.some(s=>s.kind==='cold');if(cold||frozen)e.fragile=Math.max(e.fragile||1,Number(frozen?bb.damage_scale_freeze:bb.damage_scale_cold)||1.25);}const resist=activeTalentsOf(battle,u).find(t=>t.name==='殊途同归'),rbb=resist?.values||{};if(resist&&!u.gnosisResistanceApplied&&battle.s.time-(u.deployAt??0)>=Number(rbb.interval||10)){for(const ally of battle.s.units.filter(v=>v.deployed&&v.hp>0&&battle.profile(v)?.groupId==='karlan'))ally.statusResistance=Math.max(ally.statusResistance||0,Math.max(0,Math.min(1,-Number(rbb.one_minus_status_resistance)||.5)));u.gnosisResistanceApplied=true;}}
 }
}

export function effectStatMods(battle,u){
 const parts=[],add={atk:0,maxHp:0,def:0,magicResistance:0,blockCnt:0,tauntLevel:0},ratio={atk:0,maxHp:0,def:0},finalAdd={atk:0,maxHp:0,def:0};
 let attackSpeed=0,spRecoveryPerSec=0,magicResistance=0;
 const note=(stat,layer,v,src)=>{if(v)parts.push({stat,layer,v,src});};
 const auras=[];
 for(const src of battle.s.units.filter(v=>v.deployed&&v.hp>0)){
  const generic=statMods(battle,src);
  if(!['char_128_plosis','char_308_swire','char_108_silent','char_358_lisa'].includes(src.id))for(const aura of generic.auras){
   auras.push({key:aura.stat+':'+aura.text,stat:aura.stat,layer:aura.layer,v:aura.value,src:aura.source.name,ok:v=>targetFilter(aura.text,src,v,battle)});
  }
  const talents=activeTalentsOf(battle,src);
  if(src.id==='char_128_plosis'){
   const t=talents.find(x=>x.name==='技力光环');if(t)auras.push({key:'sp_recovery_aura',stat:'spRecoveryPerSec',layer:'maxSame',v:t.values.sp_recovery_per_sec||.3,src:'白面鸮',ok:()=>true});
  }
  if(src.id==='char_308_swire'){
   const t=talents.find(x=>x.name==='近距离作战指导');if(!t)continue;
   const bb=skillBB(battle,src);let scale=1,radius=1;
   if(battle.skillActive(src)){scale=bb.talent_scale||scale;if(bb.talent_range_flag)radius=2;}
   const v=(t.values.atk||.1)*scale;
   auras.push({key:'swire-atk',stat:'atk',layer:'maxSame',v,src:'诗怀雅',ok:v=>v.kind!=='summon'&&v.uid!==src.uid&&battle.profile(v).position==='MELEE'&&(battle.skillActive(src)&&bb.talent_range_flag?battle.inNamedRange(src,v,battle.profile(src).skill.rangeId):chebyshev(src,v)<=radius)});
  }
  if(src.id==='char_108_silent'){
   const t=talents.find(x=>x.name==='强化注射');if(t)auras.push({key:'silent-as',stat:'attackSpeed',layer:'maxSame',v:t.values.attack_speed||12,src:'赫默',ok:v=>battle.profile(v).profession==='MEDIC'});
  }
  if(src.id==='char_1041_angel2'){
   const t=talents.find(x=>x.name==='铳弹协约');if(t){const base=t.values.atk||.09,mult=t.values.mult||2;auras.push({key:'angel-ammo-atk',stat:'atk',layer:'maxSame',v:base,src:'新约能天使',ok:v=>v.kind!=='summon'&&battle.profile(v)?.skill?.durationType==='AMMO'});auras.push({key:'angel-ammo-laterano',stat:'atk',layer:'maxSame',v:base*mult,src:'新约能天使·拉特兰',ok:v=>v.kind!=='summon'&&battle.profile(v)?.skill?.durationType==='AMMO'&&battle.profile(v)?.bonds?.includes('lateranoShip')});}
  }
  if(src.id==='char_4162_cathy'&&(src.source?.skillIndex??battle.profile(src).skillIndex)===0){const bb=skillBB(battle,src),devices=battle.s.summons.filter(s=>s.ownerUid===src.uid&&s.type==='cathy-device');auras.push({key:'cathy-device-atk',stat:'atk',layer:'maxSame',v:Number(bb.s1_atk)||.11,src:'凯瑟琳',ok:v=>devices.some(d=>d.anchorUid===v.uid)});auras.push({key:'cathy-device-def',stat:'def',layer:'maxSame',v:Number(bb.s1_def)||.11,src:'凯瑟琳',ok:v=>devices.some(d=>d.anchorUid===v.uid)});}
  if(src.id==='char_245_cello'&&battle.skillActive(src)&&(src.source?.skillIndex??battle.profile(src).skillIndex)===2){const bb=skillBB(battle,src),all=battle.s.units.filter(v=>v.uid!==src.uid&&v.deployed&&v.hp>0&&battle.inside(src,v,true));const hp=all.slice().sort((a,b)=>b.maxHp-a.maxHp)[0],atk=all.slice().sort((a,b)=>b.atk-a.atk)[0],def=all.slice().sort((a,b)=>b.def-a.def)[0];if(hp)auras.push({key:'cello-maxhp',stat:'maxHp',layer:'maxSame',v:Number(bb['cello_s_3[max_hp].max_hp'])||.2,src:'塑心',ok:v=>v.uid===hp.uid});if(atk)auras.push({key:'cello-atk',stat:'atk',layer:'maxSame',v:Number(bb['cello_s_3[atk].atk'])||.2,src:'塑心',ok:v=>v.uid===atk.uid});if(def)auras.push({key:'cello-def',stat:'def',layer:'maxSame',v:Number(bb['cello_s_3[def].def'])||.2,src:'塑心',ok:v=>v.uid===def.uid});}
  if(src.id==='char_4134_cetsyr'&&battle.skillActive(src)&&(src.source?.skillIndex??battle.profile(src).skillIndex)===2){const bb=skillBB(battle,src);auras.push({key:'cetsyr-maxhp',stat:'maxHp',layer:'maxSame',v:Number(bb.max_hp)||.65,src:'魔王',ok:v=>v.uid!==src.uid&&battle.inside(src,v,true)});}
  if(src.id==='char_391_rosmon'&&src.rosmonPartner!=null)auras.push({key:'rosmon-caster',stat:'atk',layer:'maxSame',v:.08,src:'迷迭香·感知稳定',ok:v=>v.uid===src.rosmonPartner});
  if(src.id==='char_1012_skadi2'&&src.inspireAura&&battle.s.time<src.inspireAura.endsAt)auras.push({key:'skadi2-inspire',stat:'atkFlat',layer:'inspire',v:src.inspireAura.value,src:'浊心斯卡蒂',ok:v=>v.uid===src.uid||battle.inside(src,v,true)});
  if(src.id==='char_1012_skadi2'&&battle.skillActive(src)&&(src.source?.skillIndex??battle.profile(src).skillIndex)===1){const bb=skillBB(battle,src),atk=Number(bb.atk)||.45,def=Number(bb.def)||.45,baseAtk=Number(battle.profile(src).attributes.atk)||0,baseDef=Number(battle.profile(src).attributes.def)||0;auras.push({key:'skadi2-s2-atk',stat:'atkFlat',layer:'inspire',v:baseAtk*atk,src:'浊心斯卡蒂',ok:v=>v.uid!==src.uid&&battle.inside(src,v,true)});auras.push({key:'skadi2-s2-def',stat:'defFlat',layer:'inspire',v:baseDef*def,src:'浊心斯卡蒂',ok:v=>v.uid!==src.uid&&battle.inside(src,v,true)});}
  if(src.id==='char_237_gravel'){
   const t=talents.find(x=>x.name==='小个子支援'),bb=t&&talentValues(t);if(t)auras.push({key:'gravel-low-cost-def',stat:'def',layer:'maxSame',v:Number(bb.def)||0,src:'砾',ok:v=>v.kind!=='summon'&&(Number(v.baseCost??battle.profile(v)?.attributes?.cost)||0)<=Number(bb['cond.cost']??10)});
  }
  if(src.id==='char_358_lisa'){
   const t=talents.find(x=>x.name==='技力光环·辅助');if(t)auras.push({key:'sp_recovery_aura',stat:'spRecoveryPerSec',layer:'maxSame',v:t.values.sp_recovery_per_sec||.4,src:'铃兰',ok:v=>battle.profile(v).profession==='SUPPORT'||v.uid===src.uid});
  }
 }
 if(u.deployed&&u.hp>0){
  const genericSelf=statMods(battle,u);
  add.atk+=genericSelf.add.atk;add.maxHp+=genericSelf.add.maxHp;add.def+=genericSelf.add.def;add.magicResistance+=genericSelf.add.magicResistance;add.blockCnt+=genericSelf.add.blockCnt||0;add.tauntLevel+=genericSelf.add.tauntLevel||0;
  ratio.atk+=genericSelf.ratio.atk;ratio.maxHp+=genericSelf.ratio.maxHp;ratio.def+=genericSelf.ratio.def;attackSpeed+=genericSelf.attackSpeed;spRecoveryPerSec+=genericSelf.spRecoveryPerSec;parts.push(...genericSelf.parts);
  const talents=activeTalentsOf(battle,u);
  if(u.hornBuff){ratio.maxHp+=-(1-(u.hornBuff.maxHpMul??.5));ratio.def+=u.hornBuff.def||0;attackSpeed+=u.hornBuff.attackSpeed||0;note('maxHp','ratio',-(1-(u.hornBuff.maxHpMul??.5)),'号角血战');}
  if(u.talentMods){ratio.atk+=u.talentMods.atk||0;ratio.maxHp+=u.talentMods.maxHp||0;ratio.def+=u.talentMods.def||0;attackSpeed+=u.talentMods.attackSpeed||0;for(const [stat,v] of Object.entries(u.talentMods))if(v)note(stat,'deploy',v,(battle.profile(u)?.name||u.id)+'部署天赋');}
  if((u.talentStacks||0)>0)for(const talent of talents){const text=talent.description||'',bb=talentValues(talent);if(!/在场.*秒|停留.*秒/.test(text))continue;if(Number(bb.atk))ratio.atk+=Number(bb.atk)*(u.talentStacks||0);if(Number(bb.def))ratio.def+=Number(bb.def)*(u.talentStacks||0);}
  if(u.id==='char_4194_rmixer'){const t=talents.find(x=>x.name==='扫射迎宾仪礼');if(t){u.rmixerStacks=(u.rmixerStacks||[]).filter(at=>battle.s.time-at<(Number(t.values.duration)||10));const stacks=Math.min(Number(t.values.max_stack_cnt)||3,u.rmixerStacks.length);add.def+=Number(t.values.def||0)*stacks;attackSpeed+=Number(t.values.attack_speed||0)*stacks;}}
 }
 const maxSame={};
  for(const a of auras){
  if(!a.ok(u))continue;
  if(a.layer==='maxSame'){if(!maxSame[a.key]||a.v>maxSame[a.key].v)maxSame[a.key]=a;continue;}
  if(a.stat==='atk')ratio.atk+=a.v;
  else if(a.stat==='atkFlat')add.atk+=a.v;
  else if(a.stat==='defFlat')add.def+=a.v;
  else if(a.stat==='maxHp')ratio.maxHp+=a.v;
  else if(a.stat==='def')ratio.def+=a.v;
  else if(a.stat==='attackSpeed')attackSpeed+=a.v;
  else if(a.stat==='magicResistance')magicResistance+=a.v;
  else if(a.stat==='spRecoveryPerSec')spRecoveryPerSec+=a.v;
  note(a.stat,a.layer,a.v,a.src);
 }
  for(const a of Object.values(maxSame)){if(a.stat==='spRecoveryPerSec')spRecoveryPerSec+=a.v;else if(a.stat==='atk')ratio.atk+=a.v;else if(a.stat==='atkFlat')add.atk+=a.v;else if(a.stat==='attackSpeed')attackSpeed+=a.v;else if(a.stat==='def')ratio.def+=a.v;else if(a.stat==='defFlat')add.def+=a.v;note(a.stat,'maxSame',a.v,a.src);}
 return {add,ratio,finalAdd,attackSpeed,magicResistance,spRecoveryPerSec,parts};
}

function validMoveTile(battle,target,x,y,{allowOccupied=false,allowFlyOnly=false}={}){
 const tile=battle.map.grid[y]?.[x];if(!tile||tile.passableMask==='NONE'||(!allowFlyOnly&&tile.passableMask==='FLY_ONLY')||tile.obstacle)return false;
 if(allowOccupied)return true;
 const alliedTarget=battle.s.units.includes(target)||(battle.s.summons||[]).includes(target);
 // 只有「占格子」的单位挡落点：干员与占格子的召唤物。**敌人不占格子**——被阻挡时它本来就和
 // 干员同格，所以敌人站着的位置不算被占，换位置（盟约突袭的再部署、乌尔比安 S3 船锚）不用避开它。
 const occupied=new Set(alliedActors(battle.s).filter(a=>a!==target&&a.deployed!==false&&a.occupiesTile!==false).map(a=>a.x+','+a.y));
 // 乌尔比安船锚位移期间，他让出的原格对友方换位置视为被占据：技能结束要返航，别被抢了。
 // 只挡友方——敌人站在那儿不影响他回来（两者可以同格）。
 if(alliedTarget)for(const a of battle.s.units)if(a!==target&&a.returnPosition&&a.deployed&&a.hp>0)occupied.add(Math.round(a.returnPosition.x)+','+Math.round(a.returnPosition.y));
 return !occupied.has(x+','+y);
}
export function teleportActor(battle,target,{x,y,source=null,mode='teleport',allowOccupied=false}={}){
 if(!target||target.hp<=0||target.hidden||x==null||y==null)return false;
 const nx=Math.round(x),ny=Math.round(y);if(!validMoveTile(battle,target,nx,ny,{allowOccupied,allowFlyOnly:true}))return false;
 const fx0=target.x,fy0=target.y;target.x=nx;target.y=ny;target.block=null;target.action=null;log(battle,'move',{uid:target.uid,sourceUid:source?.uid,x:nx,y:ny,mode});battle.emit('move',{uid:target.uid,x:nx,y:ny,fromX:fx0,fromY:fy0,mode});return true;
}
export function moveActor(battle,target,source,description=''){
 if(!target||target.hp<=0||target.hidden||target.levitated)return false;
 const away=/推开|推动|击退/.test(description),toward=/拖拽|拉向|拉至/.test(description);if(!away&&!toward)return false;
 const dx=target.x-source.x,dy=target.y-source.y,len=Math.hypot(dx,dy)||1,step=away?1:-1,nx=Math.round(target.x+(dx/len)*step),ny=Math.round(target.y+(dy/len)*step);
 if(!validMoveTile(battle,target,nx,ny))return false;
 return teleportActor(battle,target,{x:nx,y:ny,source,mode:away?'push':'pull'});
}

// 「换位置」类效果（盟约突袭的再部署、乌尔比安 S3 的船锚位移）的落点口径：地形按备战期
// canDeploy 的同一套规则（不能部署的格子、近战不能上高台），再叠上 validMoveTile 的占位判定。
// 调用方先用它筛候选格，再交给 teleportActor 落位。
export function canRelocateTo(battle,actor,x,y){
 const tile=battle.map.grid[y]?.[x];if(!tile||tile.buildableType==='NONE'||tile.obstacle)return false;
 if(actor?.kind!=='summon'&&battle.profile?.(actor)?.position==='MELEE'&&tile.heightType==='HIGHLAND')return false;
 return validMoveTile(battle,actor,x,y,{allowFlyOnly:true});
}
// 找落点用的候选枚举：先四向、再对角，然后一圈圈外扩（老实现只试四向，四格被占就不落点）。
// 同一圈内顺序固定，固定种子下挑到的格子可复现。
export function nearbySpots(point,{maxRadius=3,axes=[[1,0],[-1,0],[0,1],[0,-1]]}={}){
 const cx=Math.round(point.x),cy=Math.round(point.y),out=[];
 for(let r=1;r<=maxRadius;r++){
  for(const [dx,dy] of axes)out.push({x:cx+dx*r,y:cy+dy*r});
  for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){if(Math.max(Math.abs(dx),Math.abs(dy))!==r||Math.abs(dx)+Math.abs(dy)===r)continue;out.push({x:cx+dx,y:cy+dy});}
 }
 return out;
}
// 沿某个方向由远及近找第一个能落脚的位置（乌尔比安船锚按「能部署就移动」的口径）。
export function projectSpot(battle,actor,dir,{minDistance=1,maxDistance=1}={}){
 for(let n=Math.max(1,Math.round(maxDistance));n>=Math.max(1,Math.round(minDistance));n--){
  const x=Math.round(actor.x)+dir[0]*n,y=Math.round(actor.y)+dir[1]*n;
  if(canRelocateTo(battle,actor,x,y))return {x,y};
 }
 return null;
}

export function dispatch(battle,type,payload){
 const {source,target,event}=payload;
 const ctx={dealDamage,applyHeal,applyRegen,applyLoss,applyElementDamage,grantShield,addDamageRedirect,queueDelayedDamage,reviveActor,gainSp,addEffect,moveActor,teleportActor,canRelocateTo,projectSpot,nearbySpots,spawnSummon,exit:commitExit,log:(b,t,p)=>log(b,t,p)};
 if(type==='skill-end'&&battle.s.band==='band_humus'&&target?.kind!=='summon'&&target?.deployed&&battle.profile(target).position==='MELEE'){const near=battle.s.units.filter(v=>v!==target&&v.deployed&&v.hp>0&&Math.abs(v.x-target.x)+Math.abs(v.y-target.y)===1);if(near.length){const pick=near[Math.floor(battle.economy.random()*near.length)];gainSp(pick,battle.profile(pick).skill,3,battle.spCost(pick));}}
 if(type==='battle-start'&&battle.s.band==='band_mberry'){const right=Math.max(...battle.s.units.map(u=>u.x));for(const u of battle.s.units)u.mberryEligible=u.x===right;}
 if(type==='after-damage'&&battle.s.band==='band_mberry'&&source?.kind!=='summon'&&source?.mberryEligible&&payload.result?.total>0){const key=payload.event?.attackId??payload.event?.eventId??battle.s.time;if(source.mberryAttackKey!==key){source.mberryAttackKey=key;if(battle.economy.random()<.25)grantGuard(battle,source,{charges:1,sourceUid:source.uid,id:'mberry-'+source.uid});}}
 if(type==='battle-start')bondBattleStart(battle);
 if(type==='after-damage')bondAfterDamage(battle,payload);
 if(type==='ammo')bondAmmo(battle,payload);
 if(type==='exit')bondExit(battle,target,payload.reason);
 if(type==='skill-start')payload.genericSuppress=operatorSkillStart(battle,target,ctx);
 else onEvent(battle,type,payload,ctx);
 if(type==='after-damage'&&payload.cause!=='dot'&&payload.cause!=='reflect'){
  if(target&&battle.s.units.includes(target)&&target.id==='char_107_liskam'&&target.deployed){
   const t=activeTalentsOf(battle,target).find(x=>x.name==='战术防御');
    if(t&&event&&consume(battle,'liskam-t1-'+target.uid,event.eventId)){
    const skill=battle.profile(target).skill,n=t.values.sp||1;
    gainSp(target,skill,n,battle.spCost(target));
    const near=battle.s.units.filter(v=>v.deployed&&v.hp>0&&v.uid!==target.uid&&chebyshev(target,v)<=1);
    if(near.length){const pick=near[Math.floor(battle.economy.random()*near.length)];gainSp(pick,battle.profile(pick).skill,n,battle.spCost(pick));}
    log(battle,'sp-gain',{uid:target.uid,from:'liskam'});
   }
  }
  if(source&&source.kind!=='summon'&&source.deployed){for(const mentor of battle.s.units.filter(u=>u.deployed&&u.hp>0&&u.id==='char_423_blemsh')){const talent=activeTalentsOf(battle,mentor).find(t=>t.name==='剑盾骑士'),spType=battle.profile(source).skill?.spData?.spType;if(talent&&(spType===8||spType==='INCREASE_WHEN_TAKEN_DAMAGE'))gainSp(source,battle.profile(source).skill,Number(talent.values?.sp)||1,battle.spCost(source));}}
  if(type==='after-damage'&&source&&target&&payload.cause!=='extra'){const owner=source.kind==='summon'?battle.s.units.find(u=>u.uid===source.ownerUid):source;if(owner?.id==='char_427_vigil'&&(owner.source?.skillIndex??battle.profile(owner).skillIndex)===2){const wolf=battle.s.summons.find(s=>s.ownerUid===owner.uid&&s.type==='vigil-wolf'&&s.deployed);if(wolf&&target.block===wolf.uid)ctx.dealDamage(battle,{source:owner,target,amount:battle.stats(owner).atk*(Number(skillBB(battle,owner)['attack@vigil_s_3.atk_scale'])||.3),type:'arts',cause:'extra',parentEventId:payload.event?.eventId,effectId:'vigil-s3-extra:'+owner.uid+':'+(payload.event?.eventId||0)});}}
  if(source?.id==='char_4194_rmixer'&&source.kind!=='summon'&&(source.source?.skillIndex??battle.profile(source).skillIndex)===0&&payload.cause!=='extra'){const allies=battle.s.units.filter(v=>v!==source&&v.deployed&&v.hp>0&&battle.profile(v)?.skill?.durationType==='AMMO'&&battle.profile(v)?.bonds?.includes('lateranoShip')&&chebyshev(v,source)<=1),ally=allies[0];if(ally)ally.ammo=Math.min(ally.ammoMax||Infinity,(ally.ammo||0)+Number(skillBB(battle,source).charge||1));}
  if(target?.id==='char_4194_rmixer'&&target.deployed&&battle.skillActive?.(target)&&(target.source?.skillIndex??battle.profile(target).skillIndex)===2&&source&&source.kind!=='summon'&&payload.cause!=='reflect'){const bb=skillBB(battle,target),now=battle.s.time;if(now>=(target.rmixerCounterNextAt||-Infinity)){target.rmixerCounterNextAt=now+(Number(bb.base_attack_time)||.3);for(const e of battle.s.enemies.filter(e=>e.hp>0&&!e.hidden&&battle.inside(target,e,true)).slice(0,Number(bb['attack@max_target'])||3))ctx.dealDamage(battle,{source:target,target:e,amount:battle.stats(target).atk,type:'physical',cause:'reflect',effectId:'rmixer-counter:'+target.uid+':'+now});}}
  if(target?.id==='char_136_hsguma'&&target.deployed&&((target.source?.skillIndex??battle.profile(target).skillIndex)===1)&&source&&source.kind!=='summon'&&payload.cause!=='reflect'){const cfg=skillConfig(battle.profile(target)),scale=Number(cfg.bb.atkScale)||.8;ctx.dealDamage(battle,{source:target,target:source,amount:battle.stats(target).atk*scale,type:'physical',cause:'reflect',parentEventId:payload.event?.eventId,effectId:'hsguma-reflect:'+target.uid+':'+(payload.event?.eventId||0)});}
  if(source&&source.id==='char_4137_udflow'&&(payload.cause==='attack'||payload.cause==='skill')&&target){
   const t=activeTalentsOf(battle,source).find(x=>x.name==='细胞活性抑制剂');
   if(t){const damage=target.tags?.includes?.('seamonster')?Number(t.values.damage_seamonster)||Number(t.values.damage)||80:Number(t.values.damage)||80;addEffect(battle,{kind:'dot',sourceUid:source.uid,sourceDeployGen:source.deployGen,targetUid:target.uid,talentOrSkillId:'udflow-t1',interval:t.values.interval||1,nextAt:battle.s.time+(t.values.interval||1),endsAt:battle.s.time+(t.values.duration||3),stackRule:'refresh',values:{damage,type:'arts'},snapshot:{damage},refKind:'owner',persistAfterSourceGone:true});}
  }
 }
  if(type==='after-damage'&&source?.id==='char_2015_dusk'&&target&&payload.result.total>0){
   const idx=source.source?.skillIndex??battle.profile(source).skillIndex;
   const first=!source.duskFirstAttack&&activeTalentsOf(battle,source).some(t=>t.name==='点睛');source.duskFirstAttack=true;
   if(first||(idx===2&&battle.skillActive(source))){
    const old=battle.s.summons.find(s=>s.ownerUid===source.uid&&s.type==='dusk-token'&&s.x===Math.round(target.x)&&s.y===Math.round(target.y));
    if(old)old.endsAt=battle.s.time+25;
    else spawnSummon(battle,source,{type:'dusk-token',name:'小自在',x:Math.round(target.x),y:Math.round(target.y),targetable:true,canBlock:true,canAttack:true,occupiesTile:true,duration:25});
   }
  }
  if(type==='after-heal'&&source?.id==='char_4139_papyrs'){
  const t=activeTalentsOf(battle,source).find(x=>x.name==='博览古卷');
   if(t){const skillScale=Number(source.papyrsShieldScale)|| (battle.skillActive(source)?Number(skillBB(battle,source).shield_scale_skill)||1:1);source.papyrsShieldScale=null;grantShield(battle,payload.target,{amount:battle.stats(source).atk*(t.values['attack@scale']||.2)*skillScale,endsAt:battle.s.time+(t.values['attack@shield_duration']||8),sourceUid:source.uid,id:'papyrs-'+source.uid+'-'+payload.target.uid});}
 }
 if(type==='after-heal'&&source?.id==='char_4042_lumen'&&source.lumenHotPending){
  const bb=skillBB(battle,source);source.lumenHotPending=false;
  const heal=battle.stats(source).atk*(bb['aura.heal_scale']||.4);
  const life=bb['aura.projectile_life_time']||5,interval=bb['aura.interval']||1;
  for(const a of alliedActors(battle.s).filter(v=>v.deployed&&v.hp>0&&chebyshev(payload.target,v)<=1)){
   addEffect(battle,{kind:'hot',sourceUid:source.uid,sourceDeployGen:source.deployGen,targetUid:a.uid,talentOrSkillId:'lumen-s1',interval,nextAt:battle.s.time+interval,endsAt:battle.s.time+life,values:{heal},snapshot:{heal},refKind:'owner',persistAfterSourceGone:true});
  }
 }
 if(type==='enemy-death'){
  const killer=payload.killer?.kind==='summon'?battle.s.units.find(u=>u.uid===payload.killer.ownerUid):payload.killer;if((battle.s.band==='band_ducklord'&&payload.target?.id?.endsWith('_2')&&['enemy_2001_duckmi_2','enemy_2002_bearmi_2','enemy_2034_sythef_2','enemy_2085_skzjxd_2'].includes(payload.target.id))||payload.target?.bountyReward){const amount=Number(payload.target.bountyReward)||1;battle.economy.s.nextRoundBonus=(battle.economy.s.nextRoundBonus||0)+amount;log(battle,'strategy-reward',{strategy:payload.target.bountyReward?'bounty':'band_ducklord',uid:payload.target.uid,amount});}if(killer?.id==='char_4079_haini'&&battle.skillActive?.(killer)&&(killer.source?.skillIndex??battle.profile(killer).skillIndex)===1&&payload.target?.elite!==true&&payload.target?.leader!==true){const bb=skillBB(battle,killer),step=Number(bb['attack@talent_up'])||.5,max=Number(bb['attack@max_talent_up'])||3;killer.hainiTalentScale=Math.min(max,(killer.hainiTalentScale||1)+step);}if(killer?.id==='char_350_surtr'&&killer.surtrS1){killer.sp=battle.spCost(killer);killer.spLock=0;killer.surtrS1=false;}if(killer?.id==='char_1028_texas2'&&!killer.texas2Killed){killer.texas2Killed=true;killer.hp=killer.maxHp;}if(killer?.id==='char_2015_dusk'){const talent=activeTalentsOf(battle,killer).find(t=>t.name==='化境');if(talent)killer.duskTalentStacks=Math.min(Number(talent.values?.max_stack_cnt)||15,(killer.duskTalentStacks||0)+1);}
  for(const u of battle.s.units.filter(v=>v.deployed&&v.hp>0&&v.id==='char_171_bldsk')){
   if(!battle.inside(u,payload.target))continue;
   const t=activeTalentsOf(battle,u).find(x=>x.name==='血液样本回收');if(!t)continue;
   if(payload.event&&!consume(battle,'bldsk-t1-'+u.uid,payload.event.eventId))continue;
   gainSp(u,battle.profile(u).skill,t.values['bldsk_t_1[self].sp']||2,battle.spCost(u));
   const near=battle.s.units.filter(v=>v.deployed&&v.hp>0&&v.uid!==u.uid&&battle.inside(u,v));
   if(near.length){const pick=near[Math.floor(battle.economy.random()*near.length)];gainSp(pick,battle.profile(pick).skill,t.values['bldsk_t_1[rand].sp']||2,battle.spCost(pick));}
   log(battle,'sp-gain',{uid:u.uid,from:'bldsk',deathUid:payload.target.uid});
  }
 }
 if(type==='guardLayerConsumed'&&target?.id==='char_311_mudrok'){
  const t=activeTalentsOf(battle,target).find(x=>x.name==='沃土予身');
  if(t)enqueue(battle,{kind:'heal',sourceUid:target.uid,targetUid:target.uid,amount:target.maxHp*(t.values.hp_ratio||.2),parentEventId:event?.eventId,effectId:'mudrok-t1-heal'});
 }
 if(type==='deploy'){onOperatorDeploy(battle,payload.target);bondDeploy(battle,payload.target);}
 if(type==='skill-start'){bondSkillStart(battle,payload.target);const specialSuppress=onSkillStart(battle,payload.target);return !!payload.genericSuppress||!!specialSuppress;}
 if(type==='skill-end'){bondSkillEnd(battle,payload.target);onSkillEnd(battle,payload.target,payload.reason);}
 if(type==='exit')onOperatorExit(battle,payload.target,payload.reason);
}

export function grantShield(battle,target,spec){
 target.shieldLayers??=[];
 if(spec.id)target.shieldLayers=target.shieldLayers.filter(l=>{if(l.id!==spec.id)return true;log(battle,'replaced',{uid:target.uid,layerId:l.id});return false;});
 const layer={id:spec.id||('sh-'+battle.s.settle.nextEffectId++),remaining:spec.amount,max:spec.amount,endsAt:spec.endsAt,decayPerSec:spec.decayPerSec||0,sourceUid:spec.sourceUid};
 target.shieldLayers.push(layer);
 target.shield=target.shieldLayers.reduce((n,l)=>n+l.remaining,0);
 log(battle,'barrier-add',{uid:target.uid,amount:spec.amount,id:layer.id});
 return layer;
}
export function grantGuard(battle,target,spec){
 target.barriers??=[];
 const g={id:spec.id||('g-'+battle.s.settle.nextEffectId++),charges:spec.charges??1,types:spec.types||null,sourceUid:spec.sourceUid,endsAt:spec.endsAt};
 target.barriers.push(g);log(battle,'guard-add',{uid:target.uid,id:g.id,charges:g.charges});return g;
}

function onOperatorDeploy(battle,u){
 u.exitLife=null;u.revivedThisLife=false;u.surtrLock=false;u.lumenHotPending=false;u.papyrsTargetUid=null;
 const passive=battle.profile(u)?.skill;if(passive?.skillType==='PASSIVE'){const bb=skillBB(battle,u);if(/部署后立即流失/.test(passive.description||'')){const ratio=Number(bb.hp_ratio)||0;if(ratio>0)applyLoss(battle,{target:u,source:u,amount:u.hp*ratio,minHp:1,cause:'loss'});}const activeDuration=Number(bb.duration)>0?Number(bb.duration):Number(passive.duration);if(activeDuration>0&&['char_337_utage','char_263_skadi'].includes(u.id))u.skillLeft=activeDuration;}
 if(u.id==='char_1028_texas2'){const idx=u.source?.skillIndex??battle.profile(u).skillIndex,bb=skillBB(battle,u);u.passiveArts=idx===1||idx===2;if(idx===1){for(const e of enemyActors(battle.s).filter(e=>e.hp>0&&!e.hidden&&battle.inside(u,e,true))){dealDamage(battle,{source:u,target:e,amount:battle.stats(u).atk*(Number(bb.atk_scale)||1.8),type:'arts',cause:'skill'});applyStatus(e,'resDown',Number(bb.debuff_duration)||10,{source:u.uid,value:-Math.abs(Number(bb.magic_resistance)||.2),resistible:false});}}if(idx===2){for(const e of enemyActors(battle.s).filter(e=>e.hp>0&&!e.hidden&&battle.inside(u,e,true))){for(let n=0;n<2;n++)dealDamage(battle,{source:u,target:e,amount:battle.stats(u).atk*(Number(bb['appear.atk_scale'])||1.3),type:'arts',cause:'skill'});applyStatus(e,'stun',Number(bb['appear.stun'])||1.5,{source:u.uid,resistible:false});}u.texas2NextAt=battle.s.time+1;}}
 for(const talent of activeTalentsOf(battle,u)){const text=talent.description||'',bb=talent.values||{};if(/部署后.*秒内技力自然回复速度/.test(text)&&Number(bb.sp_recovery_per_sec)>0&&Number(bb.duration)>0){u.talentSpRecovery=Number(bb.sp_recovery_per_sec);u.talentSpRecoveryUntil=battle.s.time+Number(bb.duration);}}
 if(u.id==='char_1033_swire2'&&(u.source?.skillIndex??battle.profile(u).skillIndex)<2){u.coinCap=coinCapFor(battle.profile(u));u.coinSkillEnabled=true;const opening=coinGainAtSkillStart(battle,u);if(opening)grantCoins(u,opening,u.coinCap);}
 if(u.id==='char_496_wildmn'&&(u.source?.skillIndex??battle.profile(u).skillIndex)===0){const bb=skillBB(battle,u);u.wildmaneAspd=Number(bb.attack_speed)||100;u.wildmaneAspdUntil=battle.s.time+(Number(battle.profile(u).skill?.duration)||25);}
 if(u.id==='char_496_wildmn'&&(u.source?.skillIndex??battle.profile(u).skillIndex)===1){for(const target of battle.reserveUnits?.(v=>battle.profile(v)?.profession==='WARRIOR')||[]){target.wildmaneCostDelta=Math.max(-5,(target.wildmaneCostDelta||0)-1);}}
 if(u.id==='char_237_gravel'&&(u.source?.skillIndex??battle.profile(u).skillIndex)===0){const bb=skillBB(battle,u);u.gravelDefBuff={ratio:Number(bb.def)||0,duration:Number(bb.duration)||8,endsAt:battle.s.time+(Number(bb.duration)||8)};}
 if(u.id==='char_237_gravel'&&(u.source?.skillIndex??battle.profile(u).skillIndex)===1){
  const bb=skillBB(battle,u),amount=battle.stats(u).maxHp*(bb.hp_ratio||1.8),dur=bb.duration||10;
  grantShield(battle,u,{amount,endsAt:battle.s.time+dur,decayPerSec:amount/dur,sourceUid:u.uid,id:'gravel-s2'});
 }
 if(u.id==='char_311_mudrok'){
  const t=activeTalentsOf(battle,u).find(x=>x.name==='沃土予身');
  if(t){
   grantGuard(battle,u,{charges:t.values.times||1,sourceUid:u.uid,id:'mudrok-init'});
   addEffect(battle,{kind:'guard',sourceUid:u.uid,sourceDeployGen:u.deployGen,talentOrSkillId:'mudrok-t1',interval:t.values.interval||9,nextAt:battle.s.time+(t.values.interval||9),values:{times:t.values.times||1,max_times:t.values.max_times||3},refKind:'live'});
  }
 }
 if(u.id==='char_107_liskam'&&(u.source?.skillIndex??0)===0){/* S1 applied on activate */}
  if(u.id==='char_108_silent')u.summonCtrl={stock:0,cap:1,type:'drone'};
 if(u.id==='char_427_vigil')u.summonCtrl={stock:0,cap:1,type:'wolf',manualSummonCards:true};
 if(u.id==='char_4162_cathy'){const t=activeTalentsOf(battle,u).find(t=>t.name==='定向支援信号');u.summonCtrl={stock:0,cap:2,type:'device',manualSummonCards:true,maxStock:t?.values.cnt??3};}
 if(u.id==='char_1023_ghost2'){spawnSummon(battle,u,{type:'ghost2-substitute',tokenId:'token_10024_ebnhlz_rcube',name:'旧日残影',targetable:false,healable:false,canBlock:false,canAttack:false,occupiesTile:false,persistAfterSourceGone:false});}
 if(u.id==='char_4134_cetsyr'){const dust=battle.s.summons.filter(s=>s.ownerUid===u.uid&&s.type==='cetsyr-dust'&&s.deployed);for(const extra of dust.slice(3))commitExit(battle,{target:extra,reason:'refresh'});u.cetsyrDust=3;for(let n=Math.min(3,dust.length);n<3;n++)spawnSummon(battle,u,{type:'cetsyr-dust',name:'微尘',synthetic:true,targetable:false,healable:false,canBlock:false,canAttack:false,occupiesTile:false,persistAfterSourceGone:true});}
 if(u.id==='char_4087_ines'&&(u.source?.skillIndex??battle.profile(u).skillIndex)===2){addEffect(battle,{kind:'zone',sourceUid:u.uid,sourceDeployGen:u.deployGen,talentOrSkillId:'ines-shadow',x:u.x,y:u.y,radius:2,interval:1,nextAt:battle.s.time+1,endsAt:battle.s.time+25,trackArea:true,trackSide:'enemy',values:{sluggish:true,reveal:true},snapshot:{},refKind:'live',persistAfterSourceGone:true});commitExit(battle,{target:u,reason:'skill'});}
  if(u.id==='char_1012_skadi2'&&!battle.s.summons.some(s=>s.ownerUid===u.uid&&s.type==='skadi2-seaborn'&&s.deployed)&&!battle.economy?.s.summonCards?.some(card=>card.ownerUid===u.uid&&card.type==='skadi2-seaborn'&&card.position)){const talent=activeTalentsOf(battle,u).find(t=>t.name==='远古血亲');if(talent){spawnSummon(battle,u,{type:'skadi2-seaborn',tokenId:'token_10017_skadi2_dedant',name:'海嗣',targetable:true,canBlock:true,canAttack:true,occupiesTile:true,duration:Number((talent.description||'').match(/持续(\d+)秒/)?.[1])||30,persistAfterSourceGone:false});u.summonRespawnAt=null;}}
 if(u.id==='char_103_angel'){const talent=activeTalentsOf(battle,u).find(t=>t.name==='天使的祝福');if(talent){const values=talent.values||{},candidates=battle.s.units.filter(v=>v.uid!==u.uid&&v.deployed&&v.hp>0);if(candidates.length){const target=candidates[Math.floor(battle.economy.random()*candidates.length)];target.angelBlessing={atk:Number(values.atk)||.06,maxHp:Number(values.max_hp)||.1,sourceUid:u.uid};}}}
 if(u.id==='char_332_archet'){const talent=activeTalentsOf(battle,u).find(t=>t.name==='铁弦');if(talent)grantShield(battle,u,{amount:Number(talent.values?.shield_value)||500,sourceUid:u.uid,id:'archet-deploy-shield'});}
 if(u.id==='char_4148_philae'){const talent=activeTalentsOf(battle,u).find(t=>t.name==='神河谕使');u.elementDamageResistance=Number(talent?.values?.damage_resistance)||.1;}
 if(u.id==='char_1046_sbell2'){const t=activeTalentsOf(battle,u).find(x=>x.name==='无垠的雪景'),bb=t&&t.values;if(t)addEffect(battle,{kind:'zone',sourceUid:u.uid,sourceDeployGen:u.deployGen,talentOrSkillId:'sbell2-snow',x:u.x,y:u.y,radius:2,interval:Number(bb.interval)||5,nextAt:battle.s.time+(Number(bb.interval)||5),endsAt:null,trackArea:true,trackSide:'enemy',values:{dot:true,sluggish:true,cold:Number(bb.cold)||5,elementScale:Number(bb.talent_magic_scale)||.75,type:'arts',elementType:'elemental'},snapshot:{damage:battle.stats(u).atk*(Number(bb.talent_magic_scale)||.75)},refKind:'live',persistAfterSourceGone:false});}
 // 凛御银灰【开放性开局】的「风雪之眼」是**待部署区**里的一张卡（技能三期间才变为可部署），
 // 不是场上的召唤物；按用户口径（2026-09-19）本期不实现，所以这里不生成任何实体。
 // 她其余的效果照旧：技能一的范围寒冷／反隐、技能三的部署费用与待部署区费用互换、雪境先驱的谢拉格增益。
 if(u.id==='char_1014_nearl2'&&(u.source?.skillIndex??battle.profile(u).skillIndex)===1){const bb=skillBB(battle,u);u.skillLeft=Number(battle.profile(u).skill.duration)||25;for(let n=0;n<(Number(bb.times)||3);n++)grantGuard(battle,u,{charges:1,sourceUid:u.uid,id:'nearl2-s2-'+n});}
 if(u.id==='char_1014_nearl2'){const t=activeTalentsOf(battle,u).find(x=>x.name==='不畏苦暗'),bb=t&&t.values;if(t)for(const e of enemyActors(battle.s).filter(e=>e.hp>0&&chebyshev(e,u)<=4)){dealDamage(battle,{source:u,target:e,amount:battle.stats(u).atk*(Number(bb.atk_scale)||.8),type:'true',cause:'skill'});applyStatus(e,'stun',Number(bb.stun)||3,{source:u.uid,resistible:false});}}
 if(u.id==='char_391_rosmon'){const t=activeTalentsOf(battle,u).find(x=>x.name==='感知稳定');if(t){const caster=battle.s.units.find(v=>v.uid!==u.uid&&v.deployed&&v.hp>0&&battle.profile(v).profession==='CASTER');u.rosmonPartner=caster?.uid??null;}}
 if(u.initialSpBonus){u.sp+=u.initialSpBonus;u.initialSpBonus=0;}
 u.duskFirstAttack=false;for(const g of battle.profile(u).garrisons||[]){const b=blackboard(g.blackboard);if(b.key==='act2autochess_gar_eff_attrByBond_add_onstart'&&b.bond_id){const stacks=Math.floor((battle.layers[b.bond_id]||0)/(Number(b.divide_num)||1));u.garrisonDeployBuff={atk:Number(b.atk||0)*stacks,maxHp:Number(b.max_hp||0)*stacks,endsAt:battle.s.time+(Number(b.duration)||0)};}}
}
function onSkillStart(battle,u){
 const idx=u.source?.skillIndex??battle.profile(u).skillIndex;
 if(u.id==='char_420_flamtl'&&idx===0){u.physicalEvadeOnce=true;}
 if(u.id==='char_420_flamtl'&&idx===1){const bb=skillBB(battle,u),duration=Number(bb['flamtl_s_2.duration'])||10,prob=Number(bb['flamtl_s_2.prob'])||0;for(const a of alliedActors(battle.s).filter(v=>v.deployed&&v.hp>0&&chebyshev(u,v)<=1)){a.physicalEvadeUntil=battle.s.time+duration;a.physicalEvadeProb=prob;}}
 if(u.id==='char_420_flamtl'&&idx===2){u.skillEvasionProb=Number(skillBB(battle,u).prob)||0;}
 if(u.id==='char_4026_vulpis'&&idx===1){const cfg=skillConfig(battle.profile(u)),bb=cfg.bb,targets=enemyActors(battle.s).filter(e=>!e.hidden&&!e.untargetable&&battle.inside(u,e,true)).slice(0,Number(bb.max_target)||6);for(const e of targets){const was=(e.statuses||[]).some(s=>s.kind==='sluggish');dealDamage(battle,{source:u,target:e,amount:battle.stats(u).atk*(Number(cfg.atkScale)||1),type:'arts',cause:'skill',skill:true});applyStatus(e,was?'stun':'sluggish',Number(was?bb.stun:bb.sluggish)||1,{source:u.uid,resistible:false});}return true;}
 if(u.id==='char_4026_vulpis'&&idx===2){u.vulpisKilled=false;u.vulpisMarks={};}
 if(u.id==='char_1012_skadi2'&&idx===2){const bb=skillBB(battle,u),duration=battle.profile(u).skill.duration;u.inspireAura={value:(battle.profile(u).attributes.atk||0)*Number(bb.atk||0),endsAt:battle.s.time+(duration>0?duration:1e9)};}
 if(u.id==='char_344_beewax'&&idx===1){const bb=skillBB(battle,u),token=spawnSummon(battle,u,{type:'beewax-obelisk',name:'沙之碑',targetable:true,canBlock:true,canAttack:false,occupiesTile:true,duration:u.skillLeft});if(token)for(const e of enemyActors(battle.s).filter(e=>chebyshev(token,e)<=1)){dealDamage(battle,{source:u,target:e,amount:battle.stats(u).atk*(bb.atk_scale||2),type:'arts',cause:'skill'});applyStatus(e,'stun',bb.stun||1,{source:u.uid,resistible:false});}return true;}
 if(u.id==='char_4016_kazema'&&idx===1){const token=spawnSummon(battle,u,{type:'kazema-shadow',name:'纸偶',targetable:true,canBlock:true,canAttack:true,occupiesTile:true,duration:u.skillLeft});if(token)for(const e of enemyActors(battle.s).filter(e=>chebyshev(token,e)<=1))dealDamage(battle,{source:u,target:e,amount:battle.stats(u).atk*(Number(activeTalentsOf(battle,u).find(t=>t.name==='折纸生花')?.values?.damage_scale)||2.7),type:'arts',cause:'skill'});}
 if(u.id==='char_1019_siege2'&&idx===2){spawnSummon(battle,u,{type:'siege2-golden',name:'黄金盟誓',targetable:true,canBlock:true,canAttack:true,occupiesTile:true,duration:u.skillLeft});}
 if(u.id==='char_391_rosmon'&&idx===2){const bb=skillBB(battle,u);for(let n=0;n<2;n++){const token=spawnSummon(battle,u,{type:'rosmon-gear-'+n,name:'战术装备',synthetic:true,targetable:true,canBlock:true,canAttack:false,occupiesTile:true,duration:u.skillLeft});if(token)for(const e of enemyActors(battle.s).filter(e=>chebyshev(token,e)<=1))applyStatus(e,'stun',Number(bb.stun)||2,{source:u.uid,resistible:false});}}
 if(u.id==='char_1033_swire2'&&idx===1){
  const target=battle.targets(u)[0],cfg=skillConfig(battle.profile(u)),range=battle.range(u,true),candidates=[...(target?[target]:[]),...range.map(p=>({x:p.x,y:p.y}))];
  let token=null;
  for(const point of candidates){const tile=battle.map.grid[point.y]?.[point.x];if(!tile||tile.buildableType==='NONE'||tile.obstacle||tile.heightType==='HIGHLAND')continue;token=spawnSummon(battle,u,{type:'swire2-trap',name:'香槟炸弹',targetable:false,healable:false,canBlock:false,canAttack:false,occupiesTile:false,x:point.x,y:point.y});if(token)break;}
  if(token){token.trapScale=Number(cfg.bb.atkScale)||1.4;token.trapSlow=Number(cfg.bb.sluggish)||2;token.trapTriggered=false;token.trapExtraAt=null;token.trapExtraUsed=false;}
 return true;
 }
 if(u.id==='char_427_vigil'&&idx===0){const wolf=battle.s.summons.find(s=>s.ownerUid===u.uid&&s.type==='vigil-wolf'&&s.deployed);if(wolf){wolf.lives=Math.min(3,(wolf.lives||1)+1);wolf.blockCnt=wolf.lives;}}
 if(u.id==='char_427_vigil'&&idx===1){const wolf=battle.s.summons.find(s=>s.ownerUid===u.uid&&s.type==='vigil-wolf'&&s.deployed);if(wolf){const bb=skillBB(battle,u);wolf.vigilBuff={scale:Number(bb['vigil_wolf_s_2.atk_scale'])||1.7,heal:Number(bb['vigil_wolf_s_2.hp_ratio'])||.15,endsAt:battle.s.time+5};}}
 if(u.id==='char_249_mlyss'&&(idx===0||idx===1||idx===2)){const token=battle.s.summons.find(s=>s.ownerUid===u.uid&&s.type==='mlyss-fluid'&&s.deployed)||spawnSummon(battle,u,{type:'mlyss-fluid',name:'流形',synthetic:!battle.data.tokens?.token_10030_mlyss_wtrman,targetable:true,canBlock:true,canAttack:true,occupiesTile:true,duration:idx===2?25:u.skillLeft,persistAfterSourceGone:true});const copy=battle.s.units.find(v=>v.uid!==u.uid&&!v.deployed&&v.hp>0);if(token&&copy&&!token.copyOf){const attrs=battle.profile(copy).attributes;token.copyOf=copy.uid;for(const [to,from] of [['maxHp','maxHp'],['hp','maxHp'],['atk','atk'],['def','def'],['res','magicResistance'],['blockCnt','blockCnt'],['interval','baseAttackTime'],['attackSpeed','attackSpeed']])if(Number.isFinite(attrs[from]))token[to]=attrs[from];token.canBlock=token.blockCnt>0;token.occupiesTile=token.canBlock;token.damageType=battle.behavior?.(copy)?.damageType||'physical';token.range=Math.max(1.1,Math.max(...(battle.profile(copy).range?.grids||[]).map(g=>Math.hypot(g.col,g.row)),1));}}
 if(u.id==='char_143_ghost'&&idx===1){u.lockHp={min:1,endsAt:null,onEnd:null};log(battle,'lock',{uid:u.uid,min:1});}
 if(u.id==='char_1023_ghost2'&&idx===1){u.lockHp={min:1,endsAt:null,onEnd:'forced'};log(battle,'lock',{uid:u.uid,min:1,operator:'归溟幽灵鲨'});}
 if(u.id==='char_107_liskam'&&idx===0){
  const bb=skillBB(battle,u);grantGuard(battle,u,{charges:1,sourceUid:u.uid,id:'liskam-s1',endsAt:battle.s.time+(bb.duration||8)});
 }
 if(u.id==='char_258_podego'&&idx===1){
  const bb=skillBB(battle,u);
  addEffect(battle,{kind:'zone',sourceUid:u.uid,sourceDeployGen:u.deployGen,talentOrSkillId:'podego-s2',x:(battle.targets(u)[0]||u).x,y:(battle.targets(u)[0]||u).y,radius:1,interval:1,nextAt:battle.s.time+1,endsAt:battle.s.time+(bb.projectile_delay_time||5),values:{dot:true,sluggish:true,silence:true,atk_scale:bb.atk_scale||.6},snapshot:{damage:battle.stats(u).atk*(bb.atk_scale||.6)},refKind:'owner',persistAfterSourceGone:true});return true;
 }
 if(u.id==='char_4042_lumen'&&idx===0){u.lumenHotPending=true;return true;}
 if(u.id==='char_4139_papyrs'&&idx===1){const target=alliedActors(battle.s).filter(v=>v.uid!==u.uid&&v.kind!=='summon'&&v.deployed&&v.hp>0&&battle.canHeal(v,u)&&battle.inside(u,v,true)).sort((a,b)=>b.maxHp-a.maxHp||a.uid-b.uid)[0];u.papyrsTargetUid=target?.uid??null;}
 if(u.id==='char_1020_reed2'&&idx===1){
  const bb=skillBB(battle,u),grounds=battle.s.units.filter(v=>v.deployed&&v.hp>0&&battle.profile(v).position==='MELEE').slice(0,bb.max_target||2);
  for(const a of grounds)for(let ball=0;ball<3;ball++)addEffect(battle,{kind:'attached',sourceUid:u.uid,sourceDeployGen:u.deployGen,anchorUid:a.uid,talentOrSkillId:'reed2-s2-'+ball,radius:.8,interval:bb.cooldown||1.5,nextAt:battle.s.time+(ball+1)*(bb.cooldown||1.5)/3,endsAt:battle.s.time+(bb.projectile_life_time||20),values:{atk_scale:bb.atk_scale||1.9,heal_ratio:.5},refKind:'anchor',persistAfterSourceGone:true});
 }
  if(u.id==='char_108_silent'&&idx===1){
  u.summonCtrl??={stock:0,cap:1,type:'drone'};
  if((u.summonCtrl.stock||0)<u.summonCtrl.cap)u.summonCtrl.stock++;
  if(u.summonCtrl.stock>0){spawnSummon(battle,u,{type:'silent-drone',name:'医疗无人机',targetable:false,healable:false,canBlock:false,canAttack:false,canHeal:true,device:true,maxHp:1,atk:battle.stats(u).atk,duration:10,persistAfterSourceGone:true,healScale:.5});}
 }
 if(u.id==='char_1014_nearl2'&&idx===2){const token=spawnSummon(battle,u,{type:'nearl2-sun',name:'耀阳',targetable:true,canBlock:true,canAttack:false,occupiesTile:true,duration:u.skillLeft});if(token)for(const e of enemyActors(battle.s).filter(e=>Math.abs(e.x-token.x)+Math.abs(e.y-token.y)<=1)){dealDamage(battle,{source:u,target:e,amount:battle.stats(u).atk*(skillBB(battle,u).value??1),type:'true',cause:'skill'});applyStatus(e,'stun',skillBB(battle,u).value2??3,{source:u.uid});}}
 if(u.id==='char_171_bldsk'&&idx===1){
  const bb=skillBB(battle,u);
  applyLoss(battle,{target:u,amount:u.maxHp*(bb.hp_ratio||.03)*0});
  addEffect(battle,{kind:'loss',sourceUid:u.uid,targetUid:u.uid,interval:bb.interval||1,nextAt:battle.s.time+1,endsAt:battle.s.time+(bb.duration||15),values:{amount:u.maxHp*(bb.hp_ratio||.03)},refKind:'owner'});
 }
}
 function onSkillEnd(battle,u){
 const idx=u.source?.skillIndex??battle.profile(u).skillIndex;
 u.skillDisarmUntil=null;u.focusHealAfter=null;u.focusHeal=false;u.statusResistance=0;u.papyrsTargetUid=null;if(u.id==='char_311_mudrok')u.invulnerableUntil=0;if(u.id==='char_311_mudrok'&&idx===2){const bb=skillBB(battle,u);for(const e of enemyActors(battle.s).filter(e=>e.hp>0&&!e.flying&&chebyshev(e,u)<=1))applyStatus(e,'stun',Number(bb.stun)||3,{source:u.uid,resistible:false});u.mudrokAwake=false;}if(u.id==='char_4056_titi'){for(const actor of battle.s.units)actor.statuses=(actor.statuses||[]).filter(s=>s.source!==u.uid||s.kind!=='sleep');u.titiSleepUid=null;}
 u.pendingPeriodicCost=null;u.svashCostRemaining=0;u.svashCostHandled=false;u.pendingNextAttack=null;u.pendingAttackSelfHeal=null;u.pendingHealScale=null;u.papyrsShieldScale=null;u.pendingCostGain=null;
 for(const fx of battle.s.logicEffects.slice())if(fx.sourceUid===u.uid&&(fx.talentOrSkillId===`skill-zone:${u.id}:${u.skillCount}`||fx.talentOrSkillId===`skill-heal-zone:${u.id}:${u.skillCount}`||fx.talentOrSkillId===`skill-loss:${u.id}:${u.skillCount}`||fx.talentOrSkillId===`skill-regen-zone:${u.id}:${u.skillCount}`||(u.id==='char_4134_cetsyr'&&String(fx.talentOrSkillId||'').startsWith('cetsyr-dust:'))))dropEffect(battle,fx,'skill-end');
 for(const fx of battle.s.logicEffects.slice())if(fx.sourceUid===u.uid&&(fx.talentOrSkillId==='warfarin-s2-ally'||fx.talentOrSkillId==='saria-s3'))dropEffect(battle,fx,'skill-end');
 for(const fx of battle.s.logicEffects.slice())if(fx.sourceUid===u.uid&&(fx.talentOrSkillId==='surtr-s3-loss'||fx.talentOrSkillId==='horn-s3-loss'))dropEffect(battle,fx,'skill-end');
 if(u.warfarinTargetUid!=null){const target=getActor(battle.s,u.warfarinTargetUid);if(target?.warfarinBuff?.sourceUid===u.uid)target.warfarinBuff=null;u.warfarinTargetUid=null;}
 if(u.vendlaTargetUid!=null){const target=getActor(battle.s,u.vendlaTargetUid);if(target?.vendlaBuff?.sourceUid===u.uid){target.vendlaBuff=null;target.healingReceived=target.vendlaPreviousHeal??1;target.vendlaPreviousHeal=null;}u.vendlaTargetUid=null;}
 for(const talent of activeTalentsOf(battle,u)){const text=talent.description||'',bb=talent.values||{};if(/技能结束.*恢复.*生命|技能结束.*回复.*生命/.test(text)&&Number(bb.hp_ratio)>0)applyHeal(battle,{source:u,target:u,amount:u.maxHp*Number(bb.hp_ratio)});}
 if(Number(u.skillEndHealRatio)>0){applyHeal(battle,{source:u,target:u,amount:u.maxHp*u.skillEndHealRatio});u.skillEndHealRatio=0;}
 if(u.unhealable)u.unhealable=false;
 if(u.id==='char_1012_skadi2')u.inspireAura=null;
 const skill=battle.profile(u)?.skill,skillText=skill?.description||'',skillBBValue=skillBB(battle,u);if(/技能结束时.*所有敌人.*法术伤害/.test(skillText)&&Number(skillBBValue.atk_scale)>0)for(const e of enemyActors(battle.s).filter(e=>battle.inside(u,e,true)))dealDamage(battle,{source:u,target:e,amount:battle.stats(u).atk*Number(skillBBValue.atk_scale),type:'arts',cause:'skill'});
 if(u.id!=='char_143_ghost'&&/(?:技能结束后|持续时间结束后).*?(?:晕眩|眩晕)/s.test(skillText)&&Number(skillBBValue.stun)>0)applyStatus(u,'stun',Number(skillBBValue.stun),{source:u.uid,resistible:false});
 if(u.id==='char_4026_vulpis'&&idx===2&&u.vulpisKilled){applyStatus(u,'camouflage',1e9,{source:u.uid,resistible:false});u.vulpisKilled=false;}
 if(u.floatUnits){const elapsed=Math.max(0,battle.s.time-(u.floatStartedAt??battle.s.time));if(u.floatOverdrive&&elapsed>0)applyStatus(u,'stun',elapsed,{source:u.uid,resistible:false});u.floatUnits=0;u.floatTarget=null;u.floatStartedAt=null;u.floatOverdrive=false;}
 if(u.damageProtection){
  const protection=u.damageProtection;u.damageProtection=null;
  if(protection.buffer>0){
   const duration=Math.max(.1,protection.finalDuration||1),interval=Math.min(.1,duration),rate=protection.buffer/duration;
   addEffect(battle,{kind:'loss',sourceUid:u.uid,sourceDeployGen:u.deployGen,targetUid:u.uid,talentOrSkillId:'delayed-loss:'+u.id+':'+u.skillCount,interval,nextAt:battle.s.time+interval,endsAt:battle.s.time+duration,values:{amount:rate*interval},snapshot:{amount:rate*interval},refKind:'owner',persistAfterSourceGone:false});
   log(battle,'damage-buffer-release',{uid:u.uid,amount:protection.buffer,duration});
  }
 }
 if(u.id==='char_143_ghost'&&idx===1){
  u.lockHp=null;applyStatus(u,'stun',skillBB(battle,u).stun||10,{source:u.uid,resistible:false});
 }
 if(u.id==='char_474_glady'&&u.gladyVortex){const center=u.gladyVortex;for(const e of enemyActors(battle.s).filter(e=>e.hp>0&&chebyshev(e,center)<=1.5))moveActor(battle,e,{x:center.x,y:center.y,uid:u.uid},'拖拽');u.gladyVortex=null;}
 if(u.id==='char_4191_tippi')u.flying=false;
 if(u.id==='char_206_gnosis'&&u.gnosisFrozenUids?.length){const bb=skillBB(battle,u);for(const uid of u.gnosisFrozenUids){const target=battle.s.enemies.find(e=>e.uid===uid&&e.hp>0);if(target)dealDamage(battle,{source:u,target,amount:battle.stats(u).atk*(Number(bb.atk_scale)||4),type:'arts',cause:'skill'});}u.gnosisFrozenUids=[];}
 if(u.id==='char_4122_grabds')u.grabdsSleepUntil=null;
 if(u.id==='char_1012_skadi2')for(const ally of battle.s.units)if(ally.damageRedirects)ally.damageRedirects=ally.damageRedirects.filter(row=>row.sourceUid!==u.uid);
 if(u.id==='char_1014_nearl2'&&(u.source?.skillIndex??battle.profile(u).skillIndex)===1&&u.deployed)commitExit(battle,{target:u,reason:'skill'});
 if(u.id==='char_1032_excu2'&&idx===2&&u.excu2Targets?.length){const bb=skillBB(battle,u);for(const uid of u.excu2Targets){const target=battle.s.enemies.find(e=>e.uid===uid&&e.hp>0);if(target)dealDamage(battle,{source:u,target,amount:battle.stats(u).atk*(Number(bb['attack@final_atk_scale'])||2),type:'physical',cause:'skill'});}u.excu2Targets=[];}
 if(u.id==='char_4058_pepe'&&u.pepeKillSp){gainSp(u,skill,u.pepeKillSp,battle.spCost(u));u.pepeKillSp=0;}
 if(u.id==='char_4087_ines'&&idx===2&&u.deployed)commitExit(battle,{target:u,reason:'skill'});
 if(u.id==='char_4193_lemuen'&&u.lemuenTargets?.length){const bb=skillBB(battle,u);for(const uid of u.lemuenTargets){const target=battle.s.enemies.find(e=>e.uid===uid&&e.hp>0);if(target)for(const e of battle.s.enemies.filter(e=>e.hp>0&&Math.max(Math.abs(e.x-target.x),Math.abs(e.y-target.y))<=1.5))dealDamage(battle,{source:u,target:e,amount:battle.stats(u).atk*(e.uid===uid?Number(bb['attack@proj_atk_scale_1'])||3.6:Number(bb['attack@proj_atk_scale_2'])||2.4),type:'physical',cause:'skill'});}u.lemuenTargets=[];u.lemuenNextAt=0;}
 if(u.id==='char_174_slbell'){for(const e of enemyActors(battle.s).filter(e=>(e.statuses||[]).some(s=>s.kind==='attackSpeedDown'&&s.source===u.uid)))e.attackSpeedMod=0;}
 if(u.id==='char_1023_ghost2'&&idx===1){u.lockHp=null;if(u.hp>0)commitExit(battle,{target:u,reason:'forced'});}
 // 返航找落点：原位被别的干员／占格子的召唤物占了，就退到旁边的可部署格。
 if(u.id==='char_4145_ulpia'&&u.returnPosition){const pos=u.returnPosition;u.returnPosition=null;if(!teleportActor(battle,u,{...pos,source:u,mode:'return'})){const fallback=nearbySpots(pos,{maxRadius:2}).find(spot=>canRelocateTo(battle,u,spot.x,spot.y));if(fallback)teleportActor(battle,u,{...fallback,source:u,mode:'return'});}}}

function onOperatorExit(battle,u,reason){
 if(u.id==='char_4087_ines'){for(const e of battle.s.enemies){if(e.inesMarked===u.uid)e.inesMarked=null;if(e.attackSpeedMod<0)e.attackSpeedMod=0;}placeInesSentry(battle,u);}
 for(const fx of battle.s.logicEffects.slice()){
  if(fx.refKind==='live'&&fx.sourceUid===u.uid&&!fx.persistAfterSourceGone)dropEffect(battle,fx,'source-exit');
  if(fx.refKind==='anchor'&&fx.anchorUid===u.uid)dropEffect(battle,fx,'anchor-exit');
 }
 for(const s of (battle.s.summons||[]).slice()){
  if(s.ownerUid===u.uid&&!s.persistAfterSourceGone)commitExit(battle,{target:s,reason:'forced'});
 }
}

const TOKEN_IDS={'silent-drone':'token_10000_silent_healrb','dusk-token':'token_10015_dusk_drgn','nearl2-sun':'token_10019_nearl2_sword','vigil-wolf':'token_10028_vigil_wolf','cathy-device':'token_10041_cathy_catsld','beewax-obelisk':'token_10011_beewax_oblisk','kazema-shadow':'token_10022_kazema_shadow','siege2-golden':'token_10040_siege2_vlion','mlyss-fluid':'token_10030_mlyss_wtrman','swire2-trap':'token_10031_swire2_gdtrap'};
// 荒芜拉普兰德「终幕·浩劫」的特种浮游单元（自由飞行实体，走 battle.s.whitwEyes）。
// 注意：它和凛御银灰待部署区里的「风雪之眼」不是同一种东西——后者本期不实现（见 onOperatorDeploy 的注释）。
// 完整流程见 PRTS：散开 1.3s（初速0.1/加速1.9/上限2.0）→ 索敌飞向（初速2.0/加速1.0/上限4.0/转向1/6每帧）
// → 抵达后持续攻击 → 目标消失则在目标为中心 1.5 边长正方形内随机重定位 → 无可选目标时绕本体左半圆巡航
// （半径0.9、线速1.0、逆时针）→ 技能结束返回干员身边。全程连续坐标，不按格子移动。
export function spawnWhitwEyes(battle,owner,options={}){
 if(!battle?.s||!owner)return [];
 const count=Math.max(0,Math.trunc(Number(options.count)||0));
 if(!count)return [];
 const opts={
  scatter:Number(options.scatter)||1,
  radius:Number(options.radius)||.9,
  moveSlow:Math.abs(Number(options.moveSlow)||.3),
  magicScale:Number(options.magicScale)||1,
  atkTimes:Number(options.atkTimes)||1,
  fear:Number(options.fear)||2,
 };
 const eyes=battle.s.whitwEyes??=[];
 const headings=fanHeadings(Number(owner.dir)||0,count);
 for(let i=0;i<count;i++){
  const eye={uid:battle.s.nextId++,ownerUid:owner.uid,ownerDeployGen:owner.deployGen,x:owner.x,y:owner.y,skillCount:owner.skillCount??0,targetUid:null,nextAttackAt:0,retargetAt:0,startedAt:battle.s.time,...opts};
  setFlightVelocity(eye,FLIGHT_PRESETS.litter.scatter.speed,headings[i]);
  eye.travel.phase=FLIGHT_MODES.SCATTER;eye.travel.phaseLeft=FLIGHT_PRESETS.litter.scatterSeconds;
  eyes.push(eye);
 }
 battle.emit('summon',{uid:owner.uid,x:owner.x,y:owner.y,type:'whitw-eye',count});
 return eyes;
}
function whitwEyesOf(battle,owner){return (battle?.s?.whitwEyes||[]).filter(e=>e.ownerUid===owner.uid&&e.skillCount===(owner.skillCount??0));}
function whitwEyeTarget(battle,eye,owner){
 const candidates=enemyActors(battle.s).filter(e=>!e.hidden&&!e.untargetable&&!e.invisible);
 if(!candidates.length)return null;
 const self=distanceBetween(eye,{x:eye.x,y:eye.y});
 let best=null,bestKey=Infinity;
 for(const e of candidates){
  const selfDistance=Math.hypot(e.x-(eye.x??0),e.y-(eye.y??0));
  const ownerDistance=Math.hypot(e.x-(owner.x??0),e.y-(owner.y??0));
  const key=selfDistance+(ownerDistance<=selfDistance?0:1e3);
  if(key<bestKey){bestKey=key;best=e;}
 }
 return best;
}
 function whitwEyeOptions(u){return {count:u.whitwEyeCount||0,scatter:u.whitwEyeScatter??1,radius:u.whitwEyeRadius??.9,moveSlow:u.whitwEyeSlow??.3,magicScale:u.whitwEyeMagic??1,atkTimes:u.whitwEyeTimes??1,fear:u.whitwEyeFear??2};}
export function tickWhitwEyes(battle,dt){
 const eyes=battle?.s?.whitwEyes;
 const unit=(battle?.s?.units||[]).find(u=>u.id==='char_1038_whitw2'&&u.deployed&&u.hp>0&&battle.skillActive(u));
 if(unit){
  const live=(eyes||[]).filter(e=>e.ownerUid===unit.uid&&e.skillCount===(unit.skillCount??0));
  if(!live.length)spawnWhitwEyes(battle,unit,whitwEyeOptions(unit));
 }
 if(!eyes?.length)return;
 const now=battle.s.time;
 for(const eye of eyes){
  const owner=getActor(battle.s,eye.ownerUid);
  if(!owner){eye.dead=true;continue;}
  const active=(owner.skillCount??0)===eye.skillCount&&battle.skillActive(owner);
  eye.ownerX=owner.x;eye.ownerY=owner.y;
  if(!active){
   // 技能结束：返回干员身边，抵达后消失
   const arrival=stepFlight(eye,dt,{accel:FLIGHT_PRESETS.litter.chase.accel,maxSpeed:FLIGHT_PRESETS.litter.chase.maxSpeed,destination:owner});
   if(arrival.arrived)eye.dead=true;
   continue;
  }
  // 周围敌人减速 + 每秒法术伤害（不叠加）
  const radius=eye.radius;
  for(const e of enemyActors(battle.s)){
   if(Math.hypot(e.x-eye.x,e.y-eye.y)>radius)continue;
   applyStatus(e,'sluggish',.6,{source:owner.uid,value:-eye.moveSlow,resistible:false});
   eye.nextAuraAt??=now;
   if(now+1e-9>=eye.nextAuraAt)dealDamage(battle,{source:owner,target:e,amount:battle.stats(owner).atk*eye.magicScale,type:'arts',cause:'skill',skill:true});
  }
  if(now+1e-9>=eye.nextAuraAt)eye.nextAuraAt=now+1;
  const travel=eye.travel;
  if(travel.phase===FLIGHT_MODES.SCATTER){
   stepFlight(eye,dt,{accel:FLIGHT_PRESETS.litter.scatter.accel,maxSpeed:FLIGHT_PRESETS.litter.scatter.maxSpeed,bounds:flightBounds(battle)});
   travel.phaseLeft-=dt;
   if(travel.phaseLeft<=0){travel.phase=FLIGHT_MODES.CHASE;travel.phaseLeft=0;}
   continue;
  }
  let target=eye.targetUid!=null?getActor(battle.s,eye.targetUid):null;
  if(target&&(target.hp<=0||target.hidden||target.untargetable))target=null;
  if(!target&&now+1e-9>=eye.retargetAt){target=whitwEyeTarget(battle,eye,owner);eye.targetUid=target?.uid??null;eye.retargetAt=now+1;}
  if(!target){
   orbitStep(eye,owner,dt,{radius:.9,lineSpeed:1,direction:1});
   continue;
  }
  const beforeX=eye.x,beforeY=eye.y;
  faceTarget(eye,target,{turnPerFrame:FLIGHT_PRESETS.litter.chase.turnPerFrame,dt});
  const arrival=stepFlight(eye,dt,{accel:FLIGHT_PRESETS.litter.chase.accel,maxSpeed:FLIGHT_PRESETS.litter.chase.maxSpeed,destination:target,bounds:flightBounds(battle),arrive:FLIGHT_PRESETS.litter.arrive});
  // 目标在地图边界外时会被边界夹住，此时按“已抵达”处理，避免永远追不上而不攻击
  const pinned=Math.hypot(eye.x-beforeX,eye.y-beforeY)<1e-6&&distanceBetween(eye,target)>FLIGHT_PRESETS.litter.arrive;
  if((arrival.arrived||pinned)&&now+1e-9>=eye.nextAttackAt){
   eye.nextAttackAt=now+Math.max(.1,1/(eye.atkTimes||1));
   dealDamage(battle,{source:owner,target,amount:battle.stats(owner).atk*(eye.atkTimes||1),type:'arts',cause:'skill',skill:true});
   applyStatus(target,'fear',eye.fear,{source:owner.uid,resistible:false});
  }
  if(target.hp<=0){
   const spot=randomPointInSquare(target,.75,()=>battle.economy.random());
   eye.x=spot.x;eye.y=spot.y;eye.targetUid=null;eye.retargetAt=0;
   setFlightVelocity(eye,FLIGHT_PRESETS.litter.chase.speed,travel.heading);
  }
 }
 for(const eye of eyes)if(eye.dead)log(battle,'exit',{uid:eye.uid,reason:'skill-end',kind:'summon'});
 battle.s.whitwEyes=eyes.filter(e=>!e.dead);
}
export function spawnSummon(battle,owner,spec){
 const tokenId=spec.tokenId||TOKEN_IDS[spec.type]||('synthetic_'+spec.type);let entity=battle.data.tokens?.[tokenId];if(!entity&&spec.synthetic){const attributes={maxHp:Math.max(1,owner.maxHp*.2),atk:Math.max(1,battle.stats(owner).atk*.3),def:0,magicResistance:0,blockCnt:0,baseAttackTime:1,attackSpeed:100,cost:0};entity={name:spec.name||spec.type,phases:[{maxLevel:1,rangeId:null,attributesKeyFrames:[{level:1,data:attributes}]}],skillRefs:[]};}
 if(!entity)throw Error('缺少固定召唤物数据 '+spec.type);
 const ctrl=owner.summonCtrl,live=battle.s.summons.filter(x=>x.ownerUid===owner.uid&&x.type===spec.type&&x.deployed);
  if(ctrl&&((!spec.preparedCard&&(ctrl.stock??0)<=0)||live.length>=ctrl.cap))return null;
 const occupied=new Set(alliedActors(battle.s).filter(x=>x.occupiesTile!==false&&(x.kind!=='summon'||(x.deployed&&x.hp>0))).map(x=>x.x+','+x.y));
 const candidates=spec.x!=null?[[spec.x,spec.y]]:[[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy])=>[owner.x+dx,owner.y+dy]);
 const position=candidates.find(([x,y])=>{const tile=battle.map.grid[y]?.[x];return tile&&tile.buildableType!=='NONE'&&!tile.obstacle&&(!spec.canBlock||tile.heightType!=='HIGHLAND')&&(spec.occupiesTile===false||!occupied.has(x+','+y))&&(spec.type!=='vigil-wolf'||battle.inside(owner,{x,y}));});
 if(!position)return null;
 const [x,y]=position,a=nativeAttributes(entity,battle.profile(owner).status).attributes,uid=battle.s.nextId++,canBlock=spec.canBlock??a.blockCnt>0,canAttack=spec.canAttack??(a.baseAttackTime>0&&entity.skillRefs?.some(r=>r.skillId));
 const row={uid,id:tokenId,ownerUid:owner.uid,ownerDeployGen:owner.deployGen,type:spec.type||tokenId,name:spec.name||entity.name,kind:'summon',allied:true,x,y,dir:owner.dir,hp:spec.maxHp??a.maxHp,maxHp:spec.maxHp??a.maxHp,atk:spec.atk??a.atk,def:a.def,res:a.magicResistance,damageResistance:spec.damageResistance||0,elementalImmune:!!spec.elementalImmune,isolated:!!spec.isolated,cost:tokenCostFor(battle.profile(owner),tokenId,a.cost),interval:spec.interval??a.baseAttackTime,attackSpeed:spec.attackSpeed??a.attackSpeed,attackCooldown:0,action:null,deployed:true,deployGen:1,statuses:[],immunities:{...(spec.immunities||{})},shield:0,barriers:[],shieldLayers:[],targetable:spec.targetable!==false,healable:spec.healable!==false,canBlock,canAttack,canHeal:spec.canHeal??false,flying:!!spec.flying,blockCnt:spec.blockCnt??a.blockCnt,blockCost:1,persistAfterSourceGone:!!spec.persistAfterSourceGone,endsAt:spec.duration?battle.s.time+spec.duration:null,occupiesTile:spec.occupiesTile??canBlock,lives:spec.lives,nextLifeAt:spec.nextLifeAt,anchorUid:spec.anchorUid,nextHealAt:battle.s.time+a.baseAttackTime,nextAuraAt:spec.type==='ghost2-substitute'?battle.s.time+1:null};
  battle.s.summons.push(row);if(ctrl&&!spec.preparedCard)ctrl.stock--;
 log(battle,'summon',{uid,ownerUid:owner.uid,type:spec.type,x,y});return row;
}

function tickSummons(battle,dt){
 for(const s of battle.s.summons.slice()){
  if(s.endsAt!=null&&battle.s.time>=s.endsAt){commitExit(battle,{target:s,reason:'forced'});continue;}
  if(s.canHeal&&battle.s.time+1e-9>=s.nextHealAt){for(const a of alliedActors(battle.s).filter(v=>v.deployed&&v.hp>0&&chebyshev(s,v)<=1&&v.healable!==false))applyHeal(battle,{source:s,target:a,amount:s.atk,origin:s});s.nextHealAt+=s.interval;}
  if(s.type==='ghost2-substitute'&&s.deployed&&s.hp>0){const owner=getActor(battle.s,s.ownerUid),talent=owner&&activeTalentsOf(battle,owner).find(t=>t.name==='拥抱自我'),bb=talent?.values||{};s.nextAuraAt??=battle.s.time+1;if(battle.s.time+1e-9>=s.nextAuraAt){s.nextAuraAt+=1;for(const e of enemyActors(battle.s).filter(e=>chebyshev(s,e)<=1)){applyStatus(e,'sluggish',1.1,{source:s.uid,resistible:false});dealDamage(battle,{source:owner||s,target:e,amount:(owner?battle.stats(owner).atk:s.atk)*(Number(bb.atk_scale)||.4),type:'arts',cause:'skill'});}}}
  if(s.type==='cetsyr-dust'&&s.deployed&&s.hp>0){const owner=getActor(battle.s,s.ownerUid);if(owner&&battle.skillActive(owner)){s.nextAuraAt??=battle.s.time+1;if(battle.s.time+1e-9>=s.nextAuraAt){s.nextAuraAt+=1;for(const e of enemyActors(battle.s).filter(e=>chebyshev(owner,e)<=2)){dealDamage(battle,{source:owner,target:e,amount:battle.stats(owner).atk*(Number(skillBB(battle,owner).atkScale)||2.2),type:'true',cause:'skill'});applyStatus(e,'root',Number(skillBB(battle,owner).unmoveable_duration)||3,{source:owner.uid,resistible:false});}}}}
  if(s.type==='swire2-trap'&&s.deployed&&s.hp>0){
   const owner=getActor(battle.s,s.ownerUid),touching=enemyActors(battle.s).filter(e=>!e.hidden&&chebyshev(s,e)<=.5).sort((a,b)=>a.uid-b.uid)[0];
   if(touching&&!s.trapTriggered){s.trapTriggered=true;s.trapTargetUid=touching.uid;s.trapExtraAt=battle.s.time+3;dealDamage(battle,{source:owner||s,target:touching,amount:(owner?battle.stats(owner).atk:s.atk)*(s.trapScale||1),type:'physical',cause:'skill',skill:true});applyStatus(touching,'sluggish',s.trapSlow||2,{source:owner?.uid||s.uid});log(battle,'trap-trigger',{uid:s.uid,targetUid:touching.uid,ownerUid:owner?.uid});}
   if(s.trapTriggered&&s.trapExtraAt!=null&&battle.s.time+1e-9>=s.trapExtraAt&&!s.trapExtraUsed){s.trapExtraUsed=true;const target=getActor(battle.s,s.trapTargetUid);if(target?.hp>0)dealDamage(battle,{source:owner||s,target,amount:(owner?battle.stats(owner).atk:s.atk)*(s.trapScale||1),type:'physical',cause:'skill',skill:true});commitExit(battle,{target:s,reason:'forced'});}
  }
  if(s.type==='vigil-wolf'&&battle.s.time>=s.nextLifeAt){s.lives=Math.min(3,(s.lives||0)+1);s.blockCnt=s.lives;s.nextLifeAt+=25;if(s.hp<=0){s.hp=s.maxHp;s.deployed=true;s.targetable=true;s.deployGen++;s.exitLife=null;}}
  if(s.type==='yan-guardian'&&s.deployed&&s.hp>0){
   if(tickYanSkill(battle,s,dt))continue;
   // 自由飞行：连续坐标推进（不按格子移动）。追踪全场仇恨最高的敌人，进入攻击范围（2.0 格）即停；
   // 场上无可选敌人时飞向随机地块。移动速度取单位数据的 1 格/秒。
   const bounds=flightBounds(battle);
   const target=yanTargets(battle,s,1)[0];
   if(target){
    s.yanAim=null;
    const heading=faceTarget(s,target,{turnPerFrame:FLIGHT_PRESETS.guardian.chase.turnPerFrame,dt});
    const gap=distanceBetween(s,target);
    if(gap>Number(s.yanRange||2))stepFlight(s,dt,{accel:FLIGHT_PRESETS.guardian.chase.accel,maxSpeed:Number(s.moveSpeed||1),bounds});
    else setFlightVelocity(s,0,heading);
   }else{
    const aim=s.yanAim||(s.yanAim=yanWanderPoint(battle));
    // 漫游不受转向限制：直接朝目标点飞
    s.travel=ensureFlight(s);s.travel.heading=Math.atan2(aim.y-s.y,aim.x-s.x);
    const flight=stepFlight(s,dt,{accel:FLIGHT_PRESETS.guardian.chase.accel,maxSpeed:Number(s.moveSpeed||1),bounds,arrive:.2});
    if(flight.arrived)s.yanAim=null;
   }
   const inAttackRange=Boolean(target)&&distanceBetween(s,target)<=Number(s.yanRange||2);
   s.attackCooldown=Math.max(0,(s.attackCooldown||0)-dt);
   if(s.attackCooldown<=0&&inAttackRange){
    const inRange=yanTargets(battle,s,99).filter(e=>distanceBetween(s,e)<=Number(s.yanRange||2));
    if(inRange.length)for(const e of inRange.slice(0,s.yanTargets||3))yanDamage(battle,s,e,1);
    s.attackCooldown=s.interval||2.5;
   }
   // 「祛恶之焰」需先飞入射程再开启：否则炎佑第一帧就原地施法，永远不会移动
   if(s.yanSkillSp>=s.yanSkillCost&&inAttackRange&&battle.s.time>=Number(s.yanSkillNextAt||0))startYanSkill(battle,s);
   continue;
  }
  if(s.canAttack&&s.deployed&&s.hp>0){s.attackCooldown=Math.max(0,(s.attackCooldown||0)-dt);if(s.attackCooldown<=0){const e=enemyActors(battle.s).filter(x=>!x.hidden).sort((a,b)=>chebyshev(s,a)-chebyshev(s,b)||a.uid-b.uid)[0];if(e&&chebyshev(s,e)<=(s.range||1.1)){const buff=s.vigilBuff;for(let i=0;i<(s.lives??1);i++)dealDamage(battle,{source:s,target:e,amount:s.atk*(buff?.scale||1),type:s.damageType||'physical',cause:'attack'});if(buff){const owner=getActor(battle.s,s.ownerUid);if(owner)applyHeal(battle,{source:owner,target:owner,amount:owner.maxHp*buff.heal});s.vigilBuff=null;}s.attackCooldown=s.interval||1;}}}
  }
  for(const owner of battle.s.units.filter(u=>u.id==='char_1012_skadi2'&&u.deployed&&u.hp>0&&u.summonRespawnAt!=null&&battle.s.time>=u.summonRespawnAt)){
   if(battle.s.summons.some(s=>s.ownerUid===owner.uid&&s.type==='skadi2-seaborn'&&s.deployed))continue;
   const talent=activeTalentsOf(battle,owner).find(t=>t.name==='远古血亲');
   if(talent){const token=spawnSummon(battle,owner,{type:'skadi2-seaborn',tokenId:'token_10017_skadi2_dedant',name:'海嗣',targetable:true,canBlock:true,canAttack:true,occupiesTile:true,duration:Number((talent.description||'').match(/持续(\d+)秒/)?.[1])||30,persistAfterSourceGone:false});if(token)owner.summonRespawnAt=null;}
  }
  for(const owner of battle.s.units.filter(u=>u.id==='char_4162_cathy'&&u.deployed&&u.hp>0)){
  const ctrl=owner.summonCtrl;if(!ctrl)continue;const devices=battle.s.summons.filter(s=>s.ownerUid===owner.uid&&s.type==='cathy-device');
  if(!ctrl.manualSummonCards)for(const target of battle.s.units.filter(t=>t.uid!==owner.uid&&t.deployed&&t.hp>0&&!devices.some(s=>s.anchorUid===t.uid))){if(ctrl.stock<=0||devices.length>=ctrl.cap)break;const device=spawnSummon(battle,owner,{type:'cathy-device',name:'支援装置',targetable:false,healable:false,canBlock:false,anchorUid:target.uid});if(device){device.nextShieldAt=battle.s.time+1;device.shieldId='cathy-'+target.uid;device.shieldCap=battle.stats(owner).maxHp*.2;grantShield(battle,target,{id:device.shieldId,amount:device.shieldCap,sourceUid:owner.uid});devices.push(device);}}
  for(const device of devices){const target=getActor(battle.s,device.anchorUid);if(!target?.deployed)continue;if(battle.s.time>=device.nextShieldAt){device.nextShieldAt+=1;const ownerSkill=owner.source?.skillIndex??battle.profile(owner).skillIndex,obb=ownerSkill===1?skillBB(battle,owner):null;if(ownerSkill===1){const cap=device.shieldCap,layer=target.shieldLayers.find(l=>l.id===device.shieldId),remaining=Math.min(cap,(layer?.remaining||0)+battle.stats(owner).maxHp*(Number(obb.overwrite_ratio)||.06));grantShield(battle,target,{id:device.shieldId,amount:remaining,sourceUid:owner.uid});}else if(battle.s.time-(target.lastDamagedAt??-999)>=5){const layer=target.shieldLayers.find(l=>l.id===device.shieldId),remaining=Math.min(device.shieldCap,(layer?.remaining||0)+battle.stats(owner).maxHp*.06);grantShield(battle,target,{id:device.shieldId,amount:remaining,sourceUid:owner.uid});}}}
 }
}

export function newAttackId(battle){return battle.s.settle.nextAttackId++;}

export function blockingActors(battle){
 return attackableAllies(battle.s).filter(u=>u.canBlock!==false&&(u.kind!=='summon'||u.canBlock));
}
