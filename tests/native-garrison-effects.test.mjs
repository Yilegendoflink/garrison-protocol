// 卫戍效果（干员特质）定向测试。
// 口径见 GARRISON_EFFECT_AUDIT.md；用户 2026-09-19 确认：
//   多盟约「每叠加 N 层」= 每个盟约分别 ⌊层数/N⌋ 后相加；「核心盟约」= 8 个核心盟约的层数合计；
//   bond_self = 每个已激活盟约各 +N；「层数最多的盟约」只取已激活、并列随机；击倒计数不含我方干员；
//   「每场作战至多 N 层」按每波重置；送特质时 check_bond_id 不匹配就不发。
import test from 'node:test';import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';import {NATIVE_DATA} from '../dist/runtime-data.js';
import {garrisonText} from '../dist/protocol.js';
import {openBattle,deployNow,enemy,byId} from './effects-harness.mjs';
import {dispatch} from '../dist/native-effects.js';
import {applyStatus} from '../dist/status.js';

const s = NATIVE_DATA.season;
// 把全部非 noStack 盟约按「已激活」上报，避免测试里为了激活盟约去摆一堆干员。
function activeBonds(g){
 const real = g.bonds.bind(g);
 return () => Object.fromEntries(Object.entries(real()).map(([id, row]) => [id, {...row, active: row.active || !s.bondInfoDict[id].noStack}]));
}
function prep(chessId, {layers = 0, round = 3} = {}){
 const g = new NativeSession(NATIVE_DATA, {seed: 7});
 g.s.funds = 999; g.s.rewardPending = null; g.s.rewardQueue = [];
 const u = g.gain(chessId);
 g.s.rewardPending = null; g.s.rewardQueue = [];
 g.s.round = round;
 u.position = {x: 3, y: 3};
 const saved = g.bonds.bind(g); g.bonds = activeBonds({bonds: saved});
 if (layers) for (const id of Object.keys(g.bonds())) g.addLayers(id, layers, false);
 return {g, u};
}
// 按干员名找可见卡（避免在测试里硬写 chessId）
function cardOf(name, suffix = '_a'){
 const shop = Object.values(s.charShopChessDatas).find(o => !o.isHidden && o.chessId.endsWith(suffix) && NATIVE_DATA.profiles[o.chessId]?.name === name);
 assert.ok(shop, `找不到 ${name}${suffix}`);
 return shop.chessId;
}

test('阿罗玛/安洁莉娜的「每回合至多 N 层」按本回合累计上限封顶', () => {
 const {g, u} = prep('chess_char_4_10_a');
 g.s.roundRefreshCount = 10;                       // 本回合刷新 10 次
 const before = g.s.bondLayers.siracusaShip || 0;
 g.triggerGarrisons('SERVER_PREP_FIN', u);
 assert.equal((g.s.bondLayers.siracusaShip || 0) - before, 6, '精锐前的上限是 6 层');
 // 同回合重复触发（白面鸮那类复制）不再发第二份
 g.triggerGarrisons('SERVER_PREP_FIN', u);
 assert.equal((g.s.bondLayers.siracusaShip || 0) - before, 6, '同一回合重复触发不再超过上限');
 // 下一回合重置
 g.s.roundRefreshCount = 10; g.s.refreshLayerClaimed = {};
 g.triggerGarrisons('SERVER_PREP_FIN', u);
 assert.equal((g.s.bondLayers.siracusaShip || 0) - before, 12, '新回合重新给一份（累计 12）');
});

test('阿罗玛精锐档的上限是每回合 12 层', () => {
 const {g, u} = prep('chess_char_4_10_b');
 g.s.roundRefreshCount = 10;
 const before = g.s.bondLayers.siracusaShip || 0;
 g.triggerGarrisons('SERVER_PREP_FIN', u);
 assert.equal((g.s.bondLayers.siracusaShip || 0) - before, 12);
});

test('松果的特殊招募池在 NAMED_POOLS 显式建表（阶级取池而不是靠池名正则）', () => {
 for (const [chessId, tier] of [['chess_char_3_10_a', 1], ['chess_char_3_10_b', 5]]) {
  const {g, u} = prep(chessId);
  g.s.rewardPending = null;
  g.triggerGarrisons('SERVER_CHESS_SOLD', u);
  const reward = g.s.rewardPending;
  assert.ok(reward, chessId + ' 售出后应给出奖励候选');
  assert.equal(reward.choices ?? reward.choice, 1, '三选一');
  assert.equal(reward.offers.length, 3);
  for (const offer of reward.offers) {
   const card = s.charShopChessDatas[offer];
   assert.equal(card.chessLevel, tier, `${offer} 应是 ${tier} 阶`);
  }
 }
});

test('余的「人数最多盟约」不再排除自身', () => {
 const {g, u} = prep(cardOf('余'));
 // 她的可见卡带「同一行有 3 名干员」条件，补两名同排干员满足它
 for (let i = 0; i < 2; i++) g.s.units.push({uid: 9000 + i, chessId: 'chess_char_1_01_a', charId: 'filler' + i, position: {x: 4 + i, y: 3}, dir: 0, equipment: []});
 const real = g.bonds.bind(g);
 g.bonds = () => { const rows = real(); for (const id of Object.keys(rows)) { rows[id].active = !s.bondInfoDict[id].noStack; rows[id].count = id === 'siracusaShip' ? 3 : 1; } return rows; };
 let request = null;
 g.draw = req => { request = req; return u.chessId; };
 g.triggerGarrisons('SERVER_PREP_START', u);
 assert.ok(request, '应发起一次抽卡请求');
 assert.equal('excludeCharId' in request, false, '描述里没有「自身除外」，请求里也不该带');
 assert.equal(request.bond, 'siracusaShip', '从人数最多的盟约里抽');
});

// ── 作战能力（IN_BATTLE）─────────────────────────────────────────────────────
function battleOf(...chessIds){
 const {b} = openBattle(chessIds.map(chessId => ({chessId})));
 deployNow(b);
 patchActive(b);
 return b;
}
function patchActive(b){
 const real = b.economy.bonds.bind(b.economy);
 b.economy.bonds = () => { const rows = real(); for (const id of Object.keys(rows)) if (!s.bondInfoDict[id].noStack) rows[id] = {...rows[id], active: true}; return rows; };
}
const unitOf = (b, chessId) => b.s.units.find(u => u.chessId === chessId);
const garrisonParts = (b, u) => (b.stats(u).parts || []).filter(p => p.src === '卫戍');
const sumParts = (b, u, stat) => garrisonParts(b, u).filter(p => p.stat === stat).reduce((n, p) => n + (Number(p.v) || 0), 0);

test('attrByBond：攻击力/生命值/防御力/回血/技力 都按每个盟约分别取整后相加', () => {
 // 水月【阿戈尔】每 3 层攻击力 +1%
 let b = battleOf(cardOf('水月')), u = unitOf(b, cardOf('水月'));
 b.layers.egirShip = 30;
 assert.ok(Math.abs(sumParts(b, u, 'atk') - 0.1) < 1e-9, `30/3=10 层 → +10%，实际 ${sumParts(b, u, 'atk')}`);
 b.layers.egirShip = 32;   // 不是 3 的倍数：向下取整
 assert.ok(Math.abs(sumParts(b, u, 'atk') - 0.1) < 1e-9, '32 层仍是 10 层');

 // 泡泡【萨尔贡】【坚守】每 3 层防御力 +1%：两个盟约分别取整后相加
 b = battleOf(cardOf('泡泡')); u = unitOf(b, cardOf('泡泡'));
 b.layers.sargonShip = 9; b.layers.steadShip = 4;   // 3 + 1 = 4 层
 assert.ok(Math.abs(sumParts(b, u, 'def') - 0.04) < 1e-9, `期望 +4%，实际 ${sumParts(b, u, 'def')}`);

 // 浊心斯卡蒂【阿戈尔】每 10 层：每秒回 50 生命、技力回复 +0.15/秒
 b = battleOf(cardOf('浊心斯卡蒂')); u = unitOf(b, cardOf('浊心斯卡蒂'));
 b.layers.egirShip = 25;
 const stats = b.stats(u);
 assert.ok(stats.hpRecoveryPerSec >= 100, `回血应至少 +100/秒，实际 ${stats.hpRecoveryPerSec}`);
 assert.ok(Math.abs(sumParts(b, u, 'spRecoveryPerSec') - 0.3) < 1e-9, '技力回复 +0.3/秒');
});

test('attrByBond：「核心盟约」= 8 个核心盟约的层数合计（与自身所属盟约无关）', () => {
 const b = battleOf(cardOf('隐德来希')), u = unitOf(b, cardOf('隐德来希'));
 const bb = s.garrisonDataDict.garrison_10_a.blackboard.reduce((o, x) => ({...o, [x.key]: x.valueStr ?? x.value}), {});
 const bonds = String(bb.bond_id).split(',');
 assert.equal(bonds.length, 8, '核心盟约列表应为 8 项');
 for (const id of bonds) b.layers[id] = 9;      // 每个 3 层 → 8×3 = 24 层
 b.layers.indomShip = 0; b.layers.swiftShip = 0;   // 她自己的盟约（不屈/灵巧）不计入「核心盟约」
 assert.ok(Math.abs(sumParts(b, u, 'atk') - 0.24) < 1e-9, `期望 +24%，实际 ${sumParts(b, u, 'atk')}`);
});

test('attack_enemy：攻击带 check_tag 的敌人时才算「提升至」倍率', () => {
 const b = battleOf(cardOf('深巡')), u = unitOf(b, cardOf('深巡'));
 const sea = enemy(b, {x: 1, y: 1, hp: 1e6, enemyTags: ['seamonster']});
 const plain = enemy(b, {x: 2, y: 1, hp: 1e6, enemyTags: ['animated']});
 assert.equal(b.garrisonDamageScale(u, sea), 1.5);
 assert.equal(b.garrisonDamageScale(u, plain), 1);
});

test('ab_damageScaleByBond：打束缚/停顿目标时按盟约层数增伤', () => {
 const b = battleOf(cardOf('仇白')), u = unitOf(b, cardOf('仇白'));
 b.layers.yanShip = 9; b.layers.raidShip = 6;    // ⌊9/3⌋+⌊6/3⌋ = 5 → +5%
 const rooted = enemy(b, {x: 1, y: 1, hp: 1e6, statuses: [{kind: 'root', remaining: 5, source: 1, value: 1}]});
 const sluggish = enemy(b, {x: 2, y: 1, hp: 1e6, statuses: [{kind: 'sluggish', remaining: 5, source: 1, value: 1}]});
 const healthy = enemy(b, {x: 3, y: 1, hp: 1e6});
 assert.ok(Math.abs(b.garrisonDamageScale(u, rooted) - 1.05) < 1e-9);
 assert.ok(Math.abs(b.garrisonDamageScale(u, sluggish) - 1.05) < 1e-9);
 assert.equal(b.garrisonDamageScale(u, healthy), 1);
});

test('bond_actived_maxstack + by_charcount_samerow：只给层数最多的已激活盟约，并按同行人数翻倍', () => {
 const b = battleOf(cardOf('塑心')), u = unitOf(b, cardOf('塑心'));
 b.layers.siracusaShip = 30; b.layers.preciShip = 5;
 const before = {...b.layers};
 b.event(u, 'skill');
 assert.equal((b.layers.siracusaShip || 0) - (before.siracusaShip || 0), 1, '同行 1 人 → +1');
 assert.equal(b.layers.preciShip || 0, before.preciShip || 0, '不是层数最多的盟约不加');
 // 同行再站两名干员 → 一次开技 +3
 const extra = [enemy, enemy];
 for (let i = 0; i < 2; i++) b.s.units.push({uid: 9100 + i, kind: 'summon', chessId: 'x', id: 'x', x: u.x + 1 + i, y: u.y, deployed: true, hp: 100, maxHp: 100, statuses: [], equipment: [], source: {position: {x: u.x + 1 + i, y: u.y}}});
 const mid = b.layers.siracusaShip || 0;
 b.event(u, 'skill');
 assert.equal((b.layers.siracusaShip || 0) - mid, 3, '同行 3 人 → +3');
});

test('bond_self：每个已激活盟约各 +N，且按每波封顶', () => {
 const b = battleOf(cardOf('瑕光')), u = unitOf(b, cardOf('瑕光'));
 // 真实部署时已经触发过一次（部署本身就算一次「部署时」），先清掉计数箱从零开始量
 b.garrisonCounters.clear();
 const before = {k: b.layers.kazimierzShip || 0, r: b.layers.raidShip || 0};
 b.event(u, 'deploy');
 assert.equal((b.layers.kazimierzShip || 0) - before.k, 4);
 assert.equal((b.layers.raidShip || 0) - before.r, 4, '每个已激活盟约各 +4');
 for (let i = 0; i < 4; i++) b.event(u, 'deploy');
 assert.equal((b.layers.kazimierzShip || 0) - before.k, 12, '每场作战至多 12 层');
});

test('「每场作战至多 N 层」按每波重置，而不是整局累计', () => {
 const first = battleOf(cardOf('史尔特尔')), u1 = unitOf(first, cardOf('史尔特尔'));
 first.garrisonCounters.clear();                    // 同上：把真实部署那一次清掉
 const base1 = first.layers.raidShip || 0;
 for (let i = 0; i < 10; i++) first.event(u1, 'deploy');
 assert.equal((first.layers.raidShip || 0) - base1, 50, '一场战斗内到 50 层封顶');
 assert.equal(u1.counters === undefined || Object.keys(u1.counters).length === 0, true, '计数箱挂在 battle 上，不留在干员身上');
 const second = battleOf(cardOf('史尔特尔')), u2 = unitOf(second, cardOf('史尔特尔'));
 second.garrisonCounters.clear();
 const base2 = second.layers.raidShip || 0;
 for (let i = 0; i < 3; i++) second.event(u2, 'deploy');
 assert.equal((second.layers.raidShip || 0) - base2, 24, '新一波重新从 0 开始计');
});

test('战斗内 conditionkey：同一行人数不够就不加层', () => {
 const b = battleOf(cardOf('蕾缪安')), u = unitOf(b, cardOf('蕾缪安'));
 const before = b.layers.lateranoShip || 0;
 for (let i = 0; i < 10; i++) b.event(u, 'ammo');       // consume_count=10
 assert.equal(b.layers.lateranoShip || 0, before, '同一行只有她自己 → 不满足 3 人');
 for (let i = 0; i < 2; i++) b.s.units.push({uid: 9200 + i, kind: 'summon', chessId: 'x', id: 'x', x: u.x + 1 + i, y: u.y, deployed: true, hp: 100, maxHp: 100, statuses: [], equipment: [], source: {position: {x: u.x + 1 + i, y: u.y}}});
 for (let i = 0; i < 10; i++) b.event(u, 'ammo');
 assert.equal((b.layers.lateranoShip || 0) - before, 2, '同行 3 人后 +2');
});

test('弹药事件按 range_id 分发：周围 4 格的干员消耗弹药也算（莫斯提马）', () => {
 const b = battleOf(cardOf('莫斯提马'), cardOf('史尔特尔'));
 const mo = unitOf(b, cardOf('莫斯提马')), ally = unitOf(b, cardOf('史尔特尔'));
 mo.x = 3; mo.y = 3; mo.dir = 0; ally.x = 4; ally.y = 3;
 const before = b.layers.lateranoShip || 0;
 b.garrisonAmmoEvent(ally, 6);
 assert.equal((b.layers.lateranoShip || 0) - before, 1, '相邻的友方消耗 6 发 → +1');
 ally.x = 7;
 b.garrisonAmmoEvent(ally, 6);
 assert.equal((b.layers.lateranoShip || 0) - before, 1, '离远了不算');
});

test('魔王：身前一格的干员因特质叠层时额外多拿层数', () => {
 const b = battleOf(cardOf('魔王'), cardOf('史尔特尔'));
 const mg = unitOf(b, cardOf('魔王')), ally = unitOf(b, cardOf('史尔特尔'));
 mg.x = 3; mg.y = 3; mg.dir = 0; ally.x = 4; ally.y = 3;
 const before = b.layers.raidShip || 0;
 b.event(ally, 'deploy');                                  // 史尔特尔：部署时【突袭】+8
 assert.equal((b.layers.raidShip || 0) - before, 9, '8 + 魔王给的前置一格 1');
});

test('冻结触发：范围内敌人进入冻结时按概率加【谢拉格】层数（初雪）', () => {
 const b = battleOf(cardOf('初雪'));
 const u = unitOf(b, cardOf('初雪'));
 u.x = 3; u.y = 3; u.dir = 0;
 b.economy.random = () => 0;                               // prob=0.5，必定命中
 b.step();                                                 // 先跑一帧建立「已见过的状态」快照
 const before = b.layers.kjeragShip || 0;
 const foe = enemy(b, {x: 4, y: 3, hp: 1e6});
 applyStatus(foe, 'frozen', 5, {source: u.uid, resistible: false});
 b.step();
 assert.equal((b.layers.kjeragShip || 0) - before, 1);
});

test('沉睡/晕眩触发：范围内敌人或干员进入沉睡或晕眩时加【萨尔贡】【精准】（缇缇）', () => {
 const b = battleOf(cardOf('缇缇'));
 const u = unitOf(b, cardOf('缇缇'));
 u.x = 3; u.y = 3; u.dir = 0;
 b.step();
 const beforeS = b.layers.sargonShip || 0, beforeP = b.layers.preciShip || 0;
 const foe = enemy(b, {x: 4, y: 3, hp: 1e6});
 applyStatus(foe, 'stun', 2, {source: u.uid, resistible: false});
 b.step();
 assert.equal((b.layers.sargonShip || 0) - beforeS, 1);
 assert.equal((b.layers.preciShip || 0) - beforeP, 1);
});

test('送特质：check_bond_id 不匹配就不发（凛御银灰），匹配才发', () => {
 const silver = cardOf('凛御银灰'), other = cardOf('史尔特尔'), kjerag = cardOf('银灰');
 const b = battleOf(silver, other, kjerag);
 const owner = unitOf(b, silver), wrong = unitOf(b, other), right = unitOf(b, kjerag);
 owner.x = 3; owner.y = 3; owner.dir = 0;
 wrong.x = 3; wrong.y = 4; right.x = 3; right.y = 5;      // 先都不在身前一格
 b.s.bondApplied = false; dispatch(b, 'battle-start', {});
 assert.equal(wrong.extraGarrisonIds?.length || 0, 0);
 // 把非谢拉格干员放到身前一格
 wrong.x = 4; wrong.y = 3; right.x = 3; right.y = 5;
 b.s.bondApplied = false; dispatch(b, 'battle-start', {});
 assert.equal(wrong.extraGarrisonIds?.includes('garrison_29_a') || false, false, '非【谢拉格】不发');
 // 换成谢拉格干员
 wrong.x = 3; wrong.y = 5; right.x = 4; right.y = 3;
 b.s.bondApplied = false; dispatch(b, 'battle-start', {});
 assert.equal(right.extraGarrisonIds?.includes('garrison_29_a') || false, true, '【谢拉格】发');
 assert.equal(wrong.extraGarrisonIds?.length || 0, 0, '每波重新结算，上一波的授予要清掉');
});

test('送特质：give_garrison_to_all 只发给对应盟约的干员（荒芜拉普兰德 精锐）', () => {
 const golden = cardOf('荒芜拉普兰德').replace(/_a$/, '_b');
 assert.ok(s.charChessDataDict[golden], '需要精锐卡数据');
 const siracusa = cardOf('拉普兰德'), other = cardOf('史尔特尔');
 const b = battleOf(golden, siracusa, other);
 const owner = unitOf(b, golden), mate = unitOf(b, siracusa), outsider = unitOf(b, other);
 b.s.bondApplied = false; dispatch(b, 'battle-start', {});
 assert.equal(mate.extraGarrisonIds?.includes('garrison_117_b') || false, true, '【叙拉古】干员应拿到');
 assert.equal(outsider.extraGarrisonIds?.includes('garrison_117_b') || false, false, '非【叙拉古】不发');
 assert.equal(owner.extraGarrisonIds?.includes('garrison_117_b') || false, false, '自己不发给自己');
});

test('耀骑士临光：自己已经持有的特质不会再被「送给自己」叠一次', () => {
 const chessId = cardOf('耀骑士临光');
 const b = battleOf(chessId), u = unitOf(b, chessId);
 u.x = 3; u.y = 3; u.dir = 0;
 b.s.bondApplied = false; dispatch(b, 'battle-start', {});
 assert.equal((u.extraGarrisonIds || []).includes('garrison_144_a'), false);
 assert.equal((u.extraGarrisonIds || []).includes('garrison_159_a'), false);
 b.layers.kazimierzShip = 9;                          // ⌊9/3⌋=3 → 再部署 ×(1-0.045)
 const mul = sumParts(b, u, 'respawnTime');
 assert.ok(Math.abs(mul - 0.955) < 1e-9, `只算一次，期望 0.955，实际 ${mul}`);
});

// 文本门禁：每条卫戍效果的显示文本都必须以【时机】开头（口径见 GARRISON_EFFECT_AUDIT.md §一）。
test('每条卫戍效果的显示文本都带【触发时机】前缀', () => {
 const cases = [
  ['角峰', '获得时'], ['波登可', '休整期结束时'], ['歌蕾蒂娅', '进入休整期时'],
  ['拉普兰德', '刷新时'], ['德克萨斯', '售出时'], ['至简', '购买时'],
  ['水月', '战斗中'], ['瑕光', '部署时'], ['史尔特尔', '部署时'],
  ['寒芒克洛丝', '战斗开始时'], ['远牙', '战斗开始时'], ['荒芜拉普兰德', '战斗中'],
 ];
 // 精锐档的荒芜拉普兰德换成「战斗开始时给所有【叙拉古】干员特质」那条
 const goldenWolf = cardOf('荒芜拉普兰德').replace(/_a$/, '_b');
 assert.ok(garrisonText(s.garrisonDataDict[s.charChessDataDict[goldenWolf].garrisonIds[0]]).startsWith('【战斗开始时】'), '精锐档应是【战斗开始时】');
 for (const [name, when] of cases) {
  const chessId = cardOf(name);
  const rules = (s.charChessDataDict[chessId].garrisonIds || []).map(id => s.garrisonDataDict[id]);
  assert.ok(rules.length, name + ' 应有卫戍效果');
  for (const rule of rules) assert.ok(garrisonText(rule).startsWith(`【${when}】`), `${name} → ${garrisonText(rule)}`);
 }
 // 全量：可见干员的每条卫戍都拿得到时机，且文本里不残留富文本标签
 let seen = 0;
 for (const shop of Object.values(s.charShopChessDatas)) {
  if (shop.isHidden) continue;
  for (const gid of s.charChessDataDict[shop.chessId].garrisonIds || []) {
   const text = garrisonText(s.garrisonDataDict[gid]);
   assert.match(text, /^【[^】]+】/, gid + ' 缺少时机前缀：' + text);
   assert.equal(/[<>]/.test(text), false, gid + ' 文本里还留着富文本标签');
   seen++;
  }
 }
 assert.ok(seen >= 120, '可见干员的卫戍条目应有 120 条以上，实际 ' + seen);
});

// 门禁：原表出现过的每个作战能力键，要么有实现，要么在本表里显式登记「未实现」，
// 避免以后新增一条卫戍时静默失效（审计见 GARRISON_EFFECT_AUDIT.md）。
test('作战能力的每个 blackboard.key 都有实现或显式登记为未实现', () => {
 const IMPLEMENTED = new Set([
  '',                                                    // 无 key：char_attribute_mul / effectType NONE 之类
  'attr_common_global_buff',                             // stats()：技力自然恢复（古米）
  'act1autochess_gar_eff_attrByBond',                    // stats()：每 N 层攻/血/防/攻速/回血（多盟约求和）
  'act1autochess_gar_eff_respawnTimeByBond',             // stats()：每 N 层再部署时间
  'act1autochess_gar_eff_chaos',                         // hit()：弱点伤害（宴/流星/伺夜）
  'act1autochess_gar_eff_attack_enemy',                  // hit()：check_tag 特攻（深巡/跃跃）
  'act2autochess_gar_eff_attrByBond_add_onstart',        // native-effects：玛恩纳部署卫戍
  'act2autochess_gar_eff_ab_damageScaleByBond',          // hit()：打束缚/停顿增伤（仇白）
  'act1autochess_gar_event_selfkillenemy',               // event('kill')
  'act1autochess_gar_event_selfdead',                    // event('selfdead')
  'act1autochess_gar_event_useskill',                    // event('skill')
  'act2autochess_gar_event_onstart',                     // event('deploy')
  'act1autochess_gar_event_consume_ammo',                // event('ammo') + range_id 分发
  'act1autochess_gar_event_enemy_abflag_inrange',        // 敌人进入冻结
  'act2autochess_gar_event_allyenemy_sleepstun_inrange', // 沉睡/晕眩
  'act1autochess_gar_event_addition_cnt',                // 魔王：身前一格特质叠层追加
 ]);
 const PENDING = {
  act1autochess_gar_event_recoverhp_enemy_abflag_inrange: '冻结时回血（garrison_27，本期没有可见干员引用，留档）',
 };
 const unknown = [];
 for (const g of Object.values(s.garrisonDataDict)) {
  if (g.eventType !== 'IN_BATTLE') continue;
  const key = (g.blackboard || []).find(x => x.key === 'key')?.valueStr || '';
  if (IMPLEMENTED.has(key) || PENDING[key]) continue;
  unknown.push(g.garrisonKey || g.garrisonId || key);
 }
 assert.deepEqual(unknown, [], '出现未登记的作战能力键');
 // 登记为未实现的那条必须真的还在数据里，避免登记表过期
 assert.ok(Object.values(s.garrisonDataDict).some(g => (g.blackboard || []).some(x => x.key === 'key' && PENDING[x.valueStr])));
});
