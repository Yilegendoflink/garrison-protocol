import test from 'node:test';
import assert from 'node:assert/strict';
import {drawDisplace} from '../dist/native-fx.js';
import {teleportActor,moveActor} from '../dist/native-effects.js';
import {openBattle,byId,enemy,deployNow} from './effects-harness.mjs';

function host(){
 const ops=[];
 const c={globalCompositeOperation:'',lineCap:'',strokeStyle:'',fillStyle:'',lineWidth:1,
  save(){},restore(){},setLineDash(){},createLinearGradient(){return{addColorStop(){}}},createRadialGradient(){return{addColorStop(){}}},
  fillRect(){},strokeRect(){},beginPath(){ops.push('beginPath');},moveTo(){},lineTo(){},closePath(){},quadraticCurveTo(){},
  stroke(){ops.push({op:'stroke',style:this.strokeStyle,width:this.lineWidth});},
  arc(){},ellipse(){ops.push({op:'ellipse',style:this.strokeStyle});},fill(){},translate(){},rotate(){},drawImage(){},fillText(){}};
 return {c,ops};
}
const Z={r:{width:800,height:520},tw:64,th:52,ox:0,oy:0};
const point=(x,y)=>({x:(x+.5)*64,y:(y+.5)*52});
const battle=events=>({s:{time:2,units:[],enemies:[],logicEffects:[],events}});

test('位移事件带起点坐标，原地与平行位移不画轨迹',()=>{
 const {b}=openBattle({chessId:'chess_char_4_22_a',skillIndex:0});
 const u=byId(b,'char_172_svrash');
 const e=enemy(b,{x:u.x+2,y:u.y,hp:1000});
 assert.equal(teleportActor(b,e,{x:u.x+3,y:u.y,source:u,mode:'pull'}),true);
 const ev=b.s.events.filter(x=>x.type==='move').at(-1);
 assert.equal(ev.x,u.x+3);assert.equal(ev.fromX,u.x+2);assert.equal(ev.fromY,u.y);
 const {c,ops}=host();
 assert.equal(drawDisplace(c,point,Z,b),true,'位移后应画轨迹');
 assert.ok(ops.some(o=>o.op==='stroke'),'应有连线');
 assert.ok(ops.some(o=>o.op==='ellipse'),'应有落点环');
 // 没有位移事件时不画
 assert.equal(drawDisplace(host().c,point,Z,battle([])),false);
 // 原地换位（起点=终点）不画
 assert.equal(drawDisplace(host().c,point,Z,battle([{type:'move',t:2,x:3,y:2,fromX:3,fromY:2,mode:'teleport'}])),false);
});

test('推退与拖拽都产生轨迹，方向由事件模式区分',()=>{
 const {b}=openBattle({chessId:'chess_char_4_22_a',skillIndex:0});
 const u=byId(b,'char_172_svrash');const e=enemy(b,{x:u.x+1,y:u.y,hp:1000});
 assert.equal(moveActor(b,e,u,'推动'),true,'推动应生效');
 const pushEvent=b.s.events.filter(x=>x.type==='move').at(-1);
 assert.equal(pushEvent.mode,'push');
 assert.equal(drawDisplace(host().c,point,Z,b),true,'推动后有轨迹');
 moveActor(b,e,u,'拖拽');
 assert.equal(b.s.events.filter(x=>x.type==='move').at(-1).mode,'pull');
});

test('换血事件画出两端脉动与连接线',()=>{
 const events=[{type:'hp-swap',t:2,x:2,y:2,targetUid:9,targetX:5,targetY:3}];
 const {c,ops}=host();
 assert.equal(drawDisplace(c,point,Z,battle(events)),true,'换血应有表现');
 assert.equal(ops.filter(o=>o.op==='ellipse').length,2,'两端各一圈');
 assert.equal(drawDisplace(host().c,point,Z,battle([{type:'hp-swap',t:0.5,x:1,y:1,targetX:2,targetY:2}])),false,'过期不画');
});

test('减少动效模式仍画但更淡',()=>{
 const events=[{type:'move',t:2,x:4,y:2,fromX:2,fromY:2,mode:'pull'}];
 const alpha=h=>{drawDisplace(h.c,point,Z,battle(events),{reduceFx:h.reduce});return h.ops.filter(o=>o.op==='stroke').reduce((a,o)=>a+Number((String(o.style).match(/([\d.]+)\)$/)||[0,0])[1]),0);};
 const normal={...host(),reduce:false},reduced={...host(),reduce:true};
 assert.ok(alpha(normal)>0&&alpha(reduced)>0,'都要可见');
 assert.ok(alpha(reduced)<alpha(normal),'减少动效应更淡');
});
