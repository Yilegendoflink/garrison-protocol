import {bountyOption} from './native-bounty.js';
import {richText} from './protocol.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function choiceFrame({kind,title,round,note,cards,footer}){
 return `<div class="native-choice-content" data-choice-kind="${kind}" data-choice-round="${round}">
 <header class="native-choice-heading"><p>第 ${round} 回合</p><h2 tabindex="-1">${title}</h2><div class="native-choice-rule"></div><p class="native-choice-note">${note}</p></header>
 <div class="native-choice-cards" data-count="${cards.length}">${cards.join('')}</div>
 <footer class="native-choice-footer">${footer}</footer></div>`;
}

export function renderBountyChoice(data,offers,round){
 const options=offers.map(id=>bountyOption(data,id)).filter(Boolean);
 const cards=options.map((o,i)=>`<button class="native-choice-card native-bounty-card" data-act="reward" data-id="${esc(o.id)}" style="--choice-order:${i}">
  <span class="native-choice-index">${o.coin===0?'特殊演练':'难度 '+o.difficulty}</span>
  <div class="native-bounty-portrait">${data.assets?.[o.enemyId]?`<img src="./${esc(data.assets[o.enemyId])}" alt="">`:'<span>◇</span>'}</div>
  <strong>${esc(o.name)}</strong><span class="native-bounty-target">额外出现 ${o.count} 只</span>
  <span class="native-bounty-prize"><b>${o.coin}</b><span>◆ / 只<br>整备奖金</span></span>
  <span class="native-choice-card-footer">${o.coin===0?'无奖金 · 轻量演练':'击倒后，下轮到账'} <b>接取</b></span>
 </button>`);
 return choiceFrame({kind:'bounty',title:'追加悬赏',round,note:'四选一 · 目标加入下一场战斗，漏失目标不获奖金。',cards,footer:'<span>奖金取原表 0–6 档 · 至少包含 1 与 4 奖金档 · 源石虫为 0</span>'});
}

export function renderDecisionChoice(data,offers,round,{type='tactical',bountyRules=null}={}){
 const labels={bounty:'悬赏',equipment:'道具补给',tactical:'战术运营'},cards=offers.map((offer,i)=>{
  const value=typeof offer==='string'?{id:offer,kind:'tactical',effectId:offer}:offer;
  if(value.kind==='bounty'){
   const image=data.assets?.[value.enemyId]?`<img src="./${esc(data.assets[value.enemyId])}" alt="">`:'<span>◇</span>';
   const desc=bountyRules?`本轮全部波次敌人替换为此目标；完美通关每只获得 ${value.coin*bountyRules.rewardMultiplier} ◆，非完美无赏金。`:`额外加入本轮 ${value.count} 名；击倒后下轮获得 ${value.coin} ◆。`;
   return `<button class="native-choice-card native-decision-card native-bounty-card" data-act="decision" data-id="${esc(value.id)}" style="--choice-order:${i}"><span class="native-choice-index">悬赏目标</span><div class="native-bounty-portrait">${image}</div><strong>${esc(value.name||data.enemies?.[value.enemyId]?.name||value.enemyId)}</strong><p>${esc(desc)}</p><span class="native-choice-card-footer">选择目标</span></button>`;
  }
  if(value.kind==='equipment'){
   const item=data.items?.find(row=>row.id===value.itemId),name=item?.name||value.itemId,desc=richText(item?.effect?.effectDesc||'');
   const icon=data.assets?.[item?.id]?`<img class="native-item-art" src="./${esc(data.assets[item.id])}" alt="">`:'<span class="native-item-art native-item-art-empty"></span>';
   return `<button class="native-choice-card native-decision-card" data-act="decision" data-id="${esc(value.id)}" style="--choice-order:${i}"><span class="native-choice-index">道具补给 · ${item?.rank||''} 阶</span><span class="native-decision-mark native-decision-item-mark" aria-hidden="true">${icon}</span><strong>${esc(name)}</strong><p>${esc(desc)}</p><span class="native-choice-card-footer">免费获得 <b>→</b></span></button>`;
  }
  const e=data.season.effectInfoDataDict[value.effectId];
  return `<button class="native-choice-card native-decision-card" data-act="decision" data-id="${esc(value.id)}" style="--choice-order:${i}"><span class="native-choice-index">战术方案</span><span class="native-decision-mark" aria-hidden="true">${['Ⅰ','Ⅱ','Ⅲ'][i]||'◇'}</span><strong>${esc(e?.effectName||value.effectId)}</strong><p>${esc(richText(e?.effectDesc||''))}</p><span class="native-choice-card-footer">选择本项 <b>→</b></span></button>`;
 });
 const label=labels[type]||labels.tactical,note=bountyRules?'每回合固定一次悬赏选择 · 最终 Boss 保留本体，只替换增援 · 零漏失通关获得三倍赏金。':type==='bounty'?'本次随机抽取悬赏类型，从目标中选一项加入下一场战斗。':type==='equipment'?'本次随机抽取道具补给，选择一件装备免费获得。':'本次随机抽取战术运营，选择一项增益继续整备。';
 return choiceFrame({kind:'decision',title:`${label}决策`,round,note,cards,footer:'<span>三选一 · 选择后立即生效</span>'});
}
