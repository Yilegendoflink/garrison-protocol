import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {TRAINING_TYPES,PLACEHOLDER_ENEMY,emptyWaveTable,normalizeWaveTable} from '../dist/native-wave-fill.js';
import {createWaveRoster,enemyCombatScale,buildWavePlan,pressureTier,fillBudgetWave,waveRng} from '../dist/native-wave-random.js';
import {buildPhasePlan} from '../dist/protocol.js';

const data=JSON.parse(fs.readFileSync('data/modes/alliance-lower/source.json','utf8'));
const stub={motionMode:'WALK',startPosition:{col:0,row:8},endPosition:{col:10,row:8}};
const air={motionMode:'FLY',startPosition:{col:1,row:8},endPosition:{col:10,row:8}};
data.levels={};
for(const rounds of Object.values(data.season.battleDataDict))for(const battles of Object.values(rounds))for(const b of battles)data.levels[b.levelId.toLowerCase()]={routes:[stub,air]};
data.enemies={enemy_a:{name:'A',motion:'WALK',attributes:{maxHp:1,atk:1}},enemy_b:{name:'B',motion:'WALK',attributes:{maxHp:1,atk:1}},[PLACEHOLDER_ENEMY]:{name:'P',motion:'WALK',attributes:{maxHp:1,atk:1}}};

function rng(seed=1){let x=seed>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;x>>>=0;return x/4294967296;};}

test('opening draw picks three distinct training types and is seed-stable',()=>{
 const a=createWaveRoster({random:rng(7),data,modeId:'mode_single_normal'});
 const b=createWaveRoster({random:rng(7),data,modeId:'mode_single_normal'});
 assert.equal(a.types.length,3);assert.equal(new Set(a.types).size,3);
 for(const id of a.types)assert.ok(TRAINING_TYPES.some(t=>t.id===id));
 assert.deepEqual(a,b);
 const c=createWaveRoster({random:rng(8),data,modeId:'mode_single_normal'});
 assert.notDeepEqual(a,c);
});

test('combat rounds cycle the three types and rise through pressure thirds',()=>{
 const roster=createWaveRoster({random:rng(3),data,modeId:'mode_single_funny'});
 const plan=buildPhasePlan(data,'mode_single_funny');
 const combat=plan.filter(t=>!t.isBossTurn);
 const used=new Set();
 let last=1;
 for(const turn of combat){
  const row=roster.rounds[turn.round];
  assert.equal(row.boss,false);
  assert.ok(roster.types.includes(row.type));
  assert.ok(Number.isInteger(row.waveSeed));
  assert.ok(row.tier>=last);last=row.tier;
  used.add(row.type);
 }
 assert.equal(used.size,3);
 assert.equal(roster.rounds[9].boss,true);
 assert.equal(pressureTier(1,combat.map(t=>t.round)),1);
 assert.equal(pressureTier(8,combat.map(t=>t.round)),3);
});

test('PRTS user-table multipliers cover independent 标准／险境／终极 samples',()=>{
 const funny=data.season.modeDataDict.mode_single_funny;
 const normal=data.season.modeDataDict.mode_single_normal;
 const abyss=data.season.modeDataDict.mode_single_abyss;
 assert.equal(enemyCombatScale(funny,1).atk,.7);
 assert.equal(enemyCombatScale(funny,1).hp,.7);
 assert.equal(enemyCombatScale(normal,4).atk,1.1*.7);
 assert.equal(enemyCombatScale(normal,13).atk,1.1**5*.7);
 assert.equal(enemyCombatScale(abyss,3).moveSpeed,1.15);
 assert.equal(enemyCombatScale(abyss,1).moveSpeed,1);
 assert.equal(enemyCombatScale(abyss,14,{hidden:true}).atk,1.1**7);
});

test('budget fill never exceeds the cap and stops when no remaining enemy fits',()=>{
 const table=emptyWaveTable();table.types.SPECIAL[1]={templates:[{budget:10,pool:['enemy_a','enemy_b']}]};table.costs={enemy_a:3,enemy_b:5};
 const pack=fillBudgetWave(waveRng(9),table,'SPECIAL',1);
 assert.equal(pack.unfilled,false);
 assert.ok(pack.spent<=10);
 assert.ok(pack.ids.every(id=>id==='enemy_a'||id==='enemy_b'));
 assert.ok(pack.leftover<3);
 assert.equal(pack.templateIndex,0);
 const again=fillBudgetWave(waveRng(9),table,'SPECIAL',1);
 assert.deepEqual(again,pack);
});

test('empty pool uses one placeholder; over-budget pool yields nothing',()=>{
 assert.equal(fillBudgetWave(waveRng(1),emptyWaveTable(),'SPECIAL',1).ids[0],PLACEHOLDER_ENEMY);
 const table=emptyWaveTable();table.types.SPECIAL[1]={templates:[{budget:4,pool:['enemy_a']}]};table.costs={enemy_a:9};
 const pack=fillBudgetWave(waveRng(1),table,'SPECIAL',1);
 assert.deepEqual(pack.ids,[]);
 assert.equal(pack.leftover,4);
});

test('legacy single pool migrates to one template; a wave draws from only one of several templates',()=>{
 const migrated=normalizeWaveTable({types:{SPECIAL:{1:{budget:8,pool:['enemy_a']}}}});
 assert.equal(migrated.types.SPECIAL[1].templates.length,1);
 assert.deepEqual(migrated.types.SPECIAL[1].templates[0].pool,['enemy_a']);
 const table=emptyWaveTable();
 table.types.SPECIAL[1]={templates:[{name:'甲',budget:9,pool:['enemy_a']},{name:'乙',budget:10,pool:['enemy_b']}]};
 table.costs={enemy_a:3,enemy_b:5};
 const a=fillBudgetWave(()=>0,table,'SPECIAL',1);
 const b=fillBudgetWave(()=>0.99,table,'SPECIAL',1);
 assert.equal(a.templateName,'甲');
 assert.ok(a.ids.every(id=>id==='enemy_a'));
 assert.equal(b.templateName,'乙');
 assert.ok(b.ids.every(id=>id==='enemy_b'));
});

test('wave plan rebuilds from roster seed without advancing game RNG and marks boss as dummy',()=>{
 const random=rng(11);const roster=createWaveRoster({random,data,modeId:'mode_single_funny'});
 const turn=buildPhasePlan(data,'mode_single_funny').find(t=>t.round===1);
 const table=emptyWaveTable();
 buildWavePlan(data,turn,roster,table);
 buildWavePlan(data,turn,roster,table);
 const after=random();
 const other=rng(11);createWaveRoster({random:other,data,modeId:'mode_single_funny'});
 assert.equal(after,other());
 const plan=buildWavePlan(data,turn,roster,table);
 assert.equal(plan.placeholders,1);
 assert.equal(buildWavePlan(data,buildPhasePlan(data,'mode_single_funny').find(t=>t.isBossTurn),roster,table).benchmark,true);
});

test('table normalize keeps only positive costs and known types',()=>{
 const table=normalizeWaveTable({version:1,defaultCost:0,costs:{enemy_a:2,enemy_b:-1,enemy_c:'x'},types:{SPECIAL:{1:{budget:7,pool:['enemy_a','enemy_a','']}}}});
 assert.equal(table.defaultCost,1);
 assert.equal(table.costs.enemy_a,2);
 assert.equal(table.costs.enemy_b,undefined);
 assert.deepEqual(table.types.SPECIAL[1].templates[0].pool,['enemy_a']);
 assert.equal(table.types.SPECIAL[1].templates[0].budget,7);
});
