import { test } from 'node:test';
import assert from 'node:assert/strict';

const { fileOf, fileSafe, nameOf, saveResults } = await import('../../web/src/restyle/approve.ts');

/** A folder that keeps what is written to it, as the browser's does. */
function folder() {
  const files = new Map<string, string>();
  return {
    files,
    name: 'For Talari',
    async getFileHandle(name: string, o?: { create?: boolean }) {
      if (!files.has(name) && !o?.create) throw Object.assign(new Error('not found'), { name: 'NotFoundError' });
      return { createWritable: async () => { let text = ''; return { write: async (b: Blob) => { text = await b.text(); }, close: async () => { files.set(name, text); } }; } };
    },
  };
}
const result = (id: string, o: object = {}) => ({ id, inputName: `input-${id}`, options: { type: 'illustration', format: 'webp' }, files: { png: 'x' }, ...o }) as any;
const answer = (body: string, disposition: string | null, ok = true) => ({ ok, status: ok ? 200 : 404, headers: { get: () => disposition }, json: async () => ({ error: 'This one has no SVG.' }), blob: async () => new Blob([body]) });

test('what is saved of a result is what the server answers with when no format is asked for: the one file that kind of result is taken as', () => {
  assert.match(fileOf(result('a')), /\/results\/a\/download$/);
});

test('each kind of result has one main file, and at most one other form beside it', async () => {
  const { mainFile, GOALS, goalOf, madeAs } = await import('@telios/shared');
  const svg = { svg: 'x' };
  assert.deepEqual(mainFile({ options: { type: 'trace', madeFor: 'object', format: 'png' }, files: svg }), { format: 'svg' });
  assert.deepEqual(mainFile({ options: { type: 'trace', madeFor: 'remix', format: 'png' }, files: svg }), { format: 'svg' });
  assert.deepEqual(mainFile({ options: { type: 'trace', madeFor: 'border', format: 'png' }, files: { ...svg, layout: 'x' } }), { format: 'package', also: 'svg' });
  assert.deepEqual(mainFile({ options: { type: 'vector', madeFor: 'frame', format: 'png' }, files: { ...svg, layout: 'x' } }), { format: 'package', also: 'svg' });
  assert.deepEqual(mainFile({ options: { type: 'cutout', madeFor: 'auto', format: 'webp' }, files: {} }), { format: 'webp', also: 'png' });
  assert.deepEqual(mainFile({ options: { type: 'cutout', madeFor: 'auto', format: 'png' }, files: {} }), { format: 'png', also: 'webp' });
  assert.deepEqual(mainFile({ options: { type: 'illustration', madeFor: 'auto', format: 'webp' }, files: {} }), { format: 'webp' });
  assert.equal(GOALS.length, 7);
  assert.equal(goalOf({ type: 'trace', madeFor: 'remix' })!.id, 'remix');
  assert.equal(goalOf({ type: 'trace', madeFor: 'pattern' })!.id, 'tile');
  assert.equal(madeAs({ type: 'clipart' }), 'Clip art');
});

test('the name the server gave a download is the name it is saved under', () => {
  assert.equal(nameOf('attachment; filename="Gold%20Frame-v2.webp"', 'x.png'), 'Gold Frame-v2.webp');
  assert.equal(nameOf('attachment; filename=frame-package.zip', 'x.png'), 'frame-package.zip');
  assert.equal(nameOf(null, 'fallback.png'), 'fallback.png');
});

test('a name the browser would refuse is made one it takes', () => {
  // the emoji of a zip's file name, misread as Latin-1: its last byte is a C1 control character
  assert.equal(fileSafe('_\u00ef\u00b8\u008f_they_couldn_t_burn_me-300w.webp'), '_ï¸_they_couldn_t_burn_me-300w.webp');
  assert.equal(fileSafe('a/b:c*d?.png'), 'a b c d .png');
  assert.equal(fileSafe('  ..hidden.. '), 'hidden');
  assert.equal(fileSafe('\u200b\u0007'), 'picture');
  assert.equal(nameOf('attachment; filename="x%C2%8Fy.webp"', 'z.png'), 'xy.webp');
});

test('each result is written into the folder; one already there is not overwritten', async () => {
  const f = folder();
  f.files.set('pic.webp', 'older');
  globalThis.fetch = (async (url: string) => answer(`body of ${url}`, 'attachment; filename="pic.webp"')) as any;
  const out = await saveResults([result('1'), result('2')], f);
  assert.deepEqual(out.saved, ['1', '2']);
  assert.deepEqual(out.names, ['pic (2).webp', 'pic (3).webp']);
  assert.equal(f.files.get('pic.webp'), 'older', 'what was there is kept');
  assert.match(f.files.get('pic (2).webp')!, /results\/1\/download/);
  assert.equal(out.error, undefined);
});

test('it stops at the first that cannot be saved, and says which; what was saved is reported', async () => {
  const f = folder();
  globalThis.fetch = (async (url: string) => (String(url).includes('/2/') ? answer('', null, false) : answer('ok', 'attachment; filename="one.webp"'))) as any;
  const out = await saveResults([result('1'), result('2'), result('3')], f);
  assert.deepEqual(out.saved, ['1'], 'the third is not tried');
  assert.equal(out.error, 'Could not save input-2: This one has no SVG.');
  assert.deepEqual([...f.files.keys()], ['one.webp']);
});
