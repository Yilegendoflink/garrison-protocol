// 引星棘刺「炼金单元」（`char_1039_thorn2`，炼金师）的回归。
// 依据 PRTS 干员页（prts:operator:73979，revisionId 394044）的技能备注与召唤物页的分支口径：
//  · 特性「可以投掷〈炼金单元〉协助作战」；单元落地后成为静止弹道，**缓存技能开启时自身的攻击力**；
//  · S1「度算浪波」：向友方投掷，落点＋周围 8 格（3×3）友方防御力 +def、每秒回复攻击力 11%（**效果可叠加**）；
//    ※优先选择生命比例最低 > 最晚部署的我方单位（不含装置），只有自己时落自己格；
//  · S2「解构涌潮」：攻击范围内有可选敌人就投到该敌人所在格，否则投到攻击范围内正前方最远的地块；
//    落点周围地面敌人受到的治疗/回复降低 50%（**乘算叠加**）、每秒受攻击力 120% 法术伤害，友方每秒回复攻击力 12%；
//    单元落地后沿**远离自己**的方向以 0.1 格/秒移动、半径从 1.1 起每秒扩大 0.13，移动与扩大时间 12 秒**不受天赋影响**；
//  · S3「我的海疆」：被动扩大攻击范围；主动向**阻挡数最低 > 最晚部署**的 3 名干员投掷，19 秒内区域敌人三围降低并每秒受伤，
//    效果在 15 秒内按 *_per_interval 爬到 max_*；区域**独立于干员存在**，多次开启伤害叠加、削弱取最高；
//  · 天赋「心相」：攻击范围内存在其他干员时，**本次投掷**的单元持续时间 +3 秒（只在投掷那一刻判定）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {applyHeal,applyRegen,commitExit,thorn2AreaContains,zoneContains} from '../dist/native-effects.js';
import {openBattle,deployNow,enemy,byId,steps} from './effects-harness.mjs';

const CHESS='chess_char_5_15_a';           // 引星棘刺（初始形态：技能等级 4 的黑板）
const ALLY='chess_char_1_20_b';            // 雷蛇：地面近战，用来当投掷目标
const ALLY2='chess_char_1_01_b';
const runTo=(b,t)=>{let guard=0;while(b.s.time<t-1e-9&&!b.s.finished){if(++guard>30000)throw Error('时间未收敛');b.step();}};
const fxOf=(b,tag)=>(b.s.logicEffects||[]).filter(f=>String(f.talentOrSkillId||'').startsWith('thorn2-'+tag));
const dotCount=(b,target)=>(b.s.logicLog||[]).filter(r=>r.type==='damage'&&r.targetUid===target.uid&&r.cause==='dot').length;
const regeOn=(b,target)=>(b.s.logicLog||[]).filter(r=>r.type==='regen'&&r.targetUid===target.uid);
function battleWith(skillIndex,extra=[]){
 const {b}=openBattle([{chessId:CHESS,skillIndex},...extra]);deployNow(b);
 return {b,u:byId(b,'char_1039_thorn2')};
}
const activate=(b,u)=>{u.sp=b.spCost(u);return b.activate(u);};

test('S1「度算浪波」：投到生命比例最低的友方，落点 3×3 的友方防御力 +60、每秒回复攻击力 11%，效果可叠加',()=>{
 const {b,u}=battleWith(0,[{chessId:ALLY},{chessId:ALLY2}]);
 const [a1,a2]=b.s.units.filter(v=>v.uid!==u.uid);
 a1.hp=a1.maxHp;a2.hp=a2.maxHp*.4;                     // a2 生命比例更低 → 它才是目标
 const base=a2?b.stats(a2).def:0,baseAtk=b.stats(u).atk;
 activate(b,u);
 const fx=fxOf(b,'s1')[0];assert.ok(fx,'开技要生成炼金单元');
 assert.equal(fx.radius,1,'S1 是落点＋周围 8 格（半径 1 的方格）');
 assert.deepEqual([fx.carrier.toX,fx.carrier.toY],[Math.round(a2.x),Math.round(a2.y)],'投到生命比例最低的友方格');
 assert.equal(fx.endsAt-fx.startedAt,9,'6 秒 + 天赋「范围内存在其他干员」延长 3 秒');
 assert.equal(fx.values.defBuff,60,'防御力 +def（技能等级 4 = 60）');
 assert.ok(Math.abs(fx.values.regen-baseAtk*.11)<1e-6,'每秒回复攻击力 11%');
 runTo(b,1.2);
 assert.equal(b.stats(a2).def-base,60,'落点上的友方吃到防御力加成');
 assert.equal(regeOn(b,a2).length,1,'每秒一跳回复');
 assert.ok(Math.abs(regeOn(b,a2)[0].amount-baseAtk*.11)<1e-6);
 // 效果可叠加：再补一个盖住同一格的同款单元 → +120
 b.s.logicEffects.push({id:'probe-thorn2-s1',startedAt:b.s.time,kind:'zone',sourceUid:u.uid,sourceDeployGen:u.deployGen,talentOrSkillId:'thorn2-s1:probe',x:a2.x,y:a2.y,radius:1,interval:1,nextAt:b.s.time+.01,endsAt:b.s.time+9,trackArea:true,trackSide:'ally',shape:'square',refKind:'live',values:{defBuff:60,regen:0},snapshot:{}});
 runTo(b,2.4);
 assert.equal(b.stats(a2).def-base,120,'两个单元盖住同一名干员时防御力加成叠加');
 runTo(b,9.4);
 assert.equal(fxOf(b,'s1').includes(fx),false,'持续时间到就消失');
 bounds: { const solo=battleWith(0);activate(solo.b,solo.u);
  const only=fxOf(solo.b,'s1')[0];
  assert.equal(only.endsAt-only.startedAt,6,'攻击范围内没有其他干员时不延长');
  assert.deepEqual([only.carrier.toX,only.carrier.toY],[Math.round(solo.u.x),Math.round(solo.u.y)],'没有可选目标时只投在自己格'); }
});

test('S2「解构涌潮」：投到敌人格（没有敌人时投正前方最远格），落地后远离自身移动、半径每秒扩大，地面敌人吃伤害并被减疗',()=>{
 const {b,u}=battleWith(1,[{chessId:ALLY}]);
 const ally=b.s.units.find(v=>v.uid!==u.uid),e=enemy(b,{x:u.x+2,y:u.y,hp:1e9,def:0,res:0}),flyer=enemy(b,{x:u.x+3,y:u.y,hp:1e9,def:0,res:0,flying:true});
 ally.x=e.x;ally.y=e.y+1;ally.hp=ally.maxHp-500;
 const atk=b.stats(u).atk;
 activate(b,u);
 const fx=fxOf(b,'s2')[0];assert.ok(fx,'开技要生成炼金单元');
 assert.deepEqual([fx.carrier.toX,fx.carrier.toY],[Math.round(e.x),Math.round(e.y)],'攻击范围内有敌人就投到敌人所在格');
 assert.equal(fx.radius,1.1,'初始影响半径 = projectile_range');
 assert.equal(fx.values.growth.rate,.13,'半径每秒扩大 value');
 assert.equal(fx.values.drift.speed,.1,'落地后 0.1 格/秒沿投掷方向移动');
 assert.equal(fx.values.healDown,.5,'地面敌人治疗/回复降低 50%');
 runTo(b,.6);
 assert.equal(fx.carrier.arrived,true,'投掷段很快落地');
 const landed={x:fx.x,y:fx.y};
 runTo(b,3.2);
 assert.ok(fx.x>landed.x+.2,'落地后沿远离自身的方向移动');
 assert.ok(Math.abs(fx.radius-(1.1+.13*3.2))<.02,'半径按 0.13/秒扩大');
 assert.equal(dotCount(b,e),3,'地面敌人每秒一跳');
 assert.equal(dotCount(b,flyer),0,'原表写「地面敌人」：飞行单位不吃');
 const per=(b.s.logicLog||[]).filter(r=>r.type==='damage'&&r.targetUid===e.uid&&r.cause==='dot')[0];
 assert.ok(Math.abs(per.hp-atk*1.2)<1e-6,'每跳伤害 = 开技时缓存的攻击力 × 120%');
 // 减疗：治疗与回复都乘 0.5
 let before=e.hp;applyHeal(b,{source:e,target:e,amount:100});
 assert.equal(Math.round(e.hp-before),50,'治疗减半');
 before=e.hp;applyRegen(b,{target:e,amount:100});
 assert.equal(Math.round(e.hp-before),50,'回复也减半');
 assert.ok(regeOn(b,ally).length>=1,'圈内友方每秒回复');
 // 移动/扩大在 remaining_time(12 秒) 后停住（总时长 15 秒）
 runTo(b,12.4);
 const frozen={x:fx.x,y:fx.y,r:fx.radius};
 runTo(b,14.4);
 assert.deepEqual([fx.x,fx.y,fx.radius],[frozen.x,frozen.y,frozen.r],'12 秒后不再移动/扩大（不受天赋延长影响）');
 // 没有可选敌人时：投到攻击范围内正前方最远的地块
 const none=battleWith(1);activate(none.b,none.u);
 const solo=fxOf(none.b,'s2')[0];
 const cells=none.b.range(none.u,true);
 assert.ok(cells.some(c=>c.x===solo.carrier.toX&&c.y===solo.carrier.toY),'落点在攻击范围里');
 assert.ok(solo.carrier.toX===none.u.x&&solo.carrier.toY>none.u.y||solo.carrier.toX>none.u.x,'落在正前方');
});

test('S3「我的海疆」：3 个落点围成判定区域，敌人三围削弱＋每秒法术伤害，15 秒爬到最大，区域独立于干员',()=>{
 const {b,u}=battleWith(2,[{chessId:ALLY},{chessId:ALLY2}]);
 const [a1,a2]=b.s.units.filter(v=>v.uid!==u.uid);
 a1.x=u.x+2;a1.y=u.y;a2.x=u.x;a2.y=u.y+2;             // 三角形 (3,0)-(5,0)-(3,2)
 const atk=b.stats(u).atk;
 activate(b,u);
 const fx=fxOf(b,'s3')[0];assert.ok(fx,'开技要生成区域');
 assert.equal(fx.values.thorn2Area.points.length,2,'范围内只有两个干员时是直线区域');
 assert.equal(fx.persistAfterSourceGone,true,'区域独立于干员存在');
 assert.equal(fx.endsAt-fx.startedAt,22,'19 秒 + 天赋 3 秒');
 // 两个落点 → 判定区域是宽 0.65 的直线 (3,2)-(5,0)（线上 (4,1)）：
 const onLine=enemy(b,{x:u.x+1,y:u.y+1,hp:1e9,def:0,res:0});
 const offLine=enemy(b,{x:u.x+1,y:u.y+2,hp:1e9,def:0,res:0});
 runTo(b,1.2);
 assert.equal(dotCount(b,onLine),1,'直线上每秒一跳');
 assert.equal(dotCount(b,offLine),0,'区域外不受影响');
 const per=(b.s.logicLog||[]).filter(r=>r.type==='damage'&&r.targetUid===onLine.uid&&r.cause==='dot')[0];
 assert.ok(Math.abs(per.hp-atk*1.32)<1e-6,'第 1 秒的每秒伤害 = 攻击力 ×(120% + 12%×1)');
 const down=(kind)=>Number((onLine.statuses||[]).find(s=>s.kind===kind)?.value);
 assert.ok(Math.abs(down('attackDown')+ .126)<1e-6,'攻击力 -12.6%（-12% 起步、每秒 -0.6%）');
 assert.ok(Math.abs(down('defDown')+ .326)<1e-6,'防御力 -32.6%');
 assert.ok(Math.abs(down('resDown')+ .326)<1e-6,'法术抗性 -32.6%');
 runTo(b,10);
 assert.ok(Math.abs(down('attackDown')+ .18)<1e-6,'第 10 秒 -18%');
 runTo(b,16.5);
 assert.ok(Math.abs(down('attackDown')+ .21)<1e-6,'15 秒后封顶 -21%');
 assert.ok(Math.abs(down('defDown')+ .41)<1e-6,'防御力封顶 -41%');
 assert.ok(Math.abs(down('resDown')+ .41)<1e-6,'法抗封顶 -41%');
 // 独立于干员：引星棘刺退场后区域照旧结算
 const before=dotCount(b,onLine);
 commitExit(b,{target:u,reason:'retreat'});
 runTo(b,17.6);
 assert.equal(fxOf(b,'s3').length,1,'干员退场后区域仍在');
 assert.ok(dotCount(b,onLine)>before,'退场后继续每秒结算');
 // 没有其他可选干员时：只投自己格、不形成区域
 const solo=battleWith(2);activate(solo.b,solo.u);
 const only=fxOf(solo.b,'s3')[0];
 assert.equal(only.values.thorn2Area.points.length,1,'只有一个落点');
 const near=enemy(solo.b,{x:solo.u.x+1,y:solo.u.y,hp:1e9,def:0,res:0});
 runTo(solo.b,2.2);
 assert.equal(dotCount(solo.b,near),0,'不成区域就没有判定范围');
});

test('判定区域的几何：一点／直线／三角形（各边外扩 0.325），区域内的友军阻挡的敌人也算在区域内',()=>{
 const area={points:[{x:3,y:0},{x:5,y:0},{x:3,y:2}],width:.325};
 assert.equal(thorn2AreaContains(area,4,1),true,'三角形内部');
 assert.equal(thorn2AreaContains(area,2.9,.9),true,'边外 0.1 在 0.325 的平移范围内');
 assert.equal(thorn2AreaContains(area,2.4,.9),false,'超出 0.325 就不算');
 assert.equal(thorn2AreaContains(area,6,0),false,'三角形外的远处');
 assert.equal(thorn2AreaContains({points:[{x:3,y:0},{x:5,y:0}],width:.325},4,.3),true,'直线区域宽 0.65');
 assert.equal(thorn2AreaContains({points:[{x:3,y:0},{x:5,y:0}],width:.325},4,.4),false,'直线区域外');
 assert.equal(thorn2AreaContains({points:[{x:3,y:0}],width:.325},3,0),true,'只有一个点时就是那一点');
 assert.equal(thorn2AreaContains({points:[{x:3,y:0}],width:.325},4,0),false);
 // 区域内的我方干员（不含装置）阻挡敌人时，被阻挡的敌人视为处于区域内。
 // 只有一个可选目标时区域就是那一点（友军所在格），所以敌人在区域外、只有靠阻挡才算进去。
 const {b,u}=battleWith(2,[{chessId:ALLY}]);
 const ally=b.s.units.find(v=>v.uid!==u.uid);
 ally.x=u.x+1;ally.y=u.y;
 activate(b,u);
 const fx=fxOf(b,'s3')[0];
 assert.equal(thorn2AreaContains(fx.values.thorn2Area,ally.x,ally.y),true,'友军所在格就是判定区域');
 const e=enemy(b,{x:u.x+2,y:u.y,hp:1e9,def:0,res:0});
 assert.equal(zoneContains(b,fx,e),false,'敌人在区域外（也没被阻挡）');
 e.block=ally.uid;
 assert.equal(zoneContains(b,fx,e),true,'被区域内友军阻挡的敌人视为处于区域内');
 e.block=999999;             // 挡它的不是友军就不算
 assert.equal(zoneContains(b,fx,e),false,'阻挡者不在场上时不算');
});

test('炼金单元的伤害缓存开技瞬间的攻击力，天赋「心相」的延长只在投掷那一刻判定',()=>{
 const {b,u}=battleWith(1,[{chessId:ALLY}]);
 const e=enemy(b,{x:u.x+2,y:u.y,hp:1e9,def:0,res:0});
 const atk=b.stats(u).atk;
 activate(b,u);
 const fx=fxOf(b,'s2')[0];
 assert.ok(Math.abs(fx.snapshot.damage-atk*1.2)<1e-6,'缓存开技瞬间的攻击力');
 const life=fx.endsAt-fx.startedAt;
 // 把友方挪出攻击范围：已投出的单元时长不变
 const ally=b.s.units.find(v=>v.uid!==u.uid);ally.x=0;ally.y=0;
 runTo(b,.2);
 assert.equal(fx.endsAt-fx.startedAt,life,'已投出的单元不受天赋重新判定影响');
 assert.equal(fx.snapshot.damage,atk*1.2,'伤害不会随自身攻击力变化');
});
