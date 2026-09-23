import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_DATA as data} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {enemy} from './effects-harness.mjs';
import {NO_BOND_BAN} from './no-bond-ban.mjs';
import {commitExit, spawnSummon, summonLifecycle} from '../dist/native-effects.js';
import {drawDollOverlay} from '../dist/native-fx.js';

// 用户 2026-09-22 报障三项：
//  1. 召唤物生命周期：布局放置 → 开战自动召唤 → 时长结束退场 → 自己的再部署 CD 转好后按布局位置复现；
//  2. 浊心斯卡蒂三技能只打敌人（不打友方／海嗣），且是真实伤害；
//  3. 傀儡师替身形态要在头像上盖动态紫色特效。
const runTo = (b, t) => { let guard = 0; while (b.s.time < t - 1e-9 && !b.s.finished) { if (++guard > 300000) throw Error('时间未收敛'); b.step(); } };

// 布局：把 owner 和它的召唤物卡都放好，开战
function layout(chessId, {extra = []} = {}) {
  const g = new NativeSession(data, {seed: 1, bondBan: NO_BOND_BAN});
  g.s.funds = 9999; g.s.capacity = 16; g.s.rewardPending = null; g.s.rewardQueue = [];
  const owner0 = g.gain(chessId);
  const units = [owner0, ...extra.map(id => g.gain(id))];
  for (const u of units) {
    let placed = false;
    for (let y = 0; y < g.map.rows && !placed; y += 1) for (let x = 0; x < g.map.cols && !placed; x += 1) {
      if (g.s.units.some(v => v.uid !== u.uid && v.position?.x === x && v.position?.y === y)) continue;
      placed = g.canDeploy(u.uid, x, y) && g.deploy(u.uid, x, y, 0);
    }
    assert.ok(placed, u.chessId + ' 需要落场');
  }
  g.s.rewardPending = null; g.s.rewardQueue = [];
  g.syncSummonCards();
  const card = g.s.summonCards.find(c => c.ownerUid === owner0.uid);
  assert.ok(card, chessId + ' 应当有召唤物卡');
  let spot = null;
  for (const [dx, dy] of [[2, 0], [1, 0], [2, -1], [3, 0], [1, -1], [2, 1], [-1, 0]]) if (g.canDeploySummonCard(card.uid, owner0.position.x + dx, owner0.position.y + dy)) { spot = {x: owner0.position.x + dx, y: owner0.position.y + dy}; break; }
  assert.ok(spot, '需要一块能放召唤物卡的地');
  assert.equal(g.deploySummonCard(card.uid, spot.x, spot.y, 0), true);
  assert.equal(g.perform('start'), true, g.lastError);
  const b = g.battle; b.s.queue = []; b.s.enemies = []; b.s.limit = 1e9;
  enemy(b, {hp: 1e12, x: -8, y: -8, trainingDummy: true, hidden: true, untargetable: true, invulnerable: true});
  const owner = b.s.units.find(u => u.chessId === chessId);
  return {g, b, card, spot, owner, summons: type => b.s.summons.filter(s => s.type === type)};
}

test('海嗣：布局放置 → 开战自动召唤（时长 25 秒）→ 退场 → 自己的再部署 CD（30 秒）后回到布局位置', () => {
  const {b, card, spot, owner, summons} = layout('chess_char_6_04_a');
  assert.deepEqual(summonLifecycle(b, owner, 'skadi2-seaborn'), {duration: 25, redeploy: 30}, '时长取天赋「持续25秒」，CD 取 token 的 respawnTime=30');
  const first = summons('skadi2-seaborn')[0];
  assert.ok(first, '开战应当自动召唤海嗣');
  assert.deepEqual({x: first.x, y: first.y}, spot, '第一次出现在布局位置');
  assert.equal(first.endsAt, 25, '持续 25 秒');
  runTo(b, 25.5);
  assert.equal(summons('skadi2-seaborn').length, 0, '时长结束退场');
  assert.equal(owner.summonRespawns['skadi2-seaborn'].at, 55, '退场后排入 30 秒的再部署 CD');
  runTo(b, 56);
  const second = summons('skadi2-seaborn')[0];
  assert.ok(second, 'CD 转好后再次出现');
  assert.deepEqual({x: second.x, y: second.y}, spot, '复现回到布局位置（不是召唤者身边）');
  assert.equal(second.endsAt, 80, '复现的这只同样持续 25 秒');
  runTo(b, 81);
  assert.equal(owner.summonRespawns['skadi2-seaborn'].at, 110, '再次退场后继续按 CD 排队');
  assert.ok(card.position && card.position.x === spot.x, '布局卡位置不变，后续都回到这里');
});

test('流形：被击败后 25 秒自动刷新，位置仍是布局点', () => {
  const {b, spot, owner, summons} = layout('chess_char_6_11_a');
  assert.deepEqual(summonLifecycle(b, owner, 'mlyss-fluid'), {duration: 0, redeploy: 25}, '天赋写的是「被击败后会在25秒后自动刷新」');
  const first = summons('mlyss-fluid')[0];
  assert.ok(first, '开战自动召唤流形');
  assert.deepEqual({x: first.x, y: first.y}, spot);
  commitExit(b, {target: first, reason: 'knockdown'});
  assert.equal(owner.summonRespawns['mlyss-fluid'].at, 25, '被击败后 25 秒刷新');
  runTo(b, 26);
  const again = summons('mlyss-fluid')[0];
  assert.ok(again, '25 秒后自动刷新');
  assert.deepEqual({x: again.x, y: again.y}, spot, '回到布局点');
});

test('装置类召唤物（支援装置／医疗无人机）不进这条复现队列', () => {
  const {b, owner, summons} = layout('chess_char_4_11_a');       // 凯瑟琳：支援装置
  const device = summons('cathy-device')[0];
  assert.ok(device, '凯瑟琳应当有支援装置');
  assert.equal(device.device, true);
  commitExit(b, {target: device, reason: 'knockdown'});
  assert.equal(owner.summonRespawns ?? null, null, '装置由技能库存管理，不自动复现');
});

test('浊心斯卡蒂三技能：只对敌人造成真实伤害，友方与海嗣都不受伤；自身每秒流失 5%', () => {
  const {b, owner, summons} = layout('chess_char_6_04_a', {extra: ['chess_char_3_20_a']});
  const ally = b.s.units.find(u => u.chessId === 'chess_char_3_20_a');
  const token = summons('skadi2-seaborn')[0];
  const probe = enemy(b, {hp: 1e6, x: owner.x + 1, y: owner.y, def: 0, res: 0});
  owner.sp = 999; owner.lastSkill = -Infinity;
  b.activate(owner);
  assert.equal(b.skillActive(owner), true, '三技能「潮涌，潮枯」应当开起来');
  const zone = (b.s.logicEffects || []).find(f => f.kind === 'zone' && /skadi2/.test(f.talentOrSkillId || ''));
  assert.ok(zone, '三技能应当生成周期伤害区域');
  assert.equal(zone.trackSide, 'enemy', '目标侧必须是敌人（文案里的「友方单位」是鼓舞那半句）');
  assert.equal(zone.values.type, 'true', '文案写「真实伤害」');
  const before = {probe: probe.hp, ally: ally.hp, token: token.hp, owner: owner.hp};
  runTo(b, 3);
  assert.ok(before.probe - probe.hp > 0, '敌人在掉血');
  assert.equal(ally.hp, before.ally, '友方干员不受伤');
  assert.equal(token.hp, before.token, '自己的海嗣不受伤');
  const lost = before.owner - owner.hp;
  assert.ok(Math.abs(lost - owner.maxHp * 0.05 * 3) < owner.maxHp * 0.02, `自身 3 秒约流失 15% 最大生命（实际 ${(lost / owner.maxHp * 100).toFixed(1)}%），没有第一秒双扣`);
});

test('傀儡师替身：头像上要盖动态紫色特效（dollForm 期间才画）', () => {
  const drawn = [], gradientStops = [];
  const ctx = {
    save: () => drawn.push('save'), restore: () => drawn.push('restore'),
    createLinearGradient: () => ({addColorStop: (at, color) => gradientStops.push(color)}),
    fillRect: (x, y, w, h) => drawn.push(`fill:${Math.round(w)}x${Math.round(h)}`),
    set fillStyle(v) { drawn.push('fillStyle:' + String(v).slice(0, 24)); }, get fillStyle() { return ''; },
    set strokeStyle(v) { drawn.push('strokeStyle:' + String(v).slice(0, 24)); }, get strokeStyle() { return ''; },
    set lineWidth(v) { drawn.push('lineWidth'); }, get lineWidth() { return 1; },
    set globalCompositeOperation(v) { drawn.push('gco:' + v); }, get globalCompositeOperation() { return 'source-over'; },
    beginPath: () => drawn.push('beginPath'), arc: (...a) => drawn.push('arc:' + a[3].toFixed(2)), stroke: () => drawn.push('stroke'),
  };
  const box = {x: 0, y: 0, w: 48, h: 48};
  assert.equal(drawDollOverlay(ctx, {}, box, {time: 1}), false, '不是替身时不画');
  assert.equal(drawDollOverlay(ctx, {dollForm: {until: 20}}, box, {time: 1}), true, '替身状态要画');
  assert.ok(gradientStops.some(v => /rgba\(1[0-9]{2},\s*\d+,\s*2[0-9]{2}/.test(v)), '要有紫色罩色：' + gradientStops.join(' '));
  assert.ok(drawn.filter(d => d.startsWith('arc:')).length >= 2, '两条弧环');
  // 动态：不同时刻的弧线角度不一样
  const angleAt = t => { const seen = []; const c2 = {...ctx, arc: (...a) => seen.push(a[3])}; drawDollOverlay(c2, {dollForm: {until: 20}}, box, {time: t}); return seen.join(','); };
  assert.notEqual(angleAt(0.2), angleAt(1.1), '弧环位置随时间变化（动态特效）');
  // reduceFx：仍然画罩色，但不做旋转
  const reduceAngles = [];
  const c3 = {...ctx, arc: (...a) => reduceAngles.push(a[3])};
  drawDollOverlay(c3, {dollForm: {until: 20}}, box, {reduceFx: true, time: 1.1});
  assert.ok(reduceAngles.length >= 2 && reduceAngles.every(a => a === 0), 'reduceFx 下画静止圆环');
});
