// The model reads a picture and answers in words: Draw it whole's paragraph about the whole figure, and Remix's sentence about what the
// picture is as a drawing. Both are prompts for the redraw, so the answer is cleaned to one run of prose.

import { chat, imagePart, provider, textPart } from '../engine/llm.ts';
import { forModel } from '../engine/render.ts';

/** The model's answer, cleaned: its lines joined, no quotes, no longer than `max` (cut at a sentence where it can be). Null when empty. */
export function cleanAnswer(text: string, max: number): string | null {
  const lines = text.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  const joined = lines.join(' ').replace(/^["'“]+|["'”]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!joined) return null;
  if (joined.length <= max) return joined;
  const cut = joined.slice(0, max);
  const end = cut.lastIndexOf('. ');
  return end > max / 2 ? cut.slice(0, end + 1) : cut;
}

/** What the model says of the picture, asked with `system` and `ask`; null when no model is set up or it could not answer
 * (logged as `what`). A cancel is passed on. */
export async function readPicture(png: Buffer, o: { system: string; ask: string; max: number; what: string; signal?: AbortSignal }): Promise<string | null> {
  if (!provider().provider) return null;
  try {
    const res = await chat({
      maxTokens: 4000,
      effort: 'low',
      signal: o.signal,
      messages: [
        { role: 'system', content: o.system },
        { role: 'user', content: [imagePart(await forModel(png, 768)), textPart(o.ask)] },
      ],
    });
    return cleanAnswer(res.message.content ?? '', o.max);
  } catch (e) {
    if (o.signal?.aborted) throw e;
    console.error(`[restyle] could not ${o.what}:`, (e as Error).message);
    return null;
  }
}
