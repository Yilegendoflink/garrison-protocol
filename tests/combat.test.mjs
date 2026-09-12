import test from 'node:test';
import assert from 'node:assert/strict';
import {attribute,damage,applyDamage,recoverHP,attackTiming,gainSP,spendSP} from '../dist/combat.js';
import {rotateCells,containsTarget,pathRemaining,selectEnemies,selectAllies,selectDefender} from '../dist/targeting.js';
import {startAttack,advanceAttack,cancelAttack} from '../dist/actions.js';
import {Game} from '../dist/engine.js';
import {OP} from '../dist/data.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);

test('attribute layers: additive attack buffs, inspiration, final reduction and bounds',()=>{
 assert.equal(attribute(1000,{ratio:2-.4,finalAdd:500,scales:[-.4]}),1860);
 assert.equal(attribute(1000,{ratio:-2}),0);
 assert.equal(attribute(100,{add:30,ratio:.5,finalAdd:10,scales:[.8]}),164);
 assert.equal(attribute(100,{ratio:10,max:600}),600);
});
test('physical, arts and true damage, penetration order and post-mitigation modifiers',()=>{
 assert.equal(damage({amount:1000,defense:300}),700);
 assert.equal(damage({amount:1000,defense:2000}),50);
 assert.equal(damage({amount:1000,type:'arts',resistance:30}),700);
 near(damage({amount:1000,type:'arts',resistance:100}),50);
 assert.equal(damage({amount:1000,defense:500,penetration:100,penetrationRatio:.5}),800);
 near(damage({amount:1000,type:'arts',resistance:80,penetration:20,penetrationRatio:.5}),700);
 assert.equal(damage({amount:1000,type:'true',defense:99999,resistance:100}),1000);
 assert.equal(damage({amount:1000,defense:9999,multiplier:2,reduction:.5}),50);
 assert.equal(damage({amount:1000,attackScale:2,defense:300}),1700);
 assert.equal(damage({amount:1000,defense:300,multiplier:2}),1400);
 assert.throws(()=>damage({amount:10,type:'invalid'}));
});
test('each hit pays defense; HP and shield accounting never includes overkill',()=>{
 const target={hp:1000,maxHp:1000,shield:100};
 const amount=damage({amount:300,defense:200});
 for(let i=0;i<3;i++)applyDamage(target,amount);
 assert.equal(target.hp,800);assert.equal(target.shield,0);
 assert.deepEqual(applyDamage(target,99999),{hp:800,shield:0,total:800});
 assert.equal(recoverHP(target,100),0,'healing cannot resurrect');
 target.hp=100;assert.equal(recoverHP(target,9999),900);
 assert.equal(applyDamage(target,99999,{immortal:true}).hp,999);assert.equal(target.hp,1);
});
test('SP events, capacity, overflow and skill lock are independent of attack speed',()=>{
 const u={hp:100,deployed:true,active:0,sp:0,spLock:0};
 const skill={sp:3,charges:2,recovery:'attack'};
 assert.equal(gainSP(u,skill,'auto',100),0);
 assert.equal(gainSP(u,skill,'attack'),1);
 gainSP(u,skill,'external',100);assert.equal(u.sp,6);
 assert.equal(spendSP(u,skill),true);assert.equal(u.sp,3);
 assert.equal(gainSP(u,skill,'attack'),0);assert.equal(spendSP(u,skill),false);
 u.spLock=0;u.active=10;assert.equal(gainSP(u,skill,'external',1),0);
 u.active=0;skill.recovery='defensive';assert.equal(gainSP(u,skill,'attack'),0);assert.equal(gainSP(u,skill,'defensive'),1);
 u.deployed=false;assert.equal(gainSP(u,skill,'defensive'),0);
});
test('attack timing uses ASPD bounds; damage is emitted only after windup',()=>{
 assert.equal(attackTiming(1,200).frames,15);
 assert.equal(attackTiming(1,0).frames,150);
 assert.equal(attackTiming(1,10000).frames,5);
 const actor={};const timing=attackTiming(1,100,.2);
 assert.equal(startAttack(actor,{targets:[7]},timing),true);
 for(let i=0;i<5;i++)assert.equal(advanceAttack(actor),null);
 assert.deepEqual(advanceAttack(actor),{targets:[7]});
 assert.equal(startAttack(actor,{},timing),false,'recovery prevents another attack');
 for(let i=0;i<24;i++)advanceAttack(actor);
 assert.equal(startAttack(actor,{},timing),true);cancelAttack(actor);assert.equal(advanceAttack(actor),null);
});
test('range rotation and collision use the same cells; splash is not target acquisition',()=>{
 const cells=rotateCells([[0,0],[1,0]],{x:3,y:3,dir:1});
 assert.deepEqual(cells,[[3,3],[3,4]]);
 assert.equal(containsTarget(cells,{x:3.49,y:4.49}),true);
 assert.equal(containsTarget(cells,{x:3.6,y:4}),false);
 assert.equal(containsTarget(cells,{x:3.6,y:4,hitRadius:.11}),true);
});
test('target priority: own blocker, anti-air trait, taunt, continuous path distance',()=>{
 const paths=[[[0,0],[1,0],[2,0]],[[0,0],[0,1],[0,2]]],unit={uid:9};
 const e=(uid,x,extra={})=>({uid,x,y:0,hp:10,path:0,segment:0,...extra});
 const enemies=[e(1,.1),e(2,.8),e(3,.2,{flying:true}),e(4,.4,{block:9}),e(5,.3,{invisible:true})];
 const settings={cells:[[0,0],[1,0]],paths,antiAir:true,priority:'air'};
 assert.deepEqual(selectEnemies(unit,enemies,settings).map(e=>e.uid),[4,3,2,1]);
 enemies[0].taunt=1;assert.deepEqual(selectEnemies(unit,enemies,settings).map(e=>e.uid),[4,3,1,2]);
 assert.ok(!selectEnemies(unit,enemies,{...settings,antiAir:false}).some(e=>e.flying));
 near(pathRemaining(enemies[1],paths),1.2);
});
test('healers use HP ratio; enemy targeting prefers blocker then taunt and last deployment',()=>{
 const units=[{uid:1,x:0,y:0,hp:400,maxHp:1000,deployed:true,deployAt:1},{uid:2,x:1,y:0,hp:200,maxHp:200,deployed:true,deployAt:2}];
 assert.equal(selectAllies(units,[[0,0],[1,0]])[0].uid,1);
 const enemy={x:0,y:0,ranged:3,block:null};assert.equal(selectDefender(enemy,units).uid,2);
 units[0].taunt=1;assert.equal(selectDefender(enemy,units).uid,1);
 enemy.block=2;assert.equal(selectDefender(enemy,units).uid,2);
});
function battle(id='kroos'){
 const g=new Game(17);g.start();const u=g.gainOp(id);g.deploy(u.uid,3,1);g.startBattle();const b=g.s.battle,bu=b.units[0];bu.deployed=true;
 b.queue=[{type:'soldier',lane:0,at:250}];const e=g.spawnEnemy({type:'soldier',lane:0});e.x=4;e.y=1;e.speed=0;e.hp=e.maxHp=100000;e.atk=0;
 return {g,u,bu,e};
}
test('actual engine: ranged windup and projectile travel delay HP loss, restore preserves pending attacks',()=>{
 const {g,bu,e}=battle();g.update(1/30);assert.ok(bu.action);assert.equal(e.hp,e.maxHp);
 for(let i=0;i<10&&!g.s.battle.projectiles.length;i++)g.update(1/30);
 assert.ok(g.s.battle.projectiles.length);assert.equal(e.hp,e.maxHp);
 const clone=Game.restore(g.serialize());assert.ok(clone);
 for(let i=0;i<120;i++){g.update(1/30);clone.update(1/30);}
 assert.ok(e.hp<e.maxHp);assert.deepEqual(clone.s,g.s);
 const next=battle();for(let i=0;i<20&&!next.g.s.battle.projectiles.length;i++)next.g.update(1/30);
 assert.ok(next.g.s.battle.projectiles.length);next.g.damageUnit(next.bu,{},999999,'true');
 for(let i=0;i<15;i++)next.g.update(1/30);assert.ok(next.e.hp<next.e.maxHp,'released projectile survives owner death');
});
test('engine SP: attack recovery only charges on released attacks and next-attack skill pays per hit',()=>{
 const {g,bu,e}=battle();const skill=OP.kroos.skills[0];g.update(.1);assert.equal(bu.sp,0);
 for(let i=0;i<15;i++)g.update(1/30);assert.equal(bu.sp,1);
 cancelAttack(bu);g.s.battle.projectiles=[];bu.sp=skill.sp;e.def=200;const hp=e.hp;
 g.update(1/30);assert.equal(bu.sp,0);assert.equal(bu.action.payload.hits,2);
 const expected=2*damage({amount:bu.stats.atk*skill.power,defense:200});
 for(let i=0;i<20;i++)g.update(1/30);near(hp-e.hp,expected);assert.equal(bu.sp,0);
});
test('fixed step is independent of caller chunk size and migrates old saves',()=>{
 const {g}=battle();const clone=Game.restore(g.serialize());g.update(1);for(let i=0;i<30;i++)clone.update(1/30);
 assert.deepEqual(g.s,clone.s);
 const old=JSON.parse(g.serialize());delete old.battle.projectiles;delete old.battle.tickRemainder;delete old.battle.rulesVersion;
 for(const u of old.battle.units){delete u.action;delete u.attackCooldown;delete u.spLock;}
 const restored=Game.restore(JSON.stringify(old));assert.ok(restored);assert.equal(restored.s.battle.rulesVersion,2);restored.update(1/30);
});
test('defensive SP integrates with shield damage and true damage bypasses dodge',()=>{
 const {g,bu}=battle('beagle');const skill=OP.beagle.skills[0],before=skill.recovery;
 try{skill.recovery='defensive';bu.shield=1000;g.damageUnit(bu,{},100);assert.equal(bu.sp,1);assert.equal(bu.hp,bu.maxHp);
  const hp=bu.hp;g.random=()=>0;OP.beagle.dodge=1;g.damageUnit(bu,{},100);assert.equal(bu.shield,995,'physical dodge prevents shield loss');g.damageUnit(bu,{},100,'true');assert.equal(bu.shield,895);assert.equal(bu.hp,hp);
 }finally{skill.recovery=before;delete OP.beagle.dodge;}
});
