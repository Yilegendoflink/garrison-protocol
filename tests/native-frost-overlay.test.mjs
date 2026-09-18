import test from 'node:test';
import assert from 'node:assert/strict';
import {drawFrostOverlay,frostKindOf} from '../dist/native-fx.js';

function fakeCanvas(){
 const ops=[];
 const c={fillStyle:'',strokeStyle:'',lineWidth:1,globalAlpha:1,font:'',textAlign:'',
  save(){ops.push({op:'save'});},restore(){ops.push({op:'restore'});},
  fillRect(x,y,w,h){ops.push({op:'fillRect',x,y,w,h,style:this.fillStyle});},
  strokeRect(x,y,w,h){ops.push({op:'strokeRect',x,y,w,h,style:this.strokeStyle});}};
 return {c,ops};
}

test('frostKindOf picks frozen over cold and ignores unrelated states',()=>{
 assert.equal(frostKindOf({statuses:[]}),null);
 assert.equal(frostKindOf({statuses:[{kind:'stun'}]}),null);
 assert.equal(frostKindOf({statuses:[{kind:'cold'}]}),'cold');
 assert.equal(frostKindOf({statuses:[{kind:'frozen'}]}),'frozen');
 assert.equal(frostKindOf({statuses:[{kind:'cold'},{kind:'frozen'}]}),'frozen');
 assert.equal(frostKindOf(null),null);
});

test('cold paints a light ice tint and frozen a deeper one',()=>{
 const box={x:10,y:20,w:40,h:40};
 const cold=fakeCanvas();
 assert.equal(drawFrostOverlay(cold.c,{statuses:[{kind:'cold'}]},box),true);
 const coldFill=cold.ops.find(o=>o.op==='fillRect');
 assert.deepEqual({x:coldFill.x,y:coldFill.y,w:coldFill.w,h:coldFill.h},box,'覆盖范围必须等于头像矩形');
 assert.match(coldFill.style,/^rgba\(140,205,235,/);
 assert.equal(cold.ops.some(o=>o.op==='strokeRect'),false,'寒冷不描边');

 const frozen=fakeCanvas();
 assert.equal(drawFrostOverlay(frozen.c,{statuses:[{kind:'frozen'}]},box),true);
 const frozenFill=frozen.ops.find(o=>o.op==='fillRect');
 assert.match(frozenFill.style,/^rgba\(70,150,205,/);
 assert.equal(frozen.ops.some(o=>o.op==='strokeRect'),true,'冰冻带描边');
 // 深蓝必须比浅蓝更实：解析 alpha 做比较
 const alpha=s=>Number(s.match(/,([\d.]+)\)$/)[1]);
 assert.ok(alpha(frozenFill.style)>alpha(coldFill.style),'冰冻填充必须比寒冷更不透明');
});

test('no overlay is drawn for healthy actors, summons or empty boxes',()=>{
 const box={x:0,y:0,w:30,h:30};
 const healthy=fakeCanvas();
 assert.equal(drawFrostOverlay(healthy.c,{statuses:[{kind:'stun'}]},box),false);
 assert.deepEqual(healthy.ops,[]);

 const summon=fakeCanvas();
 assert.equal(drawFrostOverlay(summon.c,{kind:'summon',statuses:[{kind:'frozen'}]},box),false);
 assert.deepEqual(summon.ops,[],'召唤物入口当前为 no-op');

 const degenerate=fakeCanvas();
 assert.equal(drawFrostOverlay(degenerate.c,{statuses:[{kind:'cold'}]},{x:0,y:0,w:0,h:10}),false);
 assert.deepEqual(degenerate.ops,[]);
});

test('reduceFx drops the outline but keeps the tint, and decorate stays optional',()=>{
 const box={x:5,y:5,w:20,h:20};
 const plain=fakeCanvas();
 drawFrostOverlay(plain.c,{statuses:[{kind:'frozen'}]},box,{reduceFx:true});
 assert.equal(plain.ops.some(o=>o.op==='strokeRect'),false);
 assert.equal(plain.ops.some(o=>o.op==='fillRect'),true);

 let decorated=null;
 const hooked=fakeCanvas();
 drawFrostOverlay(hooked.c,{statuses:[{kind:'frozen'}]},box,{decorate:(c,b,kind)=>{decorated={b,kind};}});
 assert.equal(decorated.kind,'frozen');
 assert.deepEqual(decorated.b,box);
});

test('the overlay restores canvas state so HUD drawn later is unaffected',()=>{
 const {c,ops}=fakeCanvas();
 drawFrostOverlay(c,{statuses:[{kind:'frozen'}]},{x:0,y:0,w:10,h:10});
 assert.equal(ops[0].op,'save');
 assert.equal(ops.at(-1).op,'restore');
});
