// What ComfyUI is asked to draw: a variation of the picture, the art style (Talari's words for it), the theme and the
// background, in plain sentences, which FLUX reads better than tag lists.

import { findStyle, findTheme, type RestyleOptions } from '@telios/shared';

// An illustration is led by the picture, which carries what it shows: the prompt says nothing about it, and asks for a
// variation with the picture as inspiration, so FLUX remixes it and does not copy.
const VARIATION = 'Using the referenced image as inspiration, create a variation of it.';

// Drawn on white: redrawn from a picture on white, FLUX keeps its white ground whatever the prompt
// says. A black ground is the white one cut away and filled (job.ts). When the ground is to be
// cleared, it is asked for bare: a studio wall, a floor or a cast shadow would be left in the cutout.
// A picture of something (a character, an object) with no background-removal model to cut it out is
// drawn on a flat key color instead, which job.ts starts it on too, and cuts it out by: FLUX draws
// that backdrop with a gradient and a floor, and light bouncing off it onto the subject, which the
// words ask it not to and the cutout copes with.
export type KeyColor = 'green' | 'blue';
export const KEY_HEX: Record<KeyColor, string> = { green: '#00ff00', blue: '#0000ff' };
const KEYED = (color: KeyColor) => `Isolated on a solid flat pure bright ${color} (${KEY_HEX[color].toUpperCase()}) background, one uniform color from edge to edge, with no gradient, no floor, no wall and no cast shadow. The subject floats in empty space with nothing beneath it, and is lit by neutral white light with no ${color} reflected on it.`;
const BACKGROUND = 'Isolated on a plain pure white background.';
// Draw it whole: the figure is described in detail, and the ground is asked for so that it can be cut out (this wording, with
// "scenery" and the even light, gave a plain white ground when tried by hand)
const BARE_WHOLE = 'The whole figure is isolated on a plain, pure white background, with no floor, no wall, no scenery and no cast shadow, evenly lit so that its edges separate cleanly from the white.';
const BARE_BACKGROUND = 'Isolated on a plain pure white background, with no floor, no wall and no cast shadow.';

/** The look the user asked for, in sentences: the art style, the theme and their own words. */
export function lookWords(o: RestyleOptions): string[] {
  const parts: string[] = [];
  const style = findStyle(o.style);
  if (style) parts.push(`In this style: ${style.words}.`);
  const theme = findTheme(o.theme);
  if (theme) {
    const name = theme.label.replace(/&/g, 'and');
    parts.push(`${name} themed, with ${name} motifs and ornament.`);
  }
  if (o.notes) parts.push(o.notes.replace(/\s+/g, ' ').replace(/([^.!?])$/, '$1.'));
  return parts;
}

/** `lead` replaces the type's own opening: for Draw it whole, the model's sentence about the whole figure. That sentence
 * is written in the look already (the model is given it, to describe the character as that look would draw it), so the
 * look is not added after it: words tacked on to a description of the original did not change what was drawn. */
export function restylePrompt(o: RestyleOptions, key?: KeyColor, lead?: string) {
  if (o.type === 'vector' || o.type === 'trace') throw new Error('A flat SVG is drawn by the model, and a trace made by the worker, not by ComfyUI: neither has a prompt.');
  const parts = [lead ? lead.replace(/\s+/g, ' ').replace(/([^.!?])$/, '$1.') : VARIATION];
  if (!lead) parts.push(...lookWords(o));
  // with no ground chosen the picture keeps its own, and the prompt says nothing about it; a whole figure is still asked for
  // on a plain white one (it has none of its own, and is drawn from nothing)
  if (o.background !== 'original' || lead) parts.push(o.background === 'white' && !lead ? BACKGROUND : key ? KEYED(key) : lead ? BARE_WHOLE : BARE_BACKGROUND);
  return parts.join(' ');
}
