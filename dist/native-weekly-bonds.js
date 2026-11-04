import {regionalBondRules} from './native-challenges.js';
import {applyStatus,removeStatus} from './status.js';

const RANDOM_STATES=['stun','root','silence','cold','fear','sluggish'];
const ABNORMAL=new Set([...RANDOM_STATES,'frozen','sleep','levitate','tremble','terror','fragile','attackDown','defDown','resDown','attackSpeedDown']);
const config=b=>regionalBondRules(b.economy.s.weeklyChallenge);
const ready=(b,id)=>b.on(id)&&b.rows[id].count>=6;
const members=(b,id)=>b.s.units.filter(u=>u.deployed&&u.hp>0&&b.owns(u,id));
const scaled=(base,per,layers)=>base+per*Math.max(0,Number(layers)||0);
export function regionalBondDescription(challenge,id,layers){
 const c=regionalBondRules(challenge);if(!c||!['siracusaShip','sargonShip'].includes(id))return null;
 const rule=challenge.rules.find(r=>r.id===(id==='siracusaShip'?'siracusa-rework':'sargon-rework'));
 const p=id==='siracusaShip'?c.siracusa:c.sargon;
 return (rule?.description||'')+' 当前 '+layers+' 层：'+(id==='siracusaShip'?`异常持续 ${Math.min(p.durationCap,scaled(p.duration,p.durationPerLayer,layers)).toFixed(2)} 秒；每次共鸣 ${scaled(p.damage,p.damagePerLayer,layers)} 真实伤害。`:`迟钝 ${(Math.min(p.slowCap,scaled(p.slow,p.slowPerLayer,layers))*100).toFixed(1)}%；每5秒 ${scaled(p.damage,p.damagePerLayer,layers)}、强化每秒 ${scaled(p.enhancedDamage,p.enhancedDamagePerLayer,layers)} 法术伤害。`);
}
export function regionalAttack(b,u,e){
 const c=config(b)?.siracusa;if(!c||!ready(b,'siracusaShip')||!b.owns(u,'siracusaShip')||u.kind==='summon'||e.hp<=0)return;
 const key=String(u.lastAttackId)+':'+(u.skillCount||0);
 if(u.regionalAttack?.key!==key)u.regionalAttack={key,targets:[],success:b.economy.random()<c.prob,kind:RANDOM_STATES[Math.floor(b.economy.random()*RANDOM_STATES.length)]};
 const roll=u.regionalAttack;if(!roll.success||roll.targets.includes(e.uid))return;roll.targets.push(e.uid);
 applyStatus(e,roll.kind,Math.min(c.durationCap,scaled(c.duration,c.durationPerLayer,b.layers.siracusaShip)),{source:'weekly-siracusa-'+u.uid,value:roll.kind==='sluggish'?c.slow:1});
}
export function regionalSkillStart(b,u,addEffect){
 const c=config(b)?.sargon;if(!c||!u||u.kind==='summon'||!ready(b,'sargonShip')||!b.owns(u,'sargonShip'))return;
 const cells=b.range(u,true).filter(p=>b.map.grid[p.y]?.[p.x]);
 let zone=b.s.logicEffects.find(f=>f.talentOrSkillId==='weekly-sargon-sand');
 if(!zone)zone=addEffect(b,{kind:'zone',talentOrSkillId:'weekly-sargon-sand',sourceUid:null,endsAt:null,persistAfterSourceGone:true,values:{staticCells:[],mouseSand:true},regionalNextAt:b.s.time+c.interval});
 const existing=new Set(zone.values.staticCells.map(p=>p.x+','+p.y));for(const p of cells)if(!existing.has(p.x+','+p.y)){existing.add(p.x+','+p.y);zone.values.staticCells.push({x:p.x,y:p.y});}
}
export function tickRegionalBonds(b,dealDamage){
 const c=config(b);if(!c)return;const now=b.s.time;
 if(ready(b,'siracusaShip')){
  b.s.regionalSiracusaNextAt??=now+1;
  while(b.s.regionalSiracusaNextAt<=now+1e-9){b.s.regionalSiracusaNextAt+=1;
   const source=members(b,'siracusaShip')[0];if(!source)break;
   for(const e of b.s.enemies.filter(e=>e.hp>0&&!e.hidden)){
    if(e.hp<=0||new Set((e.statuses||[]).filter(s=>s.remaining>0&&ABNORMAL.has(s.kind)).map(s=>s.kind)).size<2)continue;
    const targets=b.s.enemies.filter(t=>t.hp>0&&!t.hidden&&Math.hypot(t.x-e.x,t.y-e.y)<=c.siracusa.radius);
    for(const target of targets)dealDamage(b,{source,target,amount:scaled(c.siracusa.damage,c.siracusa.damagePerLayer,b.layers.siracusaShip),type:'true',cause:'extra',skipHooks:true});
   }
  }
 }
 const zone=b.s.logicEffects.find(f=>f.talentOrSkillId==='weekly-sargon-sand'),source=members(b,'sargonShip')[0];
 const enabled=zone&&source&&ready(b,'sargonShip'),cells=new Set((zone?.values.staticCells||[]).map(p=>p.x+','+p.y));
 const active=members(b,'sargonShip').filter(u=>b.skillActive(u));
 for(const e of b.s.enemies){
  const inside=enabled&&e.hp>0&&!e.hidden&&!e.flying&&cells.has(Math.floor(e.x+.5)+','+Math.floor(e.y+.5));
  if(!inside){removeStatus(e,'sluggish','weekly-sargon-sand');continue;}
  const enhanced=active.some(u=>b.inside(u,e,true)),slow=Math.min(c.sargon.slowCap,scaled(c.sargon.slow,c.sargon.slowPerLayer,b.layers.sargonShip))*(enhanced?2:1);
  removeStatus(e,'sluggish','weekly-sargon-sand');applyStatus(e,'sluggish',.1,{source:'weekly-sargon-sand',value:slow,resistible:false});
 }
 if(!enabled)return;
 while(zone.regionalNextAt<=now+1e-9){zone.regionalNextAt+=c.sargon.interval;
  for(const e of b.s.enemies.filter(e=>e.hp>0&&!e.hidden&&!e.flying&&cells.has(Math.floor(e.x+.5)+','+Math.floor(e.y+.5)))){
   applyStatus(e,'root',c.sargon.rootDuration,{source:'weekly-sargon-sand'});
   dealDamage(b,{source,target:e,amount:scaled(c.sargon.damage,c.sargon.damagePerLayer,b.layers.sargonShip),type:'arts',cause:'extra',skipHooks:true});
  }
 }
 zone.regionalEnhancedNextAt??=now+1;
 while(zone.regionalEnhancedNextAt<=now+1e-9){zone.regionalEnhancedNextAt+=1;
  for(const e of b.s.enemies.filter(e=>e.hp>0&&!e.hidden&&!e.flying&&cells.has(Math.floor(e.x+.5)+','+Math.floor(e.y+.5))&&active.some(u=>b.inside(u,e,true))))dealDamage(b,{source,target:e,amount:scaled(c.sargon.enhancedDamage,c.sargon.enhancedDamagePerLayer,b.layers.sargonShip),type:'arts',cause:'extra',skipHooks:true});
 }
}
