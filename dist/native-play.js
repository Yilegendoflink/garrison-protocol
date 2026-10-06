import {renderBountyChoice,renderDecisionChoice} from './native-choices.js';
import {nativeWavePlan} from './native-waves.js';
import {TRAINING_TYPES,loadWaveTable,normalizeWaveTable,saveWaveTable,defaultWaveTable,waveTableIsDefault} from './native-wave-fill.js';
import {createWaveRoster,trainingType,waveRng} from './native-wave-random.js';
import {DEFAULT_FINAL_BOSS_HP_MULTIPLIER,finalBossConfig,rollFinalBoss} from './native-final-boss.js';
import {applyEditorAction,applyEditorField,editorState,renderWaveEditor} from './native-wave-editor.js';
import {activeBondBan,banConfigIsDefault,bannedOperatorsHtml,bondBanBriefingHtml,bondBanIds,loadBondBan,resetBondBan,saveBondBan} from './native-bond-ban.js';
import {loadPrepSkills,prepOperatorRow,renderArchiveWindow,renderPreparePage,renderPrepSkillInfo,savePrepSkills} from './native-prep.js';
// 本地战绩档案（最近 10 场）＋特殊标记：导出/导入存档时一起带走，见 docs/SAVE_ARCHIVE.md。
import {appendRun,archiveFromRecord,alreadyRecorded,exportRecord,loadArchive,mergeArchives,normalizeArchive,runRecord,saveArchive} from './native-archive.js';
// 「输入密码」的密码表与效果（纯函数）：见 dist/native-passcode.js。
import {PASSCODE_MAX,applyPasscode} from './native-passcode.js';
import {NATIVE_DATA} from './runtime-data.js';
import {NativeSession} from './native-session.js';
import {NativeBattle} from './native-battle.js';
import {renderLobby as renderBaseLobby,NATIVE_CHANGELOG,changelogHtml} from './native-lobby.js';
import {OnlineRoomClient,defaultOnlineServerUrl,normalizeOnlineServerUrl,renderOnlinePanel} from './native-online.js';
import {buildPhasePlan,ensureStock,STOCK_BY_TIER,garrisonText,richText,battleBoardVisible,bondCurrentPreviewHtml,isolatedPlatform,tileLiftAmount,ROUND_LEAK_CAP,HAND_LIMIT,enemySprite,battleTally,RANDOM_MAP_ID,resolveMapId,directionOf,mapThumbnailHtml} from './protocol.js';
// 特殊地块/地图装置的绘制只读环境层：气流格由 blowerCells 统一算，别在绘制里另算一遍。
import {blowerCells} from './native-environment.js';
import {strategyCoverage} from './strategy.js';
import {spBarFill} from './native-sp.js';
import {playBattleEvents,resetFxClock,unlockAudio,actorOffset,drawFx,drawSeesCoreScreenFx,SEES_CORE_EFFECT_SECONDS,drawStatuses,drawElementRing,drawDownRing,drawFrostOverlay,drawConcealOverlay,drawDollOverlay,drawWhitwEyes,formTintedImage} from './native-fx.js';
import {renderSkillDescription} from './native-skill-text.js';
import {zoneVisual} from './native-operator-effects.js';
import {EGG_BASE_MODE,EGG_MODE_ID,apply325Display,egg325Active,format325,rewrite325Text} from './native-325.js';
// S.E.E.S. 策略（用户 2026-09-27 口径）：解锁标记决定策略列表里能不能看到它，本局选了它才会带进卡池。
import {visibleBands,isSeesBand,bondPanelCount,SEES_BOND_ID,TARTARUS_BOND_ID,freeDeploy} from './native-sees.js';

const CAT_MODE_ID='mode_cat_all',CAT_BASE_MODE='mode_single_normal';
let upgradeConfirm=false;
const data=NATIVE_DATA,root=document.getElementById('app'),strategyCoverageById=Object.fromEntries(strategyCoverage(data).map(x=>[x.id,x])),SAVE='garrison-native-manual-v1',CHECKPOINT_SAVE='garrison-native-safe-v1',VIEW_SAVE='garrison-native-view-v1';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plain=s=>richText(s);
// 卫戍效果：时机标签（【获得时】【战斗中】…）加粗，正文照旧去富文本标签。
const garrisonHtml=rule=>{const text=garrisonText(rule),m=text.match(/^(【[^】]+】)([\s\S]*)$/);return m?`<b class="native-garrison-when">${esc(m[1])}</b>${esc(m[2])}`:esc(text);};
const imageCache=new Map(),img=id=>{const file=data.assets[id];if(!file)return null;if(!imageCache.has(file)){const im=new Image();im.src='./'+file;imageCache.set(file,im);}return imageCache.get(file);};
function preference(key,fallback){try{return localStorage.getItem(key)??fallback;}catch{return fallback;}}
function savePreference(key,value){try{localStorage.setItem(key,value);}catch{}}
const mobilePlay=()=>matchMedia('(hover:none) and (pointer:coarse)').matches;
const iosMobile=()=>/iPhone|iPad|iPod/i.test(navigator.platform)||/iPhone|iPad|iPod/i.test(navigator.userAgent)||(/Macintosh/i.test(navigator.userAgent)&&navigator.maxTouchPoints>1);
function syncPlayChrome(){
 const fullscreenButton=document.querySelector('[data-act="fullscreen"]');
 if(fullscreenButton)fullscreenButton.hidden=!mobilePlay()||iosMobile()||!!(document.fullscreenElement||document.webkitFullscreenElement)||!(document.documentElement.requestFullscreen||document.documentElement.webkitRequestFullscreen);
 const locked=document.documentElement.classList.contains('native-play-lock');
 const compact=matchMedia('(orientation:landscape) and (max-height:600px) and (max-width:1100px)').matches;
 const need=locked&&matchMedia('(orientation:portrait)').matches;
 document.documentElement.classList.toggle('native-landscape-ui',locked||compact);
 document.documentElement.classList.toggle('native-need-rotate',need);
 const app=document.getElementById('app');
 if(!app)return;
 if(need){app.style.setProperty('width',innerHeight+'px','important');app.style.setProperty('height',innerWidth+'px','important');}
 else{app.style.removeProperty('width');app.style.removeProperty('height');}
 const dossier=document.querySelector('.native-dossier'),top=document.querySelector('.native-top');if(dossier&&top)dossier.style.top=`${top.offsetTop+top.offsetHeight+8}px`;
 syncHandScrollControls();
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
document.addEventListener('fullscreenchange',syncPlayChrome);
document.addEventListener('webkitfullscreenchange',syncPlayChrome);
// `state.map` 默认是哨兵「随机地图」：开局按本局种子抽一个具体阵地（用户 2026-09-22 口径）。
const state={supplyCollapsed:false,expiresAt:null,game:null,draft:null,sandbox:null,view:'lobby',mode:'mode_single_normal',band:'band_amiya',strategyDraft:null,map:RANDOM_MAP_ID,selected:null,summonSelected:null,item:null,inspect:null,quickSell:null,preview:null,paused:false,speed:1,muted:preference('garrison-mute','0')==='1',reduceFx:preference('garrison-reduce-fx','0')==='1',volume:Math.max(0,Math.min(1,Number(preference('garrison-volume','1'))||0)),modal:null,roundEnd:null,resultUnitUid:null,editor:editorState(),waveTable:loadWaveTable(),bondBanBlocks:0};
state.online={connection:'idle',room:null,player:null,peers:{},error:null,notice:null,serverUrl:preference('garrison-online-url',defaultOnlineServerUrl()),playerName:preference('garrison-online-player-name','玩家'),modeId:'mode_multi_normal'};
state.onlineRun=null;
let onlineClient=null;
const onlinePeerStatuses=new Map();
function renderLobby(args){const html=renderBaseLobby(args),panel=renderOnlinePanel({online:state.online,data:args.data,esc:args.esc,onlineRun:state.onlineRun,hasGame:!!state.game});return html.replace('<section class="native-home-card native-database">',`${panel}<section class="native-home-card native-database">`);}
function positionLobbyUpdateCard(){const hero=root.querySelector('.native-hero'),panel=root.querySelector('.native-hero-panel'),loadout=root.querySelector('.native-loadout');if(!hero||!panel||!loadout)return;if(matchMedia('(max-width:820px) and (orientation:portrait)').matches)loadout.after(panel);else hero.append(panel);}
const onlinePendingTransfers=[];
function onlineSessionToken(){try{return localStorage.getItem('garrison-online-session');}catch{return null;}}
function createOnlineClient(serverUrl=state.online.serverUrl){
 let normalized;try{normalized=normalizeOnlineServerUrl(serverUrl);}catch(error){notice(error.message);return null;}
 if(onlineClient&&onlineClient.url===normalized)return onlineClient;
 if(onlineClient?.state.room){notice('请先离开当前联机房间，再更换信令服务。');return null;}
 const previousUrl=onlineClient?.url||state.online.serverUrl,sessionToken=previousUrl===normalized?onlineSessionToken():null;
 if(previousUrl!==normalized)try{localStorage.removeItem('garrison-online-session');}catch{}
 onlineClient?.dispose();
 state.online.serverUrl=normalized;savePreference('garrison-online-url',normalized);
 onlineClient=new OnlineRoomClient({url:normalized,sessionToken,onChange:snapshot=>{state.online={...state.online,...snapshot,serverUrl:normalized};if(state.view==='lobby')render();},onPeerMessage:(fromPlayerId,message)=>handleOnlinePeerMessage(fromPlayerId,message),onCoopEvent:handleCoopEvent});
 state.online={...state.online,...onlineClient.snapshot(),serverUrl:normalized};return onlineClient;
}
function refreshOnlineTeamPeers(){
 const game=state.game,room=state.online.room,playerId=onlineClient?.state.player?.id||state.online.player?.id;
 if(!game||!room||!playerId)return;
 game.s.teamPeers=(room.players||[]).filter(player=>player.id!==playerId).map(player=>({playerId:player.id,name:player.name,bondCounts:onlinePeerStatuses.get(player.id)?.bondCounts||{}}));
}
function handleOnlinePeerMessage(fromPlayerId,message){
 if(message?.type==='peer.status'){
  const bondCounts=message.bondCounts&&typeof message.bondCounts==='object'?message.bondCounts:{};
  onlinePeerStatuses.set(fromPlayerId,{bondCounts,round:Number(message.round)||0,phase:String(message.phase||'')});refreshOnlineTeamPeers();return;
 }
 if(message?.type==='team.fang'&&message.record){
  if(!state.game){onlinePendingTransfers.push(message.record);return;}
  if(state.game.receiveFangTransfer(message.record)){save();notice('已收到队友转让的干员，将在下轮备战时入队。');render();}
 }
}
let lastOnlineStatusAt=0;
function publishOnlineStatus(force=false){
 const game=state.game;if(!onlineClient||!state.onlineRun||!game)return;
 if(!force&&Date.now()-lastOnlineStatusAt<1200)return;lastOnlineStatusAt=Date.now();
 const bondCounts=Object.fromEntries(Object.entries(game.bonds()).map(([id,bond])=>[id,Number(bond.count)||0]));
 onlineClient.sendPeerMessage({type:'peer.status',round:game.s.round,phase:game.s.phase,bondCounts});
}
function coopWaitModal(title,description){
 const progress=onlineClient?.state.coop?.progress||state.online.coop?.progress,room=onlineClient?.state.room||state.online.room;
 const expected=progress?.expectedPlayers||[],completed=new Set(progress?.completedPlayers||[]),names=expected.filter(id=>!completed.has(id)).map(id=>room?.players?.find(player=>player.id===id)?.name||'队友');
 const waiting=names.length?`<p>等待：${names.map(esc).join('、')}</p>`:'<p>正在同步队伍状态…</p>';
 modal(`<h2>${esc(title)}</h2><p>${esc(description)}</p>${waiting}`);
}
function submitCoopBattleResult(g){
 const run=state.onlineRun;if(!run||run.reportedBattleRound===g.s.round)return;
 run.reportedBattleRound=g.s.round;run.waitingForServer='battle';
 const result=g.battle?.s?.result||g.s.history.at(-1)||{},failedEnemies=(result.failedEnemies||[]).slice(0,256).map(enemy=>({id:enemy.id,route:enemy.route??0}));
 onlineClient?.reportBattle({round:g.s.round,leaks:Math.max(0,Number(result.leaks??g.s.lastBattle?.leaks)||0),failedEnemies,eliminated:g.s.hp<=0});
 coopWaitModal('等待队友完成本轮作战',`第 ${g.s.round} 回合战果已提交，服务端会统一判断是否进入联防。`);
}
function submitCoopDefenseResult(g){
 const run=state.onlineRun;if(!run||run.reportedDefenseRound===g.s.round)return;
 run.reportedDefenseRound=g.s.round;run.waitingForServer='defense';
 const result=g.s.coopDefenseResult||{leaks:0};
 onlineClient?.reportJointDefense({round:g.s.round,leaks:Math.max(0,Number(result.leaks)||0),eliminated:g.s.hp<=0});
 coopWaitModal('等待联防结算',`第 ${g.s.round} 回合联防结果已提交，等待其他防守玩家。`);
}
function handleCoopEvent(message){
 const run=state.onlineRun,g=state.game;if(!run||!g)return;
 if(message.type==='coop.progress'){
  if(run.waitingForServer==='battle')coopWaitModal('等待队友完成本轮作战',`第 ${g.s.round} 回合战果已提交，等待队伍汇总。`);
  else if(run.waitingForServer==='defense')coopWaitModal('等待联防结算',`第 ${g.s.round} 回合联防结果已提交，等待其他防守玩家。`);
  else if(run.waitingForServer==='boss')coopWaitModal('联机对局结束中','已到 Boss 阶段，本局按联机 MVP 规则直接结束。');
  else if(run.waitingForServer==='ready')coopWaitModal('等待队友继续',`已确认继续第 ${g.s.round+1} 回合，等待其他存活玩家。`);
  return;
 }
 if(message.type==='coop.joint-defense.started'){
  run.waitingForServer=null;run.coopStage='joint-defense';run.defenders=message.defenders||[];
  state.modal=null;renderModal();
  if(run.defenders.includes(run.playerId)){
   const enemies=message.enemiesByPlayer?.[run.playerId]||[];
   try{
    if(!g.startJointDefense(enemies))throw new Error('当前会话不能开始联防。');
    g.s.coopStage='joint-defense';state.paused=false;resetFxClock();attachZoneVisual(g.battle);save();render();
   }catch(error){notice(`联防未能启动：${error.message||error}`);run.reportedDefenseRound=g.s.round;run.waitingForServer='defense';onlineClient?.reportJointDefense({round:g.s.round,leaks:1,eliminated:false});coopWaitModal('联防启动失败','已向服务端报告联防失败，等待本轮结算。');}
  }else{
   coopWaitModal('队友正在联防',`第 ${g.s.round} 回合由 ${run.defenders.map(id=>state.online.room?.players?.find(player=>player.id===id)?.name||'队友').map(esc).join('、')} 处理漏怪。`);
  }
  return;
 }
 if(message.type==='coop.round.advance'){
  run.waitingForServer=null;run.coopStage='advance';run.eliminatedPlayers=message.eliminatedPlayers||[];
  const active=(onlineClient?.state.room?.players||state.online.room?.players||[]).some(player=>player.id===run.playerId)&&!run.eliminatedPlayers.includes(run.playerId);
  const summary=message.outcome==='all-perfect'?'全队完美通关。':message.outcome==='no-perfect-defender'?'本轮没有完美通关者，跳过联防。':message.success?'联防成功，漏怪已清除。':`联防漏怪 ${Number(message.defenseLeaks)||0}。`;
  modal(`<h2>第 ${g.s.round} 回合结算</h2><p>${esc(summary)}</p>${active?'<button class="native-primary" data-act="coop-next">全员结算后继续 →</button>':'<p>本局生命已用尽，等待队伍完成后续结算。</p>'}`);
  return;
 }
 if(message.type==='coop.round.begin'){
  run.waitingForServer=null;run.coopStage='battle';run.reportedBattleRound=null;run.reportedDefenseRound=null;
  if((message.activePlayers||[]).includes(run.playerId)&&g.s.phase==='intermission'){
   if(!g.perform('next')){notice(g.lastError||'未能进入下一回合。');return;}
   state.modal=null;renderModal();state.paused=false;save();saveCheckpoint();render();flushOnlineTransfers();publishOnlineStatus(true);
  }
  return;
 }
 if(message.type==='coop.game.finished'){
  run.waitingForServer=null;run.coopStage='finished';state.modal=null;renderModal();
  if(g.s.runResult?.kind==='online-boss-skipped')showResult();
  else if(g.s.runResult||g.s.history.length)showResult();
  else modal('<h2>本局结束</h2><p>全队已完成联机对局。</p><button class="native-primary" data-act="home">回到大厅</button>');
 }
}
function flushOnlineTransfers(){
 if(!state.game)return;let received=0;
 for(const record of onlinePendingTransfers.splice(0))if(state.game.receiveFangTransfer(record))received++;
 if(received){notice(`收到 ${received} 名队友转让的干员，将在下轮备战时入队。`);save();}
}
function deriveOnlinePlayerSeed(seed,playerId){let hash=(Number(seed)||1)>>>0;for(const char of String(playerId||''))hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;return hash||1;}
function onlineConnectionsReady(room,player){return !!room&&room.phase==='signaling'&&!!player&&(room.players||[]).every(member=>member.id===player.id||onlineClient?.state.peers?.[member.id]?.connection==='connected');}
function beginOnlineBriefing(){
 const room=onlineClient?.state.room||state.online.room,player=onlineClient?.state.player||state.online.player;
 if(!room||room.phase!=='signaling'||!player){notice('当前没有可开始的联机房间。');return;}
 if(!onlineConnectionsReady(room,player)){notice('仍有队友尚未建立点对点连接。');return;}
 const baseSeed=(Number(room.sessionSeed)||1)>>>0,modeId=room.modeId,seed=deriveOnlinePlayerSeed(baseSeed,player.id);
 const mapId=resolveMapId(data,room.mapId||RANDOM_MAP_ID,waveRng(baseSeed),modeId),banConfig=loadBondBan(data);
 const sharedBonds=bondBanIds(data,baseSeed,banConfig);
 state.draft={modeId,mapId,seed,sharedSeed:baseSeed,playerId:player.id,teamPeers:(room.players||[]).filter(member=>member.id!==player.id).map(member=>({playerId:member.id,name:member.name,bondCounts:onlinePeerStatuses.get(member.id)?.bondCounts||{}})),online:true,roomCode:room.code,sessionId:room.sessionId,finalBossId:rollFinalBoss(data,modeId,baseSeed),roster:createWaveRoster({random:waveRng((baseSeed^0x57a4c319)>>>0||1),data,modeId}),bondBan:{bonds:sharedBonds,always:banConfig.always,never:banConfig.never},egg325:false,cat:false};
 state.onlineRun=null;state.bondBanBlocks=0;state.view='briefing';rememberView('lobby');state.strategyDraft=null;state.modal=null;render();
}
function beginOnlineSession(){
 const draft=state.draft;if(!draft?.online)return;
 const room=onlineClient?.state.room,player=onlineClient?.state.player;if(!onlineConnectionsReady(room,player)){notice('点对点连接已中断，请返回联机大厅重新连接。');state.view='lobby';render();return;}
 state.lastChoiceContent=null;enterPlayChrome();state.supplyCollapsed=false;
 try{
  const transport={send:record=>onlineClient?.sendPeerMessage({type:'team.fang',record},record.recipientId)??false};
  state.game=new NativeSession(data,{modeId:draft.modeId,bandId:guardedBandId(),mapId:draft.mapId,seed:draft.seed,waveRoster:draft.roster,bondBan:draft.bondBan,egg325:false,cat:false,playerId:draft.playerId,teamPeers:draft.teamPeers,teamTransport:transport,finalBossId:draft.finalBossId,finalBossHpMultiplier:state.waveTable?.finalBossHpMultiplier??DEFAULT_FINAL_BOSS_HP_MULTIPLIER});
  state.game.s.onlineCoop=true;state.game.s.coopStage='battle';
  state.onlineRun={roomCode:draft.roomCode,sessionId:draft.sessionId,sessionSeed:draft.sharedSeed,playerId:draft.playerId,coopStage:'battle',reportedBattleRound:null,reportedDefenseRound:null,waitingForServer:null};state.view='game';rememberView('game');state.draft=null;state.paused=false;state.expiresAt=null;state.resultUnitUid=null;state.selected=state.summonSelected=state.item=state.inspect=state.preview=state.modal=null;
  refreshOnlineTeamPeers();save();saveCheckpoint();render();flushOnlineTransfers();publishOnlineStatus(true);
 }catch(error){notice(error.message);}
}
async function handleOnlineAction(button){
 const act=button.dataset.act;
 if(act==='online-create'||act==='online-join'){
  const serverUrl=document.getElementById('online-server-url')?.value||state.online.serverUrl;
  const playerName=document.getElementById('online-player-name')?.value||state.online.playerName;
  const modeId=document.getElementById('online-mode')?.value||state.online.modeId;
  state.online.playerName=playerName;state.online.modeId=modeId;savePreference('garrison-online-player-name',playerName);
  const client=createOnlineClient(serverUrl);if(!client)return;
  if(act==='online-create')client.createRoom({playerName,modeId,allowUnderfilledStart:document.getElementById('online-allow-underfilled')?.checked!==false});
  else client.joinRoom(document.getElementById('online-room-code')?.value,playerName);
  return;
 }
 if(act==='online-settings'){
  const client=createOnlineClient();client?.setSettings({modeId:document.getElementById('online-room-mode')?.value,allowUnderfilledStart:!!document.getElementById('online-room-underfilled')?.checked});return;
 }
 if(act==='online-ready'){onlineClient?.setReady(!state.online.player?.ready);return;}
 if(act==='online-start'){onlineClient?.start(state.map||RANDOM_MAP_ID);return;}
 if(act==='online-leave'){onlineClient?.leave();state.onlineRun=null;onlinePeerStatuses.clear();return;}
 if(act==='online-enter'){
  if(state.game&&state.onlineRun){state.view='game';state.paused=false;enterPlayChrome();render();return;}
  beginOnlineBriefing();return;
 }
 if(act==='online-copy'){
  try{await navigator.clipboard.writeText(state.online.room?.code||'');notice('配对码已复制');}
  catch{notice(`配对码：${state.online.room?.code||''}`);}
 }
}
root.addEventListener('click',event=>{
 const button=event.target.closest?.('[data-act]');if(!button)return;
 if(button.dataset.act==='begin'&&state.draft?.online){event.preventDefault();event.stopImmediatePropagation();beginOnlineSession();return;}
 if(button.dataset.act==='coop-next'&&state.onlineRun){event.preventDefault();event.stopImmediatePropagation();const run=state.onlineRun,round=state.game?.s.round;if(run.readyRound===round)return;run.readyRound=round;run.waitingForServer='ready';onlineClient?.readyNextRound(round);coopWaitModal('等待队友继续',`已确认继续第 ${round+1} 回合，等待其他存活玩家。`);return;}
 if(button.dataset.act==='next'&&state.onlineRun){event.preventDefault();event.stopImmediatePropagation();notice('联机回合需要在队伍结算提示中统一继续。');return;}
 if(!button.dataset.act.startsWith('online-'))return;
 event.preventDefault();event.stopImmediatePropagation();void handleOnlineAction(button);
},true);
root.addEventListener('click',()=>{if(state.view==='game')setTimeout(()=>publishOnlineStatus(),0);});
root.addEventListener('pointerup',()=>{if(state.view==='game')setTimeout(()=>publishOnlineStatus(),0);});
if(onlineSessionToken()){const client=createOnlineClient();client?.connect();}
window.addEventListener('resize',()=>{if(state.view==='lobby')positionLobbyUpdateCard();});
let canvas,seesScreenFxCanvas=null,seesScreenFxWasActive=false,drag=null,canvasPress=null,aim=null,touchButton=null,last=performance.now(),acc=0,hudTime=0,saveTime=0,ignoredClickPointer=null,ignoredClickUntil=0,dossierDismissedAt=0,runtimeFault=null;
function readSave(key){try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):null;}catch{return null;}}
function savedView(){try{return sessionStorage.getItem(VIEW_SAVE)||'lobby';}catch{return 'lobby';}}
function rememberView(view){try{sessionStorage.setItem(VIEW_SAVE,view);}catch{}}
function restoreSavedGame(){for(const key of [CHECKPOINT_SAVE,SAVE]){const record=readSave(key),game=record&&NativeSession.restore(data,record);if(game)return {game,record};}return null;}
try{const restored=restoreSavedGame();if(restored){state.game=restored.game;state.paused=true;state.expiresAt=restored.record.expiresAt??null;if(restored.game.s.legacyBossBattleRestarted){delete restored.game.s.legacyBossBattleRestarted;notice('旧版最终 Boss 战场已切回原图；本回合已退回战前部署，请重新部署并开战。');}if(savedView()==='game'){state.view='game';enterPlayChrome();}}}catch{}
const profile=u=>{const base=data.profiles[u.chessId],selected=base?.skillChoices?.[u.source?.skillIndex??u.skillIndex];return selected?{...base,...selected}:base;};
// 战绩档案区的样式（dist/native-archive.css）随功能单独一个文件，启动时挂一次 <link>。
(function ensureArchiveStyles(){try{if(document.getElementById('native-archive-css'))return;const link=document.createElement('link');link.id='native-archive-css';link.rel='stylesheet';link.href='./native-archive.css';document.head.append(link);}catch{}})();
const avatar=id=>data.assets[id]?`<img src="./${data.assets[id]}" alt="" loading="lazy" draggable="false">`:'';
function save(){if(!state.game||state.sandbox)return;try{if(state.game.s.phase==='prep')state.game.syncSummonCards?.();state.game.syncHandSlots?.();localStorage.setItem(SAVE,JSON.stringify({...state.game.snapshot(),expiresAt:state.expiresAt}));if(['intermission','finished'].includes(state.game.s.phase))saveCheckpoint();}catch{notice('进度未能写入浏览器存储，可使用导出存档。');}}
function saveCheckpoint(){if(!state.game||state.sandbox)return;try{const record=state.game.snapshot();record.battle=null;localStorage.setItem(CHECKPOINT_SAVE,JSON.stringify({...record,expiresAt:state.expiresAt}));}catch{notice('安全回合点未能写入浏览器存储。');}}
// ── 本地战绩档案（最近 10 场 / 战前准备技能 / 特殊标记） ──────────────────────────
// 档案存自己的 localStorage 键，不随某一局的对局存档走；对局结束时把当前战绩与战前准备的技能配置一起写回。
const archiveStorage=()=>{try{return typeof localStorage!=='undefined'?localStorage:null;}catch{return null;}};
function archiveNow(){return loadArchive(archiveStorage());}
function archiveWithPrepSkills(archive){return normalizeArchive({...archive,prepSkills:loadPrepSkills(data)||{}});}
// 隐藏模式（用户 2026-09-27 口径）：「325 模式」「海猫模式」默认不在大厅「行动难度」里出现，
// 只有用密码解锁（archive.flags.egg325／cat）后才把选项放回来。做法是在大厅渲染后摘掉对应的 <option>，
// 不动 native-lobby 的模板（那里另有并行改动）。
function gateLockedModes(){
 try{
  const select=document.getElementById('native-mode');if(!select)return false;
  const flags=archiveNow().flags,locked=[[EGG_MODE_ID,'egg325'],[CAT_MODE_ID,'cat']];let removed=false;
  for(const [modeId,flag] of locked){
   if(flags[flag])continue;
   const option=[...select.options].find(o=>o.value===modeId);
   if(option){option.remove();removed=true;if(select.value===modeId)select.value=select.options[0]?.value||select.value;}
  }
  return removed;
 }catch{return false;}
}
function recordRunIfOver(g){
 if(!g||state.sandbox)return null;
 const s=g.s;if(!(s.phase==='finished'||s.hp<=0))return null;
 const current=archiveWithPrepSkills(archiveNow()),run=runRecord(g,data);
 if(!run||alreadyRecorded(current,run.id))return null;
 const next=saveArchive(archiveStorage(),appendRun(current,run));
 state.archive=next;
 return run;
}
function notice(s){const t=document.getElementById('toast');t.textContent=eggOn()?rewrite325Text(s):s;t.classList.add('visible');clearTimeout(notice.timer);notice.timer=setTimeout(()=>t.classList.remove('visible'),4000);}
function currentTurn(){return buildPhasePlan(data,state.game.s.modeId).find(t=>t.round===state.game.s.round);}
function modal(html,meta=null){state.modal=html;state.modalMeta=meta;renderModal();}
function showUpdateLog(){const log=NATIVE_CHANGELOG;modal(`<h2>更新日志</h2><div class="native-changelog-meta"><b>${esc(log.version)}</b><time datetime="${esc(log.publishedAt)}">${esc(log.displayTime)}</time></div><p class="native-changelog-intro">本期功能更新与修复记录。</p>${log.sections.map(section=>`<section class="native-changelog-section"><h3>${changelogHtml(section.title)}</h3><ul>${section.items.map(item=>`<li>${changelogHtml(item)}</li>`).join('')}</ul></section>`).join('')}`);}
let painting=false;
function eggOn(){return egg325Active(state);}
// 海猫模式：整备资金视为无限，界面上以彩色 ALL 代替金额。
function catOn(){return !!(state.draft?.cat||state.game?.s?.cat);}
function fundsMarkup(funds){return catOn()?'<b class="funds native-funds-all">ALL</b>':`<b class="funds">${funds}<i> ◆</i></b>`;}
function canvasNumber(n){return eggOn()?format325(n):String(n);}
// 区域/领域特效的视觉分类由 operator-effects 提供，挂到战斗对象上供特效层读取
function attachZoneVisual(battle){if(battle)battle.zoneVisual=zoneVisual;return battle;}
function paint325(target=root){
 const on=eggOn();
 document.documentElement.classList.toggle('egg-325',on);
 if(on&&target)apply325Display(target);
}
// 大厅顶部那条「配置已改动」提示的判定：敌人池或盟约禁用配置只要有一个和默认不一致就出现
// （用户 2026-09-22 口径）。两边的判定都放在各自模块里（`waveTableIsDefault`／`banConfigIsDefault`），
// 这里只做「或」。
function poolDirty(){return !waveTableIsDefault(state.waveTable||loadWaveTable())||!banConfigIsDefault(data);}
function renderModal(){
 const old=document.getElementById('native-modal');if(old&&old._content===state.modal)return;old?.remove();if(!state.modal)return;
 const choice=state.modal.includes('native-choice-content'),archiveWindow=state.modal.includes('native-archive-window'),el=document.createElement('div');el.id='native-modal';el._content=state.modal;
 el.className=choice?'native-modal native-round-end native-choice-overlay':archiveWindow?'native-modal native-archive-modal':'native-modal';
 if(choice){if(state.reduceFx)el.dataset.reduce='';if(state.lastChoiceContent===state.modal)el.dataset.steady='';state.lastChoiceContent=state.modal;}
 el.innerHTML=choice?`<div class="native-round-end-dim"></div><section class="native-round-end-banner" role="dialog" aria-modal="true" aria-label="选择本轮方案">${state.modal}</section>`:`<section role="dialog" aria-modal="true"${archiveWindow?' aria-label="战绩与解锁"':''}><button data-act="close" class="native-close" aria-label="关闭">×</button>${state.modal}</section>`;
 root.append(el);if(choice){el.querySelector('h2')?.focus({preventScroll:true});el.addEventListener('keydown',e=>{if(e.key!=='Tab')return;const buttons=[...el.querySelectorAll('button:not(:disabled)')],first=buttons[0],last=buttons.at(-1);if(e.shiftKey&&(document.activeElement===first||document.activeElement===el.querySelector('h2'))){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}});}if(!painting)paint325(el);
}

// 大厅「资料与工具 → 输入密码」：弹数字键盘，支持数字／删除／清空／确定。
// 密码表与效果在 native-passcode.js：命中就置位本地存档的特殊标记并弹窗，没命中只提示「什么都没有发生」（用户 2026-09-27 口径）。
function renderPasscodePad(){
 const digits=state.passcode?.digits||'';
 modal(`<h2>输入密码</h2><p class="native-passcode-hint">用下方数字键盘输入，确认后交给后续功能处理。</p><div class="native-passcode-display">${digits?esc(digits.split('').join(' ')):'<span>未输入</span>'}</div><div class="native-keypad">${['1','2','3','4','5','6','7','8','9'].map(d=>`<button data-act="passcode-key" data-key="${d}">${d}</button>`).join('')}<button data-act="passcode-key" data-key="back" aria-label="删除一位">⌫</button><button data-act="passcode-key" data-key="0">0</button><button data-act="passcode-key" data-key="clear">清空</button></div><div class="native-keypad-actions"><button data-act="passcode-key" data-key="ok" class="native-primary">确定</button></div>`);
}
function passcodeKey(key){
 const p=state.passcode??={digits:''};
 if(key==='clear')p.digits='';
 else if(key==='back')p.digits=p.digits.slice(0,-1);
 else if(key==='ok'){if(!p.digits){notice('请先输入密码');return;}const code=p.digits;p.digits='';state.modal=null;renderModal();passcodeSubmit(code);return;}
 else if(/^\d$/.test(key)&&p.digits.length<PASSCODE_MAX)p.digits+=key;
 renderPasscodePad();
}
// 密码确认后的唯一接线点（用户 2026-09-27 口径）：
// `20100305` → 弹窗「策略：S.E.E.S.已解锁」＋把本地存档的 flags.sees 写成 true；其它数字只提示「什么都没有发生」。
function passcodeSubmit(code){
 const result=applyPasscode(archiveNow(),code);
 if(!result.hit){notice('什么都没有发生');return;}
 state.archive=saveArchive(archiveStorage(),result.archive);
 modal(`<h2>${esc(result.hit.title)}</h2><p>特殊标记【${esc(result.hit.name)}】已写入本地存档（当前：<b>开</b>）。可在「战前准备」页查看，导出存档时会一起带走。</p><div class="native-keypad-actions"><button class="native-primary" data-act="close">知道了</button></div>`);
}
function showBranches(id=null){
 const all=data.branchRules.records,records=id?all.filter(r=>r.id===id):all;
 modal(`<h2>职业分支规则</h2><p>已记录 ${all.length} 个历史分支，${all.filter(r=>r.inCurrentMode).length} 个出现在本期固定预设中。这里区分分支基础逻辑与干员专属技能、天赋、模组；复杂机制仍有待补齐项。</p><div class="native-branch-catalog">${records.map(r=>`<details ${id?'open':''}><summary><b>${esc(r.name)}</b><span>${r.inCurrentMode?'本期包含':'非本期固定预设'} · ${r.runtime.status==='partial'?'部分接入':'基础行为已接入'}</span></summary><p>${esc(r.baseTrait)}</p><p>${r.pending.length?'待补齐：'+r.pending.map(esc).join('、'):'专属技能／天赋／模组例外另行处理。'}</p><a href="${r.sources[1].url}" target="_blank" rel="noreferrer">PRTS 特性细则 · 修订 ${r.sources[1].revision} ↗</a></details>`).join('')}</div>`);
}
function showLimitations(){modal(`<h2>手动验收版 · 已知差异</h2><p>主入口已使用下半期数据和新对局控制器。该版本不代表完全还原，未运行本轮自动或浏览器测试。</p><ul>${data.limitations.map(s=>`<li>${esc(s)}</li>`).join('')}</ul><p>请导出当前存档，连同复现步骤提交问题。</p><a href="https://github.com/Yilegendoflink/garrison-protocol/issues" target="_blank" rel="noreferrer">反馈问题 ↗</a>`);}
const sandboxOperators=Object.values(data.profiles).filter(p=>p?.charId).map(p=>({id:p.chessId,charId:p.charId,name:p.name,rank:p.rank,isGolden:p.isGolden,position:p.position}));
const sandboxEnemies=Object.entries(data.enemies).map(([id,e])=>({id,name:e.name,applyWay:e.applyWay,motion:e.motion}));
function newSandbox(){const economy=new NativeSession(data,{modeId:'mode_single_normal',bandId:'band_bldsk',mapId:resolveMapId(data,state.map),seed:1,bondBan:{bonds:[]},cat:!!state.draft?.cat});economy.s.units=[];economy.s.items=[];economy.s.offers=[];economy.s.itemOffers=[];economy.setFunds(9999);economy.s.phase='prep';economy.s.rewardPending=null;return {economy,battle:null,phase:'setup',opQuery:'',enemyQuery:'',selectedUid:null,enemyDrafts:[],nextUid:1,enemySeq:0};}
function openSandbox(){if(!state.sandbox){state.sandbox=newSandbox();state.sandbox.previousGame=state.game;state.sandbox.previousView='lobby';}state.game=state.sandbox.economy;state.view='game';state.paused=true;state.modal=null;render();}
function sandboxAddOperator(id){const sb=state.sandbox,p=data.profiles[id],shop=data.season.charShopChessDatas[id]||data.season.charShopChessDatas[data.season.chessNormalIdLookupDict[id]];if(!sb||sb.phase!=='setup'||!p||!shop)return;const u={uid:++sb.nextUid,chessId:id,charId:p.charId,rank:p.rank||shop.chessLevel,position:null,dir:0,equipment:[],bondIds:data.season.charChessDataDict[id]?.bondIds||[]};sb.economy.s.units.push(u);sb.selectedUid=u.uid;state.selected=u.uid;state.item=null;render();}
function sandboxSpawnEnemy(id,dummy=false){const sb=state.sandbox;if(!sb)return;if(sb.phase==='setup'){sb.enemyDrafts.push({id,dummy,uid:++sb.enemySeq});render();return;}if(!sb.battle)return;const raw=data.enemies[id];if(!raw)return;const flying=raw.motion==='FLY',route=Math.max(0,sb.battle.level.routes.findIndex(r=>r.motionMode===(flying?'FLY':'WALK')));try{sb.battle.spawn({id,route});const e=sb.battle.s.enemies.at(-1),i=sb.enemySeq++;const spots=[[8,1],[8,2],[8,3],[7,1],[7,2],[7,3],[6,1],[6,2]];const spot=spots[i%spots.length];e.x=spot[0];e.y=spot[1];e.progress=0;e.cmd=0;if(dummy){e.trainingDummy=true;e.canAttack=false;e.ranged=false;e.speed=0;e.interval=999;e.route=[];e.leak=0;e.block=null;e.name='测试木桩';e.def=0;e.res=0;e.baseDef=0;e.baseRes=0;e.damageResistance=0;}sb.enemyDrafts.push({id,dummy,uid:e.uid});sb.battle.s.total=sb.battle.s.enemies.length;render();}catch(error){notice(error.message||'无法生成敌人');}}
function sandboxStart(){const sb=state.sandbox;if(!sb||sb.phase!=='setup')return;if(!sb.economy.s.units.some(u=>u.position)){notice('请先添加并放置至少一名干员');return;}if(!sb.economy.beginBattle()){notice('无法开始测试场景');return;}const turn=buildPhasePlan(data,'mode_single_normal')[0],b=attachZoneVisual(new NativeBattle(data,sb.economy,sb.economy.map,turn));b.s.queue=[];b.s.enemies=[];b.s.total=0;b.s.limit=1e9;for(const u of b.s.units){u.deployAt=0;b.deploy(u);}sb.battle=b;sb.economy.battle=b;sb.phase='battle';state.game=sb.economy;const drafts=sb.enemyDrafts.slice();sb.enemyDrafts=[];for(const draft of drafts)sandboxSpawnEnemy(draft.id,draft.dummy);state.paused=true;render();}
function sandboxRemoveEnemy(uid){const sb=state.sandbox;if(!sb)return;sb.enemyDrafts=sb.enemyDrafts.filter(e=>e.uid!==uid);if(sb.battle)sb.battle.s.enemies=sb.battle.s.enemies.filter(e=>e.uid!==uid);render();}
function sandboxReset(){const previous=state.sandbox?.previousGame||null;state.sandbox=newSandbox();state.sandbox.previousGame=previous;state.sandbox.previousView='lobby';state.game=state.sandbox.economy;state.view='game';state.paused=true;render();}
function sandboxDetail(){const sb=state.sandbox,b=sb?.battle,ops=sandboxOperators,ens=sandboxEnemies;return `<section class="sandbox-inline"><div class="sandbox-inline-head"><b>技能测试内容</b><small>${sb?.phase==='setup'?'按正式场景方式选择干员、拖拽/点击地块并确认朝向':'沿用正式战斗控制器，可暂停、单步和手动释放技能'}</small></div><details open><summary>添加干员</summary><input id="sandbox-op-search" type="search" value="${esc(sb?.opQuery||'')}" placeholder="搜索名称或 ID" aria-label="搜索测试干员"><div class="sandbox-inline-results">${ops.map(o=>`<button data-act="sandbox-add-op" data-id="${o.id}" data-sandbox-op="${esc((o.name+' '+o.id).toLowerCase())}" ${sb?.opQuery&&!((o.name+' '+o.id).toLowerCase().includes(sb.opQuery.toLowerCase()))?'hidden':''}>${avatar(o.charId)}<span><b>${esc(o.name)}</b><small>${o.rank} 阶${o.isGolden?' · 精锐':''}</small></span></button>`).join('')}</div></details><details open><summary>添加敌人</summary><input id="sandbox-enemy-search" type="search" value="${esc(sb?.enemyQuery||'')}" placeholder="搜索敌人名称或 ID" aria-label="搜索测试敌人"><button class="sandbox-dummy" data-act="sandbox-add-dummy">＋ 不行动木桩</button><div class="sandbox-inline-results">${ens.map(e=>`<button data-act="sandbox-add-enemy" data-id="${e.id}" data-sandbox-enemy="${esc((e.name+' '+e.id).toLowerCase())}" ${sb?.enemyQuery&&!((e.name+' '+e.id).toLowerCase().includes(sb.enemyQuery.toLowerCase()))?'hidden':''}><span class="sandbox-enemy-glyph">◆</span><span><b>${esc(e.name)}</b><small>${e.applyWay==='RANGED'?'远程':'近战'} · ${e.motion==='FLY'?'飞行':'地面'}</small></span></button>`).join('')}</div></details><div class="sandbox-inline-picked"><b>已选敌人</b>${(sb?.enemyDrafts||[]).map(d=>`<div><span>${d.dummy?'∞':'◆'} ${esc(d.dummy?'不行动木桩':data.enemies[d.id]?.name||d.id)}</span><button data-act="sandbox-remove-enemy" data-uid="${d.uid}">移除</button></div>`).join('')||'<small>暂无敌人</small>'}</div><div class="sandbox-inline-actions"><button data-act="sandbox-start" ${sb?.phase!=='setup'?'disabled':''}>开始测试</button><button data-act="sandbox-step" ${sb?.phase!=='battle'?'disabled':''}>单步</button><button data-act="sandbox-clear-enemies">清空敌人</button><button data-act="sandbox-reset">重置</button><button data-act="sandbox-exit">退出</button></div>${sb?.battle?`<div class="sandbox-inline-live"><b>测试干员</b>${sb.economy.s.units.map(u=>{const live=b.s.units.find(v=>v.uid===u.uid),p=data.profiles[u.chessId];return live?`<div><span>${esc(p.name)} · ${Math.round(live.hp)}/${Math.round(live.maxHp)}</span><button data-act="sandbox-fill-sp" data-uid="${u.uid}">充能</button><button data-act="sandbox-skill" data-uid="${u.uid}">${live.skillLeft>0||live.ammo>0?'结束技能':'释放技能'}</button></div>`:''}).join('')||'<small>暂无已部署干员</small>'}<b>测试敌人</b>${(sb.enemyDrafts||[]).map(d=>`<div><span>${d.dummy?'∞':'◆'} ${esc(d.dummy?'不行动木桩':data.enemies[d.id]?.name||d.id)}</span><button data-act="sandbox-remove-enemy" data-uid="${d.uid}">移除</button></div>`).join('')||'<small>暂无敌人</small>'}</div>`:''}</section>`;}
function bondOperators(id){const seen=new Set();return Object.values(data.season.charShopChessDatas).filter(shop=>shop.charId&&!shop.isHidden&&data.profiles[shop.chessId]?.bonds?.includes(id)).map(shop=>{if(seen.has(shop.charId))return null;seen.add(shop.charId);const p=data.profiles[shop.chessId];return {chessId:shop.chessId,charId:shop.charId,name:p.name,rank:shop.chessLevel};}).filter(Boolean).sort((a,b)=>a.rank-b.rank||a.name.localeCompare(b.name,'zh-CN'));}
function sortedBondRows(rows,layers={}){const layerOf=id=>id===SEES_BOND_ID?0:(layers[id]||0);return Object.entries(rows).filter(([id,b])=>b.active||b.count>0||layerOf(id)>0).sort(([aId,a],[bId,b])=>Number(b.active)-Number(a.active)||layerOf(bId)-layerOf(aId)||b.count-a.count||aId.localeCompare(bId));}
// 盟约面板的「当前动态数值」：受层数影响的每一项都由 protocol.bondCurrentPreviewHtml 按原表的
// descParamBaseList／descParamPerStackList 生成（含叙拉古的攻速与隐匿持续时间、谢拉格寒风时长），
// 这里只做一层薄封装，别再往这里加手写数值——漏项就是这么来的。
function bondCurrentPreview(id,layers){return bondCurrentPreviewHtml(data,id,layers);}
// 盟约侧栏与盟约面板的 HTML 只在这里各生成一份：render() 用它们建初始 DOM，updateBondLive() 在战斗中
// 按 0.2 秒的 HUD 节奏重建。战斗中的层数变化（谢拉格「敌人进入冻结→叠层」、卫戍/装备发的层）原来要等
// 回合结束才看得到——侧栏只在 render() 里生成，而战斗中 render() 只在阶段切换时才跑（用户 2026-09-23 报的）。
function bondSidebarHtml(g,rows=g.bonds()){const s=g.s;return sortedBondRows(rows,s.bondLayers).map(([id,b])=>{const info=data.season.bondInfoDict[id],tartarus=id===TARTARUS_BOND_ID,panel=bondPanelCount(data,s,id,b.count);return `<button data-act="bond-info" data-id="${id}" class="${b.active?'active':''}"><b>${info.name}</b><span>${tartarus?`${panel} 层`:`${b.count} / ${info.activeCount}`}</span><small>${tartarus||id===SEES_BOND_ID||info.noStack?'':(s.bondLayers[id]||0)+' 层'}</small></button>`;}).join('')||'<p>部署干员以激活盟约</p>';}
function bondModalHtml(id){
 const g=state.game,b=data.season.bondInfoDict[id],members=bondOperators(id),live=new Set((g?.s.units||[]).filter(u=>u.position).map(u=>u.charId)),layer=g?.s.bondLayers?.[id===SEES_BOND_ID?TARTARUS_BOND_ID:id]||0,active=g?.bonds?.()?.[id]?.active;
 return `<h2>${esc(b.name)}</h2><p>${esc(plain(b.desc))}</p>${bondCurrentPreview(id,layer)}<p class="muted small">${active?'当前盟约已激活，动态数值生效中。':'当前盟约尚未激活，动态数值仅作预览。'}</p><div class="native-bond-roster" aria-label="盟约干员">${members.map(m=>{const on=live.has(m.charId);return `<div class="native-bond-member${on?' active':''}">${avatar(m.charId)}<span><b>${esc(m.name)}</b><small>${m.rank} 阶${on?' · 场上':''}</small></span></div>`;}).join('')||'<small>暂无可用干员</small>'}</div>`;
}
// 侧栏按钮与打开着的盟约面板都按当前层数重算；只有内容真的变了才写 DOM（不打断悬停/焦点）。
function updateBondLive(){
 const g=state.game;if(!g||state.view!=='game')return;
 const aside=root.querySelector('.native-bonds');
 if(aside){const html=bondSidebarHtml(g);if(aside.dataset.bondSig!==html){aside.dataset.bondSig=html;aside.innerHTML=html;}}
 const bond=state.modalMeta&&state.modalMeta.bond;
 if(bond&&data.season.bondInfoDict[bond]){const html=bondModalHtml(bond);if(state.modal!==html)modal(html,{bond});}
}
function strategyInfo(id){const b=data.season.bandDataListDict[id],common=data.common.bandDataDict[id];return {id,name:common?.bandName||id,desc:plain(b?.bandDesc||''),hp:b?.totalHp??'—'};}
function decorateStrategyCatalog(){for(const button of root.querySelectorAll('.native-strategy-catalog button')){const c=strategyCoverageById[button.dataset.id]||{status:'partial',statusLabel:'待核对',gapNote:'尚未建立效果覆盖记录'},span=button.querySelector('span');if(!span)continue;const status=document.createElement('small');status.className=`native-strategy-completeness ${c.status}`;status.textContent=c.statusLabel;status.title=c.gapNote||c.statusLabel;span.prepend(status);if(c.gapNote){const gap=document.createElement('em');gap.className='native-strategy-gap';gap.textContent='缺口：'+c.gapNote;span.append(gap);}}}
// 作战前简报的「盟约缺席情况」与「被禁干员」弹窗。判定与 HTML 片段都在 `native-bond-ban.js`
// 里（那边能在 Node 里直接断言渲染结果），这里只注入转义／头像并挂到动作上。
function bondBanBriefing(d){return bondBanBriefingHtml(data,d?.bondBan,{esc});}
// 弹窗取的是「本局」的禁用记录（战前＝draft，局中＝会话），不能优先用 state.game：
// 从大厅开新局时它可能还留着上一局／旧存档恢复出来的空记录，那样会显示成 0 名。
function showBannedOperators(){modal(bannedOperatorsHtml(data,activeBondBan(state.draft?.bondBan,state.game?.s?.bondBan),{esc,avatar}));}
// 「战前准备」页面状态：页签／筛选和已保存的默认技能覆盖。
function prepState(){
 if(!state.prep)state.prep={tab:'operator',tier:0,core:'',extra:'',skills:null,scroll:0};
 const p=state.prep;
 if(!p.skills)p.skills={...loadPrepSkills(data)};
 return p;
}
// 技能按钮立即写入默认配置；只更新该卡片，保留横向资料带的滚动位置。
function updatePrepCard(charId){
 const p=prepState(),row=prepOperatorRow(data,charId),card=root.querySelector(`.native-prep-card[data-char="${charId}"]`);
 if(!row||!card)return;
 const override=p.skills[charId],custom=override!=null,current=override??row.archive;
 card.classList.toggle('is-custom',custom);
 const skillInfo=card.querySelector('.native-prep-current-skill');
 if(skillInfo)skillInfo.outerHTML=renderPrepSkillInfo(data,charId,current,custom,esc);
 for(const button of card.querySelectorAll('[data-act="prep-skill"]')){const chosen=Number(button.dataset.index)===current;button.classList.toggle('chosen',chosen);button.setAttribute('aria-pressed',String(chosen));}
}
function renderBriefingScreen(){
 const d=state.draft,mode=data.season.modeDataDict[d.modeId],mapIndex=data.maps.filter(m=>m.weight>0).findIndex(m=>m.stageId===d.mapId),map=data.maps.find(m=>m.stageId===d.mapId),tags=(d.roster.types||[]).map(id=>trainingType(id)).filter(Boolean),boss=finalBossConfig(data,d.finalBossId,d.modeId,state.waveTable?.finalBossHpMultiplier??DEFAULT_FINAL_BOSS_HP_MULTIPLIER),strategy=strategyInfo(guardedBandId());
 const modeName=d.cat?'海猫模式':d.egg325?'325模式':mode?.name||'模拟模式',mapLabel=mapIndex>=0?`阵地 ${mapIndex+1}`:'阵地待定',bossName=boss.enemyProfile.name||boss.bossId,bondMarkup=bondBanBriefing(d);
 const mapThumb=mapThumbnailHtml(map,{esc,label:`本局战场：${mapLabel}${map?' · '+map.stageId:''}`});
 return `<main class="native-lobby native-briefing native-briefing-v2">
<header class="briefing-topbar"><button class="briefing-back" data-act="home"><span aria-hidden="true">‹</span> 大厅</button><span class="briefing-topmark"><span class="native-eyebrow">TACTICAL DOSSIER</span><b>SIMULATION / 01</b></span><span class="briefing-mode">${esc(modeName)} <i></i> ${esc(mapLabel)}</span></header>
<div class="briefing-content" role="region" aria-label="模拟简报内容，可滚动" tabindex="0">
<section class="briefing-title"><div><span class="native-eyebrow">MISSION SUMMARY</span><h1>模拟简报</h1><p>确认本局特训、初始策略与盟约限制后，进入模拟。</p></div><aside class="briefing-final-boss"><span class="native-eyebrow">FINAL ENCOUNTER</span><div class="briefing-final-main">${avatar(boss.handbookEnemyId)}<div><small>最终 BOSS · 血量 ${Math.round(boss.hpMultiplier*100)}%</small><b>${esc(bossName)}</b></div></div></aside></section>
<section class="briefing-overview"><section class="briefing-training"><header class="briefing-section-head"><div><span>01 / BATTLE CONDITIONS</span><h2>本局特训</h2></div><small>${tags.length} 项生效</small></header><div class="briefing-training-grid">${tags.length?tags.map((tag,index)=>`<article class="briefing-training-card"><span class="briefing-training-index">${String(index+1).padStart(2,'0')}</span><div><h3>${esc(tag.name)}</h3><small>${esc(tag.id)}</small><p>${esc(tag.desc)}</p></div></article>`).join(''):'<p class="briefing-empty">本局没有额外特训。</p>'}</div></section><aside class="briefing-map-card"><div class="briefing-map-copy"><span class="native-eyebrow">BATTLEFIELD</span><h2>本局战场</h2><b>${esc(mapLabel)}</b><small>${map?esc(map.stageId):'地图数据缺失'}</small></div><div class="briefing-map-preview">${mapThumb}</div></aside></section>
<section class="briefing-strategy-section"><header class="briefing-section-head"><div><span>02 / STARTING PLAN</span><h2>初始策略</h2></div><button class="briefing-choose-strategy" data-act="strategy-select">更换策略 <span aria-hidden="true">→</span></button></header><article class="briefing-selected-strategy"><div class="briefing-strategy-art">${avatar(strategy.id)||'<span class="native-strategy-placeholder" aria-hidden="true">◈</span>'}</div><div class="briefing-strategy-copy"><span class="native-eyebrow">SELECTED STRATEGY</span><h3>${esc(strategy.name)}</h3><p>${esc(strategy.desc)}</p><small>初始生命 <b>${strategy.hp}</b></small></div></article></section>
${bondMarkup?`<section class="briefing-bond-section"><span class="native-eyebrow">03 / COVENANT STATUS</span>${bondMarkup}</section>`:''}
</div><footer class="briefing-actions"><button class="native-primary native-begin" data-act="begin">进入模拟 <span aria-hidden="true">→</span></button></footer></main>`;
}
// 已选策略可能因为「关掉 S.E.E.S. 标记」而变得不可见：这时回落到列表里的第一个，
// 别把一个本局不该存在的策略带进简报与对局（`state.band` 只在选择时才写）。
function guardedBandId(){const bands=visibleBands(data,archiveNow()).map(b=>b.bandId);return bands.includes(state.band)?state.band:(bands[0]||state.band);}
// 部署计数：虎狼丸「不占用部署位」，所以它不计入「N/M 部署」（与 NativeSession.canDeploy 的上限判定同一口径）。
function deployCount(s){return s.units.filter(u=>u.position&&!freeDeploy(data,u)).length;}
function renderStrategySelectScreen(){const bands=visibleBands(data,archiveNow()).map(b=>b.bandId),list=bands.map(id=>strategyInfo(id)).filter(b=>b.name),selectedDraft=state.strategyDraft||state.band,selected=bands.includes(selectedDraft)?selectedDraft:(list[0]?.id||null);return `<main class="native-lobby native-strategy-select"><header><button data-act="strategy-cancel">‹ 返回模拟简报</button><span>策略选择</span></header><div class="native-strategy-select-heading"><div><span class="native-eyebrow">STRATEGY CATALOG</span><h1>选择初始策略</h1></div><p>点击策略卡片预览，再次点击当前策略确认并返回模拟简报。</p></div><div class="native-strategy-catalog">${list.map(b=>`<button data-act="strategy-pick" data-id="${b.id}" class="${selected===b.id?'chosen':''}"><div class="native-strategy-card-art">${avatar(b.id)||'<span class="native-strategy-placeholder" aria-hidden="true">◈</span>'}</div><span><b>${esc(b.name)}</b><small>初始生命 ${b.hp}</small><p>${esc(b.desc)}</p></span></button>`).join('')}</div><div class="native-strategy-select-actions"><button data-act="strategy-cancel">取消</button></div></main>`;}
function render(){
 painting=true;
 try{
 document.getElementById('native-quick-sell')?.remove();
 // 禁用盟约挡住了某次发放（策略／道具／卫戍点名发的干员）时给一条提示：这类拦截是「不发」而不是
 // 「报错」，不提示的话玩家只会觉得效果没生效。计数由 NativeSession.gain 写，这里只负责播报一次。
 if(state.game&&(state.game.s.bondBanBlocks||0)>(state.bondBanBlocks||0)){
  const blocked=state.game.s.bondBanLast||{};
  state.bondBanBlocks=state.game.s.bondBanBlocks;
  const bannedNames=(blocked?.bonds||[]).map(id=>data.season.bondInfoDict[id]?.name||id).join('／');
  notice(`${data.profiles[blocked?.chessId]?.name||'该干员'}属于本局被禁用的【${bannedNames||'盟约'}】，本次无法获得。`);
 }
 if(state.view==='lobby'){root.innerHTML=renderLobby({data,state,avatar});positionLobbyUpdateCard();root.querySelector('.native-tool-grid')?.insertAdjacentHTML('afterbegin',poolDirty()?'<div class="native-pool-update"><div><span>CONFIGURATION UPDATE</span><b>敌人编制／Boss 倍率／禁用配置已改动</b><small>与默认配置不一致，点击右侧按钮可一起恢复默认</small></div><button class="native-pool-update-action" data-act="pool-defaults">恢复默认配置</button></div>':'');/* 主界面的「导出存档」（用户 2026-09-27 需求）：插在动作行末尾，和「导入存档」成对。 */root.querySelector('.native-loadout-actions')?.insertAdjacentHTML('beforeend','<button data-act="export">导出存档</button>');gateLockedModes();renderModal();return;}
  if(state.view==='strategy-select'){root.innerHTML=renderStrategySelectScreen();decorateStrategyCatalog();renderModal();return;}
 if(state.view==='briefing'){root.innerHTML=renderBriefingScreen();renderModal();return;}
  if(state.view==='prepare'){const p=prepState(),listScroll=root.querySelector('#prep-list')?.scrollLeft??p.listScrollLeft??0;root.innerHTML=renderPreparePage(data,p,{esc,avatar});const list=root.querySelector('#prep-list');if(list)list.scrollLeft=listScroll;if(p.scroll)window.scrollTo(0,p.scroll);renderModal();return;}
 if(state.view==='editor'){const oldNav=root.querySelector('.wave-ed-temps'),navTop=oldNav?.scrollTop||0,navLeft=oldNav?.scrollLeft||0;root.innerHTML=renderWaveEditor(data,state.waveTable,state.editor);const nav=root.querySelector('.wave-ed-temps');if(nav){nav.scrollTop=navTop;nav.scrollLeft=navLeft;}const search=document.getElementById('ed-search'),catalog=document.getElementById('ed-catalog');if(search&&state.editor.keepSearch){search.focus();try{search.setSelectionRange(state.editor.caret,state.editor.caret);}catch{}}state.editor.keepSearch=false;if(catalog)catalog.scrollTop=state.editor.scroll||0;const dialog=root.querySelector('#wave-ed-test');if(dialog){dialog.showModal();const close=()=>{state.editor.sample=null;render();root.querySelector('.wave-ed-current [data-act=ed-roll]')?.focus();};dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}});}renderModal();return;}
 const g=state.game,s=g.s,turn=currentTurn(),rows=g.bonds(),handLayout=handView(g);root.innerHTML=`<main class="native-game${s.phase==='battle'?' is-battle':''}${state.supplyCollapsed?' is-supply-collapsed':''}${state.sandbox?' is-sandbox':''}">${dossier()}<header class="native-top"><button data-act="home">‹ 大厅</button><strong>卫戍协议 / 盟约下半</strong><button class="native-mobile-info" data-act="field-info">战况 / 设置</button><button data-act="limits">已知差异</button><button data-act="branches">分支规则</button><button class="native-ban-entry" data-act="ban-list">禁用名单</button><button data-act="export">导出存档</button></header><div class="native-workspace"><aside class="native-bonds">${bondSidebarHtml(g,rows)}</aside><section class="native-field"><div class="native-field-caption"><b>${state.sandbox?(s.phase==='battle'?'技能测试':'测试配置'):s.phase==='battle'?(turn.isBossTurn?'最终 Boss':'自动作战'):s.phase==='prep'?'阵地休整':s.phase==='finished'?'模拟结束':'回合结算'}</b><span id="native-wave-progress">${deployCount(s)} / ${s.capacity} 部署</span>${s.phase==='battle'&&!state.sandbox?battleBar():''}</div><div class="native-terrain-legend" aria-label="地块图例">${terrainLegend(g.map)}</div><div class="native-board"><canvas id="native-canvas" tabindex="0" aria-label="战场棋盘，先选位置再拖动朝向确认"></canvas><span class="native-cost" title="战斗费用余额，与商店资金独立"><small>Cost 费用</small><output id="native-cost-balance" aria-label="战斗费用余额">—</output></span></div><div class="native-facing" ${state.preview?'':'hidden'}><span class="native-facing-tip">拖动选择朝向，松手确认；中心松手取消。</span>${[0,1,2,3].map((d)=>`<button data-act="aim" data-dir="${d}">${['→','↓','←','↑'][d]}</button>`).join('')}<button data-act="place-confirm">确认放置</button><button data-act="cancel">取消</button></div><div class="native-controls"><button data-act="fullscreen" hidden>打开全屏</button><button data-act="pause" ${s.phase!=='battle'?'disabled':''}>${state.paused?'继续':'暂停'}</button>${[1,2,4].map(n=>`<button data-act="speed" data-speed="${n}" class="${state.speed===n?'chosen':''}">${n}×</button>`).join('')}<button data-act="mute">${state.muted?'声音关':'声音开'}</button><label>音量 <input id="native-volume" aria-label="战斗音量" type="range" min="0" max="1" step="0.05" value="${state.volume}" style="width:72px"></label><button data-act="reduce-fx">${state.reduceFx?'动效少':'动效'}</button>${s.phase==='prep'?(state.sandbox?'<button class="native-primary" data-act="sandbox-start">开始测试 →</button>':'<button class="native-primary" data-act="start">准备完毕 →</button>'):s.phase==='intermission'?'<button class="native-primary" data-act="next">进入下一回合 →</button>':s.phase==='finished'?'<button data-act="result">查看伤害报告</button><button data-act="home">回到大厅</button>':''}</div><div class="native-bench-label${g.handFull()?' is-over':''}" id="native-hand-label">整备区 ${g.handLength()} / ${HAND_LIMIT} ${g.handFull()?'<em class="native-hand-warn">已满，出售或部署清出空余后才能购买</em>':''}<span id="native-drop-hint" aria-live="polite">拖动卡片换格；场上干员拖回此处</span></div><div class="native-bench" id="native-hand" data-layout="${handLayout.signature}" aria-label="整备区">${handLayout.html}</div></section><aside class="native-detail">${state.sandbox?sandboxDetail():waveIntel()}${detail()}<h3>${esc(data.common.bandDataDict[s.bandId].bandName)}</h3><p>${esc(plain(data.season.bandDataListDict[s.bandId].bandDesc))}</p><p>${turn.isBossTurn?`本局最终 Boss：${esc(finalBossConfig(data,s.finalBossId,s.modeId).enemyProfile.name||s.finalBossId)}。倒计时 100 秒 + 开战时剩余生命；30 名增援每 3 秒从上下红门进入，Boss 击破立即胜利。`:'最终回合按随机 Boss 作战，本体击破立即获胜。'}</p><div id="native-combat-stats"></div></aside></div><div class="native-status" id="native-status"></div><section class="native-shop" id="native-supply-shop"><div><h2>调度中心 ${s.level}</h2><button class="native-supply-toggle" data-act="supply-toggle" aria-controls="native-supply-shop" aria-expanded="${!state.supplyCollapsed}">${state.supplyCollapsed?'展开商店 ▴':'收起商店 ▾'}</button><button data-act="upgrade" ${s.phase!=='prep'?'disabled':''}>升级 ${catOn()?'ALL':(g.terms().upgradeCost??'MAX')} ◆</button><span class="native-refresh-control"><button data-act="refresh" ${s.phase!=='prep'?'disabled':''}${s.forcedRefresh?` title="特殊刷新：此次刷新出现的干员优先为${esc(data.season.bondInfoDict[s.forcedRefresh.bond]?.name||'指定盟约')}干员"`:''}>${s.forcedRefresh?`特殊刷新${s.forcedRefresh.count>1?` ×${s.forcedRefresh.count}`:''}`:'刷新'} ${s.freeRefresh?'免费':catOn()?'ALL':'1 ◆'}</button></span>${catOn()?'<button data-act="stockview" title="查看各干员剩余库存">库存</button>':''}<button data-act="lock" ${s.phase!=='prep'?'disabled':''}>${g.shopAllFrozen()?'解冻':'冻结'}</button>${s.rewardPending?.tier?'<span class="native-reward-shop-hint">三合一奖励选择中 · 点击候选卡片预览，再次点击确认</span>':''}${g.handFull()?'<span class="native-reward-shop-hint is-over" title="召唤物卡、干员与装备一起占整备区格">整备区已满，暂不可购入干员／装备</span>':''}</div><div class="native-shop-cards">${shopCards(g,s)}</div></section></main>`;canvas=document.getElementById('native-canvas');syncFreeRefreshCount();syncPlayChrome();updateHud();fitWaveFaces();draw();renderModal();showRequired();syncQuickSell();
 }finally{painting=false;paint325();}
}
function waveIntel(){
 const g=state.game;if(!g||g.s.phase==='finished')return '';
 const turn=currentTurn(),p=nativeWavePlan(data,turn,g.s.waveRoster),roman=n=>'I'.repeat(n||1);
 const tags=(g.s.waveRoster?.types||[]).map(id=>trainingType(id)||TRAINING_TYPES.find(t=>t.id===id)).filter(Boolean);
 const contracts=[...(g.s.pendingBounties||[]),g.s.pendingBounty].filter(Boolean),faces=[...(p.pack?.ids||[]),...contracts.map(x=>x.enemyId)].map(id=>avatar(id)||'<span class="native-wave-miss">?</span>').join('');
 const bountyNote=contracts.length?`<p class="native-wave-bounty-note">决策悬赏：${contracts.map(x=>`${esc(data.enemies[x.enemyId]?.name||x.enemyId)} · ${x.coin}◆`).join(' / ')}</p>`:'';
 const bossRound=Boolean(turn?.isBossTurn&&!turn.isConditional),boss=bossRound?finalBossConfig(data,g.s.finalBossId,g.s.modeId,g.s.finalBossHpMultiplier):null;
 const body=boss?`<p>最终 Boss · ${esc(boss.enemyProfile.name||boss.bossId)}</p><div class="native-wave-faces">${avatar(boss.handbookEnemyId)}<span>血量 ${Math.round(boss.hpMultiplier*100)}% · 普通敌人 30 名 · 每 3 秒从上下红门出现</span></div>`:`<p>${esc(trainingType(p.assignment?.type)?.name||'未指定')} ${roman(p.assignment?.tier)}</p><div class="native-wave-faces">${faces}</div>${bountyNote}`;
 return `<section class="native-wave-preview"><h3>本波敌情</h3><p class="native-wave-tags">本局特训 ${tags.map(t=>esc(t.name)).join(' / ')||'尚未抽取'}</p>${body}</section>`;
}
function fitWaveFaces(){
 const box=document.querySelector('.native-wave-faces');if(!box)return;
 const n=box.childElementCount,w=box.clientWidth,h=box.clientHeight;
 let s=48;while(s>8&&Math.floor(w/s)*Math.floor(h/s)<n)s--;
 box.style.setProperty('--face',s+'px');
}
function itemRecord(id){return data.items.find(i=>i.id===id||i.elite?.chessId===id);}
function itemName(id){const record=data.season.trapChessDataDict[id];return (itemRecord(id)?.name||id)+(record?.isGolden?' · 进阶':'');}
function itemIcon(id){const item=itemRecord(id),file=item&&data.assets[item.id];return file?`<img class="native-item-art" src="./${esc(file)}" alt="" loading="lazy" draggable="false">`:'<span class="native-item-art native-item-art-empty" aria-hidden="true"></span>';}
function itemEffect(id){const trap=data.season.trapChessDataDict[id],info=data.season.effectInfoDataDict[trap?.effectId];return info?{name:info.effectName,desc:plain(info.effectDesc)}:{name:itemName(id),desc:''};}
function inspectSame(kind,key){const inv=state.inspect;return !!inv&&inv.kind===kind&&(inv.uid??inv.index)===key;}
function rewardShopCards(reward){return (reward?.offers||[]).map((id,i)=>{const p=data.profiles[id],bonds=(p?.bonds||[]).map(id=>data.season.bondInfoDict[id]?.name||id).join(' / ')||'无盟约';return p?`<button data-act="reward" data-index="${i}" class="native-reward-shop-card ${inspectSame('reward',i)?'chosen':''}">${avatar(p.charId)}<strong>${esc(p.name)}</strong><small>三合一奖励候选</small><p>${esc(bonds)}<br><span>点击预览，再次点击选择</span></p></button>`:'';}).join('');}
 function shopCards(g,s){if(s.rewardPending?.tier){g.ensureRewards();return rewardShopCards(s.rewardPending);}const frozen=i=>s.locked||(s.frozenSlots||[]).includes(i),mergeReady=id=>{const chess=data.season.charChessDataDict[id];return !!chess?.upgradeChessId&&s.units.filter(u=>u.chessId===id).length+1>=chess.upgradeNum;};return s.offers.map((id,i)=>id?`<div class="native-shop-card"><button data-act="buy" data-index="${i}" class="${inspectSame('shop',i)?'chosen ':''}${mergeReady(id)?'native-shop-merge-ready ':''}${frozen(i)?'native-shop-frozen':''}"${mergeReady(id)?' title="购买后触发三合一"':''}>${avatar(data.profiles[id].charId)}<strong>${esc(data.profiles[id].name)}</strong><small>${data.profiles[id].rank} 阶 · ${g.price(id)} ◆</small><p>${g.ownBonds({chessId:id}).map(b=>data.season.bondInfoDict[b].name).join(' / ')}</p></button></div>`:'<div class="native-empty">已调配</div>').join('')+s.itemOffers.map((id,i)=>id?`<button data-act="buyItem" data-index="${i}" class="${inspectSame('shopItem',i)?'chosen ':''}${s.locked?'native-shop-frozen':''}">${itemIcon(id)}<strong>${esc(itemName(id))}</strong><small>${data.season.trapChessDataDict[id].purchasePrice} ◆</small></button>`:'<div class="native-empty">已调配</div>').join('');}
function syncFreeRefreshCount(){const button=root.querySelector('.native-shop [data-act="refresh"]');if(!button)return;let control=button.parentElement;if(!control?.classList.contains('native-refresh-control')){control=document.createElement('span');control.className='native-refresh-control';button.before(control);control.append(button);}let label=control.querySelector('.native-free-refresh-count'),remaining=Math.max(0,Math.floor(Number(state.game?.s?.freeRefresh)||0));if(remaining){if(!label){label=document.createElement('small');label.className='native-free-refresh-count';label.setAttribute('aria-live','polite');control.append(label);}label.textContent=`剩余 ${remaining} 次`;}else label?.remove();}
function inspectTarget(){
 const g=state.game,inv=state.inspect;if(!g||!inv)return null;
 if(inv.kind==='unit'){const u=g.s.units.find(x=>x.uid===inv.uid);return u?{kind:'op',u,p:profile(u),live:g.battle?.s.units.find(a=>a.uid===u.uid),shop:false}:null;}
 if(inv.kind==='summon'){const s=g.battle?.s.summons?.find(x=>x.uid===inv.uid);return s?{kind:'summon',s}:null;}
 if(inv.kind==='reward'){const id=g.s.rewardPending?.offers?.[inv.index],p=id&&data.profiles[id];return p?{kind:'op',u:null,p:{...p,...(p.skillChoices?.[p.skillIndex]||{})},live:null,shop:false,reward:true}:null;}
 if(inv.kind==='shop'){const id=g.s.offers[inv.index];if(!id)return null;const row=data.profiles[id];return {kind:'op',u:null,p:{...row,...(row.skillChoices?.[row.skillIndex]||{})},live:null,shop:true,price:g.price(id)};}
 if(inv.kind==='shopItem'){const id=g.s.itemOffers[inv.index];return id?{kind:'item',id,shop:true,price:data.season.trapChessDataDict[id]?.purchasePrice}:null;}
 if(inv.kind==='pack'){const it=g.s.items.find(i=>i.uid===inv.uid);return it?{kind:'item',id:it.chessId,shop:false,uid:it.uid}:null;}
 if(inv.kind==='equip'){const u=g.s.units.find(x=>x.uid===inv.uid),it=u?.equipment?.[inv.slot];return it?{kind:'item',id:it.chessId,shop:false,owner:u,slot:inv.slot}:null;}
 return null;
}
function mineCampControls(camp){
 const g=state.game,ready=g?.s.phase==='battle'&&g.battle?.mineCampReady(camp),cost=camp.mineSkill.spData.spCost;
 return `<p>当前指令：${camp.mineMode==='waiting'?'待命':'出击'} · 技力 ${Math.floor(camp.sp)}/${cost}</p><div class="native-dossier-acts"><button data-act="mineCommand" data-uid="${camp.uid}" ${ready?'':'disabled'}>切换为${camp.mineMode==='waiting'?'出击':'待命'}</button></div>`;
}
function dossier(){
 const t=inspectTarget();if(!t)return '';
 if(t.kind==='item'){
  const fx=itemEffect(t.id),owner=t.owner,prep=state.game?.s.phase==='prep';
  // 销毁按钮统一放在道具详情里（方形按钮，与「撤回整备区／出售」同款），不再挂在手牌卡片和装备位上。
  const acts=t.shop?'':`<div class="native-dossier-acts">${owner?`<button data-act="inspect-back" data-uid="${owner.uid}">返回干员</button>`:''}${prep?`<button data-act="${owner?'destroyEquip':'destroy'}" data-uid="${owner?owner.uid:t.uid}" data-slot="${owner?t.slot:''}">销毁</button>`:''}</div>`;
  const where=owner?`已装备 · ${esc(data.profiles[owner.chessId]?.name||'')}`:'整备区';
  const hint=t.shop?`<p class="native-dossier-buy">再次点击卡片购买 · ${catOn()?'ALL':t.price} ◆</p>`:(owner?'':`<p class="native-dossier-buy">再次点击卡片以装备给干员</p>`);
  return `<aside class="native-dossier" aria-label="道具档案"><div class="native-dossier-body"><button data-act="inspect-close" class="native-dossier-close" aria-label="关闭">×</button><div class="native-dossier-art native-dossier-item">${itemIcon(t.id)}</div><h2>${esc(itemName(t.id))}</h2><p class="native-dossier-kicker">${esc(fx.name)} · ${where}</p><h3>效果</h3><p>${esc(fx.desc||'无效果说明')}</p>${hint}${acts}</div></aside>`;
 }
 if(t.kind==='summon'){
  const s=t.s,owner=state.game.s.units.find(u=>u.uid===s.ownerUid);
  return `<aside class="native-dossier" aria-label="召唤物档案"><div class="native-dossier-body"><button data-act="inspect-close" class="native-dossier-close" aria-label="关闭">×</button><h2>${esc(s.name||s.type)}</h2><p class="native-dossier-kicker">${s.neutral?'中立单位':s.device?'装置':'召唤物'}${owner?' · '+esc(data.profiles[owner.chessId]?.name||''):''}</p><p id="native-dossier-hp" class="native-dossier-hp">生命 <b>${Math.round(s.hp)}</b><i>/${Math.round(s.maxHp)}</i></p><p>${s.targetable===false?'不可被常规选中':''} ${s.canBlock?'可阻挡':''} ${s.canHeal?'可治疗':''}</p>${s.type==='mine-camp'?'<div id="native-mine-camp-controls">'+mineCampControls(s)+'</div>':''}</div></aside>`;
 }
 const p=t.p,g=state.game,owned=t.u,a=t.live&&g.battle?g.battle.stats(t.live):p.attributes;
 const hp=Math.round(t.live?.hp??a.maxHp),max=Math.round(t.live?.maxHp??a.maxHp);
 const live=t.live,liveFill=live&&g.battle?spBarFill(live,p.skill,g.battle.spCost(live)):null,phase=live?(live.dollForm?`替身 ${Math.max(0,live.dollForm.until-(g.battle?.s.time||0)).toFixed(1)}s`:live.ammo>0?`弹药 ${live.ammo}/${live.ammoMax}`:live.skillLeft>0?`技能持续 ${live.skillLeft.toFixed(1)}s`:live.down>0?`再部署 ${Math.ceil(live.down)}s`:liveFill?.ready?'技力就绪':'待机'):'';
 const parts=(a.parts||[]).map(x=>`${esc(x.src)} ${x.stat} ${x.layer} ${x.v}`).join('<br>')||'无额外加成';
 const statuses=(live?.statuses||[]).map(s=>s.kind).join('、')||'无';
 const bondIds=[...new Set(owned?g.ownBonds(owned):p.bonds||data.season.charChessDataDict[p.chessId]?.bondIds||[])];
 // 同名干员（按 charId 归并）的技能是共用的：档案里给个提示，免得玩家以为要一张张改。
 const sameNameCount=owned?g.s.units.filter(v=>v.charId===owned.charId).length:0;
 const equipment=owned?.equipment||[],equipmentSlots=Array.from({length:2},(_,i)=>equipment[i]?`<button class="native-equipment-slot filled" data-act="equip-inspect" data-uid="${owned.uid}" data-slot="${i}"><span class="native-equipment-slot-art">${itemIcon(equipment[i].chessId)}</span><span>装备位 ${i+1}</span><b>${esc(itemName(equipment[i].chessId))}</b><small>已装备 · 点击查看</small></button>`:`<div class="native-equipment-slot"><span>装备位 ${i+1}</span><b>空槽</b><small>${owned?'可装备':'获得干员后可用'}</small></div>`).join('');
 return `<aside class="native-dossier" aria-label="干员档案"><div class="native-dossier-art">${avatar(p.charId)}</div><div class="native-dossier-body"><button data-act="inspect-close" class="native-dossier-close" aria-label="关闭">×</button><h2 class="native-dossier-heading"><span class="native-dossier-heading-name">${esc(p.name)}${p.isGolden?'<span class="native-dossier-elite-badge">进阶</span>':''}</span>${bondIds.length?`<span class="native-dossier-name-bonds">${bondIds.map(id=>`<i>${esc(data.season.bondInfoDict[id]?.name||id)}</i>`).join('')}</span>`:''}${owned&&g.s.phase==='prep'?`<button class="native-dossier-sell" data-act="sell" data-uid="${owned.uid}">出售 +1 ◆</button>`:''}</h2><p class="native-dossier-kicker">${esc(data.branchRules.records.find(r=>r.id===p.branch)?.name||p.branch||'')} · ${p.rank} 阶${t.reward?' · 三合一奖励候选':''}</p><p id="native-dossier-hp" class="native-dossier-hp">生命 <b>${hp}</b><i>/${max}</i></p><div class="native-dossier-stats"><span>攻击 ${Math.round(a.atk)}</span><span>防御 ${Math.round(a.def)}</span><span>法抗 ${Math.round(a.magicResistance)}</span><span>攻速 ${Math.round(a.attackSpeed)}</span></div><div id="native-dossier-live" class="native-dossier-live"><p>阶段 ${esc(phase)}</p><p>状态 ${esc(statuses)}</p><h3>属性来源</h3><p>${parts}</p></div><h3>所属盟约</h3><div class="native-dossier-bonds">${bondIds.map(id=>`<span>${esc(data.season.bondInfoDict[id]?.name||id)}</span>`).join('')||'<small>暂无盟约</small>'}</div><h3>技能</h3>${owned?`<label>携带技能<select data-uid="${owned.uid}" id="native-skill" ${g.s.phase!=='prep'?'disabled':''}>${data.profiles[owned.chessId].skillChoices.map((v,i)=>`<option value="${i}" ${(owned.skillIndex??data.profiles[owned.chessId].skillIndex)===i?'selected':''}>${esc(v.skill?.name||'无主动技能')}</option>`).join('')}</select></label>${sameNameCount>1?`<p class="native-dossier-sync">同名干员共 ${sameNameCount} 张，技能会一起切换（场上的这些干员保持同一个技能）。</p>`:''}`:`<p class="native-dossier-skill-name">${esc(p.skill?.name||'无主动技能')}</p>`}<p>${esc(renderSkillDescription(p.skill)||'无主动技能')}</p><h3>卫戍</h3>${(p.garrisons||[]).map(x=>`<p>${garrisonHtml(x)}</p>`).join('')||'<p>无卫戍效果</p>'}<h3>装备栏</h3><div class="native-dossier-equipment">${equipmentSlots}</div>${t.shop?`<p class="native-dossier-buy">再次点击卡片购买 · ${catOn()?'ALL':t.price} ◆</p>`:''}${owned&&owned.position&&g.s.phase==='prep'?`<div class="native-dossier-acts"><button data-act="withdraw" data-uid="${owned.uid}">撤回整备区</button></div>`:''}</div></aside>`;
}
function syncQuickSell(){
 document.getElementById('native-quick-sell')?.remove();
 const g=state.game,quick=state.quickSell,uid=quick?.uid;
 if(!g||state.view!=='game'||state.sandbox||g.s.phase!=='prep'||g.s.rewardPending||state.modal||state.inspect?.kind!=='unit'||state.inspect.uid!==uid)return;
 const unit=g.s.units.find(u=>u.uid===uid);if(!unit)return;
 let x=quick.x,y=quick.y;
 if(!unit.position){const card=root.querySelector(`#native-hand button[data-act="select"][data-uid="${uid}"]`),target=card?.querySelector('img')||card,rect=target?.getBoundingClientRect?.();if(rect){x=(rect.left+rect.right)/2;y=rect.top-3;}}
 if(!Number.isFinite(x)||!Number.isFinite(y))return;
 const button=document.createElement('button');button.type='button';button.id='native-quick-sell';button.className='native-quick-sell';button.dataset.act='sell';button.dataset.uid=String(uid);button.setAttribute('aria-label',`${data.profiles[unit.chessId]?.name||'干员'} 出售 +1 ◆`);button.textContent='出售 +1 ◆';button.style.left=`${x}px`;button.style.top=`${y}px`;
 button.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();action(button);});document.body.append(button);
}
function detail(){return state.inspect?'':'<h3>阵地指令</h3><p>点击干员或商店卡片查看档案。商店需再点一次才购买。</p>';}
// 海猫模式的库存面板：按阶级列出每个可售干员的剩余 / 初始库存
function stockPanel(){
 const g=state.game;ensureStock(data,g.s);
 const rows=Object.values(data.season.charShopChessDatas).filter(o=>o.charId&&!o.isHidden);
 const groups=new Map();
 for(const row of rows){const tier=Number(row.chessLevel)||1;if(!groups.has(tier))groups.set(tier,[]);groups.get(tier).push(row);}
 const sections=[...groups.keys()].sort((a,b)=>a-b).map(tier=>{
  const list=groups.get(tier).slice().sort((a,b)=>(data.profiles[a.chessId]?.name||'').localeCompare(data.profiles[b.chessId]?.name||'','zh'));
  return `<h3 class="native-stock-tier">${tier} 阶 · 每人 ${STOCK_BY_TIER[tier]??64}</h3><div class="native-stock-grid">${list.map(row=>{
   const name=esc(data.profiles[row.chessId]?.name||row.chessId),left=g.s.stock[row.chessId],total=STOCK_BY_TIER[tier]??64;
   return `<span class="native-stock-row${left<=0?' is-empty':''}"><b>${name}</b><i>${left}</i><small>/${total}</small></span>`;
  }).join('')}</div>`;
 }).join('');
 return `<h2>剩余库存</h2><p class="native-dossier-kicker">只有从商店买走的干员占库存；出售会按购买记录回补，精锐出售回补合成时买走的全部份数。干员／策略等效果获得的干员不占库存、出售也不回补。</p><div class="native-stock">${sections}</div>`;
}
function showRequired(){
 const g=state.game,r=g.s.rewardPending;
 if(r&&!r.tier){if(r.kind==='bounty')modal(renderBountyChoice(data,r.offers,g.s.round));else{g.ensureRewards();modal(`<h2>晋升／特殊调配</h2><p>选择获得一项奖励</p><div class="native-rewards">${r.offers.map(id=>`<button data-act="reward" data-id="${id}">${r.kind==='item'?itemIcon(id):avatar(data.profiles[id].charId)}<b>${esc(r.kind==='item'?itemName(id):data.profiles[id].name)}</b></button>`).join('')}</div>`);}}
 else if(g.s.phase==='decision')modal(renderDecisionChoice(data,g.s.roundDecisions,g.s.round,{type:g.s.roundDecisionType}));
}
function requiredChoicePending(){const s=state.game?.s;return !!(s&&(s.rewardPending&&!s.rewardPending.tier||s.phase==='decision'));}

// 整局结束（打完 BOSS／血量清空 game over）后的作战报告。底部动作行用 `.native-result-actions`
// 吸底：手机上伤害列表要滚动，按钮不能被列表顶出屏幕；「回到大厅」是这一屏的主按钮。
function reportCurve(samples){const values=(samples||[]).map(v=>Math.max(0,Number(v)||0)),w=320,h=120,p=8,peak=Math.max(0,...values),scale=peak||1,points=values.map((v,i)=>`${p+(w-2*p)*(values.length<2?0:i/(values.length-1))},${h-p-(h-2*p)*v/scale}`).join(' ');return `<svg class="native-dps-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="每秒伤害变化曲线"><path d="M ${p} ${h-p} H ${w-p} M ${p} ${h-p} V ${p}"/><polyline points="${points}"/></svg><small>战斗时间（秒） · 峰值 ${Math.round(peak).toLocaleString()} DPS</small>`;}
function finalBondLayerRows(g,r){const sees=isSeesBand(g.s.bandId),visible=id=>sees||id!==SEES_BOND_ID&&id!==TARTARUS_BOND_ID,ids=[...new Set([...Object.keys(data.season.bondInfoDict||{}),SEES_BOND_ID,TARTARUS_BOND_ID,...Object.keys(g.s.bondLayers||{})])].filter(visible),rows=Array.isArray(r.finalBondLayers)?r.finalBondLayers.filter(row=>visible(row.id)):ids.map(id=>({id,name:data.season.bondInfoDict[id]?.name||id,layers:g.s.bondLayers?.[id]||0}));return rows.map(row=>{const value=Number(row.layers);return {id:row.id,name:row.name||data.season.bondInfoDict[row.id]?.name||row.id,layers:Number.isFinite(value)?Math.max(0,Math.floor(value)):0};});}
function bondLayerReport(rows){return '<section class="native-result-bond-layers"><h3>盟约最终层数</h3><div role="list">'+rows.map(row=>'<span role="listitem" class="'+(row.layers?'has-layers':'')+'"><b>'+esc(row.name)+'</b><i>'+row.layers+' 层</i></span>').join('')+'</div></section>';}
function showResult(){const g=state.game,r=g.s.runResult||g.s.history.at(-1);if(!r)return;if(r.kind==='online-boss-skipped'){modal(`<h2>联机对局结束</h2><p>已到第 ${r.round} 回合的 Boss 阶段。联机 MVP 暂不开放 Boss 战，本局在此结束。</p><button class="native-primary" data-act="home">回到大厅</button>`);return;}const archived=state.archive?.runs?.length||archiveNow().runs.length,units=(r.units||[]).slice().sort((a,b)=>b.damage-a.damage),selected=units.find(u=>u.uid===state.resultUnitUid)||units[0],bossName=r.bossName||'最终 Boss';modal(`<h2>${r.kind==='final-boss'?(r.reason==='boss-killed'?'Boss 击破 · 挑战成功':'Boss 未能击破 · 挑战结束'):'作战报告'}</h2>${r.kind==='final-boss'?`<p class="native-boss-result-heading">${esc(bossName)} · ${r.elapsed.toFixed(1)} 秒</p>`:''}<p>总伤害</p><strong class="native-total">${Math.round(r.totalDamage||0).toLocaleString()}</strong><p>${r.elapsed.toFixed(2)} 秒 · DPS ${(r.dps??(r.elapsed>0?r.totalDamage/r.elapsed:0)).toFixed(2)}${r.kind==='final-boss'?` · 红门漏怪 ${r.timePenalty||0} 次`:''}</p>${archived?`<p class="muted small">已记入本地战绩：最近 ${archived} 场，可在「战前准备」页查看并随存档导出。</p>`:''}<div class="native-result-dps"><h3>角色造成总伤害</h3><div class="native-result-unit-list">${units.map(u=>{const source=g.s.units.find(x=>x.uid===u.uid),name=source?data.profiles[source.chessId].name:u.id||'其他来源';return `<button data-act="result-unit" data-uid="${u.uid}" class="${selected?.uid===u.uid?'chosen':''}">${esc(name)}<b>${Math.round(u.damage).toLocaleString()}</b></button>`;}).join('')||'<p>本次没有造成伤害。</p>'}</div>${selected?reportCurve(selected.dpsSamples):''}</div>${bondLayerReport(finalBondLayerRows(g,r))}<div class="native-result-actions"><button data-act="export">导出本次记录</button><button class="native-primary" data-act="home">回到大厅</button></div>`);}
function resetUpgradeConfirm(){if(!upgradeConfirm)return;upgradeConfirm=false;const button=root.querySelector('[data-act="upgrade"]');if(button){button.textContent=`升级 ${catOn()?'ALL':(state.game?.terms?.().upgradeCost??'MAX')} ◆`;button.classList.remove('is-confirming');button.setAttribute('aria-pressed','false');}}
function action(button,anchor=null){const a=button.dataset.act,g=state.game,uid=Number(button.dataset.uid);if(button.disabled)return;if(a!=='upgrade')resetUpgradeConfirm();if(['home','new','begin','resume','sandbox','sandbox-exit'].includes(a))runtimeFault=null;if(['sandbox','home','sandbox-exit','new'].includes(a))rememberView('lobby');if(['begin','resume','import'].includes(a))rememberView('game');
 if(a==='upgrade'){if(!g||g.s.phase!=='prep')return;if(!upgradeConfirm){upgradeConfirm=true;button.textContent='确定升级';button.classList.add('is-confirming');button.setAttribute('aria-pressed','true');return;}resetUpgradeConfirm();const ok=g.perform('upgrade');if(!ok)notice(g.lastError||'当前资金不足或商店已达最高等级，无法升级。');save();render();return;}
 if(a==='result-unit'){state.resultUnitUid=uid;showResult();return;}
 if(a==='update-log'){showUpdateLog();return;}
 if(a==='hand-scroll'){scrollHandByHalfSlot(button.dataset.direction);return;}
 if(a==='fullscreen'){enterPlayChrome().then(()=>{if(!(document.fullscreenElement||document.webkitFullscreenElement))notice('未能进入全屏，请再次点击或检查浏览器全屏设置。');});return;}
 if(a==='ban-list'){showBannedOperators();return;}
 if(a==='archive'&&state.view==='lobby'){modal(renderArchiveWindow(archiveNow(),esc));return;}
 if(a==='passcode'){state.passcode={digits:''};renderPasscodePad();return;}
 if(a==='passcode-key'){passcodeKey(button.dataset.key||'');return;}
 if(a==='band'){state.band=button.dataset.id;render();return;}if(a==='limits'){showLimitations();return;}if(a==='branches'){showBranches(button.dataset.id||null);return;}if(a==='close'){if(requiredChoicePending())return;state.modal=null;state.modalMeta=null;renderModal();return;}
 if(a==='supply-toggle'){state.supplyCollapsed=!state.supplyCollapsed;render();return;}
 if(a==='sandbox'){enterPlayChrome();openSandbox();return;}if(a==='home'&&state.sandbox){const previous=state.sandbox.previousGame||null;state.sandbox=null;state.game=previous;state.view='lobby';state.paused=true;leavePlayChrome();render();return;}if(a==='sandbox-exit'){const previous=state.sandbox?.previousGame||null;state.sandbox=null;state.game=previous;state.view='lobby';state.paused=true;leavePlayChrome();render();return;}if(a==='sandbox-reset'){sandboxReset();return;}if(a==='sandbox-add-op'){sandboxAddOperator(button.dataset.id);return;}if(a==='sandbox-add-enemy'){sandboxSpawnEnemy(button.dataset.id,false);return;}if(a==='sandbox-add-dummy'){sandboxSpawnEnemy('enemy_1041_lazerd',true);return;}if(a==='sandbox-remove-enemy'){sandboxRemoveEnemy(uid);return;}if(a==='sandbox-remove-op'){const sb=state.sandbox;if(sb){sb.economy.s.units=sb.economy.s.units.filter(u=>u.uid!==uid);if(sb.battle)sb.battle.s.units=sb.battle.s.units.filter(u=>u.uid!==uid);render();}return;}if(a==='sandbox-start'){sandboxStart();return;}if(a==='sandbox-pause'){if(state.sandbox?.phase==='battle'){state.paused=!state.paused;render();}return;}if(a==='sandbox-step'){if(state.sandbox?.battle){state.sandbox.battle.step();render();}return;}if(a==='sandbox-clear-enemies'){if(state.sandbox){state.sandbox.enemyDrafts=[];if(state.sandbox.battle)state.sandbox.battle.s.enemies=[];render();}return;}if(a==='sandbox-fill-sp'){const sb=state.sandbox,u=sb?.battle?.s.units.find(v=>v.uid===uid);if(u){u.sp=sb.battle.spCost(u);render();}return;}if(a==='sandbox-skill'){const sb=state.sandbox,u=sb?.battle?.s.units.find(v=>v.uid===uid);if(u){if(u.skillLeft>0||u.ammo>0)sb.battle.deactivate(u);else{u.sp=sb.battle.spCost(u);sb.battle.activate(u);}render();}return;}
 if(a==='field-info'){const banCount=g?.bannedOperatorList?.().length||0,banBonds=g?.s?.bondBan?.bonds?.length||0;modal(`<h2>战况 / 设置</h2>${document.querySelector('.native-detail').innerHTML.replace(/ id="[^"]*"/g,'')}${document.querySelector('.native-terrain-legend').outerHTML}${banBonds?`<button class="native-ban-entry" data-act="ban-list">禁用名单（${banCount} 名 · 缺席 ${banBonds} 盟约）</button>`:''}<label>音量 <input data-native-volume aria-label="战斗音量" type="range" min="0" max="1" step="0.05" value="${state.volume}"></label><p><button data-act="limits">已知差异</button> <button data-act="branches">分支规则</button> <button data-act="export">导出存档</button></p>`);fitWaveFaces();return;}
  if(a==='prepare'){const p=prepState();p.skills={...loadPrepSkills(data)};
   state.view='prepare';state.modal=null;p.scroll=0;if(typeof window.scrollTo==='function')window.scrollTo(0,0);render();return;}
  if(a==='prep-tab'){const p=prepState();p.tab=button.dataset.tab==='equipment'?'equipment':'operator';p.scroll=window.scrollY||0;render();return;}
  // 特殊标记【S.E.E.S.】：本地解锁状态控制策略与资料可见性；本局卡池资格仍由当前策略判定。
  if(a==='prep-flags-sees'){const archive=archiveNow(),next=saveArchive(archiveStorage(),{...archive,flags:{...archive.flags,sees:!archive.flags.sees}});state.archive=next;/* 关掉标记后这一局就不能再选 S.E.E.S. 了：把草稿与已选策略一并回落到可见的那一个。 */if(isSeesBand(state.strategyDraft))state.strategyDraft=null;state.band=guardedBandId();notice(`特殊标记【S.E.E.S.】已${next.flags.sees?'打开':'关闭'}（策略和资料可见性已更新）。`);if(state.view==='lobby'){modal(renderArchiveWindow(next,esc));return;}render();return;}
  if(a==='prep-skill'){const p=prepState(),charId=button.dataset.char,index=Number(button.dataset.index),row=prepOperatorRow(data,charId);if(!row?.choices.some(choice=>choice.index===index))return;const skills={...p.skills};if(index===row.archive)delete skills[charId];else skills[charId]=index;p.skills=savePrepSkills(skills,data);p.scroll=window.scrollY||0;updatePrepCard(charId);return;}
  // 阶级是「点一下筛、再点一下取消」：只有 1–6 六个数字按钮，不额外占一行「全部」。
  if(a==='prep-tier'){const p=prepState(),tier=Number(button.dataset.tier)||0;p.tier=p.tier===tier?0:tier;p.scroll=window.scrollY||0;render();return;}
  if(a==='prep-reset-all'){const p=prepState();p.skills=savePrepSkills({},data);p.scroll=window.scrollY||0;notice('全部干员已恢复档案默认技能。');render();return;}
 if(a==='editor'){state.view='editor';state.editor.sample=null;state.waveTable=loadWaveTable();render();return;}
 // 大厅提示的「恢复默认配置」：敌人池与禁用方案一起回到默认（正在进行的对局不受影响，改动从下一局生效）。
 if(a==='pool-defaults'){
  state.waveTable=saveWaveTable(normalizeWaveTable(defaultWaveTable()));
  resetBondBan(data);
  if(state.editor){state.editor.bondBan=null;state.editor.sample=null;state.editor.template=0;}
  notice('已恢复默认敌人池与禁用配置。');render();return;
 }
 if(a.startsWith('ed-')){
  const catalog=document.getElementById('ed-catalog');state.editor.scroll=catalog?.scrollTop||0;
  const result=applyEditorAction(a,button.dataset,state.waveTable,state.editor,data);
  if(result==='export'){const url=URL.createObjectURL(new Blob([JSON.stringify(state.waveTable,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='garrison-wave-table.json';link.click();URL.revokeObjectURL(url);return;}
  if(result==='import'){const input=document.createElement('input');input.type='file';input.accept='.json';input.onchange=async()=>{try{state.waveTable=saveWaveTable(normalizeWaveTable(JSON.parse(await input.files[0].text())));state.editor.sample=null;state.editor.template=0;notice('已导入波次表');render();}catch(e){notice(e.message||'无法读取波次表');}};input.click();return;}
  if(result==='bond-export'){const url=URL.createObjectURL(new Blob([JSON.stringify(state.editor.bondBan||loadBondBan(data),null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='garrison-bond-ban.json';link.click();URL.revokeObjectURL(url);return;}
  if(result==='bond-import'){const input=document.createElement('input');input.type='file';input.accept='.json';input.onchange=async()=>{try{state.editor.bondBan=saveBondBan(JSON.parse(await input.files[0].text()),data);notice('已导入禁用方案');render();}catch(e){notice(e.message||'无法读取禁用方案');}};input.click();return;}
  if(result==='filled')notice('已补入基础活动中已准入、符合词条与难度限制的敌人，保留现有混编。');
  if(result==='choose-activity')notice('请先选择模板活动，或在档案中筛选一个活动。');
  if(result==='incompatible')notice('只能加入逻辑已准入的敌人。');
  if(result==='defaults')notice('已恢复内置默认配置，下一次生成波次时生效。');
  if(result==='reset')notice('已清空全部词条池和自定义难度。');
  if(result)render();if(a==='ed-close-test')root.querySelector('.wave-ed-current [data-act=ed-roll]')?.focus();return;
 }
  if(a==='strategy-select'&&state.view==='briefing'){state.strategyDraft=null;state.view='strategy-select';render();return;}if(a==='strategy-pick'&&state.view==='strategy-select'){const catalog=document.querySelector('.native-strategy-catalog'),scrollHost=catalog?.scrollHeight>catalog?.clientHeight?catalog:catalog?.closest('.native-lobby'),scroll=scrollHost?.scrollTop||0,id=button.dataset.id;if(state.strategyDraft===id){state.band=id;state.strategyDraft=null;state.view='briefing';render();return;}state.strategyDraft=id;render();const next=document.querySelector('.native-strategy-catalog'),nextHost=next?.scrollHeight>next?.clientHeight?next:next?.closest('.native-lobby');if(nextHost)nextHost.scrollTop=scroll;return;}if(a==='strategy-cancel'&&state.view==='strategy-select'){state.strategyDraft=null;state.view='briefing';render();return;}
 if(a==='new'){const egg=state.mode===EGG_MODE_ID,cat=state.mode===CAT_MODE_ID,modeId=egg?EGG_BASE_MODE:cat?CAT_BASE_MODE:state.mode,seed=(Date.now()&0xffffffff)>>>0;const banConfig=loadBondBan(data),mapId=resolveMapId(data,state.map,waveRng((seed^0x9e3779b9)>>>0),modeId);state.draft={modeId,mapId,seed,finalBossId:rollFinalBoss(data,modeId,seed),roster:createWaveRoster({random:waveRng(seed),data,modeId}),bondBan:{bonds:bondBanIds(data,seed,banConfig),always:banConfig.always,never:banConfig.never},egg325:egg,cat};state.bondBanBlocks=0;state.view='briefing';state.strategyDraft=null;state.modal=null;render();return;}
 if(a==='begin'){state.lastChoiceContent=null;enterPlayChrome();state.supplyCollapsed=false;if(!state.draft){state.view='lobby';leavePlayChrome();render();return;}try{state.game=new NativeSession(data,{modeId:state.draft.modeId,bandId:guardedBandId(),mapId:state.draft.mapId,seed:state.draft.seed,waveRoster:state.draft.roster,bondBan:state.draft.bondBan,egg325:!!state.draft.egg325,cat:!!state.draft.cat,finalBossId:state.draft.finalBossId,finalBossHpMultiplier:state.waveTable?.finalBossHpMultiplier??DEFAULT_FINAL_BOSS_HP_MULTIPLIER});state.view='game';state.draft=null;state.paused=false;state.expiresAt=null;state.resultUnitUid=null;state.selected=state.summonSelected=state.item=state.inspect=state.preview=state.modal=null;save();saveCheckpoint();render();}catch(e){notice(e.message);}return;}
 if(a==='resume'){if(state.expiresAt&&Date.now()>=state.expiresAt){notice('暂离已超过24小时，请开始新模拟');return;}enterPlayChrome();state.expiresAt=null;state.view='game';render();return;}if(a==='home'){dismissRoundEnd();if(state.view==='editor'||state.view==='briefing'||state.view==='prepare'){state.view='lobby';leavePlayChrome();render();return;}state.view='lobby';state.paused=true;state.expiresAt??=Date.now()+86400000;state.modal=null;save();leavePlayChrome();render();return;}if(a==='result'){showResult();return;}
 // 导出存档（用户 2026-09-27 需求）：大厅与对局顶栏共用一个入口。
 // 有对局时导出的是**原来的对局存档**（多带一份战绩档案，NativeSession.restore 会忽略额外字段），
 // 没有对局时只导出战绩档案；两种都能被下面的导入功能读回来。
 if(a==='export'){const archive=archiveWithPrepSkills(archiveNow()),record=exportRecord(g||null,archive,{expiresAt:g?state.expiresAt:null}),stamp=new Date().toISOString().slice(0,19).replace(/[:T]/g,'-'),url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='garrison-save-'+stamp+'.json';link.click();URL.revokeObjectURL(url);notice(g?`已导出对局存档＋战绩档案（${archive.runs.length} 场）。`:`已导出战绩档案（${archive.runs.length} 场，当前没有进行中的对局）。`);return;}
 if(a==='import'){const input=document.createElement('input');input.type='file';input.accept='.json';input.onchange=async()=>{try{if(input.files[0].size>10e6)throw Error('存档文件过大');const record=JSON.parse(await input.files[0].text()),incoming=archiveFromRecord(record);let game=null;if(record&&record.s){game=NativeSession.restore(data,record);if(!game)throw Error('存档版本、数据或有效期不匹配');}if(!game&&!incoming)throw Error('这个 JSON 既不是对局存档，也没有战绩档案');
  // 档案与对局存档分开合并：同 id 的场次以导入的为准，其余按时间合并，最多留 10 场。
  // 技能覆盖实际使用独立的 localStorage 键；导入档案时也写回那里，才能影响战前准备与新局。
  const mergedRaw=incoming?mergeArchives(archiveWithPrepSkills(archiveNow()),record.archive):null;
  if(mergedRaw)mergedRaw.prepSkills=savePrepSkills(mergedRaw.prepSkills,data);
  const merged=mergedRaw?saveArchive(archiveStorage(),mergedRaw):null;state.archive=merged;
  if(game){state.game=game;state.view='game';state.paused=true;save();saveCheckpoint();enterPlayChrome();notice(merged?`已恢复对局，并导入战绩档案（${merged.runs.length} 场）。`:'已恢复对局。');}else{state.view='lobby';leavePlayChrome();notice(`已导入战绩档案 ${merged.runs.length} 场（文件里没有对局存档）。`);}
  render();}catch(e){notice(e.message);}};input.click();return;}
 if(!g)return;
 if(a==='pause'){state.paused=!state.paused;render();return;}if(a==='speed'){state.speed=Number(button.dataset.speed);render();return;}
 if(a==='mute'){state.muted=!state.muted;savePreference('garrison-mute',state.muted?'1':'0');if(!state.muted)unlockAudio();render();return;}
 if(a==='reduce-fx'){state.reduceFx=!state.reduceFx;savePreference('garrison-reduce-fx',state.reduceFx?'1':'0');render();return;}
 if(a==='inspect-close'){state.inspect=null;render();return;}
 if(a==='summon-select'){state.summonSelected=uid;state.selected=null;state.item=null;state.inspect={kind:'summon-card',uid};state.preview=null;render();return;}
 if(a==='select'){if(state.item)equipItemOnUnit(uid);state.quickSell=null;if(g?.s?.phase==='prep'&&!state.sandbox){const image=button.querySelector?.('img'),target=image||button,rect=target.getBoundingClientRect?.();if(rect)state.quickSell={uid,x:rect.left+rect.width/2,y:rect.top-3};else if(anchor)state.quickSell={uid,x:anchor.x,y:anchor.y-22};}state.summonSelected=null;state.selected=uid;state.inspect={kind:'unit',uid};state.preview=null;save();render();return;}
 if(a==='item'){state.summonSelected=null;if(inspectSame('pack',uid)){state.item=uid;notice('点击一名场上或整备区干员以装备／使用。');}else{state.item=null;state.selected=null;state.inspect={kind:'pack',uid};}render();return;}
 if(a==='equip-inspect'){state.item=null;state.selected=null;state.inspect={kind:'equip',uid,slot:Number(button.dataset.slot)};render();return;}
 if(a==='inspect-back'){state.inspect={kind:'unit',uid};render();return;}
 if(a==='replace'){g.perform('equip',state.item,uid,Number(button.dataset.slot));state.item=null;state.modal=null;save();render();return;}
 if(a==='stockview'){modal(stockPanel());return;}
 if(a==='destroy'||a==='destroyEquip'){const slot=Number(button.dataset.slot),fromEquip=state.inspect?.kind==='equip',name=itemName(a==='destroy'?g.s.items.find(i=>i.uid===uid)?.chessId:g.s.units.find(u=>u.uid===uid)?.equipment?.[slot]?.chessId);if(!g.perform(a,uid,slot)){notice('当前阶段无法销毁装备。');return;}if(state.item===uid)state.item=null;state.inspect=fromEquip?{kind:'unit',uid}:null;notice('已销毁 '+name+'。');save();render();return;}
 if(a==='bond-info'){modal(bondModalHtml(button.dataset.id),{bond:button.dataset.id});return;}if(a==='aim'){if(state.preview){state.preview.dir=Number(button.dataset.dir);draw();}return;}if(a==='cancel'){state.preview=null;render();return;}if(a==='place-confirm'){commitPreview();return;}
 let ok;const handWasFull=g.handFull();if(a==='buy'||a==='buyItem'){const kind=a==='buy'?'shop':'shopItem',index=Number(button.dataset.index);if(!inspectSame(kind,index)){state.inspect={kind,index};state.selected=null;state.item=null;render();return;}if(g.s.phase!=='prep'){notice('当前阶段不能购买');return;}ok=g.perform(a,index);if(ok){state.inspect=null;if(a==='buy')state.selected=g.s.units.at(-1)?.uid??null;}}else if(a==='reward'){const reward=g.s.rewardPending,index=Number(button.dataset.index),id=reward?.tier?reward.offers?.[index]:button.dataset.id;if(reward?.tier&&!inspectSame('reward',index)){state.inspect={kind:'reward',index};state.selected=null;state.item=null;render();return;}ok=id?g.perform(reward?.kind==='bounty'?'bounty':'takePromotion',id):false;if(ok&&reward?.kind==='bounty')saveCheckpoint();state.modal=null;if(ok)state.inspect=null;}else if(a==='decision'){ok=g.perform(a,button.dataset.id);state.modal=null;}else if(a==='sell'){state.quickSell=null;ok=g.perform(a,uid);if(ok){state.selected=null;state.inspect=null;}}else if(a==='withdraw'||a==='mineCommand'){ok=g.perform(a,uid);}else if(['upgrade','refresh','lock','start','next'].includes(a)){ok=g.perform(a);if(a==='start'){state.paused=false;resetFxClock();unlockAudio();attachZoneVisual(g.battle);}state.preview=null;if(a==='refresh')state.inspect=null;}else return;
 if(!ok)notice(handWasFull&&(a==='buy'||a==='buyItem')?'整备区已满：先部署、出售或装备清出空余，才能购入干员／装备':g.lastError||'当前资金、位置或阶段不允许此操作');if(ok&&(a==='next'||a==='decision'))saveCheckpoint();save();render();if(ok&&a==='start'&&state.onlineRun&&g.s.runResult?.kind==='online-boss-skipped'){state.onlineRun.waitingForServer='boss';onlineClient?.skipBoss(g.s.round);coopWaitModal('联机对局结束中','已到 Boss 阶段，本局按联机 MVP 规则直接结束。');}else if(g.s.phase==='finished'&&!state.onlineRun)showResult();
}
function handCards(game){if(game.s.phase==='prep')game.syncSummonCards?.();return game.syncHandSlots?.()||game.hand();}
function handCardKind(game,card){return game.s.units.includes(card)?'operator':game.s.items.includes(card)?'item':'summon-card';}
function handCardHtml(game,card){const kind=handCardKind(game,card),slot=card.handSlot;if(kind==='operator')return `<button data-act="select" data-uid="${card.uid}" data-hand-card="true" class="native-hand-card${data.profiles[card.chessId].isGolden?' is-elite':''}${state.selected===card.uid||inspectSame('unit',card.uid)?' chosen':''}" aria-label="${esc(data.profiles[card.chessId].name)}，手牌格 ${slot+1}">${avatar(card.charId)}<b>${esc(data.profiles[card.chessId].name)}</b>${data.profiles[card.chessId].isGolden?'<small>精锐</small>':''}</button>`;if(kind==='item')return `<div role="button" tabindex="0" data-act="item" data-uid="${card.uid}" data-hand-card="true" class="native-hand-card${state.item===card.uid||inspectSame('pack',card.uid)?' chosen':''}" aria-label="${esc(itemName(card.chessId))}，手牌格 ${slot+1}">${itemIcon(card.chessId)}<b>${esc(itemName(card.chessId))}</b></div>`;const hint=card.mode==='skill'?'技能转好后自动出现':card.mode==='auto'?'开战时自动出现':'可拖动放置并选择朝向';return `<button data-act="summon-select" data-uid="${card.uid}" data-mode="${card.mode||'manual'}" data-placeable="${String(!!card.placeable)}" data-hand-card="true" class="native-hand-card native-summon-card${state.summonSelected===card.uid?' chosen':''}"${card.mode!=='manual'&&!card.placeable?' disabled':''} aria-label="${esc(card.name)}，手牌格 ${slot+1}"><span class="native-summon-icon">◈</span><b>${esc(card.name)}</b><small>${hint}</small></button>`;}
function handView(game){const cards=handCards(game),signature=cards.map(card=>`${handCardKind(game,card)}:${card.uid}@${card.handSlot}`).join('|');if(game.s.phase!=='prep')return {signature,html:cards.map(card=>handCardHtml(game,card)).join('')};const bySlot=new Map(cards.map(card=>[card.handSlot,card])),slot=(index,overflow=false)=>{const card=bySlot.get(index);return `<div class="native-hand-slot${overflow?' is-overflow-slot':''}${card?'':' is-empty'}" data-hand-slot="${index}" aria-label="${overflow?'临时超额':'手牌'}${card?'':'空位'} ${overflow?index-HAND_LIMIT+1:index+1}">${card?handCardHtml(game,card):`<span>${overflow?'+':String(index+1).padStart(2,'0')}</span>`}</div>`;},overflowMax=cards.reduce((max,card)=>Math.max(max,card.handSlot),HAND_LIMIT-1),temporary=overflowMax>=HAND_LIMIT?`<span class="native-hand-overflow-divider" aria-hidden="true">临时</span>${Array.from({length:overflowMax-HAND_LIMIT+1},(_,i)=>slot(HAND_LIMIT+i,true)).join('')}`:'';return {signature,html:Array.from({length:HAND_LIMIT},(_,i)=>slot(i)).join('')+temporary};}
function syncHandScrollControls(){const bench=document.getElementById('native-hand');if(!bench)return;let controls=root.querySelector('.native-hand-scroll-controls');if(!controls){bench.insertAdjacentHTML('afterend','<div class="native-hand-scroll-controls" role="group" aria-label="横向翻动手牌" hidden><button type="button" data-act="hand-scroll" data-direction="-1" aria-label="向左翻动手牌" aria-controls="native-hand">‹</button><button type="button" data-act="hand-scroll" data-direction="1" aria-label="向右翻动手牌" aria-controls="native-hand">›</button></div>');controls=root.querySelector('.native-hand-scroll-controls');}const visible=(mobilePlay()||document.documentElement.classList.contains('native-landscape-ui'))&&!state.sandbox&&bench.scrollWidth>bench.clientWidth+1;controls.hidden=!visible;bench.classList.toggle('has-scroll-arrows',visible);if(visible){controls.querySelector('[data-direction="-1"]').disabled=bench.scrollLeft<=1;controls.querySelector('[data-direction="1"]').disabled=bench.scrollLeft+bench.clientWidth>=bench.scrollWidth-1;}}
function scrollHandByHalfSlot(direction){const bench=document.getElementById('native-hand');if(!bench)return;const item=bench.querySelector('.native-hand-slot,.native-hand-card'),gap=parseFloat(getComputedStyle(bench).gap)||0,step=(item?.getBoundingClientRect().width||62)+gap,behavior=matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth';bench.scrollBy({left:(Number(direction)<0?-1:1)*step/2,behavior});}
function renderSummonCards(){const game=state.game,bench=document.getElementById('native-hand');if(!game||!bench)return;const view=handView(game);if(!drag&&bench.dataset.layout!==view.signature){bench.innerHTML=view.html;bench.dataset.layout=view.signature;}syncHandScrollControls();}
// ── 回合结束演出 ────────────────────────────────────────────────────────────
// 暗屏 + 拉出横幅「波次结束 / WAVE END」→ 停留 1 秒 → 收横幅 → 「损失生命」从 0 快速累加到位。
// 纯表现层：只读 s.lastBattle（loss = 上限后的真实扣血，leaks = 真值），不写任何战斗状态，
// 也不参与索敌/结算。减动效开关下退化为「横幅瞬现 + 短停留」。
function roundEndInfo(g){
 const last=g.s.lastBattle||{},loss=Math.max(0,Math.min(ROUND_LEAK_CAP,Number(last.loss)||0)),leaks=Math.max(0,Number(last.leaks)||0),gameOver=g.s.phase==='finished'||g.s.hp<=0;
 return {loss,leaks,gameOver,bountyEarned:g.battle?.s.bountyEarned||0,hp:Math.max(0,g.s.hp),maxHp:g.s.maxHp,danger:gameOver||loss>=ROUND_LEAK_CAP};
}
function roundEndStage(next){
 const r=state.roundEnd;if(!r||!r.node.isConnected)return;
 r.stage=next;r.node.dataset.stage=next;
 if(next!=='count')return;
 r.countStart=performance.now();
 if(r.info.gameOver)r.timer=setTimeout(()=>{if(state.roundEnd===r&&r.node.isConnected)showResult();},1000);
}
function roundEndBegin(g){
 if(state.roundEnd?.timer)clearTimeout(state.roundEnd.timer);
 const reduce=!!state.reduceFx,info=roundEndInfo(g),node=document.createElement('div');
 node.className='native-round-end';node.dataset.stage='wave';node.dataset.tone=info.danger?'danger':info.loss?'normal':'perfect';
 if(reduce)node.dataset.reduce='1';
 node.setAttribute('role','dialog');node.setAttribute('aria-label','波次结束');
 node.innerHTML=`<div class="native-round-end-dim"></div><div class="native-round-end-banner"><div class="native-round-end-wave"><b>波次结束</b><em>WAVE END</em></div><div class="native-round-end-body"><p class="native-round-end-round">第 ${g.s.round} 回合</p>${info.loss?`<p class="native-round-end-label">损失生命</p><strong class="native-round-end-value">0</strong>`:'<p class="native-round-end-perfect">完美通关</p>'}<p class="native-round-end-hp">剩余生命 ${info.hp} / ${info.maxHp}${info.leaks?` · 漏失 ${info.leaks}`:''}</p>${info.bountyEarned?`<p class="native-round-end-hp">悬赏奖金 +${info.bountyEarned} ◆ · 下轮到账</p>`:''}<div class="native-round-end-actions"><button class="native-primary" data-act="${info.gameOver?'result':'next'}">${info.gameOver?'查看伤害报告':'进入下一回合 →'}</button>${info.gameOver?'<button data-act="home">回到大厅</button>':''}</div></div></div>`;
 root.append(node);
 state.roundEnd={node,info,stage:'wave',count:0,countStart:0,timer:0};
 const hold=reduce?260:1000,out=reduce?20:340;
 state.roundEnd.timer=setTimeout(()=>{const r=state.roundEnd;if(!r||r.node!==node)return;roundEndStage('out');r.timer=setTimeout(()=>{if(state.roundEnd===r)roundEndStage('count');},out);},hold);
}
function roundEndTick(now){
 const r=state.roundEnd;if(!r)return;
 if(!r.node.isConnected){state.roundEnd=null;return;}
 if(r.stage!=='count'||!r.info.loss)return;
 const value=Math.round(r.info.loss*(1-Math.pow(1-Math.min(1,(now-r.countStart)/650),3)));
 if(value===r.count)return;
 r.count=value;const el=r.node.querySelector('.native-round-end-value');if(el)el.textContent=String(value);
}
// 收掉「波次结束」演出层。它挂在 root 上、并带着一枚「游戏结束 1 秒后自动弹作战报告」的定时器，
// 所以回大厅必须连定时器一起清掉：只让 render() 擦掉节点的话，那枚定时器还会把报告弹到大厅上面。
function dismissRoundEnd(){const r=state.roundEnd;if(!r)return false;if(r.timer)clearTimeout(r.timer);state.roundEnd=null;r.node.remove();return true;}
// 战斗中计数器：贴在场景窗体的标题行里（`.native-field-caption` 的最后一个子元素，靠右），
// 左=当前回合，中=击杀敌人/当轮敌人总数（衍生敌人不计击杀数），右=剩余生命值。
// 数值由 `updateHud()` 每 0.2 秒刷新；口径走 `protocol.battleTally`，别在这里另写一套。
function battleBar(){
 return `<div class="native-battle-bar" id="native-battle-bar" aria-label="战斗态势">`
 +`<span class="native-bb-seg"><em>回合</em><b id="native-bb-round">—</b></span>`
 +`<span class="native-bb-seg native-bb-core"><svg class="native-bb-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6 19.6 5.7v6c0 4.4-3 8.2-7.6 9.7-4.6-1.5-7.6-5.3-7.6-9.7v-6z"/><path d="M12 6.9v9.3M7.8 11.6h8.4"/></svg><b id="native-bb-kills">0</b><i class="native-bb-slash">/</i><b id="native-bb-total" class="native-bb-accent">0</b></span>`
 +`<span class="native-bb-seg"><svg class="native-bb-icon native-bb-icon-hp" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 20.5V9.5h11v11z"/><path d="M6.5 9.5V6h3v2h2.5V6h3v2h3v1.5M9.5 20.5v-4.6h5v4.6"/></svg><b id="native-bb-hp">0</b></span>`
 +`</div>`;
}
function updateHud(){const g=state.game;if(!g||state.view!=='game')return;renderSummonCards();const b=g.battle?.s,rounds=buildPhasePlan(data,g.s.modeId).filter(r=>!r.isConditional).length,status=document.getElementById('native-status'),tally=b?battleTally(b):null;
 if(status){const time=b&&g.s.phase==='battle'?`<div><small>剩余时间</small><b>${Math.max(0,Math.ceil(b.limit-b.time))}<i> 秒</i></b></div><div><small>剩余资金</small>${fundsMarkup(g.s.funds)}</div>`:`<div><small>剩余资金</small>${fundsMarkup(g.s.funds)}</div>`;
  const wave=b&&g.s.phase==='battle'?`<div><small>波次</small><b>${tally.kills}<i> / ${b.total}</i></b></div>`:`<div><small>回合</small><b>${g.s.round}<i>/${rounds}</i></b></div>`;
  status.innerHTML=`<div><small>生命</small><b class="hp">${g.s.hp}<i>/${g.s.maxHp}</i></b></div>${time}${wave}`;}
  const bar=document.getElementById('native-battle-bar');
  if(bar){const set=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=String(value);};
   set('native-bb-round',g.s.round);set('native-bb-kills',tally?tally.kills:0);set('native-bb-total',tally?tally.total:0);set('native-bb-hp',g.s.hp);}
 const cost=document.getElementById('native-cost-balance');if(cost){const active=b&&g.s.phase!=='prep',value=active?Number(b.cost):NaN;cost.textContent=Number.isFinite(value)?String(Math.round(value*10)/10):'—';cost.parentElement.title=active?'战斗费用余额，与商店资金独立':'待开战：战斗开始后显示实时费用';cost.classList.toggle('is-debt',Number.isFinite(value)&&value<0);}
 const progress=document.getElementById('native-wave-progress');if(progress)progress.textContent=g.s.phase==='battle'&&b?`漏失 ${b.leaks}`:`${deployCount(g.s)} / ${g.s.capacity} 部署`;
 const live=document.getElementById('native-unit-live'),unit=g.battle?.s.units.find(u=>u.uid===state.selected);if(live){if(unit&&g.s.phase==='battle'){const sk=profile(unit)?.skill,cost=g.battle.spCost(unit),fill=spBarFill(unit,sk,cost),cap=cost*Math.max(1,sk?.spData?.maxChargeTime||1),skillState=fill?.kind==='duration'?unit.skillLeft>1e6?'技能持续中':`技能持续 ${Math.ceil(unit.skillLeft)}s`:fill?.ammo?`弹药 ${fill.ammo.current}/${fill.ammo.max}`:fill?.ready?'技能就绪':fill?`技力 ${Math.floor(unit.sp||0)}/${cap}`:sk?.skillType==='PASSIVE'?'被动技能':'无技力条',progress=fill?.ammo?fill.ammo.current/fill.ammo.max:fill?.ratio??0,meter=fill?`<progress class="native-unit-sp-meter${fill.kind==='duration'?' is-active':''}" max="1" value="${Math.max(0,Math.min(1,progress))}" aria-label="${skillState}"></progress>`:'';live.innerHTML=`<span>当前生命 ${Math.round(unit.hp)}/${Math.round(unit.maxHp)} · 治疗 ${Math.round(unit.healing||0)} · 持续回复 ${Math.round(unit.regeneration||0)} · ${skillState}</span>${meter}`;}else live.textContent='';}
 const dossierHp=document.getElementById('native-dossier-hp');if(dossierHp&&state.inspect?.kind==='unit'){const seen=g.battle?.s.units.find(u=>u.uid===state.inspect.uid),row=g.s.units.find(u=>u.uid===state.inspect.uid);if(row){const a=seen&&g.battle?g.battle.stats(seen):profile(row).attributes,hp=Math.round(seen?.hp??a.maxHp),max=Math.round(seen?.maxHp??a.maxHp);dossierHp.innerHTML=`生命 <b>${hp}</b><i>/${max}</i>`;}}
 const dossierStats=document.querySelector('.native-dossier-stats');if(dossierStats&&state.inspect?.kind==='unit'){const seen=g.battle?.s.units.find(u=>u.uid===state.inspect.uid),row=g.s.units.find(u=>u.uid===state.inspect.uid);if(row){const a=seen&&g.battle?g.battle.stats(seen):profile(row).attributes;dossierStats.innerHTML=`<span>攻击 ${Math.round(a.atk)}</span><span>防御 ${Math.round(a.def)}</span><span>法抗 ${Math.round(a.magicResistance)}</span><span>攻速 ${Math.round(a.attackSpeed)}</span>`;}}
 if(dossierHp&&state.inspect?.kind==='summon'){const actor=g.battle?.s.summons.find(s=>s.uid===state.inspect.uid);if(actor)dossierHp.innerHTML=`生命 <b>${Math.round(actor.hp)}</b><i>/${Math.round(actor.maxHp)}</i>`;}
 const mineControls=document.getElementById('native-mine-camp-controls');if(mineControls&&state.inspect?.kind==='summon'){const camp=g.battle?.s.summons.find(s=>s.uid===state.inspect.uid);if(camp?.type==='mine-camp')mineControls.innerHTML=mineCampControls(camp);}
 const dossierLive=document.getElementById('native-dossier-live');if(dossierLive&&state.inspect?.kind==='unit'){const seen=g.battle?.s.units.find(u=>u.uid===state.inspect.uid),row=g.s.units.find(u=>u.uid===state.inspect.uid);if(row){const a=seen&&g.battle?g.battle.stats(seen):profile(row).attributes,p=profile(row),fill=seen&&g.battle?spBarFill(seen,p.skill,g.battle.spCost(seen)):null,phase=seen?(seen.dollForm?`替身 ${Math.max(0,seen.dollForm.until-(g.battle?.s.time||0)).toFixed(1)}s`:seen.ammo>0?`弹药 ${seen.ammo}/${seen.ammoMax}`:seen.skillLeft>0?`技能持续 ${seen.skillLeft.toFixed(1)}s`:seen.down>0?`再部署 ${Math.ceil(seen.down)}s`:fill?.ready?'技力就绪':'待机'):'';dossierLive.innerHTML=`<p>阶段 ${esc(phase)}</p><p>状态 ${esc((seen?.statuses||[]).map(s=>s.kind).join('、')||'无')}</p><h3>属性来源</h3><p>${(a.parts||[]).map(x=>`${esc(x.src)} ${x.stat} ${x.layer} ${x.v}`).join('<br>')||'无额外加成'}</p>`;}}
 const el=document.getElementById('native-combat-stats');if(el&&g.battle&&g.s.phase==='battle'){const btl=g.battle.s,total=Object.values(btl.damage).reduce((n,v)=>n+v,0);el.innerHTML=`<h3>${Math.max(0,Math.ceil(btl.limit-btl.time))} 秒</h3><p>伤害 ${Math.round(total).toLocaleString()}<br>击倒 ${tally.kills} / ${btl.total}<br>漏失 ${btl.leaks}</p>`;}
 updateBondLive();
 if(!painting&&eggOn())for(const node of [status,cost,progress,live,dossierHp,dossierStats,dossierLive,el])apply325Display(node);
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
function handSlotAt(x,y){const slot=document.elementFromPoint(x,y)?.closest?.('.native-hand-slot[data-hand-slot]');return slot&&root.contains(slot)?Number(slot.dataset.handSlot):null;}
function moveHandCardToSlot(kind,uid,target){const game=state.game;if(!game||game.s.phase!=='prep'||!Number.isSafeInteger(target)||target<0)return false;const cards=game.syncHandSlots(),card=cards.find(item=>item.uid===uid&&handCardKind(game,item)===kind);if(!card||target>=HAND_LIMIT&&card.handSlot<HAND_LIMIT)return false;const occupant=cards.find(item=>item.handSlot===target),source=card.handSlot;if(card===occupant)return true;card.handSlot=target;if(occupant)occupant.handSlot=source;game.syncHandSlots();return true;}
function overShop(x,y){const shop=document.getElementById('native-supply-shop');if(!shop||!shop.offsetParent)return false;return insideRect(shop.getBoundingClientRect(),x,y);}
function overUnitCard(x,y){const el=document.elementFromPoint(x,y)?.closest?.('[data-act="select"]');if(!el)return null;const uid=Number(el.dataset.uid);return state.game?.s.units.find(u=>u.uid===uid)||null;}
// 装备落点也包含棋盘上已部署的干员（召唤物与召唤卡不算）
function equipDropTarget(x,y){const u=overUnitCard(x,y);if(u)return u;if(!overCanvas(x,y))return null;const hit=unitAtPointer(x,y);if(!hit||hit.kind||hit.summon||hit.summonCard)return null;return state.game?.s.units.find(v=>v.uid===hit.uid)||null;}
// 装备到干员（点击流程与拖放流程共用）。槽位已满时弹出摧毁选择。
function sameBondRecruitItem(game,itemUid){const item=game?.s?.items?.find(i=>i.uid===itemUid),def=game?.data?.season?.trapChessDataDict?.[item?.chessId];return (game?.data?.season?.effectBuffInfoDataDict?.[def?.effectId]||[]).some(e=>e.key==='use_equip_reward_char_chess_with_same_bond');}
function equipItemOnUnit(uid,itemUid=state.item){const g=state.game;if(!itemUid||!g.s.items.some(i=>i.uid===itemUid)){notice('先从整备区选择一件装备。');return false;}const sameBondRecruit=sameBondRecruitItem(g,itemUid),gainStart=g.s.events.length,previousError=g.lastError;if(!g.perform('equip',itemUid,uid)){const u=g.s.units.find(x=>x.uid===uid);if(u?.equipment.length>=2&&!sameBondRecruit){state.item=itemUid;modal(`<h2>选择替换的装备</h2><p>装备槽已满，请选择要摧毁的一件。</p>${u.equipment.map((e,i)=>`<button class="native-replace-item" data-act="replace" data-uid="${uid}" data-slot="${i}">${itemIcon(e.chessId)}${esc(itemName(e.chessId))}</button>`).join('')}`);return false;}notice(g.lastError&&g.lastError!==previousError?g.lastError:'当前阶段无法装备该道具。');return false;}state.item=null;if(sameBondRecruit){const counts=new Map();for(const event of g.s.events.slice(gainStart))if(event.type==='gain'){const name=data.profiles[event.chessId]?.name||event.chessId;counts.set(name,(counts.get(name)||0)+1);}const rewards=[...counts].map(([name,count])=>count>1?`${name} ×${count}`:name).join('、');notice(rewards?`通讯机招募：${rewards}；干员获得时效果已触发。`:'通讯机已使用，但没有新干员获得记录。');}else notice('已装备。');return true;}
function tileLift(tile,z){return tileLiftAmount(tile,z.th);}
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
  const bench=root.querySelector('.native-bench'),hint=document.getElementById('native-drop-hint'),over=drag?.moved&&drag.from==='field'&&overBench(drag.x,drag.y),full=state.game?.handFull?.()??false,reorder=drag?.moved&&drag.from==='hand'?handSlotAt(drag.x,drag.y):null;
  bench?.classList.toggle('drop-target',!!over&&!full);bench?.classList.toggle('drop-blocked',!!over&&full);for(const slot of root.querySelectorAll('.native-hand-slot'))slot.classList.toggle('drop-slot',Number(slot.dataset.handSlot)===reorder);const shop=document.getElementById('native-supply-shop');const overShopNow=drag?.moved&&drag.kind==='operator'&&overShop(drag.x,drag.y);if(shop)shop.classList.toggle('drop-target',!!overShopNow);const itemDrag=drag?.moved&&drag.kind==='item';const hoverUnit=itemDrag?equipDropTarget(drag.x,drag.y):null;for(const card of root.querySelectorAll('.native-bench [data-act="select"]')){card.classList.toggle('drop-target',!!hoverUnit&&Number(card.dataset.uid)===hoverUnit.uid);}
  const text=reorder!==null?'松手调整手牌位置':over?(full?'整备区已满，无法收回':`松手将${drag?.kind==='summon-card'?'召唤物':'干员'}移回整备区`):'可将场上干员或召唤物拖回此处；换位后重新选朝向';if(hint&&hint.textContent!==text)hint.textContent=text;
  let ghost=document.getElementById('native-drag-ghost');if(!drag?.moved){ghost?.remove();return;}
  if(!ghost){ghost=document.createElement('div');ghost.id='native-drag-ghost';ghost.className='native-drag-ghost';ghost.setAttribute('aria-hidden','true');const u=state.game.s.units.find(u=>u.uid===drag.uid),card=state.game.s.summonCards?.find(c=>c.uid===drag.uid),item=drag.kind==='item'?state.game.s.items.find(i=>i.uid===drag.uid):null;ghost.innerHTML=drag.kind==='summon-card'?`<span class="native-summon-icon">◈</span><b>${esc(card?.name||'召唤物')}</b>`:item?`${itemIcon(item.chessId)}<b>${esc(itemName(item.chessId))}</b>`:u?avatar(u.charId):'';root.append(ghost);}ghost.style.left=(drag.x-28)+'px';ghost.style.top=(drag.y-36)+'px';
}
function clearDrag(){drag=null;canvasPress=null;touchButton=null;dragFeedback();}
// 点击档案以外的地方直接关闭详情（干员档案、商店干员／装备详情）。三种情况不吞这次按压：
// 商店卡片（同卡再点＝确认购买、异卡再点＝切到那件商品）、奖励候选按钮、
// 以及「已经选好装备再点干员」（那一下本来就是要装备）。落在棋盘上的按压仍旧吞掉，
// 否则关掉详情的同时会把干员挪到那一格。
function dismissInspectOnOutsidePress(e){
 const inv=state.inspect;if(!inv)return false;
 if(!['unit','shop','shopItem','pack','equip','summon'].includes(inv.kind))return false;
 if(e.target.closest?.('.native-dossier'))return false;
 if(e.target.closest?.('button[data-act="buy"], button[data-act="buyItem"], [data-act="reward"]'))return false;
 if(state.item&&e.target.closest?.('[data-act="select"]'))return false;
 state.inspect=null;
 if(e.target===canvas||!e.target.closest?.('button[data-act], [role="button"][data-act]')){
  dossierDismissedAt=performance.now();e.preventDefault();render();return true;
 }
 // 按的是别的按钮（顶栏的「已知差异／分支规则／禁用名单」、别的干员卡…）：这一下要留给按钮自己，不能整页重绘
 // （重绘会把按钮节点换掉、click 丢失，等于按了没反应），也**不能设「吞下一次点击」的窗口**（那是给棋盘按压用的，
 // 否则「开着档案点顶栏按钮」会变成关掉档案却什么都没打开）。这里直接把档案节点摘掉：状态已经清了，下次 render 也不会再画。
 root.querySelector('.native-dossier')?.remove();
 return false;
}

// 地块图例：基础项常驻，特殊地块与地图装置按**当前地图真实出现**的补进去（PRTS 战场一览逐图标注）。
function terrainLegend(map){
 const tiles=new Set(),devices=new Set();
 for(let y=0;y<map.rows;y++)for(let x=0;x<map.cols;x++){const t=map.grid[y][x];if(t.tileKey)tiles.add(t.tileKey);if(t.device)devices.add(t.device);}
 const items=[['terrain-high','高台'],['terrain-ground','可部署地面'],['terrain-isolated','隔离平台'],['terrain-corridor','可通行通道'],['terrain-blocked','阻隔工事'],['terrain-entry','敌方入口'],['terrain-goal','防守目标']];
 const special=[];
 if(tiles.has('tile_deepsea'))special.push(['terrain-water','深水区（不可部署）']);
 if(tiles.has('tile_mire'))special.push(['terrain-mire','沼泽地段']);
 if(tiles.has('tile_infection'))special.push(['terrain-originium','活性源石']);
 if(tiles.has('tile_smog'))special.push(['terrain-vent','排气格栅']);
 if(map.environment?.blower)special.push(['terrain-wind','源石流气流']);
 if(devices.has('trap_040_canoe'))special.push(['terrain-platform','特制水上平台']);
 if(devices.has('trap_032_mound'))special.push(['terrain-mound','土石结构（挡沙尘暴）']);
 if(devices.has('trap_1107_acblock'))special.push(['terrain-sealed','封印的地面']);
 if(devices.has('trap_1106_achplat'))special.push(['terrain-achplat','射击台']);
 if(devices.has('trap_218_fttree'))special.push(['terrain-bush','树丛']);
 return [...items,...special].map(([cls,label])=>`<span><i class="${cls}"></i>${label}</span>`).join('');
}
// ── 特殊地块与地图装置的画法 ────────────────────────────────────────────────
// PRTS《卫戍协议：盟约 下半/战场一览》逐张战场标注的地块与装置：深水区、沼泽地段、活性源石、
// 排气格栅、源石流发生装置（气流）、特制水上平台、土石结构、封印的地面、射击台、树丛。
// 这里只负责画：效果判定全在 native-environment.js，装置位置由 build-protocol 按裁切换算。
// 动画用 performance.now()：地块氛围（水波/光晕/气泡/气流）不参与结算，也不随暂停停住。
const TERRAIN_STYLE={tile_deepsea:'water',tile_mire:'mire',tile_infection:'originium',tile_smog:'vent'};
const TERRAIN_TAG={water:'深水',mire:'沼泽',originium:'源石',vent:'格栅'};
// 特殊地块的文字角标（和「高台／隔离／通道」同一套位置与字号）。
function terrainTag(c,px,py,w,h,text,color){c.fillStyle=color;c.textAlign='left';c.font='9px sans-serif';c.fillText(text,px+4,py+h-4);}
// 深水区（#05/#08，涨潮控制）：不可部署、敌方每秒受 40 真实伤害并降攻速移速（判定在环境层）。
function drawWaterTile(c,px,py,w,h,now){
 const g=c.createLinearGradient(px,py,px,py+h);g.addColorStop(0,'#123c52');g.addColorStop(1,'#0a2233');
 c.fillStyle=g;c.fillRect(px,py,w,h);c.strokeStyle='#2f7f9d';c.lineWidth=1;c.strokeRect(px+.5,py+.5,w-1,h-1);
 c.strokeStyle='#63d3ee66';
 for(let i=0;i<2;i++){const yy=py+3+(((now*.3+i*.5)%1))*(h-6);c.beginPath();c.moveTo(px+3,yy);c.quadraticCurveTo(px+w*.5,yy-3,px+w-3,yy);c.stroke();}
 terrainTag(c,px,py,w,h,TERRAIN_TAG.water,'#8fd8ee99');
}
// 沼泽地段（#06）：每 3 秒叠一层攻速/移速 -5%，离开清空（判定在环境层）。
function drawMireTile(c,px,py,w,h,now){
 const g=c.createLinearGradient(px,py,px,py+h);g.addColorStop(0,'#2b3a24');g.addColorStop(1,'#16210f');
 c.fillStyle=g;c.fillRect(px,py,w,h);c.strokeStyle='#5d7a44';c.lineWidth=1;c.strokeRect(px+.5,py+.5,w-1,h-1);
 c.strokeStyle='#9fbf7855';c.beginPath();c.moveTo(px+3,py+h*.55);c.quadraticCurveTo(px+w*.35,py+h*.42,px+w*.6,py+h*.58);c.quadraticCurveTo(px+w*.8,py+h*.7,px+w-3,py+h*.5);c.stroke();
 c.fillStyle='#b6d68a88';
 for(let i=0;i<2;i++){const t=(now*.5+i*.5)%1,r=1+t*2.2;c.globalAlpha=.55*(1-t);c.beginPath();c.arc(px+w*(.3+i*.38),py+h*(.4+i*.2),r,0,Math.PI*2);c.fill();}
 c.globalAlpha=1;terrainTag(c,px,py,w,h,TERRAIN_TAG.mire,'#c8e6a099');
}
// 活性源石（#04）：站在上面每秒 70 真实伤害、攻击力 +20%、攻速 +20（判定在环境层）。
function drawOriginiumTile(c,px,py,w,h,now){
 c.fillStyle='#241a26';c.fillRect(px,py,w,h);
 const pulse=.45+.55*Math.abs(Math.sin(now*1.6));
 const g=c.createRadialGradient(px+w*.5,py+h*.5,1,px+w*.5,py+h*.5,Math.max(w,h)*.7);
 g.addColorStop(0,`rgba(255,138,64,${.38+.28*pulse})`);g.addColorStop(1,'rgba(84,30,40,0)');
 c.fillStyle=g;c.fillRect(px,py,w,h);
 c.fillStyle=`rgba(255,180,90,${.7+.3*pulse})`;
 for(const [fx,fy,sc] of [[.3,.34,.3],[.62,.5,.42],[.46,.72,.26]]){
  c.beginPath();c.moveTo(px+w*fx,py+h*(fy-sc*.5));c.lineTo(px+w*(fx+sc*.26),py+h*(fy+sc*.12));c.lineTo(px+w*fx,py+h*(fy+sc*.5));c.lineTo(px+w*(fx-sc*.26),py+h*(fy+sc*.12));c.closePath();c.fill();
 }
 c.strokeStyle='#a4491f';c.lineWidth=1;c.strokeRect(px+.5,py+.5,w-1,h-1);
 terrainTag(c,px,py,w,h,TERRAIN_TAG.originium,'#ffc08a');
}
// 排气格栅（#07）：置于其中的干员不会成为敌军远程攻击的目标（判定在敌方索敌里）。
function drawVentTile(c,px,py,w,h,now){
 c.fillStyle='#2b3238';c.fillRect(px,py,w,h);c.strokeStyle='#98a6ae';c.lineWidth=1;c.strokeRect(px+.5,py+.5,w-1,h-1);
 c.strokeStyle='#141c21';c.lineWidth=2;
 for(let i=1;i<=3;i++){const yy=py+h*i/4;c.beginPath();c.moveTo(px+3,yy);c.lineTo(px+w-3,yy);c.stroke();}
 c.strokeStyle='#c9d6dc';c.lineWidth=1;
 for(let i=1;i<=3;i++){const yy=py+h*i/4-2;c.beginPath();c.moveTo(px+3,yy);c.lineTo(px+w-3,yy);c.stroke();}
 c.fillStyle=`rgba(180,200,210,${.25+.25*Math.abs(Math.sin(now*.8))})`;c.fillRect(px+3,py+h-4,w-6,2);
 terrainTag(c,px,py,w,h,TERRAIN_TAG.vent,'#d7e3e9');
}
// 地图装置画在地块之上：源石流发生装置、特制水上平台、土石结构、封印的地面、射击台、树丛。
function drawDeviceGlyph(c,t,px,py,w,h,direction){
 const id=t.device,cx=px+w/2,cy=py+h/2,s=Math.min(w,h);
 if(id==='trap_013_blower'){
  c.fillStyle='#3d4a52';c.beginPath();c.arc(cx,cy,s*.3,0,Math.PI*2);c.fill();
  c.strokeStyle='#f0d18a';c.lineWidth=1.6;
  for(let i=0;i<3;i++){const a=i*Math.PI*2/3;c.beginPath();c.moveTo(cx,cy);c.lineTo(cx+Math.cos(a)*s*.26,cy+Math.sin(a)*s*.26);c.stroke();}
  const [dx,dy]=directionOf(direction);
  c.strokeStyle='#8fe6ff';c.lineWidth=2;c.beginPath();c.moveTo(cx+dx*s*.3,cy+dy*s*.3);c.lineTo(cx+dx*s*.52,cy+dy*s*.52);c.stroke();
  c.fillStyle='#bff0ff';c.font='9px sans-serif';c.textAlign='left';c.fillText('气流',px+3,py+10);
 }
 else if(id==='trap_040_canoe'){
  c.fillStyle='#7a5a33';c.fillRect(px+1,py+1,w-2,h-2);c.fillStyle='#9c7442';
  for(let i=2;i<w-4;i+=6)c.fillRect(px+i,py+2,3,h-4);
  c.strokeStyle='#d8b071';c.lineWidth=1;c.strokeRect(px+1.5,py+1.5,w-3,h-3);
  terrainTag(c,px,py,w,h,'平台','#ffe3b0');
 }
 else if(id==='trap_032_mound'){
  c.fillStyle='#6b6154';c.beginPath();c.moveTo(px+2,py+h-2);c.lineTo(px+w*.4,py+3);c.lineTo(px+w*.7,py+h-3);c.closePath();c.fill();
  c.fillStyle='#877c6b';c.beginPath();c.moveTo(px+w*.45,py+h-2);c.lineTo(px+w*.75,py+5);c.lineTo(px+w-2,py+h-2);c.closePath();c.fill();
  terrainTag(c,px,py,w,h,'掩体','#efe0c4');
 }
 else if(id==='trap_1107_acblock'){
  c.fillStyle='#161f24';c.fillRect(px,py,w,h);c.strokeStyle='#7c8a90';c.lineWidth=1.4;
  c.beginPath();c.moveTo(px+3,py+3);c.lineTo(px+w-3,py+h-3);c.moveTo(px+w-3,py+3);c.lineTo(px+3,py+h-3);c.stroke();
  c.strokeRect(px+1.5,py+1.5,w-3,h-3);terrainTag(c,px,py,w,h,'封印','#b9c7cd');
 }
 else if(id==='trap_1106_achplat'){
  c.strokeStyle='#e7d7a8';c.lineWidth=1.6;
  for(const [sx,sy] of [[1,1],[-1,1],[1,-1],[-1,-1]]){const x=sx>0?px+2:px+w-2,y=sy>0?py+2:py+h-2;c.beginPath();c.moveTo(x+sx*5,y);c.lineTo(x,y);c.lineTo(x,y+sy*5);c.stroke();}
  terrainTag(c,px,py,w,h,'射击台','#f2e3b6');
 }
 else if(id==='trap_218_fttree'){
  c.fillStyle='#4a3a24';c.fillRect(cx-1.5,cy,3,h*.3);
  c.fillStyle='#2f6b3c';c.beginPath();c.moveTo(cx,py+2);c.lineTo(cx+s*.3,cy+s*.2);c.lineTo(cx-s*.3,cy+s*.2);c.closePath();c.fill();
  terrainTag(c,px,py,w,h,'树丛','#a9dfb4');
 }
}
// 气流：在装置正前方 3 格画流动的人字箭头（画面只表示方向，数值在环境层）。
function drawWindCells(c,z,map,now){
 if(!map.environment?.blower)return;
 for(const cell of blowerCells(map).values()){
  const px=z.ox+cell.x*z.tw+2,py=z.oy+cell.y*z.th+2,w=z.tw-4,h=z.th-4,cx=px+w/2,cy=py+h/2;
  c.save();c.strokeStyle='#8fe6ff';
  for(let i=0;i<2;i++){
   const t=((now*1.4+i*.5+((cell.x*7+cell.y*3)%10)/10)%1),alpha=.15+.5*(1-Math.abs(t-.5)*2);
   c.globalAlpha=alpha;c.lineWidth=1.8;
   const ox=cx+cell.dx*(t-.5)*w*.8,oy=cy+cell.dy*(t-.5)*h*.8;
   c.beginPath();
   c.moveTo(ox-cell.dx*5-cell.dy*4,oy-cell.dy*5-cell.dx*4);
   c.lineTo(ox,oy);
   c.lineTo(ox-cell.dx*5+cell.dy*4,oy-cell.dy*5+cell.dx*4);
   c.stroke();
  }
  c.restore();
 }
}
// 站在特殊地块上的单位角标：让「地块效果生效了没有」一眼可见（配色与图例一致）。
function drawTerrainBadges(c,p,u,size){
 const badges=[];
 if(u.originium)badges.push({text:'源石',color:'#ffb066'});
 if(u.mireStacks>0)badges.push({text:'沼泽×'+u.mireStacks,color:'#b8dc8a'});
 if(u.windAtkRatio)badges.push({text:`气流${u.windAtkRatio>0?'+':''}${Math.round(u.windAtkRatio*100)}%`,color:'#8fe6ff'});
 else if(u.windMove&&(u.envMoveScale??1)!==1)badges.push({text:`气流${u.envMoveScale>1?'+':''}${Math.round((u.envMoveScale-1)*100)}%`,color:'#8fe6ff'});
 if(u.vented)badges.push({text:'格栅',color:'#d7e3e9'});
 if(!badges.length)return;
 c.font='bold 9px sans-serif';c.textAlign='left';
 let x=p.x-size*.62,y=p.y-size*.95;
 for(const badge of badges.slice(0,2)){
  const w=c.measureText(badge.text).width+6;
  c.fillStyle='#08161ad0';c.fillRect(x,y-8,w,10);
  c.strokeStyle=badge.color;c.lineWidth=1;c.strokeRect(x+.5,y-7.5,w-1,9);
  c.fillStyle=badge.color;c.fillText(badge.text,x+3,y);
  x+=w+3;
 }
}
function drawTerrain(c,z,map){
 const now=performance.now()/1000;
 for(let y=0;y<map.rows;y++)for(let x=0;x<map.cols;x++){
  const t=map.grid[y][x],px=z.ox+x*z.tw+2,py=z.oy+y*z.th+2,w=z.tw-4,h=z.th-4;if(t.zone){if(t.device)drawDeviceGlyph(c,t,px,py,w,h,t.direction);continue;}const lift=tileLift(t,z),entry=t.tileKey.startsWith('tile_start'),goal=t.tileKey.startsWith('tile_end'),blocked=!!t.obstacle,fenced=isolatedPlatform(t),corridor=t.buildableType==='NONE'&&t.passableMask!=='NONE'&&!blocked;
  c.fillStyle='#071216';c.fillRect(px,py+3,w,h);
  if(lift&&!blocked){const top=c.createLinearGradient(px,py,px+w,py+h-lift);top.addColorStop(0,'#a4b7bd');top.addColorStop(1,'#718b98');c.fillStyle=top;c.fillRect(px,py,w,h-lift);c.fillStyle='#314c5c';c.fillRect(px,py+h-lift,w,lift);c.strokeStyle='#d7e5e9';c.lineWidth=1.2;c.strokeRect(px+.5,py+.5,w-1,h-lift-1);c.strokeStyle='#182e3b';c.beginPath();c.moveTo(px,py+h);c.lineTo(px+w,py+h);c.stroke();c.fillStyle='#dce8eb';c.font=Math.max(8,Math.min(10,z.tw*.16))+'px sans-serif';c.textAlign='right';c.fillText('高台',px+w-3,py+h-2);}
  else{const special=TERRAIN_STYLE[t.tileKey];
   if(special){if(special==='water')drawWaterTile(c,px,py,w,h,now);else if(special==='mire')drawMireTile(c,px,py,w,h,now);else if(special==='originium')drawOriginiumTile(c,px,py,w,h,now);else drawVentTile(c,px,py,w,h,now);}
   else{const top=c.createLinearGradient(px,py,px,py+h);top.addColorStop(0,entry?'#824537':goal?'#356c7b':blocked?'#1a282e':corridor?'#1b4e59':'#42565b');top.addColorStop(1,entry?'#49291f':goal?'#203e4d':blocked?'#121e24':corridor?'#102d36':'#2a3c42');c.fillStyle=top;c.fillRect(px,py,w,h);c.strokeStyle=entry?'#ffad7c':goal?'#8bdcea':blocked?'#36464d':corridor?'#63dce4':'#61767b';c.lineWidth=entry||goal||corridor?1.5:.8;c.strokeRect(px+.5,py+.5,w-1,h-1);
    if(blocked){c.save();c.beginPath();c.rect(px,py,w,h);c.clip();c.strokeStyle='#69828a22';c.lineWidth=1;for(let i=-h;i<w;i+=10){c.beginPath();c.moveTo(px+i,py+h);c.lineTo(px+i+h,py);c.stroke();}c.restore();c.fillStyle='#607780';c.font=Math.max(9,Math.min(13,z.tw*.22))+'px sans-serif';c.textAlign='center';c.fillText('工事',px+w/2,py+h/2+4);}
    else if(entry||goal){c.fillStyle=entry?'#ffc39b':'#b8f1fb';c.textAlign='center';c.font='bold '+Math.max(9,Math.min(14,z.tw*.24))+'px sans-serif';c.fillText(entry?'入口':'目标',px+w/2,py+h/2+4);}
    else if(fenced){c.strokeStyle='#c9a575';c.lineWidth=1.6;c.strokeRect(px+.5,py+.5,w-1,h-1);c.strokeStyle='#a8875b';c.lineWidth=1;for(let i=5;i<w-3;i+=6){c.beginPath();c.moveTo(px+i,py+1);c.lineTo(px+i,py+3.5);c.moveTo(px+i,py+h-1);c.lineTo(px+i,py+h-3.5);c.stroke();}for(let i=5;i<h-3;i+=6){c.beginPath();c.moveTo(px+1,py+i);c.lineTo(px+3.5,py+i);c.moveTo(px+w-1,py+i);c.lineTo(px+w-3.5,py+i);c.stroke();}c.fillStyle='#e6cfa4';c.textAlign='left';c.font='9px sans-serif';c.fillText('隔离',px+4,py+h-4);}
    else{c.strokeStyle=corridor?'#8beaf055':'#91a6ac50';c.lineWidth=1;for(const [cx,cy,sx,sy]of [[px+3,py+3,1,1],[px+w-3,py+3,-1,1],[px+3,py+h-3,1,-1],[px+w-3,py+h-3,-1,-1]]){c.beginPath();c.moveTo(cx+sx*4,cy);c.lineTo(cx,cy);c.lineTo(cx,cy+sy*4);c.stroke();}if(corridor){c.save();c.beginPath();c.rect(px,py,w,h);c.clip();c.strokeStyle='#8beaf033';c.lineWidth=1;for(let i=-h;i<w;i+=8){c.beginPath();c.moveTo(px+i,py+h);c.lineTo(px+i+h,py);c.stroke();}c.restore();}c.fillStyle=corridor?'#a9f4f0b8':'#a6b7b966';c.textAlign='left';c.font='9px sans-serif';c.fillText(corridor?'通道':'地',px+4,py+h-4);}
   }
   if(t.device)drawDeviceGlyph(c,t,px,py,w,h,t.direction);
  }
 }
 drawWindCells(c,z,map,now);
 c.font='9px monospace';c.textAlign='center';c.fillStyle='#a7bebc';for(let x=map.viewport.left;x<=map.viewport.right;x++)c.fillText(String.fromCharCode(65+x),z.ox+(x+.5)*z.tw,z.oy-5);for(let y=map.viewport.top;y<=map.viewport.bottom;y++)c.fillText(canvasNumber(y+1),Math.max(8,z.ox+map.viewport.left*z.tw-10),z.oy+(y+.5)*z.th+3);
}
function drawFinalBossPlacementPreview(c,z,area){
 if(!area)return;
 const x=z.ox+area.firstColumn*z.tw+1,y=z.oy+area.firstRow*z.th+1,w=area.columns*z.tw-2,h=area.rows*z.th-2;
 c.save();c.fillStyle='#efb85b35';c.fillRect(x,y,w,h);c.strokeStyle='#ffd17a';c.lineWidth=2.5;c.strokeRect(x+1,y+1,w-2,h-2);c.strokeStyle='#ffd17a88';c.lineWidth=1;
 for(let col=1;col<area.columns;col++){c.beginPath();c.moveTo(x+col*z.tw,y);c.lineTo(x+col*z.tw,y+h);c.stroke();}
 c.beginPath();c.moveTo(x,y+z.th);c.lineTo(x+w,y+z.th);c.stroke();
 c.fillStyle='#102127e8';c.fillRect(x+4,y+4,w-8,Math.min(17,z.th*.36));c.fillStyle='#ffe2a8';c.font='bold '+Math.max(9,Math.min(12,z.tw*.2))+'px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(w<88?'J1-K3':'Boss 判定 · J1-K3',x+w/2,y+4+Math.min(17,z.th*.36)/2,w-10);c.restore();
}
function draw(){
 if(!canvas||state.view!=='game'||!state.game)return;const g=state.game,z=geometry(),dpr=Math.min(2,window.devicePixelRatio||1);if(canvas.width!==Math.round(z.r.width*dpr)||canvas.height!==Math.round(z.r.height*dpr)){canvas.width=Math.round(z.r.width*dpr);canvas.height=Math.round(z.r.height*dpr);}const c=canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,z.r.width,z.r.height);const point=(x,y)=>({x:z.ox+(x+.5)*z.tw,y:z.oy+(y+.5)*z.th});c.fillStyle='#111f23';c.fillRect(0,0,z.r.width,z.r.height);
 drawTerrain(c,z,g.map);
 if(g.s.phase==='prep')drawFinalBossPlacementPreview(c,z,g.finalBossPrepArea());
 const selected=g.s.units.find(u=>u.uid===(state.preview?.uid||state.selected)),live=selected&&g.battle?g.battle.s.units.find(u=>u.uid===selected.uid):null;
 if(selected&&(selected.position||state.preview)){
  const p=state.preview||{...selected.position,dir:selected.dir};
  // 备战期／拖动预览也按**所选技能**的范围画（用户口径：技能范围要和描述一致）。
  // 战斗期取实时范围（含开技中的技能范围）；「攻击范围扩大至整个战场」的高亮整张图。
  const sp=profile(selected),skillText=String(sp.skill?.description||'');
  const wholeField=/整个战场|全场/.test(skillText);
  const prepGrids=data.ranges?.[sp.skill?.rangeId||sp.rangeId]?.grids||sp.range?.grids||[];
  const cells=wholeField
   ?Array.from({length:g.map.rows},(_,y)=>Array.from({length:g.map.cols},(_,x)=>({x,y}))).flat()
   :g.s.phase==='battle'&&!state.preview&&g.battle&&live?g.battle.range(live,g.battle.skillActive(live))
   :prepGrids.map(cell=>{let x=cell.col,y=-cell.row;for(let i=0;i<(p.dir??0);i++)[x,y]=[-y,x];return{x:p.x+x,y:p.y+y};});
  for(const cell of cells)c.fillStyle='#63d8b738',c.fillRect(z.ox+cell.x*z.tw+2,z.oy+cell.y*z.th+2,z.tw-4,z.th-4);
 }
 const statusOverlays=[];
  const prepSummons=g.s.phase==='prep'?(g.s.summonCards||[]).filter(card=>card.position).map(card=>({...card,x:card.position.x,y:card.position.y,id:card.type,deployed:true})):[];
  const actors=battleBoardVisible(g.s.phase)?g.battle?.s.units||[]:[...g.s.units.filter(u=>u.position).map(u=>({...u,x:u.position.x,y:u.position.y,id:u.charId,deployed:true})),...prepSummons];
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
  drawConcealOverlay(c,u,{x:p.x-size/2,y:p.y-size*.75,w:size,h:size},{reduceFx:state.reduceFx,time:g.battle?.s.time||0,image:im});
  // 傀儡师替身形态：头像上盖一层动态紫色特效（用户 2026-09-22 口径），和「替身 Ns」文字一起用。
  drawDollOverlay(c,u,{x:p.x-size/2,y:p.y-size*.75,w:size,h:size},{reduceFx:state.reduceFx,time:g.battle?.s.time||0});
  if(u.hp!==undefined&&u.deployed){c.fillStyle='#122022';c.fillRect(p.x-size/2,p.y+size*.35,size,4);c.fillStyle='#75d9aa';c.fillRect(p.x-size/2,p.y+size*.35,size*Math.max(0,u.hp/u.maxHp),4);}
  const sk=profile(u)?.skill,cost=g.battle&&u.sp!==undefined?g.battle.spCost(u):sk?.spData?.spCost||0,fill=spBarFill(u,sk,cost);if(fill&&u.deployed){const bx=p.x-size/2,by=p.y+size*.35+(u.hp!==undefined?6:0);if(fill.kind==='ammo'){const n=fill.cells,gap=1,cw=Math.max(1,(size-(n-1)*gap)/n);for(let i=0;i<n;i++){c.fillStyle='#122022';c.fillRect(bx+i*(cw+gap),by,cw,4);if(i<fill.filled){c.fillStyle='#f4d38b';c.fillRect(bx+i*(cw+gap),by,cw,4);}}}else{c.fillStyle='#122022';c.fillRect(bx,by,size,3);c.fillStyle=fill.on?'#f4d38b':fill.ready?'#f0d18a':'#7bbaf3';c.fillRect(bx,by,size*fill.ratio,3);}}if(u.deployed&&u.ammo>0){const label=`${u.ammo}/${u.ammoMax}`;c.save();c.font='bold 10px sans-serif';c.textAlign='right';c.textBaseline='middle';const w=c.measureText(label).width+8,x=p.x+size/2,y=p.y-size*.68;c.fillStyle='rgba(8,24,25,.94)';c.fillRect(x-w,y-7,w,14);c.fillStyle='#fff0c3';c.fillText(label,x-4,y);c.restore();}
  if(u.dollForm){c.fillStyle='#d6b5ff';c.font='bold 11px sans-serif';c.textAlign='center';c.fillText('替身 '+Math.max(0,Math.ceil(u.dollForm.until-(g.battle?.s.time||0)))+'s',p.x,p.y-size*.86);}
  if(g.battle)drawStatuses(c,p.x,p.y,u,size);if(g.battle)drawTerrainBadges(c,p,u,size);if(down)drawDownRing(c,p,u,size,eggOn()?{formatNumber:format325}:undefined);
  });
 }
 if(g.battle&&battleBoardVisible(g.s.phase))for(const s of g.battle.s.summons||[]){
  if(!s.deployed)continue;
  const p=point(s.x,s.y);p.y-=tileLift(g.map.grid[s.y]?.[s.x],z)*.5;const size=Math.min(z.tw*.5,z.th*.8);
  {c.fillStyle=s.device?'#7ec8e3':'#c9a56a';c.beginPath();c.moveTo(p.x,p.y-size*.55);c.lineTo(p.x+size*.4,p.y);c.lineTo(p.x,p.y+size*.45);c.lineTo(p.x-size*.4,p.y);c.closePath();c.fill();c.strokeStyle='#f4efe2';c.lineWidth=state.inspect?.kind==='summon'&&state.inspect.uid===s.uid?2:1;c.stroke();}
  statusOverlays.push(()=>{
  drawElementRing(c,p.x,p.y,s,size);
  drawFrostOverlay(c,s,{x:p.x-size/2,y:p.y-size*.55,w:size,h:size},{reduceFx:state.reduceFx});
  drawConcealOverlay(c,s,{x:p.x-size/2,y:p.y-size*.55,w:size,h:size},{reduceFx:state.reduceFx,time:g.battle?.s.time||0});
  c.fillStyle='#122022';c.fillRect(p.x-size/2,p.y+size*.35,size,4);c.fillStyle='#75d9aa';c.fillRect(p.x-size/2,p.y+size*.35,size*Math.max(0,s.hp/s.maxHp),4);
  drawStatuses(c,p.x,p.y,s,size);
  c.fillStyle='#e9fff7';c.font='10px sans-serif';c.textAlign='center';c.fillText(s.name||s.type,p.x,p.y-size*.65);
  });
 }
 if(g.battle&&battleBoardVisible(g.s.phase))for(const e of g.battle.s.enemies){if(e.hidden)continue;const p=point(e.x,e.y),sprite=enemySprite(e),size=z.tw*.55*sprite.scale,im=formTintedImage(img(sprite.key),sprite.tint&&!state.reduceFx?sprite.tint:null);if(e.trainingDummy){c.fillStyle='#be9364';c.fillRect(p.x-7,p.y-20,14,40);c.fillRect(p.x-20,p.y-10,40,10);c.fillStyle='#fff0c8';c.font='bold 22px sans-serif';c.fillText('∞',p.x,p.y-26);drawFrostOverlay(c,e,{x:p.x-20,y:p.y-20,w:40,h:40},{reduceFx:state.reduceFx});}else{if(im?.complete&&im.naturalWidth)c.drawImage(im,p.x-size/2,p.y-size/2-(e.flying?15:0),size,size);else{c.fillStyle='#d9846d';c.beginPath();c.arc(p.x,p.y,12,0,Math.PI*2);c.fill();}statusOverlays.push(()=>{drawElementRing(c,p.x,p.y-(e.flying?15:0),e,size);drawFrostOverlay(c,e,{x:p.x-size/2,y:p.y-size/2-(e.flying?15:0),w:size,h:size},{reduceFx:state.reduceFx});drawConcealOverlay(c,e,{x:p.x-size/2,y:p.y-size/2-(e.flying?15:0),w:size,h:size},{reduceFx:state.reduceFx,time:g.battle.s.time,image:im});c.fillStyle='#e29179';c.fillRect(p.x-size/2,p.y-size*.65-(e.flying?15:0),size*Math.max(0,e.hp/e.maxHp),3);drawStatuses(c,p.x,p.y-(e.flying?15:0),e,size);drawTerrainBadges(c,{x:p.x,y:p.y-(e.flying?15:0)},e,size);});}if(g.battle.s.whitwEyes?.some(x=>x.targetUid===e.uid)){const y=p.y-size*.8-(e.flying?15:0);c.save();c.strokeStyle='#ff4f5e';c.fillStyle='#ff4f5e';c.lineWidth=2;c.beginPath();c.ellipse(p.x,y,7,4.5,0,0,Math.PI*2);c.stroke();c.beginPath();c.arc(p.x,y,2,0,Math.PI*2);c.fill();c.beginPath();c.moveTo(p.x-11,y);c.lineTo(p.x-8,y);c.moveTo(p.x+8,y);c.lineTo(p.x+11,y);c.stroke();c.restore();}}
 if(g.battle&&battleBoardVisible(g.s.phase))drawWhitwEyes(c,point,z,g.battle,{reduceFx:state.reduceFx});
 if(g.battle&&g.s.phase==='battle')drawFx(c,point,z,g.battle,{reduceFx:state.reduceFx,formatText:eggOn()?rewrite325Text:null});
  if(drag?.moved&&overCanvas(drag.x,drag.y)){const cell=cellAt(drag.x,drag.y);if(g.map.grid[cell.y]?.[cell.x]){const can=drag.kind==='summon-card'?g.canDeploySummonCard(drag.uid,cell.x,cell.y):g.canDeploy(drag.uid,cell.x,cell.y);c.strokeStyle=can?'#78f1bd':'#f88c78';c.lineWidth=3;c.strokeRect(z.ox+cell.x*z.tw+2,z.oy+cell.y*z.th+2,z.tw-4,z.th-4);}}
 if(state.preview){const p=point(state.preview.x,state.preview.y);c.fillStyle='#08151195';c.fillRect(0,0,z.r.width,z.r.height);c.strokeStyle='#70e4c1';c.lineWidth=2;c.beginPath();c.moveTo(p.x,p.y-62);c.lineTo(p.x+62,p.y);c.lineTo(p.x,p.y+62);c.lineTo(p.x-62,p.y);c.closePath();c.stroke();c.fillStyle='#e9fff7';c.font='bold 32px sans-serif';c.fillText(state.preview.dir===null?'✥':['→','↓','←','↑'][state.preview.dir],p.x,p.y+10);}
 // HUD is the final canvas pass: portraits and combat effects cannot cover it.
 for(const drawOverlay of statusOverlays){c.save();c.globalAlpha=1;drawOverlay();c.restore();}
 let screenFx=document.getElementById('native-sees-fx-board');
 if(!screenFx){screenFx=document.createElement('canvas');screenFx.id='native-sees-fx-board';screenFx.className='native-sees-fx-board';screenFx.setAttribute('aria-hidden','true');document.querySelector('.native-board')?.append(screenFx);}
 if(screenFx){
  if(screenFx!==seesScreenFxCanvas){seesScreenFxCanvas=screenFx;seesScreenFxWasActive=false;}
  const rect=screenFx.getBoundingClientRect(),width=rect.width,height=rect.height,dpr=Math.min(2,window.devicePixelRatio||1),battle=g.battle;
  const active=!!battle&&(battle.s.events||[]).some(event=>event.type==='sees-core'&&battle.s.time-event.t>=0&&battle.s.time-event.t<SEES_CORE_EFFECT_SECONDS);
  if(active||seesScreenFxWasActive){
   if(screenFx.width!==Math.round(width*dpr)||screenFx.height!==Math.round(height*dpr)){screenFx.width=Math.round(width*dpr);screenFx.height=Math.round(height*dpr);}
   const fx=screenFx.getContext('2d');fx.setTransform(dpr,0,0,dpr,0,0);fx.clearRect(0,0,width,height);
   if(active)drawSeesCoreScreenFx(fx,battle,width,height,{reduceFx:state.reduceFx});
  }
  seesScreenFxWasActive=active;
 }
}
root.addEventListener('change',e=>{
 if(upgradeConfirm)resetUpgradeConfirm();
 if(e.target.id==='native-mode')state.mode=e.target.value;if(e.target.id==='native-map')state.map=e.target.value;if(e.target.id==='native-skill'){state.game.perform('skill',Number(e.target.dataset.uid),Number(e.target.value));save();render();}
 // 战前准备页：盟约下拉重筛列表；技能选择通过卡片按钮即时保存。
 if(state.view==='prepare'){
  const p=prepState();
  if(e.target.id==='prep-core'){p.core=e.target.value;p.scroll=window.scrollY||0;render();return;}
  if(e.target.id==='prep-extra'){p.extra=e.target.value;p.scroll=window.scrollY||0;render();return;}
 }
 if(state.view==='editor'&&e.target.dataset.act){const catalog=document.getElementById('ed-catalog');state.editor.scroll=catalog?.scrollTop||0;if(applyEditorField(e.target.dataset.act,e.target.dataset.id,e.target.value,state.waveTable,state.editor)){if(['ed-budget','ed-cost','ed-default','ed-temp-name'].includes(e.target.dataset.act)){const ui=state.editor,slot=state.waveTable.types[ui.type][ui.tier].templates[ui.template],name=slot.name||`模板 ${ui.template+1}`;root.querySelector('.wave-ed-current h2').textContent=name;root.querySelector('.wave-ed-temps .chosen b').textContent=name;root.querySelector('.wave-ed-temps .chosen small').textContent=`${slot.pool.length} 种敌人 · 预算 ${slot.budget}`;}else{const act=e.target.dataset.act;queueMicrotask(()=>{render();root.querySelector(`[data-act="${act}"]`)?.focus();});}}}
});
root.addEventListener('input',e=>{
 if(upgradeConfirm)resetUpgradeConfirm();
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
 const handArrows=mobilePlay()||document.documentElement.classList.contains('native-landscape-ui'),panes=[...root.querySelectorAll('.native-strategy-catalog, .native-strategy-pane, .native-dossier, .native-modal>section, .native-prep-list, .native-bench, .native-lobby')].filter(pane=>!(handArrows&&pane.matches('.native-bench'))).reverse();
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
 if(scroller.matches('.native-prep-list, .native-bench'))return Math.max(0,scroller.scrollWidth-scroller.clientWidth);
 if(scroller.matches('.native-lobby, .native-strategy-catalog'))return Math.max(0,scroller.scrollHeight-scroller.clientHeight);
 const track=paneTrack(scroller);
 return Math.max(0,(track?.offsetHeight||0)-scroller.clientHeight);
}
function shiftOf(scroller){return scroller.matches('.native-prep-list, .native-bench')?scroller.scrollLeft:scroller.matches('.native-lobby, .native-strategy-catalog')?scroller.scrollTop:paneShift.get(scroller)||0;}
function setShift(scroller,y){
 if(scroller.matches('.native-prep-list, .native-bench')){const next=Math.max(0,Math.min(paneMax(scroller),y));scroller.scrollLeft=next;return next;}
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
  if(node.matches?.('.native-strategy-catalog, .native-strategy-pane, .native-dossier, .native-modal>section, .native-prep-list, .native-bench, .native-lobby')&&!(node.matches('.native-bench')&&(mobilePlay()||document.documentElement.classList.contains('native-landscape-ui')))&&paneMax(node)>0)return node;
  node=node.parentElement;
 }
 return null;
}
function paneDelta(touch,clientX,clientY,scroller){
 if(scroller?.matches('.native-bench'))return rotatedPlay()?touch.y-clientY:touch.x-clientX;
 return scroller?.matches('.native-prep-list')||rotatedPlay()?touch.x-clientX:touch.y-clientY;
}
let paneTouch=null,paneMoved=false,benchTouchMoved=false;
root.addEventListener('touchstart',e=>{
 benchTouchMoved=false;
 if(e.touches.length!==1)return;
 paneMoved=false;
 const t=e.touches[0],scroller=scrollerAtPoint(t.clientX,t.clientY)||paneScroller(e.target);
 if(!scroller||paneMax(scroller)<=0){paneTouch=null;paneMoved=false;return;}
 paneMoved=false;
 paneTouch={scroller,x:t.clientX,y:t.clientY,top:shiftOf(scroller)};
},{passive:true});
root.addEventListener('touchmove',e=>{
 if(!paneTouch||e.touches.length!==1)return;
 const t=e.touches[0],dy=paneDelta(paneTouch,t.clientX,t.clientY,paneTouch.scroller);
 if(Math.abs(dy)<8)return;
 setShift(paneTouch.scroller,paneTouch.top+dy);
 if(paneTouch.scroller.matches('.native-bench'))benchTouchMoved=true;
 paneMoved=true;
 touchButton=null;
 e.preventDefault();
},{passive:false});
root.addEventListener('touchend',()=>{
  if(paneMoved){ignoredClickUntil=Math.max(ignoredClickUntil,performance.now()+80);paneTouch=null;return;}
  paneTouch=null;paneMoved=false;benchTouchMoved=false;
},{passive:true});
root.addEventListener('touchcancel',()=>{paneTouch=null;paneMoved=false;benchTouchMoved=false;},{passive:true});
root.addEventListener('wheel',e=>{
 const scroller=scrollerAtPoint(e.clientX,e.clientY);
 if(!scroller||paneMax(scroller)<=0)return;
 e.preventDefault();
 setShift(scroller,shiftOf(scroller)+(scroller.matches('.native-prep-list, .native-bench')?(e.deltaX||e.deltaY):e.deltaY));
},{passive:false});
root.addEventListener('scroll',e=>{if(e.target?.id==='native-hand')syncHandScrollControls();},true);
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
  if(upgradeConfirm&&!e.target.closest?.('[data-act="upgrade"]'))resetUpgradeConfirm();
  if(dismissInspectOnOutsidePress(e))return;
 const paneHit=hitInScroller(scrollerAtPoint(e.clientX,e.clientY),e.clientX,e.clientY);
 const button=paneHit||e.target.closest('button[data-act], [role="button"][data-act]');
 if(e.pointerType==='touch'&&button&&!button.disabled)touchButton={b:button,id:e.pointerId,x:e.clientX,y:e.clientY};
 const manage=state.game?.s.phase==='prep'&&!state.game.s.rewardPending&&!state.modal;
  if(button?.dataset.act==='destroy'||button?.dataset.act==='destroyEquip')return;
  if(button?.dataset.act==='item'&&manage&&button.dataset.uid){drag={uid:Number(button.dataset.uid),kind:'item',id:e.pointerId,from:'hand',x0:e.clientX,y0:e.clientY,x:e.clientX,y:e.clientY,moved:false};button.setPointerCapture(e.pointerId);return;}
  if((button?.dataset.act==='select'||button?.dataset.act==='summon-select')&&manage&&!state.item&&(button.dataset.act!=='summon-select'||button.dataset.mode==='manual'||button.dataset.placeable==='true')){state.preview=null;root.querySelector('.native-facing')?.setAttribute('hidden','');drag={uid:Number(button.dataset.uid),kind:button.dataset.act==='summon-select'?'summon-card':'operator',id:e.pointerId,from:'hand',x0:e.clientX,y0:e.clientY,x:e.clientX,y:e.clientY,moved:false};button.setPointerCapture(e.pointerId);return;}
 if(e.target!==canvas)return;
 if(state.preview&&manage){const z=geometry(),x=z.r.left+z.ox+(state.preview.x+.5)*z.tw,y=z.r.top+z.oy+(state.preview.y+.5)*z.th;if(Math.hypot(e.clientX-x,e.clientY-y)>95){state.preview=null;render();return;}aim={x,y,id:e.pointerId};canvas.setPointerCapture(e.pointerId);return;}
  const cell=cellAt(e.clientX,e.clientY),unit=unitAtPointer(e.clientX,e.clientY);canvasPress={...cell,uid:unit?.uid,kind:unit?.kind,x0:e.clientX,y0:e.clientY};
  if(unit&&manage&&!state.item&&(!unit.summon||unit.summonCard))drag={uid:unit.uid,kind:unit.summonCard?'summon-card':'operator',id:e.pointerId,from:'field',x0:e.clientX,y0:e.clientY,x:e.clientX,y:e.clientY,moved:false};canvas.setPointerCapture(e.pointerId);
});
root.addEventListener('pointermove',e=>{
 if(touchButton&&Math.hypot(e.clientX-touchButton.x,e.clientY-touchButton.y)>8)touchButton=null;
 if(benchTouchMoved&&drag?.id===e.pointerId){clearDrag();return;}
 if(drag&&drag.id===e.pointerId){drag.x=e.clientX;drag.y=e.clientY;if(Math.hypot(e.clientX-drag.x0,e.clientY-drag.y0)>8)drag.moved=true;if(drag.moved){canvasPress=null;touchButton=null;dragFeedback();draw();}}
 if(aim&&aim.id===e.pointerId&&state.preview){const dx=e.clientX-aim.x,dy=e.clientY-aim.y;state.preview.dir=Math.hypot(dx,dy)<18?null:Math.abs(dx)>Math.abs(dy)?dx>0?0:2:dy>0?1:3;draw();}
});
root.addEventListener('pointerup',e=>{
 if(benchTouchMoved){benchTouchMoved=false;paneMoved=false;paneTouch=null;ignoredClickPointer=e.pointerId;ignoredClickUntil=performance.now()+400;clearDrag();return;}
 if(drag&&drag.id===e.pointerId){const d=drag;if(d.moved){
if(d.from==='hand'&&!(d.kind==='item'&&overUnitCard(e.clientX,e.clientY))){const slot=handSlotAt(e.clientX,e.clientY);if(slot!==null){drag=null;dragFeedback();ignoredClickPointer=e.pointerId;ignoredClickUntil=performance.now()+400;if(moveHandCardToSlot(d.kind,d.uid,slot)){state.inspect=null;save();notice('已调整手牌位置');}render();return;}}if(d.kind==='operator'&&overShop(e.clientX,e.clientY)){drag=null;dragFeedback();const u=state.game.s.units.find(x=>x.uid===d.uid);const name=u?(data.profiles[u.chessId]?.name||'干员'):'干员';if(state.game.perform('sell',d.uid)){state.selected=null;state.inspect=null;save();notice('已出售 '+name+'，资金 +'+(u?data.season.shopCharChessInfoData[u.rank][data.season.charChessDataDict[u.chessId].isGolden?1:0].chessSoldPrice:0)+' ◆');}else notice('当前阶段无法出售该干员。');render();return;}
if(d.kind==='item'&&d.from==='hand'){const u=equipDropTarget(e.clientX,e.clientY);drag=null;dragFeedback();if(u){const name=data.profiles[u.chessId]?.name||'干员';const sameBondRecruit=sameBondRecruitItem(state.game,d.uid);const equipped=equipItemOnUnit(u.uid,d.uid);state.selected=u.uid;state.inspect={kind:'unit',uid:u.uid};save();render();if(equipped&&!sameBondRecruit)notice('已为'+name+'装备。');return;}notice('请把装备拖到干员身上。');render();return;}ignoredClickPointer=e.pointerId;ignoredClickUntil=performance.now()+400;clearDrag();state.inspect=null;
    if(d.from==='field'&&overBench(e.clientX,e.clientY)){const ok=d.kind==='summon-card'?state.game.perform('withdrawSummon',d.uid):state.game.perform('withdraw',d.uid);if(ok){state.selected=state.summonSelected=state.preview=null;save();notice('已移回整备区');}else notice('整备区已满或当前阶段无法收回');render();}
    else if(overCanvas(e.clientX,e.clientY)){const cell=cellAt(e.clientX,e.clientY);d.kind==='summon-card'?placeSummon(d.uid,cell.x,cell.y):place(d.uid,cell.x,cell.y);}else render();return;
   }drag=null;dragFeedback();if(d.from==='field'){canvasPress=null;action({dataset:{act:d.kind==='summon-card'?'summon-select':'select',uid:String(d.uid)}},{x:e.clientX,y:e.clientY});return;}}
 if(aim&&aim.id===e.pointerId){aim=null;ignoredClickPointer=e.pointerId;ignoredClickUntil=performance.now()+400;if(state.preview&&state.preview.dir!==null)commitPreview();else{state.preview=null;render();}return;}
  if(canvasPress){const press=canvasPress;canvasPress=null;if(overCanvas(e.clientX,e.clientY)){const cell=cellAt(e.clientX,e.clientY);if(press.kind==='summon-card')action({dataset:{act:'summon-select',uid:String(press.uid)}});else if(press.uid){const summon=state.game.battle?.s.summons?.find(s=>s.uid===press.uid);if(summon){state.inspect={kind:'summon',uid:press.uid};state.selected=null;render();}else action({dataset:{act:'select',uid:String(press.uid)}},{x:e.clientX,y:e.clientY});}else if(state.selected)place(state.selected,cell.x,cell.y);else if(state.summonSelected)placeSummon(state.summonSelected,cell.x,cell.y);}}
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
root.addEventListener('pointercancel',()=>{benchTouchMoved=false;if(!drag&&!aim&&!state.preview&&!canvasPress)return;clearDrag();aim=null;state.preview=null;render();});
document.addEventListener('keydown',e=>{if(root.querySelector('#wave-ed-test[open]')||root.querySelector('.native-choice-overlay'))return;if(e.target.matches('input,select,textarea'))return;if(e.key==='Escape'){clearDrag();aim=null;state.preview=null;state.selected=state.summonSelected=null;state.inspect=null;if(!requiredChoicePending())state.modal=null;render();}if(state.preview){const d={ArrowRight:0,ArrowDown:1,ArrowLeft:2,ArrowUp:3}[e.key];if(d!==undefined){e.preventDefault();state.preview.dir=d;draw();}if(e.key==='Enter')commitPreview();}});
window.addEventListener('beforeunload',()=>{state.expiresAt??=Date.now()+86400000;save();});
// 切走页面**不再自动暂停**（用户 2026-09-23 口径「网页切走时后台继续运行而不是暂停」）：隐藏标签页里
// requestAnimationFrame 会停摆，所以换一条按真实时间补帧的后台驱动（scheduleBackground），回到前台再交还给 rAF。
document.addEventListener('visibilitychange',()=>{
 if(document.hidden){state.expiresAt??=Date.now()+86400000;save();scheduleBackground();}
 else{cancelBackground();last=performance.now();acc=Math.min(acc,1/30);updateHud();draw();}
});
// 后台继续跑：
//  · 隐藏标签页里 rAF 完全停摆，浏览器还会节流定时器（Chrome：隐藏后最多 1 秒一次；隐藏 5 分钟后可能降到
//    1 分钟一次，个别情况整个标签页被冻结）。所以每次唤醒都按 performance.now() 的**真实差值**补帧，
//    不能假设「一帧 = 1/30 秒」。
//  · 单次唤醒给一个**墙钟预算**（BG_BUDGET_MS）：预算用完就把欠账留在 acc 里，下一次唤醒继续补，
//    免得一次性跑几千帧把主线程卡住。欠账只在回到前台时截断成一帧（那时玩家在看，宁可少补也不能卡）。
//  · 后台不发声、不重绘画布/头部计数（playBattleEvents 仍以静音调用，只为推进「已播放」游标，
//    否则回来时会补响一串音效）；阶段变化（波次结束、整局结束）照旧 render()，回到前台立刻 updateHud()+draw()。
const BG_WAKE_MS=250,BG_BUDGET_MS=200,BG_MAX_GAP=3600;
let bgTimer=null;
function scheduleBackground(){if(bgTimer!=null||runtimeFault)return;bgTimer=setTimeout(backgroundWake,BG_WAKE_MS);}
function cancelBackground(){if(bgTimer!=null){clearTimeout(bgTimer);bgTimer=null;}}
function backgroundWake(){
 bgTimer=null;
 if(runtimeFault||!document.hidden)return;
 try{advance(performance.now(),false);}
 catch(error){runtimeFault=error;state.paused=true;console.error('Native runtime paused',error);try{notice('战斗已暂停：'+(error?.message||String(error)));}catch{}}
 if(document.hidden)scheduleBackground();
}
// 一帧的推进（可见与后台共用）：live=false 就是后台补帧。
function advance(now,live){
 const gap=Math.max(0,(now-last)/1000);last=now;
 const dt=Math.min(live?.15:BG_MAX_GAP,gap);
 const g=state.game;
 if(state.view==='game'&&g?.s.phase==='battle'&&!state.paused){
  acc+=dt*state.speed;const previous=g.s.phase,deadline=live?0:performance.now()+BG_BUDGET_MS;
  while(acc>=1/30&&g.s.phase==='battle'){acc-=1/30;g.tick();if(!live&&performance.now()>deadline)break;}
  if(g.battle)playBattleEvents(g.battle.s,live?state.muted:true,state.volume);
  if(g.s.phase!==previous){acc=0;save();recordRunIfOver(g);render();if(state.onlineRun){if(g.s.phase==='intermission'){if(g.s.coopStage==='joint-defense-complete')submitCoopDefenseResult(g);else submitCoopBattleResult(g);}else if(g.s.coopStage==='boss-skipped'){state.onlineRun.waitingForServer='boss';onlineClient?.skipBoss(g.s.round);coopWaitModal('联机对局结束中','已到 Boss 阶段，本局按联机 MVP 规则直接结束。');}else submitCoopBattleResult(g);}else if(g.s.phase==='intermission')roundEndBegin(g);else if(g.s.phase==='finished'){const dmg=Math.round(g.s.runResult?.totalDamage||0),result=g.s.runResult;notice(result?.kind==='final-boss'?(result.success?'最终 Boss 击破，挑战成功':'最终 Boss 未能击破，挑战失败'):'模拟结束，总伤害 '+(eggOn()?format325(dmg):dmg.toLocaleString()));if(['final-boss','training-dummy'].includes(result?.kind))showResult();else roundEndBegin(g);}}
 }else if(state.view==='sandbox'&&state.sandbox?.phase==='battle'&&!state.paused){
  acc+=dt*state.speed;const deadline=live?0:performance.now()+BG_BUDGET_MS;
  while(acc>=1/30&&!state.sandbox.battle.s.finished){acc-=1/30;state.sandbox.battle.step();if(!live&&performance.now()>deadline)break;}
  if(state.sandbox.battle)playBattleEvents(state.sandbox.battle.s,live?state.muted:true,state.volume);
 }else acc=0;
 hudTime+=dt;saveTime+=dt;if(hudTime>.2){updateHud();hudTime=0;}if(saveTime>2&&g){save();saveTime=0;}
 if(live){roundEndTick(now);draw();}
}
function frame(now){
 if(runtimeFault){requestAnimationFrame(frame);return;}
 try{advance(now,!document.hidden);}
 catch(error){runtimeFault=error;state.paused=true;console.error('Native runtime paused',error);try{notice('战斗已暂停：'+(error?.message||String(error)));}catch{}}
 requestAnimationFrame(frame);
}
root.setAttribute('data-view','native');root.addEventListener('pointerdown',()=>unlockAudio(),{once:true});syncPlayChrome();render();document.getElementById('boot-screen')?.remove();clearTimeout(window.__garrisonBootTimer);window.__garrisonReady=true;requestAnimationFrame(frame);
