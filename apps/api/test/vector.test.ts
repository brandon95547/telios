import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { RestyleResult, RunEvent } from '@telios/shared';

process.env.TELIOS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'telios-vector-test-'));
process.env.TELIOS_PROVIDER = 'custom';
process.env.TELIOS_BASE_URL = 'http://127.0.0.1:9';   // never called: the model's steps are stubbed
process.env.TELIOS_MODEL = 'fake-model';

const { cleanOptions, DEFAULT_OPTIONS, OUTPUT_TYPES, drawnByModel, settingRows, typeInfo } = await import('@telios/shared');
const sharp = (await import('sharp')).default;
const express = (await import('express')).default;
const { drawVector } = await import('../src/restyle/vector.ts');
const { restylePrompt } = await import('../src/restyle/prompt.ts');
const { resultFolder, restyleRoutes } = await import('../src/restyle/routes.ts');
const { getResult, inputDir, removeResult, resultDir, saveInput, saveResult } = await import('../src/restyle/store.ts');
const { designDir, getDesign, getRun, listDesigns, rel, runDir, saveRun, updateDesign } = await import('../src/store.ts');
const { fromAnalysis } = await import('../src/engine/read.ts');

// ── The type ──

test('Flat SVG is a group of its own beside 2D and 3D, and the four illustration types are as they were', () => {
  assert.deepEqual([...new Set(OUTPUT_TYPES.map((t) => t.group))], ['2D', '3D', 'Vector']);
  assert.deepEqual(OUTPUT_TYPES.filter((t) => t.group !== 'Vector').map((t) => [t.value, t.group]), [['clipart', '2D'], ['lineart', '2D'], ['illustration', '2D'], ['render3d', '3D']]);
  assert.equal(typeInfo('vector').label, 'Flat SVG');
  assert.ok(typeInfo('vector').vector);
  assert.deepEqual(OUTPUT_TYPES.filter((t) => drawnByModel(t.value)).map((t) => t.value), ['vector']);
});

test('a flat SVG takes no art style, medium or theme, and ComfyUI is never asked to draw one', () => {
  const o = cleanOptions({ type: 'vector', style: 'art-deco', medium: 'watercolor', theme: 'celtic', notes: 'one ink', variations: 2 });
  assert.equal(o.type, 'vector');
  assert.deepEqual([o.style, o.medium, o.theme], ['', '', '']);
  assert.equal(o.notes, 'one ink');
  assert.equal(o.variations, 2);
  assert.equal(cleanOptions({ type: 'illustration', style: 'tonalism', theme: 'celtic' }).theme, 'celtic');   // the others keep theirs
  assert.throws(() => restylePrompt({ ...DEFAULT_OPTIONS, type: 'vector' }, 'x'), /not by ComfyUI/);
});

// ── Drawing one ──

async function makeResult(id: string, over: Partial<RestyleResult['options']> = {}) {
  const dir = resultDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const white = { create: { width: 40, height: 30, channels: 3 as const, background: '#ffffff' } };
  await sharp(white).png().toFile(path.join(dir, 'source.png'));
  await sharp(white).webp().toFile(path.join(dir, 'original.webp'));
  const r: RestyleResult = {
    id, batchId: 'b1', inputId: 'i1', inputName: 'Rose frame', folder: '', variation: 1, status: 'queued', createdAt: new Date().toISOString(),
    options: { ...DEFAULT_OPTIONS, type: 'vector', notes: 'keep the roses', ...over },
  };
  saveResult(r);
  return r;
}

const read = async (designId: string) => { updateDesign(designId, (d) => { d.status = 'ready'; d.reading = fromAnalysis({}); }); };

/** A stand-in for the drawing loop: it finishes a run with the files a real one writes. */
function finishes(seen: Record<string, unknown> = {}, cost = 0.0421) {
  return async (runId: string, hooks: { signal: AbortSignal; onEvent: (e: RunEvent) => void }) => {
    const run = getRun(runId)!;
    const design = getDesign(run.designId)!;
    Object.assign(seen, { note: run.options.note, confirmed: design.reading?.confirmed, model: run.options.model, mode: run.mode });
    const dir = path.join(runDir(run.designId, run.id), 'result');
    fs.mkdirSync(dir, { recursive: true });
    await sharp({ create: { width: 200, height: 150, channels: 4, background: { r: 30, g: 30, b: 30, alpha: 0 } } }).png().toFile(path.join(dir, 'preview.png'));
    fs.writeFileSync(path.join(dir, 'layered.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="8"><path d="M0 0h10v8z" fill="#222"/></svg>');
    fs.writeFileSync(path.join(dir, 'layout.json'), JSON.stringify({ form: 'frame', size: [10, 8], slice: 3 }));
    hooks.onEvent({ type: 'status', status: 'running', stage: 'draw', message: 'Running drawing 1' });
    run.status = 'done';
    run.usage.costUsd = cost;
    run.iterations.push({ n: 1, at: new Date().toISOString(), ok: true, notes: '', files: {} });
    run.result = {
      size: [10, 8], layers: [], layout: { form: 'frame', size: [10, 8], slice: 3 }, palette: [], summary: 'A rose frame, drawn new.', colorMode: 'full',
      files: { drawing: rel(path.join(dir, 'layered.svg')), layered: rel(path.join(dir, 'layered.svg')), preview: rel(path.join(dir, 'preview.png')), layout: rel(path.join(dir, 'layout.json')) },
    };
    saveRun(run);
  };
}

const designsOf = (resultId: string) => listDesigns().filter((d) => d.fromResult === resultId);

test('a flat SVG result gets the SVG, its fitting data and a preview, and its design stays out of the library', async () => {
  await makeResult('xvec1');
  const seen: Record<string, unknown> = {};
  await drawVector('xvec1', new AbortController().signal, { read, draw: finishes(seen) });
  const r = getResult('xvec1')!;
  assert.equal(r.status, 'done');
  assert.equal(r.stage, undefined);
  const dir = resultDir('xvec1');
  assert.match(fs.readFileSync(path.join(dir, 'result.svg'), 'utf8'), /^<svg /);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'layout.json'), 'utf8')), { form: 'frame', size: [10, 8], slice: 3 });
  for (const f of ['result.png', 'thumb.webp', 'view.webp', 'original.webp']) assert.ok(fs.existsSync(path.join(dir, f)), f);
  assert.ok(!fs.existsSync(path.join(dir, 'source.png')), 'the source is dropped once it is drawn');
  assert.deepEqual(Object.keys(r.files!).sort(), ['layout', 'original', 'png', 'svg', 'thumb', 'view']);
  assert.equal((await sharp(path.join(dir, 'result.png')).metadata()).hasAlpha, true);   // the window stays clear
  assert.deepEqual(r.size, [200, 150]);

  // what the loop was given: the model's reading, taken as confirmed, and the user's words
  assert.deepEqual(seen, { note: 'keep the roses', confirmed: true, model: 'Model fake-model', mode: 'reillustrate' });
  assert.equal(r.drawing?.renders, 1);
  assert.equal(r.drawing?.summary, 'A rose frame, drawn new.');
  assert.match(settingRows(r).map((x) => `${x.label}: ${x.value}`).join('\n'), /Drawn by: Model fake-model[\s\S]*Cost: about 4\.2¢/);
  assert.ok(!settingRows({ ...r, drawing: { ...r.drawing!, costUsd: 0 } }).some((x) => x.label === 'Cost'), 'a model with no known price shows no cost');

  // its design is the one the result names, and the library does not list it
  const [design] = designsOf('xvec1');
  assert.equal(r.designId, design.id);
  assert.equal(design.runs.length, 1);

  removeResult('xvec1');
  assert.ok(!fs.existsSync(dir));
  assert.ok(!fs.existsSync(designDir(design.id)), 'deleting the result takes its design too');
});

test('a flat SVG reports its stages as progress that only moves forward, and none once it is done', async () => {
  await makeResult('xvec4');
  const finish = finishes();
  const seen: [string | undefined, number][] = [];
  const draw = async (runId: string, hooks: { signal: AbortSignal; onEvent: (e: RunEvent) => void }) => {
    const watch = (stage: 'plan' | 'draw' | 'critique', message: string) => {
      hooks.onEvent({ type: 'status', status: 'running', stage, message });
      const r = getResult('xvec4')!;
      seen.push([r.stage, r.progress!.from]);
    };
    watch('plan', 'Studying the original');
    watch('draw', 'Running drawing 1');
    watch('critique', 'Checking drawing 1');
    watch('draw', 'Running drawing 2');
    watch('critique', 'Checking the seams and the fit');
    await finish(runId, hooks);
  };
  await drawVector('xvec4', new AbortController().signal, { read, draw });
  assert.deepEqual(seen.map(([s]) => s), ['Studying the original', 'Running drawing 1', 'Checking drawing 1', 'Running drawing 2', 'Checking the seams and the fit']);
  seen.forEach(([, from], i) => { if (i) assert.ok(from > seen[i - 1][1], `${seen[i][0]} is further on than ${seen[i - 1][0]}`); });
  assert.ok(seen[0][1] >= 0.1 && seen.at(-1)![1] < 1);
  const r = getResult('xvec4')!;
  assert.equal(r.status, 'done');
  assert.equal(r.progress, undefined);
  removeResult('xvec4');
});

test('a background other than transparent is put behind the preview, not the SVG', async () => {
  await makeResult('xvec2', { background: 'white' });
  await drawVector('xvec2', new AbortController().signal, { read, draw: finishes() });
  const dir = resultDir('xvec2');
  assert.equal((await sharp(path.join(dir, 'result.png')).metadata()).hasAlpha, false);
  assert.match(fs.readFileSync(path.join(dir, 'result.svg'), 'utf8'), /fill="#222"/);
  removeResult('xvec2');
});

test('a failed drawing fails the result in the run\'s own words, and trying again starts afresh', async () => {
  await makeResult('xvec3');
  const failing = async (runId: string) => { const run = getRun(runId)!; run.status = 'failed'; run.error = 'The model declined to continue this drawing.'; saveRun(run); };
  await drawVector('xvec3', new AbortController().signal, { read, draw: failing });
  const failed = getResult('xvec3')!;
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'The model declined to continue this drawing.');
  const [first] = designsOf('xvec3');
  assert.equal(failed.designId, first.id);

  saveResult({ ...failed, status: 'queued', error: undefined });   // what the retry route does
  await drawVector('xvec3', new AbortController().signal, { read, draw: finishes() });
  assert.equal(getResult('xvec3')!.status, 'done');
  const now = designsOf('xvec3');
  assert.equal(now.length, 1, 'the first try\'s design is gone');
  assert.notEqual(now[0].id, first.id);
  assert.ok(!fs.existsSync(designDir(first.id)));
  removeResult('xvec3');
});

test('stopping a drawing ends the result as stopped, with no error', async () => {
  await makeResult('xvec4');
  const stop = new AbortController();
  await drawVector('xvec4', stop.signal, { read, draw: async () => { stop.abort(); } });
  const r = getResult('xvec4')!;
  assert.equal(r.status, 'canceled');
  assert.equal(r.error, undefined);
  removeResult('xvec4');
});

test('a picture that cannot be read fails the result before any drawing', async () => {
  await makeResult('xvec5');
  let drew = false;
  await drawVector('xvec5', new AbortController().signal, {
    read: async (id) => { updateDesign(id, (d) => { d.status = 'failed'; d.error = 'The picture could not be opened.'; }); },
    draw: async () => { drew = true; },
  });
  assert.equal(getResult('xvec5')!.error, 'The picture could not be opened.');
  assert.equal(drew, false);
  removeResult('xvec5');
});

test('without a model the result fails with the reason, and no design is made', async () => {
  await makeResult('xvec6');
  process.env.TELIOS_PROVIDER = 'none';
  try {
    await drawVector('xvec6', new AbortController().signal, { read, draw: finishes() });
  } finally {
    process.env.TELIOS_PROVIDER = 'custom';
  }
  const r = getResult('xvec6')!;
  assert.equal(r.status, 'failed');
  assert.match(r.error!, /No model is set up/);
  assert.equal(designsOf('xvec6').length, 0);
  removeResult('xvec6');
});

// ── Asking for one, and downloading it ──

async function withApp<T>(run: (base: string, sent: { type: string }[]) => Promise<T>) {
  const sent: { type: string }[] = [];
  const app = express();
  app.use(express.json());
  app.use('/api/restyle', restyleRoutes((m) => { sent.push(m); }));
  const server = await new Promise<http.Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try { return await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/restyle`, sent); } finally { server.close(); }
}
const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('asking for a flat SVG needs a model; with one, each picture is queued for the worker', async () => {
  fs.mkdirSync(inputDir('ivec1'), { recursive: true });
  await sharp({ create: { width: 40, height: 30, channels: 3, background: '#ffffff' } }).png().toFile(path.join(inputDir('ivec1'), 'source.png'));
  saveInput({ id: 'ivec1', name: 'Rose frame', folder: '', createdAt: new Date().toISOString(), status: 'ready', format: 'png' });
  await withApp(async (base, sent) => {
    process.env.TELIOS_PROVIDER = 'none';
    try {
      const refused = await post(`${base}/results`, { inputIds: ['ivec1'], options: { type: 'vector' } });
      assert.equal(refused.status, 409);
      assert.match((await refused.json()).error, /No model is set up/);
      assert.equal(sent.length, 0);
    } finally {
      process.env.TELIOS_PROVIDER = 'custom';
    }
    const ok = await post(`${base}/results`, { inputIds: ['ivec1'], options: { type: 'vector', style: 'art-deco', theme: 'celtic', variations: 2 } });
    assert.equal(ok.status, 201);
    const { results } = await ok.json();
    assert.equal(results.length, 2);
    assert.deepEqual(results.map((r: RestyleResult) => [r.options.type, r.options.style, r.options.theme, r.status]), [['vector', '', '', 'queued'], ['vector', '', '', 'queued']]);
    assert.deepEqual(sent.map((m) => m.type), ['restyle', 'restyle']);
    for (const r of results) removeResult(r.id);
  });
});

test('a flat SVG downloads as its SVG and its fitting data, and its zip folder is named for the type', async () => {
  await makeResult('xvec7');
  await drawVector('xvec7', new AbortController().signal, { read, draw: finishes() });
  await withApp(async (base) => {
    const svg = await fetch(`${base}/results/xvec7/download?format=svg`);
    assert.equal(svg.headers.get('content-type'), 'image/svg+xml');
    assert.match(svg.headers.get('content-disposition')!, /Rose%20frame\.svg/);
    assert.match(await svg.text(), /^<svg /);
    const layout = await fetch(`${base}/results/xvec7/download?format=layout`);
    assert.match(layout.headers.get('content-disposition')!, /Rose%20frame\.layout\.json/);
    assert.deepEqual(await layout.json(), { form: 'frame', size: [10, 8], slice: 3 });
  });
  assert.equal(resultFolder(getResult('xvec7')!), 'Flat SVG');
  removeResult('xvec7');
});

test('a result with no fitting data says so', async () => {
  await makeResult('xvec8');
  await drawVector('xvec8', new AbortController().signal, { read, draw: finishes() });
  saveResult({ ...getResult('xvec8')!, files: { ...getResult('xvec8')!.files!, layout: undefined } });
  await withApp(async (base) => {
    assert.equal((await fetch(`${base}/results/xvec8/download?format=layout`)).status, 404);
  });
  removeResult('xvec8');
});
