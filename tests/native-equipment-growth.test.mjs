import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {dealDamage,dispatch} from '../dist/native-effects.js';
import {applyStatus} from '../dist/status.js';
import {spCap} from '../dist/native-sp.js';
import {enemy} from './effects-harness.mjs';
import {equipRune,equipMagicPenetration,equipWeakness} from '../dist/native-equipment.js';

// 装备效果补全（第二批）：叠层成长、回复/技力、成对联动、战斗期新机制、跨回合装备。
// 判定口径见 EQUIPMENT_EFFECT_AUDIT.md 的「落地进度」。
const ITEM={
 knife:'chess_item_3_04_e_a',accel:'chess_item_4_03_e_a',flag:'chess_item_4_07_e_a',cauldron:'chess_item_6_03_e_a',
 badge:'chess_item_6_11_e_a',compass:'chess_item_6_07_e_a',helm:'chess_item_5_09_e_a',spear:'chess_item_6_01_e_a',
 gun:'chess_item_6_02_e_a',clip:'chess_item_4_08_e_a',tear:'chess_item_6_06_e_a',decree:'chess_item_6_10_e_a',
 steam:'chess_item_6_05_e_a',suit:'chess_item_3_01_e_a',projection:'chess_item_5_06_e_a',arm:'chess_item_5_03_e_a',
 laser:'chess_item_3_03_e_a',burn:'chess_item_4_09_e_a',accelHammer:'chess_item_3_10_e_a',trembleHammer:'chess_item_2_03_e_a',
 ice:'chess_item_5_02_e_a',tea:'chess_item_2_04_e_a',ration:'chess_item_3_05_e_a',trench:'chess_item_6_04_e_a',
 egirBlade:'chess_item_3_07_e_a',
};
const OP={
 ghost:'char_143_ghost',victoria:'char_494_vendla',victoriaMelee:'char_222_bpipe',kjerag:'char_199_yak',
 siracusa:'char_145_prove',kazimierz:'char_496_wildmn',yan:'char_306_leizi',sargon:'char_127_estell',laterano:'char_498_inside',
 swift:'char_496_wildmn',swiftMate:'char_4151_tinman',
};
function startSession(specs,{seed=5}={}){
 const g=new NativeSession(NATIVE_DATA,{seed,bandId:'band_bldsk'});
 g.s.funds=9999;g.s.capacity=16;g.s.rewardPending=null;g.s.rewardQueue=[];
 const made=specs.map(spec=>{
  const charId=typeof spec==='string'?spec:spec.charId;
  const profile=Object.values(NATIVE_DATA.profiles).find(p=>p?.charId===charId);
  const unit=g.gain(profile.chessId);
  g.s.rewardPending=null;g.s.rewardQueue=[];
  return {unit,items:(typeof spec==='string'?[]:spec.items)||[]};
 });
 for(const {unit} of made){
  let placed=false;
  for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++){
   if(g.s.units.some(v=>v.uid!==unit.uid&&v.position?.x===x&&v.position?.y===y))continue;
   if(g.canDeploy(unit.uid,x,y))placed=g.deploy(unit.uid,x,y,0);
  }
  assert.ok(placed,'干员需要落场');
 }
 for(const {unit,items} of made)for(const id of items){const item=g.gainItem(id);assert.equal(g.equip(item.uid,unit.uid),true,`装备 ${id} 应当成功`);}
 assert.equal(g.perform('start'),true,g.lastError||'开战失败');
 const b=g.battle;b.s.queue=[];b.s.enemies=[];b.s.limit=1e9;
 // 留一只场外木桩，否则清场后 step() 直接判定战斗结束、时间不再前进
 enemy(b,{hp:1e12,x:-8,y:-8,trainingDummy:true,hidden:true,untargetable:true,invulnerable:true});
 const units=made.map(x=>b.s.units.find(v=>v.uid===x.unit.uid));
 for(const u of units)b.deploy(u);
 b.step();
 return {g,b,units,u:units[0]};
}
const setup=(charId,items=[],opts)=>startSession([{charId,items}],opts);
const attack=(b,u,e,amount=100,type='physical')=>b.hit(u,e,amount,type);
const atkOf=b=>b.stats(b.s.units[0]).atk;

test('炎国短刀：每开技 +5% 攻击（上限 10 层），0 层时不加',()=>{
 const base=setup(OP.ghost,[]),withKnife=setup(OP.ghost,[ITEM.knife]);
 assert.ok(Math.abs(atkOf(withKnife.b)-atkOf(base.b))<1e-6,'0 层时不该有常驻攻击加成（通用通道已排除该行）');
 for(let i=0;i<3;i++)dispatch(withKnife.b,'skill-start',{target:withKnife.u});
 assert.ok(Math.abs(atkOf(withKnife.b)-atkOf(base.b)*1.15)<1e-6,`3 层应当是 +15%（实际 ${atkOf(withKnife.b).toFixed(1)} vs ${(atkOf(base.b)*1.15).toFixed(1)}）`);
 assert.equal(withKnife.u.equipSkillUses,3);
 for(let i=0;i<20;i++)dispatch(withKnife.b,'skill-start',{target:withKnife.u});
 assert.equal(withKnife.u.equipSkillUses,10,'层数上限 atk_buff_cnt=10');
 assert.ok(Math.abs(atkOf(withKnife.b)-atkOf(base.b)*1.5)<1e-6,'10 层封顶 +50%');
});

test('有限加速器：每次攻击或治疗后 +1 攻速，最高 60 层',()=>{
 const base=setup(OP.ghost,[]),accel=setup(OP.ghost,[ITEM.accel]);
 const baseSpeed=base.b.stats(base.u).attackSpeed;
 const e=enemy(accel.b,{x:accel.u.x+1,y:accel.u.y,hp:1e6,def:0});
 for(let i=0;i<3;i++)attack(accel.b,accel.u,e);
 assert.equal(accel.u.equipAspdStacks,3);
 assert.ok(Math.abs(accel.b.stats(accel.u).attackSpeed-(baseSpeed+3))<1e-6,'3 次攻击应当 +3 攻速');
 accel.u.equipAspdStacks=999;
 assert.ok(Math.abs(accel.b.stats(accel.u).attackSpeed-(baseSpeed+60))<1e-6,'上限 max_buff_cnt=60');
});

test('天师古鼎：本回合每获得 1 名干员 +25 攻速（上限 3 层）',()=>{
 const base=setup(OP.yan,[]),cauldron=setup(OP.yan,[ITEM.cauldron]);
 const baseSpeed=base.b.stats(base.u).attackSpeed;
 cauldron.g.s.roundGainedChars={round:cauldron.g.s.round,count:2};
 assert.ok(Math.abs(cauldron.b.stats(cauldron.u).attackSpeed-(baseSpeed+50))<1e-6,'获得 2 名干员应当 +50 攻速');
 cauldron.g.s.roundGainedChars={round:cauldron.g.s.round,count:9};
 assert.ok(Math.abs(cauldron.b.stats(cauldron.u).attackSpeed-(baseSpeed+75))<1e-6,'上限 max_cnt=3');
});

test('天师古鼎＋炎国短刀：炎干员每次获得干员给 2 资金（每回合最多 3 次）',()=>{
 const g=new NativeSession(NATIVE_DATA,{seed:7,bandId:'band_bldsk'});
 g.s.funds=9999;
 const owner=g.gain(NATIVE_DATA.profiles['chess_char_1_03_a'].chessId);
 g.s.rewardPending=null;g.s.rewardQueue=[];
 for(const id of [ITEM.cauldron,ITEM.knife])assert.equal(g.equip(g.gainItem(id).uid,owner.uid),true);
 const before=g.s.funds,picks=Object.values(NATIVE_DATA.season.charShopChessDatas).filter(s=>s.charId&&!s.isHidden).slice(0,4).map(s=>s.chessId);
 for(const id of picks){g.gain(id);g.s.rewardPending=null;g.s.rewardQueue=[];}
 assert.equal(g.s.funds-before,6,'4 次获得只结算 3 次，每次 2 资金');
 const roundBefore=g.s.round;g.s.round=roundBefore+1;
 g.gain(picks[0]);g.s.rewardPending=null;g.s.rewardQueue=[];
 assert.equal(g.s.funds-before,8,'新回合重新计数');
});

test('卡西米尔竞技旗：部署后 15 秒内伤害 ×1.35，之后每 0.5 秒衰减 4%，不低于 100%',()=>{
 const {b,u}=setup(OP.ghost,[ITEM.flag]);
 const e=enemy(b,{x:u.x+1,y:u.y,hp:1e9});
 const shot=()=>{const before=e.hp;attack(b,u,e,100,'true');return before-e.hp;};
 assert.ok(Math.abs(shot()-135)<1e-6,'窗口内应当是 135');
 b.s.time+=16; // 15 秒窗口外 1 秒 → 衰减 2 档
 assert.ok(Math.abs(shot()-127)<1e-6,`窗口外 1 秒应当衰减到 127（实际 ${shot()}）`);
 b.s.time+=40;
 assert.ok(Math.abs(shot()-100)<1e-6,'衰减不会低于 100%');
});

test('黄沙罗盘：部署时 +30 初始技力；【萨尔贡】首次技能结束回复 30 点技力',()=>{
 const base=setup(OP.sargon,[]),compass=setup(OP.sargon,[ITEM.compass]);
 const skill=compass.b.profile(compass.u).skill,cost=compass.b.spCost(compass.u);
 const expect=Math.min(spCap(skill,cost),base.u.sp+30);
 assert.equal(compass.u.sp,expect,'初始技力 +init_sp（受技力上限约束）');
 compass.u.sp=0;compass.u.skillLeft=0;
 dispatch(compass.b,'skill-end',{target:compass.u});
 assert.equal(compass.u.sp,Math.min(spCap(skill,cost),30),'首次技能结束回复 30 点技力');
 compass.u.sp=0;dispatch(compass.b,'skill-end',{target:compass.u});
 assert.equal(compass.u.sp,0,'只有首次技能结束触发');
});

test('黄沙罗盘＋萨尔贡浓茶：每次开技为全部萨尔贡干员回复 3 点技力',()=>{
 const {b,u}=startSession([{charId:OP.sargon,items:[ITEM.compass,ITEM.tea]}]);
 u.sp=0;u.skillLeft=0;
 dispatch(b,'skill-start',{target:u});
 assert.equal(u.sp,3,'开技时给自己（同属萨尔贡）回 3 点技力');
 const solo=setup(OP.sargon,[ITEM.compass]);
 solo.u.sp=0;solo.u.skillLeft=0;
 dispatch(solo.b,'skill-start',{target:solo.u});
 assert.equal(solo.u.sp,0,'没装备萨尔贡浓茶就不触发');
});

test('天马之盔：与天马之枪成对时每秒回复 8% 最大生命',()=>{
 const solo=setup(OP.ghost,[ITEM.helm]);
 solo.u.hp=solo.u.maxHp*0.5;
 for(let i=0;i<32;i++)solo.b.step();
 assert.ok(solo.u.hp<=solo.u.maxHp*0.52,'单独装备不回血');
 const pair=setup(OP.ghost,[ITEM.helm,ITEM.spear]);
 pair.u.hp=pair.u.maxHp*0.5;
 const before=pair.u.hp;
 for(let i=0;i<32;i++)pair.b.step();
 assert.ok(pair.u.hp-before>=pair.u.maxHp*0.07,`约 1 秒应当回复 8% 最大生命（实际 ${((pair.u.hp-before)/pair.u.maxHp*100).toFixed(1)}%）`);
});

test('耶拉冈德之泪：【谢拉格】携带者范围内寒冷/冻结的敌人每秒受 30% 攻击力法术伤害，成对不融冰提升到 100%',()=>{
 const solo=setup(OP.kjerag,[ITEM.tear]);
 // 缴械：避免携带者的普通攻击混进每秒伤害里（本条只测耶拉冈德之泪的秒伤）
 applyStatus(solo.u,'disarm',30,{source:null,resistible:false});
 const atk=solo.b.stats(solo.u).atk;
 const e1=enemy(solo.b,{x:solo.u.x,y:solo.u.y,hp:1e6,res:0});
 applyStatus(e1,'cold',30,{source:null,resistible:false});
 const before=e1.hp;
 for(let i=0;i<33;i++)solo.b.step();
 const dealt=before-e1.hp;
 assert.ok(Math.abs(dealt-atk*0.3)<atk*0.05,`每秒一次 30% 攻击力法术伤害（实际 ${(dealt/atk).toFixed(2)} 倍）`);
 const pair=setup(OP.kjerag,[ITEM.tear,ITEM.ice]);
 applyStatus(pair.u,'disarm',30,{source:null,resistible:false});
 const pairAtk=pair.b.stats(pair.u).atk;
 const e2=enemy(pair.b,{x:pair.u.x,y:pair.u.y,hp:1e6,res:0});
 applyStatus(e2,'frozen',30,{source:null,resistible:false});
 const before2=e2.hp;
 for(let i=0;i<33;i++)pair.b.step();
 const dealt2=before2-e2.hp;
 assert.ok(Math.abs(dealt2-pairAtk*1)<pairAtk*0.05,`成对时提升到 100% 攻击力（实际 ${(dealt2/pairAtk).toFixed(2)} 倍）`);
});

test('骑士戒律：卡西米尔携带者开技后 20 秒内压制范围内敌人攻速与移速',()=>{
 const {b,u}=setup(OP.kazimierz,[ITEM.decree]);
 const e=enemy(b,{x:u.x+1,y:u.y,hp:1e6,def:0});
 dispatch(b,'skill-start',{target:u});
 assert.ok(u.knightDecreeUntil>b.s.time,'开技后进入 20 秒窗口');
 b.step();
 assert.ok(e.attackSpeedMod<0,`窗口内敌人攻速被压低（实际 ${e.attackSpeedMod}）`);
 assert.ok(Math.abs(e.moveSpeedMod-0.65)<1e-9,'移速 ×0.65');
 u.knightDecreeUntil=0;b.step();
 assert.equal(e.moveSpeedMod,1,'窗口结束后恢复');
});

test('骑士戒律＋卡西米尔竞技旗：技能期攻击力 +100%，致死不撤退、技能结束退场',()=>{
 const {b,u}=setup(OP.kazimierz,[ITEM.decree,ITEM.flag]);
 assert.equal((b.stats(u).parts||[]).some(p=>p.src==='装备·骑士戒律'),false,'没开技时不给攻击加成');
 u.skillLeft=10;
 const part=(b.stats(u).parts||[]).find(p=>p.src==='装备·骑士戒律');
 assert.ok(part&&Math.abs(part.v-1)<1e-9,'技能期 +100% 攻击');
 const e=enemy(b,{x:u.x+1,y:u.y,hp:1e6});
 dealDamage(b,{source:e,target:u,amount:u.maxHp*10,type:'true'});
 assert.ok(u.hp>=1&&u.equipRetreatAtSkillEnd===true,'致命伤不撤退');
 u.skillLeft=0;u.equipRetreatAtSkillEnd=true;
 b.step();
 assert.equal(u.deployed,false,'技能结束后退场');
});

test('叙拉古正装：部署方向左右两侧的我方干员攻速 +10',()=>{
 const {b,units}=startSession([{charId:OP.siracusa,items:[ITEM.suit]},{charId:OP.ghost}]);
 const [suit,ally]=units;
 suit.x=3;suit.y=3;suit.dir=0; // 朝向 [1,0] → 左右是 (x,y+1)/(x,y-1)
 ally.x=3;ally.y=4;
 const near=b.stats(ally).attackSpeed;
 ally.y=5; // 斜前方两格外（不在左右两侧）
 const far=b.stats(ally).attackSpeed;
 assert.ok(Math.abs(near-far-10)<1e-6,`左右两侧应当 +10 攻速（${near} vs ${far}）`);
 suit.x=-6;suit.y=-6; // 携带者离场/走远
 assert.ok(Math.abs(b.stats(ally).attackSpeed-far)<1e-6,'不在两侧就不给');
});

test('拉特兰桥夹：子弹技能剩余一发时概率恢复 40% 子弹，每次部署最多 3 次',()=>{
 const {b,u}=setup(OP.laterano,[ITEM.clip]);
 u.ammoMax=10;
 b.economy.random=()=>0.999;
 u.ammo=1;dispatch(b,'ammo',{source:u,target:u,used:1});
 assert.equal(u.ammo,1,'概率未命中不恢复');
 b.economy.random=()=>0;
 u.ammo=1;dispatch(b,'ammo',{source:u,target:u,used:1});
 assert.equal(u.ammo,5,'恢复 40%×10=4 发');
 assert.equal(u.equipAmmoRestores,1);
 u.ammo=1;dispatch(b,'ammo',{source:u,target:u,used:1});
 u.ammo=1;dispatch(b,'ammo',{source:u,target:u,used:1});
 assert.equal(u.equipAmmoRestores,3);
 const before=u.ammo;
 dispatch(b,'ammo',{source:u,target:u,used:1});
 assert.equal(u.ammo,before,'每次部署最多触发 max_trigger_cnt=3 次');
});

test('铳骑之威：拉特兰干员攻击时有概率追加一发子弹',()=>{
 const {b,u}=setup(OP.laterano,[ITEM.gun]);
 const first=enemy(b,{x:u.x+1,y:u.y,hp:1e6,def:0});
 const second=enemy(b,{x:u.x+1,y:u.y+1,hp:1e6,def:0});
 b.economy.random=()=>0;
 const before=second.hp;
 attack(b,u,first,10);
 assert.ok(before-second.hp>0,'应当对范围内另一名敌人追加子弹');
});

test('激光发射器：攻击无视 25% 法术抗性',()=>{
 const {b,u}=setup(OP.ghost,[ITEM.laser]);
 assert.equal(equipMagicPenetration(b,u),0.25);
 const e=enemy(b,{x:u.x+1,y:u.y,hp:1e6,res:40});
 const before=e.hp;
 attack(b,u,e,100,'arts');
 assert.ok(Math.abs(before-e.hp-70)<1e-6,`40 法抗被无视 25% 后按 30 计算（实际 ${(before-e.hp).toFixed(1)}）`);
});

test('双模机械臂：物理/法术伤害按敌人防御与法抗取更高的那种（弱点伤害）',()=>{
 const {b,u}=setup(OP.ghost,[ITEM.arm]);
 assert.equal(equipWeakness(b,u),true);
 const e=enemy(b,{x:u.x+1,y:u.y,hp:1e6,def:0,res:50});
 const before=e.hp;
 attack(b,u,e,100,'arts');
 assert.ok(Math.abs(before-e.hp-100)<1e-6,`应当按物理结算（实际 ${(before-e.hp).toFixed(1)}）`);
 const plain=setup(OP.ghost,[]);
 const e2=enemy(plain.b,{x:plain.u.x+1,y:plain.u.y,hp:1e6,def:0,res:50});
 const before2=e2.hp;
 attack(plain.b,plain.u,e2,100,'arts');
 assert.ok(Math.abs(before2-e2.hp-50)<1e-6,'没装备时法术伤害照旧吃 50 法抗');
});

test('灼燃维式重锤：造成法术伤害附带 10% 灼燃损伤',()=>{
 const {b,u}=setup(OP.ghost,[ITEM.burn]);
 const e=enemy(b,{x:u.x+1,y:u.y,hp:1e6,def:0,res:0});
 attack(b,u,e,100,'arts');
 assert.ok(Math.abs((e.elemental?.burn||0)-10)<1e-6,`100 点法术伤害应当附带 10 点灼燃损伤（实际 ${e.elemental?.burn}）`);
});

test('蒸汽之心：【维多利亚】携带者获得维式重锤特殊效果（攻速），携带系列装备时翻倍，非维多利亚不获得',()=>{
 const base=setup(OP.victoria,[]).b;
 const baseSpeed=base.stats(base.s.units[0]).attackSpeed;
 const steam=setup(OP.victoria,[ITEM.steam]);
 assert.ok(Math.abs(steam.b.stats(steam.u).attackSpeed-(baseSpeed+35+30))<1e-6,'维多利亚携带者额外获得 +30 攻速');
 const doubled=setup(OP.victoria,[ITEM.steam,ITEM.accelHammer]);
 assert.ok(Math.abs(doubled.b.stats(doubled.u).attackSpeed-(baseSpeed+35+60))<1e-6,`携带加速维式重锤时该件效果翻倍（实际 ${doubled.b.stats(doubled.u).attackSpeed}）`);
 const egir=setup(OP.ghost,[ITEM.steam]);
 const egirBase=setup(OP.ghost,[]).b;
 assert.ok(Math.abs(egir.b.stats(egir.u).attackSpeed-(egirBase.stats(egirBase.s.units[0]).attackSpeed+35))<1e-6,'非维多利亚只吃攻击速度+35');
 const tremble=setup(OP.victoriaMelee,[ITEM.steam]);
 const target=enemy(tremble.b,{x:tremble.u.x+1,y:tremble.u.y,hp:1e6,def:0});
 tremble.b.economy.random=()=>0;
 attack(tremble.b,tremble.u,target);
 const st=(target.statuses||[]).find(s=>s.kind==='tremble');
 assert.ok(st&&Math.abs(st.remaining-2)<1e-9,'地面携带者攻击时按战栗锤的概率与时长触发');
});

test('家族徽章：【叙拉古】携带者隐匿期间攻击力成长，失去隐匿后首次伤害清空（成对时追加真实伤害）',()=>{
 const {b,u}=setup(OP.siracusa,[ITEM.badge]);
 const base=b.stats(u).atk;
 applyStatus(u,'invisible',30,{source:null,resistible:false});
 u.invisible=true;
 for(let i=0;i<64;i++)b.step();
 assert.ok(u.familyBadgeAtk>0,'隐匿期间攻击力逐渐提升');
 const grown=b.stats(u).atk;
 assert.ok(grown>base,`成长应当进 stats（${grown} > ${base}）`);
 assert.ok(u.familyBadgeAtk<=1,'上限 max_atk=100%');
 u.invisible=false;u.statuses=(u.statuses||[]).filter(s=>s.kind!=='invisible');
 const e=enemy(b,{x:u.x+1,y:u.y,hp:1e6,def:0});
 attack(b,u,e,10);
 assert.equal(u.familyBadgeAtk,0,'失去隐匿后首次造成伤害即清空');
});

test('博士投影（普通）：下个回合开始时销毁装备并把携带者晋升为精锐干员',()=>{
 const g=new NativeSession(NATIVE_DATA,{seed:11,bandId:'band_bldsk'});
 g.s.funds=9999;
 const unit=g.gain(NATIVE_DATA.profiles['chess_char_1_03_a'].chessId);
 g.s.rewardPending=null;g.s.rewardQueue=[];
 const item=g.gainItem(ITEM.projection);
 assert.equal(g.equip(item.uid,unit.uid),true);
 assert.equal(unit.equipment.length,1,'装备先留在身上，下回合才销毁');
 g.s.phase='intermission';
 assert.equal(g.advanceRound(),true,'进入下一个回合');
 assert.equal(unit.chessId,NATIVE_DATA.season.charChessDataDict['chess_char_1_03_a'].upgradeChessId,'晋升为精锐干员');
 assert.equal(unit.equipment.length,0,'装备已销毁');
});

test('变形同构体：原表天赋列出的映射与装备 giveBondId 逐条一致（额外盟约走同一通道）',()=>{
 const table=JSON.parse(fs.readFileSync('data/gamedata/allianceLower/character_table.json','utf8'));
 const text=table.trap_1073_acarm073.talents[0].candidates[0].description;
 const pairs=[...text.matchAll(/“(.+?)”(?:系列装备)?→【(.+?)】盟约/g)].map(m=>[m[1],m[2]]);
 assert.ok(pairs.length>=14,`原表映射应当有 14 条（实际 ${pairs.length}）`);
 const bondIdByName=new Map(Object.entries(NATIVE_DATA.season.bondInfoDict).map(([id,b])=>[b.name,id]));
 const items=Object.entries(NATIVE_DATA.season.trapChessDataDict).filter(([,t])=>t.itemType==='EQUIP');
 for(const [itemName,bondName] of pairs){
  const bondId=bondIdByName.get(bondName);
  assert.ok(bondId,`盟约名 ${bondName} 应当能在原表里找到 id`);
  const matched=items.filter(([,t])=>(NATIVE_DATA.season.effectInfoDataDict[t.effectId]?.effectName||'').includes(itemName));
  assert.ok(matched.length,`装备名 ${itemName} 应当能在原表里找到`);
  for(const [chessId,t] of matched)assert.equal(t.giveBondId,bondId,`${itemName}(${chessId}) 的 giveBondId 应当就是【${bondName}】`);
 }
});

test('迅捷作战粮：部署时给 3 点技力，每有一个同盟约的其他干员再加 3 点',()=>{
 const solo=setup(OP.swift,[ITEM.ration]);
 const mate=startSession([{charId:OP.swift,items:[ITEM.ration]},{charId:OP.swiftMate}]);
 assert.equal(mate.g.s.units.length,2,'两名干员都应当在场上');
 assert.equal(mate.u.sp,solo.u.sp+3,`多一个同盟约友军应当多给 3 点技力（${mate.u.sp} vs ${solo.u.sp}）`);
});

test('海沟实验体：【阿戈尔】携带者受击时对来源造成 50% 攻击力法术伤害（成对阿戈尔重刃两次）',()=>{
 const {b,u}=setup(OP.ghost,[ITEM.trench]);
 const e=enemy(b,{x:u.x+1,y:u.y,hp:1e6,def:0,res:0});
 const atk=b.stats(u).atk,before=e.hp;
 dealDamage(b,{source:e,target:u,amount:10,type:'physical'});
 assert.ok(Math.abs(before-e.hp-atk*0.5)<1e-6,`反伤应当是 50% 攻击力（实际 ${((before-e.hp)/atk).toFixed(2)} 倍）`);
 const pair=setup(OP.ghost,[ITEM.trench,ITEM.egirBlade]);
 const atk2=pair.b.stats(pair.u).atk,e2=enemy(pair.b,{x:pair.u.x+1,y:pair.u.y,hp:1e6,def:0,res:0});
 const before2=e2.hp;
 dealDamage(pair.b,{source:e2,target:pair.u,amount:10,type:'physical'});
 assert.ok(Math.abs(before2-e2.hp-atk2)<1e-6,`成对阿戈尔重刃应当反伤两次（实际 ${((before2-e2.hp)/atk2).toFixed(2)} 倍）`);
});

test('天马之枪：与天马之盔成对时额外造成 30% 攻击力真实伤害',()=>{
 const solo=setup(OP.ghost,[ITEM.spear]);
 // 高防御敌人：真实伤害不吃防御，普通物理伤害会被压到 5% 下限
 const e=enemy(solo.b,{x:solo.u.x+1,y:solo.u.y,hp:1e6,def:9999});
 const before=e.hp;
 attack(solo.b,solo.u,e,100,'physical');
 const soloDealt=before-e.hp;
 const pair=setup(OP.ghost,[ITEM.spear,ITEM.helm]);
 const e2=enemy(pair.b,{x:pair.u.x+1,y:pair.u.y,hp:1e6,def:9999});
 const atk2=pair.b.stats(pair.u).atk,before2=e2.hp;
 attack(pair.b,pair.u,e2,100,'physical');
 assert.ok(Math.abs((before2-e2.hp)-soloDealt-atk2*0.3)<1,`成对时应当多出 30% 攻击力的真实伤害（实际 ${(before2-e2.hp-soloDealt).toFixed(1)} vs ${(atk2*0.3).toFixed(1)}）`);
});

test('“神秘顾客”主动销毁时给 1 份资金',()=>{
 const g=new NativeSession(NATIVE_DATA,{seed:13,bandId:'band_bldsk'});
 g.s.funds=20;
 const item=g.gainItem('chess_item_6_01_m');
 assert.equal(g.s.items.some(i=>i.uid===item.uid),true,'道具应当在整备区');
 const before=g.s.funds;
 assert.equal(g.destroyItem(item.uid),true);
 assert.equal(g.s.funds,before+1,'原表 trap_disney_special 的 count=1');
});
