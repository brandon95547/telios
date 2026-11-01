import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { cellFacts, cellOf, cutCell, tileInstruction } from '../src/engine/lattice.ts';

// what the worker measured on a printed lattice: a staggered pattern, 458 × 790 px a cell, two motifs in each
const analysis = (over: Record<string, unknown> = {}) => ({
  bbox: [20, 22, 918, 2100],
  lattice: { a: [-229, -395], b: [229, -395], strength: 0.4, kind: 'half-drop', cell: [458, 790], perCell: 2, ...over },
});

test('the cell is the rectangle that repeats, as shares of the design, with how many the scan holds', () => {
  const c = cellOf(analysis())!;
  assert.equal(c.kind, 'half-drop');
  assert.equal(c.perCell, 2);
  assert.ok(Math.abs(c.wShare - 0.499) < 0.001 && Math.abs(c.hShare - 0.376) < 0.001);
  assert.ok(Math.abs(c.aspect - 458 / 790) < 1e-9);
  assert.ok(Math.abs(c.across - 2.004) < 0.01 && Math.abs(c.down - 2.658) < 0.01);
});

test('there is no cell where none was measured, the match is weak, or the scan shows less than one', () => {
  assert.equal(cellOf(null), null);
  assert.equal(cellOf({ bbox: [0, 0, 100, 100] }), null);
  assert.equal(cellOf(analysis({ cell: null })), null);
  assert.equal(cellOf(analysis({ strength: 0.2 })), null, 'a weak match is not trusted over the model’s eye');
  assert.equal(cellOf(analysis({ cell: [2000, 790] })), null, 'wider than the scan');
  assert.equal(cellOf({ ...analysis(), bbox: [0, 0, 300, 2100] }), null);
});

test('the model is told the cell’s shape, how many motifs it holds, and that the scan is not the tile', () => {
  const c = cellOf(analysis())!;
  assert.deepEqual(cellFacts(c).cell, { widthShare: 0.499, heightShare: 0.376, aspect: 0.58 });
  assert.equal(cellFacts(c).motifCentersPerCell, 2);
  const words = tileInstruction(c);
  assert.match(words, /layout\.form 'tile', lattice 'half-drop'/);
  assert.match(words, /ONE CELL/);
  assert.match(words, /two motif centers/);
  assert.match(words, /0\.58/);
  assert.match(words, /about 1044 wide by 1800 high/);
  assert.match(tileInstruction({ ...c, kind: 'grid', perCell: 1, aspect: 1.5 }), /one motif center in it/);
});

test('one cell is cut from the middle of the scan, at the cell’s size', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'telios-cell-'));
  const src = path.join(dir, 'crop.png');
  await sharp({ create: { width: 918, height: 2100, channels: 3, background: '#808080' } }).png().toFile(src);
  const out = await cutCell(src, cellOf(analysis())!, path.join(dir, 'cell.png'));
  assert.deepEqual([out.width, out.height], [458, 790]);
  const m = await sharp(out.file).metadata();
  assert.deepEqual([m.width, m.height], [458, 790]);
});
