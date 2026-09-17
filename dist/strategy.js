const params=e=>Object.fromEntries(e.blackboard.map(b=>[b.key,b.valueStr??b.value]));
const list=v=>String(v??'').split(',').filter(Boolean);
const fixedGain=(c,p)=>{for(let i=0;i<(p.count||1);i++)p.type==='char'?c.gain(p.chess):c.gainItem(p.chess);};
const randomGain=(c,p)=>{for(let i=0;i<(p.count||1);i++){const kind=p.type==='char'?'operator':'item',id=c.draw({kind,pool:p.pool});kind==='operator'?c.gain(id):c.gainItem(id);}};
const effects={
 preparation_start_gain_chess_from_round:{event:'prep',run:(c,p)=>{if(c.s.round===p.round)fixedGain(c,p);}},
 preparation_start_gain_chess_every_n_round:{event:'prep',run:(c,p)=>{if(c.s.round%p.round===0)fixedGain(c,p);}},
 give_coin_in_round:{event:'prep',run:(c,p)=>{if(c.s.round===p.round)c.s.funds+=p.coin-(c.s.round+3);}},
 prep_start_gain_chess_from_pool_in_round:{event:'prep',run:(c,p)=>{if(c.s.round===p.round)randomGain(c,p);}},
 gain_bond_char_per_round:{event:'prep',run:(c,p)=>{if(c.s.round>=p.round&&(c.s.round-p.round)%p.preround===0)for(let i=0;i<p.count;i++)c.gain(c.draw({kind:'operator',bond:p.bond,maxTier:c.s.level}));}},
 round_start_bond_check_gain_layer:{event:'prep',run:(c,p)=>{if(c.s.round!==p.round)return;const ids=Object.keys(c.bonds()).filter(id=>c.bonds()[id].active);for(const id of ids)c.addLayers(id,ids.length===p.factioncount?p.count1:p.count2);}},
 round_start_activate_char_chess_effect_in_board:{event:'prep',run:(c,p)=>{const units=c.s.units.filter(u=>u.position&&c.hasGarrison(u,p.event_type)).sort((a,b)=>b.position.x-a.position.x||b.position.y-a.position.y);for(const u of units.slice(0,p.count))c.triggerGarrisons(p.event_type,u);}},
 round_start_gain_char_chess_in_shop_every_n_round:{event:'prep',run:(c,p)=>{if(c.s.round%p.round===0)for(let i=0;i<p.count;i++){const indices=c.s.offers.map((id,i)=>c.data.season.charShopChessDatas[id]?.charId?i:null).filter(i=>i!==null);if(indices.length){const index=c.pick(indices),id=c.s.offers[index];c.s.offers[index]=null;c.gain(id);}}}},
 preparation_start_add_special_goods_every_n_round:{event:'prep',run:(c,p)=>{if(c.s.round%p.round===0)c.rewardFromPool(p.pool,p.refresh_cnt,p.choice_cnt,'item');}},
 prep_finish_char_bond_add_layer:{event:'prepEnd',run:(c,p)=>{const units=c.s.units.filter(u=>u.position);for(const rank of new Set(units.map(u=>u.rank))){const u=c.pick(units.filter(u=>u.rank===rank));for(const id of c.ownBonds(u))c.addLayers(id,p.layer,false);}}},
 coin_carry_over:{event:'prepEnd',run:(c,p)=>{c.s.carryFunds=c.s.funds+Math.min(p.max,Math.floor(c.s.funds/p.capital))*p.interest;}},
 up_shop_add_special_goods:{event:'upgrade',run:(c,p)=>c.rewardFromPool(p.pool,p.count,p.choice,'item')},
 up_shop_next_refresh_must_present_bond_char:{event:'upgrade',run:(c,p,k)=>{const level=Number(c.s.level);if(!list(p.lvlist).map(Number).includes(level))return;const claim=k+':level:'+level;if(c.s.strategyClaims[claim])return;c.s.strategyClaims[claim]=1;c.s.forcedRefresh={bond:p.bond,price:p.price};}},
 band_coin_cost_gain_random_char_by_shop_level:{event:'spent',run:(c,p,k)=>{const earned=Math.floor(c.s.totalSpent/p.coin_cnt),claimed=c.s.strategyClaims[k]||0;for(let i=claimed;i<earned;i++)for(let n=0;n<p.count;n++)c.gain(c.draw({kind:'operator',maxTier:c.s.level}));c.s.strategyClaims[k]=earned;}},
 band_cost_coin_reach_cnt_gain_chess_from_pool:{event:'spent',run:(c,p,k)=>{if(c.s.totalSpent>=p.coin_cnt&&!c.s.strategyClaims[k]){randomGain(c,p);c.s.strategyClaims[k]=1;}}},
 round_start_gain_coin_by_bond_char_chess_buy:{event:'bought',run:(c,p,k,u)=>{if(c.ownBonds(u).includes(p.bond)){const key=k+':'+c.s.round,claimed=c.s.strategyClaims[key]||0;if(claimed<p.max_count){c.s.nextRoundBonus+=p.count;c.s.strategyClaims[key]=claimed+1;}}}},
 refresh_shop_count_gain_coin_bond_char_chess:{event:'refreshed',run:(c,p,k)=>{const key=k+':'+c.s.round,earned=Math.min(p.max_count,Math.floor(c.s.roundRefreshCount/p.refresh_count)),claimed=c.s.strategyClaims[key]||0;for(let i=claimed;i<earned;i++)c.gain(c.draw({kind:'operator',bond:p.bond,maxTier:c.s.level}));c.s.strategyClaims[key]=earned;}},
 first_buy_in_round_char_price_change:{event:'price',run:(c,p,k,u)=>c.ownBonds(u).includes(p.bond)&&!(c.s.roundBoughtBonds[p.bond]>0)?p.price:null},
 band_first_self_refresh_present_char:{event:'refreshRequirements',run:(c,p)=>c.s.roundRefreshCount<2?{bond:p.bond,minCount:p.count}:null},
 band_shop_refresh_copy_max_lv_char:{event:'refreshRequirements',run:()=>({duplicateCount:2,freezeOne:true})}
};
export const STRATEGY_SERVER_EFFECTS=Object.keys(effects);
export const STRATEGY_GAP_NOTES=Object.freeze({
 band_amiya:'激活盟约后的攻血增益未接入',band_orchid:'同名复制/冻结槽与寻呼模块效果未完整接入',band_ermengard:'前3次击倒复活未接入',band_clementia:'阿戈尔击倒加层未接入',band_emperor:'部署后再部署时间减半未接入',band_mberry:'攻击概率护盾未接入',band_humus:'技能结束周围回技力未接入',band_quintus:'突变细胞特殊装备未接入',band_doberm:'教鞭特殊法术未接入',band_malkie:'商业包装出售计数未接入',band_qalaisa:'击倒后的攻击叠层未接入',band_chen:'弱点伤害转换未接入',band_damaztic:'变形同构体装备效果未接入',band_dusk:'同名增攻与画卷复制未接入',band_ducklord:'特殊敌人替换与击倒奖励未接入',band_vodfox:'首次出售交换未接入',band_ioleta:'精锐数量对应的攻血增益未接入',band_jesica:'寻呼模块特殊装备效果未接入',band_mlyss:'博士投影的精英升级语义未完成',band_fang:'信标销毁、刷新、传递未接入',band_narant:'萨尔贡装备效果共享替换未接入',band_amedic:'医疗预备干员/Touch替换未接入'
});
export function runStrategyEvent(c,event,unit=null){
 const band=c.data.season.bandDataListDict[c.s.bandId];if(!band)return [];
 const result=[];for(const [i,e]of c.data.season.effectBuffInfoDataDict[band.effectId].entries()){const handler=effects[e.key];if(handler?.event===event){const value=handler.run(c,params(e),c.s.bandId+':'+i,unit);if(value!==null&&value!==undefined)result.push(value);}}
 return result;
}
export function strategyCoverage(data){return Object.values(data.season.bandDataListDict).map(b=>{const keys=data.season.effectBuffInfoDataDict[b.effectId].map(e=>e.key),partial=['band_shop_refresh_copy_max_lv_char'],pendingKeys=keys.filter(k=>!STRATEGY_SERVER_EFFECTS.includes(k)||partial.includes(k)),gapNote=STRATEGY_GAP_NOTES[b.bandId]||null,status=pendingKeys.length||gapNote?'partial':'complete';return {id:b.bandId,serverHooks:keys.filter(k=>STRATEGY_SERVER_EFFECTS.includes(k)),pendingKeys,gapNote,status,statusLabel:status==='complete'?'效果已完整接入':'部分接入',mainBattleIntegrated:false};});}
