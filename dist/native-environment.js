import {dealDamage} from './native-effects.js';
import {applyStatus,removeStatus} from './status.js';

// 仅处理原始地图显式配置的“深水”控制器；它不同于有时间轴的涨/退潮。
export function tickDeepWater(battle){
 const cfg=battle.map.environment?.deepWater,now=battle.s.time;
 for(const e of battle.s.enemies){
  const tile=battle.map.grid[Math.round(e.y)]?.[Math.round(e.x)];
  const wet=!!cfg&&!battle.s.benchmark&&e.hp>0&&!e.hidden&&!e.flying&&tile?.tileKey==='tile_deepsea';
  const diver=e.id==='enemy_1158_divman';
  e.waterlogged=wet;e.waterMoveScale=wet&&!diver?cfg.moveScale:1;e.waterAttackSpeedScale=wet&&!diver?cfg.attackSpeedScale:1;
  e.waterAttackMultiplier=wet&&diver?1+Number(e.enemyTalent['Swim.atk']):1;
  if(diver){
   if(e.block!=null)e.diverRevealUntil=now+3;
   if(wet&&e.block==null&&now>=(e.diverRevealUntil||0))applyStatus(e,'invisible',.2,{source:'deep-water',resistible:false});
   else removeStatus(e,'invisible','deep-water');
  }
  if(!wet||diver){e.waterNextAt=null;continue;}
  e.waterNextAt??=now+1;
  while(e.hp>0&&now+1e-9>=e.waterNextAt){
   e.waterNextAt+=1;
   if(cfg.damage>0)dealDamage(battle,{target:e,amount:cfg.damage,type:'true',cause:'dot'});
   const extra=Number(e.enemyTalent?.['Drown.damage']);
   if(extra>0&&e.hp>0)dealDamage(battle,{target:e,amount:extra,type:'true',cause:'dot'});
  }
 }
}
