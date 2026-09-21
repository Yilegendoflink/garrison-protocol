import {isIsolated} from './status.js';
import {cancelEnemyCast} from './native-enemy-skills.js';

export function initEnemyTransport(e){
 if(e.transport)return;
 const bb=e.enemyTalent||{},wood=e.id==='enemy_10159_mntrjn';
 if(!wood&&e.id!=='enemy_1302_ymtro_2')return;
 e.transport={max:Number(bb[wood?'bus.max_cnt':'Bus.max_cnt']),radius:.5,passengers:[],inheritRoute:wood,scatter:wood?.2:0,speedPerPassenger:wood?Number(bb['bus.move_speed']):0,disabled:false};
 if(wood){e.canAttack=e.baseCanAttack=false;e.unblockable=e.baseUnblockable=true;}else e.blockCost=4;
}

export function syncPassengerPositions(b){
 for(const e of b.s.enemies)if(e.carriedBy!=null){const carrier=b.s.enemies.find(a=>a.uid===e.carriedBy);if(carrier){e.x=carrier.x;e.y=carrier.y;}}
}

export function tickEnemyTransport(b){
 for(const carrier of b.s.enemies){
  const spec=carrier.transport;if(!spec||carrier.hp<=0)continue;
  spec.passengers=spec.passengers.filter(uid=>b.s.enemies.some(e=>e.uid===uid&&e.hp>0&&e.carriedBy===carrier.uid));
  const prohibited=carrier.hidden||carrier.carriedBy!=null||carrier.unbalanced||(carrier.statuses||[]).some(s=>['stun','frozen','levitate','sleep'].includes(s.kind));
  if(!spec.disabled&&!prohibited)for(const e of b.s.enemies){
   if(spec.passengers.length>=spec.max)break;
   if(e===carrier||e.hp<=0||e.hidden||isIsolated(e)||e.carriedBy!=null||e.flying||e.transport||['BOSS','LEADER'].includes(e.enemyRank)||(e.enemyTags||[]).includes('machine'))continue;
   if(Math.hypot(e.x-carrier.x,e.y-carrier.y)>spec.radius+1e-9)continue;
   cancelEnemyCast(b,e);e.action=null;e.block=null;e.hidden=true;e.carriedBy=carrier.uid;spec.passengers.push(e.uid);
   b.emit('enemy-ability',{uid:carrier.uid,x:carrier.x,y:carrier.y,ability:'board',targetUid:e.uid,count:spec.passengers.length});
  }
  if(spec.speedPerPassenger)carrier.speed=Math.max(.1,carrier.baseSpeed*(1+spec.speedPerPassenger*spec.passengers.length));
 }
 syncPassengerPositions(b);
}

// 退场及云梯都复用卸载；保留原实体/生命/技力，不生成新敌人或发放击倒奖励。
export function unloadEnemyTransport(b,carrier,{disable=false}={}){
 if(carrier.carriedBy!=null){
  const owner=b.s.enemies.find(e=>e.uid===carrier.carriedBy);
  if(owner?.transport){owner.transport.passengers=owner.transport.passengers.filter(uid=>uid!==carrier.uid);if(owner.transport.speedPerPassenger)owner.speed=Math.max(.1,owner.baseSpeed*(1+owner.transport.speedPerPassenger*owner.transport.passengers.length));}
  carrier.carriedBy=null;carrier.hidden=false;
 }
 const spec=carrier.transport;if(!spec)return;
 const passengers=spec.passengers;spec.passengers=[];if(disable)spec.disabled=true;
 for(const uid of passengers){
  const e=b.s.enemies.find(a=>a.uid===uid&&a.hp>0&&a.carriedBy===carrier.uid);if(!e)continue;
  e.carriedBy=null;e.hidden=false;e.block=null;e.action=null;
  e.x=spec.scatter?carrier.x+(b.economy.random()*2-1)*spec.scatter:Math.round(carrier.x);
  e.y=spec.scatter?carrier.y+(b.economy.random()*2-1)*spec.scatter:Math.round(carrier.y);
  if(spec.inheritRoute){e.route=structuredClone(carrier.route);e.cmd=carrier.cmd;}
  if(e.route?.[e.cmd]?.kind==='wait')e.cmd++;
  e.cmdLeft=null;
  b.emit('enemy-ability',{uid:carrier.uid,x:e.x,y:e.y,ability:'unload',targetUid:e.uid});
 }
 carrier.speed=carrier.baseSpeed;
}
