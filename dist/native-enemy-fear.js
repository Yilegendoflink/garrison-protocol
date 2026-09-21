import {getActor} from './native-effects.js';
import {enemyMovementSpeed,permissions} from './status.js';
import {advanceEnemy,remainingDistance} from './native-combat.js';

const key=p=>p.x+','+p.y;
const cell=e=>({x:Math.round(e.x),y:Math.round(e.y)});
const flies=e=>e.flying&&!e.groundNavigation;
const FEAR=new Set(['fear','selfFear']);
function passable(b,e,p){
 const t=b.map.grid[p.y]?.[p.x];
 return !!t&&t.passableMask!=='NONE'&&(e.flying||t.passableMask!=='FLY_ONLY')&&t.tileKey!=='tile_hole';
}
function reach(b,e,from){
 const queue=[from],seen=new Map([[key(from),{p:from,parent:null,distance:0}]]),closed=new Set();
 const dirs=e.routeDiagonal?[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]:[[1,0],[-1,0],[0,1],[0,-1]];
 while(queue.length){
  queue.sort((a,c)=>seen.get(key(a)).distance-seen.get(key(c)).distance);
  const p=queue.shift(),row=seen.get(key(p));if(closed.has(key(p)))continue;closed.add(key(p));
  for(const [dx,dy]of dirs){
   const next={x:p.x+dx,y:p.y+dy},k=key(next);
   if(closed.has(k)||!passable(b,e,next)||(dx&&dy&&(!passable(b,e,{x:p.x+dx,y:p.y})||!passable(b,e,{x:p.x,y:p.y+dy}))))continue;
   const distance=row.distance+Math.hypot(dx,dy);if(distance>=(seen.get(k)?.distance??Infinity))continue;
   seen.set(k,{p:next,parent:key(p),distance});queue.push(next);
  }
 }
 return seen;
}
function pathTo(tree,goal){
 const path=[];let row=tree.get(key(goal));
 while(row?.parent!=null){path.unshift({...row.p});row=tree.get(row.parent);}
 return path;
}
function rebuild(b,e,status,signature){
 const origin={x:e.x,y:e.y},source=getActor(b.s,status.source),goal=[...(e.route||[])].reverse().find(p=>p.kind==='move');
 const state={signature,candidates:[],path:[],index:0};
 if(source&&source!==e&&Math.hypot(origin.x-source.x,origin.y-source.y)>1e-9&&goal){
  const reachable=e.flying?b.map.grid.flatMap((row,y)=>row.map((_,x)=>({p:{x,y}}))):[...reach(b,e,cell(goal)).values()],dx=origin.x-source.x,dy=origin.y-source.y,len=Math.hypot(dx,dy);
  for(const {p}of reachable){
   const x=p.x-origin.x,y=p.y-origin.y,d=Math.hypot(x,y),tile=b.map.grid[p.y]?.[p.x];
   if(passable(b,e,p)&&d>0&&d<=10&&(x*dx+y*dy)/(d*len)>=Math.SQRT1_2-1e-9&&tile?.tileKey!=='tile_end')state.candidates.push(p);
  }
 }
 e.fearMovement=state;
}
function choosePath(b,e,state,forceCurrent=false){
 const start=cell(e),tree=e.flying?null:reach(b,e,start),near=state.candidates.filter(p=>(e.flying?Math.hypot(p.x-e.x,p.y-e.y):tree.get(key(p))?.distance??Infinity)<=5);
 const chosen=!forceCurrent&&near.length?near[Math.floor(b.economy.random()*near.length)]:start;
 const offset={x:chosen.x+(b.economy.random()-.5)*.5,y:chosen.y+(b.economy.random()-.5)*.5};
 state.targetCenter=chosen;state.targetOffset=offset;state.path=e.flying?[]:pathTo(tree,chosen);state.path.push(offset);state.index=0;
}
function rejoin(b,e){
 if(e.flying)return;
 let index=e.cmd;
 if(e.route?.[index]?.kind==='wait')index++;
 const goal=e.route?.[index];if(goal?.kind!=='move')return;
 const tree=reach(b,e,cell(e)),route=pathTo(tree,cell(goal));
 if(route.length)e.route.splice(index,0,...route.map(p=>({kind:'move',...p})));
}

// null 表示没有恐惧，调用方继续常规路线；boolean 表示本帧已处理，值为是否抵达原终点。
export function advanceEnemyFear(b,e,dt){
 const states=(e.statuses||[]).filter(s=>FEAR.has(s.kind));
 if(!states.length){if(e.fearMovement){rejoin(b,e);e.fearMovement=null;}return null;}
 const active=states.find(s=>s.source===e.fearSource)||states.at(-1),signature=(e.fearRevision||0)+':'+states.map(s=>s.kind+':'+s.source).join(',');
 if(e.fearMovement?.signature!==signature)rebuild(b,e,active,signature);
 e.block=null;
 // 原路径事件仍执行，停驻时间正常消耗；仅移动部分交给临时路径。
 const escaped=advanceEnemy(e,dt,kind=>b.emit(kind,{uid:e.uid,x:e.x,y:e.y}),true);
 if(escaped||e.hidden||e.formHold||!permissions(e).move)return escaped;
 const state=e.fearMovement;
 // 外部位移/路径点传送后重新寻路；超过5格的旧目标从本次候选集淘汰。
 if(state.lastPosition&&state.targetCenter&&Math.hypot(e.x-state.lastPosition.x,e.y-state.lastPosition.y)>1e-7){
  const tree=e.flying?null:reach(b,e,cell(e)),distance=e.flying?Math.hypot(e.x-state.targetCenter.x,e.y-state.targetCenter.y):tree.get(key(state.targetCenter))?.distance??Infinity;
  if(distance>5){state.candidates=state.candidates.filter(p=>key(p)!==key(state.targetCenter));choosePath(b,e,state,true);}
  else{state.path=e.flying?[]:pathTo(tree,state.targetCenter);state.path.push(state.targetOffset);state.index=0;}
 }
 if(state.index>=state.path.length)choosePath(b,e,state);
 let distance=Math.max(0,enemyMovementSpeed(e)*(e.moveSpeedMod??1)*(e.waterMoveScale??1)*(e.sandMoveScale??1)*dt*((e.statuses||[]).some(s=>s.kind==='sluggish')?.2:1));
 while(distance>0&&state.index<state.path.length){
  const to=state.path[state.index],dx=to.x-e.x,dy=to.y-e.y,d=Math.hypot(dx,dy);
  if(d<=distance){e.x=to.x;e.y=to.y;state.index++;distance-=d;}
  else{e.x+=dx/d*distance;e.y+=dy/d*distance;distance=0;}
 }
 state.lastPosition={x:e.x,y:e.y};e.progress=remainingDistance(e);return false;
}
