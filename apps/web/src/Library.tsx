import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type DesignSummary } from './api.ts';
import { KINDS } from '@telios/shared';

const STATUS: Record<string, string> = { ingesting: 'Measuring', reading: 'Reading', failed: 'Failed' };

export function statusOf(d: DesignSummary): { label: string; tone: string } {
  if (d.status !== 'ready') return { label: STATUS[d.status] ?? d.status, tone: d.status === 'failed' ? 'bad' : 'busy' };
  const r = d.lastRun;
  if (!r) return { label: d.reading?.confirmed ? 'Ready' : 'Check the reading', tone: 'todo' };
  if (r.status === 'queued') return { label: 'Queued', tone: 'busy' };
  if (r.status === 'running') return { label: r.mode === 'trace' ? 'Tracing' : r.mode === 'rebuild' ? 'Rebuilding' : r.stage === 'vectorize' ? 'Making layers' : 'Drawing', tone: 'busy' };
  if (r.status === 'done') return { label: r.mode === 'trace' ? 'Traced' : r.mode === 'rebuild' ? 'Rebuilt' : 'Redrawn', tone: 'good' };
  return { label: r.status === 'canceled' ? 'Canceled' : r.status === 'interrupted' ? 'Interrupted' : 'Run failed', tone: 'bad' };
}

export function Library() {
  const [designs, setDesigns] = useState<DesignSummary[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(() => api.designs().then(setDesigns).catch((e) => setErrors([e.message])), []);
  useEffect(() => { load(); }, [load]);
  const working = designs?.some((d) => statusOf(d).tone === 'busy');
  useEffect(() => {
    if (!working) return;
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [working, load]);

  const upload = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    setErrors([]);
    try {
      const res = await api.upload(files);
      setErrors(res.errors);
      await load();
      if (res.designs.length === 1) location.hash = `#/d/${res.designs[0].id}`;
    } catch (e) {
      setErrors([(e as Error).message]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="library">
      <section
        className={`drop ${over ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); upload([...e.dataTransfer.files]); }}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
      >
        <input ref={input} type="file" multiple accept=".png,.jpg,.jpeg,.webp,.tif,.tiff,.pdf,.gif,.bmp" hidden onChange={(e) => upload([...(e.target.files ?? [])])} />
        <div className="drop-title">{busy ? 'Uploading…' : 'Drop images of designs here'}</div>
        <div className="drop-hint">Frames, borders, corners, ornaments, pattern tiles, initials · PNG, JPG, WebP, TIFF or PDF pages · several at once</div>
        <div className="drop-hint">Telios works out what each one is; you confirm it, then it redraws it as new vector art.</div>
      </section>
      {errors.length > 0 && <div className="errors">{errors.map((e) => <p key={e}>{e}</p>)}</div>}

      {designs && designs.length > 0 && (
        <section className="grid">
          {designs.map((d) => {
            const s = statusOf(d);
            const img = d.lastRun?.status === 'done' && d.lastRun.preview ? api.file(d.lastRun.preview) : d.status !== 'ingesting' ? `/files/designs/${d.id}/thumb.png` : '';
            return (
              <a key={d.id} className="card" href={`#/d/${d.id}`}>
                <div className="card-img">{img ? <img src={img} alt="" loading="lazy" /> : <div className="placeholder">Measuring…</div>}</div>
                <div className="card-body">
                  <div className="card-name" title={d.name}>{d.name}</div>
                  <div className="card-meta">
                    <span className={`chip ${s.tone}`}>{s.label}</span>
                    {d.reading && <span className="kind">{KINDS.find((k) => k.value === d.reading!.kind)?.label}</span>}
                  </div>
                </div>
              </a>
            );
          })}
        </section>
      )}
      {designs && designs.length === 0 && <p className="empty">Nothing here yet. Upload a scan of a frame, a border or an ornament to begin.</p>}
    </div>
  );
}
