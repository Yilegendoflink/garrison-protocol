import {DurableObject} from 'cloudflare:workers';
import {CoopGameCoordinator, CoopRoundCoordinator} from '../coop-coordinator.mjs';
import {ServiceError} from '../service-error.mjs';
import {
  MAX_ROOM_PLAYERS,
  MAX_SIGNAL_BYTES,
  assertMapId,
  delivery,
  failed,
  hashToken,
  isPlainObject,
  isValidRoomCode,
  normalizeName,
  publicPlayer,
  publicRoom,
  randomInt,
  randomToken,
  roomStateDeliveries,
  validateModeId
} from './shared.mjs';

const ROOM_TTL_MS = 30 * 60 * 1000;
const MAX_FAILED_ENEMIES_PER_PLAYER = 256;
const SIGNAL_WINDOW_MS = 10_000;
const MAX_SIGNALS_PER_WINDOW = 40;

function coordinatorSnapshot(coordinator, initialPlayerIds) {
  if (coordinator instanceof CoopGameCoordinator) return coordinator.snapshot();
  return {
    initialPlayerIds,
    activePlayers: [...coordinator.activePlayers],
    round: coordinator.round,
    stage: coordinator.stage,
    battleReports: [...coordinator.battleReports.entries()],
    defenseReports: [...coordinator.defenseReports.entries()],
    bossReports: [...coordinator.bossReports],
    roundReady: [...coordinator.roundReady],
    defenders: [...coordinator.defenders],
    eliminatedPlayers: [...coordinator.eliminatedPlayers]
  };
}

function restoreCoordinator(snapshot) {
  if (Array.isArray(snapshot.strategyAvailability)) return CoopGameCoordinator.restore(snapshot);
  const coordinator = new CoopRoundCoordinator(snapshot.initialPlayerIds);
  coordinator.activePlayers = new Set(snapshot.activePlayers);
  coordinator.round = snapshot.round;
  coordinator.stage = snapshot.stage;
  coordinator.battleReports = new Map(snapshot.battleReports);
  coordinator.defenseReports = new Map(snapshot.defenseReports);
  coordinator.bossReports = new Set(snapshot.bossReports);
  coordinator.roundReady = new Set(snapshot.roundReady);
  coordinator.defenders = [...snapshot.defenders];
  coordinator.eliminatedPlayers = new Set(snapshot.eliminatedPlayers);
  return coordinator;
}

function requestIdOf(message) {
  return typeof message?.requestId === 'string' && message.requestId.length <= 80 ? message.requestId : undefined;
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

export class GameRoomDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(() => {
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room_state (id INTEGER PRIMARY KEY CHECK (id = 1), snapshot TEXT NOT NULL)');
    });
  }

  #load() {
    const row = this.ctx.storage.sql.exec('SELECT snapshot FROM room_state WHERE id = 1').toArray()[0];
    return row ? JSON.parse(row.snapshot) : null;
  }

  #save(state) {
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO room_state (id, snapshot) VALUES (1, ?)', JSON.stringify(state));
  }

  #delete() {
    this.ctx.storage.sql.exec('DELETE FROM room_state WHERE id = 1');
  }

  #newPlayer(room, playerName, connectionId, tokenHash) {
    const now = Date.now();
    return {
      id: crypto.randomUUID(),
      name: normalizeName(playerName, `玩家 ${room.players.length + 1}`),
      ready: false,
      online: true,
      joinedAt: now,
      lastSeenAt: now,
      tokenHash,
      connectionId,
      signalWindow: null
    };
  }

  #roomShell(code, {modeId, allowUnderfilledStart, visibility}) {
    const now = Date.now();
    return {
      id: crypto.randomUUID(),
      code,
      modeId,
      allowUnderfilledStart,
      visibility,
      phase: 'waiting',
      sessionId: null,
      sessionSeed: null,
      mapId: null,
      hostPlayerId: null,
      players: [],
      revision: 0,
      createdAt: now,
      updatedAt: now,
      startedAt: null
    };
  }

  async createRoom(code, connectionId, payload = {}, requestId = undefined) {
    try {
      if (!isValidRoomCode(code)) throw new ServiceError('INVALID_ROOM_CODE', '房间码格式无效。');
      const modeId = validateModeId(payload.modeId || 'mode_multi_normal');
      const allowUnderfilledStart = payload.allowUnderfilledStart ?? false;
      if (typeof allowUnderfilledStart !== 'boolean') throw new ServiceError('INVALID_SETTINGS', 'allowUnderfilledStart 必须是布尔值。');
      const token = randomToken(code);
      const tokenHash = await hashToken(token);
      if (this.#load()) return {ok: false, collision: true};
      const room = this.#roomShell(code, {modeId, allowUnderfilledStart, visibility: 'private'});
      const player = this.#newPlayer(room, payload.playerName, connectionId, tokenHash);
      room.players.push(player);
      room.hostPlayerId = player.id;
      room.revision = 1;
      const state = {room, coordinator: null};
      this.#save(state);
      const visibleRoom = publicRoom(room);
      return {
        ok: true,
        roomCode: code,
        player: publicPlayer(player),
        sessionToken: token,
        deliveries: [
          delivery(connectionId, 'room.created', {room: visibleRoom, player: publicPlayer(player), sessionToken: token}, requestId),
          ...roomStateDeliveries(room)
        ]
      };
    } catch (error) {
      return failed(error);
    }
  }

  async joinRoom(connectionId, code, payload = {}, requestId = undefined) {
    try {
      if (!isValidRoomCode(code)) throw new ServiceError('ROOM_NOT_FOUND', '房间码无效或房间已关闭。');
      const token = randomToken(code);
      const tokenHash = await hashToken(token);
      const state = this.#load();
      const room = state?.room;
      if (!room) throw new ServiceError('ROOM_NOT_FOUND', '房间码无效或房间已关闭。');
      if (room.visibility !== 'private') throw new ServiceError('ROOM_NOT_JOINABLE', '快速匹配房间不接受房间码加入。');
      if (room.phase !== 'waiting') throw new ServiceError('ROOM_STARTED', '该房间已经开始信令阶段。');
      if (room.players.length >= MAX_ROOM_PLAYERS) throw new ServiceError('ROOM_FULL', '房间已满。');
      const player = this.#newPlayer(room, payload.playerName, connectionId, tokenHash);
      room.players.push(player);
      this.#touch(room);
      this.#save(state);
      await this.ctx.storage.deleteAlarm();
      return {
        ok: true,
        roomCode: code,
        player: publicPlayer(player),
        sessionToken: token,
        deliveries: [
          delivery(connectionId, 'room.joined', {room: publicRoom(room), player: publicPlayer(player), sessionToken: token}, requestId),
          ...roomStateDeliveries(room)
        ]
      };
    } catch (error) {
      return failed(error);
    }
  }

  async rejoinSession(connectionId, sessionToken, requestId = undefined) {
    try {
      if (typeof sessionToken !== 'string' || sessionToken.length < 48 || sessionToken.length > 128) {
        throw new ServiceError('INVALID_SESSION', '成员票据无效或已过期。');
      }
      const separator = sessionToken.indexOf('.');
      const code = separator > 0 ? sessionToken.slice(0, separator).toUpperCase() : '';
      if (!isValidRoomCode(code)) throw new ServiceError('INVALID_SESSION', '成员票据无效或已过期。');
      const tokenHash = await hashToken(sessionToken);
      const state = this.#load();
      const room = state?.room;
      if (!room) throw new ServiceError('INVALID_SESSION', '房间已关闭或成员已离开。');
      const player = room.players.find(entry => entry.tokenHash === tokenHash);
      if (!player) throw new ServiceError('INVALID_SESSION', '成员票据无效或已过期。');
      const previousConnectionId = player.connectionId;
      player.connectionId = connectionId;
      player.online = true;
      player.lastSeenAt = Date.now();
      this.#touch(room);
      this.#save(state);
      await this.ctx.storage.deleteAlarm();
      return {
        ok: true,
        roomCode: code,
        player: publicPlayer(player),
        previousConnectionId,
        deliveries: [
          delivery(connectionId, 'room.rejoined', {room: publicRoom(room), player: publicPlayer(player)}, requestId),
          ...roomStateDeliveries(room)
        ]
      };
    } catch (error) {
      return failed(error);
    }
  }

  async authorizeTurnCredentials(sessionToken) {
    try {
      if (typeof sessionToken !== 'string' || sessionToken.length < 48 || sessionToken.length > 128) {
        throw new ServiceError('INVALID_SESSION', '成员票据无效或已过期。');
      }
      const separator = sessionToken.indexOf('.');
      const code = separator > 0 ? sessionToken.slice(0, separator).toUpperCase() : '';
      if (!isValidRoomCode(code)) throw new ServiceError('INVALID_SESSION', '成员票据无效或已过期。');
      const tokenHash = await hashToken(sessionToken);
      const state = this.#load();
      const room = state?.room;
      if (!room || room.code !== code || room.phase !== 'signaling') {
        throw new ServiceError('TURN_NOT_READY', '房间尚未进入点对点连接阶段。');
      }
      const player = room.players.find(entry => entry.tokenHash === tokenHash);
      if (!player || !player.online) throw new ServiceError('INVALID_SESSION', '成员票据无效或已过期。');
      const now = Date.now();
      if (now - (player.turnCredentialIssuedAt || 0) < 60_000) {
        throw new ServiceError('TURN_RATE_LIMITED', 'TURN 凭据刚刚签发，请稍后重试。');
      }
      player.turnCredentialIssuedAt = now;
      this.#save(state);
      return {ok: true, playerId: player.id};
    } catch (error) {
      return failed(error);
    }
  }

  async createMatchedRoom(code, matches) {
    try {
      if (!isValidRoomCode(code) || !Array.isArray(matches) || matches.length < 2 || matches.length > MAX_ROOM_PLAYERS) {
        throw new ServiceError('INVALID_MATCH', '匹配房间参数无效。');
      }
      const sessions = await Promise.all(matches.map(async match => {
        const token = randomToken(code);
        return {...match, token, tokenHash: await hashToken(token)};
      }));
      if (this.#load()) return {ok: false, collision: true};
      const room = this.#roomShell(code, {modeId: validateModeId(matches[0].modeId), allowUnderfilledStart: true, visibility: 'matchmaking'});
      const created = sessions.map(match => {
        const player = this.#newPlayer(room, match.playerName, match.connectionId, match.tokenHash);
        room.players.push(player);
        return {connectionId: match.connectionId, player: publicPlayer(player), sessionToken: match.token};
      });
      room.hostPlayerId = room.players[0].id;
      this.#touch(room);
      this.#save({room, coordinator: null});
      return {ok: true, room: publicRoom(room), matches: created};
    } catch (error) {
      return failed(error);
    }
  }

  broadcastRoomState() {
    const state = this.#load();
    return {deliveries: state?.room ? roomStateDeliveries(state.room) : []};
  }

  async handleMessage(connectionId, playerId, message) {
    const requestId = requestIdOf(message);
    const payload = isPlainObject(message?.payload) ? message.payload : {};
    try {
      const state = this.#load();
      const room = state?.room;
      if (!room || !playerId) throw new ServiceError('NOT_IN_ROOM', '请先创建或加入房间。');
      const player = room.players.find(entry => entry.id === playerId);
      if (!player || player.connectionId !== connectionId) throw new ServiceError('NOT_IN_ROOM', '当前成员票据已失效。');
      const deliveries = [];

      switch (message.type) {
        case 'room.ready': {
          if (typeof payload.ready !== 'boolean') throw new ServiceError('INVALID_READY', 'ready 必须是布尔值。');
          if (room.phase !== 'waiting') throw new ServiceError('ROOM_STARTED', '房间已开始，不能修改准备状态。');
          player.ready = payload.ready;
          this.#touch(room);
          this.#save(state);
          deliveries.push(delivery(connectionId, 'request.accepted', {action: 'room.ready', revision: room.revision}, requestId));
          deliveries.push(...roomStateDeliveries(room));
          break;
        }
        case 'room.set-settings': {
          if (room.hostPlayerId !== playerId) throw new ServiceError('HOST_ONLY', '只有房主可以执行此操作。');
          if (room.phase !== 'waiting') throw new ServiceError('ROOM_STARTED', '房间已开始，不能修改设置。');
          let changed = false;
          if (Object.hasOwn(payload, 'modeId')) {
            const modeId = validateModeId(payload.modeId);
            changed ||= room.modeId !== modeId;
            room.modeId = modeId;
          }
          if (Object.hasOwn(payload, 'allowUnderfilledStart')) {
            if (typeof payload.allowUnderfilledStart !== 'boolean') throw new ServiceError('INVALID_SETTINGS', 'allowUnderfilledStart 必须是布尔值。');
            changed ||= room.allowUnderfilledStart !== payload.allowUnderfilledStart;
            room.allowUnderfilledStart = payload.allowUnderfilledStart;
          }
          if (changed) for (const member of room.players) member.ready = false;
          this.#touch(room);
          this.#save(state);
          deliveries.push(delivery(connectionId, 'request.accepted', {action: 'room.set-settings', revision: room.revision}, requestId));
          deliveries.push(...roomStateDeliveries(room));
          break;
        }
        case 'room.kick': {
          this.#requireHost(room, playerId);
          if (room.phase !== 'waiting') throw new ServiceError('ROOM_STARTED', '房间开始后不能移除成员。');
          const targetIndex = room.players.findIndex(member => member.id === payload.playerId);
          if (targetIndex < 0) throw new ServiceError('PLAYER_NOT_FOUND', '目标成员不在该房间。');
          if (payload.playerId === playerId) throw new ServiceError('CANNOT_KICK_HOST', '房主不能移除自己。');
          const [removed] = room.players.splice(targetIndex, 1);
          if (state.coordinator) state.coordinator = this.#removeCoopPlayer(state.coordinator, removed.id).snapshot;
          this.#touch(room);
          this.#save(state);
          deliveries.push(delivery(removed.connectionId, 'room.kicked', {roomCode: room.code}));
          deliveries.push(delivery(connectionId, 'request.accepted', {action: 'room.kick', revision: room.revision}, requestId));
          deliveries.push(...roomStateDeliveries(room));
          break;
        }
        case 'room.start': {
          this.#requireHost(room, playerId);
          if (room.phase !== 'waiting') throw new ServiceError('ROOM_STARTED', '房间已经开始。');
          if (room.players.length < 2) throw new ServiceError('ROOM_NEEDS_PLAYERS', '至少需要两名玩家才能开始联机。');
          if (!room.allowUnderfilledStart && room.players.length < MAX_ROOM_PLAYERS) throw new ServiceError('ROOM_NEEDS_PLAYERS', '房间未满 4 人，房主尚未允许不足员开局。');
          if (room.players.some(member => !member.online || !member.ready)) throw new ServiceError('PLAYERS_NOT_READY', '所有房间成员都需要在线并准备。');
          room.phase = 'signaling';
          room.sessionId = crypto.randomUUID();
          room.sessionSeed = randomInt(0xffff_ffff) + 1;
          room.mapId = assertMapId(payload.mapId || 'random');
          room.startedAt = Date.now();
          this.#touch(room);
          const ids = room.players.map(member => member.id);
          state.coordinator = coordinatorSnapshot(new CoopGameCoordinator(ids), ids);
          this.#save(state);
          deliveries.push(delivery(connectionId, 'request.accepted', {action: 'room.start', sessionId: room.sessionId}, requestId));
          const event = {type: 'room.started', sessionId: room.sessionId, room: publicRoom(room)};
          deliveries.push(...room.players.filter(member => member.online).map(member => ({connectionId: member.connectionId, message: event})));
          break;
        }
        case 'coop.strategy.availability':
        case 'coop.strategy.choose':
        case 'coop.prep.ready':
        case 'coop.battle.report':
        case 'coop.joint-defense.report':
        case 'coop.round.ready':
        case 'coop.boss.skip': {
          if (room.phase !== 'signaling') throw new ServiceError('GAME_NOT_STARTED', '房间尚未开始联机局内阶段。');
          const coordinator = state.coordinator ? restoreCoordinator(state.coordinator) : new CoopGameCoordinator(room.players.map(member => member.id));
          let result;
          if (message.type === 'coop.strategy.availability') result = coordinator.submitStrategyAvailability(playerId, payload);
          else if (message.type === 'coop.strategy.choose') result = coordinator.chooseStrategy(playerId, payload);
          else if (message.type === 'coop.prep.ready') result = coordinator.readyForBattle(playerId, payload);
          else if (message.type === 'coop.battle.report') result = coordinator.submitBattleResult(playerId, payload);
          else if (message.type === 'coop.joint-defense.report') result = coordinator.submitDefenseResult(playerId, payload);
          else if (message.type === 'coop.round.ready') result = coordinator.readyNextRound(playerId, payload);
          else result = coordinator.finishAtBoss(playerId, payload);
          state.coordinator = coordinatorSnapshot(coordinator, state.coordinator?.initialPlayerIds || room.players.map(member => member.id));
          this.#touch(room);
          this.#save(state);
          for (const event of [result.event, ...(result.followupEvents || [])].filter(Boolean)) {
            deliveries.push(...room.players.filter(member => member.online).map(member => ({connectionId: member.connectionId, message: event})));
          }
          if (result.progress) {
            const progress = {type: 'coop.progress', ...result.progress};
            deliveries.push(...room.players.filter(member => member.online).map(member => ({connectionId: member.connectionId, message: progress})));
          }
          deliveries.push(delivery(connectionId, 'request.accepted', {action: message.type, round: coordinator.round}, requestId));
          await this.#scheduleCoordinatorAlarm(state);
          break;
        }
        case 'room.leave': {
          const oldCode = room.code;
          const index = room.players.findIndex(member => member.id === playerId);
          room.players.splice(index, 1);
          let coopRemoval = null;
          if (!room.players.length) this.#delete();
          else {
            if (room.hostPlayerId === playerId) room.hostPlayerId = room.players[0].id;
            if (state.coordinator) {
              coopRemoval = this.#removeCoopPlayer(state.coordinator, playerId);
              state.coordinator = coopRemoval.snapshot;
            }
            this.#touch(room);
            this.#save(state);
            deliveries.push(...roomStateDeliveries(room));
            this.#appendCoopResult(deliveries, room, coopRemoval?.result);
            await this.#scheduleCoordinatorAlarm(state);
          }
          if (!room.players.length) await this.ctx.storage.deleteAlarm();
          deliveries.unshift(delivery(connectionId, 'room.left', {roomCode: oldCode}, requestId));
          return {ok: true, clearRoom: true, deliveries};
        }
        case 'signal.offer':
        case 'signal.answer':
        case 'signal.ice': {
          if (room.phase !== 'signaling') throw new ServiceError('SIGNAL_NOT_READY', '房主开始连接阶段后才能交换信令。');
          const now = Date.now();
          if (!player.signalWindow || now - player.signalWindow.startedAt >= SIGNAL_WINDOW_MS) player.signalWindow = {startedAt: now, count: 0};
          player.signalWindow.count += 1;
          if (player.signalWindow.count > MAX_SIGNALS_PER_WINDOW) throw new ServiceError('SIGNAL_RATE_LIMIT', '信令发送过快，请稍后重试。');
          const targetPlayerId = payload.targetPlayerId;
          const data = payload.data;
          if (typeof targetPlayerId !== 'string' || targetPlayerId === playerId) throw new ServiceError('INVALID_SIGNAL_TARGET', '信令目标无效。');
          if (message.type === 'signal.ice') {
            if (data !== null && (!isPlainObject(data) || typeof data.candidate !== 'string')) throw new ServiceError('INVALID_SIGNAL_DATA', 'ICE 信令必须是 candidate 对象或结束标记 null。');
          } else if (!isPlainObject(data) || data.type !== message.type.slice('signal.'.length) || typeof data.sdp !== 'string') {
            throw new ServiceError('INVALID_SIGNAL_DATA', 'offer／answer 信令需要匹配的 type 和 SDP 字符串。');
          }
          if (new TextEncoder().encode(JSON.stringify(data)).byteLength > MAX_SIGNAL_BYTES) throw new ServiceError('SIGNAL_TOO_LARGE', '信令消息超过 48 KB。');
          const target = room.players.find(member => member.id === targetPlayerId);
          if (!target) throw new ServiceError('PLAYER_NOT_IN_ROOM', '信令目标不在当前房间。');
          if (!target.online || !target.connectionId) throw new ServiceError('PEER_OFFLINE', '信令目标当前不在线。');
          this.#save(state);
          deliveries.push(delivery(target.connectionId, 'signal.forward', {
            fromPlayerId: playerId,
            fromName: player.name || '玩家',
            signalType: message.type,
            data
          }));
          deliveries.push(delivery(connectionId, 'signal.sent', {targetPlayerId}, requestId));
          break;
        }
        default:
          throw new ServiceError('UNKNOWN_MESSAGE', '无法识别的服务消息类型。');
      }
      return {ok: true, deliveries};
    } catch (error) {
      return failed(error);
    }
  }

  async setPresence(connectionId, playerId, online) {
    const state = this.#load();
    const room = state?.room;
    const player = room?.players.find(member => member.id === playerId);
    if (!player || player.connectionId !== connectionId || player.online === online) return {deliveries: []};
    player.online = online;
    player.lastSeenAt = Date.now();
    this.#touch(room);
    this.#save(state);
    await this.#scheduleCoordinatorAlarm(state);
    return {deliveries: roomStateDeliveries(room)};
  }

  async alarm() {
    const state = this.#load();
    const room = state?.room;
    if (!room) return;
    const coordinator = state.coordinator ? restoreCoordinator(state.coordinator) : null;
    if (coordinator?.deadlineAt != null && Date.now() >= coordinator.deadlineAt) {
      const result = coordinator.advanceDeadline(Date.now());
      state.coordinator = coordinatorSnapshot(coordinator, coordinator.initialPlayerIds);
      this.#touch(room);
      this.#save(state);
      const events = [result.event, ...(result.followupEvents || [])].filter(Boolean);
      for (const event of events) for (const player of room.players.filter(member => member.online && member.connectionId)) {
        try {
          const session = this.env.CLIENT_SESSIONS.get(this.env.CLIENT_SESSIONS.idFromString(player.connectionId));
          await session.deliver(event);
        } catch {}
      }
      if (result.progress) for (const player of room.players.filter(member => member.online && member.connectionId)) {
        try {
          const session = this.env.CLIENT_SESSIONS.get(this.env.CLIENT_SESSIONS.idFromString(player.connectionId));
          await session.deliver({type: 'coop.progress', ...result.progress});
        } catch {}
      }
    }
    const latest = this.#load();
    await this.#scheduleCoordinatorAlarm(latest);
  }

  #touch(room) {
    room.revision += 1;
    room.updatedAt = Date.now();
  }

  async #scheduleCoordinatorAlarm(state) {
    const room = state?.room;
    if (!room) return this.ctx.storage.deleteAlarm();
    const deadlines = [];
    if (Number.isSafeInteger(state.coordinator?.deadlineAt)) deadlines.push(state.coordinator.deadlineAt);
    if (room.players.every(member => !member.online)) deadlines.push(room.updatedAt + ROOM_TTL_MS);
    if (!deadlines.length) return this.ctx.storage.deleteAlarm();
    await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, Math.min(...deadlines)));
  }

  #requireHost(room, playerId) {
    if (room.hostPlayerId !== playerId) throw new ServiceError('HOST_ONLY', '只有房主可以执行此操作。');
  }

  #removeCoopPlayer(snapshot, playerId) {
    const coordinator = restoreCoordinator(snapshot);
    const result = coordinator.removePlayer(playerId);
    return {snapshot: coordinatorSnapshot(coordinator, snapshot.initialPlayerIds), result};
  }

  #appendCoopResult(deliveries, room, result) {
    if (!result) return;
    for (const event of [result.event, ...(result.followupEvents || [])].filter(Boolean)) deliveries.push(...room.players
      .filter(member => member.online && member.connectionId)
      .map(member => ({connectionId: member.connectionId, message: event})));
    if (result.progress) {
      const progress = {type: 'coop.progress', ...result.progress};
      deliveries.push(...room.players
        .filter(member => member.online && member.connectionId)
        .map(member => ({connectionId: member.connectionId, message: progress})));
    }
  }
}
