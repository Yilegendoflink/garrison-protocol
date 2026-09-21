import {tickStatuses,permissions,statusAttributeChanges} from './status.js';
import {advanceEnemy,compareEnemyTargets,windupSeconds} from './native-combat.js';
import {attackTiming,FPS} from './combat.js';
import {advanceEnemyFear} from './native-enemy-fear.js';
import {dealDamage,applyHeal,commitExit,getActor,newAttackId} from './native-effects.js';

export function spawnMiner(battle,q,placement){
 const raw=battle.data.enemyDependencies.enemy_3010_mcreep,a=raw.attributes,route=structuredClone(placement?.route||battle.path(battle.level.routes[q.route??0],false)),p=placement||route[0],bb=Object.fromEntries(raw.talentBlackboard.map(x=>[x.key,x.value]));
 const miner={uid:battle.s.nextId++,id:raw.prefabKey,name:raw.name,kind:'summon',type:'neutral-miner',neutral:true,allied:false,deployed:true,deployGen:0,x:p.x,y:p.y,hp:a.maxHp,maxHp:a.maxHp,atk:a.atk,def:a.def,res:a.magicResistance,taunt:-1,speed:a.moveSpeed,baseSpeed:a.moveSpeed,range:raw.rangeRadius,interval:a.baseAttackTime,attackSpeed:a.attackSpeed||100,damageType:'physical',canAttack:true,canBlock:false,blockCnt:0,unblockable:true,block:null,occupiesTile:false,elementalImmune:true,route,routeDiagonal:placement?.routeDiagonal??false,cmd:placement?.cmd??0,cmdLeft:null,hidden:false,waiting:!!placement?.waiting,attackCooldown:0,action:null,statuses:[],shield:0,shieldLayers:[],barriers:[],enemyTalent:bb,nextMedicAt:battle.s.time+1,fearDamageAt:null};
 battle.s.summons.push(miner);battle.emit('summon',{uid:miner.uid,x:miner.x,y:miner.y,type:miner.type});return miner;
}

export function tickMiners(battle,dt){
 for(const m of battle.s.summons.slice())if(m.type==='neutral-miner'&&m.deployed&&m.hp>0){
  tickStatuses(m,dt);const control=permissions(m),fear=m.statuses.some(s=>['fear','selfFear'].includes(s.kind));
  if(fear){m.fearDamageAt??=battle.s.time+1;while(m.hp>0&&battle.s.time+1e-9>=m.fearDamageAt){m.fearDamageAt+=1;dealDamage(battle,{source:m,target:m,amount:Number(m.enemyTalent['FearLoseBlood.value']),type:'true',cause:'dot'});}}
  else m.fearDamageAt=null;
  while(m.hp>0&&battle.s.time+1e-9>=m.nextMedicAt){m.nextMedicAt+=1;if(m.hp<m.maxHp)for(const medic of battle.s.units.filter(u=>u.deployed&&u.hp>0&&battle.profile(u)?.profession==='MEDIC'&&battle.inside(u,m))){applyHeal(battle,{source:m,target:m,amount:battle.stats(medic).atk*Number(m.enemyTalent['GetHeal.heal_scale']),minerMedicUid:medic.uid});}}
  if(m.hp<=0)continue;
  const targets=battle.s.enemies.filter(e=>e.hp>0&&!e.hidden&&!e.flying&&!e.invulnerable&&!e.invisible&&!permissions(e).sleeping&&Math.hypot(e.x-m.x,e.y-m.y)<=m.range+1e-9);
  targets.sort((a,b)=>compareEnemyTargets({uid:a.uid,tauntLevel:a.taunt||0,deployAt:0},{uid:b.uid,tauntLevel:b.taunt||0,deployAt:0}));
  m.attackCooldown=Math.max(0,m.attackCooldown-1);
  if(m.action){const action=m.action;if(!control.attack||m.waiting){m.action=null;}else if(battle.s.time+1e-9>=action.fireAt){m.action=null;const target=getActor(battle.s,action.targetUid);if(target?.hp>0&&target.deployGen===action.targetGen&&!target.hidden){dealDamage(battle,{source:m,target,amount:m.atk,type:'physical',cause:'attack',attackId:action.attackId});battle.emit('strike',{uid:m.uid,x:m.x,y:m.y,targetX:target.x,targetY:target.y,type:'physical',enemy:false});}}}
  if(!m.waiting&&control.attack&&!m.action&&m.attackCooldown===0&&targets.length){const timing=attackTiming(m.interval,m.attackSpeed+statusAttributeChanges(m).attackSpeed,windupSeconds(m.interval)),target=targets[0];m.attackCooldown=timing.frames;m.action={targetUid:target.uid,targetGen:target.deployGen,fireAt:battle.s.time+timing.windupFrames/FPS,attackId:newAttackId(battle)};}
  const feared=advanceEnemyFear(battle,m,dt),escaped=feared??advanceEnemy(m,dt,kind=>battle.emit(kind,{uid:m.uid,x:m.x,y:m.y}),m.waiting||targets.length>0||!!m.action);
  if(escaped)commitExit(battle,{target:m,reason:'route-end'});
 }
}
