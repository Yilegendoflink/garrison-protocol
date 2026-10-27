import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {prepCatalog,prepBondOptions} from '../dist/native-prep.js';
import {bondIds} from '../dist/native-bond-ban.js';
import {bondCurrentPreviewHtml} from '../dist/protocol.js';
import {emptyArchive} from '../dist/native-archive.js';
import {applyPasscode} from '../dist/native-passcode.js';
import {
 SEES_BAND_ID,SEES_BOND_ID,TARTARUS_BOND_ID,seesUnlocked,isSeesBand,visibleBands,dataForPrep,operatorAllowed,itemAllowed,
 tartarusLayers,addTartarusLayers,tartarusCap,coreTrueDamagePercent,coreCooldown,layersPerFund,grantEveryLayers,
 grantCountForLayers,settleFundsToLayers,seesGrantCandidates,bondPanelCount,isSeesOperator,weaknessSource,freeDeploy,
 makotoKillLayers,aigisLayerScale
} from '../dist/native-sees.js';
import {openBattle,enemy,byId} from './effects-harness.mjs';
import {drawSeesCore} from '../dist/native-fx.js';
import {NO_BOND_BAN} from './no-bond-ban.mjs';

// S.E.E.S. 策略（band_sees）的回归：这条策略把「策略 ＋ 两条专属盟约 ＋ 四名联动干员 ＋ 一件专属装备」
// 绑在一起，所以这里分五块钉死——① 构建期注入的内容在位；② 可见性与卡池门控；③ 回合结算与层数账本；
// ④ 核心盟约与臂章的战斗结算；⑤ 逐名干员效果。凡是「项目规定值」的项都额外验证「改数据 → 行为跟着变」。
const data=NATIVE_DATA;
const numbers=data.sees.numbers;
const locked=emptyArchive();
const unlocked=applyPasscode(emptyArchive(),'20100305').archive;
const SEES_CHESS=['chess_collab_kormr','chess_collab_yukari','chess_collab_aigis','chess_collab_makoto'];
const ARMBAND='chess_item_9_01_e_a';
// 只改 sees.numbers 的浅拷贝数据：其余部分共用，避免动 NATIVE_DATA 本体。
const patchedNumbers=patch=>({...data,sees:{...data.sees,numbers:{...numbers,...patch}}});
const shopOf=chessId=>data.season.charShopChessDatas[chessId];
const firstMap=()=>data.maps.find(m=>m.weight>0).stageId;
const seesSession=(extra={})=>new NativeSession(data,{bondBan:NO_BOND_BAN,modeId:'mode_single_normal',bandId:SEES_BAND_ID,mapId:firstMap(),seed:7,...extra});
const normalSession=(extra={})=>new NativeSession(data,{bondBan:NO_BOND_BAN,modeId:'mode_single_normal',mapId:firstMap(),seed:7,...extra});
const normalChessId=()=>Object.values(data.season.charShopChessDatas).find(s=>s.charId&&!s.isHidden&&!s.sees&&s.chessLevel===1).chessId;
// 装备只能在备战期装上，所以臂章的用例自己走一遍「gain → equip → 落位 → 开战」。
function equippedBattle(wearerChessId){
 const g=seesSession();g.s.level=6;g.s.capacity=16;g.setFunds(0);
 const u=g.gain(wearerChessId);
 const item=g.gainItem(ARMBAND);
 assert.equal(g.equip(item.uid,u.uid),true,'臂章要能装上');
 let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(u.uid,x,y))placed=g.deploy(u.uid,x,y,0);
 assert.ok(placed,'没有可部署格');
 assert.equal(g.perform('start'),true,g.lastError||'');
 g.battle.s.queue=[];g.battle.s.limit=1e9;
 // 战场上的单位按 uid 对齐（`id` 字段是 charId，不是 chessId）。
 return {g,b:g.battle,unit:g.battle.s.units.find(x=>x.uid===u.uid)};
}

test('注入：策略、两条专属盟约、四名干员与臂章都进了运行时数据',()=>{
 assert.ok(data.sees,'运行时要有 sees 清单（构建期从 sees-content.json 注入）');
 assert.equal(data.sees.bandId,SEES_BAND_ID);
 assert.deepEqual(data.sees.bondIds.slice().sort(),[SEES_BOND_ID,TARTARUS_BOND_ID].sort());
 assert.deepEqual(data.sees.roster.map(r=>[r.charId,r.rank]),[['char_4220_kormr',1],['char_4219_yukari',2],['char_4218_aigis',3],['char_4217_makoto',6]],'四人的阶级按用户口径 1/2/3/6');
 assert.deepEqual(data.sees.items.map(i=>i.id),[ARMBAND]);
 assert.equal(data.sees.numbers.tartarusLayerCap,264);
 assert.equal(data.sees.numbers.coreTrueDamagePercentBase,0.05);
 assert.equal(data.sees.numbers.coreTrueDamagePercentMax,0.4);
 assert.equal(data.sees.numbers.grantEveryLayers,25);
 assert.ok(data.season.bandDataListDict[SEES_BAND_ID],'策略本体');
 assert.equal(data.common.bandDataDict[SEES_BAND_ID].bandName,'S.E.E.S.');
 assert.equal(data.season.bondInfoDict[TARTARUS_BOND_ID].activeCount,0,'【塔尔塔罗斯】是 0/0 特殊盟约');
 assert.equal(data.season.bondInfoDict[SEES_BOND_ID].activeCount,3,'【S.E.E.S.】核心盟约 3/3');
 const SEES_GARRISON={chess_collab_kormr:'garrison_sees_kormr',chess_collab_yukari:'garrison_sees_yukari',chess_collab_aigis:'garrison_sees_aigis',chess_collab_makoto:'garrison_sees_makoto'};
 for(const id of SEES_CHESS){
  const shop=shopOf(id),chess=data.season.charChessDataDict[id];
  assert.equal(shop.sees,true,id+' 要有「只在 S.E.E.S. 局放行」标记');
  assert.equal(shop.isHidden,true,id+' 平时仍是隐藏档（不进 112 名册与默认池）');
  assert.equal(chess.bondIds.length,1);assert.equal(chess.bondIds[0],SEES_BOND_ID);
  // 四人的 garrisonIds 指向 sees-content 登记的 garrison_sees_* 说明项（用户 2026-09-27 口径），
  // 实际规则仍由 native-sees／native-collab-* 执行，不走通用 garrison 事件。
  assert.deepEqual(chess.garrisonIds,[SEES_GARRISON[id]],id+' 挂 sees-content 登记的卫戍说明项');
 }
 const armband=data.items.find(i=>i.id===ARMBAND);
 assert.ok(armband,'臂章要进 catalog.items');
 assert.equal(armband.sees,true);assert.equal(armband.hidden,true,'默认隐藏，解锁后才在战前准备里出现');
 assert.equal(armband.normal.giveBondId,SEES_BOND_ID,'臂章的盟约归属是 S.E.E.S.（给商店取货用）');
 assert.equal(armband.normal.canGiveBond,false,'它不该把盟约发给携带者');
 for(const effectId of [armband.normal.effectId,armband.elite.effectId]){
  const rows=data.season.effectBuffInfoDataDict[effectId];
  assert.equal(rows.length,1);assert.equal(rows[0].key,'sees_armband_damage');
  const bb=Object.fromEntries(rows[0].blackboard.map(b=>[b.key,b.valueStr??b.value]));
  assert.equal(bb.key,'act1autochess_equip_sees_armband_global_buff');
  const elite=effectId===armband.elite.effectId;
  assert.equal(Number(bb.weakness_scale),elite?0.2:0.1);
  assert.equal(Number(bb.true_scale),elite?0.2:0.1);
 }
});

test('可见性：没解锁看不到这个策略，解锁后才出现；关掉标记又回落',()=>{
 assert.equal(seesUnlocked(locked),false);
 assert.ok(!visibleBands(data,locked).some(b=>b.bandId===SEES_BAND_ID),'未解锁时策略列表里没有它');
 assert.ok(visibleBands(data,unlocked).some(b=>b.bandId===SEES_BAND_ID));
 assert.equal(visibleBands(data,unlocked).length,visibleBands(data,locked).length+1);
 assert.equal(isSeesBand(SEES_BAND_ID),true);
 assert.equal(isSeesBand({bandId:SEES_BAND_ID}),true);
 assert.equal(isSeesBand('band_bldsk'),false);
 assert.equal(isSeesBand(null),false);
 const play=fs.readFileSync('dist/native-play.js','utf8');
 assert.ok(play.includes('visibleBands(data,archiveNow())'),'策略列表与已选策略的回落都走 visibleBands');
 assert.ok(play.includes('function guardedBandId()'),'要有一个「已选策略不可见就回落」的入口');
 assert.ok(play.includes('bandId:guardedBandId()'),'对局创建也要走回落后的策略');
 assert.ok(play.includes('state.band=guardedBandId()'),'关掉特殊标记后要立即回落');
});

test('战前准备：未解锁 112 名 / 56 件，解锁后加上四人与臂章',()=>{
 const before=prepCatalog(dataForPrep(data,locked));
 assert.equal(before.operators.length,112);
 assert.equal(before.equipment.length,56);
 assert.ok(!before.equipment.some(i=>i.id===ARMBAND));
 assert.ok(!before.operators.some(r=>SEES_CHESS.includes(r.chessId)),'未解锁时名册与改动前完全一致');
 const after=prepCatalog(dataForPrep(data,unlocked));
 assert.equal(after.operators.length,116,'解锁后四人进名册');
 assert.equal(new Set(after.operators.map(r=>r.charId)).size,116);
 assert.equal(after.equipment.length,57,'臂章进装备效果页');
 assert.ok(after.equipment.some(i=>i.id===ARMBAND));
 for(const id of ['char_4220_kormr','char_4217_makoto'])assert.ok(after.operators.some(r=>r.charId===id));
 const prep=fs.readFileSync('dist/native-prep.js','utf8');
 assert.ok(prep.includes('dataForPrep(data,archive)'),'战前准备要过 dataForPrep 这道开关');
});

test('盟约禁用池排除两条专属盟约（它们只在该策略局存在）',()=>{
 const ids=bondIds(data);
 assert.equal(ids.length,23,'盟约数不变：禁用机制只认原来那 23 个');
 assert.ok(!ids.includes(SEES_BOND_ID));assert.ok(!ids.includes(TARTARUS_BOND_ID));
 const flat=[...prepBondOptions(data).core,...prepBondOptions(data).extra].map(o=>o.id);
 assert.ok(!flat.includes(SEES_BOND_ID));assert.ok(!flat.includes(TARTARUS_BOND_ID),'战前准备的盟约下拉也不该出现它们');
});

test('卡池门控：默认局抽不到四人，选了策略才有他们（含库存）',()=>{
 const plain=normalSession();
 assert.ok(!plain.eligible().some(o=>o.sees),'默认局不进调配池');
 for(const id of SEES_CHESS)assert.equal(plain.s.stock?.[id],undefined,'默认局不铺库存');
 const run=seesSession();
 const pool=run.eligible();
 for(const id of SEES_CHESS)assert.ok(pool.some(o=>o.chessId===id),id+' 要进池');
 for(const id of SEES_CHESS)assert.ok(run.s.stock[id]>0,'库存要铺出来，否则 eligible 放行了也抽不到');
 let got=false;
 for(let i=0;i<80&&!got;i++){run.s.level=6;const rows=run.rollOffers();if(rows.some(id=>SEES_CHESS.includes(id)))got=true;}
 assert.ok(got,'band_sees 局刷新应该能刷出四人');
 const other=normalSession();
 for(let i=0;i<80;i++){other.s.level=6;for(const id of other.rollOffers())assert.ok(!SEES_CHESS.includes(id),'默认局不该刷出联动的四人');}
 assert.equal(operatorAllowed(data,shopOf('chess_collab_kormr'),run),true);
 assert.equal(operatorAllowed(data,shopOf('chess_collab_kormr'),other),false);
});

test('装备池门控：臂章只在 S.E.E.S. 局出现',()=>{
 const item=data.items.find(i=>i.id===ARMBAND);
 assert.equal(itemAllowed(item,seesSession()),true);
 assert.equal(itemAllowed(item,normalSession()),false);
 const run=seesSession();run.s.level=6;
 const seen=new Set();for(let i=0;i<2000;i++)seen.add(run.drawFromPool({kind:'item'}));
 assert.ok(seen.has(ARMBAND),'S.E.E.S. 局要能抽到臂章');
 const other=normalSession();other.s.level=6;
 const otherSeen=new Set();for(let i=0;i<2000;i++)otherSeen.add(other.drawFromPool({kind:'item'}));
 assert.ok(!otherSeen.has(ARMBAND),'普通局不该出现臂章');
 assert.match(fs.readFileSync('dist/native-session.js','utf8'),/itemAllowed\(\w+,this\)/,'装备池过滤走 itemAllowed');
});

test('回合结算：资金换层数、每 25 层发一名、封顶 264',()=>{
 const run=seesSession();
 run.s.level=1;run.setFunds(7);
 run.settleTartarusRound();
 assert.equal(run.s.funds,0,'资金全部消耗');
 assert.equal(tartarusLayers(run),35,'基础每资金 5 层 → 7×5');
 assert.equal(run.s.seesGrants,1,'跨过 25 层发一名');
 assert.equal(run.s.units.length,1);
 assert.equal(run.s.units[0].charId,'char_4220_kormr','1 级商店只能发 1 阶的虎狼丸');
 run.s.round=2;run.s.phase='prep';run.s.level=3;run.setFunds(3);
 run.settleTartarusRound();
 assert.equal(tartarusLayers(run),50);
 assert.equal(run.s.seesGrants,2,'50 层跨过了第二档');
 run.s.round=3;run.s.phase='prep';run.setFunds(1);
 run.settleTartarusRound();
 assert.equal(tartarusLayers(run),55);
 assert.equal(run.s.seesGrants,2,'没到 75 层不发新的');
 run.s.round=4;run.s.phase='prep';run.setFunds(1e6);
 run.settleTartarusRound();
 assert.equal(tartarusLayers(run),264);
 run.s.round=5;run.s.phase='prep';run.setFunds(1000);
 run.settleTartarusRound();
 assert.equal(tartarusLayers(run),264,'满层不再增长');
 assert.equal(tartarusCap(data),264);
 assert.equal(tartarusCap(patchedNumbers({tartarusLayerCap:100})),100,'上限读数据');
 const capped=seesSession();addTartarusLayers(capped,999,patchedNumbers({tartarusLayerCap:100}));
 assert.equal(tartarusLayers(capped),100);
 // 不选这个策略的局：资金照旧被 beginBattle 清零，但不产生层数与发放。
 const other=normalSession();other.s.level=1;other.setFunds(7);
 assert.equal(other.perform('start'),true);
 assert.equal(tartarusLayers(other),0);
 assert.equal(other.s.units.length,0);
});

for(const funds of [0,1])test(`资金 ${funds} 开战补发 S.E.E.S. 干员触发三合一时保留奖励，领取后可继续开战`,()=>{
 const run=seesSession();run.s.round=12;run.s.level=1;run.setFunds(funds);
 addTartarusLayers(run,162-funds*layersPerFund(data,run),data);run.s.seesGrants=5;
 run.gain('chess_collab_kormr');run.gain('chess_collab_kormr');
 assert.equal(run.perform('start'),true,'补发触发晋升奖励不应回滚整次开战操作');
 assert.equal(run.s.phase,'prep');assert.equal(run.battle,null);
 assert.equal(run.s.seesGrants,6);assert.equal(tartarusLayers(run),162);assert.equal(run.s.funds,0);
 assert.equal(run.s.units.length,1,'第三张卡已合成精锐');
 assert.equal(run.s.rewardPending?.kind,'operator');
 const reward=structuredClone(run.s.rewardPending);
 assert.equal(run.perform('start'),false,'未领取奖励时仍禁止开战');
 assert.deepEqual(run.s.rewardPending,reward,'重复点击不能丢失奖励');
 const restored=NativeSession.restore(data,run.snapshot());
 assert.deepEqual(restored.s.rewardPending,reward,'存档往返保留奖励');
 assert.equal(restored.s.seesGrants,6);
 assert.equal(run.perform('takePromotion',reward.offers[0]),true);
 assert.equal(run.s.rewardPending,null);
 assert.equal(run.perform('start'),true);
 assert.equal(run.s.phase,'battle');assert.ok(run.battle);
 assert.equal(run.s.seesGrants,6,'重试开战不能重复发卡');
 assert.equal(tartarusLayers(run),162);
});

test('结算的层数额度：由加莉加成、发放档位账本、候选按阶级与「尽量不重复」',()=>{
 const plain=seesSession();plain.s.units=[];plain.s.funds=2;
 assert.equal(layersPerFund(data,plain),5);
 assert.equal(settleFundsToLayers(data,plain,[]),10);
 const withYukari=seesSession();
 withYukari.s.units=[{uid:1,charId:'char_4219_yukari',chessId:'chess_collab_yukari',position:{x:0,y:0}}];
 assert.equal(layersPerFund(data,withYukari),7,'初始由加莉 +2');
 const eliteYukari=seesSession();
 eliteYukari.s.units=[{uid:1,charId:'char_4219_yukari',chessId:'chess_collab_yukari',isGolden:true,position:{x:0,y:0}}];
 assert.equal(layersPerFund(data,eliteYukari),9,'精锐档读 numbers.uikariPerFund.elite');
 const bench=seesSession();bench.s.units=[{uid:1,charId:'char_4219_yukari',chessId:'chess_collab_yukari',position:null}];
 assert.equal(layersPerFund(data,bench),5,'没上场不给加成');
 const run=seesSession();run.s.level=2;
 assert.deepEqual(seesGrantCandidates(data,run).pool.map(r=>r.charId),['char_4220_kormr','char_4219_yukari']);
 assert.deepEqual(seesGrantCandidates(data,run,{exclude:['char_4220_kormr']}).fresh.map(r=>r.charId),['char_4219_yukari'],'优先不与场上已有的重复');
 run.s.level=1;
 assert.deepEqual(seesGrantCandidates(data,run).pool.map(r=>r.charId),['char_4220_kormr'],'1 级只能发 1 阶');
 const ledger=seesSession();ledger.s.level=1;ledger.s.seesGrants=9;ledger.setFunds(0);
 ledger.settleTartarusRound();
 assert.equal(ledger.s.units.length,0,'账本已到位就不发');
 assert.equal(ledger.s.seesGrants,9);
 assert.equal(grantEveryLayers(data),25);
 assert.equal(grantCountForLayers(patchedNumbers({grantEveryLayers:10}),25),2,'节奏读数据');
});

test('核心盟约：造成弱点伤害时按层数比例对全场敌人结算真实伤害，并按冷却节流',()=>{
 const {g,b}=openBattle(['chess_collab_kormr','chess_collab_yukari','chess_collab_aigis'],{bandId:SEES_BAND_ID,funds:0});
 assert.equal(b.on(SEES_BOND_ID),true,'场上三名 S.E.E.S. 干员 → 核心盟约 3/3 激活');
 assert.equal(b.on(TARTARUS_BOND_ID),true,'【塔尔塔罗斯】0/0 在该策略局恒激活');
 assert.equal(tartarusLayers(g),0);
 const kormr=byId(b,'char_4220_kormr');
 const atkSum=['char_4220_kormr','char_4219_yukari','char_4218_aigis'].reduce((n,id)=>n+b.stats(byId(b,id)).atk,0);
 const a=enemy(b,{hp:100000,x:3,y:3}),c=enemy(b,{hp:100000,x:5,y:3});
 b.s.time=0;
 b.hit(kormr,a,100,'physical');
 const expected=atkSum*coreTrueDamagePercent(data,0);
 assert.ok(Math.abs((100000-a.hp)-(100+expected))<1e-6,`被打的那只：普攻 100 ＋ 核心真实伤害 ${expected}`);
 assert.ok(Math.abs((100000-c.hp)-expected)<1e-6,'全场（不只是被打的那只）');
 assert.equal(b.s.seesCoreNextAt,coreCooldown(data,0),'触发后进入冷却');
 const cAfterCore=100000-c.hp;
 b.hit(kormr,c,100,'physical');
 assert.ok(Math.abs((100000-c.hp)-(cAfterCore+100))<1e-6,'冷却内只结算这一击的普通伤害，核心不会再触发');
 addTartarusLayers(g,264,data);
 // 埃癸斯自己也会随层数变强，所以满层那一击要按**加层后**的攻击总和算。
 const atkSumFull=['char_4220_kormr','char_4219_yukari','char_4218_aigis'].reduce((n,id)=>n+b.stats(byId(b,id)).atk,0);
 b.s.time=coreCooldown(data,0);
 const d=enemy(b,{hp:100000,x:6,y:3});
 b.hit(kormr,d,100,'physical');
 const full=atkSumFull*coreTrueDamagePercent(data,264);
 assert.ok(Math.abs((100000-d.hp)-(100+full))<1e-6,`满层按 40% 结算（${full}）`);
 assert.equal(coreCooldown(data,264),1);
 assert.equal(coreTrueDamagePercent(data,264),0.4);
 assert.equal(coreTrueDamagePercent(data,0),0.05);
 assert.equal(coreTrueDamagePercent(patchedNumbers({coreTrueDamagePercentBase:0.1}),0),0.1,'比例读数据');
 const other=openBattle(['chess_collab_kormr','chess_collab_yukari','chess_collab_aigis'],{funds:0});
 const e=enemy(other.b,{hp:100000,x:3,y:3});
 other.b.hit(byId(other.b,'char_4220_kormr'),e,100,'physical');
 assert.equal(100000-e.hp,100,'默认局只有普通伤害');
});

test('臂章：追加弱点伤害；装备者是【S.E.E.S.】盟约时再追加真实伤害',()=>{
 const {g,b,unit}=equippedBattle('chess_collab_kormr');
 const e=enemy(b,{hp:100000,x:3,y:3});
 b.hit(unit,e,1000,'physical');
 assert.equal(100000-e.hp,1000+100+100,'弱点伤害 10% ＋ 真实伤害 10%');
 // 改黑板数值 → 追加伤害跟着变。
 const rows=data.season.effectBuffInfoDataDict[data.season.trapChessDataDict[ARMBAND].effectId];
 const setScale=(key,value)=>{rows[0].blackboard.find(x=>x.key===key).value=value;};
 setScale('weakness_scale',0.5);setScale('true_scale',0.5);
 const e2=enemy(b,{hp:100000,x:4,y:3});
 b.hit(unit,e2,1000,'physical');
 assert.equal(100000-e2.hp,1000+500+500,'比例读黑板');
 setScale('weakness_scale',0.1);setScale('true_scale',0.1);
 // 非 S.E.E.S. 盟约的携带者：只有弱点那一半，没有真实伤害。
 const non=equippedBattle(normalChessId());
 const e3=enemy(non.b,{hp:100000,x:3,y:3});
 non.b.hit(non.unit,e3,1000,'physical');
 assert.equal(100000-e3.hp,1000+100,'不是 S.E.E.S. 盟约就不追加真实伤害');
 assert.equal(g.s.items.length+non.g.s.items.length,0,'装上的臂章不该还留在整备区');
});

test('虎狼丸：伤害转弱点伤害，且不占用部署位',()=>{
 const {g,b}=openBattle(['chess_collab_kormr','chess_collab_yukari'],{bandId:SEES_BAND_ID,funds:0});
 const kormr=byId(b,'char_4220_kormr');
 const highDef=enemy(b,{hp:100000,x:3,y:3,def:900,res:0});
 b.hit(kormr,highDef,1000,'physical');
 assert.ok(100000-highDef.hp>=1000-1e-6,'高防目标照样吃满（走法抗那一侧的低减伤）');
 assert.equal(weaknessSource(kormr),true);
 assert.equal(weaknessSource(byId(b,'char_4219_yukari')),false);
 assert.equal(freeDeploy(data,kormr),true);
 assert.equal(freeDeploy(data,byId(b,'char_4219_yukari')),false);
 // 部署位：上限 1 时，虎狼丸不占名额。
 const run=seesSession();run.s.capacity=1;run.s.phase='prep';
 const first=run.gain('chess_collab_yukari'),second=run.gain('chess_collab_kormr');
 const spot=uid=>{for(let y=0;y<run.map.rows;y++)for(let x=0;x<run.map.cols;x++){if(run.s.units.some(v=>v.uid!==uid&&v.position?.x===x&&v.position?.y===y))continue;if(run.canDeploy(uid,x,y))return {x,y};}return null;};
 const s1=spot(first.uid);assert.ok(run.deploy(first.uid,s1.x,s1.y,0));
 const s2=spot(second.uid);assert.ok(s2,'虎狼丸不受部署上限限制');
 assert.ok(run.deploy(second.uid,s2.x,s2.y,0));
 const third=run.gain('chess_collab_aigis');
 const freeTile=()=>{for(let y=0;y<run.map.rows;y++)for(let x=0;x<run.map.cols;x++){const cell=run.map.grid[y][x];if(cell.buildableType==='NONE'||cell.obstacle)continue;if(run.s.units.some(v=>v.position?.x===x&&v.position?.y===y))continue;return {x,y};}return null;};
 const cell3=freeTile();
 assert.ok(cell3&&!run.canDeploy(third.uid,cell3.x,cell3.y),'名额已满，普通干员上不去');
 const play=fs.readFileSync('dist/native-play.js','utf8');
 assert.ok(play.includes('function deployCount(s)')&&play.includes('${deployCount(s)} / ${s.capacity}'),'界面计数也要排除虎狼丸');
});

test('埃癸斯：攻击与生命随【塔尔塔罗斯】层数每层 +0.2%',()=>{
 assert.equal(aigisLayerScale(data,0),1);
 assert.ok(Math.abs(aigisLayerScale(data,264)-1.528)<1e-9);
 assert.ok(Math.abs(aigisLayerScale(data,100)-1.2)<1e-9);
 assert.ok(Math.abs(aigisLayerScale(patchedNumbers({aigisPerLayer:0.01}),10)-1.1)<1e-9,'每层比例读数据');
 const {g,b}=openBattle(['chess_collab_aigis'],{bandId:SEES_BAND_ID,funds:0});
 const aigis=byId(b,'char_4218_aigis');
 const base=b.stats(aigis);
 addTartarusLayers(g,100,data);
 const scaled=b.stats(aigis);
 assert.ok(Math.abs(scaled.atk/base.atk-1.2)<1e-6,'攻击 +20%');
 assert.ok(Math.abs(scaled.maxHp/base.maxHp-1.2)<1e-6,'生命 +20%');
 // 不选这个策略的局不生效（即便有人手工往账本里塞层数）。
 const other=openBattle(['chess_collab_aigis'],{funds:0});
 const plain=byId(other.b,'char_4218_aigis');
 const before=other.b.stats(plain);
 other.g.s.bondLayers={tartarusShip:100};
 const after=other.b.stats(plain);
 assert.equal(after.atk,before.atk);
 assert.equal(after.maxHp,before.maxHp);
});

test('结城理：击倒敌人与自身被击倒各加初始/精锐层数',()=>{
 assert.equal(makotoKillLayers(data,{charId:'char_4217_makoto',chessId:'chess_collab_makoto'}),5);
 assert.equal(makotoKillLayers(data,{charId:'char_4220_kormr',chessId:'chess_collab_kormr'}),0,'只对结城理本人计数');
 assert.equal(makotoKillLayers(patchedNumbers({makotoKillLayers:{initial:7,elite:11}}),{charId:'char_4217_makoto'}),7,'数值读数据');
 const {g,b}=openBattle(['chess_collab_makoto'],{bandId:SEES_BAND_ID,funds:0});
 const makoto=byId(b,'char_4217_makoto');
 assert.ok(isSeesOperator(data,makoto));
 const e=enemy(b,{hp:10,x:3,y:3});
 b.hit(makoto,e,1000,'physical');
 assert.equal(tartarusLayers(g),5,'击倒一名敌人 +5');
 const derived=enemy(b,{hp:10,x:4,y:3,derived:true});
 b.hit(makoto,derived,1000,'physical');
 assert.equal(tartarusLayers(g),5,'衍生敌人（碎片／召唤）不算击倒');
 b.s.enemies.length=0;
 makoto.hp=1;
 b.hurt(makoto,enemy(b,{hp:100,atk:1,x:5,y:3}),{damageAmount:99999});
 assert.ok(tartarusLayers(g)>=10,'自身被击倒 +5');
});

test('海猫模式下的 S.E.E.S. 局：资金保持哨兵值，层数按封顶算',()=>{
 const run=seesSession({cat:true});
 run.s.level=1;
 run.settleTartarusRound();
 assert.equal(run.s.funds,Number.MAX_SAFE_INTEGER,'cat 模式下 `setFunds(0)` 不该把哨兵值打回普通数（AGENTS 红线）');
 assert.equal(tartarusLayers(run),264,'无限资金一次封顶，不会算成 Infinity／NaN');
});

test('存档往返：band、层数与发放档位都读得回来',()=>{
 const run=seesSession();
 run.s.level=2;run.setFunds(6);
 assert.equal(run.perform('start'),true,run.lastError||'');
 const snap=run.snapshot(),back=NativeSession.restore(data,snap);
 assert.ok(back,'S.E.E.S. 局要能从存档读回（数据总是烘进运行时，不依赖解锁标记）');
 assert.equal(back.s.bandId,SEES_BAND_ID);
 assert.equal(tartarusLayers(back),tartarusLayers(run));
 assert.equal(back.s.seesGrants,run.s.seesGrants);
 assert.equal(back.eligible().filter(o=>o.sees).length,4,'读档后卡池资格仍然成立');
 assert.equal(back.s.stock[SEES_CHESS[0]]>0,true,'读档后库存也在');
});

test('面板：侧栏与盟约卡的计数口径',()=>{
 const run=seesSession();run.s.bondLayers={[TARTARUS_BOND_ID]:77};
 assert.equal(bondPanelCount(data,run,TARTARUS_BOND_ID,0),77);
 assert.equal(bondPanelCount(data,run,SEES_BOND_ID,3),3,'别的盟约照旧按成员数');
 assert.equal(run.bonds().tartarusShip.count,77,'战报的盟约情况也按层数记账');
 assert.equal(run.bonds().tartarusShip.active,true,'该策略局恒激活');
 assert.ok(bondCurrentPreviewHtml(data,TARTARUS_BOND_ID,77).includes('264 层'),'面板要显示层数上限');
 assert.ok(bondCurrentPreviewHtml(data,SEES_BOND_ID,264).includes('40%'),'面板要显示满层比例');
 assert.ok(bondCurrentPreviewHtml(data,SEES_BOND_ID,132).includes('22.5%'),'面板按当前层数算比例');
 assert.ok(bondCurrentPreviewHtml(data,SEES_BOND_ID,264).includes('1 秒'),'满层冷却 1 秒');
 const plain=normalSession();
 assert.equal(plain.bonds().tartarusShip,undefined,'默认局的盟约行里没有这两条（侧栏／战报都不该出现）');
 assert.equal(plain.bonds().seesShip,undefined);
 assert.equal(Object.keys(plain.bonds()).length,23);
 assert.equal(Object.keys(run.bonds()).length,25);
 const play=fs.readFileSync('dist/native-play.js','utf8');
 assert.ok(play.includes('bondPanelCount(data,s,id,b.count)'),'侧栏计数走 bondPanelCount');
 assert.ok(!play.includes('${b.count} / ${data.season.bondInfoDict[id].activeCount}'),'不要再直接印成员数');
});

// 记录型假 canvas：只统计「画了什么」，不参与任何判定（特效回归都用这套）。
function recordingCtx(){
 const calls=[],texts=[];
 const ctx={calls,texts,save(){calls.push('save');},restore(){calls.push('restore');},beginPath(){calls.push('beginPath');},stroke(){calls.push('stroke');},fill(){calls.push('fill');},moveTo(){},lineTo(){},arc(){calls.push('arc');},ellipse(){calls.push('ellipse');},fillRect(){calls.push('fillRect');},fillText(t){texts.push(String(t));},set fillStyle(v){calls.push('fillStyle');},get fillStyle(){return '#000';},set strokeStyle(v){calls.push('strokeStyle');},get strokeStyle(){return '#000';},set lineWidth(v){},get lineWidth(){return 1;},set font(v){},get font(){return '';},set textAlign(v){},get textAlign(){return '';},set globalAlpha(v){},get globalAlpha(){return 1;},set globalCompositeOperation(v){},get globalCompositeOperation(){return 'source-over';}};
 return ctx;
}

test('核心盟约的表现：触发时画出扩散环与比例标签（reduceFx 只留静止环）',()=>{
 const point=(x,y)=>({x:x*40,y:y*40}),z={tw:40,th:40};
 const battle={s:{time:1,events:[{type:'sees-core',t:.9,x:2,y:3,layers:132,percent:.225}]}};
 const ctx=recordingCtx();
 assert.equal(drawSeesCore(ctx,point,z,battle),true);
 assert.ok(ctx.calls.includes('ellipse'),'要画扩散环');
 assert.ok(ctx.texts.some(t=>/S\.E\.E\.S\.\s*弱点追击\s*22\.5%/.test(t)),'要带比例标签');
 const reduced=recordingCtx();
 assert.equal(drawSeesCore(reduced,point,z,battle,{reduceFx:true}),true);
 assert.equal(reduced.texts.length,1,'reduceFx 下标签照旧');
 assert.ok(reduced.calls.includes('ellipse'),'reduceFx 下仍留静止环');
 assert.equal(drawSeesCore(recordingCtx(),point,z,{s:{time:5,events:[]}}),false,'没有事件就不画');
 assert.equal(drawSeesCore(recordingCtx(),point,z,{s:{time:9,events:[{type:'sees-core',t:1,x:0,y:0,percent:.1}]}}),false,'过期事件不画');
});

test('接线门禁：构建脚本、构建清单与四个运行时模块都接上了',()=>{
 const build=fs.readFileSync('scripts/build-protocol.mjs','utf8'),native=fs.readFileSync('scripts/build-native.mjs','utf8');
 assert.ok(build.includes("import {applySeesContent,loadSeesContent} from './lib/sees-content.mjs'"));
 assert.ok(build.includes('applySeesContent(data);'));
 assert.ok(build.includes('{roster,items,bands,maps,modes,enemies,bonds:data.season.bondInfoDict,sees}'),'catalog 要带上 sees 清单');
 assert.ok(native.includes('applySeesContent(source);'));
 assert.ok(native.includes('sees:catalog.sees||null'));
 assert.ok(fs.readFileSync('scripts/build-browser.mjs','utf8').includes("'native-sees.js'"),'native-sees 要进浏览器包');
 const session=fs.readFileSync('dist/native-session.js','utf8');
 assert.ok(session.includes('settleTartarusRound()')&&session.includes('this.settleTartarusRound()'),'回合结算要挂在开战前');
 assert.ok(session.includes('operatorAllowed(this.data,o,this)'),'eligible 放行四人');
 const battle=fs.readFileSync('dist/native-battle.js','utf8');
 assert.ok(battle.includes('seesCoreStrike(u)')&&battle.includes('seesArmbandStrike(u,e,value'));
 assert.ok(battle.includes('weaknessSource(u)'),'虎狼丸的弱点转化接在命中类型路由上');
 assert.ok(fs.readFileSync('dist/native-sees.js','utf8').includes('addTartarusLayers(s, per * funds, data)'),'封顶要读数据');
 assert.ok(fs.readFileSync('dist/native-bond-ban.js','utf8').includes('SEES_EXCLUSIVE_BONDS'),'禁用池排除两条专属盟约');
});

test('无禁用方案可用于本文件的会话构造',()=>assert.deepEqual(NO_BOND_BAN,{bonds:[]}));
