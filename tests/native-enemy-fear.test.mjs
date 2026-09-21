import test from 'node:test';import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';import {NativeBattle} from '../dist/native-battle.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';import {applyStatus,permissions} from '../dist/status.js';

function arena(id='enemy_1007_slime',{ally=false}={}){
 const g=new NativeSession(NATIVE_DATA,{seed:42});g.s.funds=100;assert.ok(g.perform('buy',0));const unit=g.s.units[0];let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(unit.uid,x,y))placed=g.deploy(unit.uid,x,y,0);
 assert.ok(placed);assert.ok(g.perform('start'));const b=g.battle,u=b.s.units[0];b.s.units=[];b.s.queue=[];b.s.enemies=[];b.s.limit=1000;
 b.map={cols:12,rows:7,origin:{col:0,row:6},grid:Array.from({length:7},()=>Array.from({length:12},()=>({tileKey:'tile_road',heightType:'LOWLAND',passableMask:'ALL',buildableType:'ALL'})))};b.map.grid[3][10].tileKey='tile_end';
 const raw=NATIVE_DATA.enemies[id];b.level={...b.level,routes:[{allowDiagonalMove:true,motionMode:raw.motion,startPosition:{col:3,row:3},endPosition:{col:10,row:3},checkpoints:[{type:'WAIT_FOR_SECONDS',time:10}]}],enemyProfiles:{...b.level.enemyProfiles,[id]:raw}};
 b.spawn({id,route:0});const e=b.s.enemies[0];e.route=[{kind:'wait',time:10},{kind:'move',x:10,y:3}];e.cmd=0;e.cmdLeft=null;
 if(ally){u.x=1;u.y=3;u.deployed=true;applyStatus(u,'disarm',600);b.s.units.push(u);}
 return {b,g,e,u};
}
function advance(b,t){for(let i=0;i<Math.round(t*30);i++)b.step();}

test('外源恐惧筛远离来源的扇形可达格，排除蓝门/地穴并实际移动',()=>{
 const {b,e,u}=arena(undefined,{ally:true});b.map.grid[3][6].tileKey='tile_hole';applyStatus(e,'fear',4,{source:u.uid});b.step();
 assert.ok(e.fearMovement.candidates.length>0);assert.ok(e.fearMovement.candidates.every(p=>p.x>3&&Math.abs(p.y-3)<=p.x-3));
 assert.ok(e.fearMovement.candidates.every(p=>!['tile_end','tile_hole'].includes(b.map.grid[p.y][p.x].tileKey)));
 const x=e.x;advance(b,1);assert.ok(e.x>x);assert.equal(e.block,null);assert.equal(permissions(e).beBlocked,false);
});

test('自身恐惧在当前格随机移动，消耗原停驻时间，结束后原地继续停驻',()=>{
 const {b,e}=arena();applyStatus(e,'fear',2,{source:e.uid});const points=[];
 for(let i=0;i<30;i++){b.step();points.push([e.x,e.y]);}
 assert.equal(e.fearMovement.candidates.length,0);assert.ok(points.some(([x,y])=>Math.hypot(x-3,y-3)>.01));assert.ok(points.every(([x,y])=>Math.abs(x-3)<=.25&&Math.abs(y-3)<=.25));
 assert.ok(Math.abs(e.cmdLeft-9)<1e-7);advance(b,1.1);assert.equal(e.fearMovement,null);const p=[e.x,e.y];advance(b,1);assert.deepEqual([e.x,e.y],p);assert.ok(e.cmdLeft<7);
 assert.equal(e.route.at(-1).x,10);
});

test('重复恐惧刷新来源方向，束缚阻止恐惧位移但不停止恐惧计时',()=>{
 const {b,e,u}=arena(undefined,{ally:true});applyStatus(e,'fear',4,{source:u.uid});b.step();const first=e.fearMovement.signature;
 u.x=9;applyStatus(e,'fear',4,{source:u.uid});b.step();assert.notEqual(e.fearMovement.signature,first);assert.ok(e.fearMovement.candidates.every(p=>p.x<e.x+.1));
 applyStatus(e,'root',1);const p=[e.x,e.y];advance(b,.5);assert.deepEqual([e.x,e.y],p);assert.ok(e.statuses.find(s=>s.kind==='fear').remaining<4);
});

test('萨科塔之翼首次严格半血以下自惧并临时加速，抵抗只缩短恐惧，不缩短独立加速',()=>{
 const {b,e}=arena('enemy_10083_hlbird');e.statusResistance=.5;e.hp=e.maxHp*.5;b.step();assert.equal(e.selfFearTriggered,undefined);
 e.hp=e.maxHp*.49;b.step();assert.equal(e.selfFearTriggered,true);assert.equal(e.speed,e.baseSpeed*1.5);assert.ok(e.statuses.some(s=>s.kind==='fear'));
 advance(b,2.7);assert.equal(e.statuses.some(s=>s.kind==='fear'),false);assert.equal(e.speed,e.baseSpeed*1.5);advance(b,2.4);assert.equal(e.speed,e.baseSpeed);
 e.hp=e.maxHp;b.step();e.hp=e.maxHp*.1;b.step();assert.equal(e.statuses.some(s=>s.kind==='fear'),false);
});

test('恐惧临时路径和进度跨JSON存档保留，恢复后继续移动',()=>{
 const {b,g,e,u}=arena(undefined,{ally:true});e.speed=.1;applyStatus(e,'fear',8,{source:u.uid});advance(b,1);
 const saved=JSON.parse(JSON.stringify(b.s)),restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,saved);assert.ok(restored);
 const other=restored.s.enemies[0];assert.deepEqual(other.fearMovement,e.fearMovement);advance(b,1);advance(restored,1);assert.equal(other.x,e.x);assert.equal(other.y,e.y);assert.equal(other.cmdLeft,e.cmdLeft);
});

test('角色类干员不接受恐惧；敌人恐惧本身不额外禁止技能和远程攻击',()=>{
 const {e,u}=arena();assert.equal(applyStatus(u,'fear',5),false);applyStatus(e,'fear',5,{source:e.uid});
 assert.equal(permissions(e).attack,true);assert.equal(permissions(e).skill,true);assert.equal(permissions(e).beBlocked,false);
});

test('地面恐惧路径绕过不可通行地块，结束后接回原路径时不穿墙',()=>{
 const {b,e,u}=arena(undefined,{ally:true});for(let y=0;y<6;y++)b.map.grid[y][5].passableMask='NONE';
 applyStatus(e,'fear',3,{source:u.uid});for(let i=0;i<100;i++){b.step();assert.notEqual(b.map.grid[Math.round(e.y)][Math.round(e.x)].passableMask,'NONE');}
 assert.equal(e.fearMovement,null);assert.equal(e.route.at(-1).x,10);assert.ok(e.route.some(p=>p.kind==='move'&&p.y>=6),'回程需要绕过墙底缺口');
});

test('敌方寒冷的攻速减少参与真实攻击节奏，不能只有状态图标',()=>{
 const normal=arena(undefined,{ally:true}),cold=arena(undefined,{ally:true});
 for(const {b,e,u}of [normal,cold]){u.x=e.x;u.y=e.y;e.atk=e.baseAtk=1;}
 applyStatus(cold.e,'cold',20);advance(normal.b,9);advance(cold.b,9);
 assert.ok(normal.e.attackCount>cold.e.attackCount);assert.ok(cold.e.attackCount>0);
});

test('恐惧期间外部移动导致旧目标超过5格时淘汰旧候选并回落当前格',()=>{
 const {b,e,u}=arena(undefined,{ally:true});b.economy.random=()=>0;applyStatus(e,'fear',5,{source:u.uid});b.step();
 const old={...e.fearMovement.targetCenter},corners=[{x:0,y:0},{x:11,y:0},{x:0,y:6},{x:11,y:6}].sort((a,c)=>Math.hypot(c.x-old.x,c.y-old.y)-Math.hypot(a.x-old.x,a.y-old.y)),to=corners[0];
 e.x=to.x;e.y=to.y;b.step();assert.ok(!e.fearMovement.candidates.some(p=>p.x===old.x&&p.y===old.y));assert.deepEqual(e.fearMovement.targetCenter,to);
});
