#!/usr/bin/env node
// One command to run Telios: installs what's missing (npm packages, a Python virtualenv with the
// worker's packages), builds the web app if it changed, and starts the API, which serves it.
//
//   npm start            http://localhost:5178
//   npm run dev          the same with hot reload (web on http://localhost:5179)
//   npm run setup        install only

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const dev = args.has('--dev');
const say = (m) => console.log(`\x1b[36mtelios\x1b[0m ${m}`);
const run = (cmd, argv, opts = {}) => {
  const r = spawnSync(cmd, argv, { cwd: ROOT, stdio: 'inherit', ...opts });
  if (r.status !== 0) { console.error(`\n${cmd} ${argv.join(' ')} failed.`); process.exit(r.status ?? 1); }
};

const [major] = process.versions.node.split('.').map(Number);
if (major < 22) { console.error(`Telios needs Node 22 or later (this is ${process.versions.node}).`); process.exit(1); }

// npm records what it installed in node_modules/.package-lock.json: install when the lock is newer
const installed = path.join(ROOT, 'node_modules', '.package-lock.json');
if (!fs.existsSync(installed) || fs.statSync(path.join(ROOT, 'package-lock.json')).mtimeMs > fs.statSync(installed).mtimeMs) {
  say('installing npm packages…');
  run('npm', ['install', '--no-fund', '--no-audit']);
}

const venvPy = path.join(ROOT, '.venv', 'bin', 'python');
const reqs = path.join(ROOT, 'worker', 'requirements.txt');
const stamp = path.join(ROOT, '.venv', '.telios-requirements');
const reqText = fs.readFileSync(reqs, 'utf8');
if (!fs.existsSync(venvPy) || !fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8') !== reqText) {
  const py = ['python3.12', 'python3.11', 'python3.10', 'python3'].find((p) => spawnSync(p, ['-c', 'import sys; assert sys.version_info >= (3, 9)']).status === 0);
  if (!py) { console.error('Telios needs Python 3.9 or later (python3) for its image worker.'); process.exit(1); }
  if (!fs.existsSync(venvPy)) { say(`creating the Python environment (.venv, ${py})…`); run(py, ['-m', 'venv', '.venv']); }
  say('installing the Python worker\'s packages…');
  run(venvPy, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip']);
  run(venvPy, ['-m', 'pip', 'install', '--quiet', '-r', reqs]);
  fs.writeFileSync(stamp, reqText);
}

if (args.has('--setup-only')) { say('set up.'); process.exit(0); }

if (!process.env.DEEPSEEK_API_KEY && !process.env.TELIOS_PROVIDER && !fs.existsSync(path.join(ROOT, '.env'))) {
  say('no model set up: Rebuild and Trace work; re-illustration needs one (see README: "A model").');
}

const children = [];
const start = (cmd, argv, opts = {}) => {
  const c = spawn(cmd, argv, { cwd: ROOT, stdio: 'inherit', ...opts });
  children.push(c);
  c.on('exit', (code) => { if (code !== null && code !== 0) { children.forEach((k) => k.kill()); process.exit(code); } });
  return c;
};
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { children.forEach((c) => c.kill(sig)); process.exit(0); });

if (dev) {
  start(process.execPath, ['--import', 'tsx', '--watch-path=apps/api/src', '--watch-path=packages/shared/src', 'apps/api/src/server.ts']);
  start('npx', ['vite', '--port', '5179'], { cwd: path.join(ROOT, 'apps', 'web') });
  setTimeout(() => say('open http://localhost:5179'), 1500);
} else {
  const dist = path.join(ROOT, 'apps', 'web', 'dist', 'index.html');
  const newest = (dir) => fs.readdirSync(dir, { recursive: true }).map((f) => fs.statSync(path.join(dir, f)).mtimeMs).reduce((a, b) => Math.max(a, b), 0);
  const sources = Math.max(newest(path.join(ROOT, 'apps', 'web', 'src')), newest(path.join(ROOT, 'packages', 'shared', 'src')));
  if (!fs.existsSync(dist) || fs.statSync(dist).mtimeMs < sources) {
    say('building the web app…');
    run('npx', ['vite', 'build', '--logLevel', 'warn'], { cwd: path.join(ROOT, 'apps', 'web') });
  }
  start(process.execPath, ['--import', 'tsx', 'apps/api/src/server.ts']);
}
