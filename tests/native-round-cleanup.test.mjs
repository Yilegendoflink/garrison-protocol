import test from 'node:test';
import assert from 'node:assert/strict';
import { openBattle, byId } from './effects-harness.mjs';
import { NativeSession } from '../dist/native-session.js';
import { NATIVE_DATA } from '../dist/runtime-data.js';

const lappland = Object.values(NATIVE_DATA.profiles).find(row => row.name === '荒芜拉普兰德' && !row.isGolden && row.skillChoices?.length);
const actor = uid => ({ uid, hp: 100, maxHp: 100, x: 1, y: 1, deployed: true, kind: 'summon' });

function battleWithLappland() {
 const opened = openBattle({ chessId: lappland.chessId, skillIndex: 2 });
 const b = opened.b, u = byId(b, 'char_1038_whitw2');
 u.sp = b.spCost(u);
 b.activate(u);
 b.step();
 assert.equal((b.s.whitwEyes || []).length, 2, 'S3 应已生成两只特殊浮游单元');
 return { ...opened, u };
}

test('normal battle entering intermission clears live entities and preserves the result board', () => {
 const { g, b, u } = battleWithLappland();
 b.s.summons.push(actor(b.s.nextId++));
 b.s.projectiles.push({ owner: u.uid, target: 999999, x: 1, y: 1, speed: 1 });
 b.s.enemyProjectiles.push({ owner: 999999, startedAt: 0, impactAt: 1, startX: 0, startY: 0, targetX: 1, targetY: 1, radius: 1, amount: 10 });
 b.s.pendingEnemySpawns.push({ q: { id: 'probe' }, placement: { x: 1, y: 1 }, at: 99 });
 b.s.logicEffects.push({ id: 1, kind: 'zone', endsAt: 99 });
 b.s.effects.push({ x: 1, y: 1, life: 10, type: 'hit' });
 b.s.events.push({ id: 1, t: b.s.time, type: 'strike', uid: u.uid });
 b.s.strikes.push({ uid: u.uid, x: 1, y: 1 });
 b.s.queue.push({ id: 'probe', at: 99 });
 b.s.settle.queue.push({ kind: 'damage', seq: 1 });
 b.s.settle.byId.pending = { id: 'pending' };
 u.whitwFloaters = [{ index: 0, targetUid: 999999 }];
 u.summonRespawns = { 'vigil-wolf': { at: 99 } };
 u.pendingReturns = 2;
 const retainedUnits = b.s.units;

 b.finish('complete');
 g.finishCurrentBattle();

 assert.equal(g.s.phase, 'intermission');
 for (const key of ['enemies', 'summons', 'whitwEyes', 'projectiles', 'enemyProjectiles', 'pendingEnemySpawns', 'logicEffects', 'effects', 'events', 'strikes', 'queue']) {
  assert.deepEqual(b.s[key], [], `${key} 应在休整时清空`);
 }
 assert.deepEqual(b.s.settle.queue, []);
 assert.deepEqual(b.s.settle.byId, {});
 assert.deepEqual(u.whitwFloaters, []);
 assert.equal(u.whitwEyeCount, 0);
 assert.deepEqual(u.summonRespawns, {});
 assert.equal(u.pendingReturns, 0);
 assert.strictEqual(b.s.units, retainedUnits, '休整画布仍保留本场干员位置');
 assert.equal(b.s.result.kind, 'battle', '战斗结算快照应保留');
 assert.equal(g.s.history.length, 1, '战绩应在清理前写入历史');
 assert.equal(g.s.lastBattle.success, true);
});

test('restoring an older intermission save also removes stale battle entities', () => {
 const { g, b } = battleWithLappland();
 b.s.summons.push(actor(b.s.nextId++));
 b.s.projectiles.push({ owner: 1, target: 2, x: 1, y: 1, speed: 1 });
 const record = structuredClone(g.snapshot());
 record.s.phase = 'intermission';

 const restored = NativeSession.restore(NATIVE_DATA, record);
 assert.ok(restored, '旧的休整存档应仍可读入');
 for (const key of ['enemies', 'summons', 'whitwEyes', 'projectiles', 'enemyProjectiles', 'pendingEnemySpawns', 'logicEffects', 'effects', 'events', 'strikes', 'queue']) {
  assert.deepEqual(restored.battle.s[key], [], `${key} 应在恢复旧休整存档时清空`);
 }
});
