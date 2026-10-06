import {ONLINE_MODE_IDS} from './shared.mjs';
export {ClientSessionDO} from './session-object.mjs';
export {GameRoomDO} from './room-object.mjs';
export {IpRateLimitDO} from './rate-limit-object.mjs';
export {MatchmakerDO} from './matchmaker-object.mjs';

const DEFAULT_ALLOWED_ORIGINS = [
  'https://yilegendoflink.github.io',
  'https://strongholdonlinepreview.pages.dev',
  'https://online.strongholdonlinepreview.pages.dev',
  'http://127.0.0.1:5502',
  'http://localhost:5502'
];
const TURN_CREDENTIALS_PATH = '/turn/ice-servers';
const TURN_CREDENTIAL_TTL_SECONDS = 12 * 60 * 60;

async function hashRateKey(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

function allowedOrigins(env) {
  return new Set(String(env.ONLINE_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(','))
    .split(',')
    .map(value => value.trim())
    .filter(Boolean));
}

function turnJsonResponse(payload, status, origin) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin'
  });
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Authorization');
    headers.set('Access-Control-Max-Age', '600');
  }
  return new Response(status === 204 ? null : JSON.stringify(payload), {status, headers});
}

async function handleTurnCredentials(request, env) {
  const origin = request.headers.get('Origin') || '';
  const origins = allowedOrigins(env);
  if (!origin || (!origins.has('*') && !origins.has(origin))) {
    return turnJsonResponse({error: 'ORIGIN_NOT_ALLOWED'}, 403, '');
  }
  if (request.method === 'OPTIONS') return turnJsonResponse({}, 204, origin);
  if (request.method !== 'POST') return turnJsonResponse({error: 'METHOD_NOT_ALLOWED'}, 405, origin);

  const keyId = String(env.TURN_KEY_ID || '').trim();
  const keySecret = String(env.TURN_KEY_SECRET || '').trim();
  if (!keyId || !keySecret) return turnJsonResponse({error: 'TURN_NOT_CONFIGURED'}, 503, origin);

  const authorization = request.headers.get('Authorization') || '';
  const sessionToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || '';
  const separator = sessionToken.indexOf('.');
  const roomCode = separator > 0 ? sessionToken.slice(0, separator).toUpperCase() : '';
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(roomCode) || sessionToken.length > 128) {
    return turnJsonResponse({error: 'INVALID_SESSION'}, 401, origin);
  }

  const authorizationResult = await env.GAME_ROOMS.getByName(roomCode).authorizeTurnCredentials(sessionToken);
  if (!authorizationResult?.ok) {
    const code = authorizationResult?.error?.code || 'INVALID_SESSION';
    const status = code === 'TURN_RATE_LIMITED' ? 429 : code === 'TURN_NOT_READY' ? 409 : 401;
    return turnJsonResponse({error: code}, status, origin);
  }

  const address = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rateKey = await hashRateKey(address);
  if (!await env.IP_LIMITERS.getByName(rateKey).consume('turn-credentials', 20, 60_000)) {
    return turnJsonResponse({error: 'RATE_LIMITED'}, 429, origin);
  }

  let upstream;
  try {
    upstream = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: {'Authorization': `Bearer ${keySecret}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({ttl: TURN_CREDENTIAL_TTL_SECONDS})
    });
  } catch {
    return turnJsonResponse({error: 'TURN_CREDENTIALS_UNAVAILABLE'}, 502, origin);
  }

  if (!upstream.ok) {
    console.error(JSON.stringify({level: 'error', message: 'Cloudflare TURN credential request failed', status: upstream.status}));
    return turnJsonResponse({error: 'TURN_CREDENTIALS_UNAVAILABLE'}, 502, origin);
  }
  let payload;
  try { payload = await upstream.json(); } catch {}
  if (!Array.isArray(payload?.iceServers) || !payload.iceServers.some(server => {
    const urls = Array.isArray(server?.urls) ? server.urls : [server?.urls];
    return urls.some(value => typeof value === 'string' && /^turns?:/i.test(value));
  })) return turnJsonResponse({error: 'TURN_CREDENTIALS_INVALID'}, 502, origin);

  return turnJsonResponse({iceServers: payload.iceServers}, 200, origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === TURN_CREDENTIALS_PATH) return handleTurnCredentials(request, env);
    if (request.method === 'GET' && ['/health', '/healthz'].includes(url.pathname)) {
      return jsonResponse({status: 'ok', service: 'garrison-cloudflare-signaling', protocolVersion: 1, websocketPath: '/ws', availableModes: ONLINE_MODE_IDS});
    }
    if (url.pathname !== '/ws') return jsonResponse({error: 'NOT_FOUND'}, 404);
    if (request.method !== 'GET') return new Response('Expected GET method', {status: 400});
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected Upgrade: websocket', {status: 426});

    const origin = request.headers.get('Origin');
    const origins = allowedOrigins(env);
    if (origin && !origins.has('*') && !origins.has(origin)) {
      return new Response('WebSocket origin is not allowed', {status: 403});
    }

    const address = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rateKey = await hashRateKey(address);
    const clientId = crypto.randomUUID();
    const session = env.CLIENT_SESSIONS.getByName(clientId);
    await session.setRateKey(rateKey);
    return session.fetch(request);
  }
};
