// 盟约禁用（作战前简报的「缺席盟约／被禁用干员」）。
//
// 口径（用户 2026-09-22 二次修订，配置版本升到 v3）：
//  * 每局从「参与随机」的盟约里随机禁用 **3 个核心盟约 + 4 个附加盟约**；固定禁用的盟约必定缺席、
//    **不占随机名额**；同一开局种子结果固定（与商店／波次随机流分开）。
//  * 每个盟约处在三种状态之一（`banRules`，在「协议自定义 → 禁用方案」页调）：
//      - `fixed`  固定禁用；`random` 参与随机；`never` 固定不被禁。
//    默认方案：`fixed` 为空；`never` = 协防干员（emptyShip）／绝技（suntShip）／调和（maniShip）
//    ＋**投资人（investShip）**（`BOND_BAN_DEFAULT_NEVER`，配置只存 `always`／`never`）。
//    **独行（soloShip）不在默认豁免里，默认就可能被随机禁到**（用户 2026-09-22 二次修订）；
//    **绝技（suntShip）是硬锁**：任何情况下都不会被禁，也不允许被配置成固定禁用或参与随机（`BOND_BAN_LOCKED_NEVER`）。
//  * **干员禁用规则（v3 修订）**：一名干员**所属的全部盟约都被禁**时才被禁用；只要还挂着一个没被禁的
//    盟约就仍然可用。v2 的逐盟约「不禁用名单」（`exempt`）已废弃，配置里不再有这一项。
//    没有盟约归属的干员不因本机制被禁。
//  * 限制覆盖**所有获取渠道**：商店／具名池之外，策略与卫戍的点名发放、道具、晋升奖励候选、援军转让
//    同样拿不到被禁干员（见 `native-session.gain` / `native-economy.bondBanned`）。
//  * **道具相关的盟约不受影响**：装备自身的 `giveBondId` 归属照旧用于商店／具名池取货，变形同构体照旧
//    把另一件装备的盟约借给携带者——被禁的是**干员的获取**，不是盟约本身。
//  * 预览按**被禁盟约分组**列出被禁干员：同一名干员挂在多个被禁盟约下时，每组各列一次（用户 2026-09-22 口径）。
//
// 干员身份按 charId 归并：精锐与初始是同一名干员的两种状态，判定与展示都只算一次。
import {waveRng} from './native-wave-random.js';

export const BOND_BAN_KEY='garrison-bond-ban-v1';
// 配置版本：临时数据时期存下来的名单没有版本号，读到就直接忽略、回落到默认方案；
// v2 多了 `always`／`never`；**v3 去掉了 `exempt`（不禁用名单）**——旧 v2 配置因版本不符被忽略，
// 按默认方案（fixed 空、never = 五个豁免盟约）重新开始，不再沿用旧名单。
export const BOND_BAN_VERSION=3;
export const BAN_CORE_COUNT=3;
export const BAN_EXTRA_COUNT=4;
// 默认不参与随机禁用的内置盟约（用户 2026-09-22 二次修订）：协防干员、绝技、调和。
// **独行（soloShip）已从这份名单移出**——默认就参与随机、可能被禁；玩家仍可在「禁用方案」页把它改成不被禁。
export const BOND_BAN_EXCLUDED=Object.freeze(['emptyShip','suntShip','maniShip']);
// **硬锁不被禁**：绝技在任何情况下都不会被禁，也不允许被配置成固定禁用／参与随机。
// `banRules` 会强制把它归到 `never`，配置页对它只显示不可点的状态（用户 2026-09-22 口径：
// 「绝技在任何情况下固定不会 ban（也不可能 ban）」）。
export const BOND_BAN_LOCKED_NEVER=Object.freeze(['suntShip']);
// 默认方案在这四个之外再把**投资人**排除出随机池。它只是默认值，可以在「禁用方案」页改。
// 默认方案里「不被禁」且**玩家可改**的盟约：三个内置豁免里去掉硬锁的绝技，再加投资人。
// 绝技由 BOND_BAN_LOCKED_NEVER 保证，不写进配置也不出现在这份默认值里（避免同一件事两处记账）。
export const BOND_BAN_DEFAULT_NEVER=Object.freeze([...BOND_BAN_EXCLUDED.filter(id=>!BOND_BAN_LOCKED_NEVER.includes(id)),'investShip']);
// 三种状态：固定禁用 / 参与随机 / 固定不被禁。
export const BAN_MODES=Object.freeze(['fixed','random','never']);

export function bondIds(data){return Object.keys(data?.season?.bondInfoDict||{});}
export function bondIsCore(data,id){return data?.common?.bondInfoDict?.[id]?.isPower===true;}
export function bondName(data,id){return data?.season?.bondInfoDict?.[id]?.name||id;}
export function bondIsBanExcluded(id){return BOND_BAN_EXCLUDED.includes(id);}
// 硬锁：任何配置都改不了它的状态（绝技）。
export function bondIsLockedNever(id){return BOND_BAN_LOCKED_NEVER.includes(id);}
// 默认方案（禁用方案页的「恢复默认」用的就是它）。
export function defaultBanRules(){return {always:[],never:[...BOND_BAN_DEFAULT_NEVER]};}
// 把配置解析成「谁固定禁用、谁固定不被禁、每个盟约当前是什么状态」。
// 两个数组各自独立回落默认值：只写了 `always` 的旧配置也能拿到默认的 `never`（投资人照样不入池）。
// 同时出现在两个数组里时以 `always` 为准（固定禁用更明确），避免状态自相矛盾。
export function banRules(config,data){
 const ids=bondIds(data),known=new Set(ids),fallback=defaultBanRules();
 const clean=list=>[...new Set((Array.isArray(list)?list:[]).filter(id=>known.has(id)))];
 // 硬锁的盟约永远只可能是 never：既不能出现在 fixed 里，也一定出现在 never 里。
 const locked=BOND_BAN_LOCKED_NEVER.filter(id=>known.has(id));
 const fixed=clean(Array.isArray(config?.always)?config.always:fallback.always).filter(id=>!locked.includes(id));
 const never=[...new Set([...clean(Array.isArray(config?.never)?config.never:fallback.never).filter(id=>!fixed.includes(id)),...locked])];
 const mode=new Map(ids.map(id=>[id,fixed.includes(id)?'fixed':never.includes(id)?'never':'random']));
 return {fixed,never,locked,mode};
}
export const banModeOf=(rules,id)=>rules?.mode?.get?.(id)||(rules?.mode?.[id])||'random';

// 名册（可售）干员，按 charId 归并：精锐与初始是同一名干员，判定只算一次，
// 盟约取两种形态的并集、等阶取低的那一份（只用于列表排序）。
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
// 都要先落到 charId 再判定，否则「禁用盟约的精锐形态照发」就是个洞。
export function charIdOf(data,chessId){
 if(typeof chessId!=='string'||!chessId)return null;
 const shop=data?.season?.charShopChessDatas?.[chessId];if(shop?.charId)return shop.charId;
 const profile=data?.profiles?.[chessId];if(profile?.charId)return profile.charId;
 const normal=data?.season?.chessNormalIdLookupDict?.[chessId];
 if(normal)return data?.season?.charShopChessDatas?.[normal]?.charId||data?.profiles?.[normal]?.charId||null;
 return null;
}
export function bondMembers(data,bond){return bondRoster(data).filter(row=>row.bonds.includes(bond));}

// ── 禁用判定（v3）：所属盟约「全部」被禁才禁用 ────────────────────────────────
const banSet=bonds=>bonds instanceof Set?bonds:new Set(bonds||[]);
export function memberBanned(row,bonds){
 if(!row?.bonds?.length)return false; // 没有盟约归属的干员不因本机制被禁
 const set=banSet(bonds);
 return row.bonds.every(bond=>set.has(bond));
}
export function isOperatorBanned(data,bonds,chessId){
 if(!bonds?.length)return false;
 const row=rosterIndex(data).get(charIdOf(data,chessId)||chessId);
 return row?memberBanned(row,bonds):false;
}
export function bannedOperators(data,bonds){
 if(!bonds?.length)return [];
 return bondRoster(data).filter(row=>memberBanned(row,bonds)).map(row=>({charId:row.charId,name:row.name,tier:row.tier,bonds:row.bonds.slice()}));
}
// 该干员被哪些盟约挡下：被禁时就是它全部的盟约（v3 的判定要求全被禁），没被禁时返回空数组。
export function bondBanBlockers(data,bonds,chessId){
 const row=rosterIndex(data).get(charIdOf(data,chessId)||chessId);
 if(!row||!memberBanned(row,bonds))return [];
 const set=banSet(bonds);
 return row.bonds.filter(bond=>set.has(bond));
}
// 简报／弹窗用：每个被禁盟约的规模、状态，以及**该盟约下被禁的干员**（这是预览分组的数据源）。
// 同一名干员挂在多个被禁盟约下时会同时出现在多组里（用户要的就是「重复多列一次」）。
export function bondBanSummary(data,bonds,config){
 const set=banSet(bonds),rows=bondRoster(data),rules=banRules(config,data);
 const detail=row=>({charId:row.charId,name:row.name,tier:row.tier,bonds:row.bonds.slice()});
 return {
  bonds:(bonds||[]).map(id=>{
   const members=bondMembers(data,id).filter(row=>memberBanned(row,set));
   return {
    id,name:bondName(data,id),core:bondIsCore(data,id),mode:banModeOf(rules,id),
    total:bondMembers(data,id).length,banned:members.map(row=>row.name),
    members:members.sort((a,b)=>a.tier-b.tier||String(a.name).localeCompare(String(b.name),'zh-CN')).map(detail),
   };
  }),
  operators:rows.filter(row=>memberBanned(row,set)).map(detail),
 };
}

// ── 配置读写 ─────────────────────────────────────────────────────────────────
export function normalizeBondBan(raw,data){
 const rules=banRules(raw,data),locked=new Set(BOND_BAN_LOCKED_NEVER);
 // 配置只留玩家意图：硬锁的盟约（绝技）不写进配置文件，判定与展示时由 banRules 强制补进 never。
 return {always:rules.fixed.filter(id=>!locked.has(id)),never:rules.never.filter(id=>!locked.has(id))};
}
export function loadBondBan(data){
 try{
  if(typeof localStorage!=='undefined'){
   const raw=JSON.parse(localStorage.getItem(BOND_BAN_KEY)||'null');
   // 只认当前版本的配置：v2 及更早（含临时数据时期的无版本名单）一律忽略，回落到默认方案。
   if(raw&&raw.version===BOND_BAN_VERSION)return normalizeBondBan(raw,data);
  }
 }catch{}
 return defaultBanRules();
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

// ── 作战前简报的两段呈现 ──────────────────────────────────────────────────────
// 战前预览要**列出全部核心盟约**（被禁的灰色＋划掉）、**单独列出被禁的附加盟约**（同样灰色＋划掉），
// 被禁干员放在单独弹窗里、按被禁盟约分组列出。
// 这两段 HTML 放在这里（而不是 native-play 里）是为了能在 Node 里直接断言渲染结果：
// UI 工具函数由调用方注入——`{esc, avatar}`，native-play 传自己的转义与头像函数。
const bondCellHtml=(data,id,isBanned,row,esc)=>{
 const mode=row?.mode||'random',tag=bondIsCore(data,id)?'核心':'附加';
 const why=isBanned?(mode==='fixed'?'固定禁用':'随机禁用'):(mode==='never'?'固定不被禁':'随机候选');
 return `<article class="native-ban-bond${isBanned?' banned':' available'}${bondIsCore(data,id)?' core':' extra'}"><b>${esc(bondName(data,id))}</b><small>${tag} · ${why}</small><span>${isBanned?`该盟约下禁用 ${row?row.banned.length:0} / ${row?row.total:0} 人`:'可用'}</span></article>`;
};

export function bondBanBriefingHtml(data,ban,ui={}){
 if(!ban?.bonds?.length)return '';
 const esc=ui.esc||String,summary=bondBanSummary(data,ban.bonds,ban),banned=new Set(ban.bonds);
 const ids=bondIds(data),rules=banRules(ban,data);
 // 核心盟约永远全列（含固定不禁用的），附加只列被禁的。
 const core=ids.filter(id=>bondIsCore(data,id)),extra=ids.filter(id=>!bondIsCore(data,id));
 const rowOf=id=>summary.bonds.find(b=>b.id===id);
 const bannedExtra=extra.filter(id=>banned.has(id));
 const fixed=[...rules.fixed,...rules.never].length?`固定禁用 ${rules.fixed.length} 个盟约${rules.fixed.length?`（${esc(rules.fixed.map(id=>bondName(data,id)).join('／'))}）`:''}；${esc(rules.never.map(id=>bondName(data,id)).join('／'))} 固定不被随机禁用。`:'';
 return `<h2>盟约缺席情况</h2><p>每局从「参与随机」的盟约里随机禁用 ${BAN_CORE_COUNT} 个核心盟约与 ${BAN_EXTRA_COUNT} 个附加盟约（不占固定禁用的名额）。${fixed}一名干员只有在<b>所属盟约全部缺席</b>时才不可使用——只要还挂着一个未缺席的盟约就仍能出场；商店抽取、策略与道具发放都不提供被禁干员。</p><h3 class="native-ban-heading">核心盟约 <small>${core.filter(id=>banned.has(id)).length} / ${core.length} 缺席</small></h3><div class="native-ban-bonds">${core.map(id=>bondCellHtml(data,id,banned.has(id),rowOf(id),esc)).join('')}</div><h3 class="native-ban-heading">被禁用的附加盟约 <small>${bannedExtra.length} 个</small></h3><div class="native-ban-bonds">${bannedExtra.map(id=>bondCellHtml(data,id,true,rowOf(id),esc)).join('')||'<p class="native-ban-none">本局没有被禁用的附加盟约。</p>'}</div><button class="native-ban-open" data-act="ban-list">查看本局被禁用的 ${summary.operators.length} 名干员 →</button>`;
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

// 被禁干员弹窗内容：先一行「缺席盟约」，再**按被禁盟约分组**列出该盟约下被禁的干员。
// 同一名干员挂在多个缺席盟约下时，每组各列一次（用户 2026-09-22 口径：重复就多列举一次）。
export function bannedOperatorsHtml(data,ban,ui={}){
 const esc=ui.esc||String,avatar=ui.avatar||(()=>'');
 const summary=bondBanSummary(data,ban?.bonds||[],ban);
 const ops=summary.operators.slice().sort((a,b)=>a.tier-b.tier||String(a.name).localeCompare(String(b.name),'zh'));
 const banned=new Set(ban?.bonds||[]),rules=banRules(ban,data);
 const fixedSet=new Set(rules.fixed);
 const coreBanned=[...banned].filter(id=>bondIsCore(data,id)),extraBanned=[...banned].filter(id=>!bondIsCore(data,id));
 const fixedBanned=[...banned].filter(id=>fixedSet.has(id)),randomBanned=[...banned].filter(id=>!fixedSet.has(id));
 const list=ids=>ids.length?`（${esc(ids.map(id=>bondName(data,id)).join('／'))}）`:'';
 const covenantLine=banned.size
  ?`${fixedBanned.length?`固定禁用 ${fixedBanned.length} 个${list(fixedBanned)} · `:''}随机禁用：核心 ${coreBanned.filter(id=>!fixedSet.has(id)).length} 个${list(randomBanned.filter(id=>bondIsCore(data,id)))} · 附加 ${extraBanned.filter(id=>!fixedSet.has(id)).length} 个${list(randomBanned.filter(id=>!bondIsCore(data,id)))}`
  :'本局没有被禁用的盟约。';
 // 分组顺序：核心在前、附加在后，组内按名字；被禁盟约即使没禁到人也列出来（说明该盟约下人人都有别的盟约兜底）。
 const groups=summary.bonds.slice().sort((a,b)=>Number(b.core)-Number(a.core)||String(a.name).localeCompare(String(b.name),'zh'));
 const card=op=>`<figure title="${esc(op.name)} · 所属盟约 ${esc(op.bonds.map(id=>bondName(data,id)).join('／'))}"><span class="native-ban-op-art">${avatar(op.charId)}</span><figcaption><b>${esc(op.name)}</b><small>${op.tier} 阶</small><em>${esc(op.bonds.map(id=>bondName(data,id)).join('／'))}</em></figcaption></figure>`;
 const group=b=>`<section class="native-ban-group" data-bond="${esc(b.id)}"><h3 class="native-ban-heading">${esc(b.name)} <small>${b.core?'核心':'附加'} · ${b.mode==='fixed'?'固定禁用':'随机禁用'} · 该盟约下禁用 ${b.members.length} / ${b.total} 人</small></h3>${b.members.length?`<div class="native-ban-operators">${b.members.map(card).join('')}</div>`:'<p class="native-ban-none">该盟约下没有被禁用的干员：成员都还挂着未缺席的盟约。</p>'}</section>`;
 return `<h2>本局禁用盟约与干员</h2><p class="native-ban-note">${covenantLine}</p><p class="native-ban-note">共 ${ops.length} 名干员无法使用：他们所属的盟约本局<b>全部缺席</b>（只要还有一个盟约没被禁就仍可使用）。同一名干员挂在多个缺席盟约下时，会在每组各列一次。</p>${groups.map(group).join('')||'<p class="native-ban-none">本局没有被禁用的盟约。</p>'}<p class="native-ban-foot">禁用方案可在协议自定义 →「禁用方案」页调整。</p><button data-act="close">关闭</button>`;
}
