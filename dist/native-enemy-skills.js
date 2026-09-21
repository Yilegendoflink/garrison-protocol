import {permissions,applyStatus,removeStatus,isIsolated} from './status.js';
import {attackableAllies,dealDamage,applyElementDamage,commitExit,getActor,newAttackId,addEffect,grantShield,teleportActor} from './native-effects.js';
import {FPS} from './combat.js';
import {windupSeconds,enemyChainTargets} from './native-combat.js';

const ATTACK_SKILLS=new Set(['AOEAttack','CrossAttack','PowerAttack','StunAttack','stuncombat','DeathEye','PollutedRangedAtk','ironsandstorm','armorpiercing']);
const VISUAL_SKILLS=new Set(['BornAnim','StartRun','EndAnim','BeginAnim']);

// 敌人只有一个共享SP槽；每个技能有独立CD。负CD表示不靠CD自动就绪，仍可消耗SP。
export function initEnemySkills(enemy,raw,now){
 enemy.enemyTags=raw.enemyTags||[];
 enemy.enemyPeriodicSpawn??=raw.enemyBehavior?.periodicSpawn||null;
 if(enemy.id==='enemy_10034_cnvsax'){enemy.jazzCounterMode??=false;enemy.jazzModeChanged??=false;}
 if(raw.skills?.some(s=>s.prefabKey==='boomb'))enemy.canAttack=enemy.baseCanAttack=false;
 if(enemy.id==='enemy_10001_trslim')enemy.lowHpRatio=0; // 逃跑由一次性技能负责，不走通用永久低血强化。
 if(enemy.id==='enemy_1504_cqbw')enemy.lowHpRatio=0;
 if(enemy.enemySkills){for(const s of enemy.enemySkills)s.initCooldown??=Number(raw.skills?.find(row=>row.prefabKey===s.prefab)?.initCooldown??0);return;}
 enemy.enemySkills=(raw.skills||[]).filter(s=>s.prefabKey&&(!VISUAL_SKILLS.has(s.prefabKey)||s.prefabKey==='StartRun'&&enemy.id==='enemy_10001_trslim')&&!(raw.enemyBehavior?.ignoredSkillPrefabs||[]).includes(s.prefabKey)).map((s,index)=>({
  index,prefab:s.prefabKey,priority:Number(s.priority)||0,cooldown:Number(s.cooldown),initCooldown:Number(s.initCooldown),spCost:Number(s.spCost)||0,
  nextAt:Number(s.initCooldown)>=0?now+Number(s.initCooldown):null,used:false,
  bb:Object.fromEntries((s.blackboard||[]).map(r=>[r.key,r.valueStr??r.value]))
 }));
 enemy.enemySp=raw.spData?{type:raw.spData.spType,max:Math.max(0,Number(raw.spData.maxSp)||0),increment:Number(raw.spData.increment)||0}:null;
 enemy.sp=Math.min(enemy.enemySp?.max||0,Math.max(0,Number(raw.spData?.initSp)||0));
 enemy.enemyRank=raw.levelType||'NORMAL';
 enemy.enemyTalent=Object.fromEntries((raw.talentBlackboard||[]).map(r=>[r.key,r.valueStr??r.value]));
 if(enemy.id==='enemy_10087_hlchgr')enemy.nextEnhanceAt=now+Number(enemy.enemyTalent['SkillTrigger.interval']);
 if(enemy.id==='enemy_10034_cnvsax'){enemy.jazzCounterMode=false;enemy.jazzModeChanged=false;}
 if(enemy.id==='enemy_10044_wintun'){enemy.wineCarrying=true;enemy.canAttack=false;enemy.speed=enemy.baseSpeed*Number(enemy.enemyTalent['1.move_speed']);}
}

export function changeEnemySp(enemy,amount,{duringSkill=false}={}){
 if(!enemy.enemySp||enemy.hp<=0||!Number.isFinite(amount)||(!duringSkill&&enemy.enemyCast))return 0;
 const before=enemy.sp;enemy.sp=Math.max(0,Math.min(enemy.enemySp.max,before+amount));return enemy.sp-before;
}
export function enemySpEvent(enemy,type){
 if(enemy.enemySp?.type===type)return changeEnemySp(enemy,enemy.enemySp.increment);
 return 0;
}
export function enemySkillReady(enemy,skill,now){
 if(enemy.enemyCast||skill.used&&['AOEAttack','boomb','BlockedBoom','StartRun'].includes(skill.prefab))return false;
 if(skill.nextAt!=null&&now+1e-9<skill.nextAt)return false;
 if(skill.nextAt==null&&skill.spCost<=0)return false;
 return skill.spCost<=0||enemy.sp+1e-9>=skill.spCost;
}
export function beginEnemySkill(battle,enemy,skill,extra={}){
 if(!enemySkillReady(enemy,skill,battle.s.time))return false;
 const spent=extra.allSp?enemy.sp:skill.spCost;
 changeEnemySp(enemy,-spent);
 enemy.enemyCast={index:skill.index,spent,...extra};
 battle.emit('enemy-skill-start',{uid:enemy.uid,x:enemy.x,y:enemy.y,skill:skill.prefab,sp:enemy.sp});
 return true;
}
export function endEnemySkill(battle,enemy,{refund=false}={}){
 const cast=enemy.enemyCast;if(!cast)return;
 const skill=enemy.enemySkills[cast.index];enemy.enemyCast=null;
 if(cast.immunities)enemy.immunities=cast.immunities;
 if(refund)changeEnemySp(enemy,cast.spent);
 else skill.used=true;
 skill.nextAt=skill.cooldown>=0?battle.s.time+skill.cooldown:null;
 enemy.nextSkillAt=skill.nextAt??Infinity;
 battle.emit('enemy-skill-end',{uid:enemy.uid,x:enemy.x,y:enemy.y,skill:skill.prefab,refunded:refund});
}

export function selectEnemyAttackSkill(battle,enemy,target){
 if(!target||enemy.enemyCast)return null;
 const ready=enemy.enemySkills.filter(s=>ATTACK_SKILLS.has(s.prefab)&&enemySkillReady(enemy,s,battle.s.time)&&
  !(enemy.id==='enemy_2003_rockman'&&s.prefab==='StunAttack')&&
  !(s.prefab==='ironsandstorm'&&enemy.enemyForm!=='warden')&&
  !(s.prefab==='armorpiercing'&&(enemy.enemyForm!=='assassin'||enemy.block!==target.uid))&&
  !(s.prefab==='CrossAttack'&&Math.abs(enemy.x-target.x)>1e-6&&Math.abs(enemy.y-target.y)>1e-6)&&
  !(s.prefab==='DeathEye'&&enemy.deathEye));
 if(!ready.length)return null;
 const priority=Math.min(...ready.map(s=>s.priority)),top=ready.filter(s=>s.priority===priority);
 const skill=top.length===1?top[0]:top[Math.floor(battle.economy.random()*top.length)];
 return {index:skill.index,prefab:skill.prefab,scale:Number(skill.bb.atk_scale??skill.bb.damage_scale)||1,
  radius:Number(skill.bb.range_radius)||1,splash:skill.prefab==='AOEAttack',stun:Number(skill.bb.stun)||0,stunBeforeDamage:skill.prefab==='StunAttack',
  type:['CrossAttack','ironsandstorm'].includes(skill.prefab)?'arts':skill.prefab==='armorpiercing'?'physical':null,noDirectAttack:skill.prefab==='DeathEye',polluted:skill.prefab==='PollutedRangedAtk',
  targets:skill.prefab==='ironsandstorm'?Number(skill.bb.max_target):undefined,hits:skill.prefab==='armorpiercing'?Number(skill.bb.times):undefined,defPenetration:skill.prefab==='armorpiercing'?Number(skill.bb.def_penetrate):undefined};
}

function releaseCaptured(battle,enemy,cast){
 for(const uid of cast.victims||[]){const victim=getActor(battle.s,uid);if(victim?.swallowedBy===enemy.uid){delete victim.swallowedBy;removeStatus(victim,'root',enemy.uid);}}
}
export function checkWEnrage(battle,enemy){
 if(enemy.id!=='enemy_1504_cqbw'||enemy.wEnraged||enemy.hp<=0||enemy.hp>=enemy.maxHp*.5)return;
 const skill=enemy.enemySkills?.find(s=>s.prefab==='C4');if(!skill)return;
 enemy.wEnraged=true;skill.nextAt=battle.s.time;enemy.nextSkillAt=skill.nextAt;
 if(enemy.enemyCast?.c4Targets)enemy.enemyCast.c4CooldownReset=true;
 battle.emit('enemy-phase',{uid:enemy.uid,x:enemy.x,y:enemy.y,phase:'low-hp'});
}
function detonateC4(battle,enemy){
 const cast=enemy.enemyCast;if(!cast?.c4Targets)return;
 const skill=enemy.enemySkills[cast.index];
 // 先结束施法并清引用，避免爆炸引发退场/反伤时重入引爆。
 endEnemySkill(battle,enemy);enemy.formHold=false;
 if(cast.c4CooldownReset){skill.nextAt=battle.s.time;enemy.nextSkillAt=skill.nextAt;}
 for(const bomb of cast.c4Targets){
  const target=getActor(battle.s,bomb.uid);
  if(!target?.deployed||target.hp<=0||target.deployGen!==bomb.deployGen)continue;
  battle.resolveEnemyStrike(enemy,target,{scale:Number(skill.bb.atk_scale),type:'physical',attackId:cast.attackId,suppressAttackZone:true});
  battle.emit('impact',{uid:enemy.uid,x:target.x,y:target.y,radius:.3,type:'physical',enemy:true});
 }
}
export function cancelEnemyCast(battle,enemy,{lostTarget=false}={}){
 const cast=enemy.enemyCast;if(!cast)return;
 if(cast.c4Targets){detonateC4(battle,enemy);return;}
 if(cast.knightCharge){enemy.formHold=false;endEnemySkill(battle,enemy);return;}
 if(cast.bomb){enemy.formHold=false;endEnemySkill(battle,enemy,{refund:true});return;}
 if(cast.charge&&!cast.hitAttempted){
  const short=(enemy.statuses||[]).some(s=>s.kind==='stun'||s.kind==='sleep');
  enemy.enemyLostUntil=battle.s.time+Number(enemy.enemyTalent[short?'data.attack@fail_duration2':'data.attack@fail_duration']);
  enemy.canAttack=false;
 }
 releaseCaptured(battle,enemy,cast);enemy.stanceUntil=0;
 endEnemySkill(battle,enemy,{refund:lostTarget&&enemy.enemySkills[cast.index].prefab==='PollutedRangedAtk'});
}

function mouseKingTargets(battle,enemy){
 const targets=battle.enemySkillTargets(enemy,{range:Number.MAX_VALUE,groundOnly:true,ignoreBlock:true});let low=null,high=null;
 for(const target of targets){const hp=battle.stats(target).maxHp;if(!low||hp<low.hp)low={target,hp};if(!high||hp>high.hp)high={target,hp};}
 return {low:low?.target,high:high?.target};
}

function tryReidRush(battle,enemy){
 if(enemy.enemyForm==='rebirth'||enemy.block!=null||enemy.action)return;
 const skill=enemy.enemySkills.find(s=>s.prefab==='Rush');if(!skill||!enemySkillReady(enemy,skill,battle.s.time))return;
 const routeCells=[{x:Math.round(enemy.x),y:Math.round(enemy.y),index:enemy.cmd-1}];
 for(let i=enemy.cmd;i<(enemy.route?.length||0);i++){
  const point=enemy.route[i];if(point.kind!=='move')break;
  routeCells.push({x:Math.round(point.x),y:Math.round(point.y),index:i});if(point.checkpointIndex!=null)break;
 }
 const targets=battle.enemySkillTargets(enemy,{range:Number(skill.bb.range_radius),ranged:true,ignoreBlock:true}).filter(t=>routeCells.some(p=>p.x===Math.round(t.x)&&p.y===Math.round(t.y))).sort((a,b)=>Math.hypot(a.x-enemy.x,a.y-enemy.y)-Math.hypot(b.x-enemy.x,b.y-enemy.y));
 const target=targets[0];if(!target||!beginEnemySkill(battle,enemy,skill))return;
 const point=routeCells.find(p=>p.x===Math.round(target.x)&&p.y===Math.round(target.y)),old=enemy.route[point.index];
 enemy.route=[...enemy.route.slice(0,enemy.cmd),{...(point.index>=enemy.cmd?old:{}),kind:'move',x:point.x,y:point.y},...enemy.route.slice(Math.max(enemy.cmd,point.index+1))];enemy.cmdLeft=null;
 enemy.reidRushUntil=battle.s.time+Number(skill.bb.duration);enemy.speed=enemy.baseSpeed*(1+Number(skill.bb.move_speed));endEnemySkill(battle,enemy);
 battle.emit('enemy-phase',{uid:enemy.uid,x:enemy.x,y:enemy.y,phase:'enemy-form',form:'冲锋'});
}
function tickMouseKingSkills(battle,enemy,control){
 const {low,high}=mouseKingTargets(battle,enemy);
 if(enemy.mouseMarkEnabled){enemy.mouseMinUid=low?.uid??null;enemy.mouseMaxUid=high?.uid??null;}
 if(!low||enemy.hidden||enemy.enemyCast||enemy.action||!control.attack||!control.skill||control.silenced||enemy.mouseSkillFrame===battle.s.frame)return;
 const ready=enemy.enemySkills.filter(s=>['DriftSand','SandStorm','Mark'].includes(s.prefab)&&enemySkillReady(enemy,s,battle.s.time));
 if(!ready.length)return;
 const priority=Math.min(...ready.map(s=>s.priority)),choices=ready.filter(s=>s.priority===priority),skill=choices.length===1?choices[0]:choices[Math.floor(battle.economy.random()*choices.length)];
 if(!beginEnemySkill(battle,enemy,skill))return;enemy.mouseSkillFrame=battle.s.frame;
 if(skill.prefab==='Mark'){enemy.mouseMarkEnabled=true;enemy.mouseMinUid=low.uid;enemy.mouseMaxUid=high.uid;}
 else if(skill.prefab==='DriftSand'){
  const cells=battle.data.ranges['x-7'].grids,attackId=newAttackId(battle);
  for(const target of attackableAllies(battle.s))if(cells.some(c=>Math.round(target.x)-Math.round(high.x)===c.col&&Math.round(target.y)-Math.round(high.y)===c.row))
   battle.resolveEnemyStrike(enemy,target,{amount:Number(skill.bb.damage),type:'physical',cause:'extra',attackId,suppressAttackZone:true});
  battle.emit('impact',{uid:enemy.uid,x:high.x,y:high.y,radius:3,type:'physical',enemy:true});
 }else{
  addEffect(battle,{kind:'zone',stackRule:'stack',sourceUid:enemy.uid,talentOrSkillId:'mouse-sand-prison',x:Math.round(low.x),y:Math.round(low.y),radius:1,interval:1,nextAt:battle.s.time+1,endsAt:battle.s.time+Number(skill.bb.duration),trackSide:'ally',values:{mouseSand:true,damage:Number(skill.bb.damage),attackScale:1+Number(skill.bb.atk),weakDuration:Number(skill.bb.duration)},refKind:'owner',persistAfterSourceGone:true});
 }
 endEnemySkill(battle,enemy);
}

function tickCrownBlink(battle,enemy){
 const state=enemy.crownBlink;if(!state)return false;
 if(!state.moved&&battle.s.time+1e-9>=state.moveAt){
  state.moved=true;
  if(teleportActor(battle,enemy,{x:state.x,y:state.y,source:enemy,mode:'blink',allowOccupied:true,exactCoordinates:true,allowFlyOnly:false})){
   enemy.cmd=state.cmd;enemy.cmdLeft=null;enemy.lastCheckpoint=Math.max(enemy.lastCheckpoint||0,state.checkpoint||0);
  }
 }
 if(battle.s.time+1e-9>=state.endsAt){Object.assign(enemy,state.restore);enemy.crownBlink=null;return false;}
 return true;
}

function tryCrownBlink(battle,enemy){
 if(enemy.block==null||enemy.action||enemy.attackCooldown>0)return false;
 const skill=enemy.enemySkills.find(s=>s.prefab==='blink');if(!skill||!enemySkillReady(enemy,skill,battle.s.time))return false;
 const route=enemy.route||[];let goal=null;
 for(let i=enemy.cmd;i<route.length;i++){const p=route[i];if(p.kind!=='move')break;goal=p;if(p.checkpointIndex!=null)break;}
 if(!goal)return false;
 const dx=goal.x-enemy.x,dy=goal.y-enemy.y,length=Math.hypot(dx,dy),distance=Number(skill.bb.dist);if(length<1e-9||!(distance>0))return false;
 const x=enemy.x+dx/length*distance,y=enemy.y+dy/length*distance,tile=battle.map.grid[Math.round(y)]?.[Math.round(x)];
 const valid=tile&&tile.passableMask!=='NONE'&&tile.passableMask!=='FLY_ONLY'&&!tile.obstacle;
 if(!beginEnemySkill(battle,enemy,skill))return false;
 const restore={unblockable:!!enemy.unblockable,invulnerable:!!enemy.invulnerable,shiftImmune:!!enemy.shiftImmune,formHold:!!enemy.formHold,canAttack:enemy.canAttack};
 let cmd=enemy.cmd,checkpoint=enemy.lastCheckpoint||0;
 if(valid)while(cmd<route.length){const p=route[cmd];if(!['move','wait'].includes(p.kind))break;const px=p.x-enemy.x,py=p.y-enemy.y,along=(px*dx+py*dy)/length,lateral=Math.abs(px*dy-py*dx)/length;if(lateral>.01||along<-.01||along>distance+1e-9)break;checkpoint=Math.max(checkpoint,p.checkpointIndex||0);cmd++;}
 enemy.crownBlink={moveAt:battle.s.time+.5,endsAt:battle.s.time+1,moved:!valid,x,y,cmd,checkpoint,restore};
 enemy.unblockable=true;enemy.block=null;
 if(valid){enemy.invulnerable=true;enemy.shiftImmune=true;enemy.formHold=true;enemy.canAttack=false;}
 enemy.attackCooldown=battle.enemyAttackTiming(enemy).frames;endEnemySkill(battle,enemy);
 battle.emit('enemy-phase',{uid:enemy.uid,x:enemy.x,y:enemy.y,phase:'blink',text:'闪现'});return true;
}

// 自施法/吞噬不依赖普通攻击目标；所有伤害和强制击杀仍进入 native-effects。
export function tickEnemySkills(battle,enemy,dt){
 if(!enemy.enemySkills)return;
 if(enemy.hp<=0){cancelEnemyCast(battle,enemy);return;}
 if(tickCrownBlink(battle,enemy))return;
 if(enemy.reidRushUntil!=null&&battle.s.time+1e-9>=enemy.reidRushUntil){enemy.reidRushUntil=null;enemy.speed=enemy.baseSpeed;}
 checkWEnrage(battle,enemy);
 if(enemy.runUntil!=null&&battle.s.time+1e-9>=enemy.runUntil){enemy.runUntil=null;enemy.speed=enemy.baseSpeed;enemy.unblockable=enemy.baseUnblockable;}
 if(enemy.wineCarrying&&enemy.block!=null){enemy.wineCarrying=false;enemy.canAttack=enemy.baseCanAttack;enemy.speed=enemy.baseSpeed;}
 const control=permissions(enemy),cast=enemy.enemyCast;
 if(cast&&enemy.enemySkills[cast.index].prefab==='PollutedRangedAtk'&&enemy.action){
  const action=enemy.action,target=getActor(battle.s,action.target);
  if(!target?.deployed||target.hp<=0||(action.targetDeployGen!=null&&target.deployGen!==action.targetDeployGen)||!battle.enemySkillTargets(enemy).includes(target)){
   enemy.action=null;cancelEnemyCast(battle,enemy,{lostTarget:true});return;
  }
 }
 if(enemy.id==='enemy_1509_mousek'){tickMouseKingSkills(battle,enemy,control);return;}
 if(cast?.knightCharge){
  if(enemy.hidden||!control.attack||!control.skill||control.silenced){cancelEnemyCast(battle,enemy);return;}
  if(battle.s.time+1e-9>=cast.endsAt){
   const target=getActor(battle.s,cast.targetUid),skill=enemy.enemySkills[cast.index];
   endEnemySkill(battle,enemy);enemy.formHold=false;
   if(target?.hp>0&&target.deployed&&target.deployGen===cast.targetDeployGen&&enemy.block===target.uid){
    const attackId=newAttackId(battle);
    for(const victim of attackableAllies(battle.s))if(Math.abs(Math.round(victim.x)-Math.round(target.x))+Math.abs(Math.round(victim.y)-Math.round(target.y))<=1)
     battle.resolveEnemyStrike(enemy,victim,{scale:Number(skill.bb[victim===target?'atk_scale':'dekght[aoe].atk_scale']),type:'physical',attackId,suppressAttackZone:true});
    battle.emit('impact',{uid:enemy.uid,x:target.x,y:target.y,radius:1,type:'physical',enemy:true});
   }
  }
  return;
 }
 if(cast?.c4Targets){
  if(enemy.hidden||!control.attack||!control.skill||control.silenced||battle.s.time+1e-9>=cast.endsAt)detonateC4(battle,enemy);
  return;
 }
 if(enemy.id==='enemy_10034_cnvsax'){
  const counter=!(enemy.invisible&&!enemy.revealed&&enemy.block==null&&!enemy.immunities?.invisible);
  if(counter!==enemy.jazzCounterMode){enemy.jazzCounterMode=counter;enemy.jazzModeChanged=true;}
  if(!counter&&enemy.jazzModeChanged){
   enemy.action=null;
   if(cast){cancelEnemyCast(battle,enemy);return;}
   if(dt>0)for(const skill of enemy.enemySkills)if(skill.nextAt!=null)skill.nextAt+=dt;
  }
 }
 if(cast?.multiAttack&&(!control.attack||!control.skill||control.silenced||enemy.hidden)){cancelEnemyCast(battle,enemy);return;}
 if(enemy.enemySp?.type==='INCREASE_WITH_TIME')changeEnemySp(enemy,enemy.enemySp.increment*dt);
 if(cast?.bomb){
  if(enemy.hidden||!control.skill||!control.attack){cancelEnemyCast(battle,enemy);return;}
  if(battle.s.time+1e-9>=cast.endsAt){
   const target=getActor(battle.s,cast.targetUid),skill=enemy.enemySkills[cast.index];
   if(!target?.deployed||target.hp<=0){cancelEnemyCast(battle,enemy);return;}
   const attackId=newAttackId(battle);
   for(const victim of attackableAllies(battle.s))if(Math.abs(Math.round(victim.x)-Math.round(target.x))<=1&&Math.abs(Math.round(victim.y)-Math.round(target.y))<=1)
    battle.resolveEnemyStrike(enemy,victim,{scale:1,type:'physical',attackId,suppressAttackZone:true});
   enemy.speed=enemy.baseSpeed*Number(skill.bb.move_speed);enemy.formHold=false;
   battle.emit('impact',{uid:enemy.uid,x:target.x,y:target.y,radius:1,type:'physical',enemy:true});
   endEnemySkill(battle,enemy);
  }
  return;
 }
 if(cast?.charge){
  if(enemy.hidden||!control.skill||!control.attack||control.silenced){cancelEnemyCast(battle,enemy);return;}
  if(!cast.hitChecked&&battle.s.time+1e-9>=cast.hitAt){
   cast.hitChecked=true;
   const target=getActor(battle.s,cast.targetUid);
   if(target?.deployed&&target.hp>0&&enemy.block===target.uid){
    cast.hitAttempted=true;
    battle.resolveEnemyStrike(enemy,target,{scale:Number(enemy.enemySkills[cast.index].bb.atk_scale_s),attackId:newAttackId(battle)});
   }
  }
  if(battle.s.time+1e-9>=cast.endsAt){if(!cast.hitAttempted)cancelEnemyCast(battle,enemy);else{enemy.stanceUntil=0;endEnemySkill(battle,enemy);}}
  return;
 }
 if(enemy.enemyLostUntil!=null){
  if(battle.s.time+1e-9<enemy.enemyLostUntil)return;
  enemy.enemyLostUntil=null;enemy.canAttack=enemy.baseCanAttack;
 }
 if(cast?.victims){
  if(enemy.hidden||!control.skill||control.silenced){cancelEnemyCast(battle,enemy);return;}
  if(battle.s.time+1e-9>=cast.endsAt){
   const skill=enemy.enemySkills[cast.index];
   for(const uid of cast.victims){const victim=getActor(battle.s,uid);if(victim?.hp>0&&victim.swallowedBy===enemy.uid){changeEnemySp(enemy,Number(skill.bb.sp)||0,{duringSkill:true});commitExit(battle,{target:victim,killer:enemy,reason:'devour'});}}
   releaseCaptured(battle,enemy,cast);enemy.stanceUntil=0;endEnemySkill(battle,enemy);
  }
  return;
 }
 if(cast?.spawn){
  if(enemy.hidden||!control.skill||control.silenced){cancelEnemyCast(battle,enemy);return;}
  if(battle.s.time+1e-9>=cast.endsAt){
   for(const dx of cast.spawn.offsets)battle.queueEnemySpawn({id:cast.spawn.enemyKey},{x:enemy.x+dx,y:enemy.y,route:structuredClone(enemy.route),cmd:enemy.cmd||0});
   enemy.stanceUntil=0;endEnemySkill(battle,enemy);
  }
  return;
 }
 if(cast?.channel){
  if(enemy.hidden||!control.skill||control.silenced){cancelEnemyCast(battle,enemy);return;}
  const skill=enemy.enemySkills[cast.index],locked=cast.targetUid==null?null:getActor(battle.s,cast.targetUid);
  if(cast.channel==='jazz'&&(!locked||locked.hp<=0||!locked.deployed)){cancelEnemyCast(battle,enemy);return;}
  while(battle.s.time+1e-9>=cast.nextAt&&cast.nextAt<cast.endsAt&&cast.shots<cast.maxShots){
   cast.nextAt+=cast.interval;
   const target=cast.channel==='jazz'?locked:attackableAllies(battle.s).filter(a=>!a.hidden&&!a.untargetable&&Math.abs(Math.round(a.x)-cast.x)<=1&&Math.abs(Math.round(a.y)-cast.y)<=1).sort((a,b)=>b.hp/b.maxHp-a.hp/a.maxHp||b.uid-a.uid)[0];
   if(!target)continue;
   cast.shots++;
   battle.resolveEnemyStrike(enemy,target,{scale:Number(skill.bb.atk_scale),type:'arts',attackId:newAttackId(battle),suppressAttackZone:true});
   if(cast.channel==='jazz')applyElementDamage(battle,{source:enemy,target,amount:enemy.atk*Number(skill.bb.ep_damage_ratio),type:'burn',cause:'skill'});
  }
  if(battle.s.time+1e-9>=cast.endsAt){enemy.stanceUntil=0;endEnemySkill(battle,enemy);}
  return;
 }
 if(enemy.id==='enemy_10087_hlchgr'){
  const interval=Number(enemy.enemyTalent['SkillTrigger.interval']),max=Number(enemy.enemyTalent['SkillTrigger.max_stack_cnt']);
  if(!(interval>0)||battle.s.time+1e-9<enemy.nextEnhanceAt)return;
  enemy.nextEnhanceAt+=interval;
  if(enemy.hidden||enemy.enemyCast||!control.skill||!control.attack)return;
  const skill=enemy.enemySkills.find(s=>s.prefab==='ForeverEnhance');
  if(!skill||(enemy.enhanceStacks||0)>=max||!beginEnemySkill(battle,enemy,skill))return;
  enemy.enhanceStacks=(enemy.enhanceStacks||0)+1;
  enemy.atk=enemy.baseAtk*(1+enemy.enhanceStacks*Number(skill.bb.atk_add));
  enemy.speed=enemy.baseSpeed*(1+enemy.enhanceStacks*Number(skill.bb.move_speed_add));
  endEnemySkill(battle,enemy);return;
 }
 if(enemy.hidden||enemy.enemyCast||!control.skill||!control.attack)return;
 if(enemy.id==='enemy_1502_crowns'&&!control.silenced&&tryCrownBlink(battle,enemy))return;
 if(enemy.id==='enemy_2050_smsha'&&!control.silenced&&!enemy.action){
  const skill=enemy.enemySkills.find(s=>s.prefab==='ChainBuff');
  const candidates=battle.s.enemies.filter(e=>e!==enemy&&e.hp>0&&!e.hidden&&!e.untargetable&&!e.invulnerable&&!permissions(e).sleeping&&!isIsolated(e));
  const first=candidates.filter(e=>Math.hypot(e.x-enemy.x,e.y-enemy.y)<=enemy.range).sort((a,b)=>(b.taunt||0)-(a.taunt||0)||b.uid-a.uid)[0];
  if(skill&&first&&beginEnemySkill(battle,enemy,skill)){
   const chain=enemyChainTargets(first,candidates,Number(skill.bb['chain.max_target']),Number(skill.bb.projectile_range)),amount=battle.enemyAttackDamage(enemy,Number(skill.bb.atk_scale)),attackId=newAttackId(battle);let from=enemy;
   for(let i=0;i<chain.length;i++){
    const target=chain[i];dealDamage(battle,{source:enemy,target,amount:amount*Math.pow(Number(skill.bb['chain.atk_scale']),i),type:'arts',cause:'skill',attackId});
    if(target.hp>0){applyStatus(target,'attackSpeedUp',Number(skill.bb.duration),{source:'snow-priest-gift',value:Number(skill.bb.attack_speed),resistible:false});applyStatus(target,'chainMoveSpeed',Number(skill.bb.duration),{source:'snow-priest-gift',value:Number(skill.bb.move_speed),resistible:false});}
    battle.emit('strike',{uid:enemy.uid,x:from.x,y:from.y,targetX:target.x,targetY:target.y,ranged:true,enemy:true,type:'arts',style:'chain-buff',hit:i});from=target;
   }
   enemy.attackCooldown=battle.enemyAttackTiming(enemy).frames;endEnemySkill(battle,enemy);return;
  }
 }
 if(enemy.id==='enemy_2003_rockman'&&!control.silenced&&!enemy.action){
  const skill=enemy.enemySkills.find(s=>s.prefab==='StunAttack');
  const targets=battle.enemySkillTargets(enemy,{ranged:true,ignoreBlock:true}).filter(t=>!t.statuses?.some(s=>s.kind==='stun')).sort((a,b)=>Math.hypot(a.x-enemy.x,a.y-enemy.y)-Math.hypot(b.x-enemy.x,b.y-enemy.y));
  if(skill&&targets.length&&beginEnemySkill(battle,enemy,skill,{holdsPosition:true})){
   const target=targets[0],timing=battle.enemyAttackTiming(enemy);enemy.attackCooldown=timing.frames;
   enemy.action={startedAt:battle.s.time,left:timing.windupFrames,target:target.uid,targets:[target.uid],ranged:true,attackId:newAttackId(battle),special:{index:skill.index,prefab:skill.prefab,scale:Number(skill.bb.atk_scale),stun:Number(skill.bb.stun),stunBeforeDamage:true,type:'physical'}};return;
  }
 }
 if(enemy.id==='enemy_1539_reid'&&dt===0&&!control.silenced)tryReidRush(battle,enemy);
 if(enemy.id==='enemy_1513_dekght_2'&&!control.silenced&&!enemy.action){
  const skill=enemy.enemySkills.find(s=>s.prefab==='TripleAttack'),targets=battle.enemySkillTargets(enemy).slice(0,3);
  if(skill&&targets.length&&beginEnemySkill(battle,enemy,skill)){
   const attackId=newAttackId(battle),delay=Number(skill.bb['dekght_2[aoe].interval']),amount=battle.enemyAttackDamage(enemy,Number(skill.bb['dekght_2[aoe].atk_scale']));
   for(const target of targets)addEffect(battle,{kind:'delayed',stackRule:'stack',sourceUid:enemy.uid,targetUid:target.uid,targetDeployGen:target.deployGen,talentOrSkillId:'knight-explosive-arrow',attackId,interval:null,nextAt:battle.s.time+delay,endsAt:battle.s.time+delay,values:{knightBomb:true,type:'arts'},snapshot:{damage:amount},refKind:'owner',persistAfterSourceGone:true});
   enemy.attackCooldown=Math.ceil(enemy.interval*FPS);endEnemySkill(battle,enemy);return;
  }
 }
 if(enemy.id==='enemy_1513_dekght'&&!control.silenced&&!enemy.action&&enemy.block!=null){
  const skill=enemy.enemySkills.find(s=>s.prefab==='ChargeAttack'),target=getActor(battle.s,enemy.block);
  if(skill&&target&&beginEnemySkill(battle,enemy,skill,{knightCharge:true,targetUid:target.uid,targetDeployGen:target.deployGen,endsAt:battle.s.time+Number(skill.bb.duration)})){
   enemy.formHold=true;enemy.attackCooldown=Math.ceil(enemy.interval*FPS);return;
  }
 }
 if(enemy.id==='enemy_2008_flking'&&!control.silenced&&!enemy.action){
  const skill=enemy.enemySkills.find(s=>s.prefab==='refreshshield');
  if(skill&&beginEnemySkill(battle,enemy,skill)){
   grantShield(battle,enemy,{id:'tombstone-shield',amount:enemy.maxHp*Number(skill.bb.hp_ratio),sourceUid:enemy.uid});endEnemySkill(battle,enemy);return;
  }
 }
 if(enemy.id==='enemy_1511_mdrock'&&!control.silenced&&!enemy.action){
  const skill=enemy.enemySkills.find(s=>s.prefab==='RefreshShield');
  if(skill&&beginEnemySkill(battle,enemy,skill)){battle.refreshMudrockShield(enemy,skill.bb);endEnemySkill(battle,enemy);return;}
 }
 if(enemy.id==='enemy_1504_cqbw'&&!control.silenced&&!enemy.action){
  const skill=enemy.enemySkills.find(s=>s.prefab==='C4');
  const targets=skill?battle.enemySkillTargets(enemy,{groundOnly:!enemy.wEnraged,range:Number(skill.bb.range_radius)}).slice(0,enemy.wEnraged?3:1):[];
  if(targets.length&&enemySkillReady(enemy,skill,battle.s.time)&&beginEnemySkill(battle,enemy,skill,{c4Targets:targets.map(t=>({uid:t.uid,deployGen:t.deployGen})),endsAt:battle.s.time+3.2,attackId:newAttackId(battle)})){
   enemy.formHold=true;enemy.attackCooldown=Math.ceil(enemy.interval*FPS);return;
  }
 }
 if(enemy.id==='enemy_10001_trslim'&&!control.silenced&&enemy.hp<enemy.maxHp*.5){
  const skill=enemy.enemySkills.find(s=>s.prefab==='StartRun');
  if(skill&&beginEnemySkill(battle,enemy,skill)){
   enemy.speed=enemy.baseSpeed*(1+Number(skill.bb.move_speed));enemy.unblockable=true;enemy.block=null;enemy.action=null;
   enemy.runUntil=battle.s.time+Number(skill.bb.block_free_time);endEnemySkill(battle,enemy);
   battle.emit('enemy-phase',{uid:enemy.uid,x:enemy.x,y:enemy.y,phase:'low-hp'});return;
  }
 }
 const barrel=enemy.enemySkills.find(s=>s.prefab==='BlockedBoom');
 if(barrel&&enemy.wineCarrying===false&&!control.silenced&&!enemy.action&&beginEnemySkill(battle,enemy,barrel)){
  const target=getActor(battle.s,enemy.block);
  if(target?.deployed&&target.hp>0){
   // PRTS半径2；本期黑板提供区域持续时间、攻速、闪避与强击倍率。
   addEffect(battle,{kind:'zone',sourceUid:enemy.uid,talentOrSkillId:'enemy-wine-zone',stackRule:'stack',x:Math.round(target.x),y:Math.round(target.y),radius:2,interval:null,nextAt:null,endsAt:battle.s.time+Number(barrel.bb.fixed_duration),values:{enemyWineBuff:true,attackSpeed:Number(barrel.bb.attack_speed),physicalDodge:Number(barrel.bb.prob)},refKind:'owner',persistAfterSourceGone:true});
   battle.resolveEnemyStrike(enemy,target,{scale:Number(barrel.bb.blockee_atk_scale),type:'physical',attackId:newAttackId(battle),suppressAttackZone:true});
  }
  endEnemySkill(battle,enemy);enemy.attackCooldown=Math.ceil(enemy.interval*FPS);return;
 }
 const bomb=enemy.enemySkills.find(s=>s.prefab==='boomb');
 if(bomb){
  const target=battle.enemySkillTargets(enemy)[0];
  if(target&&beginEnemySkill(battle,enemy,bomb,{bomb:true,targetUid:target.uid,endsAt:battle.s.time+windupSeconds(enemy.interval)}))enemy.formHold=true;
  return;
 }
 if(enemy.id==='enemy_10144_xdelk_2'&&!control.silenced&&!enemy.action&&enemy.attackCooldown<=1&&enemy.block!=null){
  const skill=enemy.enemySkills.find(s=>s.prefab==='skill');
  if(skill&&beginEnemySkill(battle,enemy,skill,{charge:true,targetUid:enemy.block,hitAt:battle.s.time+6.6,endsAt:battle.s.time+Number(skill.bb.duration),hitAttempted:false})){
   enemy.stanceUntil=enemy.enemyCast.endsAt;return;
  }
 }
 if(enemy.enemyPeriodicSpawn&&!control.silenced){
  const spec=enemy.enemyPeriodicSpawn,skill=enemy.enemySkills.find(s=>s.prefab===spec.skill);
  if(skill&&beginEnemySkill(battle,enemy,skill,{spawn:spec,endsAt:battle.s.time+spec.delay}))enemy.stanceUntil=battle.s.time+spec.delay;
  return;
 }
 if(['enemy_1273_stmgun_2','enemy_10034_cnvsax'].includes(enemy.id)&&!control.silenced&&!enemy.action&&enemy.attackCooldown<=1){
  const jazz=enemy.id==='enemy_10034_cnvsax',concealed=enemy.invisible&&!enemy.revealed&&enemy.block==null;
  if(jazz&&concealed)return;
  const skill=enemy.enemySkills.find(s=>s.prefab===(jazz?'fire':'Cannon'));
  const targets=attackableAllies(battle.s).filter(a=>!a.invisible&&!a.untargetable&&Math.hypot(a.x-enemy.x,a.y-enemy.y)<=enemy.range);
  if(jazz)targets.sort((a,b)=>Number(b.uid===enemy.block)-Number(a.uid===enemy.block)||b.deployAt-a.deployAt||b.uid-a.uid);
  else targets.sort((a,b)=>b.maxHp-a.maxHp||b.uid-a.uid);
  const target=targets[0];
  if(skill&&target){
   // PRTS 自行炮：九格锁定区域，6秒内每0.5秒攻击，最多10次。爵士乐手参数取本期黑板。
   const duration=jazz?Number(skill.bb['enemy_cnvsax[cd].duration']):6,interval=jazz?Number(skill.bb.hit_interval):.5;
   const extra={channel:jazz?'jazz':'cannon',targetUid:jazz?target.uid:null,x:Math.round(target.x),y:Math.round(target.y),nextAt:battle.s.time+interval,endsAt:battle.s.time+duration,interval,shots:0,maxShots:jazz?Math.ceil(duration/interval):10};
   if(!jazz)extra.immunities={...enemy.immunities};
   if(beginEnemySkill(battle,enemy,skill,extra)){
    enemy.stanceUntil=extra.endsAt;
    if(!jazz)for(const kind of ['stun','frozen','sleep','levitate'])enemy.immunities[kind]=true;
   }
  }
  if(enemy.enemyCast)return;
 }
 if(enemy.id!=='enemy_9009_acfort'||control.silenced||enemy.action||enemy.attackCooldown>1)return;
 const choices=[];
 for(const skill of enemy.enemySkills){
  if(!enemySkillReady(enemy,skill,battle.s.time))continue;
  if(skill.prefab==='KillOthers'){
   const victims=battle.s.enemies.filter(e=>e!==enemy&&e.hp>0&&!e.hidden&&!isIsolated(e)&&e.flying&&!e.swallowedBy&&e.enemyRank==='NORMAL'&&Math.hypot(e.x-enemy.x,e.y-enemy.y)<=enemy.range*Number(skill.bb.range_radius));
   if(victims.length)choices.push({skill,victims:victims.slice(0,3)});
  }else if(skill.prefab==='FireWeapon'){
   const targets=attackableAllies(battle.s).filter(a=>!a.invisible&&!a.untargetable);
   if(targets.length)choices.push({skill,targets});
  }
 }
 if(!choices.length)return;
 const priority=Math.min(...choices.map(c=>c.skill.priority)),top=choices.filter(c=>c.skill.priority===priority),choice=top.length===1?top[0]:top[Math.floor(battle.economy.random()*top.length)];
 const {skill,victims,targets}=choice;
 if(victims){
  const endsAt=battle.s.time+Number(skill.bb.duration);
  if(!beginEnemySkill(battle,enemy,skill,{endsAt,victims:victims.map(e=>e.uid)}))return;
  enemy.stanceUntil=endsAt;
  for(const victim of victims){victim.swallowedBy=enemy.uid;applyStatus(victim,'root',Number(skill.bb.duration),{source:enemy.uid,resistible:false});}
 }else{
  const shots=Math.floor(enemy.sp);if(!beginEnemySkill(battle,enemy,skill,{allSp:true}))return;
  for(let i=0;i<shots;i++){const alive=targets.filter(t=>t.hp>0);if(!alive.length)break;const target=alive[Math.floor(battle.economy.random()*alive.length)];dealDamage(battle,{source:enemy,target,amount:enemy.atk*Number(skill.bb.atk_scale),type:'physical',cause:'skill'});}
  endEnemySkill(battle,enemy);
 }
 enemy.attackCooldown=Math.max(enemy.attackCooldown,Math.ceil(enemy.interval*FPS));
}
