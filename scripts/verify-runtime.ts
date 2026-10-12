import path from 'node:path';
import { Store } from '../server/store.js';
import { config } from '../server/config.js';
import { Events } from '../server/events.js';
import { RuntimeManager } from '../server/runtime.js';
const store = new Store(path.join(config.data, 'home.sqlite'));
const runtime = new RuntimeManager(store, new Events());
try {
  await runtime.validate(runtime.record().version);
  const rpc = await runtime.getControl();
  const account = await rpc.call('account/read', { refreshToken: false });
  console.log(
    JSON.stringify(
      {
        version: runtime.record().version,
        protocolValidated: true,
        accountConnected: account.account?.type === 'chatgpt',
        modelCount: (await runtime.models()).length,
      },
      null,
      2,
    ),
  );
} finally {
  await runtime.stop();
  store.close();
}
