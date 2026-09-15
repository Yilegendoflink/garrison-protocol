import {nativeWavePlan} from './native-waves.js';
import {TRAINING_TYPES,loadWaveTable,normalizeWaveTable,saveWaveTable} from './native-wave-fill.js';
import {createWaveRoster,trainingType,waveRng} from './native-wave-random.js';
import {applyEditorAction,applyEditorField,editorState,renderWaveEditor} from './native-wave-editor.js';
import {NATIVE_DATA} from './runtime-data.js';
import {NativeSession} from './native-session.js';
import {buildPhasePlan} from './protocol.js';
import {spBarFill} from './native-sp.js';
import {playBattleEvents,resetFxClock,unlockAudio,actorOffset,drawFx,drawStatuses,drawDownRing} from './native-fx.js';

const data=NATIVE_DATA,root=document.getElementById('app'),SAVE='garrison-native-manual-v1';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const skillDescription=skill=>{const values=Object.fromEntries((skill?.blackboard||[]).map(b=>[b.key,b.valueStr??b.value]));return plain(skill?.description).replace(/\{([^}:]+)(?::([^}]+))?\}/g,(all,key,format)=>{const value=values[key];return value===undefined?'—':format?.includes('%')?Math.round(value*100)+'%':String(value);});};
const plain=s=>String(s||'').replace(/<[^>]+>/g,'').replace(/\\n/g,'\n');
const imageCache=new Map(),img=id=>{const file=data.assets[id];if(!file)return null;if(!imageCache.has(file)){const im=new Image();im.src='./'+file;imageCache.set(file,im);}return imageCache.get(file);};
function preference(key,fallback){try{return localStorage.getItem(key)??fallback;}catch{return fallback;}}
function savePreference(key,value){try{localStorage.setItem(key,value);}catch{}}
const state={expiresAt:null,game:null,draft:null,view:'lobby',mode:'mode_single_normal',band:'band_bldsk',map:data.maps.find(m=>m.weight>0).stageId,selected:null,item:null,inspect:null,preview:null,paused:false,speed:1,muted:preference('garrison-mute','0')==='1',reduceFx:preference('garrison-reduce-fx','0')==='1',volume:Math.max(0,Math.min(1,Number(preference('garrison-volume','1'))||0)),modal:null,editor:editorState(),waveTable:loadWaveTable()};
let canvas,drag=null,canvasPress=null,aim=null,touchButton=null,last=performance.now(),acc=0,hudTime=0,saveTime=0,ignoredClickPointer=null,ignoredClickUntil=0;
try{const saved=JSON.parse(localStorage.getItem(SAVE)||'null');if(saved){state.game=NativeSession.restore(data,saved);if(state.game){state.paused=true;state.expiresAt=saved.expiresAt??null;}}}catch{}
const profile=u=>{const base=data.profiles[u.chessId],selected=base?.skillChoices?.[u.skillIndex];return selected?{...base,...selected}:base;};
const avatar=id=>data.assets[id]?`<img src="./${data.assets[id]}" alt="" loading="lazy" draggable="false">`:'';
function save(){if(!state.game)return;try{localStorage.setItem(SAVE,JSON.stringify({...state.game.snapshot(),expiresAt:state.expiresAt}));}catch{notice('进度未能写入浏览器存储，可使用导出存档。');}}
function notice(s){const t=document.getElementById('toast');t.textContent=s;t.classList.add('visible');clearTimeout(notice.timer);notice.timer=setTimeout(()=>t.classList.remove('visible'),4000);}
function currentTurn(){return buildPhasePlan(data,state.game.s.modeId).find(t=>t.round===state.game.s.round);}
function modal(html){state.modal=html;renderModal();}
function renderModal(){const el=document.getElementById('native-modal');if(el)el.remove();if(!state.modal)return;const el2=document.createElement('div');el2.id='native-modal';el2.className='native-modal';el2.innerHTML=`<section role="dialog" aria-modal="true"><button data-act="close" class="native-close" aria-label="关闭">×</button>${state.modal}</section>`;root.append(el2);}
function showBranches(id=null){
 const all=data.branchRules.records,records=id?all.filter(r=>r.id===id):all;
 modal(`<h2>职业分支规则</h2><p>已记录 ${all.length} 个历史分支，${all.filter(r=>r.inCurrentMode).length} 个出现在本期固定预设中。这里区分分支基础逻辑与干员专属技能、天赋、模组；复杂机制仍有待补齐项。</p><div class="native-branch-catalog">${records.map(r=>`<details ${id?'open':''}><summary><b>${esc(r.name)}</b><span>${r.inCurrentMode?'本期包含':'非本期固定预设'} · ${r.runtime.status==='partial'?'部分接入':'基础行为已接入'}</span></summary><p>${esc(r.baseTrait)}</p><p>${r.pending.length?'待补齐：'+r.pending.map(esc).join('、'):'专属技能／天赋／模组例外另行处理。'}</p><a href="${r.sources[1].url}" target="_blank" rel="noreferrer">PRTS 特性细则 · 修订 ${r.sources[1].revision} ↗</a></details>`).join('')}</div>`);
}
function showLimitations(){modal(`<h2>手动验收版 · 已知差异</h2><p>主入口已使用下半期数据和新对局控制器。该版本不代表完全还原，未运行本轮自动或浏览器测试。</p><ul>${data.limitations.map(s=>`<li>${esc(s)}</li>`).join('')}</ul><p>请导出当前存档，连同复现步骤提交问题。</p><a href="https://github.com/Yilegendoflink/garrison-protocol/issues" target="_blank" rel="noreferrer">反馈问题 ↗</a>`);}
function render(){
 if(state.view==='lobby'){root.innerHTML=`<main class="native-lobby"><header><span>RHODES ISLAND / PRTS</span><button data-act="limits">手动验收版 · 已知差异</button></header><h1>卫戍协议<span>盟约 · 下半期</span></h1><p>原作数据驱动的独立模拟 · 最终领袖阶段以无限生命木桩替代</p><div class="native-home"><section><h2>难度</h2><select id="native-mode">${Object.values(data.season.modeDataDict).filter(m=>m.modeType!=='MULTI').map(m=>`<option value="${m.modeId}" ${m.modeId===state.mode?'selected':''}>${m.name}</option>`).join('')}</select><h2>地图</h2><select id="native-map">${data.maps.filter(m=>m.weight>0).map((m,i)=>`<option value="${m.stageId}" ${m.stageId===state.map?'selected':''}>阵地 ${i+1} · ${m.stageId}</option>`).join('')}</select><p>基础资金第1轮4，此后每轮+1，各难度相同。最终木桩150秒，可手动结束。</p><button class="native-primary" data-act="new">开启一局 →</button>${state.game?'<button data-act="resume">恢复本地模拟</button>':''}<button data-act="import">导入存档</button></section><section><h2>数据库</h2><button data-act="editor">敌人波次编制台</button><button data-act="branches">职业分支规则</button><a href="./legacy.html">旧版演示与资料库 ↗</a></section></div><footer>本期预设与属性来源：PRTS / 历史游戏数据 · 非官方同人作品</footer></main>`;renderModal();return;}
 if(state.view==='briefing'){const d=state.draft,mode=data.season.modeDataDict[d.modeId],mapName=data.maps.filter(m=>m.weight>0).findIndex(m=>m.stageId===d.mapId),tags=(d.roster.types||[]).map(id=>trainingType(id)).filter(Boolean),order=(d.roster.order||[]).map(id=>trainingType(id)?.name||id);root.innerHTML=`<main class="native-lobby native-briefing"><header><button data-act="home">‹ 大厅</button><span>战前准备</span></header><h1>战前准备</h1><p>${esc(mode?.name||'')} · 阵地 ${mapName+1}</p><h2>本局特训</h2><p>抽中三种词条，战斗按 ${order.map(esc).join(' → ')} 轮换出怪。</p><div class="native-tags">${tags.map(t=>`<article><b>${esc(t.name)}</b><small>${esc(t.id)}</small><p>${esc(t.desc)}</p></article>`).join('')}</div><h2>初始策略</h2><div class="native-strategies">${Object.values(data.season.bandDataListDict).map(b=>`<button data-act="band" data-id="${b.bandId}" class="${state.band===b.bandId?'chosen':''}">${avatar(b.bandId)}<span><b>${esc(data.common.bandDataDict[b.bandId].bandName)}</b><small>生命 ${b.totalHp}</small><p>${esc(plain(b.bandDesc))}</p></span></button>`).join('')}</div><button class="native-primary native-begin" data-act="begin">进入对局 →</button></main>`;renderModal();return;}
 if(state.view==='editor'){root.innerHTML=renderWaveEditor(data,state.waveTable,state.editor);const search=document.getElementById('ed-search'),catalog=document.getElementById('ed-catalog');if(search&&state.editor.keepSearch){search.focus();try{search.setSelectionRange(state.editor.caret,state.editor.caret);}catch{}}state.editor.keepSearch=false;if(catalog)catalog.scrollTop=state.editor.scroll||0;renderModal();return;}
 const g=state.game,s=g.s,turn=currentTurn(),rows=g.bonds();root.innerHTML=`<main class="native-game${s.phase==='battle'?' is-battle':''}">${dossier()}<header class="native-top"><button data-act="home">‹ 大厅</button><strong>卫戍协议 / 盟约下半</strong><button data-act="limits">已知差异</button><button data-act="branches">分支规则</button><button data-act="export">导出存档</button></header><div class="native-workspace"><aside class="native-bonds">${Object.entries(rows).filter(([,b])=>b.count>0).map(([id,b])=>`<button data-act="bond-info" data-id="${id}" class="${b.active?'active':''}"><b>${data.season.bondInfoDict[id].name}</b><span>${b.count} / ${data.season.bondInfoDict[id].activeCount}</span><small>${data.season.bondInfoDict[id].noStack?'':(s.bondLayers[id]||0)+' 层'}</small></button>`).join('')||'<p>部署干员以激活盟约</p>'}</aside><section class="native-field"><div class="native-field-caption"><b>${s.phase==='battle'?(turn.isBossTurn?'木桩测试':'自动作战'):s.phase==='prep'?'阵地休整':s.phase==='finished'?'模拟结束':'回合结算'}</b><span id="native-wave-progress">${s.units.filter(u=>u.position).length} / ${s.capacity} 部署</span></div><div class="native-terrain-legend" aria-label="地块图例"><span><i class="terrain-high"></i>高台</span><span><i class="terrain-ground"></i>地面／通道</span><span><i class="terrain-blocked"></i>阻隔工事</span><span><i class="terrain-entry"></i>敌方入口</span><span><i class="terrain-goal"></i>防守目标</span></div><canvas id="native-canvas" tabindex="0" aria-label="战场棋盘，先选位置再拖动朝向确认"></canvas><div class="native-facing" ${state.preview?'':'hidden'}>拖动选择朝向，松手确认；中心松手取消。${[0,1,2,3].map((d)=>`<button data-act="aim" data-dir="${d}">${['→','↓','←','↑'][d]}</button>`).join('')}<button data-act="place-confirm">确认放置</button><button data-act="cancel">取消</button></div><div class="native-controls"><button data-act="pause" ${s.phase!=='battle'?'disabled':''}>${state.paused?'继续':'暂停'}</button>${[1,2,4].map(n=>`<button data-act="speed" data-speed="${n}" class="${state.speed===n?'chosen':''}">${n}×</button>`).join('')}<button data-act="mute">${state.muted?'声音关':'声音开'}</button><label>音量 <input id="native-volume" aria-label="战斗音量" type="range" min="0" max="1" step="0.05" value="${state.volume}" style="width:72px"></label><button data-act="reduce-fx">${state.reduceFx?'动效少':'动效'}</button>${s.phase==='prep'?'<button class="native-primary" data-act="start">准备完毕 →</button>':s.phase==='intermission'?'<button class="native-primary" data-act="next">进入下一回合 →</button>':s.phase==='battle'&&turn.isBossTurn?'<button data-act="stop">结束木桩并播报伤害</button>':s.phase==='finished'?'<button data-act="result">查看伤害报告</button>':''}</div><div class="native-bench-label">整备区 ${g.hand().length} / 10 <span id="native-drop-hint" aria-live="polite">可将场上干员拖回此处；换位后重新选朝向</span></div><div class="native-bench">${s.units.filter(u=>!u.position).map(u=>`<button data-act="select" data-uid="${u.uid}" class="${state.selected===u.uid||inspectSame('unit',u.uid)?'chosen':''}">${avatar(u.charId)}<b>${esc(data.profiles[u.chessId].name)}</b>${data.profiles[u.chessId].isGolden?'<small>精锐</small>':''}</button>`).join('')}${s.items.map(i=>`<button data-act="item" data-uid="${i.uid}" class="${state.item===i.uid||inspectSame('pack',i.uid)?'chosen':''}"><span class="native-item-icon">◇</span><b>${esc(itemName(i.chessId))}</b></button>`).join('')}</div></section><aside class="native-detail">${waveIntel()}${detail()}<h3>${esc(data.common.bandDataDict[s.bandId].bandName)}</h3><p>${esc(plain(data.season.bandDataListDict[s.bandId].bandDesc))}</p><p>${turn.isBossTurn?'最终木桩：生命无限，防御0、法抗0，倒计时150秒。':'开局抽取三种特训词条；每档按难度预算从敌人池抽取，空池使用占位模板。'}</p><div id="native-combat-stats"></div></aside></div><div class="native-status" id="native-status"></div><section class="native-shop"><div><h2>调度中心 ${s.level}</h2><button data-act="upgrade" ${s.phase!=='prep'?'disabled':''}>升级 ${g.terms().upgradeCost??'MAX'} ◆</button><button data-act="refresh" ${s.phase!=='prep'?'disabled':''}>刷新 ${s.freeRefresh?'免费':'1 ◆'}</button><button data-act="lock" ${s.phase!=='prep'?'disabled':''}>${s.locked?'❄ 已冻结':'冻结'}</button></div><div class="native-shop-cards">${s.offers.map((id,i)=>id?`<button data-act="buy" data-index="${i}" class="${inspectSame('shop',i)?'chosen':''}">${avatar(data.profiles[id].charId)}<strong>${esc(data.profiles[id].name)}</strong><small>${data.profiles[id].rank} 阶 · ${g.price(id)} ◆</small><p>${g.ownBonds({chessId:id}).map(b=>data.season.bondInfoDict[b].name).join(' / ')}</p></button>`:'<div class="native-empty">已调配</div>').join('')}${s.itemOffers.map((id,i)=>id?`<button data-act="buyItem" data-index="${i}" class="${inspectSame('shopItem',i)?'chosen':''}"><span class="native-item-icon">◇</span><strong>${esc(itemName(id))}</strong><small>${data.season.trapChessDataDict[id].purchasePrice} ◆</small></button>`:'<div class="native-empty">已调配</div>').join('')}</div></section></main>`;canvas=document.getElementById('native-canvas');updateHud();fitWaveFaces();draw();renderModal();showRequired();
}
function waveIntel(){
 const g=state.game;if(!g||g.s.phase==='finished')return '';
 const turn=currentTurn(),p=nativeWavePlan(data,turn,g.s.waveRoster),roman=n=>'I'.repeat(n||1);
 const tags=(g.s.waveRoster?.types||[]).map(id=>trainingType(id)||TRAINING_TYPES.find(t=>t.id===id)).filter(Boolean);
 const faces=(p.pack?.ids||[]).map(id=>avatar(id)||'<span class="native-wave-miss">?</span>').join('');
 const body=p.benchmark?`<p>木桩阶段</p>`:`<p>${esc(trainingType(p.assignment?.type)?.name||'未指定')} ${roman(p.assignment?.tier)}</p><div class="native-wave-faces">${faces}</div>`;
 return `<section class="native-wave-preview"><h3>本波敌情</h3><p class="native-wave-tags">本局特训 ${tags.map(t=>esc(t.name)).join(' / ')||'尚未抽取'}</p>${body}</section>`;
}
function fitWaveFaces(){
 const box=document.querySelector('.native-wave-faces');if(!box)return;
 const n=box.childElementCount,w=box.clientWidth,h=box.clientHeight;
 let s=48;while(s>8&&Math.floor(w/s)*Math.floor(h/s)<n)s--;
 box.style.setProperty('--face',s+'px');
}
function itemName(id){const record=data.season.trapChessDataDict[id];return data.items.find(i=>i.id===id||i.elite?.chessId===id)?.name+(record?.isGolden?' · 进阶':'')||id;}
function itemEffect(id){const trap=data.season.trapChessDataDict[id],info=data.season.effectInfoDataDict[trap?.effectId];return info?{name:info.effectName,desc:plain(info.effectDesc)}:{name:itemName(id),desc:''};}
function inspectSame(kind,key){const inv=state.inspect;return !!inv&&inv.kind===kind&&(inv.uid??inv.index)===key;}
function inspectTarget(){
 const g=state.game,inv=state.inspect;if(!g||!inv)return null;
 if(inv.kind==='unit'){const u=g.s.units.find(x=>x.uid===inv.uid);return u?{kind:'op',u,p:profile(u),live:g.battle?.s.units.find(a=>a.uid===u.uid),shop:false}:null;}
 if(inv.kind==='summon'){const s=g.battle?.s.summons?.find(x=>x.uid===inv.uid);return s?{kind:'summon',s}:null;}
 if(inv.kind==='shop'){const id=g.s.offers[inv.index];if(!id)return null;const row=data.profiles[id];return {kind:'op',u:null,p:{...row,...(row.skillChoices?.[row.skillIndex]||{})},live:null,shop:true,price:g.price(id)};}
 if(inv.kind==='shopItem'){const id=g.s.itemOffers[inv.index];return id?{kind:'item',id,shop:true,price:data.season.trapChessDataDict[id]?.purchasePrice}:null;}
 if(inv.kind==='pack'){const it=g.s.items.find(i=>i.uid===inv.uid);return it?{kind:'item',id:it.chessId,shop:false,uid:it.uid}:null;}
 return null;
}
function dossier(){
 const t=inspectTarget();if(!t)return '';
 if(t.kind==='item'){
  const fx=itemEffect(t.id);
  return `<aside class="native-dossier" aria-label="道具档案"><div class="native-dossier-body"><button data-act="inspect-close" class="native-dossier-close" aria-label="关闭">×</button><div class="native-dossier-art native-dossier-item">◇</div><h2>${esc(itemName(t.id))}</h2><p class="native-dossier-kicker">${esc(fx.name)}</p><h3>效果</h3><p>${esc(fx.desc||'无效果说明')}</p>${t.shop?`<p class="native-dossier-buy">再次点击卡片购买 · ${t.price} ◆</p>`:''}</div></aside>`;
 }
 if(t.kind==='summon'){
  const s=t.s,owner=state.game.s.units.find(u=>u.uid===s.ownerUid);
  return `<aside class="native-dossier" aria-label="召唤物档案"><div class="native-dossier-body"><button data-act="inspect-close" class="native-dossier-close" aria-label="关闭">×</button><h2>${esc(s.name||s.type)}</h2><p class="native-dossier-kicker">${s.device?'装置':'召唤物'}${owner?' · '+esc(data.profiles[owner.chessId]?.name||''):''}</p><p id="native-dossier-hp" class="native-dossier-hp">生命 <b>${Math.round(s.hp)}</b><i>/${Math.round(s.maxHp)}</i></p><p>${s.targetable===false?'不可被常规选中':''} ${s.canBlock?'可阻挡':''} ${s.canHeal?'可治疗':''}</p></div></aside>`;
 }
 const p=t.p,g=state.game,owned=t.u,a=t.live&&g.battle?g.battle.stats(t.live):p.attributes;
 const hp=Math.round(t.live?.hp??a.maxHp),max=Math.round(t.live?.maxHp??a.maxHp);
 const live=t.live,phase=live?(live.ammo>0?`弹药 ${live.ammo}/${live.ammoMax}`:live.skillLeft>0?`技能持续 ${live.skillLeft.toFixed(1)}s`:live.down>0?`再部署 ${Math.ceil(live.down)}s`:(g.battle?spBarFill(live,p.skill,g.battle.spCost(live)):null)?.ready?'技力就绪':'待机'):'';
 const parts=(a.parts||[]).map(x=>`${esc(x.src)} ${x.stat} ${x.layer} ${x.v}`).join('<br>')||'无额外加成';
 const statuses=(live?.statuses||[]).map(s=>s.kind).join('、')||'无';
 return `<aside class="native-dossier" aria-label="干员档案"><div class="native-dossier-art">${avatar(p.charId)}</div><div class="native-dossier-body"><button data-act="inspect-close" class="native-dossier-close" aria-label="关闭">×</button><h2>${esc(p.name)}${p.isGolden?' · 精锐':''}</h2><p class="native-dossier-kicker">${esc(data.branchRules.records.find(r=>r.id===p.branch)?.name||p.branch||'')} · ${p.rank} 阶</p><p id="native-dossier-hp" class="native-dossier-hp">生命 <b>${hp}</b><i>/${max}</i></p><div class="native-dossier-stats"><span>攻击 ${Math.round(a.atk)}</span><span>防御 ${Math.round(a.def)}</span><span>法抗 ${Math.round(a.magicResistance)}</span><span>攻速 ${Math.round(a.attackSpeed)}</span></div><div id="native-dossier-live" class="native-dossier-live"><p>阶段 ${esc(phase)}</p><p>状态 ${esc(statuses)}</p><h3>属性来源</h3><p>${parts}</p></div><h3>技能</h3>${owned?`<label>携带技能<select data-uid="${owned.uid}" id="native-skill" ${g.s.phase!=='prep'?'disabled':''}>${data.profiles[owned.chessId].skillChoices.map((v,i)=>`<option value="${i}" ${(owned.skillIndex??data.profiles[owned.chessId].skillIndex)===i?'selected':''}>${esc(v.skill?.name||'无主动技能')}</option>`).join('')}</select></label>`:`<p class="native-dossier-skill-name">${esc(p.skill?.name||'无主动技能')}</p>`}<p>${esc(skillDescription(p.skill)||'无主动技能')}</p><h3>卫戍</h3>${(p.garrisons||[]).map(x=>`<p>${esc(plain(x.description||x.garrisonDesc))}</p>`).join('')||'<p>无卫戍效果</p>'}${owned?`<p class="native-dossier-gear">${owned.equipment.map(i=>esc(itemName(i.chessId))).join('<br>')||'未携带装备'}</p>`:''}${t.shop?`<p class="native-dossier-buy">再次点击卡片购买 · ${t.price} ◆</p>`:''}${owned&&g.s.phase==='prep'?`<div class="native-dossier-acts"><button data-act="withdraw" data-uid="${owned.uid}">撤回整备区</button><button data-act="sell" data-uid="${owned.uid}">出售 +1 ◆</button></div>`:''}</div></aside>`;
}
function detail(){return state.inspect?'':'<h3>阵地指令</h3><p>点击干员或商店卡片查看档案。商店需再点一次才购买。</p>';}
function showRequired(){const g=state.game,r=g.s.rewardPending;if(r){g.ensureRewards();modal(`<h2>晋升／特殊调配</h2><p>选择获得一项奖励</p><div class="native-rewards">${r.offers.map(id=>`<button data-act="reward" data-id="${id}">${r.kind==='item'?'◇':avatar(data.profiles[id].charId)}<b>${esc(r.kind==='item'?itemName(id):data.profiles[id].name)}</b></button>`).join('')}</div>`);}else if(g.s.phase==='decision')modal(`<h2>机变决策</h2><div class="native-rewards">${g.s.roundDecisions.map(id=>{const e=data.season.effectInfoDataDict[id];return `<button data-act="decision" data-id="${id}"><b>${esc(e.effectName)}</b><p>${esc(plain(e.effectDesc))}</p></button>`;}).join('')}</div>`);}
function showResult(){const g=state.game,r=g.s.runResult||g.s.history.at(-1);if(!r)return;modal(`<h2>${r.kind==='training-dummy'?'木桩测试完成':'作战报告'}</h2><p>总伤害</p><strong class="native-total">${Math.round(r.totalDamage||0).toLocaleString()}</strong><p>${r.elapsed.toFixed(2)} 秒${r.dps!==undefined?' · DPS '+r.dps.toFixed(2):' · 击倒 '+r.kills+' · 漏失 '+r.leaks}</p>${(r.units||[]).sort((a,b)=>b.damage-a.damage).map(u=>`<div class="native-result-row"><span>${esc(g.s.units.find(x=>x.uid===u.uid)?data.profiles[g.s.units.find(x=>x.uid===u.uid).chessId].name:u.id||'其他')}</span><b>${Math.round(u.damage).toLocaleString()}</b></div>`).join('')}<button data-act="export">导出本次记录</button><button data-act="home">返回大厅</button>`);}
function action(button){const a=button.dataset.act,g=state.game,uid=Number(button.dataset.uid);if(button.disabled)return;
 if(a==='band'){state.band=button.dataset.id;render();return;}if(a==='limits'){showLimitations();return;}if(a==='branches'){showBranches(button.dataset.id||null);return;}if(a==='close'){if(g?.s.rewardPending||g?.s.phase==='decision')return;state.modal=null;renderModal();return;}
 if(a==='editor'){state.view='editor';state.waveTable=loadWaveTable();render();return;}
 if(a.startsWith('ed-')){
  const catalog=document.getElementById('ed-catalog');state.editor.scroll=catalog?.scrollTop||0;
  const result=applyEditorAction(a,button.dataset,state.waveTable,state.editor,data);
  if(result==='export'){const url=URL.createObjectURL(new Blob([JSON.stringify(state.waveTable,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='garrison-wave-table.json';link.click();URL.revokeObjectURL(url);return;}
  if(result==='import'){const input=document.createElement('input');input.type='file';input.accept='.json';input.onchange=async()=>{try{state.waveTable=saveWaveTable(normalizeWaveTable(JSON.parse(await input.files[0].text())));notice('已导入波次表');render();}catch(e){notice(e.message||'无法读取波次表');}};input.click();return;}
  if(result==='filled')notice('已写入本期该词条名单，难度值仍需逐个设定。');
  if(result==='defaults')notice('已恢复内置默认配置，下一次生成波次时生效。');
  if(result==='reset')notice('已清空全部词条池和自定义难度。');
  if(result)render();return;
 }
 if(a==='new'){const seed=(Date.now()&0xffffffff)>>>0;state.draft={modeId:state.mode,mapId:state.map,seed,roster:createWaveRoster({random:waveRng(seed),data,modeId:state.mode})};state.view='briefing';state.modal=null;render();return;}
 if(a==='begin'){if(!state.draft){state.view='lobby';render();return;}try{state.game=new NativeSession(data,{modeId:state.draft.modeId,bandId:state.band,mapId:state.draft.mapId,seed:state.draft.seed,waveRoster:state.draft.roster});state.view='game';state.draft=null;state.paused=false;state.expiresAt=null;state.selected=state.item=state.inspect=state.preview=state.modal=null;save();render();}catch(e){notice(e.message);}return;}
 if(a==='resume'){if(state.expiresAt&&Date.now()>=state.expiresAt){notice('暂离已超过24小时，请开始新模拟');return;}state.expiresAt=null;state.view='game';render();return;}if(a==='home'){if(state.view==='editor'||state.view==='briefing'){state.view='lobby';render();return;}state.view='lobby';state.paused=true;state.expiresAt??=Date.now()+86400000;state.modal=null;save();render();return;}if(a==='result'){showResult();return;}
 if(a==='export'){const url=URL.createObjectURL(new Blob([JSON.stringify(g.snapshot(),null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='garrison-round-'+g.s.round+'.json';link.click();URL.revokeObjectURL(url);return;}
 if(a==='import'){const input=document.createElement('input');input.type='file';input.accept='.json';input.onchange=async()=>{try{if(input.files[0].size>10e6)throw Error('存档文件过大');const record=JSON.parse(await input.files[0].text()),game=NativeSession.restore(data,record);if(!game)throw Error('存档版本、数据或有效期不匹配');state.game=game;state.view='game';state.paused=true;save();render();}catch(e){notice(e.message);}};input.click();return;}
 if(!g)return;
 if(a==='pause'){state.paused=!state.paused;render();return;}if(a==='speed'){state.speed=Number(button.dataset.speed);render();return;}
 if(a==='mute'){state.muted=!state.muted;savePreference('garrison-mute',state.muted?'1':'0');if(!state.muted)unlockAudio();render();return;}
 if(a==='reduce-fx'){state.reduceFx=!state.reduceFx;savePreference('garrison-reduce-fx',state.reduceFx?'1':'0');render();return;}
 if(a==='inspect-close'){state.inspect=null;render();return;}
 if(a==='select'){if(state.item){if(!g.perform('equip',state.item,uid)){const u=g.s.units.find(u=>u.uid===uid);if(u?.equipment.length>=2){modal(`<h2>选择替换的装备</h2>${u.equipment.map((e,i)=>`<button data-act="replace" data-uid="${uid}" data-slot="${i}">${esc(itemName(e.chessId))}</button>`).join('')}`);return;}}state.item=null;}state.selected=uid;state.inspect={kind:'unit',uid};state.preview=null;save();render();return;}
 if(a==='item'){if(inspectSame('pack',uid)){state.item=uid;notice('点击一名场上或整备区干员以装备／使用。');}else{state.item=null;state.selected=null;state.inspect={kind:'pack',uid};}render();return;}
 if(a==='replace'){g.perform('equip',state.item,uid,Number(button.dataset.slot));state.item=null;state.modal=null;save();render();return;}
 if(a==='bond-info'){const b=data.season.bondInfoDict[button.dataset.id];modal(`<h2>${esc(b.name)}</h2><p>${esc(plain(b.desc))}</p>`);return;}
 if(a==='aim'){if(state.preview){state.preview.dir=Number(button.dataset.dir);draw();}return;}if(a==='cancel'){state.preview=null;render();return;}if(a==='place-confirm'){commitPreview();return;}
 let ok;if(a==='buy'||a==='buyItem'){const kind=a==='buy'?'shop':'shopItem',index=Number(button.dataset.index);if(!inspectSame(kind,index)){state.inspect={kind,index};state.selected=null;state.item=null;render();return;}if(g.s.phase!=='prep'){notice('当前阶段不能购买');return;}ok=g.perform(a,index);if(ok){state.inspect=null;if(a==='buy')state.selected=g.s.units.at(-1)?.uid??null;}}else if(a==='reward'){ok=g.perform('takePromotion',button.dataset.id);state.modal=null;}else if(a==='decision'){ok=g.perform(a,button.dataset.id);state.modal=null;}else if(a==='sell'){ok=g.perform(a,uid);if(ok){state.selected=null;state.inspect=null;}}else if(a==='withdraw'){ok=g.perform(a,uid);}else if(['upgrade','refresh','lock','start','next','stop'].includes(a)){ok=g.perform(a);if(a==='start'){state.paused=false;resetFxClock();unlockAudio();}state.preview=null;if(a==='refresh')state.inspect=null;}else return;
 if(!ok)notice(g.lastError||'当前资金、位置或阶段不允许此操作');save();render();if(g.s.phase==='finished')showResult();
}
function updateHud(){const g=state.game;if(!g||state.view!=='game')return;const b=g.battle?.s,rounds=buildPhasePlan(data,g.s.modeId).filter(r=>!r.isConditional).length,status=document.getElementById('native-status');
 if(status){const time=b&&g.s.phase==='battle'?`<div><small>剩余时间</small><b>${Math.max(0,Math.ceil(b.limit-b.time))}<i> 秒</i></b></div><div><small>费用</small><b class="funds">${Math.floor(b.cost??20)}<i> ◆</i></b></div>`:`<div><small>剩余资金</small><b class="funds">${g.s.funds}<i> ◆</i></b></div>`;
  const wave=b&&g.s.phase==='battle'?`<div><small>波次</small><b>${b.kills}<i> / ${b.total}</i></b></div>`:`<div><small>回合</small><b>${g.s.round}<i>/${rounds}</i></b></div>`;
  status.innerHTML=`<div><small>生命</small><b class="hp">${g.s.hp}<i>/${g.s.maxHp}</i></b></div>${time}${wave}`;}
 const progress=document.getElementById('native-wave-progress');if(progress)progress.textContent=g.s.phase==='battle'&&b?`击倒 ${b.kills} / ${b.total} · 漏失 ${b.leaks}`:`${g.s.units.filter(u=>u.position).length} / ${g.s.capacity} 部署`;
 const live=document.getElementById('native-unit-live'),unit=g.battle?.s.units.find(u=>u.uid===state.selected);if(live)live.textContent=unit&&g.s.phase==='battle'?`当前生命 ${Math.round(unit.hp)}/${Math.round(unit.maxHp)} · 治疗 ${Math.round(unit.healing||0)} · 持续回复 ${Math.round(unit.regeneration||0)}`:'';
 const dossierHp=document.getElementById('native-dossier-hp');if(dossierHp&&state.inspect?.kind==='unit'){const seen=g.battle?.s.units.find(u=>u.uid===state.inspect.uid),row=g.s.units.find(u=>u.uid===state.inspect.uid);if(row){const a=seen&&g.battle?g.battle.stats(seen):profile(row).attributes,hp=Math.round(seen?.hp??a.maxHp),max=Math.round(seen?.maxHp??a.maxHp);dossierHp.innerHTML=`生命 <b>${hp}</b><i>/${max}</i>`;}}
 const dossierLive=document.getElementById('native-dossier-live');if(dossierLive&&state.inspect?.kind==='unit'){const seen=g.battle?.s.units.find(u=>u.uid===state.inspect.uid),row=g.s.units.find(u=>u.uid===state.inspect.uid);if(row){const a=seen&&g.battle?g.battle.stats(seen):profile(row).attributes,p=profile(row),fill=seen&&g.battle?spBarFill(seen,p.skill,g.battle.spCost(seen)):null,phase=seen?(seen.ammo>0?`弹药 ${seen.ammo}/${seen.ammoMax}`:seen.skillLeft>0?`技能持续 ${seen.skillLeft.toFixed(1)}s`:seen.down>0?`再部署 ${Math.ceil(seen.down)}s`:fill?.ready?'技力就绪':'待机'):'';dossierLive.innerHTML=`<p>阶段 ${esc(phase)}</p><p>状态 ${esc((seen?.statuses||[]).map(s=>s.kind).join('、')||'无')}</p><h3>属性来源</h3><p>${(a.parts||[]).map(x=>`${esc(x.src)} ${x.stat} ${x.layer} ${x.v}`).join('<br>')||'无额外加成'}</p>`;}}
 const el=document.getElementById('native-combat-stats');if(el&&g.battle&&g.s.phase==='battle'){const btl=g.battle.s,total=btl.benchmark?btl.enemies[0]?.damageLedger.total||0:Object.values(btl.damage).reduce((n,v)=>n+v,0);el.innerHTML=`<h3>${Math.max(0,Math.ceil(btl.limit-btl.time))} 秒</h3><p>伤害 ${Math.round(total).toLocaleString()}<br>击倒 ${btl.kills} / ${btl.total}<br>漏失 ${btl.leaks}</p>`;}}
function geometry(){const r=canvas.getBoundingClientRect(),v=state.game?.map.viewport||{left:0,right:10,top:0,bottom:6},cols=v.right-v.left+1,rows=v.bottom-v.top+1,tw=Math.min((r.width-32)/cols,(r.height-44)/rows/.82),th=tw*.82;return {r,tw,th,ox:(r.width-tw*cols)/2-v.left*tw,oy:(r.height-th*rows)/2-v.top*th};}
function cellAt(x,y){const z=geometry();return{x:Math.floor((x-z.r.left-z.ox)/z.tw),y:Math.floor((y-z.r.top-z.oy)/z.th)};}
function place(uid,x,y){
 const g=state.game,u=g.s.units.find(u=>u.uid===uid);if(!u||g.s.phase!=='prep')return;
 if(state.item){action({dataset:{act:'select',uid:String(uid)}});return;}
 if(!g.canDeploy(uid,x,y)){notice('该位置无法部署或交换此干员');return;}
 state.inspect=null;state.selected=uid;state.preview={uid,x,y,dir:null,revision:g.s.commands.length};render();
}
function commitPreview(){
 const p=state.preview,g=state.game;if(!p||p.dir===null){notice('请先选择朝向');return;}
 if(g.s.phase!=='prep'||g.s.commands.length!==p.revision){state.preview=null;notice('阵地已变化，请重新选择位置');render();return;}
 if(!g.perform('deploy',p.uid,p.x,p.y,p.dir))notice('该位置无法部署');
 state.preview=null;state.selected=null;state.inspect=null;save();render();
}
function insideRect(r,x,y){return !!r&&x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;}
function overCanvas(x,y){return canvas?.isConnected&&insideRect(canvas.getBoundingClientRect(),x,y);}
function overBench(x,y){return ['.native-bench','.native-bench-label'].some(selector=>insideRect(root.querySelector(selector)?.getBoundingClientRect(),x,y));}
function tileLift(tile,z){return (tile?.heightType==='HIGHLAND'||tile?.tileKey==='tile_fence_bound')&&tile.buildableType!=='NONE'?Math.min(10,z.th*.22):0;}
function unitAtPointer(x,y){
 const g=state.game,z=geometry(),px=x-z.r.left,py=y-z.r.top,size=Math.min(z.tw*.68,z.th*1.1);
 const units=g.s.units.filter(u=>u.position).slice().sort((a,b)=>b.position.y-a.position.y||b.position.x-a.position.x);
 for(const u of units){const cx=z.ox+(u.position.x+.5)*z.tw,cy=z.oy+(u.position.y+.5)*z.th-tileLift(g.map.grid[u.position.y][u.position.x],z)*.5;if(px>=cx-size/2-3&&px<=cx+size/2+3&&py>=cy-size*.75-3&&py<=cy+size*.35+14)return u;}
 if(g.battle){
  const summons=(g.battle.s.summons||[]).filter(s=>s.deployed).slice().sort((a,b)=>b.y-a.y||b.x-a.x);
  for(const s of summons){const cx=z.ox+(s.x+.5)*z.tw,cy=z.oy+(s.y+.5)*z.th-tileLift(g.map.grid[s.y]?.[s.x],z)*.5;if(px>=cx-size/2-3&&px<=cx+size/2+3&&py>=cy-size*.75-3&&py<=cy+size*.35+14)return {uid:s.uid,kind:'summon',summon:true};}
 }
 const cell=cellAt(x,y);return units.find(u=>u.position.x===cell.x&&u.position.y===cell.y);
}
function dragFeedback(){
 const bench=root.querySelector('.native-bench'),hint=document.getElementById('native-drop-hint'),over=drag?.moved&&drag.from==='field'&&overBench(drag.x,drag.y),full=state.game?.hand().length>=10;
 bench?.classList.toggle('drop-target',!!over&&!full);bench?.classList.toggle('drop-blocked',!!over&&full);
 const text=over?(full?'整备区已满，无法收回':'松手将干员移回整备区'):'可将场上干员拖回此处；换位后重新选朝向';if(hint&&hint.textContent!==text)hint.textContent=text;
 let ghost=document.getElementById('native-drag-ghost');if(!drag?.moved){ghost?.remove();return;}
 if(!ghost){ghost=document.createElement('div');ghost.id='native-drag-ghost';ghost.className='native-drag-ghost';ghost.setAttribute('aria-hidden','true');const u=state.game.s.units.find(u=>u.uid===drag.uid);ghost.innerHTML=avatar(u.charId);root.append(ghost);}ghost.style.left=(drag.x-28)+'px';ghost.style.top=(drag.y-36)+'px';
}
function clearDrag(){drag=null;canvasPress=null;touchButton=null;dragFeedback();}
function drawTerrain(c,z,map){
 for(let y=0;y<map.rows;y++)for(let x=0;x<map.cols;x++){
  const t=map.grid[y][x];if(t.zone)continue;const px=z.ox+x*z.tw+2,py=z.oy+y*z.th+2,w=z.tw-4,h=z.th-4,lift=tileLift(t,z),entry=t.tileKey.startsWith('tile_start'),goal=t.tileKey.startsWith('tile_end'),blocked=!!t.obstacle;
  c.fillStyle='#071216';c.fillRect(px,py+3,w,h);
  if(lift&&!blocked){const top=c.createLinearGradient(px,py,px+w,py+h-lift);top.addColorStop(0,'#a4b7bd');top.addColorStop(1,'#718b98');c.fillStyle=top;c.fillRect(px,py,w,h-lift);c.fillStyle='#314c5c';c.fillRect(px,py+h-lift,w,lift);c.strokeStyle='#d7e5e9';c.lineWidth=1.2;c.strokeRect(px+.5,py+.5,w-1,h-lift-1);c.strokeStyle='#182e3b';c.beginPath();c.moveTo(px,py+h);c.lineTo(px+w,py+h);c.stroke();c.fillStyle='#dce8eb';c.font=Math.max(8,Math.min(10,z.tw*.16))+'px sans-serif';c.textAlign='right';c.fillText(t.heightType==='HIGHLAND'?'高台':'隔离平台',px+w-3,py+h-2);}
  else{const top=c.createLinearGradient(px,py,px,py+h);top.addColorStop(0,entry?'#824537':goal?'#356c7b':blocked?'#1a282e':'#42565b');top.addColorStop(1,entry?'#49291f':goal?'#203e4d':blocked?'#121e24':'#2a3c42');c.fillStyle=top;c.fillRect(px,py,w,h);c.strokeStyle=entry?'#ffad7c':goal?'#8bdcea':blocked?'#36464d':'#61767b';c.lineWidth=entry||goal?2:.8;c.strokeRect(px+.5,py+.5,w-1,h-1);
   if(blocked){c.save();c.beginPath();c.rect(px,py,w,h);c.clip();c.strokeStyle='#69828a22';c.lineWidth=1;for(let i=-h;i<w;i+=10){c.beginPath();c.moveTo(px+i,py+h);c.lineTo(px+i+h,py);c.stroke();}c.restore();c.fillStyle='#607780';c.font=Math.max(9,Math.min(13,z.tw*.22))+'px sans-serif';c.textAlign='center';c.fillText('工事',px+w/2,py+h/2+4);}
   else if(entry||goal){c.fillStyle=entry?'#ffc39b':'#b8f1fb';c.textAlign='center';c.font='bold '+Math.max(9,Math.min(14,z.tw*.24))+'px sans-serif';c.fillText(entry?'入口':'目标',px+w/2,py+h/2+4);}
   else{c.strokeStyle='#91a6ac50';c.lineWidth=1;for(const [cx,cy,sx,sy]of [[px+3,py+3,1,1],[px+w-3,py+3,-1,1],[px+3,py+h-3,1,-1],[px+w-3,py+h-3,-1,-1]]){c.beginPath();c.moveTo(cx+sx*4,cy);c.lineTo(cx,cy);c.lineTo(cx,cy+sy*4);c.stroke();}c.fillStyle='#a6b7b966';c.textAlign='left';c.font='9px sans-serif';c.fillText(t.buildableType==='NONE'?'通道':'地',px+4,py+h-4);}
  }
 }
 c.font='9px monospace';c.textAlign='center';c.fillStyle='#a7bebc';for(let x=map.viewport.left;x<=map.viewport.right;x++)c.fillText(String.fromCharCode(65+x),z.ox+(x+.5)*z.tw,z.oy-5);for(let y=map.viewport.top;y<=map.viewport.bottom;y++)c.fillText(y+1,Math.max(8,z.ox+map.viewport.left*z.tw-10),z.oy+(y+.5)*z.th+3);
}
function draw(){
 if(!canvas||state.view!=='game'||!state.game)return;const g=state.game,z=geometry(),dpr=Math.min(2,window.devicePixelRatio||1);if(canvas.width!==Math.round(z.r.width*dpr)||canvas.height!==Math.round(z.r.height*dpr)){canvas.width=Math.round(z.r.width*dpr);canvas.height=Math.round(z.r.height*dpr);}const c=canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,z.r.width,z.r.height);const point=(x,y)=>({x:z.ox+(x+.5)*z.tw,y:z.oy+(y+.5)*z.th});c.fillStyle='#111f23';c.fillRect(0,0,z.r.width,z.r.height);
 drawTerrain(c,z,g.map);
 const selected=g.s.units.find(u=>u.uid===(state.preview?.uid||state.selected)),live=selected&&g.battle?g.battle.s.units.find(u=>u.uid===selected.uid):null;
 if(selected&&(selected.position||state.preview)){
  const p=state.preview||{...selected.position,dir:selected.dir};
  const cells=g.s.phase==='battle'&&!state.preview&&g.battle&&live?g.battle.range(live,g.battle.skillActive(live)):((profile(selected).range?.grids||[]).concat(profile(selected).branch==='fortress'?[{row:0,col:0}]:[]).map(cell=>{let x=cell.col,y=-cell.row;for(let i=0;i<(p.dir??0);i++)[x,y]=[-y,x];return{x:p.x+x,y:p.y+y};}));
  for(const cell of cells)c.fillStyle='#63d8b738',c.fillRect(z.ox+cell.x*z.tw+2,z.oy+cell.y*z.th+2,z.tw-4,z.th-4);
 }
 const statusOverlays=[];
 const actors=g.s.phase==='battle'||g.s.phase==='finished'||g.s.phase==='intermission'?g.battle?.s.units||[]:g.s.units.filter(u=>u.position).map(u=>({...u,x:u.position.x,y:u.position.y,id:u.charId,deployed:true}));
 for(const u of actors){
  const shift=g.battle&&!state.reduceFx?actorOffset(u,g.battle):{x:0,y:0};
  const p=point(u.x+shift.x,u.y+shift.y);p.y-=tileLift(g.map.grid[u.y]?.[u.x],z)*.5;const im=img(u.id),size=Math.min(z.tw*.68,z.th*1.1);
  const waiting=!u.deployed&&u.hp>0,down=!u.deployed&&u.hp<=0;
  c.globalAlpha=waiting?0.45:down?0.3:1;
  c.fillStyle=data.profiles[u.chessId]?.isGolden?'#f3ce74':'#b8e7d8';c.fillRect(p.x-size/2-2,p.y-size*.75-2,size+4,size+4);if(im?.complete&&im.naturalWidth)c.drawImage(im,p.x-size/2,p.y-size*.75,size,size);
  if(u.skillLeft>0||u.ammo>0){c.strokeStyle='#f4d38b';c.lineWidth=2;c.strokeRect(p.x-size/2-3,p.y-size*.75-3,size+6,size+6);}
  c.globalAlpha=1;c.fillStyle='#d5fff1';c.font='14px sans-serif';c.textAlign='center';c.fillText(['→','↓','←','↑'][u.dir],p.x+size*.65,p.y);
  statusOverlays.push(()=>{
  if(u.hp!==undefined&&u.deployed){c.fillStyle='#122022';c.fillRect(p.x-size/2,p.y+size*.35,size,4);c.fillStyle='#75d9aa';c.fillRect(p.x-size/2,p.y+size*.35,size*Math.max(0,u.hp/u.maxHp),4);}
  const sk=profile(u)?.skill,cost=g.battle&&u.sp!==undefined?g.battle.spCost(u):sk?.spData?.spCost||0,fill=spBarFill(u,sk,cost);if(fill&&u.deployed){const bx=p.x-size/2,by=p.y+size*.35+(u.hp!==undefined?6:0);if(fill.kind==='ammo'){const n=fill.cells,gap=1,cw=Math.max(1,(size-(n-1)*gap)/n);for(let i=0;i<n;i++){c.fillStyle='#122022';c.fillRect(bx+i*(cw+gap),by,cw,4);if(i<fill.filled){c.fillStyle='#f4d38b';c.fillRect(bx+i*(cw+gap),by,cw,4);}}}else{c.fillStyle='#122022';c.fillRect(bx,by,size,3);c.fillStyle=fill.on?'#f4d38b':fill.ready?'#f0d18a':'#7bbaf3';c.fillRect(bx,by,size*fill.ratio,3);}}
  if(g.battle)drawStatuses(c,p.x,p.y,u,size);if(down)drawDownRing(c,p,u,size);
  });
 }
 if(g.battle)for(const s of g.battle.s.summons||[]){
  if(!s.deployed)continue;
  const p=point(s.x,s.y);p.y-=tileLift(g.map.grid[s.y]?.[s.x],z)*.5;const size=Math.min(z.tw*.5,z.th*.8);
  c.fillStyle=s.device?'#7ec8e3':'#c9a56a';c.beginPath();c.moveTo(p.x,p.y-size*.55);c.lineTo(p.x+size*.4,p.y);c.lineTo(p.x,p.y+size*.45);c.lineTo(p.x-size*.4,p.y);c.closePath();c.fill();
  c.strokeStyle='#f4efe2';c.lineWidth=state.inspect?.kind==='summon'&&state.inspect.uid===s.uid?2:1;c.stroke();
  statusOverlays.push(()=>{
  c.fillStyle='#122022';c.fillRect(p.x-size/2,p.y+size*.35,size,4);c.fillStyle='#75d9aa';c.fillRect(p.x-size/2,p.y+size*.35,size*Math.max(0,s.hp/s.maxHp),4);
  drawStatuses(c,p.x,p.y,s,size);
  c.fillStyle='#e9fff7';c.font='10px sans-serif';c.textAlign='center';c.fillText(s.name||s.type,p.x,p.y-size*.65);
  });
 }
 if(g.battle&&g.s.phase!=='prep')for(const e of g.battle.s.enemies){if(e.hidden)continue;const p=point(e.x,e.y),im=img(e.id),size=z.tw*.55;if(e.trainingDummy){c.fillStyle='#be9364';c.fillRect(p.x-7,p.y-20,14,40);c.fillRect(p.x-20,p.y-10,40,10);c.fillStyle='#fff0c8';c.font='bold 22px sans-serif';c.fillText('∞',p.x,p.y-26);}else{if(im?.complete&&im.naturalWidth)c.drawImage(im,p.x-size/2,p.y-size/2-(e.flying?15:0),size,size);else{c.fillStyle='#d9846d';c.beginPath();c.arc(p.x,p.y,12,0,Math.PI*2);c.fill();}statusOverlays.push(()=>{c.fillStyle='#e29179';c.fillRect(p.x-size/2,p.y-size*.65-(e.flying?15:0),size*Math.max(0,e.hp/e.maxHp),3);drawStatuses(c,p.x,p.y-(e.flying?15:0),e,size);});}}
 if(g.battle&&g.s.phase==='battle')drawFx(c,point,z,g.battle,{reduceFx:state.reduceFx});
 if(drag?.moved&&overCanvas(drag.x,drag.y)){const cell=cellAt(drag.x,drag.y);if(g.map.grid[cell.y]?.[cell.x]){c.strokeStyle=g.canDeploy(drag.uid,cell.x,cell.y)?'#78f1bd':'#f88c78';c.lineWidth=3;c.strokeRect(z.ox+cell.x*z.tw+2,z.oy+cell.y*z.th+2,z.tw-4,z.th-4);}}
 if(state.preview){const p=point(state.preview.x,state.preview.y);c.fillStyle='#08151195';c.fillRect(0,0,z.r.width,z.r.height);c.strokeStyle='#70e4c1';c.lineWidth=2;c.beginPath();c.moveTo(p.x,p.y-62);c.lineTo(p.x+62,p.y);c.lineTo(p.x,p.y+62);c.lineTo(p.x-62,p.y);c.closePath();c.stroke();c.fillStyle='#e9fff7';c.font='bold 32px sans-serif';c.fillText(state.preview.dir===null?'✥':['→','↓','←','↑'][state.preview.dir],p.x,p.y+10);}
 // HUD is the final canvas pass: portraits and combat effects cannot cover it.
 for(const drawOverlay of statusOverlays){c.save();c.globalAlpha=1;drawOverlay();c.restore();}
}
root.addEventListener('change',e=>{
 if(e.target.id==='native-mode')state.mode=e.target.value;if(e.target.id==='native-map')state.map=e.target.value;if(e.target.id==='native-skill'){state.game.perform('skill',Number(e.target.dataset.uid),Number(e.target.value));save();render();}
 if(state.view==='editor'&&e.target.dataset.act){const catalog=document.getElementById('ed-catalog');state.editor.scroll=catalog?.scrollTop||0;if(applyEditorField(e.target.dataset.act,e.target.dataset.id,e.target.value,state.waveTable,state.editor)){if(['ed-budget','ed-cost','ed-default','ed-temp-name'].includes(e.target.dataset.act)){const sample=root.querySelector('.wave-ed-sample');if(sample)sample.textContent='配置已更新，点击“预演抽取”查看新结果。';}else queueMicrotask(()=>render());}}
});
root.addEventListener('input',e=>{
 if(e.target.id==='native-volume'){state.volume=Number(e.target.value);savePreference('garrison-volume',String(state.volume));return;}
 if(e.target.id!=='ed-search')return;state.editor.query=e.target.value;state.editor.caret=e.target.selectionStart||e.target.value.length;state.editor.keepSearch=true;const catalog=document.getElementById('ed-catalog');state.editor.scroll=catalog?.scrollTop||0;render();
});
root.addEventListener('click',e=>{if(e.pointerType==='touch'||(e.pointerId===ignoredClickPointer&&performance.now()<ignoredClickUntil))return;
 if(state.view==='editor'){const hit=e.target.closest('[data-act]');if(!hit||hit.matches('input,select,textarea'))return;action(hit);return;}
 const button=e.target.closest('button[data-act]');if(button)action(button);
});
root.addEventListener('pointerdown',e=>{
 if(e.isPrimary===false||e.button!==0)return;ignoredClickPointer=null;ignoredClickUntil=0;
 const button=e.target.closest('button[data-act]');if(e.pointerType==='touch'&&button&&!button.disabled)touchButton={b:button,id:e.pointerId,x:e.clientX,y:e.clientY};
 const manage=state.game?.s.phase==='prep'&&!state.game.s.rewardPending&&!state.modal;
 if(button?.dataset.act==='select'&&manage&&!state.item){state.preview=null;root.querySelector('.native-facing')?.setAttribute('hidden','');drag={uid:Number(button.dataset.uid),id:e.pointerId,from:'hand',x0:e.clientX,y0:e.clientY,x:e.clientX,y:e.clientY,moved:false};button.setPointerCapture(e.pointerId);return;}
 if(e.target!==canvas)return;
 if(state.preview&&manage){const z=geometry(),x=z.r.left+z.ox+(state.preview.x+.5)*z.tw,y=z.r.top+z.oy+(state.preview.y+.5)*z.th;if(Math.hypot(e.clientX-x,e.clientY-y)>95){state.preview=null;render();return;}aim={x,y,id:e.pointerId};canvas.setPointerCapture(e.pointerId);return;}
 const cell=cellAt(e.clientX,e.clientY),unit=unitAtPointer(e.clientX,e.clientY);canvasPress={...cell,uid:unit?.uid,x0:e.clientX,y0:e.clientY};
 if(unit&&manage&&!state.item&&!unit.summon)drag={uid:unit.uid,id:e.pointerId,from:'field',x0:e.clientX,y0:e.clientY,x:e.clientX,y:e.clientY,moved:false};canvas.setPointerCapture(e.pointerId);
});
root.addEventListener('pointermove',e=>{
 if(touchButton&&Math.hypot(e.clientX-touchButton.x,e.clientY-touchButton.y)>8)touchButton=null;
 if(drag&&drag.id===e.pointerId){drag.x=e.clientX;drag.y=e.clientY;if(Math.hypot(e.clientX-drag.x0,e.clientY-drag.y0)>8)drag.moved=true;if(drag.moved){canvasPress=null;touchButton=null;dragFeedback();draw();}}
 if(aim&&aim.id===e.pointerId&&state.preview){const dx=e.clientX-aim.x,dy=e.clientY-aim.y;state.preview.dir=Math.hypot(dx,dy)<18?null:Math.abs(dx)>Math.abs(dy)?dx>0?0:2:dy>0?1:3;draw();}
});
root.addEventListener('pointerup',e=>{
 if(drag&&drag.id===e.pointerId){const d=drag;if(d.moved){ignoredClickPointer=e.pointerId;ignoredClickUntil=performance.now()+400;clearDrag();state.inspect=null;
   if(d.from==='field'&&overBench(e.clientX,e.clientY)){if(state.game.perform('withdraw',d.uid)){state.selected=state.preview=null;save();notice('已移回整备区');}else notice('整备区已满或当前阶段无法收回');render();}
   else if(overCanvas(e.clientX,e.clientY)){const cell=cellAt(e.clientX,e.clientY);place(d.uid,cell.x,cell.y);}else render();return;
  }drag=null;dragFeedback();if(d.from==='field'){canvasPress=null;action({dataset:{act:'select',uid:String(d.uid)}});return;}}
 if(aim&&aim.id===e.pointerId){aim=null;ignoredClickPointer=e.pointerId;ignoredClickUntil=performance.now()+400;if(state.preview&&state.preview.dir!==null)commitPreview();else{state.preview=null;render();}return;}
 if(canvasPress){const press=canvasPress;canvasPress=null;if(overCanvas(e.clientX,e.clientY)){const cell=cellAt(e.clientX,e.clientY);if(press.uid){const summon=state.game.battle?.s.summons?.find(s=>s.uid===press.uid);if(summon){state.inspect={kind:'summon',uid:press.uid};state.selected=null;render();}else action({dataset:{act:'select',uid:String(press.uid)}});}else if(state.selected)place(state.selected,cell.x,cell.y);}}
 if(touchButton){const t=touchButton;touchButton=null;if(t.id===e.pointerId&&t.b.isConnected&&e.target.closest('button[data-act]')===t.b)action(t.b);}
});
root.addEventListener('pointercancel',()=>{clearDrag();aim=null;state.preview=null;render();});
document.addEventListener('keydown',e=>{if(e.target.matches('input,select,textarea'))return;if(e.key==='Escape'){clearDrag();aim=null;state.preview=null;state.selected=null;state.inspect=null;if(!state.game?.s.rewardPending&&state.game?.s.phase!=='decision')state.modal=null;render();}if(state.preview){const d={ArrowRight:0,ArrowDown:1,ArrowLeft:2,ArrowUp:3}[e.key];if(d!==undefined){e.preventDefault();state.preview.dir=d;draw();}if(e.key==='Enter')commitPreview();}});
window.addEventListener('beforeunload',()=>{state.expiresAt??=Date.now()+86400000;save();});document.addEventListener('visibilitychange',()=>{if(document.hidden){state.paused=true;state.expiresAt??=Date.now()+86400000;save();}});
function frame(now){const dt=Math.min(.15,(now-last)/1000);last=now;const g=state.game;if(state.view==='game'&&g?.s.phase==='battle'&&!state.paused){acc+=dt*state.speed;const previous=g.s.phase;while(acc>=1/30&&g.s.phase==='battle'){acc-=1/30;g.tick();}if(g.battle)playBattleEvents(g.battle.s,state.muted,state.volume);if(g.s.phase!==previous){acc=0;save();render();if(g.s.phase==='finished'){notice('模拟结束，总伤害 '+Math.round(g.s.runResult?.totalDamage||0).toLocaleString());showResult();}}}else acc=0;hudTime+=dt;saveTime+=dt;if(hudTime>.2){updateHud();hudTime=0;}if(saveTime>2&&g){save();saveTime=0;}draw();requestAnimationFrame(frame);}
root.setAttribute('data-view','native');root.addEventListener('pointerdown',()=>unlockAudio(),{once:true});render();document.getElementById('boot-screen')?.remove();clearTimeout(window.__garrisonBootTimer);window.__garrisonReady=true;requestAnimationFrame(frame);
