/** A viewer's Previous, its tick box and Next, together at the top of the dialog. */
export function ViewerNav({ index, count, setIndex, checked, toggle, label }: {
  index: number; count: number; setIndex: (i: number) => void;
  checked: boolean; toggle: () => void; label: string;
}) {
  return (
    <div className="viewer-nav">
      <button type="button" disabled={index === 0} onClick={() => setIndex(index - 1)}>← Previous</button>
      <label className="keep">
        <input type="checkbox" checked={checked} onChange={toggle} /> {label}
      </label>
      <button type="button" disabled={index === count - 1} onClick={() => setIndex(index + 1)}>Next →</button>
    </div>
  );
}
