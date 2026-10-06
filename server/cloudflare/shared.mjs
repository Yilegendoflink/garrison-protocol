import {ServiceError} from '../service-error.mjs';

export const ONLINE_MODE_IDS = Object.freeze([
  'mode_multi_funny',
  'mode_multi_normal',
  'mode_multi_hard',
  'mode_multi_abyss'
]);

export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const MAX_ROOM_PLAYERS = 4;
export const MAX_MESSAGE_BYTES = 64 * 1024;
export const MAX_SIGNAL_BYTES = 48 * 1024;

export function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function requestIdOf(message) {
  return typeof message?.requestId === 'string' && message.requestId.length <= 80 ? message.requestId : undefined;
}

export function errorPayload(error, requestId) {
  const message = {type: 'error', code: error instanceof ServiceError ? error.code : 'INTERNAL_ERROR', message: error instanceof ServiceError ? error.message : '服务暂时无法处理该请求。'};
  if (requestId !== undefined) message.requestId = requestId;
  return message;
}

export function validateModeId(modeId) {
  if (typeof modeId !== 'string' || !ONLINE_MODE_IDS.includes(modeId)) {
    throw new ServiceError('INVALID_MODE', '当前服务只开放四种正式同盟难度。');
  }
  return modeId;
}

export function normalizeName(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const name = [...value.replace(/[\u0000-\u001f\u007f]/g, '').trim()].slice(0, 24).join('');
  return name || fallback;
}

export function randomInt(max) {
  if (!Number.isSafeInteger(max) || max < 1) throw new RangeError('max must be a positive safe integer');
  const range = 0x1_0000_0000;
  const limit = Math.floor(range / max) * max;
  const sample = new Uint32Array(1);
  do {
    crypto.getRandomValues(sample);
  } while (sample[0] >= limit);
  return sample[0] % max;
}

export function randomRoomCode() {
  let code = '';
  for (let index = 0; index < 6; index += 1) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return code;
}

export function isValidRoomCode(value) {
  return typeof value === 'string' && value.length === 6 && [...value].every(char => ROOM_CODE_ALPHABET.includes(char));
}

export function randomToken(code) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const binary = String.fromCharCode(...bytes);
  const suffix = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `${code}.${suffix}`;
}

export async function hashToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    ready: player.ready,
    online: player.online,
    joinedAt: player.joinedAt,
    lastSeenAt: player.lastSeenAt
  };
}

export function publicRoom(room) {
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
    maxPlayers: MAX_ROOM_PLAYERS,
    players: room.players.map(publicPlayer),
    revision: room.revision,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    startedAt: room.startedAt
  };
}

export function delivery(connectionId, type, payload = {}, requestId = undefined) {
  const message = {type, ...payload};
  if (requestId !== undefined) message.requestId = requestId;
  return {connectionId, message};
}

export function roomStateDeliveries(room) {
  const message = {type: 'room.state', room: publicRoom(room)};
  return room.players
    .filter(player => player.online && player.connectionId)
    .map(player => ({connectionId: player.connectionId, message}));
}

export function failed(error) {
  return {ok: false, error: {code: error instanceof ServiceError ? error.code : 'INTERNAL_ERROR', message: error instanceof ServiceError ? error.message : '服务暂时无法处理该请求。'}};
}

export function assertMapId(mapId = 'random') {
  if (typeof mapId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(mapId)) {
    throw new ServiceError('INVALID_MAP', '作战阵地编号无效。');
  }
  return mapId;
}
