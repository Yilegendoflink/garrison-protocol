import {DurableObject} from 'cloudflare:workers';
import {ServiceError} from '../service-error.mjs';
import {isPlainObject, normalizeName, randomRoomCode, validateModeId} from './shared.mjs';

const MAX_ROOM_PLAYERS = 4;
const BATCH_DELAY_MS = 900;

export class MatchmakerDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(() => {
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS queue_state (id INTEGER PRIMARY KEY CHECK (id = 1), snapshot TEXT NOT NULL)');
    });
  }

  #load() {
    const row = this.ctx.storage.sql.exec('SELECT snapshot FROM queue_state WHERE id = 1').toArray()[0];
    return row ? JSON.parse(row.snapshot) : {queues: {}};
  }

  #save(state) {
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO queue_state (id, snapshot) VALUES (1, ?)', JSON.stringify(state));
  }

  async search(connectionId, payload = {}) {
    try {
      const modeId = validateModeId(payload.modeId || 'mode_multi_normal');
      const minPlayers = payload.minPlayers ?? 2;
      if (!Number.isInteger(minPlayers) || minPlayers < 2 || minPlayers > MAX_ROOM_PLAYERS) {
        throw new ServiceError('INVALID_MATCH_SIZE', 'minPlayers 必须是 2 到 4 之间的整数。');
      }
      const state = this.#load();
      if (Object.values(state.queues).some(queue => queue.entries.some(entry => entry.connectionId === connectionId))) {
        throw new ServiceError('ALREADY_SEARCHING', '该连接已经在匹配队列中。');
      }
      const key = `${modeId}:${minPlayers}`;
      const queue = state.queues[key] || {entries: [], dueAt: null};
      const ticket = {
        ticketId: crypto.randomUUID(),
        connectionId,
        playerName: normalizeName(payload.playerName, '玩家'),
        modeId,
        minPlayers,
        createdAt: Date.now()
      };
      queue.entries.push(ticket);
      if (queue.entries.length >= MAX_ROOM_PLAYERS) queue.dueAt = Date.now();
      else if (queue.entries.length >= minPlayers && queue.dueAt == null) queue.dueAt = Date.now() + BATCH_DELAY_MS;
      state.queues[key] = queue;
      this.#save(state);
      await this.#scheduleNextAlarm(state);
      return {ok: true, ticketId: ticket.ticketId, queuePosition: queue.entries.length};
    } catch (error) {
      return {ok: false, error: {code: error.code || 'INTERNAL_ERROR', message: error.message || '匹配请求失败。'}};
    }
  }

  async cancel(connectionId) {
    const state = this.#load();
    let cancelled = false;
    for (const [key, queue] of Object.entries(state.queues)) {
      const remaining = queue.entries.filter(entry => entry.connectionId !== connectionId);
      if (remaining.length !== queue.entries.length) cancelled = true;
      queue.entries = remaining;
      if (!remaining.length) delete state.queues[key];
      else if (remaining.length < remaining[0].minPlayers) queue.dueAt = null;
    }
    this.#save(state);
    await this.#scheduleNextAlarm(state);
    return {cancelled};
  }

  async alarm() {
    const now = Date.now();
    const state = this.#load();
    const batches = [];
    for (const [key, queue] of Object.entries(state.queues)) {
      const minPlayers = queue.entries[0]?.minPlayers;
      if (!minPlayers || queue.entries.length < minPlayers || queue.dueAt == null || queue.dueAt > now) continue;
      const selected = queue.entries.splice(0, Math.min(MAX_ROOM_PLAYERS, queue.entries.length));
      batches.push({key, selected});
      queue.dueAt = queue.entries.length >= minPlayers ? now + BATCH_DELAY_MS : null;
      if (!queue.entries.length) delete state.queues[key];
    }
    this.#save(state);
    await this.#scheduleNextAlarm(state);

    for (const batch of batches) await this.#createRoomForBatch(batch.selected);
  }

  async #createRoomForBatch(selected) {
    let result = null;
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const code = randomRoomCode();
      result = await this.env.GAME_ROOMS.getByName(code).createMatchedRoom(code, selected);
      if (!result.collision) break;
    }
    if (!result?.ok) {
      const error = result?.error || {code: 'ROOM_CODE_EXHAUSTED', message: '暂时无法生成匹配房间，请稍后重试。'};
      await Promise.allSettled(selected.map(entry => this.#deliver(entry.connectionId, {type: 'error', ...error})));
      return;
    }
    const attached = await Promise.allSettled(result.matches.map(match => this.env.CLIENT_SESSIONS
      .get(this.env.CLIENT_SESSIONS.idFromString(match.connectionId))
      .attachRoom(result.room.code, match.player.id, false)));
    const events = result.matches.map(match => ({
      connectionId: match.connectionId,
      message: {type: 'matchmaking.matched', room: result.room, player: match.player, sessionToken: match.sessionToken}
    }));
    await this.#dispatch(events);
    const roomDeliveries = await this.env.GAME_ROOMS.getByName(result.room.code).broadcastRoomState();
    await this.#dispatch(roomDeliveries.deliveries || []);
    if (attached.some(item => item.status === 'rejected')) {
      console.warn(JSON.stringify({level: 'warn', message: 'some matched sessions were no longer connected', roomCode: result.room.code}));
    }
  }

  async #deliver(connectionId, message) {
    return this.env.CLIENT_SESSIONS.get(this.env.CLIENT_SESSIONS.idFromString(connectionId)).deliver(message);
  }

  async #dispatch(deliveries) {
    for (const item of deliveries) await this.#deliver(item.connectionId, item.message);
  }

  async #scheduleNextAlarm(state) {
    const dueAt = Object.values(state.queues).map(queue => queue.dueAt).filter(value => Number.isSafeInteger(value));
    if (!dueAt.length) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.min(...dueAt));
  }
}
