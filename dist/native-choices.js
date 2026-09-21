import {bountyOption} from './native-bounty.js';
import {richText} from './protocol.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function choiceFrame({kind,title,kicker,round,note,cards,footer}){
 return `<div class="native-choice-content" data-choice-kind="${kind}" data-choice-round="${round}">
 <header class="native-choice-heading"><p>${kicker} <span>ROUND ${String(round).padStart(2,'0')}</span></p><h2 tabindex="-1">${title}</h2><div class="native-choice-rule"></div><p class="native-choice-note">${note}</p></header>
 <div class="native-choice-cards" data-count="${cards.length}">${cards.join('')}</div>
 <footer class="native-choice-footer">${footer}</footer></div>`;
}

export function renderBountyChoice(data,offers,round,{item=false}={}){
 const options=offers.map(id=>bountyOption(data,id)).filter(Boolean);
 const cards=options.map((o,i)=>`<button class="native-choice-card native-bounty-card" data-act="${item?'reward':'round-bounty'}" data-id="${esc(o.id)}" style="--choice-order:${i}">
  <span class="native-choice-index">0${i+1} / ${o.coin===0?'特殊演练':'难度 '+o.difficulty}</span>
  <div class="native-bounty-portrait">${data.assets?.[o.enemyId]?`<img src="./${esc(data.assets[o.enemyId])}" alt="">`:'<span>◇</span>'}</div>
  <strong>${esc(o.name)}</strong><span class="native-bounty-target">额外出现 ${o.count} 只</span>
  <span class="native-bounty-prize"><b>${o.coin}</b><span>◆ / 只<br>整备奖金</span></span>
  <span class="native-choice-card-footer">${o.coin===0?'无奖金 · 轻量演练':'击倒后，下轮到账'} <b>接取 →</b></span>
 </button>`);
 return choiceFrame({kind:'bounty',title:item?'追加悬赏':'本轮悬赏',kicker:'BOUNTY / CONTRACT',round,note:'四选一 · 目标加入本轮战斗，漏失目标不获奖金。',cards,footer:`<span>每次至少包含 1 奖金与 4 奖金档 · 源石虫为 0</span>${item?'':'<button data-act="bounty-later">稍后选择</button>'}`});
}

export function renderDecisionChoice(data,offers,round){
 const cards=offers.map((id,i)=>{const e=data.season.effectInfoDataDict[id];return `<button class="native-choice-card native-decision-card" data-act="decision" data-id="${esc(id)}" style="--choice-order:${i}"><span class="native-choice-index">0${i+1} / 机变方案</span><span class="native-decision-mark" aria-hidden="true">${['Ⅰ','Ⅱ','Ⅲ'][i]||'◇'}</span><strong>${esc(e?.effectName||id)}</strong><p>${esc(richText(e?.effectDesc||''))}</p><span class="native-choice-card-footer">选择本项 <b>→</b></span></button>`;});
 return choiceFrame({kind:'decision',title:'机变决策',kicker:'TACTICAL / DECISION',round,note:'选择一项增益，继续本轮整备。',cards,footer:'<span>三选一 · 选择后立即生效</span>'});
}
