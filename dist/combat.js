// Shared numerical rules. Ratios are fractions, time is seconds, ASPD defaults to 100.
export const FPS = 30;
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export function attribute(base, {add = 0, ratio = 0, finalAdd = 0, scales = [], min = 0, max = Infinity} = {}) {
  const scale = scales.reduce((total, value) => total * (value < 0 ? 1 + value : value), 1);
  return clamp(((base + add) * Math.max(0, 1 + ratio) + finalAdd) * scale, min, max);
}
export function attackTiming(interval, attackSpeed = 100, windup = interval * .3, intervalAdd = 0) {
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
export function applyDamage(target, amount, {immortal = false, type = 'physical'} = {}) {
  if (target.hp <= 0) return {hp: 0, shield: 0, total: 0};
  const barrier = (target.barriers || []).find(b => b.charges > 0 && (!b.types || b.types.includes(type)));
  if(barrier && amount > 0){barrier.charges--;return {hp:0,shield:0,total:0,blocked:true};}
  const shield = Math.min(Math.max(0, target.shield || 0), Math.max(0, amount));
  target.shield = Math.max(0, (target.shield || 0) - shield);
  const hp = Math.min(Math.max(0, target.hp - (immortal ? 1 : 0)), Math.max(0, amount - shield));
  target.hp -= hp;
  return {hp, shield, total: hp + shield};
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
