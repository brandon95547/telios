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
/** Where a bust's base begins, as a share of the new height, and how much wider than the bust it is. */
const BASE_AT = 0.25;
const BASE_WIDER = 1.12;

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

/** Where the subject meets the bottom edge: its first and last column, as shares of the picture's width; null if it does not. */
export async function bottomSpan(mask: Buffer): Promise<[number, number] | null> {
  const { data, info } = await sharp(mask).greyscale().raw().toBuffer({ resolveWithObject: true });
  const band = Math.max(2, Math.round(info.height * BOTTOM_BAND));
  let first = info.width, last = -1;
  for (let y = info.height - band; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[y * info.width + x] > 127) { first = Math.min(first, x); last = Math.max(last, x); }
  return last < 0 ? null : [first / info.width, (last + 1) / info.width];
}

/** How far a bust's base is redrawn from the slab it starts as (1 would forget the slab): with the slab FLUX draws a
 * base every time, and without it drew a reflection and a floor three times in four. */
export const BASE_DENOISE = 0.85;

/** The canvas of a bust with its base already on it, as a plain slab in the bust's own color, shaded top to bottom:
 * the start of the inpaint, which turns it into stone (or whatever the bust is made of). `subject` is the bust cut
 * out on white, `mask` the model's mask of it, `span` where it meets the bottom edge (bottomSpan). */
export async function baseStart(subject: Buffer, mask: Buffer, span: [number, number], size: [number, number], share: number): Promise<Buffer> {
  const { width: W0, height: H0 } = await sharp(subject).metadata();
  const [w, h] = size;
  const rgb = await sharp(subject).removeAlpha().raw().toBuffer();
  const m = await sharp(mask).greyscale().resize(W0, H0).raw().toBuffer();
  let n = 0;
  const sum = [0, 0, 0];
  for (let y = Math.round(H0! * 0.93); y < H0!; y++) for (let x = 0; x < W0!; x++) if (m[y * W0! + x] > 127) { n++; for (let c = 0; c < 3; c++) sum[c] += rgb[(y * W0! + x) * 3 + c]; }
  const mean = n ? sum.map((v) => v / n) : [110, 110, 110];
  const shade = (k: number) => `rgb(${mean.map((v) => Math.max(0, Math.min(255, Math.round(v * k)))).join(',')})`;
  const Hn = growthOf(H0!, share), H = H0! + Hn;
  const sx = w / W0!, sy = h / H;
  const cx = ((span[0] + span[1]) / 2) * W0!, half = ((span[1] - span[0]) / 2) * W0! * BASE_WIDER;
  const x0 = Math.max(0, cx - half) * sx, x1 = Math.min(W0!, cx + half) * sx;
  const y0 = (H0! - 2) * sy, y1 = (H0! + Hn * 0.94) * sy;
  const slab = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(1.25)}"/><stop offset="0.15" stop-color="${shade(1)}"/><stop offset="1" stop-color="${shade(0.7)}"/></linearGradient></defs><rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${(x1 - x0).toFixed(1)}" height="${(y1 - y0).toFixed(1)}" fill="url(#g)"/></svg>`;
  const { picture } = await extendCanvas(subject, size, share);
  return sharp(picture).composite([{ input: Buffer.from(slab) }]).png().toBuffer();
}

/** A bust's base, as the only part of the new area to be drawn: the bust's own width for a short way (its flat
 * cut finished), then a low base a little wider than it, to the bottom of the canvas. Left to itself, FLUX draws a
 * reflection or a floor under a bust and no base; given only this shape it has to draw one. `span` is where the
 * bust meets the bottom edge (bottomSpan), `picture` its size, `size` the canvas it is drawn on. */
export async function baseMask(span: [number, number], picture: [number, number], size: [number, number], share: number): Promise<Buffer> {
  const [W0, H0] = picture, [w, h] = size;
  const Hn = growthOf(H0, share), H = H0 + Hn;
  const sx = w / W0, sy = h / H;
  const cx = ((span[0] + span[1]) / 2) * W0, half = ((span[1] - span[0]) / 2) * W0;
  const edge = (k: number) => [Math.max(0, cx - half * k), Math.min(W0, cx + half * k)];
  const ramp = Math.max(8, Math.round(H0 * RAMP_SHARE));
  const profile: [number, number][] = [[H0 - ramp, 1], [H0 + Hn * BASE_AT, 1], [H0 + Hn * BASE_AT + 1, BASE_WIDER], [H, BASE_WIDER]];
  const points = [...profile.map(([y, k]) => [edge(k)[0], y]), ...[...profile].reverse().map(([y, k]) => [edge(k)[1], y])];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="black"/><polygon fill="white" points="${points.map(([x, y]) => `${(x * sx).toFixed(1)},${(y * sy).toFixed(1)}`).join(' ')}"/></svg>`;
  const raw = await sharp(Buffer.from(svg)).greyscale().blur(2.5).raw().toBuffer();
  // soft into the picture over its last rows, as the whole new area's mask is
  for (let y = 0; y < h; y++) {
    const at = y / sy;
    const f = at >= H0 ? 1 : at >= H0 - ramp ? (at - (H0 - ramp)) / ramp : 0;
    if (f < 1) for (let x = 0; x < w; x++) raw[y * w + x] = Math.round(raw[y * w + x] * f);
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
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

/** What the inpaint is asked for a head or a chest: not a body drawn from so little, but a low base of the same
 * material for the bust's clean flat cut to rest on (drawn in the base's own shape, baseMask). */
export function basePrompt(notes: string) {
  const parts = ['A low, plain rectangular base of the same material and color as the bust, wider than the bust and directly under it, with a clean flat top that the bust rests on and a flat front.'];
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
