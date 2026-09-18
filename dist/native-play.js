import {nativeWavePlan} from './native-waves.js';
import {TRAINING_TYPES,loadWaveTable,normalizeWaveTable,saveWaveTable} from './native-wave-fill.js';
import {createWaveRoster,trainingType,waveRng} from './native-wave-random.js';
import {applyEditorAction,applyEditorField,editorState,renderWaveEditor} from './native-wave-editor.js';
import {NATIVE_DATA} from './runtime-data.js';
import {NativeSession} from './native-session.js';
import {NativeBattle} from './native-battle.js';
import {renderLobby} from './native-lobby.js';
import {buildPhasePlan} from './protocol.js';
import {strategyCoverage} from './strategy.js';
import {spBarFill} from './native-sp.js';
import {playBattleEvents,resetFxClock,unlockAudio,actorOffset,drawFx,drawStatuses,drawElementRing,drawDownRing,drawFrostOverlay,drawWhitwEyes} from './native-fx.js';
import {renderSkillDescription} from './native-skill-text.js';
import {EGG_BASE_MODE,EGG_MODE_ID,apply325Display,egg325Active,format325,rewrite325Text} from './native-325.js';

const CAT_MODE_ID='mode_cat_all',CAT_BASE_MODE='mode_single_normal';
const data=NATIVE_DATA,root=document.getElementById('app'),strategyCoverageById=Object.fromEntries(strategyCoverage(data).map(x=>[x.id,x])),SAVE='garrison-native-manual-v1',CHECKPOINT_SAVE='garrison-native-safe-v1',VIEW_SAVE='garrison-native-view-v1';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plain=s=>String(s||'').replace(/<[^>]+>/g,'').replace(/\\n/g,'\n');
const imageCache=new Map(),img=id=>{const file=data.assets[id];if(!file)return null;if(!imageCache.has(file)){const im=new Image();im.src='./'+file;imageCache.set(file,im);}return imageCache.get(file);};
function preference(key,fallback){try{return localStorage.getItem(key)??fallback;}catch{return fallback;}}
function savePreference(key,value){try{localStorage.setItem(key,value);}catch{}}
const mobilePlay=()=>matchMedia('(hover:none) and (pointer:coarse)').matches;
const iosMobile=()=>/iPhone|iPad|iPod/i.test(navigator.platform)||/iPhone|iPad|iPod/i.test(navigator.userAgent)||(/Macintosh/i.test(navigator.userAgent)&&navigator.maxTouchPoints>1);
function syncPlayChrome(){
 const locked=document.documentElement.classList.contains('native-play-lock');
 const compact=matchMedia('(orientation:landscape) and (max-height:600px) and (max-width:1100px)').matches;
 const need=locked&&matchMedia('(orientation:portrait)').matches;
 document.documentElement.classList.toggle('native-landscape-ui',locked||compact);
 document.documentElement.classList.toggle('native-need-rotate',need);
 const app=document.getElementById('app');
 if(!app)return;
 if(need){app.style.setProperty('width',innerHeight+'px','important');app.style.setProperty('height',innerWidth+'px','important');}
 else{app.style.removeProperty('width');app.style.removeProperty('height');}
}
async function enterPlayChrome(){
 if(!mobilePlay()||iosMobile())return;
 document.documentElement.classList.add('native-play-lock');
 syncPlayChrome();
 const node=document.documentElement;
 try{if(!(document.fullscreenElement||document.webkitFullscreenElement))await (node.requestFullscreen||node.webkitRequestFullscreen).call(node);}catch{}
 try{await screen.orientation?.lock?.('landscape');}catch{}
 syncPlayChrome();
}
async function leavePlayChrome(){
 document.documentElement.classList.remove('native-play-lock','native-need-rotate');
 try{screen.orientation?.unlock?.();}catch{}
 try{if(document.fullscreenElement||document.webkitFullscreenElement)await (document.exitFullscreen||document.webkitExitFullscreen).call(document);}catch{}
 syncPlayChrome();
}
const portraitQuery=matchMedia('(orientation:portrait)');
if(portraitQuery.addEventListener)portraitQuery.addEventListener('change',syncPlayChrome);else portraitQuery.addListener(syncPlayChrome);
window.addEventListener('resize',syncPlayChrome);
const state={supplyCollapsed:false,expiresAt:null,game:null,draft:null,sandbox:null,view:'lobby',mode:'mode_single_normal',band:'band_amiya',strategyDraft:null,map:data.maps.find(m=>m.weight>0).stageId,selected:null,summonSelected:null,item:null,inspect:null,preview:null,paused:false,speed:1,muted:preference('garrison-mute','0')==='1',reduceFx:preference('garrison-reduce-fx','0')==='1',volume:Math.max(0,Math.min(1,Number(preference('garrison-volume','1'))||0)),modal:null,editor:editorState(),waveTable:loadWaveTable()};
let canvas,drag=null,canvasPress=null,aim=null,touchButton=null,last=performance.now(),acc=0,hudTime=0,saveTime=0,ignoredClickPointer=null,ignoredClickUntil=0,dossierDismissedAt=0;
function readSave(key){try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):null;}catch{return null;}}
function savedView(){try{return sessionStorage.getItem(VIEW_SAVE)||'lobby';}catch{return 'lobby';}}
function rememberView(view){try{sessionStorage.setItem(VIEW_SAVE,view);}catch{}}
function restoreSavedGame(){for(const key of [CHECKPOINT_SAVE,SAVE]){const record=readSave(key),game=record&&NativeSession.restore(data,record);if(game)return {game,record};}return null;}
try{const restored=restoreSavedGame();if(restored){state.game=restored.game;state.paused=true;state.expiresAt=restored.record.expiresAt??null;if(savedView()==='game'){state.view='game';enterPlayChrome();}}}catch{}
const profile=u=>{const base=data.profiles[u.chessId],selected=base?.skillChoices?.[u.skillIndex];return selected?{...base,...selected}:base;};
const avatar=id=>data.assets[id]?`<img src="./${data.assets[id]}" alt="" loading="lazy" draggable="false">`:'';
function save(){if(!state.game||state.sandbox)return;try{localStorage.setItem(SAVE,JSON.stringify({...state.game.snapshot(),expiresAt:state.expiresAt}));if(['intermission','finished'].includes(state.game.s.phase))saveCheckpoint();}catch{notice('进度未能写入浏览器存储，可使用导出存档。');}}
function saveCheckpoint(){if(!state.game||state.sandbox)return;try{const record=state.game.snapshot();record.battle=null;localStorage.setItem(CHECKPOINT_SAVE,JSON.stringify({...record,expiresAt:state.expiresAt}));}catch{notice('安全回合点未能写入浏览器存储。');}}
function notice(s){const t=document.getElementById('toast');t.textContent=eggOn()?rewrite325Text(s):s;t.classList.add('visible');clearTimeout(notice.timer);notice.timer=setTimeout(()=>t.classList.remove('visible'),4000);}
function currentTurn(){return buildPhasePlan(data,state.game.s.modeId).find(t=>t.round===state.game.s.round);}
function modal(html){state.modal=html;renderModal();}
let painting=false;
function eggOn(){return egg325Active(state);}
// 海猫模式：整备资金视为无限，界面上以彩色 ALL 代替金额。
function catOn(){return !!(state.draft?.cat||state.game?.s?.cat);}
function fundsMarkup(funds){return catOn()?'<b class="funds native-funds-all">ALL</b>':`<b class="funds">${funds}<i> ◆</i></b>`;}
function canvasNumber(n){return eggOn()?format325(n):String(n);}
function paint325(target=root){
 const on=eggOn();
 document.documentElement.classList.toggle('egg-325',on);
 if(on&&target)apply325Display(target);
}
function renderModal(){const el=document.getElementById('native-modal');if(el)el.remove();if(!state.modal)return;const el2=document.createElement('div');el2.id='native-modal';el2.className='native-modal';el2.innerHTML=`<section role="dialog" aria-modal="true"><button data-act="close" class="native-close" aria-label="关闭">×</button>${state.modal}</section>`;root.append(el2);if(!painting)paint325(el2);}
function showBranches(id=null){
 const all=data.branchRules.records,records=id?all.filter(r=>r.id===id):all;
 modal(`<h2>职业分支规则</h2><p>已记录 ${all.length} 个历史分支，${all.filter(r=>r.inCurrentMode).length} 个出现在本期固定预设中。这里区分分支基础逻辑与干员专属技能、天赋、模组；复杂机制仍有待补齐项。</p><div class="native-branch-catalog">${records.map(r=>`<details ${id?'open':''}><summary><b>${esc(r.name)}</b><span>${r.inCurrentMode?'本期包含':'非本期固定预设'} · ${r.runtime.status==='partial'?'部分接入':'基础行为已接入'}</span></summary><p>${esc(r.baseTrait)}</p><p>${r.pending.length?'待补齐：'+r.pending.map(esc).join('、'):'专属技能／天赋／模组例外另行处理。'}</p><a href="${r.sources[1].url}" target="_blank" rel="noreferrer">PRTS 特性细则 · 修订 ${r.sources[1].revision} ↗</a></details>`).join('')}</div>`);
}
function showLimitations(){modal(`<h2>手动验收版 · 已知差异</h2><p>主入口已使用下半期数据和新对局控制器。该版本不代表完全还原，未运行本轮自动或浏览器测试。</p><ul>${data.limitations.map(s=>`<li>${esc(s)}</li>`).join('')}</ul><p>请导出当前存档，连同复现步骤提交问题。</p><a href="https://github.com/Yilegendoflink/garrison-protocol/issues" target="_blank" rel="noreferrer">反馈问题 ↗</a>`);}
const sandboxOperators=Object.values(data.profiles).filter(p=>p?.charId).map(p=>({id:p.chessId,charId:p.charId,name:p.name,rank:p.rank,isGolden:p.isGolden,position:p.position}));
const sandboxEnemies=Object.entries(data.enemies).map(([id,e])=>({id,name:e.name,applyWay:e.applyWay,motion:e.motion}));
function newSandbox(){const economy=new NativeSession(data,{modeId:'mode_single_normal',bandId:'band_bldsk',mapId:state.map,seed:1});economy.s.units=[];economy.s.items=[];economy.s.offers=[];economy.s.itemOffers=[];economy.s.funds=9999;economy.s.phase='prep';economy.s.rewardPending=null;return {economy,battle:null,phase:'setup',opQuery:'',enemyQuery:'',selectedUid:null,enemyDrafts:[],nextUid:1,enemySeq:0};}
function openSandbox(){if(!state.sandbox){state.sandbox=newSandbox();state.sandbox.previousGame=state.game;state.sandbox.previousView='lobby';}state.game=state.sandbox.economy;state.view='game';state.paused=true;state.modal=null;render();}
function sandboxAddOperator(id){const sb=state.sandbox,p=data.profiles[id],shop=data.season.charShopChessDatas[id]||data.season.charShopChessDatas[data.season.chessNormalIdLookupDict[id]];if(!sb||sb.phase!=='setup'||!p||!shop)return;const u={uid:++sb.nextUid,chessId:id,charId:p.charId,rank:p.rank||shop.chessLevel,position:null,dir:0,equipment:[],bondIds:data.season.charChessDataDict[id]?.bondIds||[]};sb.economy.s.units.push(u);sb.selectedUid=u.uid;state.selected=u.uid;state.item=null;render();}
function sandboxSpawnEnemy(id,dummy=false){const sb=state.sandbox;if(!sb)return;if(sb.phase==='setup'){sb.enemyDrafts.push({id,dummy,uid:++sb.enemySeq});render();return;}if(!sb.battle)return;const raw=data.enemies[id];if(!raw)return;const flying=raw.motion==='FLY',route=Math.max(0,sb.battle.level.routes.findIndex(r=>r.motionMode===(flying?'FLY':'WALK')));try{sb.battle.spawn({id,route});const e=sb.battle.s.enemies.at(-1),i=sb.enemySeq++;const spots=[[8,1],[8,2],[8,3],[7,1],[7,2],[7,3],[6,1],[6,2]];const spot=spots[i%spots.length];e.x=spot[0];e.y=spot[1];e.progress=0;e.cmd=0;if(dummy){e.trainingDummy=true;e.canAttack=false;e.ranged=false;e.speed=0;e.interval=999;e.route=[];e.leak=0;e.block=null;e.name='测试木桩';e.def=0;e.res=0;e.baseDef=0;e.baseRes=0;e.damageResistance=0;}sb.enemyDrafts.push({id,dummy,uid:e.uid});sb.battle.s.total=sb.battle.s.enemies.length;render();}catch(error){notice(error.message||'无法生成敌人');}}
function sandboxStart(){const sb=state.sandbox;if(!sb||sb.phase!=='setup')return;if(!sb.economy.s.units.some(u=>u.position)){notice('请先添加并放置至少一名干员');return;}if(!sb.economy.beginBattle()){notice('无法开始测试场景');return;}const turn=buildPhasePlan(data,'mode_single_normal')[0],b=new NativeBattle(data,sb.economy,sb.economy.map,turn);b.s.queue=[];b.s.enemies=[];b.s.total=0;b.s.limit=1e9;for(const u of b.s.units){u.deployAt=0;b.deploy(u);}sb.battle=b;sb.economy.battle=b;sb.phase='battle';state.game=sb.economy;const drafts=sb.enemyDrafts.slice();sb.enemyDrafts=[];for(const draft of drafts)sandboxSpawnEnemy(draft.id,draft.dummy);state.paused=true;render();}
function sandboxRemoveEnemy(uid){const sb=state.sandbox;if(!sb)return;sb.enemyDrafts=sb.enemyDrafts.filter(e=>e.uid!==uid);if(sb.battle)sb.battle.s.enemies=sb.battle.s.enemies.filter(e=>e.uid!==uid);render();}
function sandboxReset(){const previous=state.sandbox?.previousGame||null;state.sandbox=newSandbox();state.sandbox.previousGame=previous;state.sandbox.previousView='lobby';state.game=state.sandbox.economy;state.view='game';state.paused=true;render();}
function sandboxDetail(){const sb=state.sandbox,b=sb?.battle,ops=sandboxOperators,ens=sandboxEnemies;return `<section class="sandbox-inline"><div class="sandbox-inline-head"><b>技能测试内容</b><small>${sb?.phase==='setup'?'按正式场景方式选择干员、拖拽/点击地块并确认朝向':'沿用正式战斗控制器，可暂停、单步和手动释放技能'}</small></div><details open><summary>添加干员</summary><input id="sandbox-op-search" type="search" value="${esc(sb?.opQuery||'')}" placeholder="搜索名称或 ID" aria-label="搜索测试干员"><div class="sandbox-inline-results">${ops.map(o=>`<button data-act="sandbox-add-op" data-id="${o.id}" data-sandbox-op="${esc((o.name+' '+o.id).toLowerCase())}" ${sb?.opQuery&&!((o.name+' '+o.id).toLowerCase().includes(sb.opQuery.toLowerCase()))?'hidden':''}>${avatar(o.charId)}<span><b>${esc(o.name)}</b><small>${o.rank} 阶${o.isGolden?' · 精锐':''}</small></span></button>`).join('')}</div></details><details open><summary>添加敌人</summary><input id="sandbox-enemy-search" type="search" value="${esc(sb?.enemyQuery||'')}" placeholder="搜索敌人名称或 ID" aria-label="搜索测试敌人"><button class="sandbox-dummy" data-act="sandbox-add-dummy">＋ 不行动木桩</button><div class="sandbox-inline-results">${ens.map(e=>`<button data-act="sandbox-add-enemy" data-id="${e.id}" data-sandbox-enemy="${esc((e.name+' '+e.id).toLowerCase())}" ${sb?.enemyQuery&&!((e.name+' '+e.id).toLowerCase().includes(sb.enemyQuery.toLowerCase()))?'hidden':''}><span class="sandbox-enemy-glyph">◆</span><span><b>${esc(e.name)}</b><small>${e.applyWay==='RANGED'?'远程':'近战'} · ${e.motion==='FLY'?'飞行':'地面'}</small></span></button>`).join('')}</div></details><div class="sandbox-inline-picked"><b>已选敌人</b>${(sb?.enemyDrafts||[]).map(d=>`<div><span>${d.dummy?'∞':'◆'} ${esc(d.dummy?'不行动木桩':data.enemies[d.id]?.name||d.id)}</span><button data-act="sandbox-remove-enemy" data-uid="${d.uid}">移除</button></div>`).join('')||'<small>暂无敌人</small>'}</div><div class="sandbox-inline-actions"><button data-act="sandbox-start" ${sb?.phase!=='setup'?'disabled':''}>开始测试</button><button data-act="sandbox-step" ${sb?.phase!=='battle'?'disabled':''}>单步</button><button data-act="sandbox-clear-enemies">清空敌人</button><button data-act="sandbox-reset">重置</button><button data-act="sandbox-exit">退出</button></div>${sb?.battle?`<div class="sandbox-inline-live"><b>测试干员</b>${sb.economy.s.units.map(u=>{const live=b.s.units.find(v=>v.uid===u.uid),p=data.profiles[u.chessId];return live?`<div><span>${esc(p.name)} · ${Math.round(live.hp)}/${Math.round(live.maxHp)}</span><button data-act="sandbox-fill-sp" data-uid="${u.uid}">充能</button><button data-act="sandbox-skill" data-uid="${u.uid}">${live.skillLeft>0||live.ammo>0?'结束技能':'释放技能'}</button></div>`:''}).join('')||'<small>暂无已部署干员</small>'}<b>测试敌人</b>${(sb.enemyDrafts||[]).map(d=>`<div><span>${d.dummy?'∞':'◆'} ${esc(d.dummy?'不行动木桩':data.enemies[d.id]?.name||d.id)}</span><button data-act="sandbox-remove-enemy" data-uid="${d.uid}">移除</button></div>`).join('')||'<small>暂无敌人</small>'}</div>`:''}</section>`;}
function bondOperators(id){const seen=new Set();return Object.values(data.season.charShopChessDatas).filter(shop=>shop.charId&&!shop.isHidden&&data.profiles[shop.chessId]?.bonds?.includes(id)).map(shop=>{if(seen.has(shop.charId))return null;seen.add(shop.charId);const p=data.profiles[shop.chessId];return {chessId:shop.chessId,charId:shop.charId,name:p.name,rank:shop.chessLevel};}).filter(Boolean).sort((a,b)=>a.rank-b.rank||a.name.localeCompare(b.name,'zh-CN'));}
function sortedBondRows(rows,layers={}){return Object.entries(rows).filter(([id,b])=>b.count>0||(layers[id]||0)>0).sort(([aId,a],[bId,b])=>Number(b.active)-Number(a.active)||(layers[bId]||0)-(layers[aId]||0)||b.count-a.count||aId.localeCompare(bId));}
function bondCurrentPreview(id,layers){
 const level=Math.max(0,Number(layers)||0),info=data.season.bondInfoDict[id],effects=data.season.effectBuffInfoDataDict[info?.effectId]||[],values={};
 for(const row of effects.flatMap(e=>e.blackboard||[]))if(row.key!=='key'&&values[row.key]===undefined)values[row.key]=Number(row.value);
 const n=v=>Number.isInteger(v)?String(v):String(Math.round(v*100)/100),pct=v=>`${n(v*100)}%`,line=(label,value)=>`<li><span>${label}</span><b>${value}</b></li>`,lines=[];
 const scaled=(label,base,per)=>lines.push(line(label,`${pct(base)} + ${pct(per)} × ${level}层 = ${pct(base+per*level)}`));
 switch(id){
  case 'yanShip':scaled('【炎】攻击力提升',values.base_atk,values.atk_per_stack);break;
  case 'sargonShip':lines.push(line('技能增益持续时间',`${n(values.base_time+values.time_per_stack*level)}秒（5 + 0.22 × ${level}）`));break;
  case 'victoriaShip':lines.push(line('装备干员伤害倍率',`${n(values.base_damage_scale+values.damage_scale_per_stack*level)}倍（基础1.25倍）`));break;
  case 'kjeragShip':lines.push(line('寒冷/冻结目标伤害倍率',`${n(values.base_ex_damage_scale+values.ex_damage_scale_per_stack*level)}倍`),line('寒风施加寒冷时间',`${n(values['bond_eff_kjerag[storm].base_time']+values['bond_eff_kjerag[storm].time_per_stack']*level)}秒`));break;
  case 'lateranoShip':lines.push(line('技能额外弹药比例',pct(values.base_ammo_percent+values.ammo_percent_per_stack*level)));break;
  case 'egirShip':scaled('最大生命值提升',values.base_max_hp,values.max_hp_per_stack);break;
  case 'siracusaShip':lines.push(line('隐匿期间攻速加成',`${n(values.base_attack_speed+values.attack_speed_per_stack*level)}`),line('隐匿期间真伤',`${n(values.base_damage+values.damage_per_stack*level)}`));break;
  case 'kazimierzShip':lines.push(line('部署攻击增益上限',pct(values.base_max_atk_when_born+values.max_atk_when_born_per_stack*level)));break;
  case 'preciShip':scaled('攻击力提升',values.base_atk,values.atk_per_stack);break;
  case 'swiftShip':lines.push(line('技能结束回技力概率',pct(values.base_prob+values.prob_per_stack*level)));break;
  case 'skillfulShip':lines.push(line('邻近干员攻速加成',n(values.base_attack_speed+values.attack_speed_per_stack*level)),line('扩大范围阈值',`${values.power_bond_stack_cnt}层`));break;
  case 'arcaneShip':lines.push(line('法术脆弱',pct(values.base_damage_scale_show+values.damage_scale_per_stack*level)),line('低于50%生命时法术脆弱',pct(values.base_damage_scale_show_ex+values.damage_scale_per_stack_show_ex*level)));break;
  case 'steadShip':scaled('最大生命值提升',values.base_max_hp,values.max_hp_per_stack);lines.push(line('反击法术伤害',`${n(values.base_damage_value+values.damage_value_per_stack*level)}`));break;
  case 'deputShip':scaled('防御力提升',values.base_def,values.def_per_stack);break;
  case 'visiShip':lines.push(line('已达到的资金奖励',`${Math.floor(level/values.layer)*values.count}资金（每${values.layer}层+${values.count}）`));break;
  case 'miraShip':lines.push(line('下次刷新免费概率',pct(values.baseprob+values.prob*level)),line('已达到的层数资金奖励',`${Math.floor(level/values.layer)*values.count}资金`));break;
  case 'investShip':lines.push(line('SERVER_GAIN重复次数',`${level>=100?3:2}次（${level>=100?'已达到':'100层后达到'}）`));break;
  case 'raidShip':lines.push(line('闲置强化状态',level>=values.power_bond_stack_cnt?`攻击速度 +${values.power_attack_speed}，攻击/生命 ${pct(values.base_atk+values.atk_per_stack*level)}`:`未激活（需${values.power_bond_stack_cnt}层）`));break;
  case 'indomShip':lines.push(line('近战干员保留部署概率',pct(values.base_prob+values.prob_per_stack*level)));break;
 }
 return lines.length?`<section class="native-bond-current"><h3>当前动态数值 · ${level}层</h3><ul>${lines.join('')}</ul></section>`:'';
}
function strategyInfo(id){const b=data.season.bandDataListDict[id],common=data.common.bandDataDict[id];return {id,name:common?.bandName||id,desc:plain(b?.bandDesc||''),hp:b?.totalHp??'—'};}
function decorateStrategyCatalog(){for(const button of root.querySelectorAll('.native-strategy-catalog button')){const c=strategyCoverageById[button.dataset.id]||{status:'partial',statusLabel:'待核对',gapNote:'尚未建立效果覆盖记录'},span=button.querySelector('span');if(!span)continue;const status=document.createElement('small');status.className=`native-strategy-completeness ${c.status}`;status.textContent=c.statusLabel;status.title=c.gapNote||c.statusLabel;span.prepend(status);if(c.gapNote){const gap=document.createElement('em');gap.className='native-strategy-gap';gap.textContent='缺口：'+c.gapNote;span.append(gap);}}}
function renderBriefingScreen(){const d=state.draft,mode=data.season.modeDataDict[d.modeId],mapName=data.maps.filter(m=>m.weight>0).findIndex(m=>m.stageId===d.mapId),tags=(d.roster.types||[]).map(id=>trainingType(id)).filter(Boolean),order=(d.roster.order||[]).map(id=>trainingType(id)?.name||id),strategy=strategyInfo(state.band);return `<main class="native-lobby native-briefing"><header><button data-act="home">‹ 大厅</button><span>战前准备</span></header><h1>战前准备</h1><p>${esc(d.cat?'海猫模式':d.egg325?'325模式':mode?.name||'')} · 阵地 ${mapName+1}</p><h2>本局特训</h2><p>抽中三种词条，战斗按 ${order.map(esc).join(' → ')} 轮换出怪。</p><div class="native-tags">${tags.map(t=>`<article><b>${esc(t.name)}</b><small>${esc(t.id)}</small><p>${esc(t.desc)}</p></article>`).join('')}</div><h2>初始策略</h2><section class="native-selected-strategy"><div class="native-selected-strategy-art">${avatar(strategy.id)}</div><div><span class="native-eyebrow">CURRENT STRATEGY</span><h3>${esc(strategy.name)}</h3><p>${esc(strategy.desc)}</p><small>初始生命 ${strategy.hp}</small></div><button data-act="strategy-select">选择策略 →</button></section><button class="native-primary native-begin" data-act="begin">进入对局 →</button></main>`;}
function renderStrategySelectScreen(){const selected=state.strategyDraft||state.band,list=Object.values(data.season.bandDataListDict).map(b=>strategyInfo(b.bandId)).filter(b=>b.name);return `<main class="native-lobby native-strategy-select"><header><button data-act="strategy-cancel">‹ 返回战前准备</button><span>策略选择</span></header><div class="native-strategy-select-heading"><div><span class="native-eyebrow">STRATEGY CATALOG</span><h1>选择初始策略</h1></div><p>点击策略卡片预览，再次点击当前策略确认并返回战前准备。</p></div><div class="native-strategy-catalog">${list.map(b=>`<button data-act="strategy-pick" data-id="${b.id}" class="${selected===b.id?'chosen':''}"><div class="native-strategy-card-art">${avatar(b.id)}</div><span><b>${esc(b.name)}</b><small>初始生命 ${b.hp}</small><p>${esc(b.desc)}</p></span></button>`).join('')}</div><div class="native-strategy-select-actions"><button data-act="strategy-cancel">取消</button></div></main>`;}
function render(){
 painting=true;
 try{
 if(state.view==='lobby'){root.innerHTML=renderLobby({data,state,avatar});root.querySelector('.native-tool-grid')?.insertAdjacentHTML('afterbegin','<div class="native-pool-update"><div><span>CONFIGURATION UPDATE</span><b>默认敌人池已经更新</b><small>需要点击按钮刷新新配置</small></div><button class="native-pool-update-action" data-act="ed-defaults">重置默认敌人池</button></div>');renderModal();return;}
  if(state.view==='strategy-select'){root.innerHTML=renderStrategySelectScreen();decorateStrategyCatalog();renderModal();return;}
 if(state.view==='briefing'){root.innerHTML=renderBriefingScreen();renderModal();return;}
 if(state.view==='briefing'){const d=state.draft,mode=data.season.modeDataDict[d.modeId],mapName=data.maps.filter(m=>m.weight>0).findIndex(m=>m.stageId===d.mapId),tags=(d.roster.types||[]).map(id=>trainingType(id)).filter(Boolean),order=(d.roster.order||[]).map(id=>trainingType(id)?.name||id);root.innerHTML=`<main class="native-lobby native-briefing"><header><button data-act="home">‹ 大厅</button><span>战前准备</span></header><h1>战前准备</h1><p>${esc(d.cat?'海猫模式':d.egg325?'325模式':mode?.name||'')} · 阵地 ${mapName+1}</p><h2>本局特训</h2><p>抽中三种词条，战斗按 ${order.map(esc).join(' → ')} 轮换出怪。</p><div class="native-tags">${tags.map(t=>`<article><b>${esc(t.name)}</b><small>${esc(t.id)}</small><p>${esc(t.desc)}</p></article>`).join('')}</div><h2>初始策略</h2><div class="native-strategy-pane"><div class="native-strategies">${Object.values(data.season.bandDataListDict).map(b=>`<button data-act="band" data-id="${b.bandId}" class="${state.band===b.bandId?'chosen':''}">${avatar(b.bandId)}<span><b>${esc(data.common.bandDataDict[b.bandId].bandName)}</b><small>生命 ${b.totalHp}</small><p>${esc(plain(b.bandDesc))}</p></span></button>`).join('')}</div></div><button class="native-primary native-begin" data-act="begin">进入对局 →</button></main>`;renderModal();return;}
 if(state.view==='editor'){root.innerHTML=renderWaveEditor(data,state.waveTable,state.editor);const search=document.getElementById('ed-search'),catalog=document.getElementById('ed-catalog');if(search&&state.editor.keepSearch){search.focus();try{search.setSelectionRange(state.editor.caret,state.editor.caret);}catch{}}state.editor.keepSearch=false;if(catalog)catalog.scrollTop=state.editor.scroll||0;renderModal();return;}
 const g=state.game,s=g.s,turn=currentTurn(),rows=g.bonds();root.innerHTML=`<main class="native-game${s.phase==='battle'?' is-battle':''}${state.supplyCollapsed?' is-supply-collapsed':''}${state.sandbox?' is-sandbox':''}">${dossier()}<header class="native-top"><button data-act="home">‹ 大厅</button><strong>卫戍协议 / 盟约下半</strong><button class="native-mobile-info" data-act="field-info">战况 / 设置</button><button data-act="limits">已知差异</button><button data-act="branches">分支规则</button><button data-act="export">导出存档</button></header><div class="native-workspace"><aside class="native-bonds">${sortedBondRows(rows,s.bondLayers).map(([id,b])=>`<button data-act="bond-info" data-id="${id}" class="${b.active?'active':''}"><b>${data.season.bondInfoDict[id].name}</b><span>${b.count} / ${data.season.bondInfoDict[id].activeCount}</span><small>${data.season.bondInfoDict[id].noStack?'':(s.bondLayers[id]||0)+' 层'}</small></button>`).join('')||'<p>部署干员以激活盟约</p>'}</aside><section class="native-field"><div class="native-field-caption"><b>${state.sandbox?(s.phase==='battle'?'技能测试':'测试配置'):s.phase==='battle'?(turn.isBossTurn?'木桩测试':'自动作战'):s.phase==='prep'?'阵地休整':s.phase==='finished'?'模拟结束':'回合结算'}</b><span id="native-wave-progress">${s.units.filter(u=>u.position).length} / ${s.capacity} 部署</span></div><div class="native-terrain-legend" aria-label="地块图例"><span><i class="terrain-high"></i>高台</span><span><i class="terrain-ground"></i>可部署地面</span><span><i class="terrain-corridor"></i>可通行通道</span><span><i class="terrain-blocked"></i>阻隔工事</span><span><i class="terrain-entry"></i>敌方入口</span><span><i class="terrain-goal"></i>防守目标</span></div><div class="native-board"><canvas id="native-canvas" tabindex="0" aria-label="战场棋盘，先选位置再拖动朝向确认"></canvas><span class="native-cost" title="战斗费用余额，与商店资金独立"><small>Cost 费用</small><output id="native-cost-balance" aria-label="战斗费用余额">—</output></span></div><div class="native-facing" ${state.preview?'':'hidden'}>拖动选择朝向，松手确认；中心松手取消。${[0,1,2,3].map((d)=>`<button data-act="aim" data-dir="${d}">${['→','↓','←','↑'][d]}</button>`).join('')}<button data-act="place-confirm">确认放置</button><button data-act="cancel">取消</button></div><div class="native-controls"><button data-act="pause" ${s.phase!=='battle'?'disabled':''}>${state.paused?'继续':'暂停'}</button>${[1,2,4].map(n=>`<button data-act="speed" data-speed="${n}" class="${state.speed===n?'chosen':''}">${n}×</button>`).join('')}<button data-act="mute">${state.muted?'声音关':'声音开'}</button><label>音量 <input id="native-volume" aria-label="战斗音量" type="range" min="0" max="1" step="0.05" value="${state.volume}" style="width:72px"></label><button data-act="reduce-fx">${state.reduceFx?'动效少':'动效'}</button>${s.phase==='prep'?(state.sandbox?'<button class="native-primary" data-act="sandbox-start">开始测试 →</button>':'<button class="native-primary" data-act="start">准备完毕 →</button>'):s.phase==='intermission'?'<button class="native-primary" data-act="next">进入下一回合 →</button>':s.phase==='battle'&&turn.isBossTurn?'<button data-act="stop">结束木桩并播报伤害</button>':s.phase==='finished'?'<button data-act="result">查看伤害报告</button>':''}</div><div class="native-bench-label" id="native-hand-label">整备区 ${g.hand().length} / 10 <span id="native-drop-hint" aria-live="polite">可将场上干员拖回此处；换位后重新选朝向</span></div><div class="native-bench" id="native-hand" aria-label="整备区">${s.units.filter(u=>!u.position).map(u=>`<button data-act="select" data-uid="${u.uid}" class="${state.selected===u.uid||inspectSame('unit',u.uid)?'chosen':''}">${avatar(u.charId)}<b>${esc(data.profiles[u.chessId].name)}</b>${data.profiles[u.chessId].isGolden?'<small>精锐</small>':''}</button>`).join('')}${s.items.map(i=>`<div role="button" tabindex="0" data-act="item" data-uid="${i.uid}" class="${state.item===i.uid||inspectSame('pack',i.uid)?'chosen':''}"><span class="native-item-icon">◇</span><b>${esc(itemName(i.chessId))}</b><button class="native-item-destroy" data-act="destroy" data-uid="${i.uid}" title="销毁这件装备" aria-label="销毁 ${esc(itemName(i.chessId))}">×</button></div>`).join('')}</div></section><aside class="native-detail">${state.sandbox?sandboxDetail():waveIntel()}${detail()}<h3>${esc(data.common.bandDataDict[s.bandId].bandName)}</h3><p>${esc(plain(data.season.bandDataListDict[s.bandId].bandDesc))}</p><p>${turn.isBossTurn?'最终木桩：生命无限，防御0、法抗0，倒计时150秒。':'开局抽取三种特训词条；每档按难度预算从敌人池抽取，空池使用占位模板。'}</p><div id="native-combat-stats"></div></aside></div><div class="native-status" id="native-status"></div><section class="native-shop" id="native-supply-shop"><div><h2>调度中心 ${s.level}</h2><button class="native-supply-toggle" data-act="supply-toggle" aria-controls="native-supply-shop" aria-expanded="${!state.supplyCollapsed}">${state.supplyCollapsed?'展开商店 ▴':'收起商店 ▾'}</button><button data-act="upgrade" ${s.phase!=='prep'?'disabled':''}>升级 ${catOn()?'ALL':(g.terms().upgradeCost??'MAX')} ◆</button><button data-act="refresh" ${s.phase!=='prep'?'disabled':''}>刷新 ${s.freeRefresh?'免费':catOn()?'ALL':'1 ◆'}</button><button data-act="lock" ${s.phase!=='prep'?'disabled':''}>${s.locked?'❄ 已冻结':'冻结'}</button>${s.rewardPending?.tier?'<span class="native-reward-shop-hint">三合一奖励选择中 · 点击候选卡片预览，再次点击确认</span>':''}</div><div class="native-shop-cards">${shopCards(g,s)}</div></section></main>`;canvas=document.getElementById('native-canvas');updateHud();fitWaveFaces();draw();renderModal();showRequired();
 }finally{painting=false;paint325();}
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
function rewardShopCards(reward){return (reward?.offers||[]).map((id,i)=>{const p=data.profiles[id],bonds=(p?.bonds||[]).map(id=>data.season.bondInfoDict[id]?.name||id).join(' / ')||'无盟约';return p?`<button data-act="reward" data-index="${i}" class="native-reward-shop-card ${inspectSame('reward',i)?'chosen':''}">${avatar(p.charId)}<strong>${esc(p.name)}</strong><small>三合一奖励候选</small><p>${esc(bonds)}<br><span>点击预览，再次点击选择</span></p></button>`:'';}).join('');}
 function shopCards(g,s){if(s.rewardPending?.tier){g.ensureRewards();return rewardShopCards(s.rewardPending);}const frozen=i=>s.locked||(s.frozenSlots||[]).includes(i);return s.offers.map((id,i)=>id?`<button data-act="buy" data-index="${i}" class="${inspectSame('shop',i)?'chosen ':''}${frozen(i)?'native-shop-frozen':''}">${avatar(data.profiles[id].charId)}<strong>${esc(data.profiles[id].name)}</strong><small>${data.profiles[id].rank} 阶 · ${g.price(id)} ◆</small><p>${g.ownBonds({chessId:id}).map(b=>data.season.bondInfoDict[b].name).join(' / ')}</p></button>`:'<div class="native-empty">已调配</div>').join('')+s.itemOffers.map((id,i)=>id?`<button data-act="buyItem" data-index="${i}" class="${inspectSame('shopItem',i)?'chosen ':''}${s.locked?'native-shop-frozen':''}"><span class="native-item-icon">◇</span><strong>${esc(itemName(id))}</strong><small>${data.season.trapChessDataDict[id].purchasePrice} ◆</small></button>`:'<div class="native-empty">已调配</div>').join('');}
function inspectTarget(){
 const g=state.game,inv=state.inspect;if(!g||!inv)return null;
 if(inv.kind==='unit'){const u=g.s.units.find(x=>x.uid===inv.uid);return u?{kind:'op',u,p:profile(u),live:g.battle?.s.units.find(a=>a.uid===u.uid),shop:false}:null;}
 if(inv.kind==='summon'){const s=g.battle?.s.summons?.find(x=>x.uid===inv.uid);return s?{kind:'summon',s}:null;}
 if(inv.kind==='reward'){const id=g.s.rewardPending?.offers?.[inv.index],p=id&&data.profiles[id];return p?{kind:'op',u:null,p:{...p,...(p.skillChoices?.[p.skillIndex]||{})},live:null,shop:false,reward:true}:null;}
 if(inv.kind==='shop'){const id=g.s.offers[inv.index];if(!id)return null;const row=data.profiles[id];return {kind:'op',u:null,p:{...row,...(row.skillChoices?.[row.skillIndex]||{})},live:null,shop:true,price:g.price(id)};}
 if(inv.kind==='shopItem'){const id=g.s.itemOffers[inv.index];return id?{kind:'item',id,shop:true,price:data.season.trapChessDataDict[id]?.purchasePrice}:null;}
 if(inv.kind==='pack'){const it=g.s.items.find(i=>i.uid===inv.uid);return it?{kind:'item',id:it.chessId,shop:false,uid:it.uid}:null;}
 return null;
}
function dossier(){
 const t=inspectTarget();if(!t)return '';
 if(t.kind==='item'){
  const fx=itemEffect(t.id);
  return `<aside class="native-dossier" aria-label="道具档案"><div class="native-dossier-body"><button data-act="inspect-close" class="native-dossier-close" aria-label="关闭">×</button><div class="native-dossier-art native-dossier-item">◇</div><h2>${esc(itemName(t.id))}</h2><p class="native-dossier-kicker">${esc(fx.name)}</p><h3>效果</h3><p>${esc(fx.desc||'无效果说明')}</p>${t.shop?`<p class="native-dossier-buy">再次点击卡片购买 · ${catOn()?'ALL':t.price} ◆</p>`:''}</div></aside>`;
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
 const bondIds=[...new Set(p.bonds||data.season.charChessDataDict[owned?.chessId||p.chessId]?.bondIds||[])];
 const equipment=owned?.equipment||[],equipmentSlots=Array.from({length:2},(_,i)=>equipment[i]?`<div class="native-equipment-slot filled"><span>装备位 ${i+1}</span><b>${esc(itemName(equipment[i].chessId))}</b><small>已装备</small><button class="native-item-destroy" data-act="destroyEquip" data-uid="${owned.uid}" data-slot="${i}" title="销毁这件装备" aria-label="销毁 ${esc(itemName(equipment[i].chessId))}">×</button></div>`:`<div class="native-equipment-slot"><span>装备位 ${i+1}</span><b>空槽</b><small>${owned?'可装备':'获得干员后可用'}</small></div>`).join('');
 return `<aside class="native-dossier" aria-label="干员档案"><div class="native-dossier-art">${avatar(p.charId)}</div><div class="native-dossier-body"><button data-act="inspect-close" class="native-dossier-close" aria-label="关闭">×</button><h2>${esc(p.name)}${p.isGolden?' · 精锐':''}</h2><p class="native-dossier-kicker">${esc(data.branchRules.records.find(r=>r.id===p.branch)?.name||p.branch||'')} · ${p.rank} 阶${t.reward?' · 三合一奖励候选':''}</p><p id="native-dossier-hp" class="native-dossier-hp">生命 <b>${hp}</b><i>/${max}</i></p><div class="native-dossier-stats"><span>攻击 ${Math.round(a.atk)}</span><span>防御 ${Math.round(a.def)}</span><span>法抗 ${Math.round(a.magicResistance)}</span><span>攻速 ${Math.round(a.attackSpeed)}</span></div><div id="native-dossier-live" class="native-dossier-live"><p>阶段 ${esc(phase)}</p><p>状态 ${esc(statuses)}</p><h3>属性来源</h3><p>${parts}</p></div><h3>所属盟约</h3><div class="native-dossier-bonds">${bondIds.map(id=>`<span>${esc(data.season.bondInfoDict[id]?.name||id)}</span>`).join('')||'<small>暂无盟约</small>'}</div><h3>技能</h3>${owned?`<label>携带技能<select data-uid="${owned.uid}" id="native-skill" ${g.s.phase!=='prep'?'disabled':''}>${data.profiles[owned.chessId].skillChoices.map((v,i)=>`<option value="${i}" ${(owned.skillIndex??data.profiles[owned.chessId].skillIndex)===i?'selected':''}>${esc(v.skill?.name||'无主动技能')}</option>`).join('')}</select></label>`:`<p class="native-dossier-skill-name">${esc(p.skill?.name||'无主动技能')}</p>`}<p>${esc(renderSkillDescription(p.skill)||'无主动技能')}</p><h3>卫戍</h3>${(p.garrisons||[]).map(x=>`<p>${esc(plain(x.description||x.garrisonDesc))}</p>`).join('')||'<p>无卫戍效果</p>'}<h3>装备栏</h3><div class="native-dossier-equipment">${equipmentSlots}</div>${t.shop?`<p class="native-dossier-buy">再次点击卡片购买 · ${catOn()?'ALL':t.price} ◆</p>`:''}${owned&&g.s.phase==='prep'?`<div class="native-dossier-acts"><button data-act="withdraw" data-uid="${owned.uid}">撤回整备区</button><button data-act="sell" data-uid="${owned.uid}">出售 +1 ◆</button></div>`:''}</div></aside>`;
}
function detail(){return state.inspect?'':'<h3>阵地指令</h3><p>点击干员或商店卡片查看档案。商店需再点一次才购买。</p>';}
function showRequired(){const g=state.game,r=g.s.rewardPending;if(r&&!r.tier){if(r.kind==='bounty')modal(`<h2>悬赏决策</h2><p>选择一项悬赏加入下一场战斗</p><div class="native-rewards">${r.offers.map(id=>{const e=data.season.effectInfoDataDict[id];return `<button data-act="reward" data-id="${id}"><b>${esc(e?.effectName||id)}</b><p>${esc(plain(e?.effectDesc||''))}</p></button>`;}).join('')}</div>`);else{g.ensureRewards();modal(`<h2>晋升／特殊调配</h2><p>选择获得一项奖励</p><div class="native-rewards">${r.offers.map(id=>`<button data-act="reward" data-id="${id}">${r.kind==='item'?'◇':avatar(data.profiles[id].charId)}<b>${esc(r.kind==='item'?itemName(id):data.profiles[id].name)}</b></button>`).join('')}</div>`);}}else if(g.s.phase==='decision')modal(`<h2>机变决策</h2><div class="native-rewards">${g.s.roundDecisions.map(id=>{const e=data.season.effectInfoDataDict[id];return `<button data-act="decision" data-id="${id}"><b>${esc(e.effectName)}</b><p>${esc(plain(e.effectDesc))}</p></button>`;}).join('')}</div>`);}
function showResult(){const g=state.game,r=g.s.runResult||g.s.history.at(-1);if(!r)return;modal(`<h2>${r.kind==='training-dummy'?'木桩测试完成':'作战报告'}</h2><p>总伤害</p><strong class="native-total">${Math.round(r.totalDamage||0).toLocaleString()}</strong><p>${r.elapsed.toFixed(2)} 秒${r.dps!==undefined?' · DPS '+r.dps.toFixed(2):' · 击倒 '+r.kills+' · 漏失 '+r.leaks}</p>${(r.units||[]).sort((a,b)=>b.damage-a.damage).map(u=>`<div class="native-result-row"><span>${esc(g.s.units.find(x=>x.uid===u.uid)?data.profiles[g.s.units.find(x=>x.uid===u.uid).chessId].name:u.id||'其他')}</span><b>${Math.round(u.damage).toLocaleString()}</b></div>`).join('')}<button data-act="export">导出本次记录</button><button data-act="home">返回大厅</button>`);}
function action(button){const a=button.dataset.act,g=state.game,uid=Number(button.dataset.uid);if(button.disabled)return;if(['sandbox','home','sandbox-exit','new'].includes(a))rememberView('lobby');if(['begin','resume','import'].includes(a))rememberView('game');
 if(a==='band'){state.band=button.dataset.id;render();return;}if(a==='limits'){showLimitations();return;}if(a==='branches'){showBranches(button.dataset.id||null);return;}if(a==='close'){if(g?.s.rewardPending||g?.s.phase==='decision')return;state.modal=null;renderModal();return;}
 if(a==='supply-toggle'){state.supplyCollapsed=!state.supplyCollapsed;render();return;}
 if(a==='sandbox'){enterPlayChrome();openSandbox();return;}if(a==='home'&&state.sandbox){const previous=state.sandbox.previousGame||null;state.sandbox=null;state.game=previous;state.view='lobby';state.paused=true;leavePlayChrome();render();return;}if(a==='sandbox-exit'){const previous=state.sandbox?.previousGame||null;state.sandbox=null;state.game=previous;state.view='lobby';state.paused=true;leavePlayChrome();render();return;}if(a==='sandbox-reset'){sandboxReset();return;}if(a==='sandbox-add-op'){sandboxAddOperator(button.dataset.id);return;}if(a==='sandbox-add-enemy'){sandboxSpawnEnemy(button.dataset.id,false);return;}if(a==='sandbox-add-dummy'){sandboxSpawnEnemy('enemy_1041_lazerd',true);return;}if(a==='sandbox-remove-enemy'){sandboxRemoveEnemy(uid);return;}if(a==='sandbox-remove-op'){const sb=state.sandbox;if(sb){sb.economy.s.units=sb.economy.s.units.filter(u=>u.uid!==uid);if(sb.battle)sb.battle.s.units=sb.battle.s.units.filter(u=>u.uid!==uid);render();}return;}if(a==='sandbox-start'){sandboxStart();return;}if(a==='sandbox-pause'){if(state.sandbox?.phase==='battle'){state.paused=!state.paused;render();}return;}if(a==='sandbox-step'){if(state.sandbox?.battle){state.sandbox.battle.step();render();}return;}if(a==='sandbox-clear-enemies'){if(state.sandbox){state.sandbox.enemyDrafts=[];if(state.sandbox.battle)state.sandbox.battle.s.enemies=[];render();}return;}if(a==='sandbox-fill-sp'){const sb=state.sandbox,u=sb?.battle?.s.units.find(v=>v.uid===uid);if(u){u.sp=sb.battle.spCost(u);render();}return;}if(a==='sandbox-skill'){const sb=state.sandbox,u=sb?.battle?.s.units.find(v=>v.uid===uid);if(u){if(u.skillLeft>0||u.ammo>0)sb.battle.deactivate(u);else{u.sp=sb.battle.spCost(u);sb.battle.activate(u);}render();}return;}
 if(a==='field-info'){modal(`<h2>战况 / 设置</h2>${document.querySelector('.native-detail').innerHTML.replace(/ id="[^"]*"/g,'')}${document.querySelector('.native-terrain-legend').outerHTML}<label>音量 <input data-native-volume aria-label="战斗音量" type="range" min="0" max="1" step="0.05" value="${state.volume}"></label><p><button data-act="limits">已知差异</button> <button data-act="branches">分支规则</button> <button data-act="export">导出存档</button></p>`);fitWaveFaces();return;}
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
  if(a==='strategy-select'&&state.view==='briefing'){state.strategyDraft=null;state.view='strategy-select';render();return;}if(a==='strategy-pick'&&state.view==='strategy-select'){const catalog=document.querySelector('.native-strategy-catalog'),scrollHost=catalog?.scrollHeight>catalog?.clientHeight?catalog:catalog?.closest('.native-lobby'),scroll=scrollHost?.scrollTop||0,id=button.dataset.id;if(state.strategyDraft===id){state.band=id;state.strategyDraft=null;state.view='briefing';render();return;}state.strategyDraft=id;render();const next=document.querySelector('.native-strategy-catalog'),nextHost=next?.scrollHeight>next?.clientHeight?next:next?.closest('.native-lobby');if(nextHost)nextHost.scrollTop=scroll;return;}if(a==='strategy-cancel'&&state.view==='strategy-select'){state.strategyDraft=null;state.view='briefing';render();return;}
 if(a==='new'){const egg=state.mode===EGG_MODE_ID,cat=state.mode===CAT_MODE_ID,modeId=egg?EGG_BASE_MODE:cat?CAT_BASE_MODE:state.mode,seed=(Date.now()&0xffffffff)>>>0;state.draft={modeId,mapId:state.map,seed,roster:createWaveRoster({random:waveRng(seed),data,modeId}),egg325:egg,cat};state.view='briefing';state.strategyDraft=null;state.modal=null;render();return;}
 if(a==='begin'){enterPlayChrome();state.supplyCollapsed=false;if(!state.draft){state.view='lobby';leavePlayChrome();render();return;}try{state.game=new NativeSession(data,{modeId:state.draft.modeId,bandId:state.band,mapId:state.draft.mapId,seed:state.draft.seed,waveRoster:state.draft.roster,egg325:!!state.draft.egg325,cat:!!state.draft.cat});state.view='game';state.draft=null;state.paused=false;state.expiresAt=null;state.selected=state.summonSelected=state.item=state.inspect=state.preview=state.modal=null;save();saveCheckpoint();render();}catch(e){notice(e.message);}return;}
 if(a==='resume'){if(state.expiresAt&&Date.now()>=state.expiresAt){notice('暂离已超过24小时，请开始新模拟');return;}enterPlayChrome();state.expiresAt=null;state.view='game';render();return;}if(a==='home'){if(state.view==='editor'||state.view==='briefing'){state.view='lobby';leavePlayChrome();render();return;}state.view='lobby';state.paused=true;state.expiresAt??=Date.now()+86400000;state.modal=null;save();leavePlayChrome();render();return;}if(a==='result'){showResult();return;}
 if(a==='export'){const url=URL.createObjectURL(new Blob([JSON.stringify(g.snapshot(),null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='garrison-round-'+g.s.round+'.json';link.click();URL.revokeObjectURL(url);return;}
 if(a==='import'){const input=document.createElement('input');input.type='file';input.accept='.json';input.onchange=async()=>{try{if(input.files[0].size>10e6)throw Error('存档文件过大');const record=JSON.parse(await input.files[0].text()),game=NativeSession.restore(data,record);if(!game)throw Error('存档版本、数据或有效期不匹配');state.game=game;state.view='game';state.paused=true;save();saveCheckpoint();enterPlayChrome();render();}catch(e){notice(e.message);}};input.click();return;}
 if(!g)return;
 if(a==='pause'){state.paused=!state.paused;render();return;}if(a==='speed'){state.speed=Number(button.dataset.speed);render();return;}
 if(a==='mute'){state.muted=!state.muted;savePreference('garrison-mute',state.muted?'1':'0');if(!state.muted)unlockAudio();render();return;}
 if(a==='reduce-fx'){state.reduceFx=!state.reduceFx;savePreference('garrison-reduce-fx',state.reduceFx?'1':'0');render();return;}
 if(a==='inspect-close'){state.inspect=null;render();return;}
 if(a==='summon-select'){state.summonSelected=uid;state.selected=null;state.item=null;state.inspect={kind:'summon-card',uid};state.preview=null;render();return;}
 if(a==='select'){if(state.item)equipItemOnUnit(uid);state.summonSelected=null;state.selected=uid;state.inspect={kind:'unit',uid};state.preview=null;save();render();return;}
 if(a==='item'){state.summonSelected=null;if(inspectSame('pack',uid)){state.item=uid;notice('点击一名场上或整备区干员以装备／使用。');}else{state.item=null;state.selected=null;state.inspect={kind:'pack',uid};}render();return;}
 if(a==='replace'){g.perform('equip',state.item,uid,Number(button.dataset.slot));state.item=null;state.modal=null;save();render();return;}
 if(a==='destroy'||a==='destroyEquip'){const slot=Number(button.dataset.slot),name=itemName(a==='destroy'?g.s.items.find(i=>i.uid===uid)?.chessId:g.s.units.find(u=>u.uid===uid)?.equipment?.[slot]?.chessId);if(!g.perform(a,uid,slot)){notice('当前阶段无法销毁装备。');return;}if(state.item===uid)state.item=null;notice('已销毁 '+name+'。');save();render();return;}
 if(a==='bond-info'){const id=button.dataset.id,b=data.season.bondInfoDict[id],members=bondOperators(id),live=new Set((g?.s.units||[]).filter(u=>u.position).map(u=>u.charId)),layer=g?.s.bondLayers?.[id]||0,active=g?.bonds?.()?.[id]?.active;modal(`<h2>${esc(b.name)}</h2><p>${esc(plain(b.desc))}</p>${bondCurrentPreview(id,layer)}<p class="muted small">${active?'当前盟约已激活，动态数值生效中。':'当前盟约尚未激活，动态数值仅作预览。'}</p><div class="native-bond-roster" aria-label="盟约干员">${members.map(m=>{const active=live.has(m.charId);return `<div class="native-bond-member${active?' active':''}">${avatar(m.charId)}<span><b>${esc(m.name)}</b><small>${m.rank} 阶${active?' · 场上':''}</small></span></div>`;}).join('')||'<small>暂无可用干员</small>'}</div>`);return;}if(a==='aim'){if(state.preview){state.preview.dir=Number(button.dataset.dir);draw();}return;}if(a==='cancel'){state.preview=null;render();return;}if(a==='place-confirm'){commitPreview();return;}
 let ok;if(a==='buy'||a==='buyItem'){const kind=a==='buy'?'shop':'shopItem',index=Number(button.dataset.index);if(!inspectSame(kind,index)){state.inspect={kind,index};state.selected=null;state.item=null;render();return;}if(g.s.phase!=='prep'){notice('当前阶段不能购买');return;}ok=g.perform(a,index);if(ok){state.inspect=null;if(a==='buy')state.selected=g.s.units.at(-1)?.uid??null;}}else if(a==='reward'){const reward=g.s.rewardPending,index=Number(button.dataset.index),id=reward?.tier?reward.offers?.[index]:button.dataset.id;if(reward?.tier&&!inspectSame('reward',index)){state.inspect={kind:'reward',index};state.selected=null;state.item=null;render();return;}ok=id?g.perform(reward?.kind==='bounty'?'bounty':'takePromotion',id):false;state.modal=null;if(ok)state.inspect=null;}else if(a==='decision'){ok=g.perform(a,button.dataset.id);state.modal=null;}else if(a==='sell'){ok=g.perform(a,uid);if(ok){state.selected=null;state.inspect=null;}}else if(a==='withdraw'){ok=g.perform(a,uid);}else if(['upgrade','refresh','lock','start','next','stop'].includes(a)){ok=g.perform(a);if(a==='start'){state.paused=false;resetFxClock();unlockAudio();}state.preview=null;if(a==='refresh')state.inspect=null;}else return;
 if(!ok)notice(g.lastError||'当前资金、位置或阶段不允许此操作');if(ok&&(a==='next'||a==='decision'))saveCheckpoint();save();render();if(g.s.phase==='finished')showResult();
}
 function renderSummonCards(){const game=state.game;if(game?.s.phase==='prep')game.syncSummonCards?.();const bench=document.getElementById('native-hand'),cards=game?.s.phase==='prep'?(game.s.summonCards||[]).filter(c=>c.position===null):[];if(!bench)return;bench.querySelectorAll('[data-act="summon-select"]').forEach(node=>node.remove());for(const card of cards){const button=document.createElement('button');button.dataset.act='summon-select';button.dataset.uid=String(card.uid);button.dataset.mode=card.mode||'manual';button.disabled=card.mode!=='manual';button.className=`native-summon-card${state.summonSelected===card.uid?' chosen':''}`;const hint=card.mode==='skill'?'技能转好后自动出现':card.mode==='auto'?'开战时自动出现':'可拖动放置并选择朝向';button.innerHTML=`<span class="native-summon-icon">◈</span><b>${esc(card.name)}</b><small>${hint}</small>`;bench.append(button);}}
function updateHud(){const g=state.game;if(!g||state.view!=='game')return;renderSummonCards();const b=g.battle?.s,rounds=buildPhasePlan(data,g.s.modeId).filter(r=>!r.isConditional).length,status=document.getElementById('native-status');
 if(status){const time=b&&g.s.phase==='battle'?`<div><small>剩余时间</small><b>${Math.max(0,Math.ceil(b.limit-b.time))}<i> 秒</i></b></div><div><small>剩余资金</small>${fundsMarkup(g.s.funds)}</div>`:`<div><small>剩余资金</small>${fundsMarkup(g.s.funds)}</div>`;
  const wave=b&&g.s.phase==='battle'?`<div><small>波次</small><b>${b.kills}<i> / ${b.total}</i></b></div>`:`<div><small>回合</small><b>${g.s.round}<i>/${rounds}</i></b></div>`;
  status.innerHTML=`<div><small>生命</small><b class="hp">${g.s.hp}<i>/${g.s.maxHp}</i></b></div>${time}${wave}`;}
 const cost=document.getElementById('native-cost-balance');if(cost){const active=b&&g.s.phase!=='prep',value=active?Number(b.cost):NaN;cost.textContent=Number.isFinite(value)?String(Math.round(value*10)/10):'—';cost.parentElement.title=active?'战斗费用余额，与商店资金独立':'待开战：战斗开始后显示实时费用';cost.classList.toggle('is-debt',Number.isFinite(value)&&value<0);}
 const progress=document.getElementById('native-wave-progress');if(progress)progress.textContent=g.s.phase==='battle'&&b?`击倒 ${b.kills} / ${b.total} · 漏失 ${b.leaks}`:`${g.s.units.filter(u=>u.position).length} / ${g.s.capacity} 部署`;
 const live=document.getElementById('native-unit-live'),unit=g.battle?.s.units.find(u=>u.uid===state.selected);if(live)live.textContent=unit&&g.s.phase==='battle'?`当前生命 ${Math.round(unit.hp)}/${Math.round(unit.maxHp)} · 治疗 ${Math.round(unit.healing||0)} · 持续回复 ${Math.round(unit.regeneration||0)}`:'';
 const dossierHp=document.getElementById('native-dossier-hp');if(dossierHp&&state.inspect?.kind==='unit'){const seen=g.battle?.s.units.find(u=>u.uid===state.inspect.uid),row=g.s.units.find(u=>u.uid===state.inspect.uid);if(row){const a=seen&&g.battle?g.battle.stats(seen):profile(row).attributes,hp=Math.round(seen?.hp??a.maxHp),max=Math.round(seen?.maxHp??a.maxHp);dossierHp.innerHTML=`生命 <b>${hp}</b><i>/${max}</i>`;}}
 const dossierLive=document.getElementById('native-dossier-live');if(dossierLive&&state.inspect?.kind==='unit'){const seen=g.battle?.s.units.find(u=>u.uid===state.inspect.uid),row=g.s.units.find(u=>u.uid===state.inspect.uid);if(row){const a=seen&&g.battle?g.battle.stats(seen):profile(row).attributes,p=profile(row),fill=seen&&g.battle?spBarFill(seen,p.skill,g.battle.spCost(seen)):null,phase=seen?(seen.ammo>0?`弹药 ${seen.ammo}/${seen.ammoMax}`:seen.skillLeft>0?`技能持续 ${seen.skillLeft.toFixed(1)}s`:seen.down>0?`再部署 ${Math.ceil(seen.down)}s`:fill?.ready?'技力就绪':'待机'):'';dossierLive.innerHTML=`<p>阶段 ${esc(phase)}</p><p>状态 ${esc((seen?.statuses||[]).map(s=>s.kind).join('、')||'无')}</p><h3>属性来源</h3><p>${(a.parts||[]).map(x=>`${esc(x.src)} ${x.stat} ${x.layer} ${x.v}`).join('<br>')||'无额外加成'}</p>`;}}
 const el=document.getElementById('native-combat-stats');if(el&&g.battle&&g.s.phase==='battle'){const btl=g.battle.s,total=btl.benchmark?btl.enemies[0]?.damageLedger.total||0:Object.values(btl.damage).reduce((n,v)=>n+v,0);el.innerHTML=`<h3>${Math.max(0,Math.ceil(btl.limit-btl.time))} 秒</h3><p>伤害 ${Math.round(total).toLocaleString()}<br>击倒 ${btl.kills} / ${btl.total}<br>漏失 ${btl.leaks}</p>`;}
 if(!painting&&eggOn())for(const node of [status,cost,progress,live,dossierHp,dossierLive,el])apply325Display(node);
}
function geometry(){
 const r=canvas.getBoundingClientRect(),v=state.game?.map.viewport||{left:0,right:10,top:0,bottom:6},cols=v.right-v.left+1,rows=v.bottom-v.top+1;
 let left=16,top=22,width=r.width-32,height=r.height-44;
 if(document.documentElement.classList.contains('native-landscape-ui')||(innerWidth>innerHeight&&innerHeight<=600&&innerWidth<=1100)){
  const bonds=root.querySelector('.native-bonds').getBoundingClientRect(),controls=root.querySelector('.native-controls').getBoundingClientRect(),caption=root.querySelector('.native-field-caption').getBoundingClientRect();
  left=bonds.right-r.left+8;top=caption.bottom-r.top+8;width=controls.left-r.left-left-8;
  // Reserve the expanded shop's space in both states so deployment targets stay put.
  height=r.height-top-8-(state.supplyCollapsed&&state.game.s.phase!=='battle'?58:0);
 }
 const tw=Math.min(width/cols,height/rows/.82),th=tw*.82;
 return {r,tw,th,ox:left+(width-tw*cols)/2-v.left*tw,oy:top+(height-th*rows)/2-v.top*th};
}
function cellAt(x,y){const z=geometry();return{x:Math.floor((x-z.r.left-z.ox)/z.tw),y:Math.floor((y-z.r.top-z.oy)/z.th)};}
function place(uid,x,y){
 const g=state.game,u=g.s.units.find(u=>u.uid===uid);if(!u||g.s.phase!=='prep')return;
 if(state.item){action({dataset:{act:'select',uid:String(uid)}});return;}
 if(!g.canDeploy(uid,x,y)){notice('该位置无法部署或交换此干员');return;}
 state.inspect=null;state.selected=uid;state.preview={uid,x,y,dir:null,revision:g.s.commands.length};render();
}
 function placeSummon(cardUid,x,y){const g=state.game;if(!g||g.s.phase!=='prep'||!g.canDeploySummonCard(cardUid,x,y)){notice('该位置不在召唤卡的可部署范围内');return;}state.inspect=null;state.preview={summonUid:cardUid,x,y,dir:null,revision:g.s.commands.length};render();}
function commitPreview(){
 const p=state.preview,g=state.game;if(!p)return;if(p.summonUid!=null){if(p.dir===null){notice('请先选择召唤物朝向');return;}if(g.s.phase!=='prep'||g.s.commands.length!==p.revision){state.preview=null;notice('阵地已变化，请重新选择召唤卡');render();return;}if(!g.perform('deploySummon',p.summonUid,p.x,p.y,p.dir)){notice('该位置无法部署召唤卡');return;}state.preview=null;state.summonSelected=null;state.inspect=null;save();render();return;}if(p.dir===null){notice('请先选择朝向');return;}
 if(g.s.phase!=='prep'||g.s.commands.length!==p.revision){state.preview=null;notice('阵地已变化，请重新选择位置');render();return;}
 if(!g.perform('deploy',p.uid,p.x,p.y,p.dir))notice('该位置无法部署');
 state.preview=null;state.selected=null;state.inspect=null;save();render();
}
function insideRect(r,x,y){return !!r&&x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;}
function overCanvas(x,y){return canvas?.isConnected&&insideRect(canvas.getBoundingClientRect(),x,y);}
function overBench(x,y){return ['.native-bench','.native-bench-label'].some(selector=>insideRect(root.querySelector(selector)?.getBoundingClientRect(),x,y));}
function overShop(x,y){const shop=document.getElementById('native-supply-shop');if(!shop||!shop.offsetParent)return false;return insideRect(shop.getBoundingClientRect(),x,y);}
function overUnitCard(x,y){const el=document.elementFromPoint(x,y)?.closest?.('[data-act="select"]');if(!el)return null;const uid=Number(el.dataset.uid);return state.game?.s.units.find(u=>u.uid===uid)||null;}
// 装备落点也包含棋盘上已部署的干员（召唤物与召唤卡不算）
function equipDropTarget(x,y){const u=overUnitCard(x,y);if(u)return u;if(!overCanvas(x,y))return null;const hit=unitAtPointer(x,y);if(!hit||hit.kind||hit.summon||hit.summonCard)return null;return state.game?.s.units.find(v=>v.uid===hit.uid)||null;}
// 装备到干员（点击流程与拖放流程共用）。槽位已满时弹出摧毁选择。
function equipItemOnUnit(uid,itemUid=state.item){const g=state.game;if(!itemUid||!g.s.items.some(i=>i.uid===itemUid)){notice('先从整备区选择一件装备。');return false;}if(!g.perform('equip',itemUid,uid)){const u=g.s.units.find(x=>x.uid===uid);if(u?.equipment.length>=2){state.item=itemUid;modal(`<h2>选择替换的装备</h2><p>装备槽已满，请选择要摧毁的一件。</p>${u.equipment.map((e,i)=>`<button data-act="replace" data-uid="${uid}" data-slot="${i}">${esc(itemName(e.chessId))}</button>`).join('')}`);return false;}notice('当前阶段无法装备该道具。');return false;}state.item=null;notice('已装备。');return true;}
function tileLift(tile,z){return (tile?.heightType==='HIGHLAND'||tile?.tileKey==='tile_fence_bound')&&tile.buildableType!=='NONE'?Math.min(10,z.th*.22):0;}
 function unitAtPointer(x,y){
  const g=state.game,z=geometry(),px=x-z.r.left,py=y-z.r.top,size=Math.min(z.tw*.68,z.th*1.1);
  const units=g.s.units.filter(u=>u.position).slice().sort((a,b)=>b.position.y-a.position.y||b.position.x-a.position.x);
  for(const u of units){const cx=z.ox+(u.position.x+.5)*z.tw,cy=z.oy+(u.position.y+.5)*z.th-tileLift(g.map.grid[u.position.y][u.position.x],z)*.5;if(px>=cx-size/2-3&&px<=cx+size/2+3&&py>=cy-size*.75-3&&py<=cy+size*.35+14)return u;}
  if(g.s.phase==='prep')for(const card of (g.s.summonCards||[]).filter(c=>c.position).slice().sort((a,b)=>b.position.y-a.position.y||b.position.x-a.position.x)){const cx=z.ox+(card.position.x+.5)*z.tw,cy=z.oy+(card.position.y+.5)*z.th-tileLift(g.map.grid[card.position.y]?.[card.position.x],z)*.5;if(px>=cx-size/2-3&&px<=cx+size/2+3&&py>=cy-size*.75-3&&py<=cy+size*.35+14)return {uid:card.uid,kind:'summon-card',summonCard:true};}
  if(g.battle){
  const summons=(g.battle.s.summons||[]).filter(s=>s.deployed).slice().sort((a,b)=>b.y-a.y||b.x-a.x);
  for(const s of summons){const cx=z.ox+(s.x+.5)*z.tw,cy=z.oy+(s.y+.5)*z.th-tileLift(g.map.grid[s.y]?.[s.x],z)*.5;if(px>=cx-size/2-3&&px<=cx+size/2+3&&py>=cy-size*.75-3&&py<=cy+size*.35+14)return {uid:s.uid,kind:'summon',summon:true};}
 }
 const cell=cellAt(x,y);return units.find(u=>u.position.x===cell.x&&u.position.y===cell.y);
}
 function dragFeedback(){
  const bench=root.querySelector('.native-bench'),hint=document.getElementById('native-drop-hint'),over=drag?.moved&&drag.from==='field'&&overBench(drag.x,drag.y),full=state.game?.hand().length>=10;
  bench?.classList.toggle('drop-target',!!over&&!full);bench?.classList.toggle('drop-blocked',!!over&&full);const shop=document.getElementById('native-supply-shop');const overShopNow=drag?.moved&&drag.kind==='operator'&&overShop(drag.x,drag.y);if(shop)shop.classList.toggle('drop-target',!!overShopNow);const itemDrag=drag?.moved&&drag.kind==='item';const hoverUnit=itemDrag?equipDropTarget(drag.x,drag.y):null;for(const card of root.querySelectorAll('.native-bench [data-act="select"]')){card.classList.toggle('drop-target',!!hoverUnit&&Number(card.dataset.uid)===hoverUnit.uid);}
  const text=over?(full?'整备区已满，无法收回':`松手将${drag?.kind==='summon-card'?'召唤物':'干员'}移回整备区`):'可将场上干员或召唤物拖回此处；换位后重新选朝向';if(hint&&hint.textContent!==text)hint.textContent=text;
  let ghost=document.getElementById('native-drag-ghost');if(!drag?.moved){ghost?.remove();return;}
  if(!ghost){ghost=document.createElement('div');ghost.id='native-drag-ghost';ghost.className='native-drag-ghost';ghost.setAttribute('aria-hidden','true');const u=state.game.s.units.find(u=>u.uid===drag.uid),card=state.game.s.summonCards?.find(c=>c.uid===drag.uid),item=drag.kind==='item'?state.game.s.items.find(i=>i.uid===drag.uid):null;ghost.innerHTML=drag.kind==='summon-card'?`<span class="native-summon-icon">◈</span><b>${esc(card?.name||'召唤物')}</b>`:item?`<span class="native-item-icon">◇</span><b>${esc(itemName(item.chessId))}</b>`:u?avatar(u.charId):'';root.append(ghost);}ghost.style.left=(drag.x-28)+'px';ghost.style.top=(drag.y-36)+'px';
}
function clearDrag(){drag=null;canvasPress=null;touchButton=null;dragFeedback();}
function drawTerrain(c,z,map){
 for(let y=0;y<map.rows;y++)for(let x=0;x<map.cols;x++){
  const t=map.grid[y][x];if(t.zone)continue;const px=z.ox+x*z.tw+2,py=z.oy+y*z.th+2,w=z.tw-4,h=z.th-4,lift=tileLift(t,z),entry=t.tileKey.startsWith('tile_start'),goal=t.tileKey.startsWith('tile_end'),blocked=!!t.obstacle,corridor=t.buildableType==='NONE'&&t.passableMask!=='NONE'&&!blocked;
  c.fillStyle='#071216';c.fillRect(px,py+3,w,h);
  if(lift&&!blocked){const top=c.createLinearGradient(px,py,px+w,py+h-lift);top.addColorStop(0,'#a4b7bd');top.addColorStop(1,'#718b98');c.fillStyle=top;c.fillRect(px,py,w,h-lift);c.fillStyle='#314c5c';c.fillRect(px,py+h-lift,w,lift);c.strokeStyle='#d7e5e9';c.lineWidth=1.2;c.strokeRect(px+.5,py+.5,w-1,h-lift-1);c.strokeStyle='#182e3b';c.beginPath();c.moveTo(px,py+h);c.lineTo(px+w,py+h);c.stroke();c.fillStyle='#dce8eb';c.font=Math.max(8,Math.min(10,z.tw*.16))+'px sans-serif';c.textAlign='right';c.fillText(t.heightType==='HIGHLAND'?'高台':'隔离平台',px+w-3,py+h-2);}
  else{const top=c.createLinearGradient(px,py,px,py+h);top.addColorStop(0,entry?'#824537':goal?'#356c7b':blocked?'#1a282e':corridor?'#1b4e59':'#42565b');top.addColorStop(1,entry?'#49291f':goal?'#203e4d':blocked?'#121e24':corridor?'#102d36':'#2a3c42');c.fillStyle=top;c.fillRect(px,py,w,h);c.strokeStyle=entry?'#ffad7c':goal?'#8bdcea':blocked?'#36464d':corridor?'#63dce4':'#61767b';c.lineWidth=entry||goal||corridor?1.5:.8;c.strokeRect(px+.5,py+.5,w-1,h-1);
   if(blocked){c.save();c.beginPath();c.rect(px,py,w,h);c.clip();c.strokeStyle='#69828a22';c.lineWidth=1;for(let i=-h;i<w;i+=10){c.beginPath();c.moveTo(px+i,py+h);c.lineTo(px+i+h,py);c.stroke();}c.restore();c.fillStyle='#607780';c.font=Math.max(9,Math.min(13,z.tw*.22))+'px sans-serif';c.textAlign='center';c.fillText('工事',px+w/2,py+h/2+4);}
   else if(entry||goal){c.fillStyle=entry?'#ffc39b':'#b8f1fb';c.textAlign='center';c.font='bold '+Math.max(9,Math.min(14,z.tw*.24))+'px sans-serif';c.fillText(entry?'入口':'目标',px+w/2,py+h/2+4);}
   else{c.strokeStyle=corridor?'#8beaf055':'#91a6ac50';c.lineWidth=1;for(const [cx,cy,sx,sy]of [[px+3,py+3,1,1],[px+w-3,py+3,-1,1],[px+3,py+h-3,1,-1],[px+w-3,py+h-3,-1,-1]]){c.beginPath();c.moveTo(cx+sx*4,cy);c.lineTo(cx,cy);c.lineTo(cx,cy+sy*4);c.stroke();}if(corridor){c.save();c.beginPath();c.rect(px,py,w,h);c.clip();c.strokeStyle='#8beaf033';c.lineWidth=1;for(let i=-h;i<w;i+=8){c.beginPath();c.moveTo(px+i,py+h);c.lineTo(px+i+h,py);c.stroke();}c.restore();}c.fillStyle=corridor?'#a9f4f0b8':'#a6b7b966';c.textAlign='left';c.font='9px sans-serif';c.fillText(corridor?'通道':'地',px+4,py+h-4);}
  }
 }
 c.font='9px monospace';c.textAlign='center';c.fillStyle='#a7bebc';for(let x=map.viewport.left;x<=map.viewport.right;x++)c.fillText(String.fromCharCode(65+x),z.ox+(x+.5)*z.tw,z.oy-5);for(let y=map.viewport.top;y<=map.viewport.bottom;y++)c.fillText(canvasNumber(y+1),Math.max(8,z.ox+map.viewport.left*z.tw-10),z.oy+(y+.5)*z.th+3);
}
function draw(){
 if(!canvas||state.view!=='game'||!state.game)return;const g=state.game,z=geometry(),dpr=Math.min(2,window.devicePixelRatio||1);if(canvas.width!==Math.round(z.r.width*dpr)||canvas.height!==Math.round(z.r.height*dpr)){canvas.width=Math.round(z.r.width*dpr);canvas.height=Math.round(z.r.height*dpr);}const c=canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,z.r.width,z.r.height);const point=(x,y)=>({x:z.ox+(x+.5)*z.tw,y:z.oy+(y+.5)*z.th});c.fillStyle='#111f23';c.fillRect(0,0,z.r.width,z.r.height);
 drawTerrain(c,z,g.map);const finalTurn=state.game.s.phase==='prep'&&currentTurn()?.isBossTurn;if(finalTurn||(g.battle?.s.benchmark&&g.battle?.s.enemies.some(e=>e.trainingDummy))){const area={left:9,right:10,top:0,bottom:2};c.fillStyle='#e5b86c22';c.strokeStyle='#f2d58b';c.lineWidth=2;c.setLineDash([6,4]);c.strokeRect(z.ox+area.left*z.tw+1,z.oy+area.top*z.th+1,(area.right-area.left+1)*z.tw-2,(area.bottom-area.top+1)*z.th-2);c.setLineDash([]);c.fillStyle='#f2d58b';c.font='bold 12px sans-serif';c.textAlign='center';c.fillText(finalTurn?'木桩判定范围':'木桩',z.ox+(area.left+1)*z.tw,z.oy+area.bottom*z.th+18);}
 const selected=g.s.units.find(u=>u.uid===(state.preview?.uid||state.selected)),live=selected&&g.battle?g.battle.s.units.find(u=>u.uid===selected.uid):null;
 if(selected&&(selected.position||state.preview)){
  const p=state.preview||{...selected.position,dir:selected.dir};
  const cells=g.s.phase==='battle'&&!state.preview&&g.battle&&live?g.battle.range(live,g.battle.skillActive(live)):((profile(selected).range?.grids||[]).concat(profile(selected).branch==='fortress'?[{row:0,col:0}]:[]).map(cell=>{let x=cell.col,y=-cell.row;for(let i=0;i<(p.dir??0);i++)[x,y]=[-y,x];return{x:p.x+x,y:p.y+y};}));
  for(const cell of cells)c.fillStyle='#63d8b738',c.fillRect(z.ox+cell.x*z.tw+2,z.oy+cell.y*z.th+2,z.tw-4,z.th-4);
 }
 const statusOverlays=[];
  const prepSummons=g.s.phase==='prep'?(g.s.summonCards||[]).filter(card=>card.position).map(card=>({...card,x:card.position.x,y:card.position.y,id:card.type,deployed:true})):[];
  const actors=g.s.phase==='battle'||g.s.phase==='finished'||g.s.phase==='intermission'?g.battle?.s.units||[]:[...g.s.units.filter(u=>u.position).map(u=>({...u,x:u.position.x,y:u.position.y,id:u.charId,deployed:true})),...prepSummons];
  for(const u of actors){
   if(u.kind==='summon-card'){const p=point(u.x,u.y);p.y-=tileLift(g.map.grid[u.y]?.[u.x],z)*.5;const size=Math.min(z.tw*.68,z.th*1.1),chosen=state.summonSelected===u.uid||state.preview?.summonUid===u.uid;c.fillStyle='#4bcdb6';c.beginPath();c.moveTo(p.x,p.y-size*.55);c.lineTo(p.x+size*.42,p.y);c.lineTo(p.x,p.y+size*.45);c.lineTo(p.x-size*.42,p.y);c.closePath();c.fill();c.strokeStyle=chosen?'#f4d38b':'#b5fff0';c.lineWidth=chosen?3:1.5;c.stroke();c.fillStyle='#06221f';c.font='bold '+Math.max(12,size*.42)+'px sans-serif';c.textAlign='center';c.fillText('召',p.x,p.y+size*.15);c.fillStyle='#e9fff7';c.font='10px sans-serif';c.fillText(u.name||'召唤物',p.x,p.y-size*.7);c.fillText(['→','↓','←','↑'][u.dir||0],p.x+size*.55,p.y);continue;}
   const shift=g.battle&&!state.reduceFx?actorOffset(u,g.battle):{x:0,y:0};
  const p=point(u.x+shift.x,u.y+shift.y);p.y-=tileLift(g.map.grid[u.y]?.[u.x],z)*.5;const im=img(u.id),size=Math.min(z.tw*.68,z.th*1.1);
  const waiting=!u.deployed&&u.hp>0,down=!u.deployed&&u.hp<=0;
  c.globalAlpha=waiting?0.45:down?0.3:1;
  c.fillStyle=data.profiles[u.chessId]?.isGolden?'#f3ce74':'#b8e7d8';c.fillRect(p.x-size/2-2,p.y-size*.75-2,size+4,size+4);if(im?.complete&&im.naturalWidth)c.drawImage(im,p.x-size/2,p.y-size*.75,size,size);
  if(u.skillLeft>0||u.ammo>0){c.strokeStyle='#f4d38b';c.lineWidth=2;c.strokeRect(p.x-size/2-3,p.y-size*.75-3,size+6,size+6);}
  c.globalAlpha=1;c.fillStyle='#d5fff1';c.font='14px sans-serif';c.textAlign='center';c.fillText(['→','↓','←','↑'][u.dir],p.x+size*.65,p.y);
  statusOverlays.push(()=>{
  drawElementRing(c,p.x,p.y,u,size);
  drawFrostOverlay(c,u,{x:p.x-size/2,y:p.y-size*.75,w:size,h:size},{reduceFx:state.reduceFx});
  if(u.hp!==undefined&&u.deployed){c.fillStyle='#122022';c.fillRect(p.x-size/2,p.y+size*.35,size,4);c.fillStyle='#75d9aa';c.fillRect(p.x-size/2,p.y+size*.35,size*Math.max(0,u.hp/u.maxHp),4);}
  const sk=profile(u)?.skill,cost=g.battle&&u.sp!==undefined?g.battle.spCost(u):sk?.spData?.spCost||0,fill=spBarFill(u,sk,cost);if(fill&&u.deployed){const bx=p.x-size/2,by=p.y+size*.35+(u.hp!==undefined?6:0);if(fill.kind==='ammo'){const n=fill.cells,gap=1,cw=Math.max(1,(size-(n-1)*gap)/n);for(let i=0;i<n;i++){c.fillStyle='#122022';c.fillRect(bx+i*(cw+gap),by,cw,4);if(i<fill.filled){c.fillStyle='#f4d38b';c.fillRect(bx+i*(cw+gap),by,cw,4);}}}else{c.fillStyle='#122022';c.fillRect(bx,by,size,3);c.fillStyle=fill.on?'#f4d38b':fill.ready?'#f0d18a':'#7bbaf3';c.fillRect(bx,by,size*fill.ratio,3);}}
  if(g.battle)drawStatuses(c,p.x,p.y,u,size);if(down)drawDownRing(c,p,u,size,eggOn()?{formatNumber:format325}:undefined);
  });
 }
 if(g.battle)for(const s of g.battle.s.summons||[]){
  if(!s.deployed)continue;
  const p=point(s.x,s.y);p.y-=tileLift(g.map.grid[s.y]?.[s.x],z)*.5;const size=Math.min(z.tw*.5,z.th*.8);
  if(s.type==='svash2-float'){c.fillStyle='#8bd8e5';c.beginPath();c.arc(p.x,p.y-size*.05,size*.42,0,Math.PI*2);c.fill();c.fillStyle='#143238';c.font='bold '+Math.max(12,size*.55)+'px sans-serif';c.textAlign='center';c.fillText('浮',p.x,p.y+size*.15);c.strokeStyle='#f4efe2';c.lineWidth=2;c.stroke();}else{c.fillStyle=s.device?'#7ec8e3':'#c9a56a';c.beginPath();c.moveTo(p.x,p.y-size*.55);c.lineTo(p.x+size*.4,p.y);c.lineTo(p.x,p.y+size*.45);c.lineTo(p.x-size*.4,p.y);c.closePath();c.fill();c.strokeStyle='#f4efe2';c.lineWidth=state.inspect?.kind==='summon'&&state.inspect.uid===s.uid?2:1;c.stroke();}
  statusOverlays.push(()=>{
  drawElementRing(c,p.x,p.y,s,size);
  drawFrostOverlay(c,s,{x:p.x-size/2,y:p.y-size*.55,w:size,h:size},{reduceFx:state.reduceFx});
  c.fillStyle='#122022';c.fillRect(p.x-size/2,p.y+size*.35,size,4);c.fillStyle='#75d9aa';c.fillRect(p.x-size/2,p.y+size*.35,size*Math.max(0,s.hp/s.maxHp),4);
  drawStatuses(c,p.x,p.y,s,size);
  c.fillStyle='#e9fff7';c.font='10px sans-serif';c.textAlign='center';c.fillText(s.name||s.type,p.x,p.y-size*.65);
  });
 }
 if(g.battle&&g.s.phase!=='prep')for(const e of g.battle.s.enemies){if(e.hidden)continue;const p=point(e.x,e.y),im=img(e.id),size=z.tw*.55;if(e.trainingDummy){c.fillStyle='#be9364';c.fillRect(p.x-7,p.y-20,14,40);c.fillRect(p.x-20,p.y-10,40,10);c.fillStyle='#fff0c8';c.font='bold 22px sans-serif';c.fillText('∞',p.x,p.y-26);drawFrostOverlay(c,e,{x:p.x-20,y:p.y-20,w:40,h:40},{reduceFx:state.reduceFx});}else{if(im?.complete&&im.naturalWidth)c.drawImage(im,p.x-size/2,p.y-size/2-(e.flying?15:0),size,size);else{c.fillStyle='#d9846d';c.beginPath();c.arc(p.x,p.y,12,0,Math.PI*2);c.fill();}statusOverlays.push(()=>{drawElementRing(c,p.x,p.y-(e.flying?15:0),e,size);drawFrostOverlay(c,e,{x:p.x-size/2,y:p.y-size/2-(e.flying?15:0),w:size,h:size},{reduceFx:state.reduceFx});c.fillStyle='#e29179';c.fillRect(p.x-size/2,p.y-size*.65-(e.flying?15:0),size*Math.max(0,e.hp/e.maxHp),3);drawStatuses(c,p.x,p.y-(e.flying?15:0),e,size);});}if(g.battle.s.summons?.some(s=>s.type==='svash2-float'&&s.svashPursuit&&s.svashTargetUid===e.uid)){c.fillStyle='#ef566b';c.font='bold 14px sans-serif';c.textAlign='center';c.fillText('狼眼',p.x,p.y-size*.8);}if(g.battle.s.whitwEyes?.some(x=>x.targetUid===e.uid)){const y=p.y-size*.8-(e.flying?15:0);c.save();c.strokeStyle='#ff4f5e';c.fillStyle='#ff4f5e';c.lineWidth=2;c.beginPath();c.ellipse(p.x,y,7,4.5,0,0,Math.PI*2);c.stroke();c.beginPath();c.arc(p.x,y,2,0,Math.PI*2);c.fill();c.beginPath();c.moveTo(p.x-11,y);c.lineTo(p.x-8,y);c.moveTo(p.x+8,y);c.lineTo(p.x+11,y);c.stroke();c.restore();}}
 if(g.battle)drawWhitwEyes(c,point,z,g.battle,{reduceFx:state.reduceFx});
 if(g.battle&&g.s.phase==='battle')drawFx(c,point,z,g.battle,{reduceFx:state.reduceFx,formatText:eggOn()?rewrite325Text:null});
  if(drag?.moved&&overCanvas(drag.x,drag.y)){const cell=cellAt(drag.x,drag.y);if(g.map.grid[cell.y]?.[cell.x]){const can=drag.kind==='summon-card'?g.canDeploySummonCard(drag.uid,cell.x,cell.y):g.canDeploy(drag.uid,cell.x,cell.y);c.strokeStyle=can?'#78f1bd':'#f88c78';c.lineWidth=3;c.strokeRect(z.ox+cell.x*z.tw+2,z.oy+cell.y*z.th+2,z.tw-4,z.th-4);}}
 if(state.preview){const p=point(state.preview.x,state.preview.y);c.fillStyle='#08151195';c.fillRect(0,0,z.r.width,z.r.height);c.strokeStyle='#70e4c1';c.lineWidth=2;c.beginPath();c.moveTo(p.x,p.y-62);c.lineTo(p.x+62,p.y);c.lineTo(p.x,p.y+62);c.lineTo(p.x-62,p.y);c.closePath();c.stroke();c.fillStyle='#e9fff7';c.font='bold 32px sans-serif';c.fillText(state.preview.dir===null?'✥':['→','↓','←','↑'][state.preview.dir],p.x,p.y+10);}
 // HUD is the final canvas pass: portraits and combat effects cannot cover it.
 for(const drawOverlay of statusOverlays){c.save();c.globalAlpha=1;drawOverlay();c.restore();}
}
root.addEventListener('change',e=>{
 if(e.target.id==='native-mode')state.mode=e.target.value;if(e.target.id==='native-map')state.map=e.target.value;if(e.target.id==='native-skill'){state.game.perform('skill',Number(e.target.dataset.uid),Number(e.target.value));save();render();}
 if(state.view==='editor'&&e.target.dataset.act){const catalog=document.getElementById('ed-catalog');state.editor.scroll=catalog?.scrollTop||0;if(applyEditorField(e.target.dataset.act,e.target.dataset.id,e.target.value,state.waveTable,state.editor)){if(['ed-budget','ed-cost','ed-default','ed-temp-name'].includes(e.target.dataset.act)){const sample=root.querySelector('.wave-ed-sample');if(sample)sample.textContent='配置已更新，点击“预演抽取”查看新结果。';}else queueMicrotask(()=>render());}}
});
root.addEventListener('input',e=>{
 if(e.target.id==='native-volume'||e.target.hasAttribute('data-native-volume')){state.volume=Number(e.target.value);savePreference('garrison-volume',String(state.volume));return;}
 if(e.target.id==='sandbox-op-search'){const term=e.target.value.trim().toLowerCase();if(state.sandbox)state.sandbox.opQuery=e.target.value;for(const button of root.querySelectorAll('[data-sandbox-op]'))button.hidden=!button.dataset.sandboxOp.includes(term);return;}if(e.target.id==='sandbox-enemy-search'){const term=e.target.value.trim().toLowerCase();if(state.sandbox)state.sandbox.enemyQuery=e.target.value;for(const button of root.querySelectorAll('[data-sandbox-enemy]'))button.hidden=!button.dataset.sandboxEnemy.includes(term);return;}
 if(e.target.id!=='ed-search')return;state.editor.query=e.target.value;state.editor.caret=e.target.selectionStart||e.target.value.length;state.editor.keepSearch=true;const catalog=document.getElementById('ed-catalog');state.editor.scroll=catalog?.scrollTop||0;render();
});
const paneShift=new WeakMap();
function rotatedPlay(){return document.documentElement.classList.contains('native-need-rotate');}
function paneLocal(scroller,x,y){
 const r=scroller.getBoundingClientRect();
 if(rotatedPlay())return {x:y-r.top,y:r.right-x,w:r.height,h:r.width};
 return {x:x-r.left,y:y-r.top,w:r.width,h:r.height};
}
function scrollerAtPoint(x,y){
 const hit=document.elementFromPoint(x,y);
 const panes=[...root.querySelectorAll('.native-strategy-catalog, .native-strategy-pane, .native-dossier, .native-modal>section, .native-lobby')].reverse();
 for(const pane of panes){
  if(paneMax(pane)<=0)continue;
  const p=paneLocal(pane,x,y);
  if(p.x<0||p.x>p.w||p.y<0||p.y>p.h)continue;
  if(!pane.contains(hit))continue;
  return pane;
 }
 return null;
}
function paneTrack(scroller){
 return scroller.querySelector(':scope > .native-strategies, :scope > .native-dossier-body, .native-strategies, .native-dossier-body')||scroller.firstElementChild;
}
function paneMax(scroller){
 if(scroller.matches('.native-lobby, .native-strategy-catalog'))return Math.max(0,scroller.scrollHeight-scroller.clientHeight);
 const track=paneTrack(scroller);
 return Math.max(0,(track?.offsetHeight||0)-scroller.clientHeight);
}
function shiftOf(scroller){return scroller.matches('.native-lobby, .native-strategy-catalog')?scroller.scrollTop:paneShift.get(scroller)||0;}
function setShift(scroller,y){
 if(scroller.matches('.native-lobby, .native-strategy-catalog')){const next=Math.max(0,Math.min(paneMax(scroller),y));scroller.scrollTop=next;return next;}
 const track=paneTrack(scroller);
 if(!track)return 0;
 const next=Math.max(0,Math.min(paneMax(scroller),y));
 paneShift.set(scroller,next);
 track.style.marginTop=next?`-${next}px`:'';
 scroller.scrollTop=0;
 return next;
}
function hitInScroller(scroller,x,y){
 if(!scroller)return null;
 const button=document.elementFromPoint(x,y)?.closest?.('button[data-act]');
 return button&&scroller.contains(button)&&!button.disabled?button:null;
}
function paneScroller(start){
 let node=start?.nodeType===1?start:start?.parentElement;
 while(node&&node!==root){
  if(node.matches?.('.native-strategy-catalog, .native-strategy-pane, .native-dossier, .native-modal>section, .native-lobby')&&paneMax(node)>0)return node;
  node=node.parentElement;
 }
 return null;
}
function paneDelta(touch,clientX,clientY){
 return rotatedPlay()?touch.x-clientX:touch.y-clientY;
}
let paneTouch=null,paneMoved=false;
root.addEventListener('touchstart',e=>{
 if(e.touches.length!==1)return;
 paneMoved=false;
 const t=e.touches[0],scroller=scrollerAtPoint(t.clientX,t.clientY)||paneScroller(e.target);
 if(!scroller||paneMax(scroller)<=0){paneTouch=null;paneMoved=false;return;}
 paneMoved=false;
 paneTouch={scroller,x:t.clientX,y:t.clientY,top:shiftOf(scroller)};
},{passive:true});
root.addEventListener('touchmove',e=>{
 if(!paneTouch||e.touches.length!==1)return;
 const t=e.touches[0],dy=paneDelta(paneTouch,t.clientX,t.clientY);
 if(Math.abs(dy)<8)return;
 setShift(paneTouch.scroller,paneTouch.top+dy);
 paneMoved=true;
 touchButton=null;
 e.preventDefault();
},{passive:false});
root.addEventListener('touchend',()=>{
  if(paneMoved){ignoredClickUntil=Math.max(ignoredClickUntil,performance.now()+80);paneTouch=null;return;}
  paneTouch=null;paneMoved=false;
},{passive:true});
root.addEventListener('touchcancel',()=>{paneTouch=null;paneMoved=false;},{passive:true});
root.addEventListener('wheel',e=>{
 const scroller=scrollerAtPoint(e.clientX,e.clientY);
 if(!scroller||paneMax(scroller)<=0)return;
 e.preventDefault();
 setShift(scroller,shiftOf(scroller)+e.deltaY);
},{passive:false});
root.addEventListener('click',e=>{
  if(dossierDismissedAt>0&&performance.now()-dossierDismissedAt<500){dossierDismissedAt=0;e.preventDefault();return;}
  const dossierButton=e.target.closest?.('.native-dossier button[data-act]');
  if(dossierButton){
   if(e.pointerType==='touch'||(e.pointerId===ignoredClickPointer&&performance.now()<ignoredClickUntil))return;
   action(dossierButton);return;
  }
  if(e.target.closest('.native-strategy-pane, .native-dossier'))return;
 if(e.pointerType==='touch'||(e.pointerId===ignoredClickPointer&&performance.now()<ignoredClickUntil))return;
 if(state.view==='editor'){const hit=e.target.closest('[data-act]');if(!hit||hit.matches('input,select,textarea'))return;action(hit);return;}
 const button=e.target.closest('button[data-act], [role="button"][data-act]');if(button)action(button);
});
root.addEventListener('pointerdown',e=>{
  if(e.isPrimary===false||e.button!==0)return;ignoredClickPointer=null;ignoredClickUntil=0;
  if(state.inspect?.kind==='unit'&&!e.target.closest?.('.native-dossier')){state.inspect=null;dossierDismissedAt=performance.now();e.preventDefault();render();return;}
 const paneHit=hitInScroller(scrollerAtPoint(e.clientX,e.clientY),e.clientX,e.clientY);
 const button=paneHit||e.target.closest('button[data-act], [role="button"][data-act]');
 if(e.pointerType==='touch'&&button&&!button.disabled)touchButton={b:button,id:e.pointerId,x:e.clientX,y:e.clientY};
 const manage=state.game?.s.phase==='prep'&&!state.game.s.rewardPending&&!state.modal;
  if(button?.dataset.act==='destroy'||button?.dataset.act==='destroyEquip')return;
  if(button?.dataset.act==='item'&&manage&&button.dataset.uid){drag={uid:Number(button.dataset.uid),kind:'item',id:e.pointerId,from:'hand',x0:e.clientX,y0:e.clientY,x:e.clientX,y:e.clientY,moved:false};button.setPointerCapture(e.pointerId);return;}
  if((button?.dataset.act==='select'||button?.dataset.act==='summon-select')&&manage&&!state.item&&(button.dataset.act!=='summon-select'||button.dataset.mode==='manual')){state.preview=null;root.querySelector('.native-facing')?.setAttribute('hidden','');drag={uid:Number(button.dataset.uid),kind:button.dataset.act==='summon-select'?'summon-card':'operator',id:e.pointerId,from:'hand',x0:e.clientX,y0:e.clientY,x:e.clientX,y:e.clientY,moved:false};button.setPointerCapture(e.pointerId);return;}
 if(e.target!==canvas)return;
 if(state.preview&&manage){const z=geometry(),x=z.r.left+z.ox+(state.preview.x+.5)*z.tw,y=z.r.top+z.oy+(state.preview.y+.5)*z.th;if(Math.hypot(e.clientX-x,e.clientY-y)>95){state.preview=null;render();return;}aim={x,y,id:e.pointerId};canvas.setPointerCapture(e.pointerId);return;}
  const cell=cellAt(e.clientX,e.clientY),unit=unitAtPointer(e.clientX,e.clientY);canvasPress={...cell,uid:unit?.uid,kind:unit?.kind,x0:e.clientX,y0:e.clientY};
  if(unit&&manage&&!state.item&&(!unit.summon||unit.summonCard))drag={uid:unit.uid,kind:unit.summonCard?'summon-card':'operator',id:e.pointerId,from:'field',x0:e.clientX,y0:e.clientY,x:e.clientX,y:e.clientY,moved:false};canvas.setPointerCapture(e.pointerId);
});
root.addEventListener('pointermove',e=>{
 if(touchButton&&Math.hypot(e.clientX-touchButton.x,e.clientY-touchButton.y)>8)touchButton=null;
 if(drag&&drag.id===e.pointerId){drag.x=e.clientX;drag.y=e.clientY;if(Math.hypot(e.clientX-drag.x0,e.clientY-drag.y0)>8)drag.moved=true;if(drag.moved){canvasPress=null;touchButton=null;dragFeedback();draw();}}
 if(aim&&aim.id===e.pointerId&&state.preview){const dx=e.clientX-aim.x,dy=e.clientY-aim.y;state.preview.dir=Math.hypot(dx,dy)<18?null:Math.abs(dx)>Math.abs(dy)?dx>0?0:2:dy>0?1:3;draw();}
});
root.addEventListener('pointerup',e=>{
 if(drag&&drag.id===e.pointerId){const d=drag;if(d.moved){
if(d.kind==='operator'&&overShop(e.clientX,e.clientY)){drag=null;dragFeedback();const u=state.game.s.units.find(x=>x.uid===d.uid);const name=u?(data.profiles[u.chessId]?.name||'干员'):'干员';if(state.game.perform('sell',d.uid)){state.selected=null;state.inspect=null;save();notice('已出售 '+name+'，资金 +'+(u?data.season.shopCharChessInfoData[u.rank][data.season.charChessDataDict[u.chessId].isGolden?1:0].chessSoldPrice:0)+' ◆');}else notice('当前阶段无法出售该干员。');render();return;}
if(d.kind==='item'&&d.from==='hand'){const u=equipDropTarget(e.clientX,e.clientY);drag=null;dragFeedback();if(u){const name=data.profiles[u.chessId]?.name||'干员';const equipped=equipItemOnUnit(u.uid,d.uid);state.selected=u.uid;state.inspect={kind:'unit',uid:u.uid};save();render();if(equipped)notice('已为'+name+'装备。');return;}notice('请把装备拖到干员身上。');render();return;}ignoredClickPointer=e.pointerId;ignoredClickUntil=performance.now()+400;clearDrag();state.inspect=null;
    if(d.from==='field'&&overBench(e.clientX,e.clientY)){const ok=d.kind==='summon-card'?state.game.perform('withdrawSummon',d.uid):state.game.perform('withdraw',d.uid);if(ok){state.selected=state.summonSelected=state.preview=null;save();notice('已移回整备区');}else notice('整备区已满或当前阶段无法收回');render();}
    else if(overCanvas(e.clientX,e.clientY)){const cell=cellAt(e.clientX,e.clientY);d.kind==='summon-card'?placeSummon(d.uid,cell.x,cell.y):place(d.uid,cell.x,cell.y);}else render();return;
   }drag=null;dragFeedback();if(d.from==='field'){canvasPress=null;action({dataset:{act:d.kind==='summon-card'?'summon-select':'select',uid:String(d.uid)}});return;}}
 if(aim&&aim.id===e.pointerId){aim=null;ignoredClickPointer=e.pointerId;ignoredClickUntil=performance.now()+400;if(state.preview&&state.preview.dir!==null)commitPreview();else{state.preview=null;render();}return;}
  if(canvasPress){const press=canvasPress;canvasPress=null;if(overCanvas(e.clientX,e.clientY)){const cell=cellAt(e.clientX,e.clientY);if(press.kind==='summon-card')action({dataset:{act:'summon-select',uid:String(press.uid)}});else if(press.uid){const summon=state.game.battle?.s.summons?.find(s=>s.uid===press.uid);if(summon){state.inspect={kind:'summon',uid:press.uid};state.selected=null;render();}else action({dataset:{act:'select',uid:String(press.uid)}});}else if(state.selected)place(state.selected,cell.x,cell.y);else if(state.summonSelected)placeSummon(state.summonSelected,cell.x,cell.y);}}
 if(paneMoved||performance.now()<ignoredClickUntil){paneMoved=false;touchButton=null;ignoredClickPointer=e.pointerId;ignoredClickUntil=performance.now()+400;return;}
 const scroller=scrollerAtPoint(e.clientX,e.clientY);
 if(scroller){
  const hit=hitInScroller(scroller,e.clientX,e.clientY);
  touchButton=null;
  if(hit&&!hit.disabled)action(hit);
  ignoredClickPointer=e.pointerId;ignoredClickUntil=performance.now()+400;
  return;
 }
 if(touchButton){
  const t=touchButton;touchButton=null;
  if(t.id===e.pointerId&&t.b.isConnected&&!t.b.disabled)action(t.b);
 }
});
root.addEventListener('pointercancel',()=>{if(!drag&&!aim&&!state.preview&&!canvasPress)return;clearDrag();aim=null;state.preview=null;render();});
document.addEventListener('keydown',e=>{if(e.target.matches('input,select,textarea'))return;if(e.key==='Escape'){clearDrag();aim=null;state.preview=null;state.selected=state.summonSelected=null;state.inspect=null;if(!state.game?.s.rewardPending&&state.game?.s.phase!=='decision')state.modal=null;render();}if(state.preview){const d={ArrowRight:0,ArrowDown:1,ArrowLeft:2,ArrowUp:3}[e.key];if(d!==undefined){e.preventDefault();state.preview.dir=d;draw();}if(e.key==='Enter')commitPreview();}});
window.addEventListener('beforeunload',()=>{state.expiresAt??=Date.now()+86400000;save();});document.addEventListener('visibilitychange',()=>{if(document.hidden){state.paused=true;state.expiresAt??=Date.now()+86400000;save();}});
function frame(now){const dt=Math.min(.15,(now-last)/1000);last=now;const g=state.game;if(state.view==='game'&&g?.s.phase==='battle'&&!state.paused){acc+=dt*state.speed;const previous=g.s.phase;while(acc>=1/30&&g.s.phase==='battle'){acc-=1/30;g.tick();}if(g.battle)playBattleEvents(g.battle.s,state.muted,state.volume);if(g.s.phase!==previous){acc=0;save();render();if(g.s.phase==='finished'){const dmg=Math.round(g.s.runResult?.totalDamage||0);notice('模拟结束，总伤害 '+(eggOn()?format325(dmg):dmg.toLocaleString()));showResult();}}}else if(state.view==='sandbox'&&state.sandbox?.phase==='battle'&&!state.paused){acc+=dt*state.speed;while(acc>=1/30&&!state.sandbox.battle.s.finished){acc-=1/30;state.sandbox.battle.step();}if(state.sandbox.battle)playBattleEvents(state.sandbox.battle.s,state.muted,state.volume);}else acc=0;hudTime+=dt;saveTime+=dt;if(hudTime>.2){updateHud();hudTime=0;}if(saveTime>2&&g){save();saveTime=0;}draw();requestAnimationFrame(frame);}
root.setAttribute('data-view','native');root.addEventListener('pointerdown',()=>unlockAudio(),{once:true});syncPlayChrome();render();document.getElementById('boot-screen')?.remove();clearTimeout(window.__garrisonBootTimer);window.__garrisonReady=true;requestAnimationFrame(frame);
