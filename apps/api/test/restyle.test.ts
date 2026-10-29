import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

process.env.TELIOS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'telios-test-'));
const { cleanOptions, DEFAULT_OPTIONS } = await import('@telios/shared');
const { restylePrompt, subjectFromName } = await import('../src/restyle/prompt.ts');
const { drawSize, restyleWorkflow, upscaleWorkflow, cutoutWorkflow } = await import('../src/comfy/workflows.ts');
const { gatewayClient, localClient, tokenUser } = await import('../src/comfy/client.ts');
const { targetSize } = await import('../src/restyle/job.ts');
const { resultFolder, resultName } = await import('../src/restyle/routes.ts');

const FLUX = { unet: 'flux1-dev-Q4_K_S.gguf', t5: 't5.safetensors', clipL: 'clip_l.safetensors', vae: 'ae.safetensors', guidance: 3.5, sampler: 'euler', scheduler: 'simple', easycache: 0.2 };
// The nodes the Phansora API's gateway runs (phansora-api comfy.GATEWAY_NODES): every workflow
// Telios builds must keep to them, or the gateway refuses it.
const GATEWAY_NODES = new Set(['LoadImage', 'ImageScale', 'ImageScaleBy', 'ImageInvert', 'UnetLoaderGGUF', 'UNETLoader', 'DualCLIPLoader', 'VAELoader', 'LoraLoaderModelOnly', 'CLIPTextEncode', 'FluxGuidance', 'EmptySD3LatentImage', 'VAEEncode', 'VAEDecode', 'KSampler', 'EasyCache', 'LoadBackgroundRemovalModel', 'RemoveBackground', 'MaskToImage', 'UpscaleModelLoader', 'ImageUpscaleWithModel', 'SaveImage']);

test('each output type asks for its own look, with the style, theme and background', () => {
  const o = { ...DEFAULT_OPTIONS, type: 'clipart' as const, style: 'art-deco', theme: 'celtic' };
  const p = restylePrompt(o, 'an oval frame with scrolls');
  assert.match(p, /^Colorful vector clip art of an oval frame with scrolls, in a flat design style/);
  assert.match(p, /art deco style, bold geometric symmetry/);
  assert.match(p, /Celtic and Insular themed/);
  assert.match(p, /plain pure white background\.$/);
  assert.match(restylePrompt({ ...o, type: 'render3d', background: 'black' }, 'x'), /3D rendered illustration of x\..*pure white background\.$/);
  assert.match(restylePrompt({ ...DEFAULT_OPTIONS, type: 'lineart' }, ''), /line art of the design in the picture/);
  assert.match(restylePrompt(DEFAULT_OPTIONS, 'Rectangular page border'), /clip art of rectangular page border/);
  assert.match(restylePrompt(DEFAULT_OPTIONS, 'A symmetrical ornament'), /clip art of a symmetrical ornament/);
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
let base = '';
const seen: { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
let history = 0;

before(async () => {
  server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    seen.push({ method: req.method!, url: req.url!, headers: req.headers, body });
    const json = (status: number, v: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
    const url = req.url!;
    // a Phansora API's gateway
    if (url === '/talari/users/telios/comfyui') return json(200, { ready: true, detail: '', flux: FLUX, upscalers: ['4x-UltraSharp.pth'], backgroundRemoval: null });
    if (url === '/talari/users/telios/comfyui/run') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end('PICTURE'); }
    if (url === '/talari/users/other/comfyui') return json(403, { detail: 'The ComfyUI lab is not open to this account.' });
    // ComfyUI itself
    if (url === '/system_stats') return json(200, {});
    if (url.startsWith('/object_info/')) {
      const node = url.split('/').pop()!;
      const field = { UnetLoaderGGUF: 'unet_name', DualCLIPLoader: 'clip_name1', VAELoader: 'vae_name', UpscaleModelLoader: 'model_name' }[node];
      const have = { UnetLoaderGGUF: [FLUX.unet], DualCLIPLoader: [FLUX.t5, FLUX.clipL], VAELoader: [FLUX.vae], UpscaleModelLoader: [] }[node];
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
  const out = await c.run({ '1': { class_type: 'LoadImage', inputs: { image: 'source.png' } } }, { 'source.png': Buffer.from('hello') });
  assert.equal(out.toString(), 'PICTURE');
  const sent = seen.find((s) => s.url.endsWith('/comfyui/run'))!;
  assert.equal(sent.headers.authorization, 'Bearer v1.telios.1999999999.sig');
  assert.equal(JSON.parse(sent.body).images['source.png'], Buffer.from('hello').toString('base64'));
  const refused = await gatewayClient(`${base}/talari`, 'v1.other.1999999999.sig').info();
  assert.equal(refused.ready, false);
  assert.match(refused.detail, /not open to this account/);
});

test('Telios\'s own ComfyUI: the upload\'s name in the workflow, the picture back, the GPU handed back', async () => {
  const c = localClient(base, FLUX);
  const info = await c.info();
  assert.equal(info.via, 'local');
  assert.equal(info.ready, true, info.detail);
  const out = await c.run(restyleWorkflow(FLUX, { prompt: 'p', width: 768, height: 768, steps: 16, denoise: 0.75, seed: 7 }), { 'source.png': Buffer.from('hello') });
  assert.equal(out.toString(), 'DRAWN');
  const prompt = JSON.parse(seen.find((s) => s.url === '/prompt')!.body).prompt;
  assert.equal(prompt['20'].inputs.image, 'telios-up.png');
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(seen.some((s) => s.url === '/free'));
  const missing = await localClient(base, { ...FLUX, vae: 'other.safetensors' }).info();
  assert.equal(missing.ready, false);
  assert.match(missing.detail, /other\.safetensors/);
});
