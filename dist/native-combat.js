import {attribute,FPS} from './combat.js';
import {permissions} from './status.js';
import {skillKind} from './native-sp.js';

// Tentative adapters — not original animation tables. Do not treat as restored data.
export const TENTATIVE_WINDUP_RATIO=.3;
export const TENTATIVE_PROJECTILE_SPEED=6;
export const TENTATIVE_HIT_GAP=2/FPS;

// Enemy movement and attack are intentionally separate.  The original game has
// enemies that fire while moving, enemies that hold after acquiring a target,
// and enemies that only hold during a burst or a scripted stance.
export const ENEMY_MOVEMENT_POLICIES=Object.freeze({
 ALWAYS_MOVE_ATTACK:'always-move-attack',
 STOP_ON_TARGET:'stop-on-target',
 STOP_WHILE_ATTACKING:'stop-while-attacking',
 BURST_THEN_MOVE:'burst-then-move',
 SCHEDULED_STOP:'scheduled-stop',
 SKILL_CONTROLLED:'skill-controlled'
});

function enemyText(raw={}){
 const ability=Array.isArray(raw.ability)?raw.ability.map(x=>typeof x==='string'?x:x?.text||''):[];
 const skills=Array.isArray(raw.skills)?raw.skills.flatMap(x=>[x?.description,x?.prefabKey]):[];
 // 原表描述带 <@eb.key>…</> 富文本标签，先去掉再匹配，否则「持续受到…法术伤害」会被标签切断。
 return [raw.name,raw.description,...ability,...skills].filter(Boolean).join(' ').replace(/<[^>]*>/g,'');
}

function enemyBlackboard(raw={}){
 const out={};const rows=[...(raw.talentBlackboard||[]),...(raw.skills||[]).flatMap(skill=>skill?.blackboard||[])];for(const row of rows)if(row?.key!=null)out[row.key]=Number.isFinite(Number(row.value))?Number(row.value):row.value;
 return out;
}
function enemyTalentBlackboard(raw={}){
 const out={};for(const row of raw.talentBlackboard||[])if(row?.key!=null)out[row.key]=Number.isFinite(Number(row.value))?Number(row.value):row.value;return out;
}

function enemySkill(raw={}){
 const skill=(raw.skills||[]).find(x=>x?.prefabKey&&!['BornAnim','StartRun','EndAnim','BeginAnim'].includes(x.prefabKey));
 if(!skill)return null;
 const bb={};for(const row of skill.blackboard||[])if(row?.key!=null)bb[row.key]=Number.isFinite(Number(row.value))?Number(row.value):row.value;
 return {prefab:skill.prefabKey,cooldown:Number(skill.cooldown),initCooldown:Number(skill.initCooldown),spCost:Number(skill.spCost)||0,bb};
}

// 原表把持续伤害区域写成「buff 模板名.字段」形式的 blackboard 行。这里按模板名取值，取不到就返回
// undefined —— 宁可漏掉一个敌人，也不要为它编造半径或伤害。
function firstTemplateField(bb,name,field){
 const row=bb[`${name}.${field}`];
 return row===undefined?undefined:Number(row);
}

function hasZonePayload(zone){
 return !!zone&&(Number(zone.damage)>0||Number(zone.atkScale)>0||Number(zone.elementScale)>0);
}

// 死亡区域（PollutedDie 等）：以自身死亡位置为中心的一次性持续伤害区。
export function inferDeathZone(raw={}){
 const behavior=raw.enemyBehavior||raw.behavior||{};
 if(behavior.deathZone)return behavior.deathZone;
 const bb=enemyBlackboard(raw),skillBb={...(enemySkill(raw)?.bb||{}),...bb};
 const damage=firstTemplateField(bb,'PollutedDie','polluted_damage_low');
 if(!Number.isFinite(damage)||damage<=0)return null;
 const radius=firstTemplateField(bb,'PollutedDie','projectile_range'),life=firstTemplateField(bb,'PollutedDie','projectile_life_time');
 return {trigger:'death',radius:Number.isFinite(radius)&&radius>0?radius:1,duration:Number.isFinite(life)&&life>0?life:8,interval:1,damage,damageType:'true'};
}

// 射击落点区域（ProjectileBoomRange 等）：普通攻击命中后在目标格留一片持续伤害区。
export function inferAttackZone(raw={}){
 const behavior=raw.enemyBehavior||raw.behavior||{};
 if(behavior.attackZone)return behavior.attackZone;
 const bb=enemyBlackboard(raw),text=enemyText(raw);
 const damage=firstTemplateField(bb,'ProjectileBoomRange','attack@value');
 if(/燃烧区域/.test(text)&&Number.isFinite(damage)&&damage>0){
  const radius=firstTemplateField(bb,'ProjectileBoomRange','attack@projectile_range'),life=firstTemplateField(bb,'ProjectileBoomRange','attack@projectile_life_time');
  return {trigger:'attack',radius:Number.isFinite(radius)&&radius>0?radius:1,duration:Number.isFinite(life)&&life>0?life:3,interval:1,damage,damageType:'true'};
 }
 const skill=enemySkill(raw),skillBb=skill?.bb||{};
 const polluted=Number(skillBb.polluted_damage_low);
 if(skill?.prefab==='PollutedRangedAtk'&&Number.isFinite(polluted)&&polluted>0){
  const radius=Number(skillBb.range_radius),life=Number(skillBb.projectile_life_time);
  return {trigger:'attack',radius:Number.isFinite(radius)&&radius>0?radius:1,duration:Number.isFinite(life)&&life>0?life:10,interval:1,damage:polluted,damageType:'true'};
 }
 return null;
}

// 常驻范围（EpDamage 等）：敌人活着时每秒对半径内我方造成法术伤害与元素损伤。
// 只在伤害或元素损伤至少有一项有原表数值时才成立，否则宁可不做。
export function inferSelfField(raw={}){
 const behavior=raw.enemyBehavior||raw.behavior||{};
 const text=enemyText(raw),talentBb=enemyTalentBlackboard(raw);
 // 必须同时有「持续对周围造成」的描述和一个正数的自身半径，才视为常驻范围。
 // 单看文本会把「击倒后毒雾持续对周围造成伤害」这类死亡技能误判成常驻光环；快照里留下的
 // 空壳（半径或伤害全为 0）也不采用，交给下面的推导重新算。
 const radius=Number(raw.rangeRadius);
 const payload=z=>!!z&&(Number(z.damage)>0||Number(z.atkScale)>0||Number(z.elementScale)>0);
 if(behavior.selfField&&payload(behavior.selfField)&&Number(behavior.selfField.radius)>0)return behavior.selfField;
 if(!/持续对周围造成/.test(text)||!(Number.isFinite(radius)&&radius>0))return null;
 const elementScale=Number(talentBb['EpDamage.ep_damage_ratio']??talentBb['epdamage.attack@ep_damage_ratio']);
 const elementType=/神经损伤/.test(text)?'neural':/侵蚀损伤/.test(text)?'corrosion':/凋亡损伤/.test(text)?'necrosis':/灼燃损伤/.test(text)?'burn':null;
 const atkScale=Number(talentBb['EpDamage.attack@atk_scale']??talentBb['EpDamage.damage_atk_scale']);
 const hasElement=Number.isFinite(elementScale)&&elementScale>0&&elementType;
 const hasDamage=Number.isFinite(atkScale)&&atkScale>0;
 if(!hasElement&&!hasDamage)return null;
 return {
  radius,
  interval:1,
  atkScale:hasDamage?atkScale:0,
  damage:0,
  damageType:'arts',
  elementScale:hasElement?elementScale:0,
  elementType
 };
}

// 死亡后留下的毒雾（假想敌：蚀裂等）：被击倒时向击倒者所在位置留下一片持续伤害区。
export function inferToxicZone(raw={}){
 const behavior=raw.enemyBehavior||raw.behavior||{};
 if(behavior.toxicZone)return behavior.toxicZone;
 const text=enemyText(raw),talentBb=enemyTalentBlackboard(raw);
 if(!/击倒(?:后|时)[^。；;]*毒雾|毒雾/.test(text))return null;
 const atkScale=Number(talentBb['1.damage_atk_scale']),radius=Number(talentBb['1.projectile_range']),life=Number(talentBb['1.projectile_life_time']),interval=Number(talentBb['1.interval']);
 if(!Number.isFinite(atkScale)||atkScale<=0)return null;
 return {trigger:'death-target',radius:Number.isFinite(radius)&&radius>0?radius:1,duration:Number.isFinite(life)&&life>0?life:8,interval:Number.isFinite(interval)&&interval>0?interval:1,atkScale,damage:0,damageType:'arts'};
}

// 逐腐兽的流血：命中后周期性受到法术伤害，目标被治疗时提前解除。
function inferBleeding(raw={}){
  const behavior=raw.enemyBehavior||raw.behavior||{};
  if(behavior.bleeding)return behavior.bleeding;
  const text=enemyText(raw),talentBb=enemyTalentBlackboard(raw);
  if(!/持续受到法术伤害/.test(text)||!/治疗时解除/.test(text))return null;
  const damage=Number(talentBb['Bleeding.attack@bleeding_damage']),duration=Number(talentBb['Bleeding.attack@duration']);
  if(!Number.isFinite(damage)||damage<=0)return null;
  return {damage,duration:Number.isFinite(duration)&&duration>0?duration:10,interval:1,cureOnHeal:true};
}

// 抵抗：原表用 one_minus_status_resistance 的负值表示「可抵抗状态时间减半」。
function inferStatusResistance(raw={}){
 const behavior=raw.enemyBehavior||raw.behavior||{};
 if(Number.isFinite(behavior.statusResistance))return Math.max(0,Math.min(1,behavior.statusResistance));
 const value=Number(enemyTalentBlackboard(raw)['Buff.one_minus_status_resistance']);
 return Number.isFinite(value)&&value<0?Math.min(1,-value):0;
}

function inferGroundZone(raw={}){
 const behavior=raw.enemyBehavior||raw.behavior||{};
 if(behavior.groundZone)return behavior.groundZone;
 return null;
}

// Infer only safe, explicitly documented policies.  Ambiguous ranged enemies
// use attack-only stopping; explicit page/level policies still take priority.
export function enemyBehaviorProfile(raw={}){
 const normalized=raw.enemyBehavior;
 // 快照里已经带推导结果（behaviorInferred）时直接复用；否则重新推导，避免把上一轮的空字段
 // 当成「已配置为关闭」而永远推不出持续伤害区域。
 if(normalized?.behaviorInferred&&normalized.attackWhileMoving!==undefined&&normalized.stallTimeout!==undefined)return {...normalized};
 const explicit=raw.movementPolicy||raw.enemyBehavior?.movementPolicy||raw.behavior?.movementPolicy;
 const text=enemyText(raw);
 let movementPolicy=explicit||(raw.applyWay==='RANGED'?ENEMY_MOVEMENT_POLICIES.STOP_WHILE_ATTACKING:ENEMY_MOVEMENT_POLICIES.STOP_ON_TARGET);
 if(!explicit){
  if(/不停止移动|持续攻击.*移动|移动中.*攻击/.test(text))movementPolicy=ENEMY_MOVEMENT_POLICIES.ALWAYS_MOVE_ATTACK;
  else if(/周期性停止移动/.test(text))movementPolicy=ENEMY_MOVEMENT_POLICIES.SCHEDULED_STOP;
  else if(/停止移动.*蓄力|停止攻击.*蓄力|蓄力.*停止攻击/.test(text))movementPolicy=ENEMY_MOVEMENT_POLICIES.SKILL_CONTROLLED;
  else if(/攻击数次后.*(?:蓄力|继续移动)|连续攻击.*(?:后|再).*移动/.test(text))movementPolicy=ENEMY_MOVEMENT_POLICIES.BURST_THEN_MOVE;
 }
 const behavior=raw.enemyBehavior||raw.behavior||{};
 const bb=enemyBlackboard(raw),talentBb=enemyTalentBlackboard(raw);
 const specialSkill=enemySkill(raw);
 const burstFromText=/三连击|攻击3次/.test(text)?3:/二连击|攻击2次/.test(text)?2:0;
 if(!explicit&&burstFromText>0&&[ENEMY_MOVEMENT_POLICIES.STOP_ON_TARGET,ENEMY_MOVEMENT_POLICIES.STOP_WHILE_ATTACKING].includes(movementPolicy)&&raw.applyWay==='RANGED')movementPolicy=ENEMY_MOVEMENT_POLICIES.BURST_THEN_MOVE;
 const burstShots=Number(behavior.burstShots??raw.burstShots??burstFromText);
 const burstDuration=Number(behavior.burstDuration??raw.burstDuration);
 const burstCooldown=Number(behavior.burstCooldown??raw.burstCooldown);
 const stallTimeout=Number(behavior.stallTimeout??raw.stallTimeout);
 const stanceInterval=Number(behavior.stanceInterval??raw.stanceInterval);
 const stanceDuration=Number(behavior.stanceDuration??raw.stanceDuration);
 const supportedSkillPrefabs=new Set(['AOEAttack','CrossAttack','PowerAttack','StunAttack','stuncombat','InvisibleCombat','DeathEye','PollutedRangedAtk','Flame']);
 const complexity=behavior.complexity||(/召唤|分裂|重生|复活|变身|传送|遁地|载客|乘客|改变路线|修改地块|地图变化|全场.*效果|区域.*生成|多阶段/.test(text)||Boolean(specialSkill&&!supportedSkillPrefabs.has(specialSkill.prefab))?'complex':'common');
 const randomPoolEligible=behavior.randomPoolEligible??(complexity!=='complex');
 const stunMatch=text.match(/攻击\s*(\d+)次后[^。；;]*晕眩/),stunBefore=stunMatch?Number(stunMatch[1]):(/数次攻击后[^。；;]*晕眩/.test(text)?Number(raw.skills?.[0]?.spCost)||3:0);
 const elementKey=/侵蚀损伤/.test(text)?'corrosion':/凋亡损伤/.test(text)?'necrosis':/灼燃损伤/.test(text)?'burn':/神经损伤/.test(text)?'neural':null;
 const elementScale=Number(talentBb['epdamage.attack@ep_damage_ratio']??talentBb['EpDamage.attack@ep_damage_ratio']??talentBb['empty.attack@ep_damage_ratio']??talentBb['ep_damage_ratio']);
 const explosion= /死亡[^。；;]*(?:产生|造成|爆炸)/.test(text)?{type:/法术/.test(text)?'arts':'physical',scale:Number(bb['boom.atk_scale'])||1,radius:Number(behavior.deathExplosionRadius??raw.deathExplosionRadius)||1,requiresFire:/点燃状态/.test(text)}:null;
 const auraDef=Number(bb['defup.def']);
 const auraRadius=Number(bb['defup.range_radius']??bb['aura.range_radius']);
 const auraDamageResistance=Number(bb['aura.damage_resistance']);
 const magicResistanceBonus=Number(bb['refracting.magic_resistance']);
 const lowHpRatio=Number(bb['atkup.hp_ratio']??bb['enrage.hp_ratio']??behavior.lowHpRatio??(/生命值降至一半以下|生命值低于50%|生命值低于一半/.test(text)?0.5:0));
 const lowHpAttackAdd=Number(bb['atkup.atk']??bb['AtkUp.atk']);
 const lowHpAttackScale=Number(bb['enrage.damage_scale']??behavior.lowHpAttackScale);
 const lowHpMoveScale=Number(bb['move_speed']??bb['run.attack@move_speed']);
 const lowHpUnblockTime=Number(bb['block_free_time']??behavior.lowHpUnblockTime);
 const initialInvisible=behavior.initialInvisible??/^\s*(?:<[^>]+>)*隐匿/.test(String(raw.description||''));
 const initialUnblockable=behavior.initialUnblockable??/无法被阻挡/.test(text);
 const initialShield=Number(bb['shield.dynamic']??behavior.initialShield);
 const specialAtkScale=Number(specialSkill?.bb?.atk_scale??specialSkill?.bb?.damage_scale);
 const firstAttackSplash=/首次攻击[^。；;]*溅射/.test(text);
 const meleeAttackScale=Number(talentBb['Empty.attack@chuang_atk_scale']);
 const pollutedDamage=Number(specialSkill?.bb?.polluted_damage_low);
 const explicitAttack=behavior.attackZone,explicitDeath=behavior.deathZone??behavior.toxicZone;
 const zoneAttack=explicitAttack??inferAttackZone(raw);
 // 只认「有伤害参数」的常驻范围：旧快照里留下的空壳（无伤害也无元素损伤）当作没有，重新推导。
 const zoneSelf=inferSelfField(raw);
 const zoneDeath=explicitDeath??inferDeathZone(raw)??inferToxicZone(raw);
 const bleedingTrait=inferBleeding(raw);
 const resistValue=inferStatusResistance(raw);
 const groundZone=behavior.groundZone??null;
 return {
  movementPolicy,
  attackWhileMoving:movementPolicy===ENEMY_MOVEMENT_POLICIES.ALWAYS_MOVE_ATTACK,
  burstShots:Number.isFinite(burstShots)&&burstShots>0?Math.floor(burstShots):0,
  burstDuration:Number.isFinite(burstDuration)&&burstDuration>0?burstDuration:0,
  burstCooldown:Number.isFinite(burstCooldown)&&burstCooldown>=0?burstCooldown:0,
  stanceInterval:Number.isFinite(stanceInterval)&&stanceInterval>0?stanceInterval:0,
  stanceDuration:Number.isFinite(stanceDuration)&&stanceDuration>0?stanceDuration:0,
  stallTimeout:Number.isFinite(stallTimeout)&&stallTimeout>0?stallTimeout:2,
  complexity,
  randomPoolEligible,
  attackStunEvery:stunBefore>0?stunBefore+1:0,
  attackStunDuration:Number(bb.stun)||Number(behavior.attackStunDuration)||0,
  attackElement:elementKey,
  attackElementScale:Number.isFinite(elementScale)&&elementScale>0?elementScale:0,
  deathExplosion:explosion,
  aura:auraDef>0||auraDamageResistance>0?{def:auraDef>0?auraDef:0,damageResistance:auraDamageResistance>0?Math.min(1,auraDamageResistance):0,radius:Number.isFinite(auraRadius)&&auraRadius>0?auraRadius:1}:null,
  magicResistanceBonus:Number.isFinite(magicResistanceBonus)&&magicResistanceBonus>0?magicResistanceBonus:0,
  lowHpRatio:Number.isFinite(lowHpRatio)&&lowHpRatio>0&&lowHpRatio<1?lowHpRatio:0,
  lowHpAttackMultiplier:Number.isFinite(lowHpAttackScale)&&lowHpAttackScale>0?lowHpAttackScale:Number.isFinite(lowHpAttackAdd)&&lowHpAttackAdd>0?1+lowHpAttackAdd:0,
  lowHpMoveMultiplier:Number.isFinite(lowHpMoveScale)&&lowHpMoveScale>0?lowHpMoveScale:0,
  lowHpUnblockTime:Number.isFinite(lowHpUnblockTime)&&lowHpUnblockTime>0?lowHpUnblockTime:0,
  initialInvisible:Boolean(initialInvisible),
  initialUnblockable:Boolean(initialUnblockable),
  initialShield:Number.isFinite(initialShield)&&initialShield>0?initialShield:0,
  specialSkill,
  specialAtkScale:Number.isFinite(specialAtkScale)&&specialAtkScale>0?specialAtkScale:0,
  firstAttackSplash,
  meleeAttackScale:Number.isFinite(meleeAttackScale)&&meleeAttackScale>0?meleeAttackScale:0,
  pollutedDamage:Number.isFinite(pollutedDamage)&&pollutedDamage>0?pollutedDamage:0,
  groundZone,
  attackZone:zoneAttack,
  selfField:zoneSelf,
  deathZone:zoneDeath,
  bleeding:bleedingTrait,
  statusResistance:resistValue,
  behaviorInferred:true
 };
}

export function enemyTargetValid(target){
 return !!target&&target.hp>0&&!target.hidden&&!target.untargetable&&!target.invulnerable;
}

export function enemyTargetInRange(enemy,target){
 if(!enemyTargetValid(target))return false;
 const range=Number(enemy.range||0);
 if(!Number.isFinite(range)||range<=0)return false;
 return Math.hypot((enemy.x??0)-(target.x??0),(enemy.y??0)-(target.y??0))<=range+(target.hitRadius||0);
}

export function enemyShouldHoldPosition(enemy,{target=null,now=0}={}){
 if(enemy?.hidden||enemy?.untargetable)return false;
 if(enemy?.block!=null)return true;
 const policy=enemy?.movementPolicy||ENEMY_MOVEMENT_POLICIES.STOP_ON_TARGET;
 const valid=enemyTargetValid(target);
 switch(policy){
  case ENEMY_MOVEMENT_POLICIES.ALWAYS_MOVE_ATTACK:return false;
  case ENEMY_MOVEMENT_POLICIES.STOP_WHILE_ATTACKING:return !!enemy.action;
  case ENEMY_MOVEMENT_POLICIES.BURST_THEN_MOVE:
   return !(Number(enemy.burstUntil)>now)&&Boolean(enemy.action||(
    valid&&Number(enemy.burstShots)>0&&Number(enemy.burstFired)>0&&Number(enemy.burstFired)<Number(enemy.burstShots)
   ));
  case ENEMY_MOVEMENT_POLICIES.SCHEDULED_STOP:return Number(enemy.stanceUntil)>now;
  case ENEMY_MOVEMENT_POLICIES.SKILL_CONTROLLED:return !!enemy.action||Number(enemy.stanceUntil)>now;
  case ENEMY_MOVEMENT_POLICIES.STOP_ON_TARGET:
  default:return valid;
 }
}

export function remainingDistance(e){
 const route=e.route;if(!route||route.length===0)return 0;
 let d=0,x=e.x,y=e.y,i=e.cmd??e.segment??0;
 for(;i<route.length;i++){
  const s=route[i],kind=s.kind||'move';
  if(kind==='appear'){x=s.x;y=s.y;continue;}
  if(kind!=='move')continue;
  d+=Math.hypot((s.x??s[0])-x,(s.y??s[1])-y);
  x=s.x??s[0];y=s.y??s[1];
 }
 return d;
}
export function specialPriority(a,b,priority){
 if(priority==='air')return Number(!!b.flying)-Number(!!a.flying);
 if(priority==='defense')return (a.def||0)-(b.def||0);
 if(priority==='weight')return (b.weight||0)-(a.weight||0);
 return 0;
}
export function compareOperatorTargets(a,b,uid,priority,position){
 const blocked=position==='RANGED'?0:Number(b.block===uid)-Number(a.block===uid);
 return blocked
  || specialPriority(a,b,priority)
  || (b.taunt||0)-(a.taunt||0)
  || remainingDistance(a)-remainingDistance(b)
  || a.uid-b.uid;
}
export function compareEnemyTargets(a,b){
 return (b.tauntLevel||b.taunt||0)-(a.tauntLevel||a.taunt||0) || (b.deployAt||0)-(a.deployAt||0) || b.uid-a.uid;
}
export function enemyBlockCost(e){return Math.max(1,e.blockCost||1);}
export function canStayBlocked(e,u,used,cap){
 if(!u||!e||e.hp<=0||e.flying||e.hidden||e.untargetable||e.unblockable)return false;
 if(!permissions(e).beBlocked||!permissions(u).block||!u.deployed||u.hp<=0)return false;
 if(Math.hypot(u.x-e.x,u.y-e.y)>=.72)return false;
 return used+enemyBlockCost(e)<=cap;
}
export function resolveBlocks(units,enemies,capOf){
 const alive=units.filter(u=>u.hp>0&&u.deployed),used=new Map();
 for(const u of alive)used.set(u.uid,0);
 for(const e of enemies){
  if(e.hp<=0||e.trainingDummy){e.block=null;continue;}
  const u=alive.find(x=>x.uid===e.block),cap=u?capOf(u):0,need=enemyBlockCost(e);
  if(!canStayBlocked(e,u,used.get(u?.uid)||0,cap))e.block=null;
  else used.set(u.uid,(used.get(u.uid)||0)+need);
 }
 const seekers=enemies.filter(e=>e.hp>0&&!e.trainingDummy&&e.block==null&&!e.flying&&!e.hidden&&!e.untargetable&&!e.unblockable&&permissions(e).beBlocked).sort((a,b)=>a.uid-b.uid);
 for(const e of seekers){
  const need=enemyBlockCost(e);
  const u=alive.filter(x=>permissions(x).block&&Math.hypot(x.x-e.x,x.y-e.y)<.72&&(used.get(x.uid)||0)+need<=capOf(x)).sort((a,b)=>a.uid-b.uid)[0];
  if(u){e.block=u.uid;used.set(u.uid,(used.get(u.uid)||0)+need);}
 }
}
export function compileRoute(route,to,walk,bfs){
 const start=to(route.startPosition),end=to(route.endPosition);
 const raw=[{kind:'move',x:start.x,y:start.y},...(route.checkpoints||[]).map(c=>{
  const p=c.position?to(c.position):start,type=c.type||'MOVE';
  if(type==='WAIT_FOR_SECONDS'||type==='WAIT')return {kind:'wait',x:null,y:null,time:c.time||0};
  if(type==='DISAPPEAR')return {kind:'disappear',x:null,y:null};
  if(type==='APPEAR_AT_POS'||type==='APPEAR')return {kind:'appear',x:p.x,y:p.y};
  if(type==='MOVE'||type==='PATROL_MOVE')return {kind:'move',x:p.x,y:p.y};
  throw Error('未支持的路线指令 '+type);
 }),{kind:'move',x:end.x,y:end.y}];
 const steps=[{kind:'move',x:start.x,y:start.y}];let cur=start;
 const pushWalk=(dest)=>{
  if(cur.x===dest.x&&cur.y===dest.y)return;
  if(!walk){steps.push({kind:'move',x:dest.x,y:dest.y});cur=dest;return;}
  const segment=bfs(cur,dest);if(!segment)throw Error('原始路线不可达：'+cur.x+','+cur.y+' → '+dest.x+','+dest.y);
  for(const p of segment)steps.push({kind:'move',x:p.x,y:p.y});
  cur=dest;
 };
 for(const node of raw){
  if(node.kind==='move')pushWalk(node);
  else if(node.kind==='appear'){steps.push(node);cur={x:node.x,y:node.y};}
  else{
   if(node.x!=null&&(node.x!==cur.x||node.y!==cur.y))pushWalk({x:node.x,y:node.y});
   steps.push({...node,x:cur.x,y:cur.y});
  }
 }
 return steps.length?steps:[{kind:'move',x:start.x,y:start.y}];
}
export function advanceEnemy(e,dt,onEvent,stopForAttack=false){
 if(e.hp<=0||e.trainingDummy||!e.route)return false;
 if(!Number.isInteger(e.cmd))e.cmd=Math.min(e.route.length,(e.segment||0)+1);
 const slow=(e.statuses||[]).some(s=>s.kind==='sluggish')?0.2:1;
 while(e.cmd<e.route.length){
  const s=e.route[e.cmd];
  if(s.kind==='wait'){
   if(e.cmdLeft==null)e.cmdLeft=s.time;
   const used=Math.min(dt,e.cmdLeft);e.cmdLeft-=used;dt-=used;
   if(e.cmdLeft<=1e-9){e.cmd++;e.cmdLeft=null;}
   if(dt<=1e-9)break;
   continue;
  }
  if(s.kind==='disappear'){e.hidden=true;e.untargetable=true;e.block=null;e.action=null;e.cmd++;e.cmdLeft=null;onEvent?.('disappear',e);continue;}
  if(s.kind==='appear'){e.x=s.x;e.y=s.y;e.hidden=false;e.untargetable=false;e.cmd++;e.cmdLeft=null;onEvent?.('appear',e);continue;}
  const dx=s.x-e.x,dy=s.y-e.y,d=Math.hypot(dx,dy);
  if(d<=1e-9){e.cmd++;continue;}
  const speed=(!e.block&&permissions(e).move&&!stopForAttack)?e.speed*slow:0;
  if(speed<=0||dt<=1e-9)break;
  const move=speed*dt;
  if(d<=move){e.x=s.x;e.y=s.y;e.cmd++;e.cmdLeft=null;dt-=d/speed;}
  else{e.x+=dx/d*move;e.y+=dy/d*move;break;}
 }
 e.progress=remainingDistance(e);
 return e.cmd>=e.route.length;
}
// 持续伤害区域（logicEffects kind:'field'）的标识：同一名敌人的常驻光环/流血只保留一份，
// 不同敌人各自独立；不随攻击次数变化，避免每次攻击都新开一片区域。
export function enemySpecialTraitId(enemy){
 return `${enemy?.id??'enemy'}-${enemy?.uid??0}-zone`;
}
// 逐腐兽流血的独立标识：治疗解除钩子靠它识别「可治疗解除」的持续伤害。
export function enemyBleedingTraitId(enemy){
 return `${enemy?.id??'enemy'}-${enemy?.uid??0}-bleeding`;
}
export function skillFlow(skill){
 const kind=skillKind(skill);
 if(!kind)return {kind:null,resetAttack:false,lockSp:false,changeAttack:false};
 const desc=skill.description||'';
 return {
  kind,
  resetAttack:skill.combatFlow?.resetAttack??(kind!=='instant'),
  lockSp:kind==='duration'||kind==='ammo',
  changeAttack:kind==='duration'||kind==='ammo'||/攻击力|攻击间隔|攻击变为/.test(desc)
 };
}
export function combineStat(base,add,ratio,muls,finalAdd=0){
 return attribute(base,{add,ratio,finalAdd,scales:muls||[]});
}
export function emitEvent(s,type,extra={}){
 const {type:damageType,...details}=extra;
 s.eventId=(s.eventId||0)+1;
 s.events??=[];s.events.push({...details,damageType,t:s.time,type,id:s.eventId});
 if(s.events.length>96)s.events.splice(0,s.events.length-96);
}
export function pruneEvents(s,keep=4){
 if(!s.events)return;s.events=s.events.filter(e=>s.time-e.t<=keep);
}
export function scheduleStrikes(s,hits,base){
 const gap=base.gap??TENTATIVE_HIT_GAP;
 for(let i=0;i<hits;i++)(s.strikes??=[]).push({...base,at:s.time+(base.delay||0)+i*gap,hit:i});
}
export function dueStrikes(s){
 const due=(s.strikes||[]).filter(x=>x.at<=s.time);s.strikes=(s.strikes||[]).filter(x=>x.at>s.time);return due;
}
export function windupSeconds(interval,override){
 if(Number.isFinite(override)&&override>=0)return override;
 return interval*TENTATIVE_WINDUP_RATIO;
}
