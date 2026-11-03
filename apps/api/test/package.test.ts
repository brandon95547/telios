import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RestyleResult } from '@telios/shared';

process.env.TELIOS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'telios-package-test-'));

const { DEFAULT_OPTIONS } = await import('@telios/shared');
const { scaledLayout, writePackage } = await import('../src/restyle/package.ts');
const { resultDir, saveResult } = await import('../src/restyle/store.ts');

// a layered SVG as the worker writes it: its width and height are the design's, its viewBox twice that
const LAYERED = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="100" height="80" viewBox="0 0 200 160"><title>Rose</title>'
  + '<g id="layer-1-ink" inkscape:groupmode="layer" inkscape:label="Ink" fill="#1a110b"><path d="M60 40h80v80H60z"/></g></svg>';

function result(id: string, kind: string, layout: object | null, over: Partial<RestyleResult> = {}) {
  const dir = resultDir(id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'result.svg'), LAYERED);
  if (layout) fs.writeFileSync(path.join(dir, 'layout.json'), JSON.stringify(layout));
  fs.writeFileSync(path.join(dir, 'fitsheet.png'), 'png');
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
    kind, rendering: 'flat', colorMode: 'one-ink', palette: [{ hex: '#1a110b', name: 'Ink' }], layers: [{ id: 'layer-1-ink', color: '#1a110b', name: 'Ink', share: 1 }],
    summary: 'A rose.', model: 'a model', appReady: { piece: 'object', ok: true, checks: [{ id: 'clip', label: 'Nothing cut off', ok: true, detail: 'fine' }] },
  }));
  const r: RestyleResult = {
    id, batchId: 'b', inputId: 'i', inputName: 'Rose.png', folder: '', variation: 1, status: 'done', createdAt: new Date().toISOString(),
    options: { ...DEFAULT_OPTIONS, type: 'vector' }, size: [100, 80],
    drawing: { runId: 'r', model: 'a model', renders: 1, maxRenders: 6, costUsd: 0, kind, colorMode: 'one-ink', summary: 'A rose.' },
    files: { png: 'p', svg: 'result.svg', fitsheet: 'fitsheet.png', thumb: 't', view: 'v', original: 'o' }, ...over,
  };
  saveResult(r);
  return r;
}
const manifestOf = (files: { src: string; name: string }[]) => JSON.parse(fs.readFileSync(files.find((f) => f.name.endsWith('.json'))!.src, 'utf8'));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'telios-pkg-out-'));

test('fitting data is put in the SVG\'s own units: every length times the viewBox\'s share of the design', () => {
  const l = scaledLayout({ form: 'frame', size: [100, 80], slice: [20, 25], keep: { x: [40, 60] }, repeat: { x: [20, 30], y: [25, 35] } }, 2, [200, 160]);
  assert.deepEqual(l, { form: 'frame', size: [200, 160], slice: [40, 50], keep: { x: [80, 120] }, repeat: { x: [40, 60], y: [50, 70] } });
  assert.equal(scaledLayout({ form: 'frame', size: [100, 80], slice: 20 }, 1.5, [150, 120]).slice, 30, 'one slice for both ways stays one number');
});

test('a frame\'s package keeps its whole canvas, with its fitting data converted, and brings its checks and sheet', async () => {
  const r = result('xpkg1', 'frame', { form: 'frame', size: [100, 80], slice: [20, 20], repeat: { x: [20, 30], y: [20, 30] }, units: 'x' });
  const files = await writePackage(r, 'Rose', tmp());
  assert.deepEqual(files.map((f) => f.name).sort(), ['README.txt', 'Rose.fitsheet.png', 'Rose.json', 'Rose.svg']);
  const m = manifestOf(files);
  assert.equal(m.format, 'telios-app-package');
  assert.equal(m.piece, 'frame');
  assert.deepEqual(m.viewBox, [0, 0, 200, 160]);
  assert.deepEqual(m.layout.size, [200, 160]);
  assert.deepEqual(m.layout.slice, [40, 40]);
  assert.deepEqual(m.layout.repeat, { x: [40, 60], y: [40, 60] });
  assert.equal(m.appReady.ok, true);
  assert.match(fs.readFileSync(files.find((f) => f.name === 'Rose.svg')!.src, 'utf8'), /width="200" height="160" viewBox="0 0 200 160"/);
  assert.match(fs.readFileSync(files.find((f) => f.name === 'README.txt')!.src, 'utf8'), /App-ready: every check passed/);
});

test('an object is trimmed to its drawing, so it sits exactly in its box, and has no fitting data to carry', async () => {
  const r = result('xpkg2', 'ornament', null);
  const files = await writePackage(r, 'Rose', tmp(), 'Rose-package/');
  assert.ok(files.every((f) => f.name.startsWith('Rose-package/')));
  const m = manifestOf(files);
  assert.equal(m.piece, 'object');
  assert.deepEqual(m.layout, { form: 'whole', size: m.size });
  // the ink is 80 × 80 at (60, 40) in a 200 × 160 canvas: a margin of 1% of the long side is left round it
  const [x, y, w, h] = m.viewBox;
  assert.ok(Math.abs(x - 58) < 1.5 && Math.abs(y - 38) < 1.5 && Math.abs(w - 84) < 3 && Math.abs(h - 84) < 3, JSON.stringify(m.viewBox));
  const svg = fs.readFileSync(files.find((f) => f.name.endsWith('.svg'))!.src, 'utf8');
  assert.match(svg, new RegExp(`width="${m.size[0]}" height="${m.size[1]}" viewBox="${x} ${y} ${w} ${h}"`));
  // centered: the same room each side
  const left = 60 - x, right = x + w - 140, top = 40 - y, bottom = y + h - 120;
  assert.ok(Math.abs(left - right) < 2 && Math.abs(top - bottom) < 2, `${left} ${right} ${top} ${bottom}`);
});

test('a piece drawn before the checks existed still packages, and says so', async () => {
  const r = result('xpkg3', 'border', { form: 'border', size: [100, 80], repeat: { x: [10, 50] } }, { drawing: { runId: 'r', model: 'm', renders: 1, maxRenders: 6, costUsd: 0, kind: 'border', colorMode: 'one-ink', summary: 's' } });
  fs.rmSync(path.join(resultDir('xpkg3'), 'meta.json'));
  const files = await writePackage(r, 'Strip', tmp());
  const m = manifestOf(files);
  assert.equal(m.piece, 'border');
  assert.equal(m.appReady, null);
  assert.deepEqual(m.layout.repeat, { x: [20, 100] });
  assert.match(fs.readFileSync(files.find((f) => f.name === 'README.txt')!.src, 'utf8'), /No app-ready checks were recorded/);
});
