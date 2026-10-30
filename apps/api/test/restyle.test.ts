import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

process.env.TELIOS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'telios-test-'));
const { cleanOptions, DEFAULT_OPTIONS, STYLE_REFERENCES, wantsStyleReference, findStyle } = await import('@telios/shared');
const { restylePrompt, subjectFromName } = await import('../src/restyle/prompt.ts');
const { drawSize, restyleWorkflow, upscaleWorkflow, cutoutWorkflow, USO } = await import('../src/comfy/workflows.ts');
const { gatewayClient, localClient, tokenUser } = await import('../src/comfy/client.ts');
const { targetSize } = await import('../src/restyle/job.ts');
const { resultFolder, resultName } = await import('../src/restyle/routes.ts');

const FLUX = { unet: 'flux1-dev-Q4_K_S.gguf', t5: 't5.safetensors', clipL: 'clip_l.safetensors', vae: 'ae.safetensors', guidance: 3.5, sampler: 'euler', scheduler: 'simple', easycache: 0.2 };
// The nodes the Phansora API's gateway runs (phansora-api comfy.GATEWAY_NODES): every workflow
// Telios builds must keep to them, or the gateway refuses it.
const GATEWAY_NODES = new Set(['LoadImage', 'ImageScale', 'ImageScaleBy', 'ImageInvert', 'UnetLoaderGGUF', 'UNETLoader', 'DualCLIPLoader', 'VAELoader', 'LoraLoaderModelOnly', 'CLIPTextEncode', 'FluxGuidance', 'EmptySD3LatentImage', 'VAEEncode', 'VAEDecode', 'KSampler', 'EasyCache', 'CLIPVisionLoader', 'CLIPVisionEncode', 'ModelPatchLoader', 'USOStyleReference', 'LoadBackgroundRemovalModel', 'RemoveBackground', 'MaskToImage', 'UpscaleModelLoader', 'ImageUpscaleWithModel', 'SaveImage']);

test('each output type asks for its own look, with the style, theme and background', () => {
  const o = { ...DEFAULT_OPTIONS, type: 'clipart' as const, style: 'art-deco', theme: 'celtic' };
  const p = restylePrompt(o, 'an oval frame with scrolls');
  assert.match(p, /^Colorful vector clip art of an oval frame with scrolls, in a flat design style/);
  assert.match(p, /art deco style, bold geometric symmetry/);
  assert.match(p, /Celtic and Insular themed/);
  assert.match(p, /plain pure white background, with no floor, no wall and no cast shadow\.$/);
  assert.match(restylePrompt({ ...o, type: 'render3d', background: 'black' }, 'x'), /3D rendered illustration of x\..*pure white background, with no floor/);
  assert.match(restylePrompt({ ...o, background: 'white' }, 'x'), /plain pure white background\.$/);   // a white ground is kept, so it needs no stripping
  assert.match(restylePrompt({ ...DEFAULT_OPTIONS, type: 'lineart' }, ''), /line art of the design in the picture/);
  assert.match(restylePrompt(DEFAULT_OPTIONS, 'Rectangular page border'), /clip art of rectangular page border/);
  assert.match(restylePrompt(DEFAULT_OPTIONS, 'A symmetrical ornament'), /clip art of a symmetrical ornament/);
});

test('a picture to be cut out by color is asked for on a flat key color, lit neutrally', () => {
  const o = { ...DEFAULT_OPTIONS, type: 'illustration' as const, background: 'transparent' as const };
  const green = restylePrompt(o, 'a girl', 'green');
  assert.match(green, /Isolated on a solid flat pure bright green \(#00FF00\) background, one uniform color from edge to edge, with no gradient, no floor, no wall and no cast shadow\. The subject floats in empty space with nothing beneath it, and is lit by neutral white light with no green reflected on it\.$/);
  assert.match(restylePrompt(o, 'a girl', 'blue'), /bright blue \(#0000FF\) background.*no blue reflected on it\.$/);
  assert.match(restylePrompt({ ...o, background: 'white' }, 'a girl', 'green'), /plain pure white background\.$/);   // a white ground needs no key
  assert.match(restylePrompt(o, 'a girl'), /with no floor, no wall and no cast shadow\.$/);                            // no key: the plain bare ground
});

test('a medium is for 2D illustrations only, and a style must suit the type', () => {
  assert.equal(cleanOptions({ type: 'clipart', style: 'tonalism' }).style, '');
  assert.equal(cleanOptions({ type: 'illustration', style: 'tonalism' }).style, 'tonalism');
  assert.equal(cleanOptions({ type: 'clipart', style: 'rubber-hose' }).style, 'rubber-hose');   // a substyle of Cartoon
  assert.equal(cleanOptions({ type: 'clipart', medium: 'watercolor' }).medium, '');
  assert.equal(cleanOptions({ type: 'illustration', medium: 'watercolor' }).medium, 'watercolor');
  assert.equal(cleanOptions({ variations: 99 }).variations, 4);
  assert.equal(cleanOptions({ type: 'nonsense', background: 'plaid' }).type, 'clipart');
  assert.match(restylePrompt(cleanOptions({ type: 'illustration', medium: 'watercolor' }), 'x'), /Made as watercolor/);
});

test('a picture is drawn at its own shape, in 16-pixel steps', () => {
  assert.deepEqual(drawSize(1, 768), [768, 768]);
  const [w, h] = drawSize(1024 / 1536, 1024);
  assert.ok(w % 16 === 0 && h % 16 === 0 && h > w);
  assert.ok(Math.abs(w * h - 1024 * 1024) / (1024 * 1024) < 0.05);
});

test('the workflows keep to the nodes the gateway runs', () => {
  const w = restyleWorkflow(FLUX, { prompt: 'p', width: 768, height: 768, steps: 16, denoise: 0.75, seed: 7 });
  for (const wf of [w, cutoutWorkflow('birefnet.safetensors'), upscaleWorkflow('4x-UltraSharp.pth', 2)]) {
    for (const node of Object.values(wf)) assert.ok(GATEWAY_NODES.has(node.class_type), node.class_type);
  }
  assert.equal(w['1'].class_type, 'UnetLoaderGGUF');
  assert.deepEqual(w['8'].inputs.model, ['12', 0]);   // through EasyCache
  assert.equal(w['8'].inputs.denoise, 0.75);
  assert.equal(w['20'].inputs.image, 'source.png');
  assert.equal(restyleWorkflow({ ...FLUX, unet: 'flux1-dev.safetensors', easycache: 0 }, { prompt: 'p', width: 512, height: 512, steps: 4, denoise: 1, seed: 1 })['1'].class_type, 'UNETLoader');
  assert.equal(upscaleWorkflow('m', 4)['4'], undefined);
});

test('a result is kept at the size asked for, never past 8192 pixels', () => {
  assert.deepEqual(targetSize('drawn', [768, 1024]), [768, 1024]);
  assert.deepEqual(targetSize('2x', [768, 1024]), [1536, 2048]);
  assert.deepEqual(targetSize('4x', [1536, 2048]), [6144, 8192]);
  assert.deepEqual(targetSize('4x', [2048, 2048]), [8192, 8192]);
  assert.deepEqual(targetSize('original', [768, 768], [3000, 3000]), [3000, 3000]);
  assert.deepEqual(targetSize('original', [768, 768]), [768, 768]);
});

test('names: a subject from a file name, a token\'s account, a zip\'s folders', () => {
  assert.equal(subjectFromName('Gold_Frame-01'), 'a gold frame');
  assert.equal(tokenUser('v1.telios.1999999999.abc'), 'telios');
  assert.equal(tokenUser('nonsense'), null);
  const r = { inputName: 'frame 01', folder: 'Frames/Gold', variation: 2, options: { ...DEFAULT_OPTIONS, type: 'lineart', style: 'art-nouveau', theme: 'gothic', variations: 3 } } as any;
  assert.equal(resultFolder(r), 'Line art - Art Nouveau - Gothic/Frames/Gold');
  assert.equal(resultName(r), 'frame 01-v2');
});

// ── Both ways to ComfyUI, against stand-ins ──

let server: http.Server;
test('seven styles take a reference picture, in the painted types only', () => {
  assert.deepEqual(Object.keys(STYLE_REFERENCES).sort(), ['biomechanical', 'expressionism', 'fauvism', 'impressionism', 'neo-expressionism', 'realistic-anime', 'rococo']);
  assert.equal(wantsStyleReference({ type: 'illustration', style: 'fauvism' }), true);
  assert.equal(wantsStyleReference({ type: 'render3d', style: 'biomechanical' }), true);
  assert.equal(wantsStyleReference({ type: 'clipart', style: 'realistic-anime' }), false);   // flat and outlined, not shaded
  assert.equal(wantsStyleReference({ type: 'lineart', style: 'biomechanical' }), false);
  assert.equal(wantsStyleReference({ type: 'illustration', style: 'tonalism' }), false);     // no picture for it
  assert.equal(wantsStyleReference({ type: 'illustration', style: '' }), false);
  for (const id of Object.keys(STYLE_REFERENCES)) assert.ok(findStyle(id), id);              // every one is a style in the catalog
});

test('a style picture goes through USO, with EasyCache last on the model', () => {
  const o = { prompt: 'p', width: 768, height: 768, steps: 16, denoise: 0.75, seed: 7, style: { weight: 0.5 } };
  const w = restyleWorkflow(FLUX, o);
  for (const node of Object.values(w)) assert.ok(GATEWAY_NODES.has(node.class_type), node.class_type);
  assert.equal(w['30'].inputs.image, 'style.png');
  assert.equal(w['31'].inputs.clip_name, USO.vision);
  assert.deepEqual(w['32'].inputs, { clip_vision: ['31', 0], image: ['30', 0], crop: 'center' });
  assert.deepEqual(w['33'].inputs, { model: ['1', 0], lora_name: USO.lora, strength_model: 0.5 });
  assert.equal(w['34'].inputs.name, USO.projector);
  assert.deepEqual(w['35'].inputs, { model: ['33', 0], model_patch: ['34', 0], clip_vision_output: ['32', 0] });
  assert.deepEqual(w['12'].inputs.model, ['35', 0]);   // EasyCache caches the steps of the model USO made
  assert.deepEqual(w['8'].inputs.model, ['12', 0]);
  assert.deepEqual(restyleWorkflow({ ...FLUX, easycache: 0 }, o)['8'].inputs.model, ['35', 0]);
  // no style picture: nothing of USO, and the sampler is as it was
  const plain = restyleWorkflow(FLUX, { ...o, style: undefined });
  assert.ok(!Object.values(plain).some((n) => ['USOStyleReference', 'CLIPVisionLoader', 'ModelPatchLoader'].includes(n.class_type)));
  assert.deepEqual(plain['12'].inputs.model, ['1', 0]);
});

let base = '';
const seen: { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
let history = 0;
let usoFiles = true;   // whether the mock ComfyUI has USO's files

before(async () => {
  server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    seen.push({ method: req.method!, url: req.url!, headers: req.headers, body });
    const json = (status: number, v: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
    const url = req.url!;
    // a Phansora API's gateway
    if (url === '/talari/users/telios/comfyui') return json(200, { ready: true, detail: '', flux: FLUX, upscalers: ['4x-UltraSharp.pth'], backgroundRemoval: null, styleReference: true });
    if (url === '/talari/users/telios/comfyui/run') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end('PICTURE'); }
    if (url === '/talari/users/other/comfyui') return json(403, { detail: 'The ComfyUI lab is not open to this account.' });
    // ComfyUI itself
    if (url === '/system_stats') return json(200, {});
    if (url.startsWith('/object_info/')) {
      const node = url.split('/').pop()!;
      const field = { UnetLoaderGGUF: 'unet_name', DualCLIPLoader: 'clip_name1', VAELoader: 'vae_name', UpscaleModelLoader: 'model_name', LoraLoaderModelOnly: 'lora_name', ModelPatchLoader: 'name', CLIPVisionLoader: 'clip_name' }[node];
      const have = { UnetLoaderGGUF: [FLUX.unet], DualCLIPLoader: [FLUX.t5, FLUX.clipL], VAELoader: [FLUX.vae], UpscaleModelLoader: [], LoraLoaderModelOnly: usoFiles ? [USO.lora] : [], ModelPatchLoader: usoFiles ? [USO.projector] : [], CLIPVisionLoader: usoFiles ? [USO.vision] : [] }[node];
      if (node === 'USOStyleReference') return json(200, usoFiles ? { USOStyleReference: { input: {} } } : {});
      return json(200, field ? { [node]: { input: { required: { [field]: [have, {}] } } } } : {});
    }
    if (url === '/upload/image') return json(200, { name: 'telios-up.png', subfolder: '', type: 'input' });
    if (url === '/prompt') return json(200, { prompt_id: 'p1' });
    if (url === '/history/p1') return json(200, ++history < 2 ? {} : { p1: { status: { completed: true }, outputs: { '10': { images: [{ filename: 'telios_1.png', subfolder: '', type: 'output' }] } } } });
    if (url.startsWith('/view?')) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end('DRAWN'); }
    if (url === '/free') return json(200, {});
    json(404, {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

test('through a Phansora API: its files, the token, the pictures as base64', async () => {
  const c = gatewayClient(`${base}/talari`, 'v1.telios.1999999999.sig');
  const info = await c.info();
  assert.equal(info.via, 'api');
  assert.equal(info.ready, true);
  assert.equal(info.flux?.unet, FLUX.unet);
  assert.equal(info.styleReference, true);
  const out = await c.run({ '1': { class_type: 'LoadImage', inputs: { image: 'source.png' } } }, { 'source.png': Buffer.from('hello') });
  assert.equal(out.toString(), 'PICTURE');
  const sent = seen.find((s) => s.url.endsWith('/comfyui/run'))!;
  assert.equal(sent.headers.authorization, 'Bearer v1.telios.1999999999.sig');
  assert.equal(JSON.parse(sent.body).images['source.png'], Buffer.from('hello').toString('base64'));
  const refused = await gatewayClient(`${base}/talari`, 'v1.other.1999999999.sig').info();
  assert.equal(refused.ready, false);
  assert.equal(refused.styleReference, false);
  assert.match(refused.detail, /not open to this account/);
});

test('Telios\'s own ComfyUI: the upload\'s name in the workflow, the picture back, the GPU handed back', async () => {
  const c = localClient(base, FLUX);
  const info = await c.info();
  assert.equal(info.via, 'local');
  assert.equal(info.ready, true, info.detail);
  assert.equal(info.styleReference, true);
  const out = await c.run(restyleWorkflow(FLUX, { prompt: 'p', width: 768, height: 768, steps: 16, denoise: 0.75, seed: 7 }), { 'source.png': Buffer.from('hello') });
  assert.equal(out.toString(), 'DRAWN');
  const prompt = JSON.parse(seen.find((s) => s.url === '/prompt')!.body).prompt;
  assert.equal(prompt['20'].inputs.image, 'telios-up.png');
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(seen.some((s) => s.url === '/free'));
  const missing = await localClient(base, { ...FLUX, vae: 'other.safetensors' }).info();
  assert.equal(missing.ready, false);
  assert.match(missing.detail, /other\.safetensors/);
  usoFiles = false;   // without USO's files, the style pictures are not available, and nothing else changes
  const without = await localClient(base, FLUX).info();
  usoFiles = true;
  assert.equal(without.ready, true);
  assert.equal(without.styleReference, false);
});

test('a style\'s reference: its picture, made small, with the strength it is applied at', async () => {
  const { availableReferences, referenceFor } = await import('../src/restyle/references.ts');
  const sharp = (await import('sharp')).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'telios-refs-'));
  assert.deepEqual(availableReferences(dir), []);
  assert.equal(await referenceFor('fauvism', dir), null);               // its picture is not there
  fs.writeFileSync(path.join(dir, 'fauvism.webp'), await sharp({ create: { width: 2400, height: 1800, channels: 4, background: '#ff0000' } }).webp().toBuffer());
  fs.writeFileSync(path.join(dir, 'tonalism.png'), 'not drawn with a reference');   // a style that takes none
  assert.deepEqual(availableReferences(dir), ['fauvism']);
  const ref = (await referenceFor('fauvism', dir))!;
  assert.equal(ref.weight, STYLE_REFERENCES.fauvism.weight);
  const meta = await sharp(ref.png).metadata();
  assert.equal(meta.format, 'png');
  assert.deepEqual([meta.width, meta.height], [768, 576]);              // 768 on the long side, whatever was dropped in
  assert.equal(await referenceFor('tonalism', dir), null);
  assert.equal(await referenceFor('', dir), null);
});

// ── The same picture is not added twice ──

const sharp = (await import('sharp')).default;
const express = (await import('express')).default;
const { restyleRoutes } = await import('../src/restyle/routes.ts');
const { getInput, inputDir, saveInput, listInputs } = await import('../src/restyle/store.ts');

const png = (color: string) => sharp({ create: { width: 12, height: 12, channels: 3, background: color } }).png().toBuffer();

async function withApp<T>(run: (post: (files: [string, Buffer][]) => Promise<any>, remove: (ids: string[]) => Promise<any>) => Promise<T>) {
  const prepared: string[] = [];
  const app = express();
  app.use(express.json());
  app.use('/api/restyle', restyleRoutes((m) => { if (m.type === 'prepare') prepared.push(m.inputId); }));
  const server = await new Promise<http.Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/restyle`;
  try {
    return await run(
      async (files) => {
        const form = new FormData();
        for (const [name, bytes] of files) form.append('files', new Blob([new Uint8Array(bytes)]), name);
        const res = await fetch(`${base}/inputs`, { method: 'POST', body: form });
        return { status: res.status, ...(await res.json()) };
      },
      async (ids) => (await fetch(`${base}/inputs/delete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids }) })).json(),
    );
  } finally {
    server.close();
  }
}

test('the same picture dropped again is skipped, whatever it is called', async () => {
  const red = await png('#cc2222'), blue = await png('#2222cc');
  await withApp(async (post, remove) => {
    const first = await post([['frame.png', red]]);
    assert.equal(first.inputs.length, 1);
    assert.deepEqual(first.duplicates, []);
    assert.equal(first.inputs[0].hash.length, 64);

    const again = await post([['frame.png', red]]);
    assert.equal(again.status, 201);                  // nothing wrong, nothing new
    assert.deepEqual([again.inputs.length, again.duplicates], [0, ['frame']]);
    const renamed = await post([['copy of frame.png', red]]);
    assert.deepEqual([renamed.inputs.length, renamed.duplicates], [0, ['copy of frame']]);

    const other = await post([['frame.png', blue]]);   // same name, other picture: kept
    assert.equal(other.inputs.length, 1);

    // two of the same in one drop: one is added, the other skipped
    const green = await png('#22cc22');
    const both = await post([['a.png', green], ['b.png', green]]);
    assert.deepEqual([both.inputs.length, both.duplicates], [1, ['b']]);
    assert.equal(listInputs().length, 3);

    // gone from the inputs, it can be added again
    await remove([first.inputs[0].id]);
    const back = await post([['frame.png', red]]);
    assert.equal(back.inputs.length, 1);
  });
});

test('a picture added before hashes were kept is still recognized, and gets its hash', async () => {
  const yellow = await png('#cccc22');
  const id = 'ilegacy1';
  fs.mkdirSync(inputDir(id), { recursive: true });
  fs.writeFileSync(path.join(inputDir(id), 'original.png'), yellow);
  saveInput({ id, name: 'old upload', folder: '', createdAt: '2026-10-01T00:00:00.000Z', status: 'ready', format: 'png' });
  assert.equal(getInput(id)?.hash, undefined);
  await withApp(async (post) => {
    const res = await post([['again.png', yellow]]);
    assert.deepEqual([res.inputs.length, res.duplicates], [0, ['again']]);
  });
  assert.equal(getInput(id)?.hash?.length, 64);
});

// ── Draw it whole ──

const { CLOSENESS, WHOLE_PAD } = await import('@telios/shared');

test('Draw it whole: a new, complete subject, set in white space, not a copy of the crop', () => {
  assert.equal(cleanOptions({ closeness: 'whole' }).closeness, 'whole');
  assert.equal(cleanOptions({ closeness: 'nonsense' }).closeness, 'balanced');
  const whole = restylePrompt({ ...DEFAULT_OPTIONS, type: 'render3d', closeness: 'whole' }, 'a crying freckled girl with copper-red hair');
  assert.match(whole, /3D rendered illustration of a crying freckled girl with copper-red hair\./);
  assert.match(whole, /shown complete and uncropped.*nothing is cut off by the edge of the picture.*whole head and hair/);
  assert.doesNotMatch(restylePrompt({ ...DEFAULT_OPTIONS, closeness: 'balanced' }, 'x'), /uncropped/);
  // it is the freest of the four, so the crop does not pull the drawing back to its own framing
  for (const type of ['clipart', 'lineart', 'illustration', 'render3d'] as const) {
    const free = CLOSENESS.find((c) => c.value === 'whole')!.denoise[type];
    assert.ok(free >= CLOSENESS.find((c) => c.value === 'loose')!.denoise[type], type);
  }
  assert.ok(WHOLE_PAD > 0.2 && WHOLE_PAD < 0.6);
  assert.ok(CLOSENESS.every((c) => c.hint.length > 10));
});

test('a cleared picture is cut to what is drawn, with a margin', async () => {
  const { trimToContent } = await import('../src/restyle/job.ts');
  // a 200 x 300 clear canvas with a 40 x 60 patch drawn in it
  const patch = await sharp({ create: { width: 40, height: 60, channels: 4, background: '#cc2222' } }).png().toBuffer();
  const canvas = await sharp({ create: { width: 200, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: patch, left: 80, top: 120 }]).png().toBuffer();
  const trimmed = await sharp(await trimToContent(canvas, 0.1)).metadata();
  assert.deepEqual([trimmed.width, trimmed.height], [52, 72]);   // 40 + 2 * 6, 60 + 2 * 6
  // nothing drawn: left as it was
  const empty = await sharp({ create: { width: 20, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  assert.deepEqual(await trimToContent(empty), empty);
});
