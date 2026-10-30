// What a picture shows, in a phrase, for the prompt: read by the model when one is set up (a
// fraction of a cent a picture, once per input), so ComfyUI is told "an oval cartouche frame with
// acanthus scrolls" rather than only the file's name.

import { chat, imagePart, provider, textPart } from '../engine/llm.ts';
import { forModel } from '../engine/render.ts';

const SYSTEM = `You describe a picture for an image generator that will redraw it in a new style.
Answer with one noun phrase of at most 25 words saying what it is (a frame, border, corner, ornament,
icon, character, animal, object, scene…), its shape and layout, and its main motifs.
No style, color, medium or quality words. No full sentence, no quotes, nothing else.`;

/** The phrase, or null when no model is set up or it could not answer. */
export async function readSubject(png: Buffer, signal?: AbortSignal): Promise<string | null> {
  if (!provider().provider) return null;
  try {
    const res = await chat({
      maxTokens: 4000,
      effort: 'low',
      signal,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: [imagePart(await forModel(png, 768)), textPart('What does this picture show?')] },
      ],
    });
    const phrase = (res.message.content ?? '').trim().split('\n')[0].replace(/^["'“]+|["'”.]+$/g, '').trim();
    return phrase ? phrase.slice(0, 320) : null;
  } catch (e) {
    if (signal?.aborted) throw e;
    console.error('[restyle] could not read a picture:', (e as Error).message);
    return null;
  }
}
