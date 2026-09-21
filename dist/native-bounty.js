import {DEFAULT_WAVE_TABLE} from './native-wave-defaults.js';
import {waveRng} from './native-wave-random.js';
import {blackboard} from './protocol.js';

export const BOUNTY_SLUG='enemy_1007_slime';
// 项目悬赏难度按内置编制成本分档，玩家改本地成本不会改变奖金。
export function bountyOption(data,id){
 const raw=data.enemies?.[id],cost=DEFAULT_WAVE_TABLE.costs[id];
 if(raw&&raw.enemyBehavior?.randomPoolEligible===true&&(Number.isFinite(cost)||id===BOUNTY_SLUG)){
  const coin=id===BOUNTY_SLUG?0:cost<=3?1:cost<=6?2:cost<=10?3:4;
  return {id,enemyId:id,name:raw.name,coin,count:1,difficulty:coin,cost:cost||0};
 }
 // 兼容旧存档中的道具悬赏效果 ID。
 const effect=data.season.effectBuffInfoDataDict[id]?.find(e=>['add_enemy_selfbattle_win_gain_coin','next_battle_add_enemy_win_gain_coin'].includes(e.key));
 if(!effect)return null;
 const p=blackboard(effect.blackboard),enemyId=String(p.enemy_id||'');if(!data.enemies?.[enemyId])return null;
 const coin=enemyId===BOUNTY_SLUG?0:Number(p.coin)||1;
 return {id,enemyId,name:data.enemies[enemyId].name,coin,count:Number(p.count)||1,difficulty:coin};
}

export function bountyOffers(data,seed){
 const pool=[...new Set([...Object.keys(DEFAULT_WAVE_TABLE.costs),BOUNTY_SLUG])].map(id=>bountyOption(data,id)).filter(Boolean);
 const rng=waveRng((seed^0x7b0a17)>>>0),pick=items=>items[Math.floor(rng()*items.length)];
 const bins=Array.from({length:5},(_,coin)=>pool.filter(o=>o.coin===coin));
 if(bins.some(bin=>!bin.length))return [];
 const extra=[0,2,3],tiers=[1,4];
 while(tiers.length<4)tiers.push(extra.splice(Math.floor(rng()*extra.length),1)[0]);
 const offers=tiers.map(tier=>pick(bins[tier]).id);
 for(let i=offers.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[offers[i],offers[j]]=[offers[j],offers[i]];}
 return offers;
}
