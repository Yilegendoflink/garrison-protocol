import {createSignalingService} from './signaling-server.mjs';

const service = createSignalingService();

try {
  const address = await service.listen();
  const host = typeof address === 'object' && address ? address.address : process.env.ONLINE_HOST || '127.0.0.1';
  const port = typeof address === 'object' && address ? address.port : process.env.ONLINE_PORT || 5503;
  console.log(`Garrison matching/signaling service listening at http://${host}:${port} (WebSocket /ws)`);
} catch (error) {
  console.error(`Could not start online service: ${error.message}`);
  process.exitCode = 1;
}

async function shutdown() {
  try {
    await service.close();
  } finally {
    process.exit();
  }
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
