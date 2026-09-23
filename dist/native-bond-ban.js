// 盟约禁用（作战前简报的「缺席盟约／被禁用干员」）。
//
// 口径（用户 2026-09-22 定稿）：
//  * 每个盟约在「协议自定义 → 禁用方案」页里处在三种状态之一（`banRules`）：
//      - `fixed`  固定禁用：每局必定缺席，**不占随机名额**；
//      - `random` 参与随机：进抽取池，每局从池里等概率抽 **3 个核心 + 4 个附加**；
//      - `never`  固定不被禁：不进池、也不固定禁。
//    默认方案：`fixed` 为空；`never` = 协防干员（emptyShip）／绝技（suntShip）／调和（maniShip）／独行（soloShip）
//    ＋**投资人（investShip）**（`BOND_BAN_DEFAULT_NEVER`，用户 2026-09-22 补充口径），其余 18 个（8 核心 + 10 附加）参与随机。
//    状态由玩家在配置页改，存在 `localStorage`／存档的 `always`／`never` 两个数组里；不看 `modeDataDict` 的模式表。
//  * 每个盟约各有一份**「不禁用名单」**：被禁盟约的成员里只有名单上的干员还能进调配池，其余全部禁用。
//    判定只看这一条——干员只要挂在某个被禁盟约名下又不在那份名单里，就禁用（哪怕它还挂着别的没被禁的盟约）。
//    （第一版理解的「名下盟约全被禁才禁用」是错的，别再退回去。）
//  * 限制覆盖**所有获取渠道**：商店／具名池之外，策略与卫戍的点名发放、道具、晋升奖励候选、援军转让
//    同样拿不到被禁干员（见 `native-session.gain` / `native-economy.bondBanned`）。
//  * **道具相关的盟约不受影响**（用户 2026-09-22 口径）：装备自身的 `giveBondId` 归属照旧用于商店／具名池
//    取货，变形同构体照旧把另一件装备的盟约借给携带者——被禁的是**干员的获取**，不是盟约本身。
//
// 干员身份按 charId 归并：精锐与初始是同一名干员的两种状态，名单只登记一次。
import {waveRng} from './native-wave-random.js';

export const BOND_BAN_KEY='garrison-bond-ban-v1';
// 存档／localStorage 里的配置版本：临时数据时期存下来的名单没有版本号，读到就直接忽略、回落到内置名单。
// 版本 2 起配置多了 `always`／`never` 两个字段（禁用方案）；旧 v2 配置缺字段时按默认方案补齐，不用重新导出。
export const BOND_BAN_VERSION=2;
export const BAN_CORE_COUNT=3;
export const BAN_EXTRA_COUNT=4;
// 内置固定不参与随机禁用的四个盟约（用户 2026-09-22 口径）：协防干员、绝技、调和、独行。
export const BOND_BAN_EXCLUDED=Object.freeze(['emptyShip','suntShip','maniShip','soloShip']);
// 默认方案在这四个之外再把**投资人**排除出随机池（用户 2026-09-22 补充口径：默认方案里投资人不被随机禁用）。
// 它只是默认值，可以在「禁用方案」页改成固定禁用或重新参与随机。
export const BOND_BAN_DEFAULT_NEVER=Object.freeze([...BOND_BAN_EXCLUDED,'investShip']);
// 三种状态：固定禁用 / 参与随机 / 固定不被禁。
export const BAN_MODES=Object.freeze(['fixed','random','never']);

export function bondIds(data){return Object.keys(data?.season?.bondInfoDict||{});}
export function bondIsCore(data,id){return data?.common?.bondInfoDict?.[id]?.isPower===true;}
export function bondName(data,id){return data?.season?.bondInfoDict?.[id]?.name||id;}
export function bondIsBanExcluded(id){return BOND_BAN_EXCLUDED.includes(id);}
// 默认方案（禁用方案页的「恢复默认」用的就是它）。
export function defaultBanRules(){return {always:[],never:[...BOND_BAN_DEFAULT_NEVER]};}
// 把配置解析成「谁固定禁用、谁固定不被禁、每个盟约当前是什么状态」。
// 两个数组各自独立回落默认值：只写了 `always` 的旧配置也能拿到默认的 `never`（投资人照样不入池）。
// 同时出现在两个数组里时以 `always` 为准（固定禁用更明确），避免状态自相矛盾。
export function banRules(config,data){
 const ids=bondIds(data),known=new Set(ids),fallback=defaultBanRules();
 const clean=list=>[...new Set((Array.isArray(list)?list:[]).filter(id=>known.has(id)))];
 const fixed=clean(Array.isArray(config?.always)?config.always:fallback.always);
 const never=clean(Array.isArray(config?.never)?config.never:fallback.never).filter(id=>!fixed.includes(id));
 const mode=new Map(ids.map(id=>[id,fixed.includes(id)?'fixed':never.includes(id)?'never':'random']));
 return {fixed,never,mode};
}
export const banModeOf=(rules,id)=>rules?.mode?.get?.(id)||(rules?.mode?.[id])||'random';

// 名册（可售）干员，按 charId 归并：精锐与初始是同一名干员，名单只登记一次，
// 盟约取两种形态的并集、等阶取低的那一份（只用于列表排序与名单按「名＋阶」定位）。
// 盟约以 `data.profiles[chessId].bonds` 为准——盟约面板（native-play 的 bondOperators）与商店都读这份，
// 不要再拿 charChessDataDict.bondIds 另算一套。
const rosterCache=new WeakMap();
export function bondRoster(data){
 if(data&&rosterCache.has(data))return rosterCache.get(data);
 const rows=new Map();
 for(const shop of Object.values(data?.season?.charShopChessDatas||{})){
  if(!shop?.charId||shop.isHidden)continue;
  const profile=data.profiles?.[shop.chessId]||{},level=Number(shop.chessLevel)||1;
  let row=rows.get(shop.charId);
  if(!row){row={charId:shop.charId,name:profile.name||shop.charId,tier:level,bonds:[],chessIds:[]};rows.set(shop.charId,row);}
  row.tier=Math.min(row.tier,level);
  if(profile.name)row.name=profile.name;
  for(const bond of profile.bonds||[])if(!row.bonds.includes(bond))row.bonds.push(bond);
  if(!row.chessIds.includes(shop.chessId))row.chessIds.push(shop.chessId);
 }
 const list=[...rows.values()].sort((a,b)=>a.tier-b.tier||String(a.name).localeCompare(String(b.name),'zh-CN'));
 for(const row of list)row.bonds.sort();
 if(data)rosterCache.set(data,list);
 return list;
}
export function rosterIndex(data){
 const rows=bondRoster(data),index=new Map();
 for(const row of rows){index.set(row.charId,row);for(const chessId of row.chessIds)index.set(chessId,row);}
 return index;
}
// 干员身份按 charId 归并：精锐形态的 chessId（chess_char_x_y_b）既不在 charShopChessDatas 里，
// 也不在名册索引里，直接拿 chessId 查会漏判。所有入口（商店、策略、道具、援军转让、精锐发放）
// 都要先落到 charId 再查名单，否则「禁用盟约的精锐形态照发」就是个洞。
export function charIdOf(data,chessId){
 if(typeof chessId!=='string'||!chessId)return null;
 const shop=data?.season?.charShopChessDatas?.[chessId];if(shop?.charId)return shop.charId;
 const profile=data?.profiles?.[chessId];if(profile?.charId)return profile.charId;
 const normal=data?.season?.chessNormalIdLookupDict?.[chessId];
 if(normal)return data?.season?.charShopChessDatas?.[normal]?.charId||data?.profiles?.[normal]?.charId||null;
 return null;
}
export function bondMembers(data,bond){return bondRoster(data).filter(row=>row.bonds.includes(bond));}
// 该干员被哪几个「已禁盟约」挡下（可能多个）：返回盟约 id 列表，供界面提示用。
export function bondBanBlockers(data,bonds,exempt,chessId){
 const row=rosterIndex(data).get(charIdOf(data,chessId)||chessId);
 if(!row)return [];
 const set=bonds instanceof Set?bonds:new Set(bonds||[]);
 return row.bonds.filter(bond=>set.has(bond)&&!exemptOf(exempt,bond).includes(row.charId));
}

// ── 各盟约的「不禁用名单」（用户 2026-09-22 提供，游戏内显示名 + 阶）──────────────────
// 键是盟约 id，值是 [干员显示名, 阶] 列表。名字里的间隔号会被忽略（原表「维娜·维多利亚」
// 用户写作「维娜维多利亚」），阶用来区分同名干员（初雪III 与 圣聆初雪VI、银灰IV 与 凛御银灰V）。
// 「叙拉古」的名单是空的：本局叙拉古被禁时它的成员全部出局。
export const BOND_EXEMPT_TABLE={
 egirShip:[['斯卡蒂',3]],
 kazimierzShip:[['砾',2],['锏',6]],
 lateranoShip:[['空弦',3],['圣约送葬人',5]],
 sargonShip:[['至简',3]],
 victoriaShip:[['哈洛德',2],['烛煌',5]],
 kjeragShip:[['哈洛德',2],['锏',6]],
 siracusaShip:[],
 yanShip:[['烛煌',5]],
 arcaneShip:[['洛洛',2],['莫斯提马',4],['圣聆初雪',6]],
 indomShip:[['风笛',4]],
 steadShip:[['斯卡蒂',3],['信仰搅拌机',4],['余',6]],
 preciShip:[['送葬人',2],['雪猎',3],['远牙',4],['缇缇',5],['异客',6]],
 skillfulShip:[['灵知',4]],
 miraShip:[['伺夜',3],['维娜·维多利亚',6]],
 investShip:[['凛御银灰',5]],
 raidShip:[['斯卡蒂',3],['瑕光',3]],
 swiftShip:[['凛御银灰',5],['异客',6],['锏',6]],
 visiShip:[['初雪',3],['风笛',4]],
 deputShip:[['耶拉',3]]
};

// 名字比对：原表的间隔号（·／・）与空白不参与匹配，用户手写名单时才不会因为一个点对不上。
export const operatorKey=name=>String(name??'').replace(/[·・\s]/g,'');
// 把「盟约 → 名＋阶」的原始名单解析成「盟约 → charId 列表」。解析不出来（名字不在该盟约、
// 或阶对不上）的条目会进 `unresolved`，由 tests/native-bond-ban.test.mjs 的门禁钉住，不许静默丢。
export function resolveBondExempt(data,table=BOND_EXEMPT_TABLE){
 const exempt={},unresolved=[];
 for(const id of bondIds(data))exempt[id]=[];
 for(const [bond,entries] of Object.entries(table)){
  if(!data.season.bondInfoDict[bond]){unresolved.push({bond,entry:null,reason:'unknown-bond'});continue;}
  const members=bondMembers(data,bond);
  for(const entry of entries){
   const [name,tier]=Array.isArray(entry)?entry:[entry,null],key=operatorKey(name);
   const byName=members.filter(row=>operatorKey(row.name)===key);
   const hit=(tier==null?byName:byName.filter(row=>row.tier===tier))[0];
   if(!hit){unresolved.push({bond,name,tier,reason:byName.length?'tier-mismatch':'not-a-member'});continue;}
   if(!exempt[bond].includes(hit.charId))exempt[bond].push(hit.charId);
  }
 }
 return {exempt,unresolved};
}
// 默认配置＝内置名单 ＋ 默认禁用方案（投资人固定不被随机禁用）。
export function defaultBondExempt(data){return {exempt:resolveBondExempt(data).exempt,...defaultBanRules()};}
export function normalizeBondBan(raw,data){
 const known=new Set(bondRoster(data).map(row=>row.charId)),exempt={};
 for(const id of bondIds(data))exempt[id]=[...new Set((Array.isArray(raw?.exempt?.[id])?raw.exempt[id]:[]).filter(charId=>typeof charId==='string'&&known.has(charId)))];
 const rules=banRules(raw,data);
 return {exempt,always:rules.fixed,never:rules.never};
}
export function loadBondBan(data){
 try{
  if(typeof localStorage!=='undefined'){
   const raw=JSON.parse(localStorage.getItem(BOND_BAN_KEY)||'null');
   // 只认当前版本的配置：临时数据时期存下来的名单（没有 version）直接忽略，回落到内置名单。
   // 同一版本的旧配置少了 `always`／`never` 时由 normalizeBondBan 按默认方案补齐。
   if(raw&&raw.version===BOND_BAN_VERSION)return normalizeBondBan(raw,data);
  }
 }catch{}
 return defaultBondExempt(data);
}
export function saveBondBan(config,data){
 const next={version:BOND_BAN_VERSION,...normalizeBondBan(config,data)};
 try{if(typeof localStorage!=='undefined')localStorage.setItem(BOND_BAN_KEY,JSON.stringify(next));}catch{}
 return next;
}

// 本局禁用哪些盟约：固定禁用的全部计入，其余从「参与随机」的池里抽 3 核心 + 4 附加，
// 等概率、不放回；同一 seed 结果固定（跟商店/波次随机流分开）。
// 固定禁用不占随机名额，池子不够时按池子大小截断（改配置时可能出现只剩 2 个核心候选的情况）。
export function banPool(data,config){
 const {fixed,never}=banRules(config,data),skip=new Set([...fixed,...never]),core=[],extra=[];
 for(const id of bondIds(data)){
  if(skip.has(id))continue;
  (bondIsCore(data,id)?core:extra).push(id);
 }
 return {core,extra};
}
export function bondBanIds(data,seed,config){
 const {core,extra}=banPool(data,config),fixed=banRules(config,data).fixed;
 const rng=waveRng(((Number(seed)||0)^0x5bd1e995)>>>0);
 const draw=(list,count)=>{
  const copy=list.slice(),out=[];
  while(out.length<count&&copy.length)out.push(copy.splice(Math.floor(rng()*copy.length),1)[0]);
  return out;
 };
 return [...fixed,...draw(core,BAN_CORE_COUNT),...draw(extra,BAN_EXTRA_COUNT)];
}

const exemptOf=(exempt,bond)=>Array.isArray(exempt?.[bond])?exempt[bond]:[];
export function memberBanned(row,bonds,exempt){
 if(!row?.bonds?.length)return false;
 const set=bonds instanceof Set?bonds:new Set(bonds||[]);
 return row.bonds.some(bond=>set.has(bond)&&!exemptOf(exempt,bond).includes(row.charId));
}
export function isOperatorBanned(data,bonds,exempt,chessId){
 if(!bonds?.length)return false;
 const row=rosterIndex(data).get(charIdOf(data,chessId)||chessId);
 return row?memberBanned(row,bonds,exempt):false;
}
export function bannedOperators(data,bonds,exempt){
 if(!bonds?.length)return [];
 return bondRoster(data).filter(row=>memberBanned(row,bonds,exempt)).map(row=>({charId:row.charId,name:row.name,tier:row.tier,bonds:row.bonds.slice()}));
}
// 简报／配置页用：每个被禁盟约的规模与名单，以及本次真正出局的干员。
// `config` 传本局配置时，每个盟约还会带上 `mode`（fixed／random／never），界面据此标出是固定禁用还是随机抽中。
export function bondBanSummary(data,bonds,exempt,config){
 const set=new Set(bonds||[]),rows=bondRoster(data),rules=banRules(config,data);
 return {
  bonds:(bonds||[]).map(id=>({
   id,name:bondName(data,id),core:bondIsCore(data,id),mode:banModeOf(rules,id),
   total:bondMembers(data,id).length,exempt:exemptOf(exempt,id).length,
   banned:rows.filter(row=>row.bonds.includes(id)&&memberBanned(row,set,exempt)).map(row=>row.name),
  })),
  operators:rows.filter(row=>memberBanned(row,set,exempt)).map(row=>({charId:row.charId,name:row.name,tier:row.tier})),
 };
}

// ── 作战前简报的两段呈现 ──────────────────────────────────────────────────────
// 用户 2026-09-22 口径：战前预览要**列出全部核心盟约**（被禁的灰色＋划掉）、**单独列出被禁的
// 附加盟约**（同样灰色＋划掉），被禁干员放在单独弹窗里用头像列出。
// 这两段 HTML 放在这里（而不是 native-play 里）是为了能在 Node 里直接断言渲染结果：
// UI 工具函数由调用方注入——`{esc, avatar}`，native-play 传自己的转义与头像函数。
const bondCellHtml=(data,id,isBanned,row,esc)=>{
 const mode=row?.mode||'random',tag=bondIsCore(data,id)?'核心':'附加';
 const why=isBanned?(mode==='fixed'?'固定禁用':'随机禁用'):(mode==='never'?'固定不被禁':'随机候选');
 return `<article class="native-ban-bond${isBanned?' banned':' available'}${bondIsCore(data,id)?' core':' extra'}"><b>${esc(bondName(data,id))}</b><small>${tag} · ${why}</small><span>${isBanned?`禁用 ${row?row.banned.length:0} / ${row?row.total:0} 人`:'可用'}</span></article>`;
};

export function bondBanBriefingHtml(data,ban,ui={}){
 if(!ban?.bonds?.length)return '';
 const esc=ui.esc||String,summary=bondBanSummary(data,ban.bonds,ban.exempt,ban),banned=new Set(ban.bonds);
 const ids=bondIds(data),rules=banRules(ban,data);
 // 核心盟约永远全列（含固定不禁用的），附加只列被禁的。
 const core=ids.filter(id=>bondIsCore(data,id)),extra=ids.filter(id=>!bondIsCore(data,id));
 const rowOf=id=>summary.bonds.find(b=>b.id===id);
 const bannedExtra=extra.filter(id=>banned.has(id));
 const fixed=[...rules.fixed,...rules.never].length?`固定禁用 ${rules.fixed.length} 个盟约${rules.fixed.length?`（${esc(rules.fixed.map(id=>bondName(data,id)).join('／'))}）`:''}；${esc(rules.never.map(id=>bondName(data,id)).join('／'))} 固定不被随机禁用。`:'';
 return `<h2>盟约缺席情况</h2><p>每局从「参与随机」的盟约里随机禁用 ${BAN_CORE_COUNT} 个核心盟约与 ${BAN_EXTRA_COUNT} 个附加盟约（不占固定禁用的名额）。${fixed}被禁盟约的干员只有在其「不禁用名单」上才能出场，商店抽取、策略与道具发放一并不提供。</p><h3 class="native-ban-heading">核心盟约 <small>${core.filter(id=>banned.has(id)).length} / ${core.length} 缺席</small></h3><div class="native-ban-bonds">${core.map(id=>bondCellHtml(data,id,banned.has(id),rowOf(id),esc)).join('')}</div><h3 class="native-ban-heading">被禁用的附加盟约 <small>${bannedExtra.length} 个</small></h3><div class="native-ban-bonds">${bannedExtra.map(id=>bondCellHtml(data,id,true,rowOf(id),esc)).join('')||'<p class="native-ban-none">本局没有被禁用的附加盟约。</p>'}</div><button class="native-ban-open" data-act="ban-list">查看本局被禁用的 ${summary.operators.length} 名干员 →</button>`;
}

// 简报（按钮上的「N 名」）与弹窗必须用**同一份**禁用记录，否则会出现「按钮写 50 名、弹窗 0 名」。
// 战前准备读 `state.draft.bondBan`；对局中才读会话的 `s.bondBan`。**不能优先读 `state.game`**：
// 从大厅开新局时 `state.game` 可能还留着上一局——甚至是旧版本存档恢复出来的、根本没有禁用字段
// 的会话（`restore` 会补成 `bonds:[]`），拿它渲染就会显示成「本局没有被禁用的干员」。
export function activeBondBan(draftBan,sessionBan){
 if(Array.isArray(draftBan?.bonds)&&draftBan.bonds.length)return draftBan;
 if(Array.isArray(sessionBan?.bonds)&&sessionBan.bonds.length)return sessionBan;
 return draftBan||sessionBan||null;
}

// 被禁干员弹窗内容：先一行「缺席盟约」，再是头像＋名字＋阶＋「被哪几个缺席盟约挡下」。
// 战前准备与对局中共用（对局里没有简报页，所以盟约也要在这里列出来）。一人一张，按阶再按名字排序。
export function bannedOperatorsHtml(data,ban,ui={}){
 const esc=ui.esc||String,avatar=ui.avatar||(()=>'');
 const summary=bondBanSummary(data,ban?.bonds||[],ban?.exempt||{},ban);
 const ops=summary.operators.slice().sort((a,b)=>a.tier-b.tier||String(a.name).localeCompare(String(b.name),'zh'));
 const blockers=o=>bondBanBlockers(data,ban?.bonds||[],ban?.exempt||{},o.charId).map(id=>bondName(data,id)).join('／');
 const banned=new Set(ban?.bonds||[]),rules=banRules(ban,data);
 const fixedSet=new Set(rules.fixed);
 const coreBanned=[...banned].filter(id=>bondIsCore(data,id)),extraBanned=[...banned].filter(id=>!bondIsCore(data,id));
 const fixedBanned=[...banned].filter(id=>fixedSet.has(id)),randomBanned=[...banned].filter(id=>!fixedSet.has(id));
 const list=ids=>ids.length?`（${esc(ids.map(id=>bondName(data,id)).join('／'))}）`:'';
 const covenantLine=banned.size
  ?`${fixedBanned.length?`固定禁用 ${fixedBanned.length} 个${list(fixedBanned)} · `:''}随机禁用：核心 ${coreBanned.filter(id=>!fixedSet.has(id)).length} 个${list(randomBanned.filter(id=>bondIsCore(data,id)))} · 附加 ${extraBanned.filter(id=>!fixedSet.has(id)).length} 个${list(randomBanned.filter(id=>!bondIsCore(data,id)))}`
  :'本局没有被禁用的盟约。';
 return `<h2>本局禁用盟约与干员</h2><p class="native-ban-note">${covenantLine}</p><p class="native-ban-note">共 ${ops.length} 名干员无法使用：所属盟约本局缺席，且不在该盟约的不禁用名单上。商店抽取、策略与道具发放都不会提供他们。</p><div class="native-ban-operators">${ops.map(o=>`<figure title="${esc(o.name)} · 被禁盟约 ${esc(blockers(o))}"><span class="native-ban-op-art">${avatar(o.charId)}</span><figcaption><b>${esc(o.name)}</b><small>${o.tier} 阶</small><em>${esc(blockers(o))}</em></figcaption></figure>`).join('')||'<p class="native-ban-none">本局没有被禁用的干员。</p>'}</div><p class="native-ban-foot">名单与禁用方案可在协议自定义 →「盟约禁用」／「禁用方案」页调整。</p><button data-act="close">关闭</button>`;
}
