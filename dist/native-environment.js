import {dealDamage,alliedActors} from './native-effects.js';
import {applyStatus,removeStatus} from './status.js';
import {DIRECTIONS,directionIndex,directionOf} from './protocol.js';

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
 // 掩体必须在**迎风侧**：气流朝下吹（DOWN=+y）时，只有上方的土石结构能挡住。
 const index=directionIndex(direction);if(index==null)return false;
 const [dx,dy]=directionOf(index),x=Math.round(actor.x),y=Math.round(actor.y);
 return (map.devices||[]).some(d=>d.id==='trap_032_mound'&&!d.destroyed&&(dx?d.y===y:d.x===x)&&((d.x-x)*dx+(d.y-y)*dy)<0);
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
  while(u.hp>0&&now+1e-9>=u.sandNextAt){u.sandNextAt+=cfg.interval;dealDamage(battle,{target:u,amount:cfg.damage,type:'true',cause:'dot',environmental:true});}
 }
}

// ── 特殊地块（PRTS《卫戍协议：盟约 下半/战场一览》，2026-09-22 核对）────────────────
// 地块类型一律按原地块的 tileKey 判定，客户端不另存坐标表：
//   tile_infection＝活性源石（#04）  tile_mire＝沼泽地段（#06）  tile_smog＝排气格栅（#07）
//   tile_deepsea＝深水区（#05/#08，逻辑在 tickDeepWater，深水不可部署在 build-protocol 里定性）
export const TERRAIN_TILES=Object.freeze({originium:'tile_infection',mire:'tile_mire',vent:'tile_smog',deepWater:'tile_deepsea'});
export function terrainAt(map,x,y){return map?.grid?.[Math.round(y)]?.[Math.round(x)]?.tileKey||null;}
// 站在某类地块上：飞行单位不踩地块，未部署的我方单位与倒下/隐藏的敌人都不算。
export function standsOn(battle,actor,key){
 if(!battle||!actor||battle.s.benchmark)return false;
 if(actor.deployed===false||actor.hidden||actor.hp<=0||actor.flying)return false;
 return terrainAt(battle.map,actor.x,actor.y)===key;
}
export function terrainActors(battle){return [...alliedActors(battle.s),...battle.s.enemies];}

// 活性源石（#04，tile_infection 黑板 damage/atk/attack_speed/duration）：
// 站在上面的**我方与敌方**单位每秒受 70 真实伤害，攻击力 +20%、攻击速度 +20。
// 窗口取原表 duration（300 秒＝PRTS 写的「5 分钟内」）从开战计时；本客户端单场战斗远短于它，
// 所以等价于「站在上面就有」。
export function tickActiveOriginium(battle){
 const cfg=battle.map.environment?.originium;
 if(!cfg||battle.s.benchmark)return;
 const now=battle.s.time,room=!cfg.duration||now<cfg.duration;
 for(const actor of terrainActors(battle)){
  const on=room&&standsOn(battle,actor,TERRAIN_TILES.originium);
  actor.originium=on;
  if(!on){actor.originiumNextAt=null;continue;}
  actor.originiumNextAt??=now+1;
  while(actor.hp>0&&now+1e-9>=actor.originiumNextAt){
   actor.originiumNextAt+=1;
   if(cfg.damage>0)dealDamage(battle,{target:actor,amount:cfg.damage,type:'true',cause:'dot',environmental:true});
  }
 }
}

// 沼泽地段（#06，trap_098_mire 黑板 attack_speed/move_speed/max_stack_cnt/value）：
// 位于沼泽地段上的单位每 3 秒叠一层沼泽：攻击速度 -5%、移动速度 -5%，至多 10 层；
// **离开地块立刻清空**（PRTS 原文），所以不叠层时就写回 0。
export function tickMire(battle){
 const cfg=battle.map.environment?.mire;
 if(!cfg)return;
 const now=battle.s.time,interval=Math.max(.1,Number(cfg.interval)||3),max=Math.max(1,Number(cfg.maxStack)||10);
 for(const actor of terrainActors(battle)){
  if(!standsOn(battle,actor,TERRAIN_TILES.mire)){actor.mireStacks=0;actor.mireNextAt=null;continue;}
  actor.mireNextAt??=now+interval;
  while(now+1e-9>=actor.mireNextAt){
   actor.mireNextAt+=interval;
   if((actor.mireStacks||0)<max)actor.mireStacks=(actor.mireStacks||0)+1;
  }
 }
}

// 排气格栅（#07，tile_smog）：置于其中的**干员**不会成为敌军**远程**攻击的目标（召唤物不算干员；
// 被阻挡时的近战照旧打得到）。
export function onVentTile(battle,actor){
 // 召唤物不享受格栅保护：原表写的是「置于其中的干员」。
 if(actor?.kind==='summon')return false;
 return standsOn(battle,actor,TERRAIN_TILES.vent);
}
export function tickVent(battle){
 for(const u of alliedActors(battle.s))u.vented=!!onVentTile(battle,u);
}

// 源石流发生装置（#05，trap_013_blower 黑板 blower_s_*）：装置正前方 3 格是气流区（长度取自装置攻击范围）。
// 与气流同向/逆向部署的我方干员攻击 ±30%（垂直 0）；同向/逆向移动的敌人移速 ±50%（垂直 0）。
// 装置位置用 `map.windSources`：**不按裁切过滤**——装置常在裁切框外一格，气流却吹进战场。
const blowerCellCache=new WeakMap();
export function blowerCells(map){
 if(blowerCellCache.has(map))return blowerCellCache.get(map);
 const cfg=map?.environment?.blower,cells=new Map();
 for(const device of map?.windSources||[]){
  const index=directionIndex(device.direction);if(index==null)continue;
  const [dx,dy]=DIRECTIONS[index],length=Math.max(1,Number(cfg?.length)||3);
  for(let step=1;step<=length;step++){
   const x=device.x+dx*step,y=device.y+dy*step;
   if(!map.grid?.[y]?.[x])break;
   cells.set(x+','+y,{x,y,dx,dy,index});
  }
 }
 blowerCellCache.set(map,cells);
 return cells;
}
// 气流与一个方向向量的关系：1＝同向、-1＝逆向、0＝垂直（点积判定，和原表的 equal/vertical/opposite 对应）。
export function windRelation(dx,dy,wx,wy){const dot=dx*wx+dy*wy;return dot>1e-6?1:dot<-1e-6?-1:0;}
export function tickBlower(battle){
 const cfg=battle.map.environment?.blower,cells=cfg&&!battle.s.benchmark?blowerCells(battle.map):new Map();
 const atkOf=relation=>relation==null?0:relation>0?Number(cfg?.equal)||0:relation<0?Number(cfg?.opposite)||0:Number(cfg?.vertical)||0;
 const moveOf=relation=>1+(relation==null?0:relation>0?Number(cfg?.equalMove)||0:relation<0?Number(cfg?.oppositeMove)||0:0);
 for(const u of alliedActors(battle.s)){
  // 原表写的是「与气流同向/逆向**部署的干员**」：召唤物不吃这条攻击力修正。
  const cell=u.kind!=='summon'&&u.deployed!==false&&!u.hidden&&u.hp>0?cells.get(Math.round(u.x)+','+Math.round(u.y)):null;
  const [fx,fy]=directionOf(u.dir??0),relation=cell?windRelation(fx,fy,cell.dx,cell.dy):null;
  u.windMove=relation??0;u.windAtkRatio=atkOf(relation);
 }
 for(const e of battle.s.enemies){
  const cell=e.hp>0&&!e.hidden?cells.get(Math.round(e.x)+','+Math.round(e.y)):null,move=e.moveDirection;
  const relation=cell&&move?windRelation(move.x,move.y,cell.dx,cell.dy):null;
  e.windMove=relation??0;e.windMoveScale=moveOf(relation);
 }
}

// 把地块效果合成到统一字段上：数值消费者只读 env*（stats／enemyAttackTiming／移动三处），
// 每帧合成一次、与各项 tick 的先后无关。ratio 走 base×(1+ratio)，scale 走乘法。
export function syncEnvModifiers(battle){
 const cfg=battle.map.environment||{};
 for(const actor of terrainActors(battle)){
  const originium=actor.originium&&cfg.originium?cfg.originium:null,mireStacks=Math.max(0,actor.mireStacks||0);
  actor.envAtkRatio=(originium?Number(originium.atk)||0:0)+(actor.windAtkRatio||0);
  actor.envAttackSpeed=originium?Number(originium.attackSpeed)||0:0;
  actor.envAttackSpeedScale=1+mireStacks*(Number(cfg.mire?.attackSpeed)||0);
  actor.envMoveScale=(1+mireStacks*(Number(cfg.mire?.moveSpeed)||0))*(actor.windMoveScale??1);
 }
}
// 一次跑完所有地块效果（深水与沙尘暴各自另有更早的历史入口，仍在 step 里单独调用）。
export function tickTerrainEffects(battle){
 tickActiveOriginium(battle);tickMire(battle);tickBlower(battle);tickVent(battle);syncEnvModifiers(battle);
}

// 只接受真正存在且点燃的供暖器实体；图上名字/寒冷状态不能产生供暖。
export function litBraziers(battle){return (battle.s.summons||[]).filter(d=>d.id==='trap_137_winfire'&&d.deployed&&d.hp>0&&d.heaterState==='lit');}
export function heatedByBrazier(battle,actor){
 if(!actor)return false;const x=Math.round(actor.x),y=Math.round(actor.y);
 return litBraziers(battle).some(d=>Math.abs(x-d.x)<=1&&Math.abs(y-d.y)<=1&&(x!==d.x||y!==d.y));
}
export function atBrazierWindDoor(battle,actor){
 if(!actor?.deployed)return false;
 return litBraziers(battle).some(d=>Math.round(actor.x)===d.x+1&&Math.round(actor.y)===d.y&&battle.map.grid[d.y]?.[d.x+1]&&battle.map.grid[d.y][d.x+1].buildableType!=='NONE');
}
