// 商店库存：每个商店可售干员在本局内有限个。只统计「从商店买走」的份数；
// 干员／策略等特殊效果获得的干员不计入库存，出售也不回补（它们没有 purchases 记录）。
export const STOCK_BY_TIER={1:64,2:64,3:64,4:32,5:16,6:8};
export function initialStock(data,chessId){const tier=Number(data.season.charShopChessDatas[chessId]?.chessLevel)||1;return STOCK_BY_TIER[tier]??STOCK_BY_TIER[1];}
// 把关卡数据里的可售干员一次性铺满库存表，缺项按阶级补默认值（老存档或新增干员都能自愈）
export function ensureStock(data,s){
 const rows=Object.values(data.season.charShopChessDatas).filter(o=>o.charId&&!o.isHidden);
 s.stock??={};
 for(const row of rows){const id=row.chessId;const init=initialStock(data,id);const cur=s.stock[id];if(!Number.isFinite(cur)||cur<0)s.stock[id]=init;}
 return s.stock;
}
export function stockOf(data,s,chessId){ensureStock(data,s);return Number.isFinite(s.stock?.[chessId])?s.stock[chessId]:initialStock(data,chessId);}
// 购买记录用 map 计数，卖出时按记录回补；三合一合并时把各份记录累加，所以卖出精锐恢复的是合成时买走的全部份数
function addPurchases(into,from){if(!from)return into;for(const [id,n] of Object.entries(from))into[id]=(into[id]||0)+Number(n||0);return into;}
export function restoreStock(s,unit){const owned=unit?.purchases;if(!owned)return;s.stock??={};for(const [id,n] of Object.entries(owned)){if(s.stock[id]===undefined)continue;s.stock[id]+=Number(n||0);}}
// 技能范围几何：范围形状是权威数据（data.ranges[rangeId].grids），特效据此贴合真实形状，
// 不靠像素半径估算。spanX/spanY 是相对施法者的最大横/纵跨度，cells 是原始格子。
const RANGE_GEOMETRY=new Map();
export function rangeGeometry(data,rangeId){
 if(!rangeId)return null;
 const key=rangeId;
 if(RANGE_GEOMETRY.has(key))return RANGE_GEOMETRY.get(key);
 const grids=data?.ranges?.[rangeId]?.grids;
 if(!grids?.length){RANGE_GEOMETRY.set(key,null);return null;}
 const cols=grids.map(g=>Number(g.col)||0),rows=grids.map(g=>Number(g.row)||0);
 const geometry={rangeId,cells:grids.map(g=>({col:Number(g.col)||0,row:Number(g.row)||0})),count:grids.length,
  spanX:Math.max(...cols)-Math.min(...cols),spanY:Math.max(...rows)-Math.min(...rows),
  reachX:Math.max(...cols.map(Math.abs)),reachY:Math.max(...rows.map(Math.abs))};
 RANGE_GEOMETRY.set(key,geometry);
 return geometry;
}
// 技能是否比常态范围更大（真银斩这类"范围扩大"技能）。用于攻击特效的 wide 标记。
export function skillWidensRange(profile,skillIndex=null){
 const skill=skillIndex!=null?(profile?.skillChoices?.[skillIndex]?.skill??profile?.skill):profile?.skill;
 if(!skill?.rangeId||!profile?.rangeId)return false;
 return skill.rangeId!==profile.rangeId;
}
export function baseFunding(round){if(!Number.isInteger(round)||round<1)throw Error('Invalid round');return round+3;}
// Versioned native data helpers. No missing rule is guessed or silently simulated.
export function blackboard(entries=[]){return Object.fromEntries((entries||[]).map(e=>[e.key,e.valueStr??e.value]));}
// 富文本 → 显示文本。原表用尖括号区分两类东西：
//   样式标签：`<@ba.vup>`、`<$ba.stun>`、`<@autochess.gray>`、闭合的 `</>` —— 丢掉；
//   内容：道具/召唤物/盟约/敌人/时机名（`<铜灯盘>`、`<替身>`、`<寻呼模块>`、`<炎>`、`<获得时>`）——
//   里面的文字是正文，必须保留。
// 原表还会嵌套（`<在场<@autochess.dgreen>6</>名不同【炎】干员>`），所以按尖括号配对扫描，不能简单用正则。
export function richText(value){
 const raw=String(value??'');let out='',i=0;
 while(i<raw.length){
  const lt=raw.indexOf('<',i);
  if(lt<0){out+=raw.slice(i);break;}
  out+=raw.slice(i,lt);
  let depth=0,end=-1;
  for(let j=lt;j<raw.length;j++){
   if(raw[j]==='<')depth++;
   else if(raw[j]==='>'){depth--;if(depth===0){end=j;break;}}
  }
  if(end<0){out+=raw.slice(lt);break;}                     // 未闭合：原样留着
  const inner=raw.slice(lt+1,end);
  if(!/^[@$/]/.test(inner)&&inner!=='')out+=richText(inner); // 内容型：保留内部文字
  i=end+1;
 }
 return out.replace(/\\n/g,'\n');
}
// 卫戍效果（干员特质）的显示文本。原表把触发时机写成尖括号标签（`<获得时>`／`<战斗中>`…），
// 直接按富文本去标签会把时机一起吃掉，所以这里统一成【…】前缀；没有标签的按 eventType／能力键补。
// 时机口径见 GARRISON_EFFECT_AUDIT.md §一。
export const GARRISON_TIMING_LABELS={SERVER_GAIN:'获得时',SERVER_PREP_START:'进入休整期时',SERVER_PREP_FIN:'休整期结束时',SERVER_REFRESH_SHOP:'刷新时',SERVER_CHESS_SOLD:'售出时',SERVER_PRICE:'购买时',IN_BATTLE:'战斗中'};
const GARRISON_TIMING_TAG=/<([^@/][^>]*)>/g,GARRISON_TIMING_TEXT=/时$|战斗中|部署/;
export function garrisonTimingLabel(rule){
 const raw=String(rule?.garrisonDesc||rule?.description||'');
 const tag=[...raw.matchAll(GARRISON_TIMING_TAG)].map(m=>m[1]).find(t=>GARRISON_TIMING_TEXT.test(t));
 if(tag)return tag;
 const key=String(blackboard(rule?.blackboard||[]).key||'');
 if(/onstart/.test(key))return '部署时';
 if(String(rule?.battleRuneKey||'').startsWith('give_garrison'))return '战斗开始时';
 return GARRISON_TIMING_LABELS[rule?.eventType]||'';
}
export function garrisonText(rule){
 const when=garrisonTimingLabel(rule);
 // 先把时机标签摘掉（它会变成前面的【…】前缀），再按富文本规则处理剩下的内容标签。
 const raw=String(rule?.garrisonDesc||rule?.description||'').replace(new RegExp(GARRISON_TIMING_TAG.source,'g'),m=>GARRISON_TIMING_TEXT.test(m.slice(1,-1))?'':m);
 const body=richText(raw).trim();
 return when?`【${when}】${body}`:body;
}
export function talentCandidateOpen(candidate,status,potentialRank=0){
 const phase=Number(String(status?.evolvePhase||'PHASE_0').replace('PHASE_','')),need=Number(String(candidate.unlockCondition?.phase||'PHASE_0').replace('PHASE_',''));
 const level=status?.charLevel??1;
 if(need>phase||(need===phase&&(candidate.unlockCondition?.level||1)>level))return false;
 return (candidate.requiredPotentialRank||0)<=potentialRank;
}
export function resolveActiveTalents(entity,status,{potentialRank=0,modulePhase=null}={}){
 const slots=[];
 for(const [index,slot] of (entity?.talents||[]).entries()){
  const pick=(slot.candidates||[]).filter(c=>talentCandidateOpen(c,status,potentialRank)).at(-1);
  if(pick)slots.push({slot:index,name:pick.name,description:pick.description,blackboard:pick.blackboard||[],prefabKey:pick.prefabKey||null});
 }
 for(const part of modulePhase?.parts||[]){
  if(part.isToken)continue;
  const cands=part.addOrOverrideTalentDataBundle?.candidates;
  if(!cands?.length)continue;
  const pick=cands.filter(c=>talentCandidateOpen(c,status,potentialRank)).at(-1);
  if(!pick)continue;
  const row={slot:slots.length,name:pick.name,description:pick.description||pick.upgradeDescription,blackboard:pick.blackboard||[],prefabKey:pick.prefabKey||null,fromModule:true};
  const i=Number.isInteger(pick.talentIndex)&&pick.talentIndex>=0?slots.findIndex(s=>s.slot===pick.talentIndex):slots.findIndex(s=>pick.name&&s.name===pick.name);
  if(i>=0){const previous=slots[i];row.slot=previous.slot;row.name??=previous.name;row.description??=previous.description;const merged={...blackboard(previous.blackboard),...blackboard(row.blackboard)};row.blackboard=Object.entries(merged).map(([key,value])=>({key,value}));slots[i]=row;}else slots.push(row);
 }
 return slots;
}
export function nativeAttributes(entity,status){
 const phaseIndex=Math.min(entity.phases.length-1,Number(status.evolvePhase.replace('PHASE_',''))),phase=entity.phases[phaseIndex];const level=Math.max(1,Math.min(status.charLevel,phase.maxLevel));const frames=phase.attributesKeyFrames;
 let left=frames[0],right=frames.at(-1);for(let i=1;i<frames.length;i++)if(level<=frames[i].level){left=frames[i-1];right=frames[i];break;}
 const t=right.level===left.level?0:(level-left.level)/(right.level-left.level),data={};for(const[k,v]of Object.entries(left.data)){const other=right.data[k];data[k]=typeof v==='number'&&typeof other==='number'?v+(other-v)*t:v;if(['maxHp','atk','def'].includes(k))data[k]=Math.round(data[k]);}return {phase:phaseIndex,level,rangeId:phase.rangeId,attributes:data};
}
export function resolveChess(data,base,chessId,{skillIndex,ownedBonus=null,potentialRank=0}={}){
 const chess=data.season.charChessDataDict[chessId];if(!chess)throw Error('Unknown chess '+chessId);
 const normalId=chess.isGolden?data.season.chessNormalIdLookupDict[chessId]||Object.keys(data.season.charChessDataDict).find(id=>data.season.charChessDataDict[id].upgradeChessId===chessId):chessId;
 const shop=data.season.charShopChessDatas[normalId];if(!shop?.charId)throw Error('DIY slot must be assigned before resolution');const entity=base.entities[shop.tmplId||shop.charId];if(!entity)throw Error('Missing native entity '+shop.charId);
 const state=nativeAttributes(entity,chess.status);const index=skillIndex??shop.defaultSkillIndex,ref=entity.skillRefs[index];const skill=ref?base.skills[ref.skillId]?.levels[Math.min(chess.status.skillLevel-1,base.skills[ref.skillId].levels.length-1)]:null;
 const module=base.modules[shop.defaultUniEquipId],modulePhase=chess.status.equipLevel>0?module?.phases.find(p=>p.equipLevel===chess.status.equipLevel):null;
 const attributes={...state.attributes},moduleStats=blackboard(modulePhase?.attributeBlackboard);for(const[from,to]of Object.entries({max_hp:'maxHp',atk:'atk',def:'def',magic_resistance:'magicResistance',attack_speed:'attackSpeed',respawn_time:'respawnTime',cost:'cost',block_cnt:'blockCnt'}))attributes[to]+=(moduleStats[from]||0);
 // Only native additive potential modifiers are handled here; other effects stay in their descriptors.
 for(const p of (entity.potentials||[]).slice(0,potentialRank))for(const m of p.buff?.attributes?.attributeModifiers||[]){const key={MAX_HP:'maxHp',ATK:'atk',DEF:'def',MAGIC_RESISTANCE:'magicResistance',COST:'cost',RESPAWN_TIME:'respawnTime'}[m.attributeType];if(key&&m.formulaItem==='ADDITION')attributes[key]+=m.value;}
 if(ownedBonus)for(const[k,v]of Object.entries(ownedBonus))if(['maxHp','atk','def'].includes(k))attributes[k]*=1+v;
 return {chessId,normalId,charId:shop.charId,name:entity.name,rank:shop.chessLevel,isGolden:chess.isGolden,status:chess.status,...state,attributes,range:base.ranges[state.rangeId],skillId:ref?.skillId||null,skillIndex:index,skill,moduleId:modulePhase?shop.defaultUniEquipId:null,modulePhase,bonds:chess.bondIds,garrisons:chess.garrisonIds.map(id=>({id,...data.season.garrisonDataDict[id]})),talents:entity.talents,activeTalents:resolveActiveTalents(entity,chess.status,{potentialRank,modulePhase}),trait:entity.trait,sourceCommit:data.source.commit};
}
export function skillPolicy(common,entity,skillIndex){const matches=common.skillTriggerDataList.filter(p=>(p.charId? p.charId===entity.id&&p.skillIndex===skillIndex:p.subProfessionId?p.subProfessionId===entity.branch:p.profession===entity.profession));return matches.find(p=>p.charId)||matches.find(p=>p.subProfessionId)||matches[0]||{skillTriggerType:'DEFAULT'};}
export function shouldAutoSkill({policy,ready,deployed,now,lastOperation=0,initialDeployment=0,hasTarget=false,hasEnemyInSkillRange=false,hasEnemyInInitialRange=false,hasAnyTarget=false,wasDamaged=false,toggleUsed=false,isToggle=false}){
 if(!ready||!deployed||now-Math.max(lastOperation,initialDeployment)<3)return false;if(isToggle&&toggleUsed)return false;
 switch(policy){case 'ALWAYS':return true;case 'TAKE_DAMAGE':return wasDamaged;case 'SEARCH':return hasEnemyInInitialRange;case 'GDGLOW_SKILL_2':return hasAnyTarget;case 'CUSTOM_RANGE_SEARCH_ENEMY':return hasEnemyInSkillRange;case 'DEFAULT':return hasTarget;default:return false;}
}
export function buildPhasePlan(data,modeId){const turns=data.common.turnInfoDataDict[modeId],battles=data.season.battleDataDict[modeId];if(!turns||!battles)throw Error('Unknown mode');return Object.values(turns).sort((a,b)=>a.round-b.round).map(t=>({...t,battles:battles[t.round]||[],isConditional:t.round===15&&data.season.modeDataDict[modeId].modeDifficulty!=='TRAINING'}));}
export function shopTerms(data,modeId,level,discount=0){const s=data.season.shopLevelDataDict[modeId]?.[level];if(!s)throw Error('Unknown shop level');return {operatorSlots:s.charChessCount,itemSlots:s.itemCount,upgradeCost:level>=6?null:Math.max(0,s.initialUpgradePrice-discount),refreshCost:data.season.constData.shopRefreshPrice};}
export function purchasePrice(data,chessId){const shop=data.season.charShopChessDatas[chessId];if(shop)return data.season.shopCharChessInfoData[shop.chessLevel][0].purchasePrice;const item=data.season.trapChessDataDict[chessId];if(item)return item.purchasePrice;throw Error('Unknown offer '+chessId);}
export function activeBonds(data,units,modeId=null){
 const allowed=modeId?new Set(data.season.modeDataDict[modeId].activeBondIdList):null,rows={};
 for(const[id,b]of Object.entries(data.season.bondInfoDict)){
  const eligible=units.filter(u=>u.position!=null||b.activeCondition==='BOARD_AND_DECK');
  const golden=b.activeConditionTemplate==='count_threshold_upward_golden';
  const members=golden?eligible.filter(u=>data.season.charChessDataDict[u.chessId]?.isGolden):eligible.filter(u=>(u.bondIds||data.season.charChessDataDict[u.chessId]?.bondIds||[]).includes(id));
  const count=golden?members.length:new Set(members.map(u=>u.charId)).size;
  const threshold=Number(b.activeParamList[0]),active=b.activeConditionTemplate==='count_threshold_downward'?count>=threshold&&count<Number(b.activeParamList[1]):count>=threshold;
  rows[id]={count,rawCount:count,active:(!allowed||allowed.has(id))&&active};
 }
 if(rows.maniShip?.active)for(const[id,row]of Object.entries(rows))if(data.common.bondInfoDict[id]?.isPower&&row.rawCount>0){row.count++;row.active=(!allowed||allowed.has(id))&&row.count>=Number(data.season.bondInfoDict[id].activeParamList[0]);}
 return rows;
}
export function applyEnemyOverrides(base,override){
 if(override&&typeof override==='object'&&!Array.isArray(override)&&Object.hasOwn(override,'m_defined'))return override.m_defined?structuredClone(override.m_value):structuredClone(base??null);
 if(override===null||override===undefined)return structuredClone(base??null);
 if(Array.isArray(override)||typeof override!=='object')return structuredClone(override);
 const out={...structuredClone(base||{})};for(const[k,v]of Object.entries(override))out[k]=applyEnemyOverrides(base?.[k],v);return out;
}
// 整备区（手牌）上限：干员、装备、召唤物卡一律占格。干员／策略效果发放的卡牌允许
// 临时超出（handLength>HAND_LIMIT），但超出期间不允许再购入干员和装备，必须先清出空余。
export const HAND_LIMIT=10;
export function suspendState(state,now=Date.now()){return {schemaVersion:1,savedAt:now,expiresAt:now+86400000,state:JSON.parse(JSON.stringify(state))};}
export function resumeState(save,now=Date.now()){if(save.schemaVersion!==1||now>=save.expiresAt||!save.state)return {ok:false,reason:'expired-or-invalid'};return {ok:true,state:JSON.parse(JSON.stringify(save.state))};}
export class PreparationState {
 constructor(data,modeId,{round=1,funds,offers=[],board=null}={}){funds??=baseFunding(round);if(!Number.isFinite(funds)||funds<0)throw Error('Invalid funding');this.data=data;this.board=board;this.s={modeId,phase:'prep',round,funds,level:1,discount:Math.max(0,round-1),units:[],items:[],offers:offers.slice(),locked:false,seq:0,rewardPending:null,events:[],stock:{}};ensureStock(data,this.s);}
 terms(){return shopTerms(this.data,this.s.modeId,this.s.level,this.s.discount);}
 // 整备区（手牌）＝未上场干员 → 未装备装备 → 未放置的召唤物卡，三者同序，只认这个总数。
 // 已经放到场上的召唤物卡不占格（它已经在阵地上了），未放置的在整备区里显示一格。
 hand(){const deployed=u=>u.position!==null,c=this.s.summonCards;return [...this.s.units.filter(u=>!deployed(u)),...this.s.items,...(Array.isArray(c)?c.filter(x=>!deployed(x)):[])];}
 handLength(){return this.hand().length;}
 // 达到或超过上限即禁止购入干员／装备；效果发放的卡牌不经过这里，所以能临时超出。
 handFull(){return this.handLength()>=HAND_LIMIT;}
 gain(chessId){ensureStock(this.data,this.s);const shop=this.data.season.charShopChessDatas[chessId],chess=this.data.season.charChessDataDict[chessId];if(!shop||!chess)throw Error('Unknown operator chess');const u={uid:++this.s.seq,chessId,charId:shop.charId,rank:shop.chessLevel,position:null,dir:0,equipment:[]};this.s.units.push(u);this.s.events.push({type:'gain',uid:u.uid,chessId});const copies=this.s.units.filter(x=>x.chessId===chessId);if(copies.length>=chess.upgradeNum&&chess.upgradeChessId){const group=copies.slice(0,chess.upgradeNum),anchor=group.find(x=>x.position!==null)||group[0];for(const x of group)this.s.items.push(...x.equipment);this.s.units=this.s.units.filter(x=>!group.includes(x));const merged={...anchor,uid:++this.s.seq,chessId:chess.upgradeChessId,equipment:[],purchases:{}};for(const x of group)addPurchases(merged.purchases,x.purchases);this.s.units.push(merged);this.s.rewardPending={tier:Math.min(6,this.s.level+1)};this.s.events.push({type:'promote',uid:merged.uid});return merged;}return u;}
 buy(index){if(this.s.phase!=='prep'||this.s.rewardPending)return {ok:false,code:'WRONG_PHASE'};const id=this.s.offers[index],shop=this.data.season.charShopChessDatas[id];if(!shop||shop.chessLevel>this.s.level)return {ok:false,code:'INVALID_OFFER'};const cost=purchasePrice(this.data,id),copies=this.s.units.filter(u=>u.chessId===id).length;if(this.s.funds<cost)return {ok:false,code:'NO_FUNDS'};if(this.handFull()&&copies<2)return {ok:false,code:'FULL_HAND'};if(stockOf(this.data,this.s,id)<=0)return {ok:false,code:'NO_STOCK'};this.s.stock[id]-=1;this.s.funds-=cost;this.s.offers[index]=null;const unit=this.gain(id);unit.purchases??={};unit.purchases[id]=(unit.purchases[id]||0)+1;return {ok:true};}
 deploy(uid,x,y,dir){if(!this.board||!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=this.board.cols||y>=this.board.rows||this.board.grid[y][x].buildableType==='NONE')return false;if(this.s.phase!=='prep'||!Number.isInteger(dir)||dir<0||dir>3)return false;const u=this.s.units.find(u=>u.uid===uid);if(!u)return false;const other=this.s.units.find(v=>v.uid!==uid&&v.position?.x===x&&v.position?.y===y);if(!other&&u.position===null&&this.s.units.filter(v=>v.position!==null).length>=8)return false;const old=u.position;if(other)other.position=old;u.position={x,y};if(old===null)u.dir=dir;return true;}
 upgrade(){const price=this.terms().upgradeCost;if(this.s.phase!=='prep'||price===null||this.s.funds<price||this.s.rewardPending)return false;this.s.funds-=price;this.s.level++;this.s.discount=0;return true;}
 refresh(offers){if(this.s.phase!=='prep'||this.s.rewardPending||this.s.funds<this.terms().refreshCost)return false;if(offers.some(id=>!this.data.season.charShopChessDatas[id]||this.data.season.charShopChessDatas[id].chessLevel>this.s.level))return false;this.s.funds-=this.terms().refreshCost;this.s.offers=offers.slice();this.s.locked=false;return true;}
 takePromotion(chessId){const shop=this.data.season.charShopChessDatas[chessId];if(!this.s.rewardPending||!shop||shop.chessLevel!==this.s.rewardPending.tier||shop.isHidden)return false;this.s.rewardPending=null;this.gain(chessId);return true;}
 sell(uid){if(this.s.phase!=='prep'||this.s.rewardPending)return false;const unit=this.s.units.find(u=>u.uid===uid);if(!unit)return false;this.s.units=this.s.units.filter(u=>u.uid!==uid);this.s.items.push(...unit.equipment);this.s.funds+=this.data.season.shopCharChessInfoData[unit.rank][this.data.season.charChessDataDict[unit.chessId].isGolden?1:0].chessSoldPrice;restoreStock(this.s,unit);this.s.events.push({type:'sell',uid});return true;}
 finishBattle({success,leaks=0}){if(this.s.phase!=='battle'||typeof success!=='boolean'||!Number.isInteger(leaks)||leaks<0)return false;this.s.lastBattle={success,leaks};this.s.phase=success?'intermission':'finished';return true;}
 nextRound(offers=[],{hiddenQualified=false}={}){if(this.s.phase!=='intermission'||!Array.isArray(offers)||offers.some(id=>!this.data.season.charShopChessDatas[id]))return false;const rounds=buildPhasePlan(this.data,this.s.modeId),next=rounds.find(r=>r.round===this.s.round+1);if(this.s.round>=rounds.length||(next?.isConditional&&!hiddenQualified)){this.s.phase='finished';return true;}this.s.round++;this.s.discount++;this.s.funds=baseFunding(this.s.round);if(!this.s.locked)this.s.offers=offers.slice();this.s.locked=false;this.s.decisionRequired=next?.battles.some(b=>b.isSpPrepare)||false;this.s.phase=this.s.decisionRequired?'decision':'prep';return true;}
 // 开战前丢掉超过上限的整备区卡牌：判定顺序与整备区显示一致（未上场干员 → 装备 → 未放置的召唤物卡）。
 beginBattle(){if(this.s.phase!=='prep'||this.s.rewardPending)return false;this.s.funds=0;if(!this.s.locked)this.s.offers=[];const cards=this.hand(),overflow=new Set(cards.slice(HAND_LIMIT).map(i=>i.uid));this.s.units=this.s.units.filter(u=>!overflow.has(u.uid));this.s.items=this.s.items.filter(i=>!overflow.has(i.uid));if(Array.isArray(this.s.summonCards))this.s.summonCards=this.s.summonCards.filter(c=>!overflow.has(c.uid));this.s.phase='battle';return true;}
}
