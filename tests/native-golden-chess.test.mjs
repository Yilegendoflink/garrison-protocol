import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NativeSession } from '../dist/native-session.js';
import { NATIVE_DATA } from '../dist/runtime-data.js';
import { deployNow } from './effects-harness.mjs';
import {NO_BOND_BAN} from './no-bond-ban.mjs';

// 三合一精锐的养成口径：应取「精英二 + 7 级技能 + 模组」。
// 数据来自固定历史活动表的 charChessDataDict，这里同时校验原始 source.json 与运行时一致。
const SKILL_TABLE = JSON.parse(fs.readFileSync('data/gamedata/allianceLower/skill_table.json', 'utf8'));

test('精锐棋子状态取自原始表且为精英二 + 7 级技能 + 模组', () => {
  const raw = JSON.parse(fs.readFileSync('data/modes/alliance-lower/source.json', 'utf8')).season.charChessDataDict;
  const fields = ['evolvePhase', 'charLevel', 'skillLevel', 'equipLevel', 'favorPoint'];
  let compared = 0, golden = 0;
  const diffs = [];
  for (const [id, rawChess] of Object.entries(raw)) {
    const rt = NATIVE_DATA.season.charChessDataDict[id];
    if (!rt) continue;
    compared++;
    if (rawChess.isGolden) golden++;
    for (const f of fields) {
      if (rawChess.status?.[f] !== rt.status?.[f]) diffs.push({ id, field: f, raw: rawChess.status?.[f], runtime: rt.status?.[f] });
    }
  }
  assert.ok(compared > 200, '应对比全部棋子');
  assert.deepEqual(diffs, [], '运行时状态必须与原始表逐字段一致');
  assert.ok(golden > 100, '精锐样本量应足够');
  for (const chess of Object.values(NATIVE_DATA.season.charChessDataDict)) {
    if (!chess?.isGolden) continue;
    assert.equal(chess.status.evolvePhase, 'PHASE_2', '精锐应为精英二');
    assert.equal(chess.status.skillLevel, 7, '精锐技能等级应为 7');
    assert.ok(chess.status.equipLevel > 0, '精锐应带模组等级');
  }
});

test('精锐的技能数值取自原始表 levels[6]（7 级）', () => {
  let checked = 0;
  const bad = [];
  for (const row of Object.values(NATIVE_DATA.profiles)) {
    if (!row?.isGolden || !row.skillChoices) continue;
    for (const st of row.skillChoices) {
      const def = SKILL_TABLE[st.skillId];
      if (!def?.levels?.length) continue;
      checked++;
      const l6 = def.levels[Math.min(6, def.levels.length - 1)];
      if (l6.duration !== st.skill.duration
        || (l6.spData?.spCost ?? 0) !== (st.skill.spData?.spCost ?? 0)
        || (l6.spData?.initSp ?? 0) !== (st.skill.spData?.initSp ?? 0)) {
        bad.push(`${row.name} ${st.skill.name}`);
      }
    }
  }
  assert.ok(checked > 100, '应覆盖全部精锐技能条目');
  assert.deepEqual(bad, [], '精锐技能应全部取 7 级');
});

test('三合一产出精锐，且上场后按精锐口径解析技能与属性', () => {
  const shop = Object.values(NATIVE_DATA.season.charShopChessDatas)
    .find(s => s.charId === 'char_199_yak' && !NATIVE_DATA.season.charChessDataDict[s.chessId]?.isGolden);
  const normalChessId = shop.chessId;
  const goldenChessId = NATIVE_DATA.season.charChessDataDict[normalChessId].upgradeChessId;
  assert.ok(goldenChessId, '初始棋子应有精锐升级目标');

  const g = new NativeSession(NATIVE_DATA, {bondBan:NO_BOND_BAN, seed: 1 });
  g.s.funds = 9999; g.s.capacity = 16; g.s.rewardPending = null; g.s.rewardQueue = [];
  g.gain(normalChessId); g.gain(normalChessId);
  const merged = g.gain(normalChessId);
  assert.equal(merged.chessId, goldenChessId, '第三次获得应合成精锐');
  assert.ok(g.s.rewardPending, '三合一应给出免费高阶干员奖励');

  // 开战前需处理待选奖励（与产品流程一致）
  g.s.rewardPending = null; g.s.rewardQueue = [];
  const u = g.s.units.find(x => x.chessId === goldenChessId);
  let placed = false;
  for (let y = 0; y < g.map.rows && !placed; y++) {
    for (let x = 0; x < g.map.cols && !placed; x++) placed = g.canDeploy(u.uid, x, y) && g.deploy(u.uid, x, y, 0);
  }
  assert.ok(placed, '精锐应可上场');
  assert.equal(g.perform('start'), true, g.lastError || 'start failed');
  const b = g.battle; b.s.queue = []; b.s.limit = 1e9; deployNow(b);

  const live = b.s.units.find(x => x.id === 'char_199_yak');
  assert.equal(live.chessId, goldenChessId, '场上单位应为精锐');
  const p = b.profile(live);
  const status = NATIVE_DATA.season.charChessDataDict[goldenChessId].status;
  assert.equal(status.evolvePhase, 'PHASE_2');
  assert.equal(status.skillLevel, 7);
  assert.ok(p.modulePhase, '精锐应解析出模组');

  const chosen = p.skillChoices[p.skillIndex ?? live.source?.skillIndex ?? 0];
  const l6 = SKILL_TABLE[chosen.skillId].levels[6];
  assert.equal(p.skill.duration, l6.duration, '技能时长应为 7 级');
  assert.equal(p.skill.spData.spCost, l6.spData.spCost, '消耗应为 7 级');
  assert.equal(p.skill.spData.initSp, l6.spData.initSp, '初始技力应为 7 级');
  const normal = Object.values(NATIVE_DATA.profiles).find(r => r.chessId === normalChessId);
  assert.ok(p.attributes.maxHp > normal.attributes.maxHp, '精锐生命上限应更高');
  assert.ok(p.attributes.atk > normal.attributes.atk, '精锐攻击应更高');
});
