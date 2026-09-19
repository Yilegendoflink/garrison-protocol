import test from 'node:test';import assert from 'node:assert/strict';
import {commitExit,tickLogic} from '../dist/native-effects.js';
import {openBattle,deployNow,enemy,byId} from './effects-harness.mjs';

// 锡人「炼金单元」（S1「老科利」/S2「大拉里」）的口径（用户 2026-09-19）：
// 朝目标方向释放一个缓慢飞行的召唤物，自身划出半径 1.5 的圈，圈内持续结算技能标注的效果，
// 最终停在目标位置、到 projectile_delay_time 结束才消失。旧的实现是「开技即在自身脚下放一块常驻区域」，
// 既不飞也永不过期，这几条用例把它钉住。
const TINMAN='char_4151_tinman';
function battleWith(skillIndex,chessId='chess_char_2_19_a',extra=[]){
 const {b}=openBattle([{chessId,skillIndex},...extra]);deployNow(b);
 return {b,u:byId(b,TINMAN)};
}
function alchemy(b){return (b.s.logicEffects||[]).find(f=>/^tinman-alchemy:/.test(String(f.talentOrSkillId)));}
function alchemyCount(b){return (b.s.logicEffects||[]).filter(f=>/^tinman-alchemy:/.test(String(f.talentOrSkillId))).length;}
function bbOf(b,u){return Object.fromEntries((b.profile(u).skill.blackboard||[]).map(r=>[r.key,r.value]));}
function activate(b,u){u.sp=b.spCost(u);return b.activate(u);}
function stepFor(b,seconds){for(let i=0;i<Math.ceil(seconds*30);i++)b.step();}
// 单看某一个目标身上的伤害记录：日志里的 hp 字段就是这一跳打掉的生命（不含护盾），
// 按目标取日志就能把炼金单元与锡人自己的普攻分开。
function hitsOn(b,target){return (b.s.logicLog||[]).filter(r=>r.type==='damage'&&r.targetUid===target.uid).map(r=>({t:r.t,cause:r.cause,dealt:Math.round(r.hp)}));}
const dotHits=(b,target)=>hitsOn(b,target).filter(h=>h.cause==='dot');
const healOn=(b,target)=>(b.s.logicLog||[]).filter(r=>r.type==='heal'&&r.targetUid===target.uid);

test('炼金单元是半径 1.5 的投掷物：从干员格起飞、朝目标格每秒飞一格、抵达后停在原地',()=>{
 const {b,u}=battleWith(1);const e=enemy(b,{x:u.x+2,y:u.y,hp:1e6,def:0,res:0});
 activate(b,u);
 const fx=alchemy(b);assert.ok(fx,'开技后应当生成炼金单元');
 assert.equal(fx.kind,'zone');assert.equal(fx.sourceUid,u.uid);
 assert.equal(fx.radius,1.5,'单元自身的圈是半径 1.5');
 assert.equal(fx.interval,1,'圈内每秒结算一次');
 assert.deepEqual([fx.x,fx.y],[u.x,u.y],'从干员所在格起飞');
 assert.deepEqual([fx.carrier.toX,fx.carrier.toY],[e.x,e.y],'落点是技能目标的格子');
 assert.equal(fx.carrier.speed,1,'缓慢飞行：1 格/秒');
 assert.equal(fx.endsAt-fx.startedAt,bbOf(b,u).projectile_delay_time,'存活时长取原表 projectile_delay_time');
 stepFor(b,.5);
 assert.equal(fx.carrier.arrived,false);assert.ok(Math.abs(fx.x-(u.x+.5))<.05,'半秒飞半格');
 stepFor(b,1.6);
 assert.equal(fx.carrier.arrived,true);assert.equal(fx.x,e.x);assert.equal(fx.y,e.y);
 stepFor(b,3);
 assert.deepEqual([fx.x,fx.y],[e.x,e.y],'抵达后停在目标位置，不再移动');
 assert.equal(fx.endsAt-fx.startedAt,bbOf(b,u).projectile_delay_time);
});

test('没有目标时按朝向落到技能射程处，而不是留在原地',()=>{
 const {b,u}=battleWith(1); // 场上只有不参与索敌的假人，targets() 为空
 assert.equal(b.targets(u).length,0);
 activate(b,u);
 const fx=alchemy(b);assert.ok(fx);
 assert.deepEqual([fx.x,fx.y],[u.x,u.y]);
 assert.notDeepEqual([fx.carrier.toX,fx.carrier.toY],[u.x,u.y]);
 assert.equal(fx.carrier.toX,u.x+Math.round(bbOf(b,u).projectile_range),'朝向（默认向右）上落技能射程处');
});

test('圈在飞行途中就开始结算，抵达后继续每秒一跳，时间到即消失',()=>{
 const {b,u}=battleWith(1);const e=enemy(b,{x:u.x+2,y:u.y,hp:1e6,def:0,res:0});
 activate(b,u);const fx=alchemy(b),per=Math.round(b.stats(u).atk*bbOf(b,u).atk_scale);
 stepFor(b,1.2); // 第一个结算点在 1 秒：单元飞到 x+1，离目标 1 格，已经在圈里
 let dots=dotHits(b,e);
 assert.equal(dots.length,1,'第一个结算点在开技后 1 秒');
 assert.equal(dots[0].dealt,per,'每跳是攻击力的 atk_scale 倍');
 assert.equal(fx.carrier.arrived,false,'此时还在飞');
 stepFor(b,.9);
 dots=dotHits(b,e);
 assert.equal(dots.length,2);
 assert.equal(dots[1].dealt,per);
 assert.equal(fx.carrier.arrived,true,'2 秒抵达落点');
 assert.equal(fx.x,e.x);
 b.s.time=fx.endsAt+.01;tickLogic(b,.1);
 assert.equal(alchemy(b),undefined,'projectile_delay_time 结束后单元消失');
 const before=dotHits(b,e).length;
 stepFor(b,2);
 assert.equal(dotHits(b,e).length,before,'消失后不再结算');
});

test('“大拉里”的圈每秒治疗圈内友方（攻击力的 hp_recovery_per_sec_ratio）',()=>{
 const {b,u}=battleWith(1,'chess_char_2_19_a',[{chessId:'chess_char_1_20_b',skillIndex:0}]);
 const ally=byId(b,'char_107_liskam');
 const e=enemy(b,{x:u.x+2,y:u.y,hp:1e6,def:0,res:0});
 ally.x=u.x+2;ally.y=u.y+1;ally.hp=ally.maxHp-2000;
 activate(b,u);const fx=alchemy(b);
 assert.ok(fx.values.hot>0,'S2 带治疗量');
 assert.equal(Math.round(fx.values.hot),Math.round(b.stats(u).atk*bbOf(b,u).hp_recovery_per_sec_ratio));
 assert.equal(e.hp,1e6);
 stepFor(b,1.2);
 const heals=healOn(b,ally);
 assert.equal(heals.length,1,'落地前就有一跳治疗');
 assert.equal(Math.round(heals[0].amount),Math.round(fx.values.hot));
 assert.equal(dotHits(b,e).length,1,'同一片圈同时打敌人');
});

test('“老科利”的圈只虚弱地面敌人并造成持续伤害，不给友方治疗',()=>{
 const {b,u}=battleWith(0,'chess_char_2_19_a',[{chessId:'chess_char_1_20_b',skillIndex:0}]);
 const ally=byId(b,'char_107_liskam'),e=enemy(b,{x:u.x+2,y:u.y,hp:1e6,def:0,res:0});
 ally.x=u.x+2;ally.y=u.y+1;ally.hp=ally.maxHp-2000;
 activate(b,u);const fx=alchemy(b);
 assert.equal(fx.values.hot,0,'S1 没有治疗');
 assert.equal(fx.values.attackDown,bbOf(b,u).atk);
 stepFor(b,1.2);
 const down=(e.statuses||[]).find(s=>s.kind==='attackDown');
 assert.ok(down,'圈内地面敌人被虚弱');
 assert.equal(down.value,bbOf(b,u).atk);
 assert.equal(dotHits(b,e).length,1);
 assert.equal(healOn(b,ally).length,0,'S1 不治疗圈内友方');
});

test('原表写「地面敌人」：飞行单位站在圈里也不吃炼金单元的伤害',()=>{
 const {b,u}=battleWith(1);
 const ground=enemy(b,{x:u.x+2,y:u.y,hp:1e6,def:0,res:0}),flyer=enemy(b,{x:u.x+2,y:u.y+1,hp:1e6,def:0,res:0,flying:true});
 activate(b,u);
 stepFor(b,1.2);
 assert.equal(dotHits(b,ground).length,1,'地面敌人照常结算');
 assert.equal(dotHits(b,flyer).length,0,'飞行单位不吃这个圈');
});

test('金卡锡人的「凋敝魂灵」让圈内地面敌人受到的持续伤害提高',()=>{
 const {b,u}=battleWith(1,'chess_char_2_19_b');const e=enemy(b,{x:u.x+2,y:u.y,hp:1e6,def:0,res:0});
 activate(b,u);stepFor(b,1.2);
 assert.ok(e.fragile>=1.2,'站在炼金单元里的敌人挂上易伤');
});

test('“大拉里”可充能两次：两次投掷各留一个单元，互不覆盖',()=>{
 const {b,u}=battleWith(1);
 activate(b,u);assert.equal(alchemyCount(b),1);
 stepFor(b,3.1); // 非自动技能有 3 秒内置冷却
 u.sp=b.spCost(u);
 activate(b,u);
 const list=(b.s.logicEffects||[]).filter(f=>/^tinman-alchemy:/.test(String(f.talentOrSkillId)));
 assert.equal(list.length,2,'两次投掷各留一个单元，互不覆盖');
 assert.notEqual(list[0].id,list[1].id);
});

test('炼金单元跟随主人离场：锡人撤走后单元立刻消失',()=>{
 const {b,u}=battleWith(1);const e=enemy(b,{x:u.x+2,y:u.y,hp:1e6,def:0,res:0});
 activate(b,u);assert.ok(alchemy(b));
 commitExit(b,{target:u,reason:'retreat'});
 assert.equal(alchemy(b),undefined,'召唤物随主人一起退场');
 const before=dotHits(b,e).length;
 stepFor(b,2);
 assert.equal(dotHits(b,e).length,before);
});
