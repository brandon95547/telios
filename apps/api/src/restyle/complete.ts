// Complete the figure: a picture cut off at the bottom (a bust whose body is missing) drawn on down to
// its end, before the usual redraw. The subject, cut out on flat white, is put at the top of a taller
// white canvas; FLUX.1 Dev draws only the new area (an inpaint, workflows.ts inpaintWorkflow) from a
// description of what is missing; the picture's own pixels are laid back over the part that was there.
// Tried on a photographed sarcophagus bust (the figures in README.md): without a description of the
// missing part the new area is random (legs in jeans), and a plain redraw cannot extend a picture at all.

import sharp from 'sharp';
import { BACKGROUND_HEX, COMPLETE_SHARE } from '@telios/shared';
import { chat, imagePart, provider, textPart } from '../engine/llm.ts';
import { forModel } from '../engine/render.ts';

/** Sampler steps of the inpaint, as tried; the redraw after it uses the quality's own. */
export const INPAINT_STEPS = 28;
/** How far into the picture the mask fades, as a share of its height (48 pixels of a 700 pixel bust). */
const RAMP_SHARE = 0.07;

/** The height a picture of this height is given below. */
export const growthOf = (height: number) => Math.round(height * COMPLETE_SHARE);

/** The picture at the top of a taller white canvas, and the mask of what is to be drawn (white: the new
 * area, fading into the picture over its last RAMP_SHARE so the join is soft), both at `size`. */
export async function extendCanvas(png: Buffer, size: [number, number]): Promise<{ picture: Buffer; mask: Buffer }> {
  const { width, height } = await sharp(png).metadata();
  const W = width!, H0 = height!, H = H0 + growthOf(H0);
  const top = await sharp(png).flatten({ background: BACKGROUND_HEX.white }).png().toBuffer();
  const canvas = await sharp({ create: { width: W, height: H, channels: 3, background: BACKGROUND_HEX.white } }).composite([{ input: top, left: 0, top: 0 }]).png().toBuffer();
  const ramp = Math.max(8, Math.round(H0 * RAMP_SHARE));
  const mask = Buffer.alloc(W * H);
  for (let y = 0; y < H; y++) mask.fill(y >= H0 ? 255 : y >= H0 - ramp ? Math.round((255 * (y - (H0 - ramp))) / ramp) : 0, y * W, (y + 1) * W);
  const [w, h] = size;
  return {
    picture: await sharp(canvas).resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer(),
    mask: await sharp(mask, { raw: { width: W, height: H, channels: 1 } }).resize(w, h, { fit: 'fill' }).png().toBuffer(),
  };
}

/** The drawn picture with the original's own pixels laid back over what was already there: the VAE
 * changes every pixel a little, and the mask is 0 over the picture and a soft ramp at the join. */
export async function layBack(drawn: Buffer, picture: Buffer, mask: Buffer, size: [number, number]): Promise<Buffer> {
  const [w, h] = size;
  const gen = await sharp(drawn).removeAlpha().resize(w, h, { fit: 'fill' }).raw().toBuffer();
  const orig = await sharp(picture).removeAlpha().raw().toBuffer();
  const m = await sharp(mask).greyscale().raw().toBuffer();
  const out = Buffer.alloc(gen.length);
  for (let i = 0; i < m.length; i++) {
    const a = m[i] / 255;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(gen[i * 3 + c] * a + orig[i * 3 + c] * (1 - a));
  }
  return sharp(out, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

const GENERIC = 'The lower half of the same figure: its body continues straight down below the picture at the same width, in the same materials, colors and ornament, down to a flat base.';

/** What the inpaint is asked: the description of the missing part (the model's, or a plain one), the
 * user's own words, and that it matches what is shown, on white. */
export function lowerHalfPrompt(described: string | null, notes: string) {
  const sentence = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/([^.!?])$/, '$1.');
  const parts = [sentence(described?.trim() || GENERIC)];
  if (notes.trim()) parts.push(sentence(notes));
  parts.push('Matching the upper body exactly, in the same light and materials.');
  parts.push('Isolated on a plain pure white background, with no floor, no wall and no cast shadow.');
  return parts.join(' ');
}

const SYSTEM = `You help an image generator draw the part of a picture that is cut off. The picture shows a figure or an object cut off at the bottom of the frame, on a white ground. Write the one sentence that tells the generator what the missing lower part looks like.
Start with "The lower half of the same", say what the subject is and what it is made of, then how it continues straight down below the picture at the same width, what covers it (the same bands, patterns, ornament or clothing as the visible part), and how it plausibly ends (feet on a low base, a hem, a stem, a pedestal). A statue or sculpture ends on a base.
At most 60 words. No style, camera or lighting words. No quotes, nothing else.
Example: The lower half of the same gilded bronze Egyptian pharaoh sarcophagus statue: the wide upright body continues straight down below the brass plaque at the same width, covered in the same ornate beaded gilt bands, scrollwork and jeweled red cabochons, ending in a pair of small carved gilded feet on a low flat base.`;

/** The model's sentence about the missing part, or null when no model is set up or it could not answer
 * (the plain description is used then). */
export async function readLowerHalf(png: Buffer, signal?: AbortSignal): Promise<string | null> {
  if (!provider().provider) return null;
  try {
    const res = await chat({
      maxTokens: 4000,
      effort: 'low',
      signal,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: [imagePart(await forModel(png, 768)), textPart('What is missing below this picture?')] },
      ],
    });
    const sentence = (res.message.content ?? '').trim().split('\n')[0].replace(/^["'“]+|["'”]+$/g, '').trim();
    return sentence ? sentence.slice(0, 500) : null;
  } catch (e) {
    if (signal?.aborted) throw e;
    console.error('[restyle] could not describe the missing part:', (e as Error).message);
    return null;
  }
}
