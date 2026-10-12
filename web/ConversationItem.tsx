import { Terminal, FileDiff } from 'lucide-react';
export interface Item {
  id: string;
  type: string;
  text?: string;
  content?: { text?: string }[];
  command?: string;
  aggregatedOutput?: string;
  status?: string;
  changes?: { path: string; diff?: string }[];
  summary?: string[];
}
export interface Turn {
  id: string;
  status: string;
  items: Item[];
}
export function ConversationItem({ item }: { item: Item }) {
  if (item.type === 'userMessage')
    return (
      <div className="message user-message">
        <p className="eyebrow">You</p>
        <div>{item.content?.map((c) => c.text).join('\n')}</div>
      </div>
    );
  if (item.type === 'agentMessage' || item.type === 'plan')
    return (
      <div className="message agent-message">
        <p className="eyebrow">{item.type === 'plan' ? 'Plan' : 'Codex'}</p>
        <div className="agent-text">{item.text}</div>
      </div>
    );
  if (item.type === 'commandExecution')
    return (
      <details className="tool-item">
        <summary>
          <Terminal size={14} />
          <code>{item.command}</code>
          <span>{item.status}</span>
        </summary>
        <pre>{item.aggregatedOutput || 'No output yet.'}</pre>
      </details>
    );
  if (item.type === 'fileChange')
    return (
      <details className="tool-item">
        <summary>
          <FileDiff size={14} />
          File changes<span>{item.status}</span>
        </summary>
        <pre>{item.changes?.map((c) => `${c.path}\n${c.diff || ''}`).join('\n')}</pre>
      </details>
    );
  if (item.type === 'reasoning')
    return item.summary?.length ? (
      <details className="tool-item">
        <summary>Reasoning summary</summary>
        <pre>{item.summary.join('\n')}</pre>
      </details>
    ) : null;
  return (
    <details className="tool-item">
      <summary>
        {item.type}
        <span>{item.status}</span>
      </summary>
      <pre>{JSON.stringify(item, null, 2)}</pre>
    </details>
  );
}
