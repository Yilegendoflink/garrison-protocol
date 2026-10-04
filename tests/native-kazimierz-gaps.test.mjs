import test from 'node:test';import assert from 'node:assert/strict';
import {openBattle,enemy,byId,deployNow} from './effects-harness.mjs';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {dealDamage} from '../dist/native-effects.js';
import {statMods} from '../dist/native-operator-effects.js';

// 卡西米尔盟约与相关干员的缺口回归（2026-09-23 第二轮）。
// 口径依据：原表干员天赋文案 + 天赋自带 rangeId（`x-5`）；数值一律从天赋黑板取。

test('耀骑士临光「不畏苦暗」用天赋自带 rangeId x-5 判定，不再用 9×9 包围半径',()=>{
 const p=Object.values(NATIVE_DATA.profiles).find(x=>x?.charId==='char_1014_nearl2');
 const talent=(p.activeTalents||[]).find(t=>t.name==='不畏苦暗');
 assert.equal(talent.rangeId,'x-5','解析后的天赋必须保留 rangeId');
 assert.deepEqual(NATIVE_DATA.ranges['x-5'].grids.map(g=>[g.row,g.col]).sort(),[[-1,0],[0,-1],[0,0],[0,1],[1,0]].sort(),'x-5 = 自身＋上下左右四格');
 const {b}=openBattle(['chess_char_6_17_a']);
 const u=byId(b,'char_1014_nearl2');
 const cells=[[1,0,'正交右'],[0,1,'正交下'],[-1,0,'正交左'],[0,-1,'正交上'],[1,1,'斜角'],[2,0,'距离2'],[1,2,'斜距2']];
 const probes=cells.map(([dx,dy])=>enemy(b,{x:u.x+dx,y:u.y+dy,hp:100000,atk:0}));
 const before=probes.map(e=>e.hp),atk=b.stats(u).atk;
 b.s.lastDeployedKazimierz=false;                            // 单独验证范围，不叠加「上一名部署」的额外一次
 b.deploy(u);
 const hit=(e,i)=>(before[i]-e.hp)>0;
 assert.ok(probes.slice(0,4).every(hit),'上下左右四格都要吃到部署真伤');
 assert.ok(!probes.slice(4).every(hit),'斜角与两格外的敌人不该吃到');
 assert.ok(Math.abs((before[0]-probes[0].hp)-0.8*atk)<1e-6,'伤害为天赋黑板的 80% 攻击力真实伤害');
 assert.ok(atk>0);
});
test('「上一名部署干员」：卡西米尔触发额外一次伤害，召唤物不覆盖记录',()=>{
 const {b}=openBattle(['chess_char_2_12_b','chess_char_4_17_b']);
 deployNow(b);
 const gravel=byId(b,'char_237_gravel'),other=b.s.units.find(u=>u!==gravel);
 assert.ok(b.profile(gravel).bonds.includes('kazimierzShip'));
 b.deploy(gravel);assert.equal(b.s.lastDeployedKazimierz,true,'部署卡西米尔干员后记录为真');
 b.deploy(other);assert.equal(b.s.lastDeployedKazimierz,false,'部署非卡西米尔干员后记录为假');
 b.deploy(gravel);
 // 召唤物不是干员：既不计数也不覆盖
 const summon={uid:770001,kind:'summon',type:'probe',x:gravel.x,y:gravel.y,hp:10,maxHp:10,deployed:true,statuses:[]};
 b.s.summons.push(summon);b.s.units.push(summon);
 assert.equal(b.s.lastDeployedKazimierz,true);
});

test('耀骑士临光：上一名部署为卡西米尔时部署真伤结算两次',()=>{
 for(const flag of [true,false]){
  const {b}=openBattle(['chess_char_6_17_a']);
  const u=byId(b,'char_1014_nearl2'),e=enemy(b,{x:u.x+1,y:u.y,hp:100000,atk:0});
  b.s.lastDeployedKazimierz=flag;
  const hp=e.hp,atk=b.stats(u).atk;
  b.deploy(u);
  assert.ok(Math.abs((hp-e.hp)-0.8*atk*(flag?2:1))<1e-6,`flag=${flag} 时伤害应为 ${flag?2:1} 次`);
 }
 // 端到端：先砾后临光 = 两次
 const {b}=openBattle(['chess_char_2_12_b','chess_char_6_17_a']);
 const gravel=byId(b,'char_237_gravel'),nearl=byId(b,'char_1014_nearl2');
 const e=enemy(b,{x:nearl.x,y:nearl.y+1,hp:100000,atk:0});
 for(const u of b.s.units)u.deployed=false;
 const hp=e.hp,atk=b.stats(nearl).atk;
 b.deploy(gravel);b.deploy(nearl);
 assert.ok(Math.abs((hp-e.hp)-1.6*atk)<1e-6,'卡西米尔在前 → 两次伤害');
});

test('焰尾「红松骑士团团长」是物理闪避，且闪避率读天赋黑板 prob',()=>{
 const {b}=openBattle([{chessId:'chess_char_4_19_b',skillIndex:0},'chess_char_2_18_b']);
 deployNow(b);
 const flam=byId(b,'char_420_flamtl'),ally=byId(b,'char_431_ashlok');
 assert.ok(b.profile(ally).bonds.includes('kazimierzShip'));
 const talent=b.profile(flam).activeTalents.find(t=>t.name==='红松骑士团团长');
 const row=talent.blackboard.find(r=>r.key==='prob');
 assert.equal(row.value,0.22);
 const hit=(type,amount=200)=>{ally.hp=ally.maxHp;const hp=ally.hp;b.hurt(ally,{uid:771,id:'probe-enemy',kind:'enemy',x:ally.x+1,y:ally.y,atk:100,damageType:type},{damageAmount:amount,cause:'attack'});return hp-ally.hp;};
 const original=row.value;
 try{
  b.economy.random=()=>0;                                   // 必定命中闪避判定
  assert.equal(hit('physical'),0,'物理伤害可以被闪避');
  assert.equal(hit('arts'),200,'法术伤害不该被这条物理闪避躲掉');
  assert.equal(hit('true'),200,'真实伤害不闪避');
  row.value=0;assert.ok(hit('physical')>0,'prob=0 时不再闪避（说明读的是黑板）');
  row.value=1;b.economy.random=()=>.5;assert.equal(hit('physical'),0,'prob=1 时任意随机数都闪避');
 }finally{row.value=original;b.economy.random=()=>0;}
});

test('玛恩纳「无动于衷」：常驻嘲讽 +1，且反弹不依赖技能',()=>{
 const {b}=openBattle(['chess_char_5_19_a','chess_char_6_17_b','chess_char_4_17_b']);
 deployNow(b);
 const mly=byId(b,'char_4064_mlynar'),nearl=byId(b,'char_1014_nearl2'),other=byId(b,'char_4116_blkkgt')||b.s.units.find(u=>u.id==='char_4064_mlynar');
 assert.equal(b.stats(mly).tauntLevel,1,'天赋黑板 taunt_level=1 必须生效（文案是「自身更容易受到攻击」）');
 assert.equal(b.skillActive(mly),false,'这里刻意不让他开技能');
 const mk=()=>{const o={uid:8899,id:'probe-enemy',kind:'enemy',x:nearl.x+1,y:nearl.y,hp:100000,maxHp:100000,atk:50,damageType:'physical'};b.s.enemies.push(o);return o;};
 const foe=mk(),hp0=foe.hp;
 b.hurt(nearl,foe,{damageAmount:50,cause:'attack'});
 assert.ok(Math.abs((hp0-foe.hp)-0.15*b.stats(mly).atk)<1e-6,'卡西米尔干员被攻击时按玛恩纳攻击力 15% 反弹真实伤害');
 // 非卡西米尔队友不享受反弹（用没有反伤天赋的角峰做对照）
 const {b:b2}=openBattle(['chess_char_5_19_a','chess_char_1_02_b']);
 deployNow(b2);
 const mly2=byId(b2,'char_4064_mlynar'),plain=byId(b2,'char_199_yak');
 assert.ok(!b2.profile(plain).bonds.includes('kazimierzShip'));
 const foe2={uid:8898,id:'probe-enemy',kind:'enemy',x:plain.x+1,y:plain.y,hp:100000,maxHp:100000,atk:50,damageType:'physical'};
 b2.s.enemies.push(foe2);const hp2=foe2.hp;
 b2.hurt(plain,foe2,{damageAmount:50,cause:'attack'});
 assert.equal(hp2-foe2.hp,0,'非卡西米尔干员被攻击不触发反弹');
 assert.ok(other&&mly2);
});

test('玛恩纳 S3 对范围内卡西米尔攻击附加一次真伤，阻挡与读档都不递归',()=>{
 const {g,b}=openBattle([
  {chessId:'chess_char_5_19_a',skillIndex:2},
  'chess_char_1_19_a','chess_char_2_12_a','chess_char_2_18_a',
  'chess_char_3_12_a','chess_char_3_17_a',
 ]);
 assert.equal(b.rows.kazimierzShip.count,6,'启用六名不同卡西米尔干员效果');
 const mly=byId(b,'char_4064_mlynar'),blocker=byId(b,'char_237_gravel');
 mly.x=4;mly.y=3;mly.dir=0;mly.sp=b.spCost(mly);b.activate(mly);
 blocker.x=5;blocker.y=3;
 const boss=enemy(b,{id:'boss-probe',x:5,y:3,hp:1e9,block:blocker.uid});
 assert.equal(b.skillActive(mly),true,'玛恩纳 S3 开启');
 assert.equal(b.inside(mly,boss,true),true,'Boss 位于玛恩纳 S3 范围内');
 const scale=Number(b.profile(mly).skill.blackboard.find(x=>x.key==='atk_scale')?.value);
 assert.ok(scale>0,'S3 黑板提供卡西米尔附伤倍率');
 const atk=b.stats(mly).atk;
 const hit=(battle,source,target)=>{
  const before=target.hp;
  assert.doesNotThrow(()=>dealDamage(battle,{source,target,amount:100,type:'physical',cause:'skill',skill:true}));
  return before-target.hp;
 };
 assert.ok(Math.abs(hit(b,mly,boss)-(100+atk*scale))<1e-6,'本次伤害只附加一次 S3 真伤');
 const distant=enemy(b,{id:'distant-probe',x:10,y:6,hp:1e6});
 assert.equal(b.inside(mly,distant,true),false,'远处敌人不在玛恩纳 S3 范围');
 const distantHp=distant.hp;
 assert.doesNotThrow(()=>dealDamage(b,{source:blocker,target:distant,amount:100,type:'physical',cause:'attack'}));
 assert.equal(distantHp-distant.hp,100,'范围外卡西米尔攻击不附加玛恩纳 S3 真伤');

 const restored=NativeSession.restore(NATIVE_DATA,g.snapshot());
 assert.ok(restored,'读档成功');
 const rb=restored.battle,rmly=byId(rb,'char_4064_mlynar'),rblocker=byId(rb,'char_237_gravel'),rboss=rb.s.enemies.find(e=>e.id==='boss-probe');
 assert.ok(rb&&rmly&&rblocker&&rboss,'读档保留玛恩纳、阻挡者与 Boss');
 assert.ok(Math.abs(hit(rb,rmly,rboss)-(100+rb.stats(rmly).atk*scale))<1e-6,'读档后再次攻击仍只结算一次');

 const hp=rboss.hp;
 assert.doesNotThrow(()=>dealDamage(rb,{source:rboss,target:rblocker,amount:100,type:'physical',cause:'attack'}));
 assert.ok(Math.abs((hp-rboss.hp)-rb.stats(rmly).atk*.15)<1e-6,'敌人攻击卡西米尔时只反弹一次玛恩纳天赋真伤');
});

test('条件式嘲讽天赋：技能开启时才生效（远牙「屏息」）',()=>{
 const {b}=openBattle(['chess_char_4_20_b']);
 deployNow(b);
 const u=b.s.units[0];
 const talent=b.profile(u).activeTalents.find(t=>/不容易成为敌人的?目标/.test(t.description||''));
 assert.ok(talent,'远牙「屏息」应当带嘲讽文案');
 assert.ok(talent.blackboard.some(r=>r.key==='taunt_level'&&Number(r.value)<0),'屏息的黑板 taunt_level 是负值');
 // 只看天赋这条通道（statMods），排除技能自身对嘲讽的影响
 assert.equal(statMods(b,u).add.tauntLevel,0,'技能未开启时天赋不生效');
 u.sp=b.spCost(u);b.activate(u);
 assert.equal(statMods(b,u).add.tauntLevel,-1,'技能开启时天赋 −1 生效');
});
