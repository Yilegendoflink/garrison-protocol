import {cancelEnemyCast,beginEnemySkill,endEnemySkill} from './native-enemy-skills.js';
import {permissions,applyStatus} from './status.js';
import {FPS} from './combat.js';
import {attackableAllies,newAttackId} from './native-effects.js';

const TRANSLATOR='enemy_10081_mpplai';
const GARGOYLES=new Set(['enemy_1172_dugago','enemy_1172_dugago_2']);
const announce=(b,e,form)=>b.emit('enemy-phase',{uid:e.uid,x:e.x,y:e.y,phase:'enemy-form',form});

export function initEnemyForm(b,e){
 if(['hover','jet','parrot'].includes(e.enemyFormKind))e.groundNavigation=true;
 if(e.enemyFormKind)return;
 if(e.id==='enemy_10116_ymgtop'){
  e.enemyFormKind='rotator';e.enemyForm='normal';e.rotationProtectedUntil=b.s.time+Number(e.enemyTalent['ProtectionTime.protection_duration']);e.ranged=false;
 }else if(e.id===TRANSLATOR){
  e.enemyFormKind='translator';e.enemyForm='original';e.formDamageCounts={physical:0,arts:0};
  e.formBaseImmunities={...e.immunities};e.formBaseShiftImmune=!!e.shiftImmune;
  e.canAttack=e.baseCanAttack=false;e.shiftImmune=true;
  for(const kind of ['stun','sleep','cold','frozen','levitate','fear'])e.immunities[kind]=true;
  e.enemyFormScale={hp:b.combatScale?.hp??1,atk:b.combatScale?.atk??1,moveSpeed:b.combatScale?.moveSpeed??1};
 }else if(GARGOYLES.has(e.id)){
  e.enemyFormKind='gargoyle';e.enemyForm='ground';e.ranged=false;e.damageType='physical';
  e.formBaseImmunities={...e.immunities};
 }else if(e.id==='enemy_2025_syufo'){
  e.enemyFormKind='hover';e.enemyForm='hovering';e.flying=true;e.shiftImmune=true;e.groundNavigation=true;
  e.enemyAttack={...e.enemyAttack,groundOnly:true};
 }else if(e.id==='enemy_2004_balloon'){
  e.enemyFormKind='jet';e.enemyForm='ground';e.formBaseShiftImmune=!!e.shiftImmune;e.groundNavigation=true;
 }else if(e.id==='enemy_10045_parrot'){
  // 历史EP-3/4/8的搬运配置使用Mode.mode=1；本期默认0且checkpoint=0。
  e.enemyFormKind='parrot';e.parrotHasPassenger=Number(e.enemyTalent['Mode.mode'])===1;
  e.enemyForm=e.parrotHasPassenger?'carrying':'hovering';e.flying=true;e.shiftImmune=true;e.groundNavigation=true;e.canAttack=e.baseCanAttack=false;e.parrotCheckAt=b.s.time+.3;
 }
}

function startTranslation(b,e,form){
 if(e.enemyForm!=='original')return;
 e.enemyForm='transforming';e.nextEnemyForm=form;e.enemyFormUntil=b.s.time+2;
 e.action=null;e.formHold=true;e.unblockable=form==='ghost';if(form==='ghost')e.block=null;
 announce(b,e,'转译中');
}

// 原始形态取消伤害，但仍按物理/法术的独立次数选择形态；转换期间不重复触发。
export function enemyFormBeforeDamage(b,e,opts){
 if(e.enemyFormKind!=='translator'||!['original','transforming'].includes(e.enemyForm))return false;
 const type=opts.type||'physical';
 if(e.enemyForm==='original'&&['physical','arts'].includes(type)&&Number(opts.value??opts.amount??opts.source?.atk)>0){
  e.formDamageCounts[type]++;
  const key=type==='physical'?'Passive.phy_max_count':'Passive.magic_max_count';
  if(e.formDamageCounts[type]>=Number(e.enemyTalent[key]))startTranslation(b,e,type==='physical'?'avenger':'caster');
 }
 return true;
}

function finishTranslation(b,e){
 const form=e.nextEnemyForm,prefix={avenger:'Mode_Fuchou_Passive',caster:'Mode_Shushi_Passive',ghost:'Mode_Youling_Passive'}[form],bb=e.enemyTalent,scale=e.enemyFormScale;
 const n=key=>Number(bb[prefix+'.'+key])||0,ratio=e.hp/e.maxHp;
 e.maxHp+=n('max_hp')*scale.hp;e.baseMaxHp=e.maxHp;e.hp=e.maxHp*ratio;
 e.baseAtk+=n('atk')*scale.atk;e.atk=e.baseAtk;e.baseDef+=n('def');e.baseRes+=n('magic_resistance');
 e.baseSpeed+=n('move_speed')*scale.moveSpeed;e.speed=e.baseSpeed;e.interval+=n('base_attack_time');e.weight+=n('mass_level');
 e.immunities={...e.formBaseImmunities};e.shiftImmune=e.formBaseShiftImmune;
 e.enemyForm=form;e.nextEnemyForm=null;e.enemyFormUntil=null;e.formHold=false;e.unblockable=form==='ghost';
 e.canAttack=e.baseCanAttack=form!=='ghost';e.ranged=form==='caster';e.damageType=form==='caster'?'arts':'physical';
 e.enemyAttack=form==='caster'?{targets:2}:null;e.attackCooldown=0;e.action=null;e.lowHpRatio=0;
 announce(b,e,{avenger:'寻仇者形态',caster:'术师形态',ghost:'幽灵形态'}[form]);
}

export function tickEnemyForm(b,e){
 if(e.enemyFormKind==='rotator'){tickRotatorForm(b,e);return;}
 if(!e.enemyFormKind||e.hp<=0)return;
 if(e.enemyFormKind==='translator'){
  if(e.enemyForm==='original'&&e.block!=null)startTranslation(b,e,'ghost');
  if(e.enemyForm==='transforming'&&b.s.time+1e-9>=e.enemyFormUntil)finishTranslation(b,e);
  if(e.enemyForm==='avenger')e.atk=e.baseAtk*(e.hp/e.maxHp<.5?1+Number(e.enemyTalent['Mode_Fuchou_Anger.atk']):1);
 }else if(e.enemyFormKind==='hover'&&e.enemyForm==='hovering'){
  if((e.statuses||[]).some(s=>['stun','sleep','frozen','grounded','unableAct'].includes(s.kind))){
   e.enemyForm='crawling';e.flying=false;e.shiftImmune=false;e.ranged=false;e.block=null;e.action=null;
   applyStatus(e,'stun',.5,{source:e.uid,resistible:false});announce(b,e,'爬行形态');
  }
 }else if(e.enemyFormKind==='jet'){
  tickJetForm(b,e);
 }else if(e.enemyFormKind==='parrot'){
  tickParrotForm(b,e);
 }else if(e.enemyForm==='stone'&&b.s.time+1e-9>=e.enemyFormUntil){
  e.enemyForm='flying';e.enemyFormUntil=null;e.formHold=false;e.flying=true;e.unblockable=false;
  e.canAttack=e.baseCanAttack=true;e.ranged=true;e.damageType='arts';e.action=null;e.attackCooldown=0;
  e.immunities={...e.formBaseImmunities};e.shiftImmune=true;
  announce(b,e,'飞行形态');
 }
}

function resetParrotSpeed(e){e.parrotBoostUntil=null;e.speed=e.baseSpeed;}
export function releaseParrotPassenger(b,e,{skill=false}={}){
 if(!e.parrotHasPassenger)return false;
 const row=e.enemySkills.find(s=>s.prefab==='ThrowEnemy'),bb=skill?row?.bb:e.enemyTalent;
 const enemyKey=skill?bb?.enemy_key:bb?.['StateController.enemy_key'],count=Number(skill?bb?.cnt:bb?.['StateController.cnt']),delay=Number(skill?bb?.delay:bb?.['StateController.delay']);
 if(!enemyKey||!(count>0))return false;
 e.parrotHasPassenger=false;
 for(let i=0;i<count;i++)b.queueEnemySpawn({id:enemyKey},{x:Math.round(e.x),y:Math.round(e.y),route:structuredClone(e.route),cmd:e.cmd||0,routeDiagonal:e.routeDiagonal},delay||0);
 b.emit('enemy-ability',{uid:e.uid,x:e.x,y:e.y,ability:'release-sailor',count});return true;
}

function tickParrotForm(b,e){
 const frozen=e.statuses.some(s=>s.kind==='frozen');
 if(e.parrotWasFrozen&&!frozen)applyStatus(e,'stun',.05,{source:e.uid,resistible:false});
 e.parrotWasFrozen=frozen;
 const grounded=e.statuses.some(s=>['stun','sleep','grounded','unableAct'].includes(s.kind));
 if(e.enemyForm!=='grounded'&&grounded){
  releaseParrotPassenger(b,e);resetParrotSpeed(e);e.enemyForm='grounded';e.flying=false;e.block=null;e.shiftImmune=false;e.unblockable=true;
  applyStatus(e,'stun',Number(e.enemyTalent['Stun.duration']),{source:e.uid,resistible:false});announce(b,e,'失去悬浮');
 }else if(e.enemyForm==='grounded'&&!grounded){
  e.enemyForm='hovering';e.flying=true;e.block=null;e.shiftImmune=true;e.unblockable=e.baseUnblockable;resetParrotSpeed(e);announce(b,e,'重新起飞');
 }
 if(e.parrotBoostUntil!=null&&b.s.time>=e.parrotBoostUntil)resetParrotSpeed(e);
 if(e.enemyForm==='carrying'&&b.s.time+1e-9>=e.parrotCheckAt){
  e.parrotCheckAt=b.s.time+.3;const checkpoint=Number(e.enemyTalent['ThrowEnemy.checkpoint']);
  if(checkpoint>0&&(e.lastCheckpoint||0)>=checkpoint&&Math.hypot(e.x-Math.round(e.x),e.y-Math.round(e.y))<.4&&permissions(e).skill){
   if(releaseParrotPassenger(b,e,{skill:true})){e.enemyForm='hovering';resetParrotSpeed(e);announce(b,e,'释放水手');}
  }
 }
}

export function enemyFormAfterDamage(b,e,result){
 if(e.enemyFormKind!=='parrot'||e.hp<=0||result.total<=0||e.enemyForm==='grounded'||e.parrotDamageUsed)return;
 e.parrotDamageUsed=true;const prefix=e.enemyForm==='carrying'?'M1SpeedUp':'M0SpeedUp';
 e.parrotBoostUntil=b.s.time+Number(e.enemyTalent[prefix+'.duration']);e.speed=e.baseSpeed*Number(e.enemyTalent[prefix+'.move_speed']);
}

function tickJetForm(b,e){
 const now=b.s.time,skill=e.enemySkills.find(s=>s.prefab==='TakeOff');if(!skill)return;
 if(e.enemyForm==='ground'){
  const control=permissions(e);
  if(!e.jetArmed&&e.block!=null&&!e.action&&e.attackCooldown<=1&&control.skill&&control.attack&&!control.silenced&&beginEnemySkill(b,e,skill)){
   e.jetArmed=true;e.jetCheckAt=now+.33;e.attackCooldown=Math.ceil(e.interval*FPS);endEnemySkill(b,e);
  }
  if(e.jetArmed&&now+1e-9>=e.jetCheckAt){
   e.jetCheckAt=now+.33;
   if(e.block!=null){e.jetArmed=false;e.enemyForm='flying';e.enemyFormStartedAt=now;e.enemyFormUntil=now+Number(skill.bb.duration);e.flying=true;e.unblockable=true;e.shiftImmune=true;e.block=null;e.action=null;e.canAttack=false;announce(b,e,'升空');}
  }
 }
 if(e.enemyForm==='flying'){
  e.speed=e.baseSpeed*(1+Number(skill.bb['balloon_s[fly].move_speed']))*(now-e.enemyFormStartedAt<1.5?.1:1);
  if(now+1e-9>=e.enemyFormUntil){e.enemyForm='landing';e.enemyFormUntil=now+1.333;e.flying=false;e.shiftImmune=e.formBaseShiftImmune;e.canAttack=e.baseCanAttack;announce(b,e,'降落');}
 }
 if(e.enemyForm==='landing'){
  e.speed=e.baseSpeed*.1;
  if(now+1e-9>=e.enemyFormUntil){e.enemyForm='ground';e.enemyFormUntil=null;e.unblockable=e.baseUnblockable;e.speed=e.baseSpeed;}
 }
}

function stopRotation(b,e){
 e.enemyForm='normal';e.canAttack=e.baseCanAttack;e.action=null;e.rotationNextAt=null;
 e.rotationProtectedUntil=b.s.time+Number(e.enemyTalent['ProtectionTime.protection_duration']);
 const skill=e.enemySkills.find(s=>s.prefab==='SwitchModeTrigger');skill.nextAt=b.s.time+skill.cooldown;e.nextSkillAt=skill.nextAt;
 announce(b,e,'停止旋转');
}

// 当前位移求解器是即时推拉；由逻辑入口在成功移动结束时通知，不把普通传送当失衡。
export function enemyFormShiftEnded(b,e){
 if(e.enemyFormKind==='rotator'&&e.enemyForm==='rotating'&&b.s.time+1e-9>=e.rotationProtectedUntil)stopRotation(b,e);
}

function tickRotatorForm(b,e){
 if(e.hp<=0||e.hidden)return;
 const now=b.s.time,bb=e.enemyTalent,control=permissions(e),skill=e.enemySkills.find(s=>s.prefab==='SwitchModeTrigger');
 if(!skill)return;
 if(e.enemyForm==='normal'){
  if(now+1e-9<e.rotationProtectedUntil||!control.skill||!control.attack||control.silenced||e.action)return;
  if(!beginEnemySkill(b,e,skill))return;
  endEnemySkill(b,e);e.enemyForm='rotating';e.canAttack=false;e.action=null;
  e.rotationProtectedUntil=now+Number(bb['ProtectionTime.protection_duration']);e.enemyFormUntil=now+Number(bb['EndRotate.rotate_duration']);e.rotationNextAt=now+Number(bb['RotateDamage.interval']);announce(b,e,'漩涡形态');return;
 }
 while(e.hp>0&&e.rotationNextAt<=e.enemyFormUntil+1e-9&&now+1e-9>=e.rotationNextAt){
  e.rotationNextAt+=Number(bb['RotateDamage.interval']);
  if(!control.attack||control.silenced)continue;
  const attackId=newAttackId(b);
  for(const target of attackableAllies(b.s))if(!target.flying&&Math.hypot(target.x-e.x,target.y-e.y)<=Number(bb['RotateDamage.attack@range_radius'])+1e-9)
   b.resolveEnemyStrike(e,target,{scale:Number(bb['RotateDamage.attack@atk_scale']),type:'physical',attackId,suppressAttackZone:true});
  b.emit('impact',{uid:e.uid,x:e.x,y:e.y,radius:Number(bb['RotateDamage.attack@range_radius']),type:'physical',enemy:true});
 }
 if(now+1e-9>=e.enemyFormUntil)stopRotation(b,e);
}

export function enemyFormStats(e){
 if(e.enemyFormKind==='gargoyle'&&e.enemyForm==='stone'){
  e.def+=Number(e.enemyTalent['stone.def'])||0;e.res+=Number(e.enemyTalent['stone.magic_resistance'])||0;
 }
}

export function enemyFormFatal(b,e){
 if(e.enemyFormKind!=='gargoyle'||e.enemyForm!=='ground'||e.pillarBrokenUntil>b.s.time)return false;
 cancelEnemyCast(b,e);
 e.enemyForm='stone';e.enemyFormUntil=b.s.time+Number(e.enemyTalent['stone.duration']);
 e.hp=e.maxHp;e.block=null;e.action=null;e.formHold=true;e.unblockable=true;e.canAttack=false;e.shiftImmune=true;
 e.immunities.levitate=true;enemyFormStats(e);
 announce(b,e,'石像形态');return true;
}
