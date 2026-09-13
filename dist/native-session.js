import {NativeEconomy} from './native-economy.js';
import {NativeBattle} from './native-battle.js';
import {buildPhasePlan,blackboard} from './protocol.js';
import {runStrategyEvent} from './strategy.js';

export class NativeSession extends NativeEconomy {
 constructor(data,{modeId='mode_single_normal',bandId='band_bldsk',mapId,seed=Date.now()}={}){
  const map=data.maps.find(m=>m.stageId===mapId)||data.maps.find(m=>m.weight>0);super(data,modeId,{bandId,board:map,seed,manualPreview:true});this.map=map;this.battle=null;this.s.mapId=map.stageId;this.s.itemOffers=[];this.s.capacity=8;this.s.passiveIncome=0;this.s.history=[];this.s.runResult=null;this.s.frozenSlots=[];this.s.roundDecisions=[];this.s.enemyModifiers=[];this.s.operatorModifiers=[];this.s.commands=[];
  this.poolDraw=request=>this.drawFromPool(request);this.s.offers=this.rollOffers();this.fillItems();this.startPreparation();this.ensureRewards();
 }
 eligible(){return Object.values(this.data.season.charShopChessDatas).filter(o=>o.charId&&!o.isHidden);}
 drawFromPool(r){
  if(r.kind==='item'){let items=this.data.items.filter(i=>!i.hidden&&i.rank<=this.s.level);const tier=Number(String(r.pool||'').match(/shop_(\d)/)?.[1]);if(tier)items=this.data.items.filter(i=>!i.hidden&&i.rank===tier);if(!items.length)throw Error('没有可用装备');return this.pick(items).id;}
  let rows=this.eligible(),tier=r.tier||Number(String(r.pool||'').match(/shop_(\d)/)?.[1]);if(tier)rows=rows.filter(o=>o.chessLevel===tier);else rows=rows.filter(o=>o.chessLevel<=(r.maxTier||this.s.level));
  if(r.bond)rows=rows.filter(o=>this.data.season.charChessDataDict[o.chessId].bondIds.includes(r.bond));if(r.excludeCharId)rows=rows.filter(o=>o.charId!==r.excludeCharId);
  if(String(r.pool).includes('later'))rows=this.eligible().filter(o=>o.chessLevel>=4&&this.data.season.charChessDataDict[o.chessId].bondIds.includes('lateranoShip'));
  if(!rows.length)throw Error('当前候选池没有匹配干员');const row=this.pick(rows);return String(r.pool).includes('later')?row.goldenChessId:row.chessId;
 }
 rollOffers(){const required=runStrategyEvent(this,'refreshRequirements'),forced=this.s.forcedRefresh;let rows=Array.from({length:this.terms().operatorSlots},()=>this.drawFromPool({kind:'operator',maxTier:this.s.level,bond:forced?.bond}));for(const r of required){if(r.bond)for(let i=0;i<r.minCount;i++)rows[i]=this.drawFromPool({kind:'operator',bond:r.bond,maxTier:this.s.level});if(r.duplicateCount)for(let i=1;i<Math.min(rows.length,r.duplicateCount);i++)rows[i]=rows[0];}return rows;}
 fillItems(){this.s.itemOffers=Array.from({length:this.terms().itemSlots},()=>this.drawFromPool({kind:'item'}));}
 ensureRewards(){const r=this.s.rewardPending;if(r?.tier&&!r.offers){r.offers=Array.from({length:3},()=>this.drawFromPool({kind:'operator',tier:r.tier}));r.kind='operator';}}
 perform(type,...args){
  const before=structuredClone(this.s);let result;
  try{
   if(type==='refresh'){result=this.refresh(this.rollOffers());if(result)this.fillItems();}
   else if(type==='lock'){if(this.s.phase!=='prep')return false;this.s.locked=!this.s.locked;result=true;}
   else if(type==='withdraw'){const u=this.s.units.find(u=>u.uid===args[0]);if(this.s.phase!=='prep'||!u?.position||this.hand().length>=10)return false;u.position=null;this.settleBondRewards();result=true;}
   else if(type==='skill'){const u=this.s.units.find(u=>u.uid===args[0]),p=this.data.profiles[u?.chessId];if(this.s.phase!=='prep'||!u||!p.skillChoices[args[1]])return false;u.skillIndex=args[1];result=true;}
   else if(type==='buyItem')result=this.buyItem(args[0]);
   else if(type==='equip')result=this.equip(args[0],args[1],args[2]);
   else if(type==='discard'){if(this.s.phase!=='prep')return false;this.s.items=this.s.items.filter(i=>i.uid!==args[0]);result=true;}
   else if(type==='start')result=this.startBattle();
   else if(type==='stop'){if(!this.battle?.s.benchmark)return false;this.battle.finish('manual');this.finishCurrentBattle();return true;}
   else if(type==='next')result=this.advanceRound();
   else if(type==='decision')result=this.chooseDecision(args[0]);
   else{const r=this.command(type,...args);result=r.ok;if(!result)throw Error(r.message||'当前条件不能执行此操作');}
   if(result===false){this.s=before;return false;}this.ensureRewards();this.s.commands.push({round:this.s.round,type,args});if(type==='takePromotion'&&this.s.prepApplied&&!this.s.rewardPending)this.startBattle();return true;
  }catch(error){this.s=before;this.triggerChain=[];this.lastError=error.message;return false;}
 }
 buyItem(index){if(this.s.phase!=='prep'||this.s.rewardPending)return false;const id=this.s.itemOffers[index],item=this.data.season.trapChessDataDict[id];if(!item||this.hand().length>=10||!this.spend(item.purchasePrice))return false;this.s.itemOffers[index]=null;this.gainItem(id);return true;}
 equip(itemUid,unitUid,replaceIndex=null){
  if(this.s.phase!=='prep')return false;const item=this.s.items.find(i=>i.uid===itemUid),u=this.s.units.find(u=>u.uid===unitUid);if(!item||!u)return false;const def=this.data.season.trapChessDataDict[item.chessId],effects=this.data.season.effectBuffInfoDataDict[def.effectId]||[];let consumed=false;
  for(const e of effects){const p=blackboard(e.blackboard);if(e.key==='equip_destory_gain_random_coin'){this.s.funds+=p.min+Math.floor(this.random()*(p.max-p.min+1));consumed=true;}if(e.key==='use_equip_gain_coin_when_next_round_start'){this.s.nextRoundBonus+=p.count;consumed=true;}if(e.key==='gain_coin_when_round_start'){this.s.passiveIncome+=p.count;consumed=true;}if(e.key==='use_equip_reward_char_chess_bond_layer'){for(const b of this.ownBonds(u))this.addLayers(b,p.layer,false);consumed=true;}if(e.key==='equip_destory_deployment_cnt_change'){this.s.capacity=p.count;consumed=true;}if(e.key==='use_equip_upgrade_char'){const next=this.data.season.charChessDataDict[u.chessId].upgradeChessId;if(next)u.chessId=next;consumed=true;}if(e.key==='use_equip_reward_char_chess_with_same_bond'){for(let n=0;n<p.count;n++)this.gain(this.drawFromPool({kind:'operator',bond:this.pick(this.ownBonds(u)),maxTier:this.s.level}));consumed=true;}if(e.key==='use_equip_reward_random_char_chess_in_shop'){const indices=this.s.offers.map((x,i)=>x?i:null).filter(x=>x!==null);for(let n=0;n<p.count&&indices.length;n++){const index=indices.splice(Math.floor(this.random()*indices.length),1)[0];this.gain(this.s.offers[index]);this.s.offers[index]=null;}consumed=true;}}
  if(!consumed){if(u.equipment.length>=2){if(replaceIndex===null)return false;const old=u.equipment.splice(replaceIndex,1)[0];if(old)this.s.items.push(old);}u.equipment.push(item);if(def.canGiveBond&&def.giveBondId)u.bondIds=[...new Set([...this.ownBonds(u),def.giveBondId])];}
  this.s.items=this.s.items.filter(i=>i.uid!==itemUid);this.settleBondRewards();return true;
 }
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
  if(other)other.position=old;u.position={x,y};u.dir=dir;this.settleBondRewards();return true;
 }
 startBattle(){if(this.s.phase!=='prep'||this.s.rewardPending||!this.s.units.some(u=>u.position))return false;const ok=this.beginBattle();if(!ok)return false;if(this.s.phase==='prep')return true;const turn=buildPhasePlan(this.data,this.s.modeId).find(t=>t.round===this.s.round);this.battle=new NativeBattle(this.data,this,this.map,turn);return true;}
 finishCurrentBattle(){if(!this.battle?.s.finished||this.s.phase!=='battle')return;const r=this.battle.s.result;this.s.history.push(r);if(r.kind==='training-dummy'){this.s.runResult=r;this.s.phase='finished';}else{this.s.hp=Math.max(0,this.s.hp-r.leaks);this.finishBattle({success:this.s.hp>0,leaks:r.leaks});if(!this.s.hp)this.s.runResult=r;}}
 tick(){if(this.s.phase==='battle'&&this.battle){this.battle.step();this.finishCurrentBattle();}}
 advanceRound(){if(this.s.phase!=='intermission')return false;const frozen=this.s.locked?this.s.itemOffers.slice():null;this.s.prepApplied=false;const ok=this.nextRound(this.rollOffers());if(!ok)return false;if(frozen)this.s.itemOffers=frozen;else this.fillItems();this.s.funds+=this.s.passiveIncome;
  if(this.s.phase==='decision'){const pool=Object.values(this.data.season.effectInfoDataDict).filter(e=>e.effectType==='BUFF_GAIN'&&this.data.season.effectBuffInfoDataDict[e.effectId]?.every(x=>['global_special_choice_gain_coin','global_special_choice_refresh_free','global_special_choice_bond_addlayer','enemy_attribute_add','enemy_attribute_mul','char_attribute_mul'].includes(x.key)));this.s.roundDecisions=[];while(this.s.roundDecisions.length<3&&pool.length){const i=Math.floor(this.random()*pool.length);this.s.roundDecisions.push(pool.splice(i,1)[0].effectId);}}
  return true;
 }
 chooseDecision(id){if(this.s.phase!=='decision'||!this.s.roundDecisions.includes(id))return false;for(const e of this.data.season.effectBuffInfoDataDict[id]){const p=blackboard(e.blackboard);if(e.key==='global_special_choice_gain_coin')this.s.funds+=p.count;if(e.key==='global_special_choice_refresh_free')this.s.freeRefresh+=p.count;if(e.key==='global_special_choice_bond_addlayer')for(const b of p.bond_list.split(','))this.addLayers(b,p.count,false);if(e.key.startsWith('enemy_attribute'))this.s.enemyModifiers.push(e);if(e.key==='char_attribute_mul')this.s.operatorModifiers.push(e);}this.s.roundDecisions=[];this.s.phase='prep';this.startPreparation();return true;}
 snapshot(){return {version:this.data.version,s:this.s,battle:this.battle?.s||null,savedAt:Date.now()};}
 static restore(data,record){
  const s=record?.s,n=v=>typeof v==='number'&&Number.isFinite(v),integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
  if(!s||record.version!==data.version||!data.season.modeDataDict[s.modeId]||!data.season.bandDataListDict[s.bandId]||!data.maps.some(m=>m.stageId===s.mapId)||!integer(s.level,1,6)||!integer(s.round,1,15)||!integer(s.capacity,1,99)||!n(s.funds)||s.funds<0||!n(s.hp)||!n(s.maxHp)||s.hp<0||s.hp>s.maxHp||!['prep','battle','decision','intermission','finished'].includes(s.phase)||!n(record.savedAt)||Date.now()>=(record.expiresAt??record.savedAt+86400000))return null;
  const item=i=>i&&integer(i.uid,1,Number.MAX_SAFE_INTEGER)&&!!data.season.trapChessDataDict[i.chessId];
  if(!Array.isArray(s.units)||s.units.length>500||!Array.isArray(s.items)||s.items.length>1000||s.items.some(i=>!item(i))||s.units.some(u=>!integer(u.uid,1,Number.MAX_SAFE_INTEGER)||!data.profiles[u.chessId]||u.charId!==data.profiles[u.chessId].charId||!integer(u.dir,0,3)||!Array.isArray(u.equipment)||u.equipment.length>2||u.equipment.some(i=>!item(i))||(u.position!==null&&(!integer(u.position?.x,0,10)||!integer(u.position?.y,0,6)))))return null;
  if(!Array.isArray(s.offers)||s.offers.some(id=>id!==null&&!data.profiles[id])||!Array.isArray(s.itemOffers)||s.itemOffers.some(id=>id!==null&&!data.season.trapChessDataDict[id])||!Array.isArray(s.history))return null;
  if(record.battle&&(!Array.isArray(record.battle.units)||!Array.isArray(record.battle.enemies)||!n(record.battle.frame)||!n(record.battle.time)))return null;
  const c=new NativeSession(data,{modeId:s.modeId,bandId:s.bandId,mapId:s.mapId,seed:1});c.s=s;let migrated=false;for(const u of c.s.units)if(u.position&&c.map.grid[u.position.y][u.position.x].buildableType==='NONE'){u.position=null;migrated=true;}if(migrated&&record.battle){const deployed=new Set(c.s.units.filter(u=>u.position).map(u=>u.uid));record.battle.units=record.battle.units.filter(u=>deployed.has(u.uid));}if(record.battle){const turn=buildPhasePlan(data,c.s.modeId).find(t=>t.round===c.s.round);c.battle=new NativeBattle(data,c,c.map,turn);c.battle.s=record.battle;}return c;
 }
}
