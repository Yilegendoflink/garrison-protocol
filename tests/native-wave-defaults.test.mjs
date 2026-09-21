import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {defaultWaveTable,loadWaveTable,emptyWaveTable,TRAINING_TYPES,WAVE_STORE_KEY,enemyActivity} from '../dist/native-wave-fill.js';
import {fillBudgetWave,waveRng} from '../dist/native-wave-random.js';
import {applyEditorAction,editorState} from '../dist/native-wave-editor.js';

test('every default template draws valid affordable period enemies without placeholders',()=>{
 const table=defaultWaveTable();let count=0;
 for(const t of TRAINING_TYPES)for(const tier of [1,2,3])for(const slot of table.types[t.id][tier].templates){
  count++;assert.ok(slot.pool.length>=1,'单一活动允许只有一种本期敌人');
  const {themes}=JSON.parse(fs.readFileSync('data/modes/alliance-lower/wave-theme-rules.json','utf8'));
  const theme=themes.find(row=>row.id===slot.theme&&row.type===t.id);assert.ok(theme);
  assert.ok(slot.pool.every(id=>theme.activities.includes(enemyActivity(id))));
  assert.ok(slot.pool.some(id=>enemyActivity(id)===slot.activity),'保留基础活动核心');
  if(tier>=2){assert.ok(new Set(slot.pool).size>=4);assert.equal(slot.minKinds,4);}
  assert.ok(slot.pool.every(id=>NATIVE_DATA.enemies[id].enemyBehavior.randomPoolEligible===true));
  for(const id of slot.pool){assert.ok(NATIVE_DATA.enemies[id]);assert.ok(NATIVE_DATA.season.enemyInfoDict[t.id].includes(id));assert.ok(table.costs[id]<=slot.budget);if(tier===1){assert.equal(slot.maxCost,4);assert.ok(table.costs[id]<=slot.maxCost);}if(t.id==='FLY')assert.equal(NATIVE_DATA.enemies[id].motion,'FLY');}
  const copy=defaultWaveTable();copy.types[t.id][tier].templates=[slot];const wave=fillBudgetWave(waveRng(42),copy,t.id,tier);
  if(tier>=2){assert.ok(new Set(wave.ids).size>=4);for(let seed=1;seed<=30;seed++)assert.ok(new Set(fillBudgetWave(waveRng(seed),copy,t.id,tier).ids).size>=4);}
  assert.equal(wave.unfilled,false);const [min,max]=[[6,8],[15,20],[35,40]][tier-1];assert.ok(wave.ids.length>=min&&wave.ids.length<=max);assert.ok(wave.spent<=slot.budget);
 }
 assert.ok(count>0,'模板表不应为空');
});
test('first launch defaults, saved edits survive, reset persists a fresh table',()=>{
 const old=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),values=new Map();
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)}});
 try{
  const initial=loadWaveTable();assert.deepEqual(initial,defaultWaveTable());initial.types.SPECIAL[1].templates[0].pool=[];assert.ok(defaultWaveTable().types.SPECIAL[1].templates[0].pool.length);
  const custom=emptyWaveTable();custom.defaultCost=7;values.set(WAVE_STORE_KEY,JSON.stringify(custom));assert.deepEqual(loadWaveTable(),custom);
  assert.equal(applyEditorAction('ed-defaults',{},custom,editorState(),NATIVE_DATA),'defaults');assert.deepEqual(custom,defaultWaveTable());assert.deepEqual(loadWaveTable(),defaultWaveTable());
  values.set(WAVE_STORE_KEY,'invalid json');assert.deepEqual(loadWaveTable(),defaultWaveTable());
 }finally{if(old)Object.defineProperty(globalThis,'localStorage',old);else delete globalThis.localStorage;}
});
