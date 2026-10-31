// Draw it whole: a picture that shows part of a figure (a bust, a half figure) redrawn as the whole figure,
// standing, head to feet. FLUX redraws from the picture only a rough layout of color; a prompt that says
// "a variation of the referenced image" cannot make a body from a head and a chest (a cartoon boy at 0.85, a
// blank mannequin at 0.95), but one that DESCRIBES the figure full-length, in detail (its armor, collars,
// jewelry, face, textures: the detail of the description is the detail of the figure), does. So the model reads
// the picture and writes that paragraph, and the redraw runs on it from nothing, on a taller canvas: no
// extension of the picture, no inpaint. The figure that comes out is a new one, inspired by the picture.

import { chat, imagePart, provider, textPart } from '../engine/llm.ts';
import { forModel } from '../engine/render.ts';

const SYSTEM = `You help an image generator draw a whole figure from a picture that shows only part of it. Your paragraph is the only thing the generator sees: it must be exact about what is visible, and sensible about what is not.
First, look closely at the visible part and describe it as exactly as you can, as it is in the picture and without improving or changing it: its colors (grayscale if the picture is black and white), its materials, its pose and which way it faces, and every item you can see, each with its own detail (a headdress and its stripes or emblem, the hair, the face with its features and expression, the beard, each collar or necklace, armor with its texture or scales, jewelry, clothing, patterns, engraved or painted marks, weapons).
Then complete the figure from what is visible: say how the part that is cut off continues, in the same materials, ornament and style, down to the feet. A statue ends in bare feet or sandals on a low rectangular stone base; a living figure or character ends in feet on the ground.
Write one paragraph of 5 or 6 sentences, 120 to 180 words, in this order: (1) "A highly detailed", the colors, "full-length", what it is, its pose and which way it faces, "shown from head to feet with the whole body visible"; (2) the head: headdress or hair, crown, face, expression, beard; (3) the neck, shoulders and chest: collars, armor, jewelry, clothing; (4) the part that is not visible, continued to match the rest; (5) the overall look: the textures, materials and aesthetic.
Do not describe the background, the lighting or the camera, and do not mention the picture. No quotes, no lists, nothing else.
Example answer: A highly detailed grayscale full-length statue of an ancient Egyptian pharaoh standing upright in right-facing side profile, shown from head to feet with the whole body visible. On his head is a striped nemes headdress with a raised cobra emblem at the forehead and long banded lappets; his face is sharply sculpted and realistic, with a calm, stern expression, strong regal features and a long braided ceremonial beard. Across his neck and shoulders lie layered collars and ornate ceremonial armor of finely engraved scales, with decorative jewelry. Below the chest the body continues in the same dark engraved stone, in a pleated kilt, with bare feet standing on a low rectangular stone base. The overall look is highly intricate and statuesque, with finely engraved textures and a dramatic ancient-Egyptian royal aesthetic.`;

/** The model's paragraph, cleaned: its lines joined, no quotes, no longer than the prompt can use. Null when empty. */
export function parseWhole(text: string): string | null {
  const lines = text.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  const joined = lines.join(' ').replace(/^["'“]+|["'”]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!joined) return null;
  if (joined.length <= MAX_LENGTH) return joined;
  const cut = joined.slice(0, MAX_LENGTH);
  const end = cut.lastIndexOf('. ');
  return end > MAX_LENGTH / 2 ? cut.slice(0, end + 1) : cut;
}
const MAX_LENGTH = 1400;

/** What the whole figure looks like, in a short detailed paragraph, from the picture; null when no model is set up or it could not answer. */
export async function readWholeFigure(png: Buffer, signal?: AbortSignal): Promise<string | null> {
  if (!provider().provider) return null;
  try {
    const res = await chat({
      maxTokens: 4000,
      effort: 'low',
      signal,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: [imagePart(await forModel(png, 768)), textPart('Describe this figure full-length.')] },
      ],
    });
    return parseWhole(res.message.content ?? '');
  } catch (e) {
    if (signal?.aborted) throw e;
    console.error('[restyle] could not describe the whole figure:', (e as Error).message);
    return null;
  }
}
