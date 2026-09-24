import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NATIVE_DATA as data} from '../dist/runtime-data.js';
import {DIRECTIONS, directionOf} from '../dist/protocol.js';
import {openBattle, deployNow, byId, enemy} from './effects-harness.mjs';

// 技能范围回归（用户 2026-09-22 报「范围过大／圆形变方形」，核对与修复见
// docs/SKILL_RANGE_AUDIT_2026-09-22.md）。这里钉住四件事：
//   1. 范围形状数据与 PRTS 快照一致（数据层不许回退）；
//   2. 「攻击范围内」类圈按真实范围格判定，不用包围半径；
//   3. 瞬时／被动技能的范围要生效；
//   4. 圆形领域、召唤物范围、要塞自身格、方向表的口径。

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const readJson = async p => JSON.parse(await readFile(path.join(root, p), 'utf8'));
const chessOf = (charId, golden = false) => Object.values(data.profiles).find(p => p.charId === charId && !!p.isGolden === golden)?.chessId;

test('范围形状数据与 PRTS 快照逐格一致，基础范围与 PRTS 的 phase.rangeId 全部对得上', async () => {
  const ours = await readJson('data/gamedata/allianceLower/range_table.json');
  const prtsRaw = await readJson('data/prts/snapshots/2026-09-12-prts/ranges.json');
  const prts = Object.fromEntries(Object.values(prtsRaw).map(e => [e.id, e]));
  const set = (grids, map) => [...new Set((grids || []).map(map))].sort().join(' ');
  const shared = Object.keys(ours).filter(id => prts[id] && (prts[id].displayCells || []).length);
  const mismatched = shared.filter(id => set(ours[id].grids, g => `${g.col},${g.row}`) !== set(prts[id].displayCells, c => `${c.x},${c.y}`));
  assert.ok(shared.length >= 60, '共有可比对的范围条数（' + shared.length + '）');
  assert.deepEqual(mismatched, [], '与 PRTS 快照不一致的范围：' + mismatched.join(','));
  // PRTS 快照抓取为空的那几条（本期只用 4-5/4-6），单独记一笔，别把「没抓到」当成「不一致」
  const empty = Object.keys(ours).filter(id => prts[id] && !(prts[id].displayCells || []).length);
  assert.ok(empty.includes('4-5') && empty.includes('4-6'), 'PRTS 快照对 4-5/4-6 是空抓取，要塞口径要靠 range_table 判定');
  // 基础范围：每个预设当前精英阶段的 rangeId 必须与 PRTS 快照一致
  const ops = await readJson('data/prts/snapshots/2026-09-12-prts/operators.json');
  const byGameId = new Map(Object.values(ops).filter(o => o?.gameId).map(o => [o.gameId, o]));
  let checked = 0;
  for (const p of Object.values(data.profiles)) {
    if (!p?.charId || p.isGolden) continue;
    const row = byGameId.get(p.charId);
    if (!row) continue;
    const phase = (row.phases || []).find(x => Number(String(x.phase).replace('PHASE_', '')) === p.phase);
    if (!phase) continue;
    checked += 1;
    assert.equal(phase.rangeId, p.rangeId, `${p.name} 精英阶段 ${p.phase} 的基础范围与 PRTS 不一致`);
  }
  assert.ok(checked >= 100, '至少核对 100 名干员（实际 ' + checked + '）');
  // 所有被引用的 rangeId 都要在范围表里
  const referenced = new Set();
  for (const p of Object.values(data.profiles)) {
    if (!p?.charId) continue;
    if (p.rangeId) referenced.add(p.rangeId);
    for (const c of p.skillChoices || []) if (c.skill?.rangeId) referenced.add(c.skill.rangeId);
  }
  const missing = [...referenced].filter(id => !ours[id]);
  assert.deepEqual(missing, [], '范围表缺少被引用的 rangeId：' + missing.join(','));
});

test('「攻击范围内」类圈按真实范围格判定：莫斯提马 S2 与塞雷娅 S3 不再用包围半径', () => {
  // 莫斯提马 S2「荒时之锁」= 攻击范围 3-6（9 格，只在正前方 3x3）
  {
    const { b } = openBattle([{ chessId: chessOf('char_213_mostma'), skillIndex: 1 }, { chessId: chessOf('char_107_liskam'), skillIndex: 1 }]);
    deployNow(b);
    const u = byId(b, 'char_213_mostma');
    const front = enemy(b, { x: u.x + 1, y: u.y, hp: 20000 });
    const corner = enemy(b, { x: u.x + 2, y: u.y + 2, hp: 20000 });
    const behind = enemy(b, { x: u.x - 2, y: u.y - 2, hp: 20000 });
    u.sp = b.spCost(u) + 2; u.lastSkill = -Infinity;
    b.activate(u);
    const zone = (b.s.logicEffects || []).find(f => f.talentOrSkillId === 'mostma-s2');
    assert.ok(zone, '要有荒时之锁的圈');
    assert.equal(zone.rangeUid, u.uid, '圈要挂在对施法者的攻击范围上');
    for (let i = 0; i < 12; i += 1) b.step();
    assert.ok(front.hp < 20000, '范围内的敌人要掉血');
    assert.equal(corner.hp, 20000, '斜后 2 格不在 3-6 里，不能掉血（此前是 5x5 方格）');
    assert.equal(behind.hp, 20000, '身后 2 格同样不该掉血');
  }
  // 塞雷娅 S3「钙质化」= x-3（25 格，缺四角）
  {
    const { b } = openBattle([{ chessId: chessOf('char_202_demkni'), skillIndex: 2 }, { chessId: chessOf('char_107_liskam'), skillIndex: 1 }]);
    deployNow(b);
    const u = byId(b, 'char_202_demkni'), ally = byId(b, 'char_107_liskam');
    ally.x = u.x + 2; ally.y = u.y; ally.hp = ally.maxHp - 400;
    const corner = enemy(b, { x: u.x + 3, y: u.y + 3, hp: 20000 });
    u.sp = b.spCost(u) + 2; u.lastSkill = -Infinity;
    const before = ally.hp;
    b.activate(u);
    const zone = (b.s.logicEffects || []).find(f => f.talentOrSkillId === 'saria-s3');
    assert.equal(zone?.rangeUid, u.uid, '钙质化的圈要挂攻击范围');
    for (let i = 0; i < 40; i += 1) b.step();
    assert.ok(ally.hp > before, '范围内的友军照常回血');
    assert.equal(corner.hp, 20000, 'x-3 的四角不在范围内，不能掉血（此前是 7x7 方格）');
  }
});

test('瞬时／被动技能的范围要生效：塞雷娅 S1 治得到相邻友军、焰尾 S2 打得到 x-1 独有格', () => {
  // 塞雷娅 S1「急救」：下一次攻击为周围（x-4 = 3x3）血量不足一半的友军回血
  {
    const { b } = openBattle([{ chessId: chessOf('char_202_demkni'), skillIndex: 0 }, { chessId: chessOf('char_107_liskam'), skillIndex: 1 }]);
    deployNow(b);
    const u = byId(b, 'char_202_demkni'), ally = byId(b, 'char_107_liskam');
    enemy(b, { x: u.x + 1, y: u.y, hp: 100000, atk: 1, block: u.uid, interval: 99 });
    ally.x = u.x; ally.y = u.y + 1; ally.hp = ally.maxHp * 0.3;
    u.sp = b.spCost(u) + 2; u.lastSkill = -Infinity;
    const before = ally.hp;
    b.activate(u);
    assert.equal(u.pendingAttackHeal?.rangeId, 'x-4', '「下一次攻击治疗」要带上技能范围');
    assert.equal(u.pendingAttackHeal?.requiresBelow, true, '文案「不足一半」要有血量门槛');
    for (let i = 0; i < 200; i += 1) b.step();
    assert.ok(ally.hp > before, '相邻的残血友军应当被治疗（此前只认自身格，永远治不到）');
  }
  // 焰尾 S2「红松林」：x-1 = 13 格，包含四个正方向 2 格
  {
    const { b } = openBattle([{ chessId: chessOf('char_420_flamtl'), skillIndex: 1 }, { chessId: chessOf('char_107_liskam'), skillIndex: 1 }]);
    deployNow(b);
    const u = byId(b, 'char_420_flamtl');
    const inData = enemy(b, { x: u.x, y: u.y - 2, hp: 20000 });
    const control = enemy(b, { x: u.x + 5, y: u.y + 3, hp: 20000 });
    u.sp = b.spCost(u) + 2; u.lastSkill = -Infinity;
    b.activate(u);
    for (let i = 0; i < 12; i += 1) b.step();
    assert.ok(inData.hp < 20000, 'x-1 独有的 (0,-2) 要能打到');
    assert.equal(control.hp, 20000, '范围外的敌人不能被打到');
  }
});

test('被动技能的范围常驻生效：缄默德克萨斯 S2 按 x-4 而不是基础 1-1', () => {
  const { b } = openBattle({ chessId: chessOf('char_1028_texas2'), skillIndex: 1 });
  deployNow(b);
  const u = b.s.units[0];
  const p = b.profile(u);
  assert.equal(p.skill.skillType, 'PASSIVE');
  assert.equal(p.rangeId, '1-1');
  assert.equal(p.skill.rangeId, 'x-4');
  assert.equal(b.rangeWithSkill(u, false).rangeId, 'x-4', '被动技能的范围不依赖 skillLeft');
  assert.equal(b.range(u, false).length, 9);
  // 开技状态也不受影响
  assert.equal(b.rangeWithSkill(u, true).rangeId, 'x-4');
});

test('要塞（灰毫／号角）的基础范围不含自身格——客户端不再手补 (0,0)', () => {
  for (const charId of ['char_4039_horn', 'char_431_ashlok']) {
    const { b } = openBattle({ chessId: chessOf(charId), skillIndex: 0 });
    deployNow(b);
    const u = b.s.units[0], grids = b.data.ranges[b.profile(u).rangeId].grids;
    assert.equal(b.profile(u).branch, 'fortress');
    assert.ok(!grids.some(g => g.col === 0 && g.row === 0), b.profile(u).name + ' 的范围表本身不含自身格');
    assert.ok(!b.range(u, false).some(c => c.x === u.x && c.y === u.y), b.profile(u).name + ' 的生效范围也不该含自身格');
  }
});

test('召唤物按自己 token 的 rangeId 判定：海嗣 3x3 打得到邻格，狼群 0-1 打不到', () => {
  // 海嗣 token 10017 的 rangeId 是 x-4（3x3）
  {
    const { b } = openBattle({ chessId: chessOf('char_1012_skadi2') });
    deployNow(b);
    const token = b.s.summons.find(s => s.type === 'skadi2-seaborn');
    assert.ok(token, '开战后应有海嗣');
    assert.equal(token.rangeId, 'x-4', '召唤物要记下自己 token 的范围');
    const near = enemy(b, { x: token.x + 1, y: token.y + 1, hp: 20000 });
    for (let i = 0; i < 200; i += 1) b.step();
    const hits = (b.s.logicLog || []).filter(x => x.type === 'damage' && x.sourceUid === token.uid && x.targetUid === near.uid);
    assert.ok(hits.length > 0, '海嗣的 3x3 覆盖斜邻格（x-4 = 3x3）');
  }
  // 狼群 token 10028 的 rangeId 是 0-1（自身格）
  {
    const { b } = openBattle({ chessId: 'chess_char_3_19_b', skillIndex: 0 });
    deployNow(b);
    const wolf = b.s.summons.find(s => s.type === 'vigil-wolf');
    assert.ok(wolf, '开战后应有狼群');
    assert.equal(wolf.rangeId, '0-1');
    const far = enemy(b, { x: wolf.x + 2, y: wolf.y, hp: 20000 });
    for (let i = 0; i < 200; i += 1) b.step();
    // 持有者自己有射程，伤害来源要按 sourceUid 归因，别把她的攻击算到狼群头上
    const wolfHits = (b.s.logicLog || []).filter(x => x.type === 'damage' && x.sourceUid === wolf.uid && x.targetUid === far.uid);
    assert.equal(wolfHits.length, 0, '狼群只打自身格／被它阻挡的目标，2 格外打不到');
  }
});

test('圆形领域按欧氏距离判定与绘制：锏 S3 不吃斜角', () => {
  const { b } = openBattle([{ chessId: chessOf('char_4116_blkkgt'), skillIndex: 2 }, { chessId: chessOf('char_107_liskam'), skillIndex: 1 }]);
  deployNow(b);
  const u = byId(b, 'char_4116_blkkgt');
  const orth = enemy(b, { x: u.x, y: u.y - 2, hp: 20000, def: 0 });
  const diag = enemy(b, { x: u.x + 2, y: u.y + 2, hp: 20000, def: 0 });
  u.sp = b.spCost(u) + 2; u.lastSkill = -Infinity;
  b.activate(u);
  const zone = (b.s.logicEffects || []).find(f => String(f.talentOrSkillId || '').startsWith('blkkgt-s3'));
  assert.equal(zone?.values?.shape, 'circle', '半径 2 的斩击领域要显式声明圆形');
  for (let i = 0; i < 12; i += 1) b.step();
  assert.ok(orth.hp < 20000, '正方向 2 格在圆内');
  assert.equal(diag.hp, 20000, '斜角 2 格在圆外（方格近似会误伤）');
});

test('方向表只有一份，且 1/3 不再颠倒', async () => {
  assert.deepEqual([...DIRECTIONS], [[1, 0], [0, 1], [-1, 0], [0, -1]], '0=右、1=下、2=左、3=上');
  assert.deepEqual(directionOf(1), [0, 1]);
  assert.deepEqual(directionOf(3), [0, -1]);
  for (const file of ['dist/native-shift.js', 'dist/native-battle.js', 'dist/native-operator-effects.js', 'dist/native-effects.js', 'dist/garrison.js', 'dist/native-equipment.js']) {
    const source = await readFile(path.join(root, file), 'utf8');
    assert.ok(!source.includes('[[1,0],[0,-1],[-1,0],[0,1]]'), file + ' 里还有 1/3 颠倒的方向表');
  }
});

test('备战预览按所选技能的范围高亮（源码门禁）', async () => {
  const play = await readFile(path.join(root, 'dist/native-play.js'), 'utf8');
  assert.match(play, /data\.ranges\?\.\[sp\.skill\?\.rangeId\|\|sp\.rangeId\]/, '预览要按所选技能的 rangeId 取网格');
  assert.match(play, /整个战场\|全场/, '「攻击范围扩大至整个战场」要整图高亮');
  assert.doesNotMatch(play, /branch==='fortress'\?\[\{row:0,col:0\}\]/, '要塞补自身格已删除，预览不要再补');
});
