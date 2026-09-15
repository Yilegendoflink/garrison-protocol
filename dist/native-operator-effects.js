import {applyStatus} from './status.js';

// Per-operator adapters share only small, data-driven primitives. A missing
// primitive remains visible in the capability ledger instead of silently
// becoming a normal attack.
const NUMERIC_KEYS={
 atkScale:['atk_scale','attack@atk_scale','attack@atk_scale_1','damage_scale'],
 maxTarget:['max_target','attack@max_target','attack@times_target'],
 hits:['attack@times','times','hit_count','attack@hit_count'],
 stun:['stun','attack@stun'],sleep:['sleep','attack@sleep'],fear:['fear','attack@fear'],terror:['terror','attack@terror'],tremble:['tremble','attack@tremble'],sluggish:['sluggish','attack@sluggish'],
 silence:['silence','attack@silence'],root:['root','attack@root'],
 healScale:['heal_scale','attack@heal_scale','attack@atk_to_hp_recovery_ratio'],
 cost:['cost','attack@cost'],ammo:['attack@trigger_time'],attackSpeed:['attack_speed'],value:['value'],hpRatio:['hp_ratio'],
 maxHp:['max_hp'],def:['def'],atk:['atk'],blockCnt:['block_cnt'],defPenetrateFixed:['def_penetrate_fixed'],damageScale:['damage_scale']
};
const firstNumber=(bb,keys)=>{for(const key of keys){const value=bb[key];if(Number.isFinite(Number(value)))return Number(value);}return null;};
export function blackboardValues(skill){const bb=Object.fromEntries((skill?.blackboard||[]).map(x=>[x.key,x.valueStr??x.value]));const out={...bb,raw:bb};for(const [name,keys] of Object.entries(NUMERIC_KEYS)){const value=firstNumber(bb,keys);if(value!=null)out[name]=value;}return out;}
function suffixNumber(bb,patterns){for(const [key,value] of Object.entries(bb))if(patterns.some(re=>re.test(key))&&Number.isFinite(Number(value)))return Number(value);return null;}
export function talentValues(talent){return Object.fromEntries((talent?.blackboard||[]).map(x=>[x.key,x.valueStr??x.value]));}
const has=(text,re)=>re.test(String(text||''));
const direct=(text,word)=>has(text,new RegExp('(?:^|[，。； ])'+word+'[+：]'))&&!has(text,/每次|每击|若|受到|技能期间|开启技能|部署后|首次/);
export function targetFilter(text,source,target,battle){
 if(target.uid===source.uid)return true;
 const profile=battle.profile(target),profession=profile?.profession||'',position=profile?.position||'';
 const match=text.match(/所有【([^】]+)】(?:职业)?干员/);if(match){const professionMap={医疗:'MEDIC',辅助:'SUPPORT',术师:'CASTER',近卫:'WARRIOR',重装:'TANK',狙击:'SNIPER',先锋:'PIONEER',特种:'SPECIAL'};return profession===match[1]||profession===professionMap[match[1]]||battle.data.branchRules?.records?.find(r=>r.name===match[1])?.id===profile?.branch;}
 if(has(text,/所有友方单位|所有我方单位|全体友方单位/))return true;
 if(has(text,/近战友方|近战干员/))return position==='MELEE';
 if(has(text,/远程友方|远程干员/))return position==='RANGED';
 return false;
}
export function operatorRegistry(data){
 const map=new Map();
 for(const profile of Object.values(data.profiles||{}))if(profile?.charId&&!map.has(profile.charId))map.set(profile.charId,{charId:profile.charId,name:profile.name,branch:profile.branch,profession:profile.profession});
 return Object.fromEntries(map);
}
export function skillConfig(profile){
 const skill=profile?.skill,bb=blackboardValues(skill),description=skill?.description||'';
 const damageType=has(description,/真实伤害/)?'true':has(description,/法术伤害|变为法术|法术攻击/)?'arts':null;
 for(const [name,patterns] of Object.entries({atkScale:[/atk_scale(?:_[12])?$/,/damage_scale(?:_[12])?$/],maxTarget:[/max_target(?:_attack|_token)?$/],hits:[/(?:^|[.@_])times$/,/trig_cnt$/],stun:[/(?:^|[.@_])stun$/],sleep:[/(?:^|[.@_])sleep$/],fear:[/(?:^|[.@_])fear$/],terror:[/(?:^|[.@_])terror$/],tremble:[/(?:^|[.@_])tremble$/],sluggish:[/(?:^|[.@_])sluggish$/],silence:[/(?:^|[.@_])silence$/],root:[/(?:^|[.@_])root$/],healScale:[/heal_scale$/],attackSpeed:[/attack_speed$/]})){if(bb[name]==null){const value=suffixNumber(bb.raw,patterns);if(value!=null)bb[name]=value;}}
 return {bb,description,damageType,stopAttack:has(description,/停止攻击|无法普通攻击/),
  resetAttack:has(description,/立即|瞬发|下次攻击|部署后/),
  multiTarget:bb.maxTarget??(has(description,/同时攻击|所有敌人/) ? Infinity : 1),
  hits:Math.max(1,Math.min(12,bb.hits??1)),atkScale:bb.atkScale??1};
}
function activeTalents(battle,u){return battle.activeTalentsOf?battle.activeTalentsOf(u):(battle.profile(u)?.activeTalents||[]);}
export function statMods(battle,u){
 const out={add:{atk:0,maxHp:0,def:0,magicResistance:0},ratio:{atk:0,maxHp:0,def:0},attackSpeed:0,spRecoveryPerSec:0,parts:[],auras:[]};
 const note=(stat,layer,v,src)=>{if(v)out.parts.push({stat,layer,v,src});};
 if(!u?.deployed||u.hp<=0)return out;
 for(const talent of activeTalents(battle,u)){
  const text=talent.description||'',bb=talentValues(talent);
  const atk=Number(bb.atk),hp=Number(bb.max_hp),def=Number(bb.def),mr=Number(bb.magic_resistance),as=Number(bb.attack_speed),sp=Number(bb.sp_recovery_per_sec);
  if(Number.isFinite(atk)&&direct(text,'攻击力')){out.ratio.atk+=atk;note('atk','ratio',atk,talent.name||u.id);}
  if(Number.isFinite(hp)&&direct(text,'生命上限')){out.ratio.maxHp+=hp;note('maxHp','ratio',hp,talent.name||u.id);}
  if(Number.isFinite(def)&&direct(text,'防御力')){out.ratio.def+=def;note('def','ratio',def,talent.name||u.id);}
  const sourceName=(battle.profile(u)?.name||u.id)+'·'+(talent.name||'天赋');
  if(Number.isFinite(mr)&&direct(text,'法术抗性')){out.add.magicResistance+=mr;note('magicResistance','add',mr,sourceName);}
  if(Number.isFinite(as)&&direct(text,'攻击速度')){out.attackSpeed+=as;note('attackSpeed','add',as,sourceName);}
  if(Number.isFinite(sp)&&has(text,/技力自然回复速度/))out.auras.push({stat:'spRecoveryPerSec',layer:'maxSame',value:sp,text,source:u});
  if(Number.isFinite(atk)&&has(text,/所有友方|全体友方|所有【/))out.auras.push({stat:'atk',layer:'ratio',value:atk,text,source:u});
  if(Number.isFinite(def)&&has(text,/所有友方|全体友方|所有【/))out.auras.push({stat:'def',layer:'ratio',value:def,text,source:u});
  if(Number.isFinite(as)&&has(text,/所有友方|全体友方|所有【|周围/))out.auras.push({stat:'attackSpeed',layer:'maxSame',value:as,text,source:u});
  if(Number.isFinite(hp)&&has(text,/所有友方|全体友方|所有【|周围/))out.auras.push({stat:'maxHp',layer:'ratio',value:hp,text,source:u});
 }
 return out;
}
function inRange(battle,source,target,skill=false){return battle.inside(source,target,skill);}
function allTargets(battle,source,skill=false){return battle.s.enemies.filter(e=>e.hp>0&&!e.hidden&&!e.untargetable&&inRange(battle,source,e,skill));}
function allAllies(battle,source,skill=false){return battle.s.units.filter(u=>u.deployed&&u.hp>0&&inRange(battle,source,u,skill));}
 function directStatus(text,config){for(const [name,kind] of [['stun','stun'],['sleep','sleep'],['fear','fear'],['terror','terror'],['tremble','tremble'],['sluggish','sluggish'],['silence','silence'],['root','root']])if(config.bb[name]!=null)return {kind,duration:config.bb[name]};if(has(text,/恐惧/))return {kind:'fear',duration:config.bb.fear??2};if(has(text,/战栗/))return {kind:'tremble',duration:config.bb.tremble??2};if(has(text,/晕眩/))return {kind:'stun',duration:config.bb.stun??1};if(has(text,/睡眠/))return {kind:'sleep',duration:config.bb.sleep??2};if(has(text,/束缚/))return {kind:'root',duration:config.bb.root??2};if(has(text,/沉默|失去特殊能力/))return {kind:'silence',duration:config.bb.silence??5};if(has(text,/停顿/))return {kind:'sluggish',duration:config.bb.sluggish??.5};return null;}
export function operatorSkillStart(battle,u,ctx){
 const profile=battle.profile(u),config=skillConfig(profile),text=config.description,bb=config.bb;
 let suppressDefault=false;
 const cost=bb.cost;if(Number.isFinite(cost)&&has(text,/获得.*费用|获得.*部署费用|获得.*金币/))battle.economy.s.funds+=cost;
 if(Number.isFinite(bb.hp_ratio)&&has(text,/生命/)&&has(text,/流失|损失/))ctx.applyLoss(battle,{target:u,source:u,amount:u.maxHp*Math.abs(bb.hp_ratio),minHp:1,cause:'loss'});
 const status=directStatus(text,config);if(status)for(const e of allTargets(battle,u,true))if(applyStatus(e,status.kind,status.duration,{source:u.uid,resistible:false}))ctx.log?.(battle,'status',{uid:e.uid,kind:status.kind,sourceUid:u.uid});
 const periodicScale=Number(bb.magic_atk_scale??bb.damage_scale??bb.atk_scale),periodicInterval=Number(bb.interval??bb.attack_interval??1);
 const duration=profile.skill?.duration;
 if(has(text,/每秒.*受到|持续.*受到|周期.*造成/)&&Number.isFinite(periodicScale)&&has(text,/伤害|法术/)){ctx.addEffect(battle,{kind:'zone',sourceUid:u.uid,sourceDeployGen:u.deployGen,talentOrSkillId:'skill-zone:'+u.id+':'+u.skillCount,x:u.x,y:u.y,radius:config.multiTarget===Infinity?2:1,interval:Math.max(.1,periodicInterval),nextAt:battle.s.time+Math.max(.1,periodicInterval),endsAt:battle.s.time+(duration>0?duration:5),values:{dot:true,atk_scale:periodicScale,type:config.damageType||'arts'},snapshot:{damage:battle.stats(u).atk*periodicScale},refKind:'owner',persistAfterSourceGone:false});}
 if(has(text,/每秒.*回复|持续.*回复/)&&Number.isFinite(config.healScale)){ctx.addEffect(battle,{kind:'zone',sourceUid:u.uid,sourceDeployGen:u.deployGen,talentOrSkillId:'skill-heal-zone:'+u.id+':'+u.skillCount,x:u.x,y:u.y,radius:1,interval:1,nextAt:battle.s.time+1,endsAt:battle.s.time+(duration>0?duration:5),values:{hot:battle.stats(u).atk*config.healScale},refKind:'owner',persistAfterSourceGone:false});}
 if(has(text,/对周围所有敌人|攻击范围内所有敌人/)&&Number.isFinite(config.atkScale)&&(bb.atkScale!=null||has(text,/造成.*伤害/))){for(const e of allTargets(battle,u,true))ctx.dealDamage(battle,{source:u,target:e,amount:battle.stats(u).atk*config.atkScale,type:config.damageType||'physical',cause:'skill',skill:true});suppressDefault=true;}
 if(has(text,/立即.*治疗|立即.*恢复.*生命/)&&Number.isFinite(config.healScale)){for(const a of allAllies(battle,u,true))ctx.applyHeal(battle,{source:u,target:a,amount:battle.stats(u).atk*config.healScale});suppressDefault=true;}
 return suppressDefault;
}
export function onEvent(battle,type,payload,ctx){
 const source=payload.source,target=payload.target;
 if(type==='deploy'&&(source||target)&&!(source||target).kind?.includes('summon')){
  const actor=source||target;actor.talentMods={atk:0,maxHp:0,def:0,attackSpeed:0};
  for(const talent of activeTalents(battle,actor)){
   const text=talent.description||'',bb=talentValues(talent);if(!has(text,/部署后|置入战场/))continue;
   for(const [key,field] of [['atk','atk'],['max_hp','maxHp'],['def','def'],['attack_speed','attackSpeed']])if(Number.isFinite(Number(bb[key])))actor.talentMods[field]+=Number(bb[key]);
  }
 }
 if(type==='after-damage'&&source&&source.kind!=='summon'&&target&&payload.skill){
  const config=skillConfig(battle.profile(source)),status=directStatus(config.description,config);
  if(status&&has(config.description,/攻击|命中|目标/))applyStatus(target,status.kind,status.duration,{source:source.uid,resistible:false});
  const bb=config.bb;if(Number.isFinite(bb.value)&&has(config.description,/恢复自身|回复自身/))ctx.applyHeal(battle,{source,target:source,amount:bb.value});
  if(Number.isFinite(bb.defPenetrateFixed)&&has(config.description,/无视.*防御/))target.def=Math.max(0,(target.def||0)-bb.defPenetrateFixed);
 }
 if((type==='before-damage'||type==='after-damage')&&source&&source.kind!=='summon'&&target&&payload.cause!=='dot'&&payload.cause!=='reflect'){
  for(const talent of activeTalents(battle,source)){
   const text=talent.description||'',bb=talentValues(talent);
   const probability=Number(bb.prob??bb.attack_prob??bb.buff_prob),scale=Number(bb.atk_scale??bb.attack_atk_scale??bb.damage_scale??bb.talent_scale);
   if(type==='before-damage'&&has(text,/攻击时/)&&Number.isFinite(probability)&&Number.isFinite(scale)&&!has(text,/额外造成|附加/)&&battle.economy.random()<probability)payload.value*=scale;
   if(type==='after-damage'&&has(text,/攻击时/)&&Number.isFinite(probability)&&Number.isFinite(scale)&&has(text,/额外造成|附加/)&&battle.economy.random()<probability){
    ctx.dealDamage(battle,{source,target,amount:battle.stats(source).atk*scale,type:has(text,/法术/)?'arts':'physical',cause:'extra',parentEventId:payload.event?.eventId,effectId:'talent:'+source.id+':'+(talent.name||'attack')});
   }
   if(has(text,/攻击使目标.*特殊能力失效|攻击使命中目标失去特殊能力/))target.specialDisabledUntil=Math.max(target.specialDisabledUntil||0,battle.s.time+(Number(bb.duration)||5));
  }
 }
 if(type==='after-heal'&&source&&target){
  for(const talent of activeTalents(battle,source)){const text=talent.description||'',bb=talentValues(talent);if(has(text,/目标获得.*抵抗/))applyStatus(target,'resist',Number(bb.duration)||4,{source:source.uid,resistible:false});}
 }
 if(type==='enemy-death'&&payload.target){
  for(const u of battle.s.units.filter(x=>x.deployed&&x.hp>0))for(const talent of activeTalents(battle,u)){
   const text=talent.description||'',bb=talentValues(talent);if(!has(text,/敌人倒下|击倒.*恢复|击杀/))continue;
   if(Number(bb.hp_ratio)>0)ctx.applyHeal(battle,{source:u,target:u,amount:u.maxHp*bb.hp_ratio});
   if(Number(bb.cost)>0)battle.economy.s.funds+=bb.cost;
   if(Number(bb.sp)>0)ctx.gainSp(u,Number(bb.sp));
  }
 }
 if(type==='after-damage'&&target&&source&&has(source.id,/^char_/))for(const talent of activeTalents(battle,target)){
  const text=talent.description||'',bb=talentValues(talent);if(has(text,/受到攻击|受到伤害/)&&Number(bb.sp)>0)ctx.gainSp(target,Number(bb.sp));
 }
}
export function periodicMods(battle,u,ctx){
 if(!u?.deployed||u.hp<=0)return;
 if(u.id==='char_181_flower')return;
 for(const talent of activeTalents(battle,u)){const text=talent.description||'',bb=talentValues(talent);
  if(has(text,/每秒恢复|每秒回复/)){const ratio=Number(bb.hp_recovery_per_sec_ratio??bb.hp_recovery_per_sec_by_max_hp_ratio??bb.atk_to_hp_recovery_ratio);if(Number.isFinite(ratio))for(const a of allAllies(battle,u))ctx.applyRegen(battle,{source:u,target:a,amount:battle.stats(u).atk*ratio/30});}
  if(has(text,/在场.*秒|停留.*秒/)&&Number(bb.atk)){u.talentTime=(u.talentTime||0)+1/30;if(u.talentTime>=(Number(bb.interval)||15)){u.talentTime=0;u.talentStacks=Math.min(Number(bb.max_stack_cnt)||99,(u.talentStacks||0)+1);}}
 }
}
