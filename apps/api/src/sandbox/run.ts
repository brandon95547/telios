// The sandbox for code a model writes. Each drawing program runs in its own short-lived Node
// process, never in the API's or the job worker's:
//
// - Node's permission model is on: the process may read only the runner itself; no file writes,
//   no child processes, no worker threads, no native addons, no inspector.
// - Its environment is empty (no API key, no paths), its working directory an empty folder.
// - Memory is capped and the process is killed after a hard timeout; its output is capped.
// - On macOS it runs under sandbox-exec with networking and file writes denied.
// - Inside, the program runs in a vm context with only the drawing library, string code
//   generation off (runner.mjs).
//
// What comes back is data: the SVG text, its palette and layout, which svg.ts then checks against
// an allowlist before anything renders it.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(HERE, 'runner.mjs');
const LIB = fs.readFileSync(path.join(HERE, '..', 'engine', 'drawlib.js'), 'utf8');
const EMPTY = fs.mkdtempSync(path.join(os.tmpdir(), 'telios-sandbox-'));
const MAX_OUT = 40 * 1024 * 1024;

const SEATBELT = `(version 1)
(allow default)
(deny network*)
(deny file-write*)
(allow file-write-data (literal "/dev/null"))`;

const useSeatbelt = process.platform === 'darwin' && fs.existsSync('/usr/bin/sandbox-exec');

export interface ProgramOutput {
  svg: string;
  palette: unknown;
  layout: unknown;
  logs: string[];
}

export type SandboxResult = { ok: true; output: ProgramOutput; ms: number } | { ok: false; error: string; ms: number };

export function drawlibSource() {
  return LIB;
}

export function runProgram(program: string, { timeoutMs = 20000 } = {}): Promise<SandboxResult> {
  const started = Date.now();
  const nodeArgs = [
    '--permission',
    `--allow-fs-read=${RUNNER}`,
    '--max-old-space-size=768',
    '--disallow-code-generation-from-strings',
    '--no-warnings',
    RUNNER,
  ];
  const [cmd, args] = useSeatbelt
    ? ['/usr/bin/sandbox-exec', ['-p', SEATBELT, process.execPath, ...nodeArgs]]
    : [process.execPath, nodeArgs];
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: EMPTY, env: {}, stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let size = 0, err = '', done = false;
    const finish = (r: SandboxResult) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ ok: false, error: `The program took longer than ${Math.round((timeoutMs + 5000) / 1000)} seconds and was stopped. Look for an endless loop or far too many shapes.`, ms: Date.now() - started });
    }, timeoutMs + 5000);
    child.stdout.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_OUT) {
        child.kill('SIGKILL');
        finish({ ok: false, error: 'The drawing came out larger than 40 MB of SVG. Draw fewer, simpler shapes (repeat with <use>, mirror with transforms).', ms: Date.now() - started });
        return;
      }
      out.push(c);
    });
    child.stderr.on('data', (c: Buffer) => { if (err.length < 4000) err += c.toString(); });
    child.on('error', (e) => finish({ ok: false, error: `The sandbox could not start: ${e.message}`, ms: Date.now() - started }));
    child.on('close', (code, signal) => {
      const text = Buffer.concat(out).toString('utf8');
      let parsed: { ok: boolean; result?: ProgramOutput; error?: string; stack?: string } | null = null;
      try { parsed = JSON.parse(text); } catch { /* reported below */ }
      if (parsed?.ok && parsed.result) return finish({ ok: true, output: parsed.result, ms: Date.now() - started });
      if (parsed && !parsed.ok) return finish({ ok: false, error: `${parsed.error}${parsed.stack ? `\n${parsed.stack}` : ''}`, ms: Date.now() - started });
      const oom = /heap out of memory|Allocation failed/i.test(err);
      finish({ ok: false, error: oom ? 'The program ran out of memory (768 MB).' : `The program stopped (${signal ?? `exit ${code}`}). ${err.slice(-1500)}`.trim(), ms: Date.now() - started });
    });
    child.stdin.end(JSON.stringify({ lib: LIB, program, timeoutMs }));
  });
}
