import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {openBattle,enemy} from './effects-harness.mjs';
import {dealDamage,dispatch,tickLogic} from '../dist/native-effects.js';

const unique=(bond,count)=>Array.from(new Map(Object.values(NATIVE_DATA.season.charShopChessDatas).filter(s=>s.charId&&NATIVE_DATA.season.charChessDataDict[s.chessId].bondIds.includes(bond)).map(s=>[s.charId,s.chessId])).values()).slice(0,count);

test('炎六人档没有九人减伤，九人档只放大攻击力',()=>{
 const six=openBattle(unique('yanShip',6)).b, g=six.s.summons.find(s=>s.type==='yan-guardian');assert.equal(g.damageResistance,0);
 const nine=openBattle(unique('yanShip',9)).b, n=nine.s.summons[0];assert.equal(n.damageResistance,.9);assert.ok(n.atk>g.atk);
});

test('拉特兰弹药层只接受拉特兰消耗者，迅捷强化档只给本次结束技能者',()=>{
 const later=openBattle(unique('lateranoShip',6)).b,other=later.s.units.find(u=>!later.owns(u,'lateranoShip'));if(other){dispatch(later,'ammo',{source:other,used:1});assert.equal(later.s.bondLateranoAmmoStacks,0);}
 const swift=openBattle(unique('swiftShip',2)).b,u=swift.s.units.find(v=>swift.owns(v,'swiftShip'));swift.layers.swiftShip=40;swift.economy.random=()=>0;for(const v of swift.s.units)v.sp=0;u.skillCount=1;dispatch(swift,'skill-end',{target:u});assert.equal(u.sp,24);assert.equal(swift.s.units.find(v=>v!==u).sp,0);
});

test('炎佑祛恶之焰首次可用且目标丢失后进入15秒冷却',()=>{
 const b=openBattle(unique('yanShip',6)).b,g=b.s.summons[0],target=enemy(b,{x:g.x+2,y:g.y,hp:100000,threat:10});g.attackCooldown=999;tickLogic(b,0);assert.equal(g.yanSkillActive,true);target.hp=0;target.hidden=true;tickLogic(b,1/30);assert.equal(g.yanSkillActive,false);assert.ok(g.yanSkillNextAt>b.s.time);
});

test('阿戈尔致死只标记下一次免费部署，复活名额已经消耗',()=>{
 const b=openBattle(unique('egirShip',5)).b,u=b.s.units.find(v=>v.deployed&&v.hp>0);b.s.bondEgirReviveCount=0;for(const v of b.s.units)v.egirRevived=false;const before=b.s.bondEgirReviveCount;dealDamage(b,{target:u,amount:1e9,type:'true'});assert.equal(b.s.bondEgirReviveCount,before+1);assert.equal(u.deployed,false);assert.equal(u.down,0);assert.equal(b.deploymentCost(u),0);b.step();assert.equal(u.deployed,true);
});
