import { CATALOG, CLOSENESS, OUTPUT_TYPES, PICTURE_LED_TYPES, QUALITIES, CLEANUPS, RATIOS, TARGETS, TRACE_TARGETS, REMIX_TARGET, drawnByModel, findStyle, styleChoices, styleFits, tracedOnly, cutoutOnly, workerOnly, typeInfo, wantsStyleReference, type OutputType, type RestyleOptions } from '@telios/shared';
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
  const byModel = drawnByModel(options);
  const traced = tracedOnly(options);
  const cutout = cutoutOnly(options);
  const worker = workerOnly(options);   // the worker does it all: no redraw, no theme, one version
  // what is redrawn by ComfyUI (the rest is drawn by a model or only traced or cut out)
  const redraw = !byModel && !worker;
  const pictureLed = PICTURE_LED_TYPES.includes(options.type);
  const isTrace = options.type === 'trace';   // a trace's targets include Remix, which a model draws
  const chooseType = (t: OutputType) => {
    const next = { type: t, madeFor: t === 'vector' ? (options.type === 'vector' ? options.madeFor : 'auto') : t === 'trace' ? 'object' : 'auto' } as const;
    set('type', t);
    if (options.style && !styleFits(t, options.style)) set('style', '');
    if (!PICTURE_LED_TYPES.includes(t)) set('rotateStyles', false);
    if (drawnByModel(next) || workerOnly(next)) set('theme', '');
    if (workerOnly(next)) set('variations', 1);
    if (cutoutOnly(next)) { set('background', 'transparent'); set('format', 'webp'); }
    else if (cutoutOnly(options) && options.format !== 'png') set('format', 'png');
    set('madeFor', next.madeFor);
    if (!PICTURE_LED_TYPES.includes(t)) {
      set('whole', false);
      if (options.background === 'original') set('background', 'transparent');   // a flat SVG has no ground to keep
    }
  };
  // Draw it whole has the model describe the whole figure, which is what is drawn
  const noWhole = health && !health.model.ok ? `Draw it whole needs the model to describe the figure: ${health.model.error ?? 'set one up in .env'}` : '';
  const quality = QUALITIES.find((q) => q.value === type.quality)!;
  return (
    <>
      <section className="panel-section">
        <h2><span className="step">2</span> Output style</h2>
        <label className="field">
          <div className="label">Output type</div>
          <select value={options.type} onChange={(e) => chooseType(e.target.value as OutputType)}>
            {OUTPUT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <div className="sub">{type.hint}</div>
        </label>
        {byModel && (
          <div className="sub">
            {health && !health.model.ok
              ? <span className="warn">{health.model.provider === 'none' ? 'No model is set up' : `${health.model.label} is not answering`}: a flat SVG is drawn by a model, not ComfyUI. {health.model.error}</span>
              : <>Drawn as new vector art by {health ? `${health.model.label} ${health.model.name}` : 'the model'}, not by ComfyUI: a few minutes and a few cents a picture, in a few renders it checks itself. It reads what each picture is (a frame, a border, a corner, an ornament) and how it is colored. The SVG has one layer per color{' '}and, for a frame or border, the data that fits it to any page.</>}
          </div>
        )}
        {isTrace && (
          <label className="field">
            <div className="label">Made for</div>
            <select value={options.madeFor} onChange={(e) => {
              const v = e.target.value as RestyleOptions['madeFor'];
              set('madeFor', v);
              // a border's or a pattern's own background is taken out unless Keep original is chosen again
              if ((v === 'border' || v === 'pattern') && options.background === 'original') set('background', 'transparent');
            }}>
              {[...TRACE_TARGETS, REMIX_TARGET].map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <div className="sub">{[...TRACE_TARGETS, REMIX_TARGET].find((t) => t.value === options.madeFor)?.hint}{traced ? <> A trace cannot be a frame or a corner (an app fits those to a page by data a trace does not have). Its app package says what it is made for.{options.madeFor === 'pattern' ? ' For a pattern tile the scan is straightened, its repeat across and down found, and one seamless tile cut from it and traced, with no AI. It has at most three colors, and the color behind its design is taken out (Background → Keep original keeps it).' : options.madeFor === 'border' ? ' For a border the strip is turned to run level, straightened, its repeat along its length found, and one seamless unit cut from it and traced, with no AI. It has at most three colors, and the color behind its design is taken out (Background → Keep original keeps it).' : ''} A picture that does not repeat is refused.</> : ' Each version is a new drawing that a model makes, so it costs what a flat SVG does.'}</div>
          </label>
        )}
        {(cutout || (traced && options.madeFor === 'object')) && (
          <label className="field">
            <div className="label">Clean up</div>
            <select value={options.cleanup} onChange={(e) => set('cleanup', e.target.value as RestyleOptions['cleanup'])}>
              {CLEANUPS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <div className="sub">{CLEANUPS.find((c) => c.value === options.cleanup)?.hint} {!cutout && 'A repeating border or tile is already cleaned by averaging every copy of its repeat.'}</div>
          </label>
        )}
        {byModel && options.type === 'vector' && (
          <label className="field">
            <div className="label">Made for</div>
            <select value={options.madeFor} onChange={(e) => set('madeFor', e.target.value as RestyleOptions['madeFor'])}>
              {TARGETS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <div className="sub">{TARGETS.find((t) => t.value === options.madeFor)?.hint}{options.madeFor === 'auto' ? '' : ' It is drawn that way and checked for it.'} Every drawing is measured for an app (nothing cut off, a clear ground, lines that hold, few colors) and comes with an app package.</div>
          </label>
        )}
        {redraw && <label className="field">
          <div className="label">Illustration style</div>
          <select value={options.style} disabled={options.rotateStyles} onChange={(e) => set('style', e.target.value)}>
            <option value="">{options.rotateStyles ? 'Rotating through them' : 'None selected'}</option>
            {CATALOG.artStyles.filter((a) => styleFits(options.type, a.id)).map((a) => (
              <optgroup key={a.id} label={a.label}>
                <option value={a.id}>{a.label}</option>
                {a.substyles.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </optgroup>
            ))}
          </select>
          <label className="check" title="Each picture in a batch is drawn in the next style of this list, from the first, and from the first again at the end">
            <input type="checkbox" checked={options.rotateStyles} onChange={(e) => set('rotateStyles', e.target.checked)} /> Rotate styles
          </label>
          {options.rotateStyles && <div className="sub">The first picture is drawn in {findStyle(styleChoices(options.type)[0])?.label}, the next in {findStyle(styleChoices(options.type)[1])?.label}, and so on down the list ({styleChoices(options.type).length} styles), then from the first again. The style chosen above is not used.</div>}
          {!type.styles ? null : <div className="sub">Only the styles that suit {type.label.toLowerCase()} are listed.</div>}
          {!options.rotateStyles && wantsStyleReference(options) && health && (
            health.comfy.styleReference && health.styleReferences.includes(options.style)
              ? <div className="sub">Drawn with a reference picture of this style, so its look comes out true.</div>
              : <div className="sub warn">{health.comfy.styleReference ? 'This style has no reference picture on this server yet' : 'ComfyUI here has no style-reference files (USO) yet'}, so it is drawn from words alone.</div>
          )}
        </label>}
        {redraw && <label className="field">
          <div className="label">Theme</div>
          <select value={options.theme} onChange={(e) => set('theme', e.target.value)}>
            <option value="">None selected</option>
            {CATALOG.themes.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>}
        {redraw && <div className="field">
          <div className="label">Follow the original</div>
          <Seg label="Follow the original" value={options.closeness} onChange={(v) => set('closeness', v)} options={CLOSENESS.map((c) => ({ value: c.value, label: c.label }))} />
          <div className="sub">{CLOSENESS.find((c) => c.value === options.closeness)?.hint}</div>
        </div>}
        {pictureLed && (
          <div className="field">
            <Toggle label="Draw it whole" on={options.whole && !noWhole} onChange={(v) => set('whole', v)} disabled={!!noWhole} />
            {noWhole && <div className="sub warn">{noWhole}</div>}
          </div>
        )}
        {cutout && <div className="sub">Lifted off its background as it is, in seconds, by the worker: neither ComfyUI nor a model draws anything. The picture is one ink on a plain ground (an engraving, a stamp, a silhouette); the ground is made clear, a turned picture is set level, and a small scan is enlarged smoothly. For a picture in several colors, use Trace.</div>}
        {traced && <div className="sub">Traced as it is, in seconds, by the worker: neither ComfyUI nor a model draws anything, so the shapes and layout stay exactly the original's. A scan's few printed colors become flat layers (colors that differ only by the print's grain are one). It is the same every time, so there is one version.</div>}
        {!worker && <div className="field">
          <div className="label">Versions of each picture</div>
          <Seg label="Versions of each picture" value={options.variations} onChange={(v) => set('variations', v)} options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))} />
          {byModel && <div className="sub">Each version is a separate drawing, and costs what one does.</div>}
        </div>}
        {!worker && <label className="field">
          <div className="label">{byModel ? 'Extra words for the model' : 'Extra words for the prompt'}</div>
          <input className="text" value={options.notes} maxLength={300} placeholder={byModel ? 'Optional: one ink, keep the rosettes, a deeper foot…' : 'Optional: gold and deep red, thin lines…'} onChange={(e) => set('notes', e.target.value)} />
        </label>}
      </section>

      <section className="panel-section">
        <h2><span className="step">3</span> Processing options</h2>
        <div className="two">
          <label className="field">
            <div className="label">{byModel || traced ? 'Preview format' : 'Output format'}</div>
            <select value={options.format} onChange={(e) => set('format', e.target.value as RestyleOptions['format'])}>
              <option value="png">PNG{options.background === 'transparent' ? ' (transparent)' : ''}</option>
              <option value="webp">WebP{options.background === 'transparent' ? ' (transparent)' : ''}</option>
              {!cutout && <option value="jpeg">JPEG</option>}
            </select>
          </label>
          {redraw && <label className="field">
            <div className="label">Size</div>
            <select value={options.size} onChange={(e) => set('size', e.target.value as RestyleOptions['size'])}>
              <option value="drawn">As drawn</option>
              <option value="original">Original size</option>
              <option value="2x">2× as drawn</option>
              <option value="4x">4× as drawn</option>
            </select>
          </label>}
        </div>
        {redraw && options.whole && !noWhole && <label className="field">
          <div className="label">Ratio</div>
          <select value={options.ratio} onChange={(e) => set('ratio', e.target.value as RestyleOptions['ratio'])}>
            {RATIOS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>}
        {redraw && <label className="field">
          <div className="label">Quality</div>
          <select value={options.quality} onChange={(e) => set('quality', e.target.value as RestyleOptions['quality'])}>
            <option value="auto">Auto ({quality.label.toLowerCase()} for {type.label.toLowerCase()})</option>
            {QUALITIES.map((q) => <option key={q.value} value={q.value}>{q.label}: {q.size} px, {q.steps} steps</option>)}
          </select>
        </label>}
        {!cutout && <label className="field">
          <div className="label">Background</div>
          <select value={options.background} onChange={(e) => set('background', e.target.value as RestyleOptions['background'])}>
            {(pictureLed || traced) && <option value="original">Keep original</option>}
            <option value="transparent">Transparent</option>
            <option value="white">White</option>
            <option value="black">Black</option>
            <option value="green">Green</option>
          </select>
          {traced && <div className="sub">{options.background === 'original' ? 'Nothing is cleared: a scan\'s margin is traced with the picture.' : 'A scan\'s paper margin is cleared; the design keeps its own ground.'}</div>}
          {pictureLed && <div className="sub">{options.background === 'original' ? 'Nothing is cut out: the picture is redrawn with its own background. Choose a background to cut the subject out onto it.' : 'The subject is cut out of the picture and put on this background.'}</div>}
          {options.background !== 'white' && options.background !== 'original' && options.type === 'illustration' && health && !health.comfy.cutout && (
            <div className="sub">No background-removal model here, so illustrations are drawn on a flat green (or blue) backdrop and cut out by color.</div>
          )}
        </label>}
        {redraw && <Toggle label="Enhance details" on={options.enhance} onChange={(v) => set('enhance', v)} disabled={health ? !health.comfy.upscale : false}
          hint={health && !health.comfy.upscale ? 'ComfyUI has no upscaling model, so enlarging is a plain resize.' : 'Enlarge with an upscaling model, which redraws fine detail, rather than a plain resize.'} />}
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
