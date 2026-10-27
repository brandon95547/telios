// The model client: any OpenAI-compatible chat API. DeepSeek is the default; Gemini, OpenAI,
// OpenRouter, a local Ollama or any other compatible endpoint work the same way. Without a model
// Telios still reads designs from their measurements, and Rebuild and Trace need none.
//
// Settings (from the shell or the git-ignored .env at the repository root):
//   DEEPSEEK_API_KEY      the key; DeepSeek is used when it is set (DEEPSEEK_MODEL, DEEPSEEK_BASE_URL optional)
//   TELIOS_PROVIDER       deepseek | gemini | openai | openrouter | ollama | custom (default: the first with a key)
//   TELIOS_MODEL          the model's name (required except for DeepSeek)
//   TELIOS_BASE_URL       the endpoint, for custom (or to override a provider's)
//   TELIOS_API_KEY        the key, for custom (or to override a provider's)

import type { Usage } from '@telios/shared';

export type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail?: 'high' | 'low' | 'auto' } };
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | Part[] }
  | { role: 'assistant'; content: string | null; reasoning_content?: string; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };
export interface Tool { type: 'function'; function: { name: string; description: string; parameters: object } }
export type Effort = 'low' | 'medium' | 'high';

interface Preset {
  label: string;
  baseUrl: string;
  keyVars: string[];
  /** The default model, where one can be named with confidence. */
  model?: string;
  /** Send the model's reasoning back with each turn (DeepSeek requires it once tools are used). */
  echoReasoning?: boolean;
  /** Per million tokens: input, output, cached input (US dollars, at the provider's higher rate). */
  prices?: [number, number, number];
}

const PRESETS: Record<string, Preset> = {
  // deepseek-flash: DeepSeek-V4.1-Flash. Peak rates; off-peak (outside 01:00–04:00 and 06:00–10:00 UTC
  // on weekdays) is half. Images are billed as input tokens.
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', keyVars: ['DEEPSEEK_API_KEY'], model: 'deepseek-flash', echoReasoning: true, prices: [0.3, 1.2, 0.006] },
  gemini: { label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'] },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', keyVars: ['OPENAI_API_KEY'] },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', keyVars: ['OPENROUTER_API_KEY'] },
  ollama: { label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', keyVars: [] },
  custom: { label: 'Model', baseUrl: '', keyVars: [] },
};

export interface Provider {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  echoReasoning: boolean;
  prices?: [number, number, number];
}

const env = (name: string) => (process.env[name] ?? '').trim();

/** The provider these settings name, or null with the reason none is set up. */
export function provider(): { provider: Provider | null; error?: string } {
  const keyOf = (p: Preset) => env('TELIOS_API_KEY') || p.keyVars.map(env).find(Boolean) || '';
  let id = env('TELIOS_PROVIDER').toLowerCase();
  if (!id) id = Object.keys(PRESETS).find((k) => PRESETS[k].keyVars.length && keyOf(PRESETS[k])) ?? (env('TELIOS_BASE_URL') ? 'custom' : '');
  if (!id || id === 'none') return { provider: null, error: 'No model is set up. Add DEEPSEEK_API_KEY to a .env file at the repository root and restart Telios. Rebuild and Trace work without one.' };
  const p = PRESETS[id];
  if (!p) return { provider: null, error: `TELIOS_PROVIDER is "${id}"; use one of ${Object.keys(PRESETS).join(', ')}.` };
  const apiKey = keyOf(p);
  const baseUrl = (env('TELIOS_BASE_URL') || (id === 'deepseek' && env('DEEPSEEK_BASE_URL')) || p.baseUrl).replace(/\/+$/, '');
  const model = env('TELIOS_MODEL') || (id === 'deepseek' && env('DEEPSEEK_MODEL')) || p.model || '';
  if (!baseUrl) return { provider: null, error: 'TELIOS_PROVIDER is custom: set TELIOS_BASE_URL (an OpenAI-compatible endpoint) and TELIOS_MODEL.' };
  if (!model) return { provider: null, error: `Set TELIOS_MODEL to the ${p.label} model to use (one that reads images).` };
  if (!apiKey && id !== 'ollama' && id !== 'custom') return { provider: null, error: `No ${p.label} key: set ${p.keyVars[0]} in .env and restart Telios.` };
  return { provider: { id, label: p.label, baseUrl, apiKey, model, echoReasoning: !!p.echoReasoning, prices: id === 'deepseek' && model.includes('pro') ? undefined : p.prices } };
}

export class LlmError extends Error {
  constructor(message: string, readonly status = 0) { super(message); }
}

export interface ChatResult {
  message: Extract<Message, { role: 'assistant' }>;
  finishReason: string;
  usage: RawUsage | null;
}

export interface RawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
}

export interface ChatOptions {
  messages: Message[];
  tools?: Tool[];
  json?: boolean;
  maxTokens: number;
  effort?: Effort;
  signal?: AbortSignal;
  /** Called as the reply streams in, with how much reasoning, text and tool input has come. */
  onProgress?: (p: { reasoning: number; text: number; toolInput: number; tool?: string }) => void;
}

const dropped = new Set<string>();   // parameters this endpoint refused, not sent again

/** One reply, streamed. Retries rate limits, overloads and dropped connections. */
export async function chat(opts: ChatOptions): Promise<ChatResult> {
  const { provider: p, error } = provider();
  if (!p) throw new LlmError(error ?? 'No model is set up.');
  for (let attempt = 0; ; attempt++) {
    const body: Record<string, unknown> = {
      model: p.model,
      messages: opts.messages,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: opts.maxTokens,
    };
    if (opts.tools?.length) body.tools = opts.tools;
    if (opts.json) body.response_format = { type: 'json_object' };
    if (opts.effort && !dropped.has('reasoning_effort')) body.reasoning_effort = opts.effort;
    if (p.id === 'deepseek' && !dropped.has('thinking')) body.thinking = { type: 'enabled' };
    const signal = AbortSignal.any([opts.signal ?? new AbortController().signal, AbortSignal.timeout(20 * 60_000)]);
    let res: Response;
    try {
      res = await fetch(`${p.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(p.apiKey && { Authorization: `Bearer ${p.apiKey}` }) },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (opts.signal?.aborted || attempt >= 4) throw e;
      await wait(attempt, null, opts.signal);
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const msg = errorMessage(text) || `${res.status} ${res.statusText}`;
      // an endpoint that doesn't know a parameter: drop it and ask again
      const unknown = ['reasoning_effort', 'thinking', 'stream_options'].find((k) => res.status === 400 && msg.includes(k) && k in body);
      if (unknown && !dropped.has(unknown)) { dropped.add(unknown); continue; }
      if ((res.status === 429 || res.status >= 500) && attempt < 4) { await wait(attempt, res.headers.get('retry-after'), opts.signal); continue; }
      throw new LlmError(res.status === 401 || res.status === 403 ? `${p.label} refused the API key (${res.status}).` : res.status === 402 ? `${p.label} says the account has no balance left (402).` : `${p.label}: ${msg}`, res.status);
    }
    try {
      return await readStream(res, opts);
    } catch (e) {
      if (opts.signal?.aborted || e instanceof LlmError || attempt >= 4) throw e;
      await wait(attempt, null, opts.signal);   // the connection dropped mid-reply: ask again
    }
  }
}

async function readStream(res: Response, opts: ChatOptions): Promise<ChatResult> {
  let content = '', reasoning = '', finishReason = '', usage: RawUsage | null = null, toolInput = 0;
  const calls: ToolCall[] = [];
  const decoder = new TextDecoder();
  let buf = '', last = 0;
  const progress = () => {
    if (!opts.onProgress || Date.now() - last < 1000) return;
    last = Date.now();
    opts.onProgress({ reasoning: reasoning.length, text: content.length, toolInput, tool: calls[calls.length - 1]?.function.name });
  };
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let ev: any;
      try { ev = JSON.parse(data); } catch { continue; }
      if (ev.error) throw new LlmError(ev.error.message ?? JSON.stringify(ev.error));
      if (ev.usage) usage = ev.usage;
      const choice = ev.choices?.[0];
      if (!choice) continue;
      const d = choice.delta ?? {};
      if (typeof d.reasoning_content === 'string') reasoning += d.reasoning_content;
      if (typeof d.content === 'string') content += d.content;
      for (const t of d.tool_calls ?? []) {
        const i = t.index ?? calls.length;
        calls[i] ??= { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (t.id) calls[i].id = t.id;
        if (t.function?.name) calls[i].function.name += t.function.name;
        if (t.function?.arguments) { calls[i].function.arguments += t.function.arguments; toolInput += t.function.arguments.length; }
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
      progress();
    }
  }
  if (!finishReason) throw new Error('The reply ended early.');
  const toolCalls = calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${i}` }));
  return {
    message: { role: 'assistant', content: content || null, ...(reasoning && { reasoning_content: reasoning }), ...(toolCalls.length && { tool_calls: toolCalls }) },
    finishReason,
    usage,
  };
}

function errorMessage(text: string) {
  try {
    const j = JSON.parse(text);
    return String(j.error?.message ?? j.message ?? j.error ?? '').slice(0, 400);
  } catch {
    return text.slice(0, 400);
  }
}

function wait(attempt: number, retryAfter: string | null, signal?: AbortSignal) {
  const ms = retryAfter && isFinite(+retryAfter) ? Math.min(60, +retryAfter) * 1000 : Math.min(30_000, 1000 * 2 ** attempt) * (0.75 + Math.random() / 2);
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason); }, { once: true });
  });
}

/** An image for a message: a JPEG as a data URL. */
export const imagePart = (jpeg: Buffer): Part => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg.toString('base64')}`, detail: 'high' } });
export const textPart = (text: string): Part => ({ type: 'text', text });

/** The assistant's turn as it goes back in the conversation: unchanged, its reasoning kept where
 * the provider requires it. */
export function asHistory(m: ChatResult['message']): Message {
  const p = provider().provider;
  if (p?.echoReasoning) return m;
  const { reasoning_content: _, ...rest } = m;
  return rest;
}

// ── Health ──

let health: { at: number; ok: boolean; provider: string; label: string; model: string; error?: string } | null = null;

/** Whether Telios can reach its model with the settings it has (checked at most every 5 minutes,
 * by listing the provider's models: no tokens are spent). */
export async function modelHealth(force = false) {
  if (health && !force && Date.now() - health.at < 5 * 60_000) return health;
  const { provider: p, error } = provider();
  if (!p) return (health = { at: Date.now(), ok: false, provider: 'none', label: 'No model', model: '', error });
  try {
    const res = await fetch(`${p.baseUrl}/models`, { headers: p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}, signal: AbortSignal.timeout(15_000) });
    if (res.status === 401 || res.status === 403) throw new Error(`${p.label} refused the API key.`);
    if (!res.ok) throw new Error(`${p.label} answered ${res.status} ${errorMessage(await res.text().catch(() => ''))}`.trim());
    health = { at: Date.now(), ok: true, provider: p.id, label: p.label, model: p.model };
  } catch (e) {
    const msg = (e as Error).name === 'TimeoutError' ? `${p.label} did not answer.` : (e as Error).message;
    health = { at: Date.now(), ok: false, provider: p.id, label: p.label, model: p.model, error: msg };
  }
  return health;
}

// ── Cost ──

export const emptyUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 });

export function addUsage(total: Usage, u: RawUsage | null | undefined) {
  if (!u) return total;
  const cached = u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0;
  const inp = Math.max(0, (u.prompt_tokens ?? 0) - cached), out = u.completion_tokens ?? 0;
  total.inputTokens += inp;
  total.outputTokens += out;
  total.cacheReadTokens += cached;
  const prices = provider().provider?.prices;
  if (prices) total.costUsd = +(total.costUsd + (inp * prices[0] + out * prices[1] + cached * prices[2]) / 1e6).toFixed(4);
  return total;
}
