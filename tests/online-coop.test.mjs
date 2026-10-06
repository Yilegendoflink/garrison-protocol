import assert from 'node:assert/strict';
import test from 'node:test';
import {WebSocket} from 'ws';
import {CoopRoundCoordinator} from '../server/coop-coordinator.mjs';
import {createSignalingService} from '../server/signaling-server.mjs';
import {NativeSession} from '../dist/native-session.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {buildPhasePlan} from '../dist/protocol.js';

function makeClient(url) {
  const socket = new WebSocket(url);
  const messages = [];
  const waiters = [];
  socket.on('message', raw => {
    const message = JSON.parse(raw.toString());
    messages.push(message);
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (waiter.type !== message.type || !waiter.predicate(message)) continue;
      waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  });
  return {
    socket,
    async opened() {
      await new Promise((resolve, reject) => {
        if (socket.readyState === WebSocket.OPEN) return resolve();
        socket.once('open', resolve);
        socket.once('error', reject);
      });
      return this.waitFor('server.hello');
    },
    send(type, payload = {}) { socket.send(JSON.stringify({type, payload})); },
    waitFor(type, predicate = () => true) {
      const index = messages.findIndex(message => message.type === type && predicate(message));
      if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = {type, predicate, resolve, timer: null};
        waiter.timer = setTimeout(() => {
          const at = waiters.indexOf(waiter);
          if (at >= 0) waiters.splice(at, 1);
          reject(new Error(`Timed out waiting for ${type}`));
        }, 5000);
        waiters.push(waiter);
      });
    }
  };
}

test('co-op coordinator randomly reduces three perfect players to two defenders and gates the next round', () => {
  const coordinator = new CoopRoundCoordinator(['p1', 'p2', 'p3', 'p4'], {drawIndex: () => 0});
  assert.equal(coordinator.submitBattleResult('p1', {round: 1, leaks: 0}).event, null);
  assert.equal(coordinator.submitBattleResult('p2', {round: 1, leaks: 0}).event, null);
  assert.equal(coordinator.submitBattleResult('p3', {round: 1, leaks: 0}).event, null);
  const result = coordinator.submitBattleResult('p4', {
    round: 1,
    leaks: 2,
    failedEnemies: [{id: 'enemy_1001', route: 0}, {id: 'enemy_1002', route: 1}]
  });
  assert.equal(result.event.type, 'coop.joint-defense.started');
  assert.equal(result.event.randomSelection, true);
  assert.equal(result.event.defenders.length, 2);
  assert.ok(result.event.defenders.every(id => ['p1', 'p2', 'p3'].includes(id)));
  assert.equal(Object.values(result.event.enemiesByPlayer).flat().length, 2);
  assert.equal(coordinator.submitDefenseResult(result.event.defenders[0], {round: 1, leaks: 0}).event, null);
  const advanced = coordinator.submitDefenseResult(result.event.defenders[1], {round: 1, leaks: 0});
  assert.equal(advanced.event.type, 'coop.round.advance');
  assert.equal(advanced.event.success, true);
  for (const id of ['p1', 'p2', 'p3', 'p4'].slice(0, 3)) assert.equal(coordinator.readyNextRound(id, {round: 1}).event, null);
  const next = coordinator.readyNextRound('p4', {round: 1});
  assert.equal(next.event.type, 'coop.round.begin');
  assert.equal(next.event.round, 2);
});

test('four WebSocket clients join one pairing room, start together, run defense, and pass the round barrier', async t => {
  const service = createSignalingService({host: '127.0.0.1', port: 0, allowedOrigins: new Set(['*'])});
  const address = await service.listen();
  const clients = Array.from({length: 4}, () => makeClient(`ws://127.0.0.1:${address.port}/ws`));
  t.after(async () => {
    for (const client of clients) client.socket.close();
    await service.close();
  });
  await Promise.all(clients.map(client => client.opened()));
  const createdPromise = clients[0].waitFor('room.created');
  clients[0].send('room.create', {playerName: 'P1', modeId: 'mode_multi_normal', allowUnderfilledStart: false});
  const created = await createdPromise;
  const playerIds = [created.player.id];
  for (const [index, client] of clients.slice(1).entries()) {
    const joinedPromise = client.waitFor('room.joined');
    client.send('room.join', {code: created.room.code, playerName: `P${index + 2}`});
    playerIds.push((await joinedPromise).player.id);
  }
  const allReady = clients[0].waitFor('room.state', message => message.room.players.length === 4 && message.room.players.every(player => player.ready));
  for (const client of clients) client.send('room.ready', {ready: true});
  await allReady;
  const started = clients.map(client => client.waitFor('room.started'));
  clients[0].send('room.start', {mapId: 'act1autochess_m01'});
  await Promise.all(started);

  const battleEvents = clients.map(client => client.waitFor('coop.joint-defense.started'));
  clients[0].send('coop.battle.report', {round: 1, leaks: 0, failedEnemies: []});
  clients[1].send('coop.battle.report', {round: 1, leaks: 0, failedEnemies: []});
  clients[2].send('coop.battle.report', {round: 1, leaks: 0, failedEnemies: []});
  clients[3].send('coop.battle.report', {
    round: 1,
    leaks: 1,
    failedEnemies: [{id: 'enemy_1001', route: 0}]
  });
  const jointDefense = await Promise.all(battleEvents);
  const defenders = jointDefense[0].defenders;
  assert.equal(defenders.length, 2);
  assert.ok(defenders.every(id => playerIds.slice(0, 3).includes(id)));
  assert.equal(Object.values(jointDefense[0].enemiesByPlayer).flat().length, 1);

  const roundEvents = clients.map(client => client.waitFor('coop.round.advance'));
  for (const playerId of defenders) clients[playerIds.indexOf(playerId)].send('coop.joint-defense.report', {round: 1, leaks: 0});
  const advanced = await Promise.all(roundEvents);
  assert.ok(advanced.every(event => event.success && event.defenseLeaks === 0));

  const beginEvents = clients.map(client => client.waitFor('coop.round.begin'));
  for (const client of clients) client.send('coop.round.ready', {round: 1});
  const begun = await Promise.all(beginEvents);
  assert.ok(begun.every(event => event.round === 2 && event.activePlayers.length === 4));

  const finishedEvents = clients.map(client => client.waitFor('coop.game.finished'));
  for (const client of clients) client.send('coop.boss.skip', {round: 2});
  const finished = await Promise.all(finishedEvents);
  assert.ok(finished.every(event => event.reason === 'boss-skipped' && event.round === 2));
});

test('online NativeSession skips the final Boss turn before constructing a battle', () => {
  const game = new NativeSession(NATIVE_DATA, {modeId: 'mode_multi_normal', mapId: 'act1autochess_m01', seed: 42});
  const finalRound = buildPhasePlan(NATIVE_DATA, 'mode_multi_normal').filter(turn => turn.isBossTurn && !turn.isConditional).at(-1).round;
  game.s.onlineCoop = true;
  game.s.round = finalRound;
  assert.equal(game.startBattle(), true);
  assert.equal(game.battle, null);
  assert.equal(game.s.phase, 'finished');
  assert.equal(game.s.runResult.kind, 'online-boss-skipped');
});

test('a selected NativeSession can enter a joint-defense wave with the assigned enemy', () => {
  const game = new NativeSession(NATIVE_DATA, {modeId: 'mode_multi_normal', mapId: 'act1autochess_m01', seed: 43});
  game.s.onlineCoop = true;
  game.s.phase = 'intermission';
  assert.equal(game.startJointDefense([{id: 'enemy_1005_yokai', route: 0}]), true);
  assert.equal(game.s.phase, 'battle');
  assert.equal(game.s.coopStage, 'joint-defense');
  assert.equal(game.battle.s.queue.length, 1);
  assert.equal(game.battle.s.queue[0].id, 'enemy_1005_yokai');
  game.battle.step();
  assert.equal(game.battle.s.queue.length, 0);
  assert.ok(game.battle.s.enemies.some(enemy => enemy.id === 'enemy_1005_yokai' && enemy.routeIndex === 0));
});
