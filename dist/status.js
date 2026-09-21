// Common status semantics; durations are simulation seconds, never render time.
const CONTROL={skillLock:['skill'],unableAct:['attack','move','block','skill'],stun:['attack','move','block','skill'],frozen:['attack','move','skill'],sleep:['attack','move','block','skill'],levitate:['attack','move','block','skill'],fear:[],selfFear:[],terror:['attack','move','block','skill'],tremble:['attack','skill'],disarm:['attack'],forcedDisarm:['attack'],cannotRetreat:['retreat'],root:['move'],silence:[]};
export function applyStatus(target,kind,duration,{source=null,value=1,resistible=true,frostSide='ally'}={}){
 if(!Number.isFinite(duration)||duration<=0||target.hp<=0)return false;if(target.immunities?.[kind])return false;if(['fear','selfFear'].includes(kind)&&target.chessId)return false;
 if(['sleep','levitate','fear','selfFear','terror'].includes(kind)&&Object.hasOwn(target,'block'))target.block=null;target.statuses??=[];
 const frost=kind==='cold'||kind==='frozen',sameFrost=s=>(s.frostSide||'ally')===frostSide;
 const time=duration*(resistible?1-Math.min(1,Math.max(0,target.statusResistance||0)):1),existing=target.statuses.find(s=>s.kind===kind&&s.source===source&&(!frost||sameFrost(s)));
 if(time<=0)return false;
 if(['fear','selfFear'].includes(kind)){target.fearRevision=(target.fearRevision||0)+1;target.fearSource=source;}
 // The two frost families never pair with each other. Enemy cold can refresh an existing freeze;
 // allied cold must pair again, keeping the longer already-resisted duration of the pair.
 if(kind==='cold'){
  const cold=target.statuses.find(s=>s.kind==='cold'&&sameFrost(s)),frozen=target.statuses.some(s=>s.kind==='frozen'&&sameFrost(s));
  if(cold&&target.immunities?.frozen){cold.remaining=Math.max(cold.remaining,time);return true;}
  if(!target.immunities?.frozen&&(cold||(frostSide==='enemy'&&frozen))){
   if(cold)target.statuses=target.statuses.filter(s=>s!==cold);
   return applyStatus(target,'frozen',frostSide==='ally'?Math.max(time,cold.remaining):time,{source,value,resistible:false,frostSide});
  }
 }
 if(existing){existing.remaining=Math.max(existing.remaining,time);existing.value=Math.max(existing.value,value);}else target.statuses.push({kind,remaining:time,source,value,...(frost?{frostSide}:{})});if(['invisible','camouflage'].includes(kind))target.invisible=target.formInvisible===true||!target.revealed;if(kind==='fragile')target.fragile=Math.max(target.fragile||1,value);return true;
}
// formInvisible：形态自带的常驻隐匿（例如深池逐火的「怨恨的余烬」），不是可驱散的状态，
// 因此不能被 tickStatuses 按状态表覆盖掉。
// 主动摘掉一条状态（例如忍冬 S3 的迷彩「直至下一次开启技能」，下一次开技时要手动撤销）。
// source 给定时只摘该来源的那一条；摘完重算 `invisible`，避免隐匿残留。
export function removeStatus(target,kind,source){
 if(!target?.statuses)return false;const before=target.statuses.length;
 target.statuses=target.statuses.filter(s=>!(s.kind===kind&&(source===undefined||s.source===source)));
 if(target.statuses.length===before)return false;
 if(['invisible','camouflage'].includes(kind))tickStatuses(target,0);
 return true;
}
export function tickStatuses(target,dt){if(!Number.isFinite(dt)||dt<0)throw Error('Invalid status delta');target.statuses??=[];for(const s of target.statuses)s.remaining-=dt;target.statuses=target.statuses.filter(s=>s.remaining>1e-9);target.invisible=target.formInvisible===true||(target.statuses.some(s=>['invisible','camouflage'].includes(s.kind))&&!target.revealed);target.levitated=target.statuses.some(s=>s.kind==='levitate');target.fragile=target.statuses.filter(s=>s.kind==='fragile').reduce((v,s)=>Math.max(v,s.value||1),1);}
export function permissions(target){const denied=new Set(target.shift?['attack','skill','block']:[]);if(target.type==='neutral-miner'&&target.waiting)denied.add('move');for(const s of target.statuses||[])for(const k of CONTROL[s.kind]||[])denied.add(k);return {beBlocked:!target.shift&&!(target.statuses||[]).some(s=>['sleep','levitate','fear','selfFear'].includes(s.kind)),retreat:!denied.has('retreat'),sleeping:(target.statuses||[]).some(s=>s.kind==='sleep'),attack:!denied.has('attack'),move:!denied.has('move'),block:!denied.has('block'),skill:!denied.has('skill'),silenced:(target.statuses||[]).some(s=>s.kind==='silence')};}
export function statusAttributeChanges(target){const s=target.statuses||[];return {attackSpeed:(-30*new Set(s.filter(s=>s.kind==='cold').map(s=>s.frostSide||'ally')).size)+s.filter(s=>s.kind==='attackSpeedDown'||s.kind==='attackSpeedUp').reduce((n,s)=>n+(s.value||0),0),resistance:s.some(s=>s.kind==='frozen'&&s.frostSide!=='enemy')?-15:0,attack:s.filter(s=>s.kind==='attackDown').reduce((v,x)=>Math.min(v,x.value??0),0),defense:s.filter(s=>s.kind==='defDown').reduce((v,x)=>Math.min(v,x.value??0),0),magicResistance:s.filter(s=>s.kind==='resDown').reduce((v,x)=>Math.min(v,x.value??0),0)};}
export function abilityEnabled(target,{silenceable=false}={}){return !silenceable||!permissions(target).silenced;}
export function isIsolated(target){
 if(!target||target.immunities?.isolated)return false;
 if(target.isolateWhileConcealed&&(target.revealed||target.immunities?.invisible))return false;
 return !!(target.isolated||target.statuses?.some(s=>s.kind==='isolated')||(target.isolateWhileConcealed&&(target.invisible||target.formInvisible)&&target.block==null));
}
export function wakeOnHit(target){if(target.wakeOnDamage)target.statuses=(target.statuses||[]).filter(s=>s.kind!=='sleep');}

export function enemyMovementSpeed(target){const bonus=(target.statuses||[]).filter(s=>s.kind==='chainMoveSpeed').reduce((n,s)=>Math.max(n,Number(s.value)||0),0);return (target.speed+(target.baseSpeed??target.speed)*bonus)*(target.formMoveMultiplier??1);}

export function yinYangAttackScale(source,target){
 const a=source?.yinYang,b=target?.yinYang;if(!['light','dark'].includes(a?.attribute)||!['light','dark'].includes(b?.attribute))return 1;
 const scale=a.attribute===b.attribute?a.sameScale:a.differentScale;return Number.isFinite(scale)&&scale>=0?scale:1;
}
