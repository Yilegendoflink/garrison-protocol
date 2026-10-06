import {createHash, randomBytes, randomInt, randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {ServiceError} from './service-error.mjs';

export {ServiceError} from './service-error.mjs';

export const ONLINE_MODE_IDS = Object.freeze([
  'mode_multi_funny',
  'mode_multi_normal',
  'mode_multi_hard',
  'mode_multi_abyss'
]);

const MODE_ID_SET = new Set(ONLINE_MODE_IDS);
const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_PLAYERS = 4;

export function validateModeId(modeId) {
  if (typeof modeId !== 'string' || !MODE_ID_SET.has(modeId)) {
    throw new ServiceError('INVALID_MODE', '当前服务只开放四种正式同盟难度。');
  }
  return modeId;
}

function normalizeName(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const name = [...value.replace(/[\u0000-\u001f\u007f]/g, '').trim()].slice(0, 24).join('');
  return name || fallback;
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function makeRoomCode(existing) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    let code = '';
    for (let i = 0; i < 6; i += 1) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
    if (!existing.has(code)) return code;
  }
  throw new ServiceError('ROOM_CODE_EXHAUSTED', '暂时无法生成房间码，请稍后重试。');
}

export class RoomManager extends EventEmitter {
  constructor({now = Date.now, matchmakingBatchMs = 900, roomTtlMs = 30 * 60 * 1000} = {}) {
    super();
    this.now = now;
    this.matchmakingBatchMs = matchmakingBatchMs;
    this.roomTtlMs = roomTtlMs;
    this.rooms = new Map();
    this.playerRooms = new Map();
    this.sessionTokens = new Map();
    this.queues = new Map();
    this.queueByConnection = new Map();
    this.queueTimers = new Map();
  }

  createRoom({playerName, modeId = 'mode_multi_normal', allowUnderfilledStart = false} = {}) {
    validateModeId(modeId);
    if (typeof allowUnderfilledStart !== 'boolean') {
      throw new ServiceError('INVALID_SETTINGS', 'allowUnderfilledStart 必须是布尔值。');
    }
    const room = this.#newRoom({modeId, allowUnderfilledStart, visibility: 'private'});
    const member = this.#addPlayer(room, playerName, {online: true});
    room.hostPlayerId = member.player.id;
    this.#touch(room);
    return {room: this.#publicRoom(room), ...member};
  }

  joinRoom(code, {playerName} = {}) {
    const room = this.#requireRoom(code);
    if (room.visibility !== 'private') throw new ServiceError('ROOM_NOT_JOINABLE', '快速匹配房间不接受房间码加入。');
    if (room.phase !== 'waiting') throw new ServiceError('ROOM_STARTED', '该房间已经开始信令阶段。');
    if (room.players.length >= MAX_PLAYERS) throw new ServiceError('ROOM_FULL', '房间已满。');
    const member = this.#addPlayer(room, playerName, {online: true});
    this.#touch(room);
    return {room: this.#publicRoom(room), ...member};
  }

  resumeSession(sessionToken) {
    if (typeof sessionToken !== 'string' || sessionToken.length < 32 || sessionToken.length > 128) {
      throw new ServiceError('INVALID_SESSION', '成员票据无效或已过期。');
    }
    const identity = this.sessionTokens.get(hashToken(sessionToken));
    if (!identity) throw new ServiceError('INVALID_SESSION', '成员票据无效或已过期。');
    const room = this.rooms.get(identity.roomCode);
    const player = room?.players.find(entry => entry.id === identity.playerId);
    if (!room || !player) throw new ServiceError('INVALID_SESSION', '房间已关闭或成员已离开。');
    player.online = true;
    player.lastSeenAt = this.now();
    this.#touch(room);
    return {room: this.#publicRoom(room), player: this.#publicPlayer(player), sessionToken};
  }

  setPresence(playerId, online) {
    const room = this.#roomForPlayer(playerId);
    if (!room) return null;
    const player = room.players.find(entry => entry.id === playerId);
    if (!player || player.online === online) return this.#publicRoom(room);
    player.online = online;
    player.lastSeenAt = this.now();
    this.#touch(room);
    return this.#publicRoom(room);
  }

  setReady(playerId, ready) {
    if (typeof ready !== 'boolean') throw new ServiceError('INVALID_READY', 'ready 必须是布尔值。');
    const {room, player} = this.#requirePlayer(playerId);
    if (room.phase !== 'waiting') throw new ServiceError('ROOM_STARTED', '房间已开始，不能修改准备状态。');
    player.ready = ready;
    this.#touch(room);
    return this.#publicRoom(room);
  }

  setSettings(playerId, settings = {}) {
    const {room} = this.#requirePlayer(playerId);
    this.#requireHost(room, playerId);
    if (room.phase !== 'waiting') throw new ServiceError('ROOM_STARTED', '房间已开始，不能修改设置。');
    let changed = false;
    if (Object.hasOwn(settings, 'modeId')) {
      const modeId = validateModeId(settings.modeId);
      changed ||= room.modeId !== modeId;
      room.modeId = modeId;
    }
    if (Object.hasOwn(settings, 'allowUnderfilledStart')) {
      if (typeof settings.allowUnderfilledStart !== 'boolean') {
        throw new ServiceError('INVALID_SETTINGS', 'allowUnderfilledStart 必须是布尔值。');
      }
      changed ||= room.allowUnderfilledStart !== settings.allowUnderfilledStart;
      room.allowUnderfilledStart = settings.allowUnderfilledStart;
    }
    if (changed) for (const player of room.players) player.ready = false;
    this.#touch(room);
    return this.#publicRoom(room);
  }

  kickPlayer(hostPlayerId, targetPlayerId) {
    const {room} = this.#requirePlayer(hostPlayerId);
    this.#requireHost(room, hostPlayerId);
    if (room.phase !== 'waiting') throw new ServiceError('ROOM_STARTED', '房间开始后不能移除成员。');
    if (targetPlayerId === hostPlayerId) throw new ServiceError('CANNOT_KICK_HOST', '房主不能移除自己。');
    if (!room.players.some(player => player.id === targetPlayerId)) {
      throw new ServiceError('PLAYER_NOT_FOUND', '目标成员不在该房间。');
    }
    return this.#removePlayer(room, targetPlayerId, 'kicked');
  }

  startRoom(playerId, {mapId = 'random'} = {}) {
    const {room} = this.#requirePlayer(playerId);
    this.#requireHost(room, playerId);
    if (room.phase !== 'waiting') throw new ServiceError('ROOM_STARTED', '房间已经开始。');
    if (room.players.length < 2) throw new ServiceError('ROOM_NEEDS_PLAYERS', '至少需要两名玩家才能开始联机。');
    if (!room.allowUnderfilledStart && room.players.length < MAX_PLAYERS) {
      throw new ServiceError('ROOM_NEEDS_PLAYERS', '房间未满 4 人，房主尚未允许不足员开局。');
    }
    if (room.players.length < 1) throw new ServiceError('ROOM_EMPTY', '空房间不能开始。');
    if (room.players.some(player => !player.online || !player.ready)) {
      throw new ServiceError('PLAYERS_NOT_READY', '所有房间成员都需要在线并准备。');
    }
    if (typeof mapId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(mapId)) {
      throw new ServiceError('INVALID_MAP', '作战阵地编号无效。');
    }
    room.phase = 'signaling';
    room.sessionId = randomUUID();
    room.sessionSeed = randomInt(1, 0x1_0000_0000);
    room.mapId = mapId;
    room.startedAt = this.now();
    this.#touch(room);
    return {room: this.#publicRoom(room), sessionId: room.sessionId, sessionSeed: room.sessionSeed};
  }

  leaveRoom(playerId, reason = 'left') {
    const room = this.#roomForPlayer(playerId);
    if (!room) throw new ServiceError('NOT_IN_ROOM', '当前连接没有加入房间。');
    return this.#removePlayer(room, playerId, reason);
  }

  getRoom(code) {
    const room = this.rooms.get(String(code || '').trim().toUpperCase());
    return room ? this.#publicRoom(room) : null;
  }

  enqueueMatchmaking(connectionId, {playerName, modeId = 'mode_multi_normal', minPlayers = 2} = {}) {
    validateModeId(modeId);
    if (!Number.isInteger(minPlayers) || minPlayers < 2 || minPlayers > MAX_PLAYERS) {
      throw new ServiceError('INVALID_MATCH_SIZE', 'minPlayers 必须是 2 到 4 之间的整数。');
    }
    if (this.queueByConnection.has(connectionId)) {
      throw new ServiceError('ALREADY_SEARCHING', '该连接已经在匹配队列中。');
    }
    const key = `${modeId}:${minPlayers}`;
    const ticket = {
      id: randomUUID(),
      connectionId,
      playerName: normalizeName(playerName, '玩家'),
      modeId,
      minPlayers,
      createdAt: this.now()
    };
    const queue = this.queues.get(key) || [];
    queue.push(ticket);
    this.queues.set(key, queue);
    this.queueByConnection.set(connectionId, key);
    if (queue.length >= MAX_PLAYERS) this.#scheduleMatch(key, 0);
    else if (queue.length >= minPlayers) this.#scheduleMatch(key, this.matchmakingBatchMs);
    return {ticketId: ticket.id, queuePosition: queue.length};
  }

  cancelMatchmaking(connectionId) {
    const key = this.queueByConnection.get(connectionId);
    if (!key) return false;
    const queue = this.queues.get(key) || [];
    const remaining = queue.filter(ticket => ticket.connectionId !== connectionId);
    this.queueByConnection.delete(connectionId);
    if (remaining.length) this.queues.set(key, remaining);
    else {
      this.queues.delete(key);
      const timer = this.queueTimers.get(key);
      if (timer) clearTimeout(timer);
      this.queueTimers.delete(key);
    }
    return true;
  }

  expireInactiveRooms() {
    const cutoff = this.now() - this.roomTtlMs;
    for (const room of this.rooms.values()) {
      if (room.updatedAt < cutoff && room.players.every(player => !player.online)) {
        this.#deleteRoom(room, 'expired');
      }
    }
  }

  close() {
    for (const timer of this.queueTimers.values()) clearTimeout(timer);
    this.queueTimers.clear();
    this.queues.clear();
    this.queueByConnection.clear();
  }

  #newRoom({modeId, allowUnderfilledStart, visibility}) {
    const code = makeRoomCode(this.rooms);
    const now = this.now();
    const room = {
      id: randomUUID(),
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
    this.rooms.set(code, room);
    return room;
  }

  #addPlayer(room, name, {online}) {
    const id = randomUUID();
    const sessionToken = randomBytes(32).toString('base64url');
    const player = {
      id,
      name: normalizeName(name, `玩家 ${room.players.length + 1}`),
      ready: false,
      online,
      joinedAt: this.now(),
      lastSeenAt: this.now(),
      tokenHash: hashToken(sessionToken)
    };
    room.players.push(player);
    this.playerRooms.set(id, room.code);
    this.sessionTokens.set(player.tokenHash, {roomCode: room.code, playerId: id});
    return {player: this.#publicPlayer(player), sessionToken};
  }

  #scheduleMatch(key, delay) {
    if (this.queueTimers.has(key)) return;
    const timer = setTimeout(() => this.#flushQueue(key), delay);
    timer.unref?.();
    this.queueTimers.set(key, timer);
  }

  #flushQueue(key) {
    this.queueTimers.delete(key);
    const queue = this.queues.get(key) || [];
    const minPlayers = queue[0]?.minPlayers;
    if (!minPlayers || queue.length < minPlayers) return;
    const selected = queue.splice(0, Math.min(MAX_PLAYERS, queue.length));
    const room = this.#newRoom({
      modeId: selected[0].modeId,
      allowUnderfilledStart: true,
      visibility: 'matchmaking'
    });
    const matches = selected.map(ticket => ({ticket, ...this.#addPlayer(room, ticket.playerName, {online: true})}));
    room.hostPlayerId = matches[0].player.id;
    this.#touch(room);
    for (const match of matches) this.queueByConnection.delete(match.ticket.connectionId);
    if (queue.length) this.queues.set(key, queue);
    else this.queues.delete(key);
    this.emit('matched', matches.map(match => ({
      connectionId: match.ticket.connectionId,
      ticketId: match.ticket.id,
      player: match.player,
      sessionToken: match.sessionToken,
      room: this.#publicRoom(room)
    })));
    if (queue.length >= minPlayers) this.#scheduleMatch(key, this.matchmakingBatchMs);
  }

  #removePlayer(room, playerId, reason) {
    const index = room.players.findIndex(player => player.id === playerId);
    if (index < 0) throw new ServiceError('PLAYER_NOT_FOUND', '成员不在该房间。');
    const [removed] = room.players.splice(index, 1);
    this.playerRooms.delete(playerId);
    this.sessionTokens.delete(removed.tokenHash);
    if (room.hostPlayerId === playerId && room.players.length) room.hostPlayerId = room.players[0].id;
    if (!room.players.length) {
      this.#deleteRoom(room, reason);
      return {room: null, roomCode: room.code, removedPlayer: this.#publicPlayer(removed), reason, closed: true};
    }
    this.#touch(room);
    this.emit('playerLeft', {roomCode: room.code, playerId, reason});
    return {room: this.#publicRoom(room), roomCode: room.code, removedPlayer: this.#publicPlayer(removed), reason, closed: false};
  }

  #deleteRoom(room, reason) {
    this.rooms.delete(room.code);
    for (const player of room.players) {
      this.playerRooms.delete(player.id);
      this.sessionTokens.delete(player.tokenHash);
    }
    this.emit('roomClosed', {roomCode: room.code, reason});
  }

  #touch(room) {
    room.revision += 1;
    room.updatedAt = this.now();
    const state = this.#publicRoom(room);
    this.emit('roomChanged', state);
    return state;
  }

  #publicRoom(room) {
    return {
      id: room.id,
      code: room.code,
      modeId: room.modeId,
      allowUnderfilledStart: room.allowUnderfilledStart,
      visibility: room.visibility,
      phase: room.phase,
      sessionId: room.sessionId,
      sessionSeed: room.sessionSeed,
      mapId: room.mapId,
      hostPlayerId: room.hostPlayerId,
      playerCount: room.players.length,
      maxPlayers: MAX_PLAYERS,
      players: room.players.map(player => this.#publicPlayer(player)),
      revision: room.revision,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      startedAt: room.startedAt
    };
  }

  #publicPlayer(player) {
    return {
      id: player.id,
      name: player.name,
      ready: player.ready,
      online: player.online,
      joinedAt: player.joinedAt,
      lastSeenAt: player.lastSeenAt
    };
  }

  #requireRoom(code) {
    const normalized = String(code || '').trim().toUpperCase();
    const room = this.rooms.get(normalized);
    if (!room) throw new ServiceError('ROOM_NOT_FOUND', '房间码无效或房间已关闭。');
    return room;
  }

  #roomForPlayer(playerId) {
    const code = this.playerRooms.get(playerId);
    return code ? this.rooms.get(code) || null : null;
  }

  #requirePlayer(playerId) {
    const room = this.#roomForPlayer(playerId);
    if (!room) throw new ServiceError('NOT_IN_ROOM', '当前连接没有加入房间。');
    const player = room.players.find(entry => entry.id === playerId);
    if (!player) throw new ServiceError('NOT_IN_ROOM', '当前连接没有加入房间。');
    return {room, player};
  }

  #requireHost(room, playerId) {
    if (room.hostPlayerId !== playerId) throw new ServiceError('HOST_ONLY', '只有房主可以执行此操作。');
  }
}
