import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { RestyleResult } from '@telios/shared';

process.env.TELIOS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'telios-rotate-test-'));

const { CATALOG, cleanOptions, DEFAULT_OPTIONS, rotatedStyle, styleChoices, styleFits } = await import('@telios/shared');
const sharp = (await import('sharp')).default;
const express = (await import('express')).default;
const { restyleRoutes } = await import('../src/restyle/routes.ts');
const { inputDir, saveInput } = await import('../src/restyle/store.ts');

// ── The list ──

test('the styles that rotate are the ones the dropdown lists, in its order: each art style, then its substyles', () => {
  const list = styleChoices('illustration');
  const expected = CATALOG.artStyles.flatMap((a) => [a.id, ...a.substyles.map((s) => s.id)]);
  assert.deepEqual(list, expected);
  assert.equal(list[0], 'realism');
  assert.ok(list.every((id) => styleFits('illustration', id)));
  assert.ok(list.length > 20, `${list.length} styles`);
  assert.deepEqual(styleChoices('vector'), [], 'a flat SVG has no styles to rotate');
});

test('the nth picture takes the nth style, and the list starts over after its last', () => {
  const list = styleChoices('illustration');
  assert.equal(rotatedStyle('illustration', 0), list[0]);
  assert.equal(rotatedStyle('illustration', 1), list[1]);
  assert.equal(rotatedStyle('illustration', list.length - 1), list.at(-1));
  assert.equal(rotatedStyle('illustration', list.length), list[0], 'the first again');
  assert.equal(rotatedStyle('illustration', list.length + 2), list[2]);
  assert.equal(rotatedStyle('trace', 3), '');
});

// ── The option ──

test('Rotate styles is off by default, only an illustration has it, and it leaves no style chosen', () => {
  assert.equal(DEFAULT_OPTIONS.rotateStyles, false);
  assert.equal(cleanOptions({}).rotateStyles, false);
  assert.equal(cleanOptions({ rotateStyles: 'yes' }).rotateStyles, false, 'only true turns it on');
  assert.equal(cleanOptions({ rotateStyles: true }).rotateStyles, true);
  const both = cleanOptions({ rotateStyles: true, style: 'art-deco' });
  assert.deepEqual([both.rotateStyles, both.style], [true, ''], 'the rotation gives each picture its own style');
  assert.equal(cleanOptions({ style: 'art-deco' }).style, 'art-deco', 'off, the style chosen is the one drawn');
  for (const type of ['trace', 'vector']) assert.equal(cleanOptions({ type, rotateStyles: true }).rotateStyles, false, type);
});

// ── A batch ──

let base = '';
let server: http.Server;
const post = async (url: string, body: unknown) => {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

async function inputs(n: number) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = `irot${i}`;
    fs.mkdirSync(inputDir(id), { recursive: true });
    await sharp({ create: { width: 30, height: 20, channels: 3, background: '#cc3333' } }).png().toFile(path.join(inputDir(id), 'source.png'));
    saveInput({ id, name: `Picture ${i}`, folder: '', createdAt: new Date().toISOString(), status: 'ready', format: 'png', hash: `h${i}` });
    ids.push(id);
  }
  return ids;
}

test('start the routes', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/restyle', restyleRoutes(() => undefined));
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/restyle`;
});

test('a batch with Rotate styles on gives each picture the next style, from the first, and starts over at the end', async () => {
  const list = styleChoices('illustration');
  const ids = await inputs(list.length + 3);
  const { status, body } = await post(`${base}/results`, { inputIds: ids, options: { type: 'illustration', rotateStyles: true, style: 'art-deco' } });
  assert.equal(status, 201);
  const styles = (body.results as RestyleResult[]).map((r) => r.options.style);
  assert.equal(styles.length, ids.length);
  assert.deepEqual(styles.slice(0, list.length), list, 'every style once, in the dropdown’s order');
  assert.deepEqual(styles.slice(list.length), list.slice(0, 3), 'then the first again');
  assert.ok((body.results as RestyleResult[]).every((r) => r.options.rotateStyles), 'each result says its style was one of a rotation');
});

test('every version of a picture takes that picture’s style', async () => {
  const ids = await inputs(2);
  const { body } = await post(`${base}/results`, { inputIds: ids, options: { type: 'illustration', rotateStyles: true, variations: 3 } });
  const by = new Map<string, Set<string>>();
  for (const r of body.results as RestyleResult[]) by.set(r.inputId, (by.get(r.inputId) ?? new Set()).add(r.options.style));
  const list = styleChoices('illustration');
  assert.deepEqual([...by.get(ids[0])!], [list[0]]);
  assert.deepEqual([...by.get(ids[1])!], [list[1]]);
  assert.equal((body.results as RestyleResult[]).length, 6);
});

test('with it off, the style chosen is drawn on every picture, and none when none is chosen', async () => {
  const ids = await inputs(3);
  const chosen = await post(`${base}/results`, { inputIds: ids, options: { type: 'illustration', style: 'art-deco' } });
  assert.deepEqual((chosen.body.results as RestyleResult[]).map((r) => r.options.style), ['art-deco', 'art-deco', 'art-deco']);
  const none = await post(`${base}/results`, { inputIds: ids, options: { type: 'illustration' } });
  assert.deepEqual((none.body.results as RestyleResult[]).map((r) => [r.options.style, r.options.rotateStyles]), [['', false], ['', false], ['', false]]);
});

test('a download, and so an approved save, is named for the picture and the style it was drawn in', async () => {
  const { saveResult, resultDir, rel } = await import('../src/restyle/store.ts');
  const make = async (id: string, style: string) => {
    fs.mkdirSync(resultDir(id), { recursive: true });
    await sharp({ create: { width: 20, height: 20, channels: 3, background: '#336699' } }).png().toFile(path.join(resultDir(id), 'result.png'));
    saveResult({
      id, batchId: 'b', inputId: 'i', inputName: 'Rose frame', folder: '', variation: 1, status: 'done', createdAt: new Date().toISOString(),
      options: { ...DEFAULT_OPTIONS, type: 'illustration', style, format: 'png' },
      files: { png: rel(path.join(resultDir(id), 'result.png')), thumb: '', view: '', original: '' },
    });
  };
  await make('xnamea1', 'art-deco');
  await make('xnameb1', '');
  const named = await fetch(`${base}/results/xnamea1/download`);
  assert.equal(decodeURIComponent(/filename="([^"]+)"/.exec(named.headers.get('content-disposition') ?? '')![1]), 'Rose frame - Art Deco.png');
  const plain = await fetch(`${base}/results/xnameb1/download`);
  assert.equal(decodeURIComponent(/filename="([^"]+)"/.exec(plain.headers.get('content-disposition') ?? '')![1]), 'Rose frame.png');
});

test('stop the routes', () => { server.close(); });
