// Runs one drawing program a model wrote, inside the sandbox process (see run.ts for how this
// process is locked down). It reads { lib, program, timeoutMs } as JSON on stdin and writes the
// drawing's result as JSON on stdout. The program runs in a fresh vm context that holds only the
// drawing library: no require, import, process, fetch, timers or host objects, and no eval. Only
// a string crosses back.
import vm from 'node:vm';

for (const name of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest', 'Request', 'Response', 'Headers', 'navigator']) {
  try { delete globalThis[name]; } catch { /* not deletable: unreachable from the context anyway */ }
}

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const { lib, program, timeoutMs = 20000 } = JSON.parse(Buffer.concat(chunks).toString('utf8'));

const reply = (obj) => process.stdout.write(JSON.stringify(obj));

try {
  const context = vm.createContext({}, { name: 'drawing', codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate' });
  new vm.Script(lib, { filename: 'drawlib.js' }).runInContext(context, { timeout: timeoutMs });
  new vm.Script(program, { filename: 'program.js' }).runInContext(context, { timeout: timeoutMs });
  const out = new vm.Script(
    `(() => {
      if (typeof draw !== 'function') throw new Error('The program must define a function draw() that returns { svg, palette, layout }.');
      const r = draw();
      if (!r || typeof r !== 'object') throw new Error('draw() must return an object { svg, palette, layout }.');
      return JSON.stringify({ svg: String(r.svg ?? ''), palette: r.palette ?? null, layout: r.layout ?? null, logs: __logs.slice(0, 50) });
    })()`,
    { filename: 'run.js' },
  ).runInContext(context, { timeout: timeoutMs });
  if (typeof out !== 'string') throw new Error('draw() returned something that is not JSON');
  process.stdout.write('{"ok":true,"result":');
  process.stdout.write(out);
  process.stdout.write('}');
} catch (e) {
  // errors thrown inside the context are the context's own objects: read them as plain strings
  let message = 'Error', stack = '';
  try { message = String(e && e.message !== undefined ? e.message : e); } catch { /* keep the default */ }
  try { stack = String(e && e.stack ? e.stack : ''); } catch { /* none */ }
  reply({ ok: false, error: message, stack: stack.split('\n').filter((l) => /program\.js|drawlib\.js/.test(l)).slice(0, 6).join('\n') });
}
