import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/store.js';
test('task records, official thread references and update settings survive restart', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codex-home-store-'));
  const file = path.join(dir, 'db.sqlite');
  let store = new Store(file);
  const task = store.create(
    {
      name: 'Durable task',
      prompt: 'Change two repositories',
      repositories: [
        { fullName: 'owner/web', baseBranch: 'main' },
        { fullName: 'owner/api', baseBranch: 'develop' },
      ],
      model: 'catalog-model',
      permission: 'review',
      network: false,
    },
    dir,
  );
  store.patch(task.id, {
    state: 'running',
    threadId: 'official-thread',
    turnId: 'official-turn',
    runtimeVersion: '1.2.3',
  });
  store.set('preferences', { automaticUpdates: false, concurrency: 2, channel: 'stable' });
  store.close();
  store = new Store(file);
  assert.equal(store.task(task.id).threadId, 'official-thread');
  assert.equal(store.task(task.id).repositories[1].baseBranch, 'develop');
  assert.equal(store.settings().concurrency, 2);
  assert.equal(
    store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'").get(),
    undefined,
  );
  store.close();
  await rm(dir, { recursive: true, force: true });
});
