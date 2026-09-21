import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';
import {NativeBattle} from '../dist/native-battle.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {applyStatus} from '../dist/status.js';
import {dealDamage,addDamageRedirect} from '../dist/native-effects.js';
import {drawEnemyPhase} from '../dist/native-fx.js';

function arena(positions=[[3,3],[8,3],[5,3],[5,2],[8,2]]){
 const g=new NativeSession(NATIVE_DATA,{seed:42});g.s.funds=100;assert.ok(g.perform('buy',0));const unit=g.s.units[0];let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(unit.uid,x,y))placed=g.deploy(unit.uid,x,y,0);
 assert.ok(placed);assert.ok(g.perform('start'));const b=g.battle,template=b.s.units[0];b.s.queue=[];b.s.enemies=[];b.s.logicEffects=[];b.s.limit=1000;b.map=structuredClone(b.map);
 b.s.units=positions.map(([x,y],i)=>{const u=structuredClone(template);u.uid+=i*100;u.x=x;u.y=y;u.deployed=true;u.hp=500;applyStatus(u,'disarm',600);applyStatus(u,'skillLock',600);b.map.grid[y][x].heightType='LOWLAND';return u;});
 const caps=b.s.units.map((u,i)=>u.maxHp=1000+i*1000),stats=b.stats.bind(b);b.stats=u=>({...stats(u),maxHp:caps[b.s.units.indexOf(u)]??1000,def:0,magicResistance:0});
 const id='enemy_1509_mousek',raw=NATIVE_DATA.enemies[id],o=b.map.origin,p={col:o.col+3,row:o.row-3};b.level={...b.level,routes:[{motionMode:'WALK',startPosition:p,endPosition:p,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...b.level.enemyProfiles,[id]:raw}};b.spawn({id,route:0});const e=b.s.enemies[0];e.canAttack=false;
 return {b,g,e,units:b.s.units,caps};
}
function advance(b,s){for(let i=0;i<Math.round(s*30);i++)b.step();}
function near(a,b){assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);}

test('鼠王本期4667法术屏障只给自身3000防御，破盾立即取消，不给附近敌人加防',()=>{
 const {b,e}=arena();b.spawn({id:'enemy_1007_slime',route:0});const other=b.s.enemies.at(-1);other.canAttack=false;b.step();assert.equal(e.shield,4667);assert.equal(e.def,e.baseDef+3000);assert.equal(other.def,other.baseDef);assert.equal(e.aura,null);assert.equal(applyStatus(e,'sleep',5),false);
 const hp=e.hp;dealDamage(b,{target:e,value:10,type:'physical'});assert.equal(e.shield,4667);assert.equal(e.hp,hp-10);dealDamage(b,{target:e,value:4667,type:'arts'});assert.equal(e.def,e.baseDef);assert.equal(e.shield,0);
});

test('唱沙选择全场最大生命上限而非当前生命或阻挡目标，x-7大十字可命中飞行且不误及斜角',()=>{
 const {b,e,units,caps}=arena();caps.splice(0,caps.length,1000,9000,2000,3000,10000);units[4].flying=true;units[1].hp=1;const hits=[];b.hurt=(u,source,opts)=>hits.push({uid:u.uid,amount:opts.damageAmount,cause:opts.cause});advance(b,19.9);assert.equal(hits.length,0);advance(b,.2);
 assert.deepEqual(hits.map(h=>h.uid).sort((a,b)=>a-b),[units[1],units[2],units[4]].map(u=>u.uid).sort((a,b)=>a-b));assert.ok(hits.every(h=>h.amount===800&&h.cause==='extra'));assert.equal(e.mouseMaxUid,units[1].uid);assert.equal(e.mouseMinUid,units[0].uid);
});

test('沙狱按全场最低生命上限选九格，法术DOT每秒一拍，最终攻击倍率只施加一次且不刷新15秒减益',()=>{
 const {b,e,units,caps}=arena([[3,3],[4,3],[7,3]]);caps.splice(0,caps.length,10000,20000,30000);units.forEach((u,i)=>{u.maxHp=caps[i];u.hp=500;});e.enemySkills.find(s=>s.prefab==='DriftSand').nextAt=9999;const hp=units[0].hp,atk=b.stats(units[0]).atk;advance(b,60.1);assert.equal(b.s.logicEffects.filter(f=>f.values?.mouseSand).length,1);
 advance(b,1);near(units[0].hp,hp-70);near(b.stats(units[0]).atk,atk*.3);assert.equal(units[2].statuses.some(s=>s.kind==='mouseSandWeak'),false);const remaining=units[0].statuses.find(s=>s.kind==='mouseSandWeak').remaining;
 advance(b,2);near(units[0].statuses.find(s=>s.kind==='mouseSandWeak').remaining,remaining-2);near(b.stats(units[0]).atk,atk*.3);
});

test('鼠王低血是防御计算后的全伤害倍率而非加攻，回血可逆，分摊不重复乘倍率',()=>{
 const {b,e,units}=arena([[6,3],[7,3]]),atk=e.atk;e.hp=e.maxHp*.5;assert.equal(dealDamage(b,{source:e,target:units[0],value:100,type:'physical'}).total,100);e.hp--;
 assert.equal(dealDamage(b,{source:e,target:units[0],value:100,type:'arts'}).total,150);assert.equal(e.atk,atk);
 units[0].hp=units[1].hp=500;addDamageRedirect(b,units[0],{targetUid:units[1].uid,ratio:.5});dealDamage(b,{source:e,target:units[0],value:100,type:'physical'});near(units[0].hp,425);near(units[1].hp,425);
 e.hp=e.maxHp;assert.equal(b.enemyOutgoingDamageMultiplier(e),1);
});

test('鼠王没有非飞行主目标时不释放技能，标记随生命上限变化更新',()=>{
 const {b,e,units,caps}=arena([[6,3],[7,3]]);units.forEach(u=>u.flying=true);advance(b,21);assert.equal(e.enemySkills.some(s=>s.used),false);units.forEach(u=>u.flying=false);b.hurt=()=>{};advance(b,.1);assert.equal(e.mouseMaxUid,units[1].uid);caps[0]=5000;b.step();assert.equal(e.mouseMaxUid,units[0].uid);assert.equal(e.mouseMinUid,units[1].uid);
});

test('沙狱持续场与减益跨JSON保留，恢复后按原定时刻继续结算',()=>{
 const {b,g,e}=arena([[3,3]]);e.enemySkills.find(s=>s.prefab==='DriftSand').nextAt=9999;advance(b,60.5);
 const restored=NativeBattle.restore(NATIVE_DATA,g,b.map,b.turn,JSON.parse(JSON.stringify(b.s)));assert.ok(restored);const u=restored.s.units[0],hp=u.hp;const stats=restored.stats.bind(restored);restored.stats=a=>({...stats(a),maxHp:1000,magicResistance:0});advance(restored,.4);assert.equal(u.hp,hp);advance(restored,.2);near(u.hp,hp-70);assert.equal(u.statuses.some(s=>s.kind==='mouseSandWeak'),true);
});

test('鼠王高低生命标记绘制只读战斗状态，使用展示层格式化入口',()=>{
 const {b}=arena([[6,3],[7,3]]);advance(b,1.1);const before=structuredClone(b.s),labels=[];
 const ctx={save(){},restore(){},fillText(text){labels.push(text);}};
 assert.equal(drawEnemyPhase(ctx,(x,y)=>({x,y}),{th:20},b,{formatText:s=>'测试'+s}),true);assert.deepEqual(labels,['测试⊕ 最高生命','测试▼ 最低生命']);assert.deepEqual(b.s,before);
});
