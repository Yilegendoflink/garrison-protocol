import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_DATA as data} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {blackboard} from '../dist/protocol.js';
import {applyStatus} from '../dist/status.js';
import {enemy} from './effects-harness.mjs';
import {NO_BOND_BAN} from './no-bond-ban.mjs';

// 谢拉格「范围内敌人进入冻结 → 概率叠层」这一族（原表文本逐条对照）：
//   garrison_28（初雪 char_3_14 / 银灰 char_4_22，初始/精锐同持有）
//     「每当范围内1名敌人进入冻结时，有50%概率使已激活的【谢拉格】层数+1」（精锐 +2）
//   garrison_29（由凛御银灰的 garrison_126「使身前一格【谢拉格】干员获得特质…」转发）
//     「…有60%概率…+1」（精锐 +2；初始版另有每场至多 200 层）
//   garrison_126 只在目标**是谢拉格干员**时发放（check_bond_id），且只给身前一格。
// 触发源：寒风（6 人）与装备「谢拉格不融冰」（攻击时 12%/20% 造成 1.5 秒寒冷）——
// 两次寒冷配对成冻结，才轮到这一族结算。
const ICE = 'chess_item_5_02_e_a';                       // 谢拉格不融冰（初始）
const K = {初雪: 'chess_char_3_14_a', 初雪精锐: 'chess_char_3_14_b', 银灰: 'chess_char_4_22_a',
 耶拉: 'chess_char_3_20_a', 崖心: 'chess_char_2_03_a', 凛御银灰: 'chess_char_5_14_a', 凛御银灰精锐: 'chess_char_5_14_b',
 隐现: 'chess_char_1_01_a'};
// 谢拉格名册按 charId 去重（同一名干员在商店里可能有两个 chessId，别拿它们凑人数）
const kjeragRoster = n => [...new Map(Object.values(data.season.charShopChessDatas)
  .filter(s => s.charId && (data.season.charChessDataDict[s.chessId]?.bondIds || []).includes('kjeragShip'))
  .map(s => [s.charId, s.chessId])).values()].slice(0, n);
const layers = b => b.economy.s.bondLayers.kjeragShip || 0;
const kinds = a => (a.statuses || []).map(s => s.kind);

// 自己搭战场：能指定部署坐标（「身前一格」这类规则必须自己控位置），能给干员预先装备。
function setup(specs, {seed = 1} = {}) {
  const g = new NativeSession(data, {seed, bondBan: NO_BOND_BAN});
  g.s.funds = 9999; g.s.capacity = 16; g.s.rewardPending = null; g.s.rewardQueue = [];
  const units = specs.map(raw => {
    const spec = typeof raw === 'string' ? {chessId: raw} : raw;
    const id = spec.chessId;
    const u = g.gain(id);
    assert.ok(u, '应当能获得 ' + id);
    for (const itemId of spec.equip || []) {
      const item = g.gainItem(itemId);
      assert.equal(g.equip(item.uid, u.uid), true, `${id} 装备 ${itemId} 应当成功`);
    }
    if (spec.at) {
      assert.ok(g.canDeploy(u.uid, spec.at[0], spec.at[1]), `${id} 应当能部署到 ${spec.at}`);
      assert.ok(g.deploy(u.uid, spec.at[0], spec.at[1], spec.dir ?? 0));
    } else {
      let placed = false;
      for (let y = 0; y < g.map.rows && !placed; y += 1) for (let x = 0; x < g.map.cols && !placed; x += 1) {
        if (g.s.units.some(v => v.uid !== u.uid && v.position?.x === x && v.position?.y === y)) continue;
        placed = g.canDeploy(u.uid, x, y) && g.deploy(u.uid, x, y, spec.dir ?? 0);
      }
      assert.ok(placed, id + ' 需要落场');
    }
    return u;
  });
  g.s.rewardPending = null; g.s.rewardQueue = [];
  assert.equal(g.perform('start'), true, g.lastError || '开战失败');
  const b = g.battle; b.s.queue = []; b.s.enemies = []; b.s.limit = 1e9;
  enemy(b, {hp: 1e12, x: -8, y: -8, trainingDummy: true, hidden: true, untargetable: true, invulnerable: true});
  const unitOf = id => b.s.units.find(u => u.chessId === id);
  return {g, b, unitOf, owner: id => unitOf(id)};
}
// 让持有者range内的敌人进入冻结；返回那只敌人
const freezeIn = (b, owner) => {
  const e = enemy(b, {x: owner.x + 1, y: owner.y, hp: 1e6});
  applyStatus(e, 'frozen', 5, {source: 'test', resistible: false});
  return e;
};

test('初雪／银灰：范围内敌人进入冻结时 50% 概率 +1 层（精锐 +2），各自独立结算', () => {
  // 只带初雪一个持有者（耶拉/角峰都没有 garrison_28），先确认刚好 +1。
  const a = setup([K.初雪, K.耶拉, K.崖心]);
  a.b.economy.random = () => 0;                       // 必过 50%
  const before = layers(a.b);
  freezeIn(a.b, a.owner(K.初雪));
  a.b.step();
  assert.equal(layers(a.b), before + 1, '初雪：范围内冻结 → +1 层');
  // 精锐 +2。
  const elite = setup([K.初雪精锐, K.耶拉, K.崖心]);
  elite.b.economy.random = () => 0;
  const beforeElite = layers(elite.b);
  freezeIn(elite.b, elite.owner(K.初雪精锐));
  elite.b.step();
  assert.equal(layers(elite.b), beforeElite + 2, '精锐初雪：+2 层');
  // 初雪和银灰各持有一条 garrison_28 → 同一次冻结按持有者各结算一次（原表没有「同一条只算一次」的限制）。
  const both = setup([K.初雪, K.银灰, K.耶拉]);
  both.b.economy.random = () => 0;
  const beforeBoth = layers(both.b);
  freezeIn(both.b, both.owner(K.初雪));
  both.b.step();
  assert.equal(layers(both.b), beforeBoth + 2, '初雪＋银灰：各 +1');
});

test('初雪／银灰：掷骰失败、范围外、只给寒冷（没冻结）都不叠层', () => {
  const miss = setup([K.初雪, K.耶拉, K.崖心]);
  miss.b.economy.random = () => 0.999;                // 必失败
  const before = layers(miss.b);
  freezeIn(miss.b, miss.owner(K.初雪));
  miss.b.step();
  assert.equal(layers(miss.b), before, '50% 没中就不加层');
  // 范围外：找一格不在持有者攻击范围内的位置。
  const far = setup([K.初雪, K.耶拉, K.崖心]);
  far.b.economy.random = () => 0;
  const owner = far.owner(K.初雪);
  const spot = [[0, 0], [far.b.map.cols - 1, far.b.map.rows - 1], [0, far.b.map.rows - 1], [far.b.map.cols - 1, 0]]
    .find(([x, y]) => !far.b.inside(owner, {x, y}, true));
  const beforeFar = layers(far.b);
  const e = enemy(far.b, {x: spot[0], y: spot[1], hp: 1e6});
  applyStatus(e, 'frozen', 5, {source: 'test', resistible: false});
  far.b.step();
  assert.equal(layers(far.b), beforeFar, '范围外的冻结不触发');
  // 只挂寒冷（还没配对成冻结）不触发：这一族的事件是「进入冻结」。
  const cold = setup([K.初雪, K.耶拉, K.崖心]);
  cold.b.economy.random = () => 0;
  const beforeCold = layers(cold.b);
  const only = enemy(cold.b, {x: cold.owner(K.初雪).x + 1, y: cold.owner(K.初雪).y, hp: 1e6});
  applyStatus(only, 'cold', 5, {source: 'test', resistible: false});
  cold.b.step();
  assert.deepEqual(kinds(only), ['cold']);
  assert.equal(layers(cold.b), beforeCold, '只挂寒冷不叠层（要冻结）');
});

test('凛御银灰：把 garrison_29 转给身前一格的谢拉格干员，非谢拉格干员拿不到', () => {
  // 让凛御银灰朝右，身前一格放初雪。
  const findPair = (g, carrier, target) => {
    for (let y = 0; y < g.map.rows; y += 1) for (let x = 0; x + 1 < g.map.cols; x += 1) {
      if (g.canDeploy(carrier.uid, x, y) && g.canDeploy(target.uid, x + 1, y)) return [x, y];
    }
    return null;
  };
  const kjerag = (() => {
    const g = new NativeSession(data, {seed: 1, bondBan: NO_BOND_BAN});
    g.s.funds = 9999; g.s.capacity = 16; g.s.rewardPending = null; g.s.rewardQueue = [];
    const carrier = g.gain(K.凛御银灰), target = g.gain(K.耶拉);   // 耶拉没有 garrison_28，便于隔离 29
    const at = findPair(g, carrier, target);
    assert.ok(at, '需要一对相邻的可部署格');
    assert.ok(g.deploy(carrier.uid, at[0], at[1], 0));
    assert.ok(g.deploy(target.uid, at[0] + 1, at[1], 0));
    const third = g.gain(K.崖心);                                 // 凑满 3 名谢拉格，盟约才会激活（addLayers 要求已激活）
    let placed = false;
    for (let y = 0; y < g.map.rows && !placed; y += 1) for (let x = 0; x < g.map.cols && !placed; x += 1) {
      if (g.s.units.some(v => v.position?.x === x && v.position?.y === y)) continue;
      placed = g.canDeploy(third.uid, x, y) && g.deploy(third.uid, x, y, 0);
    }
    assert.ok(placed);
    assert.equal(g.perform('start'), true, g.lastError || '开战失败');
    const b = g.battle; b.s.queue = []; b.s.enemies = []; b.s.limit = 1e9;
    enemy(b, {hp: 1e12, x: -8, y: -8, trainingDummy: true, hidden: true, untargetable: true, invulnerable: true});
    return {g, b};
  })();
  const {b} = kjerag;
  const target = b.s.units.find(u => u.chessId === K.耶拉), carrier = b.s.units.find(u => u.chessId === K.凛御银灰);
  assert.deepEqual(carrier.extraGarrisonIds, [], '转发者自己不拿');
  assert.deepEqual(target.extraGarrisonIds, ['garrison_29_a'], '身前一格的谢拉格干员拿到 garrison_29_a');
  // 拿到 29 的耶拉：范围内冻结 → 60% 概率 +1（random=0 必过）
  b.economy.random = () => 0;
  const before = layers(b);
  freezeIn(b, target);
  b.step();
  assert.equal(layers(b), before + 1, '收到的 garrison_29 在冻结时 +1 层');

  // 非谢拉格干员在身前：不发（check_bond_id=kjeragShip）
  const outsider = (() => {
    const g = new NativeSession(data, {seed: 1, bondBan: NO_BOND_BAN});
    g.s.funds = 9999; g.s.capacity = 16; g.s.rewardPending = null; g.s.rewardQueue = [];
    const carrier = g.gain(K.凛御银灰), target = g.gain(K.隐现);
    const at = findPair(g, carrier, target);
    assert.ok(at);
    assert.ok(g.deploy(carrier.uid, at[0], at[1], 0));
    assert.ok(g.deploy(target.uid, at[0] + 1, at[1], 0));
    assert.equal(g.perform('start'), true, g.lastError || '开战失败');
    return g.battle;
  })();
  const fen = outsider.s.units.find(u => u.chessId === K.隐现);
  assert.deepEqual(fen.extraGarrisonIds || [], [], '非谢拉格干员拿不到（check_bond_id 门禁）');
});

test('凛御银灰精锐：转发的是 garrison_29_b（+2），冻结时 +2 层', () => {
  const g = new NativeSession(data, {seed: 1, bondBan: NO_BOND_BAN});
  g.s.funds = 9999; g.s.capacity = 16; g.s.rewardPending = null; g.s.rewardQueue = [];
  const carrier = g.gain(K.凛御银灰精锐), target = g.gain(K.耶拉);
  let at = null;
  for (let y = 0; y < g.map.rows && !at; y += 1) for (let x = 0; x + 1 < g.map.cols && !at; x += 1) if (g.canDeploy(carrier.uid, x, y) && g.canDeploy(target.uid, x + 1, y)) at = [x, y];
  assert.ok(at);
  assert.ok(g.deploy(carrier.uid, at[0], at[1], 0));
  assert.ok(g.deploy(target.uid, at[0] + 1, at[1], 0));
  const third = g.gain(K.崖心);                                   // 盟约要激活才会加层
  let placed = false;
  for (let y = 0; y < g.map.rows && !placed; y += 1) for (let x = 0; x < g.map.cols && !placed; x += 1) {
    if (g.s.units.some(v => v.position?.x === x && v.position?.y === y)) continue;
    placed = g.canDeploy(third.uid, x, y) && g.deploy(third.uid, x, y, 0);
  }
  assert.ok(placed);
  assert.equal(g.perform('start'), true, g.lastError || '开战失败');
  const b = g.battle; b.s.queue = []; b.s.enemies = []; b.s.limit = 1e9;
  enemy(b, {hp: 1e12, x: -8, y: -8, trainingDummy: true, hidden: true, untargetable: true, invulnerable: true});
  const receiver = b.s.units.find(u => u.chessId === K.耶拉);
  assert.deepEqual(receiver.extraGarrisonIds, ['garrison_29_b']);
  b.economy.random = () => 0;
  const before = layers(b);
  freezeIn(b, receiver);
  b.step();
  assert.equal(layers(b), before + 2, '精锐转发的 29_b 是 +2');
});

test('garrison_29_a 的「每场至多 200 层」上限按累计发放量结算', () => {
  const {b, owner} = setup([K.初雪, K.耶拉, K.崖心]);
  const u = owner(K.初雪), g28 = b.profile(u).garrisons.find(x => x.id === 'garrison_28_a');
  assert.ok(g28);
  // 借用同一条 28 的结算入口，把上限与每次发放改成可观测的小值。
  const bb = {...blackboard(g28.blackboard), max_add_count_per_battle: 3, bond_add_count: 2, prob: 1};
  b.economy.random = () => 0;
  const before = layers(b);
  assert.equal(b.applyGarrisonGrant(u, g28, bb, 'status:frozen'), true);
  assert.equal(layers(b), before + 2, '第一次按 bond_add_count 发 2 层');
  assert.equal(b.applyGarrisonGrant(u, g28, bb, 'status:frozen'), true);
  assert.equal(layers(b), before + 3, '第二次只补到上限 3 层');
  assert.equal(b.applyGarrisonGrant(u, g28, bb, 'status:frozen'), false, '到顶后不再发放');
  assert.equal(layers(b), before + 3);
});

test('寒风：时长随当前层数增长（叠层 → 寒风更久，与 garrison_28/29 形成闭环）', () => {
  const six = kjeragRoster(6);   // 6 名不同干员才会起风
  const { b, owner } = setup(six);
  const zone = (b.s.logicEffects || []).find(f => f.talentOrSkillId === 'bond-kjerag-storm');
  assert.ok(zone, '在场 6 名谢拉格时应当生成寒风');
  assert.equal(zone.interval, 25, '寒风每 25 秒一次');
  // 寒风时长 = base_time(20) + time_per_stack(0.1) × 当前层数（每次起风按当时层数重算）
  const expectedCold = () => 20 + 0.1 * (b.layers.kjeragShip || 0);
  b.economy.addLayers('kjeragShip', 50, false);
  const e = enemy(b, { x: owner(K.初雪).x + 1, y: owner(K.初雪).y, hp: 1e6});
  zone.nextAt = b.s.time;                       // 立刻吹一次
  b.step();
  const cold = (e.statuses || []).find(s => s.kind === 'cold' || s.kind === 'frozen');
  assert.ok(cold, '寒风要给敌人挂寒冷');
  const firstDuration = cold.remaining;
  assert.ok(Math.abs(firstDuration - expectedCold()) < 1.5, `寒风时长随层数增长（期望≈${expectedCold().toFixed(1)} 秒，实际 ${firstDuration}）`);
  // 层数再加 50 → 下一次寒风时长再多 5 秒（说明叠层真的在给寒风加时长）
  b.economy.addLayers('kjeragShip', 50, false);
  const e2 = enemy(b, { x: owner(K.初雪).x - 1, y: owner(K.初雪).y, hp: 1e6});
  zone.nextAt = b.s.time;
  b.step();
  const cold2 = (e2.statuses || []).find(s => s.kind === 'cold' || s.kind === 'frozen');
  assert.ok(cold2 && Math.abs(cold2.remaining - expectedCold()) < 1.5, `层数 +50 后时长≈${expectedCold().toFixed(1)} 秒（实际 ${cold2?.remaining}）`);
  assert.ok(cold2.remaining - firstDuration > 3, '第二轮应当明显更长（叠层 → 寒风更久）');
});

test('「范围内」按当前攻击范围算：银灰开真银斩后扩大范围也会跟着扩，没开技就按基础范围', () => {
  const {b, owner} = setup([K.银灰, K.耶拉, K.崖心]);
  const svrash = owner(K.银灰);
  assert.equal(b.profile(svrash).skill.name, '真银斩', '银灰默认带真银斩（3-12 → 3-7）');
  // 找一个「只在技能范围里、不在基础范围里」的格子
  let cell = null;
  for (let y = 0; y < b.map.rows && !cell; y += 1) for (let x = 0; x < b.map.cols && !cell; x += 1) {
    if (b.inside(svrash, {x, y}, true) && !b.inside(svrash, {x, y}, false)) cell = {x, y};
  }
  assert.ok(cell, '真银斩应当比基础范围多出格子');
  const e = enemy(b, {x: cell.x, y: cell.y, hp: 1e6});
  b.economy.random = () => 0;
  // 没开技：这个格子在基础范围外 → 冻结不触发
  const before = layers(b);
  applyStatus(e, 'frozen', 5, {source: 'test', resistible: false});
  b.step();
  assert.equal(layers(b), before, '技能未开时，只在技能范围里的格子不算「范围内」');
  // 开真银斩：范围扩大 → 同一格现在算「范围内」
  e.statuses = e.statuses.filter(s => s.kind !== 'frozen');
  b.step();                                                      // 让「已进入冻结」的记账复位（解冻本身不加层）
  assert.equal(layers(b), before, '解冻不加层');
  svrash.sp = b.spCost(svrash);
  svrash.lastSkill = -Infinity;                                  // 免掉开技后的 3 秒冷却
  b.activate(svrash);
  assert.equal(b.skillActive(svrash), true, '真银斩应当开起来');
  assert.ok(b.inside(svrash, cell, true), '开技后该格在范围内');
  applyStatus(e, 'frozen', 5, {source: 'test', resistible: false});
  b.step();
  assert.equal(layers(b), before + 1, '开技扩范围后，同一格冻结就触发 +1 层');
});

test('闭环：不融冰概率造成寒冷 → 两次配对成冻结 → 触发 garrison_28 叠层', () => {
  // 银灰同时是持有着 garrison_28 的谢拉格干员，也是不融冰的携带者。
  const {b, unitOf} = setup([{chessId: K.银灰, equip: [ICE]}, K.耶拉, K.崖心]);
  const carrier = unitOf(K.银灰);
  const e = enemy(b, {x: carrier.x + 1, y: carrier.y, hp: 1e6});
  b.economy.random = () => 0;                     // 不融冰 12% 与卫戍 50% 都必过
  b.hit(carrier, e, 100, 'physical');             // cause='attack' → onOperatorHit
  assert.deepEqual(kinds(e), ['cold'], '第一次攻击施加寒冷');
  const before = layers(b);
  b.step();
  assert.equal(layers(b), before, '只挂寒冷时还不叠层');
  b.hit(carrier, e, 100, 'physical');             // 第二次寒冷 → 配对成冻结
  assert.ok(kinds(e).includes('frozen'), '两次寒冷配对成冻结');
  b.step();
  assert.equal(layers(b), before + 1, '冻结触发 garrison_28 → +1 层');
});
