import {TRAINING_TYPES,saveWaveTable,emptyWaveTable,defaultWaveTable,enemyCost,tierPack,currentTemplate,emptyTemplate,templateLabel} from './native-wave-fill.js';
import {fillBudgetWave,waveRng} from './native-wave-random.js';

const KIND_LABEL={ 'random-pool':'常规池','mode-effect':'策略／悬赏','template':'生成模板' };
const SORTS=[['name','名称'],['hp','生命'],['atk','攻击'],['cost','难度'],['id','ID']];

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
// 敌人描述同样是原表富文本：`<@ba.vup>` 这类样式标签丢掉，`<铜灯盘>` 这类内容标签里的文字要留下。
import {richText} from './protocol.js';
const plain=s=>richText(s);

export function editorState(){return {type:'SPECIAL',tier:1,template:0,query:'',sort:'name',motion:'all',kind:'all',tag:'all',selected:null,sample:null,scroll:0,caret:0};}

export function enemyRows(data){
 if(data.enemyIndex)return data.enemyIndex.map(e=>({...e,desc:plain(e.desc)}));
 return Object.entries(data.enemies||{}).map(([id,raw])=>{const a=raw.attributes||{};return {id,name:raw.name||id,kinds:[],categories:[],motion:raw.motion||'WALK',applyWay:raw.applyWay||'',hp:a.maxHp??0,atk:a.atk??0,def:a.def??0,res:a.magicResistance??0,speed:a.moveSpeed??0,interval:a.baseAttackTime??0,tags:raw.enemyTags||[],desc:plain(raw.description)};});
}

export function originalTypeIds(data,type){return [...new Set(data.season?.enemyInfoDict?.[type]||[])];}

function tagsOf(data,id){
 const dict=data.season?.enemyInfoDict||{},tags=[];
 for(const [type,list] of Object.entries(dict))if(Array.isArray(list)&&list.includes(id))tags.push(type);
 return tags;
}

function portrait(data,id){const file=data.assets?.[id];return file?`<img src="./${file}" alt="" loading="lazy" draggable="false">`:'<span class="wave-ed-fallback">?</span>';}

function filterRows(rows,ui,data,table){
 const q=ui.query.trim().toLowerCase();
 return rows.filter(e=>{
  if(ui.motion==='FLY'&&e.motion!=='FLY')return false;
  if(ui.motion==='WALK'&&e.motion==='FLY')return false;
  if(ui.kind!=='all'&&!(e.kinds||[]).includes(ui.kind))return false;
  if(ui.tag!=='all'&&!tagsOf(data,e.id).includes(ui.tag))return false;
  if(!q)return true;
  return e.name.toLowerCase().includes(q)||e.id.toLowerCase().includes(q)||(e.tags||[]).join(' ').toLowerCase().includes(q)||(e.desc||'').toLowerCase().includes(q);
 }).sort((a,b)=>{
  const dir=ui.sort==='name'||ui.sort==='id'?1:-1,key=ui.sort==='cost'?'cost':ui.sort;
  const av=key==='cost'?enemyCost(table,a.id):a[key],bv=key==='cost'?enemyCost(table,b.id):b[key];
  if(typeof av==='string')return String(av).localeCompare(String(bv),'zh');
  return (Number(av)-Number(bv))*dir||a.name.localeCompare(b.name,'zh');
 });
}

function clampTemplate(table,ui){
 const n=tierPack(table,ui.type,ui.tier).templates.length;
 if(!Number.isInteger(ui.template)||ui.template<0||ui.template>=n)ui.template=0;
}

function drawList(data,table,sample,byId){
 const rows=(sample.ids||[]).map((id,i)=>{
  const e=byId[id]||{id,name:id,motion:'WALK'};
  return `<li><b>${i+1}</b>${portrait(data,id)}<span><strong>${esc(e.name)}</strong><small>${esc(id)} · ${e.motion==='FLY'?'飞行':'地面'} · 难 ${sample.unfilled?0:enemyCost(table,id)}</small></span></li>`;
 }).join('');
 if(sample.unfilled)return `<p class="wave-ed-sample">抽中 ${esc(sample.templateName)}，池是空的，开战会出 1 只占位模板。</p><ol class="wave-ed-draw">${rows}</ol>`;
 return `<p class="wave-ed-sample">抽中 ${esc(sample.templateName)} · ${sample.ids.length} 只 · 花费 ${sample.spent} / ${sample.budget} · 剩余 ${sample.leftover}</p><ol class="wave-ed-draw">${rows||'<li>预算内买不起池里任何一只。</li>'}</ol>`;
}

export function renderWaveEditor(data,table,ui){
 clampTemplate(table,ui);
 const type=TRAINING_TYPES.find(t=>t.id===ui.type)||TRAINING_TYPES[0],pack=tierPack(table,type.id,ui.tier),slot=pack.templates[ui.template],rows=enemyRows(data);
 const byId=Object.fromEntries(rows.map(e=>[e.id,e])),pool=slot.pool.map(id=>byId[id]||{id,name:id,motion:'WALK',hp:0,atk:0,kinds:[]});
 const filtered=filterRows(rows,ui,data,table),kinds=[...new Set(rows.flatMap(e=>e.kinds||[]))];
 const sample=ui.sample||fillBudgetWave(waveRng((type.id.length+ui.tier)*9973),table,type.id,ui.tier);
 const used=sample.unfilled?0:sample.spent,pct=sample.budget?Math.min(100,used/sample.budget*100):0;
 return `<main class="wave-ed">
  <header class="wave-ed-top"><button data-act="home">‹ 大厅</button><div><small>编制台 / WAVE LEDGER</small><h1>敌人波次</h1></div><span>本期 ${rows.length} 条可出怪档案</span></header>
  <p class="wave-ed-lead">同一词条、同一难度可编多套模板。开战时先随机抽一套，再按那一套的预算从它的池里抽怪，直到买不起为止。</p>
  <p class="wave-ed-lead">内置默认配置覆盖全部 7 种词条、3 个压力档，每档按登场活动分组；前期 6–8 只、中期 15–20 只、后期 35–40 只。默认预算足够完成数量目标；手动降低预算可能减少出怪数。预算与敌人难度用于测试，不代表原作波次；部分敌人特殊能力仍待完善。恢复默认会覆盖当前整张表。</p>
  <nav class="wave-ed-types">${TRAINING_TYPES.map(t=>`<button data-act="ed-type" data-id="${t.id}" class="${t.id===type.id?'chosen':''}">${esc(t.name)}<small>${esc(t.id)}</small></button>`).join('')}</nav>
  <div class="wave-ed-toolbar">
   <div class="wave-ed-tiers">${[1,2,3].map(n=>`<button data-act="ed-tier" data-tier="${n}" class="${ui.tier===n?'chosen':''}">${'I'.repeat(n)}</button>`).join('')}</div>
   <nav class="wave-ed-temps">${pack.templates.map((row,i)=>`<button data-act="ed-temp" data-index="${i}" class="${i===ui.template?'chosen':''}">${esc(templateLabel(row,i))}<small>${row.pool.length} 种 · ${row.minCount?row.minCount+'–'+row.maxCount+'只 · ':''}预算 ${row.budget}${row.maxCost?` · ≤${row.maxCost}成本`:''}</small></button>`).join('')}<button data-act="ed-add-temp">＋ 新模板</button><button data-act="ed-copy-temp">复制本套</button><button data-act="ed-del-temp" ${pack.templates.length<=1?'disabled':''}>删除本套</button></nav>
  </div>
  <div class="wave-ed-toolbar">
   <label>名称 <input id="ed-temp-name" data-act="ed-temp-name" value="${esc(slot.name)}" placeholder="模板 ${ui.template+1}" maxlength="24"></label>
   <label>预算 <input id="ed-budget" data-act="ed-budget" type="number" min="0" step="1" value="${slot.budget}"></label>
   <label>默认难度 <input id="ed-default" data-act="ed-default" type="number" min="1" step="1" value="${table.defaultCost}"></label>
   <button data-act="ed-fill-type">填入本期「${esc(type.name)}」名单</button>
   <button data-act="ed-roll">预演抽取</button>
   <button data-act="ed-export">导出 JSON</button>
   <button data-act="ed-import">导入 JSON</button>
   <button data-act="ed-defaults" title="替换全部词条、模板与费用为内置测试配置">恢复默认配置</button>
   <button data-act="ed-reset">清空本表</button>
  </div>
  <div class="wave-ed-meter" aria-label="预算占用"><i style="width:${pct}%"></i></div>
  ${drawList(data,table,sample,byId)}
  <div class="wave-ed-body">
   <section class="wave-ed-pool">
    <h2>${esc(type.name)} · ${'I'.repeat(ui.tier)} · ${esc(templateLabel(slot,ui.template))}<small>${pool.length} 种</small></h2>
    <div class="wave-ed-cards">${pool.map(e=>`<article class="${ui.selected===e.id?'chosen':''}">
      <button data-act="ed-select" data-id="${esc(e.id)}" class="wave-ed-card">${portrait(data,e.id)}<b>${esc(e.name)}</b><span>${e.motion==='FLY'?'飞行':'地面'} · 难 ${enemyCost(table,e.id)}</span></button>
      <label>难 <input data-act="ed-cost" data-id="${esc(e.id)}" type="number" min="1" step="1" value="${enemyCost(table,e.id)}"></label>
      <button data-act="ed-remove" data-id="${esc(e.id)}" class="wave-ed-x" aria-label="移出池">×</button>
    </article>`).join('')||'<p class="wave-ed-empty">从右侧档案点「加入」写入本套模板。开战只从抽中的那一套出怪。</p>'}</div>
   </section>
   <section class="wave-ed-db">
    <h2>敌人档案<small>${filtered.length} / ${rows.length}</small></h2>
    <div class="wave-ed-filters">
     <input id="ed-search" type="search" placeholder="搜索名称、ID、描述" value="${esc(ui.query)}" aria-label="搜索敌人">
     <select id="ed-motion" data-act="ed-motion">${[['all','全部移动'],['WALK','地面'],['FLY','飞行']].map(([id,name])=>`<option value="${id}" ${ui.motion===id?'selected':''}>${name}</option>`).join('')}</select>
     <select id="ed-kind" data-act="ed-kind"><option value="all">全部来源</option>${kinds.map(k=>`<option value="${esc(k)}" ${ui.kind===k?'selected':''}>${KIND_LABEL[k]||k}</option>`).join('')}</select>
     <select id="ed-tag" data-act="ed-tag"><option value="all">全部词条标签</option>${TRAINING_TYPES.map(t=>`<option value="${t.id}" ${ui.tag===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select>
     <select id="ed-sort" data-act="ed-sort">${SORTS.map(([id,name])=>`<option value="${id}" ${ui.sort===id?'selected':''}>按${name}</option>`).join('')}</select>
    </div>
    <div id="ed-catalog" class="wave-ed-table-wrap">
     <table class="wave-ed-table"><thead><tr><th></th><th>名称</th><th>移动</th><th>生命</th><th>攻击</th><th>防御</th><th>难度</th><th></th></tr></thead>
     <tbody>${filtered.map(e=>`<tr data-act="ed-select" data-id="${esc(e.id)}" class="${ui.selected===e.id?'chosen':''}${slot.pool.includes(e.id)?' in-pool':''}">
      <td>${portrait(data,e.id)}</td>
      <td><b>${esc(e.name)}</b><small>${esc(e.id)}${tagsOf(data,e.id).length?' · '+tagsOf(data,e.id).map(id=>TRAINING_TYPES.find(t=>t.id===id)?.name||id).join(' / '):''}</small></td>
      <td>${e.motion==='FLY'?'飞行':'地面'}</td>
      <td>${e.hp}</td><td>${e.atk}</td><td>${e.def}</td>
      <td><input data-act="ed-cost" data-id="${esc(e.id)}" type="number" min="1" step="1" value="${enemyCost(table,e.id)}"></td>
      <td>${slot.pool.includes(e.id)?`<button data-act="ed-remove" data-id="${esc(e.id)}">移出</button>`:`<button data-act="ed-add" data-id="${esc(e.id)}">加入</button>`}</td>
     </tr>`).join('')||'<tr><td colspan="8">没有符合筛选的敌人。</td></tr>'}</tbody></table>
    </div>
    ${detail(data,byId[ui.selected],table)}
   </section>
  </div>
 </main>`;
}

function detail(data,e,table){
 if(!e)return '<aside class="wave-ed-detail"><p>点选一条档案查看属性。难度值对所有词条共用。</p></aside>';
 return `<aside class="wave-ed-detail">${portrait(data,e.id)}<h3>${esc(e.name)}</h3><p>${esc(e.id)}</p><p>${e.motion==='FLY'?'飞行':'地面'} · ${e.applyWay==='RANGED'?'远程':e.applyWay==='NONE'?'不攻击':'近战'} · 难度 ${enemyCost(table,e.id)}</p><p>生命 ${e.hp} / 攻击 ${e.atk} / 防御 ${e.def} / 法抗 ${e.res}</p><p>移速 ${e.speed} · 攻击间隔 ${e.interval}s</p><p>${esc(e.desc)||'无描述'}</p><p>${(e.kinds||[]).map(k=>KIND_LABEL[k]||k).join(' · ')||'未分类'}</p></aside>`;
}

export function applyEditorAction(act,dataset,table,ui,data){
 if(act==='ed-type'){ui.type=dataset.id;ui.template=0;ui.sample=null;return 'render';}
 if(act==='ed-tier'){ui.tier=Number(dataset.tier);ui.template=0;ui.sample=null;return 'render';}
 if(act==='ed-temp'){ui.template=Number(dataset.index)||0;ui.sample=null;return 'render';}
 if(act==='ed-add-temp'){const list=tierPack(table,ui.type,ui.tier).templates;list.push(emptyTemplate(ui.tier));ui.template=list.length-1;ui.sample=null;saveWaveTable(table);return 'render';}
 if(act==='ed-copy-temp'){const list=tierPack(table,ui.type,ui.tier).templates,src=currentTemplate(table,ui.type,ui.tier,ui.template);list.push({name:(src.name||templateLabel(src,ui.template))+' 副本',budget:src.budget,maxCost:src.maxCost,pool:src.pool.slice(),...(src.minCount?{minCount:src.minCount,maxCount:src.maxCount}:{})});ui.template=list.length-1;ui.sample=null;saveWaveTable(table);return 'render';}
 if(act==='ed-del-temp'){const list=tierPack(table,ui.type,ui.tier).templates;if(list.length<=1){list[0]=emptyTemplate(ui.tier);ui.template=0;}else{list.splice(ui.template,1);if(ui.template>=list.length)ui.template=list.length-1;}ui.sample=null;saveWaveTable(table);return 'render';}
 if(act==='ed-select'){ui.selected=dataset.id;return 'render';}
 if(act==='ed-add'){const pool=currentTemplate(table,ui.type,ui.tier,ui.template).pool;if(!pool.includes(dataset.id))pool.push(dataset.id);ui.sample=null;saveWaveTable(table);return 'render';}
 if(act==='ed-remove'){const slot=currentTemplate(table,ui.type,ui.tier,ui.template);slot.pool=slot.pool.filter(id=>id!==dataset.id);ui.sample=null;saveWaveTable(table);return 'render';}
 if(act==='ed-fill-type'){const ids=originalTypeIds(data,ui.type).filter(id=>data.enemies?.[id]||data.enemyIndex?.some(e=>e.id===id));currentTemplate(table,ui.type,ui.tier,ui.template).pool=[...new Set(ids)];ui.sample=null;saveWaveTable(table);return 'filled';}
 if(act==='ed-roll'){ui.sample=fillBudgetWave(waveRng((Date.now()&0xffffffff)>>>0),table,ui.type,ui.tier);return 'render';}
 if(act==='ed-defaults'){Object.assign(table,defaultWaveTable());ui.template=0;ui.sample=null;ui.selected=null;saveWaveTable(table);return 'defaults';}
 if(act==='ed-reset'){Object.assign(table,emptyWaveTable());ui.template=0;ui.sample=null;saveWaveTable(table);return 'reset';}
 if(act==='ed-export'){return 'export';}
 if(act==='ed-import'){return 'import';}
 return null;
}

export function applyEditorField(act,id,value,table,ui){
 if(act==='ed-budget'){currentTemplate(table,ui.type,ui.tier,ui.template).budget=Math.max(0,Number(value)||0);ui.sample=null;saveWaveTable(table);}
 else if(act==='ed-temp-name'){currentTemplate(table,ui.type,ui.tier,ui.template).name=String(value||'').slice(0,24);saveWaveTable(table);}
 else if(act==='ed-default'){table.defaultCost=Math.max(1,Number(value)||1);ui.sample=null;saveWaveTable(table);}
 else if(act==='ed-cost'&&id){table.costs[id]=Math.max(1,Number(value)||1);ui.sample=null;saveWaveTable(table);}
 else if(act==='ed-motion')ui.motion=value;
 else if(act==='ed-kind')ui.kind=value;
 else if(act==='ed-tag')ui.tag=value;
 else if(act==='ed-sort')ui.sort=value;
 else return false;
 return true;
}
