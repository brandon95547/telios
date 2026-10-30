import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.TELIOS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'telios-kinds-test-'));
process.env.TELIOS_PROVIDER = 'custom';
process.env.TELIOS_BASE_URL = 'http://127.0.0.1:9';
process.env.TELIOS_MODEL = 'fake-model';

const { systemOf } = await import('../src/engine/draw.ts');

const FRAME_NOTES = 'This piece is a frame: made app-ready';
const OBJECT_NOTES = 'This piece is an object: drawn whole';

test('a frame is given the frame notes, the kit and its example; an object and the rest are not', () => {
  const frame = systemOf('frame');
  assert.ok(frame.includes(FRAME_NOTES));
  assert.ok(frame.includes('function frameKit('), 'the kit is in the library every kind has');
  assert.ok(frame.includes('Example 3: a frame built with frameKit'));
  assert.ok(frame.includes('square master'));
  assert.ok(!frame.includes(OBJECT_NOTES));
  for (const cls of ['object', 'border', 'corner', 'tile'] as const) {
    const text = systemOf(cls);
    assert.ok(!text.includes(FRAME_NOTES), `${cls} gets no frame rules`);
    assert.ok(!text.includes('Example 3'), `${cls} is not shown the kit's example`);
    assert.ok(text.includes('Example 1: Persian Carpet') && text.includes('Example 2: Renaissance Moresque'), `${cls} keeps the two examples it always had`);
  }
});

test('an object is given the notes for a whole piece, and what an object is not asked is not asked of a frame', () => {
  assert.ok(systemOf('object').includes(OBJECT_NOTES));
  assert.ok(systemOf('object').includes("form: 'whole'"));
  for (const cls of ['frame', 'border', 'corner', 'tile'] as const) assert.ok(!systemOf(cls).includes(OBJECT_NOTES), `${cls} gets no object rules`);
});

test('every kind is told about the app-ready checks, and the brief no longer fixes the canvas for all of them', () => {
  for (const cls of ['frame', 'object', 'border', 'corner', 'tile'] as const) {
    const text = systemOf(cls);
    assert.ok(text.includes('## App-ready'), cls);
    assert.ok(text.includes('as the task says for this kind of piece'), cls);
    assert.ok(!text.includes('about 1200–1800 on the long side. The canvas is the design itself, edge to edge'), `${cls}: the old canvas rule is gone from the shared brief`);
  }
});

test('the prompts are made once and kept: the same text comes back', () => {
  assert.equal(systemOf('frame'), systemOf('frame'));
  assert.notEqual(systemOf('frame'), systemOf('object'));
});
