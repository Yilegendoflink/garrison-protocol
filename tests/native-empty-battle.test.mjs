import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeSession} from '../dist/native-session.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {ROUND_LEAK_CAP} from '../dist/protocol.js';

test('空场可开战：没有干员或全部留在整备区，均正常漏怪、扣血并进入下一回合',()=>{
 for(const benchOnly of [false,true]){
  const g=new NativeSession(NATIVE_DATA,{seed:5});
  if(benchOnly)assert.equal(g.perform('buy',0),true);
  const hp=g.s.hp,units=g.s.units.length;
  assert.equal(g.s.units.filter(u=>u.position).length,0);
  assert.equal(g.perform('start'),true);
  assert.equal(g.s.phase,'battle');
  assert.equal(g.battle.s.units.length,0);
  assert.ok(g.battle.s.queue.length>0,'空场也必须正常生成敌人波次');
  const maxFrames=Math.ceil(g.battle.s.limit*30)+1;
  for(let i=0;i<maxFrames&&g.s.phase==='battle';i++)g.tick();
  assert.equal(g.s.phase,'intermission');
  assert.ok(g.s.lastBattle.leaks>0);
  assert.equal(g.s.lastBattle.loss,Math.min(ROUND_LEAK_CAP,g.s.lastBattle.leaks));
  assert.equal(g.s.hp,hp-g.s.lastBattle.loss);
  assert.equal(g.s.history.at(-1).totalDamage,0);
  assert.equal(g.s.units.length,units,'整备区干员保留');
  assert.equal(g.perform('next'),true);
  assert.equal(g.s.round,2);
 }
});

test('允许空场开战仍须遵守阶段与待领奖限制，漏怪耗尽生命后正常结束',()=>{
 const g=new NativeSession(NATIVE_DATA,{seed:5});
 g.s.rewardPending={tier:2,offers:[]};
 assert.equal(g.startBattle(),false);
 g.s.rewardPending=null;
 g.s.hp=1;
 assert.equal(g.perform('start'),true);
 assert.equal(g.startBattle(),false,'战斗中不能再次开战');
 const maxFrames=Math.ceil(g.battle.s.limit*30)+1;
 for(let i=0;i<maxFrames&&g.s.phase==='battle';i++)g.tick();
 assert.equal(g.s.phase,'finished');
 assert.equal(g.s.hp,0);
 assert.ok(g.s.runResult.leaks>0);
 assert.equal(g.startBattle(),false,'结束后不能再次开战');
});
