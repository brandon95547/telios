// Rendering and the critique tools (stage 5): every render of a drawing is looked at beside the
// original, in close-up, as a seam check of its repeating unit, fitted to other page sizes, and
// checked for colors outside its palette. All of it runs in the job worker on SVG text that
// svg.ts has already checked.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { borderCells, composeCells, frameCells, sliceOf, tileSvg } from '@telios/shared';
import type { Layout, PaletteColor } from '@telios/shared';

sharp.cache(false);
const GROUND = { r: 216, g: 212, b: 204 };   // the light gray the comparisons sit on

const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** The SVG rendered so its long side is `long` pixels (or at `scale` × its size). */
export async function render(svg: string, { long, scale, background }: { long?: number; scale?: number; background?: string } = {}) {
  const [w, h] = sizeOf(svg);
  const s = scale ?? (long ? long / Math.max(w, h) : 1);
  let img = sharp(Buffer.from(svg), { density: Math.max(1, 72 * s), limitInputPixels: 400_000_000, unlimited: true });
  if (background) img = img.flatten({ background });
  return img.png().toBuffer();
}

export function sizeOf(svg: string): [number, number] {
  const open = svg.match(/<svg\b[^>]*>/i)?.[0] ?? '';
  const w = parseFloat(open.match(/\swidth="([\d.]+)/)?.[1] ?? '0');
  const h = parseFloat(open.match(/\sheight="([\d.]+)/)?.[1] ?? '0');
  if (w && h) return [w, h];
  const vb = open.match(/viewBox="([^"]+)"/)?.[1]?.split(/[\s,]+/).map(Number) ?? [0, 0, 100, 100];
  return [vb[2], vb[3]];
}

/** For the model: JPEG, long side at most 1568 px (what the API reads without resizing). */
export async function forModel(png: Buffer, long = 1568) {
  return sharp(png).resize({ width: long, height: long, fit: 'inside', withoutEnlargement: true }).flatten({ background: GROUND }).jpeg({ quality: 86 }).toBuffer();
}

/** The original cropped to its design (the analysis' bounding box and a small margin), cached. */
export async function originalCrop(designDir: string, analysis: any): Promise<string> {
  const out = path.join(designDir, 'crop.png');
  if (fs.existsSync(out)) return out;
  const src = path.join(designDir, 'source.png');
  const meta = await sharp(src).metadata();
  const [x, y, w, h] = analysis?.bbox ?? [0, 0, meta.width!, meta.height!];
  const m = Math.round(0.01 * Math.max(w, h));
  const left = Math.max(0, Math.floor(x - m)), top = Math.max(0, Math.floor(y - m));
  const width = Math.min(meta.width! - left, Math.ceil(w + 2 * m)), height = Math.min(meta.height! - top, Math.ceil(h + 2 * m));
  await sharp(src).extract({ left, top, width, height }).png().toFile(out);
  return out;
}

/** Images side by side at one height on the light gray ground. */
export async function sideBySide(images: Buffer[], height: number, gap = 24): Promise<Buffer> {
  const resized = await Promise.all(images.map((b) => sharp(b).resize({ height, fit: 'inside' }).png().toBuffer({ resolveWithObject: true })));
  const W = resized.reduce((s, r) => s + r.info.width + gap, gap);
  const H = Math.max(...resized.map((r) => r.info.height)) + 2 * gap;
  let x = gap;
  const comps = resized.map((r) => { const c = { input: r.data, left: x, top: gap }; x += r.info.width + gap; return c; });
  return sharp({ create: { width: W, height: H, channels: 3, background: GROUND } }).composite(comps).png().toBuffer();
}

/** The original beside the drawing (on white), both the same height. */
export async function compare(originalPng: string, drawingPng: Buffer, height = 900) {
  const onWhite = await sharp(drawingPng).flatten({ background: '#ffffff' }).png().toBuffer();
  return sideBySide([fs.readFileSync(originalPng), onWhite], height);
}

/** A close-up: the same region of the original and the drawing, enlarged. `region` is in design units. */
export async function closeup(originalPng: string, svg: string, region: [number, number, number, number], px = 760) {
  const [W, H] = sizeOf(svg);
  let [x, y, w, h] = region;
  x = Math.max(0, Math.min(W - 4, x)); y = Math.max(0, Math.min(H - 4, y));
  w = Math.max(4, Math.min(W - x, w)); h = Math.max(4, Math.min(H - y, h));
  const scale = Math.min(8, px / Math.max(w, h));
  const drawing = await sharp(Buffer.from(svg), { density: 72 * scale, unlimited: true }).flatten({ background: '#ffffff' })
    .extract({ left: Math.floor(x * scale), top: Math.floor(y * scale), width: Math.max(1, Math.floor(w * scale) - 1), height: Math.max(1, Math.floor(h * scale) - 1) }).png().toBuffer();
  const meta = await sharp(originalPng).metadata();
  const ox = Math.floor((x / W) * meta.width!), oy = Math.floor((y / H) * meta.height!);
  const ow = Math.max(1, Math.min(meta.width! - ox, Math.round((w / W) * meta.width!)));
  const oh = Math.max(1, Math.min(meta.height! - oy, Math.round((h / H) * meta.height!)));
  const orig = await sharp(originalPng).extract({ left: ox, top: oy, width: ow, height: oh }).resize({ width: Math.round(w * scale), height: Math.round(h * scale), fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
  return { image: await sideBySide([orig, drawing], Math.min(px, Math.round(h * scale))), scale, originalPixels: [ow, oh] };
}

/** Each repeating unit tiled three times (top edge along, left edge down; a border's strip; a tile 3 × 3), so a seam shows. */
export async function unitCheck(svg: string, layout: Layout | null): Promise<Buffer | null> {
  if (!layout) return null;
  const [W, H] = sizeOf(svg);
  if (layout.form === 'tile') {
    const tiled = tileSvg(svg, [W, H], 3, 3, layout.lattice ?? 'grid', 'chk');
    return render(tiled, { long: 1200, background: '#ffffff' });
  }
  const rep = layout.repeat;
  if (!rep?.x && !rep?.y) return null;
  const s = Math.min(2, 1400 / Math.max(W, H));
  const png = await sharp(Buffer.from(svg), { density: 72 * s, unlimited: true }).flatten({ background: '#ffffff' }).png().toBuffer();
  const meta = await sharp(png).metadata();
  const strips: Buffer[] = [];
  const [sx, sy] = layout.form === 'frame' ? sliceOf(layout) : [W, H];
  const tile = async (box: { left: number; top: number; width: number; height: number }, across: boolean) => {
    box = { left: Math.max(0, Math.round(box.left)), top: Math.max(0, Math.round(box.top)), width: Math.round(box.width), height: Math.round(box.height) };
    box.width = Math.max(1, Math.min(meta.width! - box.left, box.width));
    box.height = Math.max(1, Math.min(meta.height! - box.top, box.height));
    const piece = await sharp(png).extract(box).png().toBuffer();
    const w = across ? box.width * 3 : box.width, h = across ? box.height : box.height * 3;
    return sharp({ create: { width: w, height: h, channels: 3, background: '#ffffff' } })
      .composite([0, 1, 2].map((i) => ({ input: piece, left: across ? i * box.width : 0, top: across ? 0 : i * box.height }))).png().toBuffer();
  };
  if (rep.y) strips.push(await tile({ left: 0, top: rep.y[0] * s, width: sx * s, height: (rep.y[1] - rep.y[0]) * s }, false));
  if (rep.x) strips.push(await tile({ left: rep.x[0] * s, top: 0, width: (rep.x[1] - rep.x[0]) * s, height: (layout.form === 'border' ? H : sy) * s }, true));
  const metas = await Promise.all(strips.map((b) => sharp(b).metadata()));
  const Wt = metas.reduce((t, m) => t + m.width! + 20, 20), Ht = Math.max(...metas.map((m) => m.height!)) + 40;
  let x = 20;
  const comps = strips.map((b, i) => { const c = { input: b, left: x, top: 20 }; x += metas[i].width! + 20; return c; });
  const out = await sharp({ create: { width: Wt, height: Ht, channels: 3, background: GROUND } }).composite(comps).png().toBuffer();
  return sharp(out).resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
}

/** The piece fitted to other shapes by the fitting algorithm: a frame on a wide and a tall page, a border at two lengths. */
export async function fitCheck(svg: string, layout: Layout | null): Promise<Buffer | null> {
  if (!layout) return null;
  const size = sizeOf(svg);
  if (layout.form === 'frame') {
    const ratio = size[0] / size[1];
    const pages: [number, number][] = [[ratio * 1.45, 1], [1, 1 / (ratio * 0.62)]];
    const shots = await Promise.all(pages.map(async ([w, h]) => {
      const { T, cells } = frameCells({ ...layout, size }, w, h);
      return render(composeCells(svg, size, T, cells, 'fit'), { long: 900, background: '#ffffff' });
    }));
    return sideBySide(shots, 700);
  }
  if (layout.form === 'border' && layout.repeat?.x) {
    const shots = await Promise.all([1.5, 2.3].map(async (k) => {
      const { T, cells } = borderCells({ ...layout, size }, size[0] * k);
      return render(composeCells(svg, size, T, cells, 'fit'), { long: 1500, background: '#ffffff' });
    }));
    const metas = await Promise.all(shots.map((b) => sharp(b).metadata()));
    const W = Math.max(...metas.map((m) => m.width!)) + 40, H = metas.reduce((t, m) => t + m.height! + 20, 20);
    let y = 20;
    return sharp({ create: { width: W, height: H, channels: 3, background: GROUND } })
      .composite(shots.map((b, i) => { const c = { input: b, left: 20, top: y }; y += metas[i].height! + 20; return c; })).png().toBuffer();
  }
  return null;
}

/** The palette as [{ hex, name }] from whatever shape draw() returned it in. */
export function normalizePalette(p: unknown, used: string[]): PaletteColor[] {
  const out: PaletteColor[] = [];
  const add = (hex: unknown, name: unknown) => {
    if (typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex) && !out.some((c) => c.hex === hex.toLowerCase())) out.push({ hex: hex.toLowerCase(), name: typeof name === 'string' && name ? name : hex.toLowerCase() });
  };
  if (Array.isArray(p)) for (const c of p) typeof c === 'string' ? add(c, null) : add((c as any)?.hex, (c as any)?.name);
  else if (p && typeof p === 'object') for (const [name, hex] of Object.entries(p)) add(hex, name);
  if (!out.length) for (const hex of used) add(hex, null);
  return out;
}

/** Share of the drawing's flat interior pixels (not edges) that are none of its palette colors: blends from opacity, masks or a color left out of the palette. */
export async function offPalette(svg: string, palette: PaletteColor[]) {
  const { data, info } = await sharp(Buffer.from(await render(svg, { long: 900 }))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pal = palette.map((c) => rgbOf(c.hex));
  const { width: w, height: h } = info;
  let interior = 0, off = 0;
  const offColors = new Map<string, number>();
  const same = (i: number, j: number) => data[i] === data[j] && data[i + 1] === data[j + 1] && data[i + 2] === data[j + 2] && data[i + 3] === data[j + 3];
  for (let y = 1; y < h - 1; y += 1) for (let x = 1; x < w - 1; x += 1) {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 250) continue;
    if (!same(i, i - 4) || !same(i, i + 4) || !same(i, i - 4 * w) || !same(i, i + 4 * w)) continue;
    interior++;
    let best = Infinity;
    for (const [r, g, b] of pal) best = Math.min(best, (data[i] - r) ** 2 + (data[i + 1] - g) ** 2 + (data[i + 2] - b) ** 2);
    if (best > 27) {
      off++;
      const hex = '#' + [data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('');
      offColors.set(hex, (offColors.get(hex) ?? 0) + 1);
    }
  }
  const top = [...offColors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c]) => c);
  return { share: interior ? off / interior : 0, colors: top };
}

/** Mirror symmetry of the rendered drawing, left–right and top–bottom (1 = exact). */
export async function symmetry(png: Buffer) {
  const { data, info } = await sharp(png).flatten({ background: '#ffffff' }).resize(256, 256, { fit: 'fill' }).blur(1.5).greyscale().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const at = (x: number, y: number) => data[y * w + x];
  const corr = (flip: (x: number, y: number) => number) => {
    let sa = 0, sb = 0, n = w * h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { sa += at(x, y); sb += flip(x, y); }
    const ma = sa / n, mb = sb / n;
    let num = 0, da = 0, db = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const a = at(x, y) - ma, b = flip(x, y) - mb; num += a * b; da += a * a; db += b * b; }
    return da && db ? num / Math.sqrt(da * db) : 1;
  };
  return { lr: +corr((x, y) => at(w - 1 - x, y)).toFixed(3), tb: +corr((x, y) => at(x, h - 1 - y)).toFixed(3) };
}

/** The tracing copy: rendered at `scale` px per unit, every opaque pixel snapped to exactly one palette color, the rest clear. */
export async function traceCopy(svg: string, palette: PaletteColor[], scale: number): Promise<Buffer> {
  const { data, info } = await sharp(Buffer.from(svg), { density: 72 * scale, unlimited: true, limitInputPixels: 400_000_000 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pal = palette.map((c) => rgbOf(c.hex));
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) { data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0; continue; }
    let best = 0, bd = Infinity;
    for (let k = 0; k < pal.length; k++) {
      const d = (data[i] - pal[k][0]) ** 2 + (data[i + 1] - pal[k][1]) ** 2 + (data[i + 2] - pal[k][2]) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    data[i] = pal[best][0]; data[i + 1] = pal[best][1]; data[i + 2] = pal[best][2]; data[i + 3] = 255;
  }
  return sharp(data, { raw: info }).png().toBuffer();
}
