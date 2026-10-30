// One result drawn: the input's picture redrawn by ComfyUI in the chosen type, style and theme,
// its background made clear if asked, sized, traced to SVG for clip art and line art, and given
// its screen copies. Runs in the job worker, one at a time: there is one GPU.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { CLOSENESS, WHOLE_PAD, findStyle, qualityOf, typeInfo, wantsStyleReference, type RestyleResult } from '@telios/shared';
import { python } from '../python.ts';
import { comfy } from '../comfy/client.ts';
import { cutoutWorkflow, drawSize, restyleWorkflow, upscaleWorkflow } from '../comfy/workflows.ts';
import { KEY_HEX, restylePrompt, subjectFromName, type KeyColor } from './prompt.ts';
import { referenceFor } from './references.ts';
import { readSubject, readWholeSubject } from './subject.ts';
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

/** A transparent picture cut to what is drawn in it, with a margin of `margin` of its longer side. */
export async function trimToContent(png: Buffer, margin = 0.04) {
  const { data, info } = await sharp(png).extractChannel('alpha').raw().toBuffer({ resolveWithObject: true });
  let [x0, y0, x1, y1] = [info.width, info.height, -1, -1];
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[y * info.width + x] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  if (x1 < 0) return png;   // nothing drawn: left as it is
  const m = Math.round(Math.max(x1 - x0, y1 - y0) * margin);
  const left = Math.max(0, x0 - m), top = Math.max(0, y0 - m);
  const right = Math.min(info.width, x1 + 1 + m), bottom = Math.min(info.height, y1 + 1 + m);
  return sharp(png).extract({ left, top, width: right - left, height: bottom - top }).png().toBuffer();
}

/** A picture with a mask (white kept) as its transparency. */
async function withMask(png: Buffer, mask: Buffer) {
  const { width, height } = await sharp(png).metadata();
  const alpha = await sharp(mask).greyscale().resize(width, height).raw().toBuffer();
  return sharp(png).removeAlpha().joinChannel(alpha, { raw: { width: width!, height: height!, channels: 1 } }).png().toBuffer();
}

export async function drawResult(id: string, signal: AbortSignal) {
  const stage = (s: string) => updateResult(id, (r) => { r.stage = s; });
  const r = updateResult(id, (x) => { x.status = 'running'; x.stage = 'Starting'; x.startedAt = new Date().toISOString(); delete x.error; });
  if (!r) return;
  const dir = resultDir(id);
  const o = r.options;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `telios-${id}-`));
  try {
    const info = await comfy().info();
    if (!info.ready || !info.flux) throw new Error(info.detail || 'ComfyUI is not ready.');
    const source = fs.readFileSync(path.join(dir, 'source.png'));
    const meta = await sharp(source).metadata();

    // what it shows: read once per input, kept with it. Drawn whole, the subject is described as a
    // complete one, with its colors, since what the picture cuts off is to be drawn new.
    const whole = o.closeness === 'whole';
    const input = getInput(r.inputId);
    let subject = whole ? input?.subjectWhole ?? input?.subject : input?.subject;
    if (!subject || (whole && !input?.subjectWhole)) {
      stage('Reading the picture');
      const read = whole ? await readWholeSubject(source, signal) : await readSubject(source, signal);
      if (read) {
        subject = read;
        if (input) updateInput(input.id, (i) => { if (whole) i.subjectWhole = read; else i.subject = read; });
      }
    }
    // a picture of something (a character, an object) is cut out of its ground by a model; without one
    // it is drawn on a flat key color, green (blue if the picture has greens), and cut out by color
    const clearing = o.background !== 'white';
    const byColor = clearing && (o.type === 'illustration' || o.type === 'render3d') && !info.backgroundRemoval;
    const key: KeyColor | null = byColor ? (await python(['pickkey', path.join(dir, 'source.png')])).color : null;
    const prompt = restylePrompt(o, subject ?? subjectFromName(r.inputName), key ?? undefined);
    const quality = qualityOf(o);
    // drawn whole, the picture is set in white space: a head the picture cuts off has room to be
    // finished, and what is drawn is not held to the picture's own edge
    const pad = whole ? Math.round(Math.max(meta.width!, meta.height!) * WHOLE_PAD) : 0;
    const warnings: string[] = [];
    const [w, h] = drawSize((meta.width! + 2 * pad) / (meta.height! + 2 * pad), quality.size);
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
    let framed = sharp(ground);
    if (pad) framed = framed.extend({ top: pad, bottom: pad, left: pad, right: pad, background: key ? KEY_HEX[key] : '#ffffff' });
    const start = await framed.resize(w, h, { fit: 'cover' }).png().toBuffer();
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
    let png = await comfy().run(restyleWorkflow(info.flux, { prompt, width: w, height: h, steps: quality.steps, denoise, seed, style }), { 'source.png': start, ...(reference && { 'style.png': reference }) }, signal);

    if (clearing) {
      stage('Clearing the background');
      let cleared = true;
      if (info.backgroundRemoval && (o.type === 'illustration' || o.type === 'render3d')) {
        const mask = await comfy().run(cutoutWorkflow(info.backgroundRemoval), { 'picture.png': png }, signal);
        png = await withMask(png, mask);
      } else if (key) {
        fs.writeFileSync(path.join(scratch, 'drawn.png'), png);
        const cut = await python(['chroma', path.join(scratch, 'drawn.png'), path.join(scratch, 'clear.png'), '--color', key]);
        cleared = cut.clear >= MIN_CLEAR;
        if (cleared) png = fs.readFileSync(path.join(scratch, 'clear.png'));
        else warnings.push(`The background was not cleared: the picture came out without a plain ${key} backdrop to cut it from.`);
      } else {
        fs.writeFileSync(path.join(scratch, 'drawn.png'), png);
        // a frame's opening is cut out too (the window rule); a character or an object has none
        const isFrame = o.type === 'clipart' || o.type === 'lineart';
        await python(['key', path.join(scratch, 'drawn.png'), path.join(scratch, 'clear.png'), ...(o.type === 'lineart' ? ['--everything'] : []), ...(isFrame && !whole ? [] : ['--no-window'])]);
        png = fs.readFileSync(path.join(scratch, 'clear.png'));
      }
      if (cleared) {
        // drawn whole on a clear ground, it is cut to what is drawn, with a small margin
        if (whole && o.background === 'transparent') png = await trimToContent(png);
        if (o.background === 'black') png = await sharp(png).flatten({ background: '#000000' }).png().toBuffer();
      }
    }

    // what is kept is as large as it was drawn (or trimmed to): its size, not the drawn canvas's
    const drawn = await sharp(png).metadata();
    const [dw, dh] = [drawn.width!, drawn.height!];
    let [tw, th] = targetSize(o.size, [dw, dh], input?.originalSize);
    if (whole && o.size === 'original' && input?.originalSize?.[0]) {
      // the original's size is a box to fit in, not a shape to stretch the new picture to
      const k = Math.min(input.originalSize[0] / dw, input.originalSize[1] / dh);
      [tw, th] = [Math.round(dw * k), Math.round(dh * k)];
    }
    if (tw > dw && o.enhance && info.upscalers.length) {
      // the upscaling model redraws fine detail as it enlarges; it works on color, so the
      // transparency is enlarged here and put back
      stage('Enlarging');
      const scale = Math.min(4, tw / dw);
      const colors = await sharp(png).flatten({ background: o.background === 'black' ? '#000' : '#fff' }).png().toBuffer();
      const big = await comfy().run(upscaleWorkflow(info.upscalers[0], scale), { 'picture.png': colors }, signal);
      const sized = sharp(big).resize(tw, th, { fit: 'fill' });
      png = o.background === 'transparent'
        ? await withMask(await sized.png().toBuffer(), await sharp(png).extractChannel('alpha').resize(tw, th, { fit: 'fill' }).png().toBuffer())
        : await sized.png().toBuffer();
    } else if (tw !== dw || th !== dh) {
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
    await sharp(png).resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toFile(path.join(dir, 'thumb.webp'));
    await sharp(png).resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toFile(path.join(dir, 'view.webp'));
    fs.rmSync(path.join(dir, 'source.png'), { force: true });
    updateResult(id, (x) => {
      x.status = 'done';
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
