import { randomBytes } from 'node:crypto';
import { readFile, writeFile, copyFile, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/store.js';
import { config, paths } from '../server/config.js';
import { Events } from '../server/events.js';
import { RuntimeManager } from '../server/runtime.js';
import { GitHub } from '../server/github.js';
import { run } from '../server/process.js';
import { passwordRecord } from '../server/auth.js';
let environment = await readFile('.env', 'utf8').catch(() => '');
const store = new Store(path.join(config.data, 'home.sqlite'));
if (!store.get('password', null)) {
  const password =
    process.env.DASHBOARD_PASSWORD ||
    environment.match(/^DASHBOARD_PASSWORD=(.+)$/m)?.[1] ||
    randomBytes(24).toString('base64url');
  if (password.length < 16) throw new Error('Dashboard password must be at least 16 characters');
  store.set('password', passwordRecord(password));
  if (!environment.includes('DASHBOARD_PASSWORD=')) {
    environment += `DASHBOARD_PASSWORD=${password}\n`;
    await writeFile('.env', environment, { mode: 0o600 });
  }
  console.log('Dashboard password is saved in .env. Keep this file private.');
}
const events = new Events(),
  runtime = new RuntimeManager(store, events),
  github = new GitHub(events);
try {
  await runtime.update();
  console.log(`Official Codex ${runtime.record().version} installed and protocol validated.`);
  if (!(await github.status()).connected) {
    try {
      // Reuse this user's existing authorized CLI login, through stdin only.
      const token = await run('gh', ['auth', 'token', '--hostname', 'github.com']);
      await github.cli(
        ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--with-token'],
        { input: token + '\n' },
      );
      console.log('Existing GitHub CLI authorization connected to Codex Home.');
    } catch {
      console.log('Connect GitHub from Settings when ready.');
    }
  }
  const rpc = await runtime.getControl();
  if (
    !(await rpc.call('account/read', { refreshToken: false })).account &&
    process.argv.includes('--reuse-local-codex-login')
  ) {
    const source = path.join(
      process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
      'auth.json',
    );
    const auth = JSON.parse(await readFile(source, 'utf8'));
    if (auth.auth_mode !== 'chatgpt')
      throw new Error('Local credentials are not a ChatGPT subscription login');
    await copyFile(source, path.join(paths.codex, 'auth.json'));
    await chmod(path.join(paths.codex, 'auth.json'), 0o600);
    await runtime.stop();
    console.log('Existing official Codex ChatGPT login copied. Codex manages refresh.');
  } else console.log('ChatGPT sign-in: open Settings and use the official device-code flow.');
  console.log('Launch: npm run build, then npm start. URL: http://127.0.0.1:3000');
} finally {
  await runtime.stop();
  store.close();
}
