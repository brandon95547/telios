// The zoom of the input preview: how large a picture is drawn, as steps of "fit" (the whole picture in the window) up to a
// limit of real pixels, so a small picture can be looked at as it is and a large one close up.

export const ZOOM_STEP = 1.25;
/** The most a picture is drawn at, as a multiple of its own pixels. */
export const MAX_SCALE = 8;
/** The least, as a share of the window it would fit in. */
export const MIN_ZOOM = 0.25;

/** The scale (drawn size over the picture's own pixels) at which the whole picture fits the window: never above 1, so a small picture is
 * not blown up to look soft before the person asks. */
export function fitScale(natural: [number, number], box: [number, number]): number {
  if (!natural[0] || !natural[1] || !box[0] || !box[1]) return 1;
  return Math.min(1, box[0] / natural[0], box[1] / natural[1]);
}

/** A zoom (a multiple of fit) kept to what can be drawn: not past MAX_SCALE of the picture's own pixels, nor under MIN_ZOOM of fit. */
export function clampZoom(zoom: number, fit: number): number {
  const most = fit > 0 ? MAX_SCALE / fit : 1;
  return Math.min(Math.max(zoom, MIN_ZOOM), Math.max(most, 1));
}

/** One step in or out from a zoom (1 steps to ZOOM_STEP and back, rounded so stepping out again lands on 1). */
export function stepZoom(zoom: number, direction: 1 | -1, fit: number): number {
  const next = direction > 0 ? zoom * ZOOM_STEP : zoom / ZOOM_STEP;
  return clampZoom(Math.abs(next - 1) < 0.02 ? 1 : next, fit);
}

/** The size the picture is drawn at, in pixels. */
export function drawnSize(natural: [number, number], fit: number, zoom: number): [number, number] {
  const scale = fit * zoom;
  return [Math.round(natural[0] * scale), Math.round(natural[1] * scale)];
}

/** The zoom as the person reads it: the share of the picture's own pixels it is drawn at. */
export const zoomLabel = (fit: number, zoom: number) => `${Math.round(fit * zoom * 100)}%`;
