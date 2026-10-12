import { useEffect, useState } from 'react';
import { ArrowRight, Check, GitBranch, Search, X } from 'lucide-react';
import { api, type RepoOption } from './api';
import { Disclosure, Empty, Field, Status } from './components';
import type { Model, Task } from '../server/types';
interface Selection {
  fullName: string;
  baseBranch: string;
  branches: string[];
}
export function NewTask({
  onCreated,
  onError,
}: {
  onCreated: (task: Task) => void;
  onError: (error: string) => void;
}) {
  const [models, setModels] = useState<Model[]>([]),
    [model, setModel] = useState(''),
    [effort, setEffort] = useState('');
  const [repos, setRepos] = useState<RepoOption[]>([]),
    [selected, setSelected] = useState<Selection[]>([]),
    [query, setQuery] = useState('');
  const [name, setName] = useState(''),
    [prompt, setPrompt] = useState(''),
    [permission, setPermission] = useState('review'),
    [network, setNetwork] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void Promise.allSettled([api<Model[]>('/models'), api<RepoOption[]>('/repositories')]).then(
      (results) => {
        if (!active) return;
        const m = results[0],
          r = results[1];
        if (m.status === 'fulfilled') {
          setModels(m.value);
          const defaultModel = m.value.find((m) => m.isDefault) || m.value[0];
          if (defaultModel) {
            setModel(defaultModel.model);
            setEffort(defaultModel.defaultReasoningEffort);
          }
        } else onError(m.reason.message);
        if (r.status === 'fulfilled') setRepos(r.value);
        else onError(r.reason.message);
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, []);
  const currentModel = models.find((m) => m.model === model);
  async function choose(repo: RepoOption) {
    if (selected.some((r) => r.fullName === repo.fullName)) return;
    setSelected((prev) => [
      ...prev,
      { fullName: repo.fullName, baseBranch: repo.defaultBranch, branches: [repo.defaultBranch] },
    ]);
    try {
      const branches = await api<{ name: string }[]>(
        `/branches?repo=${encodeURIComponent(repo.fullName)}`,
      );
      setSelected((prev) =>
        prev.map((r) =>
          r.fullName === repo.fullName ? { ...r, branches: branches.map((b) => b.name) } : r,
        ),
      );
    } catch (e) {
      onError((e as Error).message);
    }
  }
  async function run() {
    setBusy(true);
    try {
      onCreated(
        await api('/tasks', 'POST', {
          name,
          prompt,
          repositories: selected.map(({ fullName, baseBranch }) => ({ fullName, baseBranch })),
          model,
          effort: effort || undefined,
          permission,
          network,
        }),
      );
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="new-task">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Prepare a mission</p>
          <h1>NEW TASK</h1>
          <p className="subtitle">One instruction. Complete repositories. Official Codex.</p>
        </div>
        <Status state="ready" />
      </div>
      <div className="new-task-grid">
        <section className="form-panel">
          <Field label="Task name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="What are we building?"
              maxLength={120}
            />
          </Field>
          <div className="two-col">
            <Field label="Runtime">
              <div className="readonly-field">
                <span className="runtime-mark">C</span>OpenAI Codex
                <span className="muted">Official</span>
              </div>
            </Field>
            <Field label="Model">
              <select
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  setEffort(
                    models.find((m) => m.model === e.target.value)?.defaultReasoningEffort || '',
                  );
                }}
              >
                <option value="" disabled>
                  {loading ? 'Loading models…' : 'Select a model'}
                </option>
                {models.map((m) => (
                  <option key={m.id} value={m.model}>
                    {m.displayName}
                    {m.isDefault ? ' · Default' : ''}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {currentModel && <p className="helper">{currentModel.description}</p>}
          {currentModel?.inputModalities?.length && (
            <p className="helper">
              Supported inputs: {currentModel.inputModalities.join(' · ')}. Default reasoning
              effort: {currentModel.defaultReasoningEffort}.
            </p>
          )}
          <Field label="Instruction">
            <textarea
              className="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Inspect the selected repositories and describe the changes you want Codex to make…"
              rows={9}
            />
          </Field>
          <Disclosure title="Execution settings">
            <Field label="Reasoning effort">
              <select value={effort} onChange={(e) => setEffort(e.target.value)}>
                {currentModel?.supportedReasoningEfforts.map((e) => (
                  <option key={e.reasoningEffort} value={e.reasoningEffort}>
                    {e.reasoningEffort}
                    {e.reasoningEffort === currentModel.defaultReasoningEffort
                      ? ' · Recommended'
                      : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Permissions">
              <select value={permission} onChange={(e) => setPermission(e.target.value)}>
                <option value="review">
                  Review commands · Codex asks before untrusted commands
                </option>
                <option value="workspace">
                  Workspace writes · Codex asks when escalation is needed
                </option>
              </select>
            </Field>
            <label className="check-row">
              <input
                type="checkbox"
                checked={network}
                onChange={(e) => setNetwork(e.target.checked)}
              />
              Allow network access in the Codex sandbox
            </label>
            <p className="helper">
              Each task has a separate working tree. Approvals use Codex’s own policy.
            </p>
          </Disclosure>
          <div className="form-footer">
            <span className="muted">Runs on your server, even when you leave.</span>
            <button
              className="primary"
              onClick={run}
              disabled={busy || !name.trim() || !prompt.trim() || !selected.length || !model}
            >
              {busy ? 'Queueing…' : 'Run task'}
              <ArrowRight size={16} />
            </button>
          </div>
        </section>
        <aside className="repo-picker">
          <div className="section-label">
            Repositories<span>{selected.length} selected</span>
          </div>
          <div className="search">
            <Search size={15} />
            <input
              aria-label="Search repositories"
              placeholder="Search repositories"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {selected.length > 0 && (
            <div className="selected-repos">
              {selected.map((repo) => (
                <div className="selected-repo" key={repo.fullName}>
                  <div>
                    <Check size={14} />
                    <strong>{repo.fullName}</strong>
                    <button
                      className="icon-button"
                      aria-label={`Remove ${repo.fullName}`}
                      onClick={() =>
                        setSelected((prev) => prev.filter((r) => r.fullName !== repo.fullName))
                      }
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <label>
                    <GitBranch size={14} />
                    <select
                      aria-label={`Base branch for ${repo.fullName}`}
                      value={repo.baseBranch}
                      onChange={(e) =>
                        setSelected((prev) =>
                          prev.map((r) =>
                            r.fullName === repo.fullName ? { ...r, baseBranch: e.target.value } : r,
                          ),
                        )
                      }
                    >
                      {repo.branches.map((b) => (
                        <option key={b}>{b}</option>
                      ))}
                    </select>
                  </label>
                </div>
              ))}
            </div>
          )}
          <div className="repo-list">
            {loading ? (
              <p className="muted">Loading authorized repositories…</p>
            ) : !repos.length ? (
              <Empty title="Connect GitHub">
                Authorize GitHub in Settings to select repositories.
              </Empty>
            ) : (
              repos
                .filter((r) => r.fullName.toLowerCase().includes(query.toLowerCase()))
                .map((repo) => (
                  <button
                    key={repo.fullName}
                    className={`repo-option ${selected.some((r) => r.fullName === repo.fullName) ? 'selected' : ''}`}
                    onClick={() => choose(repo)}
                  >
                    <div>
                      <strong>{repo.fullName}</strong>
                      <span>{repo.private ? 'Private' : 'Public'}</span>
                    </div>
                    {repo.description && <p>{repo.description}</p>}
                  </button>
                ))
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
