import {branchBehavior,branchTrait} from './native-branches.js';
import {nativeWavePlan} from './native-waves.js';
import {damage,applyDamage,recoverHP,attackTiming,FPS} from './combat.js';
import {applyStatus,tickStatuses,permissions,statusAttributeChanges} from './status.js';
import {blackboard,skillPolicy,shouldAutoSkill} from './protocol.js';
import {createTrainingDummy,dummySummary} from './benchmark.js';

export class NativeBattle {
 constructor(data,economy,map,turn){
  this.data=data;this.economy=economy;this.map=map;this.s={frame:0,time:0,units:[],enemies:[],projectiles:[],queue:[],damage:{},leaks:0,kills:0,finished:false,benchmark:!!turn.isBossTurn,limit:turn.isBossTurn?turn.bossTurnHpReduceTime:turn.normalPhaseTime,effects:[],nextId:100000};
  this.rows=economy.bonds();this.layers=economy.s.bondLayers;this.s.band=economy.s.bandId;
  const sources=economy.s.units.filter(u=>u.position).sort((a,b)=>a.position.y-b.position.y||a.position.x-b.position.x);
  this.s.units=sources.map((u,i)=>{const p=this.profile(u),a=p.attributes,skill=p.skill;return {uid:u.uid,id:u.charId,chessId:u.chessId,source:u,x:u.position.x,y:u.position.y,dir:u.dir,hp:a.maxHp,maxHp:a.maxHp,sp:skill?.spData.initSp||0,deployed:false,deployAt:3+i*.18,down:0,skillLeft:0,skillCount:0,ammo:0,attackCooldown:0,action:null,statuses:[],shield:0,barriers:[],damage:0,healing:0,lastAttack:0,lastSkill:-999,counters:{},buffs:[]};});
  if(this.s.benchmark){this.s.enemies=[createTrainingDummy(this.s.nextId++,5,3)];this.s.total=1;}else this.prepareWaves(turn);
  for(const u of this.s.units){const stats=this.stats(u);u.hp=u.maxHp=stats.maxHp;}
 }
 profile(u){const row=this.data.profiles[u.chessId];const selected=row?.skillChoices?.[u.source?.skillIndex??u.skillIndex];return selected?{...row,...selected}:row;}
 skillActive(u){return u.skillLeft>0||u.ammo>0;}
 behavior(u){return branchBehavior(this.profile(u),this.skillActive(u));}
 canHeal(target,source=null){
  if(!target?.deployed||target.hp<=0||target.isolated)return false;
  const noExternal=this.behavior(target).noExternalHealing,selfException=noExternal&&source?.uid===target.uid;
  return selfException||(!noExternal&&!target.unhealable&&!target.statuses?.some(s=>s.kind==='healingBlocked'));
 }
 elementInjury(target){const value=target.elementInjury;return typeof value==='number'?Math.max(0,value):Object.values(value||{}).reduce((sum,n)=>sum+Math.max(0,n||0),0);}
 healingTargets(u,allowFull=false){const element=this.behavior(u).elementHealing;return this.s.units.filter(v=>this.canHeal(v,u)&&this.inside(u,v)&&(allowFull||v.hp<v.maxHp||(element&&this.elementInjury(v)>0))).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp||(element?this.elementInjury(b)-this.elementInjury(a):0)||a.uid-b.uid);}
 inNamedRange(center,target,id){const range=this.data.ranges[id];return (range?.grids||[]).some(g=>{let x=g.col,y=-g.row;for(let i=0;i<(center.dir||0);i++)[x,y]=[-y,x];return Math.abs(center.x+x-target.x)<=.5&&Math.abs(center.y+y-target.y)<=.5;});}
 heal(source,target,amount){
  if(!source.deployed||source.hp<=0||!this.canHeal(target,source)||!Number.isFinite(amount)||amount<=0)return 0;
  const behavior=this.behavior(source),trait=branchTrait(this.profile(source));if(behavior.farHealRange&&!this.inNamedRange(source,target,behavior.farHealRange))amount*=trait.values.heal_scale??.8;if(behavior.healsDuringSkill&&this.skillActive(source))amount*=trait.values.heal_scale??.75;
  const real=recoverHP(target,amount*(target.healingReceived??1)*(source.healingMultiplier??1));source.healing+=real;if(real>0)this.s.effects.push({x:target.x,y:target.y,text:'+'+Math.round(real),life:.6,type:'healing'});return real;
 }
 healElements(source,target,amount){
  if(!this.canHeal(target,source)||amount<=0)return;let restored=0;if(typeof target.elementInjury==='number'){restored=Math.min(target.elementInjury,amount);target.elementInjury-=restored;}else if(target.elementInjury){for(const key of Object.keys(target.elementInjury)){const n=Math.min(Math.max(0,target.elementInjury[key]),amount);target.elementInjury[key]-=n;restored+=n;}}source.elementHealing=(source.elementHealing||0)+restored;
 }
 regenerate(source,target,amount){if(!target?.deployed||target.hp<=0)return;const real=recoverHP(target,amount);source.regeneration=(source.regeneration||0)+real;}
 updateBranch(u,dt){
  const p=this.profile(u),behavior=this.behavior(u),trait=branchTrait(p).values,active=this.skillActive(u);
  if(p.branch==='librator'){if(u.branchSkillActive&&!active)u.branchCharge=0;if(!active)u.branchCharge=Math.min(trait.max_stack_cnt??40,(u.branchCharge||0)+dt);}
  u.branchSkillActive=active;
  if(behavior.hpDrain)u.hp=Math.max(Math.min(1,u.hp),u.hp-u.maxHp*(trait.hp_ratio??behavior.hpDrain)*dt);
  if(behavior.kind==='regeneration'){
   const bb=active?blackboard(p.skill?.blackboard):{},replaced=active&&(p.skill?.description||'').includes('特性变为');
   if(!replaced){const ratio=bb['attack@atk_to_hp_recovery_ratio']??trait['attack@atk_to_hp_recovery_ratio']??.1;const amount=this.stats(u).atk*ratio*dt;for(const ally of this.s.units)if(this.inside(u,ally))this.regenerate(u,ally,amount);}
  }
  if(u.pendingSelfHeals){const due=u.pendingSelfHeals.filter(h=>h.at<=this.s.time);u.pendingSelfHeals=u.pendingSelfHeals.filter(h=>h.at>this.s.time);for(const h of due)this.heal(u,u,h.amount);}
 }
 selfHealAfterDamage(u){
  if(!u.deployed||u.hp<=0)return;const behavior=this.behavior(u),amount=branchTrait(this.profile(u)).values.value||0;
  if(behavior.selfHealing==='musha')this.heal(u,u,amount);
  if(behavior.selfHealing==='reaper'){
   if(this.s.time-(u.reaperWindowStart??-999)>=.05){u.reaperWindowStart=this.s.time;u.reaperWindowCount=0;}
   if((u.reaperWindowCount||0)>=Math.max(0,this.stats(u).blockCnt))return;u.reaperWindowCount=(u.reaperWindowCount||0)+1;
   const at=Math.max(this.s.time,u.nextSelfHealAt||0);u.nextSelfHealAt=at+.12;if(at<=this.s.time)this.heal(u,u,amount);else (u.pendingSelfHeals??=[]).push({at,amount});
  }
 }
 branchAttackScale(u,target){
  const p=this.profile(u),behavior=this.behavior(u),trait=branchTrait(p),bb=trait.values;let scale=1;
  if(behavior.rangedPenalty&&target.block!==u.uid&&!(this.skillActive(u)&&/不再降低|不降低/.test(p.skill?.description||'')))scale*=bb.atk_scale??.8;
  if(behavior.unblockedBonus&&target.block!==u.uid)scale*=bb.atk_scale??1.2;
  if(behavior.frontScale&&this.inNamedRange(u,target,trait.rangeId||'1-3'))scale*=bb.atk_scale??1.5;
  if(behavior.magazine)scale*=bb.atk_scale??1.2;return scale;
 }
 releaseNativeAttack(u,action){
  const p=this.profile(u),behavior=this.behavior(u),trait=branchTrait(p).values,kind=action.kind||behavior.kind;
  if(kind==='heal'){
   if(behavior.style==='heal-chain'){
    let target=this.s.units.find(v=>v.uid===action.targets[0]&&this.canHeal(v,u)),power=action.amount;const visited=new Set(),max=trait['attack@chain.max_target']??3;
    for(let i=0;target&&i<max;i++){visited.add(target.uid);this.heal(u,target,power);const prev=target;target=this.s.units.filter(v=>!visited.has(v.uid)&&this.canHeal(v,u)&&this.inNamedRange({x:prev.x,y:prev.y,dir:0},v,behavior.jumpRange)).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp||b.deployAt-a.deployAt||a.uid-b.uid)[0];power*=trait['attack@chain.atk_scale']??.75;}
   }else for(const id of action.targets){const target=this.s.units.find(v=>v.uid===id);if(!target)continue;this.heal(u,target,action.amount);if(behavior.elementHealing)this.healElements(u,target,action.amount*(trait.ep_heal_ratio??.5));}
   return;
  }
  let released=0;for(const id of action.targets){const target=this.s.enemies.find(e=>e.uid===id&&e.hp>0);if(!target)continue;const ranged=p.position==='RANGED'||(['lord','agent','hookmaster','shotprotector','fortress'].includes(p.branch)&&target.block!==u.uid);
   for(let n=0;n<action.hits;n++){released++;
    const packet={owner:u.uid,target:id,x:u.x,y:u.y,amount:action.amount*this.branchAttackScale(u,target),type:action.type,speed:6,style:behavior.style,radius:behavior.radius||0,antiAir:behavior.antiAir,ownerDeployment:u.deployAt,returning:false,returns:!!behavior.returnProjectile};
    if(ranged){this.s.projectiles.push(packet);if(packet.returns)u.pendingReturns=(u.pendingReturns||0)+1;}else this.impactNativeAttack(u,target,packet);
   }
   if(behavior.storage&&id===action.targets[0])for(let n=0;n<(action.storedEnergy||0);n++){released++;this.s.projectiles.push({owner:u.uid,target:id,x:u.x,y:u.y,amount:action.baseAmount??action.amount,type:'arts',speed:6,style:'single',antiAir:true,ownerDeployment:u.deployAt});}
   if(behavior.drone){u.droneScale=u.droneTarget===target.uid?Math.min(trait.max_atk_scale??1.1,(u.droneScale??.2)+(trait.delta_atk_scale??.15)):(trait.init_atk_scale??.2);u.droneTarget=target.uid;this.s.projectiles.push({owner:u.uid,target:id,x:u.x,y:u.y,amount:action.amount*u.droneScale,type:'arts',speed:6,style:'single',antiAir:true,ownerDeployment:u.deployAt});}
  }return released;
 }
 impactNativeAttack(u,target,packet){
  const p=this.profile(u),trait=branchTrait(p).values,eligible=e=>e.hp>0&&!e.invulnerable&&!permissions(e).sleeping&&(packet.antiAir||!e.flying||e.uid===target.uid);
  if(packet.style==='chain'){
   const visited=new Set();let victim=target,power=packet.amount;const max=trait['attack@max_target']??3;
   for(let i=0;victim&&i<max;i++){visited.add(victim.uid);this.hit(u,victim,power,packet.type);applyStatus(victim,'sluggish',trait['attack@sluggish']??.5,{source:u.uid});const previous=victim;victim=this.s.enemies.filter(e=>eligible(e)&&!visited.has(e.uid)&&Math.hypot(e.x-previous.x,e.y-previous.y)<=1.7).sort((a,b)=>Math.hypot(a.x-previous.x,a.y-previous.y)-Math.hypot(b.x-previous.x,b.y-previous.y)||(b.progress||0)-(a.progress||0))[0];power*=.85;}return;
  }
  const splash=packet.style==='splash'||packet.style==='aftershock'||packet.style==='hammer'||(packet.style==='fortress'&&target.block!==u.uid);
  const victims=splash?this.s.enemies.filter(e=>eligible(e)&&Math.hypot(e.x-target.x,e.y-target.y)<=packet.radius):[target];
  for(const e of victims){const scale=packet.style==='hammer'&&e.uid!==target.uid?(trait['attack@atk_scale_2']??.5):1;this.hit(u,e,packet.amount*scale,packet.type);}
  if(packet.style==='aftershock')for(const e of victims)if(e.hp>0)this.hit(u,e,packet.amount*(trait['attack@append_atk_scale']??.5),packet.type);
 }
 advanceNativeProjectiles(dt){
  const packets=this.s.projectiles;this.s.projectiles=[];for(const packet of packets){const u=this.s.units.find(u=>u.uid===packet.owner);if(!u)continue;
   if(packet.returning){if(!u.deployed||packet.ownerDeployment!==u.deployAt)continue;const dx=u.x-packet.x,dy=u.y-packet.y,d=Math.hypot(dx,dy);if(d<=packet.speed*dt){u.pendingReturns=Math.max(0,(u.pendingReturns||0)-1);continue;}packet.x+=dx/d*packet.speed*dt;packet.y+=dy/d*packet.speed*dt;this.s.projectiles.push(packet);continue;}
   const target=this.s.enemies.find(e=>e.uid===packet.target&&e.hp>0);if(!target){if(packet.returns){packet.returning=true;this.s.projectiles.push(packet);}continue;}
   const dx=target.x-packet.x,dy=target.y-packet.y,d=Math.hypot(dx,dy);if(d<=packet.speed*dt){packet.x=target.x;packet.y=target.y;this.impactNativeAttack(u,target,packet);if(packet.returns){packet.returning=true;this.s.projectiles.push(packet);}}else{packet.x+=dx/d*packet.speed*dt;packet.y+=dy/d*packet.speed*dt;this.s.projectiles.push(packet);}
  }
 }
 params(id){const b=this.data.season.bondInfoDict[id];return blackboard(this.data.season.effectBuffInfoDataDict[b?.effectId]?.find(e=>e.key==='env_gbuff_new')?.blackboard);}
 owns(u,id){const own=this.economy.ownBonds(u.source);return own.includes(id)||(own.includes('maniShip')&&this.data.common.bondInfoDict[id]?.isPower&&this.rows[id]?.active);}
 on(id){return !!this.rows[id]?.active;}
 stats(u){
  const p=this.profile(u),a={...p.attributes},l=this.layers,has=id=>this.on(id)&&this.owns(u,id);let atk=0,hp=0,def=0,as=0;
  if(has('yanShip')){const b=this.params('yanShip');atk+=b.base_atk+b.atk_per_stack*(l.yanShip||0);}
  if(has('egirShip')){const b=this.params('egirShip');hp+=b.base_max_hp+b.max_hp_per_stack*(l.egirShip||0);}
  if(this.on('steadShip')){const b=this.params('steadShip');hp+=b.base_max_hp+b.max_hp_per_stack*(l.steadShip||0);}
  if(this.on('deputShip')){const b=this.params('deputShip');def+=b.base_def+b.def_per_stack*(l.deputShip||0);a.respawnTime*=.7;}
  if(this.on('preciShip')&&(has('preciShip')||(this.rows.preciShip.count>=3&&p.position==='RANGED'))){const b=this.params('preciShip');atk+=b.base_atk+b.atk_per_stack*(l.preciShip||0);}
  if(has('soloShip')){atk+=.6;hp+=.6;}
  if(this.on('suntShip')&&p.isGolden)atk+=.3;
  if(this.on('raidShip')&&(l.raidShip||0)>=50)as+=50;
  if(has('siracusaShip')){const b=this.params('siracusaShip');if(this.s.time-u.deployAt<b.base_duration+b.duration_per_stack*(l.siracusaShip||0))as+=b.base_attack_speed+b.attack_speed_per_stack*(l.siracusaShip||0);}
  if(this.on('skillfulShip')){const radius=(l.skillfulShip||0)>=40?1.42:1.01;if(this.s.units.some(v=>v.deployed&&v.hp>0&&this.owns(v,'skillfulShip')&&Math.hypot(u.x-v.x,u.y-v.y)<radius))as+=10+(l.skillfulShip||0);}
  for(const g of p.garrisons){const b=blackboard(g.blackboard);if(g.battleRuneKey==='char_attribute_mul'){a.atk*=b.atk??1;a.maxHp*=b.max_hp??1;}if(g.battleRuneKey==='env_gbuff_new_with_verify'&&b.bond_id&&b.atk_per_stack)atk+=b.atk_per_stack*(l[b.bond_id]||0);}
  for(const item of u.source.equipment){const record=this.data.season.trapChessDataDict[item.chessId];for(const effect of this.data.season.effectBuffInfoDataDict[record?.effectId]||[]){const b=blackboard(effect.blackboard);if(effect.key==='char_attribute_mul'){a.atk*=b.atk??1;a.maxHp*=b.max_hp??1;a.def*=b.def??1;}else if(effect.key.startsWith('env_gbuff')){atk+=b.atk||0;hp+=b.max_hp||0;def+=b.def||0;as+=b.attack_speed||0;a.magicResistance+=b.magic_resistance||0;}}}
  if(has('victoriaShip')&&this.rows.victoriaShip.count>=6)for(const i of u.source.equipment)atk+=this.data.season.trapChessDataDict[i.chessId].isGolden?.8:.5;
  const band=this.s.band,count=Object.values(this.rows).filter(b=>b.active).length;
  if(band==='band_amiya'&&count>=3){const n=count>=5?.4:count===4?.3:.2;atk+=n;hp+=n;}
  if(band==='band_dusk'&&this.s.units.filter(v=>v.id===u.id).length>1)atk+=.3;
  if(band==='band_ioleta'&&p.isGolden){const n=this.s.units.filter(v=>this.profile(v).isGolden).length*.1;atk+=n;hp+=n;}
  atk+=u.deathBuff||0;atk+=u.deploymentBuff||0;
  if(u.skillLeft>0||u.ammo>0){const b=blackboard(p.skill?.blackboard);atk+=b.atk||0;hp+=b.max_hp||0;def+=b.def||0;as+=b.attack_speed||0;a.baseAttackTime=Math.max(.1,a.baseAttackTime+(b.base_attack_time||0));}
  const branch=branchBehavior(p,this.skillActive(u)),trait=branchTrait(p).values;if(p.branch==='phalanx'&&!this.skillActive(u)){def+=trait.def??2;a.magicResistance+=trait.magic_resistance??20;}if(p.branch==='librator'){atk+=(trait.atk??2)*Math.min(1,Math.floor(u.branchCharge||0)/(trait.max_stack_cnt??40));if(!this.skillActive(u))a.blockCnt=0;}if(branch.blockZeroDuringSkill&&this.skillActive(u))a.blockCnt=0;if(branch.taunt!==undefined)a.tauntLevel=Math.min(a.tauntLevel??0,branch.taunt);const status=statusAttributeChanges(u);a.atk*=1+atk;a.maxHp*=1+hp;a.def*=1+def;a.attackSpeed=Math.max(10,Math.min(600,a.attackSpeed+as+status.attackSpeed));a.magicResistance+=status.resistance;for(const e of this.economy.s.operatorModifiers||[])for(const[k,v]of Object.entries(blackboard(e.blackboard))){const key={max_hp:'maxHp',atk:'atk',def:'def'}[k];if(key)a[key]*=v;}return a;
 }
 range(u,skill=false){const p=this.profile(u),r=skill&&p.skill?.rangeId?this.data.ranges[p.skill.rangeId]:p.range;let grids=r?.grids||[{row:0,col:1}];if(p.branch==='fortress'&&!grids.some(g=>g.row===0&&g.col===0))grids=grids.concat({row:0,col:0});return grids.map(g=>{let x=g.col,y=-g.row;for(let i=0;i<u.dir;i++)[x,y]=[-y,x];return{x:u.x+x,y:u.y+y};});}
 inside(u,e,skill=(u.skillLeft>0||u.ammo>0)){return this.range(u,skill).some(g=>Math.abs(g.x-e.x)<=.7&&Math.abs(g.y-e.y)<=.7);}
 targets(u){const behavior=this.behavior(u);return this.s.enemies.filter(e=>e.hp>0&&!e.invulnerable&&!e.untargetable&&!permissions(e).sleeping&&(e.block===u.uid||((!e.flying||behavior.antiAir)&&(!behavior.airOnlyIdle||this.skillActive(u)||e.flying)&&this.inside(u,e)))).sort((a,b)=>Number(b.block===u.uid)-Number(a.block===u.uid)||(behavior.priority==='air'?Number(b.flying)-Number(a.flying):behavior.priority==='defense'?a.def-b.def:behavior.priority==='weight'?(b.weight||0)-(a.weight||0):0)||(b.progress||0)-(a.progress||0)||a.uid-b.uid);}
 prepareWaves(turn){const plan=nativeWavePlan(this.data,turn,this.economy.s.waveRoster);this.level=plan.level;this.s.queue=plan.queue;this.s.total=plan.total;this.combatScale=plan.scale||{atk:1,hp:1,moveSpeed:1};}
 path(route,flying){
  const to=p=>({x:p.col-this.map.origin.col,y:this.map.origin.row-p.row}),start=to(route.startPosition),end=to(route.endPosition),points=[start,...(route.checkpoints||[]).filter(c=>c.position&&['MOVE','PATROL_MOVE'].includes(c.type)).map(c=>to(c.position)),end];if(flying)return points;
  const result=[start],walk=p=>p.x>=0&&p.y>=0&&p.x<this.map.cols&&p.y<this.map.rows&&this.map.grid[p.y][p.x].passableMask!=='FLY_ONLY'&&this.map.grid[p.y][p.x].passableMask!=='NONE';
  for(let n=1;n<points.length;n++){
   const from=points[n-1],dest=points[n],key=p=>p.x+','+p.y,queue=[from],seen=new Map([[key(from),null]]),cost=new Map([[key(from),0]]),closed=new Set();
   const steps=route.allowDiagonalMove?[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]:[[1,0],[-1,0],[0,1],[0,-1]];
   while(queue.length){queue.sort((a,b)=>cost.get(key(a))-cost.get(key(b)));const p=queue.shift(),pk=key(p);if(closed.has(pk))continue;closed.add(pk);if(pk===key(dest))break;
    for(const [dx,dy]of steps){const q={x:p.x+dx,y:p.y+dy},qk=key(q);if(!walk(q)||closed.has(qk)||(dx&&dy&&(!walk({x:p.x+dx,y:p.y})||!walk({x:p.x,y:p.y+dy}))))continue;const next=cost.get(pk)+Math.hypot(dx,dy);if(next<(cost.get(qk)??Infinity)){cost.set(qk,next);seen.set(qk,p);queue.push(q);}}
   }
   if(!seen.has(key(dest)))throw Error('原始路线不可达：'+key(from)+' → '+key(dest));const segment=[];let p=dest;while(p&&key(p)!==key(from)){segment.unshift(p);p=seen.get(key(p));}result.push(...segment);
  }
  return result;
 }
 spawn(q){const raw=this.level.enemyProfiles[q.id]||this.data.enemies[q.id];if(!raw)throw Error('缺少敌人数据 '+q.id);const a={...raw.attributes};for(const e of this.economy.s.enemyModifiers||[])for(const[k,v]of Object.entries(blackboard(e.blackboard))){const key={max_hp:'maxHp',atk:'atk',def:'def',magic_resistance:'magicResistance'}[k];if(key)a[key]=e.key.endsWith('_mul')?a[key]*v:a[key]+v;}const scale=this.s.benchmark?{atk:1,hp:1,moveSpeed:1}:this.combatScale||{atk:1,hp:1,moveSpeed:1},flying=raw.motion==='FLY'||this.level.routes[q.route].motionMode==='FLY',route=this.path(this.level.routes[q.route],flying),pos=route[0];this.s.enemies.push({uid:this.s.nextId++,id:q.id,name:raw.name,x:pos.x,y:pos.y,hp:a.maxHp*scale.hp,maxHp:a.maxHp*scale.hp,atk:a.atk*scale.atk,weight:a.massLevel??0,def:a.def,res:a.magicResistance,speed:(a.moveSpeed||0)*scale.moveSpeed,interval:a.baseAttackTime||1,attackSpeed:a.attackSpeed||100,regen:a.hpRecoveryPerSec||0,canAttack:raw.applyWay!=='NONE',ranged:raw.applyWay==='RANGED',range:raw.rangeRadius||0,damageType:(raw.description||'').includes('法术')?'arts':'physical',flying,route,segment:0,progress:0,block:null,leak:raw.lifePointReduce??1,statuses:[],immunities:{stun:a.stunImmune,silence:a.silenceImmune,frozen:a.frozenImmune,sleep:a.sleepImmune,levitate:a.levitateImmune},shield:0,attackCooldown:0,action:null});}
 event(u,event){
  const p=this.profile(u);for(const g of p.garrisons){if(g.eventType!=='IN_BATTLE'||g.effectType!=='ADD_BOND')continue;const b=blackboard(g.blackboard),key=b.key||'',match=event==='kill'?/selfkillenemy/.test(key):event==='skill'?/skill/.test(key):event==='deploy'?/born|deploy/.test(key):event==='ammo'?/consume_ammo/.test(key):false;if(!match)continue;const id=g.id+':'+event;u.counters[id]=(u.counters[id]||0)+1;const threshold=b.check_cnt||b.consume_count||1;if(u.counters[id]%threshold)continue;const limit=b.max_cnt||b.max_count||b.max_trigger_count||Infinity;if(u.counters[id]/threshold>limit)continue;const bonds=b.bond_id?String(b.bond_id).split(','):this.economy.ownBonds(u.source);for(const bond of bonds)this.economy.addLayers(bond,b.bond_add_type==='by_charlevel'?p.rank:(b.bond_add_count??1));}
 }
 deploy(u){u.deployed=true;u.branchCharge=0;u.branchSkillActive=false;u.pendingReturns=0;u.energy=0;u.magazine=branchTrait(this.profile(u)).values.value??8;u.pendingSelfHeals=[];u.droneTarget=null;u.droneScale=0;u.reaperWindowStart=-999;u.reaperWindowCount=0;u.nextSelfHealAt=0;u.hp=u.maxHp=this.stats(u).maxHp;u.sp=this.profile(u).skill?.spData.initSp||0;if(this.on('soloShip')&&this.owns(u,'soloShip'))u.sp+=15;u.deployAt=this.s.time;this.event(u,'deploy');if(this.on('kazimierzShip'))for(const v of this.s.units)if(this.owns(v,'kazimierzShip'))v.deploymentBuff=Math.min(.5+.01*(this.layers.kazimierzShip||0),(v.deploymentBuff||0)+.2);}
 activate(u){const p=this.profile(u),sk=p.skill;if(!sk||!permissions(u).skill)return;const b=blackboard(sk.blackboard),cost=this.spCost(u);if(u.sp<cost||(sk.skillType!=='AUTO'&&this.s.time-u.lastSkill<3))return;if(sk.skillType==='AUTO'&&sk.duration===0&&(u.action||u.attackCooldown>0))return;u.sp-=cost;u.lastSkill=this.s.time;u.skillCount++;u.skillLeft=sk.duration<0?1e9:sk.duration;u.ammo=sk.durationType==='AMMO'?(b['attack@trigger_time']||b.ammo||1):0;this.event(u,'skill');if(sk.skillType==='AUTO'&&sk.duration===0&&sk.spData.spType==='INCREASE_WHEN_ATTACK'){u.enhanced=true;return;}if(sk.duration===0&&!u.ammo){const targets=this.targets(u);if(p.branch!=='incantationmedic'&&/回复.*生命|治疗/.test(sk.description||'')){for(const v of this.healingTargets(u))this.heal(u,v,this.stats(u).atk*(b.heal_scale||b.atk_scale||1));}else if(b.atk_scale){for(const e of targets.slice(0,b.max_target||999))this.hit(u,e,this.stats(u).atk*b.atk_scale,this.baseDamageType(u));}if(b.stun)for(const e of targets)applyStatus(e,'stun',b.stun,{source:u.uid});}}
 spCost(u){const p=this.profile(u),base=p.skill?.spData.spCost||0;return this.on('suntShip')&&this.rows.suntShip.count>=5&&p.isGolden?Math.floor(base*.7):base;}
 baseDamageType(u){const p=this.profile(u),description=p.skill?.description||'';if((u.skillLeft>0||u.ammo>0)&&description.includes('真实伤害'))return 'true';if((u.skillLeft>0||u.ammo>0)&&/变为.*法术|造成法术/.test(description))return 'arts';return this.behavior(u).damageType;}
 hit(u,e,amount,type){if(e.hp<=0||e.invulnerable||permissions(e).sleeping)return;const p=this.profile(u),stats=this.stats(u);let penetrationRatio=this.on('preciShip')&&this.rows.preciShip.count>=3&&(this.owns(u,'preciShip')||p.position==='RANGED')?.3:0;const physical=damage({amount,type:'physical',defense:e.def,penetrationRatio}),arts=damage({amount,type:'arts',resistance:Math.max(0,e.res+statusAttributeChanges(e).resistance),penetrationRatio});if(type!=='true'&&(this.s.band==='band_chen'||p.garrisons.some(g=>blackboard(g.blackboard).key==='act1autochess_gar_eff_chaos')))type=physical>=arts?'physical':'arts';let value=type==='physical'?physical:type==='arts'?arts:amount;
  if(this.on('victoriaShip')&&this.owns(u,'victoriaShip')&&u.source.equipment.length)value*=1.25+.008*(this.layers.victoriaShip||0);
  if(this.on('kjeragShip')&&this.owns(u,'kjeragShip'))value*=e.statuses.some(s=>s.kind==='cold'||s.kind==='frozen')?1.35+.01*(this.layers.kjeragShip||0):1.25;
  if(this.on('emptyShip')&&this.owns(u,'emptyShip'))value*=p.isGolden?1.4:1.2;
  if(type==='arts'&&e.artsWeak)value*=1+e.artsWeak.value;
  const result=applyDamage(e,value,{type,sourceId:u.id,sourceUid:u.uid});const healingDamage=result.blocked?0:Math.max(0,value-result.shield);if(p.branch==='incantationmedic'&&healingDamage>0&&u.deployed&&u.hp>0){const target=this.healingTargets(u)[0];if(target)this.heal(u,target,healingDamage*(branchTrait(p).values.scale??.5));}if(!result.blocked&&value>0)this.selfHealAfterDamage(u);if(p.branch==='slower'&&healingDamage>0)applyStatus(e,'sluggish',branchTrait(p).values.sluggish??.8,{source:u.uid});u.damage+=result.total;this.s.damage[u.uid]=(this.s.damage[u.uid]||0)+result.total;this.s.effects.push({x:e.x,y:e.y,text:Math.round(result.total),life:.6,type});
  if(type==='arts'&&this.on('arcaneShip')&&this.owns(u,'arcaneShip'))e.artsWeak={value:this.rows.arcaneShip.count>=3&&e.hp/e.maxHp<.5?.68+.014*(this.layers.arcaneShip||0):.2+.01*(this.layers.arcaneShip||0),until:this.s.time+3};
  if(e.hp<=0){this.s.kills++;this.event(u,'kill'); }
 }
 hurt(u,e){const evade=this.behavior(u).evasion;if(evade&&['physical','arts'].includes(e.damageType)&&this.economy.random()<(branchTrait(this.profile(u)).values.prob??evade)){this.s.effects.push({x:u.x,y:u.y,text:'闪避',life:.5,type:'evade'});return;}let value=damage({amount:e.atk,type:e.damageType,defense:this.stats(u).def,resistance:this.stats(u).magicResistance});if(this.on('emptyShip'))value*=.8;applyDamage(u,value,{type:e.damageType});u.lastDamagedAt=this.s.time;if(this.profile(u).skill?.spData.spType==='INCREASE_WHEN_TAKEN_DAMAGE')u.sp=Math.min(this.spCost(u),u.sp+1);if(u.hp<=0){u.deployed=false;u.action=null;u.skillLeft=0;u.ammo=0;u.down=this.stats(u).respawnTime;if(this.s.band==='band_emperor')u.down*=.5;if(this.s.band==='band_ermengard'&&(this.s.revives||0)<3){this.s.revives=(this.s.revives||0)+1;u.down=0;}if(this.on('indomShip')&&this.profile(u).position==='MELEE'&&this.economy.random()<.18+.004*(this.layers.indomShip||0))u.down=0;if(this.s.band==='band_qalaisa')for(const v of this.s.units)if(v.deployed)v.deathBuff=Math.min(2,(v.deathBuff||0)+.2);if(this.s.band==='band_clementia'&&this.owns(u,'egirShip'))this.economy.addLayers('egirShip',this.profile(u).rank);}}
 step(){
  if(this.s.finished)return;const dt=1/FPS;this.s.frame++;this.s.time=this.s.frame/FPS;while(this.s.queue.length&&this.s.queue[0].at<=this.s.time)this.spawn(this.s.queue.shift());
  for(const e of this.s.enemies){tickStatuses(e,dt);if(e.artsWeak?.until<this.s.time)e.artsWeak=null;}
  for(const u of this.s.units){
   tickStatuses(u,dt);u.skillLeft=Math.max(0,u.skillLeft-dt);
   if(!u.deployed){if(u.hp<=0){u.down=Math.max(0,u.down-dt);if(u.down===0)this.deploy(u);}else if(this.s.time>=u.deployAt)this.deploy(u);continue;}if(u.hp<=0)continue;
   this.updateBranch(u,dt);const p=this.profile(u),skill=p.skill;let stats=this.stats(u),behavior=this.behavior(u);
   if(u.maxHp!==stats.maxHp){u.hp=u.hp/u.maxHp*stats.maxHp;u.maxHp=stats.maxHp;}recoverHP(u,(stats.hpRecoveryPerSec||0)*dt);
   const cost=this.spCost(u),blocking=this.s.enemies.some(e=>e.hp>0&&e.block===u.uid);
   if(skill&&!this.skillActive(u)&&skill.spData.spType==='INCREASE_WITH_TIME'&&(!behavior.spRequiresBlock||blocking))u.sp=Math.min(cost,u.sp+dt*(stats.spRecoveryPerSec??1));
   let targets=this.targets(u),heals=this.healingTargets(u),healer=behavior.kind==='heal';
   const policy=skillPolicy(this.data.common,{id:u.id,profession:p.profession,branch:p.branch},p.skillIndex).skillTriggerType;
   const skillReady=skill?.skillType==='AUTO'?u.sp>=cost&&(healer?heals.length>0:targets.length>0):shouldAutoSkill({policy,ready:u.sp>=cost,deployed:u.deployed,now:this.s.time,lastOperation:u.lastSkill,initialDeployment:u.deployAt,hasTarget:healer?heals.length>0:targets.length>0,hasAnyTarget:this.s.enemies.length>0,hasEnemyInInitialRange:targets.length>0,hasEnemyInSkillRange:this.s.enemies.some(e=>e.hp>0&&this.inside(u,e,true)),wasDamaged:this.s.time-(u.lastDamagedAt??-999)<.1});
   if(skill&&skill.skillType!=='PASSIVE'&&!u.enhanced&&!this.skillActive(u)&&skillReady)this.activate(u);
   stats=this.stats(u);behavior=this.behavior(u);healer=behavior.kind==='heal';u.branchSkillActive=this.skillActive(u);
   targets=this.targets(u);heals=this.healingTargets(u);u.attackCooldown=Math.max(0,u.attackCooldown-1);
   if(u.action&&((u.action.kind==='heal'&&!healer)||(u.action.kind==='damage'&&healer))){u.action=null;u.attackCooldown=0;}
   if(!permissions(u).attack||!behavior.attack||(this.skillActive(u)&&(skill?.description||'').includes('停止攻击'))){u.action=null;continue;}
   if(u.action&&--u.action.left<=0){const action=u.action;u.action=null;
    if(action.kind==='reload')u.magazine=Math.min(branchTrait(p).values.value??8,(u.magazine??0)+1);
    else if(action.kind==='charge')u.energy=Math.min(branchTrait(p).values.times??3,(u.energy||0)+1);
    else{const released=this.releaseNativeAttack(u,action);if(released>0){if(behavior.magazine)u.magazine=Math.max(0,u.magazine-1);if(behavior.storage)u.energy=Math.max(0,(u.energy||0)-(action.storedEnergy||0));}u.lastAttack=this.s.time;if(skill?.spData.spType==='INCREASE_WHEN_ATTACK'&&!this.skillActive(u)&&!action.enhanced)u.sp=Math.min(cost,u.sp+1);if(u.ammo>0){u.ammo--;this.event(u,'ammo');}}
   }
   if(u.action||u.attackCooldown>0||(behavior.returnProjectile&&u.pendingReturns>0))continue;
   const trait=branchTrait(p).values;
   if(behavior.magazine){u.magazine??=trait.value??8;if(u.magazine<=0||(!targets.length&&u.magazine<(trait.value??8))){u.action={kind:'reload',left:Math.max(1,Math.round(p.attributes.baseAttackTime*FPS))};continue;}}
   if(behavior.storage&&!targets.length&&(u.energy||0)<(trait.times??3)){const t=attackTiming(stats.baseAttackTime,stats.attackSpeed);u.attackCooldown=t.frames;u.action={kind:'charge',left:t.windupFrames};continue;}
   const active=this.skillActive(u)||u.enhanced,bb=active?blackboard(skill?.blackboard):{},defaultCount=behavior.style==='all'?this.s.enemies.length:behavior.style==='block-count'?Math.max(1,stats.blockCnt):behavior.targets||1;
   const count=bb.max_target??defaultCount,chosen=(healer?heals:targets).slice(0,count);
   if(chosen.length){const timing=attackTiming(stats.baseAttackTime,stats.attackSpeed);u.attackCooldown=timing.frames;const hits=bb['attack@times']??bb.hit_count??bb.times??behavior.hits??1;u.action={kind:healer?'heal':'damage',left:timing.windupFrames,targets:chosen.map(e=>e.uid),amount:stats.atk*(bb.atk_scale??1),baseAmount:stats.atk,hits:Math.max(1,Math.min(10,hits)),type:this.baseDamageType(u),enhanced:!!u.enhanced,storedEnergy:behavior.storage?(u.energy||0):0};u.enhanced=false;}
  }
  for(const e of this.s.enemies){if(e.hp<=0||e.trainingDummy)continue;const control=permissions(e),alive=this.s.units.filter(u=>u.hp>0&&u.deployed);e.block=null;if(!e.flying&&control.beBlocked){const b=alive.find(u=>permissions(u).block&&Math.hypot(u.x-e.x,u.y-e.y)<.72&&this.s.enemies.filter(v=>v!==e&&v.block===u.uid).length<(this.stats(u).blockCnt||0));if(b)e.block=b.uid;}
   const target=e.block?alive.find(u=>u.uid===e.block):e.ranged?alive.filter(u=>!permissions(u).sleeping&&Math.hypot(u.x-e.x,u.y-e.y)<=e.range).sort((a,b)=>(this.stats(b).tauntLevel||0)-(this.stats(a).tauntLevel||0)||b.deployAt-a.deployAt)[0]:null;e.attackCooldown=Math.max(0,e.attackCooldown-1);
   if(!control.attack)e.action=null;if(e.action&&--e.action.left<=0){const u=alive.find(u=>u.uid===e.action.target);e.action=null;if(u)this.hurt(u,e);}if(target&&e.canAttack&&control.attack&&!e.action&&!e.attackCooldown){const t=attackTiming(e.interval,e.attackSpeed);e.attackCooldown=t.frames;e.action={left:t.windupFrames,target:target.uid};}
   if(!e.block&&!target&&control.move){let move=e.speed*dt*(e.statuses.some(s=>s.kind==='sluggish')?.2:1);while(move>0&&e.segment<e.route.length-1){const next=e.route[e.segment+1],dx=next.x-e.x,dy=next.y-e.y,d=Math.hypot(dx,dy);if(d<=move){e.x=next.x;e.y=next.y;e.segment++;move-=d;}else{e.x+=dx/d*move;e.y+=dy/d*move;move=0;}}e.progress=e.segment;if(e.segment>=e.route.length-1){this.s.leaks+=e.leak;e.hp=0;e.escaped=true;}}
  }
  this.advanceNativeProjectiles(dt);
  this.s.effects=this.s.effects.filter(e=>(e.life-=dt)>0);this.s.enemies=this.s.enemies.filter(e=>e.hp>0);
  if(this.s.benchmark){if(this.s.time>=this.s.limit)this.finish('timeout');}else if((!this.s.queue.length&&!this.s.enemies.length)||this.s.time>=this.s.limit||this.s.leaks>=this.economy.s.hp)this.finish('complete');
 }
 finish(reason='manual'){if(this.s.finished)return;this.s.finished=true;this.s.result=this.s.benchmark?dummySummary(this.s.enemies[0],this.s.time,reason):{kind:'battle',elapsed:this.s.time,kills:this.s.kills,leaks:this.s.leaks+(this.s.time>=this.s.limit?this.s.enemies.reduce((n,e)=>n+e.leak,0):0),units:this.s.units.map(u=>({uid:u.uid,id:u.id,damage:u.damage,healing:u.healing})),totalDamage:Object.values(this.s.damage).reduce((a,b)=>a+b,0)};}
}
