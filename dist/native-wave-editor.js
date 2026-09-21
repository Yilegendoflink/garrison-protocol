import {TRAINING_TYPES,saveWaveTable,emptyWaveTable,defaultWaveTable,enemyCost,tierPack,currentTemplate,emptyTemplate,templateLabel,enemyActivity,enemyActivitySource,enemyPoolEligible} from './native-wave-fill.js';
import {fillBudgetWave,waveRng,filterRandomPoolTable} from './native-wave-random.js';

const KIND_LABEL={ 'random-pool':'常规池','mode-effect':'策略／悬赏','template':'生成模板' };
const SORTS=[['name','名称'],['hp','生命'],['atk','攻击'],['cost','难度'],['id','ID']];

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
// 敌人描述同样是原表富文本：`<@ba.vup>` 这类样式标签丢掉，`<铜灯盘>` 这类内容标签里的文字要留下。
import {richText} from './protocol.js';
const plain=s=>richText(s);

export function editorState(){return {type:'SPECIAL',tier:1,template:0,query:'',sort:'name',motion:'all',kind:'all',tag:'all',activity:'all',readiness:'ready',selected:null,sample:null,scroll:0,caret:0};}

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

export function filterRows(rows,ui,data,table){
 const q=ui.query.trim().toLowerCase();
 return rows.filter(e=>{
  if(ui.activity&&ui.activity!=='all'&&enemyActivity(e.id)!==ui.activity)return false;
  if(ui.readiness==='ready'&&!enemyPoolEligible(e.id,data))return false;
  if(ui.readiness==='pending'&&enemyPoolEligible(e.id,data))return false;
  if(ui.motion==='FLY'&&e.motion!=='FLY')return false;
  if(ui.motion==='WALK'&&e.motion==='FLY')return false;
  if(ui.kind!=='all'&&!(e.kinds||[]).includes(ui.kind))return false;
  if(ui.tag!=='all'&&!tagsOf(data,e.id).includes(ui.tag))return false;
  if(!q)return true;
  return e.name.toLowerCase().includes(q)||e.id.toLowerCase().includes(q)||enemyActivity(e.id).toLowerCase().includes(q)||(e.tags||[]).join(' ').toLowerCase().includes(q)||(e.desc||'').toLowerCase().includes(q);
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

function drawTestDialog(data,table,sample,byId){
 if(!sample)return '';
 const counts=new Map();for(const id of sample.ids)counts.set(id,(counts.get(id)||0)+1);
 return `<dialog id="wave-ed-test" class="wave-ed-test" aria-labelledby="wave-ed-test-title">
  <header><div><small>当前模板 · 抽取测试</small><h2 id="wave-ed-test-title">${esc(sample.templateName)}</h2></div><button data-act="ed-close-test" aria-label="关闭抽取测试" autofocus>关闭</button></header>
  <p class="wave-ed-hint">${esc(sample.activity||'未定活动')} · 仅从当前模板抽取，不影响实战随机数。</p>
  <div class="wave-ed-test-stats"><div><strong>${sample.ids.length}</strong><span>出怪数量</span></div><div><strong>${sample.spent} <small>/ ${sample.budget}</small></strong><span>使用预算</span></div><div><strong>${sample.leftover}</strong><span>剩余预算</span></div></div>
  ${sample.unfilled?'<p class="wave-ed-test-warning">当前模板没有可抽取敌人，结果为占位敌人。不会改抽其他模板。</p>':''}
  <ul class="wave-ed-test-results">${[...counts].map(([id,count])=>`<li>${portrait(data,id)}<span><b>${esc(byId[id]?.name||id)}</b><small>单体难度 ${sample.unfilled?0:enemyCost(table,id)}</small></span><strong>× ${count}</strong></li>`).join('')||'<li>预算不足，无法抽取池中的敌人。</li>'}</ul>
  <footer><span>同名敌人合并显示</span><button class="wave-ed-primary" data-act="ed-roll">再抽一次</button></footer>
 </dialog>`;
}

export function renderWaveEditor(data,table,ui){
 clampTemplate(table,ui);
 const type=TRAINING_TYPES.find(t=>t.id===ui.type)||TRAINING_TYPES[0],pack=tierPack(table,type.id,ui.tier),slot=pack.templates[ui.template],rows=enemyRows(data);
 const byId=Object.fromEntries(rows.map(e=>[e.id,e])),pool=slot.pool.map(id=>byId[id]||{id,name:id,motion:'WALK',hp:0,atk:0,kinds:[]});
 const filtered=filterRows(rows,ui,data,table),kinds=[...new Set(rows.flatMap(e=>e.kinds||[]))];
 const activities=[...new Set(rows.map(e=>enemyActivity(e.id)))].sort((a,b)=>a.localeCompare(b,'zh'));
 const options=(values,current)=>values.map(([id,name])=>`<option value="${esc(id)}" ${current===id?'selected':''}>${esc(name)}</option>`).join('');
 return `<main class="wave-ed">
  <header class="wave-ed-top"><button data-act="home">‹ 大厅</button><div><small>WAVE EDITOR</small><h1>敌人编制台</h1></div><span class="wave-ed-autosave">编辑自动保存</span><button data-act="ed-tools" aria-expanded="${!!ui.tools}">配置管理</button></header>
  ${ui.tools?`<section class="wave-ed-management" aria-label="配置管理"><p>每套模板只包含同活动敌人。实战随机选模板；抽取测试仅使用当前模板。恢复默认或清空会覆盖整张表。</p><div><button data-act="ed-export">导出 JSON</button><button data-act="ed-import">导入 JSON</button><button data-act="ed-defaults">恢复默认配置</button><button data-act="ed-reset">清空本表</button><label>缺省难度 <input data-act="ed-default" type="number" min="1" value="${table.defaultCost}"></label></div></section>`:''}
  <div class="wave-ed-layout">
   <aside class="wave-ed-sidebar">
    <label class="wave-ed-field">特训词条<select data-act="ed-type-select" aria-label="选择特训词条">${options(TRAINING_TYPES.map(t=>[t.id,t.name]),type.id)}</select></label>
    <div class="wave-ed-tiers" aria-label="压力档">${[1,2,3].map(n=>`<button data-act="ed-tier" data-tier="${n}" aria-pressed="${ui.tier===n}" class="${ui.tier===n?'chosen':''}">${['低压','中压','高压'][n-1]}</button>`).join('')}</div>
    <div class="wave-ed-section-label"><span>模板</span><small>${pack.templates.length} 套</small></div>
    <nav class="wave-ed-temps" aria-label="模板列表">${pack.templates.map((row,i)=>`<button data-act="ed-temp" data-index="${i}" aria-pressed="${i===ui.template}" class="${i===ui.template?'chosen':''}"><b>${esc(templateLabel(row,i))}</b><small>${row.pool.length} 种敌人 · 预算 ${row.budget}</small></button>`).join('')}</nav>
    <button class="wave-ed-new" data-act="ed-add-temp">＋ 新建模板</button>
   </aside>
   <section class="wave-ed-work">
    <header class="wave-ed-current"><div><small>${esc(type.name)} / ${['低压','中压','高压'][ui.tier-1]}</small><h2>${esc(templateLabel(slot,ui.template))}</h2></div><button class="wave-ed-primary" data-act="ed-roll">测试当前模板</button></header>
    <div class="wave-ed-settings">
     <label class="wave-ed-field">模板名称<input id="ed-temp-name" data-act="ed-temp-name" value="${esc(slot.name)}" placeholder="模板 ${ui.template+1}" maxlength="60"></label>
     <label class="wave-ed-field">登场活动<select data-act="ed-template-activity" aria-label="模板活动" ${slot.pool.length?'disabled title="移出池中敌人后可更换活动"':''}><option value="">由首名敌人确定</option>${options(activities.map(a=>[a,a]),slot.activity)}</select></label>
     <label class="wave-ed-field">预算<input id="ed-budget" data-act="ed-budget" type="number" min="0" step="1" value="${slot.budget}"></label>
    </div>
    <div class="wave-ed-template-meta"><span>${slot.minCount?`目标 ${slot.minCount}–${slot.maxCount} 只`:'按预算抽取'}${slot.maxCost?` · 单体难度 ≤ ${slot.maxCost}`:''}</span><div><button data-act="ed-copy-temp">复制</button><button data-act="ed-del-temp" ${pack.templates.length<=1?'disabled':''}>删除</button></div></div>
    <div class="wave-ed-body">
     <section class="wave-ed-pool">
      <h2>模板敌人 <small>${pool.length} 种</small></h2>
      <p class="wave-ed-hint">${esc(slot.activity||'加入首名敌人后锁定活动')}</p>
      <div class="wave-ed-cards">${pool.map(e=>`<article class="${ui.selected===e.id?'chosen':''}">
       <button data-act="ed-select" data-id="${esc(e.id)}" class="wave-ed-card">${portrait(data,e.id)}<span><b>${esc(e.name)}</b><small>${enemyPoolEligible(e.id,data)?'已准入':'待补齐'}</small></span></button>
       <label>难度<input data-act="ed-cost" data-id="${esc(e.id)}" aria-label="${esc(e.name)}难度" type="number" min="1" value="${enemyCost(table,e.id)}"></label>
       <button data-act="ed-remove" data-id="${esc(e.id)}" class="wave-ed-x" aria-label="移出${esc(e.name)}">×</button>
      </article>`).join('')||'<p class="wave-ed-empty">模板还是空的<br>从敌人档案中选择并加入。</p>'}</div>
      <button class="wave-ed-fill" data-act="ed-fill-type">填入同活动词条敌人</button>
     </section>
     <section class="wave-ed-db">
      <h2>敌人档案 <small>${filtered.length} / ${rows.length}</small></h2>
      <div class="wave-ed-search-row"><input id="ed-search" type="search" placeholder="搜索敌人名称、活动…" value="${esc(ui.query)}" aria-label="搜索敌人"><button data-act="ed-filters" aria-expanded="${!!ui.moreFilters}">${ui.moreFilters?'收起筛选':'更多筛选'}</button></div>
      <div class="wave-ed-filters">
       <select data-act="ed-activity" aria-label="筛选登场活动"><option value="all">全部登场活动</option>${options(activities.map(a=>[a,a]),ui.activity)}</select>
       <select data-act="ed-readiness" aria-label="筛选逻辑状态">${options([['ready','逻辑已准入'],['pending','待补齐'],['all','全部逻辑状态']],ui.readiness)}</select>
      </div>
      ${ui.moreFilters?`<div class="wave-ed-extra-filters">
       <select id="ed-motion" data-act="ed-motion" aria-label="筛选移动方式">${options([['all','全部移动'],['WALK','地面'],['FLY','飞行']],ui.motion)}</select>
       <select id="ed-kind" data-act="ed-kind" aria-label="筛选来源">${options([['all','全部来源'],...kinds.map(k=>[k,KIND_LABEL[k]||k])],ui.kind)}</select>
       <select id="ed-tag" data-act="ed-tag" aria-label="筛选词条">${options([['all','全部词条'],...TRAINING_TYPES.map(t=>[t.id,t.name])],ui.tag)}</select>
       <select id="ed-sort" data-act="ed-sort" aria-label="排序">${options(SORTS.map(([id,name])=>[id,'按'+name]),ui.sort)}</select>
      </div>`:''}
      <div id="ed-catalog" class="wave-ed-table-wrap"><table class="wave-ed-table"><thead><tr><th>敌人</th><th>难度</th><th><span class="wave-ed-sr-only">操作</span></th></tr></thead><tbody>
       ${filtered.map(e=>`<tr class="${ui.selected===e.id?'chosen':''}${slot.pool.includes(e.id)?' in-pool':''}">
        <td><button class="wave-ed-enemy" data-act="ed-select" data-id="${esc(e.id)}">${portrait(data,e.id)}<span><b>${esc(e.name)}</b><small>${esc(enemyActivity(e.id))} · ${e.motion==='FLY'?'飞行':'地面'}${!enemyPoolEligible(e.id,data)?' · 待补齐':''}</small></span></button></td>
        <td>${enemyCost(table,e.id)}</td><td>${slot.pool.includes(e.id)?`<button data-act="ed-remove" data-id="${esc(e.id)}">移出</button>`:`<button data-act="ed-add" data-id="${esc(e.id)}" ${!enemyPoolEligible(e.id,data)||slot.activity&&slot.activity!==enemyActivity(e.id)?'disabled':''}>${!enemyPoolEligible(e.id,data)?'待补齐':slot.activity&&slot.activity!==enemyActivity(e.id)?'不同活动':'加入'}</button>`}</td>
       </tr>`).join('')||'<tr><td colspan="3" class="wave-ed-empty">没有符合筛选的敌人。</td></tr>'}
      </tbody></table></div>
      ${detail(data,byId[ui.selected],table)}
     </section>
    </div>
   </section>
  </div>
  ${drawTestDialog(data,table,ui.sample,byId)}
 </main>`;
}

function detail(data,e,table){
 if(!e)return '<aside class="wave-ed-detail"><p>点选一条档案查看属性。难度值对所有词条共用。</p></aside>';
 return `<aside class="wave-ed-detail">${portrait(data,e.id)}<h3>${esc(e.name)}</h3><p>${esc(e.id)}</p><p>${esc(enemyActivity(e.id))} · ${enemyPoolEligible(e.id,data)?'逻辑已准入（本期范围）':'逻辑待补齐'} · <a href="${esc(enemyActivitySource(e.id))}" target="_blank" rel="noopener noreferrer">PRTS 资料</a></p><p>${e.motion==='FLY'?'飞行':'地面'} · ${e.applyWay==='RANGED'?'远程':e.applyWay==='NONE'?'不攻击':'近战'} · 难度 ${enemyCost(table,e.id)}</p><label>难度<input data-act="ed-cost" data-id="${esc(e.id)}" aria-label="${esc(e.name)}难度" type="number" min="1" value="${enemyCost(table,e.id)}"></label><p>生命 ${e.hp} / 攻击 ${e.atk} / 防御 ${e.def} / 法抗 ${e.res}</p><p>移速 ${e.speed} · 攻击间隔 ${e.interval}s</p><p>${esc(e.desc)||'无描述'}</p><p>${(e.kinds||[]).map(k=>KIND_LABEL[k]||k).join(' · ')||'未分类'}</p></aside>`;
}

export function applyEditorAction(act,dataset,table,ui,data){
 if(act==='ed-type'){ui.type=dataset.id;ui.template=0;ui.sample=null;return 'render';}
 if(act==='ed-tier'){ui.tier=Number(dataset.tier);ui.template=0;ui.sample=null;return 'render';}
 if(act==='ed-temp'){ui.template=Number(dataset.index)||0;ui.sample=null;return 'render';}
 if(act==='ed-add-temp'){const list=tierPack(table,ui.type,ui.tier).templates;list.push(emptyTemplate(ui.tier));ui.template=list.length-1;ui.sample=null;saveWaveTable(table);return 'render';}
 if(act==='ed-copy-temp'){const list=tierPack(table,ui.type,ui.tier).templates,src=currentTemplate(table,ui.type,ui.tier,ui.template);list.push({activity:src.activity,name:(src.name||templateLabel(src,ui.template))+' 副本',budget:src.budget,maxCost:src.maxCost,pool:src.pool.slice(),...(src.minCount?{minCount:src.minCount,maxCount:src.maxCount}:{})});ui.template=list.length-1;ui.sample=null;saveWaveTable(table);return 'render';}
 if(act==='ed-del-temp'){const list=tierPack(table,ui.type,ui.tier).templates;if(list.length<=1){list[0]=emptyTemplate(ui.tier);ui.template=0;}else{list.splice(ui.template,1);if(ui.template>=list.length)ui.template=list.length-1;}ui.sample=null;saveWaveTable(table);return 'render';}
 if(act==='ed-select'){ui.selected=dataset.id;return 'render';}
 if(act==='ed-add'){const slot=currentTemplate(table,ui.type,ui.tier,ui.template),pool=slot.pool;if(!enemyPoolEligible(dataset.id,data)||!data.enemies?.[dataset.id]||slot.activity&&slot.activity!==enemyActivity(dataset.id))return 'incompatible';slot.activity=enemyActivity(dataset.id);if(!pool.includes(dataset.id))pool.push(dataset.id);ui.sample=null;saveWaveTable(table);return 'render';}
 if(act==='ed-remove'){const slot=currentTemplate(table,ui.type,ui.tier,ui.template);slot.pool=slot.pool.filter(id=>id!==dataset.id);ui.sample=null;saveWaveTable(table);return 'render';}
 if(act==='ed-fill-type'){const slot=currentTemplate(table,ui.type,ui.tier,ui.template),activity=slot.activity||(ui.activity!=='all'?ui.activity:'');if(!activity)return 'choose-activity';slot.activity=activity;const ids=originalTypeIds(data,ui.type).filter(id=>data.enemies?.[id]&&enemyPoolEligible(id,data)&&enemyActivity(id)===activity&&(!slot.maxCost||enemyCost(table,id)<=slot.maxCost));slot.pool=[...new Set(ids)];ui.sample=null;saveWaveTable(table);return 'filled';}
 if(act==='ed-roll'){const slot=currentTemplate(table,ui.type,ui.tier,ui.template),single={...table,types:{[ui.type]:{[ui.tier]:{templates:[{...slot,name:templateLabel(slot,ui.template)}]}}}};ui.sample=fillBudgetWave(waveRng((Date.now()&0xffffffff)>>>0),filterRandomPoolTable(single,data),ui.type,ui.tier);return 'render';}
 if(act==='ed-close-test'){ui.sample=null;return 'render';}
 if(act==='ed-tools'){ui.tools=!ui.tools;return 'render';}
 if(act==='ed-filters'){ui.moreFilters=!ui.moreFilters;return 'render';}
 if(act==='ed-defaults'){Object.assign(table,defaultWaveTable());ui.template=0;ui.sample=null;ui.selected=null;saveWaveTable(table);return 'defaults';}
 if(act==='ed-reset'){Object.assign(table,emptyWaveTable());ui.template=0;ui.sample=null;saveWaveTable(table);return 'reset';}
 if(act==='ed-export'){return 'export';}
 if(act==='ed-import'){return 'import';}
 return null;
}

export function applyEditorField(act,id,value,table,ui){
 if(act==='ed-budget'){currentTemplate(table,ui.type,ui.tier,ui.template).budget=Math.max(0,Number(value)||0);ui.sample=null;saveWaveTable(table);}
 else if(act==='ed-temp-name'){currentTemplate(table,ui.type,ui.tier,ui.template).name=String(value||'').slice(0,60);ui.sample=null;saveWaveTable(table);}
 else if(act==='ed-default'){table.defaultCost=Math.max(1,Number(value)||1);ui.sample=null;saveWaveTable(table);}
 else if(act==='ed-cost'&&id){table.costs[id]=Math.max(1,Number(value)||1);ui.sample=null;saveWaveTable(table);}
 else if(act==='ed-type-select'){ui.type=value;ui.template=0;ui.sample=null;}
 else if(act==='ed-activity')ui.activity=value;
 else if(act==='ed-readiness')ui.readiness=value;
 else if(act==='ed-template-activity'){const slot=currentTemplate(table,ui.type,ui.tier,ui.template);if(slot.pool.length)return false;slot.activity=value;ui.activity=value||'all';ui.sample=null;saveWaveTable(table);}
 else if(act==='ed-motion')ui.motion=value;
 else if(act==='ed-kind')ui.kind=value;
 else if(act==='ed-tag')ui.tag=value;
 else if(act==='ed-sort')ui.sort=value;
 else return false;
 return true;
}
