import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {buildPhasePlan,enemySprite} from '../dist/protocol.js';
import {dealDamage} from '../dist/native-effects.js';
import {blowerCells} from '../dist/native-environment.js';
import {AVAILABLE_FINAL_BOSS_IDS,finalBossConfig,finalBossPlacementArea,finalBossSpawnPoint,rollFinalBoss} from '../dist/native-final-boss.js';

function finalRound(g){g.s.round=buildPhasePlan(NATIVE_DATA,g.s.modeId).filter(t=>t.isBossTurn&&!t.isConditional).at(-1).round;assert.equal(g.startPreparation(),true);}
function game({mapId=NATIVE_DATA.maps[0].stageId,operator=false,seed=42}={}){
 const g=new NativeSession(NATIVE_DATA,{modeId:'mode_single_normal',bandId:'band_amiya',mapId,seed,bondBan:{bonds:[]},finalBossId:'boss_5'});
 g.s.rewardPending=null;g.s.rewardQueue=[];
 finalRound(g);
 if(operator){g.s.funds=9999;const shop=Object.values(NATIVE_DATA.season.charShopChessDatas).find(x=>x.charId&&!x.isHidden);const u=g.gain(shop.chessId);assert.ok(u);let placed=false;for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(u.uid,x,y))placed=g.deploy(u.uid,x,y,0);assert.ok(placed);}
 assert.ok(g.startBattle(),g.lastError||'Boss battle failed to start');return g;
}

test('implemented final bosses 4/5/7 enter the weighted run roll and simulated hp defaults to 75% of coop hp',()=>{
 assert.deepEqual(AVAILABLE_FINAL_BOSS_IDS,['boss_4','boss_5','boss_7']);
 assert.equal(rollFinalBoss(NATIVE_DATA,'mode_single_normal',123),rollFinalBoss(NATIVE_DATA,'mode_single_normal',123));
 assert.ok(AVAILABLE_FINAL_BOSS_IDS.includes(rollFinalBoss(NATIVE_DATA,'mode_single_normal',123)));
 assert.equal(finalBossConfig(NATIVE_DATA,'boss_5','mode_single_normal').hp,292500);
 assert.equal(finalBossConfig(NATIVE_DATA,'boss_5','mode_single_hard').hp,585000);
 assert.equal(finalBossConfig(NATIVE_DATA,'boss_4','mode_single_normal').hp,531562.5);
 assert.equal(finalBossConfig(NATIVE_DATA,'boss_4','mode_single_abyss').hp,3150000);
 assert.equal(finalBossConfig(NATIVE_DATA,'boss_7','mode_single_normal').hp,590625);
 assert.equal(finalBossConfig(NATIVE_DATA,'boss_7','mode_single_abyss').hp,3000000);
});

test('static bosses spawn in the reserved 3x2 upper-right area and keep generic attacks closed',()=>{
 for(const bossId of ['boss_4','boss_7']){
  const g=new NativeSession(NATIVE_DATA,{modeId:'mode_single_normal',bandId:'band_amiya',mapId:NATIVE_DATA.maps[0].stageId,seed:42,bondBan:{bonds:[]},finalBossId:bossId});
  finalRound(g);
  assert.ok(g.startBattle());
  const b=g.battle,boss=b.s.enemies.find(e=>e.finalBoss);
  assert.equal(boss.finalBossHp,boss.maxHp);
  assert.equal(boss.formHold,true,bossId+' 自缚站桩');
  assert.equal(boss.unblockable,true,bossId+' 不可阻挡');
  assert.equal(boss.canAttack,false,bossId+' 通用普攻关闭，攻击全部走逐名 tick');
  assert.deepEqual(boss.hitRect,{length:4.95,width:2.95,offsetY:1},bossId+' 盟约版巨型受击矩形');
  const range=b.range;b.range=()=>[{x:g.map.cols-3,y:0}];
  assert.equal(b.inside({},boss,true),true,bossId+' 应被地图内、预留区左侧的攻击格选中');b.range=range;
  assert.equal(boss.spriteScale>2,true,bossId+' 放大表现');
  assert.equal(enemySprite(boss).key,finalBossConfig(NATIVE_DATA,bossId,'mode_single_normal').handbookEnemyId,bossId+' 使用本期图鉴头像映射');
  assert.ok(NATIVE_DATA.assets[enemySprite(boss).key],bossId+' 战斗头像资源存在');
  const point=finalBossSpawnPoint(g.map,boss.id);assert.equal(boss.x,point.x);assert.equal(boss.y,point.y);
  assert.notDeepEqual([boss.x,boss.y],[boss.route[0].x,boss.route[0].y],bossId+' 不应站在红门出生点');
  for(let i=0;i<90;i++)b.step();
  assert.equal(boss.x,point.x);assert.equal(boss.y,point.y);
  if(bossId==='boss_7')assert.ok(boss.madnessResist>0&&boss.madnessResist<1,bossId+' 半血减伤读本期黑板');
  if(bossId==='boss_4')assert.equal(boss.dslilyForm,1);
 }
});

test('every arena has two tile_start routes, a tile_end target, and a closed walkable boss patrol loop',()=>{
 for(const map of NATIVE_DATA.maps){
  assert.equal(map.bossDoorRoutes.length,2,map.stageId);
  const doors=map.bossDoorRoutes.map(r=>({x:r.startPosition.col-map.origin.col,y:map.origin.row-r.startPosition.row}));assert.notDeepEqual(doors[0],doors[1],map.stageId+' red doors must differ');
  assert.deepEqual(new Set(doors.map(p=>map.grid[p.y]?.[p.x]?.tileKey)),new Set(['tile_start']),map.stageId);
  const end=map.bossDoorRoutes[0].endPosition,exit={x:end.col-map.origin.col,y:map.origin.row-end.row};
  assert.equal(map.grid[exit.y]?.[exit.x]?.tileKey,'tile_end',map.stageId);
  const route=map.bossPatrolRoute;assert.ok(route.length>=8,map.stageId);
  assert.deepEqual([route[0].x,route[0].y],[route.at(-1).x,route.at(-1).y],map.stageId);
  for(const p of route)assert.ok(map.grid[p.y]?.[p.x]&&map.grid[p.y][p.x].passableMask!=='NONE'&&map.grid[p.y][p.x].passableMask!=='FLY_ONLY',map.stageId+' patrol '+p.x+','+p.y);
 }
});

test('final boss maps use the paired PRTS boss crops and their own blower sources',()=>{
 for(const map of NATIVE_DATA.maps){
  const arena=map.bossArena;assert.ok(arena,map.stageId+' boss crop');
  assert.deepEqual([arena.cols,arena.rows],[21,7],map.stageId+' joined leftBoss/rightBoss crop');
  assert.deepEqual([arena.origin.col,arena.origin.row],[0,6],map.stageId+' boss crop origin');
  assert.equal(arena.bossDoorRoutes.length,2,map.stageId+' two telin-to-end routes');
  for(const route of arena.bossDoorRoutes){
   const start={x:route.startPosition.col-arena.origin.col,y:arena.origin.row-route.startPosition.row};
   const end={x:route.endPosition.col-arena.origin.col,y:arena.origin.row-route.endPosition.row};
   assert.equal(arena.grid[start.y]?.[start.x]?.tileKey,'tile_telin',map.stageId+' boss entrance');
   assert.equal(arena.grid[end.y]?.[end.x]?.tileKey,'tile_end',map.stageId+' boss exit');
  }
  assert.deepEqual([arena.bossPatrolRoute[0].x,arena.bossPatrolRoute[0].y],[arena.bossPatrolRoute.at(-1).x,arena.bossPatrolRoute.at(-1).y],map.stageId+' closed boss patrol');
 }
 const windMap=NATIVE_DATA.maps.find(map=>map.stageId==='act2autochess_m01'),arena=windMap.bossArena,field={...windMap,...arena};
 assert.equal(windMap.windSources.length,8,'normal crop retains both rows of sources for normal play');
 assert.equal(arena.windSources.length,4,'boss crop uses only the four row-6 sources');
 assert.ok(arena.windSources.every(source=>source.y===0));
 const cells=blowerCells(field);
 for(const source of arena.windSources){
  assert.equal(arena.grid[source.y][source.x].buildableType,'NONE','blower source itself is not deployable');
  for(let step=1;step<=3;step++)assert.ok(cells.has(`${source.x},${source.y+step}`),`three airflow cells at ${source.x},${source.y+step}`);
 }
 assert.equal(cells.has('5,1'),true,'airflow cells retain the PRTS map tile’s deployment rule');
 assert.equal(arena.grid[1][5].buildableType,'ALL');
});

test('final boss preparation switches to the boss map and restores it with saved placements cleared',()=>{
 const g=new NativeSession(NATIVE_DATA,{modeId:'mode_single_normal',bandId:'band_amiya',mapId:'act2autochess_m01',seed:42,bondBan:{bonds:[]}});
 const shop=Object.values(NATIVE_DATA.season.charShopChessDatas).find(row=>row.charId&&!row.isHidden),unit=g.gain(shop.chessId);
 let placed=false;for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(unit.uid,x,y))placed=g.deploy(unit.uid,x,y,0);
 assert.ok(placed,'normal-round placement');
 const bossRound=buildPhasePlan(NATIVE_DATA,g.s.modeId).filter(turn=>turn.isBossTurn&&!turn.isConditional).at(-1).round;
 g.s.round=bossRound-1;g.s.phase='intermission';
 assert.equal(g.advanceRound(),true);
 assert.equal(g.s.round,bossRound);assert.equal(g.s.mapVariant,'boss');assert.equal(g.map.cols,21);
 assert.equal(g.s.units[0].position,null,'units return to the bench for the joined boss board');
 assert.equal(g.canDeploy(unit.uid,5,1),true,'boss board accepts units on the actual airflow ground tile');
 const restored=NativeSession.restore(NATIVE_DATA,g.snapshot());
 assert.ok(restored);assert.equal(restored.map.cols,21);assert.equal(restored.s.mapVariant,'boss');
});

test('static bosses reserve and target the upper-right 2-column by 3-row area',()=>{
 for(const map of NATIVE_DATA.maps){
  const arena={...map,...map.bossArena},area=finalBossPlacementArea(arena,'enemy_1521_dslily'),point=finalBossSpawnPoint(arena,'enemy_1521_dslily');
  assert.deepEqual([area.firstColumn,area.firstRow,area.columns,area.rows],[arena.cols-2,0,2,3],map.stageId+' upper-right footprint');
  assert.deepEqual(point,{x:arena.cols-1,y:1},map.stageId+' PRTS 范围锚定在最右列格心');
  assert.equal(area.x,arena.cols-1.5,map.stageId+' reserved footprint center remains independent');
  assert.deepEqual([area.left,area.right,area.top,area.bottom],[arena.cols-2.5,arena.cols-.5,-.5,2.5],map.stageId+' targetable preview bounds');
 }
});

test('final battle has one looping boss and 30 tag-pool reinforcements scheduled every three seconds',()=>{
 const g=game(),b=g.battle,boss=b.s.enemies.find(e=>e.finalBoss);
 assert.equal(boss.id,'enemy_2016_csphtm');assert.equal(boss.hp,292500);
 assert.equal(b.s.limit,100+g.s.hp);assert.equal(b.s.total,31);assert.equal(b.s.queue.length,30);
 assert.deepEqual(b.s.queue.map(q=>q.at),Array.from({length:30},(_,i)=>(i+1)*3));
 assert.ok(b.s.queue.every(q=>(q.route===0||q.route===1)&&NATIVE_DATA.enemies[q.id]));
 const tagPools=g.s.waveRoster.types.map(type=>new Set(NATIVE_DATA.season.enemyInfoDict[type]||[]));assert.ok(b.s.queue.every(q=>tagPools.some(pool=>pool.has(q.id))));
 assert.ok(boss.route.length>=8);assert.equal(boss.route[0].x,boss.route.at(-1).x);assert.equal(boss.route[0].y,boss.route.at(-1).y);
});

test('Lucian skills get the final attack-cooldown frame and the blocked blink spawns its phantom',()=>{
 const setup=()=>{
  const g=game({operator:true}),b=g.battle,boss=b.s.enemies.find(e=>e.finalBoss),blocker=b.s.units[0],point=boss.route[2];
  blocker.x=point.x;blocker.y=point.y;boss.x=point.x;boss.y=point.y;boss.cmd=3;boss.block=blocker.uid;boss.action=null;boss.attackCooldown=1;
  boss.enemySkills.find(s=>s.prefab==='aoe').nextAt=1000;boss.enemySkills.find(s=>s.prefab==='blink').nextAt=0;
  return {b,boss,blocker,point};
 };
 let {b,boss,blocker,point}=setup();b.step();assert.ok(boss.crownBlink);assert.equal(boss.block,null);
 for(let i=0;i<20;i++)b.step();assert.equal(b.s.enemies.filter(e=>e.id==='enemy_2017_csphts').length,1);
 const phantom=b.s.enemies.find(e=>e.id==='enemy_2017_csphts');assert.equal(phantom.x,point.x);assert.equal(phantom.y,point.y);assert.ok(blocker.hp>0);
 ({b,boss}=setup());boss.enemySkills.find(s=>s.prefab==='aoe').nextAt=0;boss.enemySkills.find(s=>s.prefab==='blink').nextAt=1000;b.step();assert.equal(boss.enemyCast?.phantomAoe,true);
});

test('timeout fails the run; the saved remaining time reaches zero on the last frame',()=>{
 const g=game(),b=g.battle;b.s.frame=Math.ceil(b.s.limit*30)-1;b.s.time=b.s.frame/30;g.tick();
 assert.equal(g.s.phase,'finished');assert.equal(g.s.hp,0);assert.equal(g.s.runResult.kind,'final-boss');assert.equal(g.s.runResult.reason,'timeout');assert.equal(g.s.runResult.success,false);
});

test('a red-door escape costs one second; killing the boss ends immediately and preserves per-operator DPS samples',()=>{
 let g=game({operator:true}),b=g.battle,boss=b.s.enemies.find(e=>e.finalBoss),q=b.s.queue.shift();b.spawn(q);const add=b.s.enemies.at(-1),blue=g.map.grid.flatMap((row,y)=>row.map((tile,x)=>tile.tileKey==='tile_end'?{x,y}:null).filter(Boolean))[0];
 add.x=blue.x;add.y=blue.y;add.route=[{kind:'move',x:add.x,y:add.y},{kind:'move',x:add.x,y:add.y}];add.cmd=1;
 const before=b.s.limit;b.step();assert.equal(b.s.timePenalty,1);assert.equal(b.s.limit,before-1);
 const actor=b.s.units[0];dealDamage(b,{source:actor,target:boss,amount:100,type:'true'});assert.equal(b.s.damageTimeline[actor.uid][0],100);
 g=NativeSession.restore(NATIVE_DATA,g.snapshot());assert.ok(g);b=g.battle;boss=b.s.enemies.find(e=>e.finalBoss);assert.equal(g.s.finalBossId,'boss_5');assert.equal(b.s.damageTimeline[b.s.units[0].uid][0],100);
 const restoredActor=b.s.units[0];
 dealDamage(b,{source:restoredActor,target:boss,amount:boss.hp+1000,type:'true'});g.tick();
 assert.equal(g.s.phase,'finished');assert.equal(g.s.hp>0,true);assert.equal(g.s.runResult.kind,'final-boss');assert.equal(g.s.runResult.reason,'boss-killed');assert.equal(g.s.runResult.success,true);
 assert.ok(g.s.runResult.units.find(u=>u.uid===restoredActor.uid).dpsSamples[0]>0);
 assert.ok(!g.s.history.some(r=>r.kind==='training-dummy'));
});
