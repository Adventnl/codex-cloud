# Codex Home

A self-hosted mission control for the **official OpenAI Codex App Server**. React/TypeScript, a thin Node.js backend, SQLite, Git and GitHub CLI. No agent harness, inference proxy or custom conversation engine.

```sh
npm ci
npm run setup
npm run build
npm start
```

Open **http://127.0.0.1:3000**, use the dashboard password saved in `.env`, and connect your ChatGPT subscription and GitHub in Settings. Node.js 24+, Git and GitHub CLI are required. Linux production execution also uses bubblewrap. For existing official Codex credentials, optionally run `npm run setup -- --reuse-local-codex-login`.

Features: real background tasks, persistent FIFO queue, complete independent multi-repository clones, dynamic Codex models/reasoning effort, native threads and approvals, SSE events, actual Git diffs including new files, per-repository commits/pushes/PRs, explicit merge confirmation, and daily compatible stable runtime updates with rollback. Browser disconnection and dashboard sign-out leave tasks running. Restarted executions are reconciled against official thread records and require explicit continuation when interrupted.

- [Deployment and security boundaries](docs/DEPLOYMENT.md): Docker Compose, Ubuntu/Debian systemd, remote access and backups.
- [Design specification](docs/DESIGN.md): restrained SpaceX-inspired engineering interface.
- [Verification](docs/VERIFICATION.md): automated coverage and actual external integration results.

```sh
npm test
npm run verify:runtime
npm run build
```

Upstream integration sources: [App Server](https://learn.chatgpt.com/docs/app-server), [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk), [official Codex source](https://github.com/openai/codex). The App Server JSONL stdio path is the only agent execution path. Codex remains independently installed and maintained by OpenAI; its currently documented App Server surface is experimental, so every release is checked before adoption.
