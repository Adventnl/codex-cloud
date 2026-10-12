# Verification record

Verified locally on Windows x64 with Node.js 24.19.0 on 12 October 2026 (Pacific/Auckland). Every dashboard task shown during verification was a real official Codex task; no seeded demonstration tasks were used.

## Actual integrations

- Official npm Codex **0.162.1** installed separately from the user's existing global 0.162.0 installation. Executable startup, version-specific generated TypeScript/JSON schemas, adapter request validation and live initialize/account/model/thread probes passed.
- Existing official ChatGPT subscription credentials were copied with explicit setup opt-in. App Server `account/read` confirmed ChatGPT authentication; `model/list` returned seven catalog entries. No API key billing was used.
- Fresh official ChatGPT and GitHub CLI device-code flows both issued verification codes. Those verification-only login attempts were cancelled before external authorization. Full device-code authorization completion on a fresh home server still requires the owner's interaction.
- Existing GitHub CLI authorization was reused. Actual authorized repository listing and branch selection were tested through the browser.
- A real official thread (`01a12eb9-8f1e-7cd2-b6a2-1f1c092df2f8`) ran against a full independent clone of `Adventnl/codex-cloud`. Native command and file-change approvals were handled through the App Server protocol; a command approval was also submitted through the real dashboard.
- The task created `docs/CODEX_HOME_SMOKE.md`. Its client disconnected while Codex was running, and Codex later reported a successful completed turn. The application's Git diff included the actual new file.
- The application committed and pushed the task branch, then created [verification PR #1](https://github.com/Adventnl/codex-cloud/pull/1). GitHub reported it open with a clean merge state. It was intentionally left unmerged.
- The server process was restarted. Task state, repository metadata, PR reference and official paginated conversation history survived. A new instruction resumed the same official thread and completed successfully after another client disconnection.
- Real multi-repository workspace preparation cloned `Adventnl/codex-cloud` from `main` and `octocat/Hello-World` from `master`, both with full histories. A second independent task clone used another task branch; a file written to the first clone was absent in the second.
- An additional real official thread (`01a12ecd-4d23-7163-bf28-dd016cd0806f`) created `docs/CODEX_HOME_MULTI_SMOKE.md` in both repositories during a single successful turn. A native file-change approval contained both actual paths; the backend verified the resulting per-repository diffs. Those local verification changes were not published.
- Chromium browser checks passed for dashboard, settings, real repository/branch selection, task changes, collapsed details and a 390px mobile viewport. No browser JavaScript errors or mobile page overflow were observed. Fonts are served locally.

## Automated checks

`npm test` covers durable SQLite records, out-of-order bidirectional RPC and lost processes, native approvals, restart reconciliation without prompt replay, descendant-thread completion isolation, resumability after cancelling queued follow-ups, dashboard authentication/session revocation, cross-site write rejection, real Git diffs and configuration/metadata boundaries, failed update preservation and rollback pointer behavior.

`npm run build` passes TypeScript validation and produces the frontend and backend. `npm audit` reported zero dependency vulnerabilities at verification time.

Optional integration checks are deliberately explicit:

```sh
npm run verify:runtime
npx tsx scripts/auth-flow-check.ts
npx tsx scripts/verify-workspaces.ts
SMOKE_REPOSITORY=owner/repository npx tsx scripts/smoke-task.ts
```

The smoke task creates one documentation file in a new isolated branch. It publishes only if `--publish` is explicitly passed; it never merges. `SMOKE_TASK_ID` reconnects to an existing verification task without rerunning its prompt. `scripts/browser-check.mjs` is the local setup verification used here; it expects the verified user's repository and smoke task record and is not a generic deployment test.

## Remaining verification limits

- The final production build is on disk. Automatic approval review rejected the last attempt to restart the hidden background server with “blocked by policy,” without a more specific reason. The already-running server remains available at `http://127.0.0.1:3000`; the last change (keeping a task waiting when another native approval is pending) loads on its next normal restart. Both real verification tasks remain completed.
- Docker and native Linux systemd/bubblewrap deployment are implemented and documented, but were not executed on this Windows machine. No Linux home-server target or Docker engine was available. amd64/arm64 cross-platform execution and host AppArmor/user-namespace configuration remain unverified.
- No real PR merge was performed, because merges require explicit authorization. The UI and backend implement typed per-PR confirmation, exact-head matching and ordinary GitHub branch protection enforcement.
- Rollback and incompatible-update behavior are covered by focused tests; a historical release rollback and a future upstream automatic update have not been exercised against actual released binaries during this session. The current real release passes the compatibility probes.
- Linux task isolation hides the controller's files and GitHub credentials. Native Windows development relies on the official Windows sandbox and remains appropriate for trusted repositories. A task's own official Codex credential copy is an upstream runtime requirement; approving a sandbox escape can expose it, as explained in [deployment boundaries](DEPLOYMENT.md).
