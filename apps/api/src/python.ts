// Calls the Python worker (python -m telios_worker <command>) and reads the JSON it prints.

import { execFile } from 'node:child_process';
import { PYTHON, WORKER_DIR } from './config.ts';

export function python<T = any>(args: string[], timeoutMs = 5 * 60_000): Promise<T> {
  return new Promise((resolve, reject) => {
    execFile(PYTHON, ['-m', 'telios_worker', ...args], { cwd: WORKER_DIR, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }, (err, stdout, stderr) => {
      if (err) {
        const last = stderr.trim().split('\n').filter(Boolean).pop();
        return reject(new Error(last || err.message));
      }
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error(`The Python worker printed something that is not JSON: ${stdout.slice(0, 200)}`)); }
    });
  });
}
