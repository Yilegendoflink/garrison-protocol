import test from 'node:test';import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';import {NativeBattle} from '../dist/native-battle.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';import {dealDamage,applyHeal,moveActor,teleportActor,commitExit} from '../dist/native-effects.js';import {applyStatus} from '../dist/status.js';

function arena(id,{raw=NATIVE_DATA.enemies[id]}={}){
 const g=new NativeSession(NATIVE_DATA,{seed:42});g.s.funds=100;assert.ok(g.perform('buy',0));const unit=g.s.units[0];let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(unit.uid,x,y))placed=g.deploy(unit.uid,x,y,0);
 assert.ok(placed);assert.ok(g.perform('start'));const b=g.battle,ally=b.s.units[0];b.s.units=[];b.s.queue=[];b.s.enemies=[];b.s.limit=1000;
 b.map=structuredClone(b.map);b.map.grid[3][3].heightType='LOWLAND';const o=b.map.origin,p={col:o.col+3,row:o.row-3};
 b.level={...b.level,routes:[{motionMode:'WALK',startPosition:p,endPosition:p,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...b.level.enemyProfiles,[id]:raw}};b.spawn({id,route:0});
 return {b,g,e:b.s.enemies[0],ally};
}
function advance(b,t){for(let i=0;i<Math.round(t*30);i++)b.step();}
function strike(b,e,type){return dealDamage(b,{target:e,value:1e6,type,cause:'attack'});}
function addAlly(b,u,x=3,y=3){u.x=x;u.y=y;u.deployed=true;u.hp=u.maxHp;applyStatus(u,'disarm',600);b.s.units.push(u);}

function openArena(id='enemy_1007_slime'){
 const scene=arena(id),{b,e}=scene;e.canAttack=false;e.weight=0;e.x=2;e.y=3;e.route=[{kind:'wait',x:2,y:3,time:600}];e.cmd=0;e.cmdLeft=null;
 for(const row of b.map.grid)for(const tile of row)Object.assign(tile,{passableMask:'ALL',heightType:'LOWLAND',obstacle:false,tileKey:'tile_road'});return scene;
}

test('有明确力度的推动逐帧运动，30帧离散摩擦位移匹配PRTS特效/弹道表',()=>{
 for(const [force,expected]of [[-2,.08492],[-1,.37363],[0,1.56247],[1,1.98705],[2,2.77347],[3,3.33058]]){
  const {b,e}=openArena();assert.equal(moveActor(b,e,{x:1,y:3,dir:0},'推动',{forceLevel:force}),true);assert.equal(e.x,2);assert.ok(e.shift);advance(b,2);assert.equal(e.shift,null);assert.ok(Math.abs(e.x-2-expected)<.00002,`${force}: ${e.x-2}`);
 }
 const {b,e}=openArena();moveActor(b,e,{x:1,y:3},'推动',{forceLevel:0,projectile:true});advance(b,2);assert.ok(Math.abs(e.x-2-1.6958)<.00002);
});

test('静态刚体进入失衡并打断攻击，但零速度/零位移，0.1秒后退出；不同于失衡免疫',()=>{
 const {b,e}=openArena('enemy_1005_yokai');assert.equal(e.staticRigid,true);e.action={left:30};assert.equal(moveActor(b,e,{x:1,y:3},'推动',{forceLevel:0}),true);assert.equal(e.action,null);assert.equal(e.shift.vx,0);advance(b,2/30);assert.ok(e.shift);assert.equal(e.x,2);advance(b,1/30);assert.equal(e.shift,null);assert.equal(e.x,2);
 e.shiftImmune=true;assert.equal(moveActor(b,e,{x:1,y:3},'推动',{forceLevel:0}),false);assert.equal(e.shift,null);
});

test('静态刚体持续受拉力时保留失衡，解绑后退出；不限制普通传送',()=>{
 const {b,e}=openArena('enemy_1005_yokai');moveActor(b,e,{x:1,y:3},'拖拽',{forceLevel:0});advance(b,.5);assert.ok(e.shift);assert.equal(e.x,2);advance(b,.5);assert.equal(e.shift,null);assert.equal(e.x,2);
 assert.equal(moveActor(b,e,{x:1,y:3},'推动'),false);assert.equal(teleportActor(b,e,{x:3,y:3}),true);assert.equal(e.x,3);
});

test('静态刚体登记覆盖当前档案且不把所有飞行单位混为静态',()=>{
 const profiles=[...Object.values(NATIVE_DATA.enemies),...Object.values(NATIVE_DATA.enemyDependencies),...Object.values(NATIVE_DATA.levels).flatMap(l=>Object.values(l.enemyProfiles||{}))],ids=new Set(profiles.filter(e=>e.enemyBehavior.staticRigid).map(e=>e.prefabKey));assert.equal(ids.size,29);assert.ok(ids.has('enemy_1430_lrrook'));assert.ok(ids.has('enemy_1040_bombd'));assert.ok(ids.has('enemy_1269_nhfly'));assert.equal(NATIVE_DATA.enemies.enemy_10045_parrot.enemyBehavior.staticRigid,false);
 const {b,e}=arena('enemy_1367_dseed',{raw:NATIVE_DATA.enemyDependencies.enemy_1367_dseed});assert.equal(e.staticRigid,false);assert.equal(e.shiftImmune,true);assert.equal(moveActor(b,e,{x:2,y:3},'推动',{forceLevel:10}),false);
});

test('力度重量差不足不进入失衡，结束事件仅在实际运动停止时触发',()=>{
 const {b,e}=openArena('enemy_10112_ymgds');e.weight=3;assert.equal(moveActor(b,e,{x:1,y:3},'推动',{forceLevel:0}),false);assert.equal(e.shift,undefined);
 e.weight=0;moveActor(b,e,{x:1,y:3},'推动',{forceLevel:0});advance(b,.2);assert.ok(e.shift);assert.equal(e.statuses.some(s=>s.kind==='stun'),false);advance(b,1);assert.equal(e.shift,null);assert.ok(e.statuses.some(s=>s.kind==='stun'));
});

test('方向推动偏离部署方向超过45度时改径向并降低两级力度',()=>{
 const straight=openArena(),side=openArena();moveActor(straight.b,straight.e,{x:1,y:3,dir:0},'推动',{forceLevel:1,directional:true});moveActor(side.b,side.e,{x:1,y:3,dir:1},'推动',{forceLevel:1,directional:true});advance(straight.b,2);advance(side.b,2);
 assert.ok(Math.abs(straight.e.x-2-1.98705)<.00002);assert.ok(Math.abs(side.e.x-2-.37363)<.00002);
});

test('见行者技能命中的真实事件入口读取力度黑板并进入连续推动',()=>{
 const {b,e,ally}=openArena(),[chessId,p]=Object.entries(NATIVE_DATA.profiles).find(([,p])=>p.charId==='char_4036_forcer'&&p.skillIndex===1);
 Object.assign(ally,{uid:777,id:p.charId,chessId,source:{...ally.source,charId:p.charId,chessId,skillIndex:1},x:1,y:3,dir:0,deployed:true,hp:p.attributes.maxHp,maxHp:p.attributes.maxHp,skillLeft:10,statuses:[]});b.s.units=[ally];e.x=1;e.y=4;b.hit(ally,e,10,'physical',{skill:true});assert.ok(e.shift);assert.ok(e.shift.vx>0);assert.equal(e.shift.vy,0,'惊爆射击侧面目标也保持身前方向，不降级成径向');assert.equal(e.x,1);b.step();assert.ok(e.x>1);
});

test('弧光锋卫失衡期间按0.066秒结算400真伤，停止后不再自伤',()=>{
 const {b,e}=openArena('enemy_1328_cbjedi');const hp=e.hp;moveActor(b,e,{x:1,y:3},'推动',{forceLevel:0});advance(b,.2);assert.equal(hp-e.hp,1200);
 advance(b,1);assert.equal(e.shift,null);const after=e.hp;advance(b,.3);assert.equal(e.hp,after);
});

test('雪孩子撞高台扣5000真伤且5秒内不重复触发，低地阻挡不误算高台',()=>{
 const {b,e}=openArena('enemy_10138_xdsnow');e.hp=e.maxHp=30000;e.x=3;b.map.grid[3][4].heightType='HIGHLAND';b.map.grid[3][4].passableMask='FLY_ONLY';moveActor(b,e,{x:2,y:3},'推动',{forceLevel:0});advance(b,.4);assert.equal(e.hp,25000);assert.ok(e.x<3.251);
 moveActor(b,e,{x:2,y:3},'推动',{forceLevel:0});advance(b,.4);assert.equal(e.hp,25000);advance(b,5);moveActor(b,e,{x:2,y:3},'推动',{forceLevel:0});advance(b,.4);assert.equal(e.hp,20000);
 const low=openArena('enemy_10138_xdsnow');low.e.hp=low.e.maxHp=30000;low.b.map.grid[3][3].passableMask='NONE';moveActor(low.b,low.e,{x:1,y:3},'推动',{forceLevel:0});advance(low.b,.4);assert.equal(low.e.hp,30000);assert.equal(low.e.snowWallUntil,undefined);
});

test('连续推动可跨JSON恢复，浮空终止失衡，非法速度存档拒绝',()=>{
 const {b,g,e}=openArena();moveActor(b,e,{x:1,y:3},'推动',{forceLevel:0});advance(b,.2);const saved=JSON.parse(JSON.stringify(b.s)),restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,saved);assert.ok(restored);advance(b,1);advance(restored,1);assert.ok(Math.abs(b.s.enemies[0].x-restored.s.enemies[0].x)<1e-9);
 const flying=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,saved);applyStatus(flying.s.enemies[0],'levitate',2);flying.step();assert.equal(flying.s.enemies[0].shift,null);
 saved.enemies[0].shift.vx=null;assert.equal(NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,saved),null);
});

test('推动进地穴走坠落退场，不触发解压缩生成碎片',()=>{
 const {b,e}=openArena('enemy_1195_sfyin');b.map.grid[3][3].tileKey='tile_hole';moveActor(b,e,{x:1,y:3},'推动',{forceLevel:0});advance(b,1);assert.equal(e.hp,0);assert.equal(b.s.kills,1);assert.equal(b.s.pendingEnemySpawns.length,0);
});

test('持续拖拽按距离四次方衰减，低受力等级位移匹配PRTS表',()=>{
 for(const [distance,force,expected]of [[2,-2,.0320],[3,-2,.0325],[2,-1,.5699],[3,-1,.9240]]){
  const {b,e}=openArena();e.x=1+distance;const before=e.x;assert.equal(moveActor(b,e,{x:1,y:3,dir:0},'拖拽',{forceLevel:force}),true);assert.equal(e.x,before);advance(b,2);assert.equal(e.shift,null);assert.ok(Math.abs(before-e.x-expected)<.00006,`${distance}/${force}: ${before-e.x}`);
 }
});

test('强拉在拉动者身前急停，但保持失衡直到1秒作用期结束',()=>{
 const {b,e}=openArena();e.x=3;moveActor(b,e,{x:1,y:3,dir:0},'拖拽',{forceLevel:0});advance(b,.7);assert.ok(e.shift);assert.equal(e.shift.vx,0);assert.ok(e.x>1&&e.x-1<=.6708);const x=e.x;advance(b,.3);assert.equal(e.shift,null);assert.equal(e.x,x);
});

test('拉动者退场解除绑定，已获得速度继续滑行而非瞬停',()=>{
 const {b,e,ally}=openArena();Object.assign(ally,{x:1,y:3,deployed:true,hp:1000,maxHp:1000,dir:0});b.s.units=[ally];e.x=5;applyStatus(ally,'disarm',60);moveActor(b,e,ally,'拖拽',{forceLevel:0});advance(b,.2);const x=e.x;assert.ok(e.shift.vx<0);ally.deployed=false;ally.deployAt=100;b.step();assert.ok(e.x<x);assert.equal(e.shift.pulls.length,0);advance(b,2);assert.equal(e.shift,null);
});

test('拖拽途中变更重量不改已锁定力，跨JSON恢复力和期限，非法拉力拒绝',()=>{
 const {b,g,e}=openArena();e.x=4;moveActor(b,e,{x:1,y:3,dir:0},'拖拽',{forceLevel:-1});advance(b,.3);e.weight=10;const saved=JSON.parse(JSON.stringify(b.s)),restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,saved);assert.ok(restored);advance(b,2);advance(restored,2);assert.ok(Math.abs(e.x-restored.s.enemies[0].x)<1e-9);
 saved.enemies[0].shift.pulls[0].force=-1;assert.equal(NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,saved),null);
});

test('百炼嘉维尔实际命中读取拉力黑板；薄绿式向内推动仍用瞬间动量',()=>{
 const {b,e,ally}=openArena(),[chessId,p]=Object.entries(NATIVE_DATA.profiles).find(([,p])=>p.charId==='char_1026_gvial2'&&p.skillIndex===1);
 Object.assign(ally,{uid:777,id:p.charId,chessId,source:{...ally.source,charId:p.charId,chessId,skillIndex:1},x:1,y:3,dir:0,deployed:true,hp:p.attributes.maxHp,maxHp:p.attributes.maxHp,skillLeft:10,statuses:[]});b.s.units=[ally];e.x=4;b.hit(ally,e,10,'physical',{skill:true});assert.equal(e.shift.pulls[0].sourceUid,777);b.step();assert.ok(e.x<4);
 const inward=openArena();inward.e.x=4;moveActor(inward.b,inward.e,{x:1,y:3},'拖拽',{forceLevel:0,radialImpulse:true});assert.equal(inward.e.shift.pulls.length,0);advance(inward.b,2);assert.ok(Math.abs(4-inward.e.x-1.56247)<.00002);
});
