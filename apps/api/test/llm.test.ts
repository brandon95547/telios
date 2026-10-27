import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { addUsage, asHistory, chat, emptyUsage, provider } from '../src/engine/llm.ts';

// A stand-in for an OpenAI-compatible chat API: each test sets how it answers.
let answer: (body: any, n: number) => { status?: number; chunks?: object[]; error?: string } = () => ({ chunks: [] });
let requests: any[] = [];
let server: http.Server;

before(async () => {
  server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const body = JSON.parse(raw || '{}');
    requests.push(body);
    const a = answer(body, requests.length);
    if (a.status && a.status !== 200) {
      res.writeHead(a.status, { 'content-type': 'application/json', 'retry-after': '0' });
      return res.end(JSON.stringify({ error: { message: a.error ?? 'error' } }));
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const c of a.chunks ?? []) res.write(`data: ${JSON.stringify(c)}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  process.env.TELIOS_PROVIDER = 'custom';
  process.env.TELIOS_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  process.env.TELIOS_MODEL = 'test-model';
});
after(() => { server.close(); });
beforeEach(() => { requests = []; });

const delta = (d: object, finish: string | null = null) => ({ choices: [{ index: 0, delta: d, finish_reason: finish }] });

test('a streamed reply is put back together: reasoning, text, tool calls in pieces, usage', async () => {
  answer = () => ({
    chunks: [
      delta({ reasoning_content: 'Look at ' }),
      delta({ reasoning_content: 'the corners.' }),
      delta({ content: 'Drawing now.' }),
      delta({ tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'draw', arguments: '{"program":' } }] }),
      delta({ tool_calls: [{ index: 0, function: { arguments: '"function draw(){}","notes":"first"}' } }] }),
      delta({}, 'tool_calls'),
      { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 200, prompt_cache_hit_tokens: 800 } },
    ],
  });
  const r = await chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 100, effort: 'high' });
  assert.equal(r.finishReason, 'tool_calls');
  assert.equal(r.message.content, 'Drawing now.');
  assert.equal(r.message.reasoning_content, 'Look at the corners.');
  assert.deepEqual(JSON.parse(r.message.tool_calls![0].function.arguments), { program: 'function draw(){}', notes: 'first' });
  assert.equal(r.message.tool_calls![0].id, 'call_a');
  const u = addUsage(emptyUsage(), r.usage);
  assert.deepEqual([u.inputTokens, u.cacheReadTokens, u.outputTokens], [200, 800, 200]);
  assert.equal(requests[0].model, 'test-model');
  assert.equal(requests[0].stream, true);
  assert.equal(requests[0].reasoning_effort, 'high');
});

test('rate limits and overloads are retried', async () => {
  answer = (_, n) => (n === 1 ? { status: 429, error: 'slow down' } : { chunks: [delta({ content: 'ok' }, 'stop')] });
  const r = await chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 10 });
  assert.equal(r.message.content, 'ok');
  assert.equal(requests.length, 2);
});

test('a parameter the endpoint refuses is dropped and the request sent again', async () => {
  answer = (body) => ('reasoning_effort' in body ? { status: 400, error: 'Unrecognized request argument supplied: reasoning_effort' } : { chunks: [delta({ content: 'fine' }, 'stop')] });
  const r = await chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 10, effort: 'low' });
  assert.equal(r.message.content, 'fine');
  assert.ok(!('reasoning_effort' in requests[requests.length - 1]));
});

test('a refused key says so plainly and is not retried', async () => {
  answer = () => ({ status: 401, error: 'Authentication Fails' });
  await assert.rejects(chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 10 }), /refused the API key/);
  assert.equal(requests.length, 1);
});

test('DeepSeek is the default when its key is set, and its reasoning goes back with each turn', () => {
  const saved = { ...process.env };
  try {
    for (const k of ['TELIOS_PROVIDER', 'TELIOS_BASE_URL', 'TELIOS_MODEL', 'TELIOS_API_KEY', 'DEEPSEEK_API_KEY', 'DEEPSEEK_MODEL', 'DEEPSEEK_BASE_URL', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY']) delete process.env[k];
    const none = provider();
    assert.equal(none.provider, null);
    assert.match(none.error!, /DEEPSEEK_API_KEY/);
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    const p = provider().provider!;
    assert.deepEqual([p.id, p.baseUrl, p.model], ['deepseek', 'https://api.deepseek.com', 'deepseek-flash']);
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';
    assert.equal(provider().provider!.model, 'deepseek-v4-flash');
    const turn = { role: 'assistant' as const, content: null, reasoning_content: 'why', tool_calls: [] };
    assert.equal((asHistory(turn) as any).reasoning_content, 'why');
    process.env.TELIOS_PROVIDER = 'gemini';
    process.env.GEMINI_API_KEY = 'g-test';
    assert.match(provider().error!, /TELIOS_MODEL/);
    process.env.TELIOS_MODEL = 'some-gemini';
    assert.equal(provider().provider!.baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
    assert.equal((asHistory(turn) as any).reasoning_content, undefined);
  } finally {
    process.env = saved;
  }
});
