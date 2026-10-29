import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..', '..');

// The API key (and any other setting) may live in a git-ignored .env at the repository root.
// It is read by the API and the job worker only; the sandbox gets an empty environment.
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

export const DATA = path.resolve(process.env.TELIOS_DATA ?? path.join(ROOT, 'data'));
export const PYTHON = process.env.TELIOS_PYTHON ?? path.join(ROOT, '.venv', 'bin', 'python');
export const WORKER_DIR = path.join(ROOT, 'worker');
export const WEB_DIST = path.join(ROOT, 'apps', 'web', 'dist');
export const PORT = Number(process.env.PORT ?? 5178);

// The model (provider, name, key) is set in engine/llm.ts from DEEPSEEK_API_KEY or TELIOS_PROVIDER.
export const DRAW_EFFORT = (['low', 'medium', 'high'].includes(process.env.TELIOS_EFFORT ?? '') ? process.env.TELIOS_EFFORT : 'high') as 'low' | 'medium' | 'high';
export const MAX_RENDERS = Number(process.env.TELIOS_MAX_RENDERS ?? 8);
/** Re-illustration runs at once; each is mostly waiting on the model. */
export const DRAW_CONCURRENCY = Number(process.env.TELIOS_DRAW_CONCURRENCY ?? 2);
export const TRACE = 2;   // tracing-copy pixels per design unit

// ComfyUI, which redraws pictures for Restyle (comfy/client.ts). With COMFYUI_API_URL set, Telios
// uses the ComfyUI behind a Phansora API (its gateway, a Talari route) and installs nothing:
// COMFYUI_API_TOKEN is the API's token for the account it calls as. Without it, Telios has its
// own ComfyUI at COMFYUI_URL, which `npm start` installs, fills with models and starts when that
// is left unset (scripts/comfyui.mjs).
export const COMFYUI_API_URL = (process.env.COMFYUI_API_URL ?? '').trim().replace(/\/+$/, '');
export const COMFYUI_API_TOKEN = (process.env.COMFYUI_API_TOKEN ?? '').trim();
export const COMFYUI_URL = ((process.env.COMFYUI_URL ?? '').trim() || 'http://127.0.0.1:8189').replace(/\/+$/, '');
/** The model files Telios's own ComfyUI draws with (the gateway names its own). */
export const FLUX = {
  unet: process.env.FLUX_UNET_FILE || `flux1-dev-${process.env.FLUX_QUANT || 'Q4_K_S'}.gguf`,
  t5: process.env.FLUX_T5_FILE || 't5xxl_fp8_e4m3fn.safetensors',
  clipL: process.env.FLUX_CLIP_L_FILE || 'clip_l.safetensors',
  vae: process.env.FLUX_VAE_FILE || 'ae.safetensors',
  guidance: Number(process.env.FLUX_GUIDANCE ?? 3.5),
  sampler: process.env.COMFYUI_SAMPLER || 'euler',
  scheduler: process.env.COMFYUI_SCHEDULER || 'simple',
  easycache: Number(process.env.FLUX_EASYCACHE ?? 0.2),
};

// Signing in, for a Telios on a public address: required once an account exists or
// TELIOS_SETUP_CODE is set (the code the first visit asks for, to make the account).
export const SETUP_CODE = (process.env.TELIOS_SETUP_CODE ?? '').trim();
export const HOST = process.env.HOST ?? '127.0.0.1';

for (const dir of ['designs', 'restyle/inputs', 'restyle/results']) fs.mkdirSync(path.join(DATA, dir), { recursive: true });
