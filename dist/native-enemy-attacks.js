import {permissions,statusAttributeChanges,applyStatus} from './status.js';
import {attackableAllies,getActor} from './native-effects.js';
import {compareEnemyTargets,enemyTargetValid,enemyTargetInRange,scheduleStrikes,TENTATIVE_HIT_GAP,enemyChainTargets} from './native-combat.js';
import {endEnemySkill} from './native-enemy-skills.js';

export function enemyAttackTargets(battle,e,alive=attackableAllies(battle.s)){
 if(e.hidden)return [];
 const spec=e.enemyAttack||{},blocker=alive.find(u=>u.uid===e.block&&enemyTargetValid(u)&&!spec.excludeIds?.includes(u.id));
 const targets=(e.ranged||spec.unblockedTargetIds)?alive.filter(u=>(!spec.unblockedTargetIds||spec.unblockedTargetIds.includes(u.id))&&enemyTargetValid(u)&&!spec.excludeIds?.includes(u.id)&&!u.invisible&&!permissions(u).sleeping&&(!spec.groundOnly||!u.flying)&&(!spec.lowlandOnly||battle.map.grid[Math.round(u.y)]?.[Math.round(u.x)]?.heightType==='LOWLAND')&&
  (enemyTargetInRange(e,u)||(e.specialSkill?.prefab==='CrossAttack'&&(Math.abs(e.x-u.x)<=1e-6||Math.abs(e.y-u.y)<=1e-6)))):[];
 targets.sort((a,b)=>compareEnemyTargets({tauntLevel:a.kind==='summon'?0:battle.stats(a).tauntLevel,deployAt:a.deployAt||0,uid:a.uid},{tauntLevel:b.kind==='summon'?0:battle.stats(b).tauntLevel,deployAt:b.deployAt||0,uid:b.uid}));
 if(/^enemy_10122_uacann(?:_2)?$/.test(e.id)&&battle.enemyHasArmyOrder(e))targets.sort((a,b)=>Number(b.id==='enemy_3010_mcreep')-Number(a.id==='enemy_3010_mcreep'));
 if(/^enemy_1389_winbab(?:_2)?$/.test(e.id))targets.sort((a,b)=>Number(battle.atBrazierWindDoor(b))-Number(battle.atBrazierWindDoor(a)));
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
 if(control.attack&&enemy.canAttack!==false&&!enemy.hidden&&target?.hp>0&&(packet.targetDeployGen==null||target.deployGen===packet.targetDeployGen)){
  if(enemy.id==='enemy_2050_smsha'&&!packet.special){
   const bb=enemy.enemyTalent,chain=enemyChainTargets(target,attackableAllies(battle.s).filter(t=>enemyTargetValid(t)&&!t.invisible&&!permissions(t).sleeping),Number(bb['Attack.attack@chain.max_target']),Number(bb['Attack.attack@projectile_range']));
   let from=enemy;
   for(let i=0;i<chain.length;i++){
    const victim=chain[i];applyStatus(victim,'cold',Number(bb['Attack.attack@freeze']),{source:enemy.uid,frostSide:'enemy'});
    battle.resolveEnemyStrike(enemy,victim,{...packet,scale:(Number(packet.scale)||1)*Math.pow(Number(bb['Attack.attack@chain.atk_scale']),i),type:'arts'});
    battle.emit('strike',{uid:enemy.uid,x:from.x,y:from.y,targetX:victim.x,targetY:victim.y,ranged:true,enemy:true,type:'arts',style:'chain',hit:i});from=victim;
   }
   return;
  }
  const spec=enemy.enemyAttack||{},ranged=packet.ranged??(enemy.ranged&&enemy.block!==target.uid);
  const splash=spec.splashOnlyRanged&&!ranged?null:packet.special?.splash?{shape:'cross'}:spec.splash;
  if(spec.projectile?.delay>0){
   const config=spec.projectile,amount=enemy.atk*(Number(packet.special?.scale??packet.scale)||1)*(1+Math.min(0,statusAttributeChanges(enemy).attack||0));
   battle.s.enemyProjectiles??=[];
   battle.s.enemyProjectiles.push({owner:enemy.uid,startedAt:battle.s.time,impactAt:battle.s.time+config.delay,startX:enemy.x,startY:enemy.y,targetX:target.x,targetY:target.y,radius:config.radius,amount,type:packet.special?.type||enemy.damageType,attackId:packet.attackId??null});
   battle.emit('strike',{uid:enemy.uid,x:enemy.x,y:enemy.y,targetX:target.x,targetY:target.y,ranged:true,enemy:true,type:enemy.damageType,style:'artillery'});
   return;
  }
  const victims=[target,...(splash?attackableAllies(battle.s).filter(u=>u!==target&&(!(spec.splashGroundOnly??spec.groundOnly)||!u.flying)&&inSplash(target,u,splash)):[])];
  const scale=(Number(packet.scale)||1)*(ranged?(spec.rangedScaleKey?Number(enemy.enemyTalent[spec.rangedScaleKey])||1:spec.rangedScale??1):1);
  battle.emit('strike',{uid:enemy.uid,x:enemy.x,y:enemy.y,targetX:target.x,targetY:target.y,ranged,enemy:true,type:packet.special?.type||enemy.damageType,style:splash?'splash':packet.special?.prefab||'single',hit:packet.hitIndex??packet.hit});
  if(enemy.powStartedAt!=null&&!enemy.powSpent)enemy.powHit=true;
  for(const victim of victims){
   if(packet.special?.stunBeforeDamage&&permissions(enemy).skill&&!permissions(enemy).silenced)applyStatus(victim,'stun',packet.special.stun,{source:enemy.uid});
   battle.resolveEnemyStrike(enemy,victim,{...packet,scale,...(['enemy_1500_skulsr','enemy_1512_mcmstr'].includes(enemy.id)&&victim!==target?{cause:'splash'}:{}),suppressAttackZone:victim!==target});
   if(enemy.id==='enemy_1500_skulsr'&&ranged)applyStatus(victim,'defDown',5,{source:enemy.uid,value:Number(enemy.enemyTalent['defdown.def']),resistible:false});
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
   battle.hurt(target,{atk:shot.amount,damageType:shot.type},{attackId:shot.attackId,sourceLess:true,...(shot.cold?{cause:'extra'}:{})});
   if(shot.cold>0&&!target.invulnerable&&!permissions(target).sleeping)applyStatus(target,'cold',shot.cold,{frostSide:'enemy'});
  }
  battle.emit('impact',{x:shot.targetX,y:shot.targetY,radius:shot.radius,type:shot.type,enemy:true});
 }
 battle.s.enemyProjectiles=keep;
}

export function releaseEnemyAttack(battle,enemy,action){
 const selected=action.targets||[action.target],spec=enemy.enemyAttack||{},targets=spec.repeatTargets&&selected.length?Array.from({length:spec.repeatTargets},(_,i)=>selected[i%selected.length]):selected,hits=Math.max(1,action.special?.hits??spec.hits??1),gap=Number(spec.hitInterval)||TENTATIVE_HIT_GAP;
 battle.recordEnemyAttack(enemy,action.special);
 if(hits>1&&enemy.enemyCast)enemy.enemyCast.multiAttack=true;
 for(let i=0;i<targets.length;i++){
  const packet={enemyAttack:true,owner:enemy.uid,target:targets[i],targetDeployGen:getActor(battle.s,targets[i])?.deployGen,special:action.special,scale:action.scale,ranged:action.ranged,attackId:action.attackId,hit:0,last:hits===1&&i===targets.length-1};
  if(spec.repeatTargets&&i>0)scheduleStrikes(battle.s,1,{...packet,delay:i*gap,hitIndex:i});else deliverEnemyAttack(battle,packet);
  for(let hit=1;hit<hits;hit++)scheduleStrikes(battle.s,1,{...packet,hitIndex:hit,delay:hit*gap,last:hit===hits-1&&i===targets.length-1});
 }
}
