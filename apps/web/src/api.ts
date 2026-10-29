import type { Design, Reading, RestyleInput, RestyleOptions, RestyleResult, Run, RunEvent, RunMode } from '@telios/shared';

export type DesignSummary = Design & { lastRun: { id: string; mode: string; status: string; stage: string; preview?: string } | null };
/** model: the provider set up for reading and re-illustrating, if any (Rebuild and Trace need none). */
export interface Health {
  ok: boolean; effort: string; maxRenders: number;
  model: { ok: boolean; provider: string; label: string; name: string; error?: string };
  /** The ComfyUI Restyle draws with: through a Phansora API (api) or Telios's own (local). */
  comfy: { via: 'api' | 'local'; ready: boolean; detail: string; model: string; upscale: boolean; cutout: boolean };
  python: boolean;
}
export interface AuthState { required: boolean; setup: boolean; signedIn: boolean; name: string | null }

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  // signed out (the session ended): the app shows the sign-in again
  if (res.status === 401 && !res.url.includes('/api/auth')) dispatchEvent(new Event('telios:signed-out'));
  if (!res.ok) throw new Error((body as any).error ?? `${res.status} ${res.statusText}`);
  return body as T;
}
const post = <T,>(url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<T>(r));

/** Files sent with the upload's progress (0 to 1) as it goes; a zip of art can be large. */
function send<T>(url: string, form: FormData, onProgress?: (done: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let body: any = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status === 401) dispatchEvent(new Event('telios:signed-out'));
      if (xhr.status >= 400) reject(new Error(body.error ?? (body.errors?.join(' ') || `${xhr.status} ${xhr.statusText}`)));
      else resolve(body);
    };
    xhr.onerror = () => reject(new Error('The upload did not go through.'));
    xhr.send(form);
  });
}

export const auth = {
  state: () => fetch('/api/auth').then((r) => json<AuthState>(r)),
  setup: (code: string, name: string, password: string) => post<{ ok: true }>('/api/auth/setup', { code, name, password }),
  login: (name: string, password: string) => post<{ ok: true }>('/api/auth/login', { name, password }),
  logout: () => post<{ ok: true }>('/api/auth/logout', {}),
};

export const restyle = {
  state: () => fetch('/api/restyle').then((r) => json<{ inputs: RestyleInput[]; results: RestyleResult[] }>(r)),
  upload: (files: File[], paths: string[] | null, onProgress?: (done: number) => void) => {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    if (paths) form.append('paths', JSON.stringify(paths));
    return send<{ inputs: RestyleInput[]; errors: string[] }>('/api/restyle/inputs', form, onProgress);
  },
  fromDesigns: (ids: string[]) => post<{ inputs: RestyleInput[]; errors: string[] }>('/api/restyle/inputs/from-designs', { ids }),
  deleteInputs: (ids: string[]) => post<{ deleted: number }>('/api/restyle/inputs/delete', { ids }),
  start: (inputIds: string[], options: RestyleOptions) => post<{ results: RestyleResult[] }>('/api/restyle/results', { inputIds, options }),
  stop: (ids: string[]) => post<{ stopped: number }>('/api/restyle/results/stop', { ids }),
  retry: (ids: string[]) => post<{ queued: number }>('/api/restyle/results/retry', { ids }),
  deleteResults: (ids: string[]) => post<{ deleted: number }>('/api/restyle/results/delete', { ids }),
  download: (ids: string[], subfolders: boolean) => post<{ url: string; files: number }>('/api/restyle/download', { ids, subfolders }),
  downloadOne: (id: string, format?: string) => `/api/restyle/results/${id}/download${format ? `?format=${format}` : ''}`,
};

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
