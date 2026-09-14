import test from 'node:test';import assert from 'node:assert/strict';
import {remainingDistance,compareOperatorTargets,resolveBlocks,compileRoute,advanceEnemy,scheduleStrikes,dueStrikes} from '../dist/native-combat.js';
import {emitEvent,skillFlow} from '../dist/native-combat.js';
import {recent} from '../dist/native-fx.js';
import {NativeSession} from '../dist/native-session.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';

function liveBattle(){
 const g=new NativeSession(NATIVE_DATA,{seed:42});g.s.funds=100;assert.ok(g.perform('buy',0));const unit=g.s.units[0];
 let placed=false;for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(unit.uid,x,y))placed=g.deploy(unit.uid,x,y,0);
 assert.ok(placed);assert.ok(g.perform('start'));const b=g.battle;b.s.queue=[];b.s.enemies=[];b.deploy(b.s.units[0]);return b;
}
test('native spawn uses route origin and ranged attacks hold position',()=>{
 const b=liveBattle(),u=b.s.units[0];const origin={col:b.map.origin.col+u.x+1,row:b.map.origin.row-u.y};
 b.level={routes:[{motionMode:'FLY',startPosition:origin,endPosition:{col:origin.col+2,row:origin.row},checkpoints:[]}],enemyProfiles:{probe:{name:'probe',motion:'FLY',applyWay:'RANGED',rangeRadius:3,attributes:{maxHp:100000,atk:1,moveSpeed:1,baseAttackTime:1,def:0,magicResistance:0}}}};
 b.spawn({id:'probe',route:0});const enemy=b.s.enemies[0],x=enemy.x;assert.equal(x,u.x+1);
 for(let i=0;i<30;i++)b.step();assert.equal(enemy.x,x);assert.ok(b.s.events.some(e=>e.type==='hit'));
 enemy.hidden=true;enemy.action={left:1,target:u.uid};const hp=u.hp;b.step();assert.equal(enemy.action,null);assert.equal(u.hp,hp);
});
test('native mode multipliers remain independent of skill percentages',()=>{
 const b=liveBattle(),u=b.s.units[0],original=b.profile(u);b.rows={};b.s.band='band_dusk';b.s.units.push({...u,uid:999});
 b.profile=()=>({...original,branch:'fighter',attributes:{...original.attributes,atk:100},garrisons:[],skill:{blackboard:[{key:'atk',value:1}]}});u.skillLeft=10;u.source.equipment=[];
 assert.equal(b.stats(u).atk,260);assert.ok(b.stats(u).parts.some(p=>p.src==='策略·夕'&&p.layer==='mul'));
});
test('explicit skill flow overrides and description changes do not alter reset policy',()=>{
 const base={spData:{spCost:10,spType:'INCREASE_WITH_TIME'},duration:0,description:'立即回复'};
 assert.equal(skillFlow(base).resetAttack,false);assert.equal(skillFlow({...base,combatFlow:{resetAttack:true}}).resetAttack,true);
});

test('compiled routes preserve spawn and teleport distance',()=>{
 const route=compileRoute({startPosition:{col:0,row:0},endPosition:{col:4,row:0}},to,false,bfs);
 assert.deepEqual(route[0],{kind:'move',x:0,y:0});
 assert.equal(remainingDistance({x:0,y:0,cmd:0,route:[{kind:'appear',x:100,y:0},{kind:'move',x:101,y:0}]}),1);
});
test('nonmovement checkpoint placeholder positions never create extra paths',()=>{
 const route=compileRoute({startPosition:{col:10,row:0},endPosition:{col:11,row:0},checkpoints:[{type:'DISAPPEAR',position:{col:0,row:0}},{type:'WAIT_FOR_SECONDS',time:2,position:{col:0,row:0}},{type:'APPEAR_AT_POS',position:{col:10,row:0}}]},to,false,bfs);
 assert.equal(route.some(s=>s.kind==='move'&&s.x===0),false);
});
test('waiting and movement share one time budget in both directions',()=>{
 const unit=route=>({hp:1,route,cmd:0,x:0,y:0,speed:1,statuses:[]});
 const a=unit([{kind:'wait',time:.05},{kind:'move',x:1,y:0}]);advanceEnemy(a,.1);assert.ok(Math.abs(a.x-.05)<1e-9);
 const b=unit([{kind:'move',x:.05,y:0},{kind:'wait',time:.1},{kind:'move',x:1,y:0}]);advanceEnemy(b,.1);assert.ok(Math.abs(b.cmdLeft-.05)<1e-9);
});
test('attack holds movement; disappearing clears an attack and reappears after wait',()=>{
 const e={hp:1,route:[{kind:'move',x:1,y:0}],cmd:0,x:0,y:0,speed:1,statuses:[]};
 advanceEnemy(e,.1,null,true);assert.equal(e.x,0);
 e.route=[{kind:'disappear'},{kind:'wait',time:.2},{kind:'appear',x:3,y:0},{kind:'move',x:4,y:0}];e.action={target:1};
 advanceEnemy(e,.1);assert.equal(e.hidden,true);assert.equal(e.action,null);
 advanceEnemy(e,.2);assert.equal(e.hidden,false);assert.ok(Math.abs(e.x-3.1)<1e-9);
});
test('combat event kind survives damage metadata and reaches renderer',()=>{
 const s={time:1};for(const kind of ['attack','impact','hit'])emitEvent(s,kind,{type:'physical'});
 assert.deepEqual(s.events.map(e=>e.type),['attack','impact','hit']);assert.equal(recent(s.events,1,'hit').length,1);
 assert.equal(s.events[2].damageType,'physical');assert.equal(s.events[2].id,3);
});
test('delayed impacts cannot be delivered in the current frame',()=>{
 const s={time:0};scheduleStrikes(s,1,{delay:2/30});assert.equal(dueStrikes(s).length,0);s.time=2/30;assert.equal(dueStrikes(s).length,1);
});

const to=p=>({x:p.col,y:p.row});
const bfs=(from,dest)=>from.x===dest.x&&from.y===dest.y?[]:[dest];

test('remaining distance uses leftover segment, not node count',()=>{
 const short={route:[{kind:'move',x:0,y:0},{kind:'move',x:2,y:0}],cmd:0,x:0,y:0,uid:1};
 const long={route:[{kind:'move',x:0,y:1},{kind:'move',x:5,y:1}],cmd:0,x:0,y:1,uid:2};
 assert.ok(remainingDistance(short)<remainingDistance(long));
 const a={...short,x:1.5},b={...long,x:.2,uid:3};
 assert.ok(remainingDistance(a)<remainingDistance(b));
 const ranked=[b,a].sort((x,y)=>compareOperatorTargets(x,y,0,null,'MELEE'));
 assert.equal(ranked[0].uid,a.uid);
});

test('fastshot keeps air priority over remaining distance',()=>{
 const near={route:[{kind:'move',x:0,y:0},{kind:'move',x:1,y:0}],cmd:0,x:0,y:0,uid:1,flying:false};
 const farAir={route:[{kind:'move',x:0,y:1},{kind:'move',x:8,y:1}],cmd:0,x:0,y:1,uid:2,flying:true};
 const ranked=[near,farAir].sort((a,b)=>compareOperatorTargets(a,b,0,'air','RANGED'));
 assert.equal(ranked[0].uid,2);
});

test('blocking keeps the current pair instead of reshuffling each pass',()=>{
 const units=[{uid:1,x:0,y:0,hp:1,deployed:true,statuses:[]}];
 const a={uid:2,x:0,y:0,hp:1,flying:false,block:1,blockCost:1,statuses:[]};
 const b={uid:3,x:0,y:0,hp:1,flying:false,block:null,blockCost:1,statuses:[]};
 resolveBlocks(units,[b,a],()=>1);
 assert.equal(a.block,1);assert.equal(b.block,null);
 units[0].hp=0;resolveBlocks(units,[a,b],()=>1);
 assert.equal(a.block,null);
});

test('wait checkpoints consume time instead of being skipped',()=>{
 const route=compileRoute({startPosition:{col:0,row:0},endPosition:{col:2,row:0},checkpoints:[{type:'MOVE',position:{col:1,row:0}},{type:'WAIT_FOR_SECONDS',time:.5,position:{col:0,row:0}}]},to,false,bfs);
 const e={hp:1,route,cmd:0,cmdLeft:null,x:0,y:0,speed:10,statuses:[],block:null,hidden:false};
 let left=.5;while(left>0&&e.cmd<e.route.length){advanceEnemy(e,.05);left-=.05;}
 assert.equal(e.x,1);assert.ok(e.route.some(s=>s.kind==='wait'));
 assert.ok(e.cmdLeft>0||e.route[e.cmd]?.kind==='wait'||e.x>=1);
});

test('multi-hit strikes are queued on later frames',()=>{
 const s={time:0,strikes:[]};scheduleStrikes(s,3,{owner:1});
 assert.equal(dueStrikes(s).length,1);assert.equal(s.strikes.length,2);
 s.time=2/30;assert.equal(dueStrikes(s).length,1);
});
