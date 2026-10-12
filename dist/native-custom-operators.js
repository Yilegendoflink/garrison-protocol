// 自选配置与本局名册视图：不依赖 session/battle/play，不修改共享运行数据。
import {richText} from './protocol.js';
import {renderSkillDescription} from './native-skill-text.js';
export const CUSTOM_OPERATOR_KEY='garrison-custom-operators-v1';
export function customChessId(data,charId,tier,elite=false){const op=data.customOperators?.operators.find(o=>o.charId===charId);return op?`chess_custom_${op.key}_${tier}_${elite?'b':'a'}`:null;}
export function normalizeCustomOperators(raw,data){
 if(raw==null)return {version:1,slots:[null,null]};
 if(raw.version!==1||!Array.isArray(raw.slots)||raw.slots.length>2)throw Error('自选配置格式无效');
 const ids=new Set(),slots=[null,null];
 for(let i=0;i<raw.slots.length;i++){const row=raw.slots[i];if(row==null)continue;if(!row||![5,6].includes(row.tier)||!data.customOperators?.operators.some(o=>o.charId===row.charId)||ids.has(row.charId))throw Error('自选干员或阶级无效');ids.add(row.charId);slots[i]={charId:row.charId,tier:row.tier};}
 return {version:1,slots};
}
function customStorage(){try{return typeof localStorage==='undefined'?null:localStorage;}catch{return null;}}
export function loadCustomOperators(data){try{return normalizeCustomOperators(JSON.parse(customStorage()?.getItem(CUSTOM_OPERATOR_KEY)||'null'),data);}catch{return normalizeCustomOperators(null,data);}}
export function saveCustomOperators(raw,data){const config=normalizeCustomOperators(raw,data);try{customStorage()?.setItem(CUSTOM_OPERATOR_KEY,JSON.stringify(config));}catch{}return config;}
export function customDataView(data,raw){
 const config=normalizeCustomOperators(raw,data),selected=new Set(config.slots.filter(Boolean).map(row=>customChessId(data,row.charId,row.tier)));
 if(!selected.size&&!Object.values(data.season.charShopChessDatas).some(row=>row.custom&&!row.isHidden))return data;
 const shops=Object.fromEntries(Object.entries(data.season.charShopChessDatas).map(([id,row])=>[id,row.custom?{...row,isHidden:!selected.has(id)}:row]));
 return {...data,season:{...data.season,charShopChessDatas:shops},customSelection:config};
}
export function customAllowed(data,chessId){const normal=data.season.chessNormalIdLookupDict[chessId]||chessId;const row=data.season.charShopChessDatas[normal];return !row?.custom||!row.isHidden;}
export const CUSTOM_PROFESSIONS=Object.freeze({PIONEER:'先锋',WARRIOR:'近卫',TANK:'重装',SNIPER:'狙击',CASTER:'术师',MEDIC:'医疗',SUPPORT:'辅助',SPECIAL:'特种'});
const customProfile=(data,op,tier=5)=>data.profiles[customChessId(data,op.charId,tier)];
export function filterCustomOperators(data,{query='',profession=''}={}){
 const words=String(query).trim().toLowerCase().split(/\s+/).filter(Boolean);
 return (data.customOperators?.operators||[]).filter(op=>{const p=customProfile(data,op);if(!p||profession&&p.profession!==profession)return false;const text=[op.name,op.charId,...(op.aliases||[]),CUSTOM_PROFESSIONS[p.profession],...op.bondIds.map(id=>data.season.bondInfoDict[id]?.name)].join(' ').toLowerCase();return words.every(word=>text.includes(word));});
}
function customBonds(data,op,esc){
 const rows=op.bondIds.map(id=>data.season.bondInfoDict[id]).filter(Boolean);
 return `<details class="native-custom-bonds"><summary>所属盟约 ${rows.map(row=>`<span>${esc(row.name)}</span>`).join('')||'无'}</summary><div>${rows.map(row=>`<b>${esc(row.name)}${row.bondId==='emptyShip'?' · 无核心阵营':''}</b><p>${esc(richText(row.desc||''))}</p>`).join('')}</div></details>`;
}
function customSkills(data,op,tier,skills,esc){
 const p=customProfile(data,op,tier),elite=data.profiles[customChessId(data,op.charId,tier,true)],index=skills[op.charId]??p.skillIndex??0,choice=p.skillChoices[index]?.skill;
 return `<div class="native-custom-skills"><span>默认技能</span><div class="native-custom-skill-options" role="group" aria-label="${esc(op.name)}默认技能">${p.skillChoices.map((entry,i)=>`<button data-act="custom-skill" data-char="${op.charId}" data-index="${i}" class="${index===i?'chosen':''}" aria-pressed="${index===i}" title="${esc(entry.skill.name)}"><b>S${i+1}</b><span>${esc(entry.skill.name)}</span></button>`).join('')}</div><details class="native-custom-skill-info"><summary>S${index+1} · ${esc(choice?.name||'')} <small>查看技能效果</small></summary><b>初始 · 技能 ${p.status.skillLevel} 级</b><p>${esc(renderSkillDescription(choice)||'暂无技能效果说明。')}</p><b>精锐 · 技能 ${elite.status.skillLevel} 级</b><p>${esc(renderSkillDescription(elite.skillChoices[index]?.skill)||'暂无技能效果说明。')}</p></details></div>`;
}
function customIdentity(data,op,tier,avatar,esc){return `<div class="native-custom-identity">${avatar(op.charId)}<div><b>${esc(op.name)}</b><small>${esc(CUSTOM_PROFESSIONS[customProfile(data,op,tier).profession]||'')}</small></div></div>`;}
export function renderCustomOperators(data,raw,{esc,avatar,skills={}}){
 const config=normalizeCustomOperators(raw,data),ops=data.customOperators?.operators||[],attributes=p=>`生命 ${Math.round(p.attributes.maxHp)} · 攻击 ${Math.round(p.attributes.atk)} · 防御 ${Math.round(p.attributes.def)}`;
 return `<section class="native-custom-config"><header class="native-custom-heading"><div><span class="native-eyebrow">CUSTOM OPERATORS</span><h2>自选干员</h2><p>最多两名，独立选择五阶或六阶。没有自带卫戍特质。</p></div><span class="native-custom-count">${config.slots.filter(Boolean).length} / 2</span></header><div class="native-custom-slots">${config.slots.map((row,slot)=>{const op=ops.find(o=>o.charId===row?.charId),normal=op&&customProfile(data,op,row.tier),elite=op&&data.profiles[customChessId(data,op.charId,row.tier,true)];return `<article class="native-custom-slot"><header><b>自选位置 ${slot+1}</b>${op?`<button data-act="custom-clear" data-slot="${slot}" aria-label="移除位置 ${slot+1} 的${esc(op.name)}">移除</button>`:''}</header>${op?`${customIdentity(data,op,row.tier,avatar,esc)}${customBonds(data,op,esc)}`:'<div class="native-custom-empty"><span aria-hidden="true">＋</span><p>尚未选择干员</p></div>'}<button data-act="custom-picker" data-slot="${slot}" class="native-custom-open" aria-haspopup="dialog">${op?'更换干员':'选择干员'}</button><div class="native-custom-tiers" role="group" aria-label="自选位置 ${slot+1} 阶级">${[5,6].map(tier=>`<button data-act="custom-tier" data-slot="${slot}" data-tier="${tier}" ${!row?'disabled':''} aria-pressed="${row?.tier===tier}" class="${row?.tier===tier?'chosen':''}">${tier} 阶</button>`).join('')}</div>${op?`<div class="native-custom-attributes"><p><b>初始</b> ${attributes(normal)}</p><p><b>精锐</b> ${attributes(elite)}</p><small>技能 4 → 7 级 · 模组 ${elite.moduleId?elite.status.equipLevel+' 级':'无'}</small></div>${customSkills(data,op,row.tier,skills,esc)}`:''}</article>`;}).join('')}</div></section>`;
}
export function renderCustomPickerResults(data,raw,picker,{esc,avatar,skills={}}){
 const config=normalizeCustomOperators(raw,data),slot=picker.slot,tier=config.slots[slot]?.tier||5,ops=filterCustomOperators(data,picker);
 if(!ops.length)return '<p class="native-custom-no-results" role="status">没有符合条件的干员，请修改搜索内容或职业筛选。</p>';
 return ops.map(op=>{const taken=config.slots.findIndex((row,index)=>index!==slot&&row?.charId===op.charId),selected=config.slots[slot]?.charId===op.charId;return `<article class="native-custom-candidate${selected?' is-selected':''}" data-custom-candidate="${op.charId}"><header>${customIdentity(data,op,tier,avatar,esc)}${taken>=0?`<small class="native-custom-taken">位置 ${taken+1} 已选</small>`:selected?'<small class="native-custom-current">当前选择</small>':''}</header>${customBonds(data,op,esc)}${customSkills(data,op,tier,skills,esc)}<button data-act="custom-choose" data-char="${op.charId}" ${taken>=0?'disabled':''} class="native-custom-choose">${taken>=0?'已占用另一位置':selected?'保留并返回':`选择${esc(op.name)}`}</button></article>`;}).join('');
}
export function renderCustomPicker(data,raw,picker,ui){
 const {esc}=ui,config=normalizeCustomOperators(raw,data),tier=config.slots[picker.slot]?.tier||5,count=filterCustomOperators(data,picker).length;
 return `<div class="native-custom-picker"><header><span class="native-eyebrow">OPERATOR SELECT</span><h2 id="custom-picker-title">选择自选干员</h2><p>自选位置 ${picker.slot+1} · ${tier} 阶</p></header><div class="native-custom-picker-filters"><label>查找干员<input type="search" id="custom-picker-search" value="${esc(picker.query||'')}" placeholder="搜索名称、别名或盟约" autocomplete="off"></label><label>职业<select id="custom-picker-profession"><option value="">全部职业</option>${Object.entries(CUSTOM_PROFESSIONS).map(([id,name])=>`<option value="${id}" ${picker.profession===id?'selected':''}>${name}</option>`).join('')}</select></label></div><div class="native-custom-picker-status" id="custom-picker-count" role="status" aria-live="polite">${count} 名符合条件</div><div class="native-custom-picker-results" id="custom-picker-results">${renderCustomPickerResults(data,config,picker,ui)}</div><footer>点击技能即保存默认设置，选择干员后返回。</footer></div>`;
}
