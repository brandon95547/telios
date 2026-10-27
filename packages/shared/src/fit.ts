// Fitting a piece to any page or length, never stretched or turned (stage 7 of the process).
//
// A frame keeps its four corners as drawn; each edge is the lead after the corner, as many whole
// repeating units as come closest to their own length (each eased by at most about a fifth, and
// only along the edge), the tail, the kept middle, then the mirror image of the first half. A
// border is a strip: its caps and whole units. Everything works in the art's own units: the page
// is first scaled so the art fits it by its smaller ratio, which makes the page at least as large
// as the art on both axes.

import type { Layout } from './types.ts';

/** A stretch of the art [from, to] drawn at [at, at + length] on the target. */
export interface Piece {
  src: [number, number];
  dst: [number, number];
}

/** How many whole units of length `unit` best fill `room` (compared on a log scale), at least one. */
export function unitCount(room: number, unit: number): number {
  if (unit <= 0 || room <= 0) return 0;
  const n0 = Math.max(1, Math.floor(room / unit));
  let best = n0, bestErr = Infinity;
  for (const n of [n0 - 1, n0, n0 + 1]) {
    if (n < 1) continue;
    const err = Math.abs(Math.log(room / n / unit));
    if (err < bestErr) { best = n; bestErr = err; }
  }
  return best;
}

const mirror = (p: Piece, L: number, T: number): Piece => ({ src: [L - p.src[1], L - p.src[0]], dst: [T - p.dst[1], T - p.dst[0]] });

/**
 * The pieces that take one axis of the art, length L, to length T (T ≥ L), with corners reaching
 * `corner` in, an optional kept middle and an optional repeating unit. Without a unit the plain
 * middle is stretched, as a frame that can't repeat must be.
 */
export function axisPieces(L: number, T: number, corner: number, keep?: [number, number], unit?: [number, number]): Piece[] {
  if (Math.abs(T - L) < 1e-6) return [{ src: [0, L], dst: [0, T] }];
  if (!unit) {
    const c = Math.min(corner, L / 2);
    return [
      { src: [0, c], dst: [0, c] },
      { src: [c, L - c], dst: [c, T - c] },
      { src: [L - c, L], dst: [T - c, T] },
    ];
  }
  const [r0, r1] = unit;
  const u = r1 - r0;
  if (keep) {
    const [k0, k1] = keep;
    const halfKeep = (k1 - k0) / 2;
    const room = T / 2 - halfKeep - r0 - (k0 - r1);
    const n = unitCount(room, u);
    const each = room / n;
    const first: Piece[] = [{ src: [0, r0], dst: [0, r0] }];
    for (let i = 0; i < n; i++) first.push({ src: [r0, r1], dst: [r0 + i * each, r0 + (i + 1) * each] });
    const tailAt = r0 + n * each;
    first.push({ src: [r1, k0], dst: [tailAt, tailAt + (k0 - r1)] });
    const middle: Piece = { src: [k0, k1], dst: [T / 2 - halfKeep, T / 2 + halfKeep] };
    return [...first, middle, ...first.map((p) => mirror(p, L, T)).reverse()];
  }
  const room = T - r0 - (L - r1);
  const n = unitCount(room, u);
  const each = room / n;
  const out: Piece[] = [{ src: [0, r0], dst: [0, r0] }];
  for (let i = 0; i < n; i++) out.push({ src: [r0, r1], dst: [r0 + i * each, r0 + (i + 1) * each] });
  out.push({ src: [r1, L], dst: [T - (L - r1), T] });
  return out;
}

export const sliceOf = (layout: Layout): [number, number] => {
  const s = layout.slice ?? Math.min(...layout.size) / 4;
  return Array.isArray(s) ? s : [s, s];
};

/** The art's scale on a page of w × h, and the page's size in the art's units. */
export function pageInArtUnits(layout: Layout, w: number, h: number) {
  const [W, H] = layout.size;
  const scale = Math.min(w / W, h / H);
  return { scale, T: [w / scale, h / scale] as [number, number] };
}

export interface Cell {
  src: [number, number, number, number];
  dst: [number, number, number, number];
}

const fmt = (n: number) => +n.toFixed(3);
/** The namespaces a placed piece may use: a layered SVG labels its groups as Inkscape layers. */
const NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"';

/** A frame fitted to a page of w × h (any units): the cells to draw, in the art's units. */
export function frameCells(layout: Layout, w: number, h: number): { T: [number, number]; scale: number; cells: Cell[] } {
  const [W, H] = layout.size;
  const { scale, T } = pageInArtUnits(layout, w, h);
  const [sx, sy] = sliceOf(layout);
  const xs = axisPieces(W, T[0], sx, layout.keep?.x, layout.repeat?.x);
  const ys = axisPieces(H, T[1], sy, layout.keep?.y, layout.repeat?.y);
  const cells: Cell[] = [];
  // the head and the foot run the full width, corners included
  for (const p of xs) {
    cells.push({ src: [p.src[0], 0, p.src[1] - p.src[0], sy], dst: [p.dst[0], 0, p.dst[1] - p.dst[0], sy] });
    cells.push({ src: [p.src[0], H - sy, p.src[1] - p.src[0], sy], dst: [p.dst[0], T[1] - sy, p.dst[1] - p.dst[0], sy] });
  }
  // the sides between them
  for (const p of ys) {
    const a = Math.max(p.dst[0], sy), b = Math.min(p.dst[1], T[1] - sy);
    if (b - a <= 1e-6) continue;
    const k = (p.src[1] - p.src[0]) / (p.dst[1] - p.dst[0]);
    const s0 = p.src[0] + (a - p.dst[0]) * k, s1 = p.src[0] + (b - p.dst[0]) * k;
    cells.push({ src: [0, s0, sx, s1 - s0], dst: [0, a, sx, b - a] });
    cells.push({ src: [W - sx, s0, sx, s1 - s0], dst: [T[0] - sx, a, sx, b - a] });
  }
  return { T, scale, cells };
}

/** A border fitted to a length (in the art's units): its cells along x at the art's height. */
export function borderCells(layout: Layout, length: number): { T: [number, number]; cells: Cell[] } {
  const [W, H] = layout.size;
  const T = Math.max(length, W);
  const xs = layout.repeat?.x ? axisPieces(W, T, 0, undefined, layout.repeat.x) : axisPieces(W, T, W / 4);
  return { T: [T, H], cells: xs.map((p) => ({ src: [p.src[0], 0, p.src[1] - p.src[0], H], dst: [p.dst[0], 0, p.dst[1] - p.dst[0], H] })) };
}

/**
 * An SVG of the art laid out in cells: `art` is the art's own SVG text. Each cell is a nested
 * viewport that shows only its stretch of the art, so units meet edge to edge.
 */
export function composeCells(art: string, artSize: [number, number], T: [number, number], cells: Cell[], prefix = 'fit'): string {
  const { inner, viewBox } = namespaceSvg(art, prefix);
  const symbol = `<symbol id="${prefix}-art" viewBox="${viewBox}" overflow="visible">${inner}</symbol>`;
  const body = cells.map((c) => `<svg x="${fmt(c.dst[0])}" y="${fmt(c.dst[1])}" width="${fmt(c.dst[2])}" height="${fmt(c.dst[3])}" viewBox="${fmt(c.src[0])} ${fmt(c.src[1])} ${fmt(c.src[2])} ${fmt(c.src[3])}" preserveAspectRatio="none" overflow="hidden"><use href="#${prefix}-art" width="${artSize[0]}" height="${artSize[1]}"/></svg>`).join('');
  return `<svg ${NS} width="${fmt(T[0])}" height="${fmt(T[1])}" viewBox="0 0 ${fmt(T[0])} ${fmt(T[1])}"><defs>${symbol}</defs>${body}</svg>`;
}

/** A tile repeated cols × rows on its lattice. */
export function tileSvg(art: string, size: [number, number], cols: number, rows: number, lattice: Layout['lattice'] = 'grid', prefix = 'tile'): string {
  const [w, h] = size;
  const { inner, viewBox } = namespaceSvg(art, prefix);
  const uses: string[] = [];
  for (let r = -1; r <= rows; r++) for (let c = -1; c <= cols; c++) {
    const x = c * w + (lattice === 'brick' && r % 2 ? w / 2 : 0);
    const y = r * h + (lattice === 'half-drop' && c % 2 ? h / 2 : 0);
    uses.push(`<use href="#${prefix}-art" x="${fmt(x)}" y="${fmt(y)}" width="${w}" height="${h}"/>`);
  }
  return `<svg ${NS} width="${cols * w}" height="${rows * h}" viewBox="0 0 ${cols * w} ${rows * h}"><defs><symbol id="${prefix}-art" viewBox="${viewBox}" overflow="visible">${inner}</symbol></defs>${uses.join('')}</svg>`;
}

/** The inside of an SVG document with every id (and every reference to one) prefixed, so several
 * copies can share a page, plus its viewBox. */
export function namespaceSvg(svg: string, prefix: string): { inner: string; viewBox: string; width: number; height: number } {
  const open = svg.match(/<svg\b[^>]*>/i);
  if (!open) throw new Error('not an SVG document');
  const attr = (name: string) => open[0].match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
  const width = parseFloat(attr('width') ?? '0');
  const height = parseFloat(attr('height') ?? '0');
  const viewBox = attr('viewBox') ?? `0 0 ${width} ${height}`;
  const start = (open.index ?? 0) + open[0].length;
  const end = svg.lastIndexOf('</svg>');
  let inner = svg.slice(start, end);
  inner = inner
    .replace(/\sid="([^"]+)"/g, ` id="${prefix}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${prefix}-$1)`)
    .replace(/(\s(?:xlink:)?href=")#([^"]+)"/g, `$1#${prefix}-$2"`);
  return { inner, viewBox, width: width || +viewBox.split(/[\s,]+/)[2], height: height || +viewBox.split(/[\s,]+/)[3] };
}

/** An SVG with each palette color swapped for its replacement (fills, strokes, stop colors, styles). */
export function recolor(svg: string, map: Record<string, string>): string {
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  if (!Object.keys(lower).length) return svg;
  return svg.replace(/#[0-9a-fA-F]{6}\b/g, (m) => lower[m.toLowerCase()] ?? m);
}
