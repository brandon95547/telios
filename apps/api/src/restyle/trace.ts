// A traced result: the input picture itself, cut into a few flat colors and traced to one SVG layer per
// color. Nothing is redrawn, so it is the picture's own shapes and layout, in seconds, with neither ComfyUI
// nor a model. The worker's `trace` finds the colors (near ones merged, TRACE_MERGE) and clears a scan's paper
// margin; this writes the preview and the screen copies, as a drawn result has. It runs on the CPU, a few at a time.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { BACKGROUND_HEX, TRACE_MAX_COLORS, TRACE_MERGE, kindFor } from '@telios/shared';
import { python } from '../python.ts';
import { screenCopies } from './job.ts';
import { stagesOf } from './progress.ts';
import { rel, resultDir, updateResult } from './store.ts';

/** The longest side of the preview picture: the SVG is not pixel-sized, the preview is only to look at. */
const PREVIEW_SIDE = 4096;

export async function drawTrace(id: string, signal: AbortSignal) {
  const r = updateResult(id, (x) => { x.status = 'running'; x.stage = 'Starting'; delete x.progress; x.startedAt = new Date().toISOString(); delete x.error; });
  if (!r) return;
  const dir = resultDir(id);
  const o = r.options;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `telios-${id}-`));
  try {
    const stage = stagesOf(id, [{ label: 'Tracing to SVG', seconds: 8 }, { label: 'Finishing', seconds: 2 }]);
    stage('Tracing to SVG');
    // the picture's own ground is kept, a scan's margin and all, only where that was asked for
    const traced = await python<{ layers: { id: string; color: string; name: string; share: number }[] }>([
      'trace', path.join(dir, 'source.png'), scratch, '--mode', 'full', '--max-colors', String(TRACE_MAX_COLORS), '--merge', String(TRACE_MERGE),
      ...(o.background === 'original' ? ['--keep-background'] : []),
    ], 10 * 60_000);
    if (signal.aborted) throw new Error('Stopped.');
    const svg = fs.readFileSync(path.join(scratch, 'layered.svg'));
    fs.writeFileSync(path.join(dir, 'result.svg'), svg);
    // what the app package is made from (restyle/package.ts): there is no reading, so what it is made for decides its kind, and no fitting data
    const kind = kindFor(o.madeFor, 'other');
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
      kind, rendering: 'flat', colorMode: 'full',
      palette: traced.layers.map((l) => ({ hex: l.color, name: l.name })), layers: traced.layers,
      summary: `Traced from the picture into ${traced.layers.length} flat colors; nothing was redrawn.`,
    }, null, 1));

    stage('Finishing');
    let png = await sharp(svg, { density: 72 }).resize({ width: PREVIEW_SIDE, height: PREVIEW_SIDE, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    if (o.background !== 'transparent' && o.background !== 'original') png = await sharp(png).flatten({ background: BACKGROUND_HEX[o.background] }).png().toBuffer();
    fs.writeFileSync(path.join(dir, 'result.png'), png);
    await screenCopies(png, dir);
    const meta = await sharp(png).metadata();
    fs.rmSync(path.join(dir, 'source.png'), { force: true });
    updateResult(id, (x) => {
      x.status = 'done';
      delete x.stage; delete x.progress;
      x.finishedAt = new Date().toISOString();
      x.size = [meta.width!, meta.height!];
      x.traced = { colors: traced.layers.map((l) => l.color) };
      if (o.madeFor === 'pattern') x.warning = 'Traced from the whole picture, as it was cropped: it tiles without a seam only if the picture is one exact repeat.';
      x.files = { png: rel(path.join(dir, 'result.png')), svg: rel(path.join(dir, 'result.svg')), thumb: rel(path.join(dir, 'thumb.webp')), view: rel(path.join(dir, 'view.webp')), original: rel(path.join(dir, 'original.webp')) };
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
