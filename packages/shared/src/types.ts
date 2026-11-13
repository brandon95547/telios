// The data Telios keeps about a design and its runs, shared by the API, the job worker and the web app.

import type { AppReport } from './appready.ts';

export type Kind = 'frame' | 'border' | 'corner' | 'ornament' | 'pattern' | 'initial' | 'other';
export type Rendering = 'flat' | 'shaded';
/** The user's color rule: one ink stays one ink; a neutral grayscale base where color stands for a
 * material or finish (gilding, wood, stone); full color where color is part of the art. */
export type ColorMode = 'one-ink' | 'neutral' | 'full';
export type Symmetry = 'none' | 'mirror-x' | 'mirror-y' | 'four-way' | 'rotational';
export type RepeatAxis = 'none' | 'edges' | 'x' | 'y' | 'lattice';

export const KINDS: { value: Kind; label: string; hint: string }[] = [
  { value: 'frame', label: 'Frame', hint: 'Goes all round a page or panel: corners, repeating edges, a window' },
  { value: 'border', label: 'Border', hint: 'A band or strip that repeats along its length' },
  { value: 'corner', label: 'Corner', hint: 'One corner piece' },
  { value: 'ornament', label: 'Ornament', hint: 'A motif drawn whole: rosette, cartouche, vignette, medallion' },
  { value: 'pattern', label: 'Pattern tile', hint: 'A surface that repeats in two directions' },
  { value: 'initial', label: 'Initial', hint: 'A decorated letter' },
  { value: 'other', label: 'Other', hint: 'Anything else, drawn whole' },
];

export const COLOR_MODES: { value: ColorMode; label: string; hint: string }[] = [
  { value: 'one-ink', label: 'One ink', hint: 'A woodcut or engraving: stays its ink (carved lines get their own color)' },
  { value: 'neutral', label: 'Neutral base', hint: 'Color stands for a material or finish you choose: drawn in grays' },
  { value: 'full', label: 'Full color', hint: 'Color is part of the art: the palette is kept' },
];

export interface PaletteColor {
  hex: string;
  name: string;
}

export interface Reading {
  kind: Kind;
  rendering: Rendering;
  colorMode: ColorMode;
  /** Why this color rule, in a sentence. */
  colorReason: string;
  /** For a neutral base: the material the color stood for (gilding, silver, wood…). */
  material: string;
  /** Light lines cut out of a solid ink, which get their own color and layer. */
  carvedLines: boolean;
  symmetry: Symmetry;
  repeats: {
    axis: RepeatAxis;
    /** What repeats, in words: "a diamond chain, about 17 units along each side". */
    description: string;
    /** About how many units along the long side (frames, borders), if it repeats. */
    count: number | null;
  };
  palette: PaletteColor[];
  /** The anatomy: bands, corners, a kept middle, the window… */
  structure: string;
  motifs: string;
  style: string;
  /** What is in the image but not part of the design: a scene in the window, text, a page number. */
  leaveOut: string;
  /** How to redraw it, in a few sentences. */
  plan: string;
  confidence: number;
  /** Who read it: a model looking at the image, or the measurements alone. */
  source: 'model' | 'measurements';
  confirmed: boolean;
}

export interface Layout {
  form: 'frame' | 'border' | 'corner' | 'tile' | 'whole';
  size: [number, number];
  /** Frames: how far the corners reach in, one value or [across, down]. */
  slice?: number | [number, number];
  /** Frames: an ornament in the middle of the top and bottom edges (x) or the sides (y), drawn whole. */
  keep?: { x?: [number, number]; y?: [number, number] };
  /** One repeating unit of the top and bottom edges (x) and of the sides (y); a border's along x. */
  repeat?: { x?: [number, number]; y?: [number, number] };
  corner?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  lattice?: 'grid' | 'half-drop' | 'brick';
}

export type DesignStatus = 'ingesting' | 'reading' | 'ready' | 'failed';

export interface Design {
  id: string;
  name: string;
  createdAt: string;
  original: { file: string; type: string; bytes: number; page?: number };
  status: DesignStatus;
  error?: string;
  /** Pixel size of source.png. */
  size?: [number, number];
  reading?: Reading;
  runs: string[];
  /** The Restyle result (a flat SVG) this design was made for: it is kept out of the library, and
   * goes when the result does. */
  fromResult?: string;
}

/** rebuild: cleaned and regularized from the upload, no model; reillustrate: drawn new by a
 * model; trace: the upload traced as it is. */
export type RunMode = 'rebuild' | 'reillustrate' | 'trace';
export type RunStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled' | 'interrupted';
export type Stage = 'queued' | 'plan' | 'draw' | 'critique' | 'vectorize' | 'done';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export interface Iteration {
  n: number;
  at: string;
  ok: boolean;
  error?: string;
  notes: string;
  files: { render?: string; compare?: string; unitcheck?: string; fitcheck?: string; program?: string; drawing?: string };
  checks?: Checks;
}

export interface Checks {
  size: [number, number];
  palette: PaletteColor[];
  offPalette: number;
  symmetry?: { lr: number; tb: number };
  similarity?: number;
  warnings: string[];
  /** What the piece must pass to go into an app as it is: measured on this render. */
  appReady?: AppReport;
}

export interface LayerInfo {
  id: string;
  color: string;
  name: string;
  share: number;
}

export interface RunResult {
  size: [number, number];
  layers: LayerInfo[];
  layout: Layout | null;
  palette: PaletteColor[];
  summary: string;
  /** What Rebuild found and did, a sentence each. */
  notes?: string[];
  colorMode: ColorMode;
  /** The final piece against the app-ready checks (a drawing made by a model). */
  appReady?: AppReport;
  files: { drawing: string; layered: string; preview: string; compare?: string; program?: string; layout?: string; unitcheck?: string; fitcheck?: string; fitsheet?: string };
}

export interface Run {
  id: string;
  designId: string;
  mode: RunMode;
  status: RunStatus;
  stage: Stage;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** model: the provider and model of a re-illustration ('' for Rebuild and Trace). */
  options: { maxRenders: number; model: string; effort: string; note?: string };
  reading: Reading;
  iterations: Iteration[];
  usage: Usage;
  result?: RunResult;
  error?: string;
}

/** What the job worker tells the browser while a run goes, in order. */
export type RunEvent =
  | { type: 'status'; status: RunStatus; stage: Stage; message?: string }
  | { type: 'note'; text: string }
  /** Live only, not kept: what the model is doing right now. */
  | { type: 'progress'; message: string }
  | { type: 'iteration'; iteration: Iteration }
  | { type: 'usage'; usage: Usage }
  | { type: 'result'; result: RunResult }
  | { type: 'error'; message: string };
