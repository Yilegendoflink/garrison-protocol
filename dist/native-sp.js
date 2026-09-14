export function spTypeOf(skill){
 const t=skill?.spData?.spType;
 if(t===8||t==='8'||t==='PASSIVE')return 'PASSIVE';
 return t||null;
}
export function usesSp(skill){
 return !!(skill?.spData&&spTypeOf(skill)!=='PASSIVE'&&(skill.spData.spCost||0)>0);
}
export function skillKind(skill){
 if(!skill||!usesSp(skill))return null;
 if(skill.durationType==='AMMO')return 'ammo';
 if((skill.duration||0)>0||skill.duration<0)return 'duration';
 return 'instant';
}
export function ammoCount(skill){
 const b=Object.fromEntries((skill?.blackboard||[]).map(x=>[x.key,x.valueStr??x.value]));
 const n=Number(b['attack@trigger_time']??b.ammo??b['attack@s2.trigger_time']);
 return Math.max(1,Math.trunc(Number.isFinite(n)?n:1));
}
export function spIncrement(skill){
 const n=skill?.spData?.increment;
 return Number.isFinite(n)?Math.trunc(n):1;
}
export function initSpOf(skill){return skill?.spData?.initSp||0;}
export function spCap(skill,cost){
 if(!usesSp(skill))return 0;
 return (cost??(skill.spData.spCost||0))*Math.max(1,skill.spData.maxChargeTime||1);
}
export function spBlocked(u){return !!(u.skillLeft>0||u.ammo>0||(u.spLock||0)>0);}
export function gainSp(u,skill,n,cost){
 if(!usesSp(skill)||spBlocked(u))return 0;
 const add=Number.isFinite(n)?Math.trunc(n):spIncrement(skill);
 if(add<=0)return 0;
 const cap=spCap(skill,cost),before=u.sp||0;
 u.sp=Math.min(cap,Math.max(0,Math.trunc(before)+add));
 return u.sp-before;
}
export function tickTimeSp(u,skill,dt,rate,opts={}){
 if(!usesSp(skill)||spTypeOf(skill)!=='INCREASE_WITH_TIME')return 0;
 if(opts.requiresBlock&&!opts.blocking)return 0;
 if(spBlocked(u))return 0;
 const cap=spCap(skill,opts.cost);
 if((u.sp||0)>=cap)return 0;
 const period=1/Math.max(1e-6,rate||1);
 u.spCd=(u.spCd||0)+dt;
 let gained=0;
 while(u.spCd>=period&&(u.sp||0)<cap&&!spBlocked(u)){
  u.spCd-=period;
  const got=gainSp(u,skill,undefined,opts.cost);
  if(!got)break;
  gained+=got;
 }
 return gained;
}
export function spBarFill(u,skill,cost){
 if(!usesSp(skill))return null;
 const kind=skillKind(skill),cap=spCap(skill,cost);
 if(kind==='ammo'&&u.ammo>0){
  return {kind:'ammo',on:true,cells:Math.max(1,u.ammoMax||ammoCount(skill)),filled:u.ammo,ratio:0,ready:false};
 }
 if(kind==='duration'&&u.skillLeft>0){
  const dur=skill.duration<0?1e9:skill.duration;
  return {kind:'duration',on:true,ratio:dur?Math.min(1,u.skillLeft/dur):0,ready:false};
 }
 const sp=Math.floor(u.sp??(skill.spData.initSp||0));
 return {kind:'idle',on:false,ratio:cap?Math.min(1,sp/cap):0,ready:sp>=(cost??(skill.spData.spCost||0))};
}
