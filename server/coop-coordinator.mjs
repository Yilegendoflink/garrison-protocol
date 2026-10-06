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
    return {id: enemy.id, route};
  });
}

export class CoopRoundCoordinator {
  constructor(playerIds, {drawIndex} = {}) {
    if (!Array.isArray(playerIds) || playerIds.length < 2 || playerIds.length > 4 || playerIds.some(id => typeof id !== 'string' || !id)) {
      throw new TypeError('协作房间必须包含 2 到 4 名有效玩家。');
    }
    this.activePlayers = new Set(playerIds);
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
    const report = {playerId, leaks: validateLeaks(payload.leaks), eliminated: payload.eliminated === true};
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
