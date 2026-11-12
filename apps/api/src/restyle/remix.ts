// Remix: an illustration redrawn in the picture's own style, not one of Talari's. Redrawn from half of the way with only "a variation of
// the referenced image" to go on, FLUX keeps the picture's look but drifts in what it shows; with a plain sentence that says what the
// picture is as a drawing ("A black ink line drawing of a flower on a plain white background", tried by hand), it draws a new piece of
// the same kind. So the model reads each picture and writes that sentence for it, naming its own subject: a lily, a rose, a moth.

import { readPicture } from './read.ts';

const SYSTEM = `You help an image generator redraw a picture as a new piece in the same style. Your sentence is the generator's prompt, after "create a remix of it:": it says what the picture is, as a drawing.
Write one sentence of 10 to 30 words, in this order: "A" or "An"; the medium and look (a black ink line drawing, a one-color silhouette, a flat color vector illustration, a watercolor painting, an engraving), with the main colors where it is in color; "of"; the subject, named as exactly as you can tell (the kind of flower, animal or object, not just "a flower"), with its main parts in a few words.
Do not mention the picture, the image, the artist, the lighting or the camera. No quotes, nothing else.`;
const WITH_GROUND = `End the sentence with what it is drawn on, plainly: "on a plain white background", "on a cream paper background".
Example answer: A black ink line drawing of a lily with three open blooms and long curling leaves on a plain white background.
Example answer: A flat color vector illustration in red, pink and green of a rose with two leaves on a plain white background.`;
const NO_GROUND = `Do not describe the background: it is chosen separately.
Example answer: A black ink line drawing of a lily with three open blooms and long curling leaves.
Example answer: A flat color vector illustration in red, pink and green of a rose with two leaves.`;
const MAX_LENGTH = 400;

/** What the picture is as a drawing, in one sentence that opens the redraw's prompt: with its ground when the picture keeps its own,
 * without it when another is chosen. Null when no model is set up or it could not answer. */
export function readRemix(png: Buffer, signal: AbortSignal | undefined, withGround: boolean): Promise<string | null> {
  return readPicture(png, {
    system: `${SYSTEM}\n${withGround ? WITH_GROUND : NO_GROUND}`,
    ask: 'Say what this picture is, as a drawing.',
    max: MAX_LENGTH,
    what: 'read the picture for a remix',
    signal,
  });
}
