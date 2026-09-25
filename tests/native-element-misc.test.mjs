// 引星棘刺「视界」/炼金单元模组、凯瑟琳「停止攻击」、烛煌「绝处重燃」、盟约·辅助干员「迭代元素」的回归
// （用户 2026-09-22「补齐遗留问题」）。PRTS 依据：
//  · 引星棘刺 73979：天赋「视界」在场时友方攻速 +5、敌方 -5，位于**连续 6 格或以上直线道路**的双方效果翻倍
//    （备注：开战时扫描可通行的地面地块；不可部署但可通行的黄线格参与计算，可部署但不可通行的地面不参与）；
//    模组 ALC-X「场上存在炼金单元时，技力自然恢复速度 +0.1/秒」；炼金单元的伤害是**无来源**法术持续伤害。
//  · 锡人 69295：模组「颅相学」同一条技力特性。
//  · 凯瑟琳 72129：S2「战火淬炼」写「停止攻击」。
//  · 烛煌 75069：天赋「绝处重燃」被击倒时倒地并获得 6000 屏障、不能被治疗、每秒回复 3% 生命，回满后复活并眩晕附近敌人 5 秒。
//  · 盟约·辅助干员 86036：天赋「迭代元素」附带神经损伤（优先）、灼燃损伤、凋亡损伤。
import test from 'node:test';
import assert from 'node:assert/strict';
import {openBattle,deployNow,enemy,byId} from './effects-harness.mjs';

const runTo=(b,t)=>{let guard=0;while(b.s.time<t-1e-9&&!b.s.finished){if(++guard>30000)throw Error('时间未收敛');b.step();}};
const THORN2='chess_char_5_15_a',CATHY='chess_char_4_11_a',BLAZE='chess_char_5_03_a',ALLY='chess_char_1_20_b';

test('引星棘刺天赋「视界」：全场友方攻速 +5、敌方 -5，位于连续 6 格直线道路的单位翻倍',()=>{
 const {b}=openBattle([{chessId:THORN2,skillIndex:0},{chessId:ALLY}]);deployNow(b);
 const u=byId(b,'char_1039_thorn2'),ally=byId(b,'char_107_liskam');
 const roads=b.straightRoads();
 assert.ok(roads.size>0,'地图上应当有连续 6 格的可通行地面直线');
 const baseAlly=b.profile(ally).attributes.attackSpeed,doubled=roads.has(Math.round(ally.x)+','+Math.round(ally.y));
 assert.equal(b.stats(ally).attackSpeed-baseAlly,doubled?10:5,'友方攻速 +5（直线道路上 +10）');
 const e=enemy(b,{x:u.x+2,y:u.y,hp:1e6,def:0,res:0});
 b.step();      // 敌人攻速修正是逐帧重算的（tickAuras）
 const eDouble=roads.has(Math.round(e.x)+','+Math.round(e.y));
 assert.equal(e.operatorAttackSpeedMod,eDouble?-10:-5,'敌方攻速 -5（直线道路上 -10）');
 // 引星棘刺离场后光环消失
 u.hp=0;u.deployed=false;
 assert.equal(b.stats(ally).attackSpeed,baseAlly,'主人离场后不再提供攻速光环');
});

test('炼金单元：模组「场上存在炼金单元时技力恢复 +0.1/秒」只在场上有单元时生效；伤害无来源但战报仍归属',()=>{
 // 模组数据只挂在**精锐形态**上（`moduleId` 为 uniequip_002_thorn2），所以这条用精锐引星棘刺。
 const {b}=openBattle([{chessId:'chess_char_5_15_b',skillIndex:1}]);deployNow(b);
 const u=byId(b,'char_1039_thorn2');
 const before=b.stats(u).spRecoveryPerSec;
 const e=enemy(b,{x:u.x+2,y:u.y,hp:1e9,def:0,res:0});
 u.sp=b.spCost(u);b.activate(u);
 runTo(b,.4);
 const fx=(b.s.logicEffects||[]).find(f=>String(f.talentOrSkillId||'').startsWith('thorn2-s2'));
 assert.ok(fx?.values?.alchemyUnit,'炼金单元要有标记（模组技力与视觉都读它）');
 assert.ok(Math.abs(b.stats(u).spRecoveryPerSec-(before+0.1))<1e-6,'场上存在炼金单元 → 技力恢复 +0.1/秒');
 assert.equal(fx.values.noSource,true,'PRTS：炼金单元的伤害是无来源法术持续伤害');
 runTo(b,2.2);
 const credited=b.s.damage?.[u.uid]||0;
 assert.ok(credited>0,'无来源伤害的战报归属仍然算给召唤者');
 const dot=(b.s.logicLog||[]).filter(r=>r.type==='damage'&&r.cause==='dot'&&r.targetUid===e.uid)[0];
 assert.ok(dot&&dot.sourceUid==null,'伤害事件本身没有来源');
 // 单元消失后技力恢复回落
 b.s.logicEffects=b.s.logicEffects.filter(f=>f!==fx);
 assert.ok(Math.abs(b.stats(u).spRecoveryPerSec-before)<1e-6,'场上没有炼金单元时特性不生效');
});

test('凯瑟琳 S2「战火淬炼」写「停止攻击」：技能期间不进行普通攻击（开技前照常）',()=>{
 const build=()=>{const {b}=openBattle([{chessId:CATHY,skillIndex:1}]);deployNow(b);
  const u=byId(b,'char_4162_cathy'),e=enemy(b,{x:u.x+1,y:u.y,hp:1e6,def:0,res:0});e.block=u.uid;
  return {b,u,e};};
 const control=build();runTo(control.b,4);
 const hitsWithout=(control.b.s.logicLog||[]).filter(r=>r.type==='damage'&&r.sourceUid===control.u.uid).length;
 assert.ok(hitsWithout>0,'未开技时会正常攻击');
 const cathy=build();cathy.u.sp=cathy.b.spCost(cathy.u);cathy.b.activate(cathy.u);
 assert.equal(cathy.b.skillActive(cathy.u),true);
 runTo(cathy.b,4);
 assert.equal((cathy.b.s.logicLog||[]).filter(r=>r.type==='damage'&&r.sourceUid===cathy.u.uid).length,0,'技能期间停止攻击');
});

test('烛煌天赋「绝处重燃」：致命伤后倒地（6000 屏障、不可治疗、每秒 3% 回血），回满复活',()=>{
 const {b}=openBattle([{chessId:BLAZE,skillIndex:2}]);deployNow(b);
 const u=byId(b,'char_1040_blaze2'),e=enemy(b,{x:u.x+1,y:u.y,hp:1e6,def:0,res:0,atk:100});
 runTo(b,.1);
 u.hp=1;
 b.hurt(u,e,{damageAmount:9999});
 assert.equal(u.downed,true,'被击倒时倒地');
 assert.equal(u.deployed,true,'倒地时仍留在场上');
 assert.ok(u.shield>=6000,'倒地获得 6000 屏障');
 assert.equal(u.healable,false,'倒地期间无法被治疗');
 assert.ok((u.blazeRegen||0)>0,'每秒回复最大生命的一定比例');
 runTo(b,25);
 assert.equal(u.downed,false,'生命回满后复活');
 assert.ok(u.hp>u.maxHp*.9);
 assert.ok(b.s.enemies.some(x=>x.uid===e.uid&&(x.statuses||[]).some(s=>s.kind==='stun')),'复活时眩晕附近敌人');
});

test('盟约·辅助干员「迭代元素」：附带的是**神经损伤**（PRTS 写「神经损伤（优先）」）',()=>{
 const {b}=openBattle([{chessId:'chess_char_1_15_a'}]);deployNow(b);
 const u=byId(b,'char_616_pithst'),e=enemy(b,{x:u.x+1,y:u.y,hp:1e6,def:0,res:0});
 b.hit(u,e,10,'arts');
 assert.ok((e.elemental?.neural||0)>0,'按文案的优先级挂神经损伤');
 assert.equal(e.elemental?.necrosis,undefined,'不是凋亡损伤');
});
