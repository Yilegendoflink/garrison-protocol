import {NativeEconomy} from './native-economy.js';
import {NativeBattle} from './native-battle.js';
import {buildPhasePlan,blackboard} from './protocol.js';
import {runStrategyEvent} from './strategy.js';
import {createWaveRoster} from './native-wave-random.js';

export class NativeSession extends NativeEconomy {
 constructor(data,{modeId='mode_single_normal',bandId='band_bldsk',mapId,seed=Date.now(),waveRoster=null,egg325=false,cat=false,playerId='local',teamPeers=[],teamTransport=null}={}){
  const map=data.maps.find(m=>m.stageId===mapId)||data.maps.find(m=>m.weight>0);super(data,modeId,{bandId,board:map,seed,manualPreview:true,playerId,teamPeers});this.map=map;this.teamTransport=teamTransport;this.battle=null;this.s.mapId=map.stageId;this.s.itemOffers=[];this.s.summonCards=[];this.s.capacity=8;this.s.passiveIncome=0;this.s.history=[];this.s.runResult=null;this.s.frozenSlots=[];this.s.roundDecisions=[];this.s.enemyModifiers=[];this.s.operatorModifiers=[];this.s.commands=[];
  this.poolDraw=request=>this.drawFromPool(request);this.s.offers=this.rollOffers();this.fillItems();this.startPreparation();this.ensureRewards();this.s.waveRoster=waveRoster||createWaveRoster({random:()=>this.random(),data:this.data,modeId:this.s.modeId});if(egg325)this.s.egg325=true;if(cat){this.s.cat=true;this.s.funds=Number.MAX_SAFE_INTEGER;}
 }
 summonCardSpecs(u){const p=this.data.profiles[u?.chessId],skillIndex=u?.skillIndex??p?.skillIndex??0,out=[];if(p?.branch==='tactician'){if(u.charId==='char_427_vigil')out.push({type:'vigil-wolf',name:'狼群',count:1,mode:'manual'});if(u.charId==='char_249_mlyss')out.push({type:'mlyss-fluid',name:'流形',count:1,mode:'manual'});}if(u.charId==='char_4162_cathy')out.push({type:'cathy-device',name:'支援装置',count:3,mode:'manual'});if(u.charId==='char_108_silent'&&skillIndex===1)out.push({type:'silent-drone',name:'医疗无人机',count:1,mode:'skill'});if(u.charId==='char_1012_skadi2')out.push({type:'skadi2-seaborn',name:'海嗣',count:1,mode:'auto'});return out;}
 syncSummonCards({resetPlaced=false}={}){this.s.summonCards??=[];const owners=new Map(this.s.units.filter(u=>u.position&&this.summonCardSpecs(u).length).map(u=>[u.uid,u]));this.s.summonCards=this.s.summonCards.filter(card=>{const owner=owners.get(card.ownerUid),spec=owner&&this.summonCardSpecs(owner).find(x=>x.type===card.type);if(!spec)return false;if(resetPlaced)card.position=null;card.mode=spec.mode;return true;});for(const owner of owners.values())for(const spec of this.summonCardSpecs(owner)){const existing=this.s.summonCards.filter(card=>card.ownerUid===owner.uid&&card.type===spec.type);for(let i=existing.length;i<spec.count;i++)this.s.summonCards.push({uid:++this.s.seq,kind:'summon-card',type:spec.type,name:spec.name,mode:spec.mode,ownerUid:owner.uid,position:null,dir:0});}}
 summonCardRange(card,x,y){const owner=this.s.units.find(u=>u.uid===card.ownerUid);if(!owner?.position)return false;const grids=this.data.profiles[owner.chessId]?.range?.grids||[];return grids.some(g=>{let dx=g.col,dy=-g.row;for(let i=0;i<(owner.dir||0);i++)[dx,dy]=[-dy,dx];return owner.position.x+dx===x&&owner.position.y+dy===y;});}
 canDeploySummonCard(cardUid,x,y){if(this.s.phase!=='prep')return false;const card=this.s.summonCards?.find(c=>c.uid===cardUid),cell=this.map.grid[y]?.[x];if(!card||!cell||cell.buildableType==='NONE'||cell.obstacle||!this.summonCardRange(card,x,y))return false;if(card.type==='cathy-device'&&this.s.summonCards.filter(c=>c.uid!==card.uid&&c.ownerUid===card.ownerUid&&c.type===card.type&&c.position).length>=2)return false;if(['vigil-wolf','skadi2-seaborn'].includes(card.type)&&cell.heightType==='HIGHLAND')return false;return card.type==='cathy-device'||(!this.s.units.some(u=>u.position?.x===x&&u.position?.y===y)&&!this.s.summonCards.some(c=>c.uid!==card.uid&&c.position?.x===x&&c.position?.y===y));}
 deploySummonCard(cardUid,x,y,dir=0){if(!this.canDeploySummonCard(cardUid,x,y))return false;const card=this.s.summonCards.find(c=>c.uid===cardUid);card.position={x,y};card.dir=dir;return true;}
 withdrawSummonCard(cardUid){if(this.s.phase!=='prep')return false;const card=this.s.summonCards?.find(c=>c.uid===cardUid&&c.position);if(!card)return false;card.position=null;return true;}
 eligible(){return Object.values(this.data.season.charShopChessDatas).filter(o=>o.charId&&!o.isHidden);}
 drawFromPool(r){
  if(r.kind==='item'){let items=this.data.items.filter(i=>!i.hidden&&i.rank<=this.s.level);const tier=Number(String(r.pool||'').match(/shop_(\d)/)?.[1]);if(tier)items=this.data.items.filter(i=>!i.hidden&&i.rank===tier);if(String(r.pool||'').includes('equip_vict'))items=items.filter(i=>i.normal?.giveBondId==='victoriaShip'||this.data.season.trapChessDataDict[i.id]?.giveBondId==='victoriaShip');if(!items.length)throw Error('没有可用装备');return this.pick(items).id;}
  const pool=String(r.pool||''),fixedTier=r.tier||Number(pool.match(/shop_(\d)/)?.[1]);let rows=this.eligible();if(fixedTier)rows=rows.filter(o=>o.chessLevel===fixedTier);else rows=rows.filter(o=>o.chessLevel<=(r.maxTier||this.s.level));
  if(r.bond)rows=rows.filter(o=>this.data.season.charChessDataDict[o.chessId].bondIds.includes(r.bond));if(r.excludeCharId)rows=rows.filter(o=>o.charId!==r.excludeCharId);
  if(pool.includes('later'))rows=this.eligible().filter(o=>o.chessLevel>=4&&this.data.season.charChessDataDict[o.chessId].bondIds.includes('lateranoShip'));
  if(!rows.length)throw Error('当前候选池没有匹配干员');
  if(!fixedTier&&r.maxTier&&!pool.includes('later')){
   const maxTier=Math.max(...rows.map(o=>o.chessLevel)),previous=maxTier-1;
   const top=rows.filter(o=>o.chessLevel===maxTier),prev=rows.filter(o=>o.chessLevel===previous),lower=rows.filter(o=>o.chessLevel<previous);
   let candidates,roll=this.random();
   if(maxTier<=1)candidates=top;
   else if(maxTier===2)candidates=roll<.7?top:prev;
   else if(roll<.6)candidates=top;
   else if(roll<.9)candidates=prev;
   else candidates=lower;
   if(!candidates?.length)candidates=top.length?top:prev.length?prev:lower;
   if(!candidates.length)throw Error('当前候选池没有匹配阶级');
   return this.pick(candidates).chessId;
  }
  const row=this.pick(rows);return pool.includes('later')?row.goldenChessId:row.chessId;
 }
 rollOffers(){const required=runStrategyEvent(this,'refreshRequirements'),forced=this.s.forcedRefresh;let rows=Array.from({length:this.terms().operatorSlots},()=>this.drawFromPool({kind:'operator',maxTier:this.s.level,bond:forced?.bond}));for(const r of required){if(r.bond)for(let i=0;i<r.minCount;i++)rows[i]=this.drawFromPool({kind:'operator',bond:r.bond,maxTier:this.s.level});if(r.duplicateCount)for(let i=1;i<Math.min(rows.length,r.duplicateCount);i++)rows[i]=rows[0];}return rows;}
 fillItems(){if(this.s.level<3){this.s.itemOffers=[];return;}this.s.itemOffers=Array.from({length:this.terms().itemSlots},()=>this.drawFromPool({kind:'item'}));}
 ensureRewards(){const r=this.s.rewardPending;if(r?.tier&&!r.offers){r.offers=Array.from({length:3},()=>this.drawFromPool({kind:'operator',tier:r.tier}));r.kind='operator';}}
 rewardFromBond(owner,count){const bonds=this.ownBonds(owner).filter(Boolean);if(!bonds.length)return false;this.s.rewardPending={offers:Array.from({length:count},()=>this.drawFromPool({kind:'operator',bond:this.pick(bonds),maxTier:this.s.level})),choice:1,kind:'operator'};return true;}
 rewardFromTier(tier,count){this.s.rewardPending={offers:Array.from({length:count},()=>this.drawFromPool({kind:'operator',tier:Math.min(6,tier)})),choice:1,kind:'operator'};return true;}
 applyPostBattleTransforms(){for(const u of this.s.units.filter(x=>x.transformAfterBattle)){const id=this.drawFromPool({kind:'operator',tier:Math.min(6,(u.rank||1)+1)}),shop=this.data.season.charShopChessDatas[id];u.chessId=id;u.charId=shop.charId;u.rank=shop.chessLevel;delete u.transformAfterBattle;}}
  // 装备增减后重算盟约：以干员自身盟约为底，叠加装备给出的盟约。战略层加过的盟约层不在 u.bondIds 里，不受影响。
 refreshEquipmentBonds(u){const base=this.data.season.charChessDataDict[u.chessId]?.bondIds||[];const extra=u.equipment.map(i=>this.data.season.trapChessDataDict[i.chessId]).filter(d=>d?.canGiveBond&&d.giveBondId).map(d=>d.giveBondId);const next=[...new Set([...base,...extra])];const cur=this.ownBonds(u);if(next.length!==cur.length||next.some((id,i)=>cur[i]!==id))u.bondIds=next;}
  // 获取装备时，若干员身上已有同名未进阶装备，则连身上那件一起收走，合成的进阶装备留在手牌（盟约页说明的口径）。
  gainItem(chessId){
   const def=this.data.season.trapChessDataDict[chessId];if(!def)throw Error('Unknown item '+chessId);const item={uid:++this.s.seq,chessId};this.s.items.push(item);
   if(!def.upgradeChessId)return item;
   const worn=[...this.s.units.flatMap(u=>u.equipment.map(i=>({i,owner:u})))].filter(x=>x.i.chessId===chessId);
   if(worn.length&&this.s.items.filter(i=>i.chessId===chessId).length>=def.upgradeNum){
    const take=this.s.items.filter(i=>i.chessId===chessId).slice(0,def.upgradeNum);
    for(const it of take)this.s.items=this.s.items.filter(x=>x.uid!==it.uid);
    for(const x of worn){x.owner.equipment=x.owner.equipment.filter(i=>i.uid!==x.i.uid);this.refreshEquipmentBonds(x.owner);}
    const merged={uid:++this.s.seq,chessId:def.upgradeChessId};this.s.items.push(merged);return merged;
   }
   const copies=[...this.s.items.map(i=>({i,owner:null})),...this.s.units.flatMap(u=>u.equipment.map(i=>({i,owner:u})))].filter(x=>x.i.chessId===chessId);
   if(copies.length>=def.upgradeNum){const chosen=copies.slice(0,def.upgradeNum),owner=chosen.find(x=>x.owner)?.owner;for(const x of chosen){if(x.owner)x.owner.equipment=x.owner.equipment.filter(i=>i.uid!==x.i.uid);else this.s.items=this.s.items.filter(i=>i.uid!==x.i.uid);}const merged={uid:++this.s.seq,chessId:def.upgradeChessId};if(owner)owner.equipment.push(merged);else this.s.items.push(merged);return merged;}
   return item;
  }
 perform(type,...args){
  const before=structuredClone(this.s);let result;
  try{
   if(type==='refresh'){const frozen=this.s.frozenSlots?.slice()||[],previous=this.s.offers.slice(),offers=this.rollOffers();for(const index of frozen)if(previous[index])offers[index]=previous[index];if(frozen.length){const free=offers.map((_,i)=>i).filter(i=>!frozen.includes(i));if(free.length>1)offers[free[1]]=offers[free[0]];}result=this.refresh(offers);if(result)this.fillItems();}
   // 升级只解锁更高阶的干员候选，不动装备商品槽：装备槽只按回合刷新（advanceRound 里的 fillItems）
   else if(type==='upgrade'){result=this.upgrade();}
   else if(type==='lock'){if(this.s.phase!=='prep')return false;this.s.locked=!this.s.locked;result=true;}
  else if(type==='withdraw'){const u=this.s.units.find(u=>u.uid===args[0]);if(this.s.phase!=='prep'||!u?.position||this.hand().length>=10)return false;u.position=null;this.settleBondRewards();result=true;}
  else if(type==='withdrawSummon')result=this.withdrawSummonCard(args[0]);
   else if(type==='skill'){const u=this.s.units.find(u=>u.uid===args[0]),p=this.data.profiles[u?.chessId];if(this.s.phase!=='prep'||!u||!p.skillChoices[args[1]])return false;u.skillIndex=args[1];result=true;}
   else if(type==='buyItem')result=this.buyItem(args[0]);
   else if(type==='equip')result=this.equip(args[0],args[1],args[2]);
   else if(type==='bounty')result=this.chooseBounty(args[0]);
   else if(type==='discard'){if(this.s.phase!=='prep')return false;this.s.items=this.s.items.filter(i=>i.uid!==args[0]);result=true;}
   else if(type==='destroy')result=this.destroyItem(args[0]);
   else if(type==='destroyEquip')result=this.destroyEquipment(args[0],args[1]);
  else if(type==='deploySummon')result=this.deploySummonCard(args[0],args[1],args[2],args[3]);
   else if(type==='start')result=this.startBattle();
   else if(type==='stop'){if(!this.battle?.s.benchmark)return false;this.battle.finish('manual');this.finishCurrentBattle();return true;}
   else if(type==='next')result=this.advanceRound();
   else if(type==='decision')result=this.chooseDecision(args[0]);
   else{const r=this.command(type,...args);result=r.ok;if(!result)throw Error(r.message||'当前条件不能执行此操作');}
   if(result===false){this.s=before;return false;}if(this.s.phase==='prep')this.syncSummonCards();this.ensureRewards();this.s.commands.push({round:this.s.round,type,args});if(type==='takePromotion'&&this.s.prepApplied&&!this.s.rewardPending)this.startBattle();return true;
  }catch(error){this.s=before;this.triggerChain=[];this.lastError=error.message;return false;}
 }
 buyItem(index){if(this.s.phase!=='prep'||this.s.rewardPending)return false;const id=this.s.itemOffers[index],item=this.data.season.trapChessDataDict[id];if(!item||this.hand().length>=10||!this.spend(item.purchasePrice))return false;this.s.itemOffers[index]=null;this.gainItem(id);return true;}
 // 主动销毁：手牌里的装备直接移除；干员身上的装备从槽位移除（不退回手牌）。
 destroyItem(itemUid){if(this.s.phase!=='prep')return false;const item=this.s.items.find(i=>i.uid===itemUid);if(!item)return false;this.s.items=this.s.items.filter(i=>i.uid!==itemUid);this.s.events.push({type:'destroyItem',uid:itemUid,chessId:item.chessId});return true;}
 destroyEquipment(unitUid,slot){if(this.s.phase!=='prep')return false;const u=this.s.units.find(x=>x.uid===unitUid);if(!u||!Number.isInteger(slot))return false;const item=u.equipment[slot];if(!item)return false;u.equipment.splice(slot,1);this.refreshEquipmentBonds(u);this.s.events.push({type:'destroyItem',uid:item.uid,chessId:item.chessId});return true;}
 equip(itemUid,unitUid,replaceIndex=null){
  if(this.s.phase!=='prep')return false;const item=this.s.items.find(i=>i.uid===itemUid),u=this.s.units.find(u=>u.uid===unitUid);if(!item||!u)return false;const def=this.data.season.trapChessDataDict[item.chessId],effects=this.data.season.effectBuffInfoDataDict[def.effectId]||[];let consumed=false;
  if(def.itemType==='MAGIC'){const effect=effects.find(e=>e.key==='trap_create_self_choice'||e.key==='trap_copy_front_char');if(effect?.key==='trap_create_self_choice'){const pool=Object.entries(this.data.season.effectInfoDataDict).filter(([id,info])=>info.effectType==='ENEMY_GAIN'&&this.data.season.effectBuffInfoDataDict[id]?.some(e=>['add_enemy_selfbattle_win_gain_coin','next_battle_add_enemy_win_gain_coin'].includes(e.key)));this.s.rewardPending={kind:'bounty',choice:1,offers:Array.from({length:3},()=>this.pick(pool)[0])};consumed=true;}if(effect?.key==='trap_copy_front_char'){const copy=this.gain(u.chessId);copy.equipment=(u.equipment||[]).map(i=>({uid:++this.s.seq,chessId:i.chessId}));copy.bondIds=[...this.ownBonds(u)];consumed=true;}if(consumed){this.s.items=this.s.items.filter(i=>i.uid!==itemUid);return true;}}
  for(const e of effects){const p=blackboard(e.blackboard);if(e.key==='equip_destory_gain_random_coin'){this.s.funds+=p.min+Math.floor(this.random()*(p.max-p.min+1));consumed=true;}if(e.key==='use_equip_gain_coin_when_next_round_start'){this.s.nextRoundBonus+=p.count;consumed=true;}if(e.key==='gain_coin_when_round_start'){this.s.passiveIncome+=p.count;consumed=true;}if(e.key==='use_equip_reward_char_chess_bond_layer'){for(const b of this.ownBonds(u))this.addLayers(b,p.layer,false);consumed=true;}if(e.key==='equip_destory_deployment_cnt_change'){this.s.capacity=p.count;consumed=true;}if(e.key==='use_equip_upgrade_char'){const next=this.data.season.charChessDataDict[u.chessId].upgradeChessId;if(next)u.chessId=next;consumed=true;}if(e.key==='use_equip_reward_char_chess_with_same_bond'){for(let n=0;n<p.count;n++)this.gain(this.drawFromPool({kind:'operator',bond:this.pick(this.ownBonds(u)),maxTier:this.s.level}));consumed=true;}if(e.key==='use_equip_reward_random_char_chess_in_shop'){const indices=this.s.offers.map((x,i)=>x?i:null).filter(x=>x!==null);for(let n=0;n<p.count&&indices.length;n++){const index=indices.splice(Math.floor(this.random()*indices.length),1)[0];this.gain(this.s.offers[index]);this.s.offers[index]=null;}consumed=true;}}
  for(const e of effects){const p=blackboard(e.blackboard);if(e.key==='use_equip_reward_special_goods_char_chess')consumed=this.rewardFromBond(u,p.refresh_cnt||3)||consumed;if(e.key==='use_equip_recruit_new_char_and_give_char_to_player_most_bond'){this.rewardFromTier(u.rank||1,p.refresh_cnt||2);if(this.s.bandId==='band_fang')this.queueFangTransfer(u);this.s.units=this.s.units.filter(x=>x!==u);consumed=true;}if(e.key==='char_chess_transformation_equip'){u.transformAfterBattle=true;consumed=true;}if(e.key==='use_equip_upgrade_char'){const normal=this.data.season.chessNormalIdLookupDict[u.chessId]||u.chessId,golden=this.data.season.charShopChessDatas[normal]?.goldenChessId;if(golden)u.chessId=golden;consumed=true;}}
  if(!consumed){if(u.equipment.length>=2){if(replaceIndex===null)return false;const old=u.equipment.splice(replaceIndex,1)[0];if(old)this.s.items.push(old);}u.equipment.push(item);if(def.canGiveBond&&def.giveBondId)u.bondIds=[...new Set([...this.ownBonds(u),def.giveBondId])];this.refreshEquipmentBonds(u);}
  this.s.items=this.s.items.filter(i=>i.uid!==itemUid);this.settleBondRewards();return true;
 }
 chooseBounty(id){const reward=this.s.rewardPending;if(this.s.phase!=='prep'||reward?.kind!=='bounty'||!reward.offers.includes(id))return false;const effect=(this.data.season.effectBuffInfoDataDict[id]||[]).find(e=>['add_enemy_selfbattle_win_gain_coin','next_battle_add_enemy_win_gain_coin'].includes(e.key));if(!effect)return false;const p=blackboard(effect.blackboard),enemyId=String(p.enemy_id||'');if(!this.data.enemies[enemyId])return false;this.s.pendingBounty={enemyId,coin:Number(p.coin)||1,count:Number(p.count)||1};this.s.rewardPending=null;return true;}
 canDeploy(uid,x,y){
  if(!Number.isInteger(x)||!Number.isInteger(y))return false;
  const u=this.s.units.find(u=>u.uid===uid),cell=this.map.grid[y]?.[x];if(!u||!cell||this.s.phase!=='prep'||cell.buildableType==='NONE')return false;
  const valid=(unit,tile)=>this.data.profiles[unit.chessId].position!=='MELEE'||tile.heightType!=='HIGHLAND';if(!valid(u,cell))return false;
  const other=this.s.units.find(v=>v.uid!==uid&&v.position?.x===x&&v.position?.y===y),old=u.position;
  if(!old&&!other&&this.s.units.filter(v=>v.position).length>=this.s.capacity)return false;
  return !other||!old||valid(other,this.map.grid[old.y][old.x]);
 }
 deploy(uid,x,y,dir){
  if(!Number.isInteger(dir)||dir<0||dir>3||!this.canDeploy(uid,x,y))return false;
  const u=this.s.units.find(u=>u.uid===uid),other=this.s.units.find(v=>v.uid!==uid&&v.position?.x===x&&v.position?.y===y),old=u.position;
  if(other)other.position=old;u.position={x,y};u.dir=dir;if(old&&(old.x!==x||old.y!==y))for(const card of this.s.summonCards||[])if(card.ownerUid===u.uid)card.position=null;this.settleBondRewards();this.syncSummonCards();return true;
 }
 fangRecipient(bonds){const peers=(this.s.teamPeers||[]).filter(p=>p?.playerId&&p.playerId!==this.s.playerId);if(!peers.length)return null;const scored=peers.map(peer=>({peer,score:Math.max(0,...bonds.map(id=>Number(peer.bondCounts?.[id]??0)))})),max=Math.max(...scored.map(x=>x.score));return this.pick(scored.filter(x=>x.score===max).map(x=>x.peer));}
 queueFangTransfer(u){const bonds=this.ownBonds(u).filter(Boolean),recipient=this.fangRecipient(bonds),record={transferId:`fang:${this.s.playerId}:${this.s.round}:${u.uid}:${this.s.seq}`,senderId:this.s.playerId,recipientId:recipient?.playerId||null,dueRound:this.s.round+1,chessId:u.chessId,charId:u.charId,rank:u.rank,skillIndex:u.skillIndex??0,bondIds:[...bonds],equipment:(u.equipment||[]).map(i=>({chessId:i.chessId}))};this.s.transferOutbox.push(record);if(this.teamTransport?.send){try{const accepted=this.teamTransport.send(structuredClone(record));if(accepted===true)record.sent=true;}catch{record.transportError='send-failed';}}return record;}
 attachTeamTransport(teamTransport){this.teamTransport=teamTransport;return this;}
 takeFangTransfers(){const pending=this.s.transferOutbox.filter(r=>!r.sent);for(const r of pending)r.sent=true;return structuredClone(pending);}
 receiveFangTransfer(record){if(!record?.transferId||record.recipientId!==this.s.playerId||!this.data.profiles[record.chessId]||this.s.strategyClaims[`fang:received:${record.transferId}`]||this.s.transferInbox.some(r=>r.transferId===record.transferId))return false;this.s.transferInbox.push(structuredClone(record));return true;}
 applyTransferInbox(){const due=[],keep=[];for(const record of this.s.transferInbox||[])(record.dueRound??0)<=this.s.round?due.push(record):keep.push(record);this.s.transferInbox=keep;for(const record of due){if(this.s.strategyClaims[`fang:received:${record.transferId}`])continue;const unit=this.gain(record.chessId);unit.bondIds=[...(record.bondIds||this.ownBonds(unit))];unit.skillIndex=record.skillIndex??unit.skillIndex;unit.equipment=(record.equipment||[]).map(i=>({uid:++this.s.seq,chessId:i.chessId}));this.s.strategyClaims[`fang:received:${record.transferId}`]=1;}}
 startPreparation(){const result=super.startPreparation();if(result){this.applyTransferInbox();if(this.s.bandId==='band_amedic'&&!this.s.strategyClaims.touchReserve){const u=this.gain('chess_virtual_prepared_medic');u.touchReserve=true;this.s.strategyClaims.touchReserve=1;}}return result;}
 applyTouchReplacement(){if(this.s.bandId!=='band_amedic'||this.s.strategyClaims.touchReplacement)return false;const elites=this.s.units.filter(u=>u.position&&this.data.season.charChessDataDict[u.chessId]?.isGolden).length,target=this.s.units.find(u=>u.touchReserve);if(elites<2||!target)return false;target.chessId='chess_virtual_touch';target.charId='char_613_acmedc';target.rank=6;target.touchReserve=false;this.s.strategyClaims.touchReplacement=1;return true;}
 startBattle(){if(this.s.phase!=='prep'||this.s.rewardPending||!this.s.units.some(u=>u.position))return false;this.applyTouchReplacement();const ok=this.beginBattle();if(!ok)return false;if(this.s.phase==='prep')return true;const turn=buildPhasePlan(this.data,this.s.modeId).find(t=>t.round===this.s.round);this.battle=new NativeBattle(this.data,this,this.map,turn);return true;}
 finishCurrentBattle(){if(!this.battle?.s.finished||this.s.phase!=='battle')return;const r=this.battle.s.result;this.s.history.push(r);if(r.kind==='training-dummy'){this.s.runResult=r;this.s.phase='finished';}else{this.s.hp=Math.max(0,this.s.hp-r.leaks);this.finishBattle({success:this.s.hp>0,leaks:r.leaks});if(!this.s.hp)this.s.runResult=r;}this.applyPostBattleTransforms();}
 tick(){if(this.s.phase==='battle'&&this.battle){this.battle.step();this.finishCurrentBattle();}}
 advanceRound(){if(this.s.phase!=='intermission')return false;const locked=this.s.locked,oldOffers=locked?this.s.offers.slice():null,oldItems=locked?this.s.itemOffers.slice():null;this.s.prepApplied=false;const ok=this.nextRound(locked?[]:this.rollOffers());if(!ok)return false;if(locked){const refillOffers=this.rollOffers();this.s.offers=Array.from({length:this.terms().operatorSlots},(_,i)=>oldOffers[i]??refillOffers[i]);if(this.s.level<3)this.s.itemOffers=[];else{const refillItems=Array.from({length:this.terms().itemSlots},()=>this.drawFromPool({kind:'item'}));this.s.itemOffers=Array.from({length:this.terms().itemSlots},(_,i)=>oldItems[i]??refillItems[i]);}}else this.fillItems();this.s.funds+=this.s.passiveIncome;
  if(this.s.phase==='prep')this.syncSummonCards({resetPlaced:true});if(this.s.phase==='decision'){const pool=Object.values(this.data.season.effectInfoDataDict).filter(e=>e.effectType==='BUFF_GAIN'&&this.data.season.effectBuffInfoDataDict[e.effectId]?.every(x=>['global_special_choice_gain_coin','global_special_choice_refresh_free','global_special_choice_bond_addlayer','enemy_attribute_add','enemy_attribute_mul','char_attribute_mul'].includes(x.key)));this.s.roundDecisions=[];while(this.s.roundDecisions.length<3&&pool.length){const i=Math.floor(this.random()*pool.length);this.s.roundDecisions.push(pool.splice(i,1)[0].effectId);}}
  return true;
 }
 chooseDecision(id){if(this.s.phase!=='decision'||!this.s.roundDecisions.includes(id))return false;for(const e of this.data.season.effectBuffInfoDataDict[id]){const p=blackboard(e.blackboard);if(e.key==='global_special_choice_gain_coin')this.s.funds+=p.count;if(e.key==='global_special_choice_refresh_free')this.s.freeRefresh+=p.count;if(e.key==='global_special_choice_bond_addlayer')for(const b of p.bond_list.split(','))this.addLayers(b,p.count,false);if(e.key.startsWith('enemy_attribute'))this.s.enemyModifiers.push(e);if(e.key==='char_attribute_mul')this.s.operatorModifiers.push(e);}this.s.roundDecisions=[];this.s.phase='prep';this.startPreparation();return true;}
 snapshot(){return {version:this.data.version,s:this.s,battle:this.battle?.s||null,savedAt:Date.now()};}
 static restore(data,record){
  record=structuredClone(record);
 const s=record?.s,n=v=>typeof v==='number'&&Number.isFinite(v),integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
  if(!s||record.version!==data.version||!data.season.modeDataDict[s.modeId]||!data.season.bandDataListDict[s.bandId]||!data.maps.some(m=>m.stageId===s.mapId)||!integer(s.level,1,6)||!integer(s.round,1,15)||!integer(s.capacity,1,99)||!n(s.funds)||s.funds<0||!n(s.hp)||!n(s.maxHp)||s.hp<0||s.hp>s.maxHp||!['prep','battle','decision','intermission','finished'].includes(s.phase)||![undefined,true].includes(s.cat)||![undefined,true].includes(s.egg325)||!n(record.savedAt)||Date.now()>=(record.expiresAt??record.savedAt+86400000))return null;
  const item=i=>i&&integer(i.uid,1,Number.MAX_SAFE_INTEGER)&&!!data.season.trapChessDataDict[i.chessId];
  if(!Array.isArray(s.units)||s.units.length>500||!Array.isArray(s.items)||s.items.length>1000||s.items.some(i=>!item(i))||s.units.some(u=>!integer(u.uid,1,Number.MAX_SAFE_INTEGER)||!data.profiles[u.chessId]||u.charId!==data.profiles[u.chessId].charId||!integer(u.dir,0,3)||!Array.isArray(u.equipment)||u.equipment.length>2||u.equipment.some(i=>!item(i))||(u.position!==null&&(!integer(u.position?.x,0,10)||!integer(u.position?.y,0,6)))))return null;
  if(!Array.isArray(s.offers)||s.offers.some(id=>id!==null&&!data.profiles[id])||!Array.isArray(s.itemOffers)||s.itemOffers.some(id=>id!==null&&!data.season.trapChessDataDict[id])||!Array.isArray(s.history))return null;
  if(record.battle&&(!Array.isArray(record.battle.units)||!Array.isArray(record.battle.enemies)||!n(record.battle.frame)||!n(record.battle.time)))return null;
  const c=Object.create(NativeSession.prototype);c.data=data;c.map=data.maps.find(m=>m.stageId===s.mapId);c.board=c.map;c.manualPreview=true;c.triggerChain=[];c.poolDraw=request=>c.drawFromPool(request);c.battle=null;c.s=s;c.s.playerId??='local';c.s.teamPeers??=[];c.s.transferInbox??=[];c.s.transferOutbox??=[];if(!c.s.waveRoster?.version)c.s.waveRoster=createWaveRoster({random:()=>c.random(),data,modeId:c.s.modeId});let migrated=false;for(const u of c.s.units)if(u.position&&c.map.grid[u.position.y][u.position.x].buildableType==='NONE'){u.position=null;migrated=true;}if(migrated&&record.battle){const deployed=new Set(c.s.units.filter(u=>u.position).map(u=>u.uid));record.battle.units=record.battle.units.filter(u=>deployed.has(u.uid));}if(record.battle){const turn=buildPhasePlan(data,c.s.modeId).find(t=>t.round===c.s.round);c.battle=NativeBattle.restore(data,c,c.map,turn,record.battle);if(!c.battle)return null;}return c;
 }
}
