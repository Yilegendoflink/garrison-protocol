// 元素治疗/元素损伤屏障/损伤降低的回归（用户 2026-09-22「补齐遗留问题」）。
// 依据 PRTS：纯烬艾雅法拉（57349）S1「每秒回复攻击力 4% 的元素损伤」且「元素治疗无视禁疗」、
// S2「范围损伤屏障吸收元素损伤」共享吸收值并可作用于后续部署的单位、S3「治疗与元素损伤回复的 5 连发」；
// 天赋「火山灰疗愈」攻击范围内友方生命上限 +6%、受到的元素损伤降低 12%；
// 哈洛德（61835）S2「治疗元素损伤累计超过一半的目标时，元素损伤回复量提升至 160%」；天赋「我即军营」范围内 -12%（文案写超过一半）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {openBattle,deployNow,enemy,byId} from './effects-harness.mjs';
import {applyElementDamage} from '../dist/native-effects.js';

const AGOAT='chess_char_6_20_a',HAROLD='chess_char_2_05_a',ALLY='chess_char_1_20_b',ALLY2='chess_char_1_01_b';
const runTo=(b,t)=>{let guard=0;while(b.s.time<t-1e-9&&!b.s.finished){if(++guard>30000)throw Error('时间未收敛');b.step();}};
function pair(chessId,skillIndex,extra=[ALLY]){
 const {b}=openBattle([{chessId,skillIndex},...extra.map(id=>({chessId:id}))]);deployNow(b);
 return {b,u:byId(b,b.s.units[0].id),allies:extra.map(id=>byId(b,id==='chess_char_1_20_b'?'char_107_liskam':'char_498_inside'))};
}

test('纯烬 S1：攻击范围内友方每秒回复攻击力 4% 的元素损伤（元素治疗无视禁疗）',()=>{
 const {b,u,allies}=pair(AGOAT,0);
 const ally=allies[0];
 u.sp=b.spCost(u)+5;b.activate(u);
 const fx=(b.s.logicEffects||[]).find(f=>f.talentOrSkillId==='agoat2-s1');
 assert.ok(fx,'S1 要建元素治疗光环');
 assert.equal(fx.interval,1,'每秒结算一次（旧实现是 1/30 秒却给整秒的量，等于 30 倍）');
 assert.ok(Math.abs(fx.values.elementRegen-b.stats(u).atk*0.04)<1e-6,'每秒回复量＝攻击力 4%');
 assert.equal(fx.values.elementRegenIgnoresHealBlock,true,'元素治疗无视禁疗');
 // 禁疗目标也能被元素治疗
 ally.healable=false;
 const injury=applyElementDamage(b,{source:u,target:ally,amount:400,type:'necrosis'});
 assert.ok(injury.added>0);
 const before=b.elementInjury(ally);
 const restored=b.healElements(u,ally,100,{ignoreHealingBlock:true});
 assert.equal(restored,100,'禁疗只挡治疗量，不挡元素治疗');
 assert.ok(b.elementInjury(ally)<before);
 ally.healable=true;
});

test('纯烬 S2「云霭荫佑」：生成损伤屏障（吸收元素损伤），后上场的单位同样受保护，重复释放重置',()=>{
 const {b,u,allies}=pair(AGOAT,1);
 const ally=allies[0];
 u.sp=b.spCost(u)+5;b.activate(u);
 const bar=(b.s.elementBarriers||[]).find(x=>x.refUid===u.uid);
 assert.ok(bar,'S2 要生成损伤屏障');
 assert.ok(Math.abs(bar.amount-b.stats(u).atk*5)<1e-6,'吸收值＝攻击力 500%');
 const r1=applyElementDamage(b,{source:u,target:ally,amount:100,type:'necrosis'});
 assert.equal(r1.added,0,'损伤全被屏障吸收');
 assert.ok(b.elementInjury(ally)===0);
 const left=bar.remaining;
 assert.ok(left<bar.amount&&left>0,'屏障吸收值按比例扣减');
 // 后续部署/挪进范围的单位也能吃（动态范围判定）
 const late=enemy(b,{x:u.x+1,y:u.y,hp:1e6,def:0,res:0});
 assert.equal((b.s.elementBarriers||[]).some(x=>x.remaining>0),true);
 applyElementDamage(b,{source:u,target:ally,amount:1e5,type:'necrosis'});
 assert.equal(bar.remaining,0,'大额损伤先把屏障打空');
 assert.ok(b.elementInjury(ally)>0||ally.elementBurst>0,'剩下的才进损伤条（打满即爆发，条会清空）');
 void late;
});

test('纯烬 S3「火山回响」：治疗与元素损伤回复各 5 连发，优先治疗不同的目标',()=>{
 const {b,u,allies}=pair(AGOAT,2,[ALLY,ALLY2]);
 const injured=allies.filter(Boolean);
 for(const a of injured){a.hp=a.maxHp*.5;applyElementDamage(b,{source:u,target:a,amount:400,type:'necrosis'});}
 const before=injured.map(a=>b.elementInjury(a));
 u.sp=b.spCost(u)+5;b.activate(u);
 const heals=(b.s.logicLog||[]).filter(r=>r.type==='heal'&&injured.some(a=>a.uid===r.targetUid));
 assert.equal(heals.length,5,'5 连发治疗');
 const after=injured.map(a=>b.elementInjury(a));
 assert.ok(after.every((v,i)=>v<before[i]),'元素损伤同时被回复');
 const targets=new Set(heals.map(r=>r.targetUid));
 assert.equal(targets.size,Math.min(5,injured.length),'优先治疗本次动作里没选过的目标');
});

test('纯烬天赋「火山灰疗愈」：攻击范围内友方生命上限 +6%、受到的元素损伤降低 12%（无需过半）',()=>{
 const {b,u,allies}=pair(AGOAT,0),ally=allies[0];
 runTo(b,.1);
 assert.ok(Math.abs((ally.elementAuraMaxHp||0)-0.06)<1e-6,'在范围内的友方拿到 +6% 生命上限光环');
 const boosted=b.stats(ally).maxHp;
 // 移到范围外：光环失效
 ally.x=u.x+6;ally.y=u.y+6;
 runTo(b,.1);
 assert.ok(b.stats(ally).maxHp<boosted,'离开范围后生命上限光环失效');
 ally.x=u.x+1;ally.y=u.y;
 runTo(b,.1);
 // 损伤降低 12%：文案没有「超过一半」，所以损伤很少时也生效
 const small=applyElementDamage(b,{source:u,target:ally,amount:100,type:'necrosis'});
 assert.ok(Math.abs(small.added-88)<1e-6,'受到的凋亡损伤 100 → 88（-12%）');
});

test('哈洛德 S2「重症优先」：元素损伤累计超过一半时，元素损伤回复量提升至 trait_scale 倍',()=>{
 const run=(injury)=>{
  const b=pair(HAROLD,1).b,u=byId(b,'char_4114_harold'),ally=byId(b,'char_107_liskam');
  ally.hp=ally.maxHp*.5;u.sp=b.spCost(u)+5;b.activate(u);
  applyElementDamage(b,{source:u,target:ally,amount:injury,type:'necrosis'});
  const start=b.elementInjury(ally);
  runTo(b,2.2);
  return {healed:start-b.elementInjury(ally),start};
 };
 const high=run(600),low=run(300);
 assert.ok(high.healed>0&&low.healed>0,'两次都发生了元素回复');
 assert.ok(high.healed>low.healed,'损伤过半时回复量更高（160% vs 100%）');
});
