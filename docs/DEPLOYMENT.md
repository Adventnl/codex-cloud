# Installation

## Local development / native foreground

Requires Node.js 24+, npm, Git and official GitHub CLI. Linux also requires bubblewrap and enabled unprivileged user namespaces. No GPU is needed.

```sh
npm ci
npm run setup
npm run build
npm start
```

Open `http://127.0.0.1:3000`. The generated dashboard password is in `.env`. Setup installs the current official stable Codex into `.data/runtimes/<version>` and validates its protocol. Existing GitHub CLI authorization is reused when available. Existing ChatGPT credentials can optionally be reused with `npm run setup -- --reuse-local-codex-login`; otherwise sign in from Settings using device authorization. No API key is required.

For hot reload, run `npm run dev` and `npm run dev:web` in separate terminals. Open `http://127.0.0.1:5173`. The proxy keeps cookies and event streaming on one origin.

Windows is a local development target using Codex's Windows sandbox. The production installation target is Linux. The Windows sandbox must be available to the managed runtime; execution fails visibly if it cannot initialize. Never enable full host access to work around this.

## Docker Compose

```sh
cp .env.example .env
# Set a long random DASHBOARD_PASSWORD in .env.
docker compose up -d --build
```

The unprivileged `node` user runs the service. The named volume preserves SQLite, GitHub credentials, official Codex credentials and histories, full workspaces, and all retained runtime versions. On first start the automatic update manager installs and validates the official stable Codex package into the volume. Watch `docker compose logs -f` for installation errors. Runtime updates do not rebuild the image.

Both amd64 and arm64 are supported by the base images and official distributions; build on the target architecture. They have not both been integration-tested for this project. No Docker socket or host repositories are mounted.

The container permits namespace creation with `seccomp=unconfined`, drops all Linux capabilities and runs tasks in a second bubblewrap filesystem/PID namespace. Your kernel must support unprivileged user namespaces. AppArmor policies on newer Ubuntu releases may restrict this; configure a narrowly scoped policy for bubblewrap rather than disabling host protections globally. A namespace setup failure becomes a failed task, never an automatic fallback to unrestricted execution.

## Ubuntu / Debian systemd installation

Install Node.js 24+ and the [official GitHub CLI](https://cli.github.com/manual/installation). From a clean checkout:

```sh
sudo bash scripts/install-linux.sh
sudo journalctl -u codex-home -f
```

This installs the app in `/opt/codex-home`, creates an unprivileged `codexhome` service user, keeps data in `/var/lib/codex-home`, stores private environment configuration in `/etc/codex-home.env`, and enables startup on boot. Run the installer again to update the application. Do not run two controllers against one database. Stop the service before moving storage or replacing files manually.

## Remote access

The published port binds to loopback. Use an SSH tunnel, a private VPN with HTTPS, or a TLS reverse proxy on your private network. For example:

```sh
ssh -L 3000:127.0.0.1:3000 user@home-server
```

For a reverse proxy, set `APP_ORIGIN=https://your-private-host`, `COOKIE_SECURE=true`, preserve `Host`, and disable proxy buffering for `/api/events`. The raw App Server only uses local stdio; it is never network-exposed. Dashboard sign-out leaves tasks running.

## Storage, recovery and updates

Back up the data directory while the controller is stopped; it contains secrets. Copying only SQLite omits Codex's official conversation history and workspaces. Backups need the entire directory and any external `WORKSPACE_DIR`.

After restart, previously active tasks are marked interrupted. Official `thread/read` can prove a saved turn completed or failed. Continued tasks use `thread/resume` in the original workspace. Review an interrupted task before explicitly continuing. Queued tasks run FIFO with configurable concurrency; browser disconnects do not cancel them.

Updates use the official npm stable tag, semver comparison, retained version directories, executable startup, generated release-specific JSON/TypeScript schemas, adapter request validation, and live initialize/account/model/thread probes. Only validated releases become active. Running tasks keep their existing child process and runtime. Validation failures retain the previous release and show the error. Rollback revalidates a retained release before switching future tasks. New model lists come directly from Codex; catalog presence is not proof of account entitlement.

## Credential and execution boundaries

GitHub authorization and dashboard credentials stay in the controller's private data directory, outside task workspaces. Task processes receive a filtered environment without dashboard passwords, GitHub tokens or API keys. Linux bubblewrap exposes only the current workspace, runtime installation, platform binaries and the task's private Codex home. Other tasks, the application files, database and controller's GitHub credentials are absent.

Official Codex requires its own authentication inside the runtime. Each task's private Codex home holds an official credential copy and official thread storage. These credentials remain accessible to a malicious command that you explicitly approve outside Codex's sandbox, because the runtime needs them to authenticate. Treat escalated approval requests carefully and only run trusted repositories with native isolation. This application does not claim to eliminate that upstream credential limitation. When supported by the installed schema, restricted Codex read roots are additionally enabled.

Git operations disable hooks, external diff/textconv helpers and filesystem protocols; publishing checks task branches, rejects modified repository Git configuration and symlinked Git metadata, and uses an explicit GitHub destination without force pushes. Merge requires a typed per-PR confirmation and an exact GitHub head SHA. GitHub branch protections remain authoritative.
