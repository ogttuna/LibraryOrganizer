export type ReaderZoom = number | 'fit-width' | 'fit-page';
export type Size = { width: number; height: number };
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3;
export const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];

export function readerScale(zoom: ReaderZoom, space: Size, page: Size) {
  if (typeof zoom === 'number') return zoom;
  if (space.width <= 0 || space.height <= 0 || page.width <= 0 || page.height <= 0) return 1;
  const widthScale = space.width / page.width;
  return zoom === 'fit-width' ? widthScale : Math.min(widthScale, space.height / page.height);
}

export function stepZoom(current: number, direction: -1 | 1) {
  return Math.min(
    MAX_ZOOM,
    Math.max(MIN_ZOOM, Math.round((current + direction * 0.25) * 1000) / 1000),
  );
}
