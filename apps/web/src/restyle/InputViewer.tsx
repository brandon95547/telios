import { useCallback, useEffect, useRef, useState } from 'react';
import type { RestyleInput } from '@telios/shared';
import { api } from '../api.ts';
import { clampZoom, drawnSize, fitScale, stepZoom, zoomLabel } from './zoom.ts';

/** One input picture large: the picture as it was prepared (at most 2048 pixels across), in a window it scrolls in, with zoom out, zoom in and
 * fit; arrows for the next, Space to tick it, Escape to close. Dragging a zoomed picture moves it. */
export function InputViewer({ inputs, index, setIndex, selected, toggle, onClose }: {
  inputs: RestyleInput[]; index: number; setIndex: (i: number) => void;
  selected: Set<string>; toggle: (id: string) => void; onClose: () => void;
}) {
  const input = inputs[index];
  const stage = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<[number, number] | null>(null);
  const [box, setBox] = useState<[number, number]>([0, 0]);
  const [zoom, setZoom] = useState(1);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  // the window's size, so "fit" follows it
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setBox([el.clientWidth - 24, el.clientHeight - 24]);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // each picture starts fitted
  useEffect(() => { setNatural(null); setZoom(1); }, [input?.id]);

  const fit = natural ? fitScale(natural, box) : 1;
  const zoomIn = useCallback(() => setZoom((z) => stepZoom(z, 1, fit)), [fit]);
  const zoomOut = useCallback(() => setZoom((z) => stepZoom(z, -1, fit)), [fit]);
  const reset = useCallback(() => setZoom(1), []);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') setIndex(Math.min(inputs.length - 1, index + 1));
      else if (e.key === 'ArrowLeft') setIndex(Math.max(0, index - 1));
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomOut(); }
      else if (e.key === '0') { e.preventDefault(); reset(); }
      else if (e.key === ' ' && input) { e.preventDefault(); toggle(input.id); }
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [index, inputs.length, input, onClose, setIndex, toggle, zoomIn, zoomOut, reset]);

  // ctrl (or ⌘) and the wheel zoom, as a browser does; the wheel alone scrolls the picture
  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom((z) => stepZoom(z, e.deltaY < 0 ? 1 : -1, fit));
  };
  const onPointerDown = (e: React.PointerEvent) => {
    const el = stage.current;
    if (!el || e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    el.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const el = stage.current;
    if (!el || !drag.current) return;
    el.scrollLeft = drag.current.left - (e.clientX - drag.current.x);
    el.scrollTop = drag.current.top - (e.clientY - drag.current.y);
  };
  const onPointerUp = () => { drag.current = null; };

  if (!input) return null;
  const size = natural ? drawnSize(natural, fit, clampZoom(zoom, fit)) : null;
  const zoomed = zoom > 1.001;
  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={`${input.name}, ${index + 1} of ${inputs.length}`} onClick={onClose}>
      <div className="viewer-box input-viewer" onClick={(e) => e.stopPropagation()}>
        <div className="viewer-head">
          <label className="keep">
            <input type="checkbox" checked={selected.has(input.id)} onChange={() => toggle(input.id)} /> Tick
          </label>
          <b className="viewer-name">{input.name}</b>
          <span className="sub">{input.originalSize ? `${input.originalSize[0]} × ${input.originalSize[1]} · ` : ''}{input.format.toUpperCase()}{input.folder ? ` · ${input.folder}` : ''}</span>
          <span className="spacer" />
          <div className="zoom-bar" role="group" aria-label="Zoom">
            <button type="button" className="small" onClick={zoomOut} aria-label="Zoom out" title="Zoom out (−)">−</button>
            <button type="button" className="small zoom-level" onClick={reset} title="Fit the picture in the window (0)">{natural ? zoomLabel(fit, zoom) : '…'}</button>
            <button type="button" className="small" onClick={zoomIn} aria-label="Zoom in" title="Zoom in (+)">+</button>
          </div>
          <span className="sub">{index + 1} of {inputs.length}</span>
          <button type="button" className="quiet" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div ref={stage} className={`input-stage${zoomed ? ' is-zoomed' : ''}`} onWheel={onWheel}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          <img key={input.id} src={api.file(`restyle/inputs/${input.id}/source.png`)} alt={input.name} draggable={false}
            width={size?.[0]} height={size?.[1]}
            onLoad={(e) => setNatural([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])} />
        </div>
        <div className="viewer-foot">
          <button type="button" disabled={index === 0} onClick={() => setIndex(index - 1)}>← Previous</button>
          <span className="sub">+ and − zoom, 0 fits, Space ticks, Esc closes</span>
          <button type="button" disabled={index === inputs.length - 1} onClick={() => setIndex(index + 1)}>Next →</button>
        </div>
      </div>
    </div>
  );
}
