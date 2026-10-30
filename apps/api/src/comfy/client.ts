// ComfyUI, two ways, one interface: through a Phansora API's gateway when COMFYUI_API_URL is set
// (that server's ComfyUI and its models; Telios installs nothing), or Telios's own ComfyUI at
// COMFYUI_URL. Either way Telios builds the workflow (workflows.ts), sends it with the pictures it
// loads, and gets back the picture it saves; the results are kept here, never there.

import { COMFYUI_API_TOKEN, COMFYUI_API_URL, COMFYUI_URL, FLUX } from '../config.ts';
import { USO } from './workflows.ts';

export type Workflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

export interface FluxFiles {
  unet: string;
  t5: string;
  clipL: string;
  vae: string;
  guidance: number;
  sampler: string;
  scheduler: string;
  easycache: number;
}

export interface ComfyInfo {
  /** api: a Phansora API's gateway; local: Telios's own ComfyUI. */
  via: 'api' | 'local';
  ready: boolean;
  detail: string;
  flux: FluxFiles | null;
  /** Upscaling model files ComfyUI has (4x-UltraSharp…). */
  upscalers: string[];
  /** The background removal model file, if ComfyUI has one. */
  backgroundRemoval: string | null;
  /** Whether ComfyUI can draw from a style picture: USO's three files and its node are there. */
  styleReference: boolean;
}

export interface Comfy {
  info(force?: boolean): Promise<ComfyInfo>;
  /** Run a workflow with the pictures its LoadImage nodes name; the picture it saves (PNG). */
  run(workflow: Workflow, images: Record<string, Buffer>, signal?: AbortSignal): Promise<Buffer>;
}

export class ComfyError extends Error {}

const RUN_TIMEOUT = 15 * 60_000;

/** The account a Phansora API token acts as: v1.<user>.<expiry>.<signature>. */
export function tokenUser(token: string) {
  const parts = token.split('.');
  return parts.length === 4 && parts[0] === 'v1' && /^[A-Za-z0-9_-]{1,64}$/.test(parts[1]) ? parts[1] : null;
}

async function failure(res: Response, what: string) {
  const body = await res.text().catch(() => '');
  let detail = '';
  try { detail = JSON.parse(body).detail ?? JSON.parse(body).error?.message ?? ''; } catch { detail = body.slice(0, 300); }
  return new ComfyError(`${what} (${res.status})${detail ? `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}

// ── Through a Phansora API ──

export function gatewayClient(base: string, token: string): Comfy {
  const user = tokenUser(token);
  const url = `${base}/users/${user}/comfyui`;
  const headers = { Authorization: `Bearer ${token}` };
  let cached: { at: number; info: ComfyInfo } | null = null;
  return {
    async info(force = false) {
      if (cached && !force && Date.now() - cached.at < 30_000) return cached.info;
      let info: ComfyInfo;
      if (!user) info = { via: 'api', ready: false, detail: 'COMFYUI_API_TOKEN is not a Phansora API token.', flux: null, upscalers: [], backgroundRemoval: null, styleReference: false };
      else {
        try {
          const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
          if (!res.ok) throw await failure(res, 'The Phansora API refused');
          const body = await res.json();
          info = { via: 'api', ready: !!body.ready && !!body.flux, detail: body.flux ? body.detail : body.detail || 'The API does not draw with FLUX.', flux: body.flux, upscalers: body.upscalers ?? [], backgroundRemoval: body.backgroundRemoval ?? null, styleReference: body.styleReference === true };
        } catch (e) {
          info = { via: 'api', ready: false, detail: (e as Error).name === 'TimeoutError' ? 'The Phansora API did not answer.' : (e as Error).message, flux: null, upscalers: [], backgroundRemoval: null, styleReference: false };
        }
      }
      cached = { at: Date.now(), info };
      return info;
    },
    async run(workflow, images, signal) {
      const res = await fetch(`${url}/run`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow, images: Object.fromEntries(Object.entries(images).map(([k, v]) => [k, v.toString('base64')])) }),
        signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(RUN_TIMEOUT)]),
      });
      if (!res.ok) throw await failure(res, 'ComfyUI could not draw it');
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

// ── Telios's own ComfyUI ──

/** The choices ComfyUI offers for one input of a node (the model files it has), or null without the node. */
function choices(info: any, node: string, field: string): string[] | null {
  if (!info?.[node]) return null;
  const spec = info[node]?.input?.required?.[field];
  if (Array.isArray(spec?.[0])) return spec[0];
  if (spec?.[1]?.options) return spec[1].options;   // newer ComfyUI: ["COMBO", { options }]
  return [];
}

export function localClient(base: string, files: FluxFiles = FLUX): Comfy {
  let cached: { at: number; info: ComfyInfo } | null = null;
  const get = async (path: string, timeout = 15_000) => {
    const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(timeout) });
    if (!res.ok) throw await failure(res, `ComfyUI answered ${path}`);
    return res.json();
  };
  const objectInfo = async (node: string) => get(`/object_info/${node}`).catch(() => ({}));
  return {
    async info(force = false) {
      if (cached && !force && Date.now() - cached.at < 30_000) return cached.info;
      const info: ComfyInfo = { via: 'local', ready: false, detail: '', flux: null, upscalers: [], backgroundRemoval: null, styleReference: false };
      try {
        await get('/system_stats', 5000);
        const gguf = files.unet.endsWith('.gguf');
        const unets = choices(await objectInfo(gguf ? 'UnetLoaderGGUF' : 'UNETLoader'), gguf ? 'UnetLoaderGGUF' : 'UNETLoader', 'unet_name');
        const encoders = choices(await objectInfo('DualCLIPLoader'), 'DualCLIPLoader', 'clip_name1') ?? [];
        const vaes = choices(await objectInfo('VAELoader'), 'VAELoader', 'vae_name') ?? [];
        const missing = [[files.unet, unets ?? []], [files.t5, encoders], [files.clipL, encoders], [files.vae, vaes]].filter(([f, have]) => !(have as string[]).includes(f as string)).map(([f]) => f);
        info.upscalers = choices(await objectInfo('UpscaleModelLoader'), 'UpscaleModelLoader', 'model_name') ?? [];
        const removal = choices(await objectInfo('LoadBackgroundRemovalModel'), 'LoadBackgroundRemovalModel', 'bg_removal_name') ?? [];
        info.backgroundRemoval = removal[0] ?? null;
        const have = [
          [USO.lora, choices(await objectInfo('LoraLoaderModelOnly'), 'LoraLoaderModelOnly', 'lora_name')],
          [USO.projector, choices(await objectInfo('ModelPatchLoader'), 'ModelPatchLoader', 'name')],
          [USO.vision, choices(await objectInfo('CLIPVisionLoader'), 'CLIPVisionLoader', 'clip_name')],
        ] as const;
        info.styleReference = !!(await objectInfo('USOStyleReference'))?.USOStyleReference && have.every(([file, files]) => !!files?.includes(file));
        if (gguf && unets === null) info.detail = 'ComfyUI is missing the GGUF loader (the ComfyUI-GGUF custom node).';
        else if (missing.length) info.detail = `ComfyUI does not have ${missing.join(', ')} yet (still downloading?).`;
        else { info.ready = true; info.flux = files; }
      } catch (e) {
        info.detail = `ComfyUI is not reachable at ${base}${(e as Error).name === 'TimeoutError' ? '' : ` (${(e as Error).message})`}.`;
      }
      cached = { at: Date.now(), info };
      return info;
    },
    async run(workflow, images, signal) {
      const stop = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(RUN_TIMEOUT)]);
      const names: Record<string, string> = {};
      for (const [name, data] of Object.entries(images)) {
        const form = new FormData();
        form.append('image', new Blob([new Uint8Array(data)], { type: 'image/png' }), `telios-${crypto.randomUUID()}-${name}`);
        form.append('type', 'input');
        form.append('overwrite', 'true');
        const res = await fetch(`${base}/upload/image`, { method: 'POST', body: form, signal: stop });
        if (!res.ok) throw await failure(res, 'ComfyUI would not take the picture');
        const up = await res.json();
        names[name] = up.subfolder ? `${up.subfolder}/${up.name}` : up.name;
      }
      const prompt: Workflow = {};
      for (const [key, node] of Object.entries(workflow)) {
        const inputs = { ...node.inputs };
        if (node.class_type === 'LoadImage') inputs.image = names[String(inputs.image)] ?? inputs.image;
        prompt[key] = { class_type: node.class_type, inputs };
      }
      try {
        const queued = await fetch(`${base}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, client_id: crypto.randomUUID() }), signal: stop });
        if (!queued.ok) throw await failure(queued, 'ComfyUI rejected the workflow');
        const { prompt_id: id } = await queued.json();
        for (;;) {
          stop.throwIfAborted();
          const history = (await get(`/history/${id}`).catch(() => ({})))[id];
          if (history?.status?.status_str === 'error') {
            const err = (history.status.messages ?? []).find((m: any) => m[0] === 'execution_error')?.[1];
            throw new ComfyError(`ComfyUI failed${err ? ` in ${err.node_type}: ${err.exception_message}` : ''}.`);
          }
          const image = Object.values<any>(history?.outputs ?? {}).flatMap((o) => o.images ?? []).find((i: any) => i.type !== 'temp');
          if (image) {
            const q = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder ?? '', type: image.type ?? 'output' });
            const res = await fetch(`${base}/view?${q}`, { signal: stop });
            if (!res.ok) throw await failure(res, 'ComfyUI drew the picture but it could not be downloaded');
            return Buffer.from(await res.arrayBuffer());
          }
          if (history?.status?.completed) throw new ComfyError('ComfyUI finished without a picture.');
          await new Promise((r) => setTimeout(r, 1000));
        }
      } finally {
        // hand the GPU back: the models move to RAM, and come back in seconds for the next picture
        fetch(`${base}/free`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unload_models: true }) }).catch(() => {});
      }
    },
  };
}

let instance: Comfy | null = null;
/** The ComfyUI these settings name. */
export function comfy(): Comfy {
  return (instance ??= COMFYUI_API_URL ? gatewayClient(COMFYUI_API_URL, COMFYUI_API_TOKEN) : localClient(COMFYUI_URL));
}
