import type { ReactNode } from 'react';

/** One item at a time, with arrows (and the arrow keys, while the carousel has focus) to move between them. */
export function Carousel({ count, index, setIndex, label, children }: { count: number; index: number; setIndex: (i: number) => void; label: string; children: ReactNode }) {
  const go = (i: number) => setIndex(Math.max(0, Math.min(count - 1, i)));
  return (
    <div className="carousel" role="group" aria-roledescription="carousel" aria-label={label}
      onKeyDown={(e) => {
        if (e.target instanceof HTMLInputElement && e.target.type === 'text') return;
        if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1); }
      }}>
      <button type="button" className="carousel-arrow" onClick={() => go(index - 1)} disabled={index <= 0} aria-label="Previous picture">‹</button>
      <div className="carousel-slide" aria-live="polite">
        {children}
        <div className="carousel-count">{index + 1} of {count}</div>
      </div>
      <button type="button" className="carousel-arrow" onClick={() => go(index + 1)} disabled={index >= count - 1} aria-label="Next picture">›</button>
    </div>
  );
}
