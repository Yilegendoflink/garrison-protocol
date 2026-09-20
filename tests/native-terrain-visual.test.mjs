import test from 'node:test';
import assert from 'node:assert/strict';
import {isolatedPlatform,tileLiftAmount} from '../dist/protocol.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';

// 隔离平台＝被围栏围住的**地面**：可部署、地面敌人的路线不经过（原表 passableMask 为 FLY_ONLY），
// 但它不是高台。用户 2026-09-19 报的问题：围栏格被当成高台抬起来画，画面上和高台分不出来。
const tiles=[];
for(const m of NATIVE_DATA.maps)for(let y=0;y<m.rows;y++)for(let x=0;x<m.cols;x++)tiles.push(m.grid[y][x]);

test('隔离平台按地面处理：永不抬升，只有可部署高台才抬升',()=>{
 const isolated=tiles.filter(isolatedPlatform);
 assert.ok(isolated.length>=50,`隔离平台样本太少（${isolated.length}），门禁可能已失效`);
 for(const t of isolated){
  assert.notEqual(t.heightType,'HIGHLAND','隔离平台不是高台');
  assert.notEqual(t.buildableType,'NONE','隔离平台要能部署');
  assert.equal(tileLiftAmount(t,40),0,'隔离平台必须画成地面，不能像高台那样抬升');
 }
 const highland=tiles.filter(t=>t.heightType==='HIGHLAND'&&t.buildableType!=='NONE');
 assert.ok(highland.length>=5,`可部署高台样本太少（${highland.length}）`);
 for(const t of highland){
  assert.equal(isolatedPlatform(t),false,'可部署高台不是隔离平台');
  assert.ok(tileLiftAmount(t,40)>0,'可部署高台仍然要抬升');
 }
 assert.equal(tileLiftAmount({heightType:'LOWLAND',buildableType:'ALL',tileKey:'tile_road'},40),0,'普通地面不抬升');
 assert.equal(tileLiftAmount({heightType:'HIGHLAND',buildableType:'NONE',tileKey:'tile_forbidden'},40),0,'不可部署的高台不抬升');
 assert.equal(tileLiftAmount(null,40),0);
 assert.equal(isolatedPlatform(null),false);
 assert.equal(isolatedPlatform({tileKey:'tile_fence_bound',heightType:'HIGHLAND',buildableType:'RANGED'}),false,'高台上的围栏仍按高台处理');
});

test('隔离平台所在格地面敌人不经过：passableMask 不是地面可通行',()=>{
 // 这批格子「路线不经过」的数据依据就是 passableMask=FLY_ONLY；采集若变成 ALL，说明判定该重新确认。
 const isolated=tiles.filter(isolatedPlatform);
 assert.ok(isolated.length,('没有隔离平台样本'));
 for(const t of isolated)assert.notEqual(t.passableMask,'ALL',`${t.tileKey} 变成了地面可通行格`);
});
