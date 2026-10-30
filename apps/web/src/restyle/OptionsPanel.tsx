import { CATALOG, CLOSENESS, OUTPUT_TYPES, QUALITIES, styleFits, typeInfo, wantsStyleReference, type OutputType, type RestyleOptions } from '@telios/shared';
import type { Health } from '../api.ts';

type Set = <K extends keyof RestyleOptions>(key: K, value: RestyleOptions[K]) => void;

function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg full" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

function Toggle({ on, onChange, label, hint, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`toggle ${disabled ? 'disabled' : ''}`} title={hint}>
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <i aria-hidden="true" />
    </label>
  );
}

export function OptionsPanel({ options, set, health, batchAll, setBatchAll, subfolders, setSubfolders }: {
  options: RestyleOptions; set: Set; health: Health | null;
  batchAll: boolean; setBatchAll: (v: boolean) => void; subfolders: boolean; setSubfolders: (v: boolean) => void;
}) {
  const type = typeInfo(options.type);
  const chooseType = (t: OutputType) => {
    set('type', t);
    if (options.style && !styleFits(t, options.style)) set('style', '');
    if (t !== 'illustration') set('medium', '');
  };
  const quality = QUALITIES.find((q) => q.value === type.quality)!;
  return (
    <>
      <section className="panel-section">
        <h2><span className="step">2</span> Output style</h2>
        {(['2D', '3D'] as const).map((group) => (
          <div key={group} className="type-group">
            <div className="label">{group}</div>
            <div className="types">
              {OUTPUT_TYPES.filter((t) => t.group === group).map((t) => (
                <button key={t.value} type="button" className={`type ${t.value === options.type ? 'on' : ''}`} aria-pressed={t.value === options.type} onClick={() => chooseType(t.value)}>
                  <b>{t.label}</b>
                  <span>{t.hint}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        <label className="field">
          <div className="label">Illustration style</div>
          <select value={options.style} onChange={(e) => set('style', e.target.value)}>
            <option value="">None selected</option>
            {CATALOG.artStyles.filter((a) => styleFits(options.type, a.id)).map((a) => (
              <optgroup key={a.id} label={a.label}>
                <option value={a.id}>{a.label}</option>
                {a.substyles.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </optgroup>
            ))}
          </select>
          {!type.styles ? null : <div className="sub">Only the styles that suit {type.label.toLowerCase()} are listed.</div>}
          {wantsStyleReference(options) && health && (
            health.comfy.styleReference && health.styleReferences.includes(options.style)
              ? <div className="sub">Drawn with a reference picture of this style, so its look comes out true.</div>
              : <div className="sub warn">{health.comfy.styleReference ? 'This style has no reference picture on this server yet' : 'ComfyUI here has no style-reference files (USO) yet'}, so it is drawn from words alone.</div>
          )}
        </label>
        {options.type === 'illustration' && (
          <label className="field">
            <div className="label">Medium</div>
            <select value={options.medium} onChange={(e) => set('medium', e.target.value)}>
              <option value="">None selected</option>
              {CATALOG.mediums.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
        )}
        <label className="field">
          <div className="label">Theme</div>
          <select value={options.theme} onChange={(e) => set('theme', e.target.value)}>
            <option value="">None selected</option>
            {CATALOG.themes.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="field">
          <div className="label">Follow the original</div>
          <Seg label="Follow the original" value={options.closeness} onChange={(v) => set('closeness', v)} options={CLOSENESS.map((c) => ({ value: c.value, label: c.label }))} />
          <div className="sub">{CLOSENESS.find((c) => c.value === options.closeness)?.hint}</div>
        </div>
        <div className="field">
          <div className="label">Versions of each picture</div>
          <Seg label="Versions of each picture" value={options.variations} onChange={(v) => set('variations', v)} options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))} />
        </div>
        <label className="field">
          <div className="label">Extra words for the prompt</div>
          <input className="text" value={options.notes} maxLength={300} placeholder="Optional: gold and deep red, thin lines…" onChange={(e) => set('notes', e.target.value)} />
        </label>
      </section>

      <section className="panel-section">
        <h2><span className="step">3</span> Processing options</h2>
        <div className="two">
          <label className="field">
            <div className="label">Output format</div>
            <select value={options.format} onChange={(e) => set('format', e.target.value as RestyleOptions['format'])}>
              <option value="png">PNG{options.background === 'transparent' ? ' (transparent)' : ''}</option>
              <option value="webp">WebP{options.background === 'transparent' ? ' (transparent)' : ''}</option>
              <option value="jpeg">JPEG</option>
            </select>
          </label>
          <label className="field">
            <div className="label">Size</div>
            <select value={options.size} onChange={(e) => set('size', e.target.value as RestyleOptions['size'])}>
              <option value="drawn">As drawn</option>
              <option value="original">Original size</option>
              <option value="2x">2× as drawn</option>
              <option value="4x">4× as drawn</option>
            </select>
          </label>
        </div>
        {type.vector && <div className="sub">{type.label} also comes as an SVG.</div>}
        <label className="field">
          <div className="label">Quality</div>
          <select value={options.quality} onChange={(e) => set('quality', e.target.value as RestyleOptions['quality'])}>
            <option value="auto">Auto ({quality.label.toLowerCase()} for {type.label.toLowerCase()})</option>
            {QUALITIES.map((q) => <option key={q.value} value={q.value}>{q.label}: {q.size} px, {q.steps} steps</option>)}
          </select>
        </label>
        <div className="field">
          <div className="label">Background</div>
          <Seg label="Background" value={options.background} onChange={(v) => set('background', v)} options={[{ value: 'transparent', label: 'Transparent' }, { value: 'white', label: 'White' }, { value: 'black', label: 'Black' }]} />
          {options.background !== 'white' && (options.type === 'illustration' || options.type === 'render3d') && health && !health.comfy.cutout && (
            <div className="sub warn">ComfyUI here has no background-removal model yet, so {options.type === 'render3d' ? '3D' : '2D'} illustrations are drawn on white.</div>
          )}
        </div>
        <Toggle label="Enhance details" on={options.enhance} onChange={(v) => set('enhance', v)} disabled={health ? !health.comfy.upscale : false}
          hint={health && !health.comfy.upscale ? 'ComfyUI has no upscaling model, so enlarging is a plain resize.' : 'Enlarge with an upscaling model, which redraws fine detail, rather than a plain resize.'} />
        <Toggle label="Process every picture" on={batchAll} onChange={setBatchAll} hint="Off: only the pictures you tick." />
      </section>

      <section className="panel-section">
        <h2><span className="step">4</span> Downloads</h2>
        <Toggle label="Organize in subfolders" on={subfolders} onChange={setSubfolders} hint="By type, style and theme, then the folders they came in" />
        <div className="sub">Results stay here until you delete them. Download the ones you tick as a zip.</div>
      </section>
    </>
  );
}
