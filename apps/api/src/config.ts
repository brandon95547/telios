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

fs.mkdirSync(path.join(DATA, 'designs'), { recursive: true });
