// Complete the figure: a picture cut off at the bottom (a bust whose body is missing) drawn on down to
// its end, before the usual redraw. The subject, cut out on flat white, is put at the top of a taller
// white canvas; FLUX.1 Dev draws only the new area (an inpaint, workflows.ts inpaintWorkflow) from a
// description of what is missing; the picture's own pixels are laid back over the part that was there.
// Tried on a photographed sarcophagus bust (the figures in README.md): without a description of the
// missing part the new area is random (legs in jeans), and a plain redraw cannot extend a picture at all.

import sharp from 'sharp';
import { BACKGROUND_HEX, COMPLETE_SHARE, SHOWN, type Shown } from '@telios/shared';
import { chat, imagePart, provider, textPart } from '../engine/llm.ts';
import { forModel } from '../engine/render.ts';

/** Sampler steps of the inpaint, as tried; the redraw after it uses the quality's own. */
export const INPAINT_STEPS = 28;
/** How far into the picture the mask fades, as a share of its height (48 pixels of a 700 pixel bust). */
const RAMP_SHARE = 0.07;

/** The height a picture of this height is given below. */
export const growthOf = (height: number, share = COMPLETE_SHARE) => Math.round(height * share);

/** The band along the bottom edge, as a share of the picture's height, where a figure that is cut off is touching it. */
const BOTTOM_BAND = 0.015;
/** A figure is cut off by the bottom edge when its mask reaches it over at least this share of the picture's width. */
export const CUT_OFF_SHARE = 0.05;

/** The share of the picture's width over which the subject (its mask, white kept) reaches the bottom edge: a
 * figure cut off there runs out of the picture, and a whole figure, feet and floor, does not. */
export async function bottomContact(mask: Buffer): Promise<number> {
  const { data, info } = await sharp(mask).greyscale().raw().toBuffer({ resolveWithObject: true });
  const band = Math.max(2, Math.round(info.height * BOTTOM_BAND));
  let columns = 0;
  for (let x = 0; x < info.width; x++) {
    for (let y = info.height - band; y < info.height; y++) if (data[y * info.width + x] > 127) { columns++; break; }
  }
  return columns / info.width;
}

/** The picture at the top of a taller white canvas, and the mask of what is to be drawn (white: the new
 * area, fading into the picture over its last RAMP_SHARE so the join is soft), both at `size`. */
export async function extendCanvas(png: Buffer, size: [number, number], share = COMPLETE_SHARE): Promise<{ picture: Buffer; mask: Buffer }> {
  const { width, height } = await sharp(png).metadata();
  const W = width!, H0 = height!, H = H0 + growthOf(H0, share);
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
const TAIL = ['Matching the upper body exactly, in the same light and materials.', 'Isolated on a plain pure white background, with no floor, no wall and no cast shadow.'];
const sentence = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/([^.!?])$/, '$1.');

/** What the inpaint is asked: the description of the missing part (the model's, or a plain one), the
 * user's own words, and that it matches what is shown, on white. */
export function lowerHalfPrompt(described: string | null, notes: string) {
  const parts = [sentence(described?.trim() || GENERIC)];
  if (notes.trim()) parts.push(sentence(notes));
  return [...parts, ...TAIL].join(' ');
}

/** What the inpaint is asked for a head or a chest: not a body drawn from so little, but the bust's clean
 * flat cut resting on a low base of the same material. */
export function basePrompt(notes: string) {
  const parts = ["A low, plain rectangular base of the same material and color as the bust, as wide as the bust's flat bottom edge, directly under it, joined to it in a clean flat horizontal line; the bust ends there and nothing continues below it."];
  if (notes.trim()) parts.push(sentence(notes));
  return [...parts, ...TAIL].join(' ');
}

const SYSTEM = `You help an image generator draw the part of a picture that is cut off. The picture shows a figure or an object on a white ground, cut off at the bottom of the frame. Answer in two lines.
Line 1: one word, how much of the figure is shown: HEAD (the head, or head and neck), CHEST (the head and shoulders, down to the chest), WAIST (down to the waist or hips), THIGHS (down to the thighs or knees), or WHOLE (all of it, to the feet or a base: nothing is cut off).
Line 2: the one sentence that tells the generator what the missing lower part looks like (leave it empty for WHOLE). Start with "The lower half of the same", say what the subject is and what it is made of, then what continues directly below the cut at the same width (the same bands, patterns, ornament or clothing as the visible part), and how it ends: a statue or sculpture ends in feet on a low base; a living figure or a character ends in feet on the ground, with no base.
At most 60 words in the sentence. No style, camera or lighting words. No quotes, nothing else.
Example:
WAIST
The lower half of the same gilded bronze Egyptian pharaoh sarcophagus statue: the wide upright body continues straight down below the brass plaque at the same width, covered in the same ornate beaded gilt bands, scrollwork and jeweled red cabochons, ending in a pair of small carved gilded feet on a low flat base.`;

export interface Reading {
  /** How much of the figure the picture shows; null when the model did not say. */
  shown: Shown | null;
  /** The sentence about the missing part; null for a whole figure or when there is none. */
  sentence: string | null;
}

/** The model's answer, two lines (how much is shown, then the sentence), or, from one that gave only a sentence, that alone. */
export function parseReading(text: string): Reading | null {
  const lines = text.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const word = lines[0].toLowerCase().replace(/[^a-z]/g, '');
  const shown = (SHOWN as readonly string[]).includes(word) ? (word as Shown) : null;
  const said = (shown ? lines[1] ?? '' : lines[0]).replace(/^["'“]+|["'”]+$/g, '').trim();
  return { shown, sentence: shown === 'whole' || !said ? null : said.slice(0, 500) };
}

/** How much of the figure is shown, and the model's sentence about the missing part; null when no model is
 * set up or it could not answer (a plain description is used then). */
export async function readLowerHalf(png: Buffer, signal?: AbortSignal): Promise<Reading | null> {
  if (!provider().provider) return null;
  try {
    const res = await chat({
      maxTokens: 4000,
      effort: 'low',
      signal,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: [imagePart(await forModel(png, 768)), textPart('How much of the figure is shown, and what is missing below this picture?')] },
      ],
    });
    return parseReading(res.message.content ?? '');
  } catch (e) {
    if (signal?.aborted) throw e;
    console.error('[restyle] could not describe the missing part:', (e as Error).message);
    return null;
  }
}
