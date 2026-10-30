import { useEffect, useRef, useState } from 'react';
import { restyle } from '../api.ts';

/** A flat SVG tile's download button: it asks which to take, the app package (what an app takes in) or the SVG alone. */
export function DownloadMenu({ id, name }: { id: string; name: string }) {
  const box = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const shut = () => { if (box.current) box.current.open = false; };

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) shut(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') shut(); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <details ref={box} className="download-menu" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="button small" aria-label={`Download ${name}`}>⤓</summary>
      <div className="download-menu-list">
        <a href={restyle.downloadOne(id, 'package')} download onClick={shut}>
          <b>App package</b>
          <span>The SVG, its fitting data and checks, and the fit sheet: what an app takes in</span>
        </a>
        <a href={restyle.downloadOne(id, 'svg')} download onClick={shut}>
          <b>SVG alone</b>
          <span>The drawing only, without its fitting data</span>
        </a>
      </div>
    </details>
  );
}
