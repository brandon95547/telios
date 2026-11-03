// The app package of a flat SVG: what an app needs to take the piece in as it is, in one folder.
//
//   <name>.svg            the layered SVG (one layer per color), its viewBox the size the fitting data is in
//                         (an object's trimmed to the drawing, so it sits in its box exactly centered)
//   <name>.json           the manifest: what the piece is, its size and fitting data in the SVG's own units,
//                         its colors and layers, and the app-ready checks it passed or failed
//   <name>.fitsheet.png   the piece fitted as an app will: a frame on every book size, a border at four
//                         lengths, a tile 3 × 3, an object at three sizes
//   README.txt            how to read the above
//
// The fitting data a drawing returns is in the drawing's design units, and the layered SVG's viewBox is a
// multiple of them (TRACE ×); the manifest's is converted, so the two agree with no arithmetic.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { classOf } from '@telios/shared';
import type { AppReport, Kind, Layout, PieceClass, RestyleResult } from '@telios/shared';
import { render } from '../engine/render.ts';
import { resultDir } from './store.ts';

interface Meta {
  kind?: Kind; rendering?: string; colorMode?: string; material?: string; style?: string; motifs?: string; carvedLines?: boolean;
  palette?: { hex: string; name: string }[]; layers?: { id: string; color: string; name: string; share: number }[]; summary?: string; model?: string; appReady?: AppReport;
}

const readJson = <T>(file: string): T | null => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return null; } };
const round = (n: number) => +n.toFixed(2);
const times = (v: unknown, k: number): unknown => (typeof v === 'number' ? round(v * k) : Array.isArray(v) ? v.map((x) => times(x, k)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([a, b]) => [a, times(b, k)])) : v);

/** The fitting data in the SVG's own units: every length of it times `k`. */
export function scaledLayout(layout: Layout, k: number, size: [number, number]): Layout {
  const out: Layout = { ...layout, size };
  if (layout.slice !== undefined) out.slice = times(layout.slice, k) as Layout['slice'];
  if (layout.keep) out.keep = times(layout.keep, k) as Layout['keep'];
  if (layout.repeat) out.repeat = times(layout.repeat, k) as Layout['repeat'];
  return out;
}

/** The ink's box in a layered SVG, in its viewBox units: [x, y, w, h]. */
async function inkBox(svg: string, vw: number, vh: number): Promise<[number, number, number, number] | null> {
  const png = await render(svg, { long: 1600 });
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] < 8) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  const s = info.width / vw;
  return [x0 / s, y0 / s, (x1 + 1 - x0) / s, (y1 + 1 - y0) / s];
}

/** The SVG's root tag with a new size and viewBox. */
function withBox(svg: string, box: [number, number, number, number]): string {
  return svg.replace(/<svg\b[^>]*>/i, (open) => `${open.replace(/\s(?:width|height|viewBox)="[^"]*"/g, '')
    .replace(/>$/, '')} width="${round(box[2])}" height="${round(box[3])}" viewBox="${round(box[0])} ${round(box[1])} ${round(box[2])} ${round(box[3])}">`);
}

const readme = (name: string, piece: PieceClass, report: AppReport | undefined) => [
  `${name}: an app package from Telios.`,
  '',
  `  ${name}.svg           the piece, one layer per color. Its viewBox is the size in the manifest.`,
  `  ${name}.json          what it is, its fitting data (layout) and colors, and the checks it was measured against.`,
  `  ${name}.fitsheet.png  the piece fitted as an app will place it${piece === 'frame' ? ' (the twelve book sizes, 6×9, 5.5×8.5, 8.5×11, 5×8, 4.25×6.87, 8×10, 8×8, 7×10, 11×8.5, 8.5×8.5, 9×12, 6×6, left to right, top to bottom)' : ''}.`,
  '',
  piece === 'frame' || piece === 'border' ? 'layout.slice is how far the corners reach in; layout.keep is a middle ornament drawn whole; layout.repeat is one unit that is repeated (as many whole times as an edge needs). All are in the SVG\'s units.' : piece === 'object' ? 'An object is drawn whole: an app only scales it.' : '',
  '',
  report ? `App-ready: ${report.ok ? 'every check passed' : 'NOT every check passed'}.\n${report.checks.map((c) => `  ${c.ok ? 'pass' : 'FAIL'}  ${c.label}: ${c.detail}`).join('\n')}` : 'No app-ready checks were recorded for this piece (it was drawn before they existed).',
  '',
].filter((l, i, all) => l !== '' || all[i - 1] !== '').join('\n');

/** Writes the package of a finished flat SVG into `dir`, and returns the files as { src, name } for a zip, `prefix` ahead of each name. */
export async function writePackage(r: RestyleResult, base: string, dir: string, prefix = ''): Promise<{ src: string; name: string }[]> {
  if (!r.files?.svg) throw new Error('This one has no SVG to package.');
  const from = resultDir(r.id);
  const meta: Meta = readJson<Meta>(path.join(from, 'meta.json')) ?? {};
  const kind = meta.kind ?? (r.drawing?.kind as Kind | undefined) ?? 'other';
  const piece = classOf(kind);
  let svg = fs.readFileSync(path.join(from, 'result.svg'), 'utf8');
  const layout = readJson<Layout>(path.join(from, 'layout.json'));
  const vb = svg.match(/<svg\b[^>]*\sviewBox="([^"]+)"/i)?.[1]?.split(/[\s,]+/).map(Number);
  const [vw, vh] = vb && vb.length === 4 ? [vb[2], vb[3]] : [r.size?.[0] ?? 0, r.size?.[1] ?? 0];
  let box: [number, number, number, number] = [0, 0, vw, vh];
  // an object is trimmed to its drawing, so that it sits centered in its own box; a frame, a border, a corner or a tile is the canvas it was fitted on
  if (piece === 'object') {
    const ink = await inkBox(svg, vw, vh);
    if (ink) {
      const pad = Math.max(vw, vh) * 0.01;
      const x = Math.max(0, ink[0] - pad), y = Math.max(0, ink[1] - pad);
      box = [x, y, Math.min(vw, ink[0] + ink[2] + pad) - x, Math.min(vh, ink[1] + ink[3] + pad) - y];
    }
  }
  svg = withBox(svg, box);
  const size: [number, number] = [round(box[2]), round(box[3])];
  const k = layout?.size?.[0] ? vw / layout.size[0] : 1;
  const fitting: Layout = piece === 'object' || !layout ? { form: 'whole', size } : scaledLayout(layout, k, [round(vw), round(vh)]);
  const slug = base.replace(/^.*\//, '');
  const manifest = {
    format: 'telios-app-package', version: 1,
    name: r.inputName.replace(/\.[a-z0-9]{2,4}$/i, ''), slug, piece, kind,
    rendering: meta.rendering ?? 'flat', colorMode: meta.colorMode ?? r.drawing?.colorMode ?? 'full', material: meta.material ?? '', carvedLines: !!meta.carvedLines,
    style: meta.style ?? '', motifs: meta.motifs ?? '',
    size, viewBox: box.map(round), layout: fitting,
    palette: meta.palette ?? [], layers: meta.layers ?? [],
    summary: meta.summary ?? r.drawing?.summary ?? '', model: meta.model ?? r.drawing?.model ?? '',
    appReady: meta.appReady ?? r.drawing?.appReady ?? null,
    files: { svg: `${slug}.svg`, fitsheet: r.files.fitsheet ? `${slug}.fitsheet.png` : null },
    madeFor: r.options.madeFor,
  };
  fs.mkdirSync(dir, { recursive: true });
  const out: { src: string; name: string }[] = [];
  const put = (file: string, body: string | Buffer | null) => {
    if (body === null) return;
    const src = path.join(dir, file);
    fs.writeFileSync(src, body);
    out.push({ src, name: `${prefix}${file}` });
  };
  put(`${slug}.svg`, svg);
  put(`${slug}.json`, JSON.stringify(manifest, null, 1));
  if (r.files.fitsheet) put(`${slug}.fitsheet.png`, fs.readFileSync(path.join(from, 'fitsheet.png')));
  put('README.txt', readme(slug, piece, manifest.appReady ?? undefined));
  return out;
}
