import test from 'node:test';
import assert from 'node:assert/strict';
import {drawStatuses} from '../dist/native-fx.js';

// 最小 canvas 替身：只记录 mark() 会触发的绘制路径调用
function host(){
 const ops=[];
 const c={save(){},restore(){},translate(){},beginPath(){ops.push('path');},moveTo(){},lineTo(){},
  closePath(){},fill(){ops.push('fill');},stroke(){ops.push('stroke');},arc(){ops.push('arc');},
  strokeRect(){ops.push('strokeRect');},fillRect(){ops.push('fillRect');},fillText(){ops.push('text');},
  set strokeStyle(v){},set fillStyle(v){},set lineWidth(v){},set font(v){}};
 return {c,ops};
}
const draws=unit=>{const h=host();drawStatuses(h.c,0,0,unit,40);return h.ops.length;};

test('cold and frozen draw no head icon because the actor itself is tinted',()=>{
 assert.equal(draws({statuses:[{kind:'cold'}]}),0,'寒冷应由冰蓝覆盖层表示，不再画图标');
 assert.equal(draws({statuses:[{kind:'frozen'}]}),0,'冰冻应由冰蓝覆盖层表示，不再画图标');
 assert.equal(draws({statuses:[{kind:'cold'},{kind:'frozen'}]}),0);
});

test('unrelated statuses keep their head icons',()=>{
 assert.ok(draws({statuses:[{kind:'stun'}]})>0,'眩晕保留图标');
 assert.ok(draws({statuses:[{kind:'sleep'}]})>0,'睡眠保留图标');
 assert.ok(draws({statuses:[{kind:'silence'}]})>0,'沉默保留图标');
 assert.ok(draws({statuses:[{kind:'root'}]})>0,'束缚保留图标');
});

test('a tinted actor still shows its other status icons alongside',()=>{
 // 冰冻 + 眩晕：冰冻不占图标位，眩晕必须照常显示
 assert.ok(draws({statuses:[{kind:'frozen'},{kind:'stun'}]})>0);
 // 且不再被冰冻挤占位置：单独眩晕与"冰冻+眩晕"的图标数量一致
 const alone=draws({statuses:[{kind:'stun'}]});
 const both=draws({statuses:[{kind:'frozen'},{kind:'stun'}]});
 assert.equal(both,alone,'冰冻不再占用 3 个图标名额');
});

test('shield and barrier icons are unaffected',()=>{
 assert.ok(draws({statuses:[],shield:5})>0,'数值护盾仍画图标');
 assert.ok(draws({statuses:[],barriers:[{charges:1}]})>0,'次数屏障仍画图标');
});
