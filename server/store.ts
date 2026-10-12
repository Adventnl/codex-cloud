import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { Task, Settings } from './types.js';
export class Store {
  db: DatabaseSync;
  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, state TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS task_queue ON tasks(state, created_at);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);`);
  }
  get<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as
      { value: string } | undefined;
    return row ? JSON.parse(row.value) : fallback;
  }
  set(key: string, value: unknown) {
    this.db
      .prepare(
        'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, JSON.stringify(value));
  }
  settings(): Settings {
    return this.get('preferences', { automaticUpdates: true, concurrency: 1, channel: 'stable' });
  }
  tasks(): Task[] {
    return (
      this.db.prepare('SELECT payload FROM tasks ORDER BY created_at DESC').all() as {
        payload: string;
      }[]
    ).map((r) => JSON.parse(r.payload));
  }
  task(id: string): Task {
    const row = this.db.prepare('SELECT payload FROM tasks WHERE id=?').get(id) as
      { payload: string } | undefined;
    if (!row) throw Object.assign(new Error('Task not found'), { statusCode: 404 });
    return JSON.parse(row.payload);
  }
  save(task: Task) {
    this.db
      .prepare(
        'INSERT INTO tasks VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,payload=excluded.payload',
      )
      .run(task.id, task.state, task.createdAt, JSON.stringify(task));
    return task;
  }
  patch(id: string, patch: Partial<Task>) {
    return this.save({ ...this.task(id), ...patch, updatedAt: new Date().toISOString() });
  }
  create(
    input: Pick<
      Task,
      'name' | 'prompt' | 'repositories' | 'model' | 'effort' | 'permission' | 'network'
    >,
    workspaceRoot: string,
  ) {
    const id = randomUUID();
    const now = new Date().toISOString();
    return this.save({
      ...input,
      id,
      pendingPrompt: input.prompt,
      state: 'queued',
      workspace: `${workspaceRoot}/${id}/workspace`,
      createdAt: now,
      updatedAt: now,
    });
  }
  close() {
    this.db.close();
  }
}
