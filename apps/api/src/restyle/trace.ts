// A traced result: the input picture itself, cut into a few flat colors and traced to one SVG layer per
// color. Nothing is redrawn, so it is the picture's own shapes, in seconds, with neither ComfyUI nor a model.
//
//   an object   the whole picture traced as it is (the worker's `trace`: near colors merged, TRACE_MERGE, and a
//               scan's paper margin cleared); this writes the preview and the screen copies, as a drawn result has;
//   a pattern   one seamless tile (the worker's `tile`): the scan straightened, its repeat found, every copy of
//               it averaged into one tile and traced with its edges wrapped, so it repeats as it is. A picture
//               that does not repeat is refused, in words. The tile's fitting data is written (layout.json), the
//               preview is the tile repeated 2 × 2 and a fit sheet shows it 3 × 3;
//   a border    the same for a strip (`tile --border`): turned to run level, straightened, one exact unit cut along
//               its length, wrapped at its ends only.
//
// A pattern tile and a border have at most three colors, and the color behind their design is taken out (unless Background is Keep
// original), so an app can take the SVG with no background and recolor it with one hue adjustment. An object keeps up to TRACE_MAX_COLORS. Its fitting data says the whole unit is the repeat; the
//               preview and the fit sheet lay it 3 and 4 times along.
//
// It runs on the CPU, a few at a time.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import { BACKGROUND_HEX, TILE_SEAM_MAX, TILE_STRENGTH_MIN, TRACE_MAX_COLORS, TRACE_MERGE, kindFor, lightnessOf } from '@telios/shared';
import type { RestyleResult, TraceTile } from '@telios/shared';
import { python } from '../python.ts';
import { screenCopies } from './job.ts';
import { stagesOf } from './progress.ts';
import { rel, resultDir, updateResult } from './store.ts';

/** The longest side of the preview picture: the SVG is not pixel-sized, the preview is only to look at. */
const PREVIEW_SIDE = 4096;
/** The longest side of a pattern's fit sheet. */
const SHEET_SIDE = 1600;

interface Layer { id: string; color: string; name: string; share: number }
interface Traced { layers: Layer[] }
interface Tiled extends Traced {
  size: [number, number]; cell: [number, number]; tilt: number; lattice: 'grid' | 'half-drop' | 'strip'; perCell: number;
  repeatStrength: [number, number]; copies: number; seam: number;
  /** A border's background that was taken out (its color and the share of the unit it covered), or null. */
  ground?: { color: string; share: number; margins?: string[] } | null;
}

/** A worker's error in plain words: its Python type name is not for the person. */
const plain = (e: unknown) => (e as Error).message.replace(/^\w*Error:\s*/, '');

/** What a tile is laid on for its preview: the color that fills most of an opaque tile; for a border or tile whose background was taken out, the ground picked (white, black or green) or a neutral that the design shows against. */
function previewGround(layers: Layer[], cleared: string | null): string {
  if (cleared === null) return [...layers].sort((a, b) => b.share - a.share)[0].color;
  if (cleared in BACKGROUND_HEX && cleared !== 'transparent' && cleared !== 'original') return BACKGROUND_HEX[cleared as keyof typeof BACKGROUND_HEX];
  const mean = layers.reduce((n, l) => n + lightnessOf(l.color), 0) / Math.max(1, layers.length);
  return mean < 0.5 ? '#f3f1ec' : '#2b2b2b';
}

/** The tile (or a border's unit) rendered at its own size (px), then laid `across` × `down` on `ground`, at most `side` px on its longer side. */
async function repeated(svg: Buffer, across: number, down: number, ground: string, side: number) {
  const one = await sharp(svg, { density: 72 }).flatten({ background: ground }).png().toBuffer();
  const m = await sharp(one).metadata();
  const comps: OverlayOptions[] = [];
  for (let j = 0; j < down; j++) for (let i = 0; i < across; i++) comps.push({ input: one, left: i * m.width!, top: j * m.height! });
  const sheet = await sharp({ create: { width: m.width! * across, height: m.height! * down, channels: 3, background: ground } }).composite(comps).png().toBuffer();
  return sharp(sheet).resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
}

export async function drawTrace(id: string, signal: AbortSignal) {
  const r = updateResult(id, (x) => { x.status = 'running'; x.stage = 'Starting'; delete x.progress; x.startedAt = new Date().toISOString(); delete x.error; });
  if (!r) return;
  const dir = resultDir(id);
  const o = r.options;
  const strip = o.madeFor === 'border';
  const tiled = o.madeFor === 'pattern' || strip;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `telios-${id}-`));
  try {
    const stage = stagesOf(id, tiled
      ? [{ label: 'Finding the repeat', seconds: 12 }, { label: 'Finishing', seconds: 3 }]
      : [{ label: 'Tracing to SVG', seconds: 8 }, { label: 'Finishing', seconds: 2 }]);
    stage(tiled ? 'Finding the repeat' : 'Tracing to SVG');
    const source = path.join(dir, 'source.png');
    let traced: Traced;
    try {
      // an object keeps the picture's own ground only where that was asked for
      traced = tiled
        ? await python<Tiled>(['tile', source, scratch, '--max-colors', String(TRACE_MAX_COLORS), ...(strip ? ['--border'] : []), ...(tiled && o.background === 'original' ? ['--keep-ground'] : [])], 10 * 60_000)
        : await python<Traced>(['trace', source, scratch, '--mode', 'auto', '--max-colors', String(TRACE_MAX_COLORS), '--merge', String(TRACE_MERGE), '--smooth', String(['off', 'light', 'strong'].indexOf(o.cleanup)), ...(o.background === 'original' ? ['--keep-background'] : [])], 10 * 60_000);
    } catch (e) {
      throw new Error(plain(e));
    }
    if (signal.aborted) throw new Error('Stopped.');
    const svg = fs.readFileSync(path.join(scratch, 'layered.svg'));
    fs.writeFileSync(path.join(dir, 'result.svg'), svg);
    // what the app package is made from (restyle/package.ts): there is no reading, so what it is made for decides its kind
    const kind = kindFor(o.madeFor === 'remix' ? 'auto' : o.madeFor, 'other');
    const t = tiled ? (traced as Tiled) : null;
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
      kind, rendering: 'flat', colorMode: 'full',
      palette: traced.layers.map((l) => ({ hex: l.color, name: l.name })), layers: traced.layers,
      summary: t
        ? `One seamless ${t.size[0]} × ${t.size[1]} ${strip ? 'unit cut from the border\'s repeat along its length' : `tile cut from the picture's repeat (${t.lattice})`}, traced into ${traced.layers.length} flat colors; nothing was redrawn.`
        : `Traced from the picture into ${traced.layers.length} flat colors; nothing was redrawn.`,
    }, null, 1));
    // a tile has its fitting data: the size it repeats at and how its rows sit; a border's whole unit is its repeat
    if (t) fs.writeFileSync(path.join(dir, 'layout.json'), JSON.stringify(strip ? { form: 'border', size: t.size, fit: 'tile', repeat: { x: [0, t.size[0]] } } : { form: 'tile', size: t.size, lattice: t.lattice }));

    stage('Finishing');
    let png: Buffer;
    let sheet: Buffer | null = null;
    const warnings: string[] = [];
    if (t) {
      // the tile is opaque, on the color that fills most of it, so the preview shows how it repeats and not what is behind
      const ground = previewGround(traced.layers, t.ground ? o.background : null);
      png = strip ? await repeated(svg, 3, 1, ground, PREVIEW_SIDE) : await repeated(svg, 2, 2, ground, PREVIEW_SIDE);
      sheet = strip ? await repeated(svg, 4, 1, ground, SHEET_SIDE) : await repeated(svg, 3, 3, ground, SHEET_SIDE);
      if (t.ground) warnings.push(`The ${strip ? "border's" : "pattern's"} background (${t.ground.color}, ${Math.round(t.ground.share * 100)}% of the ${strip ? 'unit' : 'tile'}) was taken out${t.ground.margins?.length ? `, with the scan's paper margin along its edges (${t.ground.margins.join(', ')})` : ''}, leaving the design on a clear ground. If it needs it, choose Background → Keep original.`);
      if (t.seam > TILE_SEAM_MAX) warnings.push(`The tile's edges do not meet cleanly (the colors change ${t.seam}× as much across them as inside): the picture may not repeat exactly.`);
      if (Math.min(...t.repeatStrength) < TILE_STRENGTH_MIN) warnings.push('The repeat is loose: copies of the pattern in the picture differ a good deal, so the tile is an average of them.');
    } else {
      png = await sharp(svg, { density: 72 }).resize({ width: PREVIEW_SIDE, height: PREVIEW_SIDE, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
      if (o.background !== 'transparent' && o.background !== 'original') png = await sharp(png).flatten({ background: BACKGROUND_HEX[o.background] }).png().toBuffer();
    }
    fs.writeFileSync(path.join(dir, 'result.png'), png);
    if (sheet) fs.writeFileSync(path.join(dir, 'fitsheet.png'), sheet);
    await screenCopies(png, dir);
    const meta = await sharp(png).metadata();
    fs.rmSync(path.join(dir, 'source.png'), { force: true });
    const tile: TraceTile | undefined = t ? { cell: t.cell, lattice: t.lattice, tilt: t.tilt, copies: t.copies, seam: t.seam, strength: t.repeatStrength } : undefined;
    updateResult(id, (x) => {
      x.status = 'done';
      delete x.stage; delete x.progress;
      x.finishedAt = new Date().toISOString();
      x.size = [meta.width!, meta.height!];
      x.traced = { colors: traced.layers.map((l) => l.color), ...(tile && { tile }) };
      if (warnings.length) x.warning = warnings.join(' ');
      const files: NonNullable<RestyleResult['files']> = {
        png: rel(path.join(dir, 'result.png')), svg: rel(path.join(dir, 'result.svg')), thumb: rel(path.join(dir, 'thumb.webp')), view: rel(path.join(dir, 'view.webp')), original: rel(path.join(dir, 'original.webp')),
        ...(t && { layout: rel(path.join(dir, 'layout.json')), fitsheet: rel(path.join(dir, 'fitsheet.png')) }),
      };
      x.files = files;
    });
  } catch (e) {
    const canceled = signal.aborted;
    updateResult(id, (x) => {
      x.status = canceled ? 'canceled' : 'failed';
      delete x.stage; delete x.progress;
      x.finishedAt = new Date().toISOString();
      if (!canceled) x.error = (e as Error).message;
    });
    if (!canceled) console.error('[restyle]', id, e);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
