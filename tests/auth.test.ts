import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
test('dashboard protects APIs, prevents cross-site writes and logout revokes sessions', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codex-home-auth-'));
  process.env.DASHBOARD_PASSWORD = 'test-only-password-with-32-characters';
  const { app } = await createApp({ dataFile: path.join(dir, 'db'), startWorkers: false });
  try {
    assert.equal((await app.inject({ url: '/api/tasks' })).statusCode, 401);
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'bad' } }))
        .statusCode,
      401,
    );
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: process.env.DASHBOARD_PASSWORD },
    });
    assert.equal(login.statusCode, 200);
    const cookie = login.headers['set-cookie'] as string;
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    assert.equal((await app.inject({ url: '/api/tasks', headers: { cookie } })).statusCode, 200);
    assert.equal(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/settings',
          headers: { cookie, origin: 'https://attacker.example' },
          payload: { concurrency: 8, automaticUpdates: true, channel: 'stable' },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/tasks',
          headers: { cookie },
          payload: { repositories: [{ fullName: '../escape', baseBranch: 'main' }] },
        })
      ).statusCode,
      400,
    );
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    assert.equal((await app.inject({ url: '/api/tasks', headers: { cookie } })).statusCode, 401);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
