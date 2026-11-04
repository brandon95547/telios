// A cutout: a one-ink object (fine detail, nothing that repeats) lifted off its plain background. The worker's `cutout` makes the
// ground clear, sets a turned picture level, cleans up its edges and enlarges a small scan smoothly; nothing is redrawn, so neither
// ComfyUI nor a model is involved. The result is a transparent picture (result.png, and WebP on download), on the CPU, in seconds.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { CLEANUPS } from '@telios/shared';
import { python } from '../python.ts';
import { screenCopies } from './job.ts';
import { stagesOf } from './progress.ts';
import { rel, resultDir, updateResult } from './store.ts';

interface Cut { size: [number, number]; tilt: number; ink: string; enlarged: number }

export async function drawCutout(id: string, signal: AbortSignal) {
  const r = updateResult(id, (x) => { x.status = 'running'; x.stage = 'Starting'; delete x.progress; x.startedAt = new Date().toISOString(); delete x.error; });
  if (!r) return;
  const dir = resultDir(id);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `telios-${id}-`));
  try {
    const stage = stagesOf(id, [{ label: 'Lifting it off the background', seconds: 4 }, { label: 'Finishing', seconds: 2 }]);
    stage('Lifting it off the background');
    let cut: Cut;
    try {
      cut = await python<Cut>(['cutout', path.join(dir, 'source.png'), scratch, '--cleanup', String(CLEANUPS.findIndex((c) => c.value === r.options.cleanup))], 5 * 60_000);
    } catch (e) {
      throw new Error((e as Error).message.replace(/^\w*Error:\s*/, ''));
    }
    if (signal.aborted) throw new Error('Stopped.');
    stage('Finishing');
    const png = fs.readFileSync(path.join(scratch, 'cutout.png'));
    fs.writeFileSync(path.join(dir, 'result.png'), png);
    await screenCopies(png, dir);
    const meta = await sharp(png).metadata();
    fs.rmSync(path.join(dir, 'source.png'), { force: true });
    updateResult(id, (x) => {
      x.status = 'done';
      delete x.stage; delete x.progress;
      x.finishedAt = new Date().toISOString();
      x.size = [meta.width!, meta.height!];
      x.cutout = { ink: cut.ink, tilt: cut.tilt, enlarged: cut.enlarged };
      x.files = { png: rel(path.join(dir, 'result.png')), thumb: rel(path.join(dir, 'thumb.webp')), view: rel(path.join(dir, 'view.webp')), original: rel(path.join(dir, 'original.webp')) };
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
