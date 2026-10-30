// "App-ready": the measured checks a drawn piece must pass to go into an app as it is, and the sheet
// that shows it fitted. Every render of a drawing is checked, and what fails goes back to the model
// as text it can act on: a model that cannot judge a fit by eye can still be told the number.
//
// What a piece is made for decides what it is checked for (a frame is fitted to twelve trims, an
// object only has to be whole, clean and flat); nothing a frame needs is asked of an object.

import sharp from 'sharp';
import { axisPieces, borderCells, classOf, composeCells, EASING, frameCells, MAX_SVG_BYTES, namespaceSvg, pageInArtUnits, reportOk, sliceOf, TRIMS } from '@telios/shared';
import type { AppCheck, AppReport, Layout, PaletteColor, PieceClass, Reading } from '@telios/shared';
import { render, sizeOf } from './render.ts';

/** A render as raw RGBA, `s` pixels to a design unit. */
interface Raster { data: Buffer; w: number; h: number; s: number }

async function raster(svg: string, long: number): Promise<Raster> {
  const [W, H] = sizeOf(svg);
  const png = await render(svg, { long });
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, s: info.width / W };
}

/** A pixel as a small number: 0 for clear, else 1 to 32 by its lightness, so two pixels "match" when close. */
const sig = (d: Buffer, i: number) => (d[i + 3] < 64 ? 0 : 1 + (((d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10) >> 3));
const differ = (a: number, b: number) => (a === 0 || b === 0 ? a !== b : Math.abs(a - b) > 2);

const pct = (v: number) => `${Math.round(v * 100)}%`;
const units = (v: number) => Math.round(v);

// ── Layout ──

/** What is wrong with a layout, in words the model can act on. */
export function layoutWarnings(l: Layout | null, [W, H]: [number, number], reading: Reading): string[] {
  const w: string[] = [];
  if (!l) return w;
  const expect = ({ frame: 'frame', border: 'border', corner: 'corner', pattern: 'tile' } as Record<string, string>)[reading.kind] ?? 'whole';
  if (l.form !== expect) w.push(`layout.form is '${l.form}' but this ${reading.kind} needs '${expect}'.`);
  const inside = (r: [number, number] | undefined, L: number, name: string) => {
    if (r && !(r[0] >= 0 && r[1] <= L && r[1] > r[0])) w.push(`${name} [${r}] is not a range inside 0–${L}.`);
  };
  inside(l.repeat?.x, W, 'repeat.x');
  inside(l.repeat?.y, H, 'repeat.y');
  if (l.form === 'frame') {
    const [sx, sy] = Array.isArray(l.slice) ? l.slice : [l.slice!, l.slice!];
    if (sx * 2 > W + 0.5 || sy * 2 > H + 0.5) w.push(`slice ${JSON.stringify(l.slice)} is more than half the canvas (${W} × ${H}): the corners would overlap.`);
    for (const [axis, L, s] of [['x', W, sx], ['y', H, sy]] as const) {
      const k = l.keep?.[axis], r = l.repeat?.[axis];
      if (k && Math.abs((k[0] + k[1]) / 2 - L / 2) > 0.5) w.push(`keep.${axis} [${k}] is not centered on ${L / 2}.`);
      if (r && r[0] < s - 0.5) w.push(`repeat.${axis} starts at ${r[0]}, inside the corner (slice ${s}): the unit must start after the corner.`);
      if (r && k && r[1] > k[0] + 0.5) w.push(`repeat.${axis} ends at ${r[1]}, past the kept middle's start ${k[0]}: the unit must lie in the first half, before the keep.`);
    }
    if (!l.repeat && reading.repeats.axis !== 'none') w.push('The reading says the edges repeat, but layout has no repeat: give repeat.x and repeat.y.');
  }
  if (l.form === 'border' && !l.repeat?.x) w.push('A border needs repeat.x: the unit that repeats along it.');
  return w;
}

function layoutCheck(layout: Layout | null, size: [number, number], reading: Reading): AppCheck {
  const label = 'Fitting data';
  if (!layout) return { id: 'layout', label, ok: false, detail: 'The drawing returned no layout.' };
  const warnings = layoutWarnings(layout, size, reading);
  return warnings.length ? { id: 'layout', label, ok: false, detail: warnings.join(' ') } : { id: 'layout', label, ok: true, detail: `${layout.form}, ${size[0]} × ${size[1]} units` };
}

// ── Nothing cut off ──

/** How far ink runs past each edge of the canvas, in design units: what the canvas cuts off. */
export async function overflow(svg: string): Promise<{ top: number; right: number; bottom: number; left: number; area: number }> {
  const [W, H] = sizeOf(svg);
  // a layered SVG's viewBox is a multiple of its width and height: the margin is measured in the viewBox's own units
  const vb = svg.match(/<svg\b[^>]*\sviewBox="([^"]+)"/i)?.[1]?.split(/[\s,]+/).map(Number);
  const [vw, vh] = vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? [vb[2], vb[3]] : [W, H];
  const k = W / vw;   // design units to a viewBox unit
  const m = Math.round(Math.max(vw, vh) * 0.2);
  const { inner } = namespaceSvg(svg, 'clp');
  const wide = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${vw + 2 * m}" height="${vh + 2 * m}" viewBox="${-m} ${-m} ${vw + 2 * m} ${vh + 2 * m}">${inner}</svg>`;
  const r = await raster(wide, 1000);
  const out = { top: 0, right: 0, bottom: 0, left: 0, area: 0 };
  const x0 = Math.round(m * r.s), x1 = Math.round((m + vw) * r.s), y0 = Math.round(m * r.s), y1 = Math.round((m + vh) * r.s);
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    if (r.data[(y * r.w + x) * 4 + 3] < 96) continue;
    if (x >= x0 && x < x1 && y >= y0 && y < y1) continue;
    out.area++;
    if (y < y0) out.top = Math.max(out.top, (y0 - y) / r.s);
    if (y >= y1) out.bottom = Math.max(out.bottom, (y - y1 + 1) / r.s);
    if (x < x0) out.left = Math.max(out.left, (x0 - x) / r.s);
    if (x >= x1) out.right = Math.max(out.right, (x - x1 + 1) / r.s);
  }
  // back to design units
  return { top: out.top * k, right: out.right * k, bottom: out.bottom * k, left: out.left * k, area: (out.area / (r.s * r.s)) * k * k };
}

async function clipCheck(svg: string): Promise<AppCheck> {
  const label = 'Nothing cut off';
  const [W, H] = sizeOf(svg);
  const o = await overflow(svg);
  // half a rule's width hanging over the edge is how a rule on the canvas edge is drawn; more is a shape cut off
  const slack = Math.max(W, H) * 0.004;
  const sides = (['top', 'right', 'bottom', 'left'] as const).filter((k) => o[k] > slack);
  if (!sides.length || o.area < W * H * 0.0002) return { id: 'clip', label, ok: true, detail: 'everything is inside the canvas' };
  return {
    id: 'clip', label, ok: false,
    detail: `Ink runs past the canvas and is cut off at the ${sides.map((k) => `${k} edge (by ${units(o[k])} units or more)`).join(', ')}: keep every shape inside 0–${W} × 0–${H} (inset what is drawn on an edge, or leave room for the ornament).`,
  };
}

// ── Fit ──

/** Whether the band of the art along an axis changes along it: a plain molding does not, a vine does. */
function varies(r: Raster, axis: 'x' | 'y', from: number, to: number, band: [number, number]): boolean {
  const a0 = Math.max(0, Math.floor(from * r.s)), a1 = Math.min(axis === 'x' ? r.w : r.h, Math.ceil(to * r.s));
  const b0 = Math.max(0, Math.floor(band[0] * r.s)), b1 = Math.min(axis === 'x' ? r.h : r.w, Math.ceil(band[1] * r.s));
  if (a1 - a0 < 3 || b1 - b0 < 3) return false;
  let total = 0, n = 0;
  for (let a = a0 + 1; a < a1; a++) {
    let diff = 0;
    for (let b = b0; b < b1; b++) {
      const i = axis === 'x' ? (b * r.w + a) * 4 : (a * r.w + b) * 4;
      const j = axis === 'x' ? i - 4 : i - r.w * 4;
      if (differ(sig(r.data, i), sig(r.data, j))) diff++;
    }
    total += diff / (b1 - b0);
    n++;
  }
  return n > 0 && total / n > 0.003;
}

interface Stretch { trim?: string; edge: string; ratio: number }

async function fitCheck(svg: string, layout: Layout, piece: PieceClass): Promise<AppCheck> {
  const label = piece === 'border' ? 'Fits any length' : 'Fits every book size';
  const size = sizeOf(svg);
  const [W, H] = size;
  const r = await raster(svg, 900);
  const bad: Stretch[] = [];
  let lo = 1, hi = 1;
  const note = (ratio: number) => { lo = Math.min(lo, ratio); hi = Math.max(hi, ratio); };
  const judge = (ratio: number, patterned: boolean, where: Stretch) => {
    if (Math.abs(ratio - 1) < 0.02) return;
    if (patterned) note(ratio);
    if (patterned && (ratio < EASING[0] || ratio > EASING[1])) bad.push({ ...where, ratio });
  };
  if (piece === 'frame') {
    const [sx, sy] = sliceOf(layout);
    for (const [wi, hi2] of TRIMS) {
      const { T } = pageInArtUnits({ ...layout, size }, wi, hi2);
      const trim = `${wi} × ${hi2}`;
      axisPieces(W, T[0], sx, layout.keep?.x, layout.repeat?.x).forEach((p) => {
        const len = p.src[1] - p.src[0];
        if (len < 1e-6) return;
        const ratio = (p.dst[1] - p.dst[0]) / len;
        if (Math.abs(ratio - 1) < 0.02) return;
        const pat = varies(r, 'x', p.src[0], p.src[1], [0, sy]) || varies(r, 'x', p.src[0], p.src[1], [H - sy, H]);
        judge(ratio, pat, { trim, edge: 'top and bottom edges', ratio });
      });
      axisPieces(H, T[1], sy, layout.keep?.y, layout.repeat?.y).forEach((p) => {
        const len = p.src[1] - p.src[0];
        if (len < 1e-6) return;
        const ratio = (p.dst[1] - p.dst[0]) / len;
        if (Math.abs(ratio - 1) < 0.02) return;
        const pat = varies(r, 'y', p.src[0], p.src[1], [0, sx]) || varies(r, 'y', p.src[0], p.src[1], [W - sx, W]);
        judge(ratio, pat, { trim, edge: 'sides', ratio });
      });
    }
  } else {
    for (const k of [1.25, 1.5, 2.3, 4]) {
      const length = W * k;
      const pieces = layout.repeat?.x ? axisPieces(W, Math.max(length, W), 0, undefined, layout.repeat.x) : axisPieces(W, Math.max(length, W), W / 4);
      pieces.forEach((p) => {
        const len = p.src[1] - p.src[0];
        if (len < 1e-6) return;
        const ratio = (p.dst[1] - p.dst[0]) / len;
        if (Math.abs(ratio - 1) < 0.02) return;
        judge(ratio, varies(r, 'x', p.src[0], p.src[1], [0, H]), { trim: `${k}× its length`, edge: 'strip', ratio });
      });
    }
  }
  if (!bad.length) return { id: 'fit', label, ok: true, detail: lo === hi ? 'units keep their shape' : `units ease ${lo.toFixed(2)}–${hi.toFixed(2)} (allowed ${EASING[0]}–${EASING[1]})` };
  const worst = [...bad].sort((a, b) => Math.abs(Math.log(b.ratio)) - Math.abs(Math.log(a.ratio)));
  const by = new Map<string, Stretch>();
  for (const b of worst) if (!by.has(`${b.trim}|${b.edge}`)) by.set(`${b.trim}|${b.edge}`, b);
  const list = [...by.values()].slice(0, 3).map((b) => `at ${b.trim}: ${b.edge} ${b.ratio > 1 ? 'stretched' : 'squeezed'} ×${b.ratio.toFixed(2)}`).join('; ');
  const trims = new Set(bad.map((b) => b.trim)).size;
  return {
    id: 'fit', label, ok: false,
    detail: `${trims} ${piece === 'frame' ? `of the ${TRIMS.length} book sizes` : 'lengths'} are stretched or squeezed along a pattern beyond ${EASING[0]}–${EASING[1]} (${list}). ${piece === 'frame'
      ? 'Draw the frame on a square master, give each patterned edge a repeating unit (repeat.x for the top and bottom, repeat.y for the sides), keep any ornament in the middle of an edge (keep) and make slice cover the corner ornaments.'
      : 'Give the strip a repeating unit (repeat.x) that starts and ends at the same point of its pattern.'}`,
  };
}

// ── Seams ──

async function seamCheck(svg: string, layout: Layout, piece: PieceClass): Promise<AppCheck | null> {
  const label = 'Repeats without a seam';
  const [W, H] = sizeOf(svg);
  const r = await raster(svg, 2000);
  const column = (x: number, y0: number, y1: number) => { const o: number[] = []; for (let y = y0; y < y1; y++) o.push(sig(r.data, (y * r.w + x) * 4)); return o; };
  const row = (y: number, x0: number, x1: number) => { const o: number[] = []; for (let x = x0; x < x1; x++) o.push(sig(r.data, (y * r.w + x) * 4)); return o; };
  const mismatch = (a: number[], b: number[]) => a.reduce((n, v, i) => n + (differ(v, b[i]) ? 1 : 0), 0) / Math.max(1, a.length);
  /** How far the last line inside a unit disagrees with its first (a few pixels apart across the join), against how far lines that far apart inside it do. */
  const LAG = 4;
  const seam = (lines: (i: number) => number[], first: number, last: number) => {
    let base = 0, n = 0;
    for (let i = first + LAG; i <= last; i += Math.max(1, Math.floor((last - first) / 60))) { base += mismatch(lines(i - LAG), lines(i)); n++; }
    return { seam: mismatch(lines(last), lines(first)), base: n ? base / n : 0 };
  };
  const inFrom = (v: number) => Math.ceil(v * r.s) + 1;     // the first line inside a unit that starts at v
  const inTo = (v: number) => Math.floor(v * r.s) - 2;      // the last line inside a unit that ends at v
  const tooMuch = (s: { seam: number; base: number }) => s.seam > s.base * 2 + 0.05;
  const bad: string[] = [];
  const clampx = (v: number) => Math.min(r.w - 1, Math.max(0, Math.round(v * r.s)));
  const clampy = (v: number) => Math.min(r.h - 1, Math.max(0, Math.round(v * r.s)));
  if (piece === 'tile') {
    const a = seam((x) => column(x, 0, r.h), 0, r.w - 1);
    const b = seam((y) => row(y, 0, r.w), 0, r.h - 1);
    if (tooMuch(a)) bad.push(`its left and right edges do not meet (${pct(a.seam)} of the edge differs; neighbouring lines differ ${pct(a.base)})`);
    if (tooMuch(b)) bad.push(`its top and bottom edges do not meet (${pct(b.seam)} of the edge differs; neighbouring lines differ ${pct(b.base)})`);
  } else {
    const [sx, sy] = piece === 'frame' ? sliceOf(layout) : [W, H];
    const rx = layout.repeat?.x, ry = layout.repeat?.y;
    if (rx) {
      const y0 = 0, y1 = clampy(piece === 'frame' ? sy : H) || r.h;
      const s = seam((x) => column(x, y0, y1), inFrom(rx[0]), inTo(rx[1]));
      if (tooMuch(s)) bad.push(`the top unit repeat.x [${rx}] does not join itself (${pct(s.seam)} of its edge differs; inside the pattern ${pct(s.base)}): a shape is cut at the unit's ends, so it must start and end at the same point of the pattern`);
    }
    if (ry && piece === 'frame') {
      const x1 = clampx(sx) || r.w;
      const s = seam((y) => row(y, 0, x1), inFrom(ry[0]), inTo(ry[1]));
      if (tooMuch(s)) bad.push(`the side unit repeat.y [${ry}] does not join itself (${pct(s.seam)} of its edge differs; inside the pattern ${pct(s.base)})`);
    }
    if (!rx && !ry) return null;
  }
  return bad.length ? { id: 'seam', label, ok: false, detail: `${bad.join('; ')}.` } : { id: 'seam', label, ok: true, detail: 'units join cleanly' };
}

// ── Window, background, lines, colors ──

async function windowCheck(svg: string): Promise<AppCheck> {
  const label = 'Open window';
  const r = await raster(svg, 500);
  const at = (x: number, y: number) => r.data[(y * r.w + x) * 4 + 3];
  const cx = r.w >> 1, cy = r.h >> 1;
  if (at(cx, cy) >= 16) return { id: 'window', label, ok: false, detail: 'The middle of the frame is not transparent: the window must stay empty and clear (no picture, text or background inside).' };
  // how far a ray from the middle runs before it meets the frame, each way
  const ray = (dx: number, dy: number) => {
    let x = cx, y = cy, n = 0;
    while (x > 0 && y > 0 && x < r.w - 1 && y < r.h - 1) { x += dx; y += dy; n++; if (at(x, y) >= 16) return n; }
    return -1;
  };
  const [l, rr, u, d] = [ray(-1, 0), ray(1, 0), ray(0, -1), ray(0, 1)];
  if ([l, rr, u, d].some((n) => n < 0)) return { id: 'window', label, ok: false, detail: 'The clear middle runs out to the canvas edge on at least one side: the window must be enclosed by the frame all round.' };
  const [w, h] = [(l + rr) / r.w, (u + d) / r.h];
  return w * h >= 0.1 ? { id: 'window', label, ok: true, detail: `${pct(w)} × ${pct(h)} of the canvas, clear` } : { id: 'window', label, ok: false, detail: `The window is only ${pct(w * h)} of the canvas: the frame's bands are too deep.` };
}

async function backgroundCheck(svg: string): Promise<AppCheck> {
  const label = 'Clear background';
  const r = await raster(svg, 200);
  let opaque = 0;
  for (let i = 3; i < r.data.length; i += 4) if (r.data[i] >= 200) opaque++;
  const share = opaque / (r.w * r.h);
  return share > 0.97
    ? { id: 'background', label, ok: false, detail: `The drawing covers ${pct(share)} of the canvas: it has a background fill. Leave the ground out so it stays transparent.` }
    : { id: 'background', label, ok: true, detail: 'transparent where nothing is drawn' };
}

/** The share of the ink that is thinner than `width` pixels at a render `long` pixels across (strokes that an opening of that size removes). */
export async function thinShare(svg: string, long = 800, width = 2): Promise<number> {
  const r = await raster(svg, long);
  const { w, h } = r;
  const on = new Uint8Array(w * h);
  let ink = 0;
  for (let i = 0; i < w * h; i++) if (r.data[i * 4 + 3] >= 128) { on[i] = 1; ink++; }
  if (!ink) return 0;
  // chamfer distance: to the nearest clear pixel (inside), then from the kept core (back out)
  const dist = (seed: (i: number) => boolean) => {
    const d = new Float32Array(w * h).fill(1e9);
    for (let i = 0; i < w * h; i++) if (seed(i)) d[i] = 0;
    const R2 = Math.SQRT2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) { v = Math.min(v, d[i - w] + 1); if (x > 0) v = Math.min(v, d[i - w - 1] + R2); if (x < w - 1) v = Math.min(v, d[i - w + 1] + R2); }
      d[i] = v;
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < h - 1) { v = Math.min(v, d[i + w] + 1); if (x < w - 1) v = Math.min(v, d[i + w + 1] + R2); if (x > 0) v = Math.min(v, d[i + w - 1] + R2); }
      d[i] = v;
    }
    return d;
  };
  const inside = dist((i) => !on[i]);
  const core = (i: number) => inside[i] >= width;
  const back = dist(core);
  let lost = 0;
  for (let i = 0; i < w * h; i++) if (on[i] && back[i] > width - 1) lost++;
  return lost / ink;
}

/** At most this share of a piece's ink may be thinner than two pixels when it is drawn 800 pixels across. */
export const THIN_LIMIT = 0.12;

async function thinCheck(svg: string): Promise<AppCheck> {
  const label = 'Lines hold at small size';
  const share = await thinShare(svg);
  return share > THIN_LIMIT
    ? { id: 'thin', label, ok: false, detail: `${pct(share)} of the ink is thinner than 0.25% of the canvas (2 pixels when it is drawn 800 across): hairlines vanish at tile and phone size. Draw lines at least ${(Math.max(...sizeOf(svg)) * 0.0025).toFixed(1)} units wide and give detail more weight.` }
    : { id: 'thin', label, ok: true, detail: `${pct(share)} of the ink is that thin (at most ${pct(THIN_LIMIT)})` };
}

function paletteCheck(palette: PaletteColor[], off: { share: number; colors: string[] }): AppCheck {
  const label = 'Few flat colors';
  if (palette.length > 8) return { id: 'palette', label, ok: false, detail: `The palette has ${palette.length} colors; an app takes at most 8 flat colors (each is a layer).` };
  if (off.share > 0.004) return { id: 'palette', label, ok: false, detail: `${(off.share * 100).toFixed(1)}% of the flat areas are colors outside the palette${off.colors.length ? ` (${off.colors.join(', ')})` : ''}: remove opacity, masks or blends, or add the color to the palette.` };
  return { id: 'palette', label, ok: true, detail: `${palette.length} flat color${palette.length === 1 ? '' : 's'}` };
}

/** The size check, once the layered SVG exists. */
export function sizeCheck(bytes: number): AppCheck {
  const label = 'Small enough';
  const kb = Math.round(bytes / 1024);
  return bytes > MAX_SVG_BYTES
    ? { id: 'size', label, ok: false, detail: `The layered SVG is ${(bytes / 1048576).toFixed(1)} MB (at most ${MAX_SVG_BYTES / 1048576} MB): fewer, smoother shapes, fewer grays; use <use> for repeats.` }
    : { id: 'size', label, ok: true, detail: kb < 1024 ? `${kb} KB` : `${(kb / 1024).toFixed(1)} MB` };
}

// ── The report ──

/** Every check the piece's kind asks for, measured on its SVG. `off` is the share of flat area outside the palette, when already known. */
export async function appReady(svg: string, layout: Layout | null, palette: PaletteColor[], reading: Reading, off: { share: number; colors: string[] } = { share: 0, colors: [] }): Promise<AppReport> {
  const piece = classOf(reading.kind);
  const size = sizeOf(svg);
  const checks: AppCheck[] = [layoutCheck(layout, size, reading)];
  if (piece !== 'tile') checks.push(await clipCheck(svg));
  if (layout && (piece === 'frame' || piece === 'border')) checks.push(await fitCheck(svg, layout, piece));
  if (layout && (piece === 'frame' || piece === 'border' || piece === 'tile')) {
    const seam = await seamCheck(svg, layout, piece);
    if (seam) checks.push(seam);
  }
  if (piece === 'frame') checks.push(await windowCheck(svg));
  checks.push(await thinCheck(svg), paletteCheck(palette, off));
  if (piece !== 'tile') checks.push(await backgroundCheck(svg));
  return { piece, ok: reportOk(checks), checks };
}

/** The failed checks as lines for the model. */
export const failures = (r: AppReport) => r.checks.filter((c) => !c.ok).map((c) => `App-ready, ${c.label.toLowerCase()}: ${c.detail}`);

// ── The sheet ──

/** The piece fitted to what an app will ask of it, in one picture: a frame on all twelve trims, a border at four lengths, a tile 3 × 3, a corner on four corners, an object at three sizes. */
export async function fitSheet(svg: string, layout: Layout | null, piece: PieceClass): Promise<Buffer> {
  const [W, H] = sizeOf(svg);
  const GROUND = { r: 216, g: 212, b: 204 };
  const place = async (shots: Buffer[], cols: number, cell: number, gap = 16) => {
    const metas = await Promise.all(shots.map((b) => sharp(b).metadata()));
    const rows = Math.ceil(shots.length / cols);
    const out = sharp({ create: { width: cols * (cell + gap) + gap, height: rows * (cell + gap) + gap, channels: 3, background: GROUND } });
    return out.composite(shots.map((b, i) => ({ input: b, left: gap + (i % cols) * (cell + gap) + Math.floor((cell - metas[i].width!) / 2), top: gap + Math.floor(i / cols) * (cell + gap) + Math.floor((cell - metas[i].height!) / 2) }))).png().toBuffer();
  };
  if (piece === 'frame' && layout) {
    const shots = await Promise.all(TRIMS.map(async ([w, h]) => {
      const { T, cells } = frameCells({ ...layout, size: [W, H] }, w, h);
      return render(composeCells(svg, [W, H], T, cells, 'sheet'), { long: 300, background: '#ffffff' });
    }));
    return place(shots, 4, 300);
  }
  if (piece === 'border' && layout) {
    const shots = await Promise.all([1, 1.5, 2.3, 4].map(async (k) => {
      const { T, cells } = borderCells({ ...layout, size: [W, H] }, W * k);
      return render(composeCells(svg, [W, H], T, cells, 'sheet'), { long: 1000, background: '#ffffff' });
    }));
    return place(shots, 1, 1000);
  }
  if (piece === 'tile') {
    const tiled = namespaceSvg(svg, 'tile');
    const uses = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => `<use href="#tile-art" x="${c * W}" y="${r * H}" width="${W}" height="${H}"/>`)).join('');
    const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 3}" height="${H * 3}" viewBox="0 0 ${W * 3} ${H * 3}"><defs><symbol id="tile-art" viewBox="${tiled.viewBox}" overflow="visible">${tiled.inner}</symbol></defs>${uses}</svg>`;
    return place([await render(sheet, { long: 900, background: '#ffffff' })], 1, 900);
  }
  if (piece === 'corner') {
    const { inner, viewBox } = namespaceSvg(svg, 'corner');
    const sym = `<symbol id="corner-art" viewBox="${viewBox}" overflow="visible">${inner}</symbol>`;
    const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 2}" height="${H * 2}" viewBox="0 0 ${W * 2} ${H * 2}"><defs>${sym}</defs>`
      + `<use href="#corner-art" width="${W}" height="${H}"/><use href="#corner-art" width="${W}" height="${H}" transform="matrix(-1 0 0 1 ${W * 2} 0)"/>`
      + `<use href="#corner-art" width="${W}" height="${H}" transform="matrix(1 0 0 -1 0 ${H * 2})"/><use href="#corner-art" width="${W}" height="${H}" transform="matrix(-1 0 0 -1 ${W * 2} ${H * 2})"/></svg>`;
    return place([await render(sheet, { long: 800, background: '#ffffff' })], 1, 800);
  }
  const sizes = [400, 160, 64];
  const shots: Buffer[] = [];
  for (const ground of ['#ffffff', '#6b7280', '#111111']) for (const long of sizes) shots.push(await render(svg, { long, background: ground }));
  return place(shots, 3, 420);
}
