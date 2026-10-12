import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
// Resolve npm's JS entry point rather than executing a Windows .cmd through a shell.
export async function npmCommand(args: string[]) {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    '/usr/local/lib/node_modules/npm/bin/npm-cli.js',
    '/usr/share/nodejs/npm/bin/npm-cli.js',
  ];
  for (const entry of candidates) {
    if (!entry) continue;
    try {
      await access(entry);
      return { command: process.execPath, args: [entry, ...args] };
    } catch {
      /* next */
    }
  }
  throw new Error('npm CLI not found. Install Node.js 24 with npm.');
}
export function run(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    input?: string;
    timeout?: number;
    maxOutput?: number;
  } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: 'pipe',
      windowsHide: true,
      shell: false,
    });
    let stdout = '',
      stderr = '',
      size = 0,
      settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(stdout.trim());
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error(`${command} timed out`));
    }, options.timeout || 120_000);
    child.stdout.on('data', (b) => {
      size += b.length;
      if (size > (options.maxOutput || 8_000_000)) {
        child.kill();
        finish(new Error('Output too large; narrow the selection'));
      } else stdout += b.toString();
    });
    child.stderr.on('data', (b) => {
      stderr = (stderr + b.toString()).slice(-8000);
    });
    child.on('error', finish);
    child.on('exit', (code) =>
      finish(code === 0 ? undefined : new Error(`${command} exited ${code}: ${stderr || stdout}`)),
    );
    if (options.input) child.stdin.write(options.input);
    child.stdin.end();
  });
}
