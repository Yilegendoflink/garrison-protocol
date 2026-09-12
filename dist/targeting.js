// Range geometry does not select targets or cause damage. Local +x is forward.
export function rotateCells(cells, unit) {
  const [fx, fy] = [[1, 0], [0, 1], [-1, 0], [0, -1]][unit.dir || 0];
  return cells.map(([x, y]) => [unit.x + x * fx - y * fy, unit.y + x * fy + y * fx]);
}
export function containsTarget(cells, target) {
  const radius = Math.max(0, target.hitRadius || 0);
  return cells.some(([x, y]) => Math.hypot(Math.max(0, Math.abs(target.x - x) - .5), Math.max(0, Math.abs(target.y - y) - .5)) <= radius);
}
export function pathRemaining(enemy, paths) {
  const path = paths[enemy.path];
  if (!path || enemy.segment >= path.length - 1) return 0;
  let distance = Math.hypot(enemy.x - path[enemy.segment + 1][0], enemy.y - path[enemy.segment + 1][1]);
  for (let i = enemy.segment + 1; i < path.length - 1; i++) distance += Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
  return distance;
}
export function selectEnemies(unit, enemies, {cells, paths, antiAir = false, priority = 'exit', limit = Infinity} = {}) {
  return enemies.filter(e => e.hp > 0 && !e.untargetable && (!e.invisible || e.block != null) && (!e.flying || antiAir) && (e.block === unit.uid || containsTarget(cells, e)))
    .sort((a, b) => Number(b.block === unit.uid) - Number(a.block === unit.uid)
      || (priority === 'air' ? Number(!!b.flying) - Number(!!a.flying) : 0)
      || (b.taunt || 0) - (a.taunt || 0)
      || pathRemaining(a, paths) - pathRemaining(b, paths)
      || a.uid - b.uid).slice(0, limit);
}
export function selectAllies(enemies, cells, limit = Infinity) {
  return enemies.filter(u => u.hp > 0 && u.deployed && !u.unhealable && u.hp < u.maxHp && containsTarget(cells, u))
    .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.uid - b.uid).slice(0, limit);
}
export function selectDefender(enemy, units) {
  const candidates = units.filter(u => u.hp > 0 && u.deployed && !u.untargetable && !u.invisible);
  const blocker = candidates.find(u => u.uid === enemy.block);
  if (blocker) return blocker;
  if (!enemy.ranged) return null;
  return candidates.filter(u => Math.hypot(u.x - enemy.x, u.y - enemy.y) <= enemy.ranged + (u.hitRadius || 0))
    .sort((a, b) => (b.taunt || 0) - (a.taunt || 0) || b.deployAt - a.deployAt || b.uid - a.uid)[0] || null;
}
