import { useEffect, useRef, useState } from 'react';

/** The whole prompt ComfyUI was sent, in a dialog of its own over the preview: Escape or a click outside
 * closes it, and Copy puts the text on the clipboard. */
export function PromptDialog({ prompt, seed, onClose }: { prompt: string; seed?: number; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => { if (d?.open) d.close(); };
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard not allowed here: the text is selectable */ }
  };

  return (
    <dialog ref={ref} className="prompt-dialog" aria-labelledby="prompt-title" onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="prompt-dialog-body">
        <div className="prompt-dialog-head">
          <h3 id="prompt-title">What ComfyUI was asked</h3>
          <span className="spacer" />
          <button type="button" className="quiet" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <pre className="prompt-text">{prompt}</pre>
        <div className="prompt-dialog-foot">
          <span className="sub">{prompt.length} characters{seed !== undefined ? ` · seed ${seed}` : ''}</span>
          <span className="spacer" />
          <button type="button" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          <button type="button" className="primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </dialog>
  );
}
