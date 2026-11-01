// Where a drawing sits against the original, measured, so the model fixes position and proportion with numbers and
// not by eye. Both are cut into a coarse grid and each cell given the nearest of the drawing's palette colors: how many cells
// agree, how much of each color each has, and which regions agree least. A third picture lays the original's edges
// (red) over the drawing. It only applies where the drawing keeps the original's shape (a tile is drawn on a cell cut
// from the scan, so it does). A repeating tile may start anywhere in the repeat, so for a tile the original is first
// slid (round the edges: the pattern wraps) to where it agrees most, and only what is still different counts.

import sharp from 'sharp';

/** How coarse the comparison is: cells across. A grid this size blurs fine line-work away, so what it compares is where the
 * colors lie, which is the layout. */
const GRID_W = 96;
/** The most the two shapes may differ (width over height) for the comparison to mean anything. */
const SAME_SHAPE = 0.08;
/** The share of the original's strongest edges drawn. */
const EDGE_SHARE = 0.07;

export interface PaletteName { hex: string; name?: string }
export interface Overlay {
  /** The drawing with the original's edges in red over it. */
  panel: Buffer;
  /** Plain words for the model: agreement, the color shares and the regions that agree least. */
  report: string;
  /** The share of grid cells that have the same color in both, 0–1. */
  agreement: number;
}

const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const pct = (v: number) => `${Math.round(v * 100)}%`;

async function cellsOf(png: Buffer, w: number, h: number) {
  return sharp(png).flatten({ background: '#ffffff' }).resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).removeAlpha().raw().toBuffer();
}

/** Each cell's nearest palette color, by index. */
export function classify(raw: Buffer, palette: number[][]) {
  const out = new Uint8Array(raw.length / 3);
  for (let i = 0; i < out.length; i++) {
    const r = raw[i * 3], g = raw[i * 3 + 1], b = raw[i * 3 + 2];
    let best = 0, bd = Infinity;
    for (let k = 0; k < palette.length; k++) {
      const d = (r - palette[k][0]) ** 2 + (g - palette[k][1]) ** 2 + (b - palette[k][2]) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    out[i] = best;
  }
  return out;
}

/** The original's classes slid by (dx, dy) cells, round the edges. */
export function roll(a: Uint8Array, w: number, h: number, dx: number, dy: number) {
  const out = new Uint8Array(a.length);
  for (let y = 0; y < h; y++) {
    const sy = (((y - dy) % h) + h) % h;
    for (let x = 0; x < w; x++) out[y * w + x] = a[sy * w + ((((x - dx) % w) + w) % w)];
  }
  return out;
}

const agree = (a: Uint8Array, b: Uint8Array) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] === b[i]) n++; return n / a.length; };

/** The slide (in cells) that makes the original agree most with the drawing, searched coarsely and then refined. */
export function bestSlide(orig: Uint8Array, drew: Uint8Array, w: number, h: number, coarse?: { orig: Uint8Array; drew: Uint8Array; w: number; h: number }) {
  let sx = 0, sy = 0;
  const search = (o: Uint8Array, d: Uint8Array, cw: number, ch: number, xs: number[], ys: number[]) => {
    let best = -1, bx = 0, by = 0;
    for (const dy of ys) for (const dx of xs) { const sc = agree(roll(o, cw, ch, dx, dy), d); if (sc > best) { best = sc; bx = dx; by = dy; } }
    return [bx, by];
  };
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);
  if (coarse) {
    const [cx, cy] = search(coarse.orig, coarse.drew, coarse.w, coarse.h, range(coarse.w), range(coarse.h));
    sx = Math.round((cx * w) / coarse.w); sy = Math.round((cy * h) / coarse.h);
    const near = (c: number) => [-2, -1, 0, 1, 2].map((d) => c + d);
    [sx, sy] = search(orig, drew, w, h, near(sx), near(sy));
  } else [sx, sy] = search(orig, drew, w, h, range(w), range(h));
  return { dx: ((sx % w) + w) % w, dy: ((sy % h) + h) % h };
}

const zoneOf = (row: number, rows: number) => (row < rows / 3 ? 'top' : row >= (2 * rows) / 3 ? 'bottom' : 'middle');
const SIDES = ['left', 'left-center', 'right-center', 'right'];

/** The words of the comparison, from each side's classified cells. */
export function overlayReport(orig: Uint8Array, drew: Uint8Array, w: number, h: number, names: string[]) {
  const n = orig.length;
  let same = 0;
  const share = (a: Uint8Array) => { const c = new Array(names.length).fill(0); for (const v of a) c[v]++; return c.map((x) => x / n); };
  for (let i = 0; i < n; i++) if (orig[i] === drew[i]) same++;
  const agreement = same / n;
  const so = share(orig), sd = share(drew);
  const cols = 4, rows = Math.min(8, Math.max(3, Math.round((cols * h) / w)));
  const blocks: { score: number; zone: string; col: number; was: string; is: string }[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x0 = Math.floor((c * w) / cols), x1 = Math.floor(((c + 1) * w) / cols), y0 = Math.floor((r * h) / rows), y1 = Math.floor(((r + 1) * h) / rows);
    let ok = 0, tot = 0;
    const co = new Array(names.length).fill(0), cd = new Array(names.length).fill(0);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * w + x; tot++; if (orig[i] === drew[i]) ok++; co[orig[i]]++; cd[drew[i]]++; }
    const top = (a: number[]) => names[a.indexOf(Math.max(...a))];
    if (tot) blocks.push({ score: ok / tot, zone: zoneOf(r, rows), col: c, was: top(co), is: top(cd) });
  }
  // blocks in the same third of the height with the same mix-up are one finding, across however many columns
  const groups = new Map<string, { zone: string; was: string; is: string; cols: number[]; scores: number[] }>();
  for (const b of blocks.filter((x) => x.score < 0.8)) {
    const key = `${b.zone}|${b.was}|${b.is}`;
    const g = groups.get(key) ?? { zone: b.zone, was: b.was, is: b.is, cols: [], scores: [] };
    g.cols.push(b.col); g.scores.push(b.score);
    groups.set(key, g);
  }
  const worst = [...groups.values()].map((g) => ({ ...g, score: g.scores.reduce((a, v) => a + v, 0) / g.scores.length, n: g.cols.length, across: [...new Set(g.cols)].sort() }))
    .sort((a, b) => b.n * (1 - b.score) - a.n * (1 - a.score)).slice(0, 3);
  const spanOf = (cs: number[]) => cs.map((c) => SIDES[c] ?? `column ${c + 1}`).join(', ');
  const shares = names.map((nm, k) => `${nm} ${pct(so[k])} → ${pct(sd[k])}`).join(', ');
  const lines = [
    `Layout against the original (colors compared in a ${w}-cell-wide grid, so fine line-work does not count, only where the colors lie): ${pct(agreement)} of the cells match.`,
    `Share of each color, original → yours: ${shares}.`,
    worst.length
      ? `Least alike: ${worst.map((b) => `${b.zone} (${b.across.length === cols ? 'all across' : spanOf(b.across)}; ${pct(b.score)} match; mostly ${b.was} in the original, mostly ${b.is} in yours)`).join('; ')}.`
      : 'No region is far off.',
  ];
  return { agreement, report: lines.join('\n') };
}

/** The drawing with the original's strongest edges in red over it, `height` px high. */
async function edgePanel(reference: Buffer, drawing: Buffer, height: number, slide: { x: number; y: number } = { x: 0, y: 0 }) {
  const meta = await sharp(drawing).metadata();
  const width = Math.max(8, Math.round((height * meta.width!) / meta.height!));
  const base = await sharp(drawing).flatten({ background: '#ffffff' }).resize(width, height, { fit: 'fill' }).png().toBuffer();
  const gray = await sharp(reference).flatten({ background: '#ffffff' }).resize(width, height, { fit: 'fill' }).greyscale().blur(2.2).raw().toBuffer();
  const mag = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x;
    const gx = gray[i - width + 1] + 2 * gray[i + 1] + gray[i + width + 1] - gray[i - width - 1] - 2 * gray[i - 1] - gray[i + width - 1];
    const gy = gray[i + width - 1] + 2 * gray[i + width] + gray[i + width + 1] - gray[i - width - 1] - 2 * gray[i - width] - gray[i - width + 1];
    mag[i] = Math.hypot(gx, gy);
  }
  // the threshold that keeps the strongest EDGE_SHARE of the cells, from a histogram
  let max = 0;
  for (const v of mag) if (v > max) max = v;
  const bins = new Uint32Array(256);
  for (const v of mag) bins[Math.min(255, Math.floor((v / (max || 1)) * 255))]++;
  let acc = 0, cut = 255;
  for (let b = 255; b >= 0; b--) { acc += bins[b]; if (acc >= EDGE_SHARE * mag.length) { cut = b; break; } }
  const t = (cut / 255) * max;
  const rgba = Buffer.alloc(width * height * 4);
  // slid round the edges to where the pattern lines up with the drawing's
  const ox = Math.round(slide.x * width), oy = Math.round(slide.y * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const m = mag[((((y - oy) % height) + height) % height) * width + ((((x - ox) % width) + width) % width)];
    if (m >= t && m > 0) { const i = (y * width + x) * 4; rgba[i] = 230; rgba[i + 1] = 20; rgba[i + 2] = 40; rgba[i + 3] = 210; }
  }
  const lines = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return sharp(base).composite([{ input: lines }]).png().toBuffer();
}

/** The overlay of a drawing on the original, or null where the two are not the same shape or there is nothing to compare by.
 * `palette`: the drawing's own colors (hex, name), which both are measured in (the scan's own measured palette merges
 * neighbors, so a printed lattice reads as two colors), at least two for the numbers; without them there is the picture alone. */
export async function overlayCheck(referencePng: Buffer, drawingPng: Buffer, palette: PaletteName[], { height = 900, wrap = false }: { height?: number; wrap?: boolean } = {}): Promise<Overlay | null> {
  const [a, b] = await Promise.all([sharp(referencePng).metadata(), sharp(drawingPng).metadata()]);
  if (!a.width || !a.height || !b.width || !b.height) return null;
  if (Math.abs(b.width / b.height / (a.width / a.height) - 1) > SAME_SHAPE) return null;
  const usable = palette.filter((p) => /^#[0-9a-f]{6}$/i.test(p.hex));
  if (usable.length < 2) return { panel: await edgePanel(referencePng, drawingPng, height), report: '', agreement: NaN };
  const w = GRID_W, h = Math.max(8, Math.round((w * a.height) / a.width));
  const rgb = usable.map((p) => rgbOf(p.hex));
  const names = usable.map((p, i) => p.name || `color ${i + 1}`);
  const grids = async (gw: number, gh: number) => ({ orig: classify(await cellsOf(referencePng, gw, gh), rgb), drew: classify(await cellsOf(drawingPng, gw, gh), rgb), w: gw, h: gh });
  const fine = await grids(w, h);
  let orig = fine.orig, note = '';
  let slide = { x: 0, y: 0 };
  if (wrap) {
    const cw = GRID_W / 2;
    const coarse = await grids(cw, Math.max(8, Math.round((cw * a.height) / a.width)));
    const { dx, dy } = bestSlide(fine.orig, fine.drew, w, h, coarse);
    if (dx || dy) {
      orig = roll(fine.orig, w, h, dx, dy);
      slide = { x: dx / w, y: dy / h };
      note = `The tile may start anywhere in the repeat, so the original was slid ${pct(slide.x)} across and ${pct(slide.y)} down (round the edges) to where it fits yours best before comparing: only differences beyond that count.\n`;
    }
  }
  const { agreement, report } = overlayReport(orig, fine.drew, w, h, names);
  return { panel: await edgePanel(referencePng, drawingPng, height, slide), report: note + report, agreement };
}
