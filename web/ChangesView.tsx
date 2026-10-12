import { Empty } from './components';
import type { Change } from './api';
export function ChangesView({ changes }: { changes: Change[] }) {
  if (!changes.length)
    return (
      <Empty title="No prepared repositories">
        Changes appear once the task workspace is ready.
      </Empty>
    );
  return (
    <>
      {changes.map((change) => (
        <section className="diff-section" key={change.fullName}>
          <div className="panel-head">
            <h3>{change.fullName}</h3>
            <code>
              {change.baseBranch} → {change.taskBranch}
            </code>
          </div>
          {change.status && <pre className="git-status">{change.status}</pre>}
          {change.committed && <pre className="git-status">{change.committed}</pre>}
          {change.untracked && (
            <p className="helper">New files (included when publishing): {change.untracked}</p>
          )}
          {change.diff ? (
            <pre className="diff">
              {change.diff.split('\n').map((line, i) => (
                <div
                  key={i}
                  className={
                    line.startsWith('+')
                      ? 'added'
                      : line.startsWith('-')
                        ? 'removed'
                        : line.startsWith('@@')
                          ? 'hunk'
                          : ''
                  }
                >
                  {line || ' '}
                </div>
              ))}
            </pre>
          ) : (
            <p className="helper">No tracked diff against the base commit.</p>
          )}
        </section>
      ))}
    </>
  );
}
