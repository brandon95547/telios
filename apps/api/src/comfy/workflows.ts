// The ComfyUI workflows Restyle runs, built here so a Phansora API's gateway and Telios's own
// ComfyUI run the same ones. Core ComfyUI nodes, and ComfyUI-GGUF's loader for a .gguf model.

import type { FluxFiles, Workflow } from './client.ts';

/** Width and height with a square's pixel area at this shape, in FLUX's 16-pixel steps. */
export function drawSize(aspect: number, side: number): [number, number] {
  const snap = (v: number) => Math.max(256, Math.min(2048, Math.round(v / 16) * 16));
  const w = Math.sqrt(side * side * aspect);
  return [snap(w), snap(w / aspect)];
}

/** Image-to-image with FLUX.1 Dev: the picture (`source.png`) redrawn from `denoise` of the way. */
export function restyleWorkflow(f: FluxFiles, o: { prompt: string; width: number; height: number; steps: number; denoise: number; seed: number }): Workflow {
  const gguf = f.unet.endsWith('.gguf');
  const w: Workflow = {
    '1': gguf ? { class_type: 'UnetLoaderGGUF', inputs: { unet_name: f.unet } } : { class_type: 'UNETLoader', inputs: { unet_name: f.unet, weight_dtype: 'default' } },
    '2': { class_type: 'DualCLIPLoader', inputs: { clip_name1: f.t5, clip_name2: f.clipL, type: 'flux' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: f.vae } },
    '4': { class_type: 'CLIPTextEncode', inputs: { text: o.prompt, clip: ['2', 0] } },
    // FLUX.1 Dev is guidance-distilled: cfg 1, an empty negative, the prompt's weight set here
    '5': { class_type: 'FluxGuidance', inputs: { conditioning: ['4', 0], guidance: f.guidance } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['2', 0] } },
    '20': { class_type: 'LoadImage', inputs: { image: 'source.png' } },
    '21': { class_type: 'ImageScale', inputs: { image: ['20', 0], upscale_method: 'lanczos', width: o.width, height: o.height, crop: 'center' } },
    '7': { class_type: 'VAEEncode', inputs: { pixels: ['21', 0], vae: ['3', 0] } },
    '8': {
      class_type: 'KSampler',
      inputs: { model: ['1', 0], positive: ['5', 0], negative: ['6', 0], latent_image: ['7', 0], seed: o.seed, steps: o.steps, cfg: 1, sampler_name: f.sampler, scheduler: f.scheduler, denoise: o.denoise },
    },
    '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 0] } },
    '10': { class_type: 'SaveImage', inputs: { images: ['9', 0], filename_prefix: 'telios' } },
  };
  if (f.easycache > 0) {
    // skips steps that would barely change the picture (built into ComfyUI)
    w['12'] = { class_type: 'EasyCache', inputs: { model: ['1', 0], reuse_threshold: f.easycache, start_percent: 0.15, end_percent: 0.95, verbose: false } };
    w['8'].inputs.model = ['12', 0];
  }
  return w;
}

/** The mask of a picture's subject (white kept, black cut away), by ComfyUI's background removal. */
export const cutoutWorkflow = (model: string): Workflow => ({
  '1': { class_type: 'LoadImage', inputs: { image: 'picture.png' } },
  '2': { class_type: 'LoadBackgroundRemovalModel', inputs: { bg_removal_name: model } },
  '3': { class_type: 'RemoveBackground', inputs: { bg_removal_model: ['2', 0], image: ['1', 0] } },
  '4': { class_type: 'MaskToImage', inputs: { mask: ['3', 0] } },
  '9': { class_type: 'SaveImage', inputs: { images: ['4', 0], filename_prefix: 'telios-cutout' } },
});

/** A picture enlarged 4× by an upscaling model (in tiles), then scaled to `scale` of its size. */
export function upscaleWorkflow(model: string, scale: number): Workflow {
  const w: Workflow = {
    '1': { class_type: 'LoadImage', inputs: { image: 'picture.png' } },
    '2': { class_type: 'UpscaleModelLoader', inputs: { model_name: model } },
    '3': { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['2', 0], image: ['1', 0] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['3', 0], filename_prefix: 'telios-upscale' } },
  };
  if (scale < 4) {
    w['4'] = { class_type: 'ImageScaleBy', inputs: { image: ['3', 0], upscale_method: 'lanczos', scale_by: scale / 4 } };
    w['9'].inputs.images = ['4', 0];
  }
  return w;
}
