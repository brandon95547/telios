import { useState } from 'react';
import { COLOR_MODES, KINDS } from '@telios/shared';
import type { Design, Reading, RunMode } from '@telios/shared';
import type { Health } from './api.ts';

const SYMMETRY: [Reading['symmetry'], string][] = [['four-way', 'Mirrored both ways'], ['mirror-x', 'Left and right mirrored'], ['mirror-y', 'Top and bottom mirrored'], ['rotational', 'Turns about its center'], ['none', 'None']];
const REPEATS: [Reading['repeats']['axis'], string][] = [['edges', 'Along each edge'], ['x', 'Along its length'], ['y', 'Down its height'], ['lattice', 'Across a surface'], ['none', 'Nothing repeats']];

/** The reading, shown for the user to confirm or correct in one step, then the three ways to run it. */
export function ReadingPanel({ design, analysis, health, busy, onStart }: {
  design: Design; analysis: any; health: Health | null; busy: boolean;
  onStart: (r: Reading, mode: RunMode, maxRenders: number, note: string) => void;
}) {
  const [r, setR] = useState<Reading>(design.reading!);
  const [renders, setRenders] = useState(health?.maxRenders ?? 8);
  const [note, setNote] = useState('');
  const [more, setMore] = useState(false);
  const set = <K extends keyof Reading>(k: K, v: Reading[K]) => setR((x) => ({ ...x, [k]: v }));
  const model = health?.model;
  const modelOk = !!model?.ok;

  return (
    <div className="reading">
      <div className="reading-head">
        <h2>What Telios sees</h2>
        <span className={`source ${r.source}`}>{r.source === 'model' ? `Read by ${model?.label ?? 'the model'} · ${Math.round(r.confidence * 100)}% sure` : 'From measurements only'}</span>
      </div>
      <p className="hint">Check it and correct anything that's off: the kind decides how it's rebuilt (a frame from corners and repeating edges, a pattern from one tile, shaded relief in grays).</p>

      <Field label="Kind">
        <div className="seg wrap">
          {KINDS.map((k) => <button key={k.value} title={k.hint} className={r.kind === k.value ? 'on' : ''} onClick={() => set('kind', k.value)}>{k.label}</button>)}
        </div>
      </Field>

      <Field label="Rendering">
        <div className="seg">
          <button className={r.rendering === 'flat' ? 'on' : ''} onClick={() => set('rendering', 'flat')} title="Flat color, line art, woodcut, stencil">Flat</button>
          <button className={r.rendering === 'shaded' ? 'on' : ''} onClick={() => set('rendering', 'shaded')} title="Carved, cast or molded: shaded relief">Shaded relief</button>
        </div>
      </Field>

      <Field label="Color">
        <div className="seg">
          {COLOR_MODES.map((m) => <button key={m.value} title={m.hint} className={r.colorMode === m.value ? 'on' : ''} onClick={() => set('colorMode', m.value)}>{m.label}</button>)}
        </div>
        <div className="sub">{COLOR_MODES.find((m) => m.value === r.colorMode)?.hint}{r.colorReason ? ` · ${r.colorReason}` : ''}</div>
        {r.colorMode === 'one-ink' && (
          <label className="check"><input type="checkbox" checked={r.carvedLines} onChange={(e) => set('carvedLines', e.target.checked)} /> Light lines carved out of the ink (they get their own color)</label>
        )}
      </Field>

      <Field label="Palette">
        <div className="palette">
          {r.palette.map((c, i) => (
            <span key={i} className="swatch-edit">
              <input type="color" value={c.hex} onChange={(e) => set('palette', r.palette.map((p, j) => (j === i ? { ...p, hex: e.target.value } : p)))} />
              <input className="swatch-name" value={c.name} onChange={(e) => set('palette', r.palette.map((p, j) => (j === i ? { ...p, name: e.target.value } : p)))} />
              <button className="x" title="Remove" onClick={() => set('palette', r.palette.filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
          {r.palette.length < 12 && <button className="quiet small" onClick={() => set('palette', [...r.palette, { hex: '#888888', name: 'gray' }])}>+ color</button>}
        </div>
      </Field>

      <div className="two">
        <Field label="Symmetry">
          <select value={r.symmetry} onChange={(e) => set('symmetry', e.target.value as Reading['symmetry'])}>
            {SYMMETRY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="What repeats">
          <select value={r.repeats.axis} onChange={(e) => set('repeats', { ...r.repeats, axis: e.target.value as Reading['repeats']['axis'] })}>
            {REPEATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
      </div>
      {r.repeats.description && <div className="sub">{r.repeats.description}</div>}

      <button className="link" onClick={() => setMore(!more)}>{more ? 'Less' : 'Structure, motifs, what to leave out, the plan'}</button>
      {more && (
        <div className="more">
          {([['structure', 'Structure'], ['motifs', 'Motifs'], ['style', 'Style'], ['leaveOut', 'Leave out'], ['plan', 'Plan']] as const).map(([k, label]) => (
            <Field key={k} label={label}>
              <textarea rows={k === 'plan' ? 3 : 2} value={r[k]} onChange={(e) => set(k, e.target.value)} />
            </Field>
          ))}
        </div>
      )}
      {!more && (r.structure || r.leaveOut) && <div className="sub">{[r.structure, r.leaveOut && `Leave out: ${r.leaveOut}`].filter(Boolean).join(' ')}</div>}

      <Field label="Anything to add (optional)">
        <input className="text" placeholder="For re-illustration, e.g. keep the corners simpler; make the vine denser" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>

      <div className="actions">
        <button className="primary" disabled={busy} title="Clean it up without a model, in seconds: its mirrored halves and repeating units averaged, print damage and specks removed, the repeat measured for fitting" onClick={() => onStart(r, 'rebuild', 0, '')}>
          Confirm and rebuild
        </button>
        <button disabled={busy || !modelOk} title={modelOk ? `Redraw it as new vector art: ${model!.label} plans, draws, compares and refines` : model?.error} onClick={() => onStart(r, 'reillustrate', renders, note)}>
          Re-illustrate{modelOk ? ` with ${model!.label}` : ''}
        </button>
        {modelOk && (
          <label className="renders" title="How many times the model may render and compare before finishing">
            up to <select value={renders} onChange={(e) => setRenders(+e.target.value)}>{[3, 5, 8, 12, 16].map((n) => <option key={n} value={n}>{n}</option>)}</select> renders
          </label>
        )}
        <button disabled={busy} title="Trace the upload into color layers in seconds, as it is: keeps the original's flaws" onClick={() => onStart(r, 'trace', 0, '')}>Trace</button>
      </div>
      {!modelOk && model && <p className={`sub${model.provider === 'none' ? '' : ' warn'}`}>Re-illustration needs a model: {model.error}</p>}
      {busy && <p className="sub">A run is in progress below.</p>}
      {analysis?.window && r.kind !== 'frame' && <p className="sub">Measured a window in the middle: this may be a frame.</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <div className="label">{label}</div>
      {children}
    </div>
  );
}
