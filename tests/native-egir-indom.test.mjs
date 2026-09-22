import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {openBattle,enemy} from './effects-harness.mjs';
import {dispatch,settleEgirSwallow,applyLoss,commitExit,tickDoll} from '../dist/native-effects.js';

const unique=(id,n)=>[...new Map(Object.values(NATIVE_DATA.season.charShopChessDatas).filter(s=>s.charId&&NATIVE_DATA.season.charChessDataDict[s.chessId].bondIds.includes(id)).map(s=>[s.charId,s.chessId])).values()].slice(0,n);
function arena(bond='egirShip',n=4){
 const {b}=openBattle(unique(bond,n));
 const profile=b.profile.bind(b);b.profile=u=>{const p=profile(u);return {...p,activeTalents:[],garrisons:[],branch:'fighter',position:'MELEE',skill:null,attributes:{...p.attributes,maxHp:20000,atk:100,blockCnt:1,def:0}};};
 b.on=id=>id===bond;b.s.bondEgirReviveCount=0;b.rows[bond].count=n;b.layers[bond]=0;b.s.band=null;
 for(const [i,u] of b.s.units.entries()){u.x=i;u.y=1;u.dir=0;u.egirRevived=false;u.egirBorrowAtk=0;u.egirBorrowBlock=0;u.indomFreeDeploy=false;b.deploy(u);u.hp=u.maxHp=20000;}
 b.s.logicLog=[];b.s.egirLayerTargets=[];b.s.bondApplied=false;return b;
}
function mark(b){dispatch(b,'battle-start',{target:null});}

test('阿戈尔直线贪吃蛇：每名获得右方整条链的基础属性，攻击力最终加算',()=>{
 const b=arena();mark(b);assert.deepEqual(b.s.units.map(u=>u.egirBorrowAtk),[300,200,100,0]);
 assert.deepEqual(b.s.units.map(u=>b.stats(u).blockCnt),[4,3,2,1]);
 const u=b.s.units[0];u.sandAttackRatio=1;assert.equal(b.stats(u).atk,500,'本体100×2+吞噬300，不能(100+300)×2');
 assert.equal(b.s.egirPendingMarks.length,6);
});
test('阿戈尔转弯链跟随中间干员朝向，环路不反向重复继承',()=>{
 const b=arena(),[a,c,d,e]=b.s.units;c.dir=1;d.x=1;d.y=2;d.dir=2;e.x=0;e.y=2;e.dir=3;
 mark(b);assert.deepEqual(b.s.units.map(u=>u.egirBorrowAtk),[300,200,100,0]);
 assert.deepEqual(a.egirConsumedUids,[c.uid,d.uid,e.uid]);
 assert.equal(b.s.egirPendingMarks.length,6);
});
test('非阿戈尔终点不继续传递，空格截断',()=>{
 const b=arena();const owns=b.owns.bind(b),stop=b.s.units[1];b.owns=(u,id)=>u===stop&&id==='egirShip'?false:owns(u,id);
 mark(b);assert.deepEqual(b.s.units[0].egirConsumedUids,[stop.uid]);
 const c=arena();c.s.units[1].x=8;mark(c);assert.equal(c.s.units[0].egirBorrowAtk,0);
});
test('吞噬固定5000：防御、减伤、盾、脆弱、分摊均不改变扣血，来源与击杀归属分开',()=>{
 const b=arena(),[a,t]=b.s.units;t.def=99999;t.damageResistance=.99;t.shield=99999;t.shieldLayers=[{id:'test',remaining:99999,max:99999}];t.fragile=9;
 mark(b);settleEgirSwallow(b);assert.equal(a.hp,20000);assert.equal(t.hp,15000);assert.equal(t.shield,99999);
 const log=b.s.logicLog.find(x=>x.type==='loss'&&x.targetUid===t.uid);assert.equal(log.sourceUid,t.uid);assert.equal(log.killerUid,a.uid);assert.equal(log.amount,5000);
 assert.deepEqual(b.s.units.map(u=>u.hp),[20000,15000,10000,5000]);
});
test('同一目标只叠一次等阶；首次击倒即取消余下标记（复活也取消）',()=>{
 const b=arena('egirShip',5);for(const u of b.s.units)u.hp=u.maxHp=4000;
 mark(b);const expected=b.s.units.slice(1).reduce((n,u)=>n+b.profile(u).rank,0);settleEgirSwallow(b);
 assert.equal(b.layers.egirShip,expected);assert.equal(b.s.bondEgirReviveCount,3);
 for(const u of b.s.units.slice(1))assert.equal(b.s.logicLog.filter(x=>x.type==='loss'&&x.targetUid===u.uid).length,1);
 assert.equal(b.s.units.at(-1).deployed,false);settleEgirSwallow(b);assert.equal(b.layers.egirShip,expected);
});
test('真实开场的吞噬击倒不会被随后初始部署刷回满血',()=>{
 const {b}=openBattle(unique('egirShip',3));const losses=b.s.logicLog.filter(x=>x.type==='loss'&&x.cause==='egir-swallow');assert.ok(losses.length);
 for(const entry of losses){const u=b.s.units.find(u=>u.uid===entry.targetUid);assert.equal(u.hp,0);assert.equal(u.deployed,false);}
});
test('不屈只免下一次再部署费用：零费用、无冷却，不倒贴撤退返费',()=>{
 const b=arena('indomShip',3),u=b.s.units[0];b.economy.random=()=>0;b.s.cost=0;
 commitExit(b,{target:u,reason:'knockdown'});assert.equal(u.down,0);assert.equal(b.deploymentCost(u),0);
 b.step();assert.equal(u.deployed,true);assert.equal(b.s.cost,0);assert.equal(u.deploymentCost,0);assert.equal(u.indomFreeDeploy,false);
 b.economy.random=()=>1;commitExit(b,{target:u,reason:'retreat'});assert.ok(u.down>0);assert.ok(b.deploymentCost(u)>0);assert.equal(b.s.cost,0);
});
test('不屈覆盖手动/技能/强制/商人撤退，三人回技力只限地面击倒',()=>{
 for(const reason of ['retreat','skill','forced','merchant-fee','fall','devour']){const b=arena('indomShip',3),[u,ally]=b.s.units;b.economy.random=()=>0;ally.sp=0;commitExit(b,{target:u,reason});assert.equal(u.down,0,reason);assert.equal(b.deploymentCost(u),0);assert.equal(ally.sp,0);}
 const b=arena('indomShip',3),[u,ally]=b.s.units;const profile=b.profile.bind(b);b.profile=v=>({...profile(v),skill:{spData:{spType:'INCREASE_WITH_TIME',spCost:100,initSp:0}}});ally.sp=0;b.economy.random=()=>1;
 commitExit(b,{target:u,reason:'knockdown'});assert.equal(ally.sp,5);
 b.deploy(u);b.profile=v=>({...profile(v),position:v===u?'RANGED':'MELEE',skill:{spData:{spType:'INCREASE_WITH_TIME',spCost:100,initSp:0}}});ally.sp=0;b.economy.random=()=>0;
 commitExit(b,{target:u,reason:'knockdown'});assert.equal(ally.sp,0);assert.ok(u.down>0);
});
test('阿戈尔复活与不屈同时触发：消耗复活名额、下一次免费部署',()=>{
 const b=arena('egirShip',5),u=b.s.units[0];b.on=id=>['egirShip','indomShip'].includes(id);b.rows.indomShip={count:3};b.economy.random=()=>0;b.s.cost=0;
 applyLoss(b,{target:u,amount:u.hp});assert.equal(u.egirRevived,true);assert.equal(b.s.bondEgirReviveCount,1);assert.equal(u.knockdownCount,1);assert.equal(u.deployed,false);assert.equal(u.down,0);assert.equal(b.deploymentCost(u),0);
 b.step();assert.equal(u.deployed,true);assert.equal(b.s.cost,0);assert.equal(u.egirRevived,true);
});
test('阿戈尔复活重新触发部署事件；第四人及同一人第二次不能再占名额',()=>{
 const b=arena('egirShip',5);const events=[];const event=b.event.bind(b);b.event=(u,k,...args)=>{events.push([u.uid,k]);return event(u,k,...args);};
 for(const u of b.s.units.slice(0,4))applyLoss(b,{target:u,amount:u.hp});
 assert.equal(b.s.bondEgirReviveCount,3);assert.equal(b.s.units[3].deployed,false);
 const first=b.s.units[0];assert.equal(events.filter(([id,k])=>id===first.uid&&k==='deploy').length,0);b.deploy(first,{reentry:true});assert.equal(events.filter(([id,k])=>id===first.uid&&k==='deploy').length,1);applyLoss(b,{target:first,amount:first.hp});assert.equal(first.deployed,false);assert.equal(b.s.bondEgirReviveCount,3);
});
test('归溟幽灵鲨本体不常驻替身伤害，切换20秒、零阻挡、返回本体可触发不屈',()=>{
 const {b}=openBattle('chess_char_5_13_a'),u=b.s.units[0];assert.equal(b.s.summons.filter(s=>s.type==='ghost2-substitute').length,0);
 b.on=()=>false;const e=enemy(b,{x:u.x,y:u.y,hp:1e6});applyLoss(b,{target:u,amount:u.hp});assert.ok(u.dollForm);assert.equal(b.stats(u).blockCnt,0);assert.equal(b.behavior(u).attack,false);
 const hp=e.hp;b.s.time=1;tickDoll(b,u);assert.ok(e.hp<hp);b.on=id=>id==='indomShip';b.economy.random=()=>0;b.s.time=20;tickDoll(b,u);
 assert.equal(u.dollForm,null);assert.equal(u.down,0);assert.equal(b.deploymentCost(u),0);
});
test('不屈概率按层数计算，非本盟约地面干员也可受益',()=>{
 const b=arena('indomShip',3),u=b.s.units[0];b.owns=()=>false;b.layers.indomShip=100;
 b.economy.random=()=>.579;commitExit(b,{target:u,reason:'knockdown'});assert.equal(u.indomFreeDeploy,true);
 b.deploy(u,{reentry:true});b.economy.random=()=>.581;commitExit(b,{target:u,reason:'knockdown'});assert.equal(u.indomFreeDeploy,false);assert.ok(u.down>0);
});
test('阿戈尔与不屈状态存读后保留，免费部署标记仅消耗一次',()=>{
 const b=arena('egirShip',5),u=b.s.units[0];b.on=id=>['egirShip','indomShip'].includes(id);b.rows.indomShip={count:3};b.economy.random=()=>0;mark(b);
 applyLoss(b,{target:u,amount:u.hp});b.s=JSON.parse(JSON.stringify(b.s));const restored=b.s.units[0];
 assert.equal(restored.egirBorrowAtk,400);assert.equal(restored.egirRevived,true);assert.equal(b.deploymentCost(restored),0);
 b.deploy(restored,{reentry:true});assert.equal(restored.indomFreeDeploy,false);assert.ok(b.deploymentCost(restored)>0);assert.equal(b.s.bondEgirReviveCount,1);
});
test('替身周期攻击遇到反伤致死时终止补拍，不读取已清理的形态',()=>{
 const {b}=openBattle('chess_char_5_13_a'),u=b.s.units[0];applyLoss(b,{target:u,amount:u.hp});enemy(b,{x:u.x,y:u.y,hp:1e6});
 b.enemyDamageReceived=()=>applyLoss(b,{target:u,amount:u.hp});b.s.time=5;assert.doesNotThrow(()=>tickDoll(b,u));assert.equal(u.deployed,false);assert.equal(u.dollForm,null);
});
test('真实存档恢复不重放开场吞噬，不回滚层数、继承属性或复活名额',()=>{
 const {g,b}=openBattle(unique('egirShip',5)),record=JSON.parse(JSON.stringify(g.snapshot()));
 const restored=NativeSession.restore(NATIVE_DATA,record);assert.ok(restored);
 assert.deepEqual(restored.s.bondLayers,g.s.bondLayers);assert.equal(restored.battle.s.bondEgirReviveCount,b.s.bondEgirReviveCount);
 for(const u of b.s.units){const v=restored.battle.s.units.find(v=>v.uid===u.uid);for(const key of ['hp','deployed','egirBorrowAtk','egirBorrowBlock','egirRevived'])assert.equal(v[key],u[key],key);assert.deepEqual(v.egirConsumedUids,u.egirConsumedUids);}
 assert.deepEqual(restored.battle.s.egirPendingMarks,[]);
});
