import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { GitHub } from '../server/github.js';
import { Events } from '../server/events.js';
import { config } from '../server/config.js';
import type { Task } from '../server/types.js';
const root = await mkdtemp(path.join(config.data, 'workspace-check-'));
const github = new GitHub(new Events());
try {
  const first = {
    id: 'workspace-check-one',
    workspace: path.join(root, 'one'),
    repositories: [
      { fullName: 'Adventnl/codex-cloud', baseBranch: 'main' },
      { fullName: 'octocat/Hello-World', baseBranch: 'master' },
    ],
  } as Task;
  const second = {
    id: 'workspace-check-two',
    workspace: path.join(root, 'two'),
    repositories: [{ fullName: 'Adventnl/codex-cloud', baseBranch: 'main' }],
  } as Task;
  const repos = await github.prepare(first, console.log),
    other = await github.prepare(second, console.log);
  for (const repo of [...repos, ...other]) {
    if ((await github.git(['rev-parse', '--is-shallow-repository'], repo.directory)) !== 'false')
      throw new Error('Repository was shallow');
    if ((await github.git(['branch', '--show-current'], repo.directory)) !== repo.taskBranch)
      throw new Error('Task branch missing');
    await github.safeDirectory(
      { ...first, workspace: repo === other[0] ? second.workspace : first.workspace },
      repo,
    );
  }
  await writeFile(path.join(repos[0].directory!, 'isolation-check.txt'), 'Only task one\n');
  if (
    await readFile(path.join(other[0].directory!, 'isolation-check.txt')).then(
      () => true,
      () => false,
    )
  )
    throw new Error('Tasks shared a writable working tree');
  console.log(
    JSON.stringify({
      completeRepositories: repos.map((r) => r.fullName),
      independentBaseBranches: repos.map((r) => r.baseBranch),
      distinctTaskBranches: [repos[0].taskBranch, other[0].taskBranch],
      isolationVerified: true,
    }),
  );
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
