// Serializable attack state: acquire -> windup -> release -> recovery -> acquire.
// The payload contains IDs and numbers only; rendering cannot advance combat.
export function startAttack(actor, payload, timing) {
  if (actor.action || actor.attackCooldown > 0) return false;
  actor.action = {phase: 'windup', left: timing.windupFrames, payload};
  actor.attackCooldown = timing.frames;
  return true;
}
export function advanceAttack(actor) {
  actor.attackCooldown = Math.max(0, (actor.attackCooldown || 0) - 1);
  if (!actor.action) return null;
  if (--actor.action.left > 0) return null;
  const payload = actor.action.payload;
  actor.action = null;
  return payload;
}
export function cancelAttack(actor) { actor.action = null; actor.attackCooldown = 0; }
