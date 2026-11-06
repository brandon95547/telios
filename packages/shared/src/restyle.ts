// Restyle: pictures (frames, ornaments, characters, anything) redrawn by ComfyUI in an art style and a theme the user
// picks, traced into flat colors, or drawn again as flat vector art by a model. The choices, and
// the data kept about each input and result.

import { CATALOG } from './catalog.ts';
import { TARGETS, type AppReport, type Target } from './appready.ts';

export { CATALOG };

/** What a picture is redrawn as: an illustration (ComfyUI, led by the picture), a trace (the worker, the picture's own shapes in flat
 * colors) or a flat SVG (a model writes it as a drawing program, the Vector redraw's loop). */
export type OutputType = 'illustration' | 'vector' | 'trace' | 'cutout';
/** The types ComfyUI draws. */
export type ComfyType = Exclude<OutputType, 'vector' | 'trace' | 'cutout'>;

export interface OutputTypeInfo {
  value: OutputType;
  label: string;
  hint: string;
  /** Comes as an SVG as well as a picture. */
  vector: boolean;
  /** The art styles that suit it (and their substyles); every one when null. */
  styles: string[] | null;
  /** The quality it is drawn at when left to Auto. */
  quality: Exclude<Quality, 'auto'>;
}

export const OUTPUT_TYPES: OutputTypeInfo[] = [
  { value: 'illustration', label: 'Illustration', hint: 'Redrawn in an art style and theme, led by the picture: its pose and layout kept, its detail redrawn', vector: false, quality: 'standard',
    styles: null },
  // Traced, not drawn: the picture's own shapes and layout, in a few flat colors, with no redraw, so neither ComfyUI nor a model.
  { value: 'trace', label: 'Trace', hint: 'The picture itself traced into flat colors, one SVG layer per color: its shapes and layout kept exactly, with no redraw', vector: true, quality: 'fast', styles: [] },
  // Lifted, not drawn: a one-ink object (fine detail, nothing that repeats) on a plain ground, the ground made clear, the picture set level
  // and cleaned up, as a transparent WebP or PNG. The worker's own work, so neither ComfyUI nor a model.
  { value: 'cutout', label: 'Cutout', hint: 'A one-ink object lifted off its plain background: the background made clear, the picture set level and cleaned up, as a transparent WebP or PNG', vector: false, quality: 'fast', styles: [] },
  // Drawn by the model, not ComfyUI: no art style or theme, and no sampler quality (it is only a
  // placeholder here, for the Quality field it does not show).
  { value: 'vector', label: 'Flat SVG', hint: 'New flat vector art for a frame, border, corner or ornament, one layer per color, with the data that fits it to any page', vector: true, quality: 'fast', styles: [] },
];

/** What results made before these types were dropped were drawn as (clip art, line art, 2D and 3D illustration). They are not offered
 * and cannot be drawn again, but such a result still shows, downloads and says what it was. */
const RETIRED: Record<string, Pick<OutputTypeInfo, 'label' | 'vector'>> = {
  clipart: { label: 'Clip art', vector: true },
  lineart: { label: 'Line art', vector: true },
  render3d: { label: '3D illustration', vector: false },
};

/** Remix, a trace's fourth target: not the picture's own shapes but a new drawing inspired by it (same subject, style and colors, different
 * shapes), so a batch of butterflies comes back as a batch of new butterflies. A model writes it, as for a flat SVG, and it costs the same. */
export const REMIX = 'remix';
export const REMIX_TARGET = { value: REMIX, label: 'Inspired by (Remix)', hint: 'A new drawing inspired by the picture: the same subject, style and colors, but its own shapes, so a batch of butterflies comes back as a batch of new butterflies. A model draws each one, as a flat SVG, and costs the same.' } as const;
/** What the model is told for a remix. */
export const REMIX_BRIEF = 'Draw a new piece inspired by this one, not a copy of it: the same kind of subject, the same art style, line weight and color palette, but its own pose, proportions, markings and details, so that placed beside the original it is clearly another piece of the same family. Do not reproduce the original’s outlines.';

/** Whether a model writes the drawing (the Vector redraw's loop), not ComfyUI. */
export const drawnByModel = (o: { type: OutputType; madeFor?: string }) => o.type === 'vector' || (o.type === 'trace' && o.madeFor === REMIX);

/** Whether the picture is traced as it is (the worker's trace), not redrawn by ComfyUI or a model. */
export const tracedOnly = (o: { type: OutputType; madeFor?: string }) => o.type === 'trace' && o.madeFor !== REMIX;

/** Whether the picture is lifted off its background as it is (the worker's cutout): a transparent picture, no SVG. */
export const cutoutOnly = (o: { type: OutputType }) => o.type === 'cutout';

/** Whether the worker does it all on the CPU (a trace or a cutout): no ComfyUI, no model, no theme, one version. */
export const workerOnly = (o: { type: OutputType; madeFor?: string }) => tracedOnly(o) || cutoutOnly(o);

/** What a trace can be made for: an object (the default), a pattern tile (one exact repeat, across and down) or a border (one exact repeat
 * along its length). Not a frame or a corner: an app fits those to a page by data a trace does not have. */
export const TRACE_TARGETS = TARGETS.filter((t) => t.value === 'object' || t.value === 'pattern' || t.value === 'border');

/** What a person asks for, in their words. Each goal is one way of using the tool, and says what it gives, how long it takes and what it costs;
 * the type and "made for" it sets are how the tool does it. The Choose step lists these, not the types. */
export interface Goal {
  id: string;
  group: 'copy' | 'new';
  label: string;
  line: string;
  /** The one file it gives. */
  gives: string;
  speed: string;
  cost: string;
  type: OutputType;
  madeFor: Target | typeof REMIX;
}
export const GOAL_GROUPS = { copy: 'Copy what is there', new: 'Make something new' } as const;
export const GOALS: Goal[] = [
  { id: 'vector', group: 'copy', label: 'Same picture as vector', line: 'The picture itself traced into flat colors. Its shapes and layout stay exactly as they are.', gives: 'SVG', speed: 'Seconds', cost: 'Free', type: 'trace', madeFor: 'object' },
  { id: 'cutout', group: 'copy', label: 'Cut out the object', line: 'A one-ink object lifted off its plain background, set level and cleaned up.', gives: 'Transparent WebP', speed: 'Seconds', cost: 'Free', type: 'cutout', madeFor: 'auto' },
  { id: 'tile', group: 'copy', label: 'Seamless pattern tile', line: 'One exact repeat of a pattern, ready to tile across and down.', gives: 'SVG', speed: 'Seconds', cost: 'Free', type: 'trace', madeFor: 'pattern' },
  { id: 'border', group: 'copy', label: 'Border strip', line: 'One exact repeat of a border, ready to run to any length.', gives: 'SVG', speed: 'Seconds', cost: 'Free', type: 'trace', madeFor: 'border' },
  { id: 'remix', group: 'new', label: 'New vector inspired by it', line: 'A new drawing with the same subject, style and colors but its own shapes: a batch of butterflies comes back as new butterflies.', gives: 'SVG', speed: 'Minutes', cost: 'A few cents each', type: 'trace', madeFor: REMIX },
  { id: 'flat', group: 'new', label: 'New flat art for a frame, border, corner or ornament', line: 'New vector art made to fit a page, with the data that stretches it to any size.', gives: 'App package', speed: 'Minutes', cost: 'A few cents each', type: 'vector', madeFor: 'auto' },
  { id: 'illustration', group: 'new', label: 'Redraw in an art style', line: 'The picture redrawn in one of Talari\u2019s art styles and themes, its pose and layout kept.', gives: 'PNG or WebP', speed: 'A minute', cost: 'Free', type: 'illustration', madeFor: 'auto' },
];
/** The goal a result or the chosen options come from; a result made before the types were dropped has none. */
export const goalOf = (o: { type: OutputType | string; madeFor?: string }): Goal | undefined => GOALS.find((g) => g.type === o.type && (g.type === 'trace' ? g.madeFor === o.madeFor : true));
/** A short name for what a result was made as, for its tile. */
export const madeAs = (o: { type: OutputType | string; madeFor?: string }) => goalOf(o)?.label ?? typeInfo(o.type).label;

/** The one file a result is taken as, and the one other form worth a small link beside it. A vector comes as its SVG (as the app package where it has
 * fitting data: a frame, border, corner or tile); a cutout as WebP (or PNG); an illustration as the format it was made in. A vector's preview
 * picture is only for looking at, so it is never a download. */
export type MainFormat = 'package' | 'svg' | OutputFormat;
export function mainFile(r: { options: Pick<RestyleOptions, 'type' | 'madeFor' | 'format'>; files?: { svg?: string; layout?: string } | null }): { format: MainFormat; also?: MainFormat } {
  const o = r.options;
  if (cutoutOnly(o)) return { format: o.format, also: o.format === 'webp' ? 'png' : 'webp' };
  if (r.files?.svg) return r.files.layout ? { format: 'package', also: 'svg' } : { format: 'svg' };
  return { format: o.format };
}
export const FORMAT_LABEL: Record<MainFormat, string> = { package: 'App package', svg: 'SVG', png: 'PNG', webp: 'WebP', jpeg: 'JPEG' };

/** Whether a result can be taken as an app package (the SVG with its manifest): a flat SVG, or a trace. */
export const hasPackage = (r: Pick<RestyleResult, 'drawing' | 'traced' | 'files'>) => !!(r.files?.svg && (r.drawing || r.traced));

/** How far apart two of a traced picture's own colors must be (Lab distance) to stay two: a scan's browns that differ
 * only by the print's grain, or by the blend where a dark line meets them, become one. Tried on a printed Islamic
 * lattice: 12 left seven layers, 16 five, 20 its four colors. */
export const TRACE_MERGE = 20;
/** The most colors a trace starts from, before near ones are merged. */
export const TRACE_MAX_COLORS = 8;

export type Quality = 'auto' | 'fast' | 'standard' | 'high';
/** The pixel budget (a square of this side) and sampler steps of each quality. */
export const QUALITIES: { value: Exclude<Quality, 'auto'>; label: string; size: number; steps: number }[] = [
  { value: 'fast', label: 'Fast', size: 768, steps: 24 },
  { value: 'standard', label: 'Standard', size: 1024, steps: 32 },
  { value: 'high', label: 'High', size: 1280, steps: 48 },
];

/** How far the redrawing may move from the original: the sampler's denoise. An illustration is a variation of
 * the picture, which carries what it shows: 0.50 keeps its pose, face and main shapes and redraws the ornament and
 * detail (tried on a photographed bust, three seeds: 0.30 is a near copy, 0.60 and up starts to lose the subject, and
 * at 0.70 from a photo a bust became a man in a flight suit). */
export type Closeness = 'close' | 'balanced' | 'loose';
export const CLOSENESS: { value: Closeness; label: string; hint: string; denoise: number }[] = [
  { value: 'close', label: 'Closely', hint: "Keeps the original's shapes and layout.", denoise: 0.4 },
  { value: 'balanced', label: 'Balanced', hint: 'Keeps the layout and redraws the details.', denoise: 0.5 },
  { value: 'loose', label: 'Loosely', hint: 'Keeps the idea, with room for a new layout.', denoise: 0.6 },
];
/** The output types redrawn from half of the way or less (CLOSENESS): the picture carries what it shows, so the prompt does not
 * describe it (redrawn from most of the way, with the picture and no words for its subject, FLUX drew a skull and a heap of rocks). */
export const PICTURE_LED_TYPES: OutputType[] = ['illustration'];

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
  expressionism: { weight: 0.75 },
  fauvism: { weight: 0.5 },
  'neo-expressionism': { weight: 0.5 },
  impressionism: { weight: 0.75 },
  rococo: { weight: 1 },
  'realistic-anime': { weight: 0.75 },
};
/** The output types that use it. */
export const STYLE_REFERENCE_TYPES: OutputType[] = ['illustration'];
/** Whether this type and style are drawn with a reference picture. */
export const wantsStyleReference = (o: { type: OutputType; style: string }) => !!STYLE_REFERENCES[o.style] && STYLE_REFERENCE_TYPES.includes(o.type);

/** The ground a picture ends on. 'original' (none chosen) keeps the picture's own background: nothing is cut out, before
 * the redraw or after it (illustrations only). The others cut
 * the subject out and fill the rest, or leave it clear. */
export type Background = 'original' | 'transparent' | 'white' | 'black' | 'green';
/** What each ground is filled with, and called. Transparent has no fill, the original keeps its own. */
export const BACKGROUND_HEX: Record<Exclude<Background, 'original' | 'transparent'>, string> = { white: '#ffffff', black: '#000000', green: '#00ff00' };
export const BACKGROUND_LABEL: Record<Background, string> = { original: 'Keep the original', transparent: 'Transparent', white: 'White', black: 'Black', green: 'Green' };
/** drawn: the size ComfyUI draws at; original: the input's own size; 2 and 4: the drawn size enlarged. */
export type OutputSize = 'drawn' | 'original' | '2x' | '4x';
export type OutputFormat = 'png' | 'webp' | 'jpeg';

/** How far a trace evens out the wobble in its edges: none (the scan exactly), a little, or a lot (finer detail is lost). */
export type CleanUp = 'off' | 'light' | 'strong';
export const CLEANUPS: { value: CleanUp; label: string; hint: string }[] = [
  { value: 'off', label: 'None', hint: 'The scan’s edges exactly as they are, wobble and nicks included.' },
  { value: 'light', label: 'Light', hint: 'Small wobbles and nicks in the edges are evened out; the detail stays.' },
  { value: 'strong', label: 'Strong', hint: 'A hand-drawn or damaged scan made smooth and even; the finest detail is lost.' },
];

export interface RestyleOptions {
  type: OutputType;
  /** An art style or one of its substyles, by id; '' for none. */
  style: string;
  /** Each picture of a batch is drawn in the next style of the list (styleChoices), from the first, so the style chosen is not used. */
  rotateStyles: boolean;
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
  /** Redraw the whole figure from a picture of part of it (WHOLE_DENOISE), for illustrations. */
  whole: boolean;
  /** The shape of the canvas a whole figure is drawn on. */
  ratio: Ratio;
  /** A flat SVG: what it is made for (a frame, a border, a corner, a pattern, an object), which decides how it is drawn and what it must pass. */
  madeFor: Target | typeof REMIX;
  /** A trace made for an object: how far its edges are evened out. */
  cleanup: CleanUp;
}

export const DEFAULT_OPTIONS: RestyleOptions = {
  type: 'illustration', style: '', rotateStyles: false, theme: '', closeness: 'balanced', quality: 'auto', variations: 1,
  background: 'original', size: 'drawn', enhance: false, format: 'png', notes: '', whole: false, ratio: '2:3', madeFor: 'auto', cleanup: 'light',
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
  /** What it shows, in a phrase: read by the model for inputs added before illustrations were led by the picture alone. */
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
  /** A cutout: the ink it was cut in, how far it was turned to level it (degrees, 0 where it was level) and how much it was enlarged. */
  cutout?: { ink: string; tilt: number; enlarged: number };
  /** A trace: the colors its layers were traced in, dark to light; and for a pattern tile, how its repeat was found and cut. */
  traced?: { colors: string[]; tile?: TraceTile };
  /** Paths inside the data folder. `png` is the preview for a flat SVG; `layout` is its fitting data. */
  files?: { png: string; svg?: string; layout?: string; fitsheet?: string; thumb: string; view: string; original: string };
}

/** How a pattern tile was cut from its scan (the worker's `tile`). */
export interface TraceTile {
  /** The repeat found, in the scan's own pixels, and how its rows sit (half-drop: each row half a cell along, two motifs a cell). */
  cell: [number, number];
  lattice: 'grid' | 'half-drop' | 'strip';
  /** The degrees the scan was turned to level it. */
  tilt: number;
  /** How many copies of the repeat in the scan were averaged into the tile. */
  copies: number;
  /** How much more the colors change across the tile's edge than just inside it: about 1 is no seam. */
  seam: number;
  /** How alike the scan is to itself shifted one repeat across and down (0–1). */
  strength: [number, number];
}

/** The worst seam a tile may have and still be called seamless. */
export const TILE_SEAM_MAX = 1.5;
/** The weakest self-match (0–1) a tile's repeat may have before it is said to be a loose repeat. */
export const TILE_STRENGTH_MIN = 0.5;

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

/** Every style an output type offers, in the order its dropdown lists them: each art style, then its own substyles. */
export function styleChoices(type: OutputType): string[] {
  return CATALOG.artStyles.filter((a) => styleFits(type, a.id)).flatMap((a) => [a.id, ...a.substyles.map((s) => s.id)]);
}

/** The style for the nth picture of a batch when the styles rotate: the list in turn from the first, and from the first again at its end. */
export function rotatedStyle(type: OutputType, index: number): string {
  const list = styleChoices(type);
  return list.length ? list[((index % list.length) + list.length) % list.length] : '';
}

export const findTheme = (id: string) => CATALOG.themes.flatMap((g) => g.options).find((o) => o.id === id) ?? null;
/** An output type's info; a retired one's (a result made before it was dropped) is told by its old name, as drawn like an illustration. */
export const typeInfo = (type: string): OutputTypeInfo => OUTPUT_TYPES.find((t) => t.value === type)
  ?? { ...OUTPUT_TYPES[0], ...(RETIRED[type] ?? { label: String(type), vector: false }), hint: 'No longer offered', styles: null };
/** Whether a type is one that can still be drawn. */
export const isOffered = (type: string) => OUTPUT_TYPES.some((t) => t.value === type);
export const qualityOf = (o: Pick<RestyleOptions, 'type' | 'quality'>) => QUALITIES.find((q) => q.value === (o.quality === 'auto' ? typeInfo(o.type).quality : o.quality))!;

/** Options from a request, every field checked; what is not understood is left at its default. */
export function cleanOptions(raw: any): RestyleOptions {
  const o = { ...DEFAULT_OPTIONS };
  const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);
  o.type = pick(raw?.type, OUTPUT_TYPES.map((t) => t.value), o.type);
  o.style = typeof raw?.style === 'string' && styleFits(o.type, raw.style) ? raw.style : '';
  // only an illustration has a style to rotate; the rotation gives each picture its own, so none is chosen here
  o.rotateStyles = raw?.rotateStyles === true && PICTURE_LED_TYPES.includes(o.type);
  if (o.rotateStyles) o.style = '';
  o.theme = !drawnByModel(o) && !workerOnly(o) && typeof raw?.theme === 'string' && findTheme(raw.theme) ? raw.theme : '';
  o.closeness = pick(raw?.closeness, CLOSENESS.map((c) => c.value), o.closeness);
  o.quality = pick(raw?.quality, ['auto', 'fast', 'standard', 'high'] as const, o.quality);
  o.variations = Math.max(1, Math.min(4, Math.round(Number(raw?.variations) || 1)));
  o.background = pick(raw?.background, ['original', 'transparent', 'white', 'black', 'green'] as const, o.background);
  // a flat SVG has no ground of its own to keep, so it always has a choice (a trace may keep the picture's own ground, a scan's margin included)
  if (o.background === 'original' && !PICTURE_LED_TYPES.includes(o.type) && !tracedOnly(o)) o.background = 'transparent';
  // a cutout is a transparent picture, and comes as WebP or PNG
  if (cutoutOnly(o)) { o.background = 'transparent'; o.format = raw?.format === 'png' ? 'png' : 'webp'; }
  o.size = pick(raw?.size, ['drawn', 'original', '2x', '4x'] as const, o.size);
  o.enhance = raw?.enhance === true;
  if (!cutoutOnly(o)) o.format = pick(raw?.format, ['png', 'webp', 'jpeg'] as const, o.format);
  o.notes = typeof raw?.notes === 'string' ? raw.notes.trim().slice(0, 300) : '';
  // a trace is the same every time: one version
  o.whole = PICTURE_LED_TYPES.includes(o.type) && raw?.whole === true;
  o.ratio = pick(raw?.ratio, RATIOS.map((r) => r.value), o.ratio);
  o.cleanup = pick(raw?.cleanup, CLEANUPS.map((c) => c.value), o.cleanup);
  o.madeFor = o.type === 'vector' ? pick(raw?.madeFor, TARGETS.map((t) => t.value), 'auto')
    : o.type === 'trace' ? pick(raw?.madeFor, [...TRACE_TARGETS.map((t) => t.value), REMIX], 'object') : 'auto';
  // a trace and a cutout are the same every time: one version (a remix is a new drawing each time, so it may have several)
  if (workerOnly(o)) o.variations = 1;
  // a remix is drawn by a model, which has no theme; a vector (flat SVG or remix) is shown on a checkerboard and has no background to choose
  if (o.madeFor === REMIX) o.theme = '';
  if (drawnByModel(o)) o.background = 'transparent';
  return o;
}

export interface SettingRow { label: string; value: string }

const trim = (n: number) => String(Math.round(n * 1000) / 1000);
const COLOR_RULE_WORDS: Record<string, string> = { 'one-ink': 'one ink', neutral: 'a neutral grayscale base', full: 'full color' };
const SIZE_WORDS: Record<RestyleOptions['size'], string> = { drawn: 'as drawn', original: 'original size', '2x': '2× as drawn', '4x': '4× as drawn' };

/** A result's settings as the preview says them, in plain words. What was only recorded later is left
 * out of a result that predates it, never guessed. */
export function settingRows(r: Pick<RestyleResult, 'options' | 'settings' | 'seed' | 'size' | 'drawing'> & { traced?: RestyleResult['traced']; cutout?: RestyleResult['cutout'] }): SettingRow[] {
  const o = r.options;
  const s = r.settings;
  const q = qualityOf(o);
  const rows: SettingRow[] = [];
  if (drawnByModel(o)) {
    const d = r.drawing;
    if (d) {
      rows.push({ label: 'Drawn by', value: d.model });
      rows.push({ label: 'Renders', value: `${d.renders} of ${d.maxRenders} allowed` });
      // a model with no known price (a local or custom one) has no cost to show
      if (d.costUsd > 0) rows.push({ label: 'Cost', value: d.costUsd < 0.005 ? 'under 1¢' : `about ${(d.costUsd * 100).toFixed(d.costUsd < 0.1 ? 1 : 0)}¢` });
      rows.push({ label: 'Read as', value: `${d.kind}, ${COLOR_RULE_WORDS[d.colorMode] ?? d.colorMode}` });
      if (d.appReady) rows.push({ label: 'App-ready', value: d.appReady.ok ? `yes, all ${d.appReady.checks.length} checks pass` : `no: ${d.appReady.checks.filter((c) => !c.ok).map((c) => c.label.toLowerCase()).join(', ')}` });
    }
    if (o.madeFor === REMIX) rows.push({ label: 'Made as', value: REMIX_TARGET.label });
    else if (o.madeFor !== 'auto') rows.push({ label: 'Made for', value: TARGETS.find((t) => t.value === o.madeFor)?.label ?? o.madeFor });
    rows.push({ label: 'Background', value: BACKGROUND_LABEL[o.background] });
    if (r.size) rows.push({ label: 'Preview', value: `${o.format.toUpperCase()}, ${r.size[0]} × ${r.size[1]} px; the SVG is not pixel-sized` });
    return rows;
  }
  if (cutoutOnly(o)) {
    const c = r.cutout;
    rows.push({ label: 'Cut out as', value: `one ink${c ? ` (${c.ink})` : ''}, the background made clear; nothing is redrawn` });
    rows.push({ label: 'Clean up', value: CLEANUPS.find((x) => x.value === o.cleanup)?.label ?? 'Light' });
    if (c) {
      rows.push({ label: 'Straightened', value: Math.abs(c.tilt) < 0.1 ? 'it was level' : `turned ${Math.abs(c.tilt)}° ${c.tilt > 0 ? 'back' : 'the other way'} to level it` });
      if (c.enlarged > 1.05) rows.push({ label: 'Enlarged', value: `${c.enlarged}×, smoothly, so a small scan's edges stay crisp` });
    }
    if (r.size) rows.push({ label: 'Result', value: `${o.format.toUpperCase()}, transparent, ${r.size[0]} × ${r.size[1]} px` });
    return rows;
  }
  if (tracedOnly(o)) {
    rows.push({ label: 'Made for', value: TARGETS.find((t) => t.value === o.madeFor)?.label ?? o.madeFor });
    const t = r.traced?.tile;
    if (t) {
      rows.push({ label: 'Repeat found', value: t.lattice === 'strip'
        ? `one unit ${t.cell[0]} px long along the border (${t.cell[1]} px across), averaged from ${t.copies} copies of it`
        : `one tile of ${t.cell[0]} × ${t.cell[1]} px of the picture, ${t.lattice === 'half-drop' ? 'staggered (half-drop: each row half a tile along)' : 'straight (a grid)'}, averaged from ${t.copies} copies of it` });
      rows.push({ label: 'Straightened', value: Math.abs(t.tilt) < 0.1 ? 'it was level' : `turned ${Math.abs(t.tilt)}° ${t.tilt > 0 ? 'back' : 'the other way'} to level it` });
      rows.push({ label: 'Seam', value: t.seam <= TILE_SEAM_MAX ? 'none: the unit’s edges meet' : `visible (the colors change ${t.seam}× as much across the edge as inside it)` });
    }
    if (o.madeFor === 'object') rows.push({ label: 'Clean up', value: CLEANUPS.find((c) => c.value === o.cleanup)?.label ?? 'Light' });
    rows.push({ label: 'Traced as', value: `the picture's own shapes in ${r.traced ? `${r.traced.colors.length} flat colors` : 'a few flat colors'}, one SVG layer each; nothing is redrawn` });
    rows.push({ label: 'Background', value: o.background === 'original' ? 'kept as in the original, a scan\'s margin included' : `${BACKGROUND_LABEL[o.background]}; a scan's margin is cleared` });
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
