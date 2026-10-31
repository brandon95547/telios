// Draw it whole: a picture that shows part of a figure (a bust, a half figure) redrawn as the whole figure,
// standing, head to feet. FLUX redraws from the picture only a rough layout of color; a prompt that says
// "a variation of the referenced image" cannot make a body from a head and a chest (a cartoon boy at 0.85, a
// blank mannequin at 0.95), but one that DESCRIBES the figure full-length does. So the model reads the
// picture and writes that sentence, and the redraw runs on it at a high denoise, on a taller canvas: no
// extension of the picture, no inpaint. The figure that comes out is a new one, inspired by the picture.

import { chat, imagePart, provider, textPart } from '../engine/llm.ts';
import { forModel } from '../engine/render.ts';

const SYSTEM = `You help an image generator draw a whole figure from a picture that shows only part of it. Write one sentence (at most 70 words) that describes the same figure shown full-length, head to feet, standing upright with the whole body visible: what it is and what it is made of, its headdress or hair, which way it faces, its clothing, ornament and colors as they appear in the picture, a plausible pose, and how it ends (a statue ends in bare feet or sandals on a low rectangular base; a living figure or character ends in feet on the ground). Start with "A full-length". No style or camera words. No quotes, nothing else.`;

/** The model's sentence, cleaned: its first line, no quotes, no longer than the prompt can use. Null when empty. */
export function parseWhole(text: string): string | null {
  const line = text.trim().split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const sentence = line.replace(/^["'“]+|["'”]+$/g, '').trim();
  return sentence ? sentence.slice(0, 600) : null;
}

/** What the whole figure looks like, in one sentence, from the picture; null when no model is set up or it could not answer. */
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
