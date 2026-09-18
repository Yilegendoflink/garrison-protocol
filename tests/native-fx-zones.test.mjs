import test from 'node:test';
import assert from 'node:assert/strict';
import {zoneVisual} from '../dist/native-operator-effects.js';
import {drawZones} from '../dist/native-fx.js';

function host(){
 const ops=[],state={saves:0,restores:0};
 const c={globalCompositeOperation:'source-over',lineCap:'butt',strokeStyle:'',fillStyle:'',lineWidth:1,
  save(){state.saves++;},restore(){state.restores++;},setLineDash(){},
  createLinearGradient(...a){const stops=[];ops.push({op:'gradient',args:a,stops});return {addColorStop:(o,col)=>stops.push([o,col])};},
  createRadialGradient(...a){const stops=[];ops.push({op:'radial',args:a,stops});return {addColorStop:(o,col)=>stops.push([o,col])};},
  fillRect(...a){ops.push({op:'fillRect',args:a,style:this.fillStyle});},
  strokeRect(...a){ops.push({op:'strokeRect',args:a,style:this.strokeStyle,width:this.lineWidth});},
  beginPath(){ops.push({op:'beginPath'});},moveTo(){},lineTo(){},closePath(){},quadraticCurveTo(){},
  stroke(){ops.push({op:'stroke',style:this.strokeStyle,width:this.lineWidth});},
  arc(){ops.push({op:'arc'});},ellipse(){ops.push({op:'ellipse'});},fill(){ops.push({op:'fill'});},
  translate(){},rotate(){},drawImage(){},fillText(){}};
 return {c,ops,state};
}
const Z={r:{width:800,height:520},tw:64,th:52,ox:0,oy:0};
const point=(x,y)=>({x:Z.ox+(x+.5)*Z.tw,y:Z.oy+(y+.5)*Z.th});
const battle=effects=>({s:{time:3,units:[{uid:1,x:2,y:2,deployed:true,hp:10}],enemies:[],logicEffects:effects},zoneVisual});

test('区域视觉分类覆盖雷暴、斩击领域、领域、治疗光环',()=>{
 assert.equal(zoneVisual('pasngr-s3',{}).tone,'thunder');
 assert.equal(zoneVisual('blkkgt-s3',{}).tone,'blade');
 assert.equal(zoneVisual('saria-s3',{}).tone,'gold');
 assert.equal(zoneVisual('yu-firewall',{}).shape,'self');
 assert.equal(zoneVisual('skill-zone:char_1:1',{dot:true,type:'arts'}).tone,'arts');
 assert.equal(zoneVisual('skill-heal-zone:x',{hot:5}).tone,'heal');
 assert.equal(zoneVisual('agoat2-s1',{elementRegen:3}).tone,'heal');
});

test('区域按逻辑层的 x/y/radius 铺格并绘制，过期或空列表不画',()=>{
 const round=host();
 const fx={id:1,kind:'zone',talentOrSkillId:'pasngr-s3',x:3,y:2,radius:1,interval:1,nextAt:3,endsAt:6,values:{dot:true,type:'arts'}};
 assert.equal(drawZones(round.c,point,Z,battle([fx])),true,'应画出区域');
 const filled=round.ops.filter(o=>o.op==='fillRect').length, stroked=round.ops.filter(o=>o.op==='strokeRect').length;
 assert.equal(filled,9,'半径 1 的圆形区域应铺 3x3 共 9 格');
 assert.equal(stroked,9);
 assert.equal(drawZones(host().c,point,Z,battle([])),false,'没有区域时不画');
 assert.equal(drawZones(host().c,point,Z,battle([{...fx,endsAt:2}])),false,'已过期区域不画');
 const big=host();
 drawZones(big.c,point,Z,battle([{...fx,radius:2}]));
 assert.equal(big.ops.filter(o=>o.op==='fillRect').length,25,'半径 2 应铺 5x5 共 25 格');
 // 自身型（防火墙）只画施法者所在格，不受 radius 影响
 const self=host();
 drawZones(self.c,point,Z,battle([{...fx,talentOrSkillId:'yu-firewall',radius:99,sourceUid:1}]));
 assert.equal(self.ops.filter(o=>o.op==='fillRect').length,1,'自身型只画自身一格');
});

test('敌方持续伤害区域（kind:field）走危险色调绘制，空壳区域不画',()=>{
 const field={id:9,kind:'field',sourceUid:100,x:3,y:2,radius:1,interval:1,nextAt:3.5,endsAt:6,values:{damage:150,damageType:'true'}};
 const out=host();
 assert.equal(drawZones(out.c,point,Z,battle([field])),true,'污染区域应当可见');
 assert.equal(out.ops.filter(o=>o.op==='fillRect').length,9);
 const stroke=out.ops.find(o=>o.op==='strokeRect');
 assert.ok(/^#[0-9a-f]{8}$/i.test(String(stroke.style)),'应当使用十六进制带透明度的描边');
 const danger=host();
 drawZones(danger.c,point,Z,battle([field]));
 const arts=host();
 drawZones(arts.c,point,Z,battle([{...field,kind:'zone',talentOrSkillId:'skill-zone:x',values:{dot:true,type:'arts'}}]));
 assert.notEqual(danger.ops.find(o=>o.op==='fillRect').style,arts.ops.find(o=>o.op==='fillRect').style,'敌方区域要有区别于普通技能区域的配色');
 assert.equal(drawZones(host().c,point,Z,battle([{...field,values:{damage:0,atkScale:0,elementScale:0}}])),false,'没有伤害参数的区域不画');
});

test('减少动效模式仍绘制但更淡',()=>{
 const normal=host(),reduced=host();
 const fx={id:1,kind:'zone',talentOrSkillId:'saria-s3',x:3,y:2,radius:1,interval:1,nextAt:3.2,endsAt:6,values:{hot:5}};
 const alpha=s=>{const t=String(s);if(t.startsWith('#')&&t.length===9)return parseInt(t.slice(7,9),16)/255;const m=t.match(/rgba?\([^)]*?([\d.]+)\)$/);return m?Number(m[1]):1;};
 const sum=h=>h.ops.filter(o=>o.op==='fillRect').reduce((a,o)=>a+alpha(o.style),0);
 drawZones(normal.c,point,Z,battle([fx]));
 drawZones(reduced.c,point,Z,battle([fx]),{reduceFx:true});
 assert.ok(sum(normal)>0&&sum(reduced)>0,'两种模式都要可见');
 assert.ok(sum(reduced)<sum(normal),'减少动效应更淡');
});
