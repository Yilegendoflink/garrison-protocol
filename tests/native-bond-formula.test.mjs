import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {bondKeyAudit,BOND_KEY_REGISTRY,BOND_KEY_PENDING,BOND_TEXT_CONSTANTS,bondValueEntries} from '../dist/native-bond-keys.js';
import {bondScaledParams,bondBlackboard,bondLayerValue,bondValue,bondPityChance,bondPityStep} from '../dist/protocol.js';
import {openBattle,enemy} from './effects-harness.mjs';
import {dealDamage,dispatch} from '../dist/native-effects.js';
import {applyStatus} from '../dist/status.js';
import {NO_BOND_BAN} from './no-bond-ban.mjs';
import {NativeSession} from '../dist/native-session.js';

// 盟约「受层数影响」的数值只能有一条来源：原表 bondInfoDict[].effectId → env_gbuff_new 行的黑板。
// 这批测试把三件事钉死：① 原表每个键都有登记的来源与消费者；② descParamPerStackList 声明的项必须是读原表；
// ③ 改原表数值必须真的改数值（面板与战斗同步），而不是改到代码里抄的一份常量。
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read=file=>readFile(path.join(root,'dist',file),'utf8');
const logicFiles=['native-battle.js','native-effects.js','native-economy.js','native-session.js','protocol.js','garrison.js','strategy.js','native-operator-effects.js','native-equipment.js','native-bond-ban.js','native-play.js','native-fx.js'];
const unique=(bond,count)=>Array.from(new Map(Object.values(NATIVE_DATA.season.charShopChessDatas).filter(s=>s.charId&&NATIVE_DATA.season.charChessDataDict[s.chessId].bondIds.includes(bond)).map(s=>[s.charId,s.chessId])).values()).slice(0,count);
// 复制一份只改指定键的原表：浅拷贝到 effect 行，避免动 NATIVE_DATA 本体。
function patchBond(bondId,values){
 const data={...NATIVE_DATA,season:{...NATIVE_DATA.season,bondInfoDict:{...NATIVE_DATA.season.bondInfoDict},effectBuffInfoDataDict:{...NATIVE_DATA.season.effectBuffInfoDataDict}}};
 const info=data.season.bondInfoDict[bondId];
 data.season.effectBuffInfoDataDict[info.effectId]=(NATIVE_DATA.season.effectBuffInfoDataDict[info.effectId]||[]).map(row=>({...row,blackboard:(row.blackboard||[]).map(x=>Object.hasOwn(values,x.key)?{...x,valueStr:String(values[x.key]),value:values[x.key]}:x)}));
 return data;
}
function statsWith(bondId,layers,{count=2,patch={},mutate}={}){
 const data=Object.keys(patch).length?patchBond(bondId,patch):NATIVE_DATA;
 const {b}=openBattle(unique(bondId,count).map(chessId=>({chessId})),{data});
 for(const u of b.s.units)if(!u.deployed)b.deploy(u);
 b.layers[bondId]=layers;
 if(mutate)mutate(b);
 return b;
}

test('原表每个盟约黑板键都在登记表里（缺一个就挂）',()=>{
 assert.deepEqual(bondKeyAudit(NATIVE_DATA),{missing:[],stale:[],badZero:[],badNote:[]});
});

test('descParamPerStackList 声明的层数项必须是读原表，不是抄常量',async()=>{
 const sources=await Promise.all(logicFiles.map(read));
 for(const [bondId,info] of Object.entries(NATIVE_DATA.season.bondInfoDict)){
  for(const perKey of info.descParamPerStackList||[]){
   const entry=(BOND_KEY_REGISTRY[bondId]||{})[perKey];
   assert.ok(entry,`${bondId}.${perKey} 没有登记`);
   assert.ok(['formula','zero'].includes(entry.src),`${bondId}.${perKey} 是原表声明的层数参数，必须 src:'formula'（当前 ${entry.src}）`);
  }
 }
 // src:'formula' 的键名必须真的出现在逻辑模块里（证明读的是原表字段）
 for(const [bondId,keys] of Object.entries(BOND_KEY_REGISTRY))for(const [key,entry] of Object.entries(keys)){
  if(entry.src!=='formula')continue;
  assert.ok(sources.some(text=>text.includes(key)),`${bondId}.${key} 登记成 formula，但没有任何逻辑模块引用这个键名`);
 }
});

test('待确认项名单是冻结的（新增待确认必须显式改测试）',()=>{
 const pending=[];
 for(const [bondId,keys] of Object.entries(BOND_KEY_REGISTRY))for(const [key,entry] of Object.entries(keys))if(entry.src==='pending')pending.push(`${bondId}.${key}`);
 assert.deepEqual(pending.sort(),[...BOND_KEY_PENDING]);
});

test('面板：原表声明几项渲染几项，突袭的生命值提升也要显示',()=>{
 for(const [bondId,info] of Object.entries(NATIVE_DATA.season.bondInfoDict)){
  const expected=Math.max((info.descParamBaseList||[]).length,(info.descParamPerStackList||[]).length)+(bondId==='raidShip'?1:0);
  assert.equal(bondScaledParams(NATIVE_DATA,bondId,10).length,expected,`${bondId} 面板项数与原表声明不符`);
 }
 const raid=bondScaledParams(NATIVE_DATA,'raidShip',10);
 assert.deepEqual(raid.map(p=>p.key),['base_atk','base_max_hp'],'突袭文案写「攻击力和生命值提升（受层数影响）」，原表少声明了生命值');
 assert.match(raid[1].label,/最大生命值提升/);
 assert.equal(raid[1].formula,'0.25 + 0.01 × 10层');
});

test('面板与战斗读同一行黑板，公式就是 base + per × 层',()=>{
 for(const bondId of Object.keys(NATIVE_DATA.season.bondInfoDict)){
  const bb=bondBlackboard(NATIVE_DATA,bondId),params=bondScaledParams(NATIVE_DATA,bondId,37);
  for(const item of params){
   const base=bondValue(bb,item.key,NaN);
   assert.ok(Number.isFinite(base),`${bondId}.${item.key} 不在 env_gbuff_new 行里`);
   assert.match(item.formula,/^[-0-9.]+ \+ [-0-9.]+ × 37层$/);
  }
 }
 // 层数公式帮助函数与面板同口径
 const bb=bondBlackboard(NATIVE_DATA,'siracusaShip');
 assert.equal(bondLayerValue(bb,'base_duration','duration_per_stack',35),32+0.4*35);
 assert.equal(bondLayerValue(bb,'base_duration','duration_per_stack',0),32);
});

test('叙拉古保底口径：概率来自原表 prob，期望命中率≈prob',()=>{
 const prob=Number(bondBlackboard(NATIVE_DATA,'siracusaShip').prob);
 assert.equal(prob,0.03,'叙拉古真实伤害概率应来自原表');
 const {step,cap}=bondPityStep(prob);
 assert.ok(Math.abs(step-Math.PI*prob*prob/2)<1e-12,'步长＝π·prob²/2');
 assert.equal(cap,Math.ceil(1/step));
 assert.equal(bondPityChance(prob,0),step);
 assert.equal(bondPityChance(prob,cap+10),1,'超过保底次数必定命中');
 // 线性递增保底的期望命中次数 ≈ 1/prob（这里用固定序列模拟）
 let hits=0,pity=0,state=12345;
 const rnd=()=>((state=(state*1664525+1013904223)>>>0)/4294967296);
 const trials=200000;
 for(let i=0;i<trials;i++){
  if(rnd()<bondPityChance(prob,pity)){hits++;pity=0;}
  else if(++pity>=cap){hits++;pity=0;}
 }
 const rate=hits/trials;
 assert.ok(Math.abs(rate-prob)<prob*0.06,`期望 ${prob}，实测 ${rate.toFixed(4)}`);
 // 改原表 prob，命中概率跟着变（未命中次数为 0 时的首抽概率之比≈(0.3/0.03)²）
 const patched=patchBond('siracusaShip',{prob:0.3});
 const patchedProb=Number(bondBlackboard(patched,'siracusaShip').prob);
 assert.equal(patchedProb,0.3);
 assert.ok(Math.abs(bondPityChance(patchedProb,0)/bondPityChance(prob,0)-100)<1e-6,'首抽概率按 prob² 变化');
});

test('旧的硬编码常量已经清掉（源码门禁）',async()=>{
 const all=[await read('native-battle.js'),await read('native-effects.js'),await read('native-economy.js')].join('\n');
 for(const stale of ['.00139','1.25+.008','1.35+.01','.68+.014','10+(l.skillfulShip','base.respawnTime*=.7','.5+.01*(battle.layers.kazimierz','variants.size>=3?4:2','count>=100?3:2','lateranoShip?.count<6','indomShip?.count<3','steadShip?.count>=3','kazimierzShip?.count<6','siracusaShip?.count>=6','kjeragShip?.count>=6','yanShip?.count>=9','rows.preciShip.count>=3','normal*.5+golden*.8'])assert.equal(all.includes(stale),false,`${stale} 应该改成读原表`);
});

test('灵巧：邻近攻速加成的每层值读原表',()=>{
 const b=statsWith('skillfulShip',10,{count:2,patch:{base_attack_speed:0,attack_speed_per_stack:5}});
 const [a,c]=b.s.units;c.x=a.x+1;c.y=a.y;
 const bonus=b.stats(a).attackSpeed-(b.profile(a).attributes.attackSpeed??100);
 assert.equal(Math.round(bonus),50,'0 + 5 × 10层');
});

test('突袭：50 层的全体攻速加成与阈值都读原表',()=>{
 const data=patchBond('raidShip',{power_attack_speed:77,power_bond_stack_cnt:50});
 const {b}=openBattle(unique('raidShip',2).map(chessId=>({chessId})),{data});
 for(const u of b.s.units)if(!u.deployed)b.deploy(u);
 const u=b.s.units[0],at=layers=>{b.layers.raidShip=layers;return b.stats(u).attackSpeed;};
 const off0=at(0),off49=at(49),on50=at(50);
 assert.equal(Math.round(off49),Math.round(off0),'未达阈值不加攻速');
 assert.equal(Math.round(on50-off49),77,'达到阈值给全体加攻速');
});

test('突袭：再部署期间的生命值加成读原表，且面板同源',()=>{
 const data=patchBond('raidShip',{max_hp_per_stack:0.5,base_max_hp:0.5});
 const {b}=openBattle(unique('raidShip',2).map(chessId=>({chessId})),{data});
 for(const u of b.s.units)if(!u.deployed)b.deploy(u);
 b.layers.raidShip=2;b.s.units.forEach(u=>{u.raidBuffUntil=b.s.time+10;});
 const buffed=b.stats(b.s.units[0]).maxHp,plain=b.profile(b.s.units[0]).attributes.maxHp;
 assert.ok(buffed>plain,'再部署期间生命值应提升');
 const panel=bondScaledParams(data,'raidShip',2).find(p=>p.key==='base_max_hp');
 assert.equal(panel.text,'+150%','0.5 + 0.5 × 2层');
});

test('谢拉格：对寒冷／冻结目标的伤害倍率读原表',()=>{
 const run=scale=>{
  const data=patchBond('kjeragShip',{base_ex_damage_scale:scale,ex_damage_scale_per_stack:0,base_damage_scale:1});
  const {b}=openBattle(unique('kjeragShip',3).map(chessId=>({chessId})),{data});
  for(const u of b.s.units)if(!u.deployed)b.deploy(u);
  const u=b.s.units.find(v=>b.owns(v,'kjeragShip'));
  b.layers.kjeragShip=2;
  const e=enemy(b,{hp:1e9,def:0,res:0});applyStatus(e,'cold',5,{source:u.uid});
  const before=e.hp;dealDamage(b,{source:u,target:e,amount:1000,type:'physical'});
  return before-e.hp;
 };
 const doubled=run(2),single=run(1);
 assert.ok(Math.abs(doubled/single-2)<0.02,'倍率差 1.0 + 1.0 × 2层＝2 倍差距');
});

test('奥术：法术脆弱比例读原表',()=>{
 const data=patchBond('arcaneShip',{base_damage_scale_show:0.5,damage_scale_per_stack:0.1,base_damage_scale:1.5});
 const {b}=openBattle(unique('arcaneShip',2).map(chessId=>({chessId})),{data});
 for(const u of b.s.units)if(!u.deployed)b.deploy(u);
 const u=b.s.units.find(v=>b.owns(v,'arcaneShip'));
 b.layers.arcaneShip=3;
 const e=enemy(b,{hp:1e9,def:0,res:0});
 dealDamage(b,{source:u,target:e,amount:100,type:'arts'});
 assert.ok(Math.abs(e.arcaneWeaknesses[u.uid].value-(0.5+0.1*3))<1e-9,'0.5 + 0.1 × 3层');
});

test('助力：休整期结束给所有已激活盟约加层读原表',()=>{
 const run=p=>{
  const data=Object.keys(p).length?patchBond('deputShip',p):NATIVE_DATA;
  const g=new NativeSession(data,{bondBan:NO_BOND_BAN,seed:5});
  g.s.funds=9999;g.s.capacity=8;g.s.rewardPending=null;g.s.rewardQueue=[];
  for(const chessId of unique('deputShip',3))g.gain(chessId);
  g.s.rewardPending=null;g.s.rewardQueue=[];
  for(const u of g.s.units.filter(u=>!u.position)){let ok=false;for(let y=0;y<g.map.rows&&!ok;y++)for(let x=0;x<g.map.cols&&!ok;x++)if(!g.s.units.some(v=>v.uid!==u.uid&&v.position?.x===x&&v.position?.y===y))ok=g.deploy(u.uid,x,y,0);assert.ok(ok);}
  assert.ok(g.perform('start'),g.lastError||'开战失败');
  return g.s.bondLayers;
 };
 const two=run({layer:2,more_layer:9,count:9}),seven=run({layer:7,more_layer:9,count:9}),more=run({layer:2,more_layer:9,count:2});
 // 只钉 助力 自己发的那一份层数：其它已激活盟约还可能被卫戍／策略按层数再发一次，不能要求逐盟约恒定差值。
 assert.equal(seven.deputShip-two.deputShip,5,'layer 从 2 改 7，加层数跟着变 5');
 assert.ok(Object.keys(seven).length>=Object.keys(two).length,'所有已激活盟约都要吃到加层');
 assert.equal(more.deputShip-two.deputShip,7,'在场人数达到 count 后改用 more_layer（2→9）');
});

test('投资人：获得时特质的触发次数与事件类型读原表',()=>{
 const counts=p=>{
  const data=Object.keys(p).length?patchBond('investShip',p):NATIVE_DATA;
  const g=new NativeSession(data,{bondBan:NO_BOND_BAN,seed:9});
  g.s.funds=9999;g.s.capacity=8;g.s.rewardPending=null;g.s.rewardQueue=[];
  for(const chessId of unique('investShip',3))g.gain(chessId);
  g.s.rewardPending=null;g.s.rewardQueue=[];
  for(const u of g.s.units.filter(u=>!u.position)){let ok=false;for(let y=0;y<g.map.rows&&!ok;y++)for(let x=0;x<g.map.cols&&!ok;x++)if(!g.s.units.some(v=>v.uid!==u.uid&&v.position?.x===x&&v.position?.y===y))ok=g.deploy(u.uid,x,y,0);assert.ok(ok);}
  const before=g.s.events.filter(e=>e.type==='garrison'&&e.event==='SERVER_GAIN').length;
  const holder=Object.entries(NATIVE_DATA.season.charChessDataDict).find(([,c])=>(c.garrisonIds||[]).some(id=>NATIVE_DATA.season.garrisonDataDict[id]?.eventType==='SERVER_GAIN'))[0];
  assert.ok(g.gain(holder),'投资人局内不额外禁用，应能获得干员');
  return g.s.events.filter(e=>e.type==='garrison'&&e.event==='SERVER_GAIN').length-before;
 };
 const base=counts({}),patched=counts({count:5});
 assert.ok(base>0,'默认按原表 count=2 触发两次');
 assert.equal(patched,base/2*5,'改 count 后按新值触发');
});

test('远见：80/150 层的永久折扣金额读原表',()=>{
 const id=Object.values(NATIVE_DATA.season.charShopChessDatas).filter(s=>s.charId&&!s.isHidden&&(s.chessLevel??0)>=5).map(s=>s.chessId)[0];
 const priceOf=data=>{const session=new NativeSession(data,{bondBan:NO_BOND_BAN,seed:11});session.s.funds=9999;session.s.permanentDiscount=2;return session.price(id);};
 const base=priceOf(NATIVE_DATA),patched=priceOf(patchBond('visiShip',{discount:3}));
 assert.equal(base-patched,2,'折扣金额从 1 变 3 时价格再降 2');
 assert.equal(BOND_TEXT_CONSTANTS.visiShip.discountAmount,1,'文案常量登记为 1');
});

test('叙拉古：隐匿持续时间读原表',()=>{
 const data=patchBond('siracusaShip',{base_duration:0,duration_per_stack:1});
 const {b}=openBattle(unique('siracusaShip',6).map(chessId=>({chessId})),{data});
 for(const u of b.s.units)if(!u.deployed)b.deploy(u);
 const u=b.s.units.find(v=>b.owns(v,'siracusaShip'));
 b.layers.siracusaShip=7;
 dispatch(b,'deploy',{target:u});
 assert.ok(Math.abs((u.siracusaInvisibleUntil-b.s.time)-7)<1e-9,'0 + 1 × 7层');
});

test('只写在文案里的常量都登记在 native-bond-keys.js',()=>{
 for(const [bondId,entry] of Object.entries(BOND_TEXT_CONSTANTS))assert.ok(entry.note&&/文案/.test(entry.note),`${bondId} 的文案常量要有出处说明`);
 assert.equal(BOND_TEXT_CONSTANTS.investShip.powerLayer,100);
 assert.equal(BOND_TEXT_CONSTANTS.yanShip.guardianShare,0.3);
 // 炎佑的 30% 与 3 个目标来自文案，代码必须引用登记值而不是再写一个字面量
 assert.equal((NATIVE_DATA.season.bondInfoDict.yanShip.desc||'').includes('30%'),true);
 assert.ok(Object.keys(bondValueEntries(NATIVE_DATA,'yanShip')).length>0);
});
