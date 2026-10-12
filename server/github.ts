import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, realpath, lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { run } from './process.js';
import { paths } from './config.js';
import type { Repository, Task } from './types.js';
import type { Events } from './events.js';
export const repositoryName = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export class GitHub {
  private login?: ReturnType<typeof spawn>;
  loginState: { state: string; url?: string; code?: string; error?: string } = { state: 'idle' };
  constructor(private events: Events) {}
  env(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      GH_CONFIG_DIR: paths.gh,
      GH_PROMPT_DISABLED: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: path.join(paths.home, '.gitconfig'),
    };
  }
  async cli(args: string[], options: { cwd?: string; input?: string } = {}) {
    return run('gh', args, { ...options, env: this.env() });
  }
  async status() {
    try {
      return {
        connected: true,
        account: JSON.parse(await this.cli(['api', 'user'])),
        login: this.loginState,
      };
    } catch {
      return { connected: false, login: this.loginState };
    }
  }
  startLogin() {
    if (this.login) return this.loginState;
    this.loginState = { state: 'pending', url: 'https://github.com/login/device' };
    const child = spawn(
      'gh',
      [
        'auth',
        'login',
        '--hostname',
        'github.com',
        '--git-protocol',
        'https',
        '--web',
        '--skip-ssh-key',
      ],
      {
        env: {
          ...this.env(),
          BROWSER: process.platform === 'win32' ? 'cmd /c exit' : '/bin/true',
          GH_PROMPT_DISABLED: '0',
        },
        windowsHide: true,
        stdio: 'pipe',
      },
    );
    this.login = child;
    let output = '';
    const consume = (data: Buffer) => {
      output = (output + data.toString()).slice(-8000);
      const code = output.match(/code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i)?.[1];
      if (code && code !== this.loginState.code) {
        this.loginState.code = code;
        this.events.publish({ method: 'home/github', params: this.loginState });
      }
      if (/press enter/i.test(data.toString())) child.stdin?.write('\n');
    };
    child.stdout?.on('data', consume);
    child.stderr?.on('data', consume);
    child.on('error', (error) => {
      this.loginState = { state: 'failed', error: error.message };
      this.login = undefined;
    });
    child.on('exit', (code) => {
      this.login = undefined;
      this.loginState =
        code === 0 ? { state: 'completed' } : { state: 'failed', error: output.slice(-1000) };
      this.events.publish({ method: 'home/github', params: this.loginState });
    });
    return this.loginState;
  }
  async logout() {
    if (this.login) {
      this.login.kill();
      this.login = undefined;
    }
    await this.cli(['auth', 'logout', '--hostname', 'github.com'], { input: 'Y\n' });
    this.loginState = { state: 'idle' };
  }
  async repositories(query = '') {
    const pages = JSON.parse(
      await this.cli([
        'api',
        '--paginate',
        '--slurp',
        'user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member',
      ]),
    );
    return pages
      .flat()
      .filter((repo: any) => repo.full_name.toLowerCase().includes(query.toLowerCase()))
      .map((repo: any) => ({
        fullName: repo.full_name,
        private: repo.private,
        description: repo.description,
        defaultBranch: repo.default_branch,
      }));
  }
  async branches(fullName: string) {
    this.checkName(fullName);
    const pages = JSON.parse(
      await this.cli(['api', '--paginate', '--slurp', `repos/${fullName}/branches?per_page=100`]),
    );
    return pages.flat().map((b: any) => ({ name: b.name, protected: b.protected }));
  }
  checkName(fullName: string) {
    if (!repositoryName.test(fullName) || fullName.split('/').some((p) => p === '.' || p === '..'))
      throw new Error('Invalid GitHub repository name');
  }
  async git(args: string[], cwd?: string) {
    // No repository-provided hooks, credential helpers, alternate SSH commands, or filesystem protocols.
    return run(
      'git',
      [
        '-c',
        `core.hooksPath=${path.join(paths.home, 'no-hooks')}`,
        '-c',
        'credential.helper=',
        '-c',
        'credential.helper=!gh auth git-credential',
        '-c',
        'core.sshCommand=false',
        '-c',
        'protocol.file.allow=never',
        '-c',
        'protocol.ext.allow=never',
        ...args,
      ],
      { cwd, env: this.env() },
    );
  }
  async prepare(task: Task, progress: (message: string) => void): Promise<Repository[]> {
    await mkdir(task.workspace, { recursive: true, mode: 0o700 });
    const repositories: Repository[] = [];
    for (const repo of task.repositories) {
      this.checkName(repo.fullName);
      await this.git(['check-ref-format', '--branch', repo.baseBranch]);
      const [owner, name] = repo.fullName.split('/');
      const directory = path.join(task.workspace, owner, name);
      await mkdir(path.dirname(directory), { recursive: true, mode: 0o700 });
      const taskBranch = `codex-home/${task.id}`;
      progress(`Cloning ${repo.fullName} at ${repo.baseBranch}`);
      await this.git([
        'clone',
        '--branch',
        repo.baseBranch,
        '--',
        `https://github.com/${repo.fullName}.git`,
        directory,
      ]);
      const baseSha = await this.git(['rev-parse', 'HEAD'], directory);
      await this.git(['switch', '-c', taskBranch], directory);
      const configDigest = createHash('sha256')
        .update(await readFile(path.join(directory, '.git', 'config')))
        .digest('hex');
      repositories.push({ ...repo, directory, taskBranch, baseSha, configDigest });
    }
    return repositories;
  }
  async safeDirectory(task: Task, repo: Repository) {
    if (!repo.directory || !repo.baseSha || !repo.taskBranch)
      throw new Error('Repository workspace is not prepared');
    const root = await realpath(task.workspace),
      directory = await realpath(repo.directory);
    const relative = path.relative(root, directory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
      throw new Error('Repository escaped its task workspace');
    const gitPath = path.join(directory, '.git');
    const stat = await lstat(gitPath);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error('Repository Git metadata must be a local directory');
    // Reject tampered metadata before running Git in the credential-bearing control plane.
    const scan = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error('Symlinks in Git metadata are not allowed');
        if (entry.isDirectory()) await scan(path.join(dir, entry.name));
      }
    };
    await scan(gitPath);
    if (
      repo.configDigest &&
      createHash('sha256')
        .update(await readFile(path.join(gitPath, 'config')))
        .digest('hex') !== repo.configDigest
    )
      throw new Error(
        'Repository Git configuration was modified. Restore it before reviewing or publishing through the dashboard.',
      );
    return directory;
  }
  async changes(task: Task, repo: Repository) {
    const directory = await this.safeDirectory(task, repo);
    const status = await this.git(['status', '--porcelain=v1', '-uall'], directory);
    let diff = await this.git(
      ['diff', '--no-ext-diff', '--no-textconv', repo.baseSha!, '--', '.'],
      directory,
    );
    const committed = await this.git(
      ['diff', '--name-status', repo.baseSha!, 'HEAD', '--', '.'],
      directory,
    );
    const untracked = await this.git(['ls-files', '--others', '--exclude-standard'], directory);
    const files = (await this.git(['ls-files', '-z', '--others', '--exclude-standard'], directory))
      .split('\0')
      .filter(Boolean);
    for (const filename of files) {
      const file = path.join(directory, filename);
      const stat = await lstat(file);
      if (stat.isSymbolicLink()) {
        diff += `\nNew symlink: ${filename}\n`;
        continue;
      }
      if (stat.size > 256_000) {
        diff += `\nNew file: ${filename} (too large for inline preview)\n`;
        continue;
      }
      const content = await readFile(file);
      diff += content.includes(0)
        ? `\nNew binary file: ${filename}\n`
        : `\ndiff --git a/${filename} b/${filename}\n--- /dev/null\n+++ b/${filename}\n${content
            .toString('utf8')
            .split('\n')
            .map((line) => '+' + line)
            .join('\n')}\n`;
      if (diff.length > 4_000_000) {
        diff += '\nPreview truncated. Review the remaining files in the workspace.\n';
        break;
      }
    }
    return {
      fullName: repo.fullName,
      status,
      committed,
      untracked,
      diff,
      taskBranch: repo.taskBranch,
      baseBranch: repo.baseBranch,
      prUrl: repo.prUrl,
      prNumber: repo.prNumber,
    };
  }
  async createPr(task: Task, repo: Repository, title: string, body: string) {
    const directory = await this.safeDirectory(task, repo);
    if ((await this.git(['branch', '--show-current'], directory)) !== repo.taskBranch)
      throw new Error(
        'Task branch was changed. Restore the managed task branch before publishing.',
      );
    // Always override the push destination; do not trust agent-modified remote configuration.
    const user = JSON.parse(await this.cli(['api', 'user']));
    await this.git(['add', '--all', '--', '.'], directory);
    const changed = await this.git(['diff', '--cached', '--name-only'], directory);
    if (changed)
      await this.git(
        [
          '-c',
          `user.name=${user.name || user.login}`,
          '-c',
          `user.email=${user.id}+${user.login}@users.noreply.github.com`,
          '-c',
          'commit.gpgsign=false',
          'commit',
          '-m',
          title,
        ],
        directory,
      );
    if (!(await this.git(['diff', '--name-only', repo.baseSha!, 'HEAD'], directory)))
      throw new Error(`No changes to publish in ${repo.fullName}`);
    await this.git(
      [
        '-c',
        'push.followTags=false',
        'push',
        '--no-verify',
        '--',
        `https://github.com/${repo.fullName}.git`,
        `HEAD:refs/heads/${repo.taskBranch}`,
      ],
      directory,
    );
    const existing = JSON.parse(
      await this.cli([
        'pr',
        'list',
        '--repo',
        repo.fullName,
        '--head',
        repo.taskBranch!,
        '--state',
        'open',
        '--json',
        'number,url',
      ]),
    );
    if (existing.length) return existing[0];
    const url = await this.cli(
      [
        'pr',
        'create',
        '--repo',
        repo.fullName,
        '--head',
        repo.taskBranch!,
        '--base',
        repo.baseBranch,
        '--title',
        title,
        '--body-file',
        '-',
      ],
      { input: body },
    );
    return JSON.parse(
      await this.cli(['pr', 'view', url, '--repo', repo.fullName, '--json', 'number,url']),
    );
  }
  async prStatus(repo: Repository) {
    if (!repo.prNumber) throw new Error('No pull request exists');
    return JSON.parse(
      await this.cli([
        'pr',
        'view',
        String(repo.prNumber),
        '--repo',
        repo.fullName,
        '--json',
        'number,url,state,mergeable,mergeStateStatus,statusCheckRollup,title,headRefName,baseRefName',
      ]),
    );
  }
  async merge(repo: Repository) {
    if (!repo.prNumber) throw new Error('No pull request exists');
    const pr = JSON.parse(
      await this.cli([
        'pr',
        'view',
        String(repo.prNumber),
        '--repo',
        repo.fullName,
        '--json',
        'headRefOid,headRefName,baseRefName',
      ]),
    );
    if (pr.headRefName !== repo.taskBranch || pr.baseRefName !== repo.baseBranch)
      throw new Error('Pull request branches differ from this task');
    await this.cli([
      'pr',
      'merge',
      String(repo.prNumber),
      '--repo',
      repo.fullName,
      '--squash',
      '--match-head-commit',
      pr.headRefOid,
    ]);
    return this.prStatus(repo);
  }
  stop() {
    this.login?.kill();
  }
}
