// Remix: a new piece drawn from a detailed description of the picture, not from the picture. Redrawn from the picture itself, FLUX
// kept nearly every line at any denoise that did not lose it altogether; drawn on a blank canvas from a paragraph that describes the
// picture closely (its medium, its subject and each of its parts, where they sit, the line work), at 1, it came back as the same
// kind of design, in the same style, with its own shapes (the user's test on the ComfyUI test bench, 2026-11-12). So the model reads
// each picture and writes that paragraph, and the paragraph is the prompt.

import type { RemixLevel } from '@telios/shared';
import { readPicture } from './read.ts';

const ROLE = `You help an image generator draw a new piece in the style of a picture. The generator never sees the picture: your paragraph is the only thing it is given, so describe the picture closely enough that it can draw the same kind of design from the words alone.`;
const RULES = `Do not mention the picture, the image, the artist, the lighting or the camera. No quotes, no lists, nothing else.`;

/** What the model is told at each level (REMIX_LEVELS): Detailed is the paragraph the remix was built on; Medium and Simple say less, so
 * ComfyUI draws less. */
const LEVELS: Record<RemixLevel, string> = {
  detailed: `Describe it exactly as it is, without improving or changing it, in this order: (1) the medium and style, with its colors (for example "A black ink tattoo flash design of a hibiscus flower in tribal style, solid black on a plain white background, vertical composition"); (2) the main subject: what it is, named as exactly as you can tell (the kind of flower, animal or object), where it sits in the design, which way it faces, and its shape and parts, each with its own detail (petals, wings, leaves, markings, the white cut lines inside a black shape); (3) everything around it, part by part: stems, tendrils, scrolls, curls, thorns, flourishes, ornaments, with their thickness, direction and how they end; (4) the line work and finish: how the strokes swell and taper, the contrast, and whether there is any shading, gray or texture, and how the design sits on the page.
Write one paragraph of 120 to 200 words. Say what the design is drawn on in the first sentence: "on a plain white background" for a white or paper ground. ${RULES}
Example answer: A black ink tattoo flash design of a hibiscus flower in tribal style, solid black on a plain white background, vertical composition. The hibiscus sits in the upper middle, seen from the front and tilted slightly down, a solid black silhouette with five wide rounded petals with softly ruffled edges, cut by a few thin white slashes that mark the petal veins and the throat. From the center of the flower, two long slender stamens rise straight up past the top petals, each ending in a small curl, framed by two thin curling tendrils on either side. Below the flower, a short black stem leads down into a dense, roughly symmetrical spray of thick tribal flourishes that fills the lower two-thirds of the design: bold tapering S-curves and C-scrolls sweep outward to the left and right and hang down like long ribbons, each ending in a tight spiral curl, with smaller thin spirals and hooked tendrils filling the gaps between them. Thick, smooth, confident brush-like strokes that swell and taper, high contrast, no shading, no gray, no texture, clean edges, centered on the page with white space around it.`,
  medium: `Describe it as it is, but only its main shapes, in this order: (1) the medium and style, with its colors; (2) the main subject, named as exactly as you can tell (the kind of flower, animal or object), where it sits, which way it faces, and its overall shape and main parts; (3) the main elements around it (stems, scrolls, flourishes, ornaments) in broad strokes; (4) the finish, as bold clean strokes. Leave out small parts, fine markings, thin lines and texture.
Write one paragraph of 60 to 100 words. Say what the design is drawn on in the first sentence: "on a plain white background" for a white or paper ground. ${RULES}
Example answer: A black ink tattoo flash design of a hibiscus flower in tribal style, solid black on a plain white background, vertical composition. A bold black hibiscus with five wide rounded petals sits in the upper middle, facing forward, with two long stamens rising above it. Below it, a short stem opens into a roughly symmetrical spray of thick tribal flourishes that sweep outward and hang down, ending in spiral curls. Bold, clean, tapering strokes, high contrast, no shading, centered with white space around it.`,
  simple: `Describe only its essence: (1) the medium and its colors; (2) the main subject, named as exactly as you can tell, and its overall silhouette; (3) at most one or two main elements around it. End with "bold simple flat shapes, clean edges, no fine detail". Leave out everything small.
Write one paragraph of 30 to 50 words. Say what the design is drawn on in the first sentence: "on a plain white background" for a white or paper ground. ${RULES}
Example answer: A black ink tribal tattoo design of a hibiscus flower on a plain white background. A solid black hibiscus at the top, above a symmetrical spray of thick sweeping flourishes ending in spiral curls. Bold simple flat shapes, clean edges, no fine detail.`,
};
const MAX_LENGTH = 1600;

/** What the model is told for a level. */
export const instructionsFor = (level: RemixLevel) => `${ROLE}\n${LEVELS[level]}`;

/** The picture described, as closely as the level asks, in one paragraph that is the remix's prompt; null when no model is set up or it
 * could not answer. */
export function readRemix(png: Buffer, signal?: AbortSignal, level: RemixLevel = 'detailed'): Promise<string | null> {
  return readPicture(png, {
    system: instructionsFor(level),
    ask: level === 'detailed' ? 'Describe this design closely.' : 'Describe this design.',
    max: MAX_LENGTH,
    what: 'describe the picture for a remix',
    signal,
  });
}
