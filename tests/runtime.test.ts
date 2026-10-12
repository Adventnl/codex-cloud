import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../server/store.js';
import { RuntimeManager } from '../server/runtime.js';
import { Events } from '../server/events.js';
import { paths } from '../server/config.js';
test('incompatible candidate retains current release; rollback validation failure leaves pointer unchanged', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codex-home-runtime-'));
  const store = new Store(path.join(dir, 'db'));
  const originalRuntimeRoot = paths.runtime;
  paths.runtime = path.join(dir, 'runtimes');
  const runtime = new RuntimeManager(store, new Events());
  try {
    store.set('runtime', { version: '1.0.0', previous: '0.9.0' });
    await mkdir(path.join(paths.runtime, '1.1.0'), { recursive: true });
    await writeFile(path.join(paths.runtime, '1.1.0', 'validated.json'), '{}');
    runtime.check = async () => {
      store.set('runtime', { ...runtime.record(), latest: '1.1.0' });
      return runtime.record();
    };
    runtime.validate = async () => {
      throw new Error('Protocol incompatible: missing thread/resume');
    };
    await assert.rejects(runtime.update(), /Protocol incompatible/);
    assert.equal(runtime.record().version, '1.0.0');
    assert.equal(runtime.record().previous, '0.9.0');
    assert.match(runtime.record().error!, /Protocol incompatible/);
    await assert.rejects(runtime.rollback(), /Protocol incompatible/);
    assert.equal(runtime.record().version, '1.0.0');
    runtime.validate = async () => {};
    await runtime.rollback();
    assert.equal(runtime.record().version, '0.9.0');
    assert.equal(runtime.record().previous, '1.0.0');
  } finally {
    await runtime.stop();
    store.close();
    paths.runtime = originalRuntimeRoot;
    await rm(dir, { recursive: true, force: true });
  }
});
