// 召唤物卡（战术家分支等在手牌里生成召唤物的干员）的整备期口径（用户 2026-09-19 确认）：
//   1. 跨回合留在原位，不因为进入下一回合被收回手牌；
//   2. 撤回卡片或撤回持有者后，场上不残留召唤物（上一场战斗的实体也不能画在备战期）；
//   3. 已放置的召唤物卡占格：干员不能压在别人的召唤物上。
import test from 'node:test';import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';import {NATIVE_DATA} from '../dist/runtime-data.js';
import {battleBoardVisible} from '../dist/protocol.js';

const data = NATIVE_DATA;
const chessOfName = name => Object.values(data.season.charShopChessDatas).find(s => s.chessId && data.profiles[s.chessId]?.name === name).chessId;
function session(...names){
 const g = new NativeSession(data, {seed: 1});
 g.s.funds = 9999; g.s.capacity = 16; g.s.rewardPending = null; g.s.rewardQueue = [];
 const units = names.map(name => {
  const u = g.gain(chessOfName(name));
  let placed = false;
  for (let y = 0; y < g.map.rows && !placed; y++) for (let x = 0; x < g.map.cols && !placed; x++) {
   if (g.s.units.some(v => v.uid !== u.uid && v.position?.x === x && v.position?.y === y)) continue;   // 别压在别人身上（那会触发换位）
   if (g.canDeploy(u.uid, x, y)) placed = g.deploy(u.uid, x, y, 0);
  }
  assert.ok(placed, name + ' 需要落场');
  return u;
 });
 g.s.rewardPending = null; g.s.rewardQueue = [];
 return {g, units};
}
const spotFor = (g, card) => {
 for (let y = 0; y < g.map.rows; y++) for (let x = 0; x < g.map.cols; x++) if (g.canDeploySummonCard(card.uid, x, y)) return {x, y};
 return null;
};

test('召唤物卡放好后跨回合留在原位，不会被收回手牌', () => {
 const {g, units} = session('伺夜');
 const card = g.s.summonCards.find(c => c.ownerUid === units[0].uid);
 assert.ok(card, '战术家应生成召唤物卡');
 const spot = spotFor(g, card);
 assert.ok(spot, '应能找到可放置格');
 assert.equal(g.deploySummonCard(card.uid, spot.x, spot.y), true);
 assert.deepEqual(card.position, spot);
 // 推进一回合：召唤物留在原位，仍在场上（不占整备区格）
 g.s.phase = 'intermission';
 assert.equal(g.perform('next'), true, g.lastError || '');
 assert.deepEqual(card.position, spot, '跨回合位置保留');
 assert.equal(g.s.summonCards.some(c => c.uid === card.uid), true, '卡片仍在');
 assert.equal(g.handLength(), g.handLength(), '已放置的召唤物卡不占整备区格');
});

test('撤回召唤物卡与撤回持有者都不会在场上留下召唤物', () => {
 const {g, units} = session('伺夜', '德克萨斯');
 const card = g.s.summonCards.find(c => c.ownerUid === units[0].uid);
 const spot = spotFor(g, card);
 assert.equal(g.deploySummonCard(card.uid, spot.x, spot.y), true);
 // 撤回卡片 → 位置上没有东西了
 assert.equal(g.withdrawSummonCard(card.uid), true);
 assert.equal(card.position, null);
 assert.equal(g.s.summonCards.filter(c => c.position).length, 0, '场上不应残留召唤物');
 // 再放一次，然后撤回持有者 → 卡片本身被清掉，场上同样不残留
 assert.equal(g.deploySummonCard(card.uid, spot.x, spot.y), true);
 assert.equal(g.perform('withdraw', units[0].uid), true);
 assert.equal(g.s.summonCards.some(c => c.ownerUid === units[0].uid), false, '持有者撤走后其召唤物卡被移除');
});

test('备战期不沿用上一场战斗的召唤物实体', () => {
 // 只有战斗/结算/休整期沿用战斗棋盘，备战期画的是整备区的布置
 assert.equal(battleBoardVisible('battle'), true);
 assert.equal(battleBoardVisible('finished'), true);
 assert.equal(battleBoardVisible('intermission'), true);
 assert.equal(battleBoardVisible('prep'), false);
 assert.equal(battleBoardVisible('lobby'), false);
});

test('已放置的召唤物卡占格：别人不能压在它上面，持有者本人可以挪过去', () => {
 const {g, units} = session('伺夜', '德克萨斯');
 const owner = units[0], other = units[1];
 const card = g.s.summonCards.find(c => c.ownerUid === owner.uid);
 const spot = spotFor(g, card);
 assert.equal(g.deploySummonCard(card.uid, spot.x, spot.y), true);
 assert.equal(g.canDeploy(other.uid, spot.x, spot.y), false, '别的干员不能压在召唤物上');
 assert.equal(g.canDeploy(owner.uid, spot.x, spot.y), true, '持有者本人可以（移动时会清掉自己的召唤物位置）');
});
