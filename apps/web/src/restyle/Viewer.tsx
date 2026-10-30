import { useEffect, useState } from 'react';
import { findStyle, findTheme, settingRows, typeInfo, type RestyleResult } from '@telios/shared';
import { api, restyle } from '../api.ts';
import { PromptDialog } from './PromptDialog.tsx';

/** One result large, beside its original: arrows for the next, Space to tick it, Escape to close; under
 * them the settings it was drawn with, and its prompt, which opens in a dialog. */
export function Viewer({ results, index, setIndex, selected, toggle, onClose }: {
  results: RestyleResult[]; index: number; setIndex: (i: number) => void;
  selected: Set<string>; toggle: (id: string) => void; onClose: () => void;
}) {
  const r = results[index];
  const [promptOpen, setPromptOpen] = useState(false);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (promptOpen) return;   // the prompt's dialog has the keys: Escape closes only it
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') setIndex(Math.min(results.length - 1, index + 1));
      else if (e.key === 'ArrowLeft') setIndex(Math.max(0, index - 1));
      else if (e.key === ' ' && r) { e.preventDefault(); toggle(r.id); }
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [index, results.length, r, onClose, setIndex, toggle, promptOpen]);
  if (!r?.files) return null;
  const o = r.options;
  const ground = o.background === 'black' ? 'black' : o.background === 'white' ? 'white' : 'checker';
  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={`${r.inputName}, ${index + 1} of ${results.length}`} onClick={onClose}>
      <div className="viewer-box" onClick={(e) => e.stopPropagation()}>
        <div className="viewer-head">
          <label className="keep">
            <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} /> Keep
          </label>
          <b className="viewer-name">{r.inputName}{o.variations > 1 ? ` · version ${r.variation}` : ''}</b>
          <span className="sub">{[typeInfo(o.type).label, findStyle(o.style)?.label, findTheme(o.theme)?.label].filter(Boolean).join(' · ')}{r.size ? ` · ${r.size[0]} × ${r.size[1]}` : ''}</span>
          <span className="spacer" />
          <span className="sub">{index + 1} of {results.length}</span>
          <button type="button" className="quiet" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {r.warning && <p className="warn-line">{r.warning}</p>}
        <div className="viewer-pair">
          <figure>
            <img src={api.file(r.files.original)} alt="The original" />
            <figcaption>The original</figcaption>
          </figure>
          <figure className={`result ${ground}`}>
            <img src={api.file(r.files.view)} alt="Redrawn" />
            <figcaption>Redrawn</figcaption>
          </figure>
        </div>
        <div className="viewer-foot">
          <button type="button" disabled={index === 0} onClick={() => setIndex(index - 1)}>← Previous</button>
          <span className="downloads-inline">
            Download
            {(['png', 'webp', 'jpeg'] as const).map((f) => <a key={f} href={restyle.downloadOne(r.id, f)} download>{f.toUpperCase()}</a>)}
            {r.files.svg && <a href={restyle.downloadOne(r.id, 'svg')} download>SVG</a>}
          </span>
          <button type="button" disabled={index === results.length - 1} onClick={() => setIndex(index + 1)}>Next →</button>
        </div>
        <section className="viewer-settings" aria-label="Settings used">
          <h3>Settings used</h3>
          <dl className="settings">
            {settingRows(r).map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
          </dl>
          {r.prompt && (
            <button type="button" className="prompt-peek" onClick={() => setPromptOpen(true)} aria-haspopup="dialog">
              <b>What ComfyUI was asked</b>
              <span className="prompt-peek-text">{r.prompt}</span>
              <span className="prompt-peek-more">View full prompt</span>
            </button>
          )}
        </section>
        {promptOpen && r.prompt && <PromptDialog prompt={r.prompt} seed={r.seed} onClose={() => setPromptOpen(false)} />}
      </div>
    </div>
  );
}
