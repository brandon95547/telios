# Telios

Telios takes a picture of an existing design (a frame, a border, a corner, an ornament, a pattern
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
provider's higher (peak) rate where Telios knows it.

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
apps/web         React + Vite: library, reading, live runs, review, downloads
apps/api         Express API + a forked job worker (queue, model loop, rendering)
  src/engine     reading, the model client, the drawing loop, checks, the drawing library, the brief
  src/sandbox    runs each model-written program in a locked-down Node process
packages/shared  types, the page-fitting algorithm, material looks
worker           Python: measuring uploads, Rebuild, exact-palette vectorizing, tracing
docs/PLAN.md     architecture, the MVP, what comes next
```

Uploads and results live in `data/` (git-ignored). See [docs/PLAN.md](docs/PLAN.md) for the
pipeline stage by stage, the sandbox, and later phases.
