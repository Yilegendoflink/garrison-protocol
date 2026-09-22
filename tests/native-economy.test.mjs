import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {NativeEconomy} from '../dist/native-economy.js';import {NativeSession} from '../dist/native-session.js';import {NATIVE_DATA} from '../dist/runtime-data.js';import {SERVER_GARRISON_TYPES} from '../dist/garrison.js';
const data=JSON.parse(fs.readFileSync('data/modes/alliance-lower/source.json','utf8'));
const chessFor=gid=>Object.values(data.season.charShopChessDatas).find(s=>s.charId&&data.season.charChessDataDict[s.chessId].garrisonIds.includes(gid));
const unit=(s,uid,position=null)=>({uid,chessId:s.chessId,charId:s.charId,rank:s.chessLevel,dir:0,position,equipment:[]});
// 本文件测的是商店／库存／盟约发放的既有口径，不测盟约禁用，所以构造会话时显式关掉本局禁用，
// 保证抽卡池就是完整名册（否则某个盟约被禁会把 A/B/C 或叙拉古干员从池里剔掉）。
const NO_BOND_BAN={bonds:[],exempt:{}};
test('every historical server garrison type has an explicit handler; battle abilities remain separate',()=>{const required=[...new Set(Object.values(data.season.garrisonDataDict).filter(g=>g.eventType.startsWith('SERVER_')).map(g=>g.effectType))];assert.equal(required.length,28);assert.deepEqual(required.filter(t=>!SERVER_GARRISON_TYPES.includes(t)),[]);});
test('third acquired operator triggers elite gain effect, not a third normal effect plus elite effect',()=>{const c=new NativeEconomy(data,'mode_single_normal'),shop=chessFor('garrison_25_a');c.gain(shop.chessId);c.gain(shop.chessId);c.gain(shop.chessId);assert.equal(c.s.units.length,1);assert.equal(data.season.charChessDataDict[c.s.units[0].chessId].isGolden,true);for(const id of data.season.charChessDataDict[shop.chessId].bondIds)if(!data.season.bondInfoDict[id].noStack)assert.equal(c.s.bondLayers[id],8);assert.equal(c.s.roundGainCount,3);});
test('shop refresh draws without replacement from the stock pool (3/3/4 gives 30/30/40)',()=>{const c=new NativeSession(NATIVE_DATA,{seed:7,bondBan:NO_BOND_BAN});c.s.level=6;c.pick=rows=>rows[0];const [A,B,C]=Object.values(NATIVE_DATA.season.charShopChessDatas).filter(s=>s.charId&&!s.isHidden&&s.chessLevel===1).map(s=>s.chessId);for(const id of Object.keys(c.s.stock))c.s.stock[id]=0;c.s.stock[A]=5;assert.equal(c.drawFromPool({kind:'operator',maxTier:6},{}),A,'只有 A 有库存时只能抽到 A');for(const id of Object.keys(c.s.stock))c.s.stock[id]=0;c.s.stock[A]=3;c.s.stock[B]=3;c.s.stock[C]=4;const counts={[A]:0,[B]:0,[C]:0};for(let i=0;i<1200;i++)for(const id of c.rollOffers())if(id)counts[id]++;const total=counts[A]+counts[B]+counts[C];assert.ok(Math.abs(counts[A]/total-0.3)<0.04,'A 应约占 30%，实际 '+(counts[A]/total).toFixed(3));assert.ok(Math.abs(counts[B]/total-0.3)<0.04,'B 应约占 30%，实际 '+(counts[B]/total).toFixed(3));assert.ok(Math.abs(counts[C]/total-0.4)<0.04,'C 应约占 40%，实际 '+(counts[C]/total).toFixed(3));for(const id of Object.keys(c.s.stock))c.s.stock[id]=0;c.s.stock[A]=1;let maxSame=0;for(let i=0;i<400;i++)maxSame=Math.max(maxSame,c.rollOffers().filter(x=>x===A).length);assert.equal(maxSame,1,'同一家店出现的同名卡不得超过剩余库存');});
test('store rolls the tier first, then draws from that tier stock (30/40/30 by shop level)',()=>{const c=new NativeSession(NATIVE_DATA,{seed:11});c.s.level=6;for(const id of Object.keys(c.s.stock))c.s.stock[id]=99;const counts={};let total=0;for(let i=0;i<600;i++)for(const id of c.rollOffers()){if(!id)continue;const lv=NATIVE_DATA.season.charShopChessDatas[id].chessLevel;counts[lv]=(counts[lv]||0)+1;total++;}const share=lv=>(counts[lv]||0)/total,lower=[1,2,3,4].reduce((n,lv)=>n+share(lv),0);assert.ok(Math.abs(share(6)-0.3)<0.04,'最高阶应约占 30%，实际 '+share(6).toFixed(3));assert.ok(Math.abs(share(5)-0.4)<0.04,'次高阶应约占 40%，实际 '+share(5).toFixed(3));assert.ok(Math.abs(lower-0.3)<0.04,'更低阶合计应约占 30%，实际 '+lower.toFixed(3));});
test('a rolled-out tier falls back to a random draw over the rest of the pool',()=>{const c=new NativeSession(NATIVE_DATA,{seed:12});c.s.level=6;for(const id of Object.keys(c.s.stock))c.s.stock[id]=0;for(const id of Object.keys(c.s.stock))if(NATIVE_DATA.season.charShopChessDatas[id].chessLevel===1)c.s.stock[id]=9;for(let i=0;i<200;i++)for(const id of c.rollOffers()){assert.ok(id,'掷中卖空的阶级时不能留下空槽');assert.equal(NATIVE_DATA.season.charShopChessDatas[id].chessLevel,1,'只有 1 阶有库存时只能给出 1 阶');}});
test('vision reserve activation claims each threshold once and preserves unlocked discounts',()=>{const c=new NativeEconomy(data,'mode_single_normal');const shops=Object.values(data.season.charShopChessDatas).filter(s=>s.charId&&data.season.charChessDataDict[s.chessId].bondIds.includes('visiShip'));const second=shops.find(s=>s.charId!==shops[0].charId);c.s.units=[unit(shops[0],1),unit(second,2)];c.addLayers('visiShip',80);assert.equal(c.s.funds,20);assert.equal(c.s.permanentDiscount,1);c.settleBondRewards();assert.equal(c.s.funds,20);c.s.units=[];assert.equal(c.s.permanentDiscount,1);});
test('investors repeat a gain trait twice, then three times at 100 layers',()=>{const c=new NativeEconomy(data,'mode_single_normal');const shops=Object.values(data.season.charShopChessDatas).filter(s=>s.charId&&data.season.charChessDataDict[s.chessId].bondIds.includes('investShip'));const chosen=[...new Map(shops.map(s=>[s.charId,s])).values()].slice(0,3);c.s.units=chosen.map((s,i)=>unit(s,i+1));c.s.seq=3;const recipient=chessFor('garrison_25_a'),bond=data.season.charChessDataDict[recipient.chessId].bondIds.find(id=>!data.season.bondInfoDict[id].noStack);c.gain(recipient.chessId);assert.equal(c.s.bondLayers[bond],4);c.s.bondLayers.investShip=100;c.gain(recipient.chessId);assert.equal(c.s.bondLayers[bond],10);});
test('unresolved random reward rolls back purchase, funds, units, counters and random state',()=>{const shop=chessFor('garrison_149_a'),c=new NativeEconomy(data,'mode_single_normal',{funds:100,offers:[shop.chessId]});c.s.level=6;const before=JSON.stringify(c.s),result=c.command('buy',0);assert.equal(result.ok,false);assert.equal(result.code,'EFFECT_UNRESOLVED');assert.equal(JSON.stringify(c.s),before);});
test('source fixed grants and carry-over interest execute on their exact rounds',()=>{const gift=new NativeEconomy(data,'mode_single_normal',{bandId:'band_justin'});assert.equal(gift.command('startPreparation').ok,true);assert.equal(gift.s.items[0].chessId,'chess_item_3_12_e_a');assert.equal(gift.command('startPreparation').ok,false);assert.equal(gift.s.items.length,1);const c=new NativeEconomy(data,'mode_single_normal',{bandId:'band_cannot',funds:7});c.startPreparation();assert.equal(c.command('beginBattle').ok,true);assert.equal(c.s.funds,0);c.finishBattle({success:true});c.nextRound([]);assert.equal(c.s.funds,13);});
test('Lee strategy defers early base funding and resolves the declared tier-two and tier-four rewards',()=>{const c=new NativeEconomy(data,'mode_single_normal',{bandId:'band_lmlee',draw:r=>{const tier=Number(r.pool.match(/shop_(\d)/)[1]);return Object.values(data.season.charShopChessDatas).find(s=>s.charId&&!s.isHidden&&s.chessLevel===tier).chessId;}});c.startPreparation();assert.equal(c.s.funds,0);c.beginBattle();c.finishBattle({success:true});c.nextRound();assert.equal(c.s.funds,0);c.beginBattle();c.finishBattle({success:true});c.nextRound();assert.equal(c.s.funds,15);assert.deepEqual(c.s.units.map(u=>u.rank).sort(),[2,4]);});

test('miracle probability is 18% plus 0.3% per layer and only grants when no free refresh remains',()=>{const c=new NativeEconomy(data,'mode_single_normal',{funds:100});const shops=Object.values(data.season.charShopChessDatas).filter(s=>s.charId&&data.season.charChessDataDict[s.chessId].bondIds.includes('miraShip'));const unique=[...new Map(shops.map(s=>[s.charId,s])).values()];c.s.units=unique.slice(0,2).map((s,i)=>unit(s,i+1));const offer=Object.values(data.season.charShopChessDatas).find(s=>s.charId&&!s.isHidden&&s.chessLevel===1).chessId;c.s.bondLayers.miraShip=40;c.random=()=>.299;assert.equal(c.refresh([offer]),true);assert.equal(c.s.freeRefresh,1);c.s.freeRefresh=2;let calls=0;c.random=()=>{calls++;return 0;};c.refresh([offer]);assert.equal(c.s.freeRefresh,1);assert.equal(calls,0);c.s.freeRefresh=0;c.random=()=>.301;c.refresh([offer]);assert.equal(c.s.freeRefresh,0);});

test('巫恋出售交换已实现后可正常进入准备阶段',()=>{const c=new NativeEconomy(data,'mode_single_normal',{bandId:'band_vodfox'});assert.equal(c.command('startPreparation').ok,true);assert.equal(c.s.lastPrepRound,1);});

test('三选一奖励每次给出的候选互不重复',()=>{
 const g=new NativeSession(NATIVE_DATA,{seed:3});g.s.rewardPending={tier:6};g.s.rewardQueue=[];
 g.ensureRewards();
 const offers=g.s.rewardPending.offers;
 assert.equal(offers.length,3,'三合一奖励仍是三选一');
 assert.equal(new Set(offers).size,3,'三合一奖励不应出现重复候选');
 assert.ok(offers.every(id=>NATIVE_DATA.profiles[id]),'候选必须都是合法干员');
});

test('盟约调配奖励同样不重复',()=>{
 const g=new NativeSession(NATIVE_DATA,{seed:4});
 g.s.rewardPending=null;g.s.rewardQueue=[];
 g.rewardFromTier(3,3);
 assert.equal(g.s.rewardPending.offers.length,3);
 assert.equal(new Set(g.s.rewardPending.offers).size,3,'高台调配奖励不应重复');
 g.s.rewardPending=null;g.s.rewardQueue=[];
 const owner=g.gain(g.s.offers.find(Boolean));
 // 隐现的盟约在 1 级商店只有 1~2 名候选，凑不出三张不同的卡；升到 6 级让盟约池够大
 g.s.level=6;
 g.s.rewardPending=null;g.s.rewardQueue=[];
 assert.equal(g.rewardFromBond(owner,3),true);
 assert.equal(g.s.rewardPending.offers.length,3);
 assert.equal(new Set(g.s.rewardPending.offers).size,3,'盟约奖励不应重复');
});

// 贾维【团伙行动】口径（用户 2026-09-19 确认）：主动刷新次数跨回合累计，每满 6 次发 1 名叙拉古干员，
// 「每回合至多 2 名」只约束发放节奏——被上限挡住的份数留到之后回合补发，同一档里程碑不重复兑现。
// 发放按 s.events 的 gain 计数（三合一合并会减少 s.units，不能拿干员数当发放数）。
test('贾维：主动刷新次数跨回合累计，满 6 次发 1 名叙拉古，单回合至多 2 名',()=>{
 const c=new NativeSession(NATIVE_DATA,{bandId:'band_chiave',seed:9,bondBan:NO_BOND_BAN});
 c.s.funds=1e9;
 const grants=()=>c.s.events.filter(e=>e.type==='gain').length;
 const lastGain=()=>c.s.events.filter(e=>e.type==='gain').at(-1)?.chessId;
 const nextRound=()=>{c.s.phase='intermission';assert.equal(c.perform('next'),true);c.s.funds=1e9;};   // nextRound 会把资金重置成当回合基础资金，刷满要补
 for(let i=0;i<3;i++)assert.equal(c.perform('refresh'),true);
 assert.equal(c.s.refreshCountTotal,3,'累计计数要记录本回合的刷新');
 assert.equal(grants(),0,'同一回合不满 6 次不发干员');
 nextRound();
 assert.equal(c.s.roundRefreshCount,0,'本回合计数换回合清零');
 assert.equal(c.s.refreshCountTotal,3,'累计计数换回合必须保留');
 for(let i=0;i<3;i++)assert.equal(c.perform('refresh'),true);
 assert.equal(grants(),1,'跨回合累计满 6 次发 1 名');
 assert.ok(NATIVE_DATA.season.charChessDataDict[lastGain()].bondIds.includes('siracusaShip'),'发的必须是叙拉古干员');
 nextRound();
 c.perform('refresh');   // 累计 7 次
 assert.equal(grants(),1,'同一档里程碑不能重复兑现');
 nextRound();
 for(let i=0;i<17;i++)c.perform('refresh');   // 累计 24 次 -> 4 档
 assert.equal(grants(),3,'单回合至多 2 名，其余留到之后补发');
 nextRound();
 c.perform('refresh');
 assert.equal(grants(),4,'被单回合上限挡住的份数在下个回合补发');
 assert.equal(c.s.strategyClaims['band_chiave:0:total'],4,'跨回合进度键按实际发放数累计');
});

