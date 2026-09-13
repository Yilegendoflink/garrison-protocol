// Infinite life is a rule flag. HP is never replaced with an arbitrarily large number.
export function createTrainingDummy(uid,x,y){
 return {uid,type:'training-dummy',name:'无限血量木桩',trainingDummy:true,infiniteHealth:true,x,y,hp:1,maxHp:1,atk:0,def:0,res:0,elementResistance:0,shield:0,maxShield:0,damageReduction:0,vulnerable:1,armorBreak:0,debuff:0,slow:1,slowUntil:0,stun:0,statuses:[],immunities:{},flying:false,unblockable:false,block:null,path:0,segment:0,speed:0,interval:1,action:null,attackCooldown:0,cd:0,leak:0,glyph:'◎',damageLedger:{total:0,hits:0,byType:{},byUnit:{}}};
}
export function recordDummyDamage(target,amount,{type='physical',sourceId=null,sourceUid=null}={}){
 if(!Number.isFinite(amount)||amount<0)throw Error('Invalid dummy damage');
 const ledger=target.damageLedger,key=sourceUid===null?'environment':String(sourceUid);
 if(amount===0)return {hp:0,shield:0,total:0};
 ledger.total+=amount;ledger.hits++;ledger.byType[type]=(ledger.byType[type]||0)+amount;
 const unit=ledger.byUnit[key]??={uid:sourceUid,id:sourceId,damage:0,hits:0};unit.damage+=amount;unit.hits++;
 return {hp:amount,shield:0,total:amount};
}
export function dummySummary(target,elapsed,reason){
 const ledger=target.damageLedger;return {kind:'training-dummy',reason,elapsed,totalDamage:ledger.total,dps:elapsed>0?ledger.total/elapsed:0,hits:ledger.hits,byType:{...ledger.byType},units:Object.values(ledger.byUnit).map(u=>({...u})).sort((a,b)=>b.damage-a.damage)};
}
