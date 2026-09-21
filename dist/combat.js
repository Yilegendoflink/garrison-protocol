import {recordDummyDamage} from './benchmark.js';
// Shared numerical rules. Ratios are fractions, time is seconds, ASPD defaults to 100.
export const FPS = 30;
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export function attribute(base, {add = 0, ratio = 0, finalAdd = 0, scales = [], min = 0, max = Infinity} = {}) {
  const scale = scales.reduce((total, value) => total * (value < 0 ? 1 + value : value), 1);
  return clamp(((base + add) * Math.max(0, 1 + ratio) + finalAdd) * scale, min, max);
}
export function attackTiming(interval, attackSpeed = 100, windup = interval * .3, intervalAdd = 0) {
  // ponytail: 30% windup is a labeled adapter, not restored animation data.
  // Attribute floor is 20; the interval formula itself clamps to [10, 600].
  const speed = clamp(Math.max(20, attackSpeed), 10, 600) / 100;
  const frames = Math.max(1, Math.round(Math.max(0, interval + intervalAdd) / speed * FPS));
  return {frames, windupFrames: clamp(Math.round(windup / speed * FPS), 1, frames), seconds: frames / FPS};
}
export function damage({amount, type = 'physical', attackScale = 1, attackAdd = 0, defense = 0, resistance = 0, elementResistance = 0, penetration = 0, penetrationRatio = 0, multiplier = 1, reduction = 0}) {
  const base = Math.max(0, amount * attackScale + attackAdd);
  const effective = value => Math.max(0, value - penetration) * (1 - clamp(penetrationRatio, 0, 1));
  let mitigated;
  if (type === 'physical') mitigated = Math.max(base * .05, base - effective(defense));
  else if (type === 'arts') mitigated = Math.max(base * .05, base * Math.max(0, 1 - effective(resistance) / 100));
  else if (type === 'elemental') mitigated = Math.max(base * .05, base * Math.max(0, 1 - elementResistance / 100));
  else if (type === 'true' || type === 'healing') mitigated = base;
  else throw new Error(`Unsupported damage type: ${type}`);
  return Math.max(0, mitigated * multiplier * (1 - clamp(reduction, 0, 1)));
}
export function applyDamage(target, amount, {immortal = false, minHp = 0, type = 'physical', sourceId = null, sourceUid = null, beforeHpDamage = null} = {}) {
  if(target.infiniteHealth)return recordDummyDamage(target,amount,{type,sourceId,sourceUid});
  if (target.hp <= 0) return {hp: 0, shield: 0, total: 0, blocked:false, consumedGuard:null, depletedLayers:[]};
  const floor = Math.max(minHp, immortal ? 1 : 0);
  const barrier = (target.barriers || []).find(b => b.charges > 0 && (!b.types || b.types.includes(type)));
  if(barrier && amount > 0){
    barrier.charges--;
    // 层数护盾用尽即移除，避免消耗过的空壳一直留在数组里（敌方也复用这套屏障）。
    target.barriers=(target.barriers||[]).filter(b=>b.charges>0);
    return {hp:0,shield:0,total:0,blocked:true,consumedGuard:barrier,depletedLayers:[]};
  }
  const depletedLayers=[];
  let leftover=Math.max(0, amount);
  let shield=0;
  if((target.shieldLayers||[]).length){
    for(const layer of target.shieldLayers){
      if(leftover<=0)break;
      if(layer.types&&!layer.types.includes(type))continue;
      const take=Math.min(leftover, Math.max(0, layer.remaining||0));
      layer.remaining-=take;leftover-=take;shield+=take;
      if(layer.remaining<=1e-9)depletedLayers.push(layer);
    }
    target.shieldLayers=target.shieldLayers.filter(l=>l.remaining>1e-9);
    target.shield=target.shieldLayers.reduce((n,l)=>n+(l.remaining||0),0);
  }else{
    shield=Math.min(Math.max(0, target.shield || 0), leftover);
    target.shield=Math.max(0, (target.shield || 0) - shield);
    leftover-=shield;
  }
  if(leftover>0&&beforeHpDamage)leftover=Math.max(0,beforeHpDamage(leftover));
  // 「特殊生命值机制」：成功受到伤害时生命值只降低 1 点（不论伤害多少）；部分单位仅接受部分伤害类型，
  // 类型不符时生命值完全不降低。被屏障／护盾全额吸收（leftover 为 0）时不算「受到伤害」，同样不减。
  let hp;
  if(target.hitCountHp){
    const allowed=!Array.isArray(target.hitCountTypes)||target.hitCountTypes.includes(type);
    hp=allowed&&leftover>0?Math.min(1,Math.max(0, target.hp - floor)):0;
  }else{
    hp=Math.min(Math.max(0, target.hp - floor), leftover);
  }
  target.hp-=hp;
  return {hp, shield, total: hp + shield, blocked:false, consumedGuard:null, depletedLayers, hitCount:!!target.hitCountHp, raw:leftover};
}
export function recoverHP(target, amount) {
  if (target.hp <= 0) return 0;
  const real = Math.min(Math.max(0, target.maxHp - target.hp), Math.max(0, amount));
  target.hp += real;
  return real;
}
export function spCapacity(skill) { return skill.sp * (skill.charges || 1); }
export function gainSP(unit, skill, event, amount = 1) {
  if (!unit.deployed || unit.hp <= 0 || unit.active > 0 || unit.spLock > 0) return 0;
  if (event !== 'external' && event !== (skill.recovery || 'auto')) return 0;
  const gained = Math.min(Math.max(0, spCapacity(skill) - unit.sp), Math.max(0, amount));
  unit.sp += gained;
  return gained;
}
export function spendSP(unit, skill) {
  if (!unit.deployed || unit.hp <= 0 || unit.active > 0 || unit.spLock > 0 || unit.sp < skill.sp) return false;
  unit.sp -= skill.sp;
  unit.spLock = Math.max(1 / FPS, skill.spLock || 0);
  return true;
}
