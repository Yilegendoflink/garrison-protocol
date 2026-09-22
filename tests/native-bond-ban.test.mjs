import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_DATA as data} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {runGarrison} from '../dist/garrison.js';
import {
 BAN_CORE_COUNT,BAN_EXTRA_COUNT,BOND_BAN_EXCLUDED,BOND_BAN_KEY,BOND_BAN_VERSION,BOND_EXEMPT_TABLE,
 banPool,bondBanBlockers,bondBanIds,bondBanSummary,bondIds,bondIsBanExcluded,bondIsCore,
 bondBanBriefingHtml,bannedOperatorsHtml,activeBondBan,
 bondMembers,bondName,bondRoster,charIdOf,defaultBondExempt,isOperatorBanned,loadBondBan,normalizeBondBan,
 resolveBondExempt,saveBondBan,
} from '../dist/native-bond-ban.js';
import {editorState,renderWaveEditor,applyEditorAction} from '../dist/native-wave-editor.js';
import {defaultWaveTable} from '../dist/native-wave-fill.js';

// 盟约禁用（用户 2026-09-22 口径，第二版）：
//  * 每局从全部 23 个盟约里随机禁 3 个核心 + 4 个附加，不看模式表的 inactiveBondIdList／trBannedBondIds。
//  * 每个盟约各有一份「不禁用名单」：被禁盟约的成员只有名单上的还能出场，其余全部禁用——
//    哪怕它还挂着别的没被禁的盟约。「名下盟约全被禁才禁用」是错的第一版，别再退回去。
//  * 商店之外的渠道（策略／道具／卫戍点名发放／援军转让）同样拿不到。
const BAN_BOND='yanShip';
const BAN_EXEMPT={[BAN_BOND]:[]};
const sessionWith=(bonds,exempt,options={})=>new NativeSession(data,{seed:7,bondBan:{bonds,exempt},...options});
const firstMember=bond=>bondMembers(data,bond)[0];
const multiBondRow=()=>{for(const bond of bondIds(data))for(const row of bondMembers(data,bond))if(row.bonds.length>1)return row;return null;};

test('每局随机禁 3 个核心 + 4 个附加盟约，协防干员／绝技／调和／独行不入池，同一 seed 结果固定',()=>{
 const {core,extra}=banPool(data);
 assert.equal(BAN_CORE_COUNT,3);assert.equal(BAN_EXTRA_COUNT,4);
 assert.equal(bondIds(data).length,23);
 assert.equal(core.length,8,'8 个核心盟约全部可被禁');
 assert.equal(extra.length,11,'15 个附加盟约里除去固定豁免的 4 个，剩 11 个可被禁');
 assert.deepEqual(core.filter(bondIsBanExcluded),[]);
 assert.deepEqual(extra.filter(bondIsBanExcluded),[]);
 for(const id of BOND_BAN_EXCLUDED)assert.equal(bondIsBanExcluded(id),true);
 assert.deepEqual([...BOND_BAN_EXCLUDED].sort(),['emptyShip','maniShip','soloShip','suntShip'],'固定不被禁的是协防干员／绝技／调和／独行');
 for(const seed of [1,2,3,7,42,999]){
  const ids=bondBanIds(data,seed);
  assert.equal(ids.length,7);
  assert.equal(new Set(ids).size,7,'同一局不能重复禁同一个盟约');
  assert.equal(ids.filter(id=>bondIsCore(data,id)).length,3,'核心盟约固定 3 个');
  assert.equal(ids.filter(id=>!bondIsCore(data,id)).length,4,'附加盟约固定 4 个');
  assert.deepEqual(ids.filter(bondIsBanExcluded),[],'固定豁免的盟约不许被抽中');
  assert.deepEqual(bondBanIds(data,seed),ids,'同一 seed 必须抽到同一批');
 }
 // 不受模式表影响：模式表声明过的盟约（只要在可禁池里）同样会被抽中，说明抽取范围不是模式表。
 const declared=new Set(Object.values(data.season.modeDataDict).flatMap(m=>m.inactiveBondIdList||[]));
 assert.ok(declared.size>0,'模式表本身应当声明禁用盟约，用于确认我们没在读它');
 const drawn=new Set(Array.from({length:400},(_,i)=>bondBanIds(data,i)).flat());
 const declaredDrawable=[...declared].filter(id=>!bondIsBanExcluded(id));
 assert.ok(declaredDrawable.length>0,'模式表里应当有可被禁的盟约');
 assert.ok(declaredDrawable.every(id=>drawn.has(id)),'模式表声明过的盟约同样会被抽中（说明没按模式表过滤）');
 assert.deepEqual([...drawn].sort(),[...core,...extra].sort(),'可禁的 19 个盟约都会出现在抽取范围里');
 for(const id of BOND_BAN_EXCLUDED)assert.equal(drawn.has(id),false,'固定豁免的盟约永远不进抽取范围');
});

test('禁用判定＝「挂在被禁盟约名下且不在该盟约的不禁用名单里」，与是否还有其他盟约无关',()=>{
 const row=multiBondRow();
 assert.ok(row&&row.bonds.length>1,'需要一名多盟约干员做这条口径的样本');
 const [bondA,bondB]=row.bonds;
 // 只禁 bondA、名单为空：哪怕它还挂着没被禁的 bondB，也必须禁用（第一版口径的错就在这）。
 assert.equal(isOperatorBanned(data,[bondA],{},row.charId),true);
 // 上了 bondA 的不禁用名单就照常可用；名单只对对应的那个盟约生效。
 assert.equal(isOperatorBanned(data,[bondA],{[bondA]:[row.charId]},row.charId),false);
 assert.equal(isOperatorBanned(data,[bondA,bondB],{[bondA]:[row.charId]},row.charId),true);
 assert.equal(isOperatorBanned(data,[bondA,bondB],{[bondA]:[row.charId],[bondB]:[row.charId]},row.charId),false);
 assert.deepEqual(bondBanBlockers(data,[bondA,bondB],{[bondA]:[row.charId]},row.charId),[bondB]);
 // 非名册干员（虚拟干员）没有盟约，不受影响。
 assert.equal(isOperatorBanned(data,[bondA],{},'chess_virtual_prepared_medic'),false);
});

test('干员身份按 charId 归并：精锐形态与初始形态共用一条名单',()=>{
 const shop=Object.values(data.season.charShopChessDatas).find(s=>s.charId&&s.goldenChessId);
 const golden=shop.goldenChessId,bond=data.profiles[shop.chessId].bonds[0];
 assert.notEqual(golden,shop.chessId);
 assert.equal(charIdOf(data,golden),shop.charId);
 assert.equal(charIdOf(data,shop.chessId),shop.charId);
 assert.equal(isOperatorBanned(data,[bond],{},golden),isOperatorBanned(data,[bond],{},shop.chessId));
 const g=sessionWith([bond],{});
 assert.equal(g.bondBanned(golden),true,'精锐形态也要按同一名干员判禁');
 assert.equal(bondMembers(data,bond).filter(row=>row.charId===shop.charId).length,1,'名册里同一名干员只登记一次');
});

test('名单语义（用户 2026-09-22 确认）：只有被「所有」被禁盟约的名单豁免才保留',()=>{
 // 原话：只要不在某个盟约的名单上就被禁，即「不被所有禁用名单禁用」才保留。
 // 所以一名干员的多个盟约里，只要有一个被禁且它的名单上没写这名干员，就出局。
 const exempt=defaultBondExempt(data).exempt;
 const charOf=(bond,name)=>{const row=bondMembers(data,bond).find(r=>r.name===name);assert.ok(row,`${bondName(data,bond)} 应该有 ${name}`);return row.charId;};
 const archet=charOf('lateranoShip','空弦'),malist=charOf('sargonShip','至简'),blaze2=charOf('yanShip','烛煌'),ashlok=charOf('kazimierzShip','灰毫');
 // 空弦：拉特兰名单上有它，灵巧名单上没它 → 灵巧被禁时出局，只有拉特兰被禁时保留。
 assert.equal(isOperatorBanned(data,['lateranoShip'],exempt,archet),false,'拉特兰名单上有空弦');
 assert.equal(isOperatorBanned(data,['skillfulShip'],exempt,archet),true,'空弦不在灵巧名单上，灵巧被禁就该出局');
 assert.equal(isOperatorBanned(data,['lateranoShip','skillfulShip'],exempt,archet),true,'一个被禁盟约没豁免它就留不住');
 // 至简同理：萨尔贡名单上的它在灵巧被禁时照样出局（seed 3 的「萨尔贡 0/10 幸存」就是这么来的）。
 assert.equal(isOperatorBanned(data,['sargonShip'],exempt,malist),false);
 assert.equal(isOperatorBanned(data,['sargonShip','skillfulShip'],exempt,malist),true);
 // 烛煌在维多利亚与炎两份名单上 → 两个盟约同时被禁也保留（被所有被禁盟约的名单豁免）。
 assert.equal(isOperatorBanned(data,['yanShip','victoriaShip'],exempt,blaze2),false,'两份被禁盟约都写着烛煌，必须保留');
 assert.equal(isOperatorBanned(data,['yanShip','kazimierzShip','skillfulShip'],exempt,blaze2),false,'没被禁的盟约不影响');
 // 灰毫两份名单都没写它 → 任一被禁即出局。
 assert.equal(isOperatorBanned(data,['kazimierzShip'],exempt,ashlok),true);
 assert.equal(isOperatorBanned(data,['steadShip'],exempt,ashlok),true);
});

test('调配池与商店候选都不含被禁盟约的干员',()=>{
 const keeper=firstMember(BAN_BOND).charId;
 const g=sessionWith([BAN_BOND],{[BAN_BOND]:[keeper]},{seed:5});
 const banned=new Set(g.bannedOperatorList().map(o=>o.charId));
 assert.ok(banned.size>0,'炎国被禁且名单只留 1 人，应当有干员出局');
 assert.equal(banned.has(keeper),false,'名单上的干员不能出局');
 for(const row of g.eligible())assert.equal(banned.has(row.charId),false,'调配池不能含被禁干员');
 g.s.level=6;for(const id of Object.keys(g.s.stock))g.s.stock[id]=99;
 for(let i=0;i<200;i++)for(const id of g.rollOffers())if(id)assert.equal(g.isOperatorBanned(id),false,'商店不能给出被禁干员：'+id);
 // 摘要与出局名单一致。
 const summary=g.bondBanSummary();
 assert.equal(summary.bonds.length,1);
 assert.equal(summary.bonds[0].exempt,1);
 assert.equal(summary.operators.length,banned.size);
});

test('策略／道具等非商店渠道同样受禁用限制：点名发放被挡下且不记账',()=>{
 const g=sessionWith([BAN_BOND],BAN_EXEMPT,{seed:6});
 const row=firstMember(BAN_BOND),blockedFor=row.bonds[0];
 const before=g.s.roundGainedChars?.count||0;
 assert.equal(g.gain(row.chessIds[0]),null,'点名发放被禁盟约的干员必须拿不到');
 assert.equal(g.s.bondBanBlocks,1);
 assert.deepEqual(g.s.bondBanLast.bonds,[blockedFor]);
 assert.equal(g.s.roundGainedChars?.count||0,before,'被挡下的发放不能算进「本回合获得过干员」');
 assert.equal(g.s.units.some(u=>u.charId===row.charId),false);
 // 未被禁盟约的干员照常发放。
 const freeBond=bondIds(data).find(id=>id!==BAN_BOND&&bondMembers(data,id).length>0&&!bondMembers(data,id).some(m=>m.bonds.includes(BAN_BOND)));
 assert.ok(freeBond,'需要一个与炎国完全不重叠的盟约做对照');
 assert.ok(g.gain(firstMember(freeBond).chessIds[0]),'未被禁盟约的干员必须照常获得');
 // 晋升奖励候选里也不能出现被禁干员。
 g.s.rewardPending=null;g.s.rewardQueue=[];
 assert.equal(g.rewardFromTier(3,3),true);
 for(const id of g.s.rewardPending.offers)assert.equal(g.isOperatorBanned(id),false,'晋升候选不能含被禁干员');
 // 援军转让：被禁干员的记录不发干员也不崩（照旧销账，避免每回合重试）。
 g.s.transferInbox=[{transferId:'t1',recipientId:'local',chessId:row.chessIds[0],dueRound:g.s.round,bondIds:row.bonds,equipment:[]}];
 g.applyTransferInbox();
 assert.equal(g.s.transferInbox.length,0);
 assert.equal(g.s.strategyClaims['fang:received:t1'],1);
 assert.equal(g.s.units.some(u=>u.charId===row.charId),false);
});

test('被禁盟约发不出人时不会抛错回滚整个动作（按盟约取人／卫戍发放）',()=>{
 // 不禁用名单为空＝该盟约成员全出局，此时「按盟约随机发人」没有候选。
 // 空候选池曾经会让 drawFromPool 抛错，而卫戍发放挂在 prep 上，抛错会把「进入下一回合」一起打回。
 const g=sessionWith([BAN_BOND],{[BAN_BOND]:[]},{seed:12});
 for(const row of bondMembers(data,BAN_BOND))assert.equal(g.bondBanned(row.chessIds[0]),true,'名单为空时该盟约成员应全部出局');
 // 偏好型请求（本次刷新优先取某盟约）忽略缺席盟约，正常给出合法干员而不是抛错。
 const drawn=g.drawFromPool({kind:'operator',bond:BAN_BOND,maxTier:g.s.level});
 assert.ok(drawn&&!g.bondBanned(drawn),'缺席盟约的偏好请求要退化成普通抽取');
 // 权益型请求：只有被禁盟约的干员问不出可发盟约，奖励直接不发。
 const owner={uid:++g.s.seq,chessId:firstMember(BAN_BOND).chessIds[0],charId:firstMember(BAN_BOND).charId,rank:1,position:null,dir:0,equipment:[],bondIds:[BAN_BOND]};
 g.s.units.push(owner);
 assert.deepEqual(g.gainableBonds(owner),[]);
 g.s.rewardPending=null;g.s.rewardQueue=[];
 assert.equal(g.rewardFromBond(owner,3),false,'发不出该盟约干员时不给奖励');
 // 卫戍「取层数最高的盟约发人」：只有被禁盟约时什么都不发，且不抛。
 const before=g.s.units.length;
 assert.doesNotThrow(()=>runGarrison(g,owner,{eventType:'SERVER_GAIN',effectType:'SERVER_MOST_BOND',blackboard:[]},'SERVER_GAIN'));
 assert.equal(g.s.units.length,before);
 // 把这些发放挂在 prep 上也不能卡住回合推进。
 g.s.phase='intermission';g.s.rewardPending=null;g.s.rewardQueue=[];g.s.candidates=null;
 assert.equal(g.perform('next'),true,'禁用的盟约发放不能把「进入下一回合」一起打回');
});

test('卫戍 SERVER_GAIN_CHAR 的点名发放也走同一条拦截',()=>{
 // garrison_52_a/b 照原表发固定的 chess_char_5_03_a（烛煌，维多利亚＋炎国）。
 const rule=data.season.garrisonDataDict.garrison_52_a,target='chess_char_5_03_a',charId=data.profiles[target].charId;
 assert.ok(data.profiles[target].bonds.includes(BAN_BOND));
 const g=sessionWith([BAN_BOND],BAN_EXEMPT,{seed:8});
 const unit={uid:++g.s.seq,chessId:firstMember(BAN_BOND).chessIds[0],charId:firstMember(BAN_BOND).charId,rank:1,position:null,dir:0,equipment:[]};
 g.s.units.push(unit);
 const before=g.s.units.length;
 runGarrison(g,unit,rule,'SERVER_GAIN');
 assert.equal(g.s.units.length,before,'卫戍点名发放不能把被禁干员发进来');
 assert.ok(g.s.bondBanBlocks>=1,'拦截要记账');
 assert.equal(g.s.units.some(u=>u.charId===charId),false);
 // 换个不被禁的盟约做对照：同一条卫戍发放应当照常生效。
 const free=sessionWith([],{}, {seed:8});
 const u2={uid:++free.s.seq,chessId:firstMember(BAN_BOND).chessIds[0],charId:firstMember(BAN_BOND).charId,rank:1,position:null,dir:0,equipment:[]};
 free.s.units.push(u2);
 runGarrison(free,u2,rule,'SERVER_GAIN');
 assert.equal(free.s.units.some(u=>u.charId===charId),true);
});

test('读档：禁用记录随存档保存，旧存档不额外禁用，脏候选会被清掉',()=>{
 const g=sessionWith([BAN_BOND],BAN_EXEMPT,{seed:9});
 assert.deepEqual(g.s.bondBan.bonds,[BAN_BOND]);
 const record=JSON.parse(JSON.stringify(g.snapshot()));
 const back=NativeSession.restore(data,{...record,savedAt:Date.now()});
 assert.ok(back,'带禁用记录的存档必须能读回');
 assert.deepEqual(back.s.bondBan.bonds,[BAN_BOND]);

 // 旧存档（没有 bondBan 字段）：按「本局不额外禁用」补齐，不动已有干员。
 const legacy=JSON.parse(JSON.stringify(g.snapshot()));
 delete legacy.s.bondBan;
 const restoredLegacy=NativeSession.restore(data,{...legacy,savedAt:Date.now()});
 assert.ok(restoredLegacy);
 assert.deepEqual(restoredLegacy.s.bondBan.bonds,[]);
 assert.equal(restoredLegacy.isOperatorBanned(firstMember(BAN_BOND).chessIds[0]),false);

 // 脏存档：商店槽与晋升候选里塞进被禁干员，读档后必须清干净。
 const bannedId=firstMember(BAN_BOND).chessIds[0];
 const stale=JSON.parse(JSON.stringify(g.snapshot()));
 stale.s.offers=[bannedId,null,null,null,null];
 stale.s.rewardPending={tier:3,offers:[bannedId],choice:1,kind:'operator'};
 stale.s.rewardQueue=[];
 const fixed=NativeSession.restore(data,{...stale,savedAt:Date.now()});
 assert.ok(fixed);
 assert.equal(fixed.s.offers.includes(bannedId),false,'残留的商店槽不能留被禁干员');
 assert.ok(!fixed.s.rewardPending||fixed.s.rewardPending.offers.every(id=>!fixed.isOperatorBanned(id)),'残留的奖励候选要么换掉要么丢掉');

 // 非法禁用记录：未知盟约／重复／超量都判定存档无效。
 for(const bad of [['nope'],[BAN_BOND,BAN_BOND],Array(30).fill(BAN_BOND)]){
  const broken=JSON.parse(JSON.stringify(g.snapshot()));
  broken.s.bondBan={bonds:bad,exempt:{}};
  assert.equal(NativeSession.restore(data,{...broken,savedAt:Date.now()}),null,'非法盟约列表必须判为无效存档：'+bad.length);
 }
});

test('内置不禁用名单：十九条逐条解析到真实干员，口径与用户给定的一致',()=>{
 // 门禁：名单里每一条「名＋阶」都必须解析成名册上的干员，不允许静默丢掉（写错名字／阶就会挂在这里）。
 const {exempt,unresolved}=resolveBondExempt(data);
 assert.deepEqual(unresolved,[],'内置名单有解析不出来的条目：'+JSON.stringify(unresolved));
 const drawable=[...banPool(data).core,...banPool(data).extra];
 assert.deepEqual(Object.keys(BOND_EXEMPT_TABLE).sort(),drawable.slice().sort(),'内置名单要覆盖全部可被禁的 19 个盟约');
 for(const id of Object.keys(BOND_EXEMPT_TABLE)){
  for(const charId of exempt[id])assert.ok(bondMembers(data,id).some(row=>row.charId===charId),`${bondName(data,id)} 名单上的 ${charId} 必须是该盟约成员`);
  assert.ok(exempt[id].length<=bondMembers(data,id).length);
 }
 // 抽查几条（用户 2026-09-22 原话：炎-烛煌V，叙拉古-无，谢拉格-哈洛德II 锏VI，拉特兰-空弦III 圣约送葬人V）。
 const nameOf=charId=>bondRoster(data).find(row=>row.charId===charId)?.name;
 assert.deepEqual(exempt.yanShip.map(nameOf),['烛煌']);
 assert.deepEqual(exempt.siracusaShip,[]);
 assert.deepEqual(exempt.kjeragShip.map(nameOf).sort(),['哈洛德','锏'].sort());
 assert.deepEqual(exempt.lateranoShip.map(nameOf).sort(),['圣约送葬人','空弦'].sort());
 assert.deepEqual(exempt.preciShip.map(nameOf).sort(),['送葬人','雪猎','远牙','缇缇','异客'].sort());
 assert.equal(defaultBondExempt(data).exempt.yanShip.join(','),exempt.yanShip.join(','),'默认名单就是这份内置数据');
 // 叙拉古被禁时 10 人全出局，炎被禁时只剩烛煌。
 assert.equal(bondBanSummary(data,['siracusaShip'],exempt).operators.length,bondMembers(data,'siracusaShip').length);
 assert.equal(bondBanSummary(data,['yanShip'],exempt).operators.length,bondMembers(data,'yanShip').length-1);
});

test('名单配置：只接受已知干员与已知盟约，可导出导入并落盘到 localStorage',()=>{
 const row=multiBondRow();
 const normalized=normalizeBondBan({exempt:{[row.bonds[0]]:[row.charId,'nope',''],notABond:['x']}},data);
 assert.deepEqual(normalized.exempt[row.bonds[0]],[row.charId]);
 assert.equal(normalized.exempt.notABond,undefined);
 assert.deepEqual(normalized.exempt[row.bonds[1]],[]);
 // 落盘：Node 里没有 localStorage 时静默跳过；有的话必须真的写进去并能读回。
 const previous=globalThis.localStorage;
 try{
  const store=new Map();
  globalThis.localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
  saveBondBan({exempt:{[row.bonds[0]]:[row.charId]}},data);
  assert.ok(store.has(BOND_BAN_KEY),'配置必须写到 localStorage 的 '+BOND_BAN_KEY);
  assert.equal(JSON.parse(store.get(BOND_BAN_KEY)).version,BOND_BAN_VERSION,'配置要带版本号，便于以后丢弃旧口径的名单');
  assert.deepEqual(loadBondBan(data).exempt[row.bonds[0]],[row.charId]);
  // 临时数据时期存下来的名单（没有 version）必须被忽略，回落到内置名单。
  store.set(BOND_BAN_KEY,JSON.stringify({exempt:{[row.bonds[0]]:[row.charId]}}));
  assert.deepEqual(loadBondBan(data).exempt[row.bonds[0]],defaultBondExempt(data).exempt[row.bonds[0]],'旧版本配置要回落到内置名单');
  store.set(BOND_BAN_KEY,'{ not json');
  assert.ok(loadBondBan(data).exempt[BAN_BOND],'坏数据要回落到内置名单而不是崩掉');
 }finally{
  if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;
 }
 // 没有 localStorage 时读配置走内置名单，不能抛。
 assert.ok(loadBondBan(data).exempt[BAN_BOND]);
});

test('编制台的盟约禁用页：逐条勾选、整盟约开关、导出/导入/恢复内置名单',()=>{
 const ui=editorState(),table=defaultWaveTable();
 assert.equal(ui.page,'enemies');
 assert.ok(renderWaveEditor(data,table,ui).includes('wave-ed-layout'),'默认仍是敌人编制页');
 assert.equal(applyEditorAction('ed-page',{page:'bonds'},table,ui,data),'render');
 assert.equal(ui.page,'bonds');
 const page=renderWaveEditor(data,table,ui);
 assert.ok(page.includes('盟约禁用名单'),'标题要切到盟约禁用');
 assert.equal(page.includes('wave-ed-layout'),false,'盟约页不画敌人编制布局');
 assert.equal(page.includes('wave-ed-bonds-grid'),true);
 const row=multiBondRow(),bond=row.bonds[0];
 // 打开页面时读进来的是内置名单；先清空再验证勾选行为。
 applyEditorAction('ed-bb-all',{bond,mode:'none'},table,ui,data);
 assert.equal(ui.bondBan.exempt[bond].length,0);
 assert.equal(applyEditorAction('ed-bb-toggle',{bond,char:row.charId},table,ui,data),'render');
 assert.ok(ui.bondBan.exempt[bond].includes(row.charId));
 applyEditorAction('ed-bb-toggle',{bond,char:row.charId},table,ui,data);
 assert.equal(ui.bondBan.exempt[bond].includes(row.charId),false,'再点一次要取消');
 applyEditorAction('ed-bb-all',{bond,mode:'all'},table,ui,data);
 assert.equal(ui.bondBan.exempt[bond].length,bondMembers(data,bond).length);
 applyEditorAction('ed-bb-all',{bond,mode:'none'},table,ui,data);
 assert.equal(ui.bondBan.exempt[bond].length,0);
 assert.equal(applyEditorAction('ed-bb-export',{},table,ui,data),'bond-export');
 assert.equal(applyEditorAction('ed-bb-import',{},table,ui,data),'bond-import');
 assert.equal(applyEditorAction('ed-bb-defaults',{},table,ui,data),'bond-defaults');
 assert.deepEqual(ui.bondBan.exempt[bond],defaultBondExempt(data).exempt[bond]);
 assert.equal(applyEditorAction('ed-bb-clear',{},table,ui,data),'bond-clear');
 assert.deepEqual(ui.bondBan.exempt[bond],[]);
 // 切回敌人编制页仍然是完整布局。
 applyEditorAction('ed-page',{page:'enemies'},table,ui,data);
 assert.ok(renderWaveEditor(data,table,ui).includes('wave-ed-layout'));
});

test('简报渲染：全部核心盟约都列出（被禁的灰掉划掉），附加盟约只列被禁的，干员进单独弹窗',()=>{
 const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
 const avatar=charId=>`<img alt="" src="./${data.assets[charId]||''}">`;
 const ban={bonds:bondBanIds(data,1),exempt:defaultBondExempt(data).exempt};
 const {core,extra}=banPool(data),banned=new Set(ban.bonds);
 const brief=bondBanBriefingHtml(data,ban,{esc});
 // 把卡片解析成结构化列表再断言（别整段字符串 includes，说明文字里也会出现盟约名）。
 const cards=[...brief.matchAll(/class="native-ban-bond ([a-z ]+)"><b>([^<]+)<\/b><small>([^<]+)<\/small><span>([^<]+)<\/span>/g)]
  .map(m=>({classes:m[1].split(' '),name:m[2],kind:m[3],status:m[4]}));
 const coreCards=cards.filter(c=>c.classes.includes('core')),extraCards=cards.filter(c=>c.classes.includes('extra'));

 // 核心盟约：8 个全部出现，被禁的 3 个带 banned、其余带 available。
 assert.equal(coreCards.length,core.length,'全部核心盟约都要列出来');
 assert.deepEqual(coreCards.map(c=>c.name).sort(),core.map(id=>bondName(data,id)).sort());
 assert.equal(coreCards.filter(c=>c.classes.includes('banned')).length,BAN_CORE_COUNT,'核心盟约里被禁的正好 3 个');
 assert.equal(coreCards.filter(c=>c.classes.includes('available')).length,core.length-BAN_CORE_COUNT);
 for(const c of coreCards)assert.equal(c.kind,'核心');
 // 附加盟约：只列被禁的那 4 个，而且都是灰掉划掉的。
 const bannedExtra=extra.filter(id=>banned.has(id));
 assert.equal(bannedExtra.length,BAN_EXTRA_COUNT);
 assert.equal(extraCards.length,bannedExtra.length,'附加盟约只列被禁的');
 assert.deepEqual(extraCards.map(c=>c.name).sort(),bannedExtra.map(id=>bondName(data,id)).sort());
 assert.ok(extraCards.every(c=>c.classes.includes('banned')),'列出来的附加盟约都必须是灰掉划掉的');
 for(const c of extraCards)assert.equal(c.kind,'附加');
 // 不在抽取池里的四个固定豁免盟约不许出现在缺席名单里（说明文字里提到它们不算）。
 const cardNames=new Set(cards.map(c=>c.name));
 for(const id of BOND_BAN_EXCLUDED)assert.equal(cardNames.has(bondName(data,id)),false,`${bondName(data,id)} 固定不被禁，不该出现在缺席名单里`);

 // 被禁干员进单独弹窗：一人一个头像块，带名字、阶与被哪个缺席盟约挡下。
 const summary=bondBanSummary(data,ban.bonds,ban.exempt);
 const popup=bannedOperatorsHtml(data,ban,{esc,avatar});
 // 对局里没有简报页，所以弹窗自己也要列缺席盟约（核心几个／附加几个，各自是谁）。
 assert.match(popup,new RegExp(`缺席盟约：核心 ${core.filter(id=>banned.has(id)).length} 个`));
 assert.match(popup,new RegExp(`附加 ${extra.filter(id=>banned.has(id)).length} 个`));
 for(const id of ban.bonds)assert.ok(popup.includes(bondName(data,id)),`弹窗要列出缺席盟约 ${bondName(data,id)}`);
 assert.equal((popup.match(/<figure/g)||[]).length,summary.operators.length,'每个被禁干员一个头像块');
 assert.equal((popup.match(/native-ban-op-art/g)||[]).length,summary.operators.length);
 assert.equal((popup.match(/<img alt=""/g)||[]).length,summary.operators.length,'要用干员头像列举');
 assert.equal(new Set(popup.match(new RegExp(data.assets[summary.operators[0].charId]||'@@','g'))||[]).size,1);
 assert.match(brief,new RegExp(`data-act="ban-list">查看本局被禁用的 ${summary.operators.length} 名干员`),'简报上要有打开弹窗的入口');
 for(const o of summary.operators.slice(0,5)){
  assert.ok(popup.includes(esc(o.name)),`弹窗要列出 ${o.name}`);
  const blockers=bondBanBlockers(data,ban.bonds,ban.exempt,o.charId).map(id=>bondName(data,id));
  assert.ok(blockers.length>=1);
  for(const name of blockers)assert.ok(popup.includes(name),`${o.name} 要标出被禁盟约 ${name}`);
 }
 // 排序：先按阶再按名字，第一条就是最低阶的那位。
 const tiers=summary.operators.slice().sort((a,b)=>a.tier-b.tier||String(a.name).localeCompare(String(b.name),'zh')).map(o=>o.tier);
 assert.deepEqual(tiers,tiers.slice().sort((a,b)=>a-b));
 // 没有被禁盟约时不渲染简报，弹窗给出空状态。
 assert.equal(bondBanBriefingHtml(data,{bonds:[],exempt:{}},{esc}),'');
 assert.match(bannedOperatorsHtml(data,{bonds:[],exempt:{}},{esc,avatar}),/本局没有被禁用的干员/);
});

test('弹窗与简报必须取同一份禁用记录：draft 优先，不能被上一局／旧存档留下的空记录顶掉',()=>{
 // 用户 2026-09-22 报障：简报按钮写「50 名」，点开弹窗却是「共 0 名」。
 // 成因是弹窗优先读了 state.game.s.bondBan——从大厅开新局时它还留着上一局（甚至旧版本存档
 // 恢复出来的、没有禁用字段因而被补成 bonds:[] 的会话），于是被禁干员算成 0。
 const live={bonds:bondBanIds(data,1),exempt:defaultBondExempt(data).exempt};
 const stale={bonds:[],exempt:defaultBondExempt(data).exempt};
 assert.equal(activeBondBan(live,stale),live,'本局(draft)的记录优先');
 assert.equal(activeBondBan(stale,live),live,'本局为空时才回落到会话记录');
 assert.equal(activeBondBan(undefined,stale),stale,'两者都空就取会话那份（渲染出空状态）');
 assert.equal(activeBondBan(undefined,undefined),null);
 assert.deepEqual(activeBondBan({exempt:{}},undefined),{exempt:{}},'没有 bonds 字段的记录不算「有禁用」，原样返回给渲染层显示空状态即可');
 // 两条路径最终算出的人数必须一致（这就是报障里对不上的那个数）。
 const esc=s=>String(s??''),avatar=()=>'<img alt="">';
 const expected=bondBanSummary(data,live.bonds,live.exempt).operators.length;
 assert.ok(expected>0);
 assert.match(bondBanBriefingHtml(data,live,{esc}),new RegExp(`查看本局被禁用的 ${expected} 名干员`));
 const popup=bannedOperatorsHtml(data,activeBondBan(live,stale),{esc,avatar});
 assert.match(popup,new RegExp(`共 ${expected} 名`));
 assert.equal((popup.match(/<figure/g)||[]).length,expected);
 // 反面：用旧记录渲染就会得到「0 名」——这正是原来的写法。
 assert.match(bannedOperatorsHtml(data,stale,{esc,avatar}),/共 0 名/);
});

test('简报摘要：列出被禁盟约的规模与拿不到的干员',()=>{
 const summary=bondBanSummary(data,[BAN_BOND],BAN_EXEMPT);
 assert.equal(summary.bonds.length,1);
 assert.equal(summary.bonds[0].id,BAN_BOND);
 assert.equal(summary.bonds[0].core,true);
 assert.equal(summary.bonds[0].name,bondName(data,BAN_BOND));
 assert.equal(summary.bonds[0].total,bondMembers(data,BAN_BOND).length);
 assert.equal(summary.bonds[0].exempt,0);
 assert.equal(summary.bonds[0].banned.length,summary.bonds[0].total);
 assert.equal(summary.operators.length,summary.bonds[0].banned.length);
});
