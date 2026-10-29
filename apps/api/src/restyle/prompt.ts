// What ComfyUI is asked to draw: the output type's look, what the picture shows, the art style
// (Talari's words for it), the medium, the theme and the background, in plain sentences, which
// FLUX reads better than tag lists.

import { findMedium, findStyle, findTheme, type RestyleOptions } from '@telios/shared';

const TYPE_WORDS: Record<RestyleOptions['type'], (subject: string) => string> = {
  clipart: (s) => `Colorful vector clip art of ${s}, in a flat design style: bold clean outlines, large areas of solid flat color in a bright full-color palette, simple shapes, little detail, no gradients, no shading and no texture.`,
  lineart: (s) => `Black and white line art of ${s}. Clean black ink outlines only, even line weight, no shading, no fill and no color, like a page of a coloring book.`,
  illustration: (s) => `A 2D illustration of ${s}.`,
  render3d: (s) => `A 3D rendered illustration of ${s}. Sculpted three-dimensional forms, physically based materials, soft global illumination, gentle studio lighting and soft shadows, a high quality 3D render.`,
};

// Always drawn on white: redrawn from a picture on white, FLUX keeps its white ground whatever
// the prompt says. A black ground is the white one cut away and filled (job.ts).
const BACKGROUND = 'Isolated on a plain pure white background.';

export function restylePrompt(o: RestyleOptions, subject: string) {
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
  parts.push(BACKGROUND);
  return parts.join(' ');
}

/** A picture's subject from its file name, when no model reads it: "Frame_01" → "a frame". */
export function subjectFromName(name: string) {
  const words = name.replace(/\.[a-z0-9]+$/i, '').replace(/[_\-.]+/g, ' ').replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return words ? `a ${words}` : 'the design in the picture';
}
