import { useCallback, useEffect, useMemo, useState } from 'react';
import { cleanOptions, DEFAULT_OPTIONS, drawnByModel, findStyle, findTheme, typeInfo, type RestyleInput, type RestyleOptions, type RestyleResult } from '@telios/shared';
import { api, restyle, type Health } from '../api.ts';
import { AddImages, ACCEPT } from './AddImages.tsx';
import { OptionsPanel } from './OptionsPanel.tsx';
import { DownloadMenu } from './DownloadMenu.tsx';
import { folderToSave, saveResults } from './approve.ts';
import { BatchProgress, TileProgress } from './Progress.tsx';
import { Viewer } from './Viewer.tsx';

// What this browser last chose: a convenience, so it may be missing (a private window).
const SAVED = 'telios.restyle';
function saved(): { options: RestyleOptions; batchAll: boolean; subfolders: boolean } {
  try {
    const s = JSON.parse(localStorage.getItem(SAVED) ?? '{}');
    return { options: cleanOptions({ ...DEFAULT_OPTIONS, ...s.options }), batchAll: s.batchAll ?? true, subfolders: s.subfolders ?? true };
  } catch {
    return { options: cleanOptions(DEFAULT_OPTIONS), batchAll: true, subfolders: true };
  }
}

// What an upload skipped because the same picture was already there.
const skipped = (names: string[] = []) => (names.length
  ? `Already added, so skipped: ${names.slice(0, 6).join(', ')}${names.length > 6 ? ` and ${names.length - 6} more` : ''}.`
  : '');
const toggled = (set: Set<string>, id: string) => { const n = new Set(set); if (!n.delete(id)) n.add(id); return n; };
const busyResult = (r: RestyleResult) => r.status === 'queued' || r.status === 'running';

function SelectAll({ ids, selected, set, label }: { ids: string[]; selected: Set<string>; set: (s: Set<string>) => void; label: string }) {
  const all = ids.length > 0 && ids.every((id) => selected.has(id));
  return (
    <label className="select-all">
      <input type="checkbox" checked={all} ref={(el) => { if (el) el.indeterminate = !all && ids.some((id) => selected.has(id)); }}
        onChange={() => set(all ? new Set([...selected].filter((id) => !ids.includes(id))) : new Set([...selected, ...ids]))} disabled={!ids.length} />
      {all ? 'Select none' : `Select all ${label}`}
    </label>
  );
}

export function Studio({ health }: { health: Health | null }) {
  const first = useMemo(saved, []);
  const [options, setOptions] = useState(first.options);
  const [batchAll, setBatchAll] = useState(first.batchAll);
  const [subfolders, setSubfolders] = useState(first.subfolders);
  const [inputs, setInputs] = useState<RestyleInput[]>([]);
  const [results, setResults] = useState<RestyleResult[]>([]);
  const [pickedInputs, setPickedInputs] = useState<Set<string>>(new Set());
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState<number | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [viewing, setViewing] = useState<number | null>(null);
  const [over, setOver] = useState(false);
  const [working, setWorking] = useState(false);
  const [skew, setSkew] = useState(0);   // how far the server's clock is ahead of this page's, for the progress bars

  useEffect(() => {
    try { localStorage.setItem(SAVED, JSON.stringify({ options, batchAll, subfolders })); } catch { /* not kept */ }
  }, [options, batchAll, subfolders]);
  const set = useCallback(<K extends keyof RestyleOptions>(key: K, value: RestyleOptions[K]) => setOptions((o) => ({ ...o, [key]: value })), []);

  const load = useCallback(async () => {
    try {
      const s = await restyle.state();
      setInputs(s.inputs);
      setResults(s.results);
      setSkew(s.now - Date.now());
      const exist = new Set(s.results.map((r) => r.id));
      setKept((k) => new Set([...k].filter((id) => exist.has(id))));
      const have = new Set(s.inputs.map((i) => i.id));
      setPickedInputs((p) => new Set([...p].filter((id) => have.has(id))));
    } catch (e) {
      setMessages([(e as Error).message]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  const active = inputs.some((i) => i.status === 'preparing') || results.some(busyResult);
  useEffect(() => {
    const t = setInterval(load, active ? 2000 : 20000);
    addEventListener('focus', load);
    return () => { clearInterval(t); removeEventListener('focus', load); };
  }, [active, load]);

  const upload = useCallback(async (files: File[], paths: string[] | null) => {
    if (!files.length) return;
    setUploading(0);
    setMessages([]);
    setNotice('');
    try {
      const res = await restyle.upload(files, paths, setUploading);
      setMessages(res.errors);
      setNotice(skipped(res.duplicates));
    } catch (e) {
      setMessages([(e as Error).message]);
    } finally {
      setUploading(null);
      load();
    }
  }, [load]);

  // a picture pasted anywhere on the page
  useEffect(() => {
    const on = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea')) return;
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (files.length) { e.preventDefault(); upload(files.map((f, n) => new File([f], f.name === 'image.png' ? `pasted-${Date.now()}-${n + 1}.png` : f.name, { type: f.type })), null); }
    };
    addEventListener('paste', on);
    return () => removeEventListener('paste', on);
  }, [upload]);

  const act = async (fn: () => Promise<unknown>) => {
    setWorking(true);
    setMessages([]);
    setNotice('');
    try {
      const res: any = await fn();
      if (res?.duplicates) setNotice(skipped(res.duplicates));
    } catch (e) { setMessages([(e as Error).message]); } finally { setWorking(false); load(); }
  };

  const ready = inputs.filter((i) => i.status === 'ready');
  const toDraw = batchAll ? ready : ready.filter((i) => pickedInputs.has(i.id));
  const count = toDraw.length * options.variations;
  const start = () => act(async () => {
    await restyle.start(toDraw.map((i) => i.id), options);
    document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  const done = results.filter((r) => r.status === 'done');
  const keptDone = done.filter((r) => kept.has(r.id));
  const running = results.filter(busyResult);
  const failed = results.filter((r) => r.status === 'failed' || r.status === 'canceled');
  // Try again takes the ticked ones among the stopped and failed, or all of them when none is ticked
  const tickedFailed = failed.filter((r) => kept.has(r.id));
  const again = tickedFailed.length ? tickedFailed : failed;
  const download = () => act(async () => {
    const { url } = await restyle.download(keptDone.map((r) => r.id), subfolders);
    location.href = url;
  });
  const removeResults = () => {
    const n = kept.size;
    if (confirm(`Delete ${n} picture${n === 1 ? '' : 's'}? Their files are removed for good.`)) act(() => restyle.deleteResults([...kept]));
  };
  // Approve: the ticked pictures are saved into the For Talari folder (chosen once, in the browser), then taken out of the results
  const approve = () => act(async () => {
    const folder = await folderToSave();
    if (!folder) return;
    const { saved, names, error } = await saveResults(keptDone, folder);
    if (saved.length) await restyle.deleteResults(saved);
    if (error) throw new Error(`${saved.length ? `Saved ${saved.length} to ${folder.name} and took them out of the results. ` : ''}${error}`);
    setNotice(`Saved ${saved.length === 1 ? names[0] : `${saved.length} pictures`} to ${folder.name} and took ${saved.length === 1 ? 'it' : 'them'} out of the results.`);
  });
  const removeInputs = (ids: string[]) => {
    if (ids.length && confirm(`Remove ${ids.length} picture${ids.length === 1 ? '' : 's'} from the inputs? Results made from them stay.`)) act(() => restyle.deleteInputs(ids));
  };

  // what the chosen type draws with must be ready: ComfyUI, or for a flat SVG the model
  const byModel = drawnByModel(options.type);
  const notReady = !health ? '' : byModel
    ? (health.model.ok ? '' : `The model is not ready: ${health.model.error ?? 'set one up in .env'}`)
    : (health.comfy.ready ? '' : `ComfyUI is not ready: ${health.comfy.detail}`);
  const viewable = done;

  return (
    <div className="studio"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
      onDrop={(e) => { e.preventDefault(); setOver(false); upload([...e.dataTransfer.files], null); }}>
      <aside className="options">
        <AddImages onFiles={upload} onDesigns={(ids) => act(() => restyle.fromDesigns(ids))} busy={uploading !== null} />
        <OptionsPanel options={options} set={set} health={health} batchAll={batchAll} setBatchAll={setBatchAll} subfolders={subfolders} setSubfolders={setSubfolders} />
        <div className="start">
          <button type="button" className="primary big" disabled={!count || working || !!notReady} onClick={start}>
            ▶ Start processing ({count})
          </button>
          <div className="sub">
            {notReady ? notReady
              : !ready.length ? 'Add pictures first.'
              : !count ? 'Tick the pictures to redraw, or turn on Process every picture.'
              : `${toDraw.length} picture${toDraw.length === 1 ? '' : 's'} × ${options.variations} version${options.variations === 1 ? '' : 's'}, ${byModel ? 'two at a time' : 'one at a time'}.`}
          </div>
        </div>
      </aside>

      <div className="work">
        {over && <div className="drop-veil">Drop to add these pictures</div>}
        {messages.length > 0 && <div className="errors" role="alert">{messages.map((m) => <p key={m}>{m}</p>)}</div>}
        {notice && <div className="notice" role="status">{notice}</div>}
        {uploading !== null && <div className="pending"><div className="spinner" />Uploading… {Math.round(uploading * 100)}%{uploading > 0.99 ? ' (opening it)' : ''}</div>}

        {!inputs.length ? (
          <label className="drop big-drop">
            <input type="file" multiple accept={ACCEPT} hidden onChange={(e) => { upload([...(e.target.files ?? [])], null); e.target.value = ''; }} />
            <div className="drop-title">Drop pictures, a folder or a zip to get started</div>
            <div className="drop-hint">Clip art, frames, borders, ornaments, icons, anything · PNG, JPEG, WebP, TIFF, SVG, EPS or PDF pages</div>
            <div className="drop-hint">Then choose how they are redrawn: ComfyUI draws clip art, line art, and 2D and 3D illustrations in Talari's styles and themes; a model draws a flat SVG.</div>
          </label>
        ) : (
          <section className="block">
            <div className="block-head">
              <h2>Input images <span className="count">{inputs.length}</span></h2>
              <SelectAll ids={inputs.map((i) => i.id)} selected={pickedInputs} set={setPickedInputs} label="" />
              <span className="spacer" />
              <button type="button" className="small" disabled={!pickedInputs.size || working} onClick={() => removeInputs([...pickedInputs])}>Remove ticked ({pickedInputs.size})</button>
              <button type="button" className="small quiet" disabled={working} onClick={() => removeInputs(inputs.map((i) => i.id))}>Clear all</button>
            </div>
            <div className="tiles inputs">
              {inputs.map((i) => (
                <label key={i.id} className={`tile ${pickedInputs.has(i.id) ? 'on' : ''}`} title={i.subject ?? i.name}>
                  <input type="checkbox" checked={pickedInputs.has(i.id)} onChange={() => setPickedInputs((s) => toggled(s, i.id))} aria-label={`Tick ${i.name}`} />
                  <div className="tile-img">
                    {i.status === 'ready' ? <img src={api.file(`restyle/inputs/${i.id}/thumb.webp`)} alt="" loading="lazy" width={i.size?.[0]} height={i.size?.[1]} />
                      : i.status === 'failed' ? <span className="tile-error">{i.error}</span> : <div className="spinner" />}
                  </div>
                  <div className="tile-name">{i.name}</div>
                  <div className="tile-meta">{i.originalSize ? `${i.originalSize[0]} × ${i.originalSize[1]} · ` : ''}{i.format.toUpperCase()}{i.folder ? ` · ${i.folder}` : ''}</div>
                </label>
              ))}
            </div>
          </section>
        )}

        {results.length > 0 && (
          <section className="block" id="results">
            <div className="block-head">
              <h2>Results <span className="count">{done.length}{running.length ? ` · ${running.length} to go` : ''}</span></h2>
              <SelectAll ids={done.map((r) => r.id)} selected={kept} set={setKept} label="" />
              {failed.length > 0 && <SelectAll ids={failed.map((r) => r.id)} selected={kept} set={setKept} label={`stopped & failed (${failed.length})`} />}
              <span className="spacer" />
              {running.length > 0 && <button type="button" className="small" disabled={working} onClick={() => act(() => restyle.stop(running.map((r) => r.id)))}>Stop the rest</button>}
              {failed.length > 0 && <button type="button" className="small" disabled={working} onClick={() => act(() => restyle.retry(again.map((r) => r.id)))}>{tickedFailed.length ? 'Try ticked again' : 'Try stopped & failed again'} ({again.length})</button>}
              <button type="button" className="small" disabled={!keptDone.length || working} onClick={approve} title="Saves the ticked pictures into your For Talari folder (you choose it the first time), then takes them out of the results">Approve ticked ({keptDone.length})</button>
              <button type="button" className="small" disabled={!kept.size || working} onClick={removeResults}>Delete ticked ({kept.size})</button>
              <button type="button" className="small primary" disabled={!keptDone.length || working} onClick={download}>Download ticked ({keptDone.length})</button>
            </div>
            <BatchProgress results={results} skew={skew} />
            <p className="sub">Tick the ones to keep, then download them; or tick the ones to delete. Space in the large view ticks one.</p>
            <div className="tiles results">
              {results.map((r) => {
                const at = viewable.indexOf(r);
                const ground = r.options.background === 'transparent' ? 'checker' : r.options.background === 'original' ? '' : r.options.background;
                return (
                  <div key={r.id} className={`tile ${kept.has(r.id) ? 'on' : ''} ${r.status}`}>
                    <input type="checkbox" checked={kept.has(r.id)} onChange={() => setKept((s) => toggled(s, r.id))} aria-label={`Tick ${r.inputName}`} />
                    <button type="button" className={`tile-img ${r.files ? ground : ''}`} disabled={!r.files} onClick={() => setViewing(at)} aria-label={`View ${r.inputName}`}>
                      {r.files ? <img src={api.file(r.files.thumb)} alt="" loading="lazy" width={r.size?.[0]} height={r.size?.[1]} />
                        : busyResult(r) ? <TileProgress result={r} skew={skew} />
                        : <span className="tile-error">{r.status === 'canceled' ? 'Stopped' : r.error}</span>}
                    </button>
                    <div className="tile-name">{r.inputName}{r.options.variations > 1 ? ` · v${r.variation}` : ''}</div>
                    <div className="tile-meta">{[typeInfo(r.options.type).label, findStyle(r.options.style)?.label, findTheme(r.options.theme)?.label].filter(Boolean).join(' · ')}</div>
                    {r.drawing?.appReady && <div className={`tile-ready ${r.drawing.appReady.ok ? 'pass' : 'fail'}`} title={r.drawing.appReady.checks.filter((c) => !c.ok).map((c) => `${c.label}: ${c.detail}`).join('\n')}>{r.drawing.appReady.ok ? '✓ App-ready' : `✗ Not app-ready (${r.drawing.appReady.checks.filter((c) => !c.ok).length})`}</div>}
                    {r.warning && <div className="tile-warn" title={r.warning}>{r.warning}</div>}
                    {r.files && (
                      <div className="tile-actions">
                        <button type="button" className="small" onClick={() => setViewing(at)}>View</button>
                        {drawnByModel(r.options.type) && r.drawing
                          ? <DownloadMenu id={r.id} name={r.inputName} />
                          : <a className="button small" href={restyle.downloadOne(r.id, drawnByModel(r.options.type) ? 'svg' : undefined)} download aria-label={`Download ${r.inputName}`}>⤓</a>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {viewing !== null && viewable[viewing] && (
        <Viewer results={viewable} index={viewing} setIndex={setViewing} selected={kept} toggle={(id) => setKept((s) => toggled(s, id))} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}
