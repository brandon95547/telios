import { test } from 'node:test';
import assert from 'node:assert/strict';

const { fileOf, nameOf, saveResults } = await import('../../web/src/restyle/approve.ts');

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
const result = (id: string, o: object = {}) => ({ id, inputName: `input-${id}`, options: { type: 'render3d', format: 'webp' }, files: { png: 'x' }, ...o }) as any;
const answer = (body: string, disposition: string | null, ok = true) => ({ ok, status: ok ? 200 : 404, headers: { get: () => disposition }, json: async () => ({ error: 'This one has no SVG.' }), blob: async () => new Blob([body]) });

test('what is saved of a result: the package of a flat SVG, the SVG of clip art, the picture of the rest', () => {
  assert.match(fileOf(result('a', { drawing: { kind: 'frame' } })), /\/results\/a\/download\?format=package$/);
  assert.match(fileOf(result('b', { options: { type: 'clipart', format: 'png' }, files: { svg: 'x' } })), /\/results\/b\/download\?format=svg$/);
  assert.match(fileOf(result('c', { options: { type: 'lineart', format: 'png' }, files: { png: 'x' } })), /\/results\/c\/download$/, 'no SVG to take: the picture');
  assert.match(fileOf(result('d')), /\/results\/d\/download$/);
});

test('the name the server gave a download is the name it is saved under', () => {
  assert.equal(nameOf('attachment; filename="Gold%20Frame-v2.webp"', 'x.png'), 'Gold Frame-v2.webp');
  assert.equal(nameOf('attachment; filename=frame-package.zip', 'x.png'), 'frame-package.zip');
  assert.equal(nameOf(null, 'fallback.png'), 'fallback.png');
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
