import test from 'node:test';import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';import {NATIVE_DATA} from '../dist/runtime-data.js';
import {dispatch} from '../dist/native-effects.js';
import {skillConfig} from '../dist/native-operator-effects.js';
import {NO_BOND_BAN} from './no-bond-ban.mjs';

// 秘术师（本模式只有深靛）口径来自 PRTS 深靛页的分支信息：
// 储存的能量弹道造成攻击力 100% 的法术普通伤害，且「技能的攻击倍率会实时作用在能量抛射物上」；
// 天赋柔光缚目按每个攻击能量独立掷概率。
const chessOf=charId=>Object.values(NATIVE_DATA.season.charShopChessDatas).find(s=>s.charId===charId&&!s.isHidden).chessId;
function live(charId){
 const g=new NativeSession(NATIVE_DATA,{bondBan:NO_BOND_BAN,seed:11});
 g.s.funds=9999;g.s.rewardPending=null;g.s.rewardQueue=[];
 const unit=g.gain(chessOf(charId));g.s.rewardPending=null;g.s.rewardQueue=[];
 let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(unit.uid,x,y))placed=g.deploy(unit.uid,x,y,0);
 assert.ok(placed);
 assert.ok(g.perform('start'),g.lastError||'开战失败');
 const b=g.battle;b.s.queue=[];b.s.enemies=[];b.deploy(b.s.units[0]);
 return {b,u:b.s.units[0]};
}
function probe(b,x,y){const e={uid:900001,id:'probe',name:'probe',x,y,hp:1000000,maxHp:1000000,atk:10,def:0,res:0,
 statuses:[],hidden:false,invulnerable:false,untargetable:false,block:null,leak:1,interval:1,attackSpeed:100,attackCooldown:0,
 action:null,deployGen:0,exitLife:null,flying:false,route:null,cmd:0,invisible:false};b.s.enemies=[e];return e;}
const indigo=b=>b.s.units[0];

test('能量弹道按技能的攻击倍率结算，而不是按 100% 攻击力',()=>{
 const {b,u}=live('char_469_indigo');const e=probe(b,u.x+1,u.y);
 const cfg=skillConfig(b.profile(u));
 assert.ok(cfg.atkScale<1,'样例技能必须有攻击倍率');
 // 记录释放时的动作参数：能量弹道的倍率必须等于技能倍率
 let seen=null;const orig=b.releaseNativeAttack.bind(b);
 b.releaseNativeAttack=(uu,action)=>{if(uu===u)seen=action;return orig(uu,action);};
 u.energy=3;u.sp=b.spCost(u);b.activate(u);
 const before=e.hp;let hits=0;const origHit=b.hit.bind(b);
 b.hit=(a,bb,cc,dd,ee)=>{if(a===u)hits++;return origHit(a,bb,cc,dd,ee);};
 for(let i=0;i<200&&hits<4;i++)b.step();
 assert.ok(seen,'必须发生一次释放');
 assert.equal(seen.storedEnergy,3,'开局攒满 3 份能量');
 assert.ok(Math.abs(seen.energyScale-cfg.atkScale)<1e-9,`能量倍率应等于技能倍率 ${cfg.atkScale}，实际 ${seen.energyScale}`);
 assert.equal(hits,4,'主攻击 + 3 条能量弹道');
 const perHit=(before-e.hp)/hits;
 assert.ok(Math.abs(perHit-b.stats(u).atk*cfg.atkScale)<1,'每条弹道按 攻击力×技能倍率 结算');
});

test('天赋柔光缚目：按弹道独立掷概率并束缚 4 秒',()=>{
 const {b,u}=live('char_469_indigo');const e=probe(b,u.x+1,u.y);
 const talent=(b.profile(u).activeTalents||[]).find(t=>/柔光缚目/.test(t.name||''));
 assert.ok(talent,'样例必须有柔光缚目');
 const tb=Object.fromEntries((talent.blackboard||[]).map(x=>[x.key,x.value]));
 assert.ok(tb.prob>0&&tb.duration>0);
 // 命中一次：掷中则束缚
 b.economy.random=()=>0;
 dispatch(b,'after-damage',{source:u,target:e,result:{total:100},cause:'attack',event:{eventId:1,attackId:1}});
 assert.ok((e.statuses||[]).some(s=>s.kind==='root'&&Math.abs(s.remaining-tb.duration)<1e-6),'命中后应施加束缚');
 // 再命中一次：没掷中则不再新增束缚（按弹道独立计算）
 e.statuses=[];b.economy.random=()=>0.99;
 dispatch(b,'after-damage',{source:u,target:e,result:{total:100},cause:'attack',event:{eventId:2,attackId:2}});
 assert.equal((e.statuses||[]).some(s=>s.kind==='root'),false,'未掷中时不应束缚');
 // 持续伤害（技能 2 的区域）不触发天赋
 b.economy.random=()=>0;
 dispatch(b,'after-damage',{source:u,target:e,result:{total:100},cause:'dot',event:{eventId:3,effectId:9}});
 assert.equal((e.statuses||[]).some(s=>s.kind==='root'),false,'持续伤害不触发天赋');
});

test('秘术师以外的人不会触发柔光缚目',()=>{
 const {b,u}=live('char_1038_whitw2');const e=probe(b,u.x+1,u.y);
 b.economy.random=()=>0;
 dispatch(b,'after-damage',{source:u,target:e,result:{total:100},cause:'attack',event:{eventId:1,attackId:1}});
 assert.equal((e.statuses||[]).some(s=>s.kind==='root'),false);
});

test('能量上限 3、无有效目标才积累、重新部署后清零',()=>{
 const {b,u}=live('char_469_indigo');
 assert.equal(b.skillActive(u),false,'样例不能处在技能期间（技能会改变攻速与倍率）');
 // 场上放一个不可选中、不参与索敌的假目标，避免空场让战斗直接判定结束。
 // 它不能算「有效目标」，所以深靛只会积累能量。
 probe(b,-20,-20);
 b.s.enemies[0].hidden=true;
 assert.equal(b.targets(u).length,0,'假目标不算有效目标');
 for(let i=0;i<400;i++)b.step();
 assert.equal(u.energy,3,'无目标时最多攒 3 份');
 assert.equal(u.action?.kind??null,null,'攒满后进入待机，不再继续充能');
 // 重新部署清零
 b.s.cost=99;
 assert.ok(u.energy>0);
 u.hp=0;b.deploy(u,{reentry:true});
 assert.equal(u.energy,0,'重新部署后能量清零');
});
