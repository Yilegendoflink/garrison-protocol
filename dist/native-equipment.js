// 装备的战斗期效果实现。
//
// 数据来源：unit.source.equipment → trapChessDataDict[chessId].effectId → effectBuffInfoDataDict[effectId]
// 的每一行（key + blackboard）。行里的符文名（黑板 `key` 字段的 valueStr）是稳定的效果标识，
// 例如 act1autochess_equip_acarm045_global_buff；**数值一律从黑板读，不写死**。
// 未接入的装备见 EQUIPMENT_EFFECT_AUDIT.md（含原因）。
//
// 这里只做「装备带来的战斗期效果」；备战期（装备时销毁、发钱、发干员、下回合晋升…）在 native-session。
//
// 三个接线点：native-effects.dispatch（事件统一转成装备事件）、native-effects.tickLogic 末尾的
// equipmentTick（逐帧效果）、native-battle.stats()（统计类修正）＋ hit()（弱点伤害／法抗穿透）。

import {skillKind} from './native-sp.js';

const ROW_KEY='key';
function runeOf(row){
 const entry=(row.blackboard||[]).find(b=>b.key===ROW_KEY);
 return entry?.valueStr||row.key;
}
function num(bb,name,fallback=0){
 const row=(bb||[]).find(b=>b.key===name);
 const raw=row?row.value??row.valueStr:undefined;
 const n=Number(raw);
 return Number.isFinite(n)?n:fallback;
}
function text(bb,name){
 const row=(bb||[]).find(b=>b.key===name);
 return row?String(row.valueStr??row.value??''):null;
}
// 一件装备的全部效果行（普通/精锐只有数值差异，符文名相同）
const rowCache=new WeakMap();
function rowsOf(battle,chessId){
 if(rowCache.has(battle)){const hit=rowCache.get(battle).get(chessId);if(hit)return hit;}
 else rowCache.set(battle,new Map());
 const record=battle.data.season.trapChessDataDict[chessId];
 const rows=record?(battle.data.season.effectBuffInfoDataDict[record.effectId]||[]).map(row=>({key:row.key,rune:runeOf(row),bb:row.blackboard||[]})):[];
 rowCache.get(battle).set(chessId,rows);
 return rows;
}
export function equipmentList(u){
 if(!u||u.kind==='summon')return [];
 return [...(u.source?.equipment||[]),...(u.equipment||[])];
}
// 取该单位身上第一个带此符文的装备行（含精锐）
function rawRune(battle,u,rune){
 for(const item of equipmentList(u))for(const row of rowsOf(battle,item.chessId))if(row.rune===rune)return {...row,chessId:item.chessId};
 return null;
}
export function equipRune(battle,u,rune){return rawRune(battle,u,rune);}
// char_dynamic_ability_new：动态能力行（耶拉冈德之泪／骑士戒律／叙拉古正装），行内的符文名才是能力 id
const DYNAMIC_KEY='char_dynamic_ability_new';
function dynamicRune(battle,u,rune){
 for(const item of equipmentList(u))for(const row of rowsOf(battle,item.chessId))if(row.key===DYNAMIC_KEY&&row.rune===rune)return {...row,chessId:item.chessId};
 return null;
}
export function hasEquipPrefix(u,prefix){
 return equipmentList(u).some(item=>String(item.chessId).startsWith(prefix));
}
// 成对联动：行的 equip_chess_id / other_equip 指向另一件装备（valueStr 是 chess_item_x_y_z 前缀或完整 id 列表）
function pairedWith(u,bb){
 const raw=text(bb,'equip_chess_id')||text(bb,'other_equip');
 if(!raw)return false;
 const own=new Set(equipmentList(u).map(item=>item.chessId));
 return String(raw).split(',').some(id=>{
  const prefix=String(id).trim();
  return [...own].some(chessId=>chessId!==prefix&&(chessId===prefix||chessId.startsWith(prefix)));
 });
}
const chance=(battle,p)=>battle.economy.random()<Math.max(0,Math.min(1,p));
// 盟约判定：NativeBattle 上没有 ownBonds，盟约名单挂在 session 的 ownBonds(u.source) 上
// （曾经写成 battle.ownBonds，导致所有「若携带者为【X】盟约干员」的装备效果恒不触发）。
const isCovenant=(battle,u,bond)=>{
 if(!u)return false;
 if(typeof battle.owns==='function'&&battle.owns(u,bond))return true;
 return bondList(battle,u).includes(bond);
};
// 该干员身上的盟约名单（装备叠加进来的也算，走 session.ownBonds）
const bondList=(battle,u)=>battle.economy?.ownBonds?.(u?.source)||u?.source?.bondIds||u?.bondIds||[];

// 通用通道（native-battle.stats 的 env_gbuff* 分支）只认固定属性字段，但有几件装备的符文行里
// 这些同名字段其实是「叠层／条件」值——当常驻属性加就变成了「炎国短刀恒 +5% 攻击」「骑士戒律恒 +100% 攻击」
// 这类错值。它们交给本模块按规则算，通用通道跳过。保留在通用通道的：萨尔贡浓茶/家族徽章（sp_recovery_per_sec）、
// 不屈弹射器（max_hp）、加速维式重锤（attack_speed）。
const GENERIC_EXCLUDED=new Set([
 'act1vautochess_equip_acarm024_global_buff', // 炎国短刀：每开技 +5% 攻击（叠层）
 'act1vautochess_equip_acarm037_global_buff', // 有限加速器：每次攻/治疗 +1 攻速（叠层）
 'act1autochess_equip_acarm077_global_buff',  // 天师古鼎：本回合每获得 1 名干员 +25 攻速（叠层）
 'act1autochess_equip_acarm079_global_buff',  // 蒸汽之心：借来的维式重锤特殊效果（含攻速）
 'act2autochess_equip_acarm119_global_buff',  // 骑士戒律：与竞技旗成对时技能期 +100% 攻击
]);
export function equipGenericExcluded(rune){return GENERIC_EXCLUDED.has(String(rune||''));}

// ── 蒸汽之心：给【维多利亚】携带者发放「维式重锤」系列的特殊效果 ──
// 原表把维式重锤四项特殊效果的黑板值（attack_speed／prob＋disarmed_duration／undeadable_duration／
// damage_scale）都写在 蒸汽之心 自己的行上，所以「获得当前场上所有维式重锤特殊效果」直接按本行数值发放；
// 携带维式重锤系列（行里的 hammer_1..4 前缀）时该系列的特殊效果翻倍（boost=2）。
function steamEffect(battle,u){
 const row=rawRune(battle,u,'act1autochess_equip_acarm079_global_buff');
 if(!row||!isCovenant(battle,u,'victoriaShip'))return null;
 const prefixes=['hammer_1','hammer_2','hammer_3','hammer_4'].map(k=>text(row.bb,k)).filter(Boolean);
 const hasOwn=prefixes.some(p=>hasEquipPrefix(u,p));
 return {...row,boost:hasOwn?2:1};
}
// 战栗（维式重锤系列）：地面干员攻击时 prob 概率战栗 disarmed_duration 秒；与蒸汽之心取较强的一份
function trembleSpec(battle,u){
 const own=rawRune(battle,u,'act1autochess_equip_acarm045_global_buff'),steam=steamEffect(battle,u);
 const ownBoost=steam?2:1;
 let prob=own?num(own.bb,'prob')*ownBoost:0,duration=own?num(own.bb,'disarmed_duration')*ownBoost:0;
 if(steam){const p=num(steam.bb,'prob')*steam.boost,d=num(steam.bb,'disarmed_duration')*steam.boost;if(p>prob){prob=p;duration=d;}}
 return {prob:Math.min(1,prob),duration:duration};
}
// 灼燃（维式重锤系列）：造成法术伤害附带 damage_scale 比例的灼燃损伤
function burningSpec(battle,u){
 const own=rawRune(battle,u,'act1autochess_equip_acarm042_global_buff'),steam=steamEffect(battle,u);
 const ownBoost=steam?2:1;
 let scale=own?num(own.bb,'damage_scale')*ownBoost:0;
 if(steam)scale=Math.max(scale,num(steam.bb,'damage_scale')*steam.boost);
 return scale;
}
// 不死（维式重锤系列）：首次致命伤后生命值不低于 1 的持续时间
function undyingSpec(battle,u){
 const own=rawRune(battle,u,'act1autochess_equip_acarm043_global_buff'),steam=steamEffect(battle,u);
 const ownBoost=steam?2:1;
 let duration=own?num(own.bb,'undeadable_duration')*ownBoost:0;
 if(steam)duration=Math.max(duration,num(steam.bb,'undeadable_duration')*steam.boost);
 return duration;
}

// ── 统计类：stats() 里调用（api 提供 ratio/note/base/addAttackSpeed） ──
export function equipmentStatMods(battle,u,api){
 if(!u||u.kind==='summon')return;
 // 蜂鸣器：更容易受到攻击（嘲讽等级）
 const taunt=rawRune(battle,u,'act1autochess_equip_acarm054_global_buff');
 if(taunt)api.base.tauntLevel=(api.base.tauntLevel||0)+num(taunt.bb,'taunt_level');
 // 不屈弹射器／骑士戒律：再部署时间修正（max_hp 走通用通道）
 const ej=rawRune(battle,u,'act1autochess_equip_acarm056_global_buff');
 if(ej)api.base.respawnTime*=Math.max(0,1+num(ej.bb,'respawn_time'));
 // 歌利亚头盔：部署时身前一格没有其他干员时的额外生命（部署那一刻定死）
 if(u.helmetMaxHpBonus)api.ratio('maxHp',u.helmetMaxHpBonus,'装备·歌利亚头盔');
 // 浓缩嗅盐：生命值高于阈值时免疫晕眩、冻结等特殊状态。
 // applyStatus 会看 target.immunities，所以这里按当前血量逐帧开/关（只动自己加的那几个键）。
 const salt=rawRune(battle,u,'act1autochess_equip_acarm059_global_buff');
 if(salt){
  const above=u.maxHp>0&&u.hp/u.maxHp>num(salt.bb,'hp_ratio',1);
  if(above&&!u.equipSaltImmune){
   u.immunities={...(u.immunities||{})};
   u.equipSaltKeys=[];
   for(const kind of CONTROL){if(!u.immunities[kind]){u.immunities[kind]=true;u.equipSaltKeys.push(kind);}}
   u.equipSaltImmune=true;
  }else if(!above&&u.equipSaltImmune){
   for(const kind of u.equipSaltKeys||[])delete u.immunities?.[kind];
   u.equipSaltKeys=[];u.equipSaltImmune=false;
  }
 }
 // 炎国短刀：每开启一次技能 +atk 攻击，最多 atk_buff_cnt 层
 const knife=rawRune(battle,u,'act1vautochess_equip_acarm024_global_buff');
 if(knife&&u.equipSkillUses>0)api.ratio('atk',num(knife.bb,'atk')*Math.min(num(knife.bb,'atk_buff_cnt',10),u.equipSkillUses),'装备·炎国短刀');
 // 有限加速器：每次攻击或治疗后 +attack_speed 攻速，最多 max_buff_cnt 层
 const accel=rawRune(battle,u,'act1vautochess_equip_acarm037_global_buff');
 if(accel&&u.equipAspdStacks>0)api.addAttackSpeed(num(accel.bb,'attack_speed',1)*Math.min(num(accel.bb,'max_buff_cnt',60),u.equipAspdStacks));
 // 天师古鼎：本回合每获得过 1 名干员，战斗开始后攻击速度 +attack_speed（最多 max_cnt 层）
 const cauldron=rawRune(battle,u,'act1autochess_equip_acarm077_global_buff');
 if(cauldron&&isCovenant(battle,u,'yanShip')){
  const gained=Math.min(num(cauldron.bb,'max_cnt',3),Math.max(0,Number(battle.economy.s.roundGainedChars?.count)||0));
  if(gained>0)api.addAttackSpeed(num(cauldron.bb,'attack_speed')*gained);
 }
 // 骑士戒律：与卡西米尔竞技旗成对时，技能持续期间攻击力 +atk
 const decree=rawRune(battle,u,'act2autochess_equip_acarm119_global_buff');
 if(decree&&isCovenant(battle,u,'kazimierzShip')&&pairedWith(u,decree.bb)&&battle.skillActive?.(u))api.ratio('atk',num(decree.bb,'atk'),'装备·骑士戒律');
 // 家族徽章：隐匿期间逐渐提升的攻击力（失去隐匿后首次造成伤害或离场时清空）
 const badge=rawRune(battle,u,'act2autochess_equip_acarm122_global_buff');
 if(badge&&isCovenant(battle,u,'siracusaShip')&&u.familyBadgeAtk>0)api.ratio('atk',u.familyBadgeAtk,'装备·家族徽章');
 // 蒸汽之心：借来的维式重锤特殊效果里的攻速（自己那件加速维式重锤的 +30 已走通用通道，这里只补差额）
 const steam=steamEffect(battle,u);
 if(steam){
  const ownAccel=rawRune(battle,u,'act1autochess_equip_acarm044_global_buff');
  const ownAs=ownAccel?num(ownAccel.bb,'attack_speed'):0;
  const borrowed=Math.max(ownAs*(steam.boost),num(steam.bb,'attack_speed')*steam.boost);
  if(borrowed>ownAs)api.addAttackSpeed(borrowed-ownAs);
 }
 // 叙拉古正装：携带者部署方向左右两侧的我方干员攻击速度 +attack_speed
 for(const v of battle.s.units||[]){
  if(v===u||!v.deployed||v.hp<=0||v.kind==='summon')continue;
  const suit=dynamicRune(battle,v,'act2autochess_equip_acarm121_ability');
  if(!suit)continue;
  const dir=[[1,0],[0,-1],[-1,0],[0,1]][v.dir||0]||[1,0];
  if((u.x===v.x-dir[1]&&u.y===v.y+dir[0])||(u.x===v.x+dir[1]&&u.y===v.y-dir[0]))api.addAttackSpeed(num(suit.bb,'attack_speed'));
 }
}

// ── 部署／开局 ──
export function equipmentDeploy(battle,u,ctx){
 if(!u||u.kind==='summon')return;
 // 突袭手雷：本次部署后 duration 秒内，攻击使目标晕眩 stun 秒
 const grenade=rawRune(battle,u,'act1autochess_equip_acarm064_global_buff');
 if(grenade)u.raidGrenadeUntil=battle.s.time+num(grenade.bb,'duration');
 // 歌利亚头盔：生命值 +init_max_hp；身前一格没有其他干员再 +ex_max_hp（部署时判定）
 const helmet=rawRune(battle,u,'act1autochess_equip_acarm049_global_buff');
 if(helmet){
  const dir=[[1,0],[0,-1],[-1,0],[0,1]][u.dir||0]||[1,0];
  const front=battle.s.units.some(v=>v.uid!==u.uid&&v.deployed&&v.hp>0&&v.x===u.x+dir[0]&&v.y===u.y+dir[1]);
  u.helmetMaxHpBonus=num(helmet.bb,'init_max_hp')+(front?0:num(helmet.bb,'ex_max_hp'));
 }
 // 迅捷作战粮：部署时获得 sp_each_person 点技力，每有一个同盟约的其他干员再加一份
 const ration=rawRune(battle,u,'act1autochess_equip_acarm051_global_buff');
 if(ration&&ctx.gainSp){
  const per=num(ration.bb,'sp_each_person'),bonds=bondList(battle,u);
  const mates=battle.s.units.filter(v=>v.uid!==u.uid&&v.deployed&&v.hp>0&&bondList(battle,v).some(b=>bonds.includes(b))).length;
  ctx.gainSp(u,battle.profile(u).skill,per+per*mates,battle.spCost(u));
 }
 // 黄沙罗盘：初始技力 +init_sp
 const compass=rawRune(battle,u,'act1autochess_equip_acarm103_global_buff');
 if(compass&&ctx.gainSp)ctx.gainSp(u,battle.profile(u).skill,num(compass.bb,'init_sp'),battle.spCost(u));
 // 卡西米尔竞技旗：部署后 interval 秒内伤害提升至 damage_scale，随后每 ex_interval 秒衰减 damage_scale_minus
 const flag=rawRune(battle,u,'act2autochess_equip_acarm120_global_buff');
 if(flag)u.kazimierzFlagAt=battle.s.time;
 // 源石溶剂：每秒流失 damage 点生命（持续整场）
 const solvent=rawRune(battle,u,'periodic_damage');
 if(solvent&&ctx.addEffect){const per=num(solvent.bb,'damage');if(per>0)ctx.addEffect(battle,{kind:'loss',sourceUid:u.uid,sourceDeployGen:u.deployGen,targetUid:u.uid,talentOrSkillId:'equip-solvent:'+u.uid,interval:1,nextAt:battle.s.time+1,endsAt:null,values:{amount:per},snapshot:{amount:per},refKind:'owner',persistAfterSourceGone:true});}
}
export function equipmentBattleStart(battle,ctx){
 return; // 'battle-start' 早于各单位 deploy；部署期效果统一由 'deploy' 钩子发放，避免发两次
}

// ── 开技／技能结束 ──
function onOperatorSkillStart(battle,u,ctx){
 if(!u||u.kind==='summon')return;
 // 炎国短刀：每开启一次技能叠一层攻击加成
 const knife=rawRune(battle,u,'act1vautochess_equip_acarm024_global_buff');
 if(knife&&chance(battle,num(knife.bb,'prob',1)))u.equipSkillUses=Math.min(num(knife.bb,'atk_buff_cnt',10),(u.equipSkillUses||0)+1);
 // 黄沙罗盘：与萨尔贡浓茶成对时，每次开技为全部【萨尔贡】干员回复 addition_sp 点技力
 const compass=rawRune(battle,u,'act1autochess_equip_acarm103_global_buff');
 if(compass&&isCovenant(battle,u,'sargonShip')&&pairedWith(u,compass.bb)){
  for(const ally of battle.s.units)if(ally.deployed&&ally.hp>0&&isCovenant(battle,ally,'sargonShip'))ctx.gainSp?.(ally,battle.profile(ally).skill,num(compass.bb,'addition_sp'),battle.spCost(ally));
 }
 // 骑士戒律：开技后 duration 秒内，攻击范围内的敌人攻速／移速被压制
 const decree=rawRune(battle,u,'act2autochess_equip_acarm119_global_buff');
 if(decree&&isCovenant(battle,u,'kazimierzShip'))u.knightDecreeUntil=battle.s.time+num(decree.bb,'duration');
}
function onOperatorSkillEnd(battle,u,ctx){
 if(!u||u.kind==='summon')return;
 // 黄沙罗盘：携带者为【萨尔贡】时，首次技能结束立刻回复 sp 点技力
 const compass=rawRune(battle,u,'act1autochess_equip_acarm103_global_buff');
 if(!compass||!isCovenant(battle,u,'sargonShip')||u.compassSkillEnd)return;
 u.compassSkillEnd=true;
 ctx.gainSp?.(u,battle.profile(u).skill,num(compass.bb,'sp'),battle.spCost(u));
}
// 拉特兰桥夹：子弹类技能剩余一发子弹时 prob 概率恢复 ammo_percent 比例的子弹（每次部署最多 max_trigger_cnt 次）
function onAmmoEvent(battle,payload,ctx){
 const u=payload.source;if(!u||u.kind==='summon')return;
 const clip=rawRune(battle,u,'act1autochess_equip_acarm057_global_buff');
 if(!clip||skillKind(battle.profile(u).skill)!=='ammo')return;
 if((u.ammo||0)>1)return;
 if((u.equipAmmoRestores||0)>=Math.max(1,num(clip.bb,'max_trigger_cnt',3)))return;
 if(!chance(battle,num(clip.bb,'prob')))return;
 u.equipAmmoRestores=(u.equipAmmoRestores||0)+1;
 const add=Math.max(1,Math.round((u.ammoMax||0)*num(clip.bb,'ammo_percent')));
 u.ammo=Math.min(u.ammoMax||Infinity,(u.ammo||0)+add);
 ctx.log?.(battle,'equip',{uid:u.uid,equip:'acarm057',ammo:u.ammo});
}

// ── 攻击时（source 是我方干员，cause==='attack'） ──
function onOperatorHit(battle,payload,ctx){
 const {source,target}=payload;if(!source||!target)return;
 // 战栗维式重锤／蒸汽之心：地面干员攻击时有 prob 概率使目标战栗 disarmed_duration 秒
 const tremble=trembleSpec(battle,source);
 if(tremble.prob>0&&battle.profile(source)?.position==='MELEE'&&chance(battle,tremble.prob))ctx.applyStatus?.(target,'tremble',tremble.duration,{source:source.uid,resistible:false});
 // 谢拉格不融冰：攻击时有 prob 概率对目标施加 cold 秒寒冷
 const ice=rawRune(battle,source,'act1vautochess_equip_acarm003_global_buff');
 if(ice&&chance(battle,num(ice.bb,'prob')))ctx.applyStatus?.(target,'cold',num(ice.bb,'cold'),{source:source.uid,resistible:false});
 // 奥术法阵：攻击使目标失去特殊能力 silence 秒（无概率）
 const arcane=rawRune(battle,source,'silence_attachment');
 if(arcane)ctx.applyStatus?.(target,'silence',num(arcane.bb,'silence'),{source:source.uid,resistible:false});
 // 突袭手雷：部署后窗口内攻击使目标晕眩
 if(source.raidGrenadeUntil>battle.s.time){const g=rawRune(battle,source,'act1autochess_equip_acarm064_global_buff');if(g)ctx.applyStatus?.(target,'stun',num(g.bb,'stun'),{source:source.uid,resistible:false});}
 // 休眠子裔：每攻击 1 个目标回复自身 hp_ratio×最大生命
 const brood=rawRune(battle,source,'act1vautochess_equip_acarm025_global_buff');
 if(brood)ctx.applyHeal(battle,{source,target:source,amount:source.maxHp*num(brood.bb,'hp_ratio')});
 // 有限加速器：每次攻击 +attack_speed 攻速（上限 max_buff_cnt）
 const accel=rawRune(battle,source,'act1vautochess_equip_acarm037_global_buff');
 if(accel)source.equipAspdStacks=Math.min(num(accel.bb,'max_buff_cnt',60),(source.equipAspdStacks||0)+1);
 // 铳骑之威：拉特兰干员攻击时有 prob 概率追加一发子弹（同时装备拉特兰桥夹时倍率提高）
 const gun=rawRune(battle,source,'act1autochess_equip_acarm076_global_buff');
 if(gun&&isCovenant(battle,source,'lateranoShip')&&chance(battle,num(gun.bb,'prob'))){
  const extra=battle.s.enemies.filter(e=>e.hp>0&&!e.hidden&&!e.untargetable&&e.uid!==target.uid&&battle.inside(source,e,true))[0];
  if(extra){const scale=pairedWith(source,gun.bb)?num(gun.bb,'atk_scale_2'):num(gun.bb,'atk_scale_1');ctx.dealDamage(battle,{source,target:extra,amount:battle.stats(source).atk*scale,type:'physical',cause:'extra',skill:true,effectId:'acarm076:'+source.uid+':'+target.uid});}
 }
 // 天马之枪：同时装备天马之盔时，造成伤害额外造成 atk_scale 的真实伤害
 const spear=rawRune(battle,source,'act2autochess_equip_acarm117_global_buff');
 if(spear&&pairedWith(source,spear.bb))ctx.dealDamage(battle,{source,target,amount:battle.stats(source).atk*num(spear.bb,'atk_scale'),type:'true',cause:'extra',skill:true,effectId:'acarm117:'+source.uid});
 // 灼燃维式重锤／蒸汽之心：造成法术伤害时附带 damage_scale 比例的灼燃损伤
 const burn=burningSpec(battle,source);
 if(burn>0&&payload.type==='arts'&&payload.result?.total>0)ctx.applyElementDamage?.(battle,{source,target,amount:payload.result.total*burn,type:'burn',cause:'element'});
 // 家族徽章：隐匿结束后首次造成伤害时，与叙拉古正装成对则额外造成 atk_scale 攻击力的真实伤害，然后清空成长
 const badge=rawRune(battle,source,'act2autochess_equip_acarm122_global_buff');
 if(badge&&isCovenant(battle,source,'siracusaShip')&&(source.familyBadgeAtk||0)>0&&!source.invisible){
  if(!source.familyBadgePaid&&pairedWith(source,badge.bb)){
   source.familyBadgePaid=true;
   ctx.dealDamage(battle,{source,target,amount:battle.stats(source).atk*num(badge.bb,'atk_scale',8),type:'true',cause:'extra',skill:true,effectId:'acarm122:'+source.uid});
  }
  source.familyBadgeAtk=0;
 }
}

// ── 受击前（target 是我方干员） ──
function onBeforeDamage(battle,payload){
 const {source,target}=payload;if(!target||target.kind==='summon'||!(payload.value>0))return;
 if(source&&source.kind!=='summon'){
  // 精准狙击镜：攻击距离 radius 格及以上的目标时伤害 ×damage_scale
  const scope=rawRune(battle,source,'act1autochess_equip_acarm063_global_buff');
  if(scope&&Math.max(Math.abs(target.x-source.x),Math.abs(target.y-source.y))>=num(scope.bb,'radius',3))payload.value*=num(scope.bb,'damage_scale',1);
  // 卡西米尔竞技旗：部署后 interval 秒内 ×damage_scale，随后逐渐衰减
  const flag=rawRune(battle,source,'act2autochess_equip_acarm120_global_buff');
  if(flag&&source.kazimierzFlagAt!=null){
   const age=battle.s.time-source.kazimierzFlagAt,window=num(flag.bb,'interval',15),step=Math.max(.01,num(flag.bb,'ex_interval',.5)),decay=num(flag.bb,'damage_scale_minus',-.04);
   payload.value*=age<=window?num(flag.bb,'damage_scale',1):Math.max(1,num(flag.bb,'damage_scale',1)+decay*Math.floor((age-window)/step));
  }
 }
 // 防暴盾：阻挡敌人时，受到来自非自身阻挡单位的伤害 ×damage_scale
 // （“阻挡的敌人”记在敌人身上的 e.block === 携带者 uid）
 const shield=rawRune(battle,target,'act1autochess_equip_acarm060_global_buff');
 if(shield){
  const blocked=new Set((battle.s.enemies||[]).filter(e=>e.hp>0&&e.block===target.uid).map(e=>e.uid));
  if(blocked.size&&(!source||!blocked.has(source.uid)))payload.value*=num(shield.bb,'damage_scale',1);
 }
 // 海沟实验体：固定伤害减免（另一行的符文名就是 halfidle_block_fixed_damage，值 180/300）
 const flat=rawRune(battle,target,'halfidle_block_fixed_damage');
 if(flat){const cut=num(flat.bb,'value');if(cut>0)payload.value=Math.max(0,payload.value-cut);}
}

// ── 受伤后：反弹伤害（海沟实验体） ──
function onTookDamage(battle,payload,ctx){
 const {source,target}=payload;if(!target||!source||target.kind==='summon')return;
 const trench=rawRune(battle,target,'act2autochess_equip_acarm078_global_buff');
 if(!trench||!isCovenant(battle,target,'egirShip'))return;
 const gap=num(trench.bb,'lock_duration')||.5;
 if(!(battle.s.time>=(target.trenchReflectAt??-Infinity)))return;
 target.trenchReflectAt=battle.s.time+gap;
 const scale=num(trench.bb,'atk_scale');
 const times=pairedWith(target,trench.bb)?2:1;
 for(let i=0;i<times;i++)ctx.dealDamage(battle,{source:target,target:source,amount:battle.stats(target).atk*scale,type:'arts',cause:'reflect',effectId:'acarm078:'+target.uid+':'+i});
}

// ── 受到致命伤害（runFatal 里调用） ──
export function equipmentFatal(battle,target,event){
 if(!target||target.kind==='summon')return false;
 // 骑士戒律：与卡西米尔竞技旗成对时，技能持续期间受到致命伤害不撤退（技能结束后退场）
 const decree=rawRune(battle,target,'act2autochess_equip_acarm119_global_buff');
 if(decree&&isCovenant(battle,target,'kazimierzShip')&&pairedWith(target,decree.bb)&&battle.skillActive?.(target)){
  target.lockHp={min:1,endsAt:null,onEnd:'none'};target.equipRetreatAtSkillEnd=true;target.hp=Math.max(1,target.hp);
  return true;
 }
 // 坚固维式重锤／蒸汽之心：首次受到致命伤害时生命值不低于 1，持续 undeadable_duration 秒
 const undying=undyingSpec(battle,target);
 if(undying>0&&!target.equipUndeadUsed){
  target.equipUndeadUsed=true;
  target.lockHp={min:1,endsAt:battle.s.time+undying,onEnd:'none'};
  target.hp=Math.max(1,target.hp);
  return true;
 }
 // M3茧甲：战斗阶段被击倒时立刻复活，最多 max_respawn_cnt 次
 const m3=rawRune(battle,target,'act1autochess_equip_acarm068_global_buff');
 if(m3&&(target.m3Revives||0)<num(m3.bb,'max_respawn_cnt',1)){
  target.m3Revives=(target.m3Revives||0)+1;
  target.hp=target.maxHp;
  return true;
 }
 return false;
}

// ── 治疗时 ──
function onHeal(battle,payload,ctx){
 const {source,target}=payload;if(!source||source.kind==='summon')return;
 // 有限加速器：每次治疗后 +attack_speed 攻速（上限 max_buff_cnt）
 const accel=rawRune(battle,source,'act1vautochess_equip_acarm037_global_buff');
 if(accel)source.equipAspdStacks=Math.min(num(accel.bb,'max_buff_cnt',60),(source.equipAspdStacks||0)+1);
 const drone=rawRune(battle,source,'act1autochess_equip_acarm061_global_buff');
 if(!drone||!target)return;
 if(!chance(battle,num(drone.bb,'prob')))return;
 const cap=num(drone.bb,'max_stack_cnt',1);
 const current=(target.barriers||[]).filter(b=>b.id&&b.id.startsWith('equip-drone')).length;
 if(current<cap)ctx.grantGuard?.(battle,target,{charges:1,sourceUid:source.uid,id:'equip-drone:'+source.uid+':'+battle.s.time});
}

const CONTROL=['stun','frozen','sleep','fear','terror','tremble','palsy','root','silence','levitate'];
// ── 首次受到伤害后：伪装服 ──
function onFirstHit(battle,payload,ctx){
 const target=payload.target;if(!target||target.kind==='summon')return;
 const camo=rawRune(battle,target,'act2autochess_equip_acarm055_global_buff');
 if(!camo||target.equipCamoUsed)return;
 target.equipCamoUsed=true;
 ctx.applyStatus?.(target,'invisible',num(camo.bb,'duration'),{source:target.uid,resistible:false});
}

// ── 逐帧效果（tickLogic 里调用一次/帧，dt 为帧时长） ──
export function equipmentTick(battle,dt,ctx){
 if(!battle||!(dt>0))return;
 for(const e of battle.s.enemies||[])if(e.moveSpeedMod!==1)e.moveSpeedMod=1;
 for(const u of battle.s.units||[]){
  if(!u.deployed||u.hp<=0||u.kind==='summon')continue;
  // 天马之盔：与天马之枪成对时，每秒回复 hp_recovery_per_sec_by_max_hp_ratio 比例的最大生命
  const helm=rawRune(battle,u,'act2autochess_equip_acarm118_global_buff');
  if(helm&&pairedWith(u,helm.bb))ctx.applyRegen(battle,{source:u,target:u,amount:u.maxHp*num(helm.bb,'hp_recovery_per_sec_by_max_hp_ratio',.08)*dt});
  // 家族徽章：隐匿期间攻击力逐渐提升（上限 max_atk）
  const badge=rawRune(battle,u,'act2autochess_equip_acarm122_global_buff');
  if(badge&&isCovenant(battle,u,'siracusaShip')){
   const concealed=!!u.invisible||battle.s.time<(u.siracusaInvisibleUntil??-Infinity);
   if(concealed)u.familyBadgeAtk=Math.min(num(badge.bb,'max_atk',1),(u.familyBadgeAtk||0)+num(badge.bb,'atk_per_sec',.02)*dt);
  }
  // 骑士戒律：开技后的 duration 秒内，攻击范围内的敌人攻速／移速被压制
  const decree=dynamicRune(battle,u,'act2autochess_equip_acarm119_ability');
  if(decree&&u.knightDecreeUntil>battle.s.time&&isCovenant(battle,u,'kazimierzShip')){
   const asMul=num(decree.bb,'attack_speed',1),moveMul=num(decree.bb,'move_speed',1);
   for(const e of battle.s.enemies||[])if(e.hp>0&&!e.hidden&&battle.inside(u,e,battle.skillActive(u))){
    e.attackSpeedMod=(e.attackSpeedMod||0)-(1-asMul)*Math.max(10,Number(e.attackSpeed)||100);
    e.moveSpeedMod=Math.min(e.moveSpeedMod??1,moveMul);
   }
  }
  // 骑士戒律：成对保命结束后，技能一结束就退场
  if(u.equipRetreatAtSkillEnd&&!battle.skillActive(u)){u.equipRetreatAtSkillEnd=false;ctx.exit?.(battle,{target:u,reason:'forced'});continue;}
  // 耶拉冈德之泪：谢拉格携带者攻击范围内处于寒冷／冻结的敌人每秒受一次 atk_scale 攻击力的法术伤害
  const tear=dynamicRune(battle,u,'act2autochess_equip_acarm102_ability');
  if(tear&&isCovenant(battle,u,'kjeragShip')){
   const interval=Math.max(.1,num(tear.bb,'interval',1));
   if(u.yaleNextAt==null)u.yaleNextAt=battle.s.time+interval;
   if(battle.s.time+1e-9>=u.yaleNextAt){
    const scale=pairedWith(u,tear.bb)?num(tear.bb,'atk_scale_ex',num(tear.bb,'atk_scale')):num(tear.bb,'atk_scale');
    const victims=(battle.s.enemies||[]).filter(e=>e.hp>0&&!e.hidden&&!e.untargetable&&(e.statuses||[]).some(s=>s.kind==='cold'||s.kind==='frozen')&&battle.inside(u,e,battle.skillActive(u)));
    while(battle.s.time+1e-9>=u.yaleNextAt){
     for(const e of victims)ctx.dealDamage(battle,{source:u,target:e,amount:battle.stats(u).atk*scale,type:'arts',cause:'skill',effectId:'acarm102:'+u.uid+':'+u.yaleNextAt});
     u.yaleNextAt+=interval;
    }
   }
  }
 }
}

// ── 命中修正（native-battle.hit 里调用） ──
// 激光发射器：攻击无视目标 magic_resist_penetrate 比例的法术抗性
export function equipMagicPenetration(battle,u){
 let ratio=0;
 for(const item of equipmentList(u))for(const row of rowsOf(battle,item.chessId))if(row.rune==='magic_penetrate_global_buff')ratio=Math.max(ratio,num(row.bb,'magic_resist_penetrate'));
 return ratio;
}
// 双模机械臂：自身造成的物理／法术伤害转化为弱点伤害（按敌人防御力与法术抗性取更高的那种）
export function equipWeakness(battle,u){return !!rawRune(battle,u,'act1autochess_equip_acarm067_global_buff');}

// ── 统一入口：native-effects 的 dispatch 里调用 ──
export function equipmentEvent(battle,type,payload,ctx){
 if(!battle||!payload)return;
 if(type==='deploy')return equipmentDeploy(battle,payload.target,ctx);
 if(type==='skill-start')return onOperatorSkillStart(battle,payload.target,ctx);
 if(type==='skill-end')return onOperatorSkillEnd(battle,payload.target,ctx);
 if(type==='ammo')return onAmmoEvent(battle,payload,ctx);
 if(type==='after-damage'){
  if(payload.cause==='attack')onOperatorHit(battle,payload,ctx);
  onTookDamage(battle,payload,ctx);
  onFirstHit(battle,payload,ctx);
  return;
 }
 if(type==='before-damage')return onBeforeDamage(battle,payload);
 if(type==='after-heal')return onHeal(battle,payload,ctx);
}
