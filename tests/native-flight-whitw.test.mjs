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
 assert.ok(eyes.every(e => e.ownerUid === u.uid));
 // 生成位置在本体附近（该帧已推进，容差放宽），且是连续坐标
 assert.ok(eyes.every(e => Math.hypot(e.x - u.x, e.y - u.y) < 0.05), '初始应在本体附近');
 assert.ok(eyes.every(e => e.travel?.phase === 'scatter'), '应先进入散开阶段');
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
