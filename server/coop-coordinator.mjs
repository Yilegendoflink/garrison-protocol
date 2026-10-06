import {ServiceError} from './service-error.mjs';
import {chooseJointDefenders} from './random-rules.mjs';

const MAX_FAILED_ENEMIES_PER_PLAYER = 256;

function validateRound(value, expected) {
  if (!Number.isSafeInteger(value) || value !== expected) {
    throw new ServiceError('INVALID_ROUND', `当前协作回合为 ${expected}。`);
  }
}

function validateLeaks(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100_000) {
    throw new ServiceError('INVALID_BATTLE_RESULT', '漏怪数值无效。');
  }
  return value;
}

function normalizeEnemies(value) {
  if (!Array.isArray(value) || value.length > MAX_FAILED_ENEMIES_PER_PLAYER) {
    throw new ServiceError('INVALID_BATTLE_RESULT', '联防敌人清单无效或过长。');
  }
  return value.map(enemy => {
    if (!enemy || typeof enemy !== 'object' || typeof enemy.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(enemy.id)) {
      throw new ServiceError('INVALID_BATTLE_RESULT', '联防敌人编号无效。');
    }
    const route = enemy.route == null ? 0 : enemy.route;
    if (!Number.isSafeInteger(route) || route < 0 || route > 32) {
      throw new ServiceError('INVALID_BATTLE_RESULT', '联防敌人路线无效。');
    }
    const loss = enemy.loss == null ? 1 : enemy.loss;
    if (!Number.isSafeInteger(loss) || loss < 1 || loss > 10_000) {
      throw new ServiceError('INVALID_BATTLE_RESULT', '敌人生命损失数值无效。');
    }
    const normalized = {id: enemy.id, route, loss};
    if (enemy.failedPlayerId != null) {
      if (typeof enemy.failedPlayerId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(enemy.failedPlayerId)) {
        throw new ServiceError('INVALID_BATTLE_RESULT', '联防敌人归属玩家无效。');
      }
      normalized.failedPlayerId = enemy.failedPlayerId;
    }
    return normalized;
  });
}

export class CoopRoundCoordinator {
  constructor(playerIds, {drawIndex} = {}) {
    if (!Array.isArray(playerIds) || playerIds.length < 2 || playerIds.length > 4 || playerIds.some(id => typeof id !== 'string' || !id)) {
      throw new TypeError('协作房间必须包含 2 到 4 名有效玩家。');
    }
    this.activePlayers = new Set(playerIds);
    this.initialPlayerIds = [...playerIds];
    this.round = 1;
    this.stage = 'battle';
    this.battleReports = new Map();
    this.defenseReports = new Map();
    this.bossReports = new Set();
    this.roundReady = new Set();
    this.defenders = [];
    this.eliminatedPlayers = new Set();
    this.drawIndex = drawIndex;
  }

  progress() {
    const expected = this.stage === 'joint-defense' ? this.defenders : ['advance', 'boss'].includes(this.stage) ? [...this.activePlayers].filter(id => !this.eliminatedPlayers.has(id)) : [...this.activePlayers];
    const completed = this.stage === 'joint-defense' ? [...this.defenseReports.keys()] : this.stage === 'boss' ? [...this.bossReports] : [...this.battleReports.keys()];
    return {round: this.round, stage: this.stage, expectedPlayers: expected, completedPlayers: completed};
  }

  finishAtBoss(playerId, payload = {}) {
    this.#requireActive(playerId);
    validateRound(payload.round, this.round);
    if (this.stage === 'finished') return {progress: this.progress(), event: null};
    if (this.stage !== 'battle' && this.stage !== 'boss') throw new ServiceError('WRONG_COOP_STAGE', '当前回合尚未到达 Boss 结束阶段。');
    this.stage = 'boss';
    this.bossReports.add(playerId);
    const continuing = [...this.activePlayers].filter(id => !this.eliminatedPlayers.has(id));
    if (continuing.some(id => !this.bossReports.has(id))) return {progress: this.progress(), event: null};
    this.stage = 'finished';
    return {progress: this.progress(), event: {type: 'coop.game.finished', round: this.round, reason: 'boss-skipped'}};
  }

  submitBattleResult(playerId, payload = {}) {
    this.#requireActive(playerId);
    validateRound(payload.round, this.round);
    const report = {
      playerId,
      leaks: validateLeaks(payload.leaks),
      failedEnemies: normalizeEnemies(payload.failedEnemies || []),
      eliminated: payload.eliminated === true
    };
    const previous = this.battleReports.get(playerId);
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(report)) throw new ServiceError('DUPLICATE_BATTLE_REPORT', '本回合战果已提交，不能修改。');
      return {progress: this.progress(), event: null};
    }
    if (this.stage !== 'battle') throw new ServiceError('WRONG_COOP_STAGE', '当前回合不在普通作战阶段。');
    this.battleReports.set(playerId, report);
    if (report.eliminated) this.eliminatedPlayers.add(playerId);
    if (this.battleReports.size < this.activePlayers.size) return {progress: this.progress(), event: null};
    return {progress: this.progress(), event: this.#resolveBattleReports()};
  }

  submitDefenseResult(playerId, payload = {}) {
    if (!this.defenders.includes(playerId)) throw new ServiceError('NOT_JOINT_DEFENDER', '本回合未被选为联防玩家。');
    validateRound(payload.round, this.round);
    const report = {playerId, leaks: validateLeaks(payload.leaks), failedEnemies: normalizeEnemies(payload.failedEnemies || []), eliminated: payload.eliminated === true};
    const previous = this.defenseReports.get(playerId);
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(report)) throw new ServiceError('DUPLICATE_DEFENSE_REPORT', '联防战果已提交，不能修改。');
      return {progress: this.progress(), event: null};
    }
    if (this.stage !== 'joint-defense') throw new ServiceError('WRONG_COOP_STAGE', '当前没有进行联防。');
    this.defenseReports.set(playerId, report);
    if (report.eliminated) this.eliminatedPlayers.add(playerId);
    if (this.defenseReports.size < this.defenders.length) return {progress: this.progress(), event: null};
    const leaks = [...this.defenseReports.values()].reduce((total, result) => total + result.leaks, 0);
    this.stage = 'advance';
    return {
      progress: this.progress(),
      event: {
        type: 'coop.round.advance',
        round: this.round,
        outcome: 'joint-defense-complete',
        success: leaks === 0,
        defenseLeaks: leaks,
        defenders: [...this.defenders],
        eliminatedPlayers: [...this.eliminatedPlayers]
      }
    };
  }

  readyNextRound(playerId, payload = {}) {
    this.#requireActive(playerId);
    validateRound(payload.round, this.round);
    if (this.stage !== 'advance') throw new ServiceError('WRONG_COOP_STAGE', '队伍尚未完成本回合结算。');
    this.roundReady.add(playerId);
    const continuing = [...this.activePlayers].filter(id => !this.eliminatedPlayers.has(id));
    if (continuing.length === 0) {
      this.stage = 'finished';
      return {progress: this.progress(), event: {type: 'coop.game.finished', round: this.round, reason: 'no-active-players'}};
    }
    if (continuing.some(id => !this.roundReady.has(id))) return {progress: this.progress(), event: null};
    const previousRound = this.round;
    for (const playerId of this.eliminatedPlayers) this.activePlayers.delete(playerId);
    this.round += 1;
    this.stage = 'battle';
    this.battleReports.clear();
    this.defenseReports.clear();
    this.bossReports.clear();
    this.roundReady.clear();
    this.defenders = [];
    this.eliminatedPlayers.clear();
    return {
      progress: this.progress(),
      event: {type: 'coop.round.begin', previousRound, round: this.round, activePlayers: continuing}
    };
  }

  removePlayer(playerId) {
    if (!this.activePlayers.delete(playerId)) return {progress: this.progress(), event: null};
    this.eliminatedPlayers.add(playerId);
    this.battleReports.delete(playerId);
    this.roundReady.delete(playerId);
    this.defenseReports.delete(playerId);
    this.bossReports.delete(playerId);
    this.defenders = this.defenders.filter(id => id !== playerId);
    let event = null;
    if (this.stage === 'battle' && this.battleReports.size === this.activePlayers.size) event = this.#resolveBattleReports();
    else if (this.stage === 'joint-defense' && this.defenseReports.size === this.defenders.length) {
      const leaks = [...this.defenseReports.values()].reduce((total, result) => total + result.leaks, 0);
      this.stage = 'advance';
      event = {type: 'coop.round.advance', round: this.round, outcome: 'joint-defense-complete', success: leaks === 0, defenseLeaks: leaks, defenders: [...this.defenders], eliminatedPlayers: [...this.eliminatedPlayers]};
    } else if (this.stage === 'boss' && [...this.activePlayers].filter(id => !this.eliminatedPlayers.has(id)).every(id => this.bossReports.has(id))) {
      this.stage = 'finished';
      event = {type: 'coop.game.finished', round: this.round, reason: 'boss-skipped'};
    }
    return {progress: this.progress(), event};
  }

  #resolveBattleReports() {
    const reports = [...this.battleReports.values()];
    const perfectPlayers = reports.filter(report => report.leaks === 0 && !report.eliminated).map(report => report.playerId);
    const failedReports = reports.filter(report => report.leaks > 0);
    if (!failedReports.length || !perfectPlayers.length) {
      this.stage = 'advance';
      return {
        type: 'coop.round.advance',
        round: this.round,
        outcome: failedReports.length ? 'no-perfect-defender' : 'all-perfect',
        perfectPlayers,
        failedPlayers: failedReports.map(report => report.playerId),
        eliminatedPlayers: [...this.eliminatedPlayers]
      };
    }
    this.defenders = chooseJointDefenders(perfectPlayers, this.drawIndex);
    const allFailedEnemies = failedReports.flatMap(report => report.failedEnemies.map(enemy => ({...enemy, failedPlayerId: report.playerId})));
    const enemiesByPlayer = Object.fromEntries(this.defenders.map(id => [id, []]));
    allFailedEnemies.forEach((enemy, index) => enemiesByPlayer[this.defenders[index % this.defenders.length]].push(enemy));
    this.defenseReports.clear();
    this.stage = 'joint-defense';
    return {
      type: 'coop.joint-defense.started',
      round: this.round,
      defenders: [...this.defenders],
      perfectPlayers,
      failedPlayers: failedReports.map(report => report.playerId),
      enemiesByPlayer,
      randomSelection: perfectPlayers.length >= 3
    };
  }

  #requireActive(playerId) {
    if (!this.activePlayers.has(playerId)) throw new ServiceError('NOT_ACTIVE_PLAYER', '该玩家不在本局活动成员中。');
  }
}

const STRATEGY_ID = /^band_[A-Za-z0-9_]{1,72}$/;
const MAX_ROUND_LEAK = 10;

function randomIndex(max) {
  if (typeof crypto?.getRandomValues !== 'function') return Math.floor(Math.random() * max);
  const range = 0x1_0000_0000;
  const limit = Math.floor(range / max) * max;
  const sample = new Uint32Array(1);
  do { crypto.getRandomValues(sample); } while (sample[0] >= limit);
  return sample[0] % max;
}

function shuffle(values) {
  const out = [...values];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const other = randomIndex(index + 1);
    [out[index], out[other]] = [out[other], out[index]];
  }
  return out;
}

function publicChoices(choices) {
  return Object.fromEntries([...choices].map(([playerId, choice]) => [playerId, {...choice}]));
}

/** Room-wide strategy selection and preparation clock wrapped around the existing battle fence. */
export class CoopGameCoordinator extends CoopRoundCoordinator {
  constructor(playerIds, options = {}) {
    super(playerIds, options);
    this.stage = 'strategy-availability';
    this.strategyAvailability = new Map();
    this.strategyOrder = [];
    this.strategyIndex = 0;
    this.strategyChoices = new Map();
    this.prepReady = new Set();
    this.playerHp = new Map();
    this.deadlineAt = null;
  }

  progress() {
    const base = super.progress();
    let expectedPlayers = base.expectedPlayers;
    let completedPlayers = base.completedPlayers;
    if (this.stage === 'strategy-availability') {
      expectedPlayers = [...this.activePlayers];
      completedPlayers = [...this.strategyAvailability.keys()];
    } else if (this.stage === 'strategy-selection') {
      expectedPlayers = this.strategyOrder[this.strategyIndex] ? [this.strategyOrder[this.strategyIndex]] : [];
      completedPlayers = [...this.strategyChoices.keys()];
    } else if (this.stage === 'countdown') {
      expectedPlayers = [...this.activePlayers];
      completedPlayers = [...this.strategyChoices.keys()];
    } else if (this.stage === 'prep') {
      expectedPlayers = [...this.activePlayers];
      completedPlayers = [...this.prepReady];
    }
    return {
      ...base,
      stage: this.stage,
      expectedPlayers,
      completedPlayers,
      strategyOrder: [...this.strategyOrder],
      strategyChoices: publicChoices(this.strategyChoices),
      currentPlayerId: this.stage === 'strategy-selection' ? this.strategyOrder[this.strategyIndex] || null : null,
      deadlineAt: this.deadlineAt,
      prepReadyPlayers: [...this.prepReady],
      playerHp: Object.fromEntries(this.playerHp)
    };
  }

  submitStrategyAvailability(playerId, payload = {}, now = Date.now()) {
    this.#requireActivePlayer(playerId);
    if (this.stage !== 'strategy-availability') throw new ServiceError('WRONG_COOP_STAGE', '策略名单已经锁定。');
    const source = Array.isArray(payload.strategies) ? payload.strategies : [];
    if (source.length < this.activePlayers.size || source.length > 256) throw new ServiceError('INVALID_STRATEGIES', '可选策略数量不足或过多。');
    const ids = new Set();
    const strategies = source.map(row => {
      const id = typeof row === 'string' ? row : row?.id;
      const hp = row && typeof row === 'object' ? row.hp : undefined;
      if (typeof id !== 'string' || !STRATEGY_ID.test(id) || ids.has(id) || !Number.isSafeInteger(hp) || hp < 1 || hp > 100_000) {
        throw new ServiceError('INVALID_STRATEGIES', '可选策略或初始生命数据无效。');
      }
      ids.add(id);
      return {id, hp};
    });
    this.strategyAvailability.set(playerId, strategies);
    if ([...this.activePlayers].some(id => !this.strategyAvailability.has(id))) return {progress: this.progress(), event: null};
    this.strategyOrder = shuffle([...this.activePlayers]);
    this.strategyIndex = 0;
    this.deadlineAt = now + 30_000;
    return {progress: this.progress(), event: this.#strategyStateEvent()};
  }

  chooseStrategy(playerId, payload = {}, now = Date.now()) {
    this.#requireActivePlayer(playerId);
    if (this.stage !== 'strategy-selection') throw new ServiceError('WRONG_COOP_STAGE', '当前不是策略选择阶段。');
    if (now >= this.deadlineAt) return this.advanceDeadline(now);
    if (playerId !== this.strategyOrder[this.strategyIndex]) throw new ServiceError('NOT_STRATEGY_TURN', '还没有轮到该玩家选择策略。');
    const bandId = payload.bandId;
    const candidates = this.strategyAvailability.get(playerId) || [];
    const choice = candidates.find(row => row.id === bandId);
    if (!choice || [...this.strategyChoices.values()].some(row => row.id === bandId)) {
      throw new ServiceError('STRATEGY_UNAVAILABLE', '该策略不可用或已被其他玩家选择。');
    }
    this.#recordStrategy(playerId, choice, false);
    return this.#advanceStrategy(now);
  }

  readyForBattle(playerId, payload = {}, now = Date.now()) {
    this.#requireActivePlayer(playerId);
    if (payload.round !== this.round || this.stage !== 'prep') throw new ServiceError('WRONG_COOP_STAGE', '当前不在该回合的整备阶段。');
    this.prepReady.add(playerId);
    if ([...this.activePlayers].some(id => !this.prepReady.has(id))) return {progress: this.progress(), event: null};
    return this.#beginBattle(now);
  }

  advanceDeadline(now = Date.now()) {
    if (this.deadlineAt == null || now < this.deadlineAt) return {progress: this.progress(), event: null};
    if (this.stage === 'strategy-selection') {
      const playerId = this.strategyOrder[this.strategyIndex];
      const used = new Set([...this.strategyChoices.values()].map(row => row.id));
      const candidates = (this.strategyAvailability.get(playerId) || []).filter(row => !used.has(row.id));
      if (!playerId || !candidates.length) throw new ServiceError('NO_STRATEGY_AVAILABLE', '超时后没有可分配的未重复策略。');
      this.#recordStrategy(playerId, candidates[randomIndex(candidates.length)], true);
      return this.#advanceStrategy(now);
    }
    if (this.stage === 'countdown') return this.#enterPrep(now);
    if (this.stage === 'prep') return this.#beginBattle(now);
    return {progress: this.progress(), event: null};
  }

  submitBattleResult(playerId, payload = {}) {
    const result = super.submitBattleResult(playerId, payload);
    if (result.event?.type === 'coop.joint-defense.started') return result;
    if (result.event?.type === 'coop.round.advance') return this.#settleRound(result, this.#battleLosses(), Date.now());
    return result;
  }

  submitDefenseResult(playerId, payload = {}) {
    const result = super.submitDefenseResult(playerId, payload);
    if (result.event?.type === 'coop.round.advance') {
      return this.#settleRound(result, this.#defenseLosses(), Date.now());
    }
    return result;
  }

  snapshot() {
    return {
      initialPlayerIds: [...this.initialPlayerIds],
      activePlayers: [...this.activePlayers],
      round: this.round,
      stage: this.stage,
      battleReports: [...this.battleReports.entries()],
      defenseReports: [...this.defenseReports.entries()],
      bossReports: [...this.bossReports],
      roundReady: [...this.roundReady],
      defenders: [...this.defenders],
      eliminatedPlayers: [...this.eliminatedPlayers],
      strategyAvailability: [...this.strategyAvailability.entries()],
      strategyOrder: [...this.strategyOrder],
      strategyIndex: this.strategyIndex,
      strategyChoices: [...this.strategyChoices.entries()],
      prepReady: [...this.prepReady],
      playerHp: [...this.playerHp.entries()],
      deadlineAt: this.deadlineAt
    };
  }

  static restore(snapshot) {
    const coordinator = new CoopGameCoordinator(snapshot.initialPlayerIds);
    coordinator.activePlayers = new Set(snapshot.activePlayers);
    coordinator.round = snapshot.round;
    coordinator.stage = snapshot.stage;
    coordinator.battleReports = new Map(snapshot.battleReports || []);
    coordinator.defenseReports = new Map(snapshot.defenseReports || []);
    coordinator.bossReports = new Set(snapshot.bossReports || []);
    coordinator.roundReady = new Set(snapshot.roundReady || []);
    coordinator.defenders = [...(snapshot.defenders || [])];
    coordinator.eliminatedPlayers = new Set(snapshot.eliminatedPlayers || []);
    coordinator.strategyAvailability = new Map(snapshot.strategyAvailability || []);
    coordinator.strategyOrder = [...(snapshot.strategyOrder || [])];
    coordinator.strategyIndex = snapshot.strategyIndex || 0;
    coordinator.strategyChoices = new Map(snapshot.strategyChoices || []);
    coordinator.prepReady = new Set(snapshot.prepReady || []);
    coordinator.playerHp = new Map(snapshot.playerHp || []);
    coordinator.deadlineAt = snapshot.deadlineAt ?? null;
    return coordinator;
  }

  removePlayer(playerId) {
    const stageBeforeRemoval = this.stage;
    const result = super.removePlayer(playerId);
    this.strategyAvailability.delete(playerId);
    this.prepReady.delete(playerId);
    if (this.strategyChoices.has(playerId)) {
      this.strategyChoices.delete(playerId);
      this.playerHp.delete(playerId);
    }
    const orderIndex = this.strategyOrder.indexOf(playerId);
    if (orderIndex >= 0) {
      this.strategyOrder.splice(orderIndex, 1);
      if (orderIndex < this.strategyIndex) this.strategyIndex -= 1;
    }
    if (result.event?.type === 'coop.round.advance') {
      return this.#settleRound(result, stageBeforeRemoval === 'joint-defense' ? this.#defenseLosses() : this.#battleLosses(), Date.now());
    }
    if (this.stage === 'strategy-availability' && [...this.activePlayers].every(id => this.strategyAvailability.has(id))) {
      this.strategyOrder = shuffle([...this.activePlayers]);
      this.strategyIndex = 0;
      this.deadlineAt = Date.now() + 30_000;
      return {progress: this.progress(), event: this.#strategyStateEvent()};
    }
    if (this.stage === 'strategy-selection' && this.strategyIndex >= this.strategyOrder.length) return this.#completeStrategies(Date.now());
    if (this.stage === 'prep' && [...this.activePlayers].every(id => this.prepReady.has(id))) return this.#beginBattle(Date.now());
    return {progress: this.progress(), event: result.event};
  }

  #requireActivePlayer(playerId) {
    if (!this.activePlayers.has(playerId)) throw new ServiceError('NOT_ACTIVE_PLAYER', '该玩家不在本局活动成员中。');
  }

  #recordStrategy(playerId, choice, automatic) {
    this.strategyChoices.set(playerId, {...choice, automatic});
    this.playerHp.set(playerId, choice.hp);
    this.strategyIndex += 1;
  }

  #advanceStrategy(now) {
    if (this.strategyIndex >= this.strategyOrder.length) return this.#completeStrategies(now);
    this.deadlineAt = now + 15_000;
    return {progress: this.progress(), event: this.#strategyStateEvent()};
  }

  #completeStrategies(now) {
    this.stage = 'countdown';
    this.deadlineAt = now + 5_000;
    return {progress: this.progress(), event: {
      type: 'coop.strategy.complete',
      order: [...this.strategyOrder],
      strategies: publicChoices(this.strategyChoices),
      countdownDeadlineAt: this.deadlineAt
    }};
  }

  #strategyStateEvent() {
    return {
      type: 'coop.strategy.state',
      order: [...this.strategyOrder],
      strategies: publicChoices(this.strategyChoices),
      currentPlayerId: this.strategyOrder[this.strategyIndex] || null,
      deadlineAt: this.deadlineAt
    };
  }

  #enterPrep(now) {
    this.stage = 'prep';
    this.deadlineAt = now + 90_000;
    this.prepReady.clear();
    return {progress: this.progress(), event: {
      type: 'coop.prep.started',
      round: this.round,
      deadlineAt: this.deadlineAt,
      strategies: publicChoices(this.strategyChoices),
      activePlayers: [...this.activePlayers]
    }};
  }

  #beginBattle(now) {
    this.stage = 'battle';
    this.deadlineAt = null;
    this.prepReady.clear();
    return {progress: this.progress(), event: {type: 'coop.battle.started', round: this.round, startedAt: now, activePlayers: [...this.activePlayers]}};
  }

  #battleLosses() {
    const losses = new Map();
    for (const [playerId, report] of this.battleReports) {
      const amount = report.failedEnemies.reduce((total, enemy) => total + enemy.loss, 0);
      losses.set(playerId, Math.min(MAX_ROUND_LEAK, report.leaks > 0 ? Math.min(report.leaks, amount || report.leaks) : 0));
    }
    return losses;
  }

  #defenseLosses() {
    const losses = new Map();
    const failedPlayers = new Set([...this.battleReports.values()].filter(row => row.leaks > 0).map(row => row.playerId));
    const original = this.#battleLosses();
    let unattributed = 0;
    for (const report of this.defenseReports.values()) {
      for (const enemy of report.failedEnemies) {
        if (enemy.failedPlayerId && failedPlayers.has(enemy.failedPlayerId)) {
          const current = losses.get(enemy.failedPlayerId) || 0;
          const remaining = Math.max(0, (original.get(enemy.failedPlayerId) || 0) - current);
          losses.set(enemy.failedPlayerId, current + Math.min(remaining, enemy.loss));
        }
        else unattributed += enemy.loss;
      }
      if (!report.failedEnemies.length) unattributed += report.leaks;
    }
    if (unattributed > 0) {
      for (const playerId of failedPlayers) {
        const remaining = Math.max(0, (original.get(playerId) || 0) - (losses.get(playerId) || 0));
        const assigned = Math.min(remaining, unattributed);
        if (assigned) losses.set(playerId, (losses.get(playerId) || 0) + assigned);
        unattributed -= assigned;
        if (!unattributed) break;
      }
    }
    for (const [playerId, amount] of losses) losses.set(playerId, Math.min(MAX_ROUND_LEAK, amount));
    return losses;
  }

  #settleRound(result, hpLosses, now) {
    const event = result.event;
    const hpRemaining = {};
    for (const playerId of this.activePlayers) {
      const before = this.playerHp.get(playerId) || 0;
      const loss = Math.min(before, hpLosses.get(playerId) || 0);
      hpLosses.set(playerId, loss);
      const after = Math.max(0, before - loss);
      this.playerHp.set(playerId, after);
      hpRemaining[playerId] = after;
      if (after === 0) this.eliminatedPlayers.add(playerId);
    }
    const previousRound = this.round;
    const surviving = [...this.activePlayers].filter(playerId => !this.eliminatedPlayers.has(playerId));
    Object.assign(event, {
      hpLosses: Object.fromEntries(hpLosses),
      hpRemaining,
      eliminatedPlayers: [...this.eliminatedPlayers],
      previousRound,
      nextRound: surviving.length ? previousRound + 1 : null,
      activePlayers: surviving,
      nextStage: surviving.length ? 'prep' : 'finished'
    });
    if (!surviving.length) {
      this.stage = 'finished';
      this.deadlineAt = null;
      result.followupEvents = [{type: 'coop.game.finished', round: previousRound, reason: 'no-active-players', hpRemaining}];
      result.progress = this.progress();
      return result;
    }
    this.activePlayers = new Set(surviving);
    this.round = previousRound + 1;
    this.stage = 'prep';
    this.deadlineAt = now + 90_000;
    this.battleReports.clear();
    this.defenseReports.clear();
    this.bossReports.clear();
    this.roundReady.clear();
    this.defenders = [];
    this.eliminatedPlayers.clear();
    this.prepReady.clear();
    event.deadlineAt = this.deadlineAt;
    result.progress = this.progress();
    return result;
  }
}
