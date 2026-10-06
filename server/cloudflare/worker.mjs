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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && ['/health', '/healthz'].includes(url.pathname)) {
      return jsonResponse({status: 'ok', service: 'garrison-cloudflare-signaling', protocolVersion: 1, websocketPath: '/ws', availableModes: ONLINE_MODE_IDS});
    }
    if (url.pathname !== '/ws') return jsonResponse({error: 'NOT_FOUND'}, 404);
    if (request.method !== 'GET') return new Response('Expected GET method', {status: 400});
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected Upgrade: websocket', {status: 426});

    const origin = request.headers.get('Origin');
    const allowedOrigins = new Set(String(env.ONLINE_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(','))
      .split(',')
      .map(value => value.trim())
      .filter(Boolean));
    if (origin && !allowedOrigins.has('*') && !allowedOrigins.has(origin)) {
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
