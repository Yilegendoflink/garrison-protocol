const params=e=>Object.fromEntries(e.blackboard.map(b=>[b.key,b.valueStr??b.value]));
const list=v=>String(v??'').split(',').filter(Boolean);
const fixedGain=(c,p)=>{for(let i=0;i<(p.count||1);i++)p.type==='char'?c.gain(p.chess):c.gainItem(p.chess);};
const randomGain=(c,p)=>{for(let i=0;i<(p.count||1);i++){const kind=p.type==='char'?'operator':'item',id=c.draw({kind,pool:p.pool});kind==='operator'?c.gain(id):c.gainItem(id);}};
const effects={
 preparation_start_gain_chess_from_round:{event:'prep',run:(c,p)=>{if(c.s.round===p.round)fixedGain(c,p);}},
 preparation_start_gain_chess_every_n_round:{event:'prep',run:(c,p)=>{if(c.s.round%p.round===0)fixedGain(c,p);}},
 give_coin_in_round:{event:'prep',run:(c,p)=>{if(c.s.round===p.round)c.addFunds(p.coin-(c.s.round+3));}},
 prep_start_gain_chess_from_pool_in_round:{event:'prep',run:(c,p)=>{if(c.s.round===p.round)randomGain(c,p);}},
 gain_bond_char_per_round:{event:'prep',run:(c,p)=>{if(c.s.round>=p.round&&(c.s.round-p.round)%p.preround===0)for(let i=0;i<p.count;i++)c.gain(c.draw({kind:'operator',bond:p.bond,maxTier:c.s.level}));}},
 round_start_bond_check_gain_layer:{event:'prep',run:(c,p)=>{if(c.s.round!==p.round)return;const ids=Object.keys(c.bonds()).filter(id=>c.bonds()[id].active);for(const id of ids)c.addLayers(id,ids.length===p.factioncount?p.count1:p.count2);}},
 round_start_activate_char_chess_effect_in_board:{event:'prep',run:(c,p)=>{const units=c.s.units.filter(u=>u.position&&c.hasGarrison(u,p.event_type)).sort((a,b)=>b.position.x-a.position.x||b.position.y-a.position.y);for(const u of units.slice(0,p.count))c.triggerGarrisons(p.event_type,u);}},
 round_start_gain_char_chess_in_shop_every_n_round:{event:'prep',run:(c,p)=>{if(c.s.round%p.round===0)for(let i=0;i<p.count;i++){const indices=c.s.offers.map((id,i)=>c.data.season.charShopChessDatas[id]?.charId?i:null).filter(i=>i!==null);if(indices.length){const index=c.pick(indices),id=c.s.offers[index];c.s.offers[index]=null;c.gain(id);}}}},
 preparation_start_add_special_goods_every_n_round:{event:'prep',run:(c,p)=>{if(c.s.round%p.round===0)c.rewardFromPool(p.pool,p.refresh_cnt,p.choice_cnt,'item');}},
 prep_finish_char_bond_add_layer:{event:'prepEnd',run:(c,p)=>{const units=c.s.units.filter(u=>u.position);for(const rank of new Set(units.map(u=>u.rank))){const u=c.pick(units.filter(u=>u.rank===rank));for(const id of c.ownBonds(u))c.addLayers(id,p.layer,false);}}},
 coin_carry_over:{event:'prepEnd',run:(c,p)=>{c.s.carryFunds=c.s.funds+Math.min(p.max,Math.floor(c.s.funds/p.capital))*p.interest;}},
 up_shop_add_special_goods:{event:'upgrade',run:(c,p)=>c.rewardFromPool(p.pool,p.count,p.choice,'item')},
 // 佩佩【博学多通】：升级到指定等级后，下一次主动刷新变成「特殊刷新」，出现的干员优先为该盟约干员。
 // 原表还带一个 price=0，但特殊刷新并不免费（图鉴文案没有「免费」字样），刷新费按常规价走，
 // 所以这里只记盟约、不记价格，免得又把 0 当成免单。
 up_shop_next_refresh_must_present_bond_char:{event:'upgrade',run:(c,p,k)=>{const level=Number(c.s.level);if(!list(p.lvlist).map(Number).includes(level))return;const claim=k+':level:'+level;if(c.s.strategyClaims[claim])return;c.s.strategyClaims[claim]=1;c.s.forcedRefresh={bond:p.bond,count:(c.s.forcedRefresh?.bond===p.bond?c.s.forcedRefresh.count||1:0)+1};}},
 band_coin_cost_gain_random_char_by_shop_level:{event:'spent',run:(c,p,k)=>{const earned=Math.floor(c.s.totalSpent/p.coin_cnt),claimed=c.s.strategyClaims[k]||0;for(let i=claimed;i<earned;i++)for(let n=0;n<p.count;n++)c.gain(c.draw({kind:'operator',maxTier:c.s.level}));c.s.strategyClaims[k]=earned;}},
 band_cost_coin_reach_cnt_gain_chess_from_pool:{event:'spent',run:(c,p,k)=>{if(c.s.totalSpent>=p.coin_cnt&&!c.s.strategyClaims[k]){randomGain(c,p);c.s.strategyClaims[k]=1;}}},
 round_start_gain_coin_by_bond_char_chess_buy:{event:'bought',run:(c,p,k,u)=>{if(c.ownBonds(u).includes(p.bond)){const key=k+':'+c.s.round,claimed=c.s.strategyClaims[key]||0;if(claimed<p.max_count){c.s.nextRoundBonus+=p.count;c.s.strategyClaims[key]=claimed+1;}}}},
 // 贾维【团伙行动】：主动刷新次数**跨回合累计**（用户 2026-09-19 确认口径）。每满 refresh_count 次
 // 发 1 名该盟约干员；「每回合至多 max_count 名」只约束发放节奏，被上限挡住的份数留到之后回合补发。
 // 因此进度键 `:total` 不带回合（跨回合累计已兑现的份数），本回合已发数才按回合记。
 refresh_shop_count_gain_coin_bond_char_chess:{event:'refreshed',run:(c,p,k)=>{
  const step=Number(p.refresh_count)||1,cap=Number(p.max_count)||Infinity,
   earned=Math.floor((c.s.refreshCountTotal||0)/step),
   claimedTotal=c.s.strategyClaims[k+':total']||0,
   grantedThisRound=c.s.strategyClaims[k+':'+c.s.round]||0,
   grant=Math.max(0,Math.min(earned-claimedTotal,cap-grantedThisRound));
  for(let i=0;i<grant;i++)c.gain(c.draw({kind:'operator',bond:p.bond,maxTier:c.s.level}));
  if(grant>0){c.s.strategyClaims[k+':total']=claimedTotal+grant;c.s.strategyClaims[k+':'+c.s.round]=grantedThisRound+grant;}
 }},
 first_buy_in_round_char_price_change:{event:'price',run:(c,p,k,u)=>c.ownBonds(u).includes(p.bond)&&!(c.s.roundBoughtBonds[p.bond]>0)?p.price:null},
 band_first_self_refresh_present_char:{event:'refreshRequirements',run:(c,p)=>c.s.roundRefreshCount<2?{bond:p.bond,minCount:p.count}:null},
 band_shop_refresh_copy_max_lv_char:{event:'refreshRequirements',run:()=>({duplicateCount:2,freezeOne:true})}
};
export const STRATEGY_SERVER_EFFECTS=Object.keys(effects);
export const STRATEGY_GAP_NOTES=Object.freeze({
 band_fang:'信标转交协议已接入，需联机宿主实际传输'
});
export function runStrategyEvent(c,event,unit=null){
 const band=c.data.season.bandDataListDict[c.s.bandId];if(!band)return [];
 const result=[];for(const [i,e]of c.data.season.effectBuffInfoDataDict[band.effectId].entries()){const handler=effects[e.key];if(handler?.event===event){const value=handler.run(c,params(e),c.s.bandId+':'+i,unit);if(value!==null&&value!==undefined)result.push(value);}}
 return result;
}
export function strategyCoverage(data){return Object.values(data.season.bandDataListDict).map(b=>{const keys=data.season.effectBuffInfoDataDict[b.effectId].map(e=>e.key),handled=['env_gbuff_new_with_verify','band_shop_refresh_copy_max_lv_char','first_sell_char_chess_exchange_char_chess_in_shop','round_start_all_player_change_enemy_2','auto_chess_change_map'],pendingKeys=keys.filter(k=>!STRATEGY_SERVER_EFFECTS.includes(k)&&!handled.includes(k)),gapNote=STRATEGY_GAP_NOTES[b.bandId]||null,status=pendingKeys.length||gapNote?'partial':'complete';return {id:b.bandId,serverHooks:keys.filter(k=>STRATEGY_SERVER_EFFECTS.includes(k)),pendingKeys,gapNote,status,statusLabel:status==='complete'?'效果已完整接入':'部分接入',mainBattleIntegrated:false};});}
