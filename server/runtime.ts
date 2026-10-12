import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import { Ajv } from 'ajv';
import { AppServer } from './rpc.js';
import { run, npmCommand } from './process.js';
import { config, paths } from './config.js';
import type { Store } from './store.js';
import type { Events } from './events.js';
import type { RuntimeRecord, Model } from './types.js';
const requiredMethods = [
  'initialize',
  'account/read',
  'account/login/start',
  'account/logout',
  'account/rateLimits/read',
  'model/list',
  'thread/start',
  'thread/resume',
  'thread/read',
  'turn/start',
  'turn/steer',
  'turn/interrupt',
];
export class RuntimeManager {
  private control?: AppServer;
  private controlStarting?: Promise<AppServer>;
  private busy = false;
  private closing = false;
  private timer?: NodeJS.Timeout;
  constructor(
    private store: Store,
    private events: Events,
  ) {}
  record(): RuntimeRecord {
    return this.store.get('runtime', { version: '' });
  }
  private save(patch: Partial<RuntimeRecord>) {
    this.store.set('runtime', { ...this.record(), ...patch });
    this.events.publish({ method: 'home/runtime', params: this.record() });
  }
  entry(version: string) {
    if (!semver.valid(version) || semver.prerelease(version))
      throw new Error('Only official stable release versions are supported');
    return path.join(paths.runtime, version, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  }
  env(home = paths.codex): NodeJS.ProcessEnv {
    // Do not pass control-plane secrets, GH tokens, API keys or parent Codex configuration.
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: paths.home,
      USERPROFILE: paths.home,
      CODEX_HOME: home,
      CODEX_API_KEY: undefined,
      OPENAI_API_KEY: undefined,
      NO_COLOR: '1',
    };
    for (const key of [
      'SystemRoot',
      'WINDIR',
      'COMSPEC',
      'PATHEXT',
      'TEMP',
      'TMP',
      'LANG',
      'LC_ALL',
      'SSL_CERT_FILE',
      'SSL_CERT_DIR',
    ])
      if (process.env[key]) env[key] = process.env[key];
    return env;
  }
  spawn(version: string, options: { cwd?: string; taskHome?: string; isolated?: boolean } = {}) {
    const entry = this.entry(version);
    const args = [
      entry,
      'app-server',
      '--listen',
      'stdio://',
      '-c',
      'cli_auth_credentials_store="file"',
    ];
    if (options.isolated && config.isolation === 'bubblewrap') {
      const home = options.taskHome!;
      const mounts = ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/etc'];
      // bubblewrap gives each task a filesystem + PID namespace. No app, DB, GitHub credentials or other workspaces.
      const bargs = [
        '--die-with-parent',
        '--new-session',
        '--unshare-pid',
        '--unshare-ipc',
        '--unshare-uts',
        '--proc',
        '/proc',
        '--dev',
        '/dev',
        '--tmpfs',
        '/tmp',
      ];
      for (const mount of mounts) bargs.push('--ro-bind-try', mount, mount);
      bargs.push(
        '--ro-bind',
        path.dirname(process.execPath),
        path.dirname(process.execPath),
        '--ro-bind',
        path.join(paths.runtime, version),
        path.join(paths.runtime, version),
        '--bind',
        home,
        home,
        '--bind',
        options.cwd!,
        options.cwd!,
        '--dir',
        paths.home,
        '--chdir',
        options.cwd!,
        '--',
        process.execPath,
        ...args,
      );
      return new AppServer('bwrap', bargs, { env: this.env(home), cwd: options.cwd });
    }
    return new AppServer(process.execPath, args, {
      env: this.env(options.taskHome),
      cwd: options.cwd || paths.home,
    });
  }
  async getControl(): Promise<AppServer> {
    if (this.closing) throw new Error('Runtime manager is stopping');
    if (this.control?.alive) return this.control;
    if (this.controlStarting) return this.controlStarting;
    this.controlStarting = (async () => {
      const version = this.record().version;
      if (!version) throw new Error('Install the Codex runtime in Settings');
      const rpc = this.spawn(version);
      rpc.on('notification', (msg) => this.events.publish(msg));
      rpc.on('request', (req) =>
        rpc.rejectRequest(req.id, 'Unsupported request on the account connection'),
      );
      rpc.once('disconnect', () => {
        if (this.control === rpc) this.control = undefined;
      });
      try {
        await rpc.initialize();
        this.control = rpc;
        return rpc;
      } catch (error) {
        await rpc.stop();
        throw error;
      }
    })();
    try {
      return await this.controlStarting;
    } finally {
      this.controlStarting = undefined;
    }
  }
  async models() {
    const rpc = await this.getControl();
    const models: Model[] = [];
    let cursor: string | undefined;
    do {
      const page: any = await rpc.call('model/list', { limit: 100, ...(cursor ? { cursor } : {}) });
      models.push(...page.data);
      cursor = page.nextCursor || undefined;
    } while (cursor);
    return models;
  }
  async check() {
    const npm = await npmCommand([
      'view',
      '@openai/codex',
      'dist-tags.latest',
      '--registry=https://registry.npmjs.org',
    ]);
    const latest = (await run(npm.command, npm.args)).trim();
    if (!semver.valid(latest) || semver.prerelease(latest))
      throw new Error('Official npm stable channel returned an invalid version');
    this.save({ latest, lastChecked: new Date().toISOString() });
    return this.record();
  }
  async validate(version: string) {
    const entry = this.entry(version);
    const directory = path.join(paths.runtime, version);
    const actual = await run(process.execPath, [entry, '--version']);
    if (!actual.includes(` ${version}`))
      throw new Error('Installed runtime version did not match the requested release');
    await run(process.execPath, [
      entry,
      'app-server',
      'generate-json-schema',
      '--out',
      path.join(directory, 'schemas'),
    ]);
    await run(process.execPath, [
      entry,
      'app-server',
      'generate-ts',
      '--out',
      path.join(directory, 'types'),
    ]);
    await this.validateSchema(directory);
    const rpc = this.spawn(version);
    try {
      await rpc.initialize();
      await rpc.call('account/read', { refreshToken: false });
      const models = await rpc.call('model/list', { limit: 1 });
      if (!Array.isArray(models.data)) throw new Error('Incompatible model/list response');
      const response = await rpc.call('thread/start', {
        cwd: paths.home,
        ephemeral: true,
        sandbox: 'read-only',
        approvalPolicy: 'untrusted',
      });
      if (typeof response.thread?.id !== 'string')
        throw new Error('Incompatible thread/start response');
    } finally {
      await rpc.stop();
    }
    await writeFile(
      path.join(directory, 'validated.json'),
      JSON.stringify({ version, validatedAt: new Date().toISOString() }),
    );
  }
  private async validateSchema(directory: string) {
    const schema = JSON.parse(
      await readFile(
        path.join(directory, 'schemas', 'codex_app_server_protocol.schemas.json'),
        'utf8',
      ),
    );
    const definitions = schema.definitions || schema.$defs;
    if (!definitions?.ClientRequest)
      throw new Error('Runtime schema bundle has no ClientRequest definition');
    const serialized = JSON.stringify(definitions.ClientRequest);
    for (const method of requiredMethods)
      if (!serialized.includes(`"${method}"`))
        throw new Error(`Protocol is incompatible: missing ${method}`);
    // Validate actual adapter request shapes against the candidate release, including restricted read access.
    const ajv = new Ajv({
      strict: false,
      formats: {
        int64: true,
        uint64: true,
        uint32: true,
        uint16: true,
        uint: true,
        int32: true,
        double: true,
        float: true,
      },
    });
    const validate = ajv.compile({ ...schema, $ref: '#/definitions/ClientRequest' });
    const samples = [
      {
        method: 'initialize',
        params: {
          clientInfo: { name: 'codex_home', title: 'Codex Home', version: '0.1.0' },
          capabilities: { experimentalApi: false },
        },
      },
      { method: 'account/login/start', params: { type: 'chatgptDeviceCode' } },
      {
        method: 'thread/start',
        params: {
          cwd: paths.home,
          sandbox: 'workspace-write',
          approvalPolicy: 'on-request',
          ephemeral: false,
        },
      },
      { method: 'thread/resume', params: { threadId: 'test', cwd: paths.home } },
      {
        method: 'turn/start',
        params: {
          threadId: 'test',
          input: [{ type: 'text', text: 'test', text_elements: [] }],
          approvalPolicy: 'on-request',
          sandboxPolicy: {
            type: 'workspaceWrite',
            writableRoots: [paths.home],
            ...(JSON.stringify(schema).includes('readOnlyAccess')
              ? {
                  readOnlyAccess: {
                    type: 'restricted',
                    includePlatformDefaults: true,
                    readableRoots: [paths.home],
                  },
                }
              : {}),
            networkAccess: false,
            excludeTmpdirEnvVar: true,
            excludeSlashTmp: false,
          },
        },
      },
      { method: 'turn/interrupt', params: { threadId: 'test', turnId: 'test' } },
      {
        method: 'turn/steer',
        params: {
          threadId: 'test',
          expectedTurnId: 'test',
          input: [{ type: 'text', text: 'test', text_elements: [] }],
        },
      },
    ];
    for (const [id, sample] of samples.entries())
      if (!validate({ id, ...sample }))
        throw new Error(
          `Protocol incompatible for ${sample.method}: ${ajv.errorsText(validate.errors).slice(0, 1000)}`,
        );
  }
  async update() {
    if (this.busy)
      throw Object.assign(new Error('A runtime operation is already in progress'), {
        statusCode: 409,
      });
    this.busy = true;
    try {
      await this.check();
      const record = this.record();
      const version = record.latest!;
      if (record.version && !semver.gt(version, record.version)) return record;
      const directory = path.join(paths.runtime, version);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      // Retained versions may still be executing after rollback. Never reinstall into an existing validated release.
      try {
        await access(path.join(directory, 'validated.json'));
      } catch {
        const npm = await npmCommand([
          'install',
          '--prefix',
          directory,
          '--no-audit',
          '--no-fund',
          '--registry=https://registry.npmjs.org',
          `@openai/codex@${version}`,
        ]);
        await run(npm.command, npm.args, { timeout: 300_000 });
      }
      await this.validate(version);
      if (this.closing) throw new Error('Application stopped before runtime switch');
      await this.control?.stop();
      this.control = undefined;
      this.save({
        version,
        previous: record.version || record.previous,
        lastUpdated: new Date().toISOString(),
        error: undefined,
      });
      return this.record();
    } catch (error) {
      this.save({ error: String(error) });
      throw error;
    } finally {
      this.busy = false;
    }
  }
  async rollback() {
    if (this.busy) throw new Error('A runtime operation is already in progress');
    this.busy = true;
    try {
      const record = this.record();
      if (!record.previous) throw new Error('No previous validated version is available');
      await this.validate(record.previous);
      await this.control?.stop();
      this.control = undefined;
      this.save({ version: record.previous, previous: record.version, error: undefined });
      return this.record();
    } finally {
      this.busy = false;
    }
  }
  startUpdates() {
    const tick = async () => {
      if (this.busy || this.closing || !this.store.settings().automaticUpdates) return;
      const checked = Date.parse(this.record().lastChecked || '');
      if (Number.isFinite(checked) && Date.now() - checked < 86_400_000) return;
      try {
        await this.update();
      } catch (error) {
        console.error('Runtime update failed:', String(error));
      }
    };
    void tick();
    this.timer = setInterval(() => void tick(), 60_000);
    this.timer.unref();
  }
  async taskHome(taskId: string) {
    const home = path.join(paths.tasks, taskId, 'codex');
    await mkdir(home, { recursive: true, mode: 0o700 });
    try {
      await access(path.join(home, 'auth.json'));
    } catch {
      const auth = await readFile(path.join(paths.codex, 'auth.json'));
      await writeFile(path.join(home, 'auth.json'), auth, { mode: 0o600 });
    }
    return home;
  }
  async stop() {
    this.closing = true;
    clearInterval(this.timer);
    await this.control?.stop();
  }
}
