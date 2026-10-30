import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RestyleResult } from '@telios/shared';

process.env.TELIOS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'telios-progress-test-'));

const { DEFAULT_OPTIONS, progressAt } = await import('@telios/shared');
const { drawingStage, stagesOf } = await import('../src/restyle/progress.ts');
const { getResult, saveResult } = await import('../src/restyle/store.ts');

const running = (id: string): RestyleResult => ({
  id, batchId: 'b1', inputId: 'i1', inputName: 'Rose frame', folder: '', variation: 1, status: 'running', createdAt: new Date().toISOString(), options: DEFAULT_OPTIONS,
});

test('a job\'s stages share the bar by how long they take, in order, from nothing to all', () => {
  saveResult(running('xprog1'));
  const stage = stagesOf('xprog1', [{ label: 'Reading', seconds: 4 }, { label: 'Drawing', seconds: 28 }, { label: 'Finishing', seconds: 8 }]);
  const seen = ['Reading', 'Drawing', 'Finishing'].map((label) => { stage(label); const r = getResult('xprog1')!; return [r.stage, r.progress!.from, r.progress!.to, r.progress!.seconds]; });
  assert.deepEqual(seen, [['Reading', 0, 0.1, 4], ['Drawing', 0.1, 0.8, 28], ['Finishing', 0.8, 1, 8]]);
  assert.ok(progressAt(getResult('xprog1')!.progress!, Date.now() + 3600_000) <= 1 + 1e-9);
});

test('a stage left out of the plan leaves no gap in the bar, and an unplanned label changes the words alone', () => {
  saveResult(running('xprog2'));
  const stage = stagesOf('xprog2', [{ label: 'Drawing', seconds: 30 }, { label: 'Finishing', seconds: 10 }]);   // no reading, no enlarging
  stage('Drawing');
  assert.equal(getResult('xprog2')!.progress!.from, 0);
  stage('Something else');
  const r = getResult('xprog2')!;
  assert.equal(r.stage, 'Something else');
  assert.deepEqual([r.progress!.from, r.progress!.to], [0, 0.75], 'the stretch of the last planned stage stays');
});

test('the drawing loop\'s messages map to stretches that run forward and fit between reading and finishing', () => {
  const max = 6;
  const steps = [
    drawingStage('plan', 'Studying the original', max),
    ...[1, 2, 3, 4, 5, 6].flatMap((n) => [drawingStage('draw', `Running drawing ${n}`, max), drawingStage('critique', `Checking drawing ${n}`, max)]),
    drawingStage('critique', 'Checking the seams and the fit', max),
  ].map((s) => s!);
  steps.forEach(([from, to, seconds], i) => {
    assert.ok(from < to && seconds > 0, `step ${i} has a stretch`);
    if (i) assert.ok(Math.abs(from - steps[i - 1][1]) < 1e-9 || from >= steps[i - 1][1], `step ${i} starts where the one before ended`);
  });
  assert.equal(steps[0][0], 0.1);
  assert.ok(steps.at(-1)![1] < 1, 'finishing keeps the end');
  assert.equal(drawingStage('draw', 'Something it does not know', max), null);
  assert.equal(drawingStage('ingest', 'Running drawing 1', max), null);
});
