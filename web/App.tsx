import { useEffect, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  LayoutDashboard,
  LogOut,
  Plus,
  Settings as SettingsIcon,
  X,
  Circle,
} from 'lucide-react';
import { api } from './api';
import { NewTask } from './NewTask';
import { TaskWorkspace } from './TaskWorkspace';
import { Settings } from './Settings';
import { Empty, Field, Status, relativeDate } from './components';
import type { Task } from '../server/types';
import type { LiveEvent } from '../server/events';
export function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null),
    [password, setPassword] = useState(''),
    [tasks, setTasks] = useState<Task[]>([]),
    [page, setPage] = useState('dashboard'),
    [selected, setSelected] = useState<string>(),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0),
    [events, setEvents] = useState<LiveEvent[]>([]),
    [filter, setFilter] = useState('all'),
    [runtimeVersion, setRuntimeVersion] = useState(''),
    [online, setOnline] = useState(false),
    [loginBusy, setLoginBusy] = useState(false);
  const report = (message: string) => setError(message);
  async function load() {
    try {
      const [list, status] = await Promise.all([api<Task[]>('/tasks'), api('/status')]);
      setTasks(list);
      setRuntimeVersion(status.runtime.version);
    } catch (e) {
      report((e as Error).message);
    }
  }
  useEffect(() => {
    api('/auth/status')
      .then((result) => setAuthenticated(result.authenticated))
      .catch((e) => report(e.message));
  }, []);
  useEffect(() => {
    if (!authenticated) return;
    void load();
    const source = new EventSource('/api/events');
    source.addEventListener('ready', () => {
      setOnline(true);
      void load();
      setRevision((r) => r + 1);
    });
    source.onmessage = (e) => {
      const event: LiveEvent = JSON.parse(e.data);
      setEvents((prev) => [...prev, event].slice(-1500));
      if (event.message.method === 'home/task') {
        const task = event.message.params?.task as Task;
        setTasks((prev) =>
          [task, ...prev.filter((t) => t.id !== task.id)].sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt),
          ),
        );
      }
      if (
        [
          'home/runtime',
          'home/github',
          'account/updated',
          'account/login/completed',
          'account/rateLimits/updated',
        ].includes(event.message.method || '')
      ) {
        setRevision((r) => r + 1);
        if (
          event.message.method === 'account/login/completed' &&
          event.message.params?.success === false
        )
          report(event.message.params.error || 'ChatGPT sign-in failed');
      }
    };
    source.onerror = () => setOnline(false);
    const timer = setInterval(() => void load(), 20_000);
    return () => {
      source.close();
      clearInterval(timer);
    };
  }, [authenticated]);
  const task = tasks.find((t) => t.id === selected);
  const running = tasks.filter((t) => ['preparing', 'running', 'waiting'].includes(t.state)),
    queued = tasks.filter((t) => t.state === 'queued'),
    completed = tasks.filter((t) => t.state === 'completed'),
    failed = tasks.filter((t) => ['failed', 'interrupted'].includes(t.state));
  if (authenticated === null)
    return (
      <div className="startup">
        <span className="brand">
          CODEX<span>HOME</span>
        </span>
        <p>{error || 'Connecting to your server…'}</p>
      </div>
    );
  if (!authenticated)
    return (
      <div className="login-page">
        <div className="login-brand">
          <span className="brand">
            CODEX<span>HOME</span>
          </span>
          <p>YOUR SERVER. YOUR MISSION CONTROL.</p>
        </div>
        <form
          className="login-panel"
          onSubmit={async (e) => {
            e.preventDefault();
            setLoginBusy(true);
            try {
              await api('/auth/login', 'POST', { password });
              setPassword('');
              setAuthenticated(true);
              setError('');
            } catch (e) {
              report((e as Error).message);
            } finally {
              setLoginBusy(false);
            }
          }}
        >
          <p className="eyebrow">Private access</p>
          <h1>SIGN IN</h1>
          <p className="subtitle">Enter your dashboard password to continue.</p>
          <Field label="Dashboard password">
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </Field>
          {error && <p className="inline-error">{error}</p>}
          <button className="primary" disabled={loginBusy || !password}>
            Enter mission control
            <ArrowRight size={16} />
          </button>
          <p className="helper">First time? Your setup password is in the server’s .env file.</p>
        </form>
        <footer>POWERED BY OFFICIAL OPENAI CODEX</footer>
      </div>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setPage('dashboard')}>
          CODEX<span>HOME</span>
        </button>
        <p className="sidebar-label">Mission control</p>
        <nav>
          <button
            className={page === 'dashboard' ? 'active' : ''}
            onClick={() => {
              setPage('dashboard');
              setSelected(undefined);
            }}
          >
            <LayoutDashboard size={17} />
            Dashboard
          </button>
          <button
            className={page === 'new' ? 'active' : ''}
            onClick={() => {
              setPage('new');
              setSelected(undefined);
            }}
          >
            <Plus size={17} />
            New task
          </button>
          <button
            className={page === 'settings' ? 'active' : ''}
            onClick={() => {
              setPage('settings');
              setSelected(undefined);
            }}
          >
            <SettingsIcon size={17} />
            Settings
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="runtime-indicator">
            <Circle size={8} fill={online ? '#c3e8c1' : '#e0ae62'} stroke="none" />
            <span>{online ? 'Server connected' : 'Reconnecting…'}</span>
          </div>
          <span className="runtime-version">
            Codex {runtimeVersion ? `v${runtimeVersion}` : 'not installed'}
          </span>
          <button
            onClick={async () => {
              try {
                await api('/auth/logout', 'POST');
                setAuthenticated(false);
              } catch (e) {
                report((e as Error).message);
              }
            }}
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <span>
            HOME /{' '}
            {page === 'task' ? 'TASK WORKSPACE' : page === 'new' ? 'NEW TASK' : page.toUpperCase()}
          </span>
          <span className="topbar-note">
            SELF-HOSTED<span className="tiny-cross">＋</span>
          </span>
        </header>
        {error && (
          <div className="error-toast" role="alert">
            <span>{error}</span>
            <button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}>
              <X size={16} />
            </button>
          </div>
        )}
        {page === 'dashboard' && (
          <div className="dashboard">
            <div className="page-heading">
              <div>
                <p className="eyebrow">Systems online / Ready for instruction</p>
                <h1>MISSION CONTROL</h1>
                <p className="subtitle">Give Codex a task. Leave the work to your server.</p>
              </div>
              <button className="primary" onClick={() => setPage('new')}>
                <Plus size={16} />
                New task
              </button>
            </div>
            <div className="metrics">
              {[
                { label: 'Active', count: running.length, note: 'Working on your server' },
                { label: 'Queued', count: queued.length, note: 'Waiting for an execution slot' },
                { label: 'Completed', count: completed.length, note: 'Successful Codex turns' },
                {
                  label: 'Needs attention',
                  count: failed.length,
                  note: 'Failed or interrupted turns',
                },
              ].map((m, i) => (
                <div className="metric" key={m.label}>
                  <div>
                    <span>{m.label}</span>
                    <small>0{i + 1}</small>
                  </div>
                  <strong>{String(m.count).padStart(2, '0')}</strong>
                  <p>{m.note}</p>
                </div>
              ))}
            </div>
            <div className="task-list-heading">
              <h2>Task operations</h2>
              <div className="filters">
                {['all', 'active', 'queued', 'completed', 'attention'].map((f) => (
                  <button
                    key={f}
                    className={filter === f ? 'active' : ''}
                    onClick={() => setFilter(f)}
                  >
                    {f === 'attention' ? 'Needs attention' : f}
                  </button>
                ))}
              </div>
            </div>
            <div className="task-list">
              {tasks
                .filter(
                  (t) =>
                    filter === 'all' ||
                    (filter === 'active' && running.includes(t)) ||
                    (filter === 'queued' && t.state === 'queued') ||
                    (filter === 'completed' && t.state === 'completed') ||
                    (filter === 'attention' && failed.includes(t)),
                )
                .map((t) => (
                  <button
                    className="task-row"
                    key={t.id}
                    onClick={() => {
                      setSelected(t.id);
                      setPage('task');
                    }}
                  >
                    <span className="task-index">{t.id.slice(0, 6)}</span>
                    <div className="task-summary">
                      <strong>{t.name}</strong>
                      <span>{t.repositories.map((r) => r.fullName).join(' · ')}</span>
                    </div>
                    <Status state={t.state} />
                    <span className="task-time">{relativeDate(t.createdAt)}</span>
                    <ArrowUpRight size={16} />
                  </button>
                ))}
              {!tasks.length && (
                <Empty title="Your next mission starts here">
                  Select your repositories, write an instruction, and let Codex work.
                  <br />
                  <button className="primary" onClick={() => setPage('new')}>
                    Create your first task
                    <ArrowRight size={15} />
                  </button>
                </Empty>
              )}
              {tasks.length > 0 &&
                !tasks.some(
                  (t) =>
                    filter === 'all' ||
                    (filter === 'active' && running.includes(t)) ||
                    (filter === 'queued' && t.state === 'queued') ||
                    (filter === 'completed' && t.state === 'completed') ||
                    (filter === 'attention' && failed.includes(t)),
                ) && (
                  <Empty title="No tasks in this view">
                    Choose another filter to see your tasks.
                  </Empty>
                )}
            </div>
            <div className="dashboard-footer">
              <span>OFFICIAL CODEX. COMPLETE REPOSITORIES. PERSISTENT EXECUTION.</span>
              <span className="tiny-cross">＋</span>
            </div>
          </div>
        )}
        {page === 'new' && (
          <NewTask
            onError={report}
            onCreated={(task) => {
              setTasks((prev) => [task, ...prev]);
              setSelected(task.id);
              setPage('task');
            }}
          />
        )}{' '}
        {page === 'settings' && <Settings onError={report} revision={revision} />}
        {page === 'task' && task && (
          <TaskWorkspace
            key={task.id}
            task={task}
            events={events}
            onBack={() => setPage('dashboard')}
            onChanged={() => void load()}
            onError={report}
          />
        )}
      </div>
    </div>
  );
}
