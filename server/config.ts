import path from 'node:path';
import { mkdirSync } from 'node:fs';
export const config = {
  data: path.resolve(process.env.DATA_DIR || '.data'),
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 3000),
  origin: process.env.APP_ORIGIN || 'http://127.0.0.1:3000',
  secureCookies: process.env.COOKIE_SECURE === 'true',
  isolation:
    process.env.RUNTIME_ISOLATION || (process.platform === 'linux' ? 'bubblewrap' : 'native'),
};
export const paths = {
  runtime: path.join(config.data, 'runtimes'),
  codex: path.join(config.data, 'codex'),
  tasks: path.resolve(process.env.WORKSPACE_DIR || path.join(config.data, 'tasks')),
  gh: path.join(config.data, 'github'),
  home: path.join(config.data, 'home'),
};
for (const dir of [config.data, ...Object.values(paths)])
  mkdirSync(dir, { recursive: true, mode: 0o700 });
