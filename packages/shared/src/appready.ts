// What a drawn piece is made for, and what it must pass to go into an app as it is ("app-ready"): shared
// by the engine (which checks every render), the job that makes a flat SVG, and the screens.

import type { Kind } from './types.ts';

/** What a Flat SVG is made for. Auto: the model reads what the picture is, as it always did. */
export type Target = 'auto' | 'frame' | 'border' | 'corner' | 'pattern' | 'object';

export const TARGETS: { value: Target; label: string; hint: string }[] = [
  { value: 'auto', label: 'Let it decide', hint: 'The model reads what the picture is: a frame, a border, a corner, a pattern or an object.' },
  { value: 'frame', label: 'Frame', hint: 'Goes all round a page: drawn on a square master that fits every page size, with its fitting data.' },
  { value: 'border', label: 'Border', hint: 'A strip that repeats to any length.' },
  { value: 'corner', label: 'Corner', hint: 'One corner piece.' },
  { value: 'pattern', label: 'Pattern tile', hint: 'One tile of a surface that repeats seamlessly.' },
  { value: 'object', label: 'Object', hint: 'Anything drawn whole: a flower, an animal, a thing, a sign, an ornament, a letter.' },
];

/** How a piece is drawn and checked: a frame, a border, a corner, a tile, or an object (anything drawn whole). */
export type PieceClass = 'frame' | 'border' | 'corner' | 'tile' | 'object';

export const classOf = (kind: Kind): PieceClass => (({ frame: 'frame', border: 'border', corner: 'corner', pattern: 'tile' }) as Partial<Record<Kind, PieceClass>>)[kind] ?? 'object';

/** The kind a picture is drawn as: what the model read, unless the user said what it is made for. */
export function kindFor(target: Target | undefined, read: Kind): Kind {
  switch (target) {
    case 'frame': return 'frame';
    case 'border': return 'border';
    case 'corner': return 'corner';
    case 'pattern': return 'pattern';
    case 'object': return classOf(read) === 'object' ? read : 'ornament';
    default: return read;
  }
}

/** How many flat colors a piece may have: a border or a pattern tile at most three, which an app lets its author recolor as a primary, a secondary and an accent; a frame, a corner or an object, eight. */
export const FEW_COLORS = 3;
export const MAX_COLORS = 8;
export const colorsFor = (piece: PieceClass) => (piece === 'border' || piece === 'tile' ? FEW_COLORS : MAX_COLORS);

/** What each color of a border or a tile is called, by the area it covers: the most is Primary, the next Secondary, the least Accent (a lone color is Color). `shares` is the area of each, in any order; the names come back in the same order. */
export function roleNames(shares: number[]): string[] {
  if (shares.length === 1) return ['Color'];
  const roles = ['Primary', 'Secondary', 'Accent'];
  const names: string[] = new Array(shares.length).fill('');
  [...shares.keys()].sort((a, b) => shares[b] - shares[a]).forEach((i, n) => { names[i] = roles[n] ?? `Color ${n + 1}`; });
  return names;
}

/** A frame's master is square, about this many design units a side: it fits every page size, square and landscape too. */
export const FRAME_MASTER = 1800;

/** The twelve trims a book comes in, [width, height] in inches: a frame must fit every one. */
export const TRIMS: [number, number][] = [[6, 9], [5.5, 8.5], [8.5, 11], [5, 8], [4.25, 6.87], [8, 10], [8, 8], [7, 10], [11, 8.5], [8.5, 8.5], [9, 12], [6, 6]];

/** How far a repeating unit may be eased, along its length, to fill an edge: outside this a flower turns into an oval. */
export const EASING: [number, number] = [0.78, 1.3];

/** A drawn piece's layered SVG is kept under this many bytes: the heaviest frames in Talari's library (shaded relief in eight grays) are about 3.5 MB as drawn, about 2.2 MB shrunk, and a few hundred KB on the wire. */
export const MAX_SVG_BYTES = 4 * 1024 * 1024;

/** One thing a piece must pass, in a sentence a person can read, and the model can act on. */
export interface AppCheck {
  id: 'clip' | 'layout' | 'fit' | 'seam' | 'window' | 'thin' | 'palette' | 'background' | 'size';
  label: string;
  ok: boolean;
  detail: string;
}

export interface AppReport {
  piece: PieceClass;
  /** Every check passed. */
  ok: boolean;
  checks: AppCheck[];
}

export const reportOk = (checks: AppCheck[]) => checks.every((c) => c.ok);
