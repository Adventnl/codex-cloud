export async function api<T = any>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${url}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `Request failed (${response.status})`);
  return value;
}
export interface RepoOption {
  fullName: string;
  private: boolean;
  description: string;
  defaultBranch: string;
}
export interface Change {
  fullName: string;
  status: string;
  committed: string;
  untracked: string;
  diff: string;
  taskBranch?: string;
  baseBranch: string;
  prUrl?: string;
  prNumber?: number;
}
