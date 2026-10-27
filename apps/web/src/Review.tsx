import { useEffect, useMemo, useState } from 'react';
import { borderCells, composeCells, frameCells, MATERIALS, materialColor, recolor, tileSvg } from '@telios/shared';
import type { Run } from '@telios/shared';
import { api } from './api.ts';

const GROUNDS: [string, string][] = [['#ffffff', 'White'], ['#f1e9d8', 'Ivory'], ['#2f3a3a', 'Slate'], ['checker', 'None']];
const PAGES: [string, number, number][] = [['Portrait 6 × 9', 6, 9], ['Square 8.5 × 8.5', 8.5, 8.5], ['Landscape 11 × 8.5', 11, 8.5], ['Pocket 4.25 × 6.87', 4.25, 6.87], ['Large 9 × 12', 9, 12]];

function useText(url: string) {
  const [text, setText] = useState('');
  useEffect(() => { let on = true; fetch(url).then((r) => r.text()).then((t) => on && setText(t)); return () => { on = false; }; }, [url]);
  return text;
}
function useBlobUrl(svg: string) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!svg) return;
    const u = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [svg]);
  return url;
}
const hideLayers = (svg: string, hidden: Set<string>) => [...hidden].reduce((s, id) => s.replace(new RegExp(`<g id="${id}"[^>]*>[\\s\\S]*?</g>`), ''), svg);

/** The finished piece: beside the original, its layers and colors, other page sizes, downloads. */
export function Review({ run }: { run: Run }) {
  const r = run.result!;
  const layeredText = useText(api.file(r.files.layered));
  const drawingText = useText(api.file(r.files.drawing));
  const [colors, setColors] = useState<Record<string, string>>({});
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [ground, setGround] = useState('#ffffff');
  const [material, setMaterial] = useState('');
  const [png, setPng] = useState(2400);
  const [pngGround, setPngGround] = useState(false);

  const shown = useMemo(() => (layeredText ? hideLayers(recolor(layeredText, colors), hidden) : ''), [layeredText, colors, hidden]);
  const shownUrl = useBlobUrl(shown);
  const art = useMemo(() => (hidden.size ? shown : drawingText ? recolor(drawingText, colors) : ''), [drawingText, colors, hidden, shown]);

  const applyMaterial = (id: string) => {
    setMaterial(id);
    setColors(id ? Object.fromEntries(r.layers.map((l) => [l.color, materialColor(l.color, id)])) : {});
  };
  const opts = { colors, hidden: [...hidden] };
  const layout = r.layout;

  return (
    <div className="review">
      <div className="compare-pair" style={{ ['--ground' as any]: ground === 'checker' ? undefined : ground }}>
        <figure>
          <img src={`/files/designs/${run.designId}/crop.png`} alt="The original" />
          <figcaption>Original</figcaption>
        </figure>
        <figure className={`result ${ground === 'checker' ? 'checker' : ''}`}>
          {shownUrl ? <img src={shownUrl} alt="The redrawn piece" /> : <div className="placeholder tall">Loading…</div>}
          <figcaption>{run.mode === 'trace' ? 'Traced' : run.mode === 'rebuild' ? 'Rebuilt' : 'Redrawn'} · {r.layers.length} layer{r.layers.length === 1 ? '' : 's'} · {Math.round(r.size[0])} × {Math.round(r.size[1])}</figcaption>
        </figure>
      </div>
      {r.summary && <p className="summary">{r.summary}</p>}

      <div className="review-tools">
        <section>
          <h3>Layers</h3>
          <ul className="layers">
            {r.layers.map((l) => (
              <li key={l.id} className={hidden.has(l.id) ? 'off' : ''}>
                <input type="checkbox" checked={!hidden.has(l.id)} onChange={() => setHidden((h) => { const n = new Set(h); n.has(l.id) ? n.delete(l.id) : n.add(l.id); return n; })} title="Show or hide" />
                <input type="color" value={colors[l.color] ?? l.color} onChange={(e) => { setMaterial(''); setColors((c) => ({ ...c, [l.color]: e.target.value })); }} />
                <span className="layer-name">{l.name}</span>
                <span className="layer-hex">{colors[l.color] ?? l.color}</span>
              </li>
            ))}
          </ul>
          <div className="row">
            <button className="quiet small" onClick={() => { setColors({}); setMaterial(''); setHidden(new Set()); }}>Reset colors</button>
          </div>
          {r.colorMode === 'neutral' && (
            <>
              <h4>Material looks</h4>
              <p className="sub">A neutral base takes the material you choose: each gray is mapped by its lightness.</p>
              <div className="seg wrap">
                <button className={!material ? 'on' : ''} onClick={() => applyMaterial('')}>Grays</button>
                {MATERIALS.map((m) => <button key={m.id} className={material === m.id ? 'on' : ''} onClick={() => applyMaterial(m.id)}>{m.label}</button>)}
              </div>
            </>
          )}
          <h4>Background</h4>
          <div className="seg">
            {GROUNDS.map(([g, label]) => <button key={g} className={ground === g ? 'on' : ''} onClick={() => setGround(g)}>{label}</button>)}
          </div>
        </section>

        <section>
          <h3>Download</h3>
          <div className="downloads">
            <a className="dl" href={api.exportUrl(run.id, 'svg', opts)}><b>SVG</b><span>{run.mode === 'trace' ? 'the traced piece' : run.mode === 'rebuild' ? 'the rebuilt piece, clean vectors' : 'the drawing itself, clean vectors'}</span></a>
            <a className="dl" href={api.exportUrl(run.id, 'layered', opts)}><b>Layered SVG</b><span>one layer per color (Illustrator, Inkscape)</span></a>
            <a className="dl" href={api.exportUrl(run.id, 'pdf', opts)}><b>PDF</b><span>vector, one page</span></a>
            <div className="dl">
              <a href={api.exportUrl(run.id, 'png', { ...opts, width: png, background: pngGround && ground !== 'checker' ? ground : undefined })}><b>PNG</b></a>
              <span><input type="number" min={100} max={10000} step={100} value={png} onChange={(e) => setPng(+e.target.value)} /> px wide · <label><input type="checkbox" checked={pngGround} onChange={(e) => setPngGround(e.target.checked)} /> on the background</label></span>
            </div>
            {r.files.layout && <a className="dl" href={api.exportUrl(run.id, 'layout')}><b>Fitting data</b><span>JSON: slice, keep, repeat</span></a>}
          </div>
          {(hidden.size > 0 || Object.keys(colors).length > 0) && <p className="sub">Downloads use your colors{hidden.size ? ' and leave out hidden layers' : ''}.</p>}
        </section>
      </div>

      {layout && art && (layout.form === 'frame' || layout.form === 'border' || layout.form === 'tile') && <FitPreview art={art} layout={layout} />}
    </div>
  );
}

function FitPreview({ art, layout }: { art: string; layout: NonNullable<Run['result']>['layout'] & {} }) {
  const shots = useMemo(() => {
    const size = layout.size;
    if (layout.form === 'frame') return PAGES.map(([label, w, h]) => { const { T, cells } = frameCells(layout, w, h); return { label, svg: composeCells(art, size, T, cells, 'fp') }; });
    if (layout.form === 'border') return [1, 1.6, 2.6].map((k) => { const { T, cells } = borderCells(layout, size[0] * k); return { label: `${k}× its length`, svg: composeCells(art, size, T, cells, 'fp') }; });
    return [{ label: 'Tiled 4 × 3', svg: tileSvg(art, size, 4, 3, layout.lattice ?? 'grid', 'fp') }];
  }, [art, layout]);
  return (
    <section className="fit">
      <h3>{layout.form === 'frame' ? 'On other page sizes' : layout.form === 'border' ? 'At other lengths' : 'As a surface'}</h3>
      <p className="sub">{layout.form === 'frame' ? 'Fitted the way an app would: corners and middles whole, edges filled with whole repeating units, never stretched or turned.' : layout.form === 'border' ? 'Whole units repeated to the length, end caps kept.' : 'The tile repeated on its lattice: no seam should show.'}</p>
      <div className={`fit-row ${layout.form}`}>
        {shots.map((s) => <FitShot key={s.label} {...s} />)}
      </div>
    </section>
  );
}

function FitShot({ label, svg }: { label: string; svg: string }) {
  const url = useBlobUrl(svg);
  return <figure>{url && <img src={url} alt={label} />}<figcaption>{label}</figcaption></figure>;
}
