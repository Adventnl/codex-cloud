import { useEffect, useState } from 'react';
import { ArrowUpRight, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from './api';
import { Field, Panel, ExternalLink } from './components';
import type { RuntimeRecord, Settings as Preferences } from '../server/types';
export function Settings({
  onError,
  revision,
}: {
  onError: (message: string) => void;
  revision: number;
}) {
  const [status, setStatus] = useState<{
      runtime: RuntimeRecord;
      settings: Preferences;
      server: any;
    }>(),
    [account, setAccount] = useState<any>(),
    [github, setGithub] = useState<any>();
  const [device, setDevice] = useState<any>(),
    [busy, setBusy] = useState('');
  async function load() {
    const results = await Promise.allSettled([api('/status'), api('/account'), api('/github')]);
    if (results[0].status === 'fulfilled') setStatus(results[0].value);
    if (results[1].status === 'fulfilled') setAccount(results[1].value);
    else setAccount({ error: results[1].reason.message });
    if (results[2].status === 'fulfilled') setGithub(results[2].value);
  }
  useEffect(() => {
    void load();
  }, [revision]);
  async function action(key: string, fn: () => Promise<any>) {
    setBusy(key);
    try {
      const value = await fn();
      await load();
      return value;
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function preferences(patch: Partial<Preferences>) {
    if (!status) return;
    await action('settings', () => api('/settings', 'PATCH', { ...status.settings, ...patch }));
  }
  const login = github?.login;
  const limits = account?.rateLimits?.rateLimits;
  return (
    <div className="settings">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Connections & infrastructure</p>
          <h1>SETTINGS</h1>
          <p className="subtitle">Your accounts. Your server. Upstream Codex.</p>
        </div>
        <ShieldCheck size={27} strokeWidth={1} />
      </div>
      <div className="settings-grid">
        <Panel
          title="ChatGPT account"
          action={
            <span
              className={`connection ${account?.account?.type === 'chatgpt' ? 'connected' : ''}`}
            >
              {account?.account?.type === 'chatgpt' ? 'Connected' : 'Not connected'}
            </span>
          }
        >
          {account?.account ? (
            <>
              <div className="account-name">{account.account.email || account.account.type}</div>
              <p className="helper">Plan: {account.account.planType || 'Not reported'}</p>
              <button
                disabled={Boolean(busy)}
                onClick={() => action('logout', () => api('/account/logout', 'POST'))}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <p className="helper">
                Use your ChatGPT subscription through official Codex authentication.
              </p>
              <button
                disabled={Boolean(busy)}
                className="primary"
                onClick={() =>
                  action('login', async () => {
                    const response = await api('/account/login', 'POST');
                    setDevice(response);
                    return response;
                  })
                }
              >
                Sign in with ChatGPT
                <ArrowUpRight size={15} />
              </button>
              {account?.error && <p className="helper">{account.error}</p>}
            </>
          )}
          {device && account?.account?.type !== 'chatgpt' && (
            <div className="device-code">
              <p>Open the official verification page and enter:</p>
              <strong>{device.userCode}</strong>
              <ExternalLink href={device.verificationUrl}>Authorize ChatGPT</ExternalLink>
              <p className="helper">
                Enable device-code authorization in ChatGPT security settings if requested.
              </p>
              <button onClick={() => void load()}>Check connection</button>
            </div>
          )}
          {limits && (
            <div className="rate-limits">
              {['primary', 'secondary'].map(
                (key) =>
                  limits[key] && (
                    <div key={key}>
                      <span>
                        {key === 'primary' ? 'Primary usage window' : 'Secondary usage window'}
                      </span>
                      <strong>{limits[key].usedPercent}% used</strong>
                      {limits[key].resetsAt && (
                        <small>
                          Resets {new Date(limits[key].resetsAt * 1000).toLocaleString()}
                        </small>
                      )}
                    </div>
                  ),
              )}
              {limits.credits && (
                <p className="helper">Credits: {limits.credits.balance ?? 'Not reported'}</p>
              )}
            </div>
          )}
        </Panel>
        <Panel
          title="GitHub"
          action={
            <span className={`connection ${github?.connected ? 'connected' : ''}`}>
              {github?.connected ? 'Connected' : 'Not connected'}
            </span>
          }
        >
          {github?.connected ? (
            <>
              <div className="account-name">@{github.account.login}</div>
              <p className="helper">
                Authorized repositories, branches and pull requests through GitHub CLI.
              </p>
              <button
                disabled={Boolean(busy)}
                onClick={() => action('ghlogout', () => api('/github/logout', 'POST'))}
              >
                Disconnect GitHub
              </button>
            </>
          ) : (
            <>
              <p className="helper">
                Connect public and private repositories using GitHub’s device authorization.
              </p>
              <button
                className="primary"
                disabled={Boolean(busy)}
                onClick={() => action('ghlogin', () => api('/github/login', 'POST'))}
              >
                Connect GitHub
                <ArrowUpRight size={15} />
              </button>
            </>
          )}
          {login?.state === 'pending' && (
            <div className="device-code">
              <p>Authorize this server at GitHub:</p>
              <strong>{login.code || 'Requesting device code…'}</strong>
              <ExternalLink href={login.url}>Authorize GitHub</ExternalLink>
              <button onClick={() => void load()}>Check connection</button>
            </div>
          )}
          {login?.error && <p className="inline-error">{login.error}</p>}
        </Panel>
      </div>
      <Panel title="Codex runtime" action={<span className="label-tag">Official · Stable</span>}>
        <div className="runtime-grid">
          <div>
            <p className="eyebrow">Installed release</p>
            <div className="version">
              {status?.runtime.version ? `v${status.runtime.version}` : 'Not installed'}
            </div>
            <p className="helper">Updated independently from this application.</p>
          </div>
          <dl>
            <dt>Latest available</dt>
            <dd>{status?.runtime.latest || 'Not checked'}</dd>
            <dt>Last checked</dt>
            <dd>
              {status?.runtime.lastChecked
                ? new Date(status.runtime.lastChecked).toLocaleString()
                : 'Never'}
            </dd>
            <dt>Last successful update</dt>
            <dd>
              {status?.runtime.lastUpdated
                ? new Date(status.runtime.lastUpdated).toLocaleString()
                : 'Never'}
            </dd>
            <dt>Previous release</dt>
            <dd>{status?.runtime.previous || 'None yet'}</dd>
          </dl>
        </div>
        {status?.runtime.error && <p className="inline-error">{status.runtime.error}</p>}
        <div className="runtime-footer">
          <label className="check-row">
            <input
              type="checkbox"
              checked={status?.settings.automaticUpdates || false}
              onChange={(e) => preferences({ automaticUpdates: e.target.checked })}
            />
            Automatically install compatible stable releases · Daily
          </label>
          <div className="actions">
            <button
              disabled={Boolean(busy)}
              onClick={() => action('check', () => api('/runtime/check', 'POST'))}
            >
              <RefreshCw size={13} />
              Check now
            </button>
            <button
              disabled={Boolean(busy)}
              onClick={() => action('update', () => api('/runtime/update', 'POST'))}
            >
              {busy === 'update' ? 'Validating update…' : 'Update now'}
            </button>
            <button
              disabled={Boolean(busy) || !status?.runtime.previous}
              onClick={() => action('rollback', () => api('/runtime/rollback', 'POST'))}
            >
              Roll back
            </button>
          </div>
        </div>
      </Panel>
      <Panel title="Server">
        <div className="server-grid">
          <Field label="Maximum concurrent tasks">
            <select
              value={status?.settings.concurrency || 1}
              onChange={(e) => preferences({ concurrency: Number(e.target.value) })}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? 'task' : 'tasks'}
                </option>
              ))}
            </select>
          </Field>
          <div>
            <p className="eyebrow">Workspace storage</p>
            <code className="storage-path">{status?.server.workspace}</code>
            <p className="helper">
              Configured with WORKSPACE_DIR. Change it before creating tasks.
            </p>
          </div>
          <div>
            <p className="eyebrow">Execution isolation</p>
            <strong>{status?.server.isolation}</strong>
            <p className="helper">
              {status?.server.platform} · Server-managed background execution
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}
