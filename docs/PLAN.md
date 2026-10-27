# Telios: plan

Telios turns a picture of an existing design (a frame, a border, a corner, an ornament, a pattern
tile, an initial) into **clean vector art**, with one layer per color, colored by a clear rule,
and, for frames and borders, built to repeat so it fits any page size. The user uploads, confirms
what Telios read, runs it, reviews the result and downloads it as SVG, layered SVG, PDF, PNG and
fitting data.

Three ways to run a design:

- **Rebuild** (default; no model, free, seconds): the copies a print is made of are found and
  averaged (§2a), so the print's damage drops out and the repeat is exact.
- **Re-illustrate** (a vision model behind any OpenAI-compatible API; DeepSeek by default): the
  model writes the design as a drawing program, renders, compares and refines. New drawing.
- **Trace** (seconds): the upload traced as it is.

It follows the process in `~/sites/illustration-recreation-process.md` (read-only), which was
written for this app; the stage numbers below are that document's.

---

## 1. Architecture

```
 Browser (React, Vite)                     Node API (Express)                    Job worker (Node, forked)
 ─────────────────────                     ──────────────────                    ─────────────────────────
 Library: upload, list        ──HTTP──▶    /api/designs, /api/runs   ──IPC──▶    queue (2 draw, 3 read at once)
 Design: reading, runs,       ◀──SSE───    events per run            ◀──IPC──    read job:  prepare → analyze → model reads
 live iterations, review,                  /api/files (data dir)                 draw job:  model loop ⇄ sandbox ⇄ renderer
 layers, colors, fit preview,              /api/runs/:id/export                  rebuild, trace jobs: Python only
 downloads                                 (SVG, layered, PDF, PNG, JSON)        finish:    exact-palette copy → layers
                                                                                     │                 │
                                                                    Sandbox (node --permission,    Python worker
                                                                    vm context, no fs/net/child)   (numpy, scipy, Pillow,
                                                                    runs the model's program       vtracer, PyMuPDF)
                                                                    and returns SVG text only      analyze, rebuild, vectorize, trace
 Storage: data/ on disk: data/designs/<id>/{original, source.png, analysis.json, reading.json, runs/<run>/…}
```

- **Web** (`apps/web`): React + Vite + TypeScript. No component library; one stylesheet.
- **API** (`apps/api/src/server.ts`): Express. Accepts uploads, serves stored files, streams run
  events (Server-Sent Events), exports downloads. Never runs model-written code and never renders
  model output itself: both happen in the job worker and the sandbox.
- **Job worker** (`apps/api/src/worker/`): a child process the API forks. It owns the queue,
  the model calls, rendering (sharp/librsvg) and the Python calls. A crash there doesn't take
  the API down; jobs and their events are persisted, so the API can show them after a restart.
- **Sandbox** (`apps/api/src/sandbox/`): every drawing program the model writes runs in its own
  short-lived Node process with the permission model on (no file writes, no child processes, no
  workers, no addons), an empty environment, a memory cap and a hard timeout; on macOS it is also
  wrapped in `sandbox-exec` with network denied. Inside, the program runs in a fresh `vm` context
  that holds only the drawing library (no `require`, `process`, `fetch` or timers), with string
  code generation off. The only thing that comes back is JSON on stdout: the SVG text, the
  palette and the layout. The SVG is then checked against an element and attribute allowlist
  (no scripts, images, external references, text, filters) before anything renders it.
- **Python worker** (`worker/telios_worker`): command-line tools the job worker calls:
  `ingest` (any upload to a clean, leveled PNG and stage 2's measurements), `pdfpages`,
  `rebuild` (§2a), `vectorize` (exact-palette tracing copy → one layer per color) and `trace`.
- **Model** (`apps/api/src/engine/llm.ts`): one client for any OpenAI-compatible chat API,
  streamed, with retries, tool calls and images. DeepSeek (`deepseek-flash`) when
  `DEEPSEEK_API_KEY` is set; Gemini, OpenAI, OpenRouter, a local Ollama or any other endpoint by
  `TELIOS_PROVIDER` and `TELIOS_MODEL`. Its reasoning goes back with each turn where the provider
  requires it (DeepSeek does once tools are used); a parameter an endpoint refuses is dropped and
  the request sent again. Health is checked by listing models, which costs nothing. The key is
  read from the environment or `.env` (see §6).

### One command

`npm start` installs what's missing (npm workspaces, a Python virtualenv in `.venv`), builds the
web app and serves everything on http://localhost:5178. `npm run dev` does the same with hot
reload (Vite on 5179, proxied to the API).

---

## 2. The pipeline in Telios

| Stage (process doc) | In Telios | Where |
|---|---|---|
| 1. Find designs in a scanned page | Later (phase 2); the MVP takes one design per image or PDF page | — |
| 2. Analyze | Automatic on upload: ink vs. paper, tilt, symmetry, repeats (FFT autocorrelation along each band), palette (k-means in Lab), carved lines, window, tonal continuity (flat vs. shaded), a first guess at the kind | `worker/telios_worker/analyze.py` |
| — Read | The model looks at the image with the measurements and returns a structured reading (JSON): kind, rendering, color rule, what repeats, symmetry, palette, structure, a plan. The user confirms or corrects it in one step. Without a model, the measurements alone fill it in | `apps/api/src/engine/read.ts` |
| 3. Plan | Part of the drawing loop's first turn, guided by the reading and the brief | `apps/api/src/engine/brief.md` |
| 4. Draw | The model writes a drawing program (JavaScript) against Telios' primitive library, with two finished programs as examples | `apps/api/src/engine/drawlib.js`, `examples/` |
| 5. Critique | Each program is run in the sandbox and rendered; the model gets the render beside the original, close-ups on request, the seam check, a fit simulation on other page sizes and a palette check, then revises (whole program or small edits) until satisfied or out of renders. Every iteration streams to the browser | `apps/api/src/engine/draw.ts`, `render.ts` |
| 6. Vectorize | The final drawing is rendered at 2 px per unit, quantized to exactly its palette, and traced into one layer per color, each reaching 2 px under the lighter colors over it | `worker/telios_worker/vectorize.py` |
| 7. Fit | The fitting algorithm (corners whole, whole units eased by at most a fifth, kept middle, mirrored second half, never stretched or turned) in a shared module, used by the review's page-size preview and the worker's fit check | `packages/shared/src/fit.ts` |
| 8. Validate | Seam check, fit check, palette exactness and symmetry on every iteration; unit tests for the fitting math | `render.ts`, `packages/shared/test`, `worker/tests` |
| 9. Approve | The review screen: original beside result, layers, colors, page sizes; the user downloads or runs again | `apps/web` |

**Trace mode** skips stages 3–5: the Python vectorizer cleans the upload (paper made transparent,
colors snapped to the reading's palette, specks removed) and traces it into per-color layers in
seconds. It keeps the original's flaws.

### 2a. Rebuild (no model)

A print is many copies of a few shapes: the halves of a mirrored design, the four corners of a
frame, every unit of a repeating band. Each copy carries its own flaws (speckle, broken lines,
ink spread, a scan's wobble) but not the same ones, so their average is cleaner than any copy.
`worker/telios_worker/rebuild.py`:

1. **Segment** at full working resolution: each pixel's share of each palette color (soft, from
   its Lab distance); the paper, the window and stray marks beyond a clear gap (a page number, a
   caption) left out. Shaded relief is read through a blur at the hatching's scale, so the
   engraver's lines become the tones they stand for, and drawn in three to five flat grays.
2. **Mirror** about the best axis near the middle, left–right and top–bottom as the reading says,
   only when the halves really agree (correlation ≥ 0.78; a relief lit from one side falls short
   and would ghost). A square frame corner is also averaged across its diagonal.
3. **Repeat**: a frame's edges and a border's length are folded on their measured period. What
   runs the band's whole length (rules, grounds) is taken out first, so only the motif can show a
   repeat; the repeat must cover at least 30% of the edge and its copies must agree (≥ 0.8) after
   each is shifted a pixel or two to absorb wobble. Hand-drawn units that vary are left as drawn.
   The averaged unit is laid back whole, symmetric about the middle, and becomes the fitting data
   (`slice`, `keep`, `repeat`). A pattern is folded on its lattice into one tile.
4. **Clean**: smoothed (more where fewer copies were averaged), a fine line kept where enough
   copies agree on it however faint each is, specks and pinholes removed, the color rule applied
   (a neutral relief's grays spread over the full range), traced into one layer per color.

Every step says what it did in the run's timeline. It keeps the original's drawing and loses its
damage; what appears only once (a frame's corner) is only as clear as the scan, and a shaded
engraving becomes flat tones, not hatching. Those are where re-illustration earns its cost.

### Color rule (the user's)

Decided in the reading and shown for confirmation:

- **Neutral grayscale base** when color stands for a material or finish the user would choose
  (gilding, silver, bronze, wood, stone, plaster). Drawn in grays with no hue: shaded relief gets
  up to 12 grays (light raised, dark recessed), flat art a few. The review offers material looks
  (gilt, silver, bronze, wood, stone) mapped over the grays.
- **Full color** when color is part of the artwork (multicolored flowers, stained glass, painted
  details, decorative patterns). The palette is kept; colors can be changed per layer.
- **One ink** (woodcut, engraving) stays one ink. Light lines carved out of a solid ink get their
  own color (Ivory) and layer, so ink and lines recolor separately.
- **Both** in one piece (gilded frame wreathed in painted flowers): full color.

### What each kind produces

| Kind | Drawn as | Layout data |
|---|---|---|
| Frame | Corners, repeating edge units on a grid anchored at each edge's middle, an optional kept middle; one quarter drawn and mirrored | `slice`, `keep`, `repeat` (x and y) |
| Border | A horizontal strip: end caps and a repeating unit | `repeat.x` |
| Corner | One corner, drawn whole | `corner` |
| Pattern tile | Exactly one tile that wraps seamlessly on its lattice (grid, half-drop, brick) | `tile` |
| Ornament, initial, other | Drawn whole; initials drawn as outlines, never font text | — |

---

## 3. Data on disk

```
data/
  designs/<designId>/
    design.json        name, upload info, status, current reading, run ids
    original.<ext>     the upload as received
    source.png         prepared: RGBA, leveled, at most 3000 px
    analysis.json      measurements
    reading.json       the model's reading (or the measurements'), then the user's confirmed version
    runs/<runId>/
      run.json         mode, options, status, usage and cost, result summary
      events.jsonl     everything the browser was told, replayable
      iter-01/ …       program.js, drawing.svg, render.png, compare.png, unitcheck.png, fitcheck.png, checks.json
      result/          drawing.svg, layered.svg, layout.json, preview.png, compare.png, program.js (re-illustration),
                       clean.png, unitcheck.png, fitcheck.png (rebuild)
```

---

## 4. The MVP (this milestone)

Done means:

1. `npm start` runs it locally in one command.
2. Upload one or more PNG, JPG, WebP, TIFF or PDF files (each PDF page becomes a design).
3. Each upload is analyzed and read automatically; the reading is shown and can be corrected.
4. Rebuild runs in seconds with no model and says what it did; Re-illustrate runs the model loop
   with live progress and every iteration shown; Trace runs in seconds.
5. Review: original beside result, layers to toggle, colors to change, material looks for a
   neutral base, a page-size preview for frames (repeating, never stretched), a length preview for
   borders, a tiled preview for patterns.
6. Download: SVG, layered SVG (Illustrator and Inkscape layers), PDF (vector), PNG at a chosen
   width, and for frames and borders the fitting data as JSON.
7. Proven on three designs from the reference library: a flat repeating border (DOVB p0097:
   halves and corners averaged, 15 copies of each edge's unit, page number left out, fit check
   seamless), a shaded frame (GILL p0032: four-way averaged, five flat grays that take the
   material looks) and a full-color frame (CHAR p0038: four-way averaged; its hand-drawn roses
   vary, so they stay as drawn). Re-illustration with DeepSeek is tested end to end against a
   local stand-in for its API; a live run waits on a key.

---

## 5. Later phases

**Phase 2: more of the process**

- Stage 1: find designs in a whole scanned page (segment ink from paper, OCR masks text,
  group into designs), with duplicate detection, so one book page yields many uploads.
- Frame sets: a lighter back and a spine drawn by the same program, on the same repeat grid.
- Download a frame fitted to a chosen page size (SVG and PDF), not just the fitting data.
- Request changes: the user marks a region on the result and writes what's wrong; the note
  goes into the loop as the next critique.
- A component library (bays, chains, knots, bands, flower families) the model can call, for
  cheaper and more predictable runs on common designs, with the model writing new code only
  when a design needs it.
- Rebuild, better: snap rules and bands to straight lines and true arcs; fit a frame's
  corners from its edges' units where the scan's corner is damaged; read hatching's direction to
  draw a relief's shading as bands rather than blobs; and offer the rebuilt result as the model's
  starting point, so a cheap model refines rather than draws from nothing.
- Compare cheap vision models on the evaluation set (DeepSeek Flash, Gemini Flash on its free
  tier, a local Qwen-VL in Ollama) to choose the default by result, not price alone.
- Exact layers by boolean geometry (Paper.js or Clipper) instead of tracing, as an option.
- An evaluation set (designs with approved results) to tune prompts, effort and render
  budgets, and to catch regressions.

**Phase 3: a product**

- Hosting, accounts, storage in object storage, a Redis-backed queue (BullMQ) and horizontally
  scaled workers.
- A stronger sandbox for model-written code: a container or microVM per run (gVisor or
  Firecracker), no network, read-only root.
- Usage metering and pricing (each re-illustration costs model tokens: see the cost per run
  shown in the app; Rebuild costs nothing), quotas.
- Rights: record each upload's source and remind users to check its terms before commercial use.

---

## 6. Decisions waiting on the user

- **Hosting**: local only for now. Where should it run later?
- **Accounts and pricing**: none yet.
- **The model**: no Anthropic. DeepSeek Flash for reading and re-illustration, by its key;
  any OpenAI-compatible provider can replace it by setting.
- **The key's place**: Telios reads `DEEPSEEK_API_KEY` (or another provider's key) from the
  environment or from a `.env` file at the repository root, which is git-ignored. It is never
  written into the repository.
