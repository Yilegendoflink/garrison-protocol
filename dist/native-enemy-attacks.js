import {permissions,statusAttributeChanges} from './status.js';
import {attackableAllies,getActor} from './native-effects.js';
import {compareEnemyTargets,enemyTargetValid,enemyTargetInRange,scheduleStrikes,TENTATIVE_HIT_GAP} from './native-combat.js';
import {endEnemySkill} from './native-enemy-skills.js';

export function enemyAttackTargets(battle,e,alive=attackableAllies(battle.s)){
 if(e.hidden)return [];
 const spec=e.enemyAttack||{},blocker=alive.find(u=>u.uid===e.block&&enemyTargetValid(u));
 const targets=e.ranged?alive.filter(u=>enemyTargetValid(u)&&!u.invisible&&!permissions(u).sleeping&&(!spec.groundOnly||!u.flying)&&
  (enemyTargetInRange(e,u)||(e.specialSkill?.prefab==='CrossAttack'&&(Math.abs(e.x-u.x)<=1e-6||Math.abs(e.y-u.y)<=1e-6)))):[];
 targets.sort((a,b)=>compareEnemyTargets({tauntLevel:a.kind==='summon'?0:battle.stats(a).tauntLevel,deployAt:a.deployAt||0,uid:a.uid},{tauntLevel:b.kind==='summon'?0:battle.stats(b).tauntLevel,deployAt:b.deployAt||0,uid:b.uid}));
 if(blocker&&!spec.ignoreBlock)return [blocker,...targets.filter(t=>t!==blocker)];
 return targets;
}

export function enemyAttackTargetCount(e){
 const spec=e.enemyAttack||{};
 if(spec.invisibleTargets)return e.invisible&&!e.revealed&&e.block==null?spec.invisibleTargets:1;
 return spec.targets||1;
}

function inSplash(center,target,spec){
 if(spec.shape==='square')return Math.max(Math.abs(Math.round(center.x)-Math.round(target.x)),Math.abs(Math.round(center.y)-Math.round(target.y)))<=(spec.radius||1);
 if(spec.shape==='cross')return Math.abs(Math.round(center.x)-Math.round(target.x))+Math.abs(Math.round(center.y)-Math.round(target.y))<=1;
 return Math.hypot(center.x-target.x,center.y-target.y)<=(spec.radius||0)+1e-9;
}

export function deliverEnemyAttack(battle,packet){
 const enemy=getActor(battle.s,packet.owner);if(!enemy||enemy.hp<=0)return;
 const target=getActor(battle.s,packet.target),control=permissions(enemy);
 if(control.attack&&!enemy.hidden&&target?.hp>0){
  const spec=enemy.enemyAttack||{},splash=packet.special?.splash?{shape:'cross'}:spec.splash;
  if(spec.projectile?.delay>0){
   const config=spec.projectile,amount=enemy.atk*(Number(packet.special?.scale??packet.scale)||1)*(1+Math.min(0,statusAttributeChanges(enemy).attack||0));
   battle.s.enemyProjectiles??=[];
   battle.s.enemyProjectiles.push({owner:enemy.uid,startedAt:battle.s.time,impactAt:battle.s.time+config.delay,startX:enemy.x,startY:enemy.y,targetX:target.x,targetY:target.y,radius:config.radius,amount,type:packet.special?.type||enemy.damageType,attackId:packet.attackId??null});
   battle.emit('strike',{uid:enemy.uid,x:enemy.x,y:enemy.y,targetX:target.x,targetY:target.y,ranged:true,enemy:true,type:enemy.damageType,style:'artillery'});
   return;
  }
  const victims=[target,...(splash?attackableAllies(battle.s).filter(u=>u!==target&&(!spec.groundOnly||!u.flying)&&inSplash(target,u,splash)):[])];
  battle.emit('strike',{uid:enemy.uid,x:enemy.x,y:enemy.y,targetX:target.x,targetY:target.y,ranged:enemy.ranged,enemy:true,type:packet.special?.type||enemy.damageType,style:splash?'splash':packet.special?.prefab||'single',hit:packet.hitIndex??packet.hit});
  if(enemy.powStartedAt!=null&&!enemy.powSpent)enemy.powHit=true;
  for(const victim of victims){
   battle.resolveEnemyStrike(enemy,victim,{...packet,suppressAttackZone:victim!==target});
   battle.resolveEnemyAttackEffects(enemy,victim,{count:false,extra:packet.special});
  }
 }
 if(packet.last&&enemy.enemyCast?.multiAttack)endEnemySkill(battle,enemy);
}

export function tickEnemyProjectiles(battle){
 const keep=[];
 for(const shot of battle.s.enemyProjectiles||[]){
  if(battle.s.time+1e-9<shot.impactAt){keep.push(shot);continue;}
  // 已发射弹道不再依赖发射者和原目标；无来源伤害使用发射时缓存的攻击力。
  for(const target of attackableAllies(battle.s))if((!shot.groundOnly||!target.flying)&&Math.hypot(target.x-shot.targetX,target.y-shot.targetY)<=shot.radius+1e-9){
   battle.hurt(target,{atk:shot.amount,damageType:shot.type},{attackId:shot.attackId,sourceLess:true});
  }
  battle.emit('impact',{x:shot.targetX,y:shot.targetY,radius:shot.radius,type:shot.type,enemy:true});
 }
 battle.s.enemyProjectiles=keep;
}

export function releaseEnemyAttack(battle,enemy,action){
 const targets=action.targets||[action.target],spec=enemy.enemyAttack||{},hits=Math.max(1,spec.hits||1),gap=Number(spec.hitInterval)||TENTATIVE_HIT_GAP;
 battle.recordEnemyAttack(enemy,action.special);
 if(hits>1&&enemy.enemyCast)enemy.enemyCast.multiAttack=true;
 for(let i=0;i<targets.length;i++){
  const packet={enemyAttack:true,owner:enemy.uid,target:targets[i],special:action.special,scale:action.scale,attackId:action.attackId,hit:0,last:hits===1&&i===targets.length-1};
  deliverEnemyAttack(battle,packet);
  for(let hit=1;hit<hits;hit++)scheduleStrikes(battle.s,1,{...packet,hitIndex:hit,delay:hit*gap,last:hit===hits-1&&i===targets.length-1});
 }
}
