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
 healScale:['heal_scale','attack@heal_scale','attack@atk_to_hp_recovery_ratio'],regenScale:['hp_recovery_per_sec_ratio_chr','hp_recovery_per_sec_ratio','atk_to_hp_recovery_ratio'],maxHpRegenScale:['hp_recovery_per_sec_by_max_hp_ratio'],elementScale:['ep_damage_ratio','element_damage_scale','element_multiplier','magic_atk_scale'],
 cost:['cost','attack@cost'],ammo:['attack@trigger_time'],interval:['interval','attack_interval'],attackSpeed:['attack_speed'],value:['value'],hpRatio:['hp_ratio'],
 maxHp:['max_hp'],def:['def'],atk:['atk'],magicResistance:['magic_resistance'],blockCnt:['block_cnt'],defPenetrateFixed:['def_penetrate_fixed'],defPenetrateRatio:['def_penetrate'],damageScale:['damage_scale']
};
const firstNumber=(bb,keys)=>{for(const key of keys){const value=bb[key];if(Number.isFinite(Number(value)))return Number(value);}return null;};
export function blackboardValues(skill){const bb=Object.fromEntries((skill?.blackboard||[]).map(x=>[x.key,x.valueStr??x.value]));const out={...bb,raw:bb};for(const [name,keys] of Object.entries(NUMERIC_KEYS)){const value=firstNumber(bb,keys);if(value!=null)out[name]=value;}return out;}
function suffixNumber(bb,patterns){for(const [key,value] of Object.entries(bb))if(patterns.some(re=>re.test(key))&&Number.isFinite(Number(value)))return Number(value);return null;}
export function talentValues(talent){
 const bb=blackboardValues({blackboard:talent?.blackboard}),out={...bb};
 for(const [name,patterns] of Object.entries({atkScale:[/atk_scale(?:_[12])?$/,/damage_scale(?:_[12])?$/],maxTarget:[/max_target(?:_attack|_token)?$/],hits:[/(?:^|[.@_])times$/,/trig_cnt$/],stun:[/(?:^|[.@_])stun$/],sleep:[/(?:^|[.@_])sleep$/],fear:[/(?:^|[.@_])fear$/],terror:[/(?:^|[.@_])terror$/],tremble:[/(?:^|[.@_])tremble$/],sluggish:[/(?:^|[.@_])sluggish$/],silence:[/(?:^|[.@_])silence$/],root:[/(?:^|[.@_])root$/],elementScale:[/ep_damage_ratio(?:_[a-z]+)?$/,/element_damage_scale$/],healScale:[/heal_scale$/]}))if(out[name]==null){const value=suffixNumber(bb.raw,patterns);if(value!=null)out[name]=value;}
 return out;
}
const has=(text,re)=>re.test(String(text||''));
const direct=(text,word)=>has(text,new RegExp('(?:^|[，。； ])'+word+'[+：]'))&&!has(text,/每次|每击|若|受到|技能期间|开启技能|部署后|首次/);
export function coinCapFor(profile){
 const match=String(profile?.skill?.description||'').match(/金币上限为(\d+)/);
 return match?Math.max(0,Number(match[1])):Infinity;
}
export function grantCoins(u,amount,cap=Infinity){
 const value=Math.max(0,Math.trunc(Number(amount)||0));if(!value)return 0;
 const before=Math.max(0,Math.trunc(u.coins||0)),limit=Number.isFinite(cap)?Math.max(0,Math.trunc(cap)):Infinity;
 u.coins=Math.min(limit,before+value);return u.coins-before;
}
export function spendCoins(u,amount){
 const value=Math.max(0,Math.trunc(Number(amount)||0));if(!value||u.coins<value)return false;
 u.coins-=value;return true;
}
export function coinGainAtSkillStart(battle,u){
 let amount=0;
 for(const talent of activeTalents(battle,u)){
  const match=String(talent.description||'').match(/开启技能时获得(\d+)枚金币/);
  if(match)amount+=Number(match[1]);
 }
 return amount;
}
function moduleRows(profile){
 const rows=[];
 const add=(value,fromModule=false)=>{
  if(!value||typeof value!=='object')return;
  const values=blackboardValues({blackboard:value.blackboard}),description=[value.description,value.overrideDescripton,value.additionalDescription].filter(Boolean).join(' ');
  if(fromModule||value.fromModule||Object.keys(values).some(key=>/cost|withdraw/i.test(key)))rows.push({values,description});
 };
 for(const talent of profile?.activeTalents||[])if(talent.fromModule||!talent.name||['10','20_root','-1'].includes(String(talent.prefabKey)))add(talent,true);
 for(const part of profile?.modulePhase?.parts||[]){
  for(const candidate of part.overrideTraitDataBundle?.candidates||[])add(candidate,true);
  for(const candidate of part.addOrOverrideTalentDataBundle?.candidates||[])add(candidate,true);
 }
 return rows;
}
export function moduleCostData(profile){
 let runtimeCost=0,runtimeCostActive=false,refundRatio=null,refundIgnoresCap=false,chargerKillCost=null,merchantCost=null,merchantInterval=null;
 for(const row of moduleRows(profile)){
  const bb=row.values,description=row.description;
  if(Number.isFinite(Number(bb.runtime_cost))){runtimeCost=Math.min(runtimeCost,Number(bb.runtime_cost));runtimeCostActive=true;}
  if(Number.isFinite(Number(bb.withdraw_cost_recover_ratio))){refundRatio=Number(bb.withdraw_cost_recover_ratio);if(refundRatio>=1)refundIgnoresCap=true;}
  if(/击杀敌人后获得.*费用/.test(description)&&Number(bb.cost)>0)chargerKillCost=Number(bb.cost);
  if(/消耗.*费用/.test(description)&&Number(bb.cost)<0){merchantCost=Math.abs(Number(bb.cost));if(Number(bb.interval)>0)merchantInterval=Number(bb.interval);}
 }
 return {runtimeCost:runtimeCostActive?runtimeCost:0,runtimeCostActive,refundRatio,refundIgnoresCap,chargerKillCost,merchantCost,merchantInterval};
}
export function tokenCostFor(profile,tokenId,fallback){
 const values=profile?.modulePhase?.tokenAttributeBlackboard?.[tokenId];
 const delta=values?.find?.(entry=>entry.key==='cost');
 return Number.isFinite(Number(delta?.value))?Math.max(0,(Number(fallback)||0)+Number(delta.value)):fallback;
}
export function targetFilter(text,source,target,battle){
 if(target.uid===source.uid)return true;
 const profile=battle.profile(target),profession=profile?.profession||'',position=profile?.position||'';
 const match=text.match(/所有(?:友方|我方)?【([^】]+)】(?:职业)?干员/);if(match){const professionMap={医疗:'MEDIC',辅助:'SUPPORT',术师:'CASTER',近卫:'WARRIOR',重装:'TANK',狙击:'SNIPER',先锋:'PIONEER',特种:'SPECIAL'};if(match[1]==='拉特兰')return profile?.bonds?.includes('lateranoShip');return profession===match[1]||profession===professionMap[match[1]]||battle.data.branchRules?.records?.find(r=>r.name===match[1])?.id===profile?.branch;}
 const nearby=text.match(/周围(?:最多)?(\d+|一|两|二|四|八)格/);if(nearby){const radius={一:1,两:2,二:2,四:4,八:8}[nearby[1]]??Number(nearby[1]);if(Math.max(Math.abs((source.x??0)-(target.x??0)),Math.abs((source.y??0)-(target.y??0)))>radius)return false;}
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
 const damageType=has(description,/真实伤害|真实/)?'true':has(description,/法术伤害|变为法术|法术攻击/)?'arts':null;
 for(const [name,patterns] of Object.entries({atkScale:[/atk_scale(?:_[12])?$/,/damage_scale(?:_[12])?$/],maxTarget:[/max_target(?:_attack|_token)?$/],hits:[/(?:^|[.@_])times$/,/trig_cnt$/],stun:[/(?:^|[.@_])stun$/],sleep:[/(?:^|[.@_])sleep$/],fear:[/(?:^|[.@_])fear$/],terror:[/(?:^|[.@_])terror$/],tremble:[/(?:^|[.@_])tremble$/],sluggish:[/(?:^|[.@_])sluggish$/],silence:[/(?:^|[.@_])silence$/],root:[/(?:^|[.@_])root$/],healScale:[/heal_scale$/],interval:[/interval$/],attackSpeed:[/attack_speed$/]})){if(bb[name]==null){const value=suffixNumber(bb.raw,patterns);if(value!=null)bb[name]=value;}}
 const targetRule=has(description,/生命值最高/) ? 'maxHp' : has(description,/生命值最低/) ? 'minHp' : has(description,/生命值高于.*80%/) ? 'lowHp' : has(description,/未被阻挡|未阻挡/) ? 'unblocked' : has(description,/被阻挡|阻挡的/) ? 'blocked' : has(description,/远程武器/) ? 'ranged' : has(description,/空中单位|飞行单位/) ? 'air' : has(description,/随机攻击|随机目标/) ? 'random' : null;
 const plainDescription=description.replace(/<[^>]+>/g,''),ammoPerAttack=suffixNumber(bb.raw,[/consume.*ammo/,/ammo_cost/])??Number(plainDescription.match(/消耗(\d+)发/)?.[1]||1),ammoBonus=suffixNumber(bb.raw,[/additional.*ammo/,/addtional.*ammo/])??0,leadingCoin=plainDescription.match(/^\s*消耗(?:(\d+)枚|一枚)金币/),coinCost=leadingCoin?(Number(leadingCoin[1])||1):0,coinCap=coinCapFor(profile);
 return {bb,description,damageType,targetRule,canTargetSleep:has(description,/睡眠目标|沉睡目标|睡眠的敌人/),canSeeHidden:has(description,/隐匿失效|隐匿效果失效|无视隐匿/),ammoPerAttack,ammoBonus,coinCost,coinCap,resource:coinCost?'coins':null,stopAttack:has(description,/停止攻击|无法普通攻击/),
  resetAttack:has(description,/立即|瞬发|下次攻击|部署后/),
  healScale:bb.healScale??null,regenScale:bb.regenScale??null,maxHpRegenScale:bb.maxHpRegenScale??null,extraProjectiles:has(description,/额外发射.*回旋|回旋投射物/)?Math.max(0,(Number(bb.cnt)||1)-1):0,
  multiTarget:bb.maxTarget??(has(description,/同时攻击|所有敌人/) ? Infinity : 1),
  hits:Math.max(1,Math.min(12,bb.hits??(has(description,/两次|二连击/)?2:1))),atkScale:bb.atkScale??1};
}
function positiveNumber(value){return Number.isFinite(Number(value))&&Number(value)>0?Number(value):null;}
export function costValue(config,kind='immediate'){
 const bb=config?.bb||{},raw=bb.raw||{};
 if(kind==='immediate'){
  const direct=positiveNumber(bb.cost);if(direct!=null)return direct;
  for(const [key,value] of Object.entries(raw))if(/(?:start|once).*cost/i.test(key)){const n=positiveNumber(value);if(n!=null)return n;}
  return null;
 }
 if(kind==='periodic'){
  for(const key of ['value','fake_cost']){const n=positiveNumber(bb[key]);if(n!=null)return n;}
  for(const [key,value] of Object.entries(raw))if(/(?:period|cost|value)/i.test(key)&&!/(?:deck|reduce|decrease|modify|cond|start|once|display)/i.test(key)){const n=positiveNumber(value);if(n!=null)return n;}
  return null;
 }
 if(kind==='periodicTick'){
  const direct=positiveNumber(bb.cost);if(direct!=null)return direct;
  for(const [key,value] of Object.entries(raw))if(/(?:cost|period)/i.test(key)&&!/(?:deck|reduce|decrease|modify|cond|start|once|display)/i.test(key)){const n=positiveNumber(value);if(n!=null)return n;}
  return null;
 }
 for(const [key,value] of Object.entries(raw))if(/cost/i.test(key)&&!/(?:deck|reduce|decrease|modify|cond|start|once|display)/i.test(key)){const n=positiveNumber(value);if(n!=null)return n;}
 return positiveNumber(bb.cost);
}
export function textCostValue(text){
 const match=String(text||'').replace(/<[^>]+>/g,'').match(/(?:获得|回复|消耗|扣除)(\d+)点(?:部署)?费用/);
 return match?Number(match[1]):null;
}
export function costValueForText(config,text,kind='immediate'){
 const bb=config?.bb||{},raw=bb.raw||{};
 const matches=[...String(text||'').matchAll(/\{([^}]*cost[^}]*)\}/gi)];if(kind==='kill')matches.reverse();for(const match of matches){const key=match[1];const value=positiveNumber(raw[key]??bb[key]);if(value!=null)return value;}
 return textCostValue(text)??costValue(config,kind);
}
function activeTalents(battle,u){return battle.activeTalentsOf?battle.activeTalentsOf(u):(battle.profile(u)?.activeTalents||[]);}
export function statMods(battle,u){
 const out={add:{atk:0,maxHp:0,def:0,magicResistance:0,blockCnt:0,tauntLevel:0},ratio:{atk:0,maxHp:0,def:0},attackSpeed:0,spRecoveryPerSec:0,parts:[],auras:[]};
 const note=(stat,layer,v,src)=>{if(v)out.parts.push({stat,layer,v,src});};
 if(!u?.deployed||u.hp<=0)return out;
 for(const talent of activeTalents(battle,u)){
  const text=talent.description||'',bb=talentValues(talent);
  const atk=Number(bb.atk),hp=Number(bb.max_hp),def=Number(bb.def),mr=Number(bb.magic_resistance),as=Number(bb.attack_speed),sp=Number(bb.sp_recovery_per_sec),blocks=Number(bb.block_cnt),taunt=Number(bb.taunt_level);
  if(Number.isFinite(atk)&&direct(text,'攻击力')){out.ratio.atk+=atk;note('atk','ratio',atk,talent.name||u.id);}
  if(Number.isFinite(hp)&&direct(text,'生命上限')){out.ratio.maxHp+=hp;note('maxHp','ratio',hp,talent.name||u.id);}
  if(Number.isFinite(def)&&direct(text,'防御力')){out.ratio.def+=def;note('def','ratio',def,talent.name||u.id);}
  const sourceName=(battle.profile(u)?.name||u.id)+'·'+(talent.name||'天赋');
  if(Number.isFinite(mr)&&direct(text,'法术抗性')){out.add.magicResistance+=mr;note('magicResistance','add',mr,sourceName);}
  if(Number.isFinite(as)&&direct(text,'攻击速度')){out.attackSpeed+=as;note('attackSpeed','add',as,sourceName);}
  if(Number.isFinite(blocks)&&direct(text,'阻挡数')){out.add.blockCnt+=blocks;note('blockCnt','add',blocks,sourceName);}
  if(Number.isFinite(taunt)&&direct(text,'嘲讽等级')){out.add.tauntLevel+=taunt;note('tauntLevel','add',taunt,sourceName);}
  if(Number.isFinite(sp)&&has(text,/技力自然回复速度/))out.auras.push({stat:'spRecoveryPerSec',layer:'maxSame',value:sp,text,source:u});
  if(Number.isFinite(atk)&&has(text,/所有友方|全体友方|所有【/))out.auras.push({stat:'atk',layer:'ratio',value:atk,text,source:u});
  if(Number.isFinite(def)&&has(text,/所有友方|全体友方|所有【/))out.auras.push({stat:'def',layer:'ratio',value:def,text,source:u});
  if(Number.isFinite(as)&&has(text,/所有友方|全体友方|所有【|周围/))out.auras.push({stat:'attackSpeed',layer:'maxSame',value:as,text,source:u});
  if(Number.isFinite(hp)&&has(text,/所有友方|全体友方|所有【|周围/))out.auras.push({stat:'maxHp',layer:'ratio',value:hp,text,source:u});
 }
 return out;
}
export function attackModifier(battle,source,target,value){
 let out=value;
 for(const talent of activeTalents(battle,source)){
  const text=talent.description||'',bb=talentValues(talent),scale=Number(bb.atkScale??bb.damageScale);
  if(!Number.isFinite(scale))continue;
  if(has(text,/未被阻挡|未阻挡/)&&target.block==null)out*=scale;
  else if(has(text,/被阻挡|阻挡的/)&&target.block!=null)out*=scale;
  const drop=Number(bb.hp_ratio_drop),up=Number(bb.atk_scale_up);if(Number.isFinite(drop)&&drop>0&&Number.isFinite(up)&&/生命.*每降低|每降低.*生命/.test(text)&&target.maxHp>0){const steps=Math.max(0,Math.floor((1-target.hp/target.maxHp+1e-9)/drop));out*=1+steps*up;}
  const hpMatch=text.match(/生命值(?:低于|不高于|少于)\s*(\d+)%/);
  if(hpMatch&&target.maxHp>0&&target.hp/target.maxHp<=Number(hpMatch[1])/100)out*=scale;
 }
 const skill=skillConfig(battle.profile(source));if(battle.skillActive?.(source)){const drop=Number(skill.bb.hp_ratio_drop),up=Number(skill.bb.atk_scale_up);if(Number.isFinite(drop)&&drop>0&&Number.isFinite(up)&&/生命.*每降低|每降低.*生命/.test(skill.description||'')&&target.maxHp>0){const steps=Math.max(0,Math.floor((1-target.hp/target.maxHp+1e-9)/drop));out*=1+steps*up;}}
 return out;
}
export function attackPenetration(battle,source,target){
 let fixed=0,ratio=0;
 for(const talent of activeTalents(battle,source)){
  const text=talent.description||'',bb=talentValues(talent);
  const weight=text.match(/重量大于等于\s*(\d+)/);if(weight&&Number(target.weight||0)<Number(weight[1]))continue;
  if(/被狼群阻挡/.test(text)&&target.block==null)continue;
  if(/无视.*防御/.test(text)){if(Number.isFinite(Number(bb.defPenetrateFixed)))fixed=Math.max(fixed,Number(bb.defPenetrateFixed));if(Number.isFinite(Number(bb.defPenetrateRatio)))ratio=Math.max(ratio,Number(bb.defPenetrateRatio));}
 }
 const skill=skillConfig(battle.profile(source));if(battle.skillActive?.(source)&&Number.isFinite(Number(skill.bb.defPenetrateFixed)))fixed=Math.max(fixed,Number(skill.bb.defPenetrateFixed));if(battle.skillActive?.(source)&&Number.isFinite(Number(skill.bb.defPenetrateRatio)))ratio=Math.max(ratio,Number(skill.bb.defPenetrateRatio));
 return {fixed,ratio};
}
export function damageReductionFor(battle,target,type){
 let reduction=0;
 for(const source of battle.s.units.filter(u=>u.deployed&&u.hp>0))for(const talent of activeTalents(battle,source)){
  const text=talent.description||'',bb=talentValues(talent);if(type==='physical'&&!/物理伤害减少|受到的物理伤害/.test(text))continue;
  const value=Number(bb.damage_resistance);if(!Number.isFinite(value)||value<=0)continue;
  if(/友方|我方/.test(text)&&!battle.s.units.includes(target)&&!(battle.s.summons||[]).includes(target))continue;
  const radius=text.match(/周围(?:最多)?(\d+|一|两|二|四|八)格/);const limit=radius?({一:1,两:2,二:2,四:4,八:8}[radius[1]]??Number(radius[1])):0;
  if(source.uid===target.uid||(limit&&Math.max(Math.abs((source.x??0)-(target.x??0)),Math.abs((source.y??0)-(target.y??0)))<=limit))reduction=Math.max(reduction,Math.min(1,value));
 }
 return reduction;
}
function inRange(battle,source,target,skill=false){return battle.inside(source,target,skill);}
function allTargets(battle,source,skill=false){return battle.s.enemies.filter(e=>e.hp>0&&!e.hidden&&!e.untargetable&&inRange(battle,source,e,skill));}
function allAllies(battle,source,skill=false){return battle.s.units.filter(u=>u.deployed&&u.hp>0&&inRange(battle,source,u,skill));}
 function directStatus(text,config){for(const [name,kind] of [['stun','stun'],['sleep','sleep'],['fear','fear'],['terror','terror'],['tremble','tremble'],['sluggish','sluggish'],['silence','silence'],['root','root'],['cold','cold'],['frozen','frozen']])if(config.bb[name]!=null)return {kind,duration:config.bb[name]};if(has(text,/恐惧/))return {kind:'fear',duration:config.bb.fear??config.bb.duration??2};if(has(text,/战栗/))return {kind:'tremble',duration:config.bb.tremble??config.bb.not_combat??config.bb.duration??2};if(has(text,/寒冷/))return {kind:'cold',duration:config.bb.cold??config.bb.duration??2};if(has(text,/冻结/))return {kind:'frozen',duration:config.bb.frozen??config.bb.duration??2};if(has(text,/晕眩/))return {kind:'stun',duration:config.bb.stun??config.bb.duration??1};if(has(text,/睡眠/))return {kind:'sleep',duration:config.bb.sleep??config.bb.duration??2};if(has(text,/束缚/))return {kind:'root',duration:config.bb.root??config.bb.duration??2};if(has(text,/沉默|失去特殊能力/))return {kind:'silence',duration:config.bb.silence??config.bb.duration??5};if(has(text,/停顿/))return {kind:'sluggish',duration:config.bb.sluggish??config.bb.duration??.5};return null;}
export function operatorSkillStart(battle,u,ctx){
 const profile=battle.profile(u),config=skillConfig(profile),text=config.description,bb=config.bb;
 let suppressDefault=false;
 if(/烹饪完成后专注于治疗/.test(text)&&Number(bb.disarm)>0){u.skillDisarmUntil=battle.s.time+Number(bb.disarm);u.focusHealAfter=u.skillDisarmUntil;u.focusHeal=false;}
 if(Number(bb.one_minus_status_resistance)<0||has(text,/获得抵抗/))u.statusResistance=Math.max(0,Math.min(1,-Number(bb.one_minus_status_resistance||0)));
 if(has(text,/技能结束时恢复.*最大生命|技能结束时回复.*最大生命/)&&Number(bb.hp_ratio)>0)u.skillEndHealRatio=Number(bb.hp_ratio);
 if(u.id==='char_4145_ulpia'&&has(text,/若船锚停留的位置可以部署/)&&ctx.teleportActor){
  u.returnPosition={x:u.x,y:u.y};
  const dirs=[[1,0],[0,-1],[-1,0],[0,1]],dir=dirs[(u.dir||0)%4],range=Math.max(1,Math.round(Number(bb.projectile_range)||1.8));
  for(let n=range;n>=1;n--)if(ctx.teleportActor(battle,u,{x:u.x+dir[0]*n,y:u.y+dir[1]*n,source:u,mode:'anchor-move'}))break;
 }
 if(profile.branch==='funnel'&&has(text,/浮游单元/)){const count=Number(bb['attack@cnt']??bb.attack_cnt??0);u.floatUnits=Math.max(1,1+(Number.isFinite(count)?count:0));u.floatTarget=null;u.floatStartedAt=battle.s.time;u.floatOverdrive=has(text,/过载/);}
 const cost=costValueForText(config,text,'immediate'),immediateText=has(text,/立即获得|技能开启时立即获得/),genericGain=has(text,/获得.*费用|获得.*部署费用/);if(Number.isFinite(cost)&&(immediateText||genericGain)&&(!has(text,/下次攻击|每次|持续|逐渐|击杀|击倒|攻击时/ )||immediateText))battle.gainCost?.(cost);if(Number.isFinite(cost)&&has(text,/获得.*金币/))grantCoins(u,cost,config.coinCap);
 if(profile.charId==='char_1045_svash2'&&battle.adjustReserveCost){const eligible=v=>['WARRIOR','CASTER','SNIPER'].includes(battle.profile(v)?.profession);if(profile.skillIndex===0){const amount=Number(bb['svash2_s_1[deck].cost']);if(amount>0)battle.adjustReserveCost(-amount,{predicate:eligible});}else if(profile.skillIndex===1){const amount=Number(bb.cost);if(amount>0)battle.adjustReserveCost(-amount,{predicate:eligible});}else if(profile.skillIndex===2&&!u.svashCostSwapped){battle.swapReserveBaseCosts(eligible);u.svashCostSwapped=true;}}
 if(Number.isFinite(bb.hp_ratio)&&has(text,/生命/)&&has(text,/流失|损失/))ctx.applyLoss(battle,{target:u,source:u,amount:u.maxHp*Math.abs(bb.hp_ratio),minHp:1,cause:'loss'});
 const status=directStatus(text,config),statusAtStart=status&&!has(text,/技能结束|每次攻击|攻击时|受到攻击/)&&has(text,/立即|技能开启时|释放|对周围|对敌人造成/);if(statusAtStart)for(const e of allTargets(battle,u,true))if(applyStatus(e,status.kind,status.duration,{source:u.uid,resistible:false}))ctx.log?.(battle,'status',{uid:e.uid,kind:status.kind,sourceUid:u.uid});
 if(profile.charId==='char_213_mostma'&&profile.skillIndex===1)for(const e of allTargets(battle,u,true))applyStatus(e,'stun',1,{source:u.uid,resistible:false});
 if(has(text,/解除.*异常|清除.*异常/))for(const a of allAllies(battle,u,true))a.statuses=(a.statuses||[]).filter(s=>!['stun','frozen','sleep','fear','terror','tremble','root','silence','levitate'].includes(s.kind));
 if(has(text,/防御力.*法术抗性/)&&Number(bb.def)<0)for(const e of allTargets(battle,u,true)){const debuffDuration=Number(profile.skill?.duration)>0?Number(profile.skill.duration):5;applyStatus(e,'defDown',debuffDuration,{source:u.uid,value:Number(bb.def),resistible:false});if(Number(bb.magic_resistance)<0)applyStatus(e,'resDown',debuffDuration,{source:u.uid,value:Number(bb.magic_resistance),resistible:false});}
 if(has(text,/下次攻击.*(?:恢复|回复)/)&&Number.isFinite(config.healScale)){u.pendingAttackHeal={scale:config.healScale,sourceUid:u.uid};suppressDefault=true;}
 if(has(text,/下次治疗.*(?:额外)?回复目标最大生命值/)&&Number.isFinite(Number(bb.hp_ratio))){u.pendingHealBonus={ratio:Number(bb.hp_ratio),requiresBelowHalf:has(text,/不满一半|低于一半/)};suppressDefault=true;}
 const periodicScale=Number(bb.magic_atk_scale??bb.damage_scale??bb.atk_scale??config.atkScale),periodicInterval=Number(bb.interval??bb.attack_interval??1),periodicCost=textCostValue(text)??costValue(config,'periodic'),periodicTick=costValue(config,'periodicTick'),duration=profile.skill?.duration;
 if(periodicCost!=null&&has(text,/持续(?:时间内)?(?:逐渐|回复总共|获得)|期间逐渐回复/)){const span=duration<0?1e9:duration>0?duration:1,interval=Math.max(.1,periodicInterval),count=Math.max(1,Math.round(span/interval)),perTick=Number.isFinite(periodicTick)?periodicTick:periodicCost/count;u.pendingPeriodicCost={total:periodicCost,duration:span,endsAt:battle.s.time+span,interval,perTick,remaining:periodicCost,nextAt:battle.s.time+interval,skillCount:u.skillCount};}
 const attackCost=costValueForText(config,text,'attack');if(attackCost!=null&&has(text,/下次攻击.*获得.*费用/))u.pendingCostGain={amount:attackCost,skillCount:u.skillCount};
 if(has(text,/下次攻击/)&&has(text,/额外造成|获得.*费用|回复|恢复/)){const extraScale=Number(bb.extra_damage_ratio??bb['bleed_atk_scale']??bb['attack@atk_scale']??bb.atk_scale);u.pendingNextAttack={skillCount:u.skillCount,extraScale:Number.isFinite(extraScale)?extraScale:null,extraType:config.damageType||has(text,/法术/)||has(text,/流失/) ? 'arts':'physical',bleedDuration:Number(bb.bleed_duration)||0};suppressDefault=true;}
 if(has(text,/每[^，。；]*秒.*受到|持续.*受到|周期.*造成|每[^，。；]*秒.*攻击|每[^，。；]*秒.*额外攻击/)&&Number.isFinite(periodicScale)&&has(text,/伤害|法术|攻击/)){const requiresStatus=has(text,/处于.*束缚|束缚状态/)?'root':null;ctx.addEffect(battle,{kind:'zone',sourceUid:u.uid,sourceDeployGen:u.deployGen,talentOrSkillId:'skill-zone:'+u.id+':'+u.skillCount,x:u.x,y:u.y,radius:Number(bb.projectile_range)|| (config.multiTarget===Infinity?2:1),interval:Math.max(.1,periodicInterval),nextAt:battle.s.time+Math.max(.1,periodicInterval),endsAt:duration<0?null:battle.s.time+(duration>0?duration:5),trackArea:has(text,/区域|影响范围|火墙/),trackSide:has(text,/友方单位|友方干员/)?'all':'enemy',values:{dot:true,atk_scale:periodicScale,type:config.damageType||'arts',requiresStatus},snapshot:{damage:battle.stats(u).atk*periodicScale},refKind:'owner',persistAfterSourceGone:false});}
 if(has(text,/每秒.*(?:回复|恢复)|持续.*(?:回复|恢复)/)&&(Number.isFinite(config.regenScale)||Number.isFinite(config.maxHpRegenScale))){const amount=has(text,/最大生命/) ? u.maxHp*(config.maxHpRegenScale||0) : battle.stats(u).atk*(config.regenScale||0);ctx.addEffect(battle,{kind:'zone',sourceUid:u.uid,sourceDeployGen:u.deployGen,talentOrSkillId:'skill-heal-zone:'+u.id+':'+u.skillCount,x:u.x,y:u.y,radius:Number(bb.projectile_range)||1,interval:1,nextAt:battle.s.time+1,endsAt:duration<0?null:battle.s.time+(duration>0?duration:5),trackArea:has(text,/区域|影响范围|地面敌人/),trackSide:'ally',values:{hot:amount},refKind:'owner',persistAfterSourceGone:false});}
 if(has(text,/获得隐匿|进入隐匿|迷彩/)){const time=duration>0?duration:1e9;applyStatus(u,has(text,/迷彩/)?'camouflage':'invisible',time,{source:u.uid,resistible:false});}
 if(has(text,/屏障|护盾/)&&ctx.grantShield){const ratio=Number(bb.shield_max_hp_ratio),amount=Number(bb.shield_value)||(Number.isFinite(ratio)?u.maxHp*ratio:0);if(Number.isFinite(amount)&&amount>0)ctx.grantShield(battle,u,{amount,endsAt:duration>0?battle.s.time+duration:null,sourceUid:u.uid,id:'skill-shield:'+u.id+':'+u.skillCount});}
  if(has(text,/每秒流失.*生命/)&&Number.isFinite(Number(bb.lose_hp_scale??bb.hp_ratio))){const interval=1/30,ratio=Number(bb.lose_hp_scale??bb.hp_ratio);ctx.addEffect(battle,{kind:'loss',sourceUid:u.uid,sourceDeployGen:u.deployGen,targetUid:u.uid,talentOrSkillId:'skill-loss:'+u.id+':'+u.skillCount,interval,nextAt:battle.s.time+interval,endsAt:duration<0?null:battle.s.time+(duration>0?duration:5),values:{amount:u.maxHp*ratio*interval},refKind:'owner',persistAfterSourceGone:false});}
  if(has(text,/每秒(?:恢复|回复).*点生命/)&&Number(bb.hp_recovery_per_sec)>0){ctx.addEffect(battle,{kind:'regen',sourceUid:u.uid,sourceDeployGen:u.deployGen,targetUid:u.uid,talentOrSkillId:'skill-regen-zone:'+u.id+':'+u.skillCount,interval:1,nextAt:battle.s.time+1,endsAt:duration<0?null:battle.s.time+(duration>0?duration:5),values:{regen:Number(bb.hp_recovery_per_sec)},snapshot:{regen:Number(bb.hp_recovery_per_sec)},refKind:'owner',persistAfterSourceGone:false});}
 if(has(text,/其余伤害延后至技能结束|伤害延后至技能结束/)){u.damageProtection={immediateRatio:Number.isFinite(Number(bb.damage_resistance))?Number(bb.damage_resistance):0,until:duration>0?battle.s.time+duration:battle.s.time,buffer:0,finalDuration:Number(bb.final_duration)||1,sourceUid:u.uid};}
 if(has(text,/生命值不会低于1|生命值始终不会低于1/)&&!u.lockHp)u.lockHp={min:1,endsAt:duration>0?battle.s.time+duration:null,onEnd:'none'};
 if(has(text,/不再成为其他角色的治疗目标|无法成为其他角色的治疗目标/))u.unhealable=true;
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
 if(type==='battle-start')for(const actor of battle.s.units.filter(u=>u.hp>0)){if(actor.initialCostGranted)continue;for(const talent of activeTalents(battle,actor)){const text=talent.description||'',bb=talentValues(talent);if(has(text,/编入队伍后.*初始部署费用|额外获得.*初始部署费用/)&&Number(bb.cost)>0){battle.gainCost?.(Number(bb.cost));actor.initialCostGranted=true;break;}}}
 if(type==='after-damage'&&source&&source.kind!=='summon'&&target&&source.pendingNextAttack&&source.pendingNextAttack.skillCount===source.skillCount){const next=source.pendingNextAttack;source.pendingNextAttack=null;if(Number.isFinite(next.extraScale)&&next.extraScale>0)ctx.dealDamage(battle,{source,target,amount:battle.stats(source).atk*next.extraScale,type:next.extraType,cause:'extra',skill:true,parentEventId:payload.event?.eventId,effectId:'next-attack:'+source.uid+':'+source.skillCount});if(next.bleedDuration>0&&Number.isFinite(next.extraScale)&&next.extraScale>0)ctx.addEffect(battle,{kind:'dot',sourceUid:source.uid,sourceDeployGen:source.deployGen,targetUid:target.uid,talentOrSkillId:'next-attack-dot:'+source.uid+':'+source.skillCount,interval:1,nextAt:battle.s.time+1,endsAt:battle.s.time+next.bleedDuration,values:{damage:battle.stats(source).atk*next.extraScale,type:'arts'},snapshot:{damage:battle.stats(source).atk*next.extraScale},refKind:'owner',persistAfterSourceGone:false});}
 if(type==='after-damage'&&source&&source.kind!=='summon'&&target&&payload.skill){
  const config=skillConfig(battle.profile(source)),status=directStatus(config.description,config);
   if(source.id==='char_4026_vulpis'&&target.kind!=='summon'){const talent=activeTalents(battle,source).find(t=>t.name==='追凶');if(talent){source.vulpisMarks??={};const mark=source.vulpisMarks[target.uid],now=battle.s.time;if(!mark||mark<=now)source.vulpisMarks[target.uid]=now+(Number(talentValues(talent).interval)||10);else if(payload.cause!=='extra')ctx.dealDamage(battle,{source,target,amount:battle.stats(source).atk*(Number(talentValues(talent).atk_scale)||.3),type:'arts',cause:'extra',parentEventId:payload.event?.eventId,effectId:'vulpis-hunt:'+source.uid+':'+target.uid});}}
   const attackCost=costValueForText(config,config.description,'attack');if(source.pendingCostGain&&source.pendingCostGain.skillCount===source.skillCount){battle.gainCost?.(source.pendingCostGain.amount);source.pendingCostGain=null;}
   if(attackCost!=null&&has(config.description,/每次攻击(?:时)?获得.*费用|每次攻击时获得.*费用|每对一个敌人造成伤害就获得.*费用/)&&payload.cause!=='extra')battle.gainCost?.(attackCost);
   const statusProb=Number(config.bb['attack@prob']??config.bb.prob),statusAllowed=!has(config.description,/寒冷/)||!Number.isFinite(statusProb)||battle.economy.random()<statusProb;if(status&&statusAllowed&&has(config.description,/攻击|命中|目标/))applyStatus(target,status.kind,Number(config.bb['attack@cold']??status.duration),{source:source.uid,resistible:false});
   if(has(config.description,/浮空/))applyStatus(target,'levitate',Number(config.bb.floating??config.bb.duration??2),{source:source.uid,resistible:false});
   if(has(config.description,/隐匿失效|隐匿效果失效/))target.revealed=true;
   if(has(config.description,/推开|推动|拖拽|拉向|拉至|击退/)&&ctx.moveActor)ctx.moveActor(battle,target,source,config.description);
   const elementScale=Number(config.bb.elementScale??(has(config.description,/灼燃|凋亡|元素损伤|元素伤害|神经损伤/)?config.atkScale:NaN));if(Number.isFinite(elementScale)&&has(config.description,/灼燃|凋亡|元素损伤|元素伤害|神经损伤/)&&ctx.applyElementDamage)ctx.applyElementDamage(battle,{source,target,amount:battle.stats(source).atk*elementScale,type:has(config.description,/凋亡/)?'necrosis':has(config.description,/灼燃/)?'burn':has(config.description,/神经损伤/)?'neural':'elemental',cause:'skill',parentEventId:payload.event?.eventId});
  const bb=config.bb;if(Number.isFinite(bb.value)&&has(config.description,/恢复自身|回复自身/))ctx.applyHeal(battle,{source,target:source,amount:bb.value});
  // Defense penetration is applied before mitigation by NativeBattle.hit; do not mutate the target.
 }
 if(type==='after-damage'&&source&&source.kind!=='summon'&&target&&!payload.skill&&source.pendingCostGain&&source.pendingCostGain.skillCount===source.skillCount){battle.gainCost?.(source.pendingCostGain.amount);source.pendingCostGain=null;}
 if(type==='after-damage'&&source&&target?.id==='char_381_bubble'&&target.deployed&&battle.skillActive(target)&&source!==target&&payload.cause!=='reflect'){
  const cfg=skillConfig(battle.profile(target)),scale=Number(cfg.bb.atkScale)||.4;ctx.dealDamage(battle,{source:target,target:source,amount:battle.stats(target).def*scale,type:'physical',cause:'reflect',parentEventId:payload.event?.eventId,effectId:'bubble-reflect:'+target.uid+':'+(payload.event?.eventId||0)});
  const talent=activeTalents(battle,target).find(t=>t.name==='尖刺盾');if(talent)applyStatus(source,'attackDown',Number(talentValues(talent).duration)||5,{source:target.uid,value:Number(talentValues(talent).atk)||-.05,resistible:false});
 }
 if(type==='after-damage'&&source&&target?.id==='char_4148_philae'&&target.deployed&&battle.skillActive(target)&&source!==target&&payload.cause!=='reflect'){
  const cfg=skillConfig(battle.profile(target)),now=battle.s.time;if(now>=(target.philaeNextAt||-Infinity)){target.philaeNextAt=now+(Number(cfg.bb.aoe_cd)||2);for(const e of battle.s.enemies.filter(e=>e.hp>0&&!e.hidden&&Math.max(Math.abs(e.x-target.x),Math.abs(e.y-target.y))<=1)){ctx.dealDamage(battle,{source:target,target:e,amount:battle.stats(target).atk*(Number(cfg.bb.atkScale)||1.1),type:'arts',cause:'skill'});if(ctx.applyElementDamage)ctx.applyElementDamage(battle,{source:target,target:e,amount:battle.stats(target).atk*(Number(cfg.bb.elementScale)||Number(cfg.bb.ep_damage_ratio)||.25),type:'necrosis',cause:'skill'});}}
 }
 if(type==='after-damage'&&source&&source.kind!=='summon'&&target&&payload.skill&&payload.cause!=='extra'){
  const config=skillConfig(battle.profile(source)),text=config.description,attackKey=payload.event?.attackId??payload.event?.eventId;
  if(source.id==='char_294_ayer'&&has(text,/额外对周围8格友方单位阻挡的所有敌人/)&&source.ayerAttackKey!==attackKey){source.ayerAttackKey=attackKey;const allyBlocked=battle.s.enemies.filter(e=>e.hp>0&&e.block!=null&&battle.s.units.some(a=>a.uid===e.block&&a.deployed&&Math.max(Math.abs(a.x-source.x),Math.abs(a.y-source.y))<=1));for(const e of allyBlocked)ctx.dealDamage(battle,{source,target:e,amount:battle.stats(source).atk*(config.bb.atkScale||1),type:'arts',cause:'extra',parentEventId:payload.event?.eventId,effectId:'ayer-extra:'+source.uid+':'+attackKey});}
  if(source.id==='char_423_blemsh'&&has(text,/每次攻击额外造成.*法术伤害/)){const scale=Number(config.bb.atkScale);if(Number.isFinite(scale))ctx.dealDamage(battle,{source,target,amount:battle.stats(source).atk*scale,type:'arts',cause:'extra',parentEventId:payload.event?.eventId,effectId:'blemsh-extra:'+source.uid+':'+(payload.event?.eventId||0)});if(Number.isFinite(config.healScale)){const ally=battle.s.units.filter(a=>a.uid!==source.uid&&a.deployed&&a.hp>0&&battle.canHeal(a,source)&&Math.max(Math.abs(a.x-source.x),Math.abs(a.y-source.y))<=1).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp||a.uid-b.uid)[0];if(ally)ctx.applyHeal(battle,{source,target:ally,amount:battle.stats(source).atk*config.healScale});}}
  if(source.id==='char_4194_rmixer'){const talent=activeTalents(battle,source).find(t=>t.name==='扫射迎宾仪礼');if(talent){source.rmixerStacks=(source.rmixerStacks||[]).filter(at=>battle.s.time-at<(Number(talentValues(talent).duration)||10));const max=Number(talentValues(talent).max_stack_cnt)||3;if(source.rmixerStacks.length<max)source.rmixerStacks.push(battle.s.time);}}
 }
 if((type==='before-damage'||type==='after-damage')&&source&&source.kind!=='summon'&&target&&payload.cause!=='dot'&&payload.cause!=='reflect'){
  for(const talent of activeTalents(battle,source)){
   const text=talent.description||'',bb=talentValues(talent);
   const baseProbability=Number(bb.prob??bb.attack_prob??bb.buff_prob),probability=has(text,/正前方一格/)&&Math.max(Math.abs(source.x-target.x),Math.abs(source.y-target.y))<=1&&Number.isFinite(Number(bb.prob2))?Number(bb.prob2):baseProbability,scale=Number(bb.atk_scale??bb.attack_atk_scale??bb.damage_scale??bb.talent_scale);
   if(type==='before-damage'&&has(text,/攻击时/)&&Number.isFinite(probability)&&Number.isFinite(scale)&&!has(text,/额外造成|附加/)&&battle.economy.random()<probability)payload.value*=scale;
   if(type==='after-damage'&&has(text,/攻击时/)&&Number.isFinite(probability)&&Number.isFinite(scale)&&has(text,/额外造成|附加/)&&battle.economy.random()<probability){
    ctx.dealDamage(battle,{source,target,amount:battle.stats(source).atk*scale,type:has(text,/法术/)?'arts':'physical',cause:'extra',parentEventId:payload.event?.eventId,effectId:'talent:'+source.id+':'+(talent.name||'attack')});
   }
   if(type==='after-damage'&&has(text,/攻击时/)&&has(text,/额外攻击一次|追加攻击/)&&Number.isFinite(probability)&&battle.economy.random()<probability){
    ctx.dealDamage(battle,{source,target,amount:battle.stats(source).atk*(Number.isFinite(scale)?scale:1),type:has(text,/法术/)?'arts':'physical',cause:'extra',parentEventId:payload.event?.eventId,effectId:'talent-extra-hit:'+source.id+':'+(talent.name||'attack')});
   }
   if(has(text,/攻击使目标.*特殊能力失效|攻击使命中目标失去特殊能力/))target.specialDisabledUntil=Math.max(target.specialDisabledUntil||0,battle.s.time+(Number(bb.duration)||5));
   if(has(text,/脆弱/)&&Number.isFinite(Number(bb.damage_scale)))applyStatus(target,'fragile',Number(bb.duration)||5,{source:source.uid,value:Number(bb.damage_scale),resistible:false});
   if(has(text,/攻击力[-−]/)&&Number(bb.atk)<0)applyStatus(target,'attackDown',Number(bb.duration)||5,{source:source.uid,value:Number(bb.atk),resistible:false});
   if(has(text,/防御力[-−]/)&&Number(bb.def)<0)applyStatus(target,'defDown',Number(bb.duration)||5,{source:source.uid,value:Number(bb.def),resistible:false});
   if(has(text,/法术抗性[-−]/)&&Number(bb.magic_resistance)<0)applyStatus(target,'resDown',Number(bb.duration)||5,{source:source.uid,value:Number(bb.magic_resistance),resistible:false});
  if(type==='after-damage'){const talentStatus=directStatus(text,{bb}),talentScale=Number(battle.profile(source)?.skill?.blackboard?.find?.(x=>x.key==='talent_scale')?.value),baseStatusProb=Number(bb.prob??bb.attack_prob??bb.buff_prob),statusProb=Number.isFinite(baseStatusProb)&&battle.skillActive(source)&&Number.isFinite(talentScale)?Math.min(1,baseStatusProb*talentScale):baseStatusProb,statusAllowed=!has(text,/概率|几率/ )||!Number.isFinite(statusProb)||battle.economy.random()<statusProb;let statusDuration=talentStatus?.duration;if(statusDuration&&battle.skillActive(source)&&Number.isFinite(talentScale))statusDuration*=talentScale;if(talentStatus&&statusAllowed&&has(text,/攻击|命中|伤害|附带/))applyStatus(target,talentStatus.kind,statusDuration,{source:source.uid,resistible:false});
   const talentElement=Number(bb.ep_damage_ratio??bb.element_damage_scale??bb.damage_scale??bb.elementScale);if(Number.isFinite(talentElement)&&has(text,/灼痕|灼燃|凋亡损伤|元素伤害|神经损伤/)&&ctx.applyElementDamage)ctx.applyElementDamage(battle,{source,target,amount:battle.stats(source).atk*talentElement,type:has(text,/凋亡/)?'necrosis':has(text,/神经损伤/)?'neural':'burn',cause:'extra',parentEventId:payload.event?.eventId});}
  }
 }
 if(type==='after-heal'&&source&&target){
  for(const talent of activeTalents(battle,source)){const text=talent.description||'',bb=talentValues(talent);if(has(text,/目标获得.*抵抗/))applyStatus(target,'resist',Number(bb.duration)||4,{source:source.uid,resistible:false});}
 }
 if(type==='ammo'&&source){
  for(const owner of battle.s.units.filter(u=>u.deployed&&u.hp>0))for(const talent of activeTalents(battle,owner)){
   const text=talent.description||'',bb=talentValues(talent);if(!has(text,/弹药.*被消耗|消耗.*弹药/))continue;
   const healRatio=Number(bb.hp_ratio);if(Number.isFinite(healRatio)&&healRatio>0)ctx.applyHeal(battle,{source:owner,target:owner,amount:owner.maxHp*healRatio});
   const probability=Number(bb.prob??bb.attack_prob),scale=Number(bb.aoe_atk_scale??bb.atkScale??bb.damageScale);if(Number.isFinite(probability)&&Number.isFinite(scale)&&battle.economy.random()<probability){for(const e of battle.s.enemies.filter(e=>e.hp>0&&!e.hidden&&battle.inside(source,e,true)))ctx.dealDamage(battle,{source:owner,target:e,amount:battle.stats(owner).atk*scale,type:'physical',cause:'skill'});}
  }
 }
 if(type==='enemy-death'&&payload.target){
  const killer=payload.killer?.kind==='summon'?battle.s.units.find(u=>u.uid===payload.killer.ownerUid):payload.killer;
  if(killer?.id==='char_1033_swire2'&&battle.skillActive?.(killer)&&/击倒敌人时获得.*金币/.test(battle.profile(killer)?.skill?.description||''))grantCoins(killer,1,skillConfig(battle.profile(killer)).coinCap);
  if(killer?.id==='char_4026_vulpis'&&battle.skillActive?.(killer)&&(battle.profile(killer)?.skillIndex??killer.source?.skillIndex)===2)killer.vulpisKilled=true;
  if(killer?.kind!=='summon'&&killer?.deployed&&killer.hp>0&&battle.profile(killer)?.branch==='charger')battle.gainCost?.(Number(killer.chargerKillCost)||1);
  if(killer?.kind!=='summon'&&killer?.deployed&&killer.hp>0){const skill=battle.profile(killer)?.skill,config=skillConfig(battle.profile(killer)),text=skill?.description||'';if(battle.skillActive?.(killer)&&has(text,/击杀|击倒|击败/)&&has(text,/获得.*费用|回复.*费用/)){const amount=costValueForText(config,text,'kill');if(amount>0)battle.gainCost?.(amount);}}
  if(killer?.kind!=='summon'&&killer?.deployed&&killer.hp>0)for(const talent of activeTalents(battle,killer)){const text=talent.description||'',bb=talentValues(talent);if(has(text,/击杀|击倒|击败/)&&has(text,/获得.*费用|回复.*费用/)){const amount=costValue({bb},'kill')??textCostValue(text);if(amount>0)battle.gainCost?.(amount);}}
  for(const u of battle.s.units.filter(x=>x.deployed&&x.hp>0))for(const talent of activeTalents(battle,u)){
   const text=talent.description||'',bb=talentValues(talent);if(!has(text,/敌人倒下|击倒.*恢复|击杀/))continue;const radiusMatch=text.match(/周围(?:最多)?(\d+|一|两|二|四|八)格/);if(radiusMatch){const radius={一:1,两:2,二:2,四:4,八:8}[radiusMatch[1]]??Number(radiusMatch[1]);if(Math.max(Math.abs((u.x??0)-(payload.target.x??0)),Math.abs((u.y??0)-(payload.target.y??0)))>radius)continue;}else if(has(text,/范围内|攻击范围/)&&!battle.inside(u,payload.target))continue;
   if(Number(bb.hp_ratio)>0)ctx.applyHeal(battle,{source:u,target:u,amount:u.maxHp*bb.hp_ratio});
   if(Number(bb.cost)>0)battle.gainCost?.(bb.cost);
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
 const skill=battle.profile(u)?.skill;if(battle.skillActive?.(u)&&skill){const text=skill.description||'',pending=u.pendingPeriodicCost?.skillCount===u.skillCount?u.pendingPeriodicCost:null;if(pending&&has(text,/逐渐获得.*费用|每秒获得.*费用|持续(?:时间内)?(?:回复总共|获得).*费用|期间逐渐回复/)){pending.nextAt??=battle.s.time+pending.interval;while(pending.remaining>1e-9&&battle.s.time+1e-9>=pending.nextAt&&battle.s.time<=pending.endsAt+1e-9){const amount=Math.min(pending.perTick,pending.remaining);battle.gainCost?.(amount);pending.remaining-=amount;pending.nextAt+=pending.interval;}}}
 for(const talent of activeTalents(battle,u)){const text=talent.description||'',bb=talentValues(talent);
  if(has(text,/每秒恢复|每秒回复/)){const ratio=Number(bb.hp_recovery_per_sec_ratio??bb.hp_recovery_per_sec_by_max_hp_ratio??bb.atk_to_hp_recovery_ratio);if(Number.isFinite(ratio))for(const a of allAllies(battle,u))ctx.applyRegen(battle,{source:u,target:a,amount:battle.stats(u).atk*ratio/30});}
  if(has(text,/在场.*秒|停留.*秒/)&&Number(bb.atk)){u.talentTime=(u.talentTime||0)+1/30;if(u.talentTime>=(Number(bb.interval)||15)){u.talentTime=0;u.talentStacks=Math.min(Number(bb.max_stack_cnt)||99,(u.talentStacks||0)+1);}}
  if(has(text,/在场.*秒|停留.*秒/)&&Number(bb.self_ammo)>0&&Number(bb.duration)>0){u.talentAmmoTimers??={};u.talentAmmoFlags??={};const key=talent.name||'ammo';if(!u.talentAmmoFlags[key]){u.talentAmmoTimers[key]=(u.talentAmmoTimers[key]||0)+1/30;if(u.talentAmmoTimers[key]>=Number(bb.duration)){u.talentAmmoFlags[key]=true;u.talentAmmoBonus=(u.talentAmmoBonus||0)+Number(bb.self_ammo);if(Number(bb.ally_ammo)>0&&/其他随机一名/.test(text)){const candidates=battle.s.units.filter(v=>v!==u&&v.deployed&&v.hp>0&&battle.profile(v)?.bonds?.includes('lateranoShip')&&battle.profile(v)?.skill?.durationType==='AMMO');const ally=candidates[Math.floor(battle.economy.random()*candidates.length)];if(ally)ally.talentAmmoBonus=(ally.talentAmmoBonus||0)+Number(bb.ally_ammo);}}}}
 }
}
