// Shared visibility thresholds of the fading characters (ghost, slime, alien): below them the body is
// invisible and only a token spot stays clickable, so the overlay never blocks the desktop under nothing.
import { PIXEL_MODE_PPU } from '../character/paint';

/** hardenAlpha (pixel style) keeps a low-res pixel only at 100/255 alpha or more. */
export const PIXEL_KEEP_ALPHA = 100 / 255;
/** Normal (smooth) rendering: fainter than this the body is not visible. */
export const SMOOTH_INVISIBLE_ALPHA = 0.08;

/** The alpha below which the character counts as invisible for a render mode. */
export function invisibleBelow(pixelsPerUnit: number): number {
  return pixelsPerUnit < PIXEL_MODE_PPU ? PIXEL_KEEP_ALPHA : SMOOTH_INVISIBLE_ALPHA;
}
