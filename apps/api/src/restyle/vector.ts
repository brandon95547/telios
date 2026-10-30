// A flat SVG result: the input drawn again as new vector art by the model, with the Vector redraw's
// loop (measure and read the picture, then draw, render and revise a drawing program). The picture
// becomes a design of its own in the data folder, kept out of the library and removed with the
// result; its finished drawing is copied into the result, so the grid, the viewer and the zip treat
// it like any other. Runs in the job worker, a few at a time (each is mostly waiting on the model).

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { BACKGROUND_HEX } from '@telios/shared';
import type { Design, RunEvent } from '@telios/shared';
import { DATA } from '../config.ts';
import { provider } from '../engine/llm.ts';
import { newRun } from '../engine/newrun.ts';
import { designDir, getDesign, getRun, newId, saveDesign, updateDesign } from '../store.ts';
import { screenCopies } from './job.ts';
import { rel, resultDir, updateResult } from './store.ts';

/** The two steps the job worker owns, which this job borrows. */
export interface VectorSteps {
  /** Measure a design and have the model read it (leaves it ready, or failed). */
  read: (designId: string) => Promise<void>;
  /** Run a queued run to its end, stopping when the signal does. */
  draw: (runId: string, hooks: { signal: AbortSignal; onEvent: (e: RunEvent) => void }) => Promise<void>;
}

export async function drawVector(id: string, signal: AbortSignal, steps: VectorSteps) {
  const stage = (s: string) => updateResult(id, (x) => { x.stage = s; });
  const r = updateResult(id, (x) => { x.status = 'running'; x.stage = 'Starting'; x.startedAt = new Date().toISOString(); delete x.error; });
  if (!r) return;
  const dir = resultDir(id);
  const o = r.options;
  const stopped = () => { if (signal.aborted) throw new Error('Stopped.'); };
  try {
    const model = provider();
    if (!model.provider) throw new Error(model.error);

    // a try again starts afresh: what the last try drew is removed
    if (r.designId) fs.rmSync(designDir(r.designId), { recursive: true, force: true });
    const design: Design = {
      id: newId('d'), name: r.inputName.slice(0, 120), createdAt: new Date().toISOString(), status: 'ingesting', runs: [], fromResult: id,
      original: { file: 'original.png', type: 'image/png', bytes: 0 },
    };
    const ddir = designDir(design.id);
    fs.mkdirSync(ddir, { recursive: true });
    fs.copyFileSync(path.join(dir, 'source.png'), path.join(ddir, 'original.png'));
    design.original.bytes = fs.statSync(path.join(ddir, 'original.png')).size;
    saveDesign(design);
    // the result was deleted meanwhile: nothing of it is kept
    if (!updateResult(id, (x) => { x.designId = design.id; })) { fs.rmSync(ddir, { recursive: true, force: true }); return; }

    stage('Measuring and reading the picture');
    await steps.read(design.id);
    stopped();
    const read = getDesign(design.id);
    if (read?.status !== 'ready' || !read.reading) throw new Error(read?.error ?? 'The picture could not be read.');
    // the batch has no step to check the reading: what the model read is what it draws
    updateDesign(design.id, (d) => { if (d.reading) d.reading.confirmed = true; });

    const run = newRun(getDesign(design.id)!, 'reillustrate', { note: o.notes || undefined });
    stage('Studying the picture');
    await steps.draw(run.id, { signal, onEvent: (e) => { if (e.type === 'status' && e.status === 'running' && e.message) stage(e.message); } });
    stopped();
    const done = getRun(run.id);
    if (done?.status !== 'done' || !done.result) throw new Error(done?.error ?? 'The drawing did not finish.');
    const res = done.result;

    stage('Finishing');
    const from = (p: string) => path.join(DATA, p);
    let png = fs.readFileSync(from(res.files.preview));
    if (o.background !== 'transparent') png = await sharp(png).flatten({ background: BACKGROUND_HEX[o.background] }).png().toBuffer();
    fs.writeFileSync(path.join(dir, 'result.png'), png);
    fs.copyFileSync(from(res.files.layered), path.join(dir, 'result.svg'));
    if (res.files.layout) fs.copyFileSync(from(res.files.layout), path.join(dir, 'layout.json'));
    await screenCopies(png, dir);
    const meta = await sharp(png).metadata();
    fs.rmSync(path.join(dir, 'source.png'), { force: true });
    updateResult(id, (x) => {
      x.status = 'done';
      delete x.stage;
      x.finishedAt = new Date().toISOString();
      x.size = [meta.width!, meta.height!];
      x.drawing = {
        runId: done.id, model: done.options.model, renders: done.iterations.filter((i) => i.ok).length, maxRenders: done.options.maxRenders,
        costUsd: done.usage.costUsd, kind: done.reading.kind, colorMode: res.colorMode, summary: res.summary,
      };
      x.files = {
        png: rel(path.join(dir, 'result.png')), svg: rel(path.join(dir, 'result.svg')), ...(res.files.layout && { layout: rel(path.join(dir, 'layout.json')) }),
        thumb: rel(path.join(dir, 'thumb.webp')), view: rel(path.join(dir, 'view.webp')), original: rel(path.join(dir, 'original.webp')),
      };
    });
  } catch (e) {
    const canceled = signal.aborted;
    updateResult(id, (x) => {
      x.status = canceled ? 'canceled' : 'failed';
      delete x.stage;
      x.finishedAt = new Date().toISOString();
      if (!canceled) x.error = (e as Error).message;
    });
    if (!canceled) console.error('[restyle]', id, e);
  }
}
