import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import staticPlugin from '@fastify/static';
import { existsSync } from 'node:fs';
import { readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { Store } from './store.js';
import { Events, type LiveEvent } from './events.js';
import { RuntimeManager } from './runtime.js';
import { GitHub, repositoryName } from './github.js';
import { TaskManager } from './tasks.js';
import { config, paths } from './config.js';
import { registerAuth } from './auth.js';
const taskInput = z.object({
  name: z.string().min(1).max(120),
  prompt: z.string().min(1).max(100_000),
  repositories: z
    .array(
      z.object({
        fullName: z.string().regex(repositoryName),
        baseBranch: z
          .string()
          .min(1)
          .max(250)
          .refine((v) => !v.startsWith('-')),
      }),
    )
    .min(1)
    .max(12)
    .refine(
      (repos) => new Set(repos.map((r) => r.fullName.toLowerCase())).size === repos.length,
      'Select each repository only once',
    ),
  model: z.string().min(1).max(200),
  effort: z.string().max(30).optional(),
  permission: z.enum(['review', 'workspace']).default('review'),
  network: z.boolean().default(false),
});
const textInput = z.object({ prompt: z.string().min(1).max(100_000) });
export async function createApp(options: { dataFile?: string; startWorkers?: boolean } = {}) {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      redact: ['req.headers.cookie', 'req.headers.authorization', 'req.body.password'],
    },
    bodyLimit: 200_000,
  });
  const store = new Store(options.dataFile || path.join(config.data, 'home.sqlite'));
  const events = new Events(),
    runtime = new RuntimeManager(store, events),
    github = new GitHub(events),
    tasks = new TaskManager(store, runtime, github, events);
  await app.register(cookie);
  await registerAuth(app, store);
  app.setErrorHandler((error, _req, reply) => {
    const e = error as Error & { statusCode?: number };
    reply.code(error instanceof z.ZodError ? 400 : e.statusCode || 400).send({ error: e.message });
  });
  app.get('/api/status', async () => ({
    runtime: runtime.record(),
    settings: store.settings(),
    server: {
      platform: process.platform,
      isolation: config.isolation,
      uptime: Math.round(process.uptime()),
      workspace: paths.tasks,
      activeTasks: tasks.active.size,
    },
  }));
  app.get('/api/account', async () => {
    const rpc = await runtime.getControl();
    const account = await rpc.call('account/read', { refreshToken: false });
    let rateLimits = null;
    try {
      rateLimits = await rpc.call('account/rateLimits/read');
    } catch {
      /* absent without ChatGPT login */
    }
    return { ...account, rateLimits };
  });
  app.post('/api/account/login', async () =>
    (await runtime.getControl()).call('account/login/start', { type: 'chatgptDeviceCode' }),
  );
  app.post('/api/account/logout', async () => {
    if (tasks.active.size) throw new Error('Stop active tasks before signing out of ChatGPT');
    await (await runtime.getControl()).call('account/logout');
    for (const dir of await readdir(paths.tasks, { withFileTypes: true }))
      if (dir.isDirectory())
        await unlink(path.join(paths.tasks, dir.name, 'codex', 'auth.json')).catch(() => {});
    return { ok: true };
  });
  app.get('/api/models', async () => runtime.models());
  app.get('/api/github', async () => github.status());
  app.post('/api/github/login', async () => github.startLogin());
  app.post('/api/github/logout', async () => {
    await github.logout();
    return { ok: true };
  });
  app.get<{ Querystring: { q?: string } }>('/api/repositories', async (req) =>
    github.repositories(
      z
        .string()
        .max(200)
        .parse(req.query.q || ''),
    ),
  );
  app.get<{ Querystring: { repo: string } }>('/api/branches', async (req) =>
    github.branches(z.string().regex(repositoryName).parse(req.query.repo)),
  );
  app.get('/api/tasks', async () => store.tasks());
  app.post('/api/tasks', async (req) => {
    const input = taskInput.parse(req.body);
    const models = await runtime.models();
    if (!models.some((m) => m.model === input.model))
      throw new Error('Choose a model from the current Codex catalog');
    const task = store.create(input, paths.tasks);
    events.publish({ method: 'home/task', params: { task } }, task.id);
    void tasks.drain();
    return task;
  });
  app.get<{ Params: { id: string } }>('/api/tasks/:id', async (req) => ({
    task: store.task(req.params.id),
    approvals: tasks.approvals(req.params.id),
  }));
  app.get<{ Params: { id: string } }>('/api/tasks/:id/thread', async (req) =>
    tasks.thread(req.params.id),
  );
  app.get<{ Params: { id: string } }>('/api/tasks/:id/events', async (req) => {
    store.task(req.params.id);
    return events.since(0).filter((event) => event.taskId === req.params.id);
  });
  app.post<{ Params: { id: string } }>('/api/tasks/:id/stop', async (req) => {
    await tasks.stopTask(req.params.id);
    return store.task(req.params.id);
  });
  app.post<{ Params: { id: string } }>('/api/tasks/:id/continue', async (req) => {
    tasks.continueTask(req.params.id, textInput.parse(req.body).prompt);
    return store.task(req.params.id);
  });
  app.post<{ Params: { id: string } }>('/api/tasks/:id/steer', async (req) =>
    tasks.steer(req.params.id, textInput.parse(req.body).prompt),
  );
  app.post<{ Params: { id: string } }>('/api/tasks/:id/approval', async (req) => {
    const input = z
      .object({
        requestId: z.union([z.string(), z.number()]),
        decision: z.enum(['accept', 'decline', 'cancel']).optional(),
        answers: z.record(z.string(), z.array(z.string().max(10_000))).optional(),
      })
      .parse(req.body);
    const request = tasks.approvals(req.params.id).find((a) => a.id === input.requestId);
    if (!request) throw new Error('Request is no longer pending');
    let result: unknown;
    if (request.method === 'item/tool/requestUserInput') {
      if (!input.answers) throw new Error('Answers required');
      result = {
        answers: Object.fromEntries(
          Object.entries(input.answers).map(([key, answers]) => [key, { answers }]),
        ),
      };
    } else if (request.method === 'item/permissions/requestApproval') {
      // Keep grants turn-scoped; allow precisely the profile requested by official Codex.
      if (!input.decision) throw new Error('Decision required');
      result = {
        permissions: input.decision === 'accept' ? request.params.permissions : {},
        scope: 'turn',
      };
    } else if (request.method === 'mcpServer/elicitation/request')
      result = { action: input.decision === 'accept' ? 'accept' : 'decline', content: null };
    else {
      if (!input.decision) throw new Error('Decision required');
      if (
        request.params.availableDecisions &&
        !request.params.availableDecisions.includes(input.decision)
      )
        throw new Error('Decision not supported by this request');
      result = { decision: input.decision };
    }
    tasks.respond(req.params.id, input.requestId, result);
    return { ok: true };
  });
  app.get<{ Params: { id: string } }>('/api/tasks/:id/changes', async (req) => {
    const task = store.task(req.params.id);
    return Promise.all(
      task.repositories.filter((r) => r.directory).map((r) => github.changes(task, r)),
    );
  });
  const publishing = new Set<string>();
  app.post<{ Params: { id: string } }>('/api/tasks/:id/pull-requests', async (req) => {
    const input = z
      .object({
        repositories: z.array(z.string()).min(1),
        title: z.string().min(1).max(200),
        body: z.string().max(50_000).default(''),
      })
      .parse(req.body);
    const task = store.task(req.params.id);
    if (
      ['queued', 'preparing', 'running', 'waiting'].includes(task.state) ||
      tasks.active.has(task.id)
    )
      throw new Error('Wait for the task to stop before publishing');
    if (publishing.has(task.id)) throw new Error('Publishing is already in progress');
    publishing.add(task.id);
    try {
      for (const fullName of input.repositories) {
        const current = store.task(task.id),
          repo = current.repositories.find((r) => r.fullName === fullName);
        if (!repo) throw new Error('Repository does not belong to this task');
        const pr = await github.createPr(current, repo, input.title, input.body);
        tasks.update(task.id, {
          repositories: current.repositories.map((r) =>
            r.fullName === fullName ? { ...r, prUrl: pr.url, prNumber: pr.number } : r,
          ),
        });
      }
      return store.task(task.id);
    } finally {
      publishing.delete(task.id);
    }
  });
  app.get<{ Params: { id: string }; Querystring: { repo: string } }>(
    '/api/tasks/:id/pull-request',
    async (req) => {
      const repo = store
        .task(req.params.id)
        .repositories.find((r) => r.fullName === req.query.repo);
      if (!repo) throw new Error('Unknown repository');
      return github.prStatus(repo);
    },
  );
  app.post<{ Params: { id: string } }>('/api/tasks/:id/merge', async (req) => {
    if (['queued', 'preparing', 'running', 'waiting'].includes(store.task(req.params.id).state))
      throw new Error('Stop the active task before merging its pull request');
    const input = z.object({ repository: z.string(), confirmation: z.string() }).parse(req.body),
      repo = store.task(req.params.id).repositories.find((r) => r.fullName === input.repository);
    if (!repo || input.confirmation !== `MERGE ${repo.fullName}#${repo.prNumber}`)
      throw new Error('Explicit merge confirmation did not match this pull request');
    return github.merge(repo);
  });
  app.patch('/api/settings', async (req) => {
    const settings = z
      .object({
        automaticUpdates: z.boolean(),
        concurrency: z.number().int().min(1).max(8),
        channel: z.literal('stable'),
      })
      .parse(req.body);
    store.set('preferences', settings);
    void tasks.drain();
    return settings;
  });
  app.post('/api/runtime/check', async () => runtime.check());
  app.post('/api/runtime/update', async () => runtime.update());
  app.post('/api/runtime/rollback', async () => runtime.rollback());
  const streams = new Set<() => void>();
  app.get('/api/events', async (request, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event: LiveEvent) => {
      if (res.writableLength > 2_000_000) {
        res.end();
        return;
      }
      res.write(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    const last = Number(request.headers['last-event-id'] || 0);
    res.write('event: ready\ndata: {}\n\n');
    if (last > 0) for (const event of events.since(last)) send(event);
    events.on('event', send);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
    const close = () => {
      clearInterval(heartbeat);
      events.off('event', send);
      streams.delete(close);
      res.end();
    };
    streams.add(close);
    request.raw.on('close', close);
  });
  const webRoot = path.resolve('dist/web');
  if (existsSync(webRoot)) {
    await app.register(staticPlugin, { root: webRoot });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/')
        ? reply.code(404).send({ error: 'Endpoint not found' })
        : reply.sendFile('index.html'),
    );
  } else
    app.get('/', async () => ({
      message: 'Run npm run dev:web for the development UI, or npm run build then npm start.',
    }));
  app.addHook('onClose', async () => {
    for (const close of streams) close();
    await tasks.close();
    github.stop();
    await runtime.stop();
    store.close();
  });
  if (options.startWorkers !== false) {
    await tasks.start();
    runtime.startUpdates();
  }
  return { app, store, events, runtime, github, tasks };
}
