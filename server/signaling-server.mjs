import {randomUUID} from 'node:crypto';
import http from 'node:http';
import {WebSocket, WebSocketServer} from 'ws';
import {ONLINE_MODE_IDS, RoomManager, ServiceError} from './room-manager.mjs';
import {CoopGameCoordinator} from './coop-coordinator.mjs';

const MAX_SIGNAL_PAYLOAD_BYTES = 48 * 1024;
const SIGNAL_WINDOW_MS = 10_000;
const MAX_SIGNALS_PER_WINDOW = 40;
const MAX_CONNECTIONS = 256;
const HEARTBEAT_MS = 25_000;

function send(client, type, payload = {}, requestId = undefined) {
  if (client.ws.readyState !== WebSocket.OPEN) return false;
  const message = {type, ...payload};
  if (requestId !== undefined) message.requestId = requestId;
  client.ws.send(JSON.stringify(message));
  return true;
}

function sendError(client, error, requestId) {
  const code = error instanceof ServiceError ? error.code : 'INTERNAL_ERROR';
  const message = error instanceof ServiceError ? error.message : '服务暂时无法处理该请求。';
  send(client, 'error', {code, message}, requestId);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseAllowedOrigins(value) {
  return new Set(String(value || 'http://127.0.0.1:5502,http://localhost:5502')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean));
}

function rejectUpgrade(socket, status, reason) {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export function createSignalingService({
  host = process.env.ONLINE_HOST || '0.0.0.0',
  port = Number(process.env.ONLINE_PORT || 5503),
  allowedOrigins = parseAllowedOrigins(process.env.ONLINE_ALLOWED_ORIGINS),
  roomManager = new RoomManager()
} = {}) {
  const clients = new Map();
  const playerConnections = new Map();
  const addressActions = new Map();
  const coopCoordinators = new Map();
  const coopTimers = new Map();
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://localhost');
    if (request.method === 'GET' && (url.pathname === '/health' || url.pathname === '/healthz')) {
      const body = JSON.stringify({
        status: 'ok',
        service: 'garrison-signaling',
        protocolVersion: 1,
        websocketPath: '/ws',
        availableModes: ONLINE_MODE_IDS
      });
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      response.end(body);
      return;
    }
    response.writeHead(404, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
    response.end(JSON.stringify({error: 'NOT_FOUND'}));
  });

  const webSockets = new WebSocketServer({noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false});

  function sendRoomState(room) {
    if (!room) return;
    const message = JSON.stringify({type: 'room.state', room});
    for (const player of room.players) {
      const client = playerConnections.get(player.id);
      if (client?.ws.readyState === WebSocket.OPEN) client.ws.send(message);
    }
  }

  function sendCoopEvent(roomCode, event) {
    if (!event?.type) return;
    const room = roomManager.getRoom(roomCode);
    if (!room) return;
    const {type, ...payload} = event;
    for (const player of room.players) {
      const client = playerConnections.get(player.id);
      if (client?.ws.readyState === WebSocket.OPEN) send(client, type, payload);
    }
  }

  function sendCoopProgress(roomCode, progress) {
    const room = roomManager.getRoom(roomCode);
    if (!room) return;
    for (const player of room.players) {
      const client = playerConnections.get(player.id);
      if (client?.ws.readyState === WebSocket.OPEN) send(client, 'coop.progress', progress);
    }
  }

  function requireCoopCoordinator(room) {
    if (room.phase !== 'signaling') throw new ServiceError('GAME_NOT_STARTED', '房间尚未开始联机局内阶段。');
    let coordinator = coopCoordinators.get(room.code);
    if (!coordinator) {
      coordinator = new CoopGameCoordinator(room.players.map(player => player.id));
      coopCoordinators.set(room.code, coordinator);
    }
    return coordinator;
  }

  function dispatchCoopResult(roomCode, result) {
    for (const event of [result?.event, ...(result?.followupEvents || [])].filter(Boolean)) sendCoopEvent(roomCode, event);
    if (result?.progress) sendCoopProgress(roomCode, result.progress);
    clearTimeout(coopTimers.get(roomCode));
    coopTimers.delete(roomCode);
    const coordinator = coopCoordinators.get(roomCode);
    if (coordinator?.deadlineAt) {
      const timer = setTimeout(() => {
        const live = coopCoordinators.get(roomCode);
        if (live) dispatchCoopResult(roomCode, live.advanceDeadline(Date.now()));
      }, Math.max(1, coordinator.deadlineAt - Date.now()));
      coopTimers.set(roomCode, timer);
    }
  }

  function attachPlayer(client, player, room) {
    const previous = playerConnections.get(player.id);
    if (previous && previous !== client) {
      previous.playerId = null;
      previous.roomCode = null;
      previous.ws.close(4001, 'session replaced');
    }
    client.playerId = player.id;
    client.roomCode = room.code;
    client.searching = false;
    playerConnections.set(player.id, client);
    roomManager.setPresence(player.id, true);
  }

  function detachPlayer(client) {
    if (!client.playerId) return;
    if (playerConnections.get(client.playerId) === client) playerConnections.delete(client.playerId);
    client.playerId = null;
    client.roomCode = null;
  }

  function requireRoomPlayer(client) {
    if (!client.playerId || !client.roomCode) throw new ServiceError('NOT_IN_ROOM', '请先创建或加入房间。');
    const room = roomManager.getRoom(client.roomCode);
    if (!room?.players.some(player => player.id === client.playerId)) {
      throw new ServiceError('NOT_IN_ROOM', '当前成员票据已失效。');
    }
    return room;
  }

  function assertUnauthenticated(client) {
    if (client.playerId) throw new ServiceError('ALREADY_IN_ROOM', '请先离开当前房间。');
  }

  function allowSignal(client) {
    const now = Date.now();
    if (!client.signalWindow || now - client.signalWindow.startedAt >= SIGNAL_WINDOW_MS) {
      client.signalWindow = {startedAt: now, count: 0};
    }
    client.signalWindow.count += 1;
    return client.signalWindow.count <= MAX_SIGNALS_PER_WINDOW;
  }

  function allowAddressAction(client, action, limit) {
    const key = `${client.remoteAddress}:${action}`;
    const now = Date.now();
    let window = addressActions.get(key);
    if (!window || now - window.startedAt >= 60_000) {
      window = {startedAt: now, count: 0};
      addressActions.set(key, window);
    }
    if (window.count >= limit) return false;
    window.count += 1;
    return true;
  }

  function relaySignal(client, message, requestId) {
    const room = requireRoomPlayer(client);
    if (room.phase !== 'signaling') throw new ServiceError('SIGNAL_NOT_READY', '房主开始连接阶段后才能交换信令。');
    if (!['signal.offer', 'signal.answer', 'signal.ice'].includes(message.type)) {
      throw new ServiceError('INVALID_SIGNAL_TYPE', '只允许转发 offer、answer 和 ICE candidate。');
    }
    if (!allowSignal(client)) throw new ServiceError('SIGNAL_RATE_LIMIT', '信令发送过快，请稍后重试。');
    const payload = message.payload;
    const targetPlayerId = payload?.targetPlayerId;
    const data = payload?.data;
    if (typeof targetPlayerId !== 'string' || targetPlayerId === client.playerId) {
      throw new ServiceError('INVALID_SIGNAL_TARGET', '信令目标无效。');
    }
    if (message.type === 'signal.ice') {
      if (data !== null && (!isPlainObject(data) || typeof data.candidate !== 'string')) {
        throw new ServiceError('INVALID_SIGNAL_DATA', 'ICE 信令必须是 candidate 对象或结束标记 null。');
      }
    } else if (!isPlainObject(data) || data.type !== message.type.slice('signal.'.length) || typeof data.sdp !== 'string') {
      throw new ServiceError('INVALID_SIGNAL_DATA', 'offer／answer 信令需要匹配的 type 和 SDP 字符串。');
    }
    if (Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_SIGNAL_PAYLOAD_BYTES) {
      throw new ServiceError('SIGNAL_TOO_LARGE', '信令消息超过 48 KB。');
    }
    const target = room.players.find(player => player.id === targetPlayerId);
    if (!target) throw new ServiceError('PLAYER_NOT_IN_ROOM', '信令目标不在当前房间。');
    const targetClient = playerConnections.get(targetPlayerId);
    if (!targetClient || targetClient.ws.readyState !== WebSocket.OPEN) {
      throw new ServiceError('PEER_OFFLINE', '信令目标当前不在线。');
    }
    send(targetClient, 'signal.forward', {
      fromPlayerId: client.playerId,
      fromName: room.players.find(player => player.id === client.playerId)?.name || '玩家',
      signalType: message.type,
      data
    });
    send(client, 'signal.sent', {targetPlayerId}, requestId);
  }

  function handleMessage(client, message) {
    const requestId = typeof message.requestId === 'string' && message.requestId.length <= 80
      ? message.requestId
      : undefined;
    const payload = isPlainObject(message.payload) ? message.payload : {};

    try {
      switch (message.type) {
        case 'room.create': {
          assertUnauthenticated(client);
          if (!allowAddressAction(client, 'create-room', 30)) throw new ServiceError('RATE_LIMITED', '房间创建过于频繁，请稍后重试。');
          roomManager.cancelMatchmaking(client.id);
          const result = roomManager.createRoom(payload);
          attachPlayer(client, result.player, result.room);
          send(client, 'room.created', {
            room: roomManager.getRoom(result.room.code),
            player: result.player,
            sessionToken: result.sessionToken
          }, requestId);
          sendRoomState(roomManager.getRoom(result.room.code));
          return;
        }
        case 'room.join': {
          assertUnauthenticated(client);
          if (!allowAddressAction(client, 'join-room', 12)) throw new ServiceError('RATE_LIMITED', '房间码尝试次数过多，请稍后重试。');
          roomManager.cancelMatchmaking(client.id);
          const result = roomManager.joinRoom(payload.code, payload);
          attachPlayer(client, result.player, result.room);
          send(client, 'room.joined', {
            room: roomManager.getRoom(result.room.code),
            player: result.player,
            sessionToken: result.sessionToken
          }, requestId);
          sendRoomState(roomManager.getRoom(result.room.code));
          return;
        }
        case 'room.rejoin': {
          assertUnauthenticated(client);
          roomManager.cancelMatchmaking(client.id);
          const result = roomManager.resumeSession(payload.sessionToken);
          attachPlayer(client, result.player, result.room);
          send(client, 'room.rejoined', {
            room: roomManager.getRoom(result.room.code),
            player: result.player
          }, requestId);
          sendRoomState(roomManager.getRoom(result.room.code));
          return;
        }
        case 'matchmaking.search': {
          assertUnauthenticated(client);
          if (!allowAddressAction(client, 'matchmaking', 10)) throw new ServiceError('RATE_LIMITED', '匹配请求过于频繁，请稍后重试。');
          const result = roomManager.enqueueMatchmaking(client.id, payload);
          client.searching = true;
          send(client, 'matchmaking.queued', result, requestId);
          return;
        }
        case 'matchmaking.cancel': {
          const cancelled = roomManager.cancelMatchmaking(client.id);
          client.searching = false;
          send(client, 'matchmaking.cancelled', {cancelled}, requestId);
          return;
        }
        case 'room.ready': {
          requireRoomPlayer(client);
          const room = roomManager.setReady(client.playerId, payload.ready);
          send(client, 'request.accepted', {action: 'room.ready', revision: room.revision}, requestId);
          return;
        }
        case 'room.set-settings': {
          requireRoomPlayer(client);
          const room = roomManager.setSettings(client.playerId, payload);
          send(client, 'request.accepted', {action: 'room.set-settings', revision: room.revision}, requestId);
          return;
        }
        case 'room.kick': {
          requireRoomPlayer(client);
          const result = roomManager.kickPlayer(client.playerId, payload.playerId);
          const targetClient = playerConnections.get(payload.playerId);
          if (targetClient) {
            detachPlayer(targetClient);
            send(targetClient, 'room.kicked', {roomCode: result.roomCode});
          }
          send(client, 'request.accepted', {action: 'room.kick', revision: result.room?.revision || 0}, requestId);
          if (result.room) sendRoomState(result.room);
          return;
        }
        case 'room.start': {
          requireRoomPlayer(client);
          const result = roomManager.startRoom(client.playerId, payload);
          coopCoordinators.set(result.room.code, new CoopGameCoordinator(result.room.players.map(player => player.id)));
          send(client, 'request.accepted', {action: 'room.start', sessionId: result.sessionId}, requestId);
          const started = JSON.stringify({type: 'room.started', sessionId: result.sessionId, room: result.room});
          for (const player of result.room.players) {
            const peer = playerConnections.get(player.id);
            if (peer?.ws.readyState === WebSocket.OPEN) peer.ws.send(started);
          }
          return;
        }
        case 'coop.strategy.availability':
        case 'coop.strategy.choose':
        case 'coop.prep.ready':
        case 'coop.battle.report': {
          const room = requireRoomPlayer(client);
          const coordinator = requireCoopCoordinator(room);
          const result = message.type === 'coop.strategy.availability' ? coordinator.submitStrategyAvailability(client.playerId, payload)
            : message.type === 'coop.strategy.choose' ? coordinator.chooseStrategy(client.playerId, payload)
              : message.type === 'coop.prep.ready' ? coordinator.readyForBattle(client.playerId, payload)
                : coordinator.submitBattleResult(client.playerId, payload);
          dispatchCoopResult(room.code, result);
          send(client, 'request.accepted', {action: message.type, round: coordinator.round}, requestId);
          return;
        }
        case 'coop.joint-defense.report': {
          const room = requireRoomPlayer(client);
          const coordinator = requireCoopCoordinator(room);
          const result = coordinator.submitDefenseResult(client.playerId, payload);
          dispatchCoopResult(room.code, result);
          send(client, 'request.accepted', {action: message.type, round: coordinator.round}, requestId);
          return;
        }
        case 'coop.round.ready': {
          const room = requireRoomPlayer(client);
          const coordinator = requireCoopCoordinator(room);
          const result = coordinator.readyNextRound(client.playerId, payload);
          dispatchCoopResult(room.code, result);
          send(client, 'request.accepted', {action: message.type, round: coordinator.round}, requestId);
          return;
        }
        case 'coop.boss.skip': {
          const room = requireRoomPlayer(client);
          const coordinator = requireCoopCoordinator(room);
          const result = coordinator.finishAtBoss(client.playerId, payload);
          dispatchCoopResult(room.code, result);
          send(client, 'request.accepted', {action: message.type, round: coordinator.round}, requestId);
          return;
        }
        case 'room.leave': {
          requireRoomPlayer(client);
          const oldCode = client.roomCode;
          const playerId = client.playerId;
          detachPlayer(client);
          const result = roomManager.leaveRoom(playerId);
          send(client, 'room.left', {roomCode: oldCode}, requestId);
          if (result.room) sendRoomState(result.room);
          return;
        }
        case 'signal.offer':
        case 'signal.answer':
        case 'signal.ice':
          relaySignal(client, message, requestId);
          return;
        default:
          throw new ServiceError('UNKNOWN_MESSAGE', '无法识别的服务消息类型。');
      }
    } catch (error) {
      sendError(client, error, requestId);
    }
  }

  webSockets.on('connection', (ws, request) => {
    const client = {
      id: randomUUID(),
      ws,
      remoteAddress: request.socket.remoteAddress || 'unknown',
      playerId: null,
      roomCode: null,
      searching: false,
      signalWindow: null,
      alive: true
    };
    clients.set(client.id, client);
    ws.on('pong', () => { client.alive = true; });
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        sendError(client, new ServiceError('BINARY_NOT_ALLOWED', '服务仅接受 JSON 文本消息。'));
        return;
      }
      let message;
      try {
        message = JSON.parse(data.toString('utf8'));
      } catch {
        sendError(client, new ServiceError('INVALID_JSON', '消息不是有效 JSON。'));
        return;
      }
      if (!isPlainObject(message) || typeof message.type !== 'string' || message.type.length > 64) {
        sendError(client, new ServiceError('INVALID_MESSAGE', '消息必须包含有效的 type。'));
        return;
      }
      handleMessage(client, message);
    });
    ws.on('close', () => {
      clients.delete(client.id);
      roomManager.cancelMatchmaking(client.id);
      if (client.playerId && playerConnections.get(client.playerId) === client) {
        playerConnections.delete(client.playerId);
        roomManager.setPresence(client.playerId, false);
      }
    });
    ws.on('error', () => {});
    send(client, 'server.hello', {
      protocolVersion: 1,
      playerCapacity: 4,
      availableModes: ONLINE_MODE_IDS
    });
  });

  server.on('upgrade', (request, socket, head) => {
    if (clients.size >= MAX_CONNECTIONS) {
      rejectUpgrade(socket, 503, 'Service Unavailable');
      return;
    }
    let url;
    try {
      url = new URL(request.url || '/', 'http://localhost');
    } catch {
      rejectUpgrade(socket, 400, 'Bad Request');
      return;
    }
    if (url.pathname !== '/ws') {
      rejectUpgrade(socket, 404, 'Not Found');
      return;
    }
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has('*') && !allowedOrigins.has(origin)) {
      rejectUpgrade(socket, 403, 'Forbidden');
      return;
    }
    webSockets.handleUpgrade(request, socket, head, ws => webSockets.emit('connection', ws, request));
  });

  roomManager.on('roomChanged', room => sendRoomState(room));
  roomManager.on('roomClosed', ({roomCode, reason}) => {
    coopCoordinators.delete(roomCode);
    clearTimeout(coopTimers.get(roomCode));
    coopTimers.delete(roomCode);
    const notice = JSON.stringify({type: 'room.closed', roomCode, reason});
    for (const client of clients.values()) {
      if (client.roomCode === roomCode) {
        detachPlayer(client);
        if (client.ws.readyState === WebSocket.OPEN) client.ws.send(notice);
      }
    }
  });
  roomManager.on('playerLeft', ({roomCode, playerId}) => {
    const coordinator = coopCoordinators.get(roomCode);
    if (!coordinator) return;
    dispatchCoopResult(roomCode, coordinator.removePlayer(playerId));
  });
  roomManager.on('matched', matches => {
    for (const match of matches) {
      const client = clients.get(match.connectionId);
      if (!client || client.ws.readyState !== WebSocket.OPEN) {
        roomManager.leaveRoom(match.player.id, 'disconnected-during-match');
        continue;
      }
      client.searching = false;
      attachPlayer(client, match.player, match.room);
      send(client, 'matchmaking.matched', {
        ticketId: match.ticketId,
        room: roomManager.getRoom(match.room.code),
        player: match.player,
        sessionToken: match.sessionToken
      });
    }
  });

  const heartbeat = setInterval(() => {
    roomManager.expireInactiveRooms();
    const actionCutoff = Date.now() - 60_000;
    for (const [key, window] of addressActions) {
      if (window.startedAt < actionCutoff) addressActions.delete(key);
    }
    for (const client of clients.values()) {
      if (!client.alive) {
        client.ws.terminate();
        continue;
      }
      client.alive = false;
      client.ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  return {
    server,
    roomManager,
    host,
    port,
    listen() {
      return new Promise((resolve, reject) => {
        const onError = error => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          const address = server.address();
          resolve(address);
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
    },
    close() {
      clearInterval(heartbeat);
      roomManager.close();
      for (const client of clients.values()) client.ws.close(1001, 'server shutting down');
      webSockets.close();
      return new Promise((resolve, reject) => {
        if (!server.listening) return resolve();
        server.close(error => error ? reject(error) : resolve());
      });
    }
  };
}
