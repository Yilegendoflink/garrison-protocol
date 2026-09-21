import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_DATA as data} from '../dist/runtime-data.js';
import {buildPhasePlan} from '../dist/protocol.js';
import {scheduleWaveQueue,buildWavePlan,createWaveRoster,waveRng,enemyCombatScale} from '../dist/native-wave-random.js';
import {NativeSession} from '../dist/native-session.js';
import {NativeBattle} from '../dist/native-battle.js';

const turns=buildPhasePlan(data,'mode_single_normal');
const level=data.levels[turns.find(t=>t.round===4).battles[0].levelId.toLowerCase()];
const ground=level.routes.findIndex(r=>r.motionMode==='WALK');
const air=level.routes.findIndex(r=>r.motionMode==='FLY');
const row=q=>level.routes[q.route].startPosition.row;

test('species are interleaved across 2–40 seconds with balanced entrances independent of route multiplicity',()=>{
 const source=[...Array.from({length:37},()=>({id:'many',route:ground})),...Array.from({length:6},()=>({id:'few',route:air})),{id:'one',route:ground,bountyReward:8}];
 const queue=scheduleWaveQueue(source,level,4);
 assert.equal(queue.length,44);assert.equal(queue[0].at,2);assert.equal(queue.at(-1).at,40);
 assert.ok(source.every(q=>q.at===undefined));
 for(let i=1;i<queue.length;i++)assert.ok(Math.abs(queue[i].at-queue[i-1].at-38/43)<1e-9);
 assert.equal(queue.filter(q=>row(q)===9).length,22);
 for(const id of ['many','few','one']){
  const entries=queue.filter(q=>q.id===id);
  assert.ok(Math.abs(entries.filter(q=>row(q)===9).length-entries.filter(q=>row(q)===12).length)<=1);
 }
 const few=queue.filter(q=>q.id==='few');assert.ok(few[0].at<8&&few.at(-1).at>34);
 assert.ok(few.every(q=>level.routes[q.route].motionMode==='FLY'));
 assert.equal(queue.find(q=>q.id==='one').bountyReward,8);
 assert.deepEqual(scheduleWaveQueue(queue,level,4),queue);
 for(const round of [1,2,3])assert.ok(scheduleWaveQueue(source,level,round).every(q=>row(q)===9));
 assert.deepEqual(scheduleWaveQueue([],level,4),[]);
 assert.equal(scheduleWaveQueue(source.slice(0,1),level,1)[0].at,2);
 assert.equal(scheduleWaveQueue(Array.from({length:80},()=>source[0]),level,10).at(-1).at,40);
});

test('all modes use lower entrance in early rounds and balanced upper/lower thereafter',()=>{
 for(const modeId of Object.keys(data.season.modeDataDict)){
  const roster=createWaveRoster({random:waveRng(42),data,modeId});
  for(const turn of buildPhasePlan(data,modeId).filter(t=>!t.isBossTurn)){
   const plan=buildWavePlan(data,turn,roster),counts=new Map();
   for(const q of plan.queue){const p=plan.level.routes[q.route].startPosition;assert.equal(p.col,10);assert.ok(q.at>=2&&q.at<=40);counts.set(p.row,(counts.get(p.row)||0)+1);}
   if(turn.round<=3)assert.deepEqual([...counts.keys()],[9]);
   else assert.ok(Math.abs((counts.get(9)||0)-(counts.get(12)||0))<=1);
   const base=enemyCombatScale(data.season.modeDataDict[modeId],turn.round,{hidden:!!turn.isConditional});
   assert.equal(plan.scale.hp,base.hp*(turn.round===1?.8:1));assert.equal(plan.scale.atk,base.atk);
  }
 }
});

test('real map spawn coordinates, first-round HP and bounty pacing use the same rules',()=>{
 for(const map of data.maps.filter(m=>m.weight>0))for(const round of [1,4]){
  const session=new NativeSession(data,{mapId:map.stageId,seed:42});
  session.s.pendingBounty={count:3,enemyId:'enemy_1000_gopro_2',coin:2};
  const battle=new NativeBattle(data,session,map,turns.find(t=>t.round===round));
  assert.ok(battle.s.queue.every(q=>q.at<=40));
  assert.equal(battle.s.queue.filter(q=>q.bountyReward===2).length,3);
  for(const q of battle.s.queue){const route=battle.level.routes[q.route],p=battle.path(route,route.motionMode==='FLY')[0];assert.equal(p.x,10);assert.ok(round===1?p.y===3:p.y===0||p.y===3);assert.equal(map.grid[p.y][p.x].tileKey,'tile_start');}
  const id='enemy_1000_gopro_2';battle.spawn({id,route:0});
  const raw=battle.enemyRaw(id);assert.equal(battle.s.enemies.at(-1).maxHp,raw.attributes.maxHp*(enemyCombatScale(data.season.modeDataDict.mode_single_normal,round).hp*(round===1?.8:1)));
  const countEnemy=Object.entries(data.enemies).find(([,e])=>e.enemyBehavior?.hitCountHp);
  battle.spawn({id:countEnemy[0],route:0});assert.equal(battle.s.enemies.at(-1).maxHp,battle.enemyRaw(countEnemy[0]).attributes.maxHp);
 }
});

test('real battle steps consume the entire wave by 40 seconds',()=>{
 const session=new NativeSession(data,{seed:42});session.s.hp=100000;
 const battle=new NativeBattle(data,session,session.map,turns.find(t=>t.round===4));
 const planned=battle.s.queue.map(q=>({...q})),spawned=[],spawn=battle.spawn.bind(battle);
 battle.spawn=(q,...args)=>{spawned.push({id:q.id,at:battle.s.time});return spawn(q,...args);};
 while(battle.s.time<40&&!battle.s.finished)battle.step();
 assert.equal(battle.s.queue.length,0);assert.equal(spawned.length,planned.length);
 assert.equal(spawned[0].at,2);assert.equal(spawned.at(-1).at,40);
});
