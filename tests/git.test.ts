import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { run } from '../server/process.js';
import { GitHub } from '../server/github.js';
import { Events } from '../server/events.js';
import type { Task, Repository } from '../server/types.js';
test('real Git diffs include new files and reject workspace escapes and modified Git configuration', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'codex-home-git-')),
    directory = path.join(workspace, 'repo');
  await mkdir(directory);
  try {
    await run('git', ['init', '-b', 'main'], { cwd: directory });
    await writeFile(path.join(directory, 'file.txt'), 'original\n');
    await run('git', ['add', '.'], { cwd: directory });
    await run(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'base'],
      { cwd: directory },
    );
    const repo: Repository = {
      fullName: 'o/r',
      baseBranch: 'main',
      taskBranch: 'main',
      directory,
      baseSha: await run('git', ['rev-parse', 'HEAD'], { cwd: directory }),
      configDigest: createHash('sha256')
        .update(await readFile(path.join(directory, '.git/config')))
        .digest('hex'),
    };
    const task = { workspace } as Task;
    const github = new GitHub(new Events());
    await writeFile(path.join(directory, 'file.txt'), 'updated\n');
    await writeFile(path.join(directory, 'new.txt'), 'new contents\n');
    const changes = await github.changes(task, repo);
    assert.match(changes.diff, /\+updated/);
    assert.match(changes.diff, /\+new contents/);
    await assert.rejects(github.safeDirectory(task, { ...repo, directory: workspace }), /escaped/);
    await writeFile(path.join(directory, '.git/config'), '[core]\n hooksPath=/unsafe\n');
    await assert.rejects(github.safeDirectory(task, repo), /configuration was modified/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
