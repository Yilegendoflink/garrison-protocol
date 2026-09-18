import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {rangeGeometry,skillWidensRange} from '../dist/protocol.js';
import {openBattle,deployNow,byId,enemy} from './effects-harness.mjs';
import {drawWideSweep,drawSelfBurst,drawAuraField,drawSkillFan,drawFx} from '../dist/native-fx.js';

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
  arc(...a){ops.push({op:'arc',args:a});},ellipse(...a){ops.push({op:'ellipse',args:a});},fill(){ops.push({op:'fill',style:this.fillStyle});},
  translate(){},rotate(){},drawImage(){},fillText(){},arcTo(){}};
 return {c,ops,state};
}
const Z={r:{width:800,height:520},tw:64,th:52,ox:0,oy:0};
const point=(x,y)=>({x:Z.ox+(x+.5)*Z.tw,y:Z.oy+(y+.5)*Z.th});

test('rangeGeometry 按 rangeId 给出跨度与格子',()=>{
 const base=rangeGeometry(NATIVE_DATA,'3-12');
 const wide=rangeGeometry(NATIVE_DATA,'3-7');
 assert.equal(base.count,8);assert.equal(wide.count,16);
 assert.equal(wide.spanY,6,'真银斩 3-7 纵向跨度应为 6');
 assert.equal(wide.reachX,3);
 assert.equal(rangeGeometry(NATIVE_DATA,'不存在的范围'),null);
});

test('只有范围扩大的技能才算 wide',()=>{
 const sv=Object.values(NATIVE_DATA.profiles).find(p=>p.chessId==='chess_char_4_22_a');
 assert.equal(skillWidensRange(sv,2),true,'真银斩 S3 扩大了范围');
 assert.equal(skillWidensRange(sv,0),false,'强力击不改范围');
 const texas=Object.values(NATIVE_DATA.profiles).find(p=>p.chessId==='chess_char_1_08_a');
 assert.equal(skillWidensRange(texas,1),true,'德克萨斯 S2 剑雨扩大了范围');
});

test('范围扩大技能发出带 wide 的攻击与 strike 事件，普通攻击不带',()=>{
 const {b}=openBattle([{chessId:'chess_char_4_22_a',skillIndex:2}]);
 const u=byId(b,'char_172_svrash');
 assert.equal(b.wideAttack(u),true,'真银斩属范围扩大');
 b.s.enemies.length=0;
 enemy(b,{x:u.x+1,y:u.y,hp:1e6,def:0});enemy(b,{x:u.x+2,y:u.y,hp:1e6,def:0});
 u.sp=b.spCost(u);b.activate(u);deployNow(b);
 assert.equal(b.rangeGeometry(u).count,16,'激活技能后取技能范围');
 for(let i=0;i<90;i++)b.step();
 assert.ok(b.s.events.some(e=>e.type==='skill-start'&&e.uid===u.uid&&e.wide===true),'skill-start 应带 wide');
 const strikes=b.s.events.filter(e=>e.type==='strike');
 assert.ok(strikes.length>0,'技能期间应产生挥砍');
 assert.ok(strikes.every(e=>e.wide===true),'技能期间每次挥砍都应带 wide');
 // 对照：未开技能时正常攻击不带 wide
 const {b:b2}=openBattle({chessId:'chess_char_4_22_a',skillIndex:0});
 const v=byId(b2,'char_172_svrash');
 b2.s.enemies.length=0;enemy(b2,{x:v.x+1,y:v.y,hp:1e6,def:0});
 deployNow(b2);for(let i=0;i<120;i++)b2.step();
 assert.equal(b2.s.events.filter(e=>e.type==='strike').some(e=>e.wide===true),false,'常态攻击不该带 wide');
});

test('wide 扫弧、自身震波、领域描边都真的画了东西',()=>{
 const {b}=openBattle({chessId:'chess_char_4_22_a',skillIndex:2});
 const u=byId(b,'char_172_svrash');
 assert.equal(b.wideKind(u),'sweep','真银斩归入持续范围强化');
 b.emit('skill-start',{uid:u.uid,kind:'duration',name:'真银斩',x:u.x,y:u.y,wide:true,wideKind:'sweep'});
 const {c,ops}=host();
 assert.equal(drawWideSweep(c,point,Z,b),true,'开技应有大弧线');
 assert.ok(ops.some(o=>o.op==='arc'),'应画出弧');
 assert.equal(drawWideSweep(c,point,Z,{s:{events:[],time:0,units:[]}}),false,'无事件时不画');
 // 瞬时自身 AoE（剑雨）走 burst，不该被当成扫弧
 const burst=openBattle({chessId:'chess_char_1_08_a',skillIndex:1});
 const tv=byId(burst.b,'char_102_texas');
 assert.equal(burst.b.wideKind(tv),'burst','剑雨归入瞬时自身 AoE');
 burst.b.emit('skill-start',{uid:tv.uid,kind:'instant',name:'剑雨',x:tv.x,y:tv.y,wide:true,wideKind:'burst'});
 const bh=host();
 assert.equal(drawSelfBurst(bh.c,point,Z,burst.b),true,'自身 AoE 应有震波');
 assert.ok(bh.ops.some(o=>o.op==='ellipse'||o.op==='strokeRect'),'应画出环或范围格');
 assert.equal(drawWideSweep(host().c,point,Z,burst.b),false,'瞬时技能不应画持续扫弧');
 // 被动大范围技能（入场自动释放）也走 burst
 const passive=openBattle({chessId:'chess_char_4_16_a',skillIndex:2});
 const pv=byId(passive.b,'char_1028_texas2');
 assert.equal(passive.b.wideKind(pv),'passive','剑雨滂沱是入场自动释放');
 passive.b.emit('skill-start',{uid:pv.uid,kind:'duration',name:'剑雨滂沱',x:pv.x,y:pv.y,wide:true,wideKind:'passive'});
 assert.equal(drawSelfBurst(host().c,point,Z,passive.b),true,'入场自动释放应有范围环');
 // 持续领域描边
 const aura=host();
 u.skillLeft=10;
 assert.equal(drawAuraField(aura.c,point,Z,b),true,'持续期应描出领域');
 assert.ok(aura.ops.some(o=>o.op==='strokeRect'),'领域按格描边');
});

test('水月的技能特效走蓝色，其他干员保持暖金',()=>{
 const {b}=openBattle({chessId:'chess_char_4_09_a',skillIndex:2});
 const u=byId(b,'char_437_mizuki');deployNow(b);u.skillLeft=10;
 const tinted=op=>/rgba\(122,198,255|rgba\(190,230,255/.test(String(op.style));
 b.emit('skill-start',{uid:u.uid,kind:'duration',name:'镜花水月',x:u.x,y:u.y,wide:true,wideKind:'sweep'});
 const sweep=host();
 assert.equal(drawWideSweep(sweep.c,point,Z,b),true);
 assert.ok(sweep.ops.some(tinted),'水月的持续范围弧应为蓝色');
 const aura=host();
 assert.equal(drawAuraField(aura.c,point,Z,b),true);
 assert.ok(aura.ops.some(tinted),'水月的领域描边应为蓝色');
 const fx=host();
 b.emit('skill-start',{uid:u.uid,kind:'duration',name:'镜花水月',x:u.x,y:u.y});
 drawFx(fx.c,point,Z,b,{});
 assert.ok(fx.ops.some(tinted),'技能开启提示环与名字也应是蓝色');
 // 对照：别的干员仍然暖金
 const other=openBattle({chessId:'chess_char_4_22_a',skillIndex:2});
 const v=byId(other.b,'char_172_svrash');deployNow(other.b);v.skillLeft=10;
 const plain=host();
 assert.equal(drawAuraField(plain.c,point,Z,other.b),true);
 assert.ok(plain.ops.some(o=>/rgba\(244,211,139/.test(String(o.style))),'其他干员的领域仍是暖金');
 assert.equal(plain.ops.some(tinted),false,'暖金路径不能混进蓝色');
});
