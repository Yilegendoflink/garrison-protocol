// 元素损伤/元素伤害的逐名口径回归（用户 2026-09-22「补齐遗留问题」）。
// 依据 PRTS 干员页备注（本地快照 data/prts/snapshots/2026-09-12-prts/source/*.json）：
//  · 妮芙 68952：凋亡损伤量以「目标受伤前后的生命值差」为准；S1 爆发期追加元素伤害；S3 爆发期攻击造成元素伤害；
//    天赋「失魂」攻击爆发期敌人时使其每秒受攻击力 40%（S2 命中时 70%）元素伤害，持续到爆发结束；
//  · 塑心 60712：天赋「无词哀歌」是**每秒**范围内凋亡损伤 + 停顿 0.2 秒；「精神逆构」使范围内敌人受到的凋亡损伤提高 20%；
//  · 焰影苇草 48441：天赋「灼痕」**造成伤害时 30% 概率**施加（攻击力-10%、15% 法术脆弱、6 秒）；S3 期间施加的灼痕无限持续、技能结束清空。
import test from 'node:test';
import assert from 'node:assert/strict';
import {openBattle,deployNow,enemy,byId,steps} from './effects-harness.mjs';
import {applyElementDamage} from '../dist/native-effects.js';

const NYMPH='chess_char_5_22_a',CELLO='chess_char_6_09_a',REED='chess_char_6_08_a';
const dmgLog=(b,target)=>((b.s.logicLog||[]).filter(r=>r.type==='damage'&&r.targetUid===target.uid));
const elLog=(b,target)=>((b.s.logicLog||[]).filter(r=>r.type==='element'&&r.targetUid===target.uid));
const runTo=(b,t)=>{let guard=0;while(b.s.time<t-1e-9&&!b.s.finished){if(++guard>30000)throw Error('时间未收敛');b.step();}};
function solo(chessId,skillIndex){
 const {b}=openBattle([{chessId,skillIndex}]);deployNow(b);
 return {b,u:byId(b,b.s.units[0].id)};
}

test('妮芙：凋亡损伤量按该次伤害的生命值损失算；S1 在爆发期追加元素伤害；S3 爆发期攻击改元素伤害',()=>{
 const {b,u}=solo(NYMPH,0),e=enemy(b,{x:u.x+1,y:u.y,hp:1e6,def:0,res:0});
 const atk=b.stats(u).atk;
 b.hit(u,e,100,'arts',{skill:true});
 const first=elLog(b,e)[0];
 assert.ok(Math.abs(first.amount-100*0.1)<1e-6,'凋亡损伤＝该次生命值损失 × 10%（不是攻击力的 10%）');
 // 爆发期：追加攻击力 30% 的元素伤害（elemental，走元素抗性）
 e.elemental={};e.elementalType=null;e.elementalStartedAt=null;e.elementalBatch=null;
 e.elementBurstUntil=b.s.time+5;e.elementBurstType='necrosis';
 const before=dmgLog(b,e).length;b.hit(u,e,100,'arts',{skill:true});
 const extra=dmgLog(b,e).slice(before).find(r=>r.cause==='extra');
 assert.ok(extra&&Math.abs(extra.hp-atk*0.3)<1e-6,'S1 爆发期追加攻击力 30% 的元素伤害');
 assert.ok(e.nymphSoul?.scale>=0.4,'命中爆发期敌人时给天赋「失魂」打标记');
 // 失魂：每秒元素伤害，直到爆发结束
 const n=dmgLog(b,e).length;runTo(b,2.2);
 const dots=dmgLog(b,e).slice(n).filter(r=>r.cause==='dot');
 assert.ok(dots.length>=2,'失魂每秒一跳');
 assert.ok(Math.abs(dots[0].hp-atk*0.4)<1e-6,'失魂每跳＝攻击力 40%');
 // S2 命中爆发期敌人：失魂倍率提高到 70%
 const s2=solo(NYMPH,1);const u2=s2.u,e2=enemy(s2.b,{x:u2.x+1,y:u2.y,hp:1e6,def:0,res:0});
 u2.sp=s2.b.spCost(u2);s2.b.activate(u2);
 e2.elementBurstUntil=s2.b.s.time+5;e2.elementBurstType='necrosis';
 s2.b.hit(u2,e2,100,'arts',{skill:true});
 assert.ok(Math.abs((e2.nymphSoul?.scale||0)-0.7)<1e-6,'S2 命中时失魂倍率 70%');
 // S3：目标处于凋亡爆发期间 → 攻击造成元素伤害（用元素抗性 50 分辨）
 const s3=solo(NYMPH,2);const u3=s3.u,e3=enemy(s3.b,{x:u3.x+1,y:u3.y,hp:1e6,def:0,res:0,elementResistance:50});
 u3.sp=s3.b.spCost(u3);s3.b.activate(u3);
 const m0=dmgLog(s3.b,e3).length;s3.b.hit(u3,e3,100,'arts',{skill:true});
 const plain=dmgLog(s3.b,e3).slice(m0).map(r=>Math.round(r.hp));
 e3.elementBurstUntil=s3.b.s.time+5;e3.elementBurstType='necrosis';
 const m1=dmgLog(s3.b,e3).length;s3.b.hit(u3,e3,100,'arts',{skill:true});
 const burst=dmgLog(s3.b,e3).slice(m1).map(r=>Math.round(r.hp));
 assert.deepEqual(plain,[100],'常态是法术伤害（法抗 0 → 100）');
 assert.deepEqual(burst,[50],'爆发期变元素伤害（元素抗性 50 → 50）');
});

test('塑心天赋「无词哀歌」是范围内每秒凋亡损伤＋停顿，不在每次攻击时结算；「精神逆构」只提高凋亡损伤',()=>{
 const {b,u}=solo(CELLO,1),e=enemy(b,{x:u.x+1,y:u.y,hp:1e6,def:0,res:0});
 b.hit(u,e,10,'arts');
 assert.deepEqual(e.elemental||{},{} ,'每次攻击不再附带凋亡损伤（那是「每秒」口径）');
 runTo(b,1.1);
 const tick=elLog(b,e).find(r=>r.t>0);
 assert.ok(tick,'每秒一跳凋亡损伤');
 assert.ok((e.statuses||[]).some(s=>s.kind==='sluggish'),'每秒同时施加停顿 0.2 秒');
 const atk=b.stats(u).atk,talentBoost=1.2;   // 精神逆构：受到的凋亡损伤 +20%
 assert.ok(Math.abs(tick.amount-atk*0.1*talentBoost)<1e-6,'凋亡损伤＝攻击力 10%，并按「精神逆构」+20%');
 // 精神逆构只作用于凋亡：别的元素类型不吃这 20%
 const other=enemy(b,{x:u.x+1,y:u.y,hp:1e6,def:0,res:0});
 const res=applyElementDamage(b,{source:u,target:other,amount:atk*0.1,type:'burn'});
 assert.ok(Math.abs(res.added-atk*0.1)<1e-6,'灼燃损伤不吃「精神逆构」（按类型区分）');
});

test('焰影苇草「灼痕」：30% 概率触发（攻击力-10%＋15% 法术脆弱）；S3 期间无限持续、技能结束清空',()=>{
 const {b,u}=solo(REED,0),e=enemy(b,{x:u.x+2,y:u.y,hp:1e6,def:0,res:0});
 let hits=0;
 for(let i=0;i<200&&!(e.statuses||[]).some(s=>s.kind==='burn');i++){b.hit(u,e,10,'arts');hits++;if(b.s.time>=(u.lastSkill??0))b.s.time+=0;}
 assert.ok(hits>1,'不是每次攻击都挂（30% 概率）');
 const thorn=(e.statuses||[]).find(s=>s.kind==='burn');
 assert.ok(thorn&&thorn.remaining>3,'灼痕持续 6 秒量级');
 const tb=Object.fromEntries((b.profile(u).activeTalents.find(t=>t.name==='灼痕').blackboard||[]).map(x=>[x.key,x.value]));
 assert.ok((e.statuses||[]).some(s=>s.kind==='fragile'&&Math.abs(s.value-tb.damage_scale)<1e-6),'同一跳附带法术脆弱（数值取当前档黑板）');
 const down=(e.statuses||[]).find(s=>s.kind==='attackDown');
 assert.ok(down&&Math.abs(down.value-tb.atk)<1e-6,'同一跳附带攻击力降低（数值取当前档黑板）');
 assert.deepEqual(e.elemental||{},{} ,'灼痕不是元素损伤');
 // S3「生命火种」：施加的灼痕无限持续，技能结束后清空
 const s3=solo(REED,2);const u3=s3.u,e3=enemy(s3.b,{x:u3.x+2,y:u3.y,hp:1e6,def:0,res:0});
 u3.sp=s3.b.spCost(u3);s3.b.activate(u3);
 for(let i=0;i<200&&!(e3.statuses||[]).some(s=>s.kind==='burn');i++)s3.b.hit(u3,e3,10,'arts');
 const mark=(e3.statuses||[]).find(s=>s.kind==='burn');
 assert.ok(mark&&mark.remaining>1e6,'S3 期间施加的灼痕无限持续');
 s3.b.deactivate(u3);
 assert.ok(!(e3.statuses||[]).some(s=>s.kind==='burn'),'技能结束时清空技能期间施加的灼痕');
 assert.equal(Math.max(1,...(e3.statuses||[]).filter(s=>s.kind==='fragile').map(s=>Number(s.value)||1)),1,'灼痕的法术脆弱也一并撤掉');
});

test('妮芙模组 ALC-X：对处于元素爆发期间的敌人造成伤害 ×1.1（普攻与天赋持续伤害都吃）',()=>{
 const ELITE='chess_char_5_22_b';               // 模组只挂在精锐形态上（moduleId uniequip_002_nymph）
 const measure=(chessId,burst)=>{
  const {b,u}=solo(chessId,0);
  const e=enemy(b,{x:u.x+1,y:u.y,hp:1e9,def:0,res:0});
  if(burst){e.elementBurstType='necrosis';e.elementBurstUntil=b.s.time+30;}
  b.hit(u,e,1000,'arts');
  return dmgLog(b,e)[0]?.hp;
 };
 assert.ok(Math.abs(measure(ELITE,false)-1000)<1e-6,'没进爆发：原样 1000');
 assert.ok(Math.abs(measure(ELITE,true)-1100)<1e-6,'爆发期间：1000 → 1100');
 assert.ok(Math.abs(measure(NYMPH,true)-1000)<1e-6,'不带模组的初始形态没有这条倍率');
 // 天赋「失魂」的每秒元素伤害也走同一个倍率（PRTS 模组写的是「造成的伤害」，不区分来源路径）
 const {b,u}=solo(ELITE,0);
 const e=enemy(b,{x:u.x+1,y:u.y,hp:1e9,def:0,res:0});
 applyElementDamage(b,{source:u,target:e,amount:1000,type:'necrosis'});
 assert.equal(e.elementBurstType,'necrosis','凋亡损伤满格后爆发');
 const before=dmgLog(b,e).filter(r=>r.cause==='dot').length;
 runTo(b,1.2);
 const dot=dmgLog(b,e).filter(r=>r.cause==='dot'&&r.sourceUid===u.uid);
 assert.equal(dot.length,before+1,'爆发期间每秒一跳「失魂」');
 const expect=b.stats(u).atk*0.4*1.1;
 assert.ok(Math.abs(dot.at(-1).hp-expect)<1e-6,'失魂的一跳＝攻击力×40%×1.1（'+dot.at(-1).hp.toFixed(2)+' vs '+expect.toFixed(2)+'）');
});
