// Explicit opt-in integration check against your real server and GitHub repository.
// Does not publish unless --publish is supplied; never merges.
import { readFile, writeFile } from 'node:fs/promises';
const origin = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:3000';
const password =
  process.env.DASHBOARD_PASSWORD ||
  (await readFile('.env', 'utf8')).match(/^DASHBOARD_PASSWORD=(.+)$/m)?.[1];
const login = await fetch(origin + '/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password }),
});
if (!login.ok) throw new Error('Dashboard login failed');
const cookie = login.headers.get('set-cookie')!.split(';')[0];
async function api(route: string, method = 'GET', body?: unknown) {
  const response = await fetch(origin + '/api' + route, {
    method,
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error);
  return value;
}
const models = await api('/models'),
  model = models.find((m: any) => m.isDefault) || models[0];
const repository = process.env.SMOKE_REPOSITORY;
if (!repository)
  throw new Error(
    'Set SMOKE_REPOSITORY=owner/repo. This check writes a documentation file on an isolated task branch.',
  );
const task = process.env.SMOKE_TASK_ID
  ? (await api(`/tasks/${process.env.SMOKE_TASK_ID}`)).task
  : await api('/tasks', 'POST', {
      name: 'Codex Home integration verification',
      prompt:
        'Create docs/CODEX_HOME_SMOKE.md explaining in three short sentences that this file verifies an official Codex App Server task running in an isolated Git repository through Codex Home. Do not change any other files. Do not commit, push, or access authentication files. Then report which file you created.',
      repositories: [{ fullName: repository, baseBranch: process.env.SMOKE_BRANCH || 'main' }],
      model: model.model,
      effort: model.defaultReasoningEffort,
      permission: 'workspace',
      network: false,
    });
await writeFile('.data/smoke-task-id.txt', task.id);
console.log(
  `Real task ${process.env.SMOKE_TASK_ID ? 'reconnected' : 'created'}: ${task.id}. The HTTP request is now closed.`,
);
const controller = new AbortController();
const stream = await fetch(origin + '/api/events', {
  headers: { Cookie: cookie },
  signal: controller.signal,
});
let eventBytes = 0;
void (async () => {
  try {
    for await (const chunk of stream.body as any) eventBytes += chunk.length;
  } catch {
    /* intentionally disconnected */
  }
})();
let disconnected = false;
for (let attempt = 0; attempt < 900; attempt++) {
  const current = (await api(`/tasks/${task.id}`)).task;
  if (!disconnected && current.state === 'running') {
    controller.abort();
    disconnected = true;
    console.log('Live client disconnected; task remains server-managed.');
  }
  if (['completed', 'failed', 'interrupted', 'cancelled'].includes(current.state)) {
    controller.abort();
    console.log(
      JSON.stringify(
        {
          state: current.state,
          error: current.error,
          threadId: current.threadId,
          runtimeVersion: current.runtimeVersion,
          eventBytes,
          disconnectedDuringRun: disconnected,
        },
        null,
        2,
      ),
    );
    if (current.state !== 'completed') process.exitCode = 1;
    else {
      const changes = await api(`/tasks/${task.id}/changes`);
      console.log(
        JSON.stringify({
          repositories: changes.map((c: any) => ({
            fullName: c.fullName,
            status: c.status,
            diffVerified: c.diff.includes('CODEX_HOME_SMOKE.md'),
          })),
        }),
      );
      if (process.argv.includes('--publish')) {
        const published = await api(`/tasks/${task.id}/pull-requests`, 'POST', {
          repositories: [repository],
          title: 'Verify Codex Home official runtime integration',
          body: 'Created by a real official Codex App Server task in an isolated workspace. Confirms background execution after client disconnection and actual Git diff / commit / push / pull-request workflow. No application behavior changes.',
        });
        console.log(
          JSON.stringify({ pullRequests: published.repositories.map((r: any) => r.prUrl) }),
        );
      }
    }
    break;
  }
  if (attempt === 899) {
    controller.abort();
    throw new Error('Integration task timed out; review it in the dashboard');
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
