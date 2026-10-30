// One result drawn: the input's picture redrawn by ComfyUI in the chosen type, style and theme,
// its background made clear if asked, sized, traced to SVG for clip art and line art, and given
// its screen copies. Runs in the job worker, one at a time: there is one GPU.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { BACKGROUND_HEX, CLOSENESS, PICTURE_LED_TYPES, findStyle, qualityOf, typeInfo, wantsStyleReference, type DrawSettings, type RestyleResult } from '@telios/shared';
import { python } from '../python.ts';
import { comfy } from '../comfy/client.ts';
import { cutoutWorkflow, drawSize, restyleWorkflow, upscaleWorkflow } from '../comfy/workflows.ts';
import { KEY_HEX, restylePrompt, subjectFromName, type KeyColor } from './prompt.ts';
import { referenceFor } from './references.ts';
import { readSubject } from './subject.ts';
import { getInput, rel, resultDir, updateInput, updateResult } from './store.ts';

export const MAX_SIDE = 8192;
/** The least a key-color cutout must clear of the picture to count as having found a backdrop. */
const MIN_CLEAR = 0.05;

/** The size a result is kept at, from the size it was drawn at. */
export function targetSize(size: RestyleResult['options']['size'], drawn: [number, number], original?: [number, number]): [number, number] {
  let [w, h] = drawn;
  if (size === '2x') [w, h] = [w * 2, h * 2];
  else if (size === '4x') [w, h] = [w * 4, h * 4];
  else if (size === 'original' && original?.[0] && original[1]) [w, h] = original;
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  return [Math.round(w * k), Math.round(h * k)];
}

/** A picture with a mask (white kept) as its transparency. Opaque first and the mask joined after, in two
 * steps: in one, sharp strips the alpha that was just joined. */
export async function withMask(png: Buffer, mask: Buffer) {
  const { width, height } = await sharp(png).metadata();
  const alpha = await sharp(mask).greyscale().resize(width, height).raw().toBuffer();
  const opaque = await sharp(png).removeAlpha().png().toBuffer();
  return sharp(opaque).joinChannel(alpha, { raw: { width: width!, height: height!, channels: 1 } }).png().toBuffer();
}

/** The least and the most of a picture a subject's mask may cover for it to count as a subject found. */
const SUBJECT_SHARE: [number, number] = [0.02, 0.98];

/** A picture's subject, by the model's mask of it, on flat white. FLUX keeps the ground it is given
 * (a prompt asking for a white background does nothing to a photographed hallway, at any strength),
 * so a redraw that starts on white has a white ground and no background of its own to keep. A mask
 * that finds no subject, or all of the picture, leaves the picture as it is. */
export async function subjectOnWhite(png: Buffer, mask: Buffer): Promise<{ png: Buffer; cut: boolean }> {
  const { width, height } = await sharp(png).metadata();
  const m = await sharp(mask).greyscale().resize(width, height).raw().toBuffer();
  let kept = 0;
  for (const v of m) if (v > 127) kept++;
  const share = kept / m.length;
  if (share < SUBJECT_SHARE[0] || share > SUBJECT_SHARE[1]) return { png, cut: false };
  return { png: await sharp(await withMask(png, mask)).flatten({ background: BACKGROUND_HEX.white }).png().toBuffer(), cut: true };
}

/** A result's screen copies: a thumbnail for the grid and a large view for the viewer. */
export async function screenCopies(png: Buffer, dir: string) {
  await sharp(png).resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toFile(path.join(dir, 'thumb.webp'));
  await sharp(png).resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toFile(path.join(dir, 'view.webp'));
}

export async function drawResult(id: string, signal: AbortSignal) {
  const stage = (s: string) => updateResult(id, (r) => { r.stage = s; });
  const r = updateResult(id, (x) => { x.status = 'running'; x.stage = 'Starting'; x.startedAt = new Date().toISOString(); delete x.error; });
  if (!r) return;
  const dir = resultDir(id);
  const o = r.options;
  if (o.type === 'vector') {   // drawn by the model (vector.ts), and never sent here
    updateResult(id, (x) => { x.status = 'failed'; delete x.stage; x.error = 'A flat SVG is drawn by the model, not by ComfyUI.'; });
    return;
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `telios-${id}-`));
  try {
    const info = await comfy().info();
    if (!info.ready || !info.flux) throw new Error(info.detail || 'ComfyUI is not ready.');
    const source = fs.readFileSync(path.join(dir, 'source.png'));
    const meta = await sharp(source).metadata();

    // what it shows: read once per input, kept with it, and only where the prompt says it
    const input = getInput(r.inputId);
    let subject = input?.subject;
    if (!subject && !PICTURE_LED_TYPES.includes(o.type)) {
      stage('Reading the picture');
      const read = await readSubject(source, signal);
      if (read) {
        subject = read;
        if (input) updateInput(input.id, (i) => { i.subject = read; });
      }
    }
    // a picture of something (a character, an object) is cut out of its ground by a model, before it is
    // redrawn (so it starts on flat white) and after (so it ends on the ground asked for: clear, white,
    // black or green); without a model it is drawn on a flat key color, green (blue if the picture has
    // greens), and cut out by color
    const pictureLed = PICTURE_LED_TYPES.includes(o.type);
    const removal = info.backgroundRemoval;
    const byModel = pictureLed && !!removal;
    const clearing = o.background !== 'white' || byModel;
    const byColor = clearing && pictureLed && !removal;
    const key: KeyColor | null = byColor ? (await python(['pickkey', path.join(dir, 'source.png')])).color : null;
    const prompt = restylePrompt(o, subject ?? subjectFromName(r.inputName), key ?? undefined);
    const quality = qualityOf(o);
    const warnings: string[] = [];
    const [w, h] = drawSize(meta.width! / meta.height!, quality.size);
    const seed = r.seed ?? crypto.randomInt(2 ** 31);
    updateResult(id, (x) => { x.prompt = prompt; x.seed = seed; });

    stage('Drawing');
    // a scan's gray or yellowed paper, made white first: redrawn, it would stay gray
    await python(['whiten', path.join(dir, 'source.png'), path.join(scratch, 'white.png')]);
    let ground = path.join(scratch, 'white.png');
    if (key) {
      // FLUX keeps the ground it is given, so the picture starts on the key color, not on white
      ground = path.join(scratch, 'ground.png');
      await python(['ground', path.join(scratch, 'white.png'), ground, '--color', KEY_HEX[key]]);
    }
    let startPicture: string | Buffer = ground;
    let startCutout = false;
    if (byModel) {
      stage('Cutting the subject out');
      const whitened = fs.readFileSync(ground);
      const mask = await comfy().run(cutoutWorkflow(removal!), { 'picture.png': whitened }, signal);
      const on = await subjectOnWhite(whitened, mask);
      startPicture = on.png;
      startCutout = on.cut;
    }
    const start = await sharp(startPicture).resize(w, h, { fit: 'cover' }).png().toBuffer();
    const denoise = CLOSENESS.find((c) => c.value === o.closeness)!.denoise[o.type];

    // a style FLUX only gets right from a picture in that style is drawn with its reference (USO
    // takes the picture's look, not its subject); without the picture, or the files USO needs, it is
    // drawn from words alone, and says so
    let style: { weight: number } | undefined;
    let reference: Buffer | undefined;
    if (wantsStyleReference(o)) {
      const ref = info.styleReference ? await referenceFor(o.style) : null;
      if (ref) { style = { weight: ref.weight }; reference = ref.png; }
      else {
        const lacking = info.styleReference ? `this server has no ${findStyle(o.style)?.label ?? o.style} reference picture yet` : "this server's ComfyUI does not have USO's style files";
        warnings.push(`Drawn without a style reference: ${lacking}, so the style comes from words alone.`);
      }
    }
    // what ComfyUI is given, kept with the result for the preview to show (the cutout and any enlargement are added below)
    const settings: DrawSettings = {
      model: info.flux.unet, width: w, height: h, steps: quality.steps, denoise, guidance: info.flux.guidance,
      sampler: info.flux.sampler, scheduler: info.flux.scheduler, easycache: info.flux.easycache,
      ...(style && { styleReference: { style: o.style, weight: style.weight } }),
      ...(startCutout && { startCutout }),
    };
    updateResult(id, (x) => { x.settings = settings; });
    let png = await comfy().run(restyleWorkflow(info.flux, { prompt, width: w, height: h, steps: quality.steps, denoise, seed, style }), { 'source.png': start, ...(reference && { 'style.png': reference }) }, signal);

    if (clearing) {
      stage('Clearing the background');
      let cleared = true;
      if (byModel) {
        const mask = await comfy().run(cutoutWorkflow(removal!), { 'picture.png': png }, signal);
        png = await withMask(png, mask);
        settings.cutout = { by: 'model', with: removal! };
      } else if (key) {
        fs.writeFileSync(path.join(scratch, 'drawn.png'), png);
        const cut = await python(['chroma', path.join(scratch, 'drawn.png'), path.join(scratch, 'clear.png'), '--color', key]);
        cleared = cut.clear >= MIN_CLEAR;
        settings.cutout = cleared ? { by: 'color', with: `a flat ${key} backdrop` } : { by: 'none' };
        if (cleared) png = fs.readFileSync(path.join(scratch, 'clear.png'));
        else warnings.push(`The background was not cleared: the picture came out without a plain ${key} backdrop to cut it from.`);
      } else {
        fs.writeFileSync(path.join(scratch, 'drawn.png'), png);
        // a frame's opening is cut out too (the window rule); a character or an object has none
        const isFrame = o.type === 'clipart' || o.type === 'lineart';
        await python(['key', path.join(scratch, 'drawn.png'), path.join(scratch, 'clear.png'), ...(o.type === 'lineart' ? ['--everything'] : []), ...(isFrame ? [] : ['--no-window'])]);
        png = fs.readFileSync(path.join(scratch, 'clear.png'));
        settings.cutout = { by: 'color', with: o.type === 'lineart' ? 'white, keeping the ink' : 'white' };
      }
      if (cleared && o.background !== 'transparent') png = await sharp(png).flatten({ background: BACKGROUND_HEX[o.background] }).png().toBuffer();
    }

    const [tw, th] = targetSize(o.size, [w, h], input?.originalSize);
    if (tw > w && o.enhance && info.upscalers.length) {
      // the upscaling model redraws fine detail as it enlarges; it works on color, so the
      // transparency is enlarged here and put back
      stage('Enlarging');
      const scale = Math.min(4, tw / w);
      const colors = await sharp(png).flatten({ background: o.background === 'black' ? '#000' : '#fff' }).png().toBuffer();
      const big = await comfy().run(upscaleWorkflow(info.upscalers[0], scale), { 'picture.png': colors }, signal);
      settings.enlargedWith = info.upscalers[0];
      const sized = sharp(big).resize(tw, th, { fit: 'fill' });
      png = o.background === 'transparent'
        ? await withMask(await sized.png().toBuffer(), await sharp(png).extractChannel('alpha').resize(tw, th, { fit: 'fill' }).png().toBuffer())
        : await sized.png().toBuffer();
    } else if (tw !== w || th !== h) {
      png = await sharp(png).resize(tw, th, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
    }
    fs.writeFileSync(path.join(dir, 'result.png'), png);

    let svg: string | undefined;
    if (typeInfo(o.type).vector) {
      stage('Tracing to SVG');
      await python(['trace', path.join(dir, 'result.png'), scratch, '--mode', o.type === 'lineart' ? 'one-ink' : 'full', '--max-colors', o.type === 'lineart' ? '2' : '10'], 10 * 60_000);
      fs.copyFileSync(path.join(scratch, 'layered.svg'), path.join(dir, 'result.svg'));
      svg = rel(path.join(dir, 'result.svg'));
    }

    stage('Finishing');
    await screenCopies(png, dir);
    fs.rmSync(path.join(dir, 'source.png'), { force: true });
    updateResult(id, (x) => {
      x.status = 'done';
      x.settings = settings;
      if (warnings.length) x.warning = warnings.join(' ');
      delete x.stage;
      x.finishedAt = new Date().toISOString();
      x.size = [tw, th];
      x.files = { png: rel(path.join(dir, 'result.png')), ...(svg && { svg }), thumb: rel(path.join(dir, 'thumb.webp')), view: rel(path.join(dir, 'view.webp')), original: rel(path.join(dir, 'original.webp')) };
    });
  } catch (e) {
    const canceled = signal.aborted;
    updateResult(id, (x) => {
      x.status = canceled ? 'canceled' : 'failed';
      delete x.stage;
      x.finishedAt = new Date().toISOString();
      if (!canceled) x.error = (e as Error).message;
    });
    if (!canceled) console.error('[restyle]', id, e);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
