// 炎佑「祛恶之焰」的表现口径（用户 2026-09-19）：
// 技能持续期间，炎佑与锁定目标之间一直有一条火光连线（不是只在命中那一瞬），目标死亡技能立刻结束后消失。
import test from 'node:test';import assert from 'node:assert/strict';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {tickLogic} from '../dist/native-effects.js';
import {drawFx} from '../dist/native-fx.js';
import {deployNow,enemy} from './effects-harness.mjs';

const uniqueBond=(id,count)=>[...new Map(Object.values(NATIVE_DATA.season.charShopChessDatas).filter(s=>s.charId&&NATIVE_DATA.season.charChessDataDict[s.chessId].bondIds.includes(id)).map(s=>[s.charId,s.chessId])).values()].slice(0,count);
function start(){
 const g=new NativeSession(NATIVE_DATA,{seed:1});g.s.funds=9999;g.s.capacity=16;
 for(const id of uniqueBond('yanShip',6))g.gain(id);
 g.s.rewardPending=null;g.s.rewardQueue=[];
 for(const u of g.s.units){let placed=false;for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++){if(g.s.units.some(v=>v.uid!==u.uid&&v.position?.x===x&&v.position?.y===y))continue;if(g.canDeploy(u.uid,x,y))placed=g.deploy(u.uid,x,y,0);}assert.ok(placed,'no tile for '+u.chessId);}
 assert.equal(g.perform('start'),true,g.lastError||'start failed');
 const b=g.battle;b.s.queue=[];b.s.limit=1e9;deployNow(b);
 return b;
}
// 记录线段（moveTo→lineTo/stroke）的画布
function host(){
 const ops=[],state={saves:0,restores:0,segments:[]};
 let cursor=null,pending=null;
 const c={globalCompositeOperation:'source-over',lineCap:'butt',strokeStyle:'',fillStyle:'',lineWidth:1,
  save(){state.saves++;},restore(){state.restores++;},setLineDash(){},
  createLinearGradient(){return {addColorStop(){}};},createRadialGradient(){return {addColorStop(){}};},
  fillRect(){},strokeRect(){},beginPath(){pending=null;},moveTo(x,y){cursor={x,y};},
  lineTo(x,y){if(cursor)pending={from:{...cursor},to:{x,y}};},
  closePath(){},quadraticCurveTo(){},arc(){},arcTo(){},ellipse(){},
  stroke(){if(pending){state.segments.push({...pending,style:this.strokeStyle,width:this.lineWidth});pending=null;}},
  fill(){},translate(){},rotate(){},drawImage(){},fillText(){}};
 return {c,ops,state};
}
const Z={r:{width:800,height:520},tw:64,th:52,ox:0,oy:0};
const point=(x,y)=>({x:Z.ox+(x+.5)*Z.tw,y:Z.oy+(y+.5)*Z.th});
const linkOf=(state,a,b)=>state.segments.find(s=>Math.hypot(s.from.x-a.x,s.from.y-a.y)<0.6&&Math.hypot(s.to.x-b.x,s.to.y-b.y)<0.6);

test('炎佑技能持续期间与目标之间一直有火光连线',()=>{
 const b=start(),g=b.s.summons.find(s=>s.type==='yan-guardian');
 const target=enemy(b,{x:g.x+2,y:g.y,hp:100000,threat:10,def:0,res:0});
 g.attackCooldown=999;tickLogic(b,0);
 assert.equal(g.yanSkillActive,true);
 const a=point(g.x,g.y),t1=point(target.x,target.y);
 // 连续几帧都应画连线（不是只在命中瞬间）
 for(const advance of [0,1/30,1/30,1/30]){
  b.s.time+=advance;tickLogic(b,advance||1/30);
  const h=host();drawFx(h.c,point,Z,b,{});
  assert.ok(linkOf(h.state,a,t1),`第 ${b.s.time.toFixed(2)} 秒应有炎佑→目标的连线`);
 }
 // reduceFx 下线照旧在（只是不打火星）
 const reduced=host();drawFx(reduced.c,point,Z,b,{reduceFx:true});
 assert.ok(linkOf(reduced.state,a,t1),'减少动效时连线仍要保留');
});

test('目标死亡后技能立刻结束，连线同时消失',()=>{
 const b=start(),g=b.s.summons.find(s=>s.type==='yan-guardian');
 const target=enemy(b,{x:g.x+2,y:g.y,hp:100000,threat:10,def:0,res:0});
 g.attackCooldown=999;tickLogic(b,0);
 const a=point(g.x,g.y),t1=point(target.x,target.y);
 const before=host();drawFx(before.c,point,Z,b,{});
 assert.ok(linkOf(before.state,a,t1),'结束前应有连线');
 target.hp=0;target.hidden=true;
 b.s.time+=1/30;tickLogic(b,1/30);
 assert.equal(g.yanSkillActive,false,'目标死亡后技能立刻结束');
 const after=host();drawFx(after.c,point,Z,b,{});
 assert.equal(linkOf(after.state,a,t1),undefined,'结束后不应再有连线');
});
