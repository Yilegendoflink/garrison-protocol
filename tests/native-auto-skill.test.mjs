import test from 'node:test';import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';import {NATIVE_DATA} from '../dist/runtime-data.js';

// 自动释放的判定口径：只要「技能开启后能打到」任何敌人就应该开，
// 包含常态范围之外的格子、未被阻挡的飞行敌人、以及开技前不可选的目标。
const chessOf=charId=>Object.values(NATIVE_DATA.season.charShopChessDatas).find(s=>s.charId===charId&&!s.isHidden).chessId;
function liveBattle(charId,{seed=5,dir=0}={}){
 const g=new NativeSession(NATIVE_DATA,{seed});
 g.s.funds=100;g.s.rewardPending=null;g.s.rewardQueue=[];
 const unit=g.gain(chessOf(charId));g.s.rewardPending=null;g.s.rewardQueue=[];
 let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(unit.uid,x,y))placed=g.deploy(unit.uid,x,y,dir);
 assert.ok(placed,'干员需要落场');
 assert.ok(g.perform('start'),g.lastError||'开战失败');
 const b=g.battle;b.s.queue=[];b.s.enemies=[];b.deploy(b.s.units[0]);
 return b;
}
function probeAt(b,x,y,extra={}){
 const e={uid:900001+b.s.enemies.length,id:'probe',name:'probe',x,y,hp:1000,maxHp:1000,atk:10,def:0,res:0,
  statuses:[],hidden:false,invulnerable:false,untargetable:false,block:null,leak:1,interval:1,attackSpeed:100,
  attackCooldown:0,action:null,deployGen:0,exitLife:null,flying:false,route:null,cmd:0,invisible:false,...extra};
 b.s.enemies.push(e);return e;
}
const offset=u=>c=>[c.x-u.x,c.y-u.y];

test('范围扩大技能按开技后的范围预判，常态打不到的格子也算能打到',()=>{
 const b=liveBattle('char_196_sunbr'),u=b.s.units[0],p=b.profile(u);
 assert.notEqual(p.rangeId,p.skill.rangeId,'样例必须是范围扩大技能');
 assert.deepEqual(b.range(u).map(offset(u)),[[0,0]],'古米常态只覆盖自身一格');
 // 斜前方一格：常态 0-1 打不到，技能 3x3 覆盖得到
 const e=probeAt(b,u.x+1,u.y+1);
 assert.equal(b.targets(u).length,0,'开技之前这一格不在常态范围里');
 assert.equal(b.skillWouldHitTarget(u,p),true,'技能开启后能打到它');
 const forward=b.rangeWithSkill(u,false,true).cells.map(offset(u));
 assert.ok(forward.some(([dx,dy])=>dx===1&&dy===1),'前瞻范围用的是技能范围');
});

test('飞行敌人只要技能能打到就算，不要求当前可选中',()=>{
 const b=liveBattle('char_196_sunbr'),u=b.s.units[0],p=b.profile(u);
 const flying=probeAt(b,u.x+1,u.y,{flying:true});
 // 古米不能对空：飞行单位在技能范围内也不算
 b.behavior=()=>({...({antiAir:false})});
 assert.equal(b.skillWouldHitTarget(u,p),false,'不能对空时飞行敌人不算');
 b.behavior=()=>({antiAir:true});
 assert.equal(b.skillWouldHitTarget(u,p),true,'能对空时飞行敌人也要算进来');
 assert.equal(flying.block,null,'飞行敌人不需要被阻挡');
});

test('预判尊重隐匿／不可选中／沉睡这些硬条件，不会为了开技而放行',()=>{
 const b=liveBattle('char_196_sunbr'),u=b.s.units[0],p=b.profile(u);
 const e=probeAt(b,u.x+1,u.y+1);
 assert.equal(b.skillWouldHitTarget(u,p),true,'基准：在技能范围内');
 e.hidden=true;
 assert.equal(b.skillWouldHitTarget(u,p),false,'隐藏单位不算');
 e.hidden=false;e.untargetable=true;
 assert.equal(b.skillWouldHitTarget(u,p),false,'不可选中不算');
 e.untargetable=false;
 e.statuses=[{kind:'sleep',remaining:5,source:1,value:1}];
 assert.equal(b.skillWouldHitTarget(u,p),false,'默认不打沉睡目标');
 e.statuses=[];
 assert.equal(b.skillWouldHitTarget(u,p),true,'清掉状态后恢复');
});
