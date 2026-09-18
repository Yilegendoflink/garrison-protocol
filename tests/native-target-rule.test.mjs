import test from 'node:test';import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';import {NATIVE_DATA} from '../dist/runtime-data.js';

// 索敌规则是「优先」不是「只能」。回归的是这一条：规则过滤后一个都不剩时必须回退，
// 否则深靛（不以束缚状态的敌人为攻击目标）与隐现（优先攻击使用远程武器的敌人）会完全不攻击。
const chessOf=charId=>Object.values(NATIVE_DATA.season.charShopChessDatas).find(s=>s.charId===charId&&!s.isHidden).chessId;
function liveBattle(charId){
 const g=new NativeSession(NATIVE_DATA,{seed:9});
 g.s.funds=9999;g.s.rewardPending=null;g.s.rewardQueue=[];
 const unit=g.gain(chessOf(charId));g.s.rewardPending=null;g.s.rewardQueue=[];
 let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(unit.uid,x,y))placed=g.deploy(unit.uid,x,y,0);
 assert.ok(placed,'干员需要落场');
 assert.ok(g.perform('start'),g.lastError||'开战失败');
 const b=g.battle;b.s.queue=[];b.s.enemies=[];b.deploy(b.s.units[0]);
 return b;
}
function probe(b,x,y,{ranged=false,rooted=false}={}){
 const e={uid:910000+b.s.enemies.length,id:'probe',name:'probe',x,y,hp:100000,maxHp:100000,atk:10,def:0,res:0,
  statuses:rooted?[{kind:'root',remaining:30,source:1,value:1}]:[],hidden:false,invulnerable:false,untargetable:false,
  block:null,leak:1,interval:1,attackSpeed:100,attackCooldown:0,action:null,deployGen:0,exitLife:null,flying:false,
  route:null,cmd:0,invisible:false,ranged,canAttack:true,range:ranged?8:0};
 b.s.enemies.push(e);return e;
}

test('深靛：场上没有束缚目标时仍然会攻击（规则是优先不是只能）',()=>{
 const b=liveBattle('char_469_indigo'),u=b.s.units[0];
 assert.deepEqual((b.profile(u).activeTalents||[]).map(t=>t.name),['柔光缚目'],'样例必须有该天赋');
 const e=probe(b,u.x+1,u.y,{rooted:false});
 assert.equal(b.targets(u).length,1,'非束缚目标不能被规则清空');
 const hp=e.hp;
 for(let i=0;i<200;i++)b.step();
 assert.ok(e.hp<hp,'深靛必须真的打出去');
});

test('深靛：场上有束缚目标时优先打束缚的',()=>{
 const b=liveBattle('char_469_indigo'),u=b.s.units[0];
 const free=probe(b,u.x+1,u.y,{rooted:false});
 const rooted=probe(b,u.x+1,u.y+1,{rooted:true});
 const picked=b.targets(u);
 assert.equal(picked.length,1,'规则生效时只保留符合条件的候选');
 assert.equal(picked[0].uid,rooted.uid,'优先打处于束缚状态的敌人');
 assert.notEqual(picked[0].uid,free.uid);
});

test('隐现：桌上只有近战敌人时仍然会攻击（优先远程≠只能远程）',()=>{
 const b=liveBattle('char_498_inside'),u=b.s.units[0];
 u.skillIndex=1;
 const melee=probe(b,u.x+1,u.y,{ranged:false});
 assert.equal(b.targets(u).length,1,'没有远程敌人时不能把候选清空');
 const hp=melee.hp;
 for(let i=0;i<200;i++)b.step();
 assert.ok(melee.hp<hp,'隐现必须真的打出去');
});
