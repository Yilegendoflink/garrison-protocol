import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../dist/engine.js';
import {OP,OPERATORS,MAPS} from '../dist/data.js';

const started=(seed=114)=>{const g=new Game(seed);g.start();return g;};
const runBattle=g=>{let ticks=0;while(g.s.phase==='battle'&&ticks++<10000)g.update(1/30);assert.notEqual(g.s.phase,'battle','a wave must always terminate');return ticks;};
const promotions=g=>{let n=0;while(g.s.rewardOffers&&n++<100)g.takePromotion(0);assert.ok(n<100);};

test('round-trip play: recruit, deploy, fight, frozen supply, and next-round funding',()=>{
 const g=started();assert.equal(g.s.money,3);const frozen=g.s.shop[1];assert.equal(g.buy(0),true);const u=g.s.units[0];assert.equal(g.deploy(u.uid,4,2),false,'melee cannot use a high tile');assert.equal(g.deploy(u.uid,3,1),true);g.lock();assert.equal(g.startBattle(),true);assert.equal(g.s.money,0);assert.equal(g.buy(1),false);runBattle(g);assert.equal(g.s.phase,'intermission');assert.equal(g.s.hp,30);assert.equal(g.s.lastResult.kills,3);g.nextRound();assert.equal(g.s.money,4);assert.equal(g.s.shop[1].id,frozen.id);assert.equal(g.upgradeCost,4);assert.equal(g.upgrade(),true);assert.equal(g.s.level,2);assert.equal(g.s.money,0);assert.equal(g.upgradeCost,7);
});

test('promotion keeps deployed position, returns equipment, grants a free higher-tier choice',()=>{
 const g=started();const first=g.gainOp('fang');g.deploy(first.uid,3,1);const item=g.gainEquipment('blade');g.equip(item.uid,first.uid);g.gainOp('fang');g.gainOp('fang');const merged=g.s.units.find(u=>u.id==='fang');assert.equal(g.s.units.filter(u=>u.id==='fang').length,1);assert.equal(merged.elite,true);assert.equal(merged.x,3);assert.equal(merged.y,1);assert.ok(g.s.items.some(e=>e.id==='blade'));assert.equal(g.s.rewardOffers.length,3);assert.ok(g.s.rewardOffers.every(o=>OP[o.id].tier===2));const money=g.s.money;g.takePromotion(0);assert.equal(g.s.money,money);assert.equal(g.s.rewardOffers,null);assert.equal(g.s.units.length,2);
});

test('equipment combines even when equipped, replacements are explicit, selling returns equipment',()=>{
 const g=started();const u=g.gainOp('beagle'),e=g.gainEquipment('armor');g.equip(e.uid,u.uid);g.gainEquipment('armor');assert.equal(u.equipment.length,0);const advanced=g.s.items.find(e=>e.id==='armor');assert.equal(advanced.elite,true);g.equip(advanced.uid,u.uid);const blade=g.gainEquipment('blade');g.equip(blade.uid,u.uid);const battery=g.gainEquipment('battery');assert.equal(g.equip(battery.uid,u.uid),'replace');assert.equal(u.equipment.length,2);g.equip(battery.uid,u.uid,1);assert.ok(!u.equipment.some(e=>e.id==='blade'));const money=g.s.money;g.sell(u.uid);assert.equal(g.s.money,money+1);assert.ok(g.s.items.some(e=>e.id==='armor'&&e.elite));assert.ok(g.s.items.some(e=>e.id==='battery'));
});

test('alliance activation uses distinct deployed identities; persisted state can resume an exact combat',()=>{
 const g=started();g.gainOp('fang');g.gainOp('fang');g.gainOp('beagle');g.s.units.forEach((u,i)=>g.deploy(u.uid,i+2,3));assert.equal(g.allies().rhodes.count,2);assert.equal(g.active('rhodes'),false);const healer=g.gainOp('ansel');g.deploy(healer.uid,2,2);g.turn(healer.uid,1);assert.equal(g.active('rhodes'),true);g.startBattle();for(let i=0;i<450;i++)g.update(1/30);const clone=Game.restore(g.serialize());assert.ok(clone);runBattle(g);runBattle(clone);assert.equal(clone.s.hp,g.s.hp);assert.deepEqual(clone.s.stats,g.s.stats);assert.deepEqual(clone.s.lastResult,g.s.lastResult);
});

test('flight bypasses blocking and skill-driven ranged attacks defeat air targets',()=>{
 const g=started();g.s.round=4;const defender=g.gainOp('beagle');g.deploy(defender.uid,3,3);g.startBattle();runBattle(g);assert.equal(g.s.stats.kills,0);assert.equal(g.s.hp,23);
 // Face the entry: ranged enemies now stop to fire instead of walking through attack ranges.
 const armed=started();armed.s.round=4;const sniper=armed.gainOp('exusiai',true);armed.deploy(sniper.uid,4,2);armed.turn(sniper.uid,0);const sniper2=armed.gainOp('kroos',true);armed.deploy(sniper2.uid,4,4);armed.turn(sniper2.uid,0);armed.startBattle();runBattle(armed);assert.ok(armed.s.stats.kills>=6);assert.ok(armed.s.stats.damage.exusiai>0);
});

test('defeated operators redeploy with cooldown and DP, and medics produce actual healing',()=>{
 const g=started();const unit=g.gainOp('beagle'),medic=g.gainOp('ansel');g.deploy(unit.uid,3,3);g.deploy(medic.uid,2,2);g.turn(medic.uid,1);g.startBattle();const bu=g.s.battle.units.find(u=>u.uid===unit.uid);bu.deployed=true;g.damageUnit(bu,{type:'test'},999999,false);assert.equal(bu.hp,0);assert.ok(bu.down>0);g.s.battle.queue=[{type:'soldier',lane:0,at:150,bounty:false}];for(let i=0;i<1300;i++)g.update(1/30);assert.ok(bu.hp>0);assert.equal(bu.deployed,true);bu.hp=bu.maxHp*.3;for(let i=0;i<150;i++)g.update(1/30);assert.ok(g.s.stats.healing.ansel>0);
});

test('full sixteen-wave scenario completes, including strategy events and boss summons',()=>{
 const g=started();for(const [id,x,y,dir] of [['saria',3,1,0],['hoshiguma',3,5,0],['mountain',3,3,0],['nightingale',2,2,1],['exusiai',4,2,2],['eyjafjalla',4,4,2],['thorns',5,3,0],['blaze',4,3,0]]){const u=g.gainOp(id,true);g.deploy(u.uid,x,y);g.turn(u.uid,dir);}
 for(let round=1;round<=16;round++){assert.equal(g.s.round,round);if(g.s.decisionOffers)g.chooseDecision(g.s.decisionOffers[0]);promotions(g);g.startBattle();runBattle(g);assert.ok(g.s.hp>0,`survive round ${round}`);if(round<16)g.nextRound();}
 assert.equal(g.s.phase,'finished');assert.equal(g.s.won,true);assert.equal(g.s.stats.rounds,16);assert.ok(g.s.stats.kills>140);assert.ok(g.s.stats.damage.eyjafjalla>0);assert.ok(g.s.stats.healing.nightingale>0);
});

test('maps, roster, skill data and failed-state handling remain valid',()=>{
 assert.equal(OPERATORS.length,35);for(const map of MAPS){for(const path of map.paths){for(let i=1;i<path.length;i++)assert.equal(Math.abs(path[i][0]-path[i-1][0])+Math.abs(path[i][1]-path[i-1][1]),1);}}
 const g=started();g.s.hp=1;const u=g.gainOp('fang');g.deploy(u.uid,9,3);g.startBattle();runBattle(g);assert.equal(g.s.phase,'finished');assert.equal(g.s.won,false);assert.equal(g.s.hp,0);assert.equal(Game.restore('{broken'),null);assert.equal(Game.restore('{"version":99}'),null);
});
