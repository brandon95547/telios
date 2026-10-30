// A new run of a design, queued: its record, its first event, and its place in the design's list.
// The caller sends it to the job worker.

import type { Design, Run, RunMode } from '@telios/shared';
import { DRAW_EFFORT, MAX_RENDERS } from '../config.ts';
import { appendEvent, runIdFor, saveRun, updateDesign } from '../store.ts';
import { provider } from './llm.ts';

export function newRun(d: Design, mode: RunMode, { maxRenders, note }: { maxRenders?: number; note?: string } = {}): Run {
  if (!d.reading) throw new Error('The design has not been read yet.');
  const model = mode === 'reillustrate' ? provider().provider : null;
  if (mode === 'reillustrate' && !model) throw new Error(provider().error);
  const run: Run = {
    id: runIdFor(d.id, d.runs.length + 1),
    designId: d.id,
    mode,
    status: 'queued',
    stage: 'queued',
    createdAt: new Date().toISOString(),
    options: { maxRenders: Math.max(2, Math.min(20, Number(maxRenders) || MAX_RENDERS)), model: model ? `${model.label} ${model.model}` : '', effort: DRAW_EFFORT, ...(note && { note }) },
    reading: d.reading,
    iterations: [],
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 },
  };
  saveRun(run);
  appendEvent(run, { type: 'status', status: 'queued', stage: 'queued', message: 'Waiting for a free worker' });
  updateDesign(d.id, (x) => { x.runs.push(run.id); });
  return run;
}
