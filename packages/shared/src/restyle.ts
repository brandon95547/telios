// Restyle: pictures (clip art, frames, ornaments, anything) redrawn by ComfyUI in a type, an art
// style and a theme the user picks. The choices, and the data kept about each input and result.

import { CATALOG } from './catalog.ts';

export { CATALOG };

/** What a picture is redrawn as. Clip art and line art come back as SVG too. */
export type OutputType = 'clipart' | 'lineart' | 'illustration' | 'render3d';

export interface OutputTypeInfo {
  value: OutputType;
  label: string;
  group: '2D' | '3D';
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
];

export type Quality = 'auto' | 'fast' | 'standard' | 'high';
/** The pixel budget (a square of this side) and sampler steps of each quality. */
export const QUALITIES: { value: Exclude<Quality, 'auto'>; label: string; size: number; steps: number }[] = [
  { value: 'fast', label: 'Fast', size: 768, steps: 16 },
  { value: 'standard', label: 'Standard', size: 1024, steps: 20 },
  { value: 'high', label: 'High', size: 1280, steps: 28 },
];

/** How far the redrawing may move from the original: the sampler's denoise, for each type.
 * Clip art and 3D change how everything is drawn (a gray engraving becomes flat color), so they
 * need more room than line art, which keeps the drawing and only cleans it. Tried on prod's
 * FLUX.1 Dev (Q4_K_S, 16 steps) with scans of engraved frames. */
export type Closeness = 'close' | 'balanced' | 'loose' | 'whole';
export const CLOSENESS: { value: Closeness; label: string; hint: string; denoise: Record<OutputType, number> }[] = [
  { value: 'close', label: 'Closely', hint: "Keeps the original's shapes and layout.", denoise: { clipart: 0.8, lineart: 0.65, illustration: 0.6, render3d: 0.75 } },
  { value: 'balanced', label: 'Balanced', hint: 'Keeps the layout and redraws the details.', denoise: { clipart: 0.88, lineart: 0.75, illustration: 0.75, render3d: 0.85 } },
  { value: 'loose', label: 'Loosely', hint: 'Keeps the idea, with room for a new layout.', denoise: { clipart: 0.94, lineart: 0.85, illustration: 0.88, render3d: 0.92 } },
  // Draws a new subject from what the picture shows, with room round it, so a head or figure the
  // original cuts off at its edge comes out whole instead of cut off again. Tried on prod's FLUX:
  // a close-up crop padded 35% with white at 0.92 gave a complete head and hair on a clean ground.
  { value: 'whole', label: 'Draw it whole', hint: 'If the original is cut off (a head or a figure at the edge of the picture), draws a new, complete character or scene, not a copy of the crop.', denoise: { clipart: 0.94, lineart: 0.92, illustration: 0.92, render3d: 0.92 } },
];
/** How much white is added round a picture drawn whole, as a share of its longer side, each side. */
export const WHOLE_PAD = 0.35;

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

export type Background = 'transparent' | 'white' | 'black';
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
}

export const DEFAULT_OPTIONS: RestyleOptions = {
  type: 'clipart', style: '', medium: '', theme: '', closeness: 'balanced', quality: 'auto', variations: 1,
  background: 'transparent', size: 'drawn', enhance: false, format: 'png', notes: '',
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
  /** What it shows described as a complete subject (colors and all), for Draw it whole. */
  subjectWhole?: string;
}

export type ResultStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled';

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
  error?: string;
  /** Something the result is not, that was asked for: drawn on white, the background not cleared. */
  warning?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  seed?: number;
  prompt?: string;
  size?: [number, number];
  /** Paths inside the data folder. */
  files?: { png: string; svg?: string; thumb: string; view: string; original: string };
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
  o.theme = typeof raw?.theme === 'string' && findTheme(raw.theme) ? raw.theme : '';
  o.closeness = pick(raw?.closeness, CLOSENESS.map((c) => c.value), o.closeness);
  o.quality = pick(raw?.quality, ['auto', 'fast', 'standard', 'high'] as const, o.quality);
  o.variations = Math.max(1, Math.min(4, Math.round(Number(raw?.variations) || 1)));
  o.background = pick(raw?.background, ['transparent', 'white', 'black'] as const, o.background);
  o.size = pick(raw?.size, ['drawn', 'original', '2x', '4x'] as const, o.size);
  o.enhance = raw?.enhance === true;
  o.format = pick(raw?.format, ['png', 'webp', 'jpeg'] as const, o.format);
  o.notes = typeof raw?.notes === 'string' ? raw.notes.trim().slice(0, 300) : '';
  return o;
}
