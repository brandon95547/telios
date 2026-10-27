import type { Design, Reading, Run, RunEvent, RunMode } from '@telios/shared';

export type DesignSummary = Design & { lastRun: { id: string; mode: string; status: string; stage: string; preview?: string } | null };
/** model: the provider set up for reading and re-illustrating, if any (Rebuild and Trace need none). */
export interface Health { ok: boolean; effort: string; maxRenders: number; model: { ok: boolean; provider: string; label: string; name: string; error?: string }; python: boolean }

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any).error ?? `${res.status} ${res.statusText}`);
  return body as T;
}

export const api = {
  health: (force = false) => fetch(`/api/health${force ? '?force=1' : ''}`).then((r) => json<Health>(r)),
  designs: () => fetch('/api/designs').then((r) => json<DesignSummary[]>(r)),
  design: (id: string) => fetch(`/api/designs/${id}`).then((r) => json<{ design: Design; analysis: any; runs: Run[] }>(r)),
  upload: (files: File[]) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    return fetch('/api/designs', { method: 'POST', body: fd }).then((r) => json<{ designs: Design[]; errors: string[] }>(r));
  },
  rename: (id: string, name: string) => fetch(`/api/designs/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }).then((r) => json<Design>(r)),
  remove: (id: string) => fetch(`/api/designs/${id}`, { method: 'DELETE' }).then((r) => json<{ ok: true }>(r)),
  confirmReading: (id: string, reading: Reading) => fetch(`/api/designs/${id}/reading`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(reading) }).then((r) => json<Design>(r)),
  startRun: (id: string, body: { mode: RunMode; maxRenders?: number; note?: string }) => fetch(`/api/designs/${id}/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<Run>(r)),
  cancel: (runId: string) => fetch(`/api/runs/${runId}/cancel`, { method: 'POST' }).then((r) => json<{ ok: true }>(r)),
  file: (rel?: string) => (rel ? `/files/${rel}` : ''),
  exportUrl: (runId: string, format: string, opts: { colors?: Record<string, string>; width?: number; background?: string; hidden?: string[] } = {}) => {
    const q = new URLSearchParams({ format });
    if (opts.colors && Object.keys(opts.colors).length) q.set('colors', JSON.stringify(opts.colors));
    if (opts.width) q.set('width', String(opts.width));
    if (opts.background) q.set('background', opts.background);
    if (opts.hidden?.length) q.set('hidden', opts.hidden.join(','));
    return `/api/runs/${runId}/export?${q}`;
  },
  events: (runId: string, onEvent: (e: RunEvent) => void) => {
    const es = new EventSource(`/api/runs/${runId}/events`);
    es.onmessage = (m) => onEvent(JSON.parse(m.data));
    return () => es.close();
  },
};
