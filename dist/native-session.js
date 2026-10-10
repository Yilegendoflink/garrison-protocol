import {bountyOffers,bountyOption,bountyDecisionOffers} from './native-bounty.js';
import {NativeEconomy} from './native-economy.js';
import {NativeBattle} from './native-battle.js';
import {buildPhasePlan,singleDecisionRounds,blackboard,ensureStock,restoreStock,stockOf,INFINITE_FUNDS,ROUND_LEAK_CAP,HAND_LIMIT} from './protocol.js';
import {allowsHighlandPlacement} from './native-branches.js';
import {AVAILABLE_FINAL_BOSS_IDS,DEFAULT_FINAL_BOSS_HP_MULTIPLIER,finalBossConfig,finalBossPlacementArea,finalBossPlacementContains,normalizeFinalBossHpMultiplier,rollFinalBoss} from './native-final-boss.js';
import {runStrategyEvent} from './strategy.js';
import {buildFinalBossAddQueue,createWaveRoster,scheduleWaveQueue,waveRng} from './native-wave-random.js';
import {nativeWavePlan} from './native-waves.js';
import {bondBanIds,loadBondBan,normalizeBondBan} from './native-bond-ban.js';
// 干员默认技能（「战前准备」页保存的配置）：购买时按它决定新干员携带哪一档，读档时用来补齐/对齐副本。
import {applyPrepSkills} from './native-prep.js';
import {TOKEN_IDS} from './native-effects.js';
import {itemAllowed,operatorAllowed,seesRun,freeDeploy,settleFundsToLayers,grantCountForLayers,seesGrantCandidates,tartarusLayers,tartarusCap,SEES_BOND_ID,TARTARUS_BOND_ID} from './native-sees.js';
import {runWeeklyChallengeHook as dispatchWeeklyChallengeHook,validateWeeklyChallengeSnapshot} from './native-challenges.js';

// 召唤物落点不受主人攻击范围限制的类型（见 summonCardRange 的注释）。
const SUMMON_FREE_PLACEMENT=new Set(['cathy-device','skadi2-seaborn','silent-drone']);
const SUMMON_ZERO_OCCUPANCY=new Set(['cathy-device']);
const FINAL_BOSS_ROUND_CACHE=new WeakMap();
function finalBossRound(data,modeId){let rounds=FINAL_BOSS_ROUND_CACHE.get(data);if(!rounds){rounds=new Map();FINAL_BOSS_ROUND_CACHE.set(data,rounds);}if(!rounds.has(modeId))rounds.set(modeId,buildPhasePlan(data,modeId).filter(t=>t.isBossTurn&&!t.isConditional).at(-1)?.round??null);return rounds.get(modeId);}
// 召唤物的**同时部署上限**取它自己 token 的 `maxDeployCount`（爬行号·防护单元 = 2，正好对上天赋「最多部署2个」）。
const summonDeployCap=(data,type)=>{const t=data?.tokens?.[TOKEN_IDS[type]];return Number(t?.phases?.[0]?.attributesKeyFrames?.[0]?.data?.maxDeployCount)||Infinity;};

// 商店阶级概率（项目规定口径）：最高阶 30% / 次高阶 40% / 更低阶合计 30%。
// 抽卡顺序必须是「先掷阶级，再从该阶级的库存里抽」；掷到的阶级没库存时才回落到整池随机抽。
// 商店只有 1 个可及阶级时全部落在最高阶；只有 2 个阶级时「更低阶」为空，按下面的兜底并回最高阶。
const SHOP_TIER_ROLL=[[.3,'top'],[.7,'prev'],[Infinity,'lower']];

// 具名卡池：原表只给池名、不给成员表（模式包里搜不到 pool_chess_glady / pool_equip_* 的定义），
// 成员只能从效果文案与装备字段推出来。写法：
//   members：显式成员，[id,权重] 或 id（缺省权重 1，按权重铺开后等概率抽）
//   bond   ：成员 = 盟约为该值的装备（原表 giveBondId），用于「维式重锤」这类整套装备
//   any    ：文案没有限定成员的池子，等于「任意」，不需要额外过滤（登记在此备查）
// 依据（逐条可查）：
//   pool_chess_glady  garrison_39 歌蕾蒂娅「若同一行有3名干员，获得1个斯卡蒂、幽灵鲨或深巡」
//   pool_char_pinus   garrison_149 焰尾「获得1个野鬃或灰毫，小概率获得远牙」→ 远牙 20%（用户给定）
//   pool_equip_pepe   garrison_94 佩佩「获得1件“盟约之币”或“萨尔贡浓茶”，有小概率发现“黄沙罗盘”」
//                     → 黄沙罗盘沿用同一「小概率」口径 20%（待确认）
//   pool_equip_rockr  garrison_91 洛洛「随机制造1件洛洛的定制品」；洛洛是维多利亚干员，
//                     该盟约的定制装备即维式重锤系列（giveBondId=victoriaShip）
//   pool_equip_normal / pool_equip_kathe / pool_equip_narant：文案只说「随机装备／刷新3件装备／两件装备」
//   pool_chess_shop_N_reward：松果 garrison_116（a=I 阶 / b=V 阶「免费特殊招募」）。成员 = 该阶级的
//                     全部可见干员，按商店库存抽，所以只登记阶级（tier），不再靠池名里的 shop_(\d) 猜。
const NAMED_POOLS={
 pool_chess_glady:{members:['chess_char_3_05_a','chess_char_2_07_a','chess_char_1_04_a']},
 pool_char_pinus:{members:[['chess_char_1_19_a',4],['chess_char_2_18_a',4],['chess_char_4_20_a',2]]},
 pool_equip_pepe:{members:[['chess_item_1_03_e_a',4],['chess_item_2_04_e_a',4],['chess_item_6_07_e_a',2]]},
 pool_equip_rockr:{bond:'victoriaShip'},
 pool_equip_normal:{any:true},
 pool_equip_kathe:{any:true},
 pool_equip_narant:{any:true},
 pool_chess_shop_1_reward:{tier:1,any:true},
 pool_chess_shop_2_reward:{tier:2,any:true},
 pool_chess_shop_3_reward:{tier:3,any:true},
 pool_chess_shop_4_reward:{tier:4,any:true},
 pool_chess_shop_5_reward:{tier:5,any:true},
 pool_chess_shop_6_reward:{tier:6,any:true}
};
// 具名池的权重铺开：[[id,4],[id2,4],[id3,2]] → 10 项，抽到第 3 个的概率就是 20%，
// 而且仍然走 this.pick，测试里可以照旧把它定死。
const namedEntries=spec=>spec.members.map(m=>Array.isArray(m)?[m[0],Number(m[1])||1]:[m,1]);
const namedWeights=spec=>new Map(namedEntries(spec));
const namedPickList=(rows,weights,keyOf)=>rows.flatMap(row=>Array(Math.max(1,Math.round(weights.get(keyOf(row))))).fill(row));


export class NativeSession extends NativeEconomy {
 constructor(data,{modeId='mode_single_normal',bandId='band_bldsk',mapId,seed=Date.now(),waveRoster=null,bondBan=null,egg325=false,cat=false,playerId='local',teamPeers=[],teamTransport=null,finalBossId=null,finalBossHpMultiplier=DEFAULT_FINAL_BOSS_HP_MULTIPLIER,weeklyChallenge=null}={}){
  const map=data.maps.find(m=>m.stageId===mapId)||data.maps.find(m=>m.weight>0);super(data,modeId,{bandId,board:map,seed,manualPreview:true,playerId,teamPeers,cat});this.baseMap=map;this.map=map;this.teamTransport=teamTransport;this.battle=null;this.s.mapId=map.stageId;this.s.itemOffers=[];this.s.summonCards=[];this.s.capacity=8;this.s.passiveIncome=0;this.s.history=[];this.s.runResult=null;this.s.frozenSlots=[];this.s.roundDecisions=[];this.s.enemyModifiers=[];this.s.operatorModifiers=[];this.s.commands=[];
  if(weeklyChallenge&&!validateWeeklyChallengeSnapshot(weeklyChallenge))throw Error('每周挑战快照无效');
  if(weeklyChallenge)this.s.weeklyChallenge=structuredClone(weeklyChallenge);
  // 本局禁用的盟约（固定禁用的全部 + 随机抽中的 3 核心 + 4 附加）在开局定死，随存档保存；
  // 干员只有在「所属盟约全部被禁」时才被禁用。
  // 禁用方案默认取协议自定义「禁用方案」页配置的那份（localStorage；未配置时是默认方案：投资人固定不被随机禁用）；
  // 简报／沙盒／测试可以显式传 bondBan 覆盖。v3 起配置里不再有逐盟约的「不禁用名单」。
  // 必须在 rollOffers() 之前设好——商店第一次抽卡就读 this.s.bondBan。
  this.s.finalBossId=finalBossId||rollFinalBoss(data,modeId,seed);this.s.finalBossHpMultiplier=normalizeFinalBossHpMultiplier(finalBossHpMultiplier);this.s.finalBossAddSeed=((Number(seed)^0x5eeda11)>>>0);
  const banOption=bondBan;
  const normalized=normalizeBondBan(banOption||loadBondBan(this.data),this.data);
  this.s.bondBan=banOption
   ?{bonds:[...new Set((banOption.bonds||[]).filter(id=>this.data.season.bondInfoDict[id]))],always:normalized.always,never:normalized.never}
   :{bonds:bondBanIds(this.data,seed,normalized),always:normalized.always,never:normalized.never};
  this.poolDraw=request=>this.drawFromPool(request);this.s.offers=this.rollOffers();this.fillItems();this.startPreparation();this.ensureRewards();this.s.waveRoster=waveRoster||createWaveRoster({random:()=>this.random(),data:this.data,modeId:this.s.modeId,weeklyChallenge:this.s.weeklyChallenge});if(egg325)this.s.egg325=true;this.prepareDoorWaveQueue();
 }
 applyWeeklyChallengeHook(hook,payload,context={}){return dispatchWeeklyChallengeHook(this.s.weeklyChallenge,hook,payload,{session:this,...context});}
 summonCardSpecs(u){const p=this.data.profiles[u?.chessId],skillIndex=u?.skillIndex??p?.skillIndex??0,out=[];if(p?.branch==='tactician'){if(u.charId==='char_427_vigil')out.push({type:'vigil-wolf',name:'狼群',count:1,mode:'manual'});if(u.charId==='char_249_mlyss')out.push({type:'mlyss-fluid',name:'流形',count:1,mode:'manual'});}
  // 凯瑟琳「定向支援信号」：携带数量取天赋黑板 `cnt`（精英0 = 2，精英1/2 = 3），同时部署上限取 token 的 `maxDeployCount`（2）。
  if(u.charId==='char_4162_cathy'){const talent=(p?.activeTalents||[]).find(t=>t.name==='定向支援信号'),cnt=talent?Number(blackboard(talent.blackboard).cnt)||3:3;out.push({type:'cathy-device',name:'支援装置',count:cnt,mode:'manual'});}
  if(u.charId==='char_108_silent'&&skillIndex===1)out.push({type:'silent-drone',name:'医疗无人机',count:1,mode:'skill',placeable:true});
  // 浊心斯卡蒂的海嗣先由玩家在备战期选定布局点，开战与再部署转好后自动出现在该位置。
  if(u.charId==='char_1012_skadi2')out.push({type:'skadi2-seaborn',name:'海嗣',count:1,mode:'manual'});
  return out;}
 syncSummonCards({resetPlaced=false}={}){this.s.summonCards??=[];const owners=new Map(this.s.units.filter(u=>u.position&&this.summonCardSpecs(u).length).map(u=>[u.uid,u]));this.s.summonCards=this.s.summonCards.filter(card=>{const owner=owners.get(card.ownerUid),spec=owner&&this.summonCardSpecs(owner).find(x=>x.type===card.type);if(!spec)return false;if(resetPlaced)card.position=null;card.mode=spec.mode;card.placeable=!!spec.placeable;return true;});for(const owner of owners.values())for(const spec of this.summonCardSpecs(owner)){const existing=this.s.summonCards.filter(card=>card.ownerUid===owner.uid&&card.type===spec.type);for(let i=existing.length;i<spec.count;i++)this.s.summonCards.push({uid:++this.s.seq,kind:'summon-card',type:spec.type,name:spec.name,mode:spec.mode,placeable:!!spec.placeable,ownerUid:owner.uid,position:null,dir:0});}}
 hand(){return super.hand().sort((a,b)=>(a.handSlot??Number.MAX_SAFE_INTEGER)-(b.handSlot??Number.MAX_SAFE_INTEGER));}
 // 保留已有位置；基础区有几个空位就下放几张临时卡，不压缩其余手牌。
 syncHandSlots(){const cards=super.hand(),active=new Set(cards),all=[...this.s.units,...this.s.items,...(this.s.summonCards||[])],used=new Set();for(const card of all)if(!active.has(card))delete card.handSlot;for(const card of cards){if(Number.isSafeInteger(card.handSlot)&&card.handSlot>=0&&!used.has(card.handSlot))used.add(card.handSlot);else delete card.handSlot;}const overflow=cards.filter(c=>Number.isSafeInteger(c.handSlot)&&c.handSlot>=HAND_LIMIT).sort((a,b)=>a.handSlot-b.handSlot),free=[];for(let slot=0;slot<HAND_LIMIT;slot++)if(!used.has(slot))free.push(slot);for(let i=0;i<Math.min(overflow.length,free.length);i++){const card=overflow[i];used.delete(card.handSlot);card.handSlot=free[i];used.add(free[i]);}for(const card of cards)if(!Number.isSafeInteger(card.handSlot)){let slot=0;while(used.has(slot))slot++;card.handSlot=slot;used.add(slot);}return cards.sort((a,b)=>a.handSlot-b.handSlot);}
 // 召唤卡的落点规则（PRTS 分开写，别再统一套一套）：
 //  * 战术家分支特性：「可以在攻击范围内选择一次战术点来召唤援军」→ 狼群／流形必须在主人当前攻击范围内；
 //  * 工匠的支援装置（爬行号·防护单元）：召唤物页写「部署位置：全部位、部署占用数 0、不会受到攻击」，
 //    是与普通单位同级的装置，按格子选即可、**没有攻击范围限制**——此前统一套用战术家口径，
 //    导致凯瑟琳只能把装置放在自己脚下或身前那一格（用户 2026-09-22 报「召唤物依然不能正确放置在场上」）。
 summonCardRange(card,x,y){if(SUMMON_FREE_PLACEMENT.has(card.type))return true;const owner=this.s.units.find(u=>u.uid===card.ownerUid);if(!owner?.position)return false;const grids=this.data.profiles[owner.chessId]?.range?.grids||[];return grids.some(g=>{let dx=g.col,dy=-g.row;for(let i=0;i<(owner.dir||0);i++)[dx,dy]=[-dy,dx];return owner.position.x+dx===x&&owner.position.y+dy===y;});}
 canDeploySummonCard(cardUid,x,y){if(this.s.phase!=='prep')return false;const card=this.s.summonCards?.find(c=>c.uid===cardUid),cell=this.map.grid[y]?.[x];if(!card||!cell||cell.buildableType==='NONE'||cell.obstacle||!this.summonCardRange(card,x,y)||finalBossPlacementContains(this.finalBossPrepArea(),x,y))return false;if(card.type==='cathy-device'&&this.s.summonCards.filter(c=>c.uid!==card.uid&&c.ownerUid===card.ownerUid&&c.type===card.type&&c.position).length>=summonDeployCap(this.data,card.type))return false;if(card.type==='vigil-wolf'&&cell.heightType==='HIGHLAND')return false;return SUMMON_ZERO_OCCUPANCY.has(card.type)||(!this.s.units.some(u=>u.position?.x===x&&u.position?.y===y)&&!this.s.summonCards.some(c=>c.uid!==card.uid&&c.position?.x===x&&c.position?.y===y));}
 deploySummonCard(cardUid,x,y,dir=0){if(!this.canDeploySummonCard(cardUid,x,y))return false;const card=this.s.summonCards.find(c=>c.uid===cardUid);card.position={x,y};card.dir=dir;return true;}
 withdrawSummonCard(cardUid){if(this.s.phase!=='prep')return false;const card=this.s.summonCards?.find(c=>c.uid===cardUid&&c.position);if(!card||this.handFull())return false;card.position=null;return true;}
 // 所属盟约全部被禁的干员不进调配池。判定只有这一条：
 // 只要挂在某个被禁盟约名下又不在那份名单里，就禁用——哪怕它还挂着没被禁的盟约。
 // eligible() 是抽卡的唯一准入过滤点（商店、具名池、'later' 池都走它），所以过滤器只挂在这里；
 // 判定与名单本身在 NativeEconomy.bondBanned（商店以外还有固定点名发放要挡，见那边的注释）。
 isOperatorBanned(chessId){return this.bondBanned(chessId);}
 eligible(){return Object.values(this.data.season.charShopChessDatas).filter(o=>operatorAllowed(this.data,o,this)&&!this.isOperatorBanned(o.chessId));}
 // 奖励候选之间不能重复：同一次奖励里出现的卡必须互不相同。
 // 卡池可选项不足时少给几项，不用重复卡补足显示数量。
 drawDistinct(request,count,exclude=[]){
  const seen=[...exclude],offers=[];
  for(let i=0;i<count;i++){
   let id=null;
   try{id=this.drawFromPool({...request,exclude:seen});}catch{id=null;}
   if(id==null)break;
   offers.push(id);seen.push(id);
  }
  return offers;
 }
 // used 只在商店刷新时传入：同一家店对库存无放回，避免给出比库存更多的同名卡
 drawFromPool(r,used=null){
  if(r.kind==='item'){
   const pool=String(r.pool||''),fixedTier=r.tier||Number(pool.match(/shop_(\d)/)?.[1]),named=NAMED_POOLS[pool];
   const pooled=Boolean(named?.members||named?.bond);
   // 突变细胞只由「不稳定要素」发放，不进商店刷新池。
   // 带特殊词条的维式重锤仍只走维多利亚专属奖励池；1 阶基础版仍可进入常规商店。
   const storePool=!pool,shopOffer=!!r.shop,isVictoriaSpecial=item=>(item.normal?.giveBondId==='victoriaShip'||this.data.season.trapChessDataDict[item.id]?.giveBondId==='victoriaShip')&&Number(item.rank)>1,isMutationCell=item=>item.id==='chess_item_5_08_e_a',eligible=item=>itemAllowed(item,this)&&(!storePool||!isVictoriaSpecial(item))&&(!shopOffer||!isMutationCell(item));
   let items=this.data.items.filter(i=>eligible(i)&&(pooled||i.rank<=this.s.level));
   if(fixedTier)items=this.data.items.filter(i=>eligible(i)&&i.rank===fixedTier);
   const bond=named?.bond||(pool.includes('equip_vict')?'victoriaShip':null);
   if(bond)items=items.filter(i=>i.normal?.giveBondId===bond||this.data.season.trapChessDataDict[i.id]?.giveBondId===bond);
   if(named?.members){const weights=namedWeights(named);items=items.filter(i=>weights.has(i.id));if(items.length)return this.pick(namedPickList(items,weights,i=>i.id)).id;}
   if(!items.length)throw Error('没有可用装备');
   return this.pick(items).id;
  }
  const pool=String(r.pool||''),named=NAMED_POOLS[pool],fixedTier=r.tier||named?.tier||Number(pool.match(/shop_(\d)/)?.[1]);
  if(named?.members){const weights=namedWeights(named),skip=new Set((r.exclude||[]).filter(Boolean)),members=this.eligible().filter(o=>weights.has(o.chessId)&&!skip.has(o.chessId));if(!members.length)throw Error('具名卡池没有可用干员：'+pool);return this.pick(namedPickList(members,weights,o=>o.chessId)).chessId;}
  let rows=this.eligible();if(fixedTier)rows=rows.filter(o=>o.chessLevel===fixedTier);else rows=rows.filter(o=>o.chessLevel<=(r.maxTier||this.s.level));
  // 有库存系统时（对局内），候选池按各干员剩余库存铺成多份后等权抽；used 让同一次刷新无放回
  // exclude 用于奖励这一类「本次候选之间不能重复」的场景：直接从候选里剔除，而不是靠重抽碰运气。
  const exclude=new Set((r.exclude||[]).filter(Boolean));
  const stockPool=!!this.s.stock,limited=stockPool&&!!used;
  const inStock=o=>stockOf(this.data,this.s,o.chessId)-(used?.[o.chessId]||0)>0;
  if(r.bond&&this.bondHasCandidates(r.bond,r.maxTier||this.s.level))rows=rows.filter(o=>this.operatorBonds(o.chessId).includes(r.bond));if(r.excludeCharId)rows=rows.filter(o=>o.charId!==r.excludeCharId);
  // 被禁盟约在本局一个人都发不出来时不要抛错：本局该盟约是缺席的，「本次刷新优先取某盟约」这种
  // **偏好型**请求直接忽略偏好、按普通规则抽（上面那行就是这么跳过的）；「发一名该盟约干员」这类
  // **权益型**请求由调用点先问 bondHasCandidates／gainableBonds，发不出来就不发，别在这里给出
  // 另一个盟约的干员。
  if(pool.includes('later'))rows=this.eligible().filter(o=>o.chessLevel>=4&&this.data.season.charChessDataDict[o.chessId].bondIds.includes('lateranoShip'));
  if(!rows.length)throw Error('当前候选池没有匹配干员');
  const allowed=exclude.size?rows.filter(o=>!exclude.has(o.chessId)):rows;
  if(allowed.length)rows=allowed;
  const available=limited?rows.filter(inStock):rows;
  if(!available.length)throw Error('当前候选池没有可用库存');
  // 抽卡两步走：先按商店等级掷出阶级（最高阶 30% / 次高阶 40% / 更低阶合计 30%），
  // 再从掷中阶级的库存里抽；该阶级已经没库存（或被排除）时，用本次刷新的整池随机代替。
  // 档位按「商店等级可及的候选」算而不是按库存算，所以掷中卖空的阶级是正常情况，走上面的回落。
  let tier=[];
  if(!fixedTier&&r.maxTier&&!pool.includes('later')){
   const maxTier=Math.max(...rows.map(o=>o.chessLevel)),previous=maxTier-1;
   const top=rows.filter(o=>o.chessLevel===maxTier),prev=rows.filter(o=>o.chessLevel===previous),lower=rows.filter(o=>o.chessLevel<previous);
   // 只有 1 个可及阶级（或次高阶缺档）时结果与 roll 无关，就不掷这一下，免得白挪随机数流。
   if(maxTier<=1)tier=top;
   else if(!prev.length)tier=top.length?top:lower;
   else{const roll=this.random();for(const [limit,key] of SHOP_TIER_ROLL)if(roll<limit){tier=key==='top'?top:key==='prev'?prev:lower;break;}}
   if(!tier?.length)tier=top.length?top:prev.length?prev:lower;
   if(!tier.length)throw Error('当前候选池没有匹配阶级');
  }
  const fromTier=tier.filter(o=>available.includes(o)),list=fromTier.length?fromTier:available;
  const weighted=rows_=>{const copies=[];for(const o of rows_){if(exclude.has(o.chessId))continue;for(let i=stockOf(this.data,this.s,o.chessId)-(used?.[o.chessId]||0);i>0;i--)copies.push(o);}return copies.length?copies[Math.floor(this.random()*copies.length)]:null;};
  let row=null;
  if(stockPool){row=weighted(list)??(fromTier.length?weighted(available):null);if(!row)throw Error('当前候选池没有可用库存');}
  else row=this.pick(list);
  if(used&&stockPool)used[row.chessId]=(used[row.chessId]||0)+1;
  return pool.includes('later')?row.goldenChessId:row.chessId;
 }
 // 商店候选取自「库存池」：每个干员按剩余库存占权重，整池无放回抽。
 // 库存 3/3/4 的三人等价于十张卡等权，同一家店也不会给出比库存更多的同名卡。
 rollOffers(preferBond=null){const required=runStrategyEvent(this,'refreshRequirements'),used={};const draw=extra=>{try{return this.drawFromPool({kind:'operator',maxTier:this.s.level,...extra},used);}catch{return null;}};const rows=Array.from({length:this.terms().operatorSlots},()=>preferBond?(draw({bond:preferBond})??draw({})):draw({}));for(const r of required){if(r.bond)for(let i=0;i<r.minCount;i++)rows[i]=draw({bond:r.bond})??rows[i];if(r.duplicateCount&&rows[0]){const cap=Number.isFinite(this.s.stock?.[rows[0]])?this.s.stock[rows[0]]:Infinity;for(let i=1;i<rows.length&&i<r.duplicateCount&&i<cap;i++)rows[i]=rows[0];}}return rows;}
 fillItems(){this.s.itemOffers=Array.from({length:this.terms().itemSlots},()=>this.drawFromPool({kind:'item',shop:true}));}
 ensureRewards(){const r=this.s.rewardPending;if(r?.tier&&!r.offers){r.offers=this.drawDistinct({kind:'operator',tier:r.tier},3);r.kind='operator';}}
 rewardFromBond(owner,count){const bonds=this.gainableBonds(owner,this.s.level).filter(Boolean);if(!bonds.length)return false;this.s.rewardPending={offers:this.drawDistinct({kind:'operator',bond:this.pick(bonds),maxTier:this.s.level},count),choice:1,kind:'operator'};return true;}
 rewardFromTier(tier,count){this.s.rewardPending={offers:this.drawDistinct({kind:'operator',tier:Math.min(6,tier)},count),choice:1,kind:'operator'};return true;}
 applyPostBattleTransforms(){for(const u of this.s.units.filter(x=>x.transformAfterBattle)){if(!this.s.units.includes(u))continue;const itemIndex=(u.equipment||[]).findIndex(item=>{const def=this.data.season.trapChessDataDict[item.chessId];return(this.data.season.effectBuffInfoDataDict[def?.effectId]||[]).some(e=>e.key==='char_chess_transformation_equip');});if(itemIndex<0){delete u.transformAfterBattle;continue;}const id=this.drawFromPool({kind:'operator',tier:Math.min(6,(u.rank||1)+1)}),shop=this.data.season.charShopChessDatas[id];u.chessId=id;u.charId=shop.charId;u.rank=shop.chessLevel;this.s.items.push(u.equipment.splice(itemIndex,1)[0]);delete u.transformAfterBattle;this.refreshEquipmentBonds(u);this.onOperatorGained(u);}}
  // 装备增减后重算盟约：以干员自身盟约为底。**装备的 giveBondId 是它自己的盟约归属**（商店与具名池按它取货），
  // 不会让携带者变成该盟约干员——否则给谁都装一件「谢拉格不融冰」就能凑出谢拉格层数、触发 6 层寒风。
  // 只有 canGiveBond 的装备（变形同构体）才给携带者盟约，而且给的是「另一件携带装备」的盟约：
  // 原表天赋栏那 14 条映射与对方 giveBondId 逐条一致（tests/native-equipment-growth.test.mjs 有门禁）。
 refreshEquipmentBonds(u){
  const base=this.operatorBonds(u.chessId);
  const items=u.equipment||[];
  const grants=items.some(i=>this.data.season.trapChessDataDict[i.chessId]?.canGiveBond===true);
  const extra=grants?[...new Set(items.map(i=>this.data.season.trapChessDataDict[i.chessId]).filter(d=>d&&d.canGiveBond!==true).map(d=>d.giveBondId).filter(Boolean))]:[];
  const next=[...new Set([...base,...extra])];
  const cur=u.bondIds||base;
  if(next.length!==cur.length||next.some(id=>!cur.includes(id)))u.bondIds=next;
 }
  // 装备的合成（整备区优先取材料、合成结果进整备区）只在 NativeEconomy.gainItem 实现一份，这里不要再覆盖。
 shopAllFrozen(){if(this.s.locked)return true;const offers=this.s.offers||[],items=this.s.itemOffers||[],frozen=new Set(this.s.frozenSlots||[]),liveOffers=offers.map((id,i)=>id?i:-1).filter(i=>i>=0);return (liveOffers.length>0||items.some(Boolean))&&!items.some(Boolean)&&liveOffers.every(i=>frozen.has(i));}
 perform(type,...args){
  const before=structuredClone(this.s);let result;
  try{
   if(type==='refresh'){const frozen=this.s.frozenSlots?.slice()||[],previous=this.s.offers.slice(),offers=this.rollOffers(this.s.forcedRefresh?.bond);for(const index of frozen)if(previous[index])offers[index]=previous[index];if(frozen.length){const free=offers.map((_,i)=>i).filter(i=>!frozen.includes(i));if(free.length>1)offers[free[1]]=offers[free[0]];}result=this.refresh(offers);if(result)this.fillItems();}
   // 升级只解锁更高阶的干员候选，不动装备商品槽：装备槽只按回合刷新（advanceRound 里的 fillItems）
   else if(type==='upgrade'){result=this.upgrade();}
   else if(type==='lock'){if(this.s.phase!=='prep')return false;if(this.shopAllFrozen()){this.s.locked=false;this.s.frozenSlots=[];}else this.s.locked=true;result=true;}
  else if(type==='withdraw'){const u=this.s.units.find(u=>u.uid===args[0]);if(this.s.phase!=='prep'||!u?.position||this.handFull())return false;u.position=null;this.settleBondRewards();result=true;}
  else if(type==='withdrawSummon')result=this.withdrawSummonCard(args[0]);
   else if(type==='skill'){
    const u=this.s.units.find(u=>u.uid===args[0]),p=this.data.profiles[u?.chessId],index=args[1];if(this.s.phase!=='prep'||!u||!p.skillChoices[index])return false;
    // 同名牌统一技能（用户 2026-09-22 口径）：同一名干员（按 charId 归并，精锐与初始算同一名）的副本必须用同一个技能，
    // 所以改一次就把所有副本一起改——场上的保证了「同名干员技能一致」，整备区的也一起改，免得之后上场又出现不一致。
    // 只在副本自己的 skillChoices 有这一档时才改（形态之间技能档数可能不同）。
    for(const unit of this.s.units)if(unit.charId===u.charId&&this.data.profiles[unit.chessId]?.skillChoices?.[index])unit.skillIndex=index;
    result=true;
   }
   else if(type==='buyItem')result=this.buyItem(args[0]);
   else if(type==='equip')result=this.equip(args[0],args[1],args[2]);
   else if(type==='bounty')result=this.chooseBounty(args[0]);
   else if(type==='discard'){if(this.s.phase!=='prep')return false;this.s.items=this.s.items.filter(i=>i.uid!==args[0]);result=true;}
   else if(type==='destroy')result=this.destroyItem(args[0]);
   else if(type==='destroyEquip')result=this.destroyEquipment(args[0],args[1]);
  else if(type==='deploySummon')result=this.deploySummonCard(args[0],args[1],args[2],args[3]);
   else if(type==='start')result=this.startBattle();
   else if(type==='mineCommand'){if(this.s.phase!=='battle')return false;result=this.battle?.toggleMineCamp(args[0])??false;}
   else if(type==='next')result=this.advanceRound();
   else if(type==='decision')result=this.chooseDecision(args[0]);
   else{const r=this.command(type,...args);result=r.ok;if(!result)throw Error(r.message||'当前条件不能执行此操作');}
   if(result===false){this.s=before;return false;}if(this.s.phase==='prep')this.syncSummonCards();this.ensureRewards();this.s.commands.push({round:this.s.round,type,args});if(type==='takePromotion'&&this.s.prepApplied&&!this.s.rewardPending)this.startBattle();return true;
  }catch(error){this.s=before;this.triggerChain=[];this.lastError=error.message;return false;}
 }
 buyItem(index){if(this.s.phase!=='prep'||this.s.rewardPending)return false;const id=this.s.itemOffers[index],item=this.data.season.trapChessDataDict[id];if(!item||this.handFull()||!this.spend(item.purchasePrice))return false;this.s.itemOffers[index]=null;this.gainItem(id);return true;}
 // 主动销毁：手牌里的装备直接移除；干员身上的装备从槽位移除（不退回手牌）。
 destroyItem(itemUid){if(this.s.phase!=='prep')return false;const item=this.s.items.find(i=>i.uid===itemUid);if(!item)return false;this.s.items=this.s.items.filter(i=>i.uid!==itemUid);this.s.events.push({type:'destroyItem',uid:itemUid,chessId:item.chessId});const row=this.equipRowsOf({equipment:[item]}).find(r=>r.key==='trap_disney_special');if(row)this.addFunds(Number(row.bb.count)||1);return true;}
 destroyEquipment(unitUid,slot){if(this.s.phase!=='prep')return false;const u=this.s.units.find(x=>x.uid===unitUid);if(!u||!Number.isInteger(slot))return false;const item=u.equipment[slot];if(!item)return false;u.equipment.splice(slot,1);this.refreshEquipmentBonds(u);this.s.events.push({type:'destroyItem',uid:item.uid,chessId:item.chessId});return true;}
 equip(itemUid,unitUid,replaceIndex=null){
  if(this.s.phase!=='prep')return false;const item=this.s.items.find(i=>i.uid===itemUid),u=this.s.units.find(u=>u.uid===unitUid);if(!item||!u)return false;const originalChessId=u.chessId,def=this.data.season.trapChessDataDict[item.chessId],effects=this.data.season.effectBuffInfoDataDict[def.effectId]||[];let consumed=false;
  if(def.itemType==='MAGIC'){const effect=effects.find(e=>e.key==='trap_create_self_choice'||e.key==='trap_copy_front_char');if(effect?.key==='trap_create_self_choice'){this.s.rewardPending={kind:'bounty',choice:1,offers:bountyOffers(this.data,this.s.randomState^itemUid)};consumed=true;}if(effect?.key==='trap_copy_front_char'){const copy=this.gain(u.chessId);copy.equipment=(u.equipment||[]).map(i=>({uid:++this.s.seq,chessId:i.chessId}));copy.bondIds=[...this.ownBonds(u)];consumed=true;}if(consumed){this.s.items=this.s.items.filter(i=>i.uid!==itemUid);return true;}}
  for(const e of effects){const p=blackboard(e.blackboard);if(e.key==='equip_destory_gain_random_coin'){this.addFunds(p.min+Math.floor(this.random()*(p.max-p.min+1)));consumed=true;}if(e.key==='use_equip_gain_coin_when_next_round_start'){this.s.nextRoundBonus+=p.count;consumed=true;}if(e.key==='gain_coin_when_round_start'){this.s.passiveIncome+=p.count;consumed=true;}if(e.key==='use_equip_reward_char_chess_bond_layer'){for(const b of this.ownBonds(u))this.addLayers(b,p.layer,false);consumed=true;}if(e.key==='equip_destory_deployment_cnt_change'){this.s.capacity=p.count;consumed=true;}if(e.key==='equip_round_start_upgrade_char')u.projectionUpgrade={itemUid:item.uid};if(e.key==='use_equip_upgrade_char'){const next=this.data.season.charChessDataDict[u.chessId].upgradeChessId;if(next)u.chessId=next;consumed=true;}if(e.key==='use_equip_reward_char_chess'){const initial=this.data.season.chessNormalIdLookupDict[u.chessId]||u.chessId,owned=this.s.units.filter(x=>(this.data.season.chessNormalIdLookupDict[x.chessId]||x.chessId)===initial).length,bonds=this.gainableBonds(u,this.s.level);if(owned>=2)this.gain(initial);else if(bonds.length)this.gain(this.drawFromPool({kind:'operator',bond:this.pick(bonds),maxTier:this.s.level}));consumed=true;}if(e.key==='use_equip_reward_char_chess_with_same_bond'){const bonds=this.gainableBonds(u,this.s.level);if(!bonds.length)throw Error('没有可招募的同盟约干员');for(let n=0;n<p.count;n++){const chessId=this.drawFromPool({kind:'operator',bond:this.pick(bonds),maxTier:this.s.level});if(!this.gain(chessId))throw Error('同盟约干员无法获得');}consumed=true;}if(e.key==='use_equip_reward_random_char_chess_in_shop'){const indices=this.s.offers.map((x,i)=>x?i:null).filter(x=>x!==null);for(let n=0;n<p.count&&indices.length;n++){const index=indices.splice(Math.floor(this.random()*indices.length),1)[0];this.gain(this.s.offers[index]);this.s.offers[index]=null;}consumed=true;}}
  for(const e of effects){const p=blackboard(e.blackboard);if(e.key==='use_equip_reward_special_goods_char_chess')consumed=this.rewardFromBond(u,p.refresh_cnt||3)||consumed;if(e.key==='use_equip_recruit_new_char_and_give_char_to_player_most_bond'){this.rewardFromTier(u.rank||1,p.refresh_cnt||2);if(this.s.bandId==='band_fang'){this.queueFangTransfer(u,{includeEquipment:false});this.s.items.push(...(u.equipment||[]));u.equipment=[];this.refreshEquipmentBonds(u);}this.s.units=this.s.units.filter(x=>x!==u);consumed=true;}if(e.key==='char_chess_transformation_equip')u.transformAfterBattle=true;if(e.key==='use_equip_upgrade_char'){const normal=this.data.season.chessNormalIdLookupDict[u.chessId]||u.chessId,golden=this.data.season.charShopChessDatas[normal]?.goldenChessId;if(golden)u.chessId=golden;consumed=true;}}
  if(!consumed){if(u.equipment.length>=2){if(replaceIndex===null)return false;const old=u.equipment.splice(replaceIndex,1)[0];if(old)this.s.items.push(old);}u.equipment.push(item);this.refreshEquipmentBonds(u);}
  this.s.items=this.s.items.filter(i=>i.uid!==itemUid);this.settleBondRewards();if(u.chessId!==originalChessId){this.refreshEquipmentBonds(u);this.onOperatorGained(u);}return true;
 }
 chooseBounty(id){const reward=this.s.rewardPending;if(this.s.phase!=='prep'||reward?.kind!=='bounty'||!reward.offers.includes(id))return false;const option=bountyOption(this.data,id);if(!option)return false;this.s.pendingBounty={enemyId:option.enemyId,coin:option.coin,count:option.count};this.s.rewardPending=this.s.rewardQueue.shift()||null;this.prepareDoorWaveQueue(this.s.round,{force:true});return true;}
 finalBossPrepArea(){if(this.s.phase!=='prep'||this.s.round!==finalBossRound(this.data,this.s.modeId))return null;return finalBossPlacementArea(this.map,finalBossConfig(this.data,this.s.finalBossId,this.s.modeId).enemyId);}
 canDeploy(uid,x,y){
  if(!Number.isInteger(x)||!Number.isInteger(y))return false;
  const u=this.s.units.find(u=>u.uid===uid),cell=this.map.grid[y]?.[x];if(!u||!cell||this.s.phase!=='prep'||cell.buildableType==='NONE'||finalBossPlacementContains(this.finalBossPrepArea(),x,y))return false;
  const valid=(unit,tile)=>{const p=this.data.profiles[unit.chessId];return tile.heightType!=='HIGHLAND'||p.position!=='MELEE'||allowsHighlandPlacement(p);};if(!valid(u,cell))return false;
  const other=this.s.units.find(v=>v.uid!==uid&&v.position?.x===x&&v.position?.y===y),old=u.position;
  // 已放置的召唤物卡也占格：干员不能压在别人的卡上（自己的卡会随干员移动清位）；
  // 凯瑟琳支援装置虽不占部署位，但不能再放置干员与其重叠。
  if((this.s.summonCards||[]).some(c=>c.position?.x===x&&c.position?.y===y&&(c.type==='cathy-device'||c.ownerUid!==uid&&!SUMMON_ZERO_OCCUPANCY.has(c.type))))return false;
  // 虎狼丸的「不占用部署位」：它自己不占名额，所以判定要看「放下去之后」的计数
  // （8 名普通干员已满时它仍能上场，而它在场也不挡别的干员）。
  if(!old&&!other){
   const used=this.s.units.filter(v=>v.position&&!freeDeploy(this.data,v)).length,adds=freeDeploy(this.data,u)?0:1;
   if(used+adds>this.s.capacity)return false;
  }
  return !other||!old||valid(other,this.map.grid[old.y][old.x]);
 }
 deploy(uid,x,y,dir){
  if(!Number.isInteger(dir)||dir<0||dir>3||!this.canDeploy(uid,x,y))return false;
  const u=this.s.units.find(u=>u.uid===uid),other=this.s.units.find(v=>v.uid!==uid&&v.position?.x===x&&v.position?.y===y),old=u.position;
  if(other)other.position=old;u.position={x,y};u.dir=dir;
  // 交换双方都发生了位置变化；被动换位的持有者也必须清掉自己的召唤物布局。
  const movedOwners=new Set();if(old&&(old.x!==x||old.y!==y))movedOwners.add(u.uid);if(other)movedOwners.add(other.uid);
  for(const card of this.s.summonCards||[])if(movedOwners.has(card.ownerUid))card.position=null;
  this.settleBondRewards();this.syncSummonCards();return true;
 }
 fangRecipient(bonds){const peers=(this.s.teamPeers||[]).filter(p=>p?.playerId&&p.playerId!==this.s.playerId);if(!peers.length)return null;const scored=peers.map(peer=>({peer,score:Math.max(0,...bonds.map(id=>Number(peer.bondCounts?.[id]??0)))})),max=Math.max(...scored.map(x=>x.score));return this.pick(scored.filter(x=>x.score===max).map(x=>x.peer));}
 queueFangTransfer(u,{includeEquipment=true}={}){const bonds=this.ownBonds(u).filter(Boolean),recipient=this.fangRecipient(bonds),record={transferId:`fang:${this.s.playerId}:${this.s.round}:${u.uid}:${this.s.seq}`,senderId:this.s.playerId,recipientId:recipient?.playerId||null,dueRound:this.s.round+1,chessId:u.chessId,charId:u.charId,rank:u.rank,skillIndex:u.skillIndex??0,bondIds:[...bonds],equipment:includeEquipment?(u.equipment||[]).map(i=>({chessId:i.chessId})):[]};this.s.transferOutbox.push(record);if(this.teamTransport?.send){try{const accepted=this.teamTransport.send(structuredClone(record));if(accepted===true)record.sent=true;}catch{record.transportError='send-failed';}}return record;}
 attachTeamTransport(teamTransport){this.teamTransport=teamTransport;return this;}
 takeFangTransfers(){const pending=this.s.transferOutbox.filter(r=>!r.sent);for(const r of pending)r.sent=true;return structuredClone(pending);}
 receiveFangTransfer(record){if(!record?.transferId||record.recipientId!==this.s.playerId||!this.data.profiles[record.chessId]||this.s.strategyClaims[`fang:received:${record.transferId}`]||this.s.transferInbox.some(r=>r.transferId===record.transferId))return false;this.s.transferInbox.push(structuredClone(record));return true;}
 applyTransferInbox(){const due=[],keep=[];for(const record of this.s.transferInbox||[])(record.dueRound??0)<=this.s.round?due.push(record):keep.push(record);this.s.transferInbox=keep;for(const record of due){if(this.s.strategyClaims[`fang:received:${record.transferId}`])continue;const unit=this.gain(record.chessId);this.s.strategyClaims[`fang:received:${record.transferId}`]=1;if(!unit)continue;unit.bondIds=[...(record.bondIds||this.ownBonds(unit))];unit.skillIndex=record.skillIndex??unit.skillIndex;unit.equipment=(record.equipment||[]).map(i=>({uid:++this.s.seq,chessId:i.chessId}));}}
 activateRoundMap(){this.map=this.baseMap;this.board=this.baseMap;delete this.s.mapVariant;return this.map;}
 startPreparation(){this.activateRoundMap();const result=super.startPreparation();if(result){this.applyTransferInbox();if(this.s.bandId==='band_amedic'&&!this.s.strategyClaims.touchReserve){const u=this.gain('chess_virtual_prepared_medic');this.s.strategyClaims.touchReserve=1;if(u)u.touchReserve=true;}}return result;}
  // 获得干员是本回合「获得过几名干员」的唯一登记点：天师古鼎的攻速叠层（战斗期）与资金（备战期）都读它。
  // 禁用盟约的干员在**所有**渠道都拿不到（用户 2026-09-22 口径）：商店抽取靠 eligible() 过滤，
  // 策略／道具的固定点名发放、卫戍 SERVER_GAIN_CHAR、援军转让、精锐形态则在这里统一挡下——
  // 一个都不发、不记账（roundGainedChars 不加），只留一条事件与计数器给界面提示。
  onOperatorGained(unit){
   unit=super.onOperatorGained(unit);if(!unit)return unit;
   // 「战前准备」里设置的默认技能：新获得的干员默认携带指定档位。只对齐**这名干员自己的**同名副本。
   applyPrepSkills(this.data,this.s.units.filter(v=>v.charId===unit.charId));
   if(this.s.roundGainedChars?.round!==this.s.round)this.s.roundGainedChars={round:this.s.round,count:0};
   this.s.roundGainedChars.count++;this.gainCharEquipEffects();return unit;
  }
  gain(chessId){
   if(this.bondBanned(chessId)){
    const bonds=this.bondBanBlockers(chessId);
    this.s.bondBanBlocks=(this.s.bondBanBlocks||0)+1;this.s.bondBanLast={chessId,bonds};
    this.s.events.push({type:'bond-ban-block',chessId,round:this.s.round,bonds});
    return null;
   }
   return super.gain(chessId);
  }
  // 携带者装备的全部效果行（备战期按 key 判定）。
  equipRowsOf(unit){return (unit?.equipment||[]).flatMap(item=>{const def=this.data.season.trapChessDataDict[item.chessId];return (this.data.season.effectBuffInfoDataDict[def?.effectId]||[]).map(row=>({key:row.key,bb:blackboard(row.blackboard)}));});}
  // 天师古鼎＋炎国短刀：携带者为该行 bond 盟约时，每次获得干员获得 count 资金（每回合最多 max 次）。
  gainCharEquipEffects(){
   for(const owner of this.s.units){
    const row=this.equipRowsOf(owner).find(r=>r.key==='equip_with_another_gain_coin_when_gain_char');if(!row)continue;
    const bond=String(row.bb.bond||'');if(bond&&!this.ownBonds(owner).includes(bond))continue;
    const other=String(row.bb.other_equip||'').split(',').map(x=>x.trim()).filter(Boolean);
    if(!other.length||!(owner.equipment||[]).some(item=>other.some(prefix=>item.chessId===prefix||item.chessId.startsWith(prefix))))continue;
    const max=Math.max(1,Number(row.bb.max)||3),count=Number(row.bb.count)||0;if(count<=0)continue;
    if(this.s.tianshiRound!==this.s.round){this.s.tianshiRound=this.s.round;this.s.tianshiCount=0;}
    if(this.s.tianshiCount>=max)continue;
    this.s.tianshiCount++;this.addFunds(count);
   }
  }
  // 博士投影（普通）：下个回合开始时销毁该装备并让携带者晋升为精锐干员；装备已被销毁/换下就不再晋升。
  applyProjectionUpgrades(){
   for(const u of this.s.units){
    const pending=u.projectionUpgrade;if(!pending)continue;
    delete u.projectionUpgrade;
    const index=(u.equipment||[]).findIndex(i=>i.uid===pending.itemUid);if(index<0)continue;
    u.equipment.splice(index,1);
    const next=this.data.season.charChessDataDict[u.chessId]?.upgradeChessId;
    if(next){u.chessId=next;u.charId=this.data.season.charShopChessDatas[next]?.charId??u.charId;this.refreshEquipmentBonds(u);this.onOperatorGained(u);}else this.refreshEquipmentBonds(u);
   }
  }
 applyTouchReplacement(){if(this.s.bandId!=='band_amedic'||this.s.strategyClaims.touchReplacement)return false;const elites=this.s.units.filter(u=>u.position&&this.data.season.charChessDataDict[u.chessId]?.isGolden).length,target=this.s.units.find(u=>u.touchReserve);if(elites<2||!target)return false;target.chessId='chess_virtual_touch';target.charId='char_613_acmedc';target.rank=6;target.touchReserve=false;this.refreshEquipmentBonds(target);this.onOperatorGained(target);this.s.strategyClaims.touchReplacement=1;return true;}
 // S.E.E.S. 策略（band_sees）的回合结算：**开战前**把剩余资金全部换成【塔尔塔罗斯】层数。
 // 用户口径是「回合结束时消耗剩余所有资金」，而 beginBattle 会把资金清零，所以这是唯一还有余额的时刻；
 // 层数每跨过 25 层补发一名不高于当前商店阶级的 S.E.E.S. 干员（优先不与场上已有的重复）。
 // 账本都在 s 上：层数 `bondLayers.tartarusShip`、已发到第几档 `seesGrants`（发不出去就不推进档位，下回合再试）。
 settleTartarusRound(){
  if(!seesRun(this))return 0;
  const gained=settleFundsToLayers(this.data,this,this.s.units);
  this.setFunds(0);
  const maxGrants=grantCountForLayers(this.data,tartarusCap(this.data)),want=Math.min(maxGrants,grantCountForLayers(this.data,tartarusLayers(this))),stored=Number(this.s.seesGrants),have=Number.isFinite(stored)?Math.max(0,Math.min(maxGrants,Math.floor(stored))):0;
  let issued=0;
  for(let remaining=Math.max(0,want-have);remaining>0;remaining--){
   const {pool,fresh}=seesGrantCandidates(this.data,this,{exclude:this.s.units.map(u=>u.charId)});
   const list=fresh.length?fresh:pool;
   if(!list.length)break;
   const row=list[Math.min(list.length-1,Math.floor(this.random()*list.length))];
   const before=structuredClone(this.s);
   try{if(!this.gain(row.id))break;}catch(error){this.s=before;this.s.events??=[];this.s.events.push({type:'sees-grant-deferred',chessId:row.id,round:this.s.round,reason:String(error?.message||error)});break;}
   issued++;
   if(this.s.rewardPending)break;
  }
  this.s.seesGrants=have+issued;
  return gained;
 }
 resolveTurn(turn){if(!turn?.isBossTurn||turn.isConditional)return turn;const finals=buildPhasePlan(this.data,this.s.modeId).filter(t=>t.isBossTurn&&!t.isConditional);if(turn.round!==finals.at(-1)?.round)return turn;const config=finalBossConfig(this.data,this.s.finalBossId,this.s.modeId,this.s.finalBossHpMultiplier);return {...turn,finalBossId:this.s.finalBossId,finalBoss:config,finalBossHp:config.hp};}
 doorForRoute(route,routes=this.map.bossDoorRoutes){
  const start=route?.startPosition,origin=this.map.origin||{col:0,row:0};if(!start)return 0;
  const x=start.col-origin.col,y=origin.row-start.row,doors=[];
  for(let row=0;row<this.map.rows;row++)for(let col=0;col<this.map.cols;col++)if(this.map.grid[row]?.[col]?.tileKey?.startsWith('tile_start'))doors.push({x:col,y:row});
  doors.sort((a,b)=>a.y-b.y||a.x-b.x);
  const exact=doors.findIndex(door=>door.x===x&&door.y===y);if(exact>=0)return Math.min(1,exact);
  const routesByDoor=(routes||[]).map((entry,index)=>({entry,index})).sort((a,b)=>(origin.row-a.entry.startPosition.row)-(origin.row-b.entry.startPosition.row));
  const routeIndex=routesByDoor.findIndex(item=>item.entry===route);return Math.max(0,Math.min(1,routeIndex));
 }
 prepareDoorWaveQueue(round=this.s.round,{force=false}={}){
  const s=this.s,turn=this.resolveTurn(buildPhasePlan(this.data,s.modeId).find(row=>row.round===round));if(!turn||!s.waveRoster)return null;
  const boss=Boolean(turn.finalBossId),routes=boss?this.map.bossDoorRoutes:null,existing=s.preparedDoorWave,routeCount=boss?routes?.length:null,bountyKey=JSON.stringify([...(s.pendingBounties||[]),s.pendingBounty].filter(Boolean));
  if(!force&&existing?.round===round&&existing.kind===(boss?'boss':'wave')&&(existing.bountyKey??'[]')===bountyKey&&Array.isArray(existing.queue)&&existing.queue.every(q=>this.data.enemies[q?.id]&&Number.isFinite(q.at)&&Number.isInteger(q.route)&&q.route>=0&&(boss?q.route<(routeCount||0):true)&&Number.isInteger(q.door)&&q.door>=0&&q.door<2))return existing;
  if(boss){
   const queue=buildFinalBossAddQueue(this.data,s.waveRoster,s.finalBossAddSeed||s.randomState,routes,null,s.weeklyChallenge||null).map(q=>({...q,door:this.doorForRoute(routes[q.route],routes)}));
   return s.preparedDoorWave={round:turn.round,kind:'boss',queue};
  }
  const plan=nativeWavePlan(this.data,turn,s.waveRoster,s.weeklyChallenge||null);if(!plan?.level)return s.preparedDoorWave={round:turn.round,kind:'wave',queue:[]};
  const queue=plan.queue.map(q=>({...q}));
  if(!s.weeklyChallenge&&s.bandId==='band_ducklord'&&turn.round>=5&&queue.length){
   const targets=['enemy_2002_bearmi_2','enemy_2034_sythef_2','enemy_2085_skzjxd_2','enemy_2001_duckmi_2'],ground=queue.filter(q=>plan.level.routes[q.route]?.motionMode!=='FLY'),assignment=s.waveRoster.rounds?.[turn.round],random=waveRng(((Number(assignment?.waveSeed)||turn.round)^0x4d595df4)>>>0),count=Math.min(2,Math.floor(random()*3));
   for(let i=0;i<count&&ground.length;i++){if(random()<.6)continue;const q=ground.splice(Math.floor(random()*ground.length),1)[0];q.id=targets[Math.floor(random()*targets.length)];q.ducklord=true;}
  }
  const bounties=[...(s.pendingBounties||[]),s.pendingBounty].filter(Boolean);
  for(const bounty of bounties){const motion=(this.data.enemies[bounty.enemyId]||plan.level.enemyProfiles?.[bounty.enemyId])?.motion==='FLY'?'FLY':'WALK',route=(plan.level.routes||[]).findIndex(r=>r.motionMode===motion&&r.startPosition.col<=10&&r.startPosition.row>=6&&r.startPosition.row<=12),baseAt=queue.reduce((n,q)=>Math.max(n,q.at||0),0);for(let i=0;i<bounty.count;i++)queue.push({id:bounty.enemyId,at:baseAt+1.5+i*1.2,route:route<0?0:route,cost:0,bountyReward:bounty.coin});}
  const scheduled=scheduleWaveQueue(queue,plan.level,turn.round).map(q=>({...q,door:this.doorForRoute(plan.level.routes[q.route],plan.level.routes)}));
  return s.preparedDoorWave={round:turn.round,kind:'wave',bountyKey,queue:scheduled};
 }
 startBattle(){if(this.s.phase!=='prep'||this.s.rewardPending)return false;this.prepareDoorWaveQueue();this.syncSummonCards();this.syncHandSlots();const area=this.finalBossPrepArea();if(area&&[...this.s.units.filter(u=>u.position),...(this.s.summonCards||[]).filter(c=>c.position)].some(actor=>finalBossPlacementContains(area,actor.position.x,actor.position.y)))throw Error('昆图斯／萨米的意志将占据右上角 2 列 × 3 行，请先移开该区域的干员和召唤物。');this.applyTouchReplacement();this.settleTartarusRound();const ok=this.beginBattle();if(!ok)return false;if(this.s.phase==='prep')return true;const turn=this.resolveTurn(buildPhasePlan(this.data,this.s.modeId).find(t=>t.round===this.s.round));this.battle=new NativeBattle(this.data,this,this.map,turn);return true;}
 bondLayerSnapshot(){const visible=id=>seesRun(this)||id!==SEES_BOND_ID&&id!==TARTARUS_BOND_ID,ids=new Set([...Object.keys(this.data.season.bondInfoDict||{}),SEES_BOND_ID,TARTARUS_BOND_ID,...Object.keys(this.s.bondLayers||{})]);return [...ids].filter(visible).map(id=>{const value=Number(this.s.bondLayers?.[id]);return {id,name:this.data.season.bondInfoDict[id]?.name||id,layers:Number.isFinite(value)?Math.max(0,Math.floor(value)):0};});}
 finishCurrentBattle(){if(!this.battle?.s.finished||this.s.phase!=='battle')return;const r=this.battle.s.result;r.finalBondLayers=this.bondLayerSnapshot();this.s.history.push(r);if(r.kind==='final-boss'){this.s.runResult=r;if(r.reason!=='boss-killed')this.s.hp=0;this.s.phase='finished';}else{const loss=Math.min(ROUND_LEAK_CAP,r.leaks);this.s.hp=Math.max(0,this.s.hp-loss);this.finishBattle({success:this.s.hp>0,leaks:r.leaks});this.s.lastBattle.loss=loss;if(!this.s.hp)this.s.runResult=r;}this.applyPostBattleTransforms();if(this.s.phase==='intermission')this.battle.clearEndedRoundEntities();}
 tick(){if(this.s.phase==='battle'&&this.battle){this.battle.step();this.finishCurrentBattle();}}
 advanceRound(){if(this.s.phase!=='intermission')return false;const locked=this.s.locked,oldOffers=locked?this.s.offers.slice():null,oldItems=locked?this.s.itemOffers.slice():null,nextRound=this.s.round+1,rounds=buildPhasePlan(this.data,this.s.modeId),next=rounds.find(row=>row.round===nextRound),mode=this.data.season.modeDataDict[this.s.modeId],decisionSchedule=singleDecisionRounds(mode),willPrepare=decisionSchedule?decisionSchedule.includes(nextRound-1):next?.battles.some(battle=>battle.isSpPrepare)||false;if(next&&nextRound<=rounds.length&&!next.isConditional&&!willPrepare)this.prepareDoorWaveQueue(nextRound);this.s.prepApplied=false;const ok=this.nextRound(locked?[]:this.rollOffers());if(!ok)return false;if(locked){const refillOffers=this.rollOffers();this.s.offers=Array.from({length:this.terms().operatorSlots},(_,i)=>oldOffers[i]??refillOffers[i]);const refillItems=Array.from({length:this.terms().itemSlots},()=>this.drawFromPool({kind:'item',shop:true}));this.s.itemOffers=Array.from({length:this.terms().itemSlots},(_,i)=>oldItems[i]??refillItems[i]);}else this.fillItems();this.addFunds(this.s.passiveIncome);this.applyProjectionUpgrades();
  // 进入新回合只做「按持有者/类型对账」，**不重置已放置的召唤物卡**：召唤物留在原位跨回合存在，
  // 只有持有者撤走（syncSummonCards 会把卡删掉）或主动撤回整备区（withdrawSummonCard）才会离场。
  if(this.s.phase==='prep'){this.syncSummonCards();this.prepareDoorWaveQueue();}if(this.s.phase==='decision')this.prepareRoundDecision();return true;
 }
 prepareRoundDecision(){const mode=this.data.season.modeDataDict[this.s.modeId],schedule=singleDecisionRounds(mode),round=this.s.round-1,index=schedule?.indexOf(round)??0,firstDecision=schedule?.[0]===round;this.s.roundDecisionPool=index<=0?'early':'late';this.s.roundDecisionType=schedule===null?'tactical':firstDecision?'bounty':['bounty','equipment','tactical'][Math.floor(this.random()*3)];this.s.roundDecisionStage='reward';this.s.roundDecisions=this.decisionRewardOffers(this.s.roundDecisionType);if(this.s.roundDecisions.length<3&&!firstDecision){this.s.roundDecisionType='tactical';this.s.roundDecisions=this.decisionRewardOffers('tactical');}}
 decisionRewardOffers(type){
  const early=this.s.roundDecisionPool!=='late',assignment=this.s.waveRoster?.rounds?.[this.s.round]||null,seed=assignment?.waveSeed??this.s.round;
  if(type==='bounty')return bountyDecisionOffers(this.data,seed,{late:!early}).map(o=>({id:`bounty:${o.enemyId}`,kind:'bounty',enemyId:o.enemyId,name:o.name,count:o.count,coin:o.coin}));
  if(type==='equipment'){
   const tiers=early?[1,2,3]:[5,6],pool=this.data.items.filter(item=>itemAllowed(item,this)&&tiers.includes(Number(item.rank))),offers=[];
   while(offers.length<3&&pool.length){const i=Math.floor(this.random()*pool.length),item=pool.splice(i,1)[0];offers.push({id:`equipment:${item.id}`,kind:'equipment',itemId:item.id});}
   return offers;
  }
  if(type==='tactical'){
   const allowed=['global_special_choice_gain_coin','global_special_choice_refresh_free','global_special_choice_bond_addlayer','enemy_attribute_add','enemy_attribute_mul','char_attribute_mul'],pool=Object.values(this.data.season.effectInfoDataDict).filter(e=>e.effectType==='BUFF_GAIN'&&this.data.season.effectBuffInfoDataDict[e.effectId]?.every(x=>allowed.includes(x.key))),offers=[];
   while(offers.length<3&&pool.length){const i=Math.floor(this.random()*pool.length),effect=pool.splice(i,1)[0];offers.push({id:`tactical:${effect.effectId}`,kind:'tactical',effectId:effect.effectId});}
   return offers;
  }
  return [];
 }
 chooseDecision(id){
  if(this.s.phase!=='decision'||!Array.isArray(this.s.roundDecisions))return false;
  if(this.s.roundDecisionStage!=='reward')return false;
  const offer=this.s.roundDecisions.find(x=>typeof x==='string'?x===id:x?.id===id);if(!offer)return false;
  const kind=typeof offer==='string'?'tactical':offer.kind;
  if(kind==='bounty'){this.s.pendingBounties??=[];this.s.pendingBounties.push({enemyId:offer.enemyId,coin:offer.coin,count:offer.count});}
  else if(kind==='equipment')this.gainItem(offer.itemId);
  else if(kind==='tactical'){
   const effectId=typeof offer==='string'?offer:offer.effectId;
   for(const e of this.data.season.effectBuffInfoDataDict[effectId]||[]){const p=blackboard(e.blackboard);if(e.key==='global_special_choice_gain_coin')this.addFunds(p.count);if(e.key==='global_special_choice_refresh_free')this.s.freeRefresh+=p.count;if(e.key==='global_special_choice_bond_addlayer')for(const b of p.bond_list.split(','))this.addLayers(b,p.count,false);if(e.key.startsWith('enemy_attribute'))this.s.enemyModifiers.push(e);if(e.key==='char_attribute_mul')this.s.operatorModifiers.push(e);}
  }else return false;
  this.s.roundDecisions=[];this.s.roundDecisionStage=null;this.s.roundDecisionType=null;this.s.roundDecisionPool=null;this.prepareDoorWaveQueue();this.s.phase='prep';this.startPreparation();return true;
 }
  // 导入的旧存档可能留着本局已禁盟约的候选（商店槽／晋升奖励候选）：读档时按禁用规则清一遍，
  // 否则玩家能从这些残留槽位买到、领到禁用干员。奖励候选被清空时按原口径补抽，抽不出来就丢掉这项奖励
  // （不能让玩家卡在「必须选一个」的奖励上）。
  sanitizeBannedOffers(){
   if(!this.s.bondBan?.bonds?.length)return;
   this.s.offers=(this.s.offers||[]).map(id=>id&&this.bondBanned(id)?null:id);
   const fix=reward=>{
    if(!reward?.offers?.length||reward.kind==='item')return reward;
    const kept=reward.offers.filter(id=>!this.bondBanned(id));
    if(kept.length===reward.offers.length)return reward;
    if(kept.length)return {...reward,offers:kept};
    const request={kind:'operator',...(reward.tier?{tier:reward.tier}:{}),...(reward.pool?{pool:reward.pool}:{})};
    try{const offers=this.drawDistinct(request,reward.offers.length);return offers.length?{...reward,offers}:null;}catch{return null;}
   };
   if(this.s.rewardPending)this.s.rewardPending=fix(this.s.rewardPending);
   this.s.rewardQueue=(this.s.rewardQueue||[]).map(fix).filter(Boolean);
   if(!this.s.rewardPending&&this.s.rewardQueue.length)this.s.rewardPending=this.s.rewardQueue.shift();
  }
 snapshot(){return {version:this.data.version,s:this.s,battle:this.battle?.s||null,savedAt:Date.now()};}
 static restore(data,record){
  record=structuredClone(record);
 const s=record?.s,n=v=>typeof v==='number'&&Number.isFinite(v),integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
  if(!s||record.version!==data.version||!data.season.modeDataDict[s.modeId]||!data.season.bandDataListDict[s.bandId]||!data.maps.some(m=>m.stageId===s.mapId)||!integer(s.level,1,6)||!integer(s.round,1,15)||!n(s.funds)||s.funds<0||!n(s.hp)||!n(s.maxHp)||s.hp<0||s.hp>s.maxHp||!['prep','battle','decision','intermission','finished'].includes(s.phase)||![undefined,true].includes(s.cat)||![undefined,true].includes(s.egg325)||!n(record.savedAt)||Date.now()>=(record.expiresAt??record.savedAt+86400000))return null;
  if(s.phase==='decision'&&s.roundDecisionStage===undefined){if(!Array.isArray(s.roundDecisions))return null;s.roundDecisionStage='reward';s.roundDecisionType='tactical';s.roundDecisionPool='early';s.roundDecisions=s.roundDecisions.map(id=>typeof id==='string'?{id:`tactical:${id}`,kind:'tactical',effectId:id}:id);}
  if(s.phase==='decision'&&(s.roundDecisionStage!=='reward'||!['early','late'].includes(s.roundDecisionPool)||!Array.isArray(s.roundDecisions)||!['bounty','equipment','tactical'].includes(s.roundDecisionType)))return null;
  if(s.phase==='decision'&&s.roundDecisionStage==='reward'&&(s.roundDecisions.length!==3||s.roundDecisions.some(o=>s.roundDecisionType==='bounty'?o?.kind!=='bounty'||!bountyOption(data,o.enemyId)||!integer(o.count,1,99)||!n(o.coin)||o.coin<0:s.roundDecisionType==='equipment'?o?.kind!=='equipment'||!data.season.trapChessDataDict[o.itemId]:o?.kind!=='tactical'||!data.season.effectBuffInfoDataDict[o.effectId])))return null;
  if(s.finalBossId!==undefined&&!AVAILABLE_FINAL_BOSS_IDS.includes(s.finalBossId))return null;
  if(s.weeklyChallenge!==undefined&&!validateWeeklyChallengeSnapshot(s.weeklyChallenge))return null;
  if(s.waveRoster?.version===3){const r=s.waveRoster,types=data.season.specialEnemyRandomTypeDict||{};if(r.modeId!==s.modeId||!Array.isArray(r.types)||r.types.length!==3||new Set(r.types).size!==3||r.types.some(id=>id==='SPECIAL'||!types[id])||!r.rounds)return null;for(const turn of buildPhasePlan(data,s.modeId)){const a=r.rounds[turn.round],g=data.season.specialEnemyInfoDict[a?.groupId];if(!a||Boolean(a.boss)!==Boolean(turn.isBossTurn)||!turn.isBossTurn&&(!integer(a.waveSeed,0,0xffffffff)||!g||g.type!==a.type||g.type!=='SPECIAL'&&!r.types.includes(g.type)||g.isInFirstHalf!==(turn.round<=7)))return null;}}
  if(s.finalBossHpMultiplier!==undefined&&(!n(s.finalBossHpMultiplier)||s.finalBossHpMultiplier<.01||s.finalBossHpMultiplier>10))return null;
  // 盟约禁用：必须是已知盟约、无重复、至多 23 个；缺省（旧存档）在下面按「本局不额外禁用」补齐。
  // `fixed`／`never`（禁用方案）只做类型校验，旧存档缺字段时读档时按当前方案补齐。
  if(s.bondBan!==undefined){const b=s.bondBan;if(typeof b!=='object'||b===null||!Array.isArray(b.bonds)||b.bonds.length>23||new Set(b.bonds).size!==b.bonds.length||b.bonds.some(id=>typeof id!=='string'||!data.season.bondInfoDict[id])||(b.always!==undefined&&!Array.isArray(b.always))||(b.never!==undefined&&!Array.isArray(b.never)))return null;}
  if(s.pendingBounties!==undefined&&(!Array.isArray(s.pendingBounties)||s.pendingBounties.some(b=>!data.enemies[b?.enemyId]||!integer(b.count,1,99)||!n(b.coin)||b.coin<0)))return null;
  if(s.roundBounty){const r=s.roundBounty;if(!integer(r.round,1,s.round)||!Array.isArray(r.offers)||r.offers.length!==4||new Set(r.offers).size!==4||r.offers.some(id=>typeof id!=='string'||!data.enemies[id]||!bountyOption(data,id))||r.selected!==null&&!r.offers.includes(r.selected))return null;const coins=r.offers.map(id=>bountyOption(data,id).coin);if(!coins.includes(1)||!coins.includes(4))return null;if(s.phase==='prep'&&r.round===s.round&&r.selected){const option=bountyOption(data,r.selected);s.pendingBounties??=[];s.pendingBounties.push({enemyId:option.enemyId,coin:option.coin,count:option.count});}delete s.roundBounty;}
  const item=i=>i&&integer(i.uid,1,Number.MAX_SAFE_INTEGER)&&!!data.season.trapChessDataDict[i.chessId];
  if(!Array.isArray(s.units)||s.units.length>500||!Array.isArray(s.items)||s.items.length>1000||s.items.some(i=>!item(i))||(s.stock!==undefined&&(typeof s.stock!=='object'||s.stock===null||Object.values(s.stock).some(v=>!integer(v,0,99999))))||s.units.some(u=>!integer(u.uid,1,Number.MAX_SAFE_INTEGER)||!data.profiles[u.chessId]||u.charId!==data.profiles[u.chessId].charId||!integer(u.dir,0,3)||!Array.isArray(u.equipment)||u.equipment.length>2||u.equipment.some(i=>!item(i))||(u.purchases!==undefined&&(typeof u.purchases!=='object'||u.purchases===null||Object.values(u.purchases).some(v=>!integer(v,1,9999))))||(u.position!==null&&(!integer(u.position?.x,0,s.mapVariant==='boss'?20:10)||!integer(u.position?.y,0,6)))))return null;
  if(!Array.isArray(s.offers)||s.offers.some(id=>id!==null&&!data.profiles[id])||!Array.isArray(s.itemOffers)||s.itemOffers.some(id=>id!==null&&!data.season.trapChessDataDict[id])||!Array.isArray(s.history))return null;
  if(record.battle&&(!Array.isArray(record.battle.units)||!Array.isArray(record.battle.enemies)||!n(record.battle.frame)||!n(record.battle.time)))return null;
  const c=Object.create(NativeSession.prototype);c.data=data;c.baseMap=data.maps.find(m=>m.stageId===s.mapId);const restartLegacyBossBattle=s.mapVariant==='boss'&&s.phase==='battle'&&!!record.battle;c.bossMap=c.baseMap;c.map=c.baseMap;c.board=c.map;c.manualPreview=true;c.triggerChain=[];c.poolDraw=request=>c.drawFromPool(request);c.battle=null;c.s=s;delete c.s.mapVariant;if(restartLegacyBossBattle){c.s.phase='prep';c.s.legacyBossBattleRestarted=true;for(const unit of c.s.units)unit.position=null;for(const card of c.s.summonCards||[])card.position=null;record.battle=null;}c.s.finalBossId??=rollFinalBoss(data,s.modeId,s.randomState);c.s.finalBossHpMultiplier=normalizeFinalBossHpMultiplier(c.s.finalBossHpMultiplier??DEFAULT_FINAL_BOSS_HP_MULTIPLIER);if(c.s.cat)c.s.funds=INFINITE_FUNDS;ensureStock(data,c.s);c.s.playerId??='local';c.s.teamPeers??=[];c.s.transferInbox??=[];c.s.transferOutbox??=[];
  // 旧存档没有盟约禁用记录：按「本局不额外禁用」补齐（`bonds:[]`），不动玩家已经买到的干员。
  // 禁用方案（fixed／never）不参与判定，只用于简报／弹窗标注「固定禁用还是随机抽中」，缺字段时补当前方案。
  // 旧存档里的 `exempt`（v2 的不禁用名单）直接忽略：判定只看 bonds 与干员自己的盟约。
  const restoredBan=s.bondBan?normalizeBondBan(s.bondBan,data):normalizeBondBan({},data);
  c.s.bondBan=s.bondBan
   ?{bonds:s.bondBan.bonds.slice(),always:restoredBan.always,never:restoredBan.never}
   :{bonds:[],always:restoredBan.always,never:restoredBan.never};c.sanitizeBannedOffers();if(!c.s.waveRoster?.version)c.s.waveRoster=createWaveRoster({random:()=>c.random(),data,modeId:c.s.modeId});let migrated=false;for(const u of c.s.units)if(u.position&&(!c.map.grid[u.position.y]?.[u.position.x]||c.map.grid[u.position.y][u.position.x].buildableType==='NONE')){u.position=null;migrated=true;}for(const card of c.s.summonCards||[])if(card.position&&(!c.map.grid[card.position.y]?.[card.position.x]||c.map.grid[card.position.y][card.position.x].buildableType==='NONE')){card.position=null;migrated=true;}
  // 旧存档里装备曾把 giveBondId 直接叠进 u.bondIds（「装了不融冰就算谢拉格」那类误判），读档时按新口径重算一次。
  for(const u of c.s.units)c.refreshEquipmentBonds(u);
  // 读档时按「战前准备」的默认技能补齐没写过档位的副本、并把同名干员对齐到同一个技能
  // （存档里显式写下的档位优先，不会被配置覆盖）。
  applyPrepSkills(data,c.s.units);if(c.s.phase==='prep')c.prepareDoorWaveQueue();if(migrated&&record.battle){const deployed=new Set(c.s.units.filter(u=>u.position).map(u=>u.uid));record.battle.units=record.battle.units.filter(u=>deployed.has(u.uid));}if(record.battle){const turn=c.resolveTurn(buildPhasePlan(data,c.s.modeId).find(t=>t.round===c.s.round));if(turn.finalBossId&&record.battle.benchmark)c.battle=new NativeBattle(data,c,c.map,turn);else{c.battle=NativeBattle.restore(data,c,c.map,turn,record.battle);if(!c.battle)return null;}}if(c.battle&&['prep','intermission','decision'].includes(c.s.phase))c.battle.clearEndedRoundEntities();return c;
 }
}
