import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {blackboard,resolveActiveTalents} from '../dist/protocol.js';
import reps from './fixtures/effects/representatives.json' with {type:'json'};
import {NO_BOND_BAN} from './no-bond-ban.mjs';

export {reps,blackboard};

export function openBattle(specs,{seed=reps.seed}={}){
 const g=new NativeSession(NATIVE_DATA,{bondBan:NO_BOND_BAN,seed});
 g.s.funds=9999;g.s.capacity=16;g.s.rewardPending=null;g.s.rewardQueue=[];
 const list=Array.isArray(specs)?specs:[specs];
 for(const spec of list){
  const id=typeof spec==='string'?spec:spec.chessId;
  const u=g.gain(id);
  if(typeof spec==='object'&&spec.skillIndex!=null)u.skillIndex=spec.skillIndex;
 }
 g.s.rewardPending=null;g.s.rewardQueue=[];
 for(const u of g.s.units.filter(u=>!u.position)){
  let placed=false;
  for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++){
   if(g.s.units.some(v=>v.uid!==u.uid&&v.position?.x===x&&v.position?.y===y))continue;
   if(g.canDeploy(u.uid,x,y))placed=g.deploy(u.uid,x,y,0);
  }
  assert.ok(placed,'no tile for '+u.chessId);
 }
 const summonCells=new Set();for(const card of g.s.summonCards||[]){let placed=false;for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++){const key=x+','+y;if(summonCells.has(key))continue;if(g.canDeploySummonCard(card.uid,x,y)){placed=g.deploySummonCard(card.uid,x,y);if(placed)summonCells.add(key);}}if(card.type!=='cathy-device')assert.ok(placed,'no tile for summon '+card.type);}
 assert.ok(g.perform('start'),g.lastError||'start failed');
 const b=g.battle;b.s.queue=[];b.s.limit=1e9;
 enemy(b,{hp:1e12,x:-8,y:-8,trainingDummy:true,hidden:true,untargetable:true,invulnerable:true});
 return {g,b};
}

export function deployNow(b){
 for(const u of b.s.units)if(!u.deployed)b.deploy(u);
}

export function enemy(b,extra={}){
 const e={uid:b.s.nextId++,id:'probe',name:'probe',x:extra.x??0,y:extra.y??0,hp:extra.hp??10000,maxHp:extra.hp??10000,atk:extra.atk??10,def:extra.def??0,res:extra.res??0,shield:0,shieldLayers:[],barriers:[],statuses:[],hidden:false,invulnerable:false,block:null,leak:1,interval:1,attackSpeed:100,attackCooldown:0,action:null,deployGen:0,exitLife:null,flying:false,...extra};
 b.s.enemies.push(e);return e;
}

export function byId(b,charId){return b.s.units.find(u=>u.id===charId);}
export function talent(b,u,name){
 const p=b.profile(u);
 return (p.activeTalents||resolveActiveTalents({talents:p.talents},p.status,{modulePhase:p.modulePhase})).find(t=>t.name===name)||null;
}
export function talentBB(b,u,name){const t=talent(b,u,name);return t?blackboard(t.blackboard):{};}
export function logOf(b,type){return (b.s.logicLog||[]).filter(x=>x.type===type);}
export function steps(b,n){for(let i=0;i<n;i++)b.step();}
