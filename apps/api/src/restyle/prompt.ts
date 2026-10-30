// What ComfyUI is asked to draw: the output type's look, what the picture shows, the art style
// (Talari's words for it), the medium, the theme and the background, in plain sentences, which
// FLUX reads better than tag lists.

import { findMedium, findStyle, findTheme, type ComfyType, type RestyleOptions } from '@telios/shared';

// Illustration and 3D are led by the picture, which carries what it shows: they say nothing about
// it, and ask for a variation with the picture as inspiration, so FLUX remixes it and does not copy.
const VARIATION = (dimension: '2D' | '3D') => `Using the referenced image as inspiration, create a ${dimension} variation of it.`;
const TYPE_WORDS: Record<ComfyType, (subject: string) => string> = {
  clipart: (s) => `Colorful vector clip art of ${s}, in a flat design style: bold clean outlines, large areas of solid flat color in a bright full-color palette, simple shapes, little detail, no gradients, no shading and no texture.`,
  lineart: (s) => `Black and white line art of ${s}. Clean black ink outlines only, even line weight, no shading, no fill and no color, like a page of a coloring book.`,
  illustration: () => VARIATION('2D'),
  render3d: () => VARIATION('3D'),
};

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
const BARE_BACKGROUND = 'Isolated on a plain pure white background, with no floor, no wall and no cast shadow.';

export function restylePrompt(o: RestyleOptions, subject: string, key?: KeyColor) {
  if (o.type === 'vector') throw new Error('A flat SVG is drawn by the model, not by ComfyUI: it has no prompt.');
  // a phrase the model wrote starts with a capital; inside the sentence it should not
  const what = subject.trim().replace(/^(?:A|An|The)\b|^[A-Z](?=[a-z])/, (w) => w.toLowerCase()) || 'the design in the picture';
  const parts = [TYPE_WORDS[o.type](what)];
  const style = findStyle(o.style);
  if (style) parts.push(`In this style: ${style.words}.`);
  const medium = o.type === 'illustration' ? findMedium(o.medium) : null;
  if (medium) parts.push(`Made as ${medium.words}.`);
  const theme = findTheme(o.theme);
  if (theme) {
    const name = theme.label.replace(/&/g, 'and');
    parts.push(`${name} themed, with ${name} motifs and ornament.`);
  }
  if (o.notes) parts.push(o.notes.replace(/\s+/g, ' ').replace(/([^.!?])$/, '$1.'));
  parts.push(o.background === 'white' ? BACKGROUND : key ? KEYED(key) : BARE_BACKGROUND);
  return parts.join(' ');
}

/** A picture's subject from its file name, when no model reads it: "Frame_01" → "a frame". */
export function subjectFromName(name: string) {
  const words = name.replace(/\.[a-z0-9]+$/i, '').replace(/[_\-.]+/g, ' ').replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return words ? `a ${words}` : 'the design in the picture';
}
