import { useEffect, useRef, useState } from 'react';
import { api, type DesignSummary } from '../api.ts';

export const ACCEPT = '.png,.jpg,.jpeg,.webp,.tif,.tiff,.gif,.bmp,.svg,.eps,.ps,.pdf,.zip';
const TABS = [['files', 'Files'], ['folder', 'Folder'], ['paste', 'Paste'], ['library', 'Library']] as const;
type Tab = (typeof TABS)[number][0];

/** Step 1: pictures in, as files (or zips), a folder, pasted, or from Telios's own library. */
export function AddImages({ onFiles, onDesigns, busy }: { onFiles: (files: File[], paths: string[] | null) => void; onDesigns: (ids: string[]) => void; busy: boolean }) {
  const [tab, setTab] = useState<Tab>('files');
  const [over, setOver] = useState(false);
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const [designs, setDesigns] = useState<DesignSummary[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => { if (tab === 'library' && !designs) api.designs().then(setDesigns).catch(() => setDesigns([])); }, [tab, designs]);
  useEffect(() => { folder.current?.setAttribute('webkitdirectory', ''); }, [tab]);

  const fromFolder = (list: FileList | null) => {
    const all = [...(list ?? [])].filter((f) => !f.name.startsWith('.'));
    onFiles(all, all.map((f) => (f as any).webkitRelativePath || f.name));
  };

  return (
    <section className="panel-section">
      <h2><span className="step">1</span> Add images</h2>
      <div className="tabs" role="tablist">
        {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      {tab === 'files' && (
        <div className={`mini-drop ${over ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); onFiles([...e.dataTransfer.files], null); }}>
          <input ref={files} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { onFiles([...(e.target.files ?? [])], null); e.target.value = ''; }} />
          <p>One picture, several, or a zip of them</p>
          <p className="sub">PNG, JPEG, WebP, TIFF, SVG, EPS or PDF pages</p>
          <button type="button" disabled={busy} onClick={() => files.current?.click()}>Choose files</button>
        </div>
      )}
      {tab === 'folder' && (
        <div className="mini-drop">
          <input ref={folder} type="file" multiple hidden onChange={(e) => { fromFolder(e.target.files); e.target.value = ''; }} />
          <p>A folder and the folders inside it</p>
          <p className="sub">Their names are kept, for the download's subfolders</p>
          <button type="button" disabled={busy} onClick={() => folder.current?.click()}>Choose folder</button>
        </div>
      )}
      {tab === 'paste' && (
        <div className="mini-drop">
          <p>Copy a picture, then press <kbd>{navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl'}</kbd> <kbd>V</kbd> anywhere on this page.</p>
        </div>
      )}
      {tab === 'library' && (
        <div className="library-pick">
          {!designs && <p className="sub">Loading…</p>}
          {designs?.length === 0 && <p className="sub">Nothing in the vector redraw's library yet.</p>}
          <div className="pick-grid">
            {designs?.map((d) => (
              <label key={d.id} className={`pick ${picked.has(d.id) ? 'on' : ''}`} title={d.name}>
                <input type="checkbox" checked={picked.has(d.id)} onChange={() => setPicked((s) => { const n = new Set(s); if (!n.delete(d.id)) n.add(d.id); return n; })} />
                <img src={`/files/designs/${d.id}/thumb.png`} alt="" loading="lazy" />
              </label>
            ))}
          </div>
          {!!designs?.length && <button type="button" disabled={!picked.size || busy} onClick={() => { onDesigns([...picked]); setPicked(new Set()); }}>Add {picked.size || ''} to the pictures</button>}
        </div>
      )}
    </section>
  );
}
