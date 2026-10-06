import {DurableObject} from 'cloudflare:workers';
import {ServiceError} from '../service-error.mjs';
import {onlineDiagnostic, roomTag, shortId} from '../online-diagnostic.mjs';
import {
  MAX_MESSAGE_BYTES,
  ONLINE_MODE_IDS,
  errorPayload,
  isPlainObject,
  isValidRoomCode,
  randomRoomCode,
  requestIdOf
} from './shared.mjs';

const encoder = new TextEncoder();

export class ClientSessionDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
  }

  async setRateKey(rateKey) {
    await this.ctx.storage.put('rateKey', rateKey);
  }

  async fetch(request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected Upgrade: websocket', {status: 426});
    }
    if (request.method !== 'GET') return new Response('Expected GET method', {status: 400});
    const rateKey = await this.ctx.storage.get('rateKey') || null;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment({roomCode: null, playerId: null, searching: false, rateKey});
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({type: 'server.hello', protocolVersion: 1, playerCapacity: 4, availableModes: ONLINE_MODE_IDS}));
    onlineDiagnostic('websocket.accepted', {connection: shortId(this.#connectionId())});
    return new Response(null, {status: 101, webSocket: client});
  }

  async webSocketMessage(socket, data) {
    try {
      await this.#handleMessage(socket, data);
    } catch (error) {
      console.error(JSON.stringify({level: 'error', message: 'websocket message failed', error: error instanceof Error ? error.message : String(error)}));
      this.#send(socket, errorPayload(error));
    }
  }

  async webSocketClose(socket, code, reason) {
    const attachment = socket.deserializeAttachment() || {};
    onlineDiagnostic('websocket.closed', {
      room: roomTag(attachment.roomCode),
      player: shortId(attachment.playerId),
      connection: shortId(this.#connectionId()),
      code: Number.isInteger(code) ? code : null,
      reasonLength: typeof reason === 'string' ? reason.length : null
    }, code === 1000 || code === 1001 ? 'info' : 'warn');
    await this.#handleDisconnect(socket);
  }

  async webSocketError(socket) {
    const attachment = socket.deserializeAttachment() || {};
    onlineDiagnostic('websocket.error', {
      room: roomTag(attachment.roomCode),
      player: shortId(attachment.playerId),
      connection: shortId(this.#connectionId())
    }, 'warn');
    await this.#handleDisconnect(socket);
  }

  async deliver(message) {
    let delivered = 0;
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      this.#updateAttachmentForMessage(socket, message);
      this.#send(socket, message);
      delivered += 1;
    }
    return delivered;
  }

  async attachRoom(roomCode, playerId, searching = false) {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() || {rateKey: null};
      attachment.roomCode = roomCode;
      attachment.playerId = playerId;
      attachment.searching = searching;
      socket.serializeAttachment(attachment);
    }
    return true;
  }

  async closeSession(code = 4001, reason = 'session replaced') {
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.close(code, reason); } catch {}
    }
  }

  #connectionId() {
    return this.ctx.id.toString();
  }

  #send(socket, message) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  #sendServiceError(socket, error, requestId) {
    this.#send(socket, errorPayload(error, requestId));
  }

  async #allowAction(socket, action, limit) {
    const rateKey = socket.deserializeAttachment()?.rateKey;
    if (!rateKey) return true;
    return this.env.IP_LIMITERS.getByName(rateKey).consume(action, limit, 60_000);
  }

  async #handleMessage(socket, data) {
    if (typeof data !== 'string') {
      this.#sendServiceError(socket, new ServiceError('BINARY_NOT_ALLOWED', '服务仅接受 JSON 文本消息。'));
      return;
    }
    if (encoder.encode(data).byteLength > MAX_MESSAGE_BYTES) {
      this.#sendServiceError(socket, new ServiceError('MESSAGE_TOO_LARGE', '消息超过 64 KB。'));
      return;
    }
    let message;
    try { message = JSON.parse(data); }
    catch {
      this.#sendServiceError(socket, new ServiceError('INVALID_JSON', '消息不是有效 JSON。'));
      return;
    }
    if (!isPlainObject(message) || typeof message.type !== 'string' || message.type.length > 64) {
      this.#sendServiceError(socket, new ServiceError('INVALID_MESSAGE', '消息必须包含有效的 type。'), requestIdOf(message));
      return;
    }

    const requestId = requestIdOf(message);
    const payload = isPlainObject(message.payload) ? message.payload : {};
    const attachment = socket.deserializeAttachment() || {roomCode: null, playerId: null, searching: false, rateKey: null};
    const connectionId = this.#connectionId();

    if (message.type === 'room.create' || message.type === 'room.join' || message.type === 'room.rejoin') {
      if (attachment.roomCode || attachment.playerId) {
        this.#sendServiceError(socket, new ServiceError('ALREADY_IN_ROOM', '请先离开当前房间。'), requestId);
        return;
      }
      await this.#handleRoomEntry(socket, message.type, payload, requestId, attachment, connectionId);
      return;
    }

    if (message.type === 'matchmaking.search') {
      if (attachment.roomCode || attachment.playerId) {
        this.#sendServiceError(socket, new ServiceError('ALREADY_IN_ROOM', '请先离开当前房间。'), requestId);
        return;
      }
      if (!await this.#allowAction(socket, 'matchmaking', 10)) {
        this.#sendServiceError(socket, new ServiceError('RATE_LIMITED', '匹配请求过于频繁，请稍后重试。'), requestId);
        return;
      }
      const result = await this.env.MATCHMAKER.getByName('global').search(connectionId, payload);
      if (!result.ok) this.#sendServiceError(socket, new ServiceError(result.error.code, result.error.message), requestId);
      else {
        attachment.searching = true;
        socket.serializeAttachment(attachment);
        this.#send(socket, {type: 'matchmaking.queued', ticketId: result.ticketId, queuePosition: result.queuePosition, requestId});
      }
      return;
    }

    if (message.type === 'matchmaking.cancel') {
      const result = await this.env.MATCHMAKER.getByName('global').cancel(connectionId);
      attachment.searching = false;
      socket.serializeAttachment(attachment);
      this.#send(socket, {type: 'matchmaking.cancelled', cancelled: result.cancelled, requestId});
      return;
    }

    if (!attachment.roomCode || !attachment.playerId) {
      this.#sendServiceError(socket, new ServiceError('NOT_IN_ROOM', '请先创建或加入房间。'), requestId);
      return;
    }
    const room = this.env.GAME_ROOMS.getByName(attachment.roomCode);
    const result = await room.handleMessage(connectionId, attachment.playerId, message);
    if (!result.ok) {
      onlineDiagnostic('message.rejected', {
        room: roomTag(attachment.roomCode),
        player: shortId(attachment.playerId),
        type: message.type,
        code: result.error?.code || 'UNKNOWN'
      }, 'warn');
      this.#send(socket, {type: 'error', ...result.error, requestId});
      return;
    }
    if (result.clearRoom) {
      attachment.roomCode = null;
      attachment.playerId = null;
      socket.serializeAttachment(attachment);
    }
    await this.#dispatch(socket, result.deliveries || []);
  }

  async #handleRoomEntry(socket, type, payload, requestId, attachment, connectionId) {
    if (type === 'room.create') {
      if (!await this.#allowAction(socket, 'create-room', 30)) {
        this.#sendServiceError(socket, new ServiceError('RATE_LIMITED', '房间创建过于频繁，请稍后重试。'), requestId);
        return;
      }
      for (let attempt = 0; attempt < 32; attempt += 1) {
        const code = randomRoomCode();
        const result = await this.env.GAME_ROOMS.getByName(code).createRoom(code, connectionId, payload, requestId);
        if (result.collision) continue;
        if (!result.ok) {
          this.#send(socket, {type: 'error', ...result.error, requestId});
          return;
        }
        attachment.roomCode = result.roomCode;
        attachment.playerId = result.player.id;
        attachment.searching = false;
        socket.serializeAttachment(attachment);
        await this.#dispatch(socket, result.deliveries);
        return;
      }
      this.#sendServiceError(socket, new ServiceError('ROOM_CODE_EXHAUSTED', '暂时无法生成房间码，请稍后重试。'), requestId);
      return;
    }

    if (type === 'room.join') {
      if (!await this.#allowAction(socket, 'join-room', 12)) {
        this.#sendServiceError(socket, new ServiceError('RATE_LIMITED', '房间码尝试次数过多，请稍后重试。'), requestId);
        return;
      }
      const code = String(payload.code || '').trim().toUpperCase();
      if (!isValidRoomCode(code)) {
        this.#sendServiceError(socket, new ServiceError('ROOM_NOT_FOUND', '房间码无效或房间已关闭。'), requestId);
        return;
      }
      const result = await this.env.GAME_ROOMS.getByName(code).joinRoom(connectionId, code, payload, requestId);
      if (!result.ok) {
        this.#send(socket, {type: 'error', ...result.error, requestId});
        return;
      }
      attachment.roomCode = result.roomCode;
      attachment.playerId = result.player.id;
      attachment.searching = false;
      socket.serializeAttachment(attachment);
      await this.#dispatch(socket, result.deliveries);
      return;
    }

    const token = payload.sessionToken;
    const separator = typeof token === 'string' ? token.indexOf('.') : -1;
    const code = separator > 0 ? token.slice(0, separator).toUpperCase() : '';
    if (!code) {
      this.#sendServiceError(socket, new ServiceError('INVALID_SESSION', '成员票据无效或已过期。'), requestId);
      return;
    }
    const result = await this.env.GAME_ROOMS.getByName(code).rejoinSession(connectionId, token, requestId);
    if (!result.ok) {
      this.#send(socket, {type: 'error', ...result.error, requestId});
      return;
    }
    attachment.roomCode = result.roomCode;
    attachment.playerId = result.player.id;
    attachment.searching = false;
    socket.serializeAttachment(attachment);
    if (result.previousConnectionId && result.previousConnectionId !== connectionId) {
      try {
        await this.env.CLIENT_SESSIONS.get(this.env.CLIENT_SESSIONS.idFromString(result.previousConnectionId)).closeSession();
      } catch {}
    }
    await this.#dispatch(socket, result.deliveries);
  }

  async #dispatch(socket, deliveries) {
    for (const item of deliveries) {
      if (item.connectionId === this.#connectionId()) {
        this.#send(socket, item.message);
        if (item.message?.type === 'signal.sent') {
          const attachment = socket.deserializeAttachment() || {};
          onlineDiagnostic('signal.sender.acknowledged', {
            room: roomTag(attachment.roomCode),
            from: shortId(attachment.playerId),
            to: shortId(item.message.targetPlayerId)
          });
        }
      }
      else {
        const id = this.env.CLIENT_SESSIONS.idFromString(item.connectionId);
        try {
          const delivered = await this.env.CLIENT_SESSIONS.get(id).deliver(item.message);
          if (item.message?.type === 'signal.forward') {
            const attachment = socket.deserializeAttachment() || {};
            onlineDiagnostic('signal.delivery', {
              room: roomTag(attachment.roomCode),
              from: shortId(item.message.fromPlayerId),
              toSession: shortId(item.connectionId),
              signalType: item.message.signalType,
              deliveredSessions: delivered
            }, delivered > 0 ? 'info' : 'warn');
          }
        } catch (error) {
          if (item.message?.type === 'signal.forward') {
            const attachment = socket.deserializeAttachment() || {};
            onlineDiagnostic('signal.delivery.failed', {
              room: roomTag(attachment.roomCode),
              from: shortId(item.message.fromPlayerId),
              toSession: shortId(item.connectionId),
              signalType: item.message.signalType,
              errorName: error instanceof Error ? error.name : 'Error'
            }, 'error');
          }
          throw error;
        }
      }
    }
  }

  #updateAttachmentForMessage(socket, message) {
    if (!['room.left', 'room.kicked', 'room.closed'].includes(message?.type)) return;
    const attachment = socket.deserializeAttachment();
    if (!attachment) return;
    attachment.roomCode = null;
    attachment.playerId = null;
    attachment.searching = false;
    socket.serializeAttachment(attachment);
  }

  async #handleDisconnect(socket) {
    const attachment = socket.deserializeAttachment();
    if (!attachment) return;
    const connectionId = this.#connectionId();
    try {
      if (attachment.roomCode && attachment.playerId) {
        const result = await this.env.GAME_ROOMS.getByName(attachment.roomCode).setPresence(connectionId, attachment.playerId, false);
        await this.#dispatch(socket, result.deliveries || []);
      }
      if (attachment.searching) await this.env.MATCHMAKER.getByName('global').cancel(connectionId);
    } catch (error) {
      console.error(JSON.stringify({level: 'warn', message: 'disconnect cleanup failed', error: error instanceof Error ? error.message : String(error)}));
    }
  }
}
