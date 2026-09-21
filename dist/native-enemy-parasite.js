import {getActor,alliedActors,dealDamage,applyElementDamage} from './native-effects.js';
import {permissions} from './status.js';

function hostOf(b,e){
 if(e.id!=='enemy_9007_acelem'||e.hp<=0||e.hidden||e.block==null)return null;
 const host=getActor(b.s,e.block);
 return host?.deployed&&host.hp>0&&permissions(host).block&&Math.hypot(host.x-e.x,host.y-e.y)<.72?host:null;
}
function detach(e){e.parasiteTargetUid=null;e.parasiteNextAt=null;e.formHold=false;}

export function tickEnemyParasites(b){
 for(const e of b.s.enemies){
  if(e.id!=='enemy_9007_acelem')continue;
  const host=hostOf(b,e);
  if(!host){if(e.parasiteTargetUid!=null)detach(e);continue;}
  if(e.parasiteTargetUid!==host.uid){
   e.parasiteTargetUid=host.uid;e.parasiteNextAt=b.s.time+1;e.formHold=true;e.x=Math.round(host.x);e.y=Math.round(host.y);
   b.emit('enemy-ability',{uid:e.uid,x:e.x,y:e.y,ability:'attach',targetUid:host.uid});
  }
  while(e.parasiteNextAt!=null&&b.s.time+1e-9>=e.parasiteNextAt){
   e.parasiteNextAt+=1;
   dealDamage(b,{source:e,target:host,amount:e.atk*Number(e.enemyTalent['1.atk_scale']),type:'arts',cause:'dot'});
   if(!hostOf(b,e)){detach(e);break;}
  }
 }
}

export function parasiteElementMultiplier(b,target){
 return b.s.enemies.reduce((n,e)=>e.parasiteTargetUid===target.uid&&hostOf(b,e)===target?Math.max(n,Number(e.enemyTalent['1.ep_damage_scale'])||1):n,1);
}

export function spreadParasiteElement(b,{target,element,event}){
 for(const e of b.s.enemies){
  if(e.parasiteTargetUid!==target.uid||hostOf(b,e)!==target)continue;
  for(const ally of alliedActors(b.s))if(ally.deployed&&ally.hp>0&&Math.abs(Math.round(ally.x)-Math.round(target.x))+Math.abs(Math.round(ally.y)-Math.round(target.y))<=1){
   applyElementDamage(b,{source:e,target:ally,amount:1000,type:element,cause:'parasite-spread',parentEventId:event.eventId});
  }
  b.emit('enemy-ability',{uid:e.uid,x:target.x,y:target.y,ability:'element-spread',element});
 }
}

export function detachEnemyParasites(b,actor){
 for(const e of b.s.enemies)if(e.id==='enemy_9007_acelem'&&(e===actor||e.parasiteTargetUid===actor.uid)){detach(e);e.block=null;}
}
