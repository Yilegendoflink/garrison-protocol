// 「从上方蓝门出的怪应该有一条自己的移动路线」（用户 2026-09-23）。
// 原表把每个出入口写成**独立路线**（起点不同、终点都是本半场的 `tile_end`），所以两条路线必须各走各的
// 通道；旧实现只按最短格数寻路，于是两条道在许多地图上贴成一条（上方门出来的怪看着跟下方门走同一条路）。
// 现在 `NativeBattle.path()` 给「偏离本路线起点所在行」的格子加 `LANE_ROW_PENALTY` 的代价：
// 本道没被隔离平台／阻隔工事堵死时不会换道，只有该行断了才拐到另一条道。
// 本文件遍历 8 张可选地图核对：两条道不同、各自先走自己那一行，并记录各图本道格数。
import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';
import {buildPhasePlan} from '../dist/protocol.js';
import {createWaveRoster,waveRng} from '../dist/native-wave-random.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';

const MODE='mode_single_normal',SEED=7;
const roster=createWaveRoster({random:waveRng(SEED),data:NATIVE_DATA,modeId:MODE});
const plan=buildPhasePlan(NATIVE_DATA,MODE);
function battle(mapId){
 const g=new NativeSession(NATIVE_DATA,{modeId:MODE,mapId,seed:SEED,waveRoster:roster,bondBan:{bonds:[]}});
 g.s.funds=9999;g.s.rewardPending=null;g.s.rewardQueue=[];
 assert.equal(g.perform('start'),true,g.lastError||'开战失败');
 const b=g.battle;b.prepareWaves(plan.find(t=>t.round===4));      // 第 4 回合起上下两个出入口都用
 return b;
}
const laneIndex=(b,row)=>(b.level.routes||[]).findIndex(r=>r.motionMode==='WALK'&&r.startPosition.row===row&&r.startPosition.col===10);
const cells=b=>b.path(b.level.routes[laneIndex(b,12)],false).map(p=>({x:p.x,y:p.y}));
const cellsOf=(b,row)=>b.path(b.level.routes[laneIndex(b,row)],false).map(p=>({x:p.x,y:p.y}));
const laneRun=(path,row)=>{let n=0;for(const p of path){if(p.y!==row)break;n++;}return n;};

test('8 张可选地图：上下两个出入口各有一条自己的通道',()=>{
 const maps=NATIVE_DATA.maps.filter(m=>m.weight>0);
 assert.equal(maps.length,8);
 const report=[];
 for(const map of maps){
  const b=battle(map.stageId);
  const top=laneIndex(b,12),bottom=laneIndex(b,9);
  assert.ok(top>=0&&bottom>=0,`${map.stageId} 应当同时有 (12,10) 与 (9,10) 两条路线`);
  const t=cellsOf(b,12),bo=cellsOf(b,9);
  assert.notDeepEqual(t,bo,`${map.stageId} 上方门与下方门不能是同一条路`);
  assert.deepEqual(t[0],{x:10,y:0},`${map.stageId} 上方门从 (10,0) 出发`);
  assert.deepEqual(bo[0],{x:10,y:3},`${map.stageId} 下方门从 (10,3) 出发`);
  // 两条路都不能从第一格就并到对面那条道上去
  assert.ok(laneRun(t,0)>=2,`${map.stageId} 上方门应当先沿上方通道走（实际 ${laneRun(t,0)} 格）`);
  assert.ok(laneRun(bo,3)>=2,`${map.stageId} 下方门应当先沿下方通道走（实际 ${laneRun(bo,3)} 格）`);
  report.push(`${map.stageId} 上${laneRun(t,0)}/下${laneRun(bo,3)}`);
 }
 assert.equal(report.length,8);
});

test('本道一直连通时必须走到底：不能从半路换到对面那条道',()=>{
 const maps=NATIVE_DATA.maps.filter(m=>m.weight>0),checked=[];
 for(const map of maps){
  const b=battle(map.stageId);
  for(const [row,laneY] of [[12,0],[9,3]]){
   // 本道从门口 (10,·) 到自己那一列是否每格都通；通了就必须一直走本道
   let contiguous=true;
   for(let x=10;x>=2&&contiguous;x--)if(!b.tileWalkable(x,laneY))contiguous=false;
   if(!contiguous)continue;
   const path=cellsOf(b,row),run=laneRun(path,laneY);
   checked.push(`${map.stageId}#${row}=${run}`);
   assert.ok(run>=9,`${map.stageId} 第 ${row} 行整条道都通，必须沿本道走到目标那一列（实际只走了 ${run} 格）`);
  }
 }
 assert.ok(checked.length>0,'至少要有一张图存在「整条道都通」的情况，否则这条门禁形同虚设');
});

test('本道没被堵死就不换道：m02 的上方门一直沿上方通道走到目标那一列才拐下去',()=>{
 const b=battle('act1autochess_m02');
 const t=cellsOf(b,12),leave=t.findIndex(p=>p.y!==0);
 assert.ok(leave>=5,`m02 上方通道连通，不应当半路换道（第 ${leave} 格才离开本道）`);
 assert.ok(t.slice(0,leave).every(p=>p.y===0),'离开本道之前的每一格都在本道上');
 assert.equal(t.at(-1).x,2);assert.equal(t.at(-1).y,3);
});

test('m01 是漏斗图：隔离平台带 + 第 9 行中段不可通行，两条道最后必然并到同一条通道',()=>{
 const b=battle('act1autochess_m01');
 // 第 9 行（下方通道）中段是 void，第 10/11 行（隔离平台）地面不可通行 → 只能走上方通道过桥
 for(const x of [5,6,7])assert.equal(b.tileWalkable(x,3),false,`(x=${x},y=3) 不可通行`);
 assert.equal(b.tileWalkable(8,1),true,'右侧有上下连通的竖井');
 const t=cellsOf(b,12),bo=cellsOf(b,9);
 assert.deepEqual(t.slice(-6),bo.slice(-6),'m01 两条道的尾段必然重合（地形决定，不是寻路问题）');
});
