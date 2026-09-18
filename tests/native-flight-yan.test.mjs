import test from 'node:test';
import assert from 'node:assert/strict';
import { NATIVE_DATA } from '../dist/runtime-data.js';
import { NativeSession } from '../dist/native-session.js';
import { deployNow, enemy } from './effects-harness.mjs';

const uniqueBond=(id,count)=>[...new Map(Object.values(NATIVE_DATA.season.charShopChessDatas).filter(s=>s.charId&&NATIVE_DATA.season.charChessDataDict[s.chessId].bondIds.includes(id)).map(s=>[s.charId,s.chessId])).values()].slice(0,count);
function yanBattle(){
 const g=new NativeSession(NATIVE_DATA,{seed:1});g.s.funds=9999;g.s.capacity=16;
 for(const id of uniqueBond('yanShip',6))g.gain(id);
 g.s.rewardPending=null;g.s.rewardQueue=[];
 for(const u of g.s.units){let placed=false;for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++){if(g.s.units.some(v=>v.uid!==u.uid&&v.position?.x===x&&v.position?.y===y))continue;if(g.canDeploy(u.uid,x,y))placed=g.deploy(u.uid,x,y,0);}assert.ok(placed,'no tile for '+u.chessId);}
 assert.equal(g.perform('start'),true,g.lastError||'start failed');
 const b=g.battle;b.s.queue=[];b.s.limit=1e9;deployNow(b);return b;
}
const guardianOf=b=>b.s.summons.find(s=>s.type==='yan-guardian');
const advance=(b,seconds)=>{for(let i=0;i<Math.round(seconds*30);i++)b.step();};

test('六人炎盟约召唤的炎佑是连续坐标自由飞行单位',()=>{
 const b=yanBattle();
 const g=guardianOf(b);
 assert.ok(g,'应召唤出炎佑');
 assert.equal(g.range,2,'攻击范围应为 2.0');
 assert.equal(g.yanRange,2);
 assert.equal(g.moveSpeed,1,'移动速度取单位数据的 1 格/秒');
 assert.equal(g.motion,'FLY');
 // 连续坐标可由小数推进（不吸附格心）
 assert.equal(Number.isFinite(g.x),true);
});

test('炎佑朝仇恨最高的敌人自由飞行，进入 2.0 格后停下',()=>{
 const b=yanBattle();
 const g=guardianOf(b);
 // 放一个远处敌人
 const far=enemy(b,{x:1,y:1,hp:1e9,def:0,atk:0});
 g.x=8.5;g.y=1.5;
 const start={x:g.x,y:g.y};
 advance(b,1);
 const afterOne={x:g.x,y:g.y};
 const movedOne=Math.hypot(afterOne.x-start.x,afterOne.y-start.y);
 assert.ok(movedOne>0.5,'1 秒应移动约 1 格（含加速）实际 '+movedOne.toFixed(2));
 assert.ok(Math.abs(movedOne-1)<0.5,'速度应约 1 格/秒，实际 '+movedOne.toFixed(2));
 // 位置必须是连续的（出现非 0 小数）
 assert.equal(Number.isInteger(g.x)&&Number.isInteger(g.y),false,'不得吸附到格心');

 // 继续飞，直到进入射程
 advance(b,8);
 const gap=Math.hypot(g.x-far.x,g.y-far.y);
 assert.ok(gap<=2.05,'应停在 2.0 格内，实际 '+gap.toFixed(2));
 // 停下后不应继续靠近（速度归零）
 const parked={x:g.x,y:g.y};
 advance(b,1);
 const drift=Math.hypot(g.x-parked.x,g.y-parked.y);
 assert.ok(drift<0.35,'入射程后应停下，实际漂移 '+drift.toFixed(2));
});

test('炎佑在场上无可选敌人时也会自由飞行（漫游随机地块）',()=>{
 const b=yanBattle();
 const g=guardianOf(b);
 // 留一个隐藏且不可选的占位敌人：否则“队列空且无敌人”会让战斗在第 1 帧判负结束
 enemy(b,{hp:1e12,x:-8,y:-8,trainingDummy:true,hidden:true,untargetable:true,invulnerable:true});
 g.x=5;g.y=3;
 const start={x:g.x,y:g.y};
 advance(b,3);
 const moved=Math.hypot(g.x-start.x,g.y-start.y);
 assert.ok(b.s.finished===false,'占位敌人应避免战斗提前结束');
 assert.ok(moved>0.5,'无敌人时也应移动，实际 '+moved.toFixed(2));
});

test('炎佑的攻击只作用于 2.0 格内的敌人',()=>{
 const b=yanBattle();
 const g=guardianOf(b);
 g.x=5.5;g.y=3.5;
 const near=enemy(b,{x:6.2,y:3.5,hp:1e9,def:0,atk:0});
 const far=enemy(b,{x:0.5,y:0.5,hp:1e9,def:0,atk:0});
 g.attackCooldown=0;
 advance(b,0.2);
 assert.ok(near.hp<1e9,'近处敌人应受击');
 assert.equal(far.hp,1e9,'远处敌人不应受击（射程仅 2.0）');
});
