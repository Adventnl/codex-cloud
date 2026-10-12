import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { Store } from '../server/store.js';
import { config } from '../server/config.js';
import { RuntimeManager } from '../server/runtime.js';
import { GitHub } from '../server/github.js';
import { Events } from '../server/events.js';
const store = new Store(path.join(config.data, 'home.sqlite'));
const runtime = new RuntimeManager(store, new Events());
const home = await mkdtemp(path.join(config.data, 'auth-flow-check-'));
const rpc = runtime.spawn(runtime.record().version, { taskHome: home });
const github = new GitHub(new Events());
const originalEnv = github.env.bind(github);
github.env = () => ({ ...originalEnv(), GH_CONFIG_DIR: path.join(home, 'gh') });
try {
  await rpc.initialize();
  const login = await rpc.call('account/login/start', { type: 'chatgptDeviceCode' });
  if (!login.userCode || !login.verificationUrl?.startsWith('https://auth.openai.com/'))
    throw new Error('Invalid official ChatGPT device-code response');
  await rpc.call('account/login/cancel', { loginId: login.loginId });
  console.log('Official ChatGPT device code issued; test login cancelled before authorization.');
  github.startLogin();
  for (let attempt = 0; attempt < 30; attempt++) {
    if (github.loginState.code) {
      console.log(
        'Official GitHub CLI device code issued; test login cancelled before authorization.',
      );
      break;
    }
    if (github.loginState.state === 'failed') throw new Error(github.loginState.error);
    if (attempt === 29) throw new Error('GitHub CLI did not return a device code');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
} finally {
  github.stop();
  await rpc.stop();
  await runtime.stop();
  store.close();
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}
