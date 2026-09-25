import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NATIVE_DATA as data} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {FPS} from '../dist/combat.js';
import {directionIndex,directionOf} from '../dist/protocol.js';
import {enemyAttackTargets} from '../dist/native-enemy-attacks.js';
import {blowerCells,onVentTile,standsOn,TERRAIN_TILES,tickTerrainEffects} from '../dist/native-environment.js';
import {NO_BOND_BAN} from './no-bond-ban.mjs';

// 特殊地块与地图装置（用户 2026-09-22：参考 PRTS wiki 的地图数据补全泥地、源石地板、吹风等效果与视觉）。
// 口径与数值依据 PRTS《卫戍协议：盟约 下半/战场一览》(oldid 387659) 与各装置页：
//   #04 活性源石＝tile_infection（5 分钟内每秒 70 真实伤害、攻击力 +20%、攻速 +20，数值取原地块黑板）
//   #05 源石流发生装置＝trap_013_blower（前方 3 格气流；干员同向 +30%／逆向 -30%；敌人同向 +50%、逆向 -50%）
//   #06 沼泽控制＝trap_098_mire ＋ tile_mire（每 3 秒叠一层：攻速/移速 -5%，至多 10 层，离开立刻清空）
//   #07 排气格栅＝tile_smog（置于其中的干员不会成为敌军远程攻击的目标）
//   #05/#08 深水区＝tile_deepsea（不可部署，平台格除外；敌方每秒 40 真实伤害、攻速 -60%、移速 60%）
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mapOf=id=>data.maps.find(m=>m.stageId===id);
const tilesOf=(map,key)=>{const out=[];for(let y=0;y<map.rows;y++)for(let x=0;x<map.cols;x++)if(map.grid[y][x].tileKey===key)out.push({x,y,tile:map.grid[y][x]});return out;};

function session(mapId){
 const g=new NativeSession(data,{bondBan:NO_BOND_BAN,seed:7,mapId,modeId:'mode_single_normal',bandId:'band_bldsk'});
 g.s.funds=9999;g.s.rewardPending=null;g.s.rewardQueue=[];
 return g;
}
// 在指定格按指定朝向放一名能落在那里的干员（返回干员本身，没找到就返回 null）。
function deployAt(g,x,y,dir=0){
 for(const shop of Object.values(data.season.charShopChessDatas)){
  if(!shop.charId||shop.isHidden)continue;
  const u=g.gain(shop.chessId);
  if(g.canDeploy(u.uid,x,y)){g.deploy(u.uid,x,y,dir);return u;}
  g.s.units=g.s.units.filter(v=>v.uid!==u.uid);
 }
 return null;
}
// 对照组：找一块不是 avoidKey 的可部署格放一名干员（用来证明效果是地块给的，不是全局开关）。
function deployElsewhere(g,avoidKey,dir=0){
 for(let y=0;y<g.map.rows;y++)for(let x=0;x<g.map.cols;x++){
  if(g.map.grid[y][x].tileKey===avoidKey)continue;
  const u=deployAt(g,x,y,dir);
  if(u)return u;
 }
 return null;
}
// 开战并留一个不参与结算的木桩：没有敌人时战斗会立刻 finished，step() 直接 return，环境 tick 就不再跑。
function battleOn(g){
 // 发放同名干员会挂起三合一奖励候选，start 会被挡；测试只关心地块，直接清掉队列。
 g.s.rewardPending=null;g.s.rewardQueue=[];
 assert.ok(g.perform('start'),g.lastError||'start failed');
 const b=g.battle;b.s.queue=[];b.s.limit=1e9;
 b.s.enemies.push({uid:b.s.nextId++,id:'probe-keepalive',name:'probe',x:-8,y:-8,hp:1e12,maxHp:1e12,atk:0,def:0,res:0,statuses:[],hidden:true,untargetable:true,invulnerable:true,block:null,leak:1,interval:999,attackSpeed:100,attackCooldown:0,action:null,deployGen:0,flying:false,trainingDummy:true});
 return b;
}
const seconds=b=>(n)=>{for(let i=0;i<Math.round(n*FPS);i++)b.step();};
const tileKeyAt=(b,actor)=>b.map.grid[Math.round(actor.y)]?.[Math.round(actor.x)]?.tileKey;

test('特殊地块的数据口径：每张战场的地块/环境配置都与 PRTS 与原表黑板逐项对齐',()=>{
 // 本期 11 张战场里出现过的特殊地块只有这四种；新增地块必须同时补 TERRAIN_TILES 与逻辑（门禁）。
 const specialKeys=new Set();
 for(const map of data.maps)for(let y=0;y<map.rows;y++)for(let x=0;x<map.cols;x++){
  const key=map.grid[y][x].tileKey;
  if(['tile_infection','tile_mire','tile_smog','tile_deepsea','tile_fence_bound'].includes(key))specialKeys.add(key);
 }
 assert.deepEqual([...specialKeys].sort(),['tile_deepsea','tile_fence_bound','tile_infection','tile_mire','tile_smog']);
 assert.deepEqual(TERRAIN_TILES,{originium:'tile_infection',mire:'tile_mire',vent:'tile_smog',deepWater:'tile_deepsea'},'地块种类登记表要覆盖上面这些 key');
 // #04 活性源石：数值来自 tile_infection 的黑板（damage/atk/attack_speed/duration）。
 assert.deepEqual(mapOf('act1autochess_m04').environment.originium,{damage:70,atk:.2,attackSpeed:20,duration:300,source:'level_act1autochess_m04.json'});
 assert.equal(tilesOf(mapOf('act1autochess_m04'),'tile_infection').length,2,'活性源石格要真的在棋盘上');
 // #05 源石流发生装置：8 台都在，位置不按裁切过滤（框外那一行才是吹进战场的）。
 const blower=mapOf('act2autochess_m01');
 assert.deepEqual({...blower.environment.blower,source:undefined},{skillId:'sktok_blower',level:2,equal:.3,vertical:0,opposite:-.3,equalMove:.5,oppositeMove:-.5,length:3,source:undefined});
 assert.equal(blower.windSources.length,8,'气流源必须全量保留（build-protocol 不裁切）');
 assert.ok(blower.windSources.some(s=>s.y<0),'a2m01 的有效气流源在裁切框外（第 13 行）');
 assert.equal(blower.windSources.filter(s=>directionIndex(s.direction)===1).length,8,'全部朝下（DOWN＝屏幕向下）');
 // #06 沼泽控制：数值取 sktok_mire 黑板。
 assert.deepEqual({...mapOf('act2autochess_m02').environment.mire,source:undefined},{skillId:'sktok_mire',level:1,attackSpeed:-.05,moveSpeed:-.05,maxStack:10,interval:3,source:undefined});
 assert.ok(tilesOf(mapOf('act2autochess_m02'),'tile_mire').length>0);
 // #07 排气格栅；#05/#08 深水（涨潮控制黑板）。
 assert.ok(tilesOf(mapOf('act2autochess_m03'),'tile_smog').length>0);
 for(const id of ['act1autochess_m05','act2autochess_m04']){
  const cfg=mapOf(id).environment.deepWater;
  assert.equal(cfg.damage,40);assert.equal(cfg.moveScale,.6);assert.equal(cfg.attackSpeedScale,.4);
 }
 // 有气流的地图才登记环境气流，避免给别的图凭空加风。
 for(const map of data.maps)assert.equal(!!map.environment?.blower,map.stageId==='act2autochess_m01',map.stageId+' 的环境配置要与原图一致');
});

test('深水区不可部署，水上平台格仍然可以站人（PRTS：Deep Water Zone Deployable? No）',()=>{
 for(const id of ['act1autochess_m05','act2autochess_m04']){
  const map=mapOf(id);
  const deep=tilesOf(map,'tile_deepsea');
  assert.ok(deep.length>0);
  for(const {tile} of deep)if(!tile.device)assert.equal(tile.buildableType,'NONE',`${id} 的深水格不可部署`);
  const platforms=deep.filter(({tile})=>tile.device==='trap_040_canoe');
  for(const {tile} of platforms)assert.equal(tile.buildableType,'ALL','平台格可部署');
  // canDeploy 走的是同一份数据：有平台格就一定能站人；没有平台的深水格一定站不了。
  const g=session(id);
  if(platforms.length){
   const platform=platforms[0];
   assert.ok(deployAt(g,platform.x,platform.y),`${id} 平台格要能部署`);
  }
  const plain=deep.find(({tile})=>!tile.device);
  if(plain){
   const plainSession=session(id);
   assert.equal(deployAt(plainSession,plain.x,plain.y),null,`${id} 深水格不该能部署`);
  }
 }
 assert.ok(tilesOf(mapOf('act2autochess_m04'),'tile_deepsea').some(({tile})=>!tile.device),'a2m04 要有无平台的深水格（门禁样本）');
});

test('活性源石：站在上面每秒 70 真实伤害、攻击力 +20%、攻速 +20，离开就没了',()=>{
 const g=session('act1autochess_m04');
 const cell=tilesOf(g.map,'tile_infection')[0];
 const unit=deployAt(g,cell.x,cell.y);
 assert.ok(unit,'活性源石格要能部署');
 const second=deployElsewhere(g,'tile_infection');
 assert.ok(second,'对照组要能放下');
 const b=battleOn(g);const tick=seconds(b);
 const on=b.s.units.find(u=>u.uid===unit.uid),off=b.s.units.find(u=>u.uid===second.uid);
 assert.equal(tileKeyAt(b,on),'tile_infection');
 const baseAtk=b.stats(on).atk,baseSpeed=b.stats(on).attackSpeed,hp0=on.hp;
 tick(1.1);
 assert.equal(on.originium,true,'站在活性源石上要打标记');
 assert.ok(Math.abs(b.stats(on).atk/baseAtk-1.2)<1e-6,'攻击力 +20%');
 assert.ok(Math.abs(b.stats(on).attackSpeed-(baseSpeed+20))<1e-6,'攻速 +20');
 assert.ok(hp0-on.hp>=70&&hp0-on.hp<=140,`每秒 70 真实伤害（实测 ${(hp0-on.hp).toFixed(1)}）`);
 assert.ok(off.originium===false,'不在活性源石上的干员不该吃这条');
 assert.equal(off.hp,off.maxHp,'没站在上面的干员不掉血');
 // 移动到场外（换到普通地面）后应该立刻失去增益。
 on.x=off.x+ (off.x<5?1:-1);on.y=off.y;
 tick(1/FPS+1e-6);
 assert.equal(on.originium,false,'离开地块要立刻失效');
 assert.ok(Math.abs(b.stats(on).atk/baseAtk-1)<1e-6);
});

test('沼泽地段：每 3 秒叠一层攻速/移速 -5%，最多 10 层，离开立刻清空',()=>{
 const g=session('act2autochess_m02');
 const cells=tilesOf(g.map,'tile_mire');
 let unit=null;
 for(const cell of cells){unit=deployAt(g,cell.x,cell.y);if(unit)break;}
 assert.ok(unit,'沼泽格要能部署');
 const b=battleOn(g);const tick=seconds(b);
 const u=b.s.units.find(v=>v.uid===unit.uid);
 assert.equal(tileKeyAt(b,u),'tile_mire');
 const base=b.stats(u).attackSpeed;
 tick(2.9);
 assert.equal(u.mireStacks||0,0,`不到 3 秒不该叠层（实测 ${u.mireStacks}）`);
 tick(.2);
 assert.equal(u.mireStacks,1,'3 秒叠第一层');
 tick(3);
 assert.equal(u.mireStacks,2);
 tick(3*9);
 assert.equal(u.mireStacks,10,'最多 10 层');
 assert.ok(Math.abs(u.envAttackSpeedScale-.5)<1e-6,'10 层 = 攻速 ×0.5');
 assert.ok(Math.abs(b.stats(u).attackSpeed-base*.5)<1e-6,`攻速要按层数下降（${b.stats(u).attackSpeed} vs ${base*.5}）`);
 // 离开沼泽：立刻清空（PRTS 原文）。
 const leave=b.map.grid[Math.round(u.y)]?.[Math.round(u.x)-1];
 assert.ok(leave);
 u.x=Math.round(u.x)-1;
 tick(1/FPS+1e-6);
 assert.equal(u.mireStacks,0);
 assert.ok(Math.abs(b.stats(u).attackSpeed-base)<1e-6,'离开后攻速立刻恢复');
});

test('排气格栅：站在格栅上的干员不会成为敌军远程攻击的目标',()=>{
 const g=session('act2autochess_m03');
 const vent=tilesOf(g.map,'tile_smog')[0];
 const onVent=deployAt(g,vent.x,vent.y);
 assert.ok(onVent,'排气格栅格要能部署');
 const control=deployElsewhere(g,'tile_smog');
 assert.ok(control,'对照组要能放下');
 const b=battleOn(g);const tick=seconds(b);
 const guarded=b.s.units.find(u=>u.uid===onVent.uid),free=b.s.units.find(u=>u.uid===control.uid);
 tick(1/FPS+1e-6);
 assert.equal(onVentTile(b,guarded),true);
 assert.equal(guarded.vented,true,'视觉角标也要有');
 const ranged={uid:b.s.nextId++,id:'ranged-probe',name:'r',x:-5,y:-5,hp:100,maxHp:100,atk:10,def:0,res:0,statuses:[],hidden:false,block:null,leak:1,interval:1,attackSpeed:100,attackCooldown:0,action:null,deployGen:0,flying:false,ranged:true,range:99,canAttack:true,enemyAttack:{}};
 b.s.enemies.push(ranged);
 const targets=enemyAttackTargets(b,ranged);
 assert.ok(!targets.some(t=>t.uid===guarded.uid),'格栅上的干员不能被远程选为目标');
 assert.ok(targets.some(t=>t.uid===free.uid),'别的干员照旧会被选（不是把远程索敌整个关掉）');
});

test('源石流发生装置：干员同向 +30%／逆向 -30%／垂直 0，敌人同向 +50%／逆向 -50%',()=>{
 const map=mapOf('act2autochess_m01');
 const cells=[...blowerCells(map).values()];
 assert.equal(cells.length,6,'前方 3 格 × 裁切内的 2 台装置');
 assert.ok(cells.every(c=>map.grid[c.y][c.x]),'气流格必须落在棋盘内（裁切外那台只留有效格）');
 assert.ok(cells.every(c=>c.dy===1),'装置朝下→气流朝屏幕下方');
 // 干员：同向/逆向/垂直。
 const windAtk=dir=>{
  const g=session('act2autochess_m01');
  const u=deployAt(g,cells[0].x,cells[0].y,dir);
  assert.ok(u,'气流格要能部署');
  const b=battleOn(g);seconds(b)(1/FPS+1e-6);
  const unit=b.s.units.find(v=>v.uid===u.uid);
  return {relation:unit.windMove,ratio:unit.windAtkRatio,atk:b.stats(unit).atk,base:b.profile(unit).attributes.atk,b};
 };
 const same=windAtk(1),against=windAtk(3),vertical=windAtk(0);
 assert.equal(same.relation,1);assert.ok(Math.abs(same.ratio-.3)<1e-6);
 assert.ok(Math.abs(same.atk/same.base-1.3)<1e-6,`同向攻击力 +30%（${same.atk} vs ${same.base}）`);
 assert.equal(against.relation,-1);assert.ok(Math.abs(against.ratio+.3)<1e-6);
 assert.ok(Math.abs(against.atk/against.base-.7)<1e-6,'逆向攻击力 -30%');
 assert.equal(vertical.relation,0);assert.equal(vertical.ratio,0);
 assert.ok(Math.abs(vertical.atk/vertical.base-1)<1e-6,'垂直不吃修正');
 // 敌人：同向/逆向/垂直的移速（数值取原表等级 2 的 ±50%）。
 const enemyWind=move=>{
  const g=session('act2autochess_m01');const b=battleOn(g);seconds(b)(1/FPS+1e-6);
  const e={uid:b.s.nextId++,id:'wind-probe',name:'e',x:cells[0].x,y:cells[0].y,hp:100,maxHp:100,atk:0,def:0,res:0,statuses:[],hidden:false,block:null,leak:1,interval:5,attackSpeed:100,attackCooldown:0,action:null,deployGen:0,flying:false,moveDirection:move};
  b.s.enemies.push(e);b.step();
  return {relation:e.windMove,scale:e.envMoveScale};
 };
 assert.deepEqual(enemyWind({x:0,y:1}),{relation:1,scale:1.5},'同向移动的敌人移速 +50%');
 assert.deepEqual(enemyWind({x:0,y:-1}),{relation:-1,scale:.5},'逆向移动的敌人移速 -50%');
 assert.deepEqual(enemyWind({x:1,y:0}),{relation:0,scale:1},'垂直移动不吃修正');
});

test('接线与视觉门禁：地块/装置有画法、图例按地图补项，环境 tick 在真实 step 里跑',async()=>{
 const play=await readFile(path.join(root,'dist/native-play.js'),'utf8');
 const css=await readFile(path.join(root,'dist/native.css'),'utf8');
 const env=await readFile(path.join(root,'dist/native-environment.js'),'utf8');
 const battle=await readFile(path.join(root,'dist/native-battle.js'),'utf8');
 assert.match(env,/export const TERRAIN_TILES=Object\.freeze\(\{originium:'tile_infection',mire:'tile_mire',vent:'tile_smog',deepWater:'tile_deepsea'\}\)/,'地块种类只在这张表里登记');
 for(const fn of ['drawWaterTile','drawMireTile','drawOriginiumTile','drawVentTile'])assert.match(play,new RegExp(`function ${fn}\\(`),fn+' 要画出对应地块');
 for(const id of ['trap_013_blower','trap_040_canoe','trap_032_mound','trap_1107_acblock','trap_1106_achplat','trap_218_fttree'])assert.match(play,new RegExp(`id==='${id}'`),id+' 要有装置画法');
 assert.match(play,/function drawWindCells\(c,z,map,now\)/,'气流要画流动箭头');
 assert.match(play,/function drawTerrainBadges\(c,p,u,size\)/,'地块状态要有头顶角标');
 assert.match(play,/drawTerrainBadges\(c,p,u,size\)/,'干员绘制里要调用角标');
 assert.match(play,/function terrainLegend\(map\)/,'图例要按当前地图生成');
 assert.match(play,/\$\{terrainLegend\(g\.map\)\}/,'图例必须接线到棋盘视图');
 assert.match(css,/\.native-terrain-legend \.terrain-originium\{/,'图例要有活性源石色块');
 assert.match(css,/\.native-terrain-legend \.terrain-mire\{/,'图例要有沼泽色块');
 assert.match(css,/\.native-terrain-legend \.terrain-vent\{/,'图例要有排气格栅色块');
 assert.match(css,/\.native-terrain-legend \.terrain-water\{/,'图例要有深水色块');
 // 环境 tick 必须在真实 step 里调用（不是只在测试里手动调）。
 assert.match(battle,/tickDeepWater\(this\);tickSandStorm\(this\);tickTerrainEffects\(this\);/,'step 里要一起跑地块效果');
 // 移动/攻速的数值消费者只读 env* 字段。
 assert.match(battle,/\*\(e\.envAttackSpeedScale\?\?1\)/,'敌方攻速要乘 mire 的比例');
 assert.match(battle,/\(u\.envAttackSpeed\|\|0\)/,'我方攻速要加上活性源石的 +20');
 const combat=await readFile(path.join(root,'dist/native-combat.js'),'utf8');
 assert.match(combat,/\(e\.envMoveScale\?\?1\)/,'敌方移速要乘地块/气流比例');
 const fear=await readFile(path.join(root,'dist/native-enemy-fear.js'),'utf8');
 assert.match(fear,/\(e\.envMoveScale\?\?1\)/,'恐惧路线也要吃地块移速');
 const traits=await readFile(path.join(root,'dist/native-enemy-traits.js'),'utf8');
 assert.match(traits,/\(e\.envMoveScale\?\?1\)/,'冲锋计值也要吃地块移速');
 const attacks=await readFile(path.join(root,'dist/native-enemy-attacks.js'),'utf8');
 assert.match(attacks,/!onVentTile\(battle,u\)/,'敌方远程索敌要排除格栅上的干员');
});
