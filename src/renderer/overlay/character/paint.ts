// Painting helpers shared by every procedural character (extracted from the cat's painter, behaviour
// unchanged). Allocation-free; only the Canvas 2D context they are given.
import type { Ctx2D } from '../cat/draw';

/** Traces a closed Catmull-Rom spline through `n` interleaved x,y points as cubic segments. */
export function traceClosedSpline(ctx: Ctx2D, pts: Float64Array, n: number): void {
  ctx.moveTo(pts[0]!, pts[1]!);
  for (let i = 0; i < n; i++) {
    const i0 = ((i - 1 + n) % n) * 2;
    const i1 = i * 2;
    const i2 = ((i + 1) % n) * 2;
    const i3 = ((i + 2) % n) * 2;
    const c1x = pts[i1]! + (pts[i2]! - pts[i0]!) / 6;
    const c1y = pts[i1 + 1]! + (pts[i2 + 1]! - pts[i0 + 1]!) / 6;
    const c2x = pts[i2]! - (pts[i3]! - pts[i1]!) / 6;
    const c2y = pts[i2 + 1]! - (pts[i3 + 1]! - pts[i1 + 1]!) / 6;
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, pts[i2]!, pts[i2 + 1]!);
  }
  ctx.closePath();
}

/** One straight limb segment as a stroked line of `width` in `color`. */
export function limbStroke(ctx: Ctx2D, x0: number, y0: number, x1: number, y1: number, width: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.1, width);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

/**
 * Outline-then-fill for the path already traced on `ctx`: strokes it `outlineWidth * 2` wide in
 * `outline` (so overlapping parts of one group merge into a single exterior outline when every
 * member is outlined first) and, when `fill` is given, fills it. Callers outline the whole group,
 * then fill the whole group.
 */
export function strokeOutline(ctx: Ctx2D, outline: string, outlineWidth: number): void {
  ctx.strokeStyle = outline;
  ctx.lineWidth = Math.max(0.1, outlineWidth * 2);
  ctx.stroke();
}

export function fillShape(ctx: Ctx2D, fill: string): void {
  ctx.fillStyle = fill;
  ctx.fill();
}

/** A soft elliptical ground shadow at (cx, groundY) in view-local units; alpha is the peak opacity. */
export function drawBlobShadow(ctx: Ctx2D, cx: number, groundY: number, halfW: number, halfH: number, alpha: number): void {
  if (!(alpha > 0.002) || !(halfW > 0) || !(halfH > 0)) return;
  ctx.save();
  ctx.globalAlpha *= Math.min(1, alpha);
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(cx, groundY, halfW, halfH, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Pixel style: make every low-res pixel either opaque or transparent for crisp edges. */
export function hardenAlpha(ctx: Ctx2D, w: number, h: number): void {
  let img: ImageData;
  try {
    img = ctx.getImageData(0, 0, w, h);
  } catch {
    return;
  }
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i]! >= 100 ? 255 : 0;
  ctx.putImageData(img, 0, 0);
}

/** True when a painter should drop fine detail (device pixels per unit below this). */
export const PIXEL_MODE_PPU = 0.6;
export const isPixelMode = (pixelsPerUnit: number): boolean => pixelsPerUnit < PIXEL_MODE_PPU;
/** Device pixels per unit at/above which painters may add fine detail (fur strokes, highlights). */
export const FINE_DETAIL_PPU = 0.9;
export const isFineDetail = (pixelsPerUnit: number): boolean => pixelsPerUnit >= FINE_DETAIL_PPU;
/** One device pixel in local units (the minimum visible stroke), guarded against a zero scale. */
export const unitPx = (pixelsPerUnit: number): number => 1 / Math.max(1e-3, pixelsPerUnit);
