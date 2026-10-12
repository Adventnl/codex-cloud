import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../server/store.js';
import { TaskManager } from '../server/tasks.js';
import { Events } from '../server/events.js';
import type { RuntimeManager } from '../server/runtime.js';
import type { GitHub } from '../server/github.js';
import type { AppServer } from '../server/rpc.js';
test('recovery trusts completed official turns but never replays interrupted work', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codex-home-recovery-'));
  const store = new Store(path.join(dir, 'db'));
  const create = (state: string) => {
    const task = store.create(
      {
        name: state,
        prompt: 'Do not repeat',
        repositories: [{ fullName: 'o/r', baseBranch: 'main' }],
        model: 'model',
        permission: 'review',
        network: false,
      },
      dir,
    );
    return store.patch(task.id, {
      state: 'running',
      threadId: state,
      turnId: 'turn',
      runtimeVersion: '1.0.0',
    });
  };
  const completed = create('completed'),
    interrupted = create('inProgress'),
    failed = create('failed');
  let starts = 0;
  const runtime = {
    spawn: () => ({
      initialize: async () => {},
      call: async (method: string, params: any) => {
        if (method !== 'thread/read') starts++;
        return {
          thread: {
            turns: [{ id: 'turn', status: params.threadId, error: { message: 'Real failure' } }],
          },
        };
      },
      stop: async () => {},
    }),
  } as unknown as RuntimeManager;
  const manager = new TaskManager(store, runtime, {} as GitHub, new Events());
  await manager.start();
  assert.equal(store.task(completed.id).state, 'completed');
  assert.equal(store.task(interrupted.id).state, 'interrupted');
  assert.equal(store.task(failed.id).state, 'failed');
  assert.equal(starts, 0);
  manager['notification'](interrupted.id, {
    method: 'turn/completed',
    params: { threadId: 'descendant-thread', turn: { id: 'child-turn', status: 'completed' } },
  });
  assert.equal(
    store.task(interrupted.id).state,
    'interrupted',
    'Descendant completions must not finish the root task',
  );
  const pendingRequests = new Map([
    [42, { id: 42, method: 'item/fileChange/requestApproval', params: {} }],
  ]);
  manager.active.set(interrupted.id, { requests: pendingRequests } as unknown as AppServer);
  store.patch(interrupted.id, { state: 'waiting' });
  manager['notification'](interrupted.id, {
    method: 'serverRequest/resolved',
    params: { threadId: interrupted.threadId, requestId: 41 },
  });
  assert.equal(
    store.task(interrupted.id).state,
    'waiting',
    'Other pending native requests keep the task waiting',
  );
  manager.active.delete(interrupted.id);
  store.patch(interrupted.id, { state: 'interrupted' });
  manager.drain = async () => {};
  manager.continueTask(interrupted.id, 'A safe follow-up');
  await manager.stopTask(interrupted.id);
  assert.equal(store.task(interrupted.id).state, 'cancelled');
  manager.continueTask(interrupted.id, 'A new explicit follow-up');
  assert.equal(
    manager['stopped'].has(interrupted.id),
    false,
    'Cancelled queued follow-ups must remain resumable',
  );
  await manager.close();
  store.close();
  await rm(dir, { recursive: true, force: true });
});
