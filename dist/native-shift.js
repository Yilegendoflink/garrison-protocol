import {advanceEnemy} from './native-combat.js';

// PRTS推与拉、失衡位移机制：质量1，g=9.81，默认动摩擦系数0.5。
const SPEEDS=[0,1,2,4,4.5,5.3,5.8];
export function startEnemyPush(battle,target,source,{forceLevel,directional=false,fixedDirection=false,projectile=false}={}){
 if(!battle.s.enemies.includes(target)||target.hp<=0||target.hidden||target.shiftImmune||target.levitated||!Number.isFinite(forceLevel))return false;
 let dx=target.x-source.x,dy=target.y-source.y,length=Math.hypot(dx,dy),level=forceLevel-(target.weight||0);
 const forward=[[1,0],[0,-1],[-1,0],[0,1]][source.dir??0];
 if(directional){if(!fixedDirection&&(length<.25||(dx*forward[0]+dy*forward[1])/length<Math.SQRT1_2))level-=2;else{dx=forward[0];dy=forward[1];length=1;}}
 if(length<1e-9){dx=forward[0];dy=forward[1];length=1;}
 const speed=SPEEDS[Math.max(0,Math.min(6,Math.floor(level)+3))];if(!(speed>0))return false;
 const previous=target.shift;
 target.shift={vx:(previous?.vx||0)+dx/length*speed,vy:(previous?.vy||0)+dy/length*speed,hardUntil:previous?.hardUntil??battle.s.time+.1,startedAt:previous?.startedAt??battle.s.time,sourceUid:source.uid??null,projectile:!previous&&projectile,fresh:!previous,nextDamageAt:previous?.nextDamageAt??battle.s.time+Number(target.enemyTalent?.['unbalanced_bleed.interval']||1)};
 target.block=null;target.action=null;battle.onActorShiftStart?.(target);battle.emit('shift-start',{uid:target.uid,x:target.x,y:target.y,forceLevel});return true;
}

function solidAt(battle,target,x,y){
 if(x<-.5||y<-.5||x>battle.map.cols-.5||y>battle.map.rows-.5)return {heightType:'BOUNDARY'};
 const radius=target.hitRadius??.25;
 for(let cy=Math.floor(y+.5-radius);cy<=Math.floor(y+.5+radius);cy++)for(let cx=Math.floor(x+.5-radius);cx<=Math.floor(x+.5+radius);cx++){
  const tile=battle.map.grid[cy]?.[cx];
  if(tile&&tile.tileKey==='tile_hole')continue;
  if(tile&&tile.passableMask!=='NONE'&&(target.flying||tile.passableMask!=='FLY_ONLY')&&!tile.obstacle)continue;
  const closestX=Math.max(cx-.5,Math.min(cx+.5,x)),closestY=Math.max(cy-.5,Math.min(cy+.5,y));
  if((closestX-x)**2+(closestY-y)**2<radius*radius-1e-9)return tile||{heightType:'BOUNDARY'};
 }
 return null;
}

function rejoin(battle,target){
 let end=target.cmd;
 if(target.route?.[end]?.kind!=='move'){target.shiftRejoin=false;return true;}
 while(end+1<target.route.length&&target.route[end].checkpointIndex==null&&target.route[end+1].kind==='move')end++;
 const goal=target.route[end],o=battle.map.origin,toMap=(x,y)=>({col:o.col+x,row:o.row-y});let path;
 try{path=battle.path({startPosition:toMap(Math.round(target.x),Math.round(target.y)),endPosition:toMap(goal.x,goal.y),checkpoints:[],allowDiagonalMove:target.routeDiagonal},target.flying&&!target.groundNavigation).slice(1);}
 catch(error){if(!String(error.message).startsWith('原始路线不可达：'))throw error;return false;}
 if(path.length)Object.assign(path.at(-1),goal);else path=[{...goal}];
 target.route=[...target.route.slice(0,target.cmd),...path,...target.route.slice(end+1)];target.shiftRejoin=false;return true;
}

function finish(battle,target){
 target.shift=null;target.shiftRejoin=true;rejoin(battle,target);battle.onActorShiftEnd?.(target);battle.emit('shift-end',{uid:target.uid,x:target.x,y:target.y});
}

// null：没有失衡，由常规路线处理；false：本帧由物理运动处理。
export function advanceEnemyShift(battle,target,dt){
 const state=target.shift;
 if(!state)return target.shiftRejoin&&!rejoin(battle,target)?false:null;
 if(target.hp<=0){target.shift=null;return false;}
 if(target.hidden||target.shiftImmune||target.levitated){finish(battle,target);return false;}
 battle.onActorShiftTick?.(target,state);if(target.hp<=0){target.shift=null;return false;}
 let speed=Math.hypot(state.vx,state.vy);
 if(!(state.fresh&&state.projectile)){
  const next=Math.max(0,speed-4.905*dt)/(1+Math.max(0,target.shiftDrag||0)*dt),scale=speed>0?next/speed:0;state.vx*=scale;state.vy*=scale;speed=next;
 }
 state.fresh=false;
 if(speed<=.1&&battle.s.time+1e-9>=state.hardUntil){finish(battle,target);return false;}
 const steps=Math.max(1,Math.min(128,Math.ceil(speed*dt/.1)));
 for(let i=0;i<steps&&target.hp>0;i++)for(const axis of ['x','y']){
  const delta=state[axis==='x'?'vx':'vy']*dt/steps;if(!delta)continue;
  const from=target[axis],to=from+delta,x=axis==='x'?to:target.x,y=axis==='y'?to:target.y,wall=solidAt(battle,target,x,y);
  if(wall){let lo=0,hi=1;for(let n=0;n<14;n++){const mid=(lo+hi)/2,p=from+delta*mid;if(solidAt(battle,target,axis==='x'?p:target.x,axis==='y'?p:target.y))hi=mid;else lo=mid;}target[axis]=from+delta*lo;state[axis==='x'?'vx':'vy']=0;battle.onActorShiftCollision?.(target,wall);}
  else target[axis]=to;
  if(!target.flying&&battle.map.grid[Math.round(target.y)]?.[Math.round(target.x)]?.tileKey==='tile_hole'){target.shift=null;battle.onActorShiftFall?.(target);return false;}
 }
 battle.onActorMoved?.(target);
 advanceEnemy(target,dt,kind=>battle.emit(kind,{uid:target.uid,x:target.x,y:target.y}),true);
 if(Math.hypot(state.vx,state.vy)<=.1&&battle.s.time+1e-9>=state.hardUntil)finish(battle,target);
 return false;
}
