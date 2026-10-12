// 自选干员专属规则。单向依赖纯工具；所有结算能力由 ctx 注入，绘制不驱动规则。
import {blackboard,DIRECTIONS,nativeAttributes} from './protocol.js';
import {applyStatus,removeStatus,statusAttributeChanges,permissions} from './status.js';
import {damage} from './combat.js';
import {finalBossPlacementArea,finalBossPlacementContains} from './native-final-boss.js';
import {containsTarget} from './targeting.js';

export const CUSTOM_IDS={wisdel:'char_1035_wisdel',chen3:'char_1050_chen3',ascln:'char_4132_ascln',wang:'char_2027_wang',clemnt:'char_4231_clemnt'};
const ids=new Set(Object.values(CUSTOM_IDS));
const id=u=>u?.id||u?.charId;
const own=u=>u.custom??(u.custom={});
const skill=(b,u)=>b.profile(u).skillIndex??u.source?.skillIndex??0;
const bb=(b,u)=>blackboard(b.profile(u).skill?.blackboard);
const talent=(b,u,name)=>blackboard(b.profile(u).activeTalents?.find(t=>t.name===name)?.blackboard);
const live=u=>u&&u.hp>0&&u.deployed!==false;
const valid=e=>e.hp>0&&!e.hidden&&!e.untargetable&&!e.invulnerable&&(!e.invisible||e.revealed||e.block!=null)&&!permissions(e).sleeping;
const distance=(a,c)=>Math.hypot(a.x-c.x,a.y-c.y);
// 沿用最终 Boss 的占地与受击矩形；附属对象也不能进入本体保留格。
const bossReserved=(b,x,y)=>finalBossPlacementContains(finalBossPlacementArea(b.map,b.turn?.finalBoss?.enemyId),x,y);
const targetDistance=(b,target,point)=>{const area=b.hitAreaOf(target);return area?Math.hypot(Math.max(0,area.left-point.x,point.x-area.right),Math.max(0,area.top-point.y,point.y-area.bottom)):distance(target,point);};
const cellsHit=(b,cells,target)=>{const area=b.hitAreaOf(target);return area?cells.some(([x,y])=>b.hitAreaContains(area,{x,y})):containsTarget(cells,target);};
const foes=(b,u,active=true)=>b.s.enemies.filter(e=>valid(e)&&b.inside(u,e,active));
const effect=(b,u,type,extra={})=>{b.s.customEffects??=[];const row={uid:b.s.nextId++,ownerUid:u.uid,ownerGen:u.deployGen,type,...extra};b.s.customEffects.push(row);return row;};
const visual=(b,u,type,p={})=>b.emit('custom-fx',{uid:u.uid,x:u.x,y:u.y,fx:type,...p});
const hit=(b,u,e,amount,type,mode='attack')=>{const previous=own(u).hitMode;own(u).hitMode=mode;try{return b.hit(u,e,amount,type,{skill:mode!=='attack'});}finally{own(u).hitMode=previous;}};
const rawHit=(b,ctx,source,target,amount,type,extra={})=>ctx.dealDamage(b,{source,target,amount,type,cause:'extra',...extra});
const ownerOf=(b,fx)=>b.s.units.find(u=>u.uid===fx.ownerUid&&u.deployGen===fx.ownerGen&&live(u));
export function isCustomOperator(u){return ids.has(id(u));}
export function validCustomBattle(saved){
 const types=new Set(['aftershock','sword','ship','vortex','bomb','follower','wang-dot']);
 if(saved.customEffects!==undefined&&(!Array.isArray(saved.customEffects)||saved.customEffects.length>2000||saved.customEffects.some(f=>!f||!types.has(f.type)||!Number.isSafeInteger(f.uid)||!saved.units.some(u=>u.uid===f.ownerUid&&isCustomOperator(u)))))return false;
 const finiteTree=value=>{if(typeof value==='number')return Number.isFinite(value);if(value&&typeof value==='object')return Object.values(value).every(finiteTree);return true;};
 if(!finiteTree(saved.customEffects))return false;
 for(const u of saved.units||[])if(u.custom!==undefined&&(!u.custom||typeof u.custom!=='object'||Array.isArray(u.custom)||!finiteTree(u.custom)))return false;
 return true;
}

export function customAttackConfig(b,u,config){
 if(!isCustomOperator(u))return config;
 const s=skill(b,u),v=bb(b,u),active=b.skillActive(u)||u.enhanced;
 const out={...config,hits:1,multiTarget:1,atkScale:1,damageType:id(u)===CUSTOM_IDS.chen3?'arts':'physical',stopAttack:false,targetRule:null};
 if(id(u)===CUSTOM_IDS.ascln){out.multiTarget=Infinity;if(s===0&&active){out.hits=2;out.atkScale=Number(v.atk_scale)||1;}}
 if(id(u)===CUSTOM_IDS.chen3&&active){if(s===0)out.hits=2;if(s===1)out.stopAttack=own(u).phase==='slashing';if(s===2){out.hits=3;out.multiTarget=Number(v['attack@max_target'])||3;out.atkScale=Number(v['attack@atk_scale'])||1;}}
 if(id(u)===CUSTOM_IDS.wisdel&&active){if(s===1){const overload=b.s.time-(own(u).startedAt||0)>=Number(b.profile(u).skill.duration)/2;out.hits=overload?4:1;out.multiTarget=overload?1:3;out.atkScale=overload?Number(v['attack@atk_scale_ol'])||1:1;out.targetRule=overload?'random':null;}if(s===2)out.atkScale=Number(v['attack@atk_scale_3'])||1;}
 if(id(u)===CUSTOM_IDS.wang){out.damageType='physical';if(s===2&&active)out.stopAttack=true;}
 if(id(u)===CUSTOM_IDS.clemnt&&active){if(s===0)out.atkScale=Number(v.atk_scale)||1;if(s===1)out.atkScale=Number(v['attack@aoe_atk_scale'])||1;if(s===2){out.atkScale=Number(v['attack@atk_scale'])||1;out.multiTarget=Number(v['attack@max_target'])||3;}}
 return out;
}
export function customStats(b,u,out){
 if(!isCustomOperator(u)||!live(u))return;
 if(id(u)===CUSTOM_IDS.ascln){const t=talent(b,u,'噬光残影');out.attackSpeed+=Number(t.attack_speed)||0;if(DIRECTIONS.some(([x,y])=>b.map.grid[Math.round(u.y)+y]?.[Math.round(u.x)+x]?.heightType==='HIGHLAND'))out.attackSpeed+=Number(t.attack_speed_add)||0;}
 if(id(u)===CUSTOM_IDS.chen3){if(b.profile(u).moduleId&&!b.s.enemies.some(e=>e.hp>0&&e.block===u.uid))out.attackSpeed+=8;if(own(u).buffUntil>b.s.time)out.ratio.atk+=Number(own(u).buffAtk)||0;}
}
export function customDamageReduction(b,u,type,attacker,base){
 if(id(u)!==CUSTOM_IDS.clemnt||!attacker||!['physical','arts'].includes(type))return base;
 const [x,y]=DIRECTIONS[u.dir],front=(Math.round(attacker.x)-Math.round(u.x))*x+(Math.round(attacker.y)-Math.round(u.y))*y>=0||attacker.block===u.uid;
 if(!front)return base;const v=talent(b,u,'习得性防御'),sea=attacker.tags?.includes('seamonster')||attacker.categories?.includes('seamonster')||attacker.prtsRace==='海怪';return Math.max(base,Number(sea?v.damage_resistance_seamonster:v.damage_resistance_normal)||0);
}
export function customDamageAmount(b,u,e,amount,type){
 if(id(u)===CUSTOM_IDS.clemnt&&type==='physical'){const v=talent(b,u,'生死定夺');e.customInitialDef??=e.baseDef??e.def;const def=e.def+(statusAttributeChanges(e).defense||0),prob=def<e.customInitialDef?Number(v.prob_special):Number(v.prob_normal);if(b.economy.random()<prob){visual(b,u,'critical',{targetX:e.x,targetY:e.y});return amount*(Number(v.t1_atk_scale)||1);}}
 return amount;
}
export function customInit(b,ctx){
 b.customCtx=ctx;b.s.customEffects??=[];
 if(b._customInstalled)return;b._customInstalled=true;
 const behavior=b.behavior.bind(b);b.behavior=u=>{const out=behavior(u);if(!isCustomOperator(u))return out;const s=skill(b,u),active=b.skillActive(u);if(id(u)===CUSTOM_IDS.wisdel)return {...out,style:'aftershock',antiAir:active&&s===2,radius:active&&s===2?2.5:u.enhanced&&s===0?1.1:.9};if(id(u)===CUSTOM_IDS.chen3)return {...out,damageType:'arts',attack:own(u).phase!=='slashing',antiAir:own(u).phase==='slashing'};return out;};
 const hurt=b.hurt.bind(b);b.hurt=(u,e,options={})=>{
  if(u.custom?.phase==='slashing')return;
  if((options.cause||'attack')==='attack'&&['physical','arts'].includes(e.damageType)){
   const a=b.s.units.filter(v=>id(v)===CUSTOM_IDS.ascln&&live(v)&&skill(b,v)===2&&b.skillActive(v)&&!e.flying&&b.inside(v,e,true)),prob=a.reduce((n,v)=>Math.max(n,Math.abs(Number(bb(b,v)['attack@damage_hitrate_'+(e.damageType==='physical'?'physical':'magical')])||0)),0);
   if(prob&&b.economy.random()<prob){visual(b,u,'miss');b.customMiss(u,e);return;}
  }
  return hurt(u,e,options);
 };
 b.customMiss=(u,e)=>{if(id(u)===CUSTOM_IDS.chen3&&own(u).evadeReady){own(u).evadeReady=false;u.physicalEvadeOnce=u.artsEvadeOnce=false;}if(id(u)===CUSTOM_IDS.ascln&&skill(b,u)===2&&b.skillActive(u))ctx.applyHeal(b,{source:u,target:u,amount:u.maxHp*(Number(bb(b,u)['attack@hp_ratio'])||0),cause:'skill'});};
 const targets=b.targets.bind(b);b.targets=(u,opts)=>{const out=targets(u,opts);if(id(u)===CUSTOM_IDS.wisdel&&skill(b,u)===2&&b.skillActive(u)){const locked=out.find(e=>e.uid===own(u).lockedUid);if(locked)return [locked,...out.filter(e=>e!==locked)];own(u).lockedUid=out[0]?.uid??null;}return out;};
 const release=b.releaseNativeAttack.bind(b);b.releaseNativeAttack=(u,action)=>{if(id(u)===CUSTOM_IDS.wisdel&&skill(b,u)===1&&b.skillActive(u)&&b.s.time-(own(u).startedAt||0)>=Number(b.profile(u).skill.duration)/2){let n=0;for(let i=0;i<4;i++){const options=targets(u);if(options.length)n+=release(u,{...action,hits:1,targets:[options[Math.floor(b.economy.random()*options.length)].uid]});}return n;}return release(u,action);};
}

function summonShadow(b,u,ctx,initial=0){
 if(b.s.summons.filter(s=>s.ownerUid===u.uid&&s.type==='wisdel-shadow'&&live(s)).length>=3)return null;
 const occupied=new Set([...b.s.units,...b.s.summons].filter(s=>live(s)&&s.occupiesTile!==false).map(s=>Math.round(s.x)+','+Math.round(s.y)));
 const spots=b.range(u,b.skillActive(u)).filter(p=>b.map.grid[p.y]?.[p.x]&&b.map.grid[p.y][p.x].buildableType!=='NONE'&&!b.map.grid[p.y][p.x].obstacle&&!bossReserved(b,p.x,p.y)&&!occupied.has(p.x+','+p.y)).sort((a,c)=>distance(a,u)-distance(c,u)||c.y-a.y||a.x-c.x);
 const spot=spots[0];if(!spot)return null;
 const token=ctx.spawnSummon(b,u,{customControl:true,type:'wisdel-shadow',tokenId:'token_10035_wisdel_wward',name:'魂灵之影',...spot,canBlock:false,canAttack:false,occupiesTile:true,targetable:true,healable:false});
 if(token){own(u).shadowUids??=[];own(u).shadowUids.push(token.uid);token.customSp=initial;token.customNextAt=b.s.time;applyStatus(token,'camouflage',1e9,{source:token.uid});if(Math.abs(u.x-token.x)+Math.abs(u.y-token.y)<=1){applyStatus(u,'camouflage',1e9,{source:token.uid});u.concealWhileBlocked=true;}}
 return token;
}
function addAsclnMark(b,u,e){const v=talent(b,u,'死亡拘审');if(!v.max_stack_cnt)return;e.customAscln??={};const old=e.customAscln[u.uid];e.customAscln[u.uid]={gen:u.deployGen,layers:Math.min(Number(v.max_stack_cnt),((old?.until>b.s.time&&old.gen===u.deployGen)?old.layers:0)+1),until:b.s.time+Number(v.debuff_duration),nextAt:old?.until>b.s.time?old.nextAt:b.s.time+Number(v.interval||1)};}
export function customSkillStart(b,u,ctx){
 if(!isCustomOperator(u))return false;customInit(b,ctx);const v=bb(b,u),s=skill(b,u),c=own(u);c.stockBeforeSkill=c.stock;c.startedAt=b.s.time;c.phase='skill';
 if(s===0&&[CUSTOM_IDS.wisdel,CUSTOM_IDS.ascln,CUSTOM_IDS.clemnt].includes(id(u))){u.enhanced=true;c.enhanced=true;u.skillLeft=0;}
 if(id(u)===CUSTOM_IDS.wisdel&&s===2){for(let i=0;i<Number(v.max_cnt);i++)summonShadow(b,u,ctx,i===0?Number(v.sp)||0:0);}
 if(id(u)===CUSTOM_IDS.chen3){u.weaknessAttacker=true;if(s===1){c.phase='slashing';c.origin={x:u.x,y:u.y};c.chain={remaining:10,nextAt:b.s.time,targetUid:null};u.skillLeft=0;applyStatus(u,'disarm',1e9,{source:'chen-chain-'+u.uid});applyStatus(u,'spBlock',1e9,{source:'chen-chain-'+u.uid});applyStatus(u,'unableAct',1e9,{source:'chen-chain-'+u.uid});c.savedImmunities={stun:!!u.immunities.stun,frozen:!!u.immunities.frozen};u.immunities.stun=u.immunities.frozen=true;u.invulnerable=true;}if(s===2){const [dx,dy]=DIRECTIONS[u.dir];effect(b,u,'sword',{x:u.x,y:u.y,dx,dy,hit:[],travel:0,atk:b.stats(u).atk,endsAt:b.s.time+Number(b.profile(u).skill.duration)});}}
 if(id(u)===CUSTOM_IDS.wang){if(s<2){c.stock=Math.min(c.stockCap,(c.stock||0)+Number(v.cnt));u.skillLeft=0;u.spLock=0;}else{c.stock=Math.min(c.stockCap,(c.stock||0)+Number(v.cnt));u.ammo=u.ammoMax=Number(v.trigger_time);u.ammoExternalConsumption=true;u.skillDisarmUntil=1e9;const extra=Number(v.cnt)-Math.max(0,c.stockCap-(c.stockBeforeSkill??c.stockCap));const candidates=b.range(u,true).filter(p=>!b.s.units.some(a=>live(a)&&a.x===p.x&&a.y===p.y)).sort((a,d)=>Number(!b.s.enemies.some(e=>valid(e)&&Math.round(e.x)===a.x&&Math.round(e.y)===a.y))-Number(!b.s.enemies.some(e=>valid(e)&&Math.round(e.x)===d.x&&Math.round(e.y)===d.y))||a.y-d.y||a.x-d.x);let left=Math.max(0,extra);for(const spot of candidates){if(!left)break;if(makeFollower(b,u,spot,ctx))left--;}}}
 if(id(u)===CUSTOM_IDS.clemnt){if(s===1){const [dx,dy]=DIRECTIONS[u.dir];effect(b,u,'ship',{x:u.x,y:u.y,dx,dy,travel:0,passengers:[],weight:Number(v['attack@max_passenger_mass']),endsAt:b.s.time+10,nextAt:b.s.time+.1});u.skillDisarmUntil=b.s.time+10;u.action=null;}if(s===2)u.ammoExternalConsumption=true;}
 visual(b,u,'skill-start',{skill:s+1});return true;
}

export function customEvent(b,type,payload,ctx){
 const {source,target}=payload;if(!b.s.units.some(isCustomOperator))return;customInit(b,ctx);
 if(type==='deploy'&&isCustomOperator(target)){target.custom={};const c=own(target);c.gen=target.deployGen;if(id(target)===CUSTOM_IDS.wisdel)summonShadow(b,target,ctx);if(id(target)===CUSTOM_IDS.chen3){target.weaknessAttacker=true;c.healAt=b.s.time+Number(talent(b,target,'寒暑觉知').stack_time||7);}if(id(target)===CUSTOM_IDS.wang){const v=talent(b,target,'铸子'),token=b.data.tokens.token_10064_wang_stone1,a=nativeAttributes(token,b.profile(target).status).attributes;c.stock=Number(v.cnt);c.stockCap=a.maxDeckStackCnt;c.deployCap=a.maxDeployCount+(b.profile(target).moduleId?1:0);c.followCap=Number(v['attack@max_spawn_cnt']);c.stoneNextAt=0;}}
 if(type==='after-damage'&&isCustomOperator(source)&&b.s.enemies.includes(target)&&payload.result?.total>0){
  const c=own(source),v=bb(b,source),s=isCustomOperator(source)?skill(b,source):0;
  if(id(source)===CUSTOM_IDS.ascln&&['attack','skill'].includes(payload.cause)&&c.hitMode!=='dot')addAsclnMark(b,source,target);
  if(id(source)===CUSTOM_IDS.chen3&&s===0&&b.skillActive(source))applyStatus(target,'silence',Math.max(.01,source.skillLeft),{source:'chen-s1-'+source.uid});
  if(id(source)===CUSTOM_IDS.clemnt&&c.hitMode==='attack'&&['attack','skill'].includes(payload.cause)){const ratio=s===0&&c.hitEnhanced?Number(v.ep_damage_ratio):s===2&&b.skillActive(source)?Number(v['attack@ep_damage_ratio']):0;if(ratio)ctx.applyElementDamage(b,{source,target,amount:payload.result.total*ratio,type:'corrosion',cause:'skill'});}
 }
 if(type==='after-damage'&&id(target)===CUSTOM_IDS.chen3&&payload.result?.total>0)own(target).healAt=b.s.time+Number(talent(b,target,'寒暑觉知').stack_time||7);
 if(type==='enemy-death'&&b.s.enemies.includes(target))for(const u of b.s.units.filter(u=>id(u)===CUSTOM_IDS.ascln&&live(u)&&skill(b,u)===1&&b.skillActive(u)&&!target.flying&&b.inside(u,target,true))){const v=bb(b,u);for(const e of b.s.enemies.filter(e=>valid(e)&&!e.flying&&distance(e,target)<=Number(v.range_radius)))addAsclnMark(b,u,e);visual(b,u,'ascln-spread',{x:target.x,y:target.y,radius:Number(v.range_radius)});}
 if(type==='element-burst'){target.customInitialDef??=target.baseDef??target.def;if(payload.element==='corrosion'&&!target.flying)for(const u of b.s.units.filter(u=>id(u)===CUSTOM_IDS.clemnt&&live(u)&&skill(b,u)===2&&b.skillActive(u))){own(u).bombMarks??=[];own(u).bombMarks.push({targetUid:target.uid,x:Math.round(target.x),y:Math.round(target.y),until:b.s.time+Number(bb(b,u).ep_break_duration||1)});}}
 if(type==='skill-end'&&isCustomOperator(target)){const c=own(target);c.phase='idle';if(id(target)===CUSTOM_IDS.chen3){for(const e of b.s.enemies)removeStatus(e,'silence','chen-s1-'+target.uid);}if(id(target)===CUSTOM_IDS.wang&&skill(b,target)===2){c.stock=Math.min(c.stockCap,c.stock+(c.unspentAmmo??0));c.unspentAmmo=0;target.ammoExternalConsumption=false;}if(id(target)===CUSTOM_IDS.clemnt)target.ammoExternalConsumption=false;}
}

export function customImpact(b,u,target,p,ctx){
 if(!isCustomOperator(u))return false;const v=bb(b,u),s=skill(b,u),c=own(u);c.hitMode='attack';c.hitEnhanced=!!p.customEnhanced;
 if(id(u)===CUSTOM_IDS.wisdel){const t=talent(b,u,'好礼'),s1=s===0&&p.customEnhanced,radius=s1?1.1:p.radius||.9;target.customResidues??={};target.customResidues[u.uid]=u.deployGen;const victims=b.s.enemies.filter(e=>valid(e)&&(p.antiAir||!e.flying)&&targetDistance(b,e,target)<=radius);for(const e of victims)hit(b,u,e,p.amount*(e.uid===target.uid?Number(t['attack@main_atk_scale'])||1:1),p.type,'attack');const third=b.profile(u).modulePhase?.parts.some(part=>part.overrideTraitDataBundle?.candidates?.some(a=>blackboard(a.blackboard)['attack@enable_third_attack']));const count=1+(third?1:0)+(s1?2:0),scale=s1?Number(v.append_atk_scale):.5;for(let i=0;i<count;i++)effect(b,u,'aftershock',{x:target.x,y:target.y,radius,amount:p.amount*scale,typeOfDamage:p.type,antiAir:p.antiAir,mainUid:target.uid,nextAt:b.s.time+(i+1)*2/30,prob:s===2&&b.skillActive(u)?Number(v['attack@prob']):Number(t['attack@prob']),talent:t,stun:s1?Number(v.stun_duration):0});if(s1)for(const e of victims)applyStatus(e,'stun',Number(v.stun_duration),{source:u.uid});visual(b,u,'impact',{targetX:target.x,targetY:target.y,radius});}
 else if(id(u)===CUSTOM_IDS.clemnt&&s===1&&p.skill){hit(b,u,target,p.amount,'physical');for(const e of b.s.enemies.filter(e=>valid(e)&&!e.flying&&e!==target&&targetDistance(b,e,target)<=1.1).slice(0,Number(v['attack@max_target'])-1))hit(b,u,e,p.baseAmount,'physical');}
 else hit(b,u,target,p.amount,p.type,'attack');
 if(id(u)!==CUSTOM_IDS.wisdel)visual(b,u,'custom-strike',{targetX:target.x,targetY:target.y,skill:s+1});
 c.hitEnhanced=false;if(p.customEnhanced)c.enhanced=false;
 return true;
}

function makeFollower(b,u,spot,ctx){const c=own(u),existing=b.s.customEffects.filter(f=>f.type==='follower'&&f.ownerUid===u.uid);if(existing.length>=c.followCap||existing.some(f=>f.x===spot.x&&f.y===spot.y))return null;if(!b.map.grid[spot.y]?.[spot.x]||bossReserved(b,spot.x,spot.y)||b.map.grid[spot.y][spot.x].heightType==='HIGHLAND'&&b.map.grid[spot.y][spot.x].buildableType==='NONE'||[...b.s.units,...b.s.summons].some(a=>live(a)&&a.occupiesTile!==false&&Math.round(a.x)===spot.x&&Math.round(a.y)===spot.y))return null;return effect(b,u,'follower',{...spot,dirs:[],skillIndex:skill(b,u)});}
const wangStoneCost=(b,u)=>Math.max(0,Number(b.data.tokens.token_10064_wang_stone1.phases[2].attributesKeyFrames[0].data.cost)-(b.profile(u).moduleId?1:0));
export function canPlaceWangStone(b,u,x,y){
 if(!live(u)||id(u)!==CUSTOM_IDS.wang||!u.custom||!Number.isInteger(x)||!Number.isInteger(y)||b.s.time<u.custom.stoneNextAt)return false;
 const c=u.custom,tile=b.map.grid[y]?.[x],active=skill(b,u)===2&&b.skillActive(u)&&b.inside(u,{x,y},true),tokens=b.s.summons.filter(t=>t.ownerUid===u.uid&&t.type==='wang-stone'&&live(t));
 return !!tile&&tile.buildableType!=='NONE'&&!tile.obstacle&&!bossReserved(b,x,y)&&c.stock>0&&tokens.length<c.deployCap&&b.s.cost>=wangStoneCost(b,u)&&!b.s.units.some(v=>live(v)&&Math.round(v.x)===x&&Math.round(v.y)===y)&&!b.s.summons.some(t=>live(t)&&t.occupiesTile!==false&&t.x===x&&t.y===y)&&(active||!b.s.enemies.some(e=>e.hp>0&&!e.hidden&&!e.flying&&!e.levitated&&Math.round(e.x)===x&&Math.round(e.y)===y));
}
export function placeWangStone(b,u,x,y,ctx=b.customCtx){
 if(!canPlaceWangStone(b,u,x,y))return false;const c=own(u),active=skill(b,u)===2&&b.skillActive(u)&&b.inside(u,{x,y},true),cost=wangStoneCost(b,u);if(cost&&!b.spendCost(cost))return false;
 const token=ctx.spawnSummon(b,u,{customControl:true,type:'wang-stone',tokenId:'token_10064_wang_stone1',name:'棋子',x,y,canBlock:false,canAttack:false,occupiesTile:true,targetable:false,healable:false,device:true});if(!token){if(cost)b.gainCost(cost);return false;}token.customDirs=[];token.customSkill=skill(b,u);c.stock--;c.stoneNextAt=b.s.time+Number(b.data.tokens.token_10064_wang_stone1.phases[2].attributesKeyFrames[0].data.respawnTime);b.s.customEffects=b.s.customEffects.filter(f=>!(f.type==='follower'&&f.x===x&&f.y===y));
 const candidates=DIRECTIONS.map(([dx,dy],i)=>({x:x+dx,y:y+dy,i})).filter(p=>b.map.grid[p.y]?.[p.x]&&!b.s.units.some(v=>live(v)&&v.x===p.x&&v.y===p.y)).sort((a,d)=>{const enemy=p=>b.s.enemies.some(e=>valid(e)&&Math.round(e.x)===p.x&&Math.round(e.y)===p.y)?0:1,terrain=p=>{const t=b.map.grid[p.y][p.x];return t.heightType==='HIGHLAND'?2:t.buildableType==='NONE'?0:1;};return enemy(a)-enemy(d)||terrain(a)-terrain(d)||[1,2,3,0][a.i]-[1,2,3,0][d.i];});let count=active?Math.min(3,u.ammo):1;for(const spot of candidates){if(!count)break;const f=makeFollower(b,u,spot,ctx);if(f){count--;if(active)u.ammo--;}}
 visual(b,u,'stone-place',{targetX:x,targetY:y});return true;
}
function tickStones(b,u,ctx){
 const c=own(u),v=bb(b,u),s=skill(b,u),t=talent(b,u,'料敌机先');const nodes=[...b.s.summons.filter(n=>n.type==='wang-stone'&&n.ownerUid===u.uid&&live(n)),...b.s.customEffects.filter(f=>f.type==='follower'&&f.ownerUid===u.uid)];
 for(const n of nodes){n.customDirs??=n.dirs||[];for(const other of nodes)if(other!==n&&Math.abs(n.x-other.x)+Math.abs(n.y-other.y)===1){const axis=n.x===other.x?'y':'x';if(!n.customDirs.includes(axis))n.customDirs.push(axis);}if(!n.customDirs.length)continue;const targets=b.s.enemies.filter(e=>valid(e)&&(s===2?cellsHit(b,b.data.ranges['x-1'].grids.map(g=>[n.x+g.col,n.y-g.row]),e):cellsHit(b,[[n.x,n.y]],e)));if(!targets.length)continue;
  let layers=0;for(const axis of n.customDirs){let count=1;for(const sign of [-1,1])for(let k=1;k<=nodes.length;k++){const other=nodes.find(o=>o.x===n.x+(axis==='x'?sign*k:0)&&o.y===n.y+(axis==='y'?sign*k:0));if(!other)break;count++;}layers=Math.max(layers,Math.min(Number(t['attack@max_trigger_cnt'])||3,count));}
  const atk=b.stats(u).atk,scale=Number(v['attack@atk_scale']??v.atk_scale)||1,boost=1+layers*(Number(t['attack@per_atk_scale'])||0),pierce=layers*(Number(t['attack@per_magic_resist_penetrate_fixed'])||0);
  if(s===0){for(const e of targets){applyStatus(e,'sluggish',Number(v['attack@sluggish']),{source:u.uid});effect(b,u,'wang-dot',{targetUid:e.uid,amount:atk*scale*boost,pierce,nextAt:b.s.time+1,endsAt:b.s.time+Number(v['attack@sluggish'])});}}
  else{const victims=s===2?targets:b.s.enemies.filter(e=>valid(e)&&n.customDirs.some(axis=>axis==='x'?Math.round(e.y)===n.y&&Math.abs(Math.round(e.x)-n.x)<=3:Math.round(e.x)===n.x&&Math.abs(Math.round(e.y)-n.y)<=3));for(const e of victims){const source=n.type==='follower'?u:n;ctx.dealDamage(b,{source,target:e,value:damage({amount:atk*scale*boost,type:'arts',resistance:Math.max(0,e.res+(statusAttributeChanges(e).magicResistance||0)-pierce)}),type:'arts',cause:'skill'});if(s===1){e.customWangSlows??=[];e.customWangSlows.push({ratio:1+Number(v['attack@move_speed']),until:b.s.time+Number(v['attack@duration'])});}}}
  if(n.kind==='summon')ctx.exit(b,{target:n,reason:'consumed'});else n.dead=true;visual(b,u,'stone-trigger',{targetX:n.x,targetY:n.y,dirs:n.customDirs,skill:s+1});
 }
 if(c.stock>=c.stockCap)applyStatus(u,'spBlock',.1,{source:'wang-stock'});else removeStatus(u,'spBlock','wang-stock');c.unspentAmmo=u.ammo||0;if(skill(b,u)===2&&b.skillActive(u)&&(u.ammo<=0||c.stock<=0))b.deactivate(u,{force:true});
}

export function customTick(b,dt,ctx){
 if(!b.s.units.some(isCustomOperator))return;customInit(b,ctx);const now=b.s.time;
 for(const e of b.s.enemies){e.customInitialDef??=e.baseDef??e.def;e.customMoveScale=1;for(const [uid,mark]of Object.entries(e.customAscln||{})){const u=b.s.units.find(u=>u.uid===Number(uid)&&live(u)&&u.deployGen===mark.gen);if(!u||mark.until<=now){delete e.customAscln[uid];continue;}const v=talent(b,u,'死亡拘审');e.customMoveScale=Math.min(e.customMoveScale,1+Number(v.move_speed)*mark.layers);while(mark.nextAt<=now+1e-9&&mark.nextAt<=mark.until){mark.nextAt+=Number(v.interval||1);rawHit(b,ctx,u,e,b.stats(u).atk*Number(v.atk_ratio)*mark.layers,'arts',{cause:'dot'});}}
  e.customWangSlows=(e.customWangSlows||[]).filter(s=>s.until>now);for(const slow of e.customWangSlows)e.customMoveScale*=slow.ratio;
 }
 for(const u of b.s.units.filter(isCustomOperator)){const c=own(u);if(!live(u)){for(const e of b.s.enemies){if(e.customResidues)delete e.customResidues[u.uid];if(e.customAscln)delete e.customAscln[u.uid];}continue;}const v=bb(b,u),s=skill(b,u);
  if(id(u)===CUSTOM_IDS.ascln)for(const e of foes(b,u,b.skillActive(u))){if(b.profile(u).moduleId?.includes('_002_'))e.customMoveScale*=.8;if(s===1&&b.skillActive(u))e.customMoveScale*=1+Number(v.move_speed);}
  if(id(u)===CUSTOM_IDS.chen3){const t=talent(b,u,'寒暑觉知');if(c.phase==='slashing')tickChenChain(b,u,ctx);else if(now>=Number(c.healAt)){c.healAt=now+Number(t.stack_time);const min=Number(t.heal_atk_scale_min),max=Number(t.heal_atk_scale_max);ctx.applyHeal(b,{source:u,target:u,amount:b.stats(u).atk*(min+Math.floor(b.economy.random()*(max-min)))/100,cause:'talent'});c.evadeReady=true;u.physicalEvadeOnce=u.artsEvadeOnce=true;}}
  if(id(u)===CUSTOM_IDS.wisdel){for(const uid of c.shadowUids||[])if(!b.s.summons.some(n=>n.uid===uid&&live(n)))removeStatus(u,'camouflage',uid);u.concealWhileBlocked=u.statuses.some(a=>a.kind==='camouflage'&&c.shadowUids?.includes(a.source));}
  if(id(u)===CUSTOM_IDS.wisdel)for(const shadow of b.s.summons.filter(n=>n.type==='wisdel-shadow'&&n.ownerUid===u.uid&&live(n))){const tokenSkill=b.data.customTokenSkills.sktok_wisdel_wward.levels[b.profile(u).status.skillLevel-1],tokenBB=blackboard(tokenSkill.blackboard),cost=Number(tokenSkill.spData.spCost);if(permissions(shadow).skill)shadow.customSp+=dt;if(shadow.customSp>=cost&&permissions(shadow).skill){const list=foes(b,u,b.skillActive(u)).filter(e=>!e.flying).sort((a,d)=>Number(a.customResidues?.[u.uid]!=null)-Number(d.customResidues?.[u.uid]!=null)||a.uid-d.uid),e=list[0];if(e){shadow.customSp-=cost;rawHit(b,ctx,shadow,e,shadow.atk,'arts',{cause:'skill'});applyStatus(e,'sluggish',Number(tokenBB.sluggish),{source:shadow.uid});e.customResidues??={};e.customResidues[u.uid]=u.deployGen;shadow.customSp+=Number(tokenBB.sp_min)+Math.floor(b.economy.random()*(Number(tokenBB.sp_max)-Number(tokenBB.sp_min)));visual(b,u,'shadow-hit',{targetX:e.x,targetY:e.y});}}}
  if(id(u)===CUSTOM_IDS.wang)tickStones(b,u,ctx);
  if(id(u)===CUSTOM_IDS.clemnt&&s===2&&u.ammo>0){c.bombMarks=(c.bombMarks||[]).filter(m=>m.until>now&&b.s.enemies.some(e=>e.uid===m.targetUid&&valid(e)));const marks=c.bombMarks.filter(m=>!b.s.customEffects.some(f=>f.type==='bomb'&&!f.dead&&f.x===m.x&&f.y===m.y)).sort((a,d)=>distance(a,u)-distance(d,u));if(marks.length){const m=marks[0];effect(b,u,'bomb',{x:m.x,y:m.y,atk:b.stats(u).atk,pulse:0,nextAt:now+1,endsAt:now+Number(v.projectile_life_time),physical:Number(v.s3_atk_scale),element:Number(v.ep_damage_scale)});c.bombMarks=c.bombMarks.filter(a=>a.x!==m.x||a.y!==m.y);u.ammo--;visual(b,u,'bomb-launch',{targetX:m.x,targetY:m.y});if(!u.ammo)b.deactivate(u,{force:true});}}
 }
 for(const f of b.s.customEffects.slice()){const u=ownerOf(b,f);if(!u){releasePassengers(b,f);f.dead=true;continue;}if(f.endsAt!=null&&now>f.endsAt){releasePassengers(b,f);f.dead=true;continue;}if(f.type==='follower'&&[...b.s.units,...b.s.summons].some(a=>live(a)&&a.occupiesTile!==false&&Math.round(a.x)===f.x&&Math.round(a.y)===f.y)){f.dead=true;continue;}tickCustomEffect(b,u,f,dt,ctx);}
 b.s.customEffects=b.s.customEffects.filter(f=>!f.dead);
}

function tickChenChain(b,u,ctx){const c=own(u),chain=c.chain,v=bb(b,u);while(chain&&chain.nextAt<=b.s.time+1e-9&&chain.remaining>0){let e=b.s.enemies.find(e=>e.uid===chain.targetUid&&valid(e));if(!e){const near=chain.last?b.s.enemies.filter(e=>valid(e)&&distance(e,chain.last)<=1.7):[];const list=near.length?near:foes(b,u,true);e=list.sort((a,d)=>distance(a,chain.last||u)-distance(d,chain.last||u)||a.uid-d.uid)[0];}if(!e){chain.remaining=0;break;}chain.targetUid=e.uid;chain.last={x:e.x,y:e.y};hit(b,u,e,b.stats(u).atk*Number(v.atk_scale),'arts','chain');chain.remaining--;if(e.hp<=0)chain.remaining++;chain.nextAt+=.4;visual(b,u,'chen-slash',{targetX:e.x,targetY:e.y,left:chain.remaining});}
 if(chain?.remaining>0)return;const e=b.s.enemies.find(e=>e.uid===chain?.targetUid&&valid(e)),spot=e&&!bossReserved(b,Math.round(e.x),Math.round(e.y))&&ctx.canRelocateTo(b,u,Math.round(e.x),Math.round(e.y))?{x:Math.round(e.x),y:Math.round(e.y)}:c.origin,ratio=u.hp/u.maxHp,evade=!!c.evadeReady;u.invulnerable=false;Object.assign(u.immunities,c.savedImmunities||{});u.statuses=[];u.buffs=[];ctx.teleportActor(b,u,{...spot,source:u,mode:'chen-special'});u.source.position={x:Math.round(u.x),y:Math.round(u.y)};b.deploy(u);u.sp=0;u.hp=u.maxHp*ratio;const state=own(u);state.phase='buff';state.chain=null;state.buffUntil=b.s.time+Number(b.profile(u).skill.duration);state.buffAtk=Number(v['chen3_s2[respawn_buff].atk']);state.buffEvade=Number(v['chen3_s2[respawn_buff].prob']);u.physicalEvadeUntil=u.artsEvadeUntil=state.buffUntil;u.physicalEvadeProb=u.artsEvadeProb=state.buffEvade;u.skillLeft=Number(b.profile(u).skill.duration);state.evadeReady=evade;u.physicalEvadeOnce=u.artsEvadeOnce=evade;visual(b,u,'chen-arrive');}

function tickCustomEffect(b,u,f,dt,ctx){const v=bb(b,u),now=b.s.time;
 if(f.type==='aftershock'&&now>=f.nextAt){f.dead=true;for(const e of b.s.enemies.filter(e=>valid(e)&&(f.antiAir||!e.flying)&&targetDistance(b,e,f)<=f.radius)){hit(b,u,e,f.amount*(e.uid===f.mainUid?Number(f.talent['attack@main_atk_scale'])||1:1),f.typeOfDamage,'aftershock');if(f.stun)applyStatus(e,'stun',f.stun,{source:u.uid});if(e.customResidues?.[u.uid]===u.deployGen&&b.economy.random()<f.prob){delete e.customResidues[u.uid];for(const victim of b.s.enemies.filter(a=>valid(a)&&targetDistance(b,a,e)<=Number(f.talent['attack@range_radius']))){rawHit(b,ctx,u,victim,b.stats(u).atk*Number(f.talent['attack@bomb_atk_scale']),'physical');applyStatus(victim,'stun',Number(f.talent['attack@stun']),{source:u.uid});}visual(b,u,'residue-explode',{targetX:e.x,targetY:e.y});}}visual(b,u,'aftershock',{targetX:f.x,targetY:f.y,radius:f.radius});}
 if(f.type==='wang-dot'){const e=b.s.enemies.find(e=>e.uid===f.targetUid&&e.hp>0&&!e.hidden);if(!e){f.dead=true;return;}while(f.nextAt<=now+1e-9&&f.nextAt<=f.endsAt){f.nextAt++;ctx.dealDamage(b,{source:null,creditUid:u.uid,target:e,value:damage({amount:f.amount,type:'arts',resistance:Math.max(0,e.res+(statusAttributeChanges(e).magicResistance||0)-f.pierce)}),type:'arts',cause:'dot'});}}
 if(f.type==='sword'){const step=1.5*dt,nx=f.x+f.dx*step,ny=f.y+f.dy*step,tile=b.map.grid[Math.round(ny)]?.[Math.round(nx)];if(!tile||tile.heightType==='HIGHLAND'||tile.tileKey==='tile_end'||tile.tileKey==='tile_start'){[f.dx,f.dy]=[-f.dy,f.dx];f.hit=[];}else{f.x=nx;f.y=ny;}f.travel+=step;for(const e of b.s.enemies.filter(e=>valid(e)&&targetDistance(b,e,f)<=1.3&&!f.hit.includes(e.uid))){f.hit.push(e.uid);hit(b,u,e,Math.max(e.hp*Number(v.hp_ratio),f.atk*Number(v.projectile_min_atk_scale)),'arts','sword');}}
 if(f.type==='ship'){const step=Math.min(2*dt,3-f.travel),nx=f.x+f.dx*step,ny=f.y+f.dy*step,tile=b.map.grid[Math.round(ny)]?.[Math.round(nx)];if(f.travel>=3||!tile||tile.obstacle||tile.heightType==='HIGHLAND'||tile.passableMask==='FLY_ONLY'){f.type='vortex';f.nextAt=now+1;f.endsAt=own(u).startedAt+Number(b.profile(u).skill.duration);u.skillDisarmUntil=null;for(const uid of f.passengers){const e=b.s.enemies.find(e=>e.uid===uid);if(e){e.invulnerable=false;removeStatus(e,'unableAct','clemnt-ship-'+f.uid);e.unblockable=e.baseUnblockable||false;}}return;}f.x=nx;f.y=ny;f.travel+=step;for(const e of b.s.enemies.filter(e=>valid(e)&&!e.flying&&!e.formHold&&!e.statuses?.some(s=>s.kind==='selfBound')&&!e.immunities?.exile&&!e.immunities?.teleport&&!e.immuneClemntBlink&&!e.immuneShuBlink&&!e.immuneYuBlink&&Math.abs(e.x-f.x)<=.55&&Math.abs(e.y-f.y)<=.55&&!f.passengers.includes(e.uid))){const weight=Number(e.weight)||0;if(weight>f.weight||f.passengers.length>=Number(v['attack@max_passenger_cnt']))continue;f.weight-=weight;f.passengers.push(e.uid);e.invulnerable=true;e.unblockable=true;e.block=null;applyStatus(e,'unableAct',10,{source:'clemnt-ship-'+f.uid});}for(const uid of f.passengers){const e=b.s.enemies.find(e=>e.uid===uid&&e.hp>0);if(e)ctx.teleportActor(b,e,{x:f.x,y:f.y,source:u,mode:'exile',allowOccupied:true,exactCoordinates:true});}}
 if(f.type==='vortex')for(const e of b.s.enemies.filter(e=>valid(e)&&targetDistance(b,e,f)<=1.5))e.customMoveScale*=1+Number(v['attack@move_speed']);
 if(f.type==='vortex')while(f.nextAt<=now+1e-9&&f.nextAt<=f.endsAt){f.nextAt++;for(const e of b.s.enemies.filter(e=>valid(e)&&targetDistance(b,e,f)<=1.5)){rawHit(b,ctx,u,e,b.stats(u).atk*Number(v['attack@physical_atk_scale']),'physical',{cause:'dot'});ctx.applyElementDamage(b,{source:u,target:e,amount:Number(v['attack@water_element']),type:'corrosion',cause:'skill'});}}
 if(f.type==='bomb')while(f.pulse<3&&f.nextAt<=now+1e-9){f.nextAt++;f.pulse++;for(const e of b.s.enemies.filter(e=>valid(e)&&!e.flying&&cellsHit(b,[[f.x,f.y],[f.x+1,f.y],[f.x-1,f.y],[f.x,f.y+1],[f.x,f.y-1]],e))){rawHit(b,ctx,u,e,f.atk*f.physical,'physical');rawHit(b,ctx,u,e,f.atk*f.element,'elemental');}visual(b,u,'bomb-hit',{targetX:f.x,targetY:f.y,pulse:f.pulse});}
}

function releasePassengers(b,f){for(const uid of f.passengers||[]){const e=b.s.enemies.find(e=>e.uid===uid);if(!e)continue;e.invulnerable=false;e.unblockable=e.baseUnblockable||false;removeStatus(e,'unableAct','clemnt-ship-'+f.uid);}}
