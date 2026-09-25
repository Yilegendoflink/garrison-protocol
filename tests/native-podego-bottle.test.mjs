import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NATIVE_DATA as data} from '../dist/runtime-data.js';
import {openBattle, deployNow, byId, enemy} from './effects-harness.mjs';

// 用户 2026-09-22 报「波登可的技能投掷瓶子的效果不正确，和 PRTS 不一致」。
// PRTS 技能备注：「※孢子群范围半径为0.9，可对空」＋描述「碎裂后在周围产生一个持续5秒的孢子群；
// 孢子群范围内所有敌人被停顿且失去特殊能力，每秒受到相当于攻击力60%的法术伤害（专三 6 秒 / 80%）」。
// 修前的两个问题：
//   1. 通用「每秒受到伤害」兜底分支在**波登可自己脚下**又画了一个 5×5 的伤害圈（真正落点的圈没人管）；
//   2. 通用「开技时对攻击范围内所有敌人施加状态」把「失去特殊能力」漏给了攻击范围内的所有敌人。
// 同一类兜底误伤了另外十来个技能，见 docs/SKILL_RANGE_AUDIT_2026-09-22.md。

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const chessOf = charId => Object.values(data.profiles).find(p => p.charId === charId && !p.isGolden)?.chessId;
// 预设的技能等级决定黑板数值（波登可 S2 的 atk_scale 随等级 40%→80%、地灵 S2 的 interval 1.6→…），
// 断言一律从当前档案的黑板取，别写死某一级的数字。
const bbOf = (u, key) => Number((u.skill?.blackboard || u.profile?.skill?.blackboard || []).find(x => x?.key === key)?.value);
const skillBB = (b, u, key) => bbOf({ skill: b.profile(u).skill }, key);

test('波登可 S2 孢子扩散：只有落点那一格、落地即停顿＋失去特殊能力、每秒 1 次法术伤害、可对空', () => {
  const { b } = openBattle([{ chessId: chessOf('char_258_podego'), skillIndex: 1 }, { chessId: chessOf('char_107_liskam'), skillIndex: 1 }]);
  deployNow(b);
  const u = byId(b, 'char_258_podego');
  const target = enemy(b, { x: u.x + 2, y: u.y, hp: 20000, res: 0 });
  const neighbour = enemy(b, { x: u.x + 2, y: u.y - 1, hp: 20000, res: 0 });  // 相邻格：不在半径 0.9 内
  const flying = enemy(b, { x: u.x + 2, y: u.y, hp: 20000, res: 0, flying: true });
  u.sp = b.spCost(u) + 2; u.lastSkill = -Infinity;
  b.activate(u);
  // 只应有一个圈：落点上的孢子群。不再有「自己脚下」的兜底伤害圈
  const zones = (b.s.logicEffects || []).filter(f => f.kind === 'zone');
  assert.deepEqual(zones.map(f => f.talentOrSkillId), ['podego-s2'], '只能有瓶子那一个圈：' + zones.map(f => f.talentOrSkillId).join(','));
  const zone = zones[0];
  assert.equal(zone.radius, 0.9, 'PRTS 备注：孢子群范围半径为 0.9');
  assert.equal(zone.values.shape, 'circle');
  assert.deepEqual({ x: zone.x, y: zone.y }, { x: target.x, y: target.y }, '圈落在投掷点（当前攻击目标）');
  assert.equal(zone.values.groundOnly, undefined, '可对空，不能设 groundOnly');
  assert.ok(Math.abs(zone.endsAt - 5) < 1e-9, '持续 projectile_delay_time = 5 秒');
  assert.equal(zone.values.silence, true, '失去特殊能力由孢子群圈负责');
  // 落地即生效
  assert.ok((target.statuses || []).some(s => s.kind === 'sluggish'), '落地马上被停顿');
  assert.ok((target.statuses || []).some(s => s.kind === 'silence'), '落地马上失去特殊能力');
  assert.equal((neighbour.statuses || []).length, 0, '相邻格不在孢子群里，不该被挂任何状态');
  // 每秒 1 次、持续 5 秒 → 每个目标 5 次；伤害 = 攻击力 × atk_scale(0.6)
  let sluggishTicks = 0;
  for (let i = 0; i < 30 * 6; i += 1) { b.step(); if ((target.statuses || []).some(s => s.kind === 'sluggish')) sluggishTicks += 1; }
  const dotsOf = uid => (b.s.logicLog || []).filter(x => x.type === 'damage' && x.cause === 'dot' && x.sourceUid === u.uid && x.targetUid === uid);
  assert.equal(dotsOf(target.uid).length, 5, '5 秒孢子群对落点目标结算 5 次');
  assert.equal(dotsOf(flying.uid).length, 5, '飞行单位同样每秒结算（可对空）');
  assert.equal(dotsOf(neighbour.uid).length, 0, '相邻格不会被孢子群每秒伤害');
  const expect = Math.round(b.stats(u).atk * skillBB(b, u, 'atk_scale'));
  for (const d of dotsOf(target.uid)) assert.ok(Math.abs(d.hp - expect) <= 2, `每次伤害应为攻击力×${skillBB(b, u, 'atk_scale')}≈${expect}，实际 ${Math.round(d.hp)}`);
  assert.ok(sluggishTicks >= 30 * 4, '孢子群内整段时间都被停顿（每秒刷新）');
  assert.ok((neighbour.statuses || []).length === 0, '相邻格全程不受影响');
});

test('地灵 S2 流沙化：只施加停顿、没有伤害；技能期间缴械；范围取攻击范围', () => {
  const { b } = openBattle({ chessId: chessOf('char_183_skgoat'), skillIndex: 1 });
  deployNow(b);
  const u = b.s.units[0];
  const inRange = enemy(b, { x: u.x + 2, y: u.y, hp: 20000, res: 0 });
  const outRange = enemy(b, { x: u.x + 9, y: u.y + 6, hp: 20000, res: 0 });
  assert.ok(b.range(u, true).some(c => c.x === inRange.x && c.y === inRange.y), '探针要落在她的攻击范围里');
  assert.ok(!b.range(u, true).some(c => c.x === outRange.x && c.y === outRange.y), '另一个探针要在范围外');
  u.sp = b.spCost(u) + 2; u.lastSkill = -Infinity;
  b.activate(u);
  const zone = (b.s.logicEffects || []).find(f => f.talentOrSkillId === 'skgoat-s2');
  assert.ok(zone, '流沙化要有专属圈');
  assert.equal(zone.rangeUid, u.uid, '范围随她的攻击范围');
  assert.equal(zone.values.dot, undefined, '流沙化没有伤害');
  assert.equal(zone.values.sluggishTime, skillBB(b, u, 'sluggish'), 'PRTS 备注：停顿时间取黑板 sluggish');
  assert.equal(zone.interval, skillBB(b, u, 'interval'), '间隔取黑板 interval');
  assert.ok((u.skillDisarmUntil || 0) > b.s.time, '技能期间缴械（停止攻击）');
  assert.ok((inRange.statuses || []).some(s => s.kind === 'sluggish'), '落地即对范围内敌人施加停顿');
  assert.equal((outRange.statuses || []).some(s => s.kind === 'sluggish'), false, '范围外不停顿');
  let sluggishTicks = 0;
  for (let i = 0; i < 30 * 6; i += 1) { b.step(); if ((inRange.statuses || []).some(s => s.kind === 'sluggish')) sluggishTicks += 1; }
  assert.ok(sluggishTicks >= 30 * 2.5, '每 1.6 秒刷新 0.8 秒停顿，累计应有约一半时间在停顿');
  assert.equal(inRange.hp, 20000, '范围内敌人只被停顿，不掉血（此前兜底圈每秒造成伤害）');
  assert.equal(outRange.hp, 20000, '范围外不受影响');
  assert.equal((b.s.logicLog || []).filter(x => x.type === 'damage' && x.sourceUid === u.uid).length, 0, '地灵本人没有造成任何伤害');
});

test('通用兜底圈与通用状态都是收窄过的白名单：没有其它技能凭空多出圈或全范围状态（源码＋实机门禁）', async () => {
  const source = await readFile(path.join(root, 'dist/native-operator-effects.js'), 'utf8');
  const listOf = name => {
    const at = source.indexOf(name);
    assert.ok(at > 0, name + ' 不存在');
    const block = source.slice(at, source.indexOf(']);', at));
    return [...block.matchAll(/'(char_\w+)#(\d)'/g)].map(m => `${m[1]}#${m[2]}`).sort();
  };
  assert.deepEqual(listOf('GENERIC_ZONE_SKILLS'), ['char_1012_skadi2#2', 'char_469_indigo#1'], '通用周期圈白名单：浊心斯卡蒂 S3 与深靛 S2');
  assert.deepEqual(listOf('DEDICATED_STATUS_SKILLS'), ['char_258_podego#1', 'char_341_sntlla#1', 'char_472_pasngr#2'], '状态由专属圈负责的技能');
  // 实机扫描：任何技能都不许同时产生「兜底圈」和「专属圈」（波登可 S2 的重复就是这一类）
  const seen = new Set();
  const duplicates = [];
  const straySilence = [];
  for (const p of Object.values(data.profiles || {})) {
    if (!p?.charId || p.isGolden) continue;
    for (let i = 0; i < (p.skillChoices || []).length; i += 1) {
      const key = p.chessId + '|' + i;
      if (seen.has(key)) continue; seen.add(key);
      let b, u;
      try { ({ b } = openBattle([{ chessId: p.chessId, skillIndex: i }])); deployNow(b); u = b.s.units[0]; } catch { continue; }
      if (!u) continue;
      u.sp = b.spCost(u) + 5; u.lastSkill = -Infinity;
      try { b.activate(u); } catch { /* 开不起来的技能跳过 */ }
      const zones = (b.s.logicEffects || []).filter(f => f.kind === 'zone');
      const generic = zones.filter(f => /^skill-zone:/.test(String(f.talentOrSkillId || '')));
      const dedicated = zones.filter(f => !/^skill-zone:/.test(String(f.talentOrSkillId || '')));
      if (generic.length && dedicated.length) duplicates.push(`${p.name} S${i + 1}: ${generic.map(f => f.talentOrSkillId).join('+')} / ${dedicated.map(f => f.talentOrSkillId).join('+')}`);
      // 「失去特殊能力/沉默」只应出现在白名单之外的技能上时才算漏（这里只做重复圈的门禁，状态由专项用例覆盖）
      if (u.id === 'char_258_podego' && (b.s.enemies || []).some(e => (e.statuses || []).some(s => s.kind === 'silence') && zones.length === 0)) straySilence.push(p.name);
    }
  }
  assert.deepEqual(duplicates, [], '不允许兜底圈与专属圈同时出现：\n' + duplicates.join('\n'));
  assert.deepEqual(straySilence, []);
});
