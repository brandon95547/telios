// A surface pattern's repeat cell: the rectangle that, copied across and down, makes the whole pattern. The worker's
// lattice (analyze.py) measures it on the scan; a scan almost never ends where the pattern does, so the tile to draw is
// this cell, not the scan's own shape. The model is told its aspect and how many of the motif it holds, and shown one
// cell of the original to draw from and to be compared with.

import path from 'node:path';
import sharp from 'sharp';

export interface Cell {
  /** How the rows sit: straight above one another, each row half a cell along (a staggered pattern holds two motifs a cell), or in bricks. */
  kind: 'grid' | 'half-drop' | 'brick';
  /** The cell as shares of the design's width and height. */
  wShare: number;
  hShare: number;
  /** Width over height. */
  aspect: number;
  /** How many of the pattern's motif centers a cell holds. */
  perCell: number;
  /** How many cells the scan holds across and down. */
  across: number;
  down: number;
}

/** The weakest self-match a lattice may have and still be trusted over the model's own eye. */
const MIN_STRENGTH = 0.3;

/** The cell the worker measured, or null where it found none, doubts it, or the scan shows less than one. `analysis` is the ingest's. */
export function cellOf(analysis: any): Cell | null {
  const l = analysis?.lattice;
  const bb = analysis?.bbox as number[] | undefined;
  if (!l?.cell || !bb || !(bb[2] > 0) || !(bb[3] > 0) || !(l.strength >= MIN_STRENGTH)) return null;
  const [cw, ch] = l.cell as number[];
  if (!(cw > 0) || !(ch > 0)) return null;
  const wShare = cw / bb[2], hShare = ch / bb[3];
  // less than one whole cell in the scan: there is nothing to cut
  if (wShare > 1.02 || hShare > 1.02) return null;
  const kind = (['grid', 'half-drop', 'brick'].includes(l.kind) ? l.kind : 'grid') as Cell['kind'];
  return { kind, wShare, hShare, aspect: cw / ch, perCell: Math.max(1, Math.round(l.perCell ?? 1)), across: bb[2] / cw, down: bb[3] / ch };
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** What the model is told about it, in the same terms as the other measurements (shares of the design). */
export function cellFacts(c: Cell) {
  return {
    cell: { widthShare: r3(c.wShare), heightShare: r3(c.hShare), aspect: r3(c.aspect) },
    lattice: c.kind,
    motifCentersPerCell: c.perCell,
    cellsInTheScan: { across: r1(c.across), down: r1(c.down) },
  };
}

/** One cell of the original, cut from the middle of the design (the scan's edges are the least reliable part), to `file`. */
export async function cutCell(cropPng: string, c: Cell, file: string) {
  const { width, height } = await sharp(cropPng).metadata();
  const w = Math.min(width!, Math.max(8, Math.round(c.wShare * width!)));
  const h = Math.min(height!, Math.max(8, Math.round(c.hShare * height!)));
  const left = Math.max(0, Math.round((width! - w) / 2)), top = Math.max(0, Math.round((height! - h) / 2));
  await sharp(cropPng).extract({ left, top, width: w, height: h }).png().toFile(file);
  return { file, width: w, height: h };
}

/** The words that say what canvas to draw: the cell's, not the scan's. */
export function tileInstruction(c: Cell) {
  const units = c.aspect >= 1 ? `${1800} wide by ${Math.round(1800 / c.aspect)} high` : `${Math.round(1800 * c.aspect)} wide by ${1800} high`;
  const where = c.perCell === 1 ? 'one motif center in it' : c.kind === 'half-drop' && c.perCell === 2
    ? 'two motif centers in it: one on the corners (the four corners are quarters of the same motif) and one in the middle, so each row sits half a cell along from the next'
    : `${c.perCell} motif centers in it`;
  return `Return layout.form 'tile', lattice '${c.kind}'. The tile is ONE CELL of the pattern, not the scan: the scan is cropped where its page ended and holds about ${r1(c.across)} cells across and ${r1(c.down)} down, so drawing its whole shape would not repeat. The cell's shape is ${r3(c.aspect)} (width over height); make the canvas that shape, about ${units} design units, with ${where}. The cell of the original, cut from the middle of the scan, is the image shown after the original. Whatever leaves one edge comes back at the opposite edge.`;
}

export const cellFile = (dir: string) => path.join(dir, 'cell.png');
