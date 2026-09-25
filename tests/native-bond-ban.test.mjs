import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_DATA as data} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {runGarrison} from '../dist/garrison.js';
import {
 BAN_CORE_COUNT,BAN_EXTRA_COUNT,BOND_BAN_DEFAULT_NEVER,BOND_BAN_EXCLUDED,BOND_BAN_KEY,BOND_BAN_VERSION,
 banModeOf,banPool,banRules,bondBanBlockers,bondBanIds,bondBanSummary,bondIds,bondIsBanExcluded,bondIsCore,
 bondBanBriefingHtml,bannedOperatorsHtml,activeBondBan,
 bondMembers,bondName,bondRoster,charIdOf,defaultBanRules,isOperatorBanned,loadBondBan,normalizeBondBan,
 saveBondBan,
} from '../dist/native-bond-ban.js';
import {editorState,renderWaveEditor,applyEditorAction} from '../dist/native-wave-editor.js';
import {defaultWaveTable} from '../dist/native-wave-fill.js';

// 盟约禁用（用户 2026-09-22 二次修订口径，配置 v3）：
//  * 每局从 23 个盟约里随机禁 3 个核心 + 4 个附加，不看模式表的 inactiveBondIdList／trBannedBondIds。
//  * **干员只有在「所属盟约全部被禁」时才被禁用**；只要还挂着一个没被禁的盟约就仍可用
//    （v2 的逐盟约「不禁用名单」已废弃，配置只留 always／never）。
//  * 商店之外的渠道（策略／道具／卫戍点名发放／援军转让）同样拿不到。
//  * 预览按被禁盟约分组列被禁干员，同一名干员挂在多个被禁盟约下时每组各列一次。
const BAN_BOND='yanShip';
const sessionWith=(bonds,options={})=>new NativeSession(data,{seed:7,bondBan:{bonds},...options});
// 只挂一个盟约的干员：v3 下「禁掉那个盟约」才会禁到他们。
const soloMembers=bond=>bondMembers(data,bond).filter(row=>row.bonds.length===1);
const rowOf=charId=>bondRoster(data).find(row=>row.charId===charId);
const multiBondRow=n=>bondRoster(data).find(row=>row.bonds.length===n);

test('每局随机禁 3 个核心 + 4 个附加盟约，默认方案里投资人也不入池，同一 seed 结果固定',()=>{
 const {core,extra}=banPool(data);
 assert.equal(BAN_CORE_COUNT,3);assert.equal(BAN_EXTRA_COUNT,4);
 assert.equal(bondIds(data).length,23);
 assert.equal(core.length,8,'8 个核心盟约全部可被禁');
 assert.equal(extra.length,10,'15 个附加盟约里除去 5 个默认不被随机禁的，剩 10 个可被禁');
 assert.deepEqual(core.filter(bondIsBanExcluded),[]);
 assert.deepEqual(extra.filter(bondIsBanExcluded),[]);
 for(const id of BOND_BAN_EXCLUDED)assert.equal(bondIsBanExcluded(id),true);
 assert.deepEqual([...BOND_BAN_EXCLUDED].sort(),['emptyShip','maniShip','soloShip','suntShip'],'固定不被禁的是协防干员／绝技／调和／独行');
 assert.deepEqual([...BOND_BAN_DEFAULT_NEVER],['emptyShip','suntShip','maniShip','soloShip','investShip'],'默认不被随机禁用的名单＝四个固定豁免 ＋ 投资人');
 assert.equal(bondName(data,'investShip'),'投资人');
 assert.equal(banModeOf(banRules(null,data),'investShip'),'never','默认方案里投资人是「固定不被禁」');
 assert.equal(extra.includes('investShip'),false,'投资人不进随机池');
 for(const seed of [1,2,3,7,42,999]){
  const ids=bondBanIds(data,seed);
  assert.equal(ids.length,7);
  assert.equal(new Set(ids).size,7,'同一局不能重复禁同一个盟约');
  assert.equal(ids.filter(id=>bondIsCore(data,id)).length,3,'核心盟约固定 3 个');
  assert.equal(ids.filter(id=>!bondIsCore(data,id)).length,4,'附加盟约固定 4 个');
  assert.deepEqual(ids.filter(bondIsBanExcluded),[],'固定豁免的盟约不许被抽中');
  assert.equal(ids.includes('investShip'),false,'投资人默认不会被随机禁到');
  assert.deepEqual(bondBanIds(data,seed),ids,'同一 seed 必须抽到同一批');
 }
 const declared=new Set(Object.values(data.season.modeDataDict).flatMap(m=>m.inactiveBondIdList||[]));
 assert.ok(declared.size>0,'模式表本身应当声明禁用盟约，用于确认我们没在读它');
 const drawn=new Set(Array.from({length:400},(_,i)=>bondBanIds(data,i)).flat());
 const declaredDrawable=[...declared].filter(id=>!bondIsBanExcluded(id)&&id!=='investShip');
 assert.ok(declaredDrawable.length>0,'模式表里应当有可被禁的盟约');
 assert.ok(declaredDrawable.every(id=>drawn.has(id)),'模式表声明过的盟约同样会被抽中（说明没按模式表过滤）');
 assert.deepEqual([...drawn].sort(),[...core,...extra].sort(),'可禁的 18 个盟约都会出现在抽取范围里');
 for(const id of BOND_BAN_DEFAULT_NEVER)assert.equal(drawn.has(id),false,'默认不被随机禁的盟约永远不进抽取范围');
});

test('禁用方案：固定禁用每局必缺席且不占随机名额，固定不被禁的永不入池',()=>{
 const config={always:['yanShip','investShip'],never:['emptyShip','kjeragShip']};
 const rules=banRules(config,data);
 assert.deepEqual(rules.fixed,['yanShip','investShip']);
 assert.deepEqual(rules.never,['emptyShip','kjeragShip']);
 assert.equal(banModeOf(rules,'yanShip'),'fixed');
 assert.equal(banModeOf(rules,'kjeragShip'),'never');
 assert.equal(banModeOf(rules,'siracusaShip'),'random');
 const {core,extra}=banPool(data,config);
 assert.equal(core.includes('yanShip'),false,'固定禁用不占随机名额');
 assert.equal(extra.includes('investShip'),false);
 assert.equal(extra.includes('kjeragShip'),false,'固定不被禁的也不入池');
 for(const seed of [1,5,9]){
  const ids=bondBanIds(data,seed,config);
  assert.ok(ids.includes('yanShip')&&ids.includes('investShip'),'固定禁用的每局都在');
  assert.equal(ids.includes('kjeragShip'),false,'固定不被禁的每局都不在');
  assert.equal(ids.filter(id=>bondIsCore(data,id)).length,BAN_CORE_COUNT+1,'3 个随机核心 ＋ 1 个固定禁用核心');
 }
});

test('禁用方案配置：只认已知盟约、去重，显式清空才是全部参与随机',()=>{
 assert.deepEqual(defaultBanRules(),{always:[],never:[...BOND_BAN_DEFAULT_NEVER]});
 assert.deepEqual(normalizeBondBan(null,data),{always:[],never:[...BOND_BAN_DEFAULT_NEVER]},'没有配置＝默认方案');
 const half=normalizeBondBan({always:['yanShip']},data);
 assert.deepEqual(half.always,['yanShip']);
 assert.deepEqual(half.never,[...BOND_BAN_DEFAULT_NEVER]);
 assert.equal('exempt' in half,false,'v3 的配置里不再有不禁用名单');
 const conflict=normalizeBondBan({always:['yanShip'],never:['yanShip','investShip']},data);
 assert.deepEqual(conflict.always,['yanShip']);
 assert.equal(conflict.never.includes('yanShip'),false,'同时写进两个数组时以固定禁用为准');
 assert.equal(banPool(data,conflict).core.includes('yanShip'),false);
 const allRandom=normalizeBondBan({always:[],never:[]},data);
 assert.deepEqual(allRandom.never,[]);
 assert.equal(banPool(data,allRandom).core.length+banPool(data,allRandom).extra.length,23,'全部参与随机时 23 个盟约都在池里');
 const redrawn=new Set(Array.from({length:400},(_,i)=>bondBanIds(data,i,allRandom)).flat());
 assert.equal(redrawn.has('investShip'),true,'清掉「不被禁」之后投资人能重新被抽中');
 const dirty=normalizeBondBan({always:['yanShip','nope','yanShip'],never:['investShip','nope']},data);
 assert.deepEqual(dirty.always,['yanShip']);assert.deepEqual(dirty.never,['investShip']);
});

test('禁用判定（v3 核心口径）：所属盟约全部被禁才禁用，剩一个未缺席就仍可用',()=>{
 const single=soloMembers(BAN_BOND)[0];
 assert.ok(single,'炎国要有只挂本盟约的干员做样本');
 assert.equal(isOperatorBanned(data,['yanShip'],single.charId),true,'只挂炎国，炎被禁就出局');
 assert.equal(isOperatorBanned(data,[],single.charId),false,'没禁盟约谁都不出局');
 assert.equal(isOperatorBanned(data,['siracusaShip'],single.charId),false,'别的盟约被禁不影响它');
 assert.deepEqual(bondBanBlockers(data,['yanShip'],single.charId),['yanShip']);
 assert.deepEqual(bondBanBlockers(data,['siracusaShip'],single.charId),[],'没被禁时不给「挡下它的盟约」');

 const pair=multiBondRow(2),[bondA,bondB]=pair.bonds;
 assert.equal(isOperatorBanned(data,[bondA],pair.charId),false,`${pair.name} 还挂着 ${bondB}，只禁一个不该出局`);
 assert.equal(isOperatorBanned(data,[bondA,bondB],pair.charId),true,'两个盟约都被禁才出局');
 assert.deepEqual(bondBanBlockers(data,[bondA,bondB],pair.charId).slice().sort(),[bondA,bondB].slice().sort(),'被禁时挡下它的是它全部盟约');
 const trio=multiBondRow(3);
 assert.equal(isOperatorBanned(data,trio.bonds.slice(0,2),trio.charId),false,`${trio.name} 三个盟约里禁两个仍可用`);
 assert.equal(isOperatorBanned(data,trio.bonds,trio.charId),true);

 assert.equal(isOperatorBanned(data,BOND_BAN_DEFAULT_NEVER,single.charId),false,'固定不被禁的盟约不算缺席，炎国干员不该出局');
 assert.equal(isOperatorBanned(data,['yanShip'],'chess_virtual_prepared_medic'),false);
 assert.equal(isOperatorBanned(data,bondIds(data),'chess_virtual_prepared_medic'),false,'把 23 个盟约全禁也一样');
 const all=bondIds(data);
 assert.equal(bondRoster(data).every(row=>isOperatorBanned(data,all,row.charId)),true,'全部盟约被禁时名册里每个人都出局');
});

test('干员身份按 charId 归并：精锐形态与初始形态同判',()=>{
 const shop=Object.values(data.season.charShopChessDatas).find(s=>s.charId&&s.goldenChessId);
 const golden=shop.goldenChessId,row=rowOf(shop.charId);
 assert.notEqual(golden,shop.chessId);
 assert.equal(charIdOf(data,golden),shop.charId);
 assert.equal(charIdOf(data,shop.chessId),shop.charId);
 assert.equal(isOperatorBanned(data,row.bonds,golden),isOperatorBanned(data,row.bonds,shop.chessId));
 const g=sessionWith(row.bonds);
 assert.equal(g.bondBanned(golden),true,'精锐形态也要按同一名干员判禁');
 assert.equal(g.bondBanned(shop.chessId),true);
 assert.equal(bondMembers(data,row.bonds[0]).filter(r=>r.charId===shop.charId).length,1,'名册里同一名干员只登记一次');
});

test('调配池与商店候选都不含被禁干员，摘要与出局名单一致',()=>{
 const g=sessionWith([BAN_BOND]);
 const banned=new Set(g.bannedOperatorList().map(o=>o.charId));
 assert.deepEqual([...banned].sort(),soloMembers(BAN_BOND).map(r=>r.charId).sort(),'只禁炎国时，出局的正好是「只挂炎国」的那几位');
 for(const row of g.eligible())assert.equal(banned.has(row.charId),false,'调配池不能含被禁干员');
 g.s.level=6;for(const id of Object.keys(g.s.stock))g.s.stock[id]=99;
 for(let i=0;i<200;i++)for(const id of g.rollOffers())if(id)assert.equal(g.isOperatorBanned(id),false,'商店不能给出被禁干员：'+id);
 const summary=g.bondBanSummary();
 assert.equal(summary.bonds.length,1);
 assert.equal(summary.bonds[0].id,BAN_BOND);
 assert.equal(summary.bonds[0].total,bondMembers(data,BAN_BOND).length);
 assert.deepEqual(summary.bonds[0].members.map(m=>m.charId).sort(),[...banned].sort(),'分组数据＝该盟约下被禁的人');
 assert.deepEqual(summary.operators.map(o=>o.charId).sort(),[...banned].sort());
});

test('策略／道具等非商店渠道同样受禁用限制：点名发放被挡下且不记账',()=>{
 const g=sessionWith([BAN_BOND],{seed:6});
 const row=soloMembers(BAN_BOND)[0];
 const before=g.s.roundGainedChars?.count||0;
 assert.equal(g.gain(row.chessIds[0]),null,'点名发放被禁盟约的干员必须拿不到');
 assert.equal(g.s.bondBanBlocks,1);
 assert.deepEqual(g.s.bondBanLast.bonds,row.bonds,'拦截提示要写清是哪几个缺席盟约挡下的');
 assert.equal(g.s.roundGainedChars?.count||0,before,'被挡下的发放不能算进「本回合获得过干员」');
 assert.equal(g.s.units.some(u=>u.charId===row.charId),false);
 const freeRow=bondRoster(data).find(r=>!r.bonds.includes(BAN_BOND));
 assert.ok(freeRow&&freeRow.bonds.length);
 assert.ok(g.gain(freeRow.chessIds[0]),'未被禁的干员必须照常获得');
 g.s.rewardPending=null;g.s.rewardQueue=[];
 assert.equal(g.rewardFromTier(3,3),true);
 for(const id of g.s.rewardPending.offers)assert.equal(g.isOperatorBanned(id),false,'晋升候选不能含被禁干员');
 g.s.transferInbox=[{transferId:'t1',recipientId:'local',chessId:row.chessIds[0],dueRound:g.s.round,bondIds:row.bonds,equipment:[]}];
 g.applyTransferInbox();
 assert.equal(g.s.transferInbox.length,0);
 assert.equal(g.s.strategyClaims['fang:received:t1'],1);
 assert.equal(g.s.units.some(u=>u.charId===row.charId),false);
});

test('某盟约全员出局时不会抛错回滚整个动作（按盟约取人／卫戍发放）',()=>{
 // 调和只有 1 名成员、且只挂调和：禁掉调和＝这个盟约一个人都发不出来。
 const g=sessionWith(['maniShip'],{seed:12});
 const row=bondMembers(data,'maniShip')[0];
 assert.equal(g.bondBanned(row.chessIds[0]),true,'调和只有单盟约成员，禁掉即全员出局');
 const drawn=g.drawFromPool({kind:'operator',bond:'maniShip',maxTier:g.s.level});
 assert.ok(drawn&&!g.bondBanned(drawn),'缺席盟约的偏好请求要退化成普通抽取');
 const owner={uid:++g.s.seq,chessId:row.chessIds[0],charId:row.charId,rank:1,position:null,dir:0,equipment:[],bondIds:['maniShip']};
 g.s.units.push(owner);
 assert.deepEqual(g.gainableBonds(owner),[]);
 g.s.rewardPending=null;g.s.rewardQueue=[];
 assert.equal(g.rewardFromBond(owner,3),false,'发不出该盟约干员时不给奖励');
 const before=g.s.units.length;
 assert.doesNotThrow(()=>runGarrison(g,owner,{eventType:'SERVER_GAIN',effectType:'SERVER_MOST_BOND',blackboard:[]},'SERVER_GAIN'));
 assert.equal(g.s.units.length,before);
 g.s.phase='intermission';g.s.rewardPending=null;g.s.rewardQueue=[];g.s.candidates=null;
 assert.equal(g.perform('next'),true,'禁用的盟约发放不能把「进入下一回合」一起打回');
});

test('卫戍 SERVER_GAIN_CHAR 的点名发放也走同一条拦截',()=>{
 // garrison_52_a/b 照原表发固定的 chess_char_5_03_a（烛煌，维多利亚＋炎国）。
 const rule=data.season.garrisonDataDict.garrison_52_a,target='chess_char_5_03_a',charId=data.profiles[target].charId;
 const row=rowOf(charId);
 assert.deepEqual(row.bonds.slice().sort(),['victoriaShip','yanShip'].slice().sort(),'样本要是双盟约干员');
 const carrier=()=>{const s=soloMembers(BAN_BOND)[0];return {uid:0,chessId:s.chessIds[0],charId:s.charId,rank:1,position:null,dir:0,equipment:[]};};
 const g=sessionWith(row.bonds,{seed:8});
 const unit={...carrier(),uid:++g.s.seq};g.s.units.push(unit);
 const before=g.s.units.length;
 runGarrison(g,unit,rule,'SERVER_GAIN');
 assert.equal(g.s.units.length,before,'卫戍点名发放不能把被禁干员发进来');
 assert.ok(g.s.bondBanBlocks>=1,'拦截要记账');
 assert.equal(g.s.units.some(u=>u.charId===charId),false);
 // 只禁其中一个盟约时，同一条卫戍发放照常生效（v3：它还挂着未缺席的盟约）。
 const partial=sessionWith([BAN_BOND],{seed:8});
 const u1={...carrier(),uid:++partial.s.seq};partial.s.units.push(u1);
 runGarrison(partial,u1,rule,'SERVER_GAIN');
 assert.equal(partial.s.units.some(u=>u.charId===charId),true,'烛煌另一个盟约没被禁，照发');
 // 一个盟约都不禁时当然也照发。
 const free=sessionWith([],{seed:8});
 const u2={...carrier(),uid:++free.s.seq};free.s.units.push(u2);
 runGarrison(free,u2,rule,'SERVER_GAIN');
 assert.equal(free.s.units.some(u=>u.charId===charId),true);
});

test('读档：禁用记录随存档保存，旧存档不额外禁用，脏候选会被清掉',()=>{
 const g=sessionWith([BAN_BOND],{seed:9});
 assert.deepEqual(g.s.bondBan.bonds,[BAN_BOND]);
 assert.equal('exempt' in g.s.bondBan,false,'v3 的会话记录里没有不禁用名单');
 const record=JSON.parse(JSON.stringify(g.snapshot()));
 const back=NativeSession.restore(data,{...record,savedAt:Date.now()});
 assert.ok(back,'带禁用记录的存档必须能读回');
 assert.deepEqual(back.s.bondBan.bonds,[BAN_BOND]);

 const legacy=JSON.parse(JSON.stringify(g.snapshot()));
 delete legacy.s.bondBan;
 const restoredLegacy=NativeSession.restore(data,{...legacy,savedAt:Date.now()});
 assert.ok(restoredLegacy);
 assert.deepEqual(restoredLegacy.s.bondBan.bonds,[]);
 assert.equal(restoredLegacy.isOperatorBanned(soloMembers(BAN_BOND)[0].chessIds[0]),false);

 // 旧 v2 存档里的 exempt 字段直接被忽略，判定按新口径重算。
 const v2=JSON.parse(JSON.stringify(g.snapshot()));
 v2.s.bondBan={bonds:[BAN_BOND],exempt:{[BAN_BOND]:[]},always:[],never:[]};
 const restoredV2=NativeSession.restore(data,{...v2,savedAt:Date.now()});
 assert.ok(restoredV2,'带旧 exempt 字段的存档仍要能读');
 assert.equal('exempt' in restoredV2.s.bondBan,false,'读档后不再保留 exempt');
 assert.equal(restoredV2.isOperatorBanned(soloMembers(BAN_BOND)[0].chessIds[0]),true,'判定按新口径重算');

 const bannedId=soloMembers(BAN_BOND)[0].chessIds[0];
 const stale=JSON.parse(JSON.stringify(g.snapshot()));
 stale.s.offers=[bannedId,null,null,null,null];
 stale.s.rewardPending={tier:3,offers:[bannedId],choice:1,kind:'operator'};
 stale.s.rewardQueue=[];
 const fixed=NativeSession.restore(data,{...stale,savedAt:Date.now()});
 assert.ok(fixed);
 assert.equal(fixed.s.offers.includes(bannedId),false,'残留的商店槽不能留被禁干员');
 assert.ok(!fixed.s.rewardPending||fixed.s.rewardPending.offers.every(id=>!fixed.isOperatorBanned(id)),'残留的奖励候选要么换掉要么丢掉');

 for(const bad of [['nope'],[BAN_BOND,BAN_BOND],Array(30).fill(BAN_BOND)]){
  const broken=JSON.parse(JSON.stringify(g.snapshot()));
  broken.s.bondBan={bonds:bad};
  assert.equal(NativeSession.restore(data,{...broken,savedAt:Date.now()}),null,'非法盟约列表必须判为无效存档：'+bad.length);
 }
});

test('禁用方案落盘：只认当前版本，v2／无版本／坏数据一律回落默认方案',()=>{
 const previous=globalThis.localStorage;
 try{
  const store=new Map();
  globalThis.localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
  saveBondBan({always:['yanShip'],never:['investShip']},data);
  assert.ok(store.has(BOND_BAN_KEY),'配置必须写到 localStorage 的 '+BOND_BAN_KEY);
  const saved=JSON.parse(store.get(BOND_BAN_KEY));
  assert.equal(saved.version,BOND_BAN_VERSION,'配置要带版本号，便于以后丢弃旧口径');
  assert.equal(BOND_BAN_VERSION,3,'v3＝去掉不禁用名单那一版');
  assert.equal('exempt' in saved,false,'落盘的配置里不该再有 exempt');
  assert.deepEqual(loadBondBan(data).always,['yanShip']);
  assert.deepEqual(loadBondBan(data).never,['investShip']);
  store.set(BOND_BAN_KEY,JSON.stringify({version:2,always:['yanShip'],never:[],exempt:{yanShip:[]}}));
  assert.deepEqual(loadBondBan(data),defaultBanRules(),'v2 配置要按版本丢弃');
  store.set(BOND_BAN_KEY,JSON.stringify({exempt:{yanShip:[]}}));
  assert.deepEqual(loadBondBan(data),defaultBanRules(),'无版本配置要按版本丢弃');
  store.set(BOND_BAN_KEY,'{ not json');
  assert.deepEqual(loadBondBan(data),defaultBanRules(),'坏数据要回落默认方案而不是崩掉');
 }finally{
  if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;
 }
 assert.deepEqual(loadBondBan(data),defaultBanRules(),'没有 localStorage 时读配置走默认方案，不能抛');
});

test('协议自定义只有两页：敌人波次 ＋ 禁用方案（「盟约禁用名单」页整页移除）',()=>{
 const ui=editorState(),table=defaultWaveTable();
 assert.equal(ui.page,'enemies');
 assert.ok(renderWaveEditor(data,table,ui).includes('wave-ed-layout'),'默认仍是敌人波次页');
 assert.ok(!('bondQuery' in ui),'名单页的搜索词状态一并删掉');
 assert.equal(applyEditorAction('ed-page',{page:'bonds'},table,ui,data),'render');
 assert.equal(ui.page,'enemies','旧的 bonds 页入口落到敌人波次页，不再有名单页');
 assert.equal(applyEditorAction('ed-page',{page:'rules'},table,ui,data),'render');
 assert.equal(ui.page,'rules');
 const page=renderWaveEditor(data,table,ui);
 assert.ok(page.includes('<h1>盟约禁用方案</h1>'));
 assert.equal(page.includes('wave-ed-layout'),false,'方案页不画敌人波次布局');
 const html=renderWaveEditor(data,table,editorState());
 assert.equal(html.includes('不禁用名单'),false,'页面上不再出现「不禁用名单」');
 assert.equal(/data-act="ed-bb-(toggle|all|defaults|clear)"/.test(html),false,'勾选／整盟约开关的动作要删掉');
 applyEditorAction('ed-page',{page:'enemies'},table,ui,data);
 assert.ok(renderWaveEditor(data,table,ui).includes('wave-ed-layout'));
});

test('协议自定义的「禁用方案」页：逐盟约三选一（固定禁用／参与随机／不被禁）',()=>{
 const ui=editorState(),table=defaultWaveTable();
 assert.equal(renderWaveEditor(data,table,editorState()).includes('<h1>协议自定义</h1>'),true,'默认页标题是协议自定义');
 assert.equal(applyEditorAction('ed-page',{page:'rules'},table,ui,data),'render');
 const page=renderWaveEditor(data,table,ui);
 assert.equal((page.match(/data-act="ed-br-mode"/g)||[]).length,bondIds(data).length*3,'每个盟约三个状态按钮');
 for(const label of ['固定禁用','参与随机','不被禁'])assert.ok(page.includes(`>${label}</button>`),label+' 按钮要在');
 assert.match(page,/data-bond="investShip" data-mode="never" aria-pressed="true"/,'默认方案里投资人是「不被禁」');
 assert.match(page,/data-bond="yanShip" data-mode="random" aria-pressed="true"/,'核心盟约默认参与随机');
 assert.equal(applyEditorAction('ed-br-mode',{bond:'yanShip',mode:'fixed'},table,ui,data),'render');
 assert.deepEqual(ui.bondBan.always,['yanShip']);
 assert.deepEqual(ui.bondBan.never,[...BOND_BAN_DEFAULT_NEVER]);
 assert.match(renderWaveEditor(data,table,ui),/data-bond="yanShip" data-mode="fixed" aria-pressed="true"/);
 assert.ok(bondBanIds(data,3,ui.bondBan).includes('yanShip'),'固定禁用必须出现在每一局的名单里');
 assert.equal(banPool(data,ui.bondBan).core.includes('yanShip'),false,'固定禁用的不占随机名额');
 applyEditorAction('ed-br-mode',{bond:'yanShip',mode:'never'},table,ui,data);
 assert.deepEqual(ui.bondBan.always,[]);
 assert.deepEqual(ui.bondBan.never,[...BOND_BAN_DEFAULT_NEVER,'yanShip'],'新加的不被禁排在后面');
 assert.equal(bondBanIds(data,3,ui.bondBan).includes('yanShip'),false);
 applyEditorAction('ed-br-mode',{bond:'yanShip',mode:'random'},table,ui,data);
 assert.deepEqual(ui.bondBan.always,[]);assert.deepEqual(ui.bondBan.never,[...BOND_BAN_DEFAULT_NEVER]);
 assert.equal(banPool(data,ui.bondBan).core.includes('yanShip'),true);
 applyEditorAction('ed-br-mode',{bond:'investShip',mode:'random'},table,ui,data);
 assert.deepEqual(ui.bondBan.never,['emptyShip','suntShip','maniShip','soloShip']);
 assert.equal(banPool(data,ui.bondBan).extra.includes('investShip'),true);
 applyEditorAction('ed-br-mode',{bond:'yanShip',mode:'fixed'},table,ui,data);
 assert.equal(applyEditorAction('ed-br-defaults',{},table,ui,data),'bond-rules-defaults');
 assert.deepEqual(ui.bondBan.always,[]);assert.deepEqual(ui.bondBan.never,[...BOND_BAN_DEFAULT_NEVER]);
 assert.equal(banPool(data,ui.bondBan).extra.includes('investShip'),false,'恢复默认方案后投资人重新不入池');
 assert.equal(applyEditorAction('ed-br-random-all',{},table,ui,data),'bond-rules-random');
 assert.deepEqual(ui.bondBan.always,[]);assert.deepEqual(ui.bondBan.never,[]);
 assert.equal(banPool(data,ui.bondBan).core.length+banPool(data,ui.bondBan).extra.length,23);
 assert.equal(applyEditorAction('ed-bb-export',{},table,ui,data),'bond-export','配置能导出');
 assert.equal(applyEditorAction('ed-bb-import',{},table,ui,data),'bond-import','配置能导入');
 applyEditorAction('ed-br-mode',{bond:'nope',mode:'fixed'},table,ui,data);
 applyEditorAction('ed-br-mode',{bond:'yanShip',mode:'nope'},table,ui,data);
 assert.deepEqual(ui.bondBan.always,[]);assert.deepEqual(ui.bondBan.never,[]);
});

test('简报渲染：全部核心盟约都列出（被禁的灰掉划掉），附加盟约只列被禁的',()=>{
 const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
 const ban={bonds:bondBanIds(data,1),...defaultBanRules()};
 const {core,extra}=banPool(data),banned=new Set(ban.bonds);
 const brief=bondBanBriefingHtml(data,ban,{esc});
 const cards=[...brief.matchAll(/class="native-ban-bond ([a-z ]+)"><b>([^<]+)<\/b><small>([^<]+)<\/small><span>([^<]+)<\/span>/g)]
  .map(m=>({classes:m[1].split(' '),name:m[2],kind:m[3].split(' · ')[0],why:m[3].split(' · ')[1],status:m[4]}));
 const coreCards=cards.filter(c=>c.classes.includes('core')),extraCards=cards.filter(c=>c.classes.includes('extra'));
 assert.equal(coreCards.length,core.length,'全部核心盟约都要列出来');
 assert.deepEqual(coreCards.map(c=>c.name).sort(),core.map(id=>bondName(data,id)).sort());
 assert.equal(coreCards.filter(c=>c.classes.includes('banned')).length,BAN_CORE_COUNT,'核心盟约里被禁的正好 3 个');
 assert.equal(coreCards.filter(c=>c.classes.includes('available')).length,core.length-BAN_CORE_COUNT);
 for(const c of coreCards)assert.equal(c.kind,'核心');
 assert.ok(coreCards.filter(c=>c.classes.includes('banned')).every(c=>c.why==='随机禁用'),'默认方案下被禁的核心盟约是随机抽中的');
 assert.ok(coreCards.filter(c=>c.classes.includes('available')).every(c=>['随机候选','固定不禁用'].includes(c.why)),'没被禁的核心要标出是随机候选还是固定不禁用');
 const bannedExtra=extra.filter(id=>banned.has(id));
 assert.equal(bannedExtra.length,BAN_EXTRA_COUNT);
 assert.equal(extraCards.length,bannedExtra.length,'附加盟约只列被禁的');
 assert.deepEqual(extraCards.map(c=>c.name).sort(),bannedExtra.map(id=>bondName(data,id)).sort());
 assert.ok(extraCards.every(c=>c.classes.includes('banned')),'列出来的附加盟约都必须是灰掉划掉的');
 for(const c of extraCards)assert.equal(c.kind,'附加');
 const cardNames=new Set(cards.map(c=>c.name));
 for(const id of BOND_BAN_DEFAULT_NEVER)assert.equal(cardNames.has(bondName(data,id)),false,`${bondName(data,id)} 固定不被随机禁，不该出现在缺席名单里`);
 assert.ok(brief.includes('所属盟约全部缺席'),'简报要说明 v3 口径：全部盟约被禁才禁用');
 assert.equal(brief.includes('不禁用名单'),false,'不再提不禁用名单');
 assert.equal(bondBanBriefingHtml(data,{bonds:[]},{esc}),'','没有被禁盟约时不渲染简报');
});

test('被禁干员弹窗：按被禁盟约分组，重复的干员每组各列一次',()=>{
 const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
 const avatar=charId=>`<img alt="" src="./${data.assets[charId]||''}">`;
 const pair=multiBondRow(2),bonds=pair.bonds.slice();
 const ban={bonds,...defaultBanRules()};
 const summary=bondBanSummary(data,bonds,ban);
 const popup=bannedOperatorsHtml(data,ban,{esc,avatar});
 const groups=[...popup.matchAll(/<section class="native-ban-group" data-bond="([^"]+)">([\s\S]*?)<\/section>/g)].map(m=>({bond:m[1],html:m[2]}));
 assert.equal(groups.length,bonds.length,'每个被禁盟约一组');
 assert.deepEqual(groups.map(g=>g.bond).slice().sort(),bonds.slice().sort());
 for(const group of groups){
  const row=summary.bonds.find(b=>b.id===group.bond);
  assert.equal((group.html.match(/<figure/g)||[]).length,row.members.length,`${bondName(data,group.bond)} 组里的人数要等于该盟约下被禁人数`);
 }
 assert.ok(groups.find(g=>g.bond===pair.bonds[0]).html.includes(esc(pair.name)),'双盟约干员要出现在第一组里');
 assert.ok(groups.find(g=>g.bond===pair.bonds[1]).html.includes(esc(pair.name)),'同一名干员在另一个被禁盟约下要再列一次');
 const figures=(popup.match(/<figure/g)||[]).length,distinct=summary.operators.length;
 assert.ok(figures>distinct,'分组会把重复的干员多列一次，所以头像块总数大于去重人数');
 assert.ok((popup.match(new RegExp(esc(pair.name),'g'))||[]).length>=2,`${pair.name} 应该在弹窗里出现至少两次`);
 const brief=bondBanBriefingHtml(data,ban,{esc});
 assert.match(brief,new RegExp(`查看本局被禁用的 ${distinct} 名干员`),'简报按钮写的是去重后的人数');
 assert.match(popup,new RegExp(`共 ${distinct} 名干员无法使用`));
 const pairSummary=summary.operators.find(o=>o.charId===pair.charId);
 assert.ok(pairSummary&&pairSummary.bonds.length===2);
 for(const id of pairSummary.bonds)assert.ok(popup.includes(bondName(data,id)),'弹窗要列出该干员的盟约名');
 const emptyBond=bonds.find(id=>summary.bonds.find(b=>b.id===id).members.length===0);
 if(emptyBond)assert.match(groups.find(g=>g.bond===emptyBond).html,/该盟约下没有被禁用的干员/,'空的被禁盟约也要成组并说明');
 assert.match(bannedOperatorsHtml(data,{bonds:[]},{esc,avatar}),/本局没有被禁用的盟约/);
 const fixedBan={bonds:['yanShip'],always:['yanShip'],never:['investShip']};
 assert.match(bondBanBriefingHtml(data,fixedBan,{esc}),/固定禁用 1 个盟约（炎）/, '简报要说明固定禁用了哪几个');
 assert.match(bannedOperatorsHtml(data,fixedBan,{esc,avatar}),/固定禁用 1 个（炎）/, '弹窗首行同样标出固定禁用');
});

test('弹窗与简报必须取同一份禁用记录：draft 优先，不能被上一局／旧存档留下的空记录顶掉',()=>{
 const live={bonds:bondBanIds(data,1)};
 const stale={bonds:[]};
 assert.equal(activeBondBan(live,stale),live,'本局(draft)的记录优先');
 assert.equal(activeBondBan(stale,live),live,'本局为空时才回落到会话记录');
 assert.equal(activeBondBan(undefined,stale),stale,'两者都空就取会话那份（渲染出空状态）');
 assert.equal(activeBondBan(undefined,undefined),null);
 const esc=s=>String(s??''),avatar=()=>'<img alt="">';
 const expected=bondBanSummary(data,live.bonds).operators.length;
 assert.ok(expected>0);
 assert.match(bondBanBriefingHtml(data,live,{esc}),new RegExp(`查看本局被禁用的 ${expected} 名干员`));
 const popup=bannedOperatorsHtml(data,activeBondBan(live,stale),{esc,avatar});
 assert.match(popup,new RegExp(`共 ${expected} 名`));
 assert.match(bannedOperatorsHtml(data,stale,{esc,avatar}),/共 0 名/,'用旧记录渲染就会得到 0 名——这正是当初的报障');
});

test('简报摘要：列出每个被禁盟约的规模与该盟约下被禁的干员',()=>{
 const summary=bondBanSummary(data,[BAN_BOND]);
 assert.equal(summary.bonds.length,1);
 assert.equal(summary.bonds[0].id,BAN_BOND);
 assert.equal(summary.bonds[0].core,true);
 assert.equal(summary.bonds[0].name,bondName(data,BAN_BOND));
 assert.equal(summary.bonds[0].total,bondMembers(data,BAN_BOND).length);
 assert.equal(summary.bonds[0].mode,'random');
 assert.deepEqual(summary.bonds[0].banned,summary.bonds[0].members.map(m=>m.name));
 assert.deepEqual(summary.bonds[0].members.map(m=>m.charId).slice().sort(),soloMembers(BAN_BOND).map(r=>r.charId).slice().sort());
 assert.deepEqual(summary.operators.map(o=>o.charId).slice().sort(),soloMembers(BAN_BOND).map(r=>r.charId).slice().sort());
 const all=bondBanSummary(data,bondIds(data));
 assert.equal(all.operators.length,bondRoster(data).length,'全部盟约被禁时每个人都出局');
 assert.equal(all.bonds.length,bondIds(data).length,'每个被禁盟约都成组');
});
