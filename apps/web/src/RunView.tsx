import { useEffect, useMemo, useState } from 'react';
import type { Iteration, Run, RunEvent } from '@telios/shared';
import { api } from './api.ts';
import { Review } from './Review.tsx';

const STAGES: [string, string][] = [['plan', 'Study and plan'], ['draw', 'Draw'], ['critique', 'Compare and refine'], ['vectorize', 'Layers'], ['done', 'Done']];

interface Live {
  run: Run;
  message: string;
  notes: { text: string; at: number }[];
}

/** One run, live: its stage, the model's notes and every iteration as it renders; then the review. */
export function RunView({ initial, onChange }: { initial: Run; onChange: () => void }) {
  // the events replay the whole run from the start, iterations included
  const [live, setLive] = useState<Live>({ run: { ...initial, iterations: [] }, message: '', notes: [] });
  const [big, setBig] = useState<string | null>(null);

  useEffect(() => {
    const seen = new Set<number>();
    return api.events(initial.id, (e: RunEvent) => {
      setLive((l) => reduce(l, e, seen));
      if (e.type === 'status' && (e.status === 'done' || e.status === 'failed' || e.status === 'canceled')) onChange();
    });
  }, [initial.id, onChange]);

  const { run, message, notes } = live;
  const going = run.status === 'queued' || run.status === 'running';
  const stageIndex = STAGES.findIndex(([s]) => s === run.stage);
  const timeline = useMemo(() => merge(notes, run.iterations), [notes, run.iterations]);

  return (
    <div className="run">
      <div className="run-head">
        {run.mode === 'reillustrate' && (
          <ol className="stages">
            {STAGES.map(([s, label], i) => (
              <li key={s} className={i < stageIndex || run.status === 'done' ? 'past' : i === stageIndex && going ? 'now' : ''}>{label}</li>
            ))}
          </ol>
        )}
        <div className="run-status">
          {going && <div className="spinner" />}
          <span>{run.status === 'done' ? 'Done' : run.status === 'failed' ? `Failed: ${run.error ?? ''}` : run.status === 'canceled' ? 'Canceled' : run.status === 'interrupted' ? run.error : message || (run.status === 'queued' ? 'Queued' : 'Working…')}</span>
          <span className="spacer" />
          {run.mode === 'reillustrate' && <span className="cost" title={`${run.usage.inputTokens.toLocaleString()} input, ${run.usage.cacheReadTokens.toLocaleString()} cached, ${run.usage.outputTokens.toLocaleString()} output tokens`}>${run.usage.costUsd.toFixed(2)} · {run.options.model} · {run.iterations.filter((i) => i.ok).length}/{run.options.maxRenders} renders</span>}
          {going && <button className="quiet" onClick={() => api.cancel(run.id)}>Cancel</button>}
        </div>
      </div>

      {run.result && <Review run={run} />}

      {run.mode !== 'trace' && timeline.length > 0 && (
        <details className="process" open={!run.result}>
          <summary>{run.mode === 'rebuild' ? 'How it was rebuilt' : `How it was drawn: ${run.iterations.filter((i) => i.ok).length} renders${run.result ? '' : ' so far'}`}</summary>
          <div className="timeline">
            {timeline.map((item, k) => item.kind === 'note' ? (
              <p key={k} className="note">{item.text}</p>
            ) : (
              <IterationCard key={k} it={item.it} onOpen={setBig} />
            ))}
          </div>
        </details>
      )}

      {big && <div className="lightbox" onClick={() => setBig(null)}><img src={big} alt="" /></div>}
    </div>
  );
}

function IterationCard({ it, onOpen }: { it: Iteration; onOpen: (src: string) => void }) {
  if (!it.ok) return <div className="iteration failed"><div className="it-n">{it.n}</div><div><b>Didn't render</b>{it.notes && ` · ${it.notes}`}<pre>{it.error}</pre></div></div>;
  const imgs = [it.files.compare, it.files.unitcheck, it.files.fitcheck].filter(Boolean) as string[];
  return (
    <div className="iteration">
      <div className="it-n">{it.n}</div>
      <div className="it-body">
        {it.notes && <p>{it.notes}</p>}
        <div className="it-imgs">
          {imgs.map((f, i) => <img key={f} className={i === 0 ? 'main' : ''} src={api.file(f)} alt="" loading="lazy" onClick={() => onOpen(api.file(f))} />)}
        </div>
        {it.checks && (
          <div className="it-checks">
            <span>{it.checks.size[0]} × {it.checks.size[1]}</span>
            <span className="mini-pal">{it.checks.palette.map((p) => <i key={p.hex} style={{ background: p.hex }} title={`${p.name} ${p.hex}`} />)}</span>
            {it.checks.symmetry && <span>symmetry {it.checks.symmetry.lr} / {it.checks.symmetry.tb}</span>}
            {it.checks.warnings.map((w) => <span key={w} className="warn">{w}</span>)}
          </div>
        )}
      </div>
    </div>
  );
}

function reduce(l: Live, e: RunEvent, seen: Set<number>): Live {
  const run = { ...l.run };
  switch (e.type) {
    case 'status': run.status = e.status; run.stage = e.stage; return { ...l, run, message: e.message ?? l.message };
    case 'note': return { ...l, notes: [...l.notes, { text: e.text, at: run.iterations.length }] };
    case 'progress': return { ...l, message: e.message };
    case 'iteration':
      if (seen.has(e.iteration.n)) return l;
      seen.add(e.iteration.n);
      run.iterations = [...run.iterations.filter((i) => i.n !== e.iteration.n), e.iteration];
      return { ...l, run };
    case 'usage': run.usage = e.usage; return { ...l, run };
    case 'result': run.result = e.result; return { ...l, run };
    case 'error': run.error = e.message; return { ...l, run };
  }
  return l;
}

type Item = { kind: 'note'; text: string } | { kind: 'it'; it: Iteration };
function merge(notes: Live['notes'], its: Iteration[]): Item[] {
  const out: Item[] = [];
  const sorted = [...its].sort((a, b) => a.n - b.n);
  for (let i = 0; i <= sorted.length; i++) {
    for (const n of notes) if (n.at === i) out.push({ kind: 'note', text: n.text });
    if (sorted[i]) out.push({ kind: 'it', it: sorted[i] });
  }
  return out;
}
