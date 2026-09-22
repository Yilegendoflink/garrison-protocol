import test from 'node:test';import assert from 'node:assert/strict';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {dealDamage} from '../dist/native-effects.js';
import {applyStatus} from '../dist/status.js';
import {enemy} from './effects-harness.mjs';
import {equipRune,equipmentList} from '../dist/native-equipment.js';

// 按 EQUIPMENT_EFFECT_AUDIT.md 补装的装备效果：概率触发、受击减伤、保命、部署期效果。
const ITEM={
 tremble:'chess_item_2_03_e_a',ice:'chess_item_5_02_e_a',arcane:'chess_item_3_08_e_a',grenade:'chess_item_3_11_e_a',
 brood:'chess_item_4_06_e_a',scope:'chess_item_3_02_e_a',riot:'chess_item_4_05_e_a',trench:'chess_item_6_04_e_a',
 undead:'chess_item_3_09_e_a',m3:'chess_item_4_12_e_a',salt:'chess_item_4_10_e_a',camo:'chess_item_4_04_e_a',
 drone:'chess_item_4_11_e_a',buzzer:'chess_item_4_02_e_a',ejector:'chess_item_2_01_e_a',helmet:'chess_item_3_06_e_a',
 ration:'chess_item_3_05_e_a',solvent:'chess_item_1_05_e_a',
};
function setup(charId,items=[],{seed=5}={}){
 const g=new NativeSession(NATIVE_DATA,{seed,bandId:'band_bldsk'});
 g.s.funds=9999;g.s.capacity=16;g.s.rewardPending=null;g.s.rewardQueue=[];
 const profile=Object.values(NATIVE_DATA.profiles).find(p=>p?.charId===charId);
 const unit=g.gain(profile.chessId);
 g.s.rewardPending=null;g.s.rewardQueue=[];
 let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(unit.uid,x,y))placed=g.deploy(unit.uid,x,y,0);
 assert.ok(placed,'干员需要落场');
 for(const id of items){const item=g.gainItem(id);assert.equal(g.equip(item.uid,unit.uid),true,`装备 ${id} 应当成功`);}
 assert.equal(g.perform('start'),true,g.lastError||'开战失败');
 const b=g.battle;b.s.queue=[];b.s.enemies=[];b.s.limit=1e9;
 // 留一只场外木桩，否则清场后 step() 会直接判定战斗结束、时间不再前进
 enemy(b,{hp:1e12,x:-8,y:-8,trainingDummy:true,hidden:true,untargetable:true,invulnerable:true});
 const u=b.s.units.find(x=>x.uid===unit.uid);
 b.deploy(u);
 b.step(); // 让 stats() 跑过一帧（浓缩嗅盐这类逐帧开关要靠它）
 return {g,b,u};
}
const kinds=u=>(u.statuses||[]).map(s=>s.kind);
const attack=(b,u,e,amount=100,type='physical')=>b.hit(u,e,amount,type); // 不加 skill → cause='attack'

test('装备能被正常装上并读到效果行',()=>{
 const {b,u}=setup('char_143_ghost',[ITEM.tremble]);
 assert.deepEqual(equipmentList(u).map(i=>i.chessId),[ITEM.tremble]);
 const row=equipRune(b,u,'act1autochess_equip_acarm045_global_buff');
 assert.ok(row,'应当能按符文名取到效果行');
 assert.equal(Number(row.bb.find(x=>x.key==='disarmed_duration').value),2);
});

test('战栗维式重锤：地面干员攻击时有概率使目标战栗（远程携带者不触发）',()=>{
 const {b,u}=setup('char_143_ghost',[ITEM.tremble]);
 const e=enemy(b,{x:u.x+1,y:u.y,hp:100000,def:0});
 b.economy.random=()=>0;
 attack(b,u,e);
 const st=(e.statuses||[]).find(s=>s.kind==='tremble');
 assert.ok(st,'近战携带者攻击应当挂上战栗');
 assert.equal(st.remaining??st.duration,2);
 const ranged=setup('char_103_angel',[ITEM.tremble]);
 const e2=enemy(ranged.b,{x:ranged.u.x+1,y:ranged.u.y,hp:100000,def:0});
 ranged.b.economy.random=()=>0;
 attack(ranged.b,ranged.u,e2);
 assert.equal(kinds(e2).includes('tremble'),false,'远程干员不触发这条“地面干员”效果');
});

test('谢拉格不融冰 / 奥术法阵：攻击时按概率或直接施加寒冷、沉默',()=>{
 const ice=setup('char_143_ghost',[ITEM.ice]);
 const target=enemy(ice.b,{x:ice.u.x+1,y:ice.u.y,hp:100000,def:0});
 ice.b.economy.random=()=>0;
 attack(ice.b,ice.u,target);
 assert.ok(kinds(target).includes('cold'),'概率命中时施加寒冷');
 const miss=setup('char_143_ghost',[ITEM.ice]);
 const t2=enemy(miss.b,{x:miss.u.x+1,y:miss.u.y,hp:100000,def:0});
 miss.b.economy.random=()=>0.999;
 attack(miss.b,miss.u,t2);
 assert.equal(kinds(t2).includes('cold'),false,'概率未命中就不挂');
 const arcane=setup('char_143_ghost',[ITEM.arcane]);
 const t3=enemy(arcane.b,{x:arcane.u.x+1,y:arcane.u.y,hp:100000,def:0});
 arcane.b.economy.random=()=>0.999;
 attack(arcane.b,arcane.u,t3);
 const silence=(t3.statuses||[]).find(s=>s.kind==='silence');
 assert.ok(silence,'奥术法阵没有概率，攻击必沉默');
 assert.equal(silence.remaining??silence.duration,5);
});

test('突袭手雷：部署后 10 秒内攻击晕眩目标，窗口外不再晕眩',()=>{
 const {b,u}=setup('char_143_ghost',[ITEM.grenade]);
 const e=enemy(b,{x:u.x+1,y:u.y,hp:100000,def:0});
 attack(b,u,e);
 assert.ok(kinds(e).includes('stun'),'窗口内攻击应当晕眩');
 const e2=enemy(b,{x:u.x+2,y:u.y,hp:100000,def:0});
 b.s.time+=11;
 attack(b,u,e2);
 assert.equal(kinds(e2).includes('stun'),false,'窗口外不再晕眩');
});

test('休眠子裔：每攻击一个目标回复自身 2% 最大生命',()=>{
 const {b,u}=setup('char_143_ghost',[ITEM.brood]);
 u.maxHp=1000;u.hp=500;
 const e=enemy(b,{x:u.x+1,y:u.y,hp:100000,def:0});
 attack(b,u,e);
 assert.equal(Math.round(u.hp),Math.round(500+u.maxHp*0.02));
});

test('精准狙击镜：距离 ≥3 格的目标伤害 ×1.3',()=>{
 const {b,u}=setup('char_103_angel',[ITEM.scope]);
 const far=enemy(b,{x:u.x+3,y:u.y,hp:100000,def:0});
 const near=enemy(b,{x:u.x+1,y:u.y,hp:100000,def:0});
 const beforeFar=far.hp,beforeNear=near.hp;
 attack(b,u,far,100);attack(b,u,near,100);
 const farDamage=beforeFar-far.hp,nearDamage=beforeNear-near.hp;
 assert.ok(Math.abs(farDamage-nearDamage*1.3)<1,`远距离伤害应当 ×1.3（${farDamage} vs ${nearDamage}）`);
});

test('防暴盾：阻挡时只减非自身阻挡来源的伤害',()=>{
 const {b,u}=setup('char_143_ghost',[ITEM.riot]);
 const blocked=enemy(b,{x:u.x,y:u.y,hp:100000,def:0});
 blocked.block=u.uid;
 const other=enemy(b,{x:u.x+2,y:u.y,hp:100000,def:0});
 const hp=u.hp;
 dealDamage(b,{source:other,target:u,amount:100,type:'true'});
 const fromOther=hp-u.hp;
 const hp2=u.hp;
 dealDamage(b,{source:blocked,target:u,amount:100,type:'true'});
 const fromBlocked=hp2-u.hp;
 assert.ok(fromOther<fromBlocked,`非阻挡来源应当更少（${fromOther} < ${fromBlocked}）`);
 assert.ok(Math.abs(fromOther-fromBlocked*0.6)<2,'减伤比例应当是 damage_scale=0.6');
});

test('海沟实验体：固定伤害减免 180 点',()=>{
 const {b,u}=setup('char_143_ghost',[ITEM.trench]);
 const e=enemy(b,{x:u.x+1,y:u.y,hp:100000,def:0});
 const hp=u.hp;
 dealDamage(b,{source:e,target:u,amount:200,type:'true'});
 assert.equal(Math.round(hp-u.hp),20,'200 点真实伤害先扣掉 180 点减免');
});

test('坚固维式重锤：首次致命伤害时生命值不低于 1（一次性）',()=>{
 const {b,u}=setup('char_143_ghost',[ITEM.undead]);
 const e=enemy(b,{x:u.x+1,y:u.y,hp:100000});
 dealDamage(b,{source:e,target:u,amount:u.maxHp*10,type:'true'});
 assert.equal(u.hp>=1,true,'第一次致命伤应当被锁住');
 assert.ok(u.lockHp,'应当进入不死状态');
 u.lockHp=null; // 不死窗口结束后再挨一次
 dealDamage(b,{source:e,target:u,amount:u.maxHp*10,type:'true'});
 assert.equal(u.hp,0,'一次性效果用完就不再保命');
});

test('M3茧甲：战斗阶段被击倒时立刻复活，次数用尽后正常退场',()=>{
 const {b,u}=setup('char_143_ghost',[ITEM.m3]);
 const e=enemy(b,{x:u.x+1,y:u.y,hp:100000});
 dealDamage(b,{source:e,target:u,amount:u.maxHp*10,type:'true'});
 assert.equal(u.hp,u.maxHp,'第一次被击倒应当满血复活');
 assert.equal(u.m3Revives,1);
 dealDamage(b,{source:e,target:u,amount:u.maxHp*10,type:'true'});
 assert.equal(u.hp,0,'次数用尽后正常退场');
});

test('M3茧甲与不屈同时触发仍消耗复活次数，免费重新部署不补回次数',()=>{
 const {b,u}=setup('char_143_ghost',[ITEM.m3]);b.on=id=>id==='indomShip';b.rows.indomShip={count:3};b.economy.random=()=>0;
 const e=enemy(b,{x:u.x+1,y:u.y,hp:100000});dealDamage(b,{source:e,target:u,amount:u.maxHp*10,type:'true'});
 assert.equal(u.m3Revives,1);assert.equal(u.down,0);assert.ok(b.deploymentCost(u)>0);b.deploy(u,{reentry:true});assert.equal(u.m3Revives,1);
 b.economy.random=()=>1;dealDamage(b,{source:e,target:u,amount:u.maxHp*10,type:'true'});assert.equal(u.deployed,false);
});

test('浓缩嗅盐：生命值高于阈值时免疫特殊状态，掉到阈值以下失效',()=>{
 const {b,u}=setup('char_143_ghost',[ITEM.salt]);
 u.hp=u.maxHp;
 b.step();
 applyStatus(u,'stun',3,{source:null,resistible:false});
 assert.equal(kinds(u).includes('stun'),false,'高血状态下晕眩应当被挡掉');
 u.hp=u.maxHp*0.1;
 b.step();
 applyStatus(u,'stun',3,{source:null,resistible:false});
 assert.ok(kinds(u).includes('stun'),'低血状态不再免疫');
});

test('伪装服：首次受到伤害后获得隐匿',()=>{
 const {b,u}=setup('char_143_ghost',[ITEM.camo]);
 const e=enemy(b,{x:u.x+1,y:u.y,hp:100000,def:0});
 dealDamage(b,{source:e,target:u,amount:10,type:'physical'});
 assert.ok(kinds(u).includes('invisible'),'首次受伤后应当隐匿');
});

test('护盾无人机：治疗时有概率给目标一层护盾',()=>{
 const {b,u}=setup('char_143_ghost',[ITEM.drone]);
 b.economy.random=()=>0;
 const before=(u.barriers||[]).length;
 b.heal(u,u,10);
 assert.equal((u.barriers||[]).length,before+1,'概率命中时获得 1 层护盾');
});

test('蜂鸣器与不屈弹射器：嘲讽等级与再部署时间进 stats',()=>{
 const base=setup('char_143_ghost',[]);
 const withItems=setup('char_143_ghost',[ITEM.buzzer,ITEM.ejector]);
 const baseStats=base.b.stats(base.u),itemStats=withItems.b.stats(withItems.u);
 assert.equal(itemStats.tauntLevel,baseStats.tauntLevel+1,'蜂鸣器 +1 嘲讽');
 assert.ok(Math.abs(itemStats.respawnTime-baseStats.respawnTime*0.7)<.01,'不屈弹射器再部署时间 ×0.7');
});

test('歌利亚头盔：部署时身前一格为空时生命值额外 +15%',()=>{
 const {u}=setup('char_143_ghost',[ITEM.helmet]);
 assert.ok(Math.abs(u.helmetMaxHpBonus-0.4)<1e-9,`25%+15%=40%（实际 ${u.helmetMaxHpBonus}）`);
});

test('迅捷作战粮：部署时按同盟约人数给技力',()=>{
 const {u}=setup('char_143_ghost',[ITEM.ration]);
 assert.ok(u.sp>=3,`部署时至少给 3 点技力（实际 ${u.sp}）`);
});

test('源石溶剂：每秒流失 60 点生命',()=>{
 const {b,u}=setup('char_143_ghost',[ITEM.solvent]);
 u.maxHp=100000;u.hp=100000;
 const before=u.hp;
 for(let i=0;i<32;i++)b.step();
 assert.ok(before-u.hp>=55,`约 1 秒应当流失 60 点（实际 ${before-u.hp}）`);
});
