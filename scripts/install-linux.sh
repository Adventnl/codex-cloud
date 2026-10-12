#!/usr/bin/env bash
set -euo pipefail
if [[ $(id -u) != 0 ]]; then echo 'Run this installer with sudo.' >&2; exit 1; fi
checkout=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
node_major=$(node -p 'Number(process.versions.node.split(".")[0])')
if (( node_major < 24 )); then echo 'Install Node.js 24 or later first.' >&2; exit 1; fi
command -v gh >/dev/null || { echo 'Install official GitHub CLI first: https://cli.github.com/manual/installation'; exit 1; }
apt-get update
apt-get install -y git bubblewrap
id codexhome &>/dev/null || useradd --system --create-home --home-dir /var/lib/codex-home --shell /usr/sbin/nologin codexhome
install -d -o codexhome -g codexhome -m 700 /var/lib/codex-home
# Copy a clean source tree; never copy developer credentials, local workspaces or .git.
install -d -m 755 /opt/codex-home
tar -C "$checkout" --exclude=.git --exclude=node_modules --exclude=dist --exclude=.env --exclude=.data --exclude=.codex-schemas -cf - . | tar -C /opt/codex-home -xf -
cd /opt/codex-home
npm ci
npm run build
npm prune --omit=dev
if [[ ! -f /etc/codex-home.env ]]; then
  dashboard_password=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("base64url"))')
  umask 077
  cat > /etc/codex-home.env <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
DATA_DIR=/var/lib/codex-home
APP_ORIGIN=http://127.0.0.1:3000
COOKIE_SECURE=false
DASHBOARD_PASSWORD=$dashboard_password
RUNTIME_ISOLATION=bubblewrap
EOF
fi
node_executable=$(command -v node)
cat > /etc/systemd/system/codex-home.service <<EOF
[Unit]
Description=Codex Home mission control
After=network-online.target
Wants=network-online.target
[Service]
User=codexhome
Group=codexhome
WorkingDirectory=/opt/codex-home
EnvironmentFile=/etc/codex-home.env
ExecStart=$node_executable /opt/codex-home/dist/server/index.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
UMask=0077
ProtectSystem=strict
ReadWritePaths=/var/lib/codex-home
ProtectHome=true
PrivateTmp=true
# Codex + bubblewrap require user namespaces; do not disable them with systemd restrictions.
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now codex-home
echo 'Installed. Read your dashboard password with sudo cat /etc/codex-home.env.'
echo 'Open http://127.0.0.1:3000 (or an SSH tunnel), then connect ChatGPT and GitHub in Settings.'
