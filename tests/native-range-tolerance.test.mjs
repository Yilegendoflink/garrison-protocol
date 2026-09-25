// 「范围内」判定必须用**连续坐标**：敌人的 x/y 是逐帧插值的连续值（`native-combat.advanceEnemy` 在
// 格子之间做线性移动），只有到点停顿那一刻才恰好是整数格心。所以「这个圈／这个范围包不包含它」只能像
// `containsTarget`／`battle.inside` 那样按「目标落在哪一格」算，不能拿格心做 `c.x===e.x` 的相等比较。
// 用户 2026-09-23 报的「银灰／初雪范围内冻结叠层依然无法触发」就是这条：移动中的敌人永远判不进范围。
// 本文件把这条口径钉住：行为（zoneContains／summonInRange／地灵 S2 的实际结算）＋ 源码门禁（禁止退回相等比较）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openBattle,deployNow,enemy,byId} from './effects-harness.mjs';
import {zoneContains,summonInRange} from '../dist/native-effects.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const runTo=(b,t)=>{let guard=0;while(b.s.time<t-1e-9&&!b.s.finished){if(++guard>30000)throw Error('时间未收敛');b.step();}};
const SKGOAT='chess_char_1_11_a';                 // 地灵：S2「流沙化」是 rangeUid = 自身攻击范围的圈
const solo=skillIndex=>{const {b}=openBattle([{chessId:SKGOAT,skillIndex}]);deployNow(b);return {b,u:byId(b,'char_183_skgoat')};};
// 范围里的一格（尽量不取自身格）与一个肯定在范围外的坐标
function spots(b,u){
 const cells=b.range(u,true),cell=cells.find(c=>!(c.x===u.x&&c.y===u.y))||cells[0];
 return {cell,outside:{x:Math.max(...cells.map(c=>c.x))+4,y:cell.y}};
}

test('按格判定的圈子（rangeUid）对移动中的敌人同样命中',()=>{
 const {b,u}=solo(1);
 const {cell,outside}=spots(b,u);
 const fx={kind:'zone',sourceUid:u.uid,x:u.x,y:u.y,radius:2,rangeUid:u.uid,values:{}};
 const atCell=enemy(b,{x:cell.x,y:cell.y,hp:1e6});          // 整数格心：一直都能命中
 const moving=enemy(b,{x:cell.x+.42,y:cell.y,hp:1e6});      // 移动中：旧实现漏掉的就是这种
 const far=enemy(b,{x:outside.x,y:outside.y,hp:1e6});
 assert.equal(zoneContains(b,fx,atCell),true,'整数格心在范围内');
 assert.equal(zoneContains(b,fx,moving),true,'同一格内的连续坐标也算在范围内');
 assert.equal(zoneContains(b,fx,far),false,'范围外仍然不算');
 assert.equal(b.inside(u,moving,true),true,'与 battle.inside 同一口径');
});

test('召唤物的攻击／治疗范围同样按连续坐标判定',()=>{
 const {b,u}=solo(1);
 const summon={uid:999001,kind:'summon',x:u.x,y:u.y,dir:0,rangeId:'1-1'};   // 自身格 + 身前格
 const front=enemy(b,{x:u.x+1,y:u.y,hp:1e6});
 const moving=enemy(b,{x:u.x+1.42,y:u.y,hp:1e6});
 const behind=enemy(b,{x:u.x-3.5,y:u.y,hp:1e6});
 assert.equal(summonInRange(b,summon,front),true,'身前格');
 assert.equal(summonInRange(b,summon,moving),true,'身前格内的连续坐标');
 assert.equal(summonInRange(b,summon,behind),false,'背后不算（rangeId 1-1 不含）');
});

test('地灵 S2「流沙化」：移动中的敌人也吃停顿（rangeUid 圈的完整链路）',()=>{
 const {b,u}=solo(1);
 const {cell,outside}=spots(b,u);
 const moving=enemy(b,{x:cell.x+.42,y:cell.y,hp:1e6,def:0,res:0});
 const far=enemy(b,{x:outside.x,y:outside.y,hp:1e6,def:0,res:0});
 u.sp=b.spCost(u);b.activate(u);
 assert.equal(b.skillActive(u),true,'开技');
 const sluggish=e=>(e.statuses||[]).some(s=>s.kind==='sluggish');
 assert.equal(sluggish(moving),true,'开技那一刻就对范围内（连续坐标）的敌人施加停顿');
 assert.equal(sluggish(far),false,'范围外的敌人不吃');
 runTo(b,2.2);                                   // 圈每 interval 秒结算一次
 assert.equal(sluggish(moving),true,'圈逐秒结算照旧命中');
 assert.equal(sluggish(far),false,'范围外一直不吃');
});

test('源码门禁：native 侧不许再拿格心做相等比较来判范围',()=>{
 const banned=/\.some\(\s*c\s*=>\s*c\.x===|c\.x===\w+\.x&&c\.y===\w+\.y/;
 const files=fs.readdirSync(path.join(root,'dist')).filter(f=>/^native-.*\.js$/.test(f));
 const hits=[];
 for(const file of files){
  const text=fs.readFileSync(path.join(root,'dist',file),'utf8');
  text.split('\n').forEach((line,index)=>{if(banned.test(line))hits.push(file+':'+(index+1)+' '+line.trim().slice(0,120));});
 }
 assert.deepEqual(hits,[],'范围判定要写 containsTarget／battle.inside（或至少 Math.round 到格），不要写格心相等');
});
