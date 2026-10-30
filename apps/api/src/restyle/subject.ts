// What a picture shows, in a phrase, for the prompt: read by the model when one is set up (a
// fraction of a cent a picture, once per input), so ComfyUI is told "an oval cartouche frame with
// acanthus scrolls" rather than only the file's name.

import { chat, imagePart, provider, textPart } from '../engine/llm.ts';
import { forModel } from '../engine/render.ts';

const SYSTEM = `You describe a picture for an image generator that will redraw it in a new style.
Answer with one noun phrase of at most 25 words saying what it is (a frame, border, corner, ornament,
icon, character, animal, object, scene…), its shape and layout, and its main motifs.
No style, color, medium or quality words. No full sentence, no quotes, nothing else.`;

// For Draw it whole: the subject as a new, complete one, with what makes it itself (its colors,
// its look) since the picture's own pixels are only a loose guide. It must not say the picture is
// cropped or a close-up, or the drawing is asked to be one.
const WHOLE = `You describe the main subject of a picture for an image generator that will draw it as a new,
COMPLETE subject. Answer with one noun phrase of at most 40 words: what it is, its hair or fur,
eye, skin and clothing colors, expression, pose and any notable features or objects. Describe it
as if it were shown whole even where the picture cuts it off. Never mention cropping, close-ups,
framing, the camera, or the picture's style, medium or quality. No full sentence, no quotes,
nothing else.`;

/** The phrase, or null when no model is set up or it could not answer. */
export const readSubject = (png: Buffer, signal?: AbortSignal) => read(SYSTEM, png, signal);
/** The subject described as a complete one (see WHOLE). */
export const readWholeSubject = (png: Buffer, signal?: AbortSignal) => read(WHOLE, png, signal);

async function read(system: string, png: Buffer, signal?: AbortSignal): Promise<string | null> {
  if (!provider().provider) return null;
  try {
    const res = await chat({
      maxTokens: 4000,
      effort: 'low',
      signal,
      messages: [
        { role: 'system', content: system },
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
