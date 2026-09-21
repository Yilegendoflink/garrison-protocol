import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {NATIVE_DATA as data} from '../dist/runtime-data.js';
import {enemyActivity,enemyPoolEligible,normalizeWaveTable,emptyWaveTable,currentTemplate,saveWaveTable} from '../dist/native-wave-fill.js';
import {fillBudgetWave,waveRng,filterRandomPoolTable} from '../dist/native-wave-random.js';
import {editorState,enemyRows,filterRows,applyEditorAction,applyEditorField,renderWaveEditor} from '../dist/native-wave-editor.js';

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

test('editor activity/readiness/search filters combine and reject incompatible additions',()=>{
 const table=emptyWaveTable(),ui=editorState(),rows=enemyRows(data);
 assert.equal(filterRows(rows,ui,data,table).length,ready.length);
 applyEditorField('ed-activity',null,enemyActivity(a),table,ui);
 assert.ok(filterRows(rows,ui,data,table).every(e=>enemyActivity(e.id)===enemyActivity(a)&&enemyPoolEligible(e.id,data)));
 ui.activity='all';ui.readiness='pending';assert.ok(filterRows(rows,ui,data,table).every(e=>!enemyPoolEligible(e.id,data)));
 ui.readiness='ready';ui.query=enemyActivity(a);assert.ok(filterRows(rows,ui,data,table).some(e=>e.id===a));
 assert.equal(applyEditorAction('ed-add',{id:a},table,ui,data),'render');
 assert.equal(applyEditorAction('ed-add',{id:b},table,ui,data),'incompatible');
 assert.equal(applyEditorAction('ed-add',{id:pending},table,ui,data),'incompatible');
 assert.deepEqual(currentTemplate(table,'SPECIAL',1).pool,[a]);
 applyEditorAction('ed-copy-temp',{},table,ui,data);assert.equal(currentTemplate(table,'SPECIAL',1,1).activity,enemyActivity(a));
 assert.match(renderWaveEditor(data,table,ui),/筛选登场活动/);
});

test('bulk fill is activity/eligibility/cost constrained and preview excludes pending-only templates',()=>{
 const table=emptyWaveTable(),ui=editorState();
 assert.equal(applyEditorAction('ed-fill-type',{},table,ui,data),'choose-activity');
 const id=data.season.enemyInfoDict.SPECIAL.find(id=>enemyPoolEligible(id,data));
 applyEditorField('ed-template-activity',null,enemyActivity(id),table,ui);
 assert.equal(applyEditorAction('ed-fill-type',{},table,ui,data),'filled');
 const slot=currentTemplate(table,'SPECIAL',1);
 assert.ok(slot.pool.length);assert.ok(slot.pool.every(id=>enemyActivity(id)===slot.activity&&enemyPoolEligible(id,data)));
 table.types.SPECIAL[1].templates=[{pool:[pending],budget:8},{pool:[a,b],budget:8}];
 const filtered=filterRandomPoolTable(table,data);
 for(let seed=1;seed<=50;seed++){
  const wave=fillBudgetWave(waveRng(seed),filtered,'SPECIAL',1);
  assert.equal(wave.unfilled,false);assert.ok(!wave.ids.includes(pending));assert.equal(new Set(wave.ids.map(enemyActivity)).size,1);
 }
});

test('preview is opt-in, always samples selected template, and closes without changing configuration',()=>{
 const table=emptyWaveTable(),ui=editorState();
 table.types.SPECIAL[1].templates=[{name:'其他模板',pool:[a],budget:8},{name:'当前模板',pool:[b],budget:6}];
 ui.template=1;
 const original=structuredClone(table);
 assert.doesNotMatch(renderWaveEditor(data,table,ui),/<dialog|wave-ed-test-results/);
 assert.equal(ui.sample,null);
 for(let i=0;i<20;i++){
  applyEditorAction('ed-roll',{},table,ui,data);
  assert.equal(ui.sample.templateName,'当前模板');
  assert.ok(ui.sample.ids.length);assert.ok(ui.sample.ids.every(id=>id===b));
 }
 assert.match(renderWaveEditor(data,table,ui),/<dialog id="wave-ed-test"/);
 assert.deepEqual(table,original);
 applyEditorAction('ed-close-test',{},table,ui,data);
 assert.equal(ui.sample,null);assert.doesNotMatch(renderWaveEditor(data,table,ui),/<dialog/);
 table.types.SPECIAL[1].templates[1].pool=[];
 applyEditorAction('ed-roll',{},table,ui,data);
 assert.equal(ui.sample.unfilled,true);assert.equal(ui.sample.templateName,'当前模板');
 applyEditorAction('ed-temp',{index:'0'},table,ui,data);assert.equal(ui.sample,null);
 applyEditorAction('ed-roll',{},table,ui,data);assert.ok(ui.sample.ids.every(id=>id===a));
});
