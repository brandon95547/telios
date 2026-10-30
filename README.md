# Telios

Telios has two tools.

**Restyle** (the home page) redraws pictures (clip art, frames, ornaments, icons, anything) with
ComfyUI in the look you choose: clip art, line art, a 2D illustration or a 3D illustration, in one
of Talari's art styles (and a medium, for 2D illustrations) and one of its themes. Add one picture,
several, a folder, or a zip of them (PNG, JPEG, WebP, TIFF, GIF, BMP, SVG, EPS, PDF pages); the
results come back in a grid to tick, download as a zip (in folders by type, style and theme), or
delete. Clip art and line art come as SVG too.

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

The header says whether ComfyUI is ready. With a background removal model (BiRefNet), 2D and 3D
illustrations are cut out of their background; without one, a plain background is made clear by
color. With an upscaling model (4x-UltraSharp), Enhance details enlarges with detail. On an
NVIDIA A4000 a picture takes about 30 seconds, and the first after a pause about a minute more
(the models are loaded again).

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

