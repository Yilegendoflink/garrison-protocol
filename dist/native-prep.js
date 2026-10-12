// 战前准备（大厅新入口）：全干员 / 全装备效果资料页 ＋ 干员默认技能设置。
//
// 用户 2026-09-22 口径：
//  * 大厅「资料与工具」里新增入口「战前准备」，点开是独立页面（`state.view='prepare'`）。
//  * 页面可以在「全干员」和「全装备效果」两个页签之间切换。
//  * 页面下方固定筛选栏：阶级 1–6 与「全部」按钮＋「核心盟约」「附加盟约」两个下拉框。
//  * 点选干员卡上的技能档位会立即保存为默认；**局内购买**时携带该技能。
//  * 打开时初始状态就是当前的默认配置（没有设置过覆盖的干员继续跟随档案自带档位）。
//
// 身份口径与盟约禁用一致：按 `charId` 归并（精锐与初始是同一名干员），所以一份设置对它全部形态生效；
// 名册（有哪些干员、什么阶级、挂哪些盟约）直接用 `native-bond-ban.bondRoster`，不再另算一套。
import {bondIsCore,bondName,bondRoster,bondIds} from './native-bond-ban.js';
import {richText,DIRECTION_NAMES} from './protocol.js';
import {renderSkillDescription} from './native-skill-text.js';
import {ARCHIVE_FLAG_DEFAULTS,loadArchive} from './native-archive.js';
import {dataForPrep,SEES_BOND_ID,TARTARUS_BOND_ID} from './native-sees.js';
import {customDataView,customChessId,loadCustomOperators,renderCustomOperators} from './native-custom-operators.js';

export const PREP_SKILL_KEY='garrison-prep-default-skill-v1';
// 配置版本：只认当前版本，读到别的版本（或没有版本号）一律当作「没设置过」，回落到档案自带档位。
export const PREP_SKILL_VERSION=1;
export const PREP_TIERS=Object.freeze([1,2,3,4,5,6]);
export const PREP_TABS=Object.freeze(['operator','equipment','custom']);

// ── 默认技能配置的读写 ───────────────────────────────────────────────────────
// 只存「玩家改过」的干员：`{charId: 档位}`。没有条目的干员继续跟随档案里的 skillIndex，
// 也就是「初始状态＝当前的默认配置」。
let rawCache={raw:null,map:null};
let normalizedCache={raw:null,data:null,map:null};
function storage(){
 try{return typeof localStorage==='undefined'?null:localStorage;}catch{return null;}
}
const prepSkillDataCache=new WeakMap();
function prepSkillData(data){
 if(!data)return data;
 data=customDataView(data,data.customSelection??loadCustomOperators(data));
 if(Object.values(data.season?.charShopChessDatas||{}).some(row=>row?.sees===true&&!row.isHidden))return data;
 const archive=loadArchive(storage());if(archive?.flags?.sees!==true)return data;
 if(prepSkillDataCache.has(data))return prepSkillDataCache.get(data);
 const page=dataForPrep(data,archive);prepSkillDataCache.set(data,page);return page;
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
 const index=prepOperatorIndex(prepSkillData(data)),source=raw&&typeof raw==='object'?(raw.skills&&typeof raw.skills==='object'?raw.skills:raw):{};
 const out={};
 for(const [charId,value] of Object.entries(source)){
  const registered=data.customOperators?.operators.some(o=>o.charId===charId);
  const row=index.get(charId)||(registered?{choices:(data.profiles[customChessId(data,charId,5)]?.skillChoices||[]).map((_,index)=>({index}))}:null);if(!row)continue;
  const i=Number(value);
  if(!Number.isInteger(i)||!row.choices.some(choice=>choice.index===i))continue;
  out[charId]=i;
 }
 return out;
}
export function loadPrepSkills(data){
 const raw=prepRawSkills(),roster=prepSkillData(data);
 if(normalizedCache.raw===rawCache.raw&&normalizedCache.data===roster&&normalizedCache.map)return normalizedCache.map;
 const map=normalizePrepSkills(raw,roster);
 normalizedCache={raw:rawCache.raw,data:roster,map};
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
  const choices=(profile.skillChoices||[]).map((choice,i)=>({index:i,name:choice.skill?.name||`技能 ${i+1}`,skill:choice.skill||null}));
  return {
   charId:row.charId,name:row.name,chessId:row.chessIds[0]||null,tier:row.tier,bonds:row.bonds.slice(),
   choices,rangeId:profile.rangeId||null,
   archive:Number.isInteger(profile.skillIndex)?profile.skillIndex:(choices.length?0:null),
  };
 });
 return rows;
}
export function prepOperatorRows(data){
 const roster=prepSkillData(data);
 if(roster&&operatorCache.has(roster))return operatorCache.get(roster);
 const rows=buildOperatorRows(roster);
 if(roster)operatorCache.set(roster,rows);
 return rows;
}
const indexCache=new WeakMap();
export function prepOperatorIndex(data){
 const roster=prepSkillData(data);
 if(roster&&indexCache.has(roster))return indexCache.get(roster);
 const map=new Map(prepOperatorRows(roster).map(row=>[row.charId,row]));
 if(roster)indexCache.set(roster,map);
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
   id:item.id,name:item.name||item.normal?.effectName||item.id,tier:Number(item.rank)||1,asset:data.assets?.[item.id]||null,
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
export function renderPrepSkillInfo(data,charId,index,custom=false,esc=value=>String(value??'')){
 const row=prepOperatorRow(data,charId),choice=row?.choices.find(entry=>entry.index===Number(index));
 if(!row||!choice)return '<section class="native-prep-current-skill"><b>无主动技能档位</b><p>当前干员没有可选的默认技能。</p></section>';
 const skill=choice.skill||{},description=renderSkillDescription(skill)||'暂无技能效果说明。',sp=skill.spData||{},rangeId=skill.rangeId||row.rangeId;
 const meta=[rangeId?`范围 ${rangeId}`:null,sp.initSp!=null||sp.spCost!=null?`技力 ${sp.initSp??'—'} / ${sp.spCost??'—'}`:null,skill.duration!=null?`持续 ${skill.duration} 秒`:null].filter(Boolean);
 return `<section class="native-prep-current-skill" aria-live="polite"><div class="native-prep-current-skill-head"><b>S${choice.index+1} · ${esc(choice.name)}</b><small>${custom?'自定义默认':'跟随档案默认'}</small></div><p title="${esc(description)}">${esc(description)}</p>${meta.length?`<small class="native-prep-current-skill-meta">${meta.map(esc).join(' · ')}</small>`:''}</section>`;
}
function operatorCard(data,row,skills,esc,avatar){
 const override=skills[row.charId],current=override??row.archive;
 const custom=override!=null;
 return `<article class="native-prep-card${custom?' is-custom':''}" data-char="${esc(row.charId)}">
<div class="native-prep-art">${avatar(row.charId)}</div>
<div class="native-prep-body">
<div class="native-prep-title"><b>${esc(row.name)}</b><small>${row.tier} 阶</small></div>
<div class="native-prep-bonds">${row.bonds.map(id=>bondChip(data,id,esc,bondIsCore(data,id)?' core':'')).join('')||'<span class="native-prep-bond none">无盟约</span>'}</div>
${renderPrepSkillInfo(data,row.charId,current,custom,esc)}
<div class="native-prep-skill">${row.choices.length?`<div class="native-prep-skill-options" role="group" aria-label="${esc(row.name)} 默认技能">${row.choices.map(choice=>`<button data-act="prep-skill" data-char="${esc(row.charId)}" data-index="${choice.index}" class="${current===choice.index?'chosen':''}" aria-pressed="${current===choice.index}" aria-label="${esc(row.name)} 默认设为 S${choice.index+1} ${esc(choice.name)}" title="设为默认：S${choice.index+1} · ${esc(choice.name)}">S${choice.index+1}</button>`).join('')}</div>`:'<span class="native-prep-no-skill">无主动技能档位</span>'}</div>
</div>
</article>`;
}
function equipmentCard(data,item,esc){
 // 基础与精锐两种形态的效果文案都要列（精锐是基础装备三合一后的形态，数值通常不一样）。
 const form=(label,entry)=>entry?`<p><b class="native-prep-form">${label}</b><span>${esc(entry.desc)}</span></p>`:'';
 const body=form('基础',item.base)+form('精锐',item.elite),icon=item.asset?`<img class="native-prep-item-icon" src="./${esc(item.asset)}" alt="">`:'<span class="native-prep-item-icon native-prep-item-icon-empty" aria-hidden="true"></span>';
 return `<article class="native-prep-card native-prep-item" data-item="${esc(item.id)}">
<div class="native-prep-body">
<div class="native-prep-title">${icon}<b>${esc(item.name)}</b><small>${item.tier} 阶</small></div>
<div class="native-prep-bonds">${item.bond?bondChip(data,item.bond,esc,''):'<span class="native-prep-bond none">无盟约归属</span>'}</div>
${body}
</div>
</article>`;
}
// 主菜单的「战绩与解锁」浮窗；未解锁的彩蛋不显示名称。
export function renderArchiveWindow(archive,esc=value=>String(value??'')){
 const flags={...ARCHIVE_FLAG_DEFAULTS,...(archive?.flags||{})},runs=archive?.runs||[];
 const unlocks=[flags.sees?'策略：S.E.E.S.':null,flags.egg325?'325 模式':null,flags.cat?'海猫模式':null].filter(Boolean);
 return `<div class="native-archive-window">
<header class="native-archive-head"><div><h2>战绩与解锁</h2><p>本地保存最近十场对局与已解锁内容；导出存档可迁移到其他浏览器。</p></div><div class="native-archive-counter"><b>${runs.length}</b><span>/ 10</span><small>最近对局</small></div></header>
<section class="native-archive-unlocks"><div class="native-archive-section-head"><h3>已解锁内容</h3><small>${unlocks.length} 项</small></div>
${unlocks.length?`<div class="native-archive-unlock-grid">${unlocks.map(name=>`<div class="native-archive-unlock"><span class="native-archive-unlock-dot"></span><b>${esc(name)}</b><small>已解锁</small></div>`).join('')}</div>`:'<p class="native-archive-empty-unlocks">暂无可查看的解锁内容</p>'}
${flags.sees?'<button data-act="prep-flags-sees" class="native-archive-toggle" aria-pressed="true">隐藏 S.E.E.S. 内容</button>':''}
</section>
<section class="native-archive-runs"><div class="native-archive-section-head"><h3>最近对局</h3><small>${runs.length} / 10</small></div>
${runs.length?`<div class="native-archive-run-list">${runs.map((run,index)=>runCard(run,index+1,esc,flags.sees)).join('')}</div>`:'<p class="native-prep-empty">尚无对局记录。完成一局后会自动归档。</p>'}
</section>
</div>`;
}
function runCard(run,index,esc,showSees=false){
 const types=(run.types||[]).map(t=>esc(t.name)).join(' · ')||'—';
 const visibleBond=id=>showSees||id!==SEES_BOND_ID&&id!==TARTARUS_BOND_ID;
 const bonds=(run.finalBonds||[]).filter(b=>visibleBond(b.id)).map(b=>`${esc(b.name)} ×${b.count}${b.active?'':'(未激活)'}`).join('、')||'无';
 const bondLayers=(run.finalBondLayers||[]).filter(b=>visibleBond(b.id)).map(b=>`${esc(b.name)} ${b.layers}层`).join('、')||'旧记录未保存';
 const banned=(run.bannedBonds||[]).map(b=>esc(b.name)).join('、')||'无';
 const lineup=(run.finalLineup||[]).map(u=>`<li><b>${esc(u.name)}</b>${u.isGolden?' · 精锐':''} <small>${esc(u.chessId)}</small><span>（${u.x},${u.y}）朝向${esc(DIRECTION_NAMES?.[u.dir]??u.dir)}${u.skillName?' · '+esc(u.skillName):''}${u.damage?` · 输出 ${Math.round(u.damage).toLocaleString()}`:''}${(u.equipment||[]).length?' · 装备 '+u.equipment.map(e=>esc(e.name)).join('／'):''}</span></li>`).join('')||'<li>场上没有干员</li>';
 return `<details class="native-prep-run">
<summary><b>#${index}</b> <span>${esc(run.atText||'')}</span> <em>${esc(run.mapId)}</em> <i>存活 ${run.waves} 波</i> <i class="${run.cleared?'ok':'bad'}">${run.cleared?'通关':'未通关'}</i> <i>最终轮输出 ${Math.round(run.finalDamage).toLocaleString()}</i></summary>
<div class="native-prep-run-body">
<p><span>词条</span>${types}</p>
<p><span>地图</span>${esc(run.mapId)}</p>
<p><span>存活波数</span>${run.waves} 波（共打 ${run.battles??run.waves} 场 · 停在第 ${run.round} 回合 · 剩余生命 ${run.hp} / ${run.maxHp}）</p>
<p><span>是否通关</span>${run.cleared?'通关':'未通关'}${run.finalRound?'（打到最终轮）':''}</p>
<p><span>最终轮输出</span>${Math.round(run.finalDamage).toLocaleString()}${run.finalElapsed?` · ${run.finalElapsed.toFixed(2)} 秒`:''}${run.finalDps?` · DPS ${run.finalDps.toFixed(2)}`:''}${run.finalKills||run.finalLeaks?` · 击倒 ${run.finalKills} · 漏失 ${run.finalLeaks}`:''}</p>
<p><span>最终轮盟约情况</span>${bonds}</p>
<p><span>盟约最终层数</span>${bondLayers}</p>
<p><span>本局缺席盟约</span>${banned}</p>
<p><span>最终轮场上阵容</span></p><ul class="native-prep-run-lineup">${lineup}</ul>
</div></details>`;
}
export function renderPreparePage(data,prep={},ui={}){
 const esc=ui.esc||(value=>String(value??'')),avatar=ui.avatar||(()=>'');
 // 档案由页面自己读（调用方也可以显式传 `ui.archive`，单测就是走这条），这样战前准备的调用签名不用变。
 const archive=ui.archive||loadArchive(storage());
 // S.E.E.S.（用户 2026-09-27 口径）：解锁标记为真时，四名联动干员与「S.E.E.S.臂章」才进这份名册／装备表；
 // 没解锁时它们在数据里仍是隐藏档，页面与改动前完全一致——dataForPrep 就是这一处开关。
 const page=customDataView(dataForPrep(data,archive),loadCustomOperators(data));
 if(prep.tab==='custom')return `<main class="native-lobby native-prep"><header class="native-prep-top"><button data-act="home">‹ 大厅</button><h1>战前准备</h1></header><div class="native-prep-tabs"><button data-act="prep-tab" data-tab="operator">干员</button><button data-act="prep-tab" data-tab="equipment">装备</button><button data-act="prep-tab" data-tab="custom" class="chosen">自选干员</button></div>${renderCustomOperators(data,loadCustomOperators(data),{esc,avatar,skills:prep.skills||loadPrepSkills(data)})}</main>`;
 const catalog=prepCatalog(page),tab=PREP_TABS.includes(prep.tab)?prep.tab:'operator';
 const skills=prep.skills||{},filters={tier:prep.tier,core:prep.core,extra:prep.extra};
 const operators=filterPrepOperators(catalog.operators,filters),equipment=filterPrepEquipment(catalog.equipment,filters);
 const list=tab==='operator'?operators:equipment,total=tab==='operator'?catalog.operators.length:catalog.equipment.length;
 const bondSelect=(id,label,options,value)=>`<label class="native-prep-field">${label}<select id="${id}"><option value="">全部${label}</option>${options.map(option=>`<option value="${esc(option.id)}" ${option.id===value?'selected':''}>${esc(option.name)}</option>`).join('')}</select></label>`;
 return `<main class="native-lobby native-prep">
<header class="native-prep-top"><button data-act="home">‹ 大厅</button><div><h1>战前准备</h1></div><span class="native-prep-count">${total} 条资料</span></header>
<section class="native-prep-heading"><div><h2>${tab==='operator'?'干员名册':'装备资料'}</h2><p>${tab==='operator'?'切换 S 档可查看当前默认技能说明，也可设为新局默认。':'横向浏览基础与精锐形态效果，使用下方筛选栏定位装备。'}</p></div><div class="native-prep-live-count"><b>${list.length}</b><span>/ ${total} 条目</span></div></section>
<div class="native-prep-tabs">
<button data-act="prep-tab" data-tab="operator" class="${tab==='operator'?'chosen':''}" aria-pressed="${tab==='operator'}">干员 <small>${catalog.operators.length}</small></button>
<button data-act="prep-tab" data-tab="equipment" class="${tab==='equipment'?'chosen':''}" aria-pressed="${tab==='equipment'}">装备 <small>${catalog.equipment.length}</small></button>
<button data-act="prep-tab" data-tab="custom" aria-pressed="false">自选干员</button>
</div>
<div class="native-prep-list" id="prep-list" role="region" tabindex="0" aria-label="${tab==='operator'?'干员名册，横向滚动浏览':'装备资料，横向滚动浏览'}">${list.length?(tab==='operator'?list.map(row=>operatorCard(page,row,skills,esc,avatar)).join(''):list.map(item=>equipmentCard(page,item,esc)).join('')):'<p class="native-prep-empty">没有符合当前筛选条件的条目。</p>'}</div>
<section class="native-prep-filters" aria-label="战前资料筛选">
<div class="native-prep-filter-main"><div class="native-prep-tier-row"><span>阶级</span>${PREP_TIERS.map(tier=>`<button data-act="prep-tier" data-tier="${tier}" class="${Number(prep.tier)===tier?'chosen':''}" aria-pressed="${Number(prep.tier)===tier}">${tier}</button>`).join('')}<button data-act="prep-tier" data-tier="0" class="native-prep-tier-all ${Number(prep.tier)===0?'chosen':''}" aria-pressed="${Number(prep.tier)===0}">全部</button></div>
<div class="native-prep-bond-row">${bondSelect('prep-core','核心盟约',catalog.bonds.core,prep.core||'')}${bondSelect('prep-extra','附加盟约',catalog.bonds.extra,prep.extra||'')}</div></div>
<div class="native-prep-actions"><span id="prep-visible">显示 ${list.length} / ${total}</span>${tab==='operator'?'<button data-act="prep-reset-all" title="所有干员恢复各自档案中的默认技能">全体恢复档案默认</button>':''}</div>
</section>
</main>`;
}
