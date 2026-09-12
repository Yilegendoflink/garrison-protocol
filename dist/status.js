// Common status semantics; durations are simulation seconds, never render time.
const CONTROL={stun:['attack','move','block','skill'],frozen:['attack','move','block','skill'],sleep:['attack','move','block','skill'],levitate:['attack','move','block','skill'],disarm:['attack'],root:['move'],silence:[]};
export function applyStatus(target,kind,duration,{source=null,value=1,resistible=true}={}){
 if(!Number.isFinite(duration)||duration<=0||target.hp<=0)return false;if(target.immunities?.[kind])return false;
 if(['sleep','levitate'].includes(kind)&&Object.hasOwn(target,'block'))target.block=null;target.statuses??=[];
 if(kind==='cold'&&target.statuses.some(s=>s.kind==='cold')){target.statuses=target.statuses.filter(s=>s.kind!=='cold');return applyStatus(target,'frozen',duration,{source,value,resistible});}
 const time=duration*(resistible?1-Math.min(1,Math.max(0,target.statusResistance||0)):1),existing=target.statuses.find(s=>s.kind===kind&&s.source===source);
 if(time<=0)return false;if(existing){existing.remaining=Math.max(existing.remaining,time);existing.value=Math.max(existing.value,value);}else target.statuses.push({kind,remaining:time,source,value});return true;
}
export function tickStatuses(target,dt){if(!Number.isFinite(dt)||dt<0)throw Error('Invalid status delta');target.statuses??=[];for(const s of target.statuses)s.remaining-=dt;target.statuses=target.statuses.filter(s=>s.remaining>1e-9);}
export function permissions(target){const denied=new Set();for(const s of target.statuses||[])for(const k of CONTROL[s.kind]||[])denied.add(k);return {beBlocked:!(target.statuses||[]).some(s=>['sleep','levitate'].includes(s.kind)),sleeping:(target.statuses||[]).some(s=>s.kind==='sleep'),attack:!denied.has('attack'),move:!denied.has('move'),block:!denied.has('block'),skill:!denied.has('skill'),silenced:(target.statuses||[]).some(s=>s.kind==='silence')};}
export function statusAttributeChanges(target){const s=target.statuses||[];return {attackSpeed:s.some(s=>s.kind==='cold'||s.kind==='frozen')?-30:0,resistance:s.some(s=>s.kind==='frozen')?-15:0};}
export function abilityEnabled(target,{silenceable=false}={}){return !silenceable||!permissions(target).silenced;}
export function wakeOnHit(target){if(target.wakeOnDamage)target.statuses=(target.statuses||[]).filter(s=>s.kind!=='sleep');}
