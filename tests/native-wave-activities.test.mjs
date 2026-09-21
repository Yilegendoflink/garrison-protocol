import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {NATIVE_DATA as data} from '../dist/runtime-data.js';
import {enemyActivity,enemyPoolEligible,normalizeWaveTable,emptyWaveTable,currentTemplate,saveWaveTable} from '../dist/native-wave-fill.js';
import {fillBudgetWave,waveRng,filterRandomPoolTable} from '../dist/native-wave-random.js';

const ready=data.enemyIndex.filter(e=>enemyPoolEligible(e.id,data));
const a=ready[0].id,b=ready.find(e=>enemyActivity(e.id)!==enemyActivity(a)).id;
const pending=data.enemyIndex.find(e=>!enemyPoolEligible(e.id,data)).id;

test('all period enemies have traceable PRTS activity, independent of logic eligibility',()=>{
 const source=JSON.parse(fs.readFileSync('data/prts/enemy-activities.json','utf8'));
 for(const e of data.enemyIndex){
  assert.equal(source.entries[e.id].name,e.name);
  assert.deepEqual(source.entries[e.id].activities,[enemyActivity(e.id)]);
  assert.match(source.entries[e.id].url,/^https:\/\/prts\.wiki\/w\//);
  assert.equal(enemyPoolEligible(e.id),e.enemyBehavior.randomPoolEligible);
 }
});

test('mixed legacy/imported pools split without losing enemies, costs or count limits',()=>{
 const raw={costs:{[a]:2,[b]:3},types:{SPECIAL:{1:{templates:[{name:'旧混合',budget:30,minCount:6,maxCount:8,maxCost:4,pool:[a,b]}]}}}};
 const table=normalizeWaveTable(raw),slots=table.types.SPECIAL[1].templates;
 assert.equal(slots.length,2);assert.deepEqual(slots.flatMap(s=>s.pool),[a,b]);
 for(const s of slots){assert.equal(s.budget,30);assert.equal(s.minCount,6);assert.equal(s.maxCount,8);assert.equal(s.maxCost,4);}
 assert.deepEqual(saveWaveTable(table),table);assert.equal(raw.types.SPECIAL[1].templates.length,1);
 for(let seed=1;seed<=100;seed++){
  const wave=fillBudgetWave(waveRng(seed),raw,'SPECIAL',1);
  assert.equal(new Set(wave.ids.map(enemyActivity)).size,1);assert.equal(enemyActivity(wave.ids[0]),wave.activity);
 }
});
