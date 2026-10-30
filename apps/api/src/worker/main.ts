// The job worker: a child process the API forks. It owns the queue, the model calls, rendering
// and the Python calls, so none of that runs in the API's own process. Jobs and their events are
// persisted; the API is told about every change over IPC and passes it on to the browser.

import fs from 'node:fs';
import path from 'node:path';
import { DRAW_CONCURRENCY } from '../config.ts';
import { python } from '../python.ts';
import { appendEvent, designDir, getDesign, getRun, listDesigns, readJson, runDir, saveRun, updateDesign, writeJson } from '../store.ts';
import { readDesign } from '../engine/read.ts';
import { originalCrop } from '../engine/render.ts';
import { reillustrate, isCanceled } from '../engine/draw.ts';
import { finishDrawing, finishRebuild, finishTrace } from '../engine/finish.ts';
import { drawnByModel } from '@telios/shared';
import type { Reading, Run, RunEvent } from '@telios/shared';
import { prepareInput } from '../restyle/prepare.ts';
import { drawResult } from '../restyle/job.ts';
import { drawVector } from '../restyle/vector.ts';
import { getResult, listInputs, listResults, updateResult } from '../restyle/store.ts';

export type ToWorker = { type: 'ingest'; designId: string } | { type: 'run'; runId: string } | { type: 'cancel'; runId: string }
  | { type: 'prepare'; inputId: string } | { type: 'restyle'; resultId: string } | { type: 'stop'; resultIds: string[] };
export type FromWorker = { type: 'design'; designId: string } | { type: 'event'; runId: string; event: RunEvent } | { type: 'ready' };

const send = (m: FromWorker) => process.send?.(m);

class Queue {
  private waiting: (() => Promise<void>)[] = [];
  private active = 0;
  constructor(private limit: number) {}
  push(job: () => Promise<void>) { this.waiting.push(job); this.next(); }
  private next() {
    while (this.active < this.limit && this.waiting.length) {
      const job = this.waiting.shift()!;
      this.active++;
      job().catch((e) => console.error('[worker]', e)).finally(() => { this.active--; this.next(); });
    }
  }
}

const ingestQueue = new Queue(3);
const runQueue = new Queue(DRAW_CONCURRENCY);
const traceQueue = new Queue(2);
const controllers = new Map<string, AbortController>();
// Restyle: uploads made ready a few at a time; results drawn one at a time (one GPU, shared). A flat
// SVG is drawn by the model, so it waits in the runs' queue with the Vector redraw's own.
const prepareQueue = new Queue(3);
const restyleQueue = new Queue(1);
const drawing = new Map<string, AbortController>();

function restyle(resultId: string) {
  const byModel = drawnByModel(getResult(resultId)?.options.type ?? 'clipart');
  (byModel ? runQueue : restyleQueue).push(async () => {
    if (getResult(resultId)?.status !== 'queued') return;   // stopped or deleted while it waited
    const controller = new AbortController();
    drawing.set(resultId, controller);
    try {
      if (byModel) await drawVector(resultId, controller.signal, { read: ingest, draw: runJob });
      else await drawResult(resultId, controller.signal);
    } finally { drawing.delete(resultId); }
  });
}

// ── Upload → measurements → reading ──

async function ingest(designId: string) {
  const design = getDesign(designId);
  if (!design) return;
  const dir = designDir(designId);
  try {
    updateDesign(designId, (d) => { d.status = 'ingesting'; delete d.error; });
    send({ type: 'design', designId });
    const analysis = await python(['ingest', path.join(dir, design.original.file), dir]);
    writeJson(path.join(dir, 'analysis.json'), analysis);
    await originalCrop(dir, analysis);
    updateDesign(designId, (d) => { d.status = 'reading'; d.size = analysis.size; });
    send({ type: 'design', designId });
    const { reading, usage, error } = await readDesign(path.join(dir, 'view.png'), analysis);
    writeJson(path.join(dir, 'reading.json'), { reading, usage, error: error ?? null, at: new Date().toISOString() });
    updateDesign(designId, (d) => { d.reading = reading; d.status = 'ready'; if (error) d.error = `Read from measurements only: ${error}`; });
  } catch (e) {
    updateDesign(designId, (d) => { d.status = 'failed'; d.error = (e as Error).message; });
  }
  send({ type: 'design', designId });
}

// ── Runs ──

/** `hooks` is for a Restyle flat SVG, which runs this inside its own job: its signal stops the run, and
 * it hears every event. */
async function runJob(runId: string, hooks: { signal: AbortSignal; onEvent: (e: RunEvent) => void } | null = null) {
  const run = getRun(runId);
  if (!run || run.status !== 'queued') return;
  const design = getDesign(run.designId)!;
  const dDir = designDir(run.designId);
  const rDir = runDir(run.designId, run.id);
  const controller = new AbortController();
  controllers.set(runId, controller);
  if (hooks?.signal.aborted) controller.abort();
  else hooks?.signal.addEventListener('abort', () => controller.abort(), { once: true });
  const emit = (event: RunEvent) => {
    hooks?.onEvent(event);
    if (event.type === 'progress') return send({ type: 'event', runId, event });   // live only
    if (event.type === 'status') { run.status = event.status; run.stage = event.stage; }
    if (event.type === 'error') run.error = event.message;
    appendEvent(run, event);
    if (event.type !== 'note') saveRun(run);
    send({ type: 'event', runId, event });
  };
  run.startedAt = new Date().toISOString();
  try {
    const analysis = readJson<any>(path.join(dDir, 'analysis.json'));
    const crop = await originalCrop(dDir, analysis);
    let result;
    if (run.mode === 'trace') {
      emit({ type: 'status', status: 'running', stage: 'vectorize', message: 'Tracing the upload into color layers' });
      result = await finishTrace(design, run.reading, rDir, dDir, crop);
    } else if (run.mode === 'rebuild') {
      emit({ type: 'status', status: 'running', stage: 'draw', message: 'Finding the mirrored halves and repeating units, averaging their copies' });
      result = await finishRebuild(design, run, rDir, dDir, crop, emit, () => saveRun(run));
    } else {
      const drawing = await reillustrate({ run, runDir: rDir, designDir: dDir, analysis, cropPng: crop, emit, save: () => saveRun(run), signal: controller.signal });
      emit({ type: 'status', status: 'running', stage: 'vectorize', message: 'Turning the drawing into one layer per color' });
      result = await finishDrawing(design, run.reading, rDir, crop, drawing);
    }
    run.result = result;
    run.finishedAt = new Date().toISOString();
    emit({ type: 'result', result });
    emit({ type: 'status', status: 'done', stage: 'done', message: 'Done' });
  } catch (e) {
    run.finishedAt = new Date().toISOString();
    if (isCanceled(e) || controller.signal.aborted) emit({ type: 'status', status: 'canceled', stage: run.stage, message: 'Canceled' });
    else {
      console.error('[worker] run', runId, e);
      emit({ type: 'error', message: (e as Error).message });
      emit({ type: 'status', status: 'failed', stage: run.stage, message: (e as Error).message });
    }
  } finally {
    controllers.delete(runId);
  }
}

process.on('message', (m: ToWorker) => {
  if (m.type === 'prepare') prepareQueue.push(() => prepareInput(m.inputId));
  else if (m.type === 'restyle') restyle(m.resultId);
  else if (m.type === 'stop') {
    for (const id of m.resultIds) {
      const c = drawing.get(id);
      if (c) c.abort();
      else if (getResult(id)?.status === 'queued') updateResult(id, (r) => { r.status = 'canceled'; r.finishedAt = new Date().toISOString(); });
    }
  } else if (m.type === 'ingest') ingestQueue.push(() => ingest(m.designId));
  else if (m.type === 'run') {
    const run = getRun(m.runId);
    (run?.mode === 'reillustrate' ? runQueue : traceQueue).push(() => runJob(m.runId));
  } else if (m.type === 'cancel') {
    const c = controllers.get(m.runId);
    if (c) c.abort();
    else {
      const run = getRun(m.runId);
      if (run && run.status === 'queued') {
        run.status = 'canceled';
        saveRun(run);
        appendEvent(run, { type: 'status', status: 'canceled', stage: run.stage, message: 'Canceled' });
        send({ type: 'event', runId: run.id, event: { type: 'status', status: 'canceled', stage: run.stage, message: 'Canceled' } });
      }
    }
  }
});

// On start: finish what a restart interrupted. Uploads are measured and read again; queued runs
// go back in the queue; a run that was mid-way is marked interrupted (it can be run again).
for (const d of listDesigns()) {
  if (d.fromResult) continue;   // a flat SVG's design: its result starts it again, from the start
  if (d.status === 'ingesting' || d.status === 'reading') ingestQueue.push(() => ingest(d.id));
  for (const runId of d.runs) {
    const run = getRun(runId);
    if (!run) continue;
    if (run.status === 'queued') (run.mode === 'reillustrate' ? runQueue : traceQueue).push(() => runJob(run.id));
    else if (run.status === 'running') {
      run.status = 'interrupted';
      run.error = 'Telios stopped while this run was going.';
      saveRun(run);
      appendEvent(run, { type: 'status', status: 'interrupted', stage: run.stage, message: run.error });
    }
  }
}
// Restyle's work, picked up again: an upload being made ready is made ready; a result being
// drawn is drawn again, from the start, in its turn.
for (const i of listInputs()) if (i.status === 'preparing') prepareQueue.push(() => prepareInput(i.id));
for (const r of listResults().reverse()) {
  if (r.status === 'running') updateResult(r.id, (x) => { x.status = 'queued'; delete x.stage; });
  if (r.status === 'running' || r.status === 'queued') restyle(r.id);
}
fs.mkdirSync(path.dirname(designDir('x')), { recursive: true });
send({ type: 'ready' });

process.on('disconnect', () => process.exit(0));
export type { Reading, Run };
