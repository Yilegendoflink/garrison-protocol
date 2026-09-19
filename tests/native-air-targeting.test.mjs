import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {SKILL_ANTIAIR,skillAntiAir,branchBehavior} from '../dist/native-branches.js';
import {tickLogic} from '../dist/native-effects.js';
import {openBattle,deployNow,enemy,byId} from './effects-harness.mjs';

// 技能级对空的依据是 PRTS 干员页的技能备注（「※可对空」「※不可对空」等），
// 本地快照在 data/prts/snapshots/<版本>/operators.json 的 skills[i].sourceTemplate.fields.备注。
const pointer=JSON.parse(fs.readFileSync('data/prts/latest.json','utf8'));
const prts=JSON.parse(fs.readFileSync(`data/prts/${pointer.path}/operators.json`,'utf8'));
const prtsList=Array.isArray(prts)?prts:Object.values(prts);
const prtsByChar=new Map(prtsList.map(o=>[o.gameId,o]));
const noteOf=(charId,index)=>String(prtsByChar.get(charId)?.skills?.[index]?.sourceTemplate?.fields?.备注||'');
const SKILL_KEYS=/可对空|可对飞行单位生效|效果可对空/;
const DENY_KEYS=/不可对空|不对空|不再攻击空中单位/;

const profileFor=charId=>Object.values(NATIVE_DATA.profiles).find(p=>p?.charId===charId);
function openFor(charId,skillIndex){
 const p=profileFor(charId);
 assert.ok(p,`本期应当有 ${charId}`);
 const {b}=openBattle([{chessId:p.chessId,skillIndex}]);
 deployNow(b);
 return {b,u:byId(b,charId)};
}
// 把飞行敌人放到「技能生效后的攻击范围内」的一个合法地图格（找不到就返回 null，由调用方降级处理）
function spawnFlyerInRange(b,u){
 for(let y=0;y<b.map.rows;y++)for(let x=0;x<b.map.cols;x++){
  if(!b.inside(u,{x,y}))continue;
  if(x===u.x&&y===u.y)continue;
  if(b.s.enemies.some(e=>e.hp>0&&e.x===x&&e.y===y))continue;
  return enemy(b,{x,y,hp:100000,def:0,res:0,flying:true});
 }
 return null;
}
const activate=b=>u=>{u.sp=b.spCost(u);b.activate(u);};

test('技能级对空表与 PRTS 技能备注一致（可对空／不可对空）',()=>{
 const rows=Object.entries(SKILL_ANTIAIR);
 assert.ok(rows.length>=9,`至少覆盖 9 名地面干员，实际 ${rows.length}`);
 for(const [charId,byIndex] of rows){
  const record=prtsByChar.get(charId);
  assert.ok(record,`PRTS 快照里应当有 ${charId}`);
  assert.equal(record.position,'近战位',`${record.name} 是地面干员`);
  for(const [index,flag] of Object.entries(byIndex)){
   const note=noteOf(charId,Number(index));
   assert.ok(note,`${record.name} 技能 ${index} 应当有 PRTS 备注`);
   const allow=SKILL_KEYS.test(note)&&!DENY_KEYS.test(note);
   assert.equal(allow,flag,`${record.name} 技能 ${index} 的 PRTS 备注：${note.slice(0,60)}`);
  }
 }
});

test('本期地面干员里，PRTS 标注可对空的技能都已经进表（utility 类除外）',()=>{
 // 这些备注里的「可对空」说的不是攻击本身（回技力、影哨反隐、天赋回复、起飞时的血镰、风雪之眼费用…），
 // 不改变攻击能否打空，因此不进对空表；除它们以外凡是 PRTS 写「可对空」的技能都必须在表里。
 const UTILITY=new Set(['char_107_liskam','char_4087_ines','char_2026_yu','char_4010_etlchi','char_1033_swire2','char_1045_svash2']);
 const visible=new Set();
 for(const p of Object.values(NATIVE_DATA.profiles||{}))if(p?.charId&&!p.isHidden)visible.add(p.charId);
 const missing=[];
 for(const [charId,record] of prtsByChar){
  if(!visible.has(charId))continue;
  if(!/近战位/.test(record.position||''))continue;
  if(UTILITY.has(charId))continue;
  (record.skills||[]).forEach((s,index)=>{
   const note=String(s.sourceTemplate?.fields?.备注||'');
   if(!SKILL_KEYS.test(note)||DENY_KEYS.test(note))return;
   if(skillAntiAir(charId,index)!==true)missing.push(`${record.name}#${index}(${s.name})`);
  });
 }
 assert.deepEqual(missing,[],'这些 PRTS 标注可对空的技能还没写进 SKILL_ANTIAIR');
});

test('技能生效时对空开关按表切换，未开启技能时回到分支默认值',()=>{
 for(const [charId,byIndex] of Object.entries(SKILL_ANTIAIR)){
  for(const [index,flag] of Object.entries(byIndex)){
   const {b,u}=openFor(charId,Number(index));
   const base=b.behavior(u).antiAir;
   assert.equal(branchBehavior(b.profile(u),false).antiAir,base);
   activate(b)(u);
   if(!u.skillAir)continue; // PASSIVE／不消耗技力的技能由部署路径触发，不走 activate：对空表本身由 PRTS 门禁覆盖
   assert.equal(b.behavior(u).antiAir,flag,`${charId} 技能 ${index} 开启那一帧的对空开关`);
   const duration=Number(b.profile(u).skill?.duration)>0;
   if(duration)assert.equal(b.skillActive(u),true,`${charId} 技能 ${index} 应当处于生效期`);
   // 瞬时技/被动技只在开启那一帧生效：走过一帧后回到分支默认值；持续技在生效期内保持覆盖值
   b.step();
   assert.equal(b.behavior(u).antiAir,b.skillActive(u)?flag:base,`${charId} 技能 ${index} 之后的开关`);
  }
 }
});

test('标注可对空的技能能选到飞行敌人，未标注的地面技能仍然选不到',()=>{
 for(const [charId,byIndex] of Object.entries(SKILL_ANTIAIR)){
  for(const [index,flag] of Object.entries(byIndex)){
   const {b,u}=openFor(charId,Number(index));
   if(!flag)continue; // 银灰「雪境生存法则」是关闭对空的例外，单独覆盖
   activate(b)(u);
   if(!u.skillAir)continue; // PASSIVE 技能的伤害走的是范围结算（本就含空中单位）
   const flyer=spawnFlyerInRange(b,u);
   if(!flyer)continue; // 技能范围只剩自身格之类的情况由开关断言覆盖
   const picked=b.targets(u).some(e=>e.uid===flyer.uid);
   assert.equal(picked,true,`${charId} 技能 ${index} 应当能选中飞行敌人`);
  }
 }
 // 没有对空标注的地面干员：开技也选不到飞行单位
 const {b,u}=openFor('char_4058_pepe',0);
 activate(b)(u);
 const flyer=spawnFlyerInRange(b,u);
 assert.ok(flyer,'佩佩技能范围内应当能放下飞行敌人');
 assert.equal(b.targets(u).some(e=>e.uid===flyer.uid),false,'没有对空标注的地面技能不能打空');
});

test('银灰「雪境生存法则」缩小范围时不再攻击空中单位，真银斩照旧能打',()=>{
 const s2=openFor('char_172_svrash',1);
 assert.equal(s2.b.behavior(s2.u).antiAir,true,'领主常态可以打空');
 activate(s2.b)(s2.u);
 assert.equal(s2.b.behavior(s2.u).antiAir,false,'雪境生存法则开启期间不能打空');
 const s3=openFor('char_172_svrash',2);
 assert.equal(s3.b.behavior(s3.u).antiAir,true);
 activate(s3.b)(s3.u);
 assert.equal(s3.b.behavior(s3.u).antiAir,true,'真银斩不受影响');
});

test('玛恩纳「未照耀的荣光」期间普通攻击真的能打到飞行敌人',()=>{
 const {b,u}=openFor('char_4064_mlynar',2);
 activate(b)(u);
 const flyer=spawnFlyerInRange(b,u);
 assert.ok(flyer,'技能范围内应当能放下飞行敌人');
 const hp=flyer.hp;
 for(let i=0;i<120&&flyer.hp>=hp;i++)b.step();
 assert.ok(flyer.hp<hp,`飞行敌人应当被普通攻击打到（剩余 ${flyer.hp}）`);
});

test('烛煌「灼烧地段」按 PRTS 备注不可对空：圈里的飞行单位不吃伤害',()=>{
 const {b,u}=openFor('char_1040_blaze2',0);
 const ground=enemy(b,{x:u.x,y:u.y+1,hp:100000,def:0,res:0});
 const flyer=enemy(b,{x:u.x+1,y:u.y,hp:100000,def:0,res:0,flying:true});
 activate(b)(u);
 const zone=(b.s.logicEffects||[]).find(f=>f.talentOrSkillId==='blaze2-s1');
 assert.ok(zone,'灼烧地段应当存在');
 assert.equal(zone.values.groundOnly,true,'灼烧地段的伤害不可对空');
 const before={ground:ground.hp,flyer:flyer.hp};
 b.s.time=zone.nextAt;tickLogic(b,1/30);
 assert.ok(ground.hp<before.ground,'地面敌人照常结算');
 assert.equal(flyer.hp,before.flyer,'飞行单位不吃灼烧地段');
});
