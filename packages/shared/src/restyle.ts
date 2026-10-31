// Restyle: pictures (clip art, frames, ornaments, anything) redrawn by ComfyUI in a type, an art
// style and a theme the user picks, or drawn again as flat vector art by a model. The choices, and
// the data kept about each input and result.

import { CATALOG } from './catalog.ts';
import { TARGETS, type AppReport, type Target } from './appready.ts';

export { CATALOG };

/** What a picture is redrawn as. Clip art and line art come back as SVG too. A flat SVG is not drawn
 * by ComfyUI: a model writes it as a drawing program (the Vector redraw's loop). */
export type OutputType = 'clipart' | 'lineart' | 'illustration' | 'render3d' | 'vector';
/** The types ComfyUI draws. */
export type ComfyType = Exclude<OutputType, 'vector'>;

export interface OutputTypeInfo {
  value: OutputType;
  label: string;
  group: '2D' | '3D' | 'Vector';
  hint: string;
  /** Traced to SVG as well as kept as a picture. */
  vector: boolean;
  /** The art styles that suit it (and their substyles); every one when null. */
  styles: string[] | null;
  /** The quality it is drawn at when left to Auto: flat art is drawn smaller, then traced. */
  quality: Exclude<Quality, 'auto'>;
}

export const OUTPUT_TYPES: OutputTypeInfo[] = [
  { value: 'clipart', label: 'Clip art', group: '2D', hint: 'Flat colors and clean outlines, as SVG and PNG', vector: true, quality: 'fast',
    styles: ['abstract', 'minimalism', 'art-nouveau', 'art-deco', 'cartoon', 'anime', 'comic-book'] },
  { value: 'lineart', label: 'Line art', group: '2D', hint: 'Black outlines only, like a coloring page or an engraving, as SVG and PNG', vector: true, quality: 'fast',
    styles: ['realism', 'surrealism', 'abstract', 'minimalism', 'art-nouveau', 'art-deco', 'classical', 'cartoon', 'anime', 'comic-book'] },
  { value: 'illustration', label: '2D illustration', group: '2D', hint: 'Painted or drawn in full, in any art style and medium', vector: false, quality: 'standard', styles: null },
  { value: 'render3d', label: '3D illustration', group: '3D', hint: 'Rendered with depth, light and materials', vector: false, quality: 'standard',
    styles: ['realism', 'surrealism', 'abstract', 'minimalism', 'art-nouveau', 'art-deco', 'classical', 'cartoon', 'anime', 'comic-book'] },
  // Drawn by the model, not ComfyUI: no art style or theme, and no sampler quality (it is only a
  // placeholder here, for the Quality field it does not show).
  { value: 'vector', label: 'Flat SVG', group: 'Vector', hint: 'New flat vector art for a frame, border, corner or ornament, one layer per color, with the data that fits it to any page', vector: true, quality: 'fast', styles: [] },
];

/** Whether a model writes the drawing (the Vector redraw's loop), not ComfyUI. */
export const drawnByModel = (type: OutputType) => type === 'vector';

export type Quality = 'auto' | 'fast' | 'standard' | 'high';
/** The pixel budget (a square of this side) and sampler steps of each quality. */
export const QUALITIES: { value: Exclude<Quality, 'auto'>; label: string; size: number; steps: number }[] = [
  { value: 'fast', label: 'Fast', size: 768, steps: 24 },
  { value: 'standard', label: 'Standard', size: 1024, steps: 32 },
  { value: 'high', label: 'High', size: 1280, steps: 48 },
];

/** How far the redrawing may move from the original: the sampler's denoise, for each type.
 * Illustration and 3D are a variation of the picture, which carries what it shows: 0.50 keeps its
 * pose, face and main shapes and redraws the ornament and detail (tried on a photographed bust,
 * three seeds: 0.30 is a near copy, 0.60 and up starts to lose the subject, and at 0.70 from a
 * photo a bust became a man in a flight suit). Clip art changes how everything is drawn (a gray
 * engraving becomes flat color), so it needs more room than line art, which keeps the drawing and
 * only cleans it. Clip art and line art tried on prod's FLUX.1 Dev (Q4_K_S, 16 steps) with scans of
 * engraved frames. */
export type Closeness = 'close' | 'balanced' | 'loose';
export const CLOSENESS: { value: Closeness; label: string; hint: string; denoise: Record<ComfyType, number> }[] = [
  { value: 'close', label: 'Closely', hint: "Keeps the original's shapes and layout.", denoise: { clipart: 0.8, lineart: 0.65, illustration: 0.4, render3d: 0.4 } },
  { value: 'balanced', label: 'Balanced', hint: 'Keeps the layout and redraws the details.', denoise: { clipart: 0.88, lineart: 0.75, illustration: 0.5, render3d: 0.5 } },
  { value: 'loose', label: 'Loosely', hint: 'Keeps the idea, with room for a new layout.', denoise: { clipart: 0.94, lineart: 0.85, illustration: 0.6, render3d: 0.6 } },
];
/** The output types redrawn from half of the way or less (CLOSENESS) that the picture carries what it
 * shows, so the prompt does not describe it. Clip art and line art are redrawn from most of the way,
 * and the words carry the subject: tried without them at 0.80, FLUX drew a skull and a heap of rocks
 * (and a bust at 0.70 from a photo became a man in a flight suit). */
export const PICTURE_LED_TYPES: OutputType[] = ['illustration', 'render3d'];

/** Draw it whole: a figure shown in part is redrawn as the whole figure, from a sentence the model writes
 * about it full-length, on a taller canvas (2:3). The redraw starts from nothing (denoise 1): from the picture
 * (a close-up of a face cropped into a tall canvas) it would keep the close-up, at 0.75 and at 0.85 and 0.9
 * alike, as only 1.0 gave a standing figure (tried on a pharaoh's bust and an anime pharaoh's). The picture is
 * only read by the model, and the figure is a new one inspired by it. */
export const WHOLE_DENOISE = 1;
export const WHOLE_ASPECT = 2 / 3;
/** The shapes a whole figure may be drawn on: width to height. 2:3 is tall (a figure standing), 3:2 is wide. */
export type Ratio = '2:3' | '3:2';
export const RATIOS: { value: Ratio; label: string; aspect: number }[] = [
  { value: '2:3', label: '2:3 (tall)', aspect: 2 / 3 },
  { value: '3:2', label: '3:2 (wide)', aspect: 3 / 2 },
];
/** The aspect a whole figure is drawn at; a result from before the choice was 2:3. */
export const wholeAspect = (o: { ratio?: Ratio }) => RATIOS.find((r) => r.value === o.ratio)?.aspect ?? WHOLE_ASPECT;

/** The art styles FLUX only gets right from a picture in that style, as well as words: USO (ByteDance's
 * style reference) takes the look of the picture (color, brushwork, texture), not what it shows.
 * Keyed by style id; the picture is `style-references/<id>.webp` in the data folder. `weight` is how
 * strongly it is applied (USO's LoRA strength): 1 is ComfyUI's own template, less lets the words
 * and the original keep more of their say. From settings tried by hand on prod's FLUX.1 Dev. */
export const STYLE_REFERENCES: Record<string, { weight: number }> = {
  biomechanical: { weight: 1 },
  expressionism: { weight: 0.75 },
  fauvism: { weight: 0.5 },
  'neo-expressionism': { weight: 0.5 },
  impressionism: { weight: 0.75 },
  rococo: { weight: 1 },
  'realistic-anime': { weight: 0.75 },
};
/** The output types that use it. Clip art and line art keep their flat, outlined look (and trace
 * cleanly to SVG), which a painted reference shades: tried with Realistic Anime clip art, USO
 * turned flat color into a shaded painting. */
export const STYLE_REFERENCE_TYPES: OutputType[] = ['illustration', 'render3d'];
/** Whether this type and style are drawn with a reference picture. */
export const wantsStyleReference = (o: { type: OutputType; style: string }) => !!STYLE_REFERENCES[o.style] && STYLE_REFERENCE_TYPES.includes(o.type);

/** The ground a picture ends on. 'original' (none chosen) keeps the picture's own background: nothing is cut out, before
 * the redraw or after it (2D and 3D illustrations only: clip art and line art are cut out to be traced). The others cut
 * the subject out and fill the rest, or leave it clear. */
export type Background = 'original' | 'transparent' | 'white' | 'black' | 'green';
/** What each ground is filled with, and called. Transparent has no fill, the original keeps its own. */
export const BACKGROUND_HEX: Record<Exclude<Background, 'original' | 'transparent'>, string> = { white: '#ffffff', black: '#000000', green: '#00ff00' };
export const BACKGROUND_LABEL: Record<Background, string> = { original: 'Keep the original', transparent: 'Transparent', white: 'White', black: 'Black', green: 'Green' };
/** drawn: the size ComfyUI draws at; original: the input's own size; 2 and 4: the drawn size enlarged. */
export type OutputSize = 'drawn' | 'original' | '2x' | '4x';
export type OutputFormat = 'png' | 'webp' | 'jpeg';

export interface RestyleOptions {
  type: OutputType;
  /** An art style or one of its substyles, by id; '' for none. */
  style: string;
  /** A medium, for 2D illustrations; '' for none. */
  medium: string;
  /** A theme, by id; '' for none. */
  theme: string;
  closeness: Closeness;
  quality: Quality;
  variations: number;
  background: Background;
  size: OutputSize;
  /** Enlarge with an upscaling model on ComfyUI rather than a plain resize. */
  enhance: boolean;
  format: OutputFormat;
  /** The user's own words, added to the prompt. */
  notes: string;
  /** Redraw the whole figure from a picture of part of it (WHOLE_DENOISE), for 2D and 3D illustrations. */
  whole: boolean;
  /** The shape of the canvas a whole figure is drawn on. */
  ratio: Ratio;
  /** A flat SVG: what it is made for (a frame, a border, a corner, a pattern, an object), which decides how it is drawn and what it must pass. */
  madeFor: Target;
}

export const DEFAULT_OPTIONS: RestyleOptions = {
  type: 'clipart', style: '', medium: '', theme: '', closeness: 'balanced', quality: 'auto', variations: 1,
  background: 'original', size: 'drawn', enhance: false, format: 'png', notes: '', whole: false, ratio: '2:3', madeFor: 'auto',
};

export type InputStatus = 'preparing' | 'ready' | 'failed';

export interface RestyleInput {
  id: string;
  name: string;
  /** The folder it came from inside a zip or a dropped folder ('' for none). */
  folder: string;
  createdAt: string;
  status: InputStatus;
  error?: string;
  /** The uploaded format, by extension (png, svg, eps, pdf…). */
  format: string;
  /** Pixel size of source.png. */
  size?: [number, number];
  /** Pixel size as uploaded (an SVG or EPS: as drawn for Telios). */
  originalSize?: [number, number];
  /** What it shows, in a phrase: read by the model when one is set up, else from its name. */
  subject?: string;
  /** SHA-256 of the picture as added, so the same picture is not added twice. */
  hash?: string;
}

export type ResultStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled';

/** What ComfyUI was given for a result and how it was cut out and sized, kept with the result so the
 * preview can say what drew it. */
export interface DrawSettings {
  /** The FLUX model file. */
  model: string;
  /** The size it was drawn at. */
  width: number;
  height: number;
  steps: number;
  /** How far from the original it was redrawn (the sampler's denoise). */
  denoise: number;
  guidance: number;
  sampler: string;
  scheduler: string;
  /** EasyCache's reuse threshold; 0 is off. */
  easycache: number;
  /** The style picture USO was given: the style it stands for and its strength. */
  styleReference?: { style: string; weight: number };
  /** How the background was made clear: by a model (`with` its file), by color (`with` what from), or not. */
  cutout?: { by: 'model' | 'color' | 'none'; with?: string };
  /** The picture was redrawn from its subject cut out and put on flat white, not from the picture as it was. */
  startCutout?: boolean;
  /** Draw it whole: the sentence the model wrote about the figure full-length, which is the redraw's prompt. */
  whole?: { prompt: string };
  /** The upscaling model that enlarged it, when one did. */
  enlargedWith?: string;
}

/** How far a running result has come. The stage it is in covers `from` to `to` of the whole job (0 to 1),
 * began at `at` and takes about `seconds`: the server knows when a stage starts, not how far into it
 * the work is, so `progressAt` eases through it with the clock. */
export interface RestyleProgress {
  from: number;
  to: number;
  at: string;
  seconds: number;
}

/** The share of the job done at `now` (ms): the stage's start, easing towards its end, which it only
 * reaches when the next stage reports in. A stage that runs long waits near its end. */
export function progressAt(p: RestyleProgress, now: number): number {
  const spent = Math.max(0, now - Date.parse(p.at)) / 1000;
  return p.from + (p.to - p.from) * (1 - Math.exp((-2.5 * spent) / p.seconds));
}

export interface RestyleResult {
  id: string;
  batchId: string;
  inputId: string;
  inputName: string;
  folder: string;
  options: RestyleOptions;
  /** 1 to options.variations. */
  variation: number;
  status: ResultStatus;
  stage?: string;
  progress?: RestyleProgress;
  error?: string;
  /** Something the result is not, that was asked for: drawn on white, the background not cleared. */
  warning?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  seed?: number;
  prompt?: string;
  settings?: DrawSettings;
  size?: [number, number];
  /** A flat SVG: the design the model drew it as in the Vector redraw's data (kept out of its
   * library, and removed with this result), and what that drawing says of itself. */
  designId?: string;
  drawing?: VectorDrawing;
  /** Paths inside the data folder. `png` is the preview for a flat SVG; `layout` is its fitting data. */
  files?: { png: string; svg?: string; layout?: string; fitsheet?: string; thumb: string; view: string; original: string };
}

/** What the model's drawing says of itself, kept with a flat SVG result. */
export interface VectorDrawing {
  runId: string;
  /** The provider and model that drew it. */
  model: string;
  /** Renders it used, of the most it was allowed. */
  renders: number;
  maxRenders: number;
  costUsd: number;
  /** What it read the picture as, and the color rule it drew by. */
  kind: string;
  colorMode: string;
  /** The checks that say whether it can go into an app as it is. */
  appReady?: AppReport;
  summary: string;
}

/** An art style or substyle by id, with its art style. */
export function findStyle(id: string) {
  for (const art of CATALOG.artStyles) {
    if (art.id === id) return { art, sub: null, label: art.label, words: art.words };
    const sub = art.substyles.find((s) => s.id === id);
    if (sub) return { art, sub, label: sub.label, words: sub.words };
  }
  return null;
}

/** Whether an art style (or a substyle, by its art style) suits an output type. */
export function styleFits(type: OutputType, id: string) {
  const styles = OUTPUT_TYPES.find((t) => t.value === type)?.styles;
  const found = findStyle(id);
  return !!found && (!styles || styles.includes(found.art.id));
}

export const findTheme = (id: string) => CATALOG.themes.flatMap((g) => g.options).find((o) => o.id === id) ?? null;
export const findMedium = (id: string) => CATALOG.mediums.find((m) => m.id === id) ?? null;
export const typeInfo = (type: OutputType) => OUTPUT_TYPES.find((t) => t.value === type)!;
export const qualityOf = (o: Pick<RestyleOptions, 'type' | 'quality'>) => QUALITIES.find((q) => q.value === (o.quality === 'auto' ? typeInfo(o.type).quality : o.quality))!;

/** Options from a request, every field checked; what is not understood is left at its default. */
export function cleanOptions(raw: any): RestyleOptions {
  const o = { ...DEFAULT_OPTIONS };
  const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);
  o.type = pick(raw?.type, OUTPUT_TYPES.map((t) => t.value), o.type);
  o.style = typeof raw?.style === 'string' && styleFits(o.type, raw.style) ? raw.style : '';
  o.medium = o.type === 'illustration' && typeof raw?.medium === 'string' && findMedium(raw.medium) ? raw.medium : '';
  o.theme = !drawnByModel(o.type) && typeof raw?.theme === 'string' && findTheme(raw.theme) ? raw.theme : '';
  o.closeness = pick(raw?.closeness, CLOSENESS.map((c) => c.value), o.closeness);
  o.quality = pick(raw?.quality, ['auto', 'fast', 'standard', 'high'] as const, o.quality);
  o.variations = Math.max(1, Math.min(4, Math.round(Number(raw?.variations) || 1)));
  o.background = pick(raw?.background, ['original', 'transparent', 'white', 'black', 'green'] as const, o.background);
  // clip art and line art are cut out of their ground to be traced, and a flat SVG has none: they always have a choice
  if (o.background === 'original' && !PICTURE_LED_TYPES.includes(o.type)) o.background = 'transparent';
  o.size = pick(raw?.size, ['drawn', 'original', '2x', '4x'] as const, o.size);
  o.enhance = raw?.enhance === true;
  o.format = pick(raw?.format, ['png', 'webp', 'jpeg'] as const, o.format);
  o.notes = typeof raw?.notes === 'string' ? raw.notes.trim().slice(0, 300) : '';
  o.whole = PICTURE_LED_TYPES.includes(o.type) && raw?.whole === true;
  o.ratio = pick(raw?.ratio, RATIOS.map((r) => r.value), o.ratio);
  o.madeFor = drawnByModel(o.type) ? pick(raw?.madeFor, TARGETS.map((t) => t.value), 'auto') : 'auto';
  return o;
}

export interface SettingRow { label: string; value: string }

const trim = (n: number) => String(Math.round(n * 1000) / 1000);
const COLOR_RULE_WORDS: Record<string, string> = { 'one-ink': 'one ink', neutral: 'a neutral grayscale base', full: 'full color' };
const SIZE_WORDS: Record<RestyleOptions['size'], string> = { drawn: 'as drawn', original: 'original size', '2x': '2× as drawn', '4x': '4× as drawn' };

/** A result's settings as the preview says them, in plain words. What was only recorded later is left
 * out of a result that predates it, never guessed. */
export function settingRows(r: Pick<RestyleResult, 'options' | 'settings' | 'seed' | 'size' | 'drawing'>): SettingRow[] {
  const o = r.options;
  const s = r.settings;
  const q = qualityOf(o);
  const rows: SettingRow[] = [];
  if (drawnByModel(o.type)) {
    const d = r.drawing;
    if (d) {
      rows.push({ label: 'Drawn by', value: d.model });
      rows.push({ label: 'Renders', value: `${d.renders} of ${d.maxRenders} allowed` });
      // a model with no known price (a local or custom one) has no cost to show
      if (d.costUsd > 0) rows.push({ label: 'Cost', value: d.costUsd < 0.005 ? 'under 1¢' : `about ${(d.costUsd * 100).toFixed(d.costUsd < 0.1 ? 1 : 0)}¢` });
      rows.push({ label: 'Read as', value: `${d.kind}, ${COLOR_RULE_WORDS[d.colorMode] ?? d.colorMode}` });
      if (d.appReady) rows.push({ label: 'App-ready', value: d.appReady.ok ? `yes, all ${d.appReady.checks.length} checks pass` : `no: ${d.appReady.checks.filter((c) => !c.ok).map((c) => c.label.toLowerCase()).join(', ')}` });
    }
    if (o.madeFor !== 'auto') rows.push({ label: 'Made for', value: TARGETS.find((t) => t.value === o.madeFor)?.label ?? o.madeFor });
    rows.push({ label: 'Background', value: BACKGROUND_LABEL[o.background] });
    if (r.size) rows.push({ label: 'Preview', value: `${o.format.toUpperCase()}, ${r.size[0]} × ${r.size[1]} px; the SVG is not pixel-sized` });
    return rows;
  }
  rows.push({ label: 'Drawn at', value: s ? `${s.width} × ${s.height} px, ${s.steps} steps (${q.label})` : `${q.label}: ${q.size} px, ${q.steps} steps` });
  rows.push({ label: 'Follow the original', value: `${CLOSENESS.find((c) => c.value === o.closeness)?.label ?? o.closeness}${s ? `, denoise ${trim(s.denoise)}` : ''}` });
  if (s) {
    rows.push({ label: 'Model', value: s.model });
    rows.push({ label: 'Prompt strength', value: `guidance ${trim(s.guidance)}` });
    rows.push({ label: 'Sampler', value: `${s.sampler}, ${s.scheduler}${s.easycache > 0 ? `, EasyCache ${trim(s.easycache)}` : ''}` });
  }
  if (r.seed !== undefined) rows.push({ label: 'Seed', value: String(r.seed) });
  if (s?.styleReference) rows.push({ label: 'Style picture', value: `${findStyle(s.styleReference.style)?.label ?? s.styleReference.style}, strength ${trim(s.styleReference.weight)}` });
  else if (s && wantsStyleReference(o)) rows.push({ label: 'Style picture', value: 'none, drawn from words alone' });
  if (s?.startCutout) rows.push({ label: 'Start picture', value: 'the subject cut out of the picture, on flat white' });
  if (s?.whole) {
    rows.push({ label: 'Draw it whole', value: 'the whole figure, described by the model and drawn from that sentence alone on a taller canvas (Follow the original does not apply)' });
    rows.push({ label: 'Figure asked for', value: s.whole.prompt });
  }
  const ground = BACKGROUND_LABEL[o.background];
  const c = s?.cutout;
  rows.push({
    label: 'Background',
    value: o.background === 'original' ? 'kept as in the original: nothing cut out' : !c ? ground : c.by === 'model' ? `${ground}, cut out by a model (${c.with})` : c.by === 'color' ? `${ground}, cleared by color${c.with ? ` from ${c.with}` : ''}` : `${ground}, not cleared`,
  });
  if (r.size) rows.push({ label: 'Kept as', value: `${o.format.toUpperCase()}, ${SIZE_WORDS[o.size]}, ${r.size[0]} × ${r.size[1]} px${s?.enlargedWith ? `, enlarged with ${s.enlargedWith}` : ''}` });
  return rows;
}
