import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {defaultWaveTable,loadWaveTable,emptyWaveTable,TRAINING_TYPES,WAVE_STORE_KEY} from '../dist/native-wave-fill.js';
import {fillBudgetWave,waveRng} from '../dist/native-wave-random.js';
import {applyEditorAction,editorState} from '../dist/native-wave-editor.js';

test('every default template draws valid affordable period enemies without placeholders',()=>{
 const table=defaultWaveTable();let count=0;
 for(const t of TRAINING_TYPES)for(const tier of [1,2,3])for(const slot of table.types[t.id][tier].templates){
  count++;assert.ok(slot.pool.length>=2);
  for(const id of slot.pool){assert.ok(NATIVE_DATA.enemies[id]);assert.ok(NATIVE_DATA.season.enemyInfoDict[t.id].includes(id));assert.ok(table.costs[id]<=slot.budget);if(t.id==='FLY')assert.equal(NATIVE_DATA.enemies[id].motion,'FLY');}
  const copy=defaultWaveTable();copy.types[t.id][tier].templates=[slot];const wave=fillBudgetWave(waveRng(42),copy,t.id,tier);
  assert.equal(wave.unfilled,false);const [min,max]=[[6,8],[15,20],[35,40]][tier-1];assert.ok(wave.ids.length>=min&&wave.ids.length<=max);assert.ok(wave.spent<=slot.budget);
 }
 assert.equal(count,42);
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
