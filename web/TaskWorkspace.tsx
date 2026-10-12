import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  GitBranch,
  GitPullRequest,
  PanelRightClose,
  PanelRightOpen,
  Square,
  Terminal,
  FileDiff,
  MessageSquare,
  Send,
  RefreshCw,
} from 'lucide-react';
import { api, type Change } from './api';
import { ApprovalCard } from './Approvals';
import { Empty, ExternalLink, Field, Modal, Status } from './components';
import type { Approval, Task } from '../server/types';
import type { LiveEvent } from '../server/events';
import { ConversationItem, type Item, type Turn } from './ConversationItem';
import { ChangesView } from './ChangesView';
export function TaskWorkspace({
  task,
  events,
  onBack,
  onError,
  onChanged,
}: {
  task: Task;
  events: LiveEvent[];
  onBack: () => void;
  onError: (m: string) => void;
  onChanged: () => void;
}) {
  const [bufferedEvents, setBufferedEvents] = useState<LiveEvent[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]),
    [approvals, setApprovals] = useState<Approval[]>([]),
    [changes, setChanges] = useState<Change[]>([]),
    [panel, setPanel] = useState(true),
    [tab, setTab] = useState('conversation');
  const [text, setText] = useState(''),
    [busy, setBusy] = useState(''),
    [prDialog, setPrDialog] = useState(false),
    [title, setTitle] = useState(task.name),
    [body, setBody] = useState(''),
    [publish, setPublish] = useState<string[]>([]),
    [merge, setMerge] = useState<Change>(),
    [confirmation, setConfirmation] = useState(''),
    [prStates, setPrStates] = useState<Record<string, any>>({});
  const running = ['queued', 'preparing', 'running', 'waiting'].includes(task.state);
  const taskEvents = [
    ...new Map(
      [...bufferedEvents, ...events.filter((e) => e.taskId === task.id)].map((e) => [
        e.sequence,
        e,
      ]),
    ).values(),
  ].sort((a, b) => a.sequence - b.sequence);
  async function refresh() {
    const results = await Promise.allSettled([
      api(`/tasks/${task.id}/thread`),
      api(`/tasks/${task.id}`),
      api<Change[]>(`/tasks/${task.id}/changes`),
    ]);
    if (results[0].status === 'fulfilled') setTurns(results[0].value?.thread?.turns || []);
    if (results[1].status === 'fulfilled') setApprovals(results[1].value.approvals);
    if (results[2].status === 'fulfilled') setChanges(results[2].value);
    else if (task.repositories.some((r) => r.directory)) onError(results[2].reason.message);
  }
  useEffect(() => {
    setTurns([]);
    void refresh();
    api<LiveEvent[]>(`/tasks/${task.id}/events`)
      .then(setBufferedEvents)
      .catch((e) => onError(e.message));
    const interval = setInterval(() => void refresh(), running ? 3500 : 15_000);
    return () => clearInterval(interval);
  }, [task.id, task.state]);
  useEffect(() => {
    if (
      taskEvents
        .slice(-4)
        .some(
          (e) =>
            e.message.method === 'home/approval' || e.message.method === 'serverRequest/resolved',
        )
    )
      void refresh();
  }, [events.length]);
  async function action(key: string, fn: () => Promise<any>) {
    setBusy(key);
    try {
      await fn();
      onChanged();
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  // Live deltas supplement official thread history; item IDs prevent duplicate message rendering.
  const liveItems = new Map<string, Item>();
  const persisted = new Map(turns.flatMap((t) => t.items).map((i) => [i.id, i]));
  for (const event of taskEvents) {
    const { method, params: p } = event.message;
    if (!p) continue;
    if ((method === 'item/started' || method === 'item/completed') && p.item)
      liveItems.set(p.item.id, p.item);
    if (method === 'item/agentMessage/delta') {
      const item = liveItems.get(p.itemId) || { id: p.itemId, type: 'agentMessage', text: '' };
      liveItems.set(p.itemId, { ...item, text: (item.text || '') + p.delta });
    }
    if (method === 'item/commandExecution/outputDelta') {
      const item: Item = liveItems.get(p.itemId) || {
        id: p.itemId,
        type: 'commandExecution',
        command: 'Command output',
      };
      liveItems.set(p.itemId, {
        ...item,
        aggregatedOutput: (item.aggregatedOutput || '') + p.delta,
      });
    }
  }
  const items = [...persisted.values()];
  for (const [id, item] of liveItems) {
    if (!persisted.has(id)) items.push(item);
    else if (item.text && item.text.length > (persisted.get(id)?.text?.length || 0))
      items[items.findIndex((i) => i.id === id)] = item;
  }
  return (
    <div className="workspace">
      <div className="workspace-heading">
        <button className="icon-button" aria-label="Back to dashboard" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <div>
          <p className="eyebrow">Task / {task.id.slice(0, 8)}</p>
          <h1>{task.name}</h1>
        </div>
        <Status state={task.state} />
        <div className="actions">
          <button className="icon-button" aria-label="Refresh task" onClick={() => void refresh()}>
            <RefreshCw size={16} />
          </button>
          {running && (
            <button
              className="stop"
              disabled={Boolean(busy)}
              onClick={() => action('stop', () => api(`/tasks/${task.id}/stop`, 'POST'))}
            >
              <Square size={12} />
              Stop
            </button>
          )}
          <button
            className="icon-button"
            aria-label={panel ? 'Collapse details' : 'Expand details'}
            onClick={() => setPanel(!panel)}
          >
            {panel ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
          </button>
        </div>
      </div>
      <div className={`workspace-grid ${panel ? '' : 'panel-collapsed'}`}>
        <main className="task-main">
          <div className="tabs">
            {[
              { id: 'conversation', icon: MessageSquare, name: 'Conversation' },
              { id: 'activity', icon: Terminal, name: 'Activity' },
              { id: 'changes', icon: FileDiff, name: 'Changes' },
            ].map((t) => (
              <button
                key={t.id}
                className={tab === t.id ? 'active' : ''}
                onClick={() => setTab(t.id)}
              >
                <t.icon size={14} />
                {t.name}
                {t.id === 'changes' && <span>{changes.length}</span>}
              </button>
            ))}
          </div>
          {task.error && <div className="task-error">{task.error}</div>}
          <div className="task-content">
            {tab === 'conversation' && (
              <>
                {!items.length && (
                  <div className="message user-message">
                    <p className="eyebrow">You</p>
                    <div>{task.prompt}</div>
                  </div>
                )}
                {items.map((item) => (
                  <ConversationItem key={item.id} item={item} />
                ))}
                {approvals.map((request) => (
                  <ApprovalCard
                    key={request.id}
                    request={request}
                    taskId={task.id}
                    onDone={() => {
                      void refresh();
                      onChanged();
                    }}
                    onError={onError}
                  />
                ))}
                {task.state === 'preparing' && (
                  <div className="working">
                    <i />
                    Preparing complete repository workspaces…
                  </div>
                )}
                {task.state === 'running' && (
                  <div className="working">
                    <i />
                    Codex is working on your server
                  </div>
                )}
              </>
            )}
            {tab === 'activity' && (
              <div className="activity-list">
                {taskEvents.length ? (
                  taskEvents.map((e) => (
                    <details key={e.sequence}>
                      <summary>
                        <time>{new Date(e.timestamp).toLocaleTimeString()}</time>
                        <code>{e.message.method}</code>
                      </summary>
                      <pre>{JSON.stringify(e.message.params, null, 2)}</pre>
                    </details>
                  ))
                ) : (
                  <Empty title="No live events in this session">
                    Conversation history is stored by Codex. Live events appear while this dashboard
                    is connected.
                  </Empty>
                )}
              </div>
            )}
            {tab === 'changes' && <ChangesView changes={changes} />}
          </div>
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void action('send', async () => {
                await api(`/tasks/${task.id}/${running ? 'steer' : 'continue'}`, 'POST', {
                  prompt: text,
                });
                setText('');
              });
            }}
          >
            <textarea
              aria-label="Follow-up instruction"
              placeholder={
                running
                  ? 'Add an instruction to the active turn…'
                  : 'Continue this task with a new instruction…'
              }
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
            />
            <div>
              <span>
                {running ? 'Steer the active Codex turn' : 'Resume the same Codex thread'} ·{' '}
                {task.model}
              </span>
              <button
                className="icon-button"
                aria-label="Send instruction"
                type="submit"
                disabled={
                  Boolean(busy) ||
                  !text.trim() ||
                  (running && task.state !== 'running') ||
                  (!running && !task.threadId)
                }
              >
                <Send size={17} />
              </button>
            </div>
          </form>
        </main>
        {panel && (
          <aside className="task-details">
            <p className="section-label">Mission details</p>
            <dl>
              <dt>Runtime</dt>
              <dd>OpenAI Codex {task.runtimeVersion && <small>v{task.runtimeVersion}</small>}</dd>
              <dt>Model</dt>
              <dd>{task.model}</dd>
              <dt>Permissions</dt>
              <dd>
                {task.permission === 'review' ? 'Review untrusted commands' : 'Workspace writes'}
              </dd>
              <dt>Created</dt>
              <dd>{new Date(task.createdAt).toLocaleString()}</dd>
              {task.completedAt && (
                <>
                  <dt>Finished</dt>
                  <dd>{new Date(task.completedAt).toLocaleString()}</dd>
                </>
              )}
            </dl>
            <p className="section-label">
              Repositories <span>{task.repositories.length}</span>
            </p>
            {task.repositories.map((r) => (
              <div className="detail-repo" key={r.fullName}>
                <strong>{r.fullName}</strong>
                <p>
                  <GitBranch size={13} />
                  {r.baseBranch}
                </p>
                {r.taskBranch && <code>{r.taskBranch}</code>}
                {r.prUrl && <ExternalLink href={r.prUrl}>PR #{r.prNumber}</ExternalLink>}
                {r.prNumber && (
                  <>
                    <button
                      className="text-button"
                      onClick={() =>
                        action('prstatus', async () => {
                          const state = await api(
                            `/tasks/${task.id}/pull-request?repo=${encodeURIComponent(r.fullName)}`,
                          );
                          setPrStates((prev) => ({ ...prev, [r.fullName]: state }));
                        })
                      }
                    >
                      Read PR status
                    </button>
                    {prStates[r.fullName] && (
                      <p className="helper">
                        {prStates[r.fullName].state} · {prStates[r.fullName].mergeStateStatus}
                      </p>
                    )}
                    <button
                      className="text-button"
                      onClick={() => {
                        setMerge(
                          changes.find((c) => c.fullName === r.fullName) || {
                            fullName: r.fullName,
                            baseBranch: r.baseBranch,
                            status: '',
                            committed: '',
                            untracked: '',
                            diff: '',
                            prNumber: r.prNumber,
                          },
                        );
                        setConfirmation('');
                      }}
                    >
                      Merge pull request…
                    </button>
                  </>
                )}
              </div>
            ))}
            <button
              className="primary pr-button"
              disabled={
                running || !changes.some((c) => c.status || c.committed || c.diff || c.prNumber)
              }
              onClick={() => {
                setPublish(
                  changes
                    .filter((c) => c.status || c.committed || c.diff || c.prNumber)
                    .map((c) => c.fullName),
                );
                setPrDialog(true);
              }}
            >
              <GitPullRequest size={15} />
              Create pull requests
            </button>
            <p className="helper">
              Review changes before publishing. Each repository gets its own PR.
            </p>
          </aside>
        )}
      </div>
      {prDialog && (
        <Modal title="Publish task changes" close={() => setPrDialog(false)}>
          <p className="helper">
            This commits pending changes and pushes each selected task branch to GitHub.
          </p>
          <Field label="PR title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Description">
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
          </Field>
          {changes.map((c) => (
            <label className="check-row" key={c.fullName}>
              <input
                type="checkbox"
                checked={publish.includes(c.fullName)}
                onChange={(e) =>
                  setPublish((prev) =>
                    e.target.checked ? [...prev, c.fullName] : prev.filter((n) => n !== c.fullName),
                  )
                }
              />
              {c.fullName}
            </label>
          ))}
          <button
            className="primary"
            disabled={Boolean(busy) || !publish.length || !title.trim()}
            onClick={() =>
              action('publish', async () => {
                await api(`/tasks/${task.id}/pull-requests`, 'POST', {
                  repositories: publish,
                  title,
                  body,
                });
                setPrDialog(false);
              })
            }
          >
            {busy === 'publish' ? 'Publishing…' : 'Commit, push & create PRs'}
            <ArrowUpRight size={15} />
          </button>
        </Modal>
      )}
      {merge && (
        <Modal title="Confirm pull request merge" close={() => setMerge(undefined)}>
          <p>
            This merges{' '}
            <strong>
              {merge.fullName}#{merge.prNumber}
            </strong>{' '}
            into <strong>{merge.baseBranch}</strong> using squash merge. GitHub branch protections
            apply.
          </p>
          <Field label={`Type MERGE ${merge.fullName}#${merge.prNumber}`}>
            <input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
          </Field>
          <button
            className="primary"
            disabled={Boolean(busy) || confirmation !== `MERGE ${merge.fullName}#${merge.prNumber}`}
            onClick={() =>
              action('merge', async () => {
                await api(`/tasks/${task.id}/merge`, 'POST', {
                  repository: merge.fullName,
                  confirmation,
                });
                setMerge(undefined);
              })
            }
          >
            Confirm merge
          </button>
        </Modal>
      )}
    </div>
  );
}
