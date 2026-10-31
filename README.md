# Telios

Telios has two tools.

**Restyle** (the home page) redraws pictures (clip art, frames, ornaments, icons, anything) with
ComfyUI in the look you choose: clip art, line art, a 2D illustration or a 3D illustration, in one
of Talari's art styles (and a medium, for 2D illustrations) and one of its themes. Add one picture,
several, a folder, or a zip of them (PNG, JPEG, WebP, TIFF, GIF, BMP, SVG, EPS, PDF pages); the
results come back in a grid to tick, download as a zip (in folders by type, style and theme), delete,
or **approve**: Approve ticked saves each ticked picture into a folder on your computer (the one you
choose the first time, For Talari, which the browser then remembers: it needs Chrome, Edge or an app built
on them, because Telios may run on a server that cannot write there) and takes it out of the results. A flat
SVG is saved as its app package (a zip), clip art and line art as their SVG, anything else as the picture; a
file already in the folder is never overwritten (the new one is "name (2)"), and a picture that could not
be saved stays in the results. Each picture being drawn shows what it is doing and a progress bar, and the grid shows how far
the whole batch has come. Clip art and line art come as SVG too. A fifth choice, **Flat SVG** (under Vector, beside
2D and 3D), is drawn by a model instead of ComfyUI: new flat vector art of a frame, border, corner
or ornament, one layer per color, with the data that fits a frame or border to any page. It is
Vector redraw's drawing loop (below) run from the same grid, so it needs a model and no ComfyUI.

**Vector redraw** takes a picture of an existing design (a frame, a border, a corner, an ornament, a pattern
tile, an initial) and redraws it as clean vector art, with one layer per color, colored by a clear
rule, and for frames and borders the data that fits it to any page size by repeating units.

It works three ways:

- **Rebuild** (the default; no model, no cost, seconds): the copies a print is made of (the
  mirrored halves, the four corners, every unit of a repeating band) are found and averaged, so
  the print's damage drops out; the clean result is put back in every place, traced into layers,
  and its repeat measured for fitting.
- **Re-illustrate** (needs a model; minutes): a vision model writes the design as a drawing
  program, renders it, compares it with the original and refines it. New drawing, not a trace.
- **Trace** (seconds): the upload itself traced into color layers, flaws included.

## Run it

```bash
npm start
```

Then open http://localhost:5178. The first run installs the npm packages and a Python virtualenv
(`.venv`) for the image worker, and builds the web app. It needs Node 22+ and Python 3.9+.

`npm run dev` runs the same with hot reload (web on http://localhost:5179). `npm test` runs the
unit tests.

### Restyle and ComfyUI

Restyle draws with FLUX.1 Dev on ComfyUI, image to image: each picture is redrawn from part of the
way, so it keeps its shape (Follow the original: closely, balanced or loosely). A scan's gray or
yellowed paper is made white first. Telios builds every workflow itself and keeps every result;
ComfyUI is only lent the work. Where it runs is one setting in `.env`:

- **Beside a Phansora API** (`COMFYUI_API_URL`, `COMFYUI_API_TOKEN`): that server's ComfyUI and its
  models, through its gateway (`/talari/users/<id>/comfyui`, open to the accounts in its
  `TALARI_LAB_USERS`). Telios installs and downloads nothing.
- **A ComfyUI already running** (`COMFYUI_URL`), with the ComfyUI-GGUF loader and FLUX's files.
- **Neither: standalone.** `npm start` installs Telios's own ComfyUI into `comfyui/` and fetches its
  models once (about 12 GB; `npm run comfyui` does only that), then starts it on 127.0.0.1:8189.
  It wants an NVIDIA GPU; a Mac draws with Metal, slowly.

The header says whether ComfyUI is ready. The Background is optional for 2D and 3D illustrations:
left on **Keep original** (the default) nothing is cut out, before the redraw or after it, and the picture
is redrawn with its own background (its prompt says nothing about the ground); choose transparent, white,
black or green and the subject is cut out onto it, as follows (clip art and line art always have one, to be traced).
With a background removal model (BiRefNet), a 2D or 3D illustration is redrawn from its subject cut
out of the picture and put on flat white (FLUX keeps the ground it is given, so asking for a white
background in the prompt does nothing to a photographed one), then cut out again and placed on the
ground chosen; the cutout is made twice, so a picture takes a few seconds more. Follow the original
is 0.40, 0.50 or 0.60 of the way for these: 0.50 is a variation that keeps the pose, face and main
shapes and redraws the detail; from 0.70 up a picture starts to lose its subject. Without the model,
they are drawn on a flat green backdrop (blue if the picture has greens of its own) and cut out by
color, and a plain background is made clear by color for clip art and line art. With an upscaling
model (4x-UltraSharp), Enhance details enlarges with detail. On an NVIDIA A4000 a picture takes about
30 seconds, and the first after a pause about a minute more (the models are loaded again).

**Draw it whole** (a switch for 2D and 3D illustrations) redraws a figure
shown in part (a bust, a half figure) as the whole figure, standing, head to feet: the model reads the
picture and writes one detailed paragraph (120 to 180 words): the visible part described as exactly as it
is (colors, materials, pose and facing, every item with its own detail: headdress, face and expression,
beard, collars, armor, jewelry, clothing), then the part that is cut off continued to match it (same
materials, ornament and style, down to the feet: a statue on a low base, a living figure on the ground).
That paragraph is the redraw's prompt (the detail of the description is the detail of the figure, and the
only thing that ties the figure to the picture), on a taller 2:3 canvas, drawn from
nothing (denoise 1; Follow the original does not apply). Nothing is added to the picture: no cutout of a
base, no mask, a single draw. It is a new figure inspired by the picture (its headdress, clothes and
colors, not its face), which is the point. Tried at small sizes on a close-up of a pharaoh, the usual
wording ("a variation of the referenced image", even "as a full-length figure") gave a cartoon boy at 0.85
and a blank mannequin at 0.95, while a prompt that describes the whole figure gave a standing statue; but
only from nothing: started from the picture cut out and cropped into the tall canvas, 0.85 and 0.9 stayed
close-ups, because a face fills the frame. Some small draws came out as two figures, so draw a few
versions. It needs the model.

Seven art styles are drawn with a picture in that style as well as words, because FLUX does not get
them right from words alone: Biomechanical, Expressionism, Fauvism, Neo-Expressionism, Impressionism,
Rococo and Realistic Anime (`STYLE_REFERENCES` in `packages/shared/src/restyle.ts`, each with how
strongly it is applied). That is for 2D and 3D illustrations; clip art and line art are drawn from
words, so their flat, outlined look stays clean for tracing. The picture goes to ComfyUI beside the original, through USO, ByteDance's
style reference for FLUX: it takes the picture's color, brushwork and texture, not what it shows.
The pictures are not in the repository: put one per style in `data/style-references/`, named by the
style's id (`fauvism.webp`, `neo-expressionism.webp`; PNG or JPEG also work, and a large one is made
small before it is sent). The options panel says when a style has no picture on this server, or
ComfyUI has no USO files, and the result is then drawn from words alone and says so. USO's files
(about 1.4 GB) are fetched with the other models when Telios runs standalone; a Phansora API's
ComfyUI already has them.

Talari's choices (art styles, substyles, mediums, themes, and the words FLUX is given for each)
are kept in `packages/shared/src/catalog.ts`, written from Phansora's own lists by
`npm run sync:catalog` when `../phansora` and `../phansora-api` are beside this folder.

### A model

Rebuild and Trace need none. Reading designs by eye and re-illustrating them need a vision model
behind an OpenAI-compatible API. DeepSeek is the default: put its key in a `.env` file at the
repository root (git-ignored; see `.env.example`) and restart Telios:

```
DEEPSEEK_API_KEY=sk-…
```

It uses `deepseek-flash` (`DEEPSEEK_MODEL` to change it). Other providers work the same way, with
`TELIOS_PROVIDER` and `TELIOS_MODEL` (a model that reads images):

| `TELIOS_PROVIDER` | Key | Notes |
| --- | --- | --- |
| `deepseek` | `DEEPSEEK_API_KEY` | default; `deepseek-flash` |
| `gemini` | `GEMINI_API_KEY` | Google AI Studio's OpenAI-compatible endpoint |
| `openai` | `OPENAI_API_KEY` | |
| `openrouter` | `OPENROUTER_API_KEY` | many models behind one key |
| `ollama` | none | a model running on this machine (`ollama serve`) |
| `custom` | `TELIOS_API_KEY` | any OpenAI-compatible endpoint at `TELIOS_BASE_URL` |

The header shows whether the model answers. Each re-illustration shows what it cost, at the
provider's higher (peak) rate where Telios knows it: with DeepSeek Flash, about 5 to 15 cents for
six renders. Its drawing is good on geometric and simple floral designs and weak on complex
ornament, where Rebuild often does better.

In Restyle, a **Flat SVG** takes each picture through that same loop: the model reads it, takes its
own reading as confirmed (there is no step to correct it in a batch), then draws, renders and
revises, up to `TELIOS_MAX_RENDERS` times. Two run at a time (`TELIOS_DRAW_CONCURRENCY`), beside any
Vector redraw runs. A result keeps the layered SVG, its fitting data (`.layout.json`, in the zip too)
and a PNG preview; its viewer links to the full drawings and page fits in Vector redraw, and
deleting the result deletes those too.

**Made for.** A Flat SVG is made for a kind of piece: a frame, a border, a corner, a pattern tile or
an object (anything drawn whole: a flower, an animal, a sign, an ornament, a letter). *Let it
decide* keeps what the model read; the others say what the picture is. The kind decides how it is
drawn and what it must pass:

- A **frame** is drawn on a square master, whatever shape the original is, so it fits any page, from
  portrait through square to landscape. It is built from parts (`frameKit` in the drawing library:
  a corner, one unit of each edge, an optional ornament kept in the middle of an edge), so its fitting
  data is made for it and cannot disagree with the drawing.
- An **object** is drawn whole on a canvas of its own shape with a little spare round it, and is
  trimmed to its drawing in its package. None of a frame's fitting is asked of it.

**App-ready checks.** Every render is measured, and what fails goes back to the model as text (so a
cheaper model can fix it without a human judging a picture): nothing cut off at the canvas edge, a
clear ground, lines that hold at phone size (not hairlines), at most eight flat colors, and a
reasonable file size; for a frame, border or tile also its fitting data, the seams where units
repeat, the window of a frame, and that every unit stays within about 0.78–1.3 of its size on each of
twelve book sizes (6×9, 5.5×8.5, 8.5×11, 5×8, 4.25×6.87, 8×10, 8×8, 7×10, 11×8.5, 8.5×8.5, 9×12,
6×6). `finish` sends a drawing back once while it fails and renders remain. The result shows what
passed, and a tile says *App-ready* or *Not app-ready*.

**App package.** A Flat SVG downloads as a package (the viewer's *App package*, and a folder in the
zip): the layered SVG, a JSON manifest (what it is, its size and fitting data in the SVG's own units,
its colors and layers, and the checks), a fit sheet (the piece fitted as an app will place it) and
a README. The format is `telios-app-package`, version 1; an app reads the manifest and takes the
layers as they are.

Other settings (all optional, in the shell or `.env`): `TELIOS_EFFORT` (`low`, `medium` or
`high`, default `high`), `TELIOS_MAX_RENDERS` (default 8), `TELIOS_DRAW_CONCURRENCY` (default 2),
`TELIOS_DATA` (default `./data`), `PORT` (default 5178).

## Using it

1. **Upload** one or more images (PNG, JPG, WebP, TIFF; each PDF page becomes its own design).
2. **Check the reading.** Telios measures the design (and the model, if there is one, reads it):
   its kind, flat or shaded relief, its color rule, what repeats, its symmetry and palette.
   Correct anything that's off; you never have to say what it is up front.
3. **Rebuild**, **Re-illustrate** (you watch every render and the model's notes as it works) or
   **Trace**.
4. **Review**: the original beside the result; layers to hide; colors to change; material looks
   for a neutral base (gilt, silver, bronze, wood, stone); a frame on five page sizes, a border at
   three lengths, a tile as a surface.
5. **Download**: SVG, layered SVG (Illustrator and Inkscape layers), PDF, PNG at any width, and for
   frames and borders the fitting data (`slice`, `keep`, `repeat`) as JSON.

**Color rule.** A neutral grayscale base when color stands for a material or finish you would
choose (gilding, silver, wood, stone); full color when color is part of the art (multicolored
flowers, stained glass, painted patterns). One ink stays one ink; light lines carved out of an
ink get their own color.

**What Rebuild can and can't do.** It cleans what repeats: a mirrored design's halves, a
frame's corners, a chain of identical units. It keeps the original's drawing, so a hand-drawn
vine whose units differ is cleaned but not regularized, a part that appears only once (a damaged
corner) is only as clear as the scan, and a shaded engraving becomes a few flat tones rather than
its hatching. Those are where re-illustration earns its cost.

## How it's built

```
apps/web         React + Vite: Restyle, the library, reading, live runs, review, downloads
apps/api         Express API + a forked job worker (queue, model loop, rendering)
  src/restyle    Restyle: inputs and results on disk, preparing uploads, the job, its routes
  src/comfy      ComfyUI, through a Phansora API or directly, and the workflows Restyle runs
  src/engine     reading, the model client, the drawing loop, checks, the drawing library, the brief
  src/sandbox    runs each model-written program in a locked-down Node process
  src/auth.ts    signing in, for a public address
packages/shared  types, Restyle's choices and Talari's catalog, the page-fitting algorithm, material looks
worker           Python: measuring uploads, Rebuild, exact-palette vectorizing, tracing, zips, EPS
docker/comfyui   Telios's own ComfyUI image and model fetcher, for standalone
docs/PLAN.md     architecture, the MVP, what comes next
```

Uploads and results live in `data/` (git-ignored). See [docs/PLAN.md](docs/PLAN.md) for the
pipeline stage by stage, the sandbox, and later phases.

## On a server

`docker-compose.prod.yml` runs Telios in Docker on 127.0.0.1:5178, for nginx in front; its data
stays in `./data`. On a public address, set `TELIOS_SETUP_CODE` in `.env`: the first visit asks for
it and makes the one account (a name and a password); every visit after that signs in.

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

A release: `git pull`, then the same command again.

### Through a tunnel

Telios listens on the server's 127.0.0.1 only, so before nginx and a domain are set up (or to
reach it without them), open an SSH tunnel from your own computer and use it as if it ran there:

```bash
ssh -N -L 5178:127.0.0.1:5178 you@your-server
```

Leave that running and open http://localhost:5178. The first visit asks for the setup code
(`grep TELIOS_SETUP_CODE .env` in Telios's folder on the server), then the name and password you
choose; the account is the same one the domain uses later. Ctrl+C closes the tunnel. If 5178 is
taken on your computer, use another port on the left: `-L 5200:127.0.0.1:5178`, then
http://localhost:5200.

