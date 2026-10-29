import { useCallback, useEffect, useState } from 'react';
import type { Design, Reading, Run, RunMode } from '@telios/shared';
import { api, type Health } from './api.ts';
import { ReadingPanel } from './ReadingPanel.tsx';
import { RunView } from './RunView.tsx';

const MODE_LABEL: Record<RunMode, string> = { rebuild: 'Rebuild', reillustrate: 'Re-illustration', trace: 'Trace' };

export function DesignPage({ id, health }: { id: string; health: Health | null }) {
  const [design, setDesign] = useState<Design | null>(null);
  const [analysis, setAnalysis] = useState<any>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await api.design(id);
      setDesign(d.design);
      setAnalysis(d.analysis);
      setRuns(d.runs);
      setSelected((s) => s ?? d.runs[d.runs.length - 1]?.id ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => { setSelected(null); load(); }, [id, load]);
  useEffect(() => {
    if (!design || design.status === 'ready' || design.status === 'failed') return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [design, load]);

  if (error) return <p className="errors">{error}</p>;
  if (!design) return <p className="empty">Loading…</p>;

  const start = async (reading: Reading, mode: RunMode, maxRenders: number, note: string) => {
    setError('');
    try {
      await api.confirmReading(design.id, reading);
      const run = await api.startRun(design.id, { mode, maxRenders, note: note || undefined });
      setSelected(run.id);
      await load();
      document.getElementById('run')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const rename = async () => {
    const name = prompt('Name', design.name);
    if (name && name.trim()) { await api.rename(design.id, name.trim()); load(); }
  };
  const remove = async () => {
    if (!confirm(`Delete “${design.name}” and all its runs? This can't be undone.`)) return;
    try { await api.remove(design.id); location.hash = '#/designs'; } catch (e) { setError((e as Error).message); }
  };

  const run = runs.find((r) => r.id === selected) ?? null;
  const busy = runs.some((r) => r.status === 'queued' || r.status === 'running');

  return (
    <div className="design">
      <div className="design-head">
        <a href="#/designs" className="back">← All designs</a>
        <h1 onClick={rename} title="Rename">{design.name}</h1>
        <span className="spacer" />
        <button className="quiet" onClick={remove}>Delete</button>
      </div>

      {design.status !== 'ready' && design.status !== 'failed' && (
        <div className="pending">
          <div className="spinner" />
          {design.status === 'ingesting' ? 'Measuring the design: paper and ink, symmetry, repeats, colors…' : 'Reading the design: what it is, how it repeats, its color rule…'}
        </div>
      )}
      {design.status === 'failed' && <p className="errors">{design.error}</p>}

      <div className="design-top">
        <figure className="original">
          {design.status !== 'ingesting' ? <img src={`/files/designs/${design.id}/crop.png`} onError={(e) => { (e.target as HTMLImageElement).src = `/files/designs/${design.id}/view.png`; }} alt="The original" /> : <div className="placeholder tall">Measuring…</div>}
          <figcaption>The original{design.size ? ` · ${design.size[0]} × ${design.size[1]} px` : ''}{analysis?.leveled ? ` · leveled ${analysis.tilt}°` : ''}</figcaption>
        </figure>
        {design.reading && (
          <ReadingPanel key={design.id + (design.reading.confirmed ? 'c' : 'u')} design={design} analysis={analysis} health={health} busy={busy} onStart={start} />
        )}
      </div>

      {runs.length > 0 && (
        <section className="runs" id="run">
          <div className="run-tabs">
            {runs.map((r, i) => (
              <button key={r.id} className={r.id === selected ? 'on' : ''} onClick={() => setSelected(r.id)}>
                {MODE_LABEL[r.mode]} {i + 1}
                <span className={`dot ${r.status}`} />
              </button>
            ))}
          </div>
          {run && <RunView key={run.id} initial={run} onChange={load} />}
        </section>
      )}
    </div>
  );
}
