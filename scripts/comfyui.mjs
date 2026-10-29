#!/usr/bin/env node
// Telios's own ComfyUI, for a Telios that runs standalone: no COMFYUI_API_URL (a Phansora API's
// ComfyUI) and no COMFYUI_URL (one already running). `npm start` calls this; on its own it only
// installs.
//
//   node scripts/comfyui.mjs     install ComfyUI into comfyui/ and fetch its models (~12 GB, once)
//
// ComfyUI and its GGUF loader are pinned (COMFYUI_REF, COMFYUI_GGUF_REF), in their own Python
// environment (comfyui/.venv), with PyTorch for CUDA when the machine has an NVIDIA GPU and the
// plain build otherwise (Apple silicon draws with Metal, slowly). The models are fetched by
// docker/comfyui/fetch_models.py, the same as the Docker image's. TELIOS_COMFYUI_DIR moves it.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIR = path.resolve(process.env.TELIOS_COMFYUI_DIR ?? path.join(ROOT, 'comfyui'));
export const PORT = 8189;
const COMFYUI_REF = process.env.COMFYUI_REF ?? 'v0.39.0';
const GGUF_REF = process.env.COMFYUI_GGUF_REF ?? '6ea2651e7df66d7585f6ffee804b20e92fb38b8a';
const say = (m) => console.log(`\x1b[35mcomfyui\x1b[0m ${m}`);
const run = (cmd, argv, opts = {}) => {
  const r = spawnSync(cmd, argv, { stdio: 'inherit', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(' ')} failed`);
};

function fetchTar(url, into) {
  fs.mkdirSync(into, { recursive: true });
  run('sh', ['-c', `curl -fsSL "${url}" | tar -xz --strip-components=1 -C "${into}"`]);
}

/** ComfyUI installed and its models fetched; nothing is done twice. */
export function ensureComfyUI() {
  const app = path.join(DIR, 'app');
  const py = path.join(DIR, '.venv', 'bin', 'python');
  const stamp = path.join(DIR, '.installed');
  const want = `${COMFYUI_REF} ${GGUF_REF}`;
  if (!fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8') !== want) {
    say(`installing ComfyUI ${COMFYUI_REF} with its GGUF loader into ${path.relative(ROOT, DIR) || DIR}…`);
    fs.rmSync(app, { recursive: true, force: true });
    fetchTar(`https://github.com/Comfy-Org/ComfyUI/archive/${COMFYUI_REF}.tar.gz`, app);
    fetchTar(`https://github.com/city96/ComfyUI-GGUF/archive/${GGUF_REF}.tar.gz`, path.join(app, 'custom_nodes', 'ComfyUI-GGUF'));
    const python = ['python3.12', 'python3.11', 'python3.10'].find((p) => spawnSync(p, ['--version']).status === 0);
    if (!python) throw new Error('ComfyUI needs Python 3.10 to 3.12.');
    if (!fs.existsSync(py)) run(python, ['-m', 'venv', path.join(DIR, '.venv')]);
    run(py, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip']);
    const nvidia = spawnSync('nvidia-smi', ['-L']).status === 0;
    say(`installing PyTorch${nvidia ? ' for CUDA' : ''}…`);
    run(py, ['-m', 'pip', 'install', '--quiet', 'torch', 'torchvision', 'torchaudio', ...(nvidia ? ['--index-url', 'https://download.pytorch.org/whl/cu126'] : [])]);
    run(py, ['-m', 'pip', 'install', '--quiet', '-r', path.join(app, 'requirements.txt'), '-r', path.join(app, 'custom_nodes', 'ComfyUI-GGUF', 'requirements.txt')]);
    fs.writeFileSync(stamp, want);
  }
  say('checking its model files (about 12 GB the first time)…');
  run(py, [path.join(ROOT, 'docker', 'comfyui', 'fetch_models.py')], { env: { ...process.env, COMFYUI_MODELS_DIR: path.join(DIR, 'models') } });
}

/** ComfyUI running on 127.0.0.1:8189, its pictures kept under comfyui/data. */
export function startComfyUI() {
  const data = path.join(DIR, 'data');
  for (const d of ['output', 'input', 'temp', 'user']) fs.mkdirSync(path.join(data, d), { recursive: true });
  return spawn(path.join(DIR, '.venv', 'bin', 'python'), [
    path.join(DIR, 'app', 'main.py'), '--listen', '127.0.0.1', '--port', String(PORT), '--disable-auto-launch',
    '--extra-model-paths-config', writeModelPaths(),
    '--output-directory', path.join(data, 'output'), '--input-directory', path.join(data, 'input'),
    '--temp-directory', path.join(data, 'temp'), '--user-directory', path.join(data, 'user'),
  ], { stdio: 'inherit' });
}

// The models live in comfyui/models, beside the install rather than inside it, so reinstalling
// ComfyUI keeps them.
function writeModelPaths() {
  const file = path.join(DIR, 'extra_model_paths.yaml');
  const models = path.join(DIR, 'models');
  fs.writeFileSync(file, `telios:\n  base_path: ${models}\n${['diffusion_models', 'text_encoders', 'vae', 'background_removal', 'upscale_models'].map((f) => `  ${f}: ${f}/`).join('\n')}\n`);
  return file;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { ensureComfyUI(); say('ready.'); } catch (e) { console.error(e.message); process.exit(1); }
}
