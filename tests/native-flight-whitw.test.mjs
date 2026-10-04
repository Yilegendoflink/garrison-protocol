import test from 'node:test';
import assert from 'node:assert/strict';
import { openBattle, deployNow, byId, enemy } from './effects-harness.mjs';
import { NATIVE_DATA } from '../dist/runtime-data.js';

const chessOf = charName => Object.values(NATIVE_DATA.profiles).find(r => r.name === charName && !r.isGolden && r.skillChoices?.length)?.chessId;

function whitwBattle(skillIndex = 2) {
 const chessId = chessOf('荒芜拉普兰德');
 const { b } = openBattle({ chessId, skillIndex });
 deployNow(b);
 const u = byId(b, 'char_1038_whitw2');
 assert.ok(u, '应有荒芜拉普兰德');
 return { b, u };
}
const advance = (b, seconds) => { for (let i = 0; i < Math.round(seconds * 30); i++) b.step(); };
const eyesOf = b => b.s.whitwEyes || [];

test('开启三技能后生成自由飞行的浮游单元实体（非格子吸附）', () => {
 const { b, u } = whitwBattle(2);
 const sk = b.profile(u).skill;
 assert.equal(sk.name, '终幕·浩劫');
 assert.equal(sk.duration, 40);
 u.sp = b.spCost(u);
 b.activate(u);
 b.step();
 const eyes = eyesOf(b);
 assert.equal(eyes.length, 2, 'attack@cnt=2 应生成 2 只');
 assert.equal(u.whitwFloaters.length, 0, 'S3 的特殊狼头不应复用 S1/S2 普通浮游单元状态');
 assert.ok(eyes.every(e => e.ownerUid === u.uid));
 // 生成位置在本体附近（该帧已推进，容差放宽），且是连续坐标
 assert.ok(eyes.every(e => Math.hypot(e.x - u.x, e.y - u.y) < 0.05), '初始应在本体附近');
 assert.ok(eyes.every(e => e.travel?.phase === 'scatter'), '应先进入散开阶段');
});

test('S1 使用普通浮游单元全场索敌静止敌人，不生成 S3 狼头', () => {
 const { b, u } = whitwBattle(0);
 const farSpot = [];
 for (let y = 0; y < b.map.rows; y++) for (let x = 0; x < b.map.cols; x++) {
  if (Math.hypot(x - u.x, y - u.y) >= 5 && !b.inside(u, { x, y }, true)) farSpot.push({ x, y });
 }
 assert.ok(farSpot.length, '地图应有常态攻击范围外的敌人位置');
 const stationary = enemy(b, { ...farSpot[0], hp: 1e9, speed: 0 });
 const moving = enemy(b, { x: u.x + 1, y: u.y, hp: 1e9, speed: 1 });
 moving.route = [{ kind: 'move', x: moving.x + 20, y: moving.y }, { kind: 'wait', x: moving.x + 20, y: moving.y, time: 600 }];
 moving.cmd = 0;
 moving.cmdLeft = null;
 u.attackCooldown = 99999; // 隔离主人自身的普通攻击，确认伤害来自浮游单元。
 u.sp = b.spCost(u);
 b.activate(u);
 advance(b, 5);
 assert.equal(eyesOf(b).length, 0, 'S1 不应创建 S3 自由飞行狼头');
 assert.equal(u.whitwFloaters.length, 1, 'S1 应有 1 枚普通浮游单元');
 assert.equal(u.whitwFloaters[0].targetUid, stationary.uid, '应索敌全场内不移动的敌人');
 assert.ok(stationary.hp < 1e9, '范围外的静止敌人应受到普通浮游单元法术伤害');
 assert.equal(moving.hp, 1e9, 'S1 浮游单元不应锁定移动敌人');
});

test('S2 三枚普通浮游单元各自索敌，10% 概率恐惧，不触发 S3 光环', () => {
 const { b, u } = whitwBattle(1);
 const spots = [];
 for (let y = 0; y < b.map.rows; y++) for (let x = 0; x < b.map.cols; x++) {
  if (b.inside(u, { x, y }, true) && Math.hypot(x - u.x, y - u.y) > 0.5) spots.push({ x, y });
 }
 assert.ok(spots.length >= 3, 'S2 技能范围应包含至少三个目标位置');
 spots.slice(0, 3).forEach(pos => enemy(b, { ...pos, hp: 1e9 }));
 u.attackCooldown = 99999;
 u.sp = b.spCost(u);
 b.activate(u);
 const inRange = b.targets(u);
 const count = inRange.length;
 assert.ok(count >= 3);
 const expectedTargets = inRange.slice(0, 3).map(e => e.uid);
 const rolls = [0, 1, 2].map(i => (i + 0.1) / count);
 let rollIndex = 0;
 b.economy.random = () => rolls[rollIndex++] ?? 0;
 b.step();
 advance(b, 3);
 assert.equal(eyesOf(b).length, 0, 'S2 不应创建 S3 自由飞行狼头');
 assert.equal(u.whitwFloaters.length, 3, 'S2 应有 3 枚普通浮游单元');
 assert.deepEqual(u.whitwFloaters.map(f => f.targetUid), expectedTargets, '三枚单元应分别锁定目标');
 const targets = expectedTargets.map(uid => b.s.enemies.find(e => e.uid === uid));
 assert.ok(targets.every(e => e.hp < 1e9), '普通浮游单元应各自造成法术伤害');
 assert.ok(targets.every(e => e.statuses?.some(s => s.kind === 'fear')), '固定随机值 0 应触发 10% 恐惧');
 assert.ok(targets.every(e => !e.statuses?.some(s => s.kind === 'sluggish')), 'S2 不应套用 S3 的周围减速光环');
});

test('叙拉古盟约真伤可由荒芜拉普兰德 S1/S2 普通浮游单元触发', () => {
 const profiles = Object.values(NATIVE_DATA.profiles).filter(p => p?.charId && p.bonds?.includes('siracusaShip') && !p.isGolden);
 const unique = [];
 for (const profile of profiles) if (!unique.some(row => row.charId === profile.charId)) unique.push(profile);
 const lappland = unique.find(row => row.charId === 'char_1038_whitw2');
 assert.ok(lappland, '荒芜拉普兰德应属于叙拉古');
 const teammates = unique.filter(row => row.charId !== lappland.charId).slice(0, 5);
 assert.equal(teammates.length, 5, '叙拉古盟约需要六名不同干员');

 for (const skillIndex of [0, 1]) {
  const roster = [{ chessId: lappland.chessId, skillIndex }, ...teammates.map(row => row.chessId)];
  const { b } = openBattle(roster);
  deployNow(b);
  const u = byId(b, 'char_1038_whitw2');
  assert.equal(b.rows.siracusaShip.count, 6);
  assert.equal(b.owns(u, 'siracusaShip'), true);
  const spot = (() => {
   for (let y = 0; y < b.map.rows; y++) for (let x = 0; x < b.map.cols; x++) {
    const valid = skillIndex === 0 ? Math.hypot(x - u.x, y - u.y) >= 5 : b.inside(u, { x, y }, true) && Math.hypot(x - u.x, y - u.y) > .5;
    if (valid && !b.map.grid[y]?.[x]?.obstacle) return { x, y };
   }
   return null;
  })();
  assert.ok(spot, `S${skillIndex + 1} 应有浮游单元可攻击的位置`);
  const target = enemy(b, { ...spot, hp: 1e9, atk: 0, def: 0, res: 0 });
  for (const ally of b.s.units) if (ally !== u) ally.attackCooldown = 1e9;
  u.attackCooldown = 1e9; // 隔离浮游单元，不让本体普通攻击代替验证。
  u.sp = b.spCost(u);
  b.s.siracusaPity = 720;
  b.economy.random = () => 0;
  b.activate(u);
  advance(b, 5);

  assert.ok(b.s.logicLog.some(row => row.type === 'damage' && row.cause === 'skill' && row.sourceUid === u.uid && row.targetUid === target.uid), `S${skillIndex + 1} 浮游单元应造成技能直接伤害`);
  const proc = b.s.logicLog.find(row => row.type === 'damage' && row.cause === 'extra' && row.sourceUid === u.uid && row.targetUid === target.uid);
  assert.ok(proc, `S${skillIndex + 1} 浮游单元命中应触发叙拉古真伤`);
  assert.equal(proc.hp, 5000 + 50 * b.layers.siracusaShip);
 }
});

test('散开阶段：1.3 秒内向外铺开，方向互不相同', () => {
 const { b, u } = whitwBattle(2);
 u.sp = b.spCost(u);
 b.activate(u);
 b.step();
 const eyes = eyesOf(b);
 const start = eyes.map(e => ({ x: e.x, y: e.y }));
 advance(b, 1.0);
 const spread = eyes.map((e, i) => Math.hypot(e.x - start[i].x, e.y - start[i].y));
 assert.ok(spread.every(d => d > 0.2), '散开阶段应移动，实际 ' + JSON.stringify(spread.map(d => d.toFixed(2))));
 const headings = eyes.map(e => e.travel.heading);
 assert.equal(new Set(headings.map(h => h.toFixed(3))).size, eyes.length, '各自方向应不同');
 // 位置连续（非整数格心）
 assert.ok(eyes.some(e => !Number.isInteger(e.x) || !Number.isInteger(e.y)), '不得吸附到格心');
 advance(b, 0.5);
 assert.ok(eyes.every(e => e.travel.phase === 'chase'), '1.3 秒后应转入追击');
});

test('追击：飞向最近敌人、抵达后攻击并施加恐惧', () => {
 const { b, u } = whitwBattle(2);
 u.sp = b.spCost(u);
 b.activate(u);
 b.step();
 const eyes = eyesOf(b);
 const target = enemy(b, { x: u.x + 5, y: u.y, hp: 1e9, def: 0, res: 0, atk: 0 });
 advance(b, 12);
 // 至少一只眼睛锁定了该敌人
 assert.ok(eyes.some(e => e.targetUid === target.uid), '应有眼睛锁定敌人');
 assert.ok(target.hp < 1e9, '抵达后应造成伤害');
 assert.ok((target.statuses || []).some(s => s.kind === 'fear'), '命中应施加恐惧');
 assert.ok(eyes.some(e => Math.hypot(e.x - target.x, e.y - target.y) < 1.5), '应有眼睛飞到目标附近');
});

test('目标倒下后重新在目标附近定位并再索敌', () => {
 const { b, u } = whitwBattle(2);
 u.sp = b.spCost(u);
 b.activate(u);
 b.step();
 const eyes = eyesOf(b);
 const first = enemy(b, { x: u.x + 4, y: u.y, hp: 500, def: 0, atk: 0 });
 advance(b, 20);
 const stillAlive = first.hp > 0;
 if (stillAlive) first.hp = 0;
 advance(b, 2);
 const second = enemy(b, { x: u.x - 4, y: u.y, hp: 1e9, def: 0, atk: 0 });
 advance(b, 12);
 assert.ok(eyes.some(e => e.targetUid === second.uid), '应重新索敌到新目标');
 assert.ok(second.hp < 1e9, '应对新目标造成伤害');
});

test('场上无可选目标时不再扣血（进入绕本体巡航）', () => {
 const { b, u } = whitwBattle(2);
 u.sp = b.spCost(u);
 b.activate(u);
 const eyes = eyesOf(b);
 enemy(b, { hp: 1e12, x: -8, y: -8, trainingDummy: true, hidden: true, untargetable: true, invulnerable: true });
 advance(b, 6);
 // 无可选目标：不应有锁定
 assert.ok(eyes.every(e => e.targetUid == null), '无可选目标时不应锁定');
 // 巡航：与本体保持约 0.9 格
 const distances = eyes.map(e => Math.hypot(e.x - u.x, e.y - u.y));
 assert.ok(distances.every(d => d > 0.3 && d < 1.4), '应绕本体巡航，实际 ' + JSON.stringify(distances.map(d => d.toFixed(2))));
});

test('技能结束后浮游单元返回干员身边并消失', () => {
 const { b, u } = whitwBattle(2);
 const sk = b.profile(u).skill;
 u.sp = b.spCost(u);
 b.activate(u);
 b.step();
 enemy(b, { x: u.x + 5, y: u.y, hp: 1e9, def: 0, atk: 0 });
 advance(b, 10);
 assert.ok(eyesOf(b).length > 0, '技能期间应存在眼睛');
 // 直接结束技能
 u.skillLeft = 0;
 advance(b, 12);
 assert.equal(eyesOf(b).length, 0, '技能结束后眼睛应消失');
});
