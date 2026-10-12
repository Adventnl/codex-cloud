import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { AppServer } from '../server/rpc.js';
test('stdio matches out-of-order responses, routes native approvals and rejects lost process requests', async () => {
  const rpc = new AppServer(process.execPath, [path.resolve('tests/fixtures/rpc.mjs')]);
  try {
    await rpc.initialize();
    const [slow, fast] = await Promise.all([
      rpc.call('echo', { value: 'slow', delay: 30 }),
      rpc.call('echo', { value: 'fast' }),
    ]);
    assert.equal(slow.value, 'slow');
    assert.equal(fast.value, 'fast');
    await rpc.call('approval');
    assert.equal(rpc.requests.get('server-7')?.method, 'item/commandExecution/requestApproval');
    rpc.respond('server-7', { decision: 'decline' });
    assert.equal(rpc.requests.size, 0);
    await assert.rejects(rpc.call('fail'), /Access denied/);
    await assert.rejects(rpc.call('exit'), /exited/);
  } finally {
    await rpc.stop();
  }
});
