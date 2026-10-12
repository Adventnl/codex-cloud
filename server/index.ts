import { createApp } from './app.js';
import { config } from './config.js';
const { app } = await createApp();
await app.listen({ host: config.host, port: config.port });
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    await app.close();
    process.exit(0);
  });
