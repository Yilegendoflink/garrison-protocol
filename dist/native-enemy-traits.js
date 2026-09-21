import {permissions,applyStatus,statusAttributeChanges,isIsolated} from './status.js';
import {grantGuard,grantShield,dealDamage,applyElementDamage,applyHeal,applyRegen,applyLoss,commitExit,dispatch,attackableAllies,alliedActors,getActor,addEffect,newAttackId} from './native-effects.js';

const near=(a,b,r)=>Math.hypot(a.x-b.x,a.y-b.y)<=r+1e-9;
const YUANZAI=new Set(['enemy_2085_skzjxd','enemy_2085_skzjxd_2']);
const NEURO_SPAWNERS=new Set(['enemy_1439_dslntf','enemy_1439_dslntf_2']);

export function initEnemyTraits(battle,e,raw,{restore=false}={}){
 e.enemyAttack??=raw.enemyBehavior?.attackProfile||null;
 e.spawnOnDeath??=raw.enemyBehavior?.spawnOnDeath||null;
 if(e.id==='enemy_2008_flking')e.costEffects=[]; // 修复旧存档：原关卡削弱不是墓碑自身能力。
 if(e.id==='enemy_1511_mdrock'){
  e.immunities.sleep=true;e.mudrockStacks??=0;
  e.mudrockShieldHpBonus??=Number(e.enemyTalent['shield.max_hp'])||0;e.mudrockShieldAspd??=Number(e.enemyTalent['shield.attack_speed'])||0;
  const initial=e.shieldLayers.find(l=>l.id==='enemy-initial-shield');if(initial){initial.id='mudrock-arts';initial.types=['arts'];}
  syncMudrockShield(e);
 }
 if(e.id==='enemy_2005_axetro'){e.enemyAttack={...e.enemyAttack,groundOnly:true};e.axetroStacks??=0;}
 if(e.id==='enemy_1050_lslime')e.damageType='arts';
 if(e.id==='enemy_1504_cqbw')e.enemyAttack={...e.enemyAttack,groundOnly:true};
 if(['enemy_10031_cnvsld','enemy_10034_cnvsax'].includes(e.id))e.isolateWhileConcealed=true;
 if(NEURO_SPAWNERS.has(e.id)){e.neuroCombat??=false;if(!e.neuroCombat)e.canAttack=false;}
 if(YUANZAI.has(e.id)){
  e.unblockable=e.baseUnblockable=true;e.canAttack=e.baseCanAttack=false;
  e.facingX??=Math.sign((e.route?.find(p=>p.kind==='move'&&Math.abs(p.x-e.x)>1e-6)?.x??e.x+1)-e.x);
 }
 if(e.enemyTalent?.['rush.dlancer_t[trigger].interval']>0&&!e.lancerRush){
  e.lancerRush={active:false,stacks:0,nextCheckAt:battle.s.time,nextStackAt:null};e.speed=e.baseSpeed;
 }
 if(e.enemyTraitsInitialized)return;
 if(restore){e.baseRes-=Number(raw.enemyBehavior?.magicResistanceBonus)||0;e.res=e.baseRes;}
 e.enemyTraitsInitialized=true;e.attackSpeedMod??=0;
 const bb=e.enemyTalent||{};
 if(e.id==='enemy_1158_divman')e.enemyAttack={...e.enemyAttack,groundOnly:true};
 if(e.id==='enemy_1025_reveng')e.lowHpRatio=0; // 每帧检测血线，不能被通用一次性分支锁住。
 e.refractionBonus=Number(bb['refracting.magic_resistance']??bb['Refracting.magic_resistance'])||0;
 e.refractionHp=Number(bb['Refracting.max_hp'])||0;
 if(e.refractionHp){e.hp*=1+e.refractionHp;e.maxHp*=1+e.refractionHp;}
 const charges=Number(bb['Shield.max_block_damage_cnt'])||0;
 if(charges>0)grantGuard(battle,e,{id:'enemy-born-guard',charges,types:['physical','arts'],sourceUid:e.uid});
 if(e.selfField||e.id==='enemy_10054_cjhot'){e.canAttack=false;e.baseCanAttack=false;e.immunities.sluggish=true;}
 if(bb['periodic_damage.damage']>0)e.nextSelfDamageAt=battle.s.time+1;
 if(bb['confinement.times']>0){e.prisonAttacks=0;e.prisonReleased=false;}
 if(bb['pow.time']>0){e.powStartedAt=battle.s.time;e.powBaseAttack=e.enemyAttack;e.enemyAttack={...e.enemyAttack,splash:{shape:'square',radius:1}};e.attackElement='burn';e.attackElementScale=Number(bb['pow.attack@ep_damage_ratio']);}
 if(e.specialSkill?.prefab==='onfire')e.nextIgnitionCheck=battle.s.time+.2;
 if(e.specialSkill?.prefab==='InvisibleCombat'&&e.formInvisible)e.invisibleStrikeReady=true;
 if(e.id==='enemy_1367_dseed'){e.unblockable=e.baseUnblockable=true;e.formHold=true;e.nextBloodLossAt=battle.s.time+1;}
 refreshEnemyTraitStats(e);
}

export function enemyConditionalAttackSpeed(e){
 const bb=e.enemyTalent||{};
 if(e.id==='enemy_1511_mdrock')return mudrockShieldActive(e)?e.mudrockShieldAspd||0:0;
 if(e.id==='enemy_2005_axetro')return (e.axetroStacks||0)*(Number(bb['atkup.attack_speed'])||0);
 return e.id==='enemy_1050_lslime'&&e.hp<e.maxHp*Number(bb['selfbuff.hp_ratio'])?Number(bb['selfbuff.attack_speed'])||0:0;
}

export function enemyConditionalAttackMultiplier(e){
 if(e.id==='enemy_1511_mdrock')return 1+(e.mudrockStacks||0)*Number(e.enemyTalent['charge.attack@enemy_mdrock_s_1[charge].atk']);
 return e.id==='enemy_2005_axetro'?1+(e.axetroStacks||0)*Number(e.enemyTalent['atkup.atk']):1;
}

function mudrockShieldActive(e){return e.shieldLayers?.some(l=>l.id==='mudrock-arts'&&l.remaining>0);}
function syncMudrockShield(e){
 const before=e.mudrockHpScale??1,after=mudrockShieldActive(e)?1+e.mudrockShieldHpBonus:1;
 if(before!==after){e.maxHp=e.baseMaxHp*after;e.hp=Math.min(e.maxHp,e.hp/before*after);}
 e.mudrockHpScale=after;
}
export function refreshEnemyMudrockShield(battle,e,bb){
 if(!(Number(bb.dynamic)>0))return;
 e.mudrockShieldHpBonus=Number(bb.max_hp)||0;e.mudrockShieldAspd=Number(bb.attack_speed)||0;
 grantShield(battle,e,{id:'mudrock-arts',amount:Number(bb.dynamic),types:['arts'],sourceUid:e.uid});syncMudrockShield(e);
}
export function enemyTraitBeforeStrike(battle,e,target,action){
 if(e.id!=='enemy_1511_mdrock'||target.hp<=0)return;
 if(action.attackId!=null&&e.mudrockLastAttackId===action.attackId)return;
 e.mudrockLastAttackId=action.attackId??null;e.mudrockStacks=Math.min(6,(e.mudrockStacks||0)+1); // PRTS：最多6层，当前有效攻击也受益。
}

export function enemyTraitDamageDealt(battle,e,result){
 if(e.id!=='enemy_2005_axetro'||e.hp<=0||!(result.total>0))return;
 const max=Number(e.enemyTalent['atkup.max_stack_cnt']);
 if(max>0){e.axetroStacks=Math.min(max,(e.axetroStacks||0)+1);e.axetroIdleSince=null;}
}

export function tickEnemyAttackContinuity(battle,e,target){
 if(e.id!=='enemy_2005_axetro')return;
 const attacking=e.canAttack&&!e.hidden&&permissions(e).attack&&(e.action||target?.hp>0);
 if(attacking){e.axetroIdleSince=null;return;}
 e.axetroIdleSince??=battle.s.time;
 if(e.axetroStacks>0&&battle.s.time-e.axetroIdleSince+1e-9>=Number(e.enemyTalent['checker.delay'])){
  e.axetroStacks=0;battle.emit('enemy-phase',{uid:e.uid,x:e.x,y:e.y,phase:'enemy-form',form:'增益清空'});
 }
}

export function tickPompeiiExplosion(battle,e,dt){
 if(e.id!=='enemy_1050_lslime'||e.hp<=0||e.hidden)return;
 if(e.statuses.some(s=>['stun','unableAct','sleep','frozen','levitate'].includes(s.kind)))return;
 if(e.block==null){e.pompeiiBlockClock=0;return;}
 const bb=e.enemyTalent,interval=Number(bb['rangedamage.interval']);if(!(interval>0))return;e.pompeiiBlockClock=(e.pompeiiBlockClock||0)+dt;
 while(e.pompeiiBlockClock+1e-9>=interval){
  e.pompeiiBlockClock-=interval;const attackId=newAttackId(battle);
  // 本期黑板没有爆炸半径；PRTS庞贝页为半径1.4，且不可对空。
  for(const target of attackableAllies(battle.s))if(!target.flying&&near(e,target,1.4))battle.hurt(target,e,{damageAmount:Number(bb['rangedamage.attack@damage']),cause:'extra',attackId});
  battle.emit('impact',{uid:e.uid,x:e.x,y:e.y,radius:1.4,type:'arts',enemy:true});
 }
}

function activateNeuroSpawner(battle,e){
 if(e.neuroCombat)return;
 e.neuroCombat=true;e.canAttack=e.baseCanAttack;e.speed=e.baseSpeed*(1+Number(e.enemyTalent['0.move_speed']));
 if(e.route?.[e.cmd]?.kind==='wait'){e.cmd++;e.cmdLeft=null;}
 battle.emit('enemy-phase',{uid:e.uid,x:e.x,y:e.y,phase:'enemy-form',form:'临战'});
}

export function tickEnemyNeurotoxin(battle){
 const sources=battle.s.enemies.filter(e=>NEURO_SPAWNERS.has(e.id)&&e.neuroCombat&&e.hp>0&&!e.hidden);
 for(const target of alliedActors(battle.s)){
  let best=null,amount=0;
  if(target.deployed&&target.hp>0&&!target.hidden)for(const e of sources)if(near(e,target,Number(e.enemyTalent['1.range_radius']))){
   const value=e.atk*(1+Math.min(0,statusAttributeChanges(e).attack||0))*Number(e.enemyTalent['1.ep_damage_ratio']);
   if(value>amount){best=e;amount=value;}
  }
  if(!best){target.neurotoxinNextAt=null;continue;}
  const interval=Number(best.enemyTalent['1.interval']);target.neurotoxinNextAt??=battle.s.time+interval;
  while(target.hp>0&&battle.s.time+1e-9>=target.neurotoxinNextAt){
   target.neurotoxinNextAt+=interval;
   applyElementDamage(battle,{source:best,target,amount,type:'neural',cause:'dot'});
  }
 }
}

function faceOperatorMajority(battle,e){
 let left=0,right=0;
 for(const u of battle.s.units)if(u.deployed&&u.hp>0){if(u.x<e.x)left++;else if(u.x>e.x)right++;}
 if(left!==right)e.facingX=right>left?1:-1;
 if(e.walkingBackward&&e.nextShowAt!=null&&battle.s.time+1e-9>=e.nextShowAt){
  e.nextShowAt=battle.s.time+Number(e.enemyTalent['ShowTrigger.interval']);
  battle.emit('enemy-phase',{uid:e.uid,x:e.x,y:e.y,phase:'enemy-form',form:'炫耀'});
 }
}

export function enemyFacingAfterMove(battle,e,oldX){
 if(!YUANZAI.has(e.id)||Math.abs(e.x-oldX)<1e-9)return;
 const backward=Math.sign(e.x-oldX)!==e.facingX;
 if(backward&&!e.walkingBackward)e.nextShowAt=battle.s.time+Number(e.enemyTalent['ShowTrigger.interval']);
 if(!backward)e.nextShowAt=null;
 e.walkingBackward=backward;
}

export function enemyFacingDamageMultiplier(e,source,type){
 if(!YUANZAI.has(e.id)||!source||!['physical','arts'].includes(type)||!Number.isFinite(source.x))return 1;
 // 水平朝向的前半平面；同一竖线按点积为0的边界处理。
 if((source.x-e.x)*(e.facingX??1)<0)return 1;
 return 1-Math.max(0,Math.min(1,Number(e.enemyTalent?.['Weakness.damage_resistance'])||0));
}

function stopLancerRush(e){const r=e.lancerRush;r.active=false;r.stacks=0;r.nextStackAt=null;e.speed=e.baseSpeed;}

export function tickEnemyLancer(battle,e){
 const r=e.lancerRush;if(!r||e.hp<=0||e.hidden)return;
 const now=battle.s.time,bb=e.enemyTalent,interval=Number(bb['rush.dlancer_t[trigger].interval']);
 while(now+1e-9>=r.nextCheckAt){
  const at=r.nextCheckAt;r.nextCheckAt+=.1;
  if(e.statuses.some(s=>s.kind==='stun'||s.kind==='root'))stopLancerRush(e);
  else if(e.block==null&&!r.active){r.active=true;r.nextStackAt=at+interval;}
 }
 while(r.active&&r.nextStackAt!=null&&now+1e-9>=r.nextStackAt){
  r.nextStackAt+=interval;r.stacks=Math.min(Number(bb['rush.dlancer_t[trigger].trig_cnt']),r.stacks+1);
  e.speed=e.baseSpeed*(1+r.stacks*Number(bb['rush.dlancer_t[trigger].move_speed']));
 }
}

export function consumeEnemyLancerRush(e){
 if(!e.lancerRush?.active)return 0;
 // “当前移动速度”包含减速，但不是阻挡后的实际位移速度（后者为0）。
 const slow=e.statuses.some(s=>s.kind==='sluggish')? .2:1;
 const amount=e.speed*(e.moveSpeedMod??1)*(e.waterMoveScale??1)*(e.sandMoveScale??1)*slow*Number(e.enemyTalent['firstattack.atk_scale']);
 stopLancerRush(e);return amount;
}

// refreshEnemyAuras 每帧先恢复基础防御/法抗，再调用此处，避免永久写回导致重复累加。
export function refreshEnemyTraitStats(e){
 const bb=e.enemyTalent||{},silenced=permissions(e).silenced;
 if(e.refractionBonus&&!silenced)e.res+=e.refractionBonus;
 const layers=e.armorLossStacks||0,max=Number(bb['def_reduce.max_stack_cnt']);
 if(layers>=2&&max>0){e.def=Math.max(0,e.def+Number(bb['def_reduce.def'])*layers/max);e.res=Math.max(0,e.res+Number(bb['def_reduce.magic_resistance'])*layers/max);}
 if(e.prisonReleased===false){e.attackSpeedMod+=(Number(bb['confinement.attack_speed'])||0);e.def+=Number(bb['confinement.def'])||0;}
 if(e.prisonReleased){e.res+=Number(bb['liberty.magic_resistance'])||0;}
}

export function tickEnemyTraits(battle,e,dt){
 if(!e.enemyTraitsInitialized||e.hp<=0)return;
 const bb=e.enemyTalent||{};
 if(YUANZAI.has(e.id))faceOperatorMajority(battle,e);
 if(e.id==='enemy_1025_reveng')e.atk=e.baseAtk*(1+(e.hp<=e.maxHp*.5?Number(bb['atkup.atk'])||0:0));
 if(bb['SelfFear.fear']>0&&!e.selfFearTriggered&&e.hp/e.maxHp<.5){e.selfFearTriggered=true;applyStatus(e,'fear',Number(bb['SelfFear.fear']),{source:e.uid});e.selfFearSpeedUntil=battle.s.time+Number(bb['SelfFear.speed_duration']);e.speed=e.baseSpeed*Number(bb['SelfFear.move_speed']);}
 if(e.selfFearSpeedUntil!=null&&battle.s.time>=e.selfFearSpeedUntil){e.selfFearSpeedUntil=null;e.speed=e.baseSpeed;}
 if(e.powStartedAt!=null&&!e.powSpent){const age=Math.floor((battle.s.time-e.powStartedAt+1e-9)*10)/10;e.atk=e.baseAtk*(1+Number(bb['pow.add_max_atk'])*Math.min(1,age/Number(bb['pow.time'])));}
 if(e.nextIgnitionCheck!=null&&!e.onFire&&battle.s.time+1e-9>=e.nextIgnitionCheck){
  e.nextIgnitionCheck=battle.s.time+.2;
  if(!e.hidden&&!e.flying&&battle.s.enemies.some(source=>source.hp>0&&!source.hidden&&source.enemyTalent?.['pow.time']>0&&near(source,e,.5))){e.onFire=true;battle.emit('enemy-phase',{uid:e.uid,x:e.x,y:e.y,phase:'enemy-form',form:'燃烧'});}
 }
 if(e.id==='enemy_10034_cnvsax'){const concealed=e.invisible&&!e.revealed&&e.block==null;e.canAttack=!concealed&&e.block!=null;e.damageType='physical';}
 if(e.refractionHp&&!e.refractionHpLost&&permissions(e).silenced){
  e.refractionHpLost=true;const ratio=1+e.refractionHp;e.maxHp/=ratio;e.hp/=ratio;
 }
 if(bb['periodic_damage.damage']>0){while(e.hp>0&&battle.s.time+1e-9>=e.nextSelfDamageAt){e.nextSelfDamageAt+=1;dealDamage(battle,{target:e,value:Number(bb['periodic_damage.damage']),type:'true',cause:'dot'});}}
 if(e.prisonReleased&&bb['liberty.hp_recovery_per_sec']>0)applyRegen(battle,{source:e,target:e,amount:Number(bb['liberty.hp_recovery_per_sec'])*dt});
 // 当前地图没有唤血祭坛/沥血王座实体，血珀按无祭坛分支每秒流失10%生命。
 if(e.id==='enemy_1367_dseed')while(e.hp>0&&battle.s.time+1e-9>=e.nextBloodLossAt){e.nextBloodLossAt+=1;applyLoss(battle,{target:e,amount:e.maxHp*Number(bb['Passive.hp_ratio'])});}
}

export function enemyTraitAfterDamage(battle,e,opts,result){
 if(!e.enemyTraitsInitialized||result.total<=0)return;
 if(e.id==='enemy_1511_mdrock')syncMudrockShield(e);
 const bb=e.enemyTalent||{},max=Number(bb['def_reduce.max_stack_cnt']);
 if(bb['Expose.weak[limit]']>0&&!bb['Expose.range_radius']&&!permissions(e).silenced){
  const source=opts.source||getActor(battle.s,opts.sourceUid);
  if(battle.s.units.includes(source))applyStatus(source,'exposed',Number(bb['Expose.weak[limit]']),{source:e.uid,value:Number(bb['Expose.damage_scale']),resistible:false});
 }
 if(e.hp<=0)return;
 if(NEURO_SPAWNERS.has(e.id))activateNeuroSpawner(battle,e);
 if(max>0){
  const old=e.armorLossStacks||0,next=Math.min(max,old+1);e.armorLossStacks=next;
  const delta=(next>=2?next:0)-(old>=2?old:0);
  e.def=Math.max(0,e.def+Number(bb['def_reduce.def'])*delta/max);e.res=Math.max(0,e.res+Number(bb['def_reduce.magic_resistance'])*delta/max);
 }
 if(bb['run.attack@move_speed']>0&&/^enemy_2001_duckmi/.test(e.id))e.speed=e.baseSpeed*(1+Number(bb['run.attack@move_speed']));
}

function releasePrisoner(battle,e){
 if(e.prisonReleased!==false)return;
 const bb=e.enemyTalent;e.prisonReleased=true;e.atk=e.baseAtk*(1+(Number(bb['liberty.atk'])||0));
 e.attackSpeedMod-=(Number(bb['confinement.attack_speed'])||0);e.def-=(Number(bb['confinement.def'])||0);e.res+=Number(bb['liberty.magic_resistance'])||0;
 e.enemyDefPenetration=Number(bb['liberty.def_penetrate'])||0;
 battle.emit('enemy-phase',{uid:e.uid,x:e.x,y:e.y,phase:'liberation'});
}
export function enemyTraitBeforeAttack(battle,e){
 if(e.prisonReleased!==false)return;
 e.prisonAttacks++;
 if(e.prisonAttacks<Number(e.enemyTalent['confinement.times']))return;
 releasePrisoner(battle,e);
 if(/^enemy_1121_lifbos/.test(e.id))for(const other of battle.s.enemies)if(other.hp>0)releasePrisoner(battle,other);
}
export function enemyTraitOnHit(battle,e,target){
 if(e.id==='enemy_1050_lslime'&&e.hp>0&&target.hp>0){
  const bb=e.enemyTalent,endsAt=battle.s.time+Number(bb['dot.duration']);
  if(!(bb['dot.duration']>0&&bb['dot.interval']>0&&bb['dot.damage']>0))return;
  const existing=battle.s.logicEffects.find(f=>f.talentOrSkillId==='pompeii-burn'&&f.targetUid===target.uid&&f.targetDeployGen===target.deployGen&&f.endsAt>battle.s.time);
  if(existing)existing.endsAt=endsAt;
  else addEffect(battle,{kind:'dot',sourceUid:null,targetUid:target.uid,targetDeployGen:target.deployGen,talentOrSkillId:'pompeii-burn',stackRule:'stack',interval:Number(bb['dot.interval']),nextAt:battle.s.time+Number(bb['dot.interval']),endsAt,values:{damage:Number(bb['dot.damage']),type:'arts'},snapshot:{damage:Number(bb['dot.damage'])},refKind:'owner',persistAfterSourceGone:true});
 }
 const stun=Number(e.enemyTalent?.['Combat.attack@stun']);
 if(stun>0&&target.hp>0)applyStatus(target,'stun',stun,{source:e.uid});
}

export function syncEnemyConcealMarker(e){
 if(e.specialSkill?.prefab!=='InvisibleCombat')return;
 const active=e.invisible&&!e.revealed&&e.block==null;
 if(active&&!e.invisibleCombatWasActive)e.invisibleStrikeReady=true;
 e.invisibleCombatWasActive=active;
}

export function enemyStealAmmo(battle,e,target){
 const amount=Number(e.enemyTalent?.['DamageOrBullet.attack@minus_bullet'])||0;
 if(amount<=0||!(target.ammo>0))return false;
 const used=Math.min(amount,target.ammo);target.ammo-=used;
 battle.garrisonAmmoEvent(target,used);dispatch(battle,'ammo',{source:target,target,used});
 battle.emit('ammo',{uid:target.uid,x:target.x,y:target.y,ammo:target.ammo,used});
 if(target.ammo===0&&!target.skillLeft){battle.emit('skill-end',{uid:target.uid,x:target.x,y:target.y});dispatch(battle,'skill-end',{target});}
 battle.emit('enemy-ability',{uid:e.uid,x:e.x,y:e.y,ability:'steal-ammo',targetUid:target.uid,used});
 return true;
}

export function enemyTraitAfterAttack(battle,e){
 if(e.powHit){e.powSpent=true;e.powHit=false;e.atk=e.baseAtk;e.enemyAttack=e.powBaseAttack;e.attackElementScale=Number(e.enemyTalent['pow.attack@ep_damage_ratio_normal']);}
 if(e.id==='enemy_1269_nhfly'&&permissions(e).attack)commitExit(battle,{target:e,reason:'self-destruct'});
}

export function enemyTraitOnDeath(battle,e,info){
 const bb=e.enemyTalent||{};
 if(bb['Boom.heal_scale']>0&&bb['Boom.projectile_range']>0&&!permissions(e).silenced&&info.reason!=='leak'){
  const amount=e.atk*(1+Math.min(0,statusAttributeChanges(e).attack||0))*Number(bb['Boom.heal_scale']);
  for(const target of battle.s.enemies)if(target!==e&&target.hp>0&&!target.hidden&&near(e,target,Number(bb['Boom.projectile_range'])))
   applyHeal(battle,{source:e,target,amount,persistAfterSourceGone:true,parentEventId:info.event?.eventId});
  battle.emit('impact',{uid:e.uid,x:e.x,y:e.y,radius:Number(bb['Boom.projectile_range']),type:'healing',enemy:true});
 }
 if(bb['Expose.range_radius']>0&&!permissions(e).silenced&&!['leak','fall'].includes(info.reason)){
  for(const target of alliedActors(battle.s))if(target.deployed&&target.hp>0&&near(e,target,Number(bb['Expose.range_radius'])))applyStatus(target,'exposed',Number(bb['Expose.weak[limit]']),{source:e.uid,value:Number(bb['Expose.damage_scale']),resistible:false});
 }
 if(bb['DeadBoom.duration']>0&&!['leak','fall'].includes(info.reason)){
  for(const target of attackableAllies(battle.s))if(!target.flying&&near(e,target,1.25)){
   dealDamage(battle,{source:e,target,amount:e.atk,type:'arts',cause:'extra',parentEventId:info.event?.eventId});
   applyStatus(target,'attackSpeedDown',Number(bb['DeadBoom.duration']),{source:e.uid,value:Number(bb['DeadBoom.attack_speed'])});
  }
  battle.emit('impact',{x:e.x,y:e.y,radius:1.25,type:'arts',enemy:true});
 }
 const spec=e.spawnOnDeath;if(!spec||['leak','fall'].includes(info.reason))return;
 for(let i=0;i<spec.count;i++){
  const scatter=Number(spec.scatter)||0,x=Math.round(e.x)+(battle.economy.random()*2-1)*scatter,y=Math.round(e.y)+(battle.economy.random()*2-1)*scatter;
  battle.queueEnemySpawn({id:spec.enemyKey},{x,y,route:structuredClone(e.route),cmd:e.cmd||0},spec.delay||0);
 }
}

// commitExit 在生命周期去重后调用：普攻、DOT、强制退场和我方撤退共用这条入口。
export function enemyNearbyExit(battle,target){
 if(target.kind==='summon'||target.device)return;
 for(const e of battle.s.enemies){
  const bb=e.enemyTalent||{},max=Number(bb['Attack.max_stack_cnt']);
  if(e===target||e.hp<=0||!(max>0)||!near(e,target,Number(bb['Attack.range_radius'])))continue;
  e.deathGrowthStacks=Math.min(max,(e.deathGrowthStacks||0)+1);
  e.atk=e.baseAtk*(1+e.deathGrowthStacks*Number(bb['Attack.atk']));
  applyHeal(battle,{source:e,target:e,amount:e.maxHp*Number(bb['Attack.hp_ratio'])});
  battle.emit('enemy-ability',{uid:e.uid,x:e.x,y:e.y,ability:'death-growth',stacks:e.deathGrowthStacks});
 }
}

export function applyEnemyTraitAuras(battle){
 const live=battle.s.enemies.filter(e=>e.hp>0&&!e.hidden),allies=attackableAllies(battle.s);
 for(const source of live){const bb=source.enemyTalent||{};
  if(bb['magdef_add.magic_resistance']>0&&!permissions(source).silenced){
   for(const target of live)if(target!==source&&!isIsolated(target)&&near(source,target,2.5))target.enemyResAura=Math.max(target.enemyResAura||0,Number(bb['magdef_add.magic_resistance']));
  }
  if(bb['auraDefup.def']>0){for(const target of live)if(target!==source&&!isIsolated(target)&&target.enemyTalent?.['auraDefup.def']>0&&near(source,target,1.5))target.def+=Number(bb['auraDefup.def']);}
  if(bb['atkSpeedDown.attack_speed']<0&&!permissions(source).silenced){
   for(const target of allies)if(near(source,target,Number(bb['defup.range_radius'])))target.enemyAttackSpeedMod=Math.min(target.enemyAttackSpeedMod||0,100*Number(bb['atkSpeedDown.attack_speed']));
  }
 }
 for(const target of live){target.res+=target.enemyResAura||0;target.enemyResAura=0;}
}
