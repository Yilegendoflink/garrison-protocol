import {applyDamage,recoverHP,damage} from './combat.js';
import {applyStatus} from './status.js';
import {blackboard,resolveActiveTalents,nativeAttributes} from './protocol.js';
import {gainSp} from './native-sp.js';
import {statMods,onEvent,operatorSkillStart,periodicMods,skillConfig,targetFilter,damageReductionFor,talentValues,grantCoins,coinCapFor,coinGainAtSkillStart,tokenCostFor} from './native-operator-effects.js';

export const BATTLE_SCHEMA_VERSION=1;
export const EFFECT_KINDS=new Set(['dot','hot','regen','loss','delayed','zone','attached','aura','guard','barrier','lock','stat']);
export const ELEMENT_TYPES=new Set(['neural','burn','necrosis','corrosion','elemental']);
const QUEUE_CAP=256,ANCESTOR_CAP=32;

export function emptySettle(){return {nextEventId:1,nextAttackId:1,nextEffectId:1,nextSeq:1,queue:[],consumed:[],byId:{},fault:null};}
export function ensureBattleShape(s){
 s.battleSchemaVersion??=BATTLE_SCHEMA_VERSION;
 s.cost??=20;s.costInitial??=20;s.costMin??=0;s.costMax??=99;s.costRecoveryInterval??=1;s.costRecoveryClock??=0;s.enemyCostRecoveryMultiplier??=1;s.enemyRespawnTimeMultiplier??=1;
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
 try{while(st.queue.length){
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
  if(target.type==='vigil-wolf'&&reason==='knockdown'){target.lives=0;target.blockCnt=0;target.targetable=false;}else battle.s.summons=battle.s.summons.filter(x=>x.uid!==target.uid);
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
  dispatch(battle,'enemy-death',{target,killer,reason,event});
  return true;
 }
 if(target.exitLife===lifeKey(target))return false;
 target.exitLife=lifeKey(target);
 if(target.kind!=='summon'&&target.deployed)target.redeployPenalty=Math.min(2,(target.redeployPenalty||0)+1);
 if(target.kind!=='summon'&&reason==='retreat'&&target.refundEligible&&target.deploymentCost>0){const profile=battle.profile(target),hasRefundRatio=target.refundRatio!=null&&Number.isFinite(Number(target.refundRatio)),rate=hasRefundRatio?Number(target.refundRatio):profile.branch==='charger'?1:profile.branch==='merchant'?0:.5,cap=target.refundIgnoresCap?target.deploymentCost:(target.refundCap??target.deploymentCost),refund=Math.floor(Math.min(target.deploymentCost*Math.max(0,rate),cap));if(refund>0)battle.gainCost?.(refund);target.refundEligible=false;}
 target.deployed=false;target.downed=false;target.action=null;target.skillLeft=0;target.ammo=0;
 if(reason==='knockdown')target.hp=0;
 if(reason==='forced'||reason==='skill'||reason==='merchant-fee'){target.hp=0;target.down=battle.respawnTime?battle.respawnTime(target):battle.stats(target).respawnTime;target.downMax=target.down;}
 else{
  target.down=battle.respawnTime?battle.respawnTime(target):battle.stats(target).respawnTime;
  if(battle.s.band==='band_emperor')target.down*=.5;
  if(battle.s.band==='band_ermengard'&&(battle.s.revives||0)<3){battle.s.revives=(battle.s.revives||0)+1;target.down=0;}
  if(battle.on?.('indomShip')&&battle.profile(target).position==='MELEE'&&battle.economy.random()<.18+.004*(battle.layers.indomShip||0))target.down=0;
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
 target.deployed=true;target.downed=false;target.down=0;target.exitLife=null;target.action=null;target.skillLeft=0;target.ammo=0;target.shieldLayers=[];target.shield=0;if(target.blazeDownUsed){target.healable=target.blazeHealable!==false;target.blazeHealable=null;target.blazeRegen=0;target.blazeStun=0;}target.hp=Math.max(1,Math.min(target.maxHp,target.maxHp*Math.max(0,Math.min(1,hpRatio))));
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
 if(target.id==='char_350_surtr'&&!target.surtrLock){
  const t=activeTalentsOf(battle,target).find(x=>x.name==='余烬');if(!t)return false;
  target.lockHp={min:1,endsAt:battle.s.time+(t.values['surtr_t_2[withdraw].interval']??8),onEnd:'forced'};
  target.surtrLock=true;target.hp=Math.max(1,target.hp);
  log(battle,'fatal-lock',{uid:target.uid,eventId:event.eventId,until:target.lockHp.endsAt});
  return true;
 }
 if(target.id==='char_1033_swire2'){
  const t=activeTalentsOf(battle,target).find(x=>x.name==='破财消灾');
  if(t){const base=Math.abs(Number(t.values.cost)||5),times=target.merchantRescueCount||0,cost=base*Math.pow(Number(t.values.cost_multi)||2,times);if(battle.spendCost?.(cost)){target.merchantRescueCount=times+1;target.hp=target.maxHp*(Number(t.values.hp_ratio)||.7);log(battle,'fatal-cost-save',{uid:target.uid,cost,hp:target.hp,eventId:event.eventId});return true;}}
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
 const reduction=damageReductionFor(battle,target,type);if(reduction>0)value*=1-reduction;
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

export function applyElementDamage(battle,{source,target,amount,type='elemental',cause='element',parentEventId=null}={}){
 if(!target||target.hp<=0||!Number.isFinite(amount)||amount<=0||!ELEMENT_TYPES.has(type))return {added:0,burst:false};
 target.elemental??={};target.elementalMax??=target.maxHp;
 const before=target.elemental[type]||0,limit=target.elementalMax,added=Math.min(amount,Math.max(0,limit-before));target.elemental[type]=before+added;
 const event=nextEvent(battle,{cause,parentEventId,type:'element',sourceUid:source?.uid,targetUid:target.uid});log(battle,'element',{eventId:event.eventId,sourceUid:source?.uid,targetUid:target.uid,element:type,amount:added,current:target.elemental[type],max:limit});
 let burst=false;if(target.elemental[type]>=limit){target.elemental[type]=0;target.elementBurst=(target.elementBurst||0)+1;burst=true;dispatch(battle,'element-burst',{source,target,element:type,event});}
 return {added,burst};
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
  const same=battle.s.logicEffects.find(e=>e.kind===row.kind&&e.talentOrSkillId===row.talentOrSkillId&&e.targetUid===row.targetUid&&e.sourceUid===row.sourceUid);
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
 for(const e of battle.s.enemies||[])if(e.damageRedirects)e.damageRedirects=e.damageRedirects.filter(row=>row.endsAt==null||row.endsAt>now);
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
 for(const u of battle.s.units)periodicMods(battle,u,ctxFor(battle));
 tickSummons(battle,dt);
}

function ctxFor(battle){return {dealDamage,applyHeal,applyRegen,applyLoss,applyElementDamage,grantShield,addDamageRedirect,queueDelayedDamage,reviveActor,gainSp,addEffect,moveActor,teleportActor,spawnSummon,log:(b,t,p)=>log(b,t,p)};}

function zoneActors(battle,fx,side){
 const cx=fx.x,cy=fx.y,r=fx.radius??1;
 const pool=side==='enemy'?enemyActors(battle.s):alliedActors(battle.s).filter(u=>u.deployed&&u.hp>0);
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
 }else if(fx.kind==='regen'){
  const targets=fx.targetUid?[getActor(battle.s,fx.targetUid)]:alliedActors(battle.s).filter(u=>u.deployed&&u.hp>0);
  const amount=fx.snapshot?.regen??fx.values?.regen??0;
  for(const t of targets)if(t)applyRegen(battle,{source,target:t,amount});
 }else if(fx.kind==='loss'){
  const t=getActor(battle.s,fx.targetUid);if(t)applyLoss(battle,{target:t,amount:fx.values?.amount||0,source,effectId:fx.id});
 }else if(fx.kind==='zone'){
  if(fx.values?.dot)for(const e of zoneActors(battle,fx,'enemy'))if(!fx.values.requiresStatus||(e.statuses||[]).some(s=>s.kind===fx.values.requiresStatus))dealDamage(battle,{source,target:e,amount:fx.snapshot?.damage??(source?battle.stats(source).atk:0)*(fx.values.atk_scale||1),type:fx.values?.type||'arts',cause:'dot',effectId:fx.id});
  if(fx.values?.sluggish)for(const e of zoneActors(battle,fx,'enemy'))applyStatus(e,'sluggish',fx.interval||1,{source:source?.uid,resistible:false});
  if(fx.values?.silence)for(const e of zoneActors(battle,fx,'enemy'))applyStatus(e,'silence',fx.interval||1,{source:source?.uid,resistible:false});
  if(fx.values?.hot)for(const a of zoneActors(battle,fx,'ally'))applyHeal(battle,{source,target:a,amount:fx.values.hot,effectId:fx.id});
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
 for(const e of enemyActors(battle.s))e.fragile=null;
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
  if(src.id==='char_1012_skadi2'&&src.inspireAura&&battle.s.time<src.inspireAura.endsAt)auras.push({key:'skadi2-inspire',stat:'atkFlat',layer:'inspire',v:src.inspireAura.value,src:'浊心斯卡蒂',ok:v=>v.uid===src.uid||battle.inside(src,v,true)});
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
  else if(a.stat==='maxHp')ratio.maxHp+=a.v;
  else if(a.stat==='def')ratio.def+=a.v;
  else if(a.stat==='attackSpeed')attackSpeed+=a.v;
  else if(a.stat==='magicResistance')magicResistance+=a.v;
  else if(a.stat==='spRecoveryPerSec')spRecoveryPerSec+=a.v;
  note(a.stat,a.layer,a.v,a.src);
 }
  for(const a of Object.values(maxSame)){if(a.stat==='spRecoveryPerSec')spRecoveryPerSec+=a.v;else if(a.stat==='atk')ratio.atk+=a.v;else if(a.stat==='attackSpeed')attackSpeed+=a.v;else if(a.stat==='def')ratio.def+=a.v;note(a.stat,'maxSame',a.v,a.src);}
 return {add,ratio,finalAdd,attackSpeed,magicResistance,spRecoveryPerSec,parts};
}

function validMoveTile(battle,target,x,y,{allowOccupied=false,allowFlyOnly=false}={}){
 const tile=battle.map.grid[y]?.[x];if(!tile||tile.passableMask==='NONE'||(!allowFlyOnly&&tile.passableMask==='FLY_ONLY')||tile.obstacle)return false;
 if(allowOccupied)return true;
 const alliedTarget=battle.s.units.includes(target)||(battle.s.summons||[]).includes(target);
 const occupants=alliedTarget?enemyActors(battle.s):alliedActors(battle.s);
 const occupied=new Set(occupants.filter(a=>a!==target&&a.deployed!==false&&a.occupiesTile!==false).map(a=>a.x+','+a.y));return !occupied.has(x+','+y);
}
export function teleportActor(battle,target,{x,y,source=null,mode='teleport',allowOccupied=false}={}){
 if(!target||target.hp<=0||target.hidden||x==null||y==null)return false;
 const nx=Math.round(x),ny=Math.round(y);if(!validMoveTile(battle,target,nx,ny,{allowOccupied,allowFlyOnly:true}))return false;
 target.x=nx;target.y=ny;target.block=null;target.action=null;log(battle,'move',{uid:target.uid,sourceUid:source?.uid,x:nx,y:ny,mode});battle.emit('move',{uid:target.uid,x:nx,y:ny,mode});return true;
}
export function moveActor(battle,target,source,description=''){
 if(!target||target.hp<=0||target.hidden||target.levitated)return false;
 const away=/推开|推动|击退/.test(description),toward=/拖拽|拉向|拉至/.test(description);if(!away&&!toward)return false;
 const dx=target.x-source.x,dy=target.y-source.y,len=Math.hypot(dx,dy)||1,step=away?1:-1,nx=Math.round(target.x+(dx/len)*step),ny=Math.round(target.y+(dy/len)*step);
 if(!validMoveTile(battle,target,nx,ny))return false;
 return teleportActor(battle,target,{x:nx,y:ny,source,mode:away?'push':'pull'});
}

export function dispatch(battle,type,payload){
 const {source,target,event}=payload;
 const ctx={dealDamage,applyHeal,applyRegen,applyLoss,applyElementDamage,grantShield,addDamageRedirect,queueDelayedDamage,reviveActor,gainSp,addEffect,moveActor,teleportActor,spawnSummon,log:(b,t,p)=>log(b,t,p)};
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
  if(source&&source.id==='char_4137_udflow'&&(payload.cause==='attack'||payload.cause==='skill')&&target){
   const t=activeTalentsOf(battle,source).find(x=>x.name==='细胞活性抑制剂');
   if(t)addEffect(battle,{kind:'dot',sourceUid:source.uid,sourceDeployGen:source.deployGen,targetUid:target.uid,talentOrSkillId:'udflow-t1',interval:t.values.interval||1,nextAt:battle.s.time+(t.values.interval||1),endsAt:battle.s.time+(t.values.duration||3),stackRule:'refresh',values:{damage:t.values.damage||80,type:'arts'},snapshot:{damage:t.values.damage||80},refKind:'owner',persistAfterSourceGone:true});
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
   if(t)grantShield(battle,payload.target,{amount:battle.stats(source).atk*(t.values['attack@scale']||.2),endsAt:battle.s.time+(t.values['attack@shield_duration']||8),sourceUid:source.uid,id:'papyrs-'+source.uid+'-'+payload.target.uid});
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
 if(type==='deploy')onOperatorDeploy(battle,payload.target);
 if(type==='skill-start')return !!payload.genericSuppress||!!onSkillStart(battle,payload.target);
 if(type==='skill-end')onSkillEnd(battle,payload.target,payload.reason);
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
function grantGuard(battle,target,spec){
 target.barriers??=[];
 const g={id:spec.id||('g-'+battle.s.settle.nextEffectId++),charges:spec.charges??1,types:spec.types||null,sourceUid:spec.sourceUid,endsAt:spec.endsAt};
 target.barriers.push(g);log(battle,'guard-add',{uid:target.uid,id:g.id,charges:g.charges});return g;
}

function onOperatorDeploy(battle,u){
 u.exitLife=null;u.revivedThisLife=false;u.surtrLock=false;u.lumenHotPending=false;
 if(u.id==='char_1033_swire2'&&(u.source?.skillIndex??battle.profile(u).skillIndex)<2){u.coinCap=coinCapFor(battle.profile(u));u.coinSkillEnabled=true;const opening=coinGainAtSkillStart(battle,u);if(opening)grantCoins(u,opening,u.coinCap);}
 if(u.id==='char_496_wildmn'&&(u.source?.skillIndex??battle.profile(u).skillIndex)===0){const bb=skillBB(battle,u);u.wildmaneAspd=Number(bb.attack_speed)||100;u.wildmaneAspdUntil=battle.s.time+(Number(battle.profile(u).skill?.duration)||25);}
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
 if(u.id==='char_427_vigil'){u.summonCtrl={stock:1,cap:1,type:'wolf'};spawnSummon(battle,u,{type:'vigil-wolf',name:'狼群',targetable:true,canBlock:true,canAttack:true,blockCnt:2,lives:2,nextLifeAt:battle.s.time+25,occupiesTile:true});}
 if(u.id==='char_4162_cathy'){const t=activeTalentsOf(battle,u).find(t=>t.name==='定向支援信号');u.summonCtrl={stock:t?.values.cnt??3,cap:2,type:'device'};}
 if(u.id==='char_108_silent'&&(u.source?.skillIndex??battle.profile(u).skillIndex)===1){u.summonCtrl.stock=1;spawnSummon(battle,u,{type:'silent-drone',name:'医疗探机',targetable:false,healable:false,canHeal:true,duration:10,persistAfterSourceGone:true});}
 if(u.id==='char_1023_ghost2'){spawnSummon(battle,u,{type:'ghost2-substitute',tokenId:'token_10024_ebnhlz_rcube',name:'旧日残影',targetable:false,healable:false,canBlock:false,canAttack:false,occupiesTile:false,persistAfterSourceGone:false});}
 u.duskFirstAttack=false;
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
 if(u.id==='char_4016_kazema'&&idx===1){spawnSummon(battle,u,{type:'kazema-shadow',name:'纸偶',targetable:true,canBlock:true,canAttack:true,occupiesTile:true,duration:u.skillLeft});}
 if(u.id==='char_1019_siege2'&&idx===2){spawnSummon(battle,u,{type:'siege2-golden',name:'黄金盟誓',targetable:true,canBlock:true,canAttack:true,occupiesTile:true,duration:u.skillLeft});}
 if(u.id==='char_1033_swire2'&&idx===1){
  const target=battle.targets(u)[0],cfg=skillConfig(battle.profile(u)),range=battle.range(u,true),candidates=[...(target?[target]:[]),...range.map(p=>({x:p.x,y:p.y}))];
  let token=null;
  for(const point of candidates){const tile=battle.map.grid[point.y]?.[point.x];if(!tile||tile.buildableType==='NONE'||tile.obstacle||tile.heightType==='HIGHLAND')continue;token=spawnSummon(battle,u,{type:'swire2-trap',name:'香槟炸弹',targetable:false,healable:false,canBlock:false,canAttack:false,occupiesTile:false,x:point.x,y:point.y});if(token)break;}
  if(token){token.trapScale=Number(cfg.bb.atkScale)||1.4;token.trapSlow=Number(cfg.bb.sluggish)||2;token.trapTriggered=false;token.trapExtraAt=null;token.trapExtraUsed=false;}
  return true;
 }
 if(u.id==='char_249_mlyss'&&idx===2){const token=spawnSummon(battle,u,{type:'mlyss-fluid',name:'流形',targetable:true,canBlock:true,canAttack:true,occupiesTile:true,duration:25,persistAfterSourceGone:true});const copy=battle.s.units.find(v=>v.uid!==u.uid&&!v.deployed&&v.hp>0);if(token&&copy){const attrs=battle.profile(copy).attributes;token.copyOf=copy.uid;for(const [to,from] of [['maxHp','maxHp'],['hp','maxHp'],['atk','atk'],['def','def'],['res','magicResistance'],['blockCnt','blockCnt'],['interval','baseAttackTime'],['attackSpeed','attackSpeed']])if(Number.isFinite(attrs[from]))token[to]=attrs[from];token.canBlock=token.blockCnt>0;token.occupiesTile=token.canBlock;token.damageType=battle.behavior?.(copy)?.damageType||'physical';token.range=Math.max(1.1,Math.max(...(battle.profile(copy).range?.grids||[]).map(g=>Math.hypot(g.col,g.row)),1));} }
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
 u.pendingPeriodicCost=null;u.pendingNextAttack=null;u.pendingCostGain=null;
 for(const fx of battle.s.logicEffects.slice())if(fx.sourceUid===u.uid&&(fx.talentOrSkillId===`skill-zone:${u.id}:${u.skillCount}`||fx.talentOrSkillId===`skill-heal-zone:${u.id}:${u.skillCount}`||fx.talentOrSkillId===`skill-loss:${u.id}:${u.skillCount}`))dropEffect(battle,fx,'skill-end');
 for(const talent of activeTalentsOf(battle,u)){const text=talent.description||'',bb=talent.values||{};if(/技能结束.*恢复.*生命|技能结束.*回复.*生命/.test(text)&&Number(bb.hp_ratio)>0)applyHeal(battle,{source:u,target:u,amount:u.maxHp*Number(bb.hp_ratio)});}
 if(u.unhealable)u.unhealable=false;
 if(u.id==='char_1012_skadi2')u.inspireAura=null;
 const skill=battle.profile(u)?.skill,skillText=skill?.description||'',skillBBValue=skillBB(battle,u);if(/技能结束时.*所有敌人.*法术伤害/.test(skillText)&&Number(skillBBValue.atk_scale)>0)for(const e of enemyActors(battle.s).filter(e=>battle.inside(u,e,true)))dealDamage(battle,{source:u,target:e,amount:battle.stats(u).atk*Number(skillBBValue.atk_scale),type:'arts',cause:'skill'});
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
 if(u.id==='char_1023_ghost2'&&idx===1){u.lockHp=null;if(u.hp>0)commitExit(battle,{target:u,reason:'forced'});}
 if(u.id==='char_4145_ulpia'&&u.returnPosition){const pos=u.returnPosition;u.returnPosition=null;teleportActor(battle,u,{...pos,source:u,mode:'return'});}
}
function onOperatorExit(battle,u,reason){
 for(const fx of battle.s.logicEffects.slice()){
  if(fx.refKind==='live'&&fx.sourceUid===u.uid&&!fx.persistAfterSourceGone)dropEffect(battle,fx,'source-exit');
  if(fx.refKind==='anchor'&&fx.anchorUid===u.uid)dropEffect(battle,fx,'anchor-exit');
 }
 for(const s of (battle.s.summons||[]).slice()){
  if(s.ownerUid===u.uid&&!s.persistAfterSourceGone)commitExit(battle,{target:s,reason:'forced'});
 }
}

const TOKEN_IDS={'silent-drone':'token_10000_silent_healrb','dusk-token':'token_10015_dusk_drgn','nearl2-sun':'token_10019_nearl2_sword','vigil-wolf':'token_10028_vigil_wolf','cathy-device':'token_10041_cathy_catsld','beewax-obelisk':'token_10011_beewax_oblisk','kazema-shadow':'token_10022_kazema_shadow','siege2-golden':'token_10040_siege2_vlion','mlyss-fluid':'token_10030_mlyss_wtrman','swire2-trap':'token_10031_swire2_gdtrap'};
export function spawnSummon(battle,owner,spec){
 const tokenId=spec.tokenId||TOKEN_IDS[spec.type],entity=battle.data.tokens?.[tokenId];
 if(!entity)throw Error('缺少固定召唤物数据 '+spec.type);
 const ctrl=owner.summonCtrl,live=battle.s.summons.filter(x=>x.ownerUid===owner.uid&&x.type===spec.type&&x.deployed);
 if(ctrl&&((ctrl.stock??0)<=0||live.length>=ctrl.cap))return null;
 const occupied=new Set(alliedActors(battle.s).filter(x=>x.kind!=='summon'||(x.deployed&&x.hp>0)).map(x=>x.x+','+x.y));
 const candidates=spec.x!=null?[[spec.x,spec.y]]:[[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy])=>[owner.x+dx,owner.y+dy]);
 const position=candidates.find(([x,y])=>{const tile=battle.map.grid[y]?.[x];return tile&&tile.buildableType!=='NONE'&&!tile.obstacle&&(!spec.canBlock||tile.heightType!=='HIGHLAND')&&!occupied.has(x+','+y)&&(spec.type!=='vigil-wolf'||battle.inside(owner,{x,y}));});
 if(!position)return null;
 const [x,y]=position,a=nativeAttributes(entity,battle.profile(owner).status).attributes,uid=battle.s.nextId++,canBlock=spec.canBlock??a.blockCnt>0,canAttack=spec.canAttack??(a.baseAttackTime>0&&entity.skillRefs?.some(r=>r.skillId));
 const row={uid,id:tokenId,ownerUid:owner.uid,ownerDeployGen:owner.deployGen,type:spec.type||tokenId,name:spec.name||entity.name,kind:'summon',allied:true,x,y,dir:owner.dir,hp:a.maxHp,maxHp:a.maxHp,atk:a.atk,def:a.def,res:a.magicResistance,cost:tokenCostFor(battle.profile(owner),tokenId,a.cost),interval:a.baseAttackTime,attackSpeed:a.attackSpeed,attackCooldown:0,action:null,deployed:true,deployGen:1,statuses:[],shield:0,barriers:[],shieldLayers:[],targetable:spec.targetable!==false,healable:spec.healable!==false,canBlock,canAttack,canHeal:spec.canHeal??false,blockCnt:spec.blockCnt??a.blockCnt,blockCost:1,persistAfterSourceGone:!!spec.persistAfterSourceGone,endsAt:spec.duration?battle.s.time+spec.duration:null,occupiesTile:spec.occupiesTile??canBlock,lives:spec.lives,nextLifeAt:spec.nextLifeAt,anchorUid:spec.anchorUid,nextHealAt:battle.s.time+a.baseAttackTime,nextAuraAt:spec.type==='ghost2-substitute'?battle.s.time+1:null};
 battle.s.summons.push(row);if(ctrl)ctrl.stock--;
 log(battle,'summon',{uid,ownerUid:owner.uid,type:spec.type,x,y});return row;
}

function tickSummons(battle,dt){
 for(const s of battle.s.summons.slice()){
  if(s.endsAt!=null&&battle.s.time>=s.endsAt){commitExit(battle,{target:s,reason:'forced'});continue;}
  if(s.canHeal&&battle.s.time+1e-9>=s.nextHealAt){for(const a of alliedActors(battle.s).filter(v=>v.deployed&&v.hp>0&&chebyshev(s,v)<=1&&v.healable!==false))applyHeal(battle,{source:s,target:a,amount:s.atk,origin:s});s.nextHealAt+=s.interval;}
  if(s.type==='ghost2-substitute'&&s.deployed&&s.hp>0){const owner=getActor(battle.s,s.ownerUid),talent=owner&&activeTalentsOf(battle,owner).find(t=>t.name==='拥抱自我'),bb=talent?.values||{};s.nextAuraAt??=battle.s.time+1;if(battle.s.time+1e-9>=s.nextAuraAt){s.nextAuraAt+=1;for(const e of enemyActors(battle.s).filter(e=>chebyshev(s,e)<=1)){applyStatus(e,'sluggish',1.1,{source:s.uid,resistible:false});dealDamage(battle,{source:owner||s,target:e,amount:(owner?battle.stats(owner).atk:s.atk)*(Number(bb.atk_scale)||.4),type:'arts',cause:'skill'});}}}
  if(s.type==='swire2-trap'&&s.deployed&&s.hp>0){
   const owner=getActor(battle.s,s.ownerUid),touching=enemyActors(battle.s).filter(e=>!e.hidden&&chebyshev(s,e)<=.5).sort((a,b)=>a.uid-b.uid)[0];
   if(touching&&!s.trapTriggered){s.trapTriggered=true;s.trapTargetUid=touching.uid;s.trapExtraAt=battle.s.time+3;dealDamage(battle,{source:owner||s,target:touching,amount:(owner?battle.stats(owner).atk:s.atk)*(s.trapScale||1),type:'physical',cause:'skill',skill:true});applyStatus(touching,'sluggish',s.trapSlow||2,{source:owner?.uid||s.uid});log(battle,'trap-trigger',{uid:s.uid,targetUid:touching.uid,ownerUid:owner?.uid});}
   if(s.trapTriggered&&s.trapExtraAt!=null&&battle.s.time+1e-9>=s.trapExtraAt&&!s.trapExtraUsed){s.trapExtraUsed=true;const target=getActor(battle.s,s.trapTargetUid);if(target?.hp>0)dealDamage(battle,{source:owner||s,target,amount:(owner?battle.stats(owner).atk:s.atk)*(s.trapScale||1),type:'physical',cause:'skill',skill:true});commitExit(battle,{target:s,reason:'forced'});}
  }
  if(s.type==='vigil-wolf'&&battle.s.time>=s.nextLifeAt){s.lives=Math.min(3,(s.lives||0)+1);s.blockCnt=s.lives;s.nextLifeAt+=25;if(s.hp<=0){s.hp=s.maxHp;s.deployed=true;s.targetable=true;s.deployGen++;s.exitLife=null;}}
  if(s.canAttack&&s.deployed&&s.hp>0){s.attackCooldown=Math.max(0,(s.attackCooldown||0)-dt);if(s.attackCooldown<=0){const e=enemyActors(battle.s).filter(x=>!x.hidden).sort((a,b)=>chebyshev(s,a)-chebyshev(s,b)||a.uid-b.uid)[0];if(e&&chebyshev(s,e)<=(s.range||1.1)){for(let i=0;i<(s.lives??1);i++)dealDamage(battle,{source:s,target:e,amount:s.atk,type:s.damageType||'physical',cause:'attack'});s.attackCooldown=s.interval||1;}}}
 }
 for(const owner of battle.s.units.filter(u=>u.id==='char_4162_cathy'&&u.deployed&&u.hp>0)){
  const ctrl=owner.summonCtrl;if(!ctrl)continue;const devices=battle.s.summons.filter(s=>s.ownerUid===owner.uid&&s.type==='cathy-device');
  for(const target of battle.s.units.filter(t=>t.uid!==owner.uid&&t.deployed&&t.hp>0&&!devices.some(s=>s.anchorUid===t.uid))){if(ctrl.stock<=0||devices.length>=ctrl.cap)break;const device=spawnSummon(battle,owner,{type:'cathy-device',name:'支援装置',targetable:false,healable:false,canBlock:false,anchorUid:target.uid});if(device){device.nextShieldAt=battle.s.time+1;device.shieldId='cathy-'+target.uid;device.shieldCap=battle.stats(owner).maxHp*.2;grantShield(battle,target,{id:device.shieldId,amount:device.shieldCap,sourceUid:owner.uid});devices.push(device);}}
  for(const device of devices){const target=getActor(battle.s,device.anchorUid);if(!target?.deployed)continue;if(battle.s.time>=device.nextShieldAt){device.nextShieldAt+=1;if(battle.s.time-(target.lastDamagedAt??-999)>=5){const layer=target.shieldLayers.find(l=>l.id===device.shieldId),remaining=Math.min(device.shieldCap,(layer?.remaining||0)+battle.stats(owner).maxHp*.06);grantShield(battle,target,{id:device.shieldId,amount:remaining,sourceUid:owner.uid});}}}
 }
}

export function newAttackId(battle){return battle.s.settle.nextAttackId++;}

export function blockingActors(battle){
 return attackableAllies(battle.s).filter(u=>u.canBlock!==false&&(u.kind!=='summon'||u.canBlock));
}
