import test from 'node:test';
import assert from 'node:assert/strict';
import {enemyOverlapLayout,enemyHealthLabel} from '../dist/native-enemy-overlap.js';
const bounds={x:0,y:0,w:500,h:300};
const entry=(uid,x=250,y=160,extra={})=>({enemy:{uid,id:'same',hp:100,maxHp:100,x:5,y:3,...extra},x,y,size:40});

test('2–12名重叠按出生顺序分组，头像各有小偏移，不改实际敌人',()=>{
 for(const count of [1,2,3,4,8,12]){
  const entries=Array.from({length:count},(_,i)=>entry(count-i)),before=structuredClone(entries),layout=enemyOverlapLayout(entries,bounds);
  assert.deepEqual(entries,before);assert.equal(layout.groups.length,count===1?0:1);
  if(count>1){assert.deepEqual(layout.groups[0].entries.map(v=>v.enemy.uid),Array.from({length:count},(_,i)=>i+1));const offsets=[...layout.positions.values()];assert.equal(new Set(offsets.map(v=>v.x+','+v.y)).size,count);assert.ok(offsets.every(v=>Math.hypot(v.x,v.y)<=13));}
 }
});

test('死亡、隐藏、Boss和木桩不混入常规重叠计数',()=>{
 const entries=[entry(1),entry(2),entry(3,250,160,{hp:0}),entry(4,250,160,{hidden:true}),entry(5,250,160,{finalBoss:true}),entry(6,250,160,{trainingDummy:true})];
 const layout=enemyOverlapLayout(entries,bounds);assert.deepEqual(layout.groups[0].entries.map(v=>v.enemy.uid),[1,2]);assert.equal(layout.positions.has(5),false);
});

test('移动合并与拆开带滞回，避免连通链把整条路线合成一组',()=>{
 const first=enemyOverlapLayout([entry(1,100),entry(2,120)],bounds);assert.equal(first.groups.length,1);
 const boundary=enemyOverlapLayout([entry(1,100),entry(2,133)],bounds,first.groups);assert.equal(boundary.groups.length,1);
 const separated=enemyOverlapLayout([entry(1,100),entry(2,140)],bounds,boundary.groups);assert.equal(separated.groups.length,0);
 const chain=enemyOverlapLayout([entry(1,100),entry(2,124),entry(3,148),entry(4,172)],bounds);assert.deepEqual(chain.groups.map(g=>g.entries.length),[2,2]);
});

test('边缘堆栈和相邻堆栈避让，触屏计数入口的高度计入布局',()=>{
 for(const coarse of [false,true])for(const [x,y] of [[0,0],[499,299],[250,160]]){const g=enemyOverlapLayout(Array.from({length:8},(_,i)=>entry(i+1,x,y)),{...bounds,coarse}).groups[0],p=g.plate;assert.ok(p.x>=0&&p.y>=0&&p.x+p.w<=500&&p.y+p.h<=300);assert.equal(p.h,coarse?132:108);}
 const groups=enemyOverlapLayout([entry(1,200),entry(2,200),entry(3,250),entry(4,250)],bounds).groups;
 const [a,b]=groups.map(g=>g.plate);assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y);
});

test('逐名生命不做平均；次数怪显示次数',()=>{
 assert.equal(enemyHealthLabel({hp:23,maxHp:100}),'23%');assert.equal(enemyHealthLabel({hp:83,maxHp:100}),'83%');assert.equal(enemyHealthLabel({hp:3,maxHp:6,hitCountHp:true}),'3次');
});
