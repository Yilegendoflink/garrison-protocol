// 装备的战斗期效果实现。
//
// 数据来源：unit.source.equipment → trapChessDataDict[chessId].effectId → effectBuffInfoDataDict[effectId]
// 的每一行（key + blackboard）。行里的符文名（黑板 `key` 字段的 valueStr）是稳定的效果标识，
// 例如 act1autochess_equip_acarm045_global_buff；**数值一律从黑板读，不写死**。
// 未接入的装备见 EQUIPMENT_EFFECT_AUDIT.md（含原因）。
//
// 这里只做「装备带来的战斗期效果」；备战期（装备时销毁、发钱、发干员、下回合晋升…）在 native-session。

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
 const rows=record?(battle.data.season.effectBuffInfoDataDict[record.effectId]||[]).map(row=>({rune:runeOf(row),bb:row.blackboard||[]})):[];
 rowCache.get(battle).set(chessId,rows);
 return rows;
}
export function equipmentList(u){
 if(!u||u.kind==='summon')return [];
 return [...(u.source?.equipment||[]),...(u.equipment||[])];
}
// 取该单位身上第一个带此符文的装备行（含精锐）
export function equipRune(battle,u,rune){
 for(const item of equipmentList(u))for(const row of rowsOf(battle,item.chessId))if(row.rune===rune)return {...row,chessId:item.chessId};
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
const isCovenant=(battle,u,bond)=>(battle.ownBonds?.(u)||[]).includes(bond);

// ── 统计类：stats() 里调用（api 提供 ratio/mul/note/base/attackSpeed） ──
export function equipmentStatMods(battle,u,api){
 if(!u||u.kind==='summon')return;
 // 蜂鸣器：更容易受到攻击（嘲讽等级）
 const taunt=equipRune(battle,u,'act1autochess_equip_acarm054_global_buff');
 if(taunt)api.base.tauntLevel=(api.base.tauntLevel||0)+num(taunt.bb,'taunt_level');
 // 不屈弹射器：再部署时间 -30/-50%（max_hp 走通用通道）
 const ej=equipRune(battle,u,'act1autochess_equip_acarm056_global_buff');
 if(ej)api.base.respawnTime*=Math.max(0,1+num(ej.bb,'respawn_time'));
 // 歌利亚头盔：部署时身前一格没有其他干员时的额外生命（部署那一刻定死）
 if(u.helmetMaxHpBonus)api.ratio('maxHp',u.helmetMaxHpBonus,'装备·歌利亚头盔');
 // 浓缩嗅盐：生命值高于阈值时免疫晕眩、冻结等特殊状态。
 // applyStatus 会看 target.immunities，所以这里按当前血量逐帧开/关（只动自己加的那几个键）。
 const salt=equipRune(battle,u,'act1autochess_equip_acarm059_global_buff');
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
}

// ── 部署／开局 ──
export function equipmentDeploy(battle,u,ctx){
 if(!u||u.kind==='summon')return;
 // 突袭手雷：本次部署后 duration 秒内，攻击使目标晕眩 stun 秒
 const grenade=equipRune(battle,u,'act1autochess_equip_acarm064_global_buff');
 if(grenade)u.raidGrenadeUntil=battle.s.time+num(grenade.bb,'duration');
 // 歌利亚头盔：生命值 +init_max_hp；身前一格没有其他干员再 +ex_max_hp（部署时判定）
 const helmet=equipRune(battle,u,'act1autochess_equip_acarm049_global_buff');
 if(helmet){
  const dir=[[1,0],[0,-1],[-1,0],[0,1]][u.dir||0]||[1,0];
  const front=battle.s.units.some(v=>v.uid!==u.uid&&v.deployed&&v.hp>0&&v.x===u.x+dir[0]&&v.y===u.y+dir[1]);
  u.helmetMaxHpBonus=num(helmet.bb,'init_max_hp')+(front?0:num(helmet.bb,'ex_max_hp'));
 }
 // 迅捷作战粮：部署时获得 sp_each_person 点技力，每有一个同盟约的其他干员再加一份
 const ration=equipRune(battle,u,'act1autochess_equip_acarm051_global_buff');
 if(ration&&ctx.gainSp){
  const per=num(ration.bb,'sp_each_person'),bonds=battle.ownBonds?.(u)||[];
  const mates=battle.s.units.filter(v=>v.uid!==u.uid&&v.deployed&&v.hp>0&&(battle.ownBonds?.(v)||[]).some(b=>bonds.includes(b))).length;
  ctx.gainSp(u,battle.profile(u).skill,per+per*mates,battle.spCost(u));
 }
 // 源石溶剂：每秒流失 damage 点生命（持续整场）
 const solvent=equipRune(battle,u,'periodic_damage');
 if(solvent&&ctx.addEffect){const per=num(solvent.bb,'damage');if(per>0)ctx.addEffect(battle,{kind:'loss',sourceUid:u.uid,sourceDeployGen:u.deployGen,targetUid:u.uid,talentOrSkillId:'equip-solvent:'+u.uid,interval:1,nextAt:battle.s.time+1,endsAt:null,values:{amount:per},snapshot:{amount:per},refKind:'owner',persistAfterSourceGone:true});}
}

export function equipmentBattleStart(battle,ctx){
 return; // 'battle-start' 早于各单位 deploy；部署期效果统一由 'deploy' 钩子发放，避免发两次
}

// ── 攻击时（source 是我方干员，cause==='attack'） ──
function onOperatorHit(battle,payload,ctx){
 const {source,target}=payload;if(!source||!target)return;
 // 战栗维式重锤：地面干员攻击时有 prob 概率使目标战栗 disarmed_duration 秒
 const hammer=equipRune(battle,source,'act1autochess_equip_acarm045_global_buff');
 if(hammer&&battle.profile(source)?.position==='MELEE'&&chance(battle,num(hammer.bb,'prob')))ctx.applyStatus?.(target,'tremble',num(hammer.bb,'disarmed_duration'),{source:source.uid,resistible:false});
 // 谢拉格不融冰：攻击时有 prob 概率对目标施加 cold 秒寒冷
 const ice=equipRune(battle,source,'act1vautochess_equip_acarm003_global_buff');
 if(ice&&chance(battle,num(ice.bb,'prob')))ctx.applyStatus?.(target,'cold',num(ice.bb,'cold'),{source:source.uid,resistible:false});
 // 奥术法阵：攻击使目标失去特殊能力 silence 秒（无概率）
 const arcane=equipRune(battle,source,'silence_attachment');
 if(arcane)ctx.applyStatus?.(target,'silence',num(arcane.bb,'silence'),{source:source.uid,resistible:false});
 // 突袭手雷：部署后窗口内攻击使目标晕眩
 if(source.raidGrenadeUntil>battle.s.time){const g=equipRune(battle,source,'act1autochess_equip_acarm064_global_buff');if(g)ctx.applyStatus?.(target,'stun',num(g.bb,'stun'),{source:source.uid,resistible:false});}
 // 休眠子裔：每攻击 1 个目标回复自身 hp_ratio×最大生命
 const brood=equipRune(battle,source,'act1vautochess_equip_acarm025_global_buff');
 if(brood)ctx.applyHeal(battle,{source,target:source,amount:source.maxHp*num(brood.bb,'hp_ratio')});
 // 铳骑之威：拉特兰干员攻击时有 prob 概率追加一发子弹（同时装备拉特兰桥夹时倍率提高）
 const gun=equipRune(battle,source,'act1autochess_equip_acarm076_global_buff');
 if(gun&&isCovenant(battle,source,'lateranoShip')&&chance(battle,num(gun.bb,'prob'))){
  const extra=battle.s.enemies.filter(e=>e.hp>0&&!e.hidden&&!e.untargetable&&e.uid!==target.uid&&battle.inside(source,e,true))[0];
  if(extra){const scale=pairedWith(source,gun.bb)?num(gun.bb,'atk_scale_2'):num(gun.bb,'atk_scale_1');ctx.dealDamage(battle,{source,target:extra,amount:battle.stats(source).atk*scale,type:'physical',cause:'extra',skill:true,effectId:'acarm076:'+source.uid+':'+target.uid});}
 }
 // 天马之枪：同时装备天马之盔时，造成伤害额外造成 atk_scale 的真实伤害
 const spear=equipRune(battle,source,'act2autochess_equip_acarm117_global_buff');
 if(spear&&pairedWith(source,spear.bb))ctx.dealDamage(battle,{source,target,amount:battle.stats(source).atk*num(spear.bb,'atk_scale'),type:'true',cause:'extra',skill:true,effectId:'acarm117:'+source.uid});
}

// ── 受击前（target 是我方干员） ──
function onBeforeDamage(battle,payload){
 const {source,target}=payload;if(!target||target.kind==='summon'||!(payload.value>0))return;
 // 精准狙击镜：攻击距离 radius 格及以上的目标时伤害 ×damage_scale
 if(source&&source.kind!=='summon'){
  const scope=equipRune(battle,source,'act1autochess_equip_acarm063_global_buff');
  if(scope&&Math.max(Math.abs(target.x-source.x),Math.abs(target.y-source.y))>=num(scope.bb,'radius',3))payload.value*=num(scope.bb,'damage_scale',1);
 }
 // 防暴盾：阻挡敌人时，受到来自非自身阻挡单位的伤害 ×damage_scale
 // （“阻挡的敌人”记在敌人身上的 e.block === 携带者 uid）
 const shield=equipRune(battle,target,'act1autochess_equip_acarm060_global_buff');
 if(shield){
  const blocked=new Set((battle.s.enemies||[]).filter(e=>e.hp>0&&e.block===target.uid).map(e=>e.uid));
  if(blocked.size&&(!source||!blocked.has(source.uid)))payload.value*=num(shield.bb,'damage_scale',1);
 }
 // 海沟实验体：固定伤害减免（另一行的符文名就是 halfidle_block_fixed_damage，值 180/300）
 const flat=equipRune(battle,target,'halfidle_block_fixed_damage');
 if(flat){const cut=num(flat.bb,'value');if(cut>0)payload.value=Math.max(0,payload.value-cut);}
}

// ── 受伤后：反弹伤害（海沟实验体） ──
function onTookDamage(battle,payload,ctx){
 const {source,target}=payload;if(!target||!source||target.kind==='summon')return;
 const trench=equipRune(battle,target,'act2autochess_equip_acarm078_global_buff');
 if(!trench||!isCovenant(battle,target,'aegirShip'))return;
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
 // 坚固维式重锤：首次受到致命伤害时生命值不低于 1，持续 undeadable_duration 秒
 const hammer=equipRune(battle,target,'act1autochess_equip_acarm043_global_buff');
 if(hammer&&!target.equipUndeadUsed){
  target.equipUndeadUsed=true;
  target.lockHp={min:1,endsAt:battle.s.time+num(hammer.bb,'undeadable_duration',8),onEnd:'none'};
  target.hp=Math.max(1,target.hp);
  return true;
 }
 // M3茧甲：战斗阶段被击倒时立刻复活，最多 max_respawn_cnt 次
 const m3=equipRune(battle,target,'act1autochess_equip_acarm068_global_buff');
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
 const drone=equipRune(battle,source,'act1autochess_equip_acarm061_global_buff');
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
 const camo=equipRune(battle,target,'act2autochess_equip_acarm055_global_buff');
 if(!camo||target.equipCamoUsed)return;
 target.equipCamoUsed=true;
 ctx.applyStatus?.(target,'invisible',num(camo.bb,'duration'),{source:target.uid,resistible:false});
}

// ── 统一入口：native-effects 的 dispatch 里调用 ──
export function equipmentEvent(battle,type,payload,ctx){
 if(!battle||!payload)return;
 if(type==='deploy')return equipmentDeploy(battle,payload.target,ctx);
 if(type==='after-damage'){
  if(payload.cause==='attack')onOperatorHit(battle,payload,ctx);
  onTookDamage(battle,payload,ctx);
  onFirstHit(battle,payload,ctx);
  return;
 }
 if(type==='before-damage')return onBeforeDamage(battle,payload);
 if(type==='after-heal')return onHeal(battle,payload,ctx);
}
