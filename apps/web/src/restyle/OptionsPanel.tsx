import { CATALOG, CLOSENESS, GOALS, PICTURE_LED_TYPES, QUALITIES, CLEANUPS, RATIOS, TARGETS, drawnByModel, findStyle, goalOf, styleChoices, styleFits, tracedOnly, cutoutOnly, typeInfo, wantsStyleReference, type Goal, type RestyleOptions } from '@telios/shared';
import type { Health } from '../api.ts';
import { GoalCards } from './GoalCards.tsx';

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

export function OptionsPanel({ options, set, health }: { options: RestyleOptions; set: Set; health: Health | null }) {
  const goal = goalOf(options) ?? GOALS[0];
  const type = typeInfo(options.type);
  const byModel = drawnByModel(options);
  const traced = tracedOnly(options);
  const cutout = cutoutOnly(options);
  const illustration = options.type === 'illustration';
  const pictureLed = PICTURE_LED_TYPES.includes(options.type);
  const choose = (g: Goal) => {
    set('type', g.type);
    set('madeFor', g.madeFor);
    set('style', '');
    set('rotateStyles', false);
    set('theme', '');
    if (g.type !== 'illustration') set('whole', false);
    if (g.type !== 'illustration' && g.type !== 'vector' && g.madeFor !== 'remix') set('variations', 1);
    // what each kind of result is on: a cutout, a vector and a pattern tile or border have no ground of their own to keep
    if (g.type !== 'illustration' && !(g.type === 'trace' && g.madeFor === 'object')) set('background', 'transparent');
    set('format', g.type === 'cutout' ? 'webp' : options.format === 'jpeg' || cutoutOnly(options) ? 'png' : options.format);
  };
  // Draw it whole has the model describe the whole figure, which is what is drawn
  const noWhole = health && !health.model.ok ? `Draw it whole needs the model to describe the figure: ${health.model.error ?? 'set one up in .env'}` : '';
  const quality = QUALITIES.find((q) => q.value === type.quality)!;
  const keepGround = options.background === 'original';
  return (
    <>
      <section className="panel-section">
        <h2><span className="step">2</span> What do you want?</h2>
        <GoalCards options={options} choose={choose} />
        {byModel && (
          <div className="sub">
            {health && !health.model.ok
              ? <span className="warn">{health.model.provider === 'none' ? 'No model is set up' : `${health.model.label} is not answering`}: this is drawn by a model, not ComfyUI. {health.model.error}</span>
              : <>Drawn by {health ? `${health.model.label} ${health.model.name}` : 'the model'}: a few minutes and a few cents a picture, in a few renders it checks itself. The SVG has one layer per color.</>}
          </div>
        )}
      </section>

      <section className="panel-section">
        <h2><span className="step">3</span> Adjust</h2>
        {(cutout || (traced && goal.id === 'vector')) && (
          <label className="field">
            <div className="label">Clean up</div>
            <select value={options.cleanup} onChange={(e) => set('cleanup', e.target.value as RestyleOptions['cleanup'])}>
              {CLEANUPS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <div className="sub">{CLEANUPS.find((c) => c.value === options.cleanup)?.hint}</div>
          </label>
        )}
        {traced && goal.id === 'vector' && <Toggle label="Clear the background inside the design" on={options.clearInside} onChange={(v) => set('clearInside', v)}
          hint="On: the plain ground showing between the vines and leaves is made transparent. Off: it is kept, as for a white flower on a white page." />}
        {traced && <Toggle label="Keep the original background" on={keepGround} onChange={(v) => set('background', v ? 'original' : 'transparent')}
          hint={goal.id === 'vector' ? 'Off: a scan\u2019s paper margin is cleared and the design keeps its own ground.' : 'Off: the color behind the design is taken out, so an app can recolor it.'} />}
        {cutout && (
          <div className="field">
            <div className="label">File type</div>
            <Seg label="File type" value={options.format === 'png' ? 'png' : 'webp'} onChange={(v) => set('format', v)} options={[{ value: 'webp', label: 'WebP' }, { value: 'png', label: 'PNG' }]} />
            <div className="sub">Both are transparent. WebP is smaller; PNG opens everywhere.</div>
          </div>
        )}
        {goal.id === 'flat' && (
          <label className="field">
            <div className="label">It is for</div>
            <select value={options.madeFor} onChange={(e) => set('madeFor', e.target.value as RestyleOptions['madeFor'])}>
              {TARGETS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <div className="sub">{TARGETS.find((t) => t.value === options.madeFor)?.hint}{options.madeFor === 'auto' ? '' : ' It is drawn that way and checked for it.'} Every drawing is measured for an app (nothing cut off, a clear ground, lines that hold, few colors).</div>
          </label>
        )}
        {illustration && <label className="field">
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
          {!options.rotateStyles && wantsStyleReference(options) && health && (
            health.comfy.styleReference && health.styleReferences.includes(options.style)
              ? <div className="sub">Drawn with a reference picture of this style, so its look comes out true.</div>
              : <div className="sub warn">{health.comfy.styleReference ? 'This style has no reference picture on this server yet' : 'ComfyUI here has no style-reference files (USO) yet'}, so it is drawn from words alone.</div>
          )}
        </label>}
        {illustration && <label className="field">
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
        {illustration && <div className="field">
          <div className="label">Follow the original</div>
          <Seg label="Follow the original" value={options.closeness} onChange={(v) => set('closeness', v)} options={CLOSENESS.map((c) => ({ value: c.value, label: c.label }))} />
          <div className="sub">{CLOSENESS.find((c) => c.value === options.closeness)?.hint}</div>
        </div>}
        {pictureLed && (
          <div className="field">
            <Toggle label="Draw it whole" on={options.whole && !noWhole} onChange={(v) => set('whole', v)} disabled={!!noWhole} />
            {noWhole && <div className="sub warn">{noWhole}</div>}
            {options.whole && !noWhole && <label className="field">
              <div className="label">Ratio</div>
              <select value={options.ratio} onChange={(e) => set('ratio', e.target.value as RestyleOptions['ratio'])}>
                {RATIOS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </label>}
          </div>
        )}
        {(illustration || goal.id === 'remix' || goal.id === 'flat') && <div className="field">
          <div className="label">Versions of each picture</div>
          <Seg label="Versions of each picture" value={options.variations} onChange={(v) => set('variations', v)} options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))} />
          {byModel && <div className="sub">Each version is a separate drawing, and costs what one does.</div>}
        </div>}
        {(illustration || byModel) && <label className="field">
          <div className="label">{byModel ? 'Extra words for the model' : 'Extra words for the prompt'}</div>
          <input className="text" value={options.notes} maxLength={300} placeholder={byModel ? 'Optional: one ink, keep the rosettes, a deeper foot…' : 'Optional: gold and deep red, thin lines…'} onChange={(e) => set('notes', e.target.value)} />
        </label>}
        {illustration && (
          <div className="field">
            <div className="label">File type</div>
            <Seg label="File type" value={options.format === 'webp' ? 'webp' : 'png'} onChange={(v) => set('format', v)} options={[{ value: 'png', label: 'PNG' }, { value: 'webp', label: 'WebP' }]} />
          </div>
        )}
        {illustration && (
          <label className="field">
            <div className="label">Background</div>
            <select value={options.background} onChange={(e) => set('background', e.target.value as RestyleOptions['background'])}>
              <option value="original">Keep original</option>
              <option value="transparent">Transparent</option>
              <option value="white">White</option>
              <option value="black">Black</option>
              <option value="green">Green</option>
            </select>
            <div className="sub">{keepGround ? 'Nothing is cut out: the picture is redrawn with its own background. Choose a background to cut the subject out onto it.' : 'The subject is cut out of the picture and put on this background.'}</div>
            {options.background !== 'white' && !keepGround && health && !health.comfy.cutout && (
              <div className="sub">No background-removal model here, so illustrations are drawn on a flat green (or blue) backdrop and cut out by color.</div>
            )}
          </label>
        )}
        {illustration && (
          <details className="more">
            <summary>Size and quality</summary>
            <label className="field">
              <div className="label">Size</div>
              <select value={options.size} onChange={(e) => set('size', e.target.value as RestyleOptions['size'])}>
                <option value="drawn">As drawn</option>
                <option value="original">Original size</option>
                <option value="2x">2× as drawn</option>
                <option value="4x">4× as drawn</option>
              </select>
            </label>
            <label className="field">
              <div className="label">Quality</div>
              <select value={options.quality} onChange={(e) => set('quality', e.target.value as RestyleOptions['quality'])}>
                <option value="auto">Auto ({quality.label.toLowerCase()})</option>
                {QUALITIES.map((q) => <option key={q.value} value={q.value}>{q.label}: {q.size} px, {q.steps} steps</option>)}
              </select>
            </label>
            <Toggle label="Enhance details" on={options.enhance} onChange={(v) => set('enhance', v)} disabled={health ? !health.comfy.upscale : false}
              hint={health && !health.comfy.upscale ? 'ComfyUI has no upscaling model, so enlarging is a plain resize.' : 'Enlarge with an upscaling model, which redraws fine detail, rather than a plain resize.'} />
          </details>
        )}
      </section>
    </>
  );
}
