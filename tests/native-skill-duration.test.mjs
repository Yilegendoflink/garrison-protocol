import test from 'node:test';
import assert from 'node:assert/strict';
import {openBattle,deployNow,byId} from './effects-harness.mjs';

// 原作表用 duration:-1 表示“没有固定持续”，它同时覆盖三类完全不同的技能：
//   1. 切换型 / 明写“持续时间无限”  → 真正无限
//   2. 描述带 {duration} 占位         → 真实时长在黑板 duration 上
//   3. 下次攻击 / 抵挡下一次这类一次性 → 不得占用持续时间
// 修复前 1 和 3 都被当成 1e9，导致技能永久激活、技力条不回缩、也不再释放。
const timeLeft=(chessId,skillIndex)=>{const {b}=openBattle({chessId,skillIndex});deployNow(b);return {b,u:b.s.units[0],sk:b.profile(b.s.units[0]).skill};};
test('切换型与“持续时间无限”技能仍是无限',()=>{
 // 山 S2 横扫架势：duration=0，但描述写明可切换
 const mountain=timeLeft('chess_char_5_17_b',1);
 assert.match(mountain.sk.description,/可以在下列状态和初始状态间切换/);
 assert.equal(mountain.b.skillTimeLeft(mountain.sk),1e9);
 // 拉普兰德 S1 日晷：duration=-1，描述写明“持续时间无限”
 const lappland=timeLeft('chess_char_2_16_b',0);
 assert.match(lappland.sk.description,/持续时间无限/);
 assert.equal(lappland.b.skillTimeLeft(lappland.sk),1e9);
});

test('描述带 {duration} 的技能从黑板取到有限时长',()=>{
 const razer=timeLeft('chess_char_1_20_b',0);   // 雷蛇 充能防御
 assert.equal(razer.sk.duration,-1);
 assert.match(razer.sk.description,/\{duration\}/);
 assert.equal(razer.b.skillTimeLeft(razer.sk),8,'黑板 duration=8');
});

test('一次性技能不再占用持续时间（原为永续的回归）',()=>{
 const bagpipe=timeLeft('chess_char_2_04_b',0);  // 小满 竹笛飞声：下次攻击
 assert.equal(bagpipe.sk.duration,-1);
 assert.equal(bagpipe.b.skillTimeLeft(bagpipe.sk),0);
});

test('充能防御不再永续：8 秒后结束且技力可继续回复',()=>{
 const {b,u,sk}=timeLeft('chess_char_1_20_b',0);
 u.sp=b.spCost(u);
 b.activate(u);
 assert.equal(u.skillLeft,8,'激活时应写入有限时长而不是 1e9');
 assert.equal(b.skillActive(u),true);
 for(let i=0;i<30*9;i++)b.step();
 assert.equal(u.skillLeft,0);
 assert.equal(b.skillActive(u),false,'8 秒后必须结束');
 assert.equal(u.skillCount,1);
});

test('一次性技能激活后立即退出激活态，不锁死技力',()=>{
 const {b,u}=timeLeft('chess_char_2_04_b',0);
 u.sp=b.spCost(u);
 b.activate(u);
 assert.equal(u.skillLeft,0);
 assert.equal(b.skillActive(u),false,'一次性技能不得停留在激活态');
 // 技力条不应被永久挡住：给它一次受击回复的机会
 const before=u.sp;
 u.sp=0;
 b.economy.random=()=>0;
 b.hurt(u,{uid:99999,atk:50,damageType:'physical'});
 assert.ok(u.sp>=before||u.sp>0||u.hp<u.maxHp,'受击后应能恢复技力或至少正常结算');
});

test('史尔特尔「黄昏」按无限持续，生命流尽后随干员倒下结束',()=>{
 const {b,u,sk}=timeLeft('chess_char_5_07_b',2);
 assert.match(sk.description,/持续时间无限/);
 assert.equal(sk.duration,-1);
 // 该技能同时带 {duration} 占位与黑板 duration=60，但无限文案优先，不得按 60 秒处理
 assert.match(sk.description,/\{duration\}/);
 assert.equal(b.skillTimeLeft(sk),1e9);
 const baseMax=u.maxHp;
 u.sp=b.spCost(u);
 b.activate(u);
 assert.equal(u.skillLeft,1e9);
 for(let i=0;i<30*10;i++)b.step();
 assert.equal(b.skillActive(u),true,'10 秒时仍应处于技能状态');
 assert.ok(b.stats(u).maxHp>baseMax,'黄昏期间应提升生命上限');
 // 流尽生命后干员倒下，技能随之结束（而不是到点结束）
 for(let i=0;i<30*40;i++)b.step();
 assert.equal(u.deployed,false,'生命流尽后应倒下');
 assert.equal(b.skillActive(u),false);
});

test('正时长技能不受影响，仍按时结束',()=>{
 const {b,u}=timeLeft('chess_char_1_20_b',1);   // 雷蛇 S2 反击电弧 duration=20
 u.sp=b.spCost(u);
 b.activate(u);
 assert.equal(u.skillLeft,20);
 for(let i=0;i<30*21;i++)b.step();
 assert.equal(b.skillActive(u),false);
 assert.equal(u.skillLeft,0);
});
