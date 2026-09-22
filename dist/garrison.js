// Source-defined preparation effects. Pool draws are supplied by the mode controller;
// an unknown pool is rejected rather than replaced with a fabricated distribution.
const split=v=>String(v??'').split(',').filter(Boolean);
const front=(u,n=1)=>{if(!u.position)return null;const [x,y]=[[1,0],[0,1],[-1,0],[0,-1]][u.dir];return{x:u.position.x+x*n,y:u.position.y+y*n};};
const at=(c,p)=>p?c.s.units.find(u=>u.position?.x===p.x&&u.position?.y===p.y):null;
const board=c=>c.s.units.filter(u=>u.position!=null);
const active=c=>Object.keys(c.bonds()).filter(id=>c.bonds()[id].active);
const add=(c,ids,count,check=true)=>{for(const id of ids)c.addLayers(id,Number(count),check);};
const own=(c,u)=>u.bondIds||c.data.season.charChessDataDict[u.chessId].bondIds;
const mostLayers=c=>{const ids=active(c);if(!ids.length)return null;const max=Math.max(...ids.map(id=>c.s.bondLayers[id]||0));return c.pick(ids.filter(id=>(c.s.bondLayers[id]||0)===max));};
const draw=(c,request,count=1)=>{for(let i=0;i<count;i++){const id=c.draw(request);request.kind==='item'?c.gainItem(id):c.gain(id);}};
const handlers={
 SERVER_CHESS_PRICE:(c,u,p)=>p.price,
 SERVER_ONCE_GOLD:(c,u,p)=>{c.s.nextRoundBonus+=p.count;},
 SERVER_GAIN_FREE_REFRESH_COUNT:(c,u,p)=>{c.s.freeRefresh+=p.count;},
 SERVER_ADD_BOND_CHESS_ALL:(c,u,p,event)=>add(c,own(c,u),p.count,event!=='SERVER_GAIN'),
 SERVER_ADD_BOND:(c,u,p,event)=>add(c,split(p.bond),p.count,event!=='SERVER_GAIN'),
 SERVER_ADD_MULTIPLE_BOND:(c,u,p,event)=>{const counts=split(p.count).map(Number);split(p.bond).forEach((id,i)=>c.addLayers(id,counts[i],event!=='SERVER_GAIN'));},
 SERVER_ADD_BOND_METHOD:(c,u,p,event)=>{
  for(const id of split(p.bond)){
   const values={shoplv:()=>c.s.level,round_gain_char:()=>c.s.roundGainCount,same_bond_diff_lv:()=>new Set(board(c).filter(v=>own(c,v).includes(id)).map(v=>v.rank)).size,hand_count:()=>c.s.units.filter(v=>v.position===null).length,same_row:()=>u.position?board(c).filter(v=>v.position.y===u.position.y).length:0};
   if(!values[p.add_method])throw Error('Unsupported garrison count method '+p.add_method);c.addLayers(id,values[p.add_method]()*p.multi,event!=='SERVER_GAIN');
  }
 },
 SERVER_ADD_BOND_ACTIVATED_MOST_LAYER:(c,u,p)=>{const id=mostLayers(c);if(id)c.addLayers(id,p.count);},
 SERVER_ADD_BOND_ACTIVATED_RANDOM:(c,u,p)=>{for(let i=0;i<p.rand_count;i++){const ids=active(c);if(ids.length)c.addLayers(c.pick(ids),p.count);}},
 SERVER_ADD_BOND_POSITION:(c,u,p)=>{for(const v of [u,at(c,front(u,p.dir==='behind'?-1:1))].filter(Boolean))add(c,own(c,v),p.count);},
 SERVER_ADD_BOND_IN_HAND:(c,u,p)=>{for(const v of c.s.units.filter(v=>v.position===null))add(c,own(c,v),p.count);},
 SERVER_ADD_BOND_FRONT_ALL_LAYER:(c,u,p)=>{if(!u.position)return;for(const v of board(c)){const dx=v.position.x-u.position.x,dy=v.position.y-u.position.y;if((u.dir===0&&dy===0&&dx>0)||(u.dir===1&&dx===0&&dy>0)||(u.dir===2&&dy===0&&dx<0)||(u.dir===3&&dx===0&&dy<0))add(c,own(c,v),p.count);}},
 SERVER_ADD_ACT_BOND_DIFF_LV_MOST_LAYER:(c,u,p)=>{const id=mostLayers(c);if(id)c.addLayers(id,new Set(board(c).filter(v=>own(c,v).includes(id)).map(v=>v.rank)).size*p.multi);},
 SERVER_ADD_BOND_ROUND_COIN_COST:(c,u,p)=>add(c,split(p.bond),Math.floor(c.s.roundSpent/p.count)*p.layer),
 // 「本回合每刷新过1次，使已激活的【叙拉古】【奥术】层数+2（至多6层）」：max_layer 是**本回合累计上限**，
 // 不是单次上限。触发点每回合一次，但链式触发（白面鸮那类「本干员的特质与身前一格相同」）可能重复触发，
 // 所以用 refreshLayerClaimed 记账，超出上限的一律不发；账本在 nextRound 里清零。
 SERVER_ADD_REFRESH_CNT_MULTIPLIER_BOND_LAYER:(c,u,p,event)=>{
  const want=Math.min(Number(p.max_layer)||0,Math.max(0,(c.s.roundRefreshCount||0)*Number(p.multiplier||0)));
  c.s.refreshLayerClaimed??={};
  for(const id of split(p.bond)){
   const key=id+':'+u.uid,claimed=c.s.refreshLayerClaimed[key]||0,grant=Math.max(0,want-claimed);
   if(!grant)continue;
   if(event!=='SERVER_GAIN'&&!c.bonds()[id]?.active)continue;
   c.addLayers(id,grant,event!=='SERVER_GAIN');c.s.refreshLayerClaimed[key]=claimed+grant;
  }
 },
 SERVER_GAIN_BOND_LAYER_BY_REFRESH_CNT:(c,u,p)=>{if(c.s.roundRefreshCount===p.refresh_cnt)add(c,split(p.bond),p.layer);},
 SERVER_ONCE_GOLD_WITH_BOND_CONDITION:(c,u,p)=>{if(u.position||split(p.bond).some(id=>c.bonds()[id]?.active))c.s.nextRoundBonus+=p.count;},
 SERVER_GAIN_EQUIP:(c,u,p)=>{for(let i=0;i<p.count;i++)c.gainItem(p.chess);},
 SERVER_GAIN_CHAR:(c,u,p)=>{for(let i=0;i<p.count;i++)c.gain(p.chess);},
 SERVER_POOL_CHAR:(c,u,p)=>draw(c,{kind:'operator',pool:p.pool},p.count),
 SERVER_POOL_EQUIP:(c,u,p)=>draw(c,{kind:'item',pool:p.pool},p.count),
 SERVER_GAIN_RANDOM_EQUIP_CHESS_IN_POOL:(c,u,p)=>{if(split(p.round_list).map(Number).includes(c.s.round))draw(c,{kind:'item',pool:p.pool},p.count);},
 SERVER_MOST_BOND:(c,u)=>{const rows=Object.entries(c.bonds()),max=Math.max(...rows.map(([,b])=>b.count));const bonds=rows.filter(([,b])=>b.count===max&&max>0).map(([id])=>id);if(bonds.length)draw(c,{kind:'operator',bond:c.pick(bonds)},1);},
 SERVER_TRIGGER_ANOTHER:(c,u,p)=>{let target;if(p.scope==='front')target=at(c,front(u));else if(p.scope==='farright')target=board(c).filter(v=>c.hasGarrison(v,p.event)).sort((a,b)=>a.position.y-b.position.y||b.position.x-a.position.x)[0];else throw Error('Unsupported garrison scope '+p.scope);if(target)c.triggerGarrisons(p.event,target);},
 SERVER_TRIGGER_FRONT_COUNT:(c,u,p)=>{for(let i=1;i<=p.count;i++){const target=at(c,front(u,i));if(target)c.triggerGarrisons(p.event,target);}},
 SERVER_FRONT_SAME_EFFECT_PREP_START:(c,u)=>{const target=at(c,front(u));if(target)c.triggerGarrisons('SERVER_PREP_START',target,{effectOwner:u});},
 SERVER_FRONT_SAME_EFFECT_PREP_FIN:(c,u)=>{const target=at(c,front(u));if(target)c.triggerGarrisons('SERVER_PREP_FIN',target,{effectOwner:u});},
 SERVER_SELL_CHESS_GAIN_SPECIAL_GOODS:(c,u,p)=>c.rewardFromPool(p['pool'+c.s.level]||p.max_pool,3,1)
};
export const SERVER_GARRISON_TYPES=Object.keys(handlers);
export function runGarrison(c,unit,rule,event){
 const p=Object.fromEntries((rule.blackboard||[]).map(e=>[e.key,e.valueStr??e.value]));
 if(p.conditionkey==='character_target_inboard'&&!unit.position)return;
 if(p.conditionkey==='character_same_row'&&(!unit.position||board(c).filter(v=>v.position.y===unit.position.y).length<p.check_count))return;
 if(p.conditionkey&&!['character_target_inboard','character_same_row'].includes(p.conditionkey))throw Error('Unsupported garrison condition '+p.conditionkey);
 const fn=handlers[rule.effectType];if(!fn)throw Error('Unsupported garrison effect '+rule.effectType);return fn(c,unit,p,event);
}
