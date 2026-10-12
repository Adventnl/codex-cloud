import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { paths } from './config.js';
import type { Store } from './store.js';
import type { RuntimeManager } from './runtime.js';
import type { GitHub } from './github.js';
import type { Events } from './events.js';
import type { Task, RpcMessage, Approval } from './types.js';
import type { AppServer } from './rpc.js';
export class TaskManager {
  active = new Map<string, AppServer | null>();
  private draining = false;
  private closing = false;
  private stopped = new Set<string>();
  private timer?: NodeJS.Timeout;
  constructor(
    private store: Store,
    private runtime: RuntimeManager,
    private github: GitHub,
    private events: Events,
  ) {}
  update(id: string, patch: Partial<Task>) {
    const task = this.store.patch(id, patch);
    this.events.publish({ method: 'home/task', params: { task } }, id);
    return task;
  }
  async start() {
    // Lost processes are interrupted until official persisted turn state proves otherwise.
    for (const task of this.store
      .tasks()
      .filter((t) => ['preparing', 'running', 'waiting'].includes(t.state))) {
      this.update(task.id, {
        state: 'interrupted',
        error: 'Server restarted. Review the thread and workspace, then explicitly continue.',
      });
      if (task.threadId && task.runtimeVersion) {
        const rpc = this.runtime.spawn(task.runtimeVersion, {
          taskHome: path.join(path.dirname(task.workspace), 'codex'),
        });
        try {
          await rpc.initialize();
          const { thread } = await rpc.call('thread/read', {
            threadId: task.threadId,
            includeTurns: true,
          });
          const turn = thread.turns.find((t: any) => t.id === task.turnId);
          if (turn?.status === 'completed')
            this.update(task.id, {
              state: 'completed',
              error: undefined,
              completedAt: new Date().toISOString(),
            });
          if (turn?.status === 'failed')
            this.update(task.id, {
              state: 'failed',
              error: turn.error?.message || 'Codex turn failed',
            });
        } catch (error) {
          this.update(task.id, {
            error: `Interrupted; persisted thread unavailable: ${String(error)}`,
          });
        } finally {
          await rpc.stop();
        }
      }
    }
    this.timer = setInterval(() => void this.drain(), 2000);
    this.timer.unref();
    await this.drain();
  }
  async drain() {
    if (this.draining || this.closing) return;
    this.draining = true;
    try {
      while (!this.closing && this.active.size < this.store.settings().concurrency) {
        const task = this.store
          .tasks()
          .filter((t) => t.state === 'queued')
          .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0];
        if (!task) break;
        this.active.set(task.id, null);
        void this.execute(task)
          .catch((error) => {
            if (!this.stopped.has(task.id))
              this.update(task.id, {
                state: /App Server exited|Runtime disconnected/.test(String(error))
                  ? 'interrupted'
                  : 'failed',
                error: String(error),
                completedAt: new Date().toISOString(),
              });
          })
          .finally(() => {
            this.active.delete(task.id);
            this.stopped.delete(task.id);
            void this.drain();
          });
      }
    } finally {
      this.draining = false;
    }
  }
  private async execute(task: Task) {
    this.update(task.id, { state: 'preparing', error: undefined, completedAt: undefined });
    let rpc: AppServer | undefined;
    try {
      const control = await this.runtime.getControl();
      const account = await control.call('account/read', { refreshToken: true });
      if (account.account?.type !== 'chatgpt')
        throw new Error('Connect a ChatGPT subscription in Settings before running tasks');
      const model = (await this.runtime.models()).find((m) => m.model === task.model);
      if (!model) throw new Error('Selected model is no longer in the Codex catalog');
      if (
        task.effort &&
        !model.supportedReasoningEfforts.some((e) => e.reasoningEffort === task.effort)
      )
        throw new Error('Reasoning effort is unavailable for the selected model');
      if (!task.repositories.every((r) => r.directory)) {
        if (task.threadId) throw new Error('A continued task has missing repository metadata');
        const repositories = await this.github.prepare(task, (message) =>
          this.events.publish({ method: 'home/workspace', params: { message } }, task.id),
        );
        task = this.update(task.id, { repositories });
      }
      await access(task.workspace);
      for (const repo of task.repositories) await this.github.safeDirectory(task, repo);
      if (this.stopped.has(task.id) || this.closing) return;
      const version = this.runtime.record().version;
      const taskHome = await this.runtime.taskHome(task.id);
      rpc = this.runtime.spawn(version, { cwd: task.workspace, taskHome, isolated: true });
      this.active.set(task.id, rpc);
      rpc.on('notification', (msg: RpcMessage) => this.notification(task.id, msg));
      rpc.on('request', (req: Approval) => this.request(task.id, rpc!, req));
      await rpc.initialize();
      const options = {
        cwd: task.workspace,
        model: task.model,
        sandbox: 'workspace-write',
        approvalPolicy: task.permission === 'review' ? 'untrusted' : 'on-request',
        approvalsReviewer: 'user',
      };
      const result = await rpc.call(
        task.threadId ? 'thread/resume' : 'thread/start',
        task.threadId
          ? { ...options, threadId: task.threadId }
          : {
              ...options,
              ephemeral: false,
              developerInstructions: `You work inside an isolated task workspace containing complete Git repositories:\n${task.repositories.map((r) => `${r.fullName}: ${r.directory}; base ${r.baseBranch}; task branch ${r.taskBranch}`).join('\n')}\nKeep changes on the existing task branches. Do not push, create or merge pull requests; the dashboard owns publishing. Do not access credentials or unrelated files.`,
            },
      );
      task = this.update(task.id, {
        threadId: result.thread.id,
        turnId: undefined,
        runtimeVersion: version,
        state: 'running',
      });
      const done = new Promise<void>((resolve, reject) => {
        rpc!.on('notification', (msg) => {
          if (msg.method === 'turn/completed' && msg.params?.threadId === task.threadId) resolve();
        });
        rpc!.once('disconnect', reject);
      });
      // Install completion handlers before turn/start: fast turns may finish before its response arrives.
      void done.catch(() => {});
      const sandboxPolicy: Record<string, unknown> = {
        type: 'workspaceWrite',
        writableRoots: [task.workspace],
        networkAccess: task.network,
        excludeTmpdirEnvVar: true,
        excludeSlashTmp: false,
      };
      const schema = await readFile(
        path.join(paths.runtime, version, 'schemas', 'codex_app_server_protocol.schemas.json'),
        'utf8',
      ).catch(() => '');
      if (schema.includes('readOnlyAccess'))
        sandboxPolicy.readOnlyAccess = {
          type: 'restricted',
          includePlatformDefaults: true,
          readableRoots: [task.workspace],
        };
      const turn = await rpc.call('turn/start', {
        threadId: task.threadId,
        input: [{ type: 'text', text: task.pendingPrompt, text_elements: [] }],
        cwd: task.workspace,
        model: task.model,
        ...(task.effort ? { effort: task.effort } : {}),
        approvalPolicy: options.approvalPolicy,
        sandboxPolicy,
      });
      if (this.store.task(task.id).state === 'running')
        this.update(task.id, { turnId: turn.turn.id });
      await done;
    } finally {
      await rpc?.stop();
    }
  }
  private notification(id: string, message: RpcMessage) {
    this.events.publish(message, id);
    // Official Codex may emit descendant-thread events on this connection. Only the root turn owns task completion.
    if (message.params?.threadId && message.params.threadId !== this.store.task(id).threadId)
      return;
    if (message.method === 'turn/started')
      this.update(id, { state: 'running', turnId: message.params?.turn.id });
    if (
      message.method === 'serverRequest/resolved' &&
      this.store.task(id).state === 'waiting' &&
      !this.active.get(id)?.requests.size
    )
      this.update(id, { state: 'running' });
    if (message.method === 'turn/completed') {
      const turn = message.params?.turn;
      this.update(id, {
        state:
          turn.status === 'completed'
            ? 'completed'
            : turn.status === 'interrupted'
              ? 'interrupted'
              : 'failed',
        error: turn.error?.message || undefined,
        completedAt: new Date().toISOString(),
        turnId: turn.id,
      });
    }
  }
  private request(id: string, rpc: AppServer, request: Approval) {
    if (
      ![
        'item/commandExecution/requestApproval',
        'item/fileChange/requestApproval',
        'item/tool/requestUserInput',
        'item/permissions/requestApproval',
        'mcpServer/elicitation/request',
      ].includes(request.method)
    ) {
      rpc.rejectRequest(request.id, 'This client does not implement this server request');
      return;
    }
    this.update(id, { state: 'waiting' });
    this.events.publish({ method: 'home/approval', params: { request } }, id);
  }
  approvals(id: string) {
    return [...(this.active.get(id)?.requests.values() || [])];
  }
  respond(id: string, requestId: string | number, result: unknown) {
    const rpc = this.active.get(id);
    if (!rpc) throw new Error('Task is not connected');
    rpc.respond(requestId, result);
    if (!rpc.requests.size) this.update(id, { state: 'running' });
  }
  async stopTask(id: string) {
    const task = this.store.task(id);
    if (!['queued', 'preparing', 'running', 'waiting'].includes(task.state))
      throw new Error('Task has already stopped');
    if (this.active.has(id)) this.stopped.add(id);
    const rpc = this.active.get(id);
    if (rpc && task.threadId && task.turnId)
      await rpc.call('turn/interrupt', { threadId: task.threadId, turnId: task.turnId });
    else if (rpc) await rpc.stop();
    if (this.store.task(id).state !== 'completed')
      this.update(id, {
        state: task.state === 'queued' ? 'cancelled' : 'interrupted',
        error: 'Stopped by user',
        completedAt: new Date().toISOString(),
      });
  }
  continueTask(id: string, prompt: string) {
    const task = this.store.task(id);
    if (
      this.active.has(id) ||
      !['completed', 'failed', 'interrupted', 'cancelled'].includes(task.state)
    )
      throw new Error('Stop the active turn before continuing');
    if (!task.threadId) throw new Error('No persisted Codex thread exists. Create a new task.');
    this.stopped.delete(id);
    this.update(id, {
      pendingPrompt: prompt,
      state: 'queued',
      error: undefined,
      completedAt: undefined,
    });
    void this.drain();
  }
  async steer(id: string, text: string) {
    const task = this.store.task(id),
      rpc = this.active.get(id);
    if (!rpc || !task.turnId) throw new Error('No active turn');
    return rpc.call('turn/steer', {
      threadId: task.threadId,
      expectedTurnId: task.turnId,
      input: [{ type: 'text', text, text_elements: [] }],
    });
  }
  async thread(id: string) {
    const task = this.store.task(id);
    if (!task.threadId) return null;
    const active = this.active.get(id);
    const read = async (rpc: AppServer) => {
      const result = await rpc.call('thread/read', { threadId: task.threadId, includeTurns: true });
      if (result.thread.historyMode === 'paginated') {
        const turns: any[] = [];
        let cursor: string | undefined;
        do {
          const page = await rpc.call('thread/turns/list', {
            threadId: task.threadId,
            limit: 100,
            sortDirection: 'asc',
            itemsView: 'full',
            ...(cursor ? { cursor } : {}),
          });
          turns.push(...page.data);
          cursor = page.nextCursor || undefined;
        } while (cursor);
        result.thread.turns = turns;
      }
      return result;
    };
    if (active) return read(active);
    const rpc = this.runtime.spawn(task.runtimeVersion || this.runtime.record().version, {
      taskHome: path.join(path.dirname(task.workspace), 'codex'),
    });
    try {
      await rpc.initialize();
      return await read(rpc);
    } finally {
      await rpc.stop();
    }
  }
  async close() {
    this.closing = true;
    clearInterval(this.timer);
    await Promise.all(
      [...this.active.entries()].map(async ([id, rpc]) => {
        this.stopped.add(id);
        this.update(id, {
          state: 'interrupted',
          error: 'Server stopped. Explicitly continue after reviewing the workspace.',
        });
        await rpc?.stop();
      }),
    );
  }
}
