import {attribute,FPS} from './combat.js';
import {permissions} from './status.js';
import {skillKind} from './native-sp.js';

// Tentative adapters — not original animation tables. Do not treat as restored data.
export const TENTATIVE_WINDUP_RATIO=.3;
export const TENTATIVE_PROJECTILE_SPEED=6;
export const TENTATIVE_HIT_GAP=2/FPS;

export function remainingDistance(e){
 const route=e.route;if(!route||route.length===0)return 0;
 let d=0,x=e.x,y=e.y,i=e.cmd??e.segment??0;
 for(;i<route.length;i++){
  const s=route[i],kind=s.kind||'move';
  if(kind==='appear'){x=s.x;y=s.y;continue;}
  if(kind!=='move')continue;
  d+=Math.hypot((s.x??s[0])-x,(s.y??s[1])-y);
  x=s.x??s[0];y=s.y??s[1];
 }
 return d;
}
export function specialPriority(a,b,priority){
 if(priority==='air')return Number(!!b.flying)-Number(!!a.flying);
 if(priority==='defense')return (a.def||0)-(b.def||0);
 if(priority==='weight')return (b.weight||0)-(a.weight||0);
 return 0;
}
export function compareOperatorTargets(a,b,uid,priority,position){
 const blocked=position==='RANGED'?0:Number(b.block===uid)-Number(a.block===uid);
 return blocked
  || specialPriority(a,b,priority)
  || (b.taunt||0)-(a.taunt||0)
  || remainingDistance(a)-remainingDistance(b)
  || a.uid-b.uid;
}
export function compareEnemyTargets(a,b){
 return (b.tauntLevel||b.taunt||0)-(a.tauntLevel||a.taunt||0) || (b.deployAt||0)-(a.deployAt||0) || b.uid-a.uid;
}
export function enemyBlockCost(e){return Math.max(1,e.blockCost||1);}
export function canStayBlocked(e,u,used,cap){
 if(!u||!e||e.hp<=0||e.flying||e.hidden||e.untargetable||e.unblockable)return false;
 if(!permissions(e).beBlocked||!permissions(u).block||!u.deployed||u.hp<=0)return false;
 if(Math.hypot(u.x-e.x,u.y-e.y)>=.72)return false;
 return used+enemyBlockCost(e)<=cap;
}
export function resolveBlocks(units,enemies,capOf){
 const alive=units.filter(u=>u.hp>0&&u.deployed),used=new Map();
 for(const u of alive)used.set(u.uid,0);
 for(const e of enemies){
  if(e.hp<=0||e.trainingDummy){e.block=null;continue;}
  const u=alive.find(x=>x.uid===e.block),cap=u?capOf(u):0,need=enemyBlockCost(e);
  if(!canStayBlocked(e,u,used.get(u?.uid)||0,cap))e.block=null;
  else used.set(u.uid,(used.get(u.uid)||0)+need);
 }
 const seekers=enemies.filter(e=>e.hp>0&&!e.trainingDummy&&e.block==null&&!e.flying&&!e.hidden&&!e.untargetable&&!e.unblockable&&permissions(e).beBlocked).sort((a,b)=>a.uid-b.uid);
 for(const e of seekers){
  const need=enemyBlockCost(e);
  const u=alive.filter(x=>permissions(x).block&&Math.hypot(x.x-e.x,x.y-e.y)<.72&&(used.get(x.uid)||0)+need<=capOf(x)).sort((a,b)=>a.uid-b.uid)[0];
  if(u){e.block=u.uid;used.set(u.uid,(used.get(u.uid)||0)+need);}
 }
}
export function compileRoute(route,to,walk,bfs){
 const start=to(route.startPosition),end=to(route.endPosition);
 const raw=[{kind:'move',x:start.x,y:start.y},...(route.checkpoints||[]).map(c=>{
  const p=c.position?to(c.position):start,type=c.type||'MOVE';
  if(type==='WAIT_FOR_SECONDS'||type==='WAIT')return {kind:'wait',x:null,y:null,time:c.time||0};
  if(type==='DISAPPEAR')return {kind:'disappear',x:null,y:null};
  if(type==='APPEAR_AT_POS'||type==='APPEAR')return {kind:'appear',x:p.x,y:p.y};
  if(type==='MOVE'||type==='PATROL_MOVE')return {kind:'move',x:p.x,y:p.y};
  throw Error('未支持的路线指令 '+type);
 }),{kind:'move',x:end.x,y:end.y}];
 const steps=[{kind:'move',x:start.x,y:start.y}];let cur=start;
 const pushWalk=(dest)=>{
  if(cur.x===dest.x&&cur.y===dest.y)return;
  if(!walk){steps.push({kind:'move',x:dest.x,y:dest.y});cur=dest;return;}
  const segment=bfs(cur,dest);if(!segment)throw Error('原始路线不可达：'+cur.x+','+cur.y+' → '+dest.x+','+dest.y);
  for(const p of segment)steps.push({kind:'move',x:p.x,y:p.y});
  cur=dest;
 };
 for(const node of raw){
  if(node.kind==='move')pushWalk(node);
  else if(node.kind==='appear'){steps.push(node);cur={x:node.x,y:node.y};}
  else{
   if(node.x!=null&&(node.x!==cur.x||node.y!==cur.y))pushWalk({x:node.x,y:node.y});
   steps.push({...node,x:cur.x,y:cur.y});
  }
 }
 return steps.length?steps:[{kind:'move',x:start.x,y:start.y}];
}
export function advanceEnemy(e,dt,onEvent,stopForAttack=false){
 if(e.hp<=0||e.trainingDummy||!e.route)return false;
 if(!Number.isInteger(e.cmd))e.cmd=Math.min(e.route.length,(e.segment||0)+1);
 const slow=(e.statuses||[]).some(s=>s.kind==='sluggish')?0.2:1;
 while(e.cmd<e.route.length){
  const s=e.route[e.cmd];
  if(s.kind==='wait'){
   if(e.cmdLeft==null)e.cmdLeft=s.time;
   const used=Math.min(dt,e.cmdLeft);e.cmdLeft-=used;dt-=used;
   if(e.cmdLeft<=1e-9){e.cmd++;e.cmdLeft=null;}
   if(dt<=1e-9)break;
   continue;
  }
  if(s.kind==='disappear'){e.hidden=true;e.untargetable=true;e.block=null;e.action=null;e.cmd++;e.cmdLeft=null;onEvent?.('disappear',e);continue;}
  if(s.kind==='appear'){e.x=s.x;e.y=s.y;e.hidden=false;e.untargetable=false;e.cmd++;e.cmdLeft=null;onEvent?.('appear',e);continue;}
  const dx=s.x-e.x,dy=s.y-e.y,d=Math.hypot(dx,dy);
  if(d<=1e-9){e.cmd++;continue;}
  const speed=(!e.block&&permissions(e).move&&!stopForAttack)?e.speed*slow:0;
  if(speed<=0||dt<=1e-9)break;
  const move=speed*dt;
  if(d<=move){e.x=s.x;e.y=s.y;e.cmd++;e.cmdLeft=null;dt-=d/speed;}
  else{e.x+=dx/d*move;e.y+=dy/d*move;break;}
 }
 e.progress=remainingDistance(e);
 return e.cmd>=e.route.length;
}
export function skillFlow(skill){
 const kind=skillKind(skill);
 if(!kind)return {kind:null,resetAttack:false,lockSp:false,changeAttack:false};
 const desc=skill.description||'';
 return {
  kind,
  resetAttack:skill.combatFlow?.resetAttack??(kind!=='instant'),
  lockSp:kind==='duration'||kind==='ammo',
  changeAttack:kind==='duration'||kind==='ammo'||/攻击力|攻击间隔|攻击变为/.test(desc)
 };
}
export function combineStat(base,add,ratio,muls){
 return attribute(base,{add,ratio,scales:muls||[]});
}
export function emitEvent(s,type,extra={}){
 const {type:damageType,...details}=extra;
 s.eventId=(s.eventId||0)+1;
 s.events??=[];s.events.push({...details,damageType,t:s.time,type,id:s.eventId});
 if(s.events.length>96)s.events.splice(0,s.events.length-96);
}
export function pruneEvents(s,keep=4){
 if(!s.events)return;s.events=s.events.filter(e=>s.time-e.t<=keep);
}
export function scheduleStrikes(s,hits,base){
 const gap=base.gap??TENTATIVE_HIT_GAP;
 for(let i=0;i<hits;i++)(s.strikes??=[]).push({...base,at:s.time+(base.delay||0)+i*gap,hit:i});
}
export function dueStrikes(s){
 const due=(s.strikes||[]).filter(x=>x.at<=s.time);s.strikes=(s.strikes||[]).filter(x=>x.at>s.time);return due;
}
export function windupSeconds(interval,override){
 if(Number.isFinite(override)&&override>=0)return override;
 return interval*TENTATIVE_WINDUP_RATIO;
}
