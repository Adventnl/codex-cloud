import { useState } from 'react';
import type { Approval } from '../server/types';
import { api } from './api';
import { Field } from './components';
export function ApprovalCard({
  request,
  taskId,
  onDone,
  onError,
}: {
  request: Approval;
  taskId: string;
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({}),
    [busy, setBusy] = useState(false);
  async function respond(decision?: string) {
    setBusy(true);
    try {
      await api(`/tasks/${taskId}/approval`, 'POST', {
        requestId: request.id,
        decision,
        answers: request.method === 'item/tool/requestUserInput' ? answers : undefined,
      });
      onDone();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const input = request.method === 'item/tool/requestUserInput';
  const rejectDecision =
    request.params.availableDecisions && !request.params.availableDecisions.includes('decline')
      ? 'cancel'
      : 'decline';
  return (
    <div className="approval-card">
      <p className="eyebrow">Codex needs your {input ? 'input' : 'approval'}</p>
      <h3>
        {request.params.reason ||
          (input
            ? 'A question from Codex'
            : request.method.includes('fileChange')
              ? 'Apply file changes'
              : 'Review execution request')}
      </h3>
      {request.params.command && <pre>{request.params.command}</pre>}
      {request.params.cwd && <p className="helper">Directory: {request.params.cwd}</p>}
      {request.params.networkApprovalContext && (
        <p>Network access: {request.params.networkApprovalContext.host}</p>
      )}
      {(request.params.additionalPermissions || request.params.permissions) && (
        <pre>
          {JSON.stringify(
            request.params.additionalPermissions || request.params.permissions,
            null,
            2,
          )}
        </pre>
      )}
      {input ? (
        <>
          {request.params.questions?.map((q: any) => (
            <Field key={q.id} label={q.question}>
              {q.options ? (
                <select
                  value={answers[q.id]?.[0] || ''}
                  onChange={(e) => setAnswers({ ...answers, [q.id]: [e.target.value] })}
                >
                  <option value="">Choose an answer</option>
                  {q.options.map((o: any) => (
                    <option key={o.label} value={o.label}>
                      {o.label} — {o.description}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={q.isSecret ? 'password' : 'text'}
                  value={answers[q.id]?.[0] || ''}
                  onChange={(e) => setAnswers({ ...answers, [q.id]: [e.target.value] })}
                />
              )}
            </Field>
          ))}
          <button
            disabled={busy || !request.params.questions?.every((q: any) => answers[q.id]?.[0])}
            onClick={() => respond()}
          >
            Send answers
          </button>
        </>
      ) : (
        <div className="actions">
          <button disabled={busy} onClick={() => respond(rejectDecision)}>
            {rejectDecision === 'cancel' ? 'Cancel request' : 'Decline'}
          </button>
          <button
            className="primary"
            disabled={
              busy ||
              (request.params.availableDecisions &&
                !request.params.availableDecisions.includes('accept'))
            }
            onClick={() => respond('accept')}
          >
            Approve once
          </button>
        </div>
      )}
    </div>
  );
}
