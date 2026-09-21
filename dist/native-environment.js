import {dealDamage,alliedActors} from './native-effects.js';
import {applyStatus,removeStatus} from './status.js';

export function dominionCell(battle,actor){
 if(!actor||battle.s.benchmark)return null;
 return battle.s.dominionCells?.[Math.round(actor.x)+','+Math.round(actor.y)]||null;
}

export function paintDominion(battle,enemy){
 if(!battle.s.enemies.includes(enemy)||enemy.id!=='enemy_2048_smgrd'||enemy.hp<=0||enemy.hidden||enemy.flying||battle.s.benchmark)return;
 const x=Math.round(enemy.x),y=Math.round(enemy.y),key=x+','+y;
 if(enemy.dominionLastTile===key)return;enemy.dominionLastTile=key;
 if(battle.map.grid[y]?.[x]?.heightType!=='LOWLAND')return;
 const bb=enemy.enemyTalent,cells=battle.data.ranges[bb['BlackFog.range_id']]?.grids;if(!cells)return;
 const field=battle.s.dominionCells??={};
 for(const cell of cells){
  const cx=x+cell.col,cy=y+cell.row,tile=battle.map.grid[cy]?.[cx];
  if(!tile||tile.buildableType==='NONE'||tile.obstacle)continue;
  const id=cx+','+cy;field[id]={x:cx,y:cy,attackSpeed:Math.min(field[id]?.attackSpeed??0,Number(bb['BlackFog.attack_speed'])||0)};
 }
}

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

export function shelteredFromSand(map,actor,direction){
 const x=Math.round(actor.x),y=Math.round(actor.y);
 return (map.devices||[]).some(d=>d.id==='trap_032_mound'&&!d.destroyed&&(
  direction==='DOWN'?d.x===x&&d.y<y:direction==='UP'?d.x===x&&d.y>y:
  direction==='RIGHT'?d.y===y&&d.x<x:direction==='LEFT'?d.y===y&&d.x>x:false));
}

export function tickSandStorm(battle){
 const cfg=battle.map.environment?.sandStorm,now=battle.s.time;
 const active=!!cfg&&!battle.s.benchmark&&now<cfg.duration;
 const exposed=a=>active&&a.hp>0&&!a.hidden&&!shelteredFromSand(battle.map,a,cfg.direction);
 for(const e of battle.s.enemies){e.sandExposed=exposed(e);e.sandMoveScale=e.sandExposed?cfg.moveScale:1;}
 for(const u of alliedActors(battle.s)){
  u.sandExposed=u.deployed&&exposed(u);u.sandAttackRatio=u.sandExposed?cfg.attackRatio:0;u.sandRespawnMultiplier=u.sandExposed?cfg.respawnMultiplier:1;
  if(!u.sandExposed){u.sandNextAt=null;continue;}
  u.sandNextAt??=now+cfg.interval;
  while(u.hp>0&&now+1e-9>=u.sandNextAt){u.sandNextAt+=cfg.interval;dealDamage(battle,{target:u,amount:cfg.damage,type:'true',cause:'dot'});}
 }
}
