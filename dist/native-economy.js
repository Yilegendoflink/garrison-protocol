import {runStrategyEvent,strategyCoverage} from './strategy.js';
import {PreparationState,activeBonds,blackboard,purchasePrice,restoreStock,stockOf} from './protocol.js';
import {runGarrison} from './garrison.js';

// Preparation controller for the historical mode. Random pools remain an explicit
// controller input until their selection rules are verified; absent draws fail atomically.
export class NativeEconomy extends PreparationState {
 constructor(data,modeId,options={}){
  super(data,modeId,options);if(options.bandId&&!data.season.bandDataListDict[options.bandId])throw Error('Unknown strategy');this.manualPreview=!!options.manualPreview;this.poolDraw=options.draw||null;this.triggerChain=[];
  Object.assign(this.s,{bondLayers:{},claimedBondRewards:{},strategyClaims:{},roundBoughtBonds:{},carryFunds:0,forcedRefresh:null,permanentDiscount:0,nextRoundBonus:0,freeRefresh:0,roundGainCount:0,roundSpent:0,roundRefreshCount:0,totalSpent:0,rewardQueue:[],randomState:(options.seed??1)>>>0,bandId:options.bandId??null,lastPrepRound:null,playerId:options.playerId??'local',teamPeers:structuredClone(options.teamPeers||[]),transferInbox:[],transferOutbox:[]});if(this.s.bandId)this.s.hp=this.s.maxHp=data.season.bandDataListDict[this.s.bandId].totalHp;
 }
 command(type,...args){
  if(!['buy','deploy','upgrade','refresh','sell','takePromotion','beginBattle','finishBattle','nextRound','startPreparation','destroy','destroyEquip'].includes(type))return {ok:false,code:'UNKNOWN_COMMAND'};
  const pending=strategyCoverage(this.data).find(b=>b.id===this.s.bandId)?.pendingKeys||[];if(pending.length&&!this.manualPreview)return {ok:false,code:'EFFECT_UNRESOLVED',message:'Strategy effects await execution support: '+pending.join(',')};
  const previous=structuredClone(this.s);
  try{const result=this[type](...args);if(result===false||result?.ok===false){this.s=previous;return result?.ok===false?result:{ok:false,code:'RULE_REJECTED'};}return {ok:true};}
  catch(error){this.s=previous;this.triggerChain=[];return {ok:false,code:'EFFECT_UNRESOLVED',message:error.message};}
 }
 random(){let x=this.s.randomState||0x6d2b79f5;x^=x<<13;x^=x>>>17;x^=x<<5;this.s.randomState=x>>>0;return this.s.randomState/4294967296;}
 pick(values){if(!values.length)throw Error('Empty candidate list');return values[Math.floor(this.random()*values.length)];}
 draw(request){
  if(!this.poolDraw)throw Error('Missing verified pool resolver: '+JSON.stringify(request));
  const id=this.poolDraw(request,structuredClone(this.s)),normalId=this.data.season.chessNormalIdLookupDict[id]||id,shop=this.data.season.charShopChessDatas[normalId],item=this.data.season.trapChessDataDict[id];
  if(request.kind==='item'?!item:!shop?.charId)throw Error('Invalid pool result '+id);
  if(shop&&request.maxTier!==undefined&&shop.chessLevel>request.maxTier)throw Error('Pool result exceeds requested tier');
  if(shop&&request.bond&&!this.data.season.charChessDataDict[id].bondIds.includes(request.bond))throw Error('Pool result violates requested bond');
  if(shop&&request.excludeCharId===shop.charId)throw Error('Pool result violates exclusion');
  return id;
 }
 bonds(){return activeBonds(this.data,this.s.units,this.s.modeId);}
 ownBonds(u){return u.bondIds||this.data.season.charChessDataDict[u.chessId].bondIds;}
 addLayers(id,amount,requireActive=true){
  const info=this.data.season.bondInfoDict[id];if(!info)throw Error('Unknown bond '+id);if(!Number.isFinite(amount)||amount<0)throw Error('Invalid bond increment');
  if(info.noStack||(requireActive&&!this.bonds()[id].active))return;
  this.s.bondLayers[id]=(this.s.bondLayers[id]||0)+amount;this.s.events.push({type:'bond-layer',id,amount,total:this.s.bondLayers[id]});this.settleBondRewards();
 }
 settleBondRewards(){
  const rows=this.bonds();for(const[id,b]of Object.entries(rows))if(b.active){const info=this.data.season.bondInfoDict[id];for(const [index,e]of (this.data.season.effectBuffInfoDataDict[info.effectId]||[]).entries()){
   const p=blackboard(e.blackboard),layers=this.s.bondLayers[id]||0,key=id+':'+index;
   if(e.key==='bond_layer_gain_coin'){const count=Math.floor(layers/p.layer),old=this.s.claimedBondRewards[key]||0;if(count>old){this.s.funds+=(count-old)*p.count;this.s.claimedBondRewards[key]=count;}}
   if(e.key==='bond_layer_added_reward_equip'){const count=Math.floor(layers/(Number(p.layer)||25)),old=this.s.claimedBondRewards[key]||0;if(count>old){for(let n=old;n<count;n++){let itemId;if(this.poolDraw)itemId=this.draw({kind:'item',pool:p.pool});else{const items=(this.data.items||[]).filter(i=>!i.hidden&&i.normal?.itemType==='EQUIP'&&(!String(p.pool).includes('equip_vict')||i.normal?.giveBondId==='victoriaShip'));const fallback=items.length?items.map(i=>i.id):Object.entries(this.data.season.trapChessDataDict).filter(([,i])=>i.itemType==='EQUIP'&&(!String(p.pool).includes('equip_vict')||i.giveBondId==='victoriaShip')).map(([id])=>id);if(!fallback.length)throw Error('没有可用装备');itemId=this.pick(fallback);}this.gainItem(itemId);}this.s.claimedBondRewards[key]=count;}}
   if(e.key==='bond_multi_layer_char_goods_price_bond_discount'){if(layers>=p.layer2)this.s.permanentDiscount=2;else if(layers>=p.layer1)this.s.permanentDiscount=Math.max(1,this.s.permanentDiscount);}
  }}
 }
 hasGarrison(u,event){return this.data.season.charChessDataDict[u.chessId].garrisonIds.some(id=>this.data.season.garrisonDataDict[id].eventType===event);}
 triggerGarrisons(event,unit,{effectOwner=unit}={}){
  const key=unit.uid+':'+event;if(this.triggerChain.includes(key)){if(this.manualPreview)return;throw Error('Cyclic garrison trigger '+key);}this.triggerChain.push(key);
  try{
   const repeat=event==='SERVER_GAIN'&&this.bonds().investShip?.active?((this.s.bondLayers.investShip||0)>=100?3:2):1;
   for(let i=0;i<repeat;i++)for(const id of this.data.season.charChessDataDict[unit.chessId].garrisonIds){const rule=this.data.season.garrisonDataDict[id];if(rule.eventType===event){runGarrison(this,effectOwner,rule,event);this.s.events.push({type:'garrison',id,uid:effectOwner.uid,event});}}
  }finally{this.triggerChain.pop();}
 }
 gain(chessId){
  const chess=this.data.season.charChessDataDict[chessId];if(!chess)throw Error('Unknown chess '+chessId);const previousReward=this.s.rewardPending;let unit;
  if(chess.isGolden){const normalId=this.data.season.chessNormalIdLookupDict[chessId]||Object.keys(this.data.season.charShopChessDatas).find(id=>this.data.season.charShopChessDatas[id].goldenChessId===chessId),shop=this.data.season.charShopChessDatas[normalId];if(!shop?.charId)throw Error('Unassigned DIY slot');unit={uid:++this.s.seq,chessId,charId:shop.charId,rank:shop.chessLevel,position:null,dir:0,equipment:[]};this.s.units.push(unit);}
  else unit=super.gain(chessId);
  if(previousReward&&previousReward!==this.s.rewardPending){this.s.rewardQueue.push(this.s.rewardPending);this.s.rewardPending=previousReward;}
  this.s.roundGainCount++;this.settleBondRewards();this.triggerGarrisons('SERVER_GAIN',unit);return unit;
 }
 gainItem(chessId){
  const def=this.data.season.trapChessDataDict[chessId];if(!def)throw Error('Unknown item '+chessId);const item={uid:++this.s.seq,chessId};this.s.items.push(item);
  if(def.upgradeChessId){const copies=[...this.s.items.map(i=>({i,owner:null})),...this.s.units.flatMap(u=>u.equipment.map(i=>({i,owner:u})))].filter(x=>x.i.chessId===chessId);if(copies.length>=def.upgradeNum){const chosen=copies.slice(0,def.upgradeNum),owner=chosen.find(x=>x.owner)?.owner;for(const x of chosen){if(x.owner)x.owner.equipment=x.owner.equipment.filter(i=>i.uid!==x.i.uid);else this.s.items=this.s.items.filter(i=>i.uid!==x.i.uid);}const merged={uid:++this.s.seq,chessId:def.upgradeChessId};if(owner)owner.equipment.push(merged);else this.s.items.push(merged);return merged;}}
  return item;
 }
 price(id){const def=this.data.season.charChessDataDict[id];if(!def)return purchasePrice(this.data,id);let value=purchasePrice(this.data,id);for(const gid of def.garrisonIds){const g=this.data.season.garrisonDataDict[gid];if(g.eventType==='SERVER_PRICE')value=runGarrison(this,null,g,'SERVER_PRICE');}if(this.s.permanentDiscount===2||(this.s.permanentDiscount===1&&def.bondIds.includes('visiShip')))value--;const special=runStrategyEvent(this,'price',{chessId:id});if(special.length)value=special.at(-1);return Math.max(0,value);}
 spend(amount){if(this.s.funds<amount)return false;this.s.funds-=amount;this.s.roundSpent+=amount;this.s.totalSpent+=amount;runStrategyEvent(this,'spent');return true;}
 buy(index){
  if(this.s.phase!=='prep'||this.s.rewardPending)return {ok:false,code:'WRONG_PHASE'};const id=this.s.offers[index],shop=this.data.season.charShopChessDatas[id];if(!shop?.charId||shop.chessLevel>this.s.level)return {ok:false,code:'INVALID_OFFER'};
  if(this.handFull()&&this.s.units.filter(u=>u.chessId===id).length<2)return {ok:false,code:'FULL_HAND'};if(!this.spend(this.price(id)))return {ok:false,code:'NO_FUNDS'};if(stockOf(this.data,this.s,id)<=0)return {ok:false,code:'NO_STOCK'};this.s.stock[id]-=1;this.s.offers[index]=null;const unit=this.gain(id);unit.purchases??={};unit.purchases[id]=(unit.purchases[id]||0)+1;runStrategyEvent(this,'bought',unit);for(const b of this.ownBonds(unit))this.s.roundBoughtBonds[b]=(this.s.roundBoughtBonds[b]||0)+1;return {ok:true};
 }
 deploy(...args){const result=super.deploy(...args);if(result)this.settleBondRewards();return result;}
 upgrade(){const price=this.terms().upgradeCost,result=super.upgrade();if(result){this.s.roundSpent+=price;this.s.totalSpent+=price;runStrategyEvent(this,'spent');runStrategyEvent(this,'upgrade');}return result;}
 refresh(offers){
  if(this.s.phase!=='prep'||this.s.rewardPending||!Array.isArray(offers)||offers.some(id=>!this.data.season.charShopChessDatas[id]||this.data.season.charShopChessDatas[id].chessLevel>this.s.level))return false;
  // 特殊刷新（佩佩【博学多通】）只是「这次刷新的干员优先为某盟约」，不减免刷新费：
  // 有免费刷新就用免费刷新，否则照常扣 refreshCost，最后才消耗掉这次特殊刷新。
  const requirements=runStrategyEvent(this,'refreshRequirements');for(const r of requirements){if(r.bond&&offers.filter(id=>this.data.season.charChessDataDict[id].bondIds.includes(r.bond)).length<r.minCount)return false;if(r.duplicateCount&&!offers.some(id=>offers.filter(x=>x===id).length>=r.duplicateCount))return false;if(r.freezeOne){if(!this.manualPreview)throw Error('Per-slot freeze still requires the shop controller');this.s.frozenSlots=[0];}}if(this.s.freeRefresh>0)this.s.freeRefresh--;else if(!this.spend(this.terms().refreshCost))return false;if(this.s.forcedRefresh)this.s.forcedRefresh=this.s.forcedRefresh.count>1?{...this.s.forcedRefresh,count:this.s.forcedRefresh.count-1}:null;
  this.s.offers=offers.slice();this.s.locked=false;this.s.roundRefreshCount++;for(const u of this.s.units.slice())this.triggerGarrisons('SERVER_REFRESH_SHOP',u);runStrategyEvent(this,'refreshed');if(this.bonds().miraShip.active&&this.s.freeRefresh===0){const effect=this.data.season.effectBuffInfoDataDict[this.data.season.bondInfoDict.miraShip.effectId].find(e=>e.key==='bond_refresh_shop_next_free'),p=blackboard(effect.blackboard);if(this.random()<Math.min(1,p.baseprob+p.prob*(this.s.bondLayers.miraShip||0)))this.s.freeRefresh++;}return true;
 }
 sell(uid){const unit=this.s.units.find(u=>u.uid===uid),owners=this.s.units.filter(u=>u.uid!==uid).flatMap(owner=>owner.equipment.map(item=>({owner,item,effects:this.data.season.effectBuffDataList?.[this.data.season.trapChessDataDict[item.chessId]?.effectId]||this.data.season.effectBuffInfoDataDict[this.data.season.trapChessDataDict[item.chessId]?.effectId]||[]})));if(!unit)return false;const vodfoxKey='vodfox:'+this.s.round;if(this.s.bandId==='band_vodfox'&&!this.data.season.charChessDataDict[unit.chessId]?.isGolden&&!this.s.strategyClaims[vodfoxKey]){const indices=this.s.offers.map((id,i)=>id?i:null).filter(i=>i!==null);if(indices.length){const index=this.pick(indices),replacement=this.s.offers[index];this.s.offers[index]=null;this.s.units=this.s.units.filter(x=>x!==unit);this.s.items.push(...(unit.equipment||[]));restoreStock(this.s,unit);this.s.strategyClaims[vodfoxKey]=1;this.gain(replacement);return true;}}if(!super.sell(uid))return false;this.settleBondRewards();this.triggerGarrisons('SERVER_CHESS_SOLD',unit);for(const {owner,item,effects} of owners)for(const effect of effects){if(effect.key!=='sell_char_count_gain_equip_owner_bond')continue;const p=blackboard(effect.blackboard),count=Number(p.count)||8,key='sell:'+item.uid;owner.strategySellCounts??={};owner.strategySellCounts[key]=(owner.strategySellCounts[key]||0)+1;if(owner.strategySellCounts[key]>=count){owner.strategySellCounts[key]-=count;const bond=this.pick(this.ownBonds(owner));this.gain(this.draw({kind:'operator',bond,maxTier:this.s.level}));}}return true;}
 rewardFromPool(pool,count,choice,kind='operator'){const offers=Array.from({length:count},()=>this.draw({kind,pool}));const reward={pool,offers,choice,kind};if(this.s.rewardPending)this.s.rewardQueue.push(reward);else this.s.rewardPending=reward;}
 takePromotion(id){
  const reward=this.s.rewardPending;if(!reward)return false;if(reward.offers){if(!reward.offers.includes(id))return false;this.s.rewardPending=null;reward.kind==='item'?this.gainItem(id):this.gain(id);}else if(!super.takePromotion(id))return false;
  if(this.s.rewardQueue.length){if(this.s.rewardPending)this.s.rewardQueue.push(this.s.rewardPending);this.s.rewardPending=this.s.rewardQueue.shift();}return true;
 }
 startPreparation(){
  if(this.s.phase!=='prep'||this.s.lastPrepRound===this.s.round)return false;this.s.lastPrepRound=this.s.round;this.s.funds+=this.s.nextRoundBonus+this.s.carryFunds;this.s.nextRoundBonus=0;this.s.carryFunds=0;runStrategyEvent(this,'prep');
  for(const u of this.s.units.slice().sort((a,b)=>(a.position?.y??999)-(b.position?.y??999)||(a.position?.x??999)-(b.position?.x??999)))this.triggerGarrisons('SERVER_PREP_START',u);this.settleBondRewards();return true;
 }
 beginBattle(){
  if(this.s.phase!=='prep'||this.s.rewardPending)return false;if(this.s.prepApplied)return super.beginBattle();for(const u of this.s.units.slice())this.triggerGarrisons('SERVER_PREP_FIN',u);
  const rows=this.bonds();if(rows.deputShip.active){const variants=new Set(this.s.units.filter(u=>u.position&&this.ownBonds(u).includes('deputShip')).map(u=>u.charId+':'+this.data.season.charChessDataDict[u.chessId].isGolden));const amount=variants.size>=3?4:2;for(const[id,b]of Object.entries(rows))if(b.active)this.addLayers(id,amount);}
  runStrategyEvent(this,'prepEnd');this.s.prepApplied=true;if(this.s.rewardPending)return true;return super.beginBattle();
 }
 nextRound(...args){const result=super.nextRound(...args);if(result&&['prep','decision'].includes(this.s.phase)){this.s.roundGainCount=0;this.s.roundSpent=0;this.s.roundRefreshCount=0;this.s.roundBoughtBonds={};if(this.s.phase==='prep')this.startPreparation();}return result;}
}
