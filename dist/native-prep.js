// 战前准备（大厅新入口）：全干员 / 全装备效果资料页 ＋ 干员默认技能设置。
//
// 用户 2026-09-22 口径：
//  * 大厅「资料与工具」里新增入口「战前准备」，点开是独立页面（`state.view='prepare'`）。
//  * 页面可以在「全干员」和「全装备效果」两个页签之间切换。
//  * 页面下方是筛选条：阶级 1–6 六个数字选项（再点一次取消筛选）＋「核心盟约」「附加盟约」两个下拉框。
//  * 页面上能直接改干员的**默认技能**；保存后**局内购买**该干员时默认携带指定技能。
//  * 打开时初始状态就是当前的默认配置（没有设置过覆盖的干员继续跟随档案自带档位）。
//
// 身份口径与盟约禁用一致：按 `charId` 归并（精锐与初始是同一名干员），所以一份设置对它全部形态生效；
// 名册（有哪些干员、什么阶级、挂哪些盟约）直接用 `native-bond-ban.bondRoster`，不再另算一套。
import {bondIsCore,bondName,bondRoster,bondIds} from './native-bond-ban.js';
import {richText} from './protocol.js';

export const PREP_SKILL_KEY='garrison-prep-default-skill-v1';
// 配置版本：只认当前版本，读到别的版本（或没有版本号）一律当作「没设置过」，回落到档案自带档位。
export const PREP_SKILL_VERSION=1;
export const PREP_TIERS=Object.freeze([1,2,3,4,5,6]);
export const PREP_TABS=Object.freeze(['operator','equipment']);

// ── 默认技能配置的读写 ───────────────────────────────────────────────────────
// 只存「玩家改过」的干员：`{charId: 档位}`。没有条目的干员继续跟随档案里的 skillIndex，
// 也就是「初始状态＝当前的默认配置」。
let rawCache={raw:null,map:null};
let normalizedCache={raw:null,data:null,map:null};
function storage(){
 try{return typeof localStorage==='undefined'?null:localStorage;}catch{return null;}
}
// localStorage 里的原始覆盖表（不校验干员是否还存在、档位是否存在）。
function prepRawSkills(){
 const store=storage(),raw=store?store.getItem(PREP_SKILL_KEY)||'':'';
 if(raw===rawCache.raw&&rawCache.map)return rawCache.map;
 const map={};
 try{
  const parsed=JSON.parse(raw||'null');
  const skills=parsed&&parsed.version===PREP_SKILL_VERSION&&parsed.skills&&typeof parsed.skills==='object'?parsed.skills:null;
  if(skills)for(const [charId,index] of Object.entries(skills)){
   const i=Number(index);
   if(charId&&Number.isInteger(i)&&i>=0)map[charId]=i;
  }
 }catch{}
 rawCache={raw,map};
 return map;
}
// 按当前数据校验：干员必须还在名册里、档位必须是这名干员真有的技能档；不合法的条目直接丢掉。
// 名册与档位数会随数据更新变化，校验放在这里就能避免配置把不存在的档位写进局内。
export function normalizePrepSkills(raw,data){
 const index=prepOperatorIndex(data),source=raw&&typeof raw==='object'?(raw.skills&&typeof raw.skills==='object'?raw.skills:raw):{};
 const out={};
 for(const [charId,value] of Object.entries(source)){
  const row=index.get(charId);if(!row)continue;
  const i=Number(value);
  if(!Number.isInteger(i)||!row.choices.some(choice=>choice.index===i))continue;
  out[charId]=i;
 }
 return out;
}
export function loadPrepSkills(data){
 const raw=prepRawSkills();
 if(normalizedCache.raw===rawCache.raw&&normalizedCache.data===data&&normalizedCache.map)return normalizedCache.map;
 const map=normalizePrepSkills(raw,data);
 normalizedCache={raw:rawCache.raw,data,map};
 return map;
}
export function savePrepSkills(skills,data){
 const next=normalizePrepSkills(skills,data),store=storage();
 try{if(store)store.setItem(PREP_SKILL_KEY,JSON.stringify({version:PREP_SKILL_VERSION,skills:next}));}catch{}
 rawCache={raw:null,map:null};normalizedCache={raw:null,data:null,map:null};
 return next;
}
export function clearPrepSkills(){
 const store=storage();
 try{if(store)store.removeItem(PREP_SKILL_KEY);}catch{}
 rawCache={raw:null,map:null};normalizedCache={raw:null,data:null,map:null};
}
// 草稿里有几项和已保存的配置不一样（含「把覆盖删掉」这种改动），界面上用它提示未保存。
export function prepDirtyCount(draft,saved){
 const a=draft||{},b=saved||{},keys=new Set([...Object.keys(a),...Object.keys(b)]);
 let n=0;
 for(const key of keys)if(Number(a[key]??NaN)!==Number(b[key]??NaN)||(key in a)!==(key in b))n++;
 return n;
}

// ── 名册：干员 / 装备 / 盟约 ────────────────────────────────────────────────
// 干员档位与档案默认档都取**初始形态**的档案（`row.chessIds[0]`）：商店卖的是初始形态，
// 精锐形态的档位数与它逐名一致（构建期门禁见 tests/native-prep.test.mjs）。
const operatorCache=new WeakMap();
function buildOperatorRows(data){
 const rows=bondRoster(data).map(row=>{
  const profile=data.profiles?.[row.chessIds[0]]||{};
  const choices=(profile.skillChoices||[]).map((choice,i)=>({index:i,name:choice.skill?.name||`技能 ${i+1}`}));
  return {
   charId:row.charId,name:row.name,chessId:row.chessIds[0]||null,tier:row.tier,bonds:row.bonds.slice(),
   choices,
   archive:Number.isInteger(profile.skillIndex)?profile.skillIndex:(choices.length?0:null),
  };
 });
 return rows;
}
export function prepOperatorRows(data){
 if(data&&operatorCache.has(data))return operatorCache.get(data);
 const rows=buildOperatorRows(data);
 if(data)operatorCache.set(data,rows);
 return rows;
}
const indexCache=new WeakMap();
export function prepOperatorIndex(data){
 if(data&&indexCache.has(data))return indexCache.get(data);
 const map=new Map(prepOperatorRows(data).map(row=>[row.charId,row]));
 if(data)indexCache.set(data,map);
 return map;
}
export function prepOperatorRow(data,charId){return prepOperatorIndex(data).get(charId)||null;}
// 装备：`data.items` 里未隐藏的条目（本期 56 件，另有 3 件隐藏的悬赏道具不属于商店装备）。
// 每件装备分基础／精锐两个形态，各自的效果文案取原表 `effectInfoDataDict[effectId].effectDesc`。
const equipmentCache=new WeakMap();
export function prepEquipmentRows(data){
 if(data&&equipmentCache.has(data))return equipmentCache.get(data);
 const info=data?.season?.effectInfoDataDict||{};
 const rows=[];
 for(const item of Object.values(data?.items||{})){
  if(!item||item.hidden)continue;
  const form=name=>{
   const id=item[name]?.effectId,desc=id?info[id]?.effectDesc:null;
   return desc?{desc:richText(desc)}:null;
  };
  const base=form('normal'),elite=form('elite');
  if(!base&&!elite)continue;
  rows.push({
   id:item.id,name:item.name||item.normal?.effectName||item.id,tier:Number(item.rank)||1,
   bond:item.normal?.giveBondId||'',base,elite,
  });
 }
 rows.sort((a,b)=>a.tier-b.tier||String(a.name).localeCompare(String(b.name),'zh-CN'));
 if(data)equipmentCache.set(data,rows);
 return rows;
}
// 盟约下拉：核心（`isPower`）与附加两栏，名字取原表。
export function prepBondOptions(data){
 const core=[],extra=[];
 for(const id of bondIds(data)){(bondIsCore(data,id)?core:extra).push({id,name:bondName(data,id)});}
 const byName=(a,b)=>String(a.name).localeCompare(String(b.name),'zh-CN');
 return {core:core.sort(byName),extra:extra.sort(byName)};
}
export function prepCatalog(data){
 return {operators:prepOperatorRows(data),equipment:prepEquipmentRows(data),bonds:prepBondOptions(data)};
}

// ── 筛选 ────────────────────────────────────────────────────────────────────
// 两个盟约下拉是「同时满足」的收窄条件（选了核心又选附加＝两者都要有）；空值＝不筛。
export function filterPrepOperators(rows,filters={}){
 const tier=Number(filters.tier)||0,core=filters.core||'',extra=filters.extra||'';
 return rows.filter(row=>(!tier||row.tier===tier)&&(!core||row.bonds.includes(core))&&(!extra||row.bonds.includes(extra)));
}
export function filterPrepEquipment(rows,filters={}){
 const tier=Number(filters.tier)||0,core=filters.core||'',extra=filters.extra||'';
 return rows.filter(row=>(!tier||row.tier===tier)&&(!core||row.bond===core)&&(!extra||row.bond===extra));
}

// ── 局内接线：购买时默认携带指定技能 ────────────────────────────────────────
// 同一名干员的全部副本必须共用一个技能（用户 2026-09-22 口径，见 native-session 的 `skill` 命令），
// 所以新拿到一张时按这个顺序取值：
//   1. 本局已经存在的同 charId 副本里显式写下的档位（局内改过技能就以那个为准，别被配置打断）；
//   2. 玩家在「战前准备」里配置的默认技能；
//   3. 都没有就保持 `undefined`（＝跟随档案自带档位，和以前完全一致）。
// 不写值是最保守的分支，所以「没配置过任何东西」时本函数什么都不改。
export function applyPrepSkills(data,units){
 const groups=new Map();
 for(const unit of units||[]){
  if(!unit?.charId)continue;
  const list=groups.get(unit.charId);
  if(list)list.push(unit);else groups.set(unit.charId,[unit]);
 }
 const configured=loadPrepSkills(data);
 for(const [charId,list] of groups){
  const explicit=list.find(unit=>unit.skillIndex!=null);
  const index=explicit?explicit.skillIndex:configured[charId];
  if(index==null)continue;
  for(const unit of list)if(data.profiles?.[unit.chessId]?.skillChoices?.[index])unit.skillIndex=index;
 }
 return units;
}

// ── 页面渲染 ────────────────────────────────────────────────────────────────
// HTML 放在这里而不是 native-play 里，是为了能在 Node 里直接断言渲染结果（和盟约禁用那两段同思路）：
// UI 工具函数由调用方注入——`{esc, avatar}`。
function bondChip(data,id,esc,cls=''){
 return `<span class="native-prep-bond${cls}">${esc(bondName(data,id))}</span>`;
}
function operatorCard(data,row,skills,esc,avatar){
 const override=skills[row.charId],current=override??row.archive;
 const custom=override!=null;
 const archiveName=row.choices.find(choice=>choice.index===row.archive)?.name||'无主动技能';
 const options=[`<option value="" ${custom?'':'selected'}>跟随档案默认（${esc(archiveName)}）</option>`]
  .concat(row.choices.map(choice=>`<option value="${choice.index}" ${custom&&override===choice.index?'selected':''}>S${choice.index+1} · ${esc(choice.name)}</option>`));
 return `<article class="native-prep-card${custom?' is-custom':''}" data-char="${esc(row.charId)}">
<div class="native-prep-art">${avatar(row.charId)}</div>
<div class="native-prep-body">
<div class="native-prep-title"><b>${esc(row.name)}</b><small>${row.tier} 阶</small></div>
<div class="native-prep-bonds">${row.bonds.map(id=>bondChip(data,id,esc,bondIsCore(data,id)?' core':'')).join('')||'<span class="native-prep-bond none">无盟约</span>'}</div>
<label class="native-prep-skill">默认技能<select data-act="prep-skill" data-char="${esc(row.charId)}">${options.join('')}</select></label>
<small class="native-prep-note">${custom?`已设为 S${override+1} · ${esc(row.choices.find(choice=>choice.index===override)?.name||'')}`:`跟随档案默认 S${(row.archive??0)+1}`}</small>
</div>
</article>`;
}
function equipmentCard(data,item,esc){
 // 基础与精锐两种形态的效果文案都要列（精锐是基础装备三合一后的形态，数值通常不一样）。
 const form=(label,entry)=>entry?`<p><b class="native-prep-form">${label}</b><span>${esc(entry.desc)}</span></p>`:'';
 const body=form('基础',item.base)+form('精锐',item.elite);
 return `<article class="native-prep-card native-prep-item" data-item="${esc(item.id)}">
<div class="native-prep-body">
<div class="native-prep-title"><b>${esc(item.name)}</b><small>${item.tier} 阶</small></div>
<div class="native-prep-bonds">${item.bond?bondChip(data,item.bond,esc,''):'<span class="native-prep-bond none">无盟约归属</span>'}</div>
${body}
</div>
</article>`;
}
export function renderPreparePage(data,prep={},ui={}){
 const esc=ui.esc||(value=>String(value??'')),avatar=ui.avatar||(()=>'');
 const catalog=prepCatalog(data),tab=PREP_TABS.includes(prep.tab)?prep.tab:'operator';
 const skills=prep.skills||{},filters={tier:prep.tier,core:prep.core,extra:prep.extra};
 const operators=filterPrepOperators(catalog.operators,filters),equipment=filterPrepEquipment(catalog.equipment,filters);
 const dirty=prepDirtyCount(skills,prep.saved||{});
 const list=tab==='operator'?operators:equipment,total=tab==='operator'?catalog.operators.length:catalog.equipment.length;
 const bondSelect=(id,label,options,value)=>`<label class="native-prep-field">${label}<select id="${id}"><option value="">全部${label}</option>${options.map(option=>`<option value="${esc(option.id)}" ${option.id===value?'selected':''}>${esc(option.name)}</option>`).join('')}</select></label>`;
 return `<main class="native-lobby native-prep">
<header class="native-prep-top"><button data-act="home">‹ 大厅</button><div><span class="native-eyebrow">PREPARATION / REFERENCE</span><h1>战前准备</h1></div><span class="native-prep-count">${total} 条资料</span></header>
<p class="native-prep-lead">查看全部干员与装备效果，并在这里设置干员的默认技能。保存后，<b>新一局购买该干员时会默认携带指定技能</b>；没有设置的干员继续跟随档案自带档位（也就是现在的默认配置）。</p>
<div class="native-prep-tabs">
<button data-act="prep-tab" data-tab="operator" class="${tab==='operator'?'chosen':''}">全干员 <small>${catalog.operators.length}</small></button>
<button data-act="prep-tab" data-tab="equipment" class="${tab==='equipment'?'chosen':''}">全装备效果 <small>${catalog.equipment.length}</small></button>
</div>
<div class="native-prep-list" id="prep-list">${list.length?(tab==='operator'?list.map(row=>operatorCard(data,row,skills,esc,avatar)).join(''):list.map(item=>equipmentCard(data,item,esc)).join('')):'<p class="native-prep-empty">没有符合当前筛选条件的条目。</p>'}</div>
<section class="native-prep-filters">
<div class="native-prep-tier-row"><span>阶级</span>${PREP_TIERS.map(tier=>`<button data-act="prep-tier" data-tier="${tier}" class="${Number(prep.tier)===tier?'chosen':''}" aria-pressed="${Number(prep.tier)===tier}">${tier}</button>`).join('')}<small>再点一次取消阶级筛选</small></div>
<div class="native-prep-bond-row">${bondSelect('prep-core','核心盟约',catalog.bonds.core,prep.core||'')}${bondSelect('prep-extra','附加盟约',catalog.bonds.extra,prep.extra||'')}</div>
<div class="native-prep-actions"><span id="prep-visible">显示 ${list.length} / ${total}</span><span id="prep-dirty" class="${dirty?'is-dirty':''}">${dirty?`未保存的改动 ${dirty} 项`:'与已保存配置一致'}</span><button data-act="prep-clear">全部改为档案默认</button><button class="native-primary" data-act="prep-save">保存默认技能</button></div>
</section>
</main>`;
}
