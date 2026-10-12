import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import type { RpcMessage, Approval } from './types.js';
export class AppServer extends EventEmitter {
  child: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  requests = new Map<string | number, Approval>();
  alive = true;
  constructor(command: string, args: string[], options: SpawnOptionsWithoutStdio = {}) {
    super();
    this.child = spawn(command, args, {
      ...options,
      stdio: 'pipe',
      shell: false,
      windowsHide: true,
    });
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      try {
        this.receive(JSON.parse(line));
      } catch (error) {
        this.emit('diagnostic', `Invalid App Server message: ${String(error)}`);
      }
    });
    this.child.stderr.on('data', (data) => this.emit('diagnostic', data.toString().slice(0, 4000)));
    this.child.on('error', (error) => this.disconnected(error));
    this.child.on('exit', (code, signal) =>
      this.disconnected(new Error(`Codex App Server exited (${code ?? signal})`)),
    );
    this.child.stdin.on('error', (error) => this.disconnected(error));
  }
  private disconnected(error: Error) {
    if (!this.alive) return;
    this.alive = false;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
    this.requests.clear();
    this.emit('disconnect', error);
  }
  private receive(message: RpcMessage) {
    if (message.id !== undefined && message.method) {
      const request = { id: message.id, method: message.method, params: message.params || {} };
      this.requests.set(message.id, request);
      this.emit('request', request);
      return;
    }
    if (message.id !== undefined) {
      const entry = this.pending.get(Number(message.id));
      if (!entry) return;
      this.pending.delete(Number(message.id));
      clearTimeout(entry.timer);
      if (message.error)
        entry.reject(new Error(`${message.error.message} (${message.error.code})`));
      else entry.resolve(message.result);
      return;
    }
    if (message.method === 'serverRequest/resolved')
      this.requests.delete(message.params?.requestId);
    this.emit('notification', message);
  }
  private send(message: RpcMessage) {
    if (!this.alive) throw new Error('Runtime disconnected');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  call<T = any>(
    method: string,
    params: Record<string, unknown> = {},
    timeout = 60_000,
  ): Promise<T> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  async initialize() {
    const result = await this.call('initialize', {
      clientInfo: { name: 'codex_home', title: 'Codex Home', version: '0.1.0' },
      capabilities: { experimentalApi: false },
    });
    this.send({ method: 'initialized', params: {} });
    return result;
  }
  respond(id: string | number, result: unknown) {
    if (!this.requests.has(id)) throw new Error('Approval expired or already answered');
    this.send({ id, result });
    this.requests.delete(id);
  }
  rejectRequest(id: string | number, reason: string) {
    this.send({ id, error: { code: -32601, message: reason } });
    this.requests.delete(id);
  }
  async stop() {
    if (!this.alive) return;
    this.child.stdin.end();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.child.kill();
        resolve();
      }, 2000);
      this.child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
