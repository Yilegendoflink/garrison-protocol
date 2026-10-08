import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_DATA as data} from '../dist/runtime-data.js';
import {buildPhasePlan} from '../dist/protocol.js';
import {originalEnemyGroups,pickWeightedGroup,originalWaveQueue} from '../dist/native-wave-original.js';
import {createWaveRoster,waveRng,buildWavePlan,buildFinalBossAddQueue,scheduleWaveQueue} from '../dist/native-wave-random.js';
import {defaultWaveTable,loadWaveTable,WAVE_STORE_KEY} from '../dist/native-wave-fill.js';
import {DEFAULT_WAVE_TABLE} from '../dist/native-wave-defaults.js';
import {NativeSession} from '../dist/native-session.js';
import {editorState,applyEditorField,renderWaveEditor} from '../dist/native-wave-editor.js';
import {weeklyChallengeSnapshot} from '../dist/native-challenges.js';

const roster=(seed=42,modeId='mode_single_normal')=>createWaveRoster({random:waveRng(seed),data,modeId,generation:'original'});
test('all difficulty draws honor three non-special types, complete groups, stage and exclusions',()=>{
 for(const modeId of Object.keys(data.season.modeDataDict).filter(id=>id!=='mode_training_1'))for(let seed=1;seed<=40;seed++){
  const r=roster(seed,modeId),banned=new Set(data.season.modeDataDict[modeId].inactiveEnemyKey);
  assert.equal(r.version,3);assert.equal(new Set(r.types).size,3);assert.ok(!r.types.includes('SPECIAL'));
  for(const t of buildPhasePlan(data,modeId).filter(t=>!t.isBossTurn)){
   const p=buildWavePlan(data,t,r),g=data.season.specialEnemyInfoDict[p.assignment.groupId],ids=new Set([g.specialEnemyKey,...g.attachedNormalEnemyKeys,...g.attachedEliteEnemyKeys]);
   assert.equal(g.isInFirstHalf,t.round<=7);assert.ok(g.type==='SPECIAL'||r.types.includes(g.type));
   assert.ok(p.queue.length);assert.ok(p.queue.every(q=>!banned.has(q.id)&&data.enemies[q.id].enemyBehavior.randomPoolEligible!==false&&(q.role==='fixed'||ids.has(q.id))));
  }
 }
 assert.deepEqual(roster(),roster());assert.notDeepEqual(roster(41),roster(42));
 const r=roster(),turn=buildPhasePlan(data,r.modeId)[0];assert.deepEqual(buildWavePlan(data,turn,r,defaultWaveTable()).queue,buildWavePlan(data,turn,r).queue);
 const rounds=Object.values(roster().rounds).filter(a=>!a.boss);assert.ok(rounds.some((a,i)=>i&&a.type===rounds[i-1].type));assert.ok(rounds.some(a=>a.type==='SPECIAL'));
});

test('relative weights and whole-group filtering preserve role identity including duplicate IDs',()=>{
 const groups=[{randomWeight:8},{randomWeight:10},{randomWeight:15}];
 assert.equal(pickWeightedGroup(()=>7/33,groups),groups[0]);assert.equal(pickWeightedGroup(()=>8/33,groups),groups[1]);assert.equal(pickWeightedGroup(()=>18/33,groups),groups[2]);
 const types=Object.keys(data.season.enemyInfoDict),all=originalEnemyGroups(data,'mode_single_hard',types,true).concat(originalEnemyGroups(data,'mode_single_hard',types,false));
 assert.equal(all.length,59);assert.ok(!all.some(g=>g.specialEnemyKey==='enemy_9008_acbunn'));
 const g=data.season.specialEnemyInfoDict.enemy_1197_sfshu;assert.equal(g.specialEnemyKey,g.attachedEliteEnemyKeys[0]);
 const r=roster(),turn=buildPhasePlan(data,r.modeId).find(t=>t.round===4),level=data.levels[turn.battles[0].levelId.toLowerCase()],q=originalWaveQueue(data,level,g);
 assert.ok(q.some(e=>e.role==='special'));assert.ok(q.some(e=>e.role==='elite'));assert.ok(q.every(e=>['enemy_1197_sfshu','enemy_1195_sfyin'].includes(e.id)));
});

test('fixed opening enemies, original late batches and asymmetric routes survive scheduling',()=>{
 const r=roster(),turns=buildPhasePlan(data,r.modeId),opening=buildWavePlan(data,turns[0],r);
 assert.equal(opening.queue.filter(q=>q.id==='enemy_1007_slime').length,2);assert.ok(opening.queue.every(q=>['fixed','normal'].includes(q.role)));
 const turn=turns.find(t=>t.round===8),level=data.levels[turn.battles[0].levelId.toLowerCase()],group=originalEnemyGroups(data,r.modeId,r.types,false).find(g=>g.type==='SPECIAL');
 const queue=originalWaveQueue(data,level,group),normal=queue.filter(q=>q.role==='normal'),byRow=row=>normal.filter(q=>level.routes[q.route].startPosition.row===row);
 assert.ok(queue.some(q=>q.at>=62));assert.notEqual(byRow(9).length,byRow(12).length);
 const extra={id:'enemy_1007_slime',at:80,route:0,bountyReward:2};assert.deepEqual(scheduleWaveQueue([...queue,extra],level,8),[...queue,extra]);
});

test('preview, bounty insertion and saved queues use the same immutable batch schedule',()=>{
 const g=new NativeSession(data,{seed:42});g.s.round=8;g.s.pendingBounties=[{enemyId:'enemy_1007_slime',count:2,coin:2}];
 const base=buildWavePlan(data,buildPhasePlan(data,g.s.modeId).find(t=>t.round===8),g.s.waveRoster).queue;
 const prepared=g.prepareDoorWaveQueue();assert.deepEqual(prepared.queue.filter(q=>q.original).map(({door,...q})=>q),base);
 assert.equal(prepared.queue.filter(q=>q.bountyReward===2).length,2);assert.ok(prepared.queue.filter(q=>q.bountyReward===2).every(q=>q.at>base.at(-1).at));
 const restored=NativeSession.restore(data,g.snapshot());assert.ok(restored);assert.deepEqual(restored.s.preparedDoorWave,prepared);assert.deepEqual(restored.s.waveRoster,g.s.waveRoster);
 const bad=g.snapshot();bad.s.waveRoster.rounds[8].groupId='missing';assert.equal(NativeSession.restore(data,bad),null);
 const legacy=new NativeSession(data,{seed:7,waveRoster:createWaveRoster({random:waveRng(7),data,modeId:'mode_single_normal',generation:'budget'})});assert.equal(NativeSession.restore(data,legacy.snapshot()).s.waveRoster.version,2);
 const adds=buildFinalBossAddQueue(data,g.s.waveRoster,42,g.map.bossDoorRoutes);assert.equal(adds.length,30);assert.equal(adds.at(-1).at,90);assert.ok(adds.every(q=>!data.season.modeDataDict[g.s.modeId].inactiveEnemyKey.includes(q.id)));
});

test('default configuration migrates without overwriting custom tables, editor switches preserve templates',()=>{
 const old=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),values=new Map();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)}});
 try{
  assert.equal(defaultWaveTable().generation,'original');values.set(WAVE_STORE_KEY,JSON.stringify({...DEFAULT_WAVE_TABLE,finalBossHpMultiplier:.9}));assert.equal(loadWaveTable().generation,'original');assert.equal(loadWaveTable().finalBossHpMultiplier,.9);
  const custom=structuredClone(DEFAULT_WAVE_TABLE);custom.types.FLY[1].templates[0].budget++;values.set(WAVE_STORE_KEY,JSON.stringify(custom));assert.equal(loadWaveTable().generation,undefined);
  const table=defaultWaveTable(),ui=editorState(),before=structuredClone(table.types);assert.match(renderWaveEditor(data,table,ui),/原版敌人编组/);assert.doesNotMatch(renderWaveEditor(data,table,ui),/id="ed-budget"/);
  applyEditorField('ed-generation',null,'budget',table,ui);assert.match(renderWaveEditor(data,table,ui),/id="ed-budget"/);assert.deepEqual(table.types,before);assert.equal(loadWaveTable().generation,'budget');
  applyEditorField('ed-generation',null,'original',table,ui);assert.equal(loadWaveTable().generation,'original');assert.deepEqual(table.types,before);
 }finally{if(old)Object.defineProperty(globalThis,'localStorage',old);else delete globalThis.localStorage;}
});

test('weekly challenge keeps its species restriction and original budget queues',()=>{
 const entry=data.weeklyChallenges.entries[0],weeklyChallenge=weeklyChallengeSnapshot(entry,Date.parse(entry.startsAt));
 const g=new NativeSession(data,{seed:42,weeklyChallenge});assert.equal(g.s.waveRoster.version,2);
 for(const turn of buildPhasePlan(data,g.s.modeId).filter(t=>!t.isBossTurn)){
  const p=buildWavePlan(data,turn,g.s.waveRoster,null,weeklyChallenge);assert.ok(p.queue.length);assert.ok(p.queue.every(q=>data.enemies[q.id].prtsRace==='海怪'&&q.at<=40));
 }
 assert.ok(NativeSession.restore(data,g.snapshot()));
});
