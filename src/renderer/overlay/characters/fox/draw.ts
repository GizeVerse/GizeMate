// The fox painter: two-pass outline-then-fill, flat fills, white chest/cheeks/muzzle, dark socks, big
// ears with dark backs, a bushy white-tipped brush. Allocation-free (module scratch buffers); fine detail
// only at pixelsPerUnit >= FINE_DETAIL_PPU, a simplified, thicker silhouette in pixel mode.
import type { CatAccessory } from '../../../../shared/cat';
import { clamp, clamp01, drawBlobShadow, drawPendantBetween, fillShape, isFineDetail, isPixelMode, lerp, strokeOutline, TAU, traceClosedSpline, type Ctx2D } from '../../character/kit';
import { LEG_BF, LEG_BN, LEG_FF, LEG_FN, type Pose } from './pose';
import { LEG_SPECS, PAW_RX, PAW_RY, TORSO_POINTS, type LegGeom, type Rig } from './rig';
import type { FoxSkin } from './skins';
import { type FoxTail, TAIL_POINTS, TAIL_TIP_FROM } from './tail';

export interface FoxDrawOptions {
  outline: number;
  shadow: boolean;
  pixelsPerUnit: number;
  accessory?: CatAccessory | undefined;
}

const DASH_NONE: number[] = [];

/** Head outline in head-local DIP (facing right, profile), closed Catmull-Rom: the upper face, snout and cheek ruff. */
export const HEAD_SHAPE = new Float64Array([
  -2, -9.2, 5, -8.4, 10.5, -5, 17, -2.2, 22.2, -0.2, 23.2, 2, 20.5, 3.8, 14, 4.6, 9, 5.6, 5.5, 9.2, -0.5, 11.6, -7, 13.6, -9.2, 8, -10.8, 0.5, -9.4, -6,
]);
export const HEAD_POINTS = HEAD_SHAPE.length / 2;
/** The lower jaw (hinge at JAW_HX, JAW_HY): closed it sits just under the upper lip, hidden behind the face. */
const JAW_HX = 8.5;
const JAW_HY = 4.6;
export const JAW_SHAPE = new Float64Array([8.5, 3.4, 20.6, 3.6, 21, 5.8, 17, 8.4, 9, 9.6, 6.5, 7.5]);
const JAW_POINTS = JAW_SHAPE.length / 2;
/** Ears: base 1, base 2, tip (head-local, upright). */
export const EAR_FAR_SRC = [-8.4, -6.4, 1.2, -8.8, -5.4, -24.6] as const;
export const EAR_NEAR_SRC = [-2.2, -8.8, 8.6, -6.6, 3.4, -25.4] as const;

const tailPts = new Float64Array(TAIL_POINTS * 4);
const tailCx = new Float64Array(TAIL_POINTS);
const tailCy = new Float64Array(TAIL_POINTS);
const tailNx = new Float64Array(TAIL_POINTS);
const tailNy = new Float64Array(TAIL_POINTS);
const tailTx = new Float64Array(TAIL_POINTS);
const tailTy = new Float64Array(TAIL_POINTS);
const jawPts = new Float64Array(JAW_SHAPE.length);
const earA = new Float64Array(6);
const earB = new Float64Array(6);

/** Result of headPoint (module scratch; read right after the call). */
export const HP = { x: 0, y: 0 };

/** Maps a head-local point to the character-local frame (inside the pose matrix). */
export function headPoint(rig: Pick<Rig, 'headX' | 'headY' | 'headRot' | 'headFlip'>, lx: number, ly: number): void {
  const f = rig.headFlip < 0 ? -1 : 1;
  const c = Math.cos(rig.headRot);
  const s = Math.sin(rig.headRot);
  const y = ly * f;
  HP.x = rig.headX + lx * c + y * s;
  HP.y = rig.headY - lx * s + y * c;
}

/** Ear triangle corners in head-local space for a rotation (+ = backwards) and flatness. */
export function earGeom(src: readonly number[], rot: number, flat: number, out: Float64Array): void {
  const f = clamp01(flat);
  const cx = (src[0]! + src[2]!) / 2;
  const cy = (src[1]! + src[3]!) / 2;
  const tx = src[4]! - cx;
  const ty = src[5]! - cy;
  const a = clamp(rot, -0.8, 1.4) + f * 0.95;
  const k = 1 - 0.32 * f;
  const c = Math.cos(a);
  const s = Math.sin(a);
  out[0] = src[0]!;
  out[1] = src[1]! + 1.4 * f;
  out[2] = src[2]!;
  out[3] = src[3]! + 1.4 * f;
  out[4] = cx + (tx * c + ty * s) * k;
  out[5] = cy + (-tx * s + ty * c) * k;
}

let pixelMode = false;

export function drawFox(ctx: Ctx2D, rig: Rig, p: Pose, tail: FoxTail, skin: FoxSkin, o: FoxDrawOptions): void {
  const ol = o.outline;
  const fine = isFineDetail(o.pixelsPerUnit);
  pixelMode = isPixelMode(o.pixelsPerUnit);

  if (o.shadow) drawFoxShadow(ctx, rig, p);

  ctx.save();
  const m = rig.m;
  ctx.transform(m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(DASH_NONE);

  if (skin.halo !== null && !pixelMode) drawHalo(ctx, rig, p, tail, skin.halo, ol);

  // Far legs behind everything.
  ctx.strokeStyle = skin.outline;
  legOutline(ctx, rig.legs[LEG_FF]!, LEG_FF, ol);
  legOutline(ctx, rig.legs[LEG_BF]!, LEG_BF, ol);
  legFill(ctx, rig.legs[LEG_FF]!, LEG_FF, skin.shade, skin);
  legFill(ctx, rig.legs[LEG_BF]!, LEG_BF, skin.shade, skin);

  if (!tail.front && !tail.over) drawTail(ctx, tail, skin, ol, fine);

  // Body group outline (torso, neck, near legs, haunch), then the fills.
  ctx.strokeStyle = skin.outline;
  traceTorso(ctx, rig);
  strokeOutline(ctx, skin.outline, ol);
  limbStrokeRound(ctx, rig.nx0, rig.ny0, rig.nx1, rig.ny1, rig.neckW + ol * 2, skin.outline);
  legOutline(ctx, rig.legs[LEG_FN]!, LEG_FN, ol);
  traceHaunch(ctx, rig);
  strokeOutline(ctx, skin.outline, ol);
  legOutline(ctx, rig.legs[LEG_BN]!, LEG_BN, ol);

  traceTorso(ctx, rig);
  fillShape(ctx, skin.coat);
  limbStrokeRound(ctx, rig.nx0, rig.ny0, rig.nx1, rig.ny1, rig.neckW, skin.coat);
  legFill(ctx, rig.legs[LEG_FN]!, LEG_FN, skin.coat, skin);
  legFill(ctx, rig.legs[LEG_BN]!, LEG_BN, skin.coat, skin);
  traceHaunch(ctx, rig);
  fillShape(ctx, skin.coat);
  haunchContour(ctx, rig, p, skin, ol);
  torsoMarks(ctx, rig, p, skin, fine);
  throatMark(ctx, rig, skin);

  // A raised near paw (groom, swat, scratch) is re-drawn in front of the chest with its own outline.
  nearLegOnTop(ctx, rig, LEG_FN, skin, ol);
  nearLegOnTop(ctx, rig, LEG_BN, skin, ol);

  // Accessory: after torso, neck and legs, before the head (the chin overlaps the collar). With the tail in
  // front the pendant is drawn after the tail instead (never twice), so the tail never covers the heart.
  const wearing = o.accessory === 'heartPendant';
  if (wearing && !tail.front && !tail.over) drawPendant(ctx, rig, skin, ol, o.pixelsPerUnit);
  if (tail.front) {
    drawTail(ctx, tail, skin, ol, fine);
    if (wearing) drawPendant(ctx, rig, skin, ol, o.pixelsPerUnit);
  }

  drawHead(ctx, rig, p, skin, ol, fine);
  if (tail.over) {
    drawTail(ctx, tail, skin, ol, fine);
    if (wearing) drawPendant(ctx, rig, skin, ol, o.pixelsPerUnit);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Shadow, halo, pendant

/** Soft ground shadow under the body (drawn in the view transform, outside the pose matrix). */
export function drawFoxShadow(ctx: Ctx2D, rig: Rig, p: Pose): void {
  const k = clamp(p.shadow, 0, 1.5);
  if (k <= 0.01) return;
  const m = rig.m;
  const cx = m[0]! * rig.bodyX + m[4]!;
  const air = clamp01(-p.offY / 14);
  const curl = clamp01(p.curl);
  const w = 30 * k * (1 - 0.35 * air) * (1 - 0.18 * curl) * Math.abs(m[0]!) + 4;
  const h = 4.2 * k * (1 - 0.3 * air) + 0.8;
  drawBlobShadow(ctx, cx, -0.6, w, h, 0.2 * Math.min(1, k) * (1 - 0.5 * air));
}

/** Extent of the shadow for measure(): an upper bound of drawFoxShadow (no airborne shrink). */
export function shadowExtent(rig: Rig, p: Pose, out: { cx: number; half: number; rh: number }): void {
  const k = clamp(p.shadow, 0, 1.5);
  const m = rig.m;
  out.cx = m[0]! * rig.bodyX + m[4]!;
  out.half = 30 * k * Math.abs(m[0]!) + 4;
  out.rh = 4.2 * k + 0.8;
}

function drawHalo(ctx: Ctx2D, rig: Rig, p: Pose, tail: FoxTail, color: string, ol: number): void {
  const w = ol * 2 + 2.8;
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  traceTorso(ctx, rig);
  ctx.stroke();
  traceHaunch(ctx, rig);
  ctx.stroke();
  limbStrokeRound(ctx, rig.nx0, rig.ny0, rig.nx1, rig.ny1, rig.neckW + w, color);
  for (let i = 0; i < 4; i++) legStrokes(ctx, rig.legs[i]!, i, w, color, color);
  traceTailPath(ctx, tail);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.stroke();
  ctx.save();
  ctx.translate(rig.headX, rig.headY);
  ctx.rotate(-rig.headRot);
  if (rig.headFlip !== 1) ctx.scale(1, clamp(rig.headFlip, -1, 1));
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  traceHead(ctx);
  ctx.stroke();
  earGeom(EAR_FAR_SRC, p.earFR, p.earFF, earA);
  traceEar(ctx, earA, 0);
  ctx.stroke();
  earGeom(EAR_NEAR_SRC, p.earNR, p.earNF, earB);
  traceEar(ctx, earB, 0);
  ctx.stroke();
  ctx.restore();
}

/** The shared heart pendant at the neck: a collar across the neck, the heart hanging towards the world's down. */
function drawPendant(ctx: Ctx2D, rig: Rig, skin: FoxSkin, ol: number, ppu: number): void {
  const t = 0.62;
  const nx = rig.nx0 + (rig.nx1 - rig.nx0) * t;
  const ny = rig.ny0 + (rig.ny1 - rig.ny0) * t;
  let dx = rig.nx1 - rig.nx0;
  let dy = rig.ny1 - rig.ny0;
  const len = Math.hypot(dx, dy);
  if (len > 1e-6) {
    dx /= len;
    dy /= len;
  } else {
    dx = 0.5;
    dy = -0.8;
  }
  const px = -dy;
  const py = dx;
  const half = rig.neckW * 0.5 - 0.4;
  const m = rig.m;
  const det = m[0]! * m[3]! - m[1]! * m[2]!;
  let hx = 0;
  let hy = 1;
  if (Math.abs(det) > 1e-4) {
    hx = -m[2]! / det;
    hy = m[0]! / det;
  }
  // A neck near the ground (sleeping, loafing) gets a smaller heart: it never hangs through the floor.
  const viewY = m[1]! * nx + m[3]! * ny + m[5]!;
  const room = -viewY - 2;
  const scale = clamp(room / 15.5 * 0.95, 0.4, 0.95);
  drawPendantBetween(ctx, nx - px * half, ny - py * half, nx + px * half, ny + py * half, hx, hy, scale, skin.outline, ol, ppu, skin.pendant);
}

// ---------------------------------------------------------------------------------------------
// Torso, neck, legs

function traceTorso(ctx: Ctx2D, rig: Rig): void {
  ctx.beginPath();
  traceClosedSpline(ctx, rig.torso, TORSO_POINTS);
}

function traceHaunch(ctx: Ctx2D, rig: Rig): void {
  ctx.beginPath();
  ctx.ellipse(rig.hx, rig.hy, Math.max(0.5, rig.hrx), Math.max(0.5, rig.hry), rig.hrot, 0, TAU);
}

function limbStrokeRound(ctx: Ctx2D, x0: number, y0: number, x1: number, y1: number, width: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.1, width);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

/** Strokes both segments of a leg in the given colours (upper, lower) with `extra` added to the width. */
function legStrokes(ctx: Ctx2D, g: LegGeom, i: number, extra: number, upper: string, lower: string): void {
  const spec = LEG_SPECS[i]!;
  ctx.lineWidth = spec.w1 + extra;
  ctx.strokeStyle = upper;
  ctx.beginPath();
  ctx.moveTo(g.rx, g.ry);
  ctx.lineTo(g.kx, g.ky);
  ctx.stroke();
  ctx.lineWidth = spec.w2 + extra;
  ctx.strokeStyle = lower;
  ctx.beginPath();
  ctx.moveTo(g.kx, g.ky);
  ctx.lineTo(g.fx, g.fy);
  ctx.stroke();
}

const paw = { x: 0, y: 0 };
function pawCenter(g: LegGeom): void {
  const c = Math.cos(g.paw);
  const s = Math.sin(g.paw);
  paw.x = g.fx + 1.5 * c;
  paw.y = g.fy + 1.5 * s - PAW_RY * 0.7 * c;
}

function legOutline(ctx: Ctx2D, g: LegGeom, i: number, ol: number): void {
  const spec = LEG_SPECS[i]!;
  const col = ctx.strokeStyle as string;
  legStrokes(ctx, g, i, ol * 2, col, col);
  pawCenter(g);
  ctx.beginPath();
  ctx.ellipse(paw.x, paw.y, PAW_RX * (spec.front ? 1 : 1.05), PAW_RY, g.paw, 0, TAU);
  ctx.lineWidth = ol * 2;
  ctx.strokeStyle = col;
  ctx.stroke();
}

function legFill(ctx: Ctx2D, g: LegGeom, i: number, upper: string, skin: FoxSkin): void {
  const spec = LEG_SPECS[i]!;
  legStrokes(ctx, g, i, 0, upper, skin.sock);
  ctx.fillStyle = skin.sock;
  ctx.beginPath();
  ctx.arc(g.kx, g.ky, spec.w2 * 0.5, 0, TAU);
  ctx.fill();
  pawCenter(g);
  ctx.beginPath();
  ctx.ellipse(paw.x, paw.y, PAW_RX * (spec.front ? 1 : 1.05), PAW_RY, g.paw, 0, TAU);
  ctx.fillStyle = skin.sock;
  ctx.fill();
}

function nearLegOnTop(ctx: Ctx2D, rig: Rig, i: number, skin: FoxSkin, ol: number): void {
  const g = rig.legs[i]!;
  const lift = clamp01((-g.fy - 5) / 8);
  if (lift <= 0.02) return;
  const a = ctx.globalAlpha;
  ctx.globalAlpha = a * lift;
  ctx.strokeStyle = skin.outline;
  legOutline(ctx, g, i, ol);
  legFill(ctx, g, i, skin.coat, skin);
  ctx.fillStyle = skin.coat;
  ctx.beginPath();
  ctx.arc(g.rx, g.ry, LEG_SPECS[i]!.w1 * 0.6, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = a;
}

/** A soft contour along the front edge of the haunch, stronger when sitting. */
function haunchContour(ctx: Ctx2D, rig: Rig, p: Pose, skin: FoxSkin, ol: number): void {
  const a0 = ctx.globalAlpha;
  ctx.globalAlpha = a0 * (0.2 + 0.7 * clamp01(p.haunch));
  ctx.strokeStyle = skin.outline;
  ctx.lineWidth = ol * 1.1;
  ctx.beginPath();
  ctx.ellipse(rig.hx, rig.hy, Math.max(0.5, rig.hrx), Math.max(0.5, rig.hry), rig.hrot, -1.75, lerp(0.55, 1.25, clamp01(p.haunch)));
  ctx.stroke();
  ctx.globalAlpha = a0;
}

function torsoMarks(ctx: Ctx2D, rig: Rig, p: Pose, skin: FoxSkin, fine: boolean): void {
  ctx.save();
  traceTorso(ctx, rig);
  ctx.clip();
  const tp = rig.torso;
  const T = rig.T;
  const rot = -Math.atan2(rig.sin, rig.cos);
  // The cream underside and the white chest bib: one shape built from the torso's own control points
  // (so nothing reaches outside the body), closed over the flank by a soft curve.
  ctx.fillStyle = skin.light;
  ctx.beginPath();
  ctx.moveTo(tp[10]!, tp[11]!);
  for (let i = 6; i <= 10; i++) ctx.lineTo(tp[i * 2]!, tp[i * 2 + 1]!);
  ctx.lineTo(rig.tx(-0.78, 0.36), rig.ty(-0.78, 0.36));
  ctx.quadraticCurveTo(rig.tx(0.1, 0.12), rig.ty(0.1, 0.12), rig.tx(0.62, 0.06), rig.ty(0.62, 0.06));
  ctx.closePath();
  ctx.fill();
  if (fine) {
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * 0.55;
    ctx.fillStyle = skin.saddle;
    ctx.beginPath();
    ctx.ellipse(rig.tx(-0.15, -0.8), rig.ty(-0.15, -0.8), rig.L * 0.8, T * 0.3 * (1 + 0.3 * clamp01(p.arch)), rot, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = a;
  }
  ctx.restore();
}

/** The white throat stripe along the lower front edge of the neck. */
function throatMark(ctx: Ctx2D, rig: Rig, skin: FoxSkin): void {
  let dx = rig.nx1 - rig.nx0;
  let dy = rig.ny1 - rig.ny0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) return;
  dx /= len;
  dy /= len;
  const off = rig.neckW * 0.22;
  const nx = -dy * off;
  const ny = dx * off;
  limbStrokeRound(ctx, rig.nx0 + nx + dx * 3, rig.ny0 + ny + dy * 3, rig.nx1 + nx * 1.1, rig.ny1 + ny * 1.1, rig.neckW * 0.5, skin.light);
}

// ---------------------------------------------------------------------------------------------
// Tail

function buildTail(tail: FoxTail): void {
  const n = TAIL_POINTS;
  for (let i = 0; i < n; i++) {
    tailCx[i] = tail.x[i]!;
    tailCy[i] = tail.y[i]!;
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    let tx = tail.x[b]! - tail.x[a]!;
    let ty = tail.y[b]! - tail.y[a]!;
    const l = Math.hypot(tx, ty);
    if (l > 1e-6) {
      tx /= l;
      ty /= l;
    } else {
      tx = -1;
      ty = 0;
    }
    tailTx[i] = tx;
    tailTy[i] = ty;
    tailNx[i] = -ty;
    tailNy[i] = tx;
    const r = tail.radius(i);
    tailPts[i * 2] = tailCx[i]! + tailNx[i]! * r;
    tailPts[i * 2 + 1] = tailCy[i]! + tailNy[i]! * r;
    const j = (2 * n - 1 - i) * 2;
    tailPts[j] = tailCx[i]! - tailNx[i]! * r;
    tailPts[j + 1] = tailCy[i]! - tailNy[i]! * r;
  }
}

function traceTailPath(ctx: Ctx2D, tail: FoxTail): void {
  buildTail(tail);
  ctx.beginPath();
  traceClosedSpline(ctx, tailPts, TAIL_POINTS * 2);
}

function drawTail(ctx: Ctx2D, tail: FoxTail, skin: FoxSkin, ol: number, fine: boolean): void {
  traceTailPath(ctx, tail);
  strokeOutline(ctx, skin.outline, ol);
  fillShape(ctx, skin.coat);
  // The white tip, cut with two soft teeth, clipped to the brush.
  ctx.save();
  traceTailPath(ctx, tail);
  ctx.clip();
  const k = TAIL_TIP_FROM;
  const e = TAIL_POINTS - 1;
  const R = tail.radius(k) + 2;
  const cx = tailCx[k]!;
  const cy = tailCy[k]!;
  const nx = tailNx[k]!;
  const ny = tailNy[k]!;
  const tx = tailTx[k]!;
  const ty = tailTy[k]!;
  ctx.beginPath();
  ctx.moveTo(cx + nx * R, cy + ny * R);
  ctx.lineTo(cx + nx * R * 0.5 - tx * 2.8, cy + ny * R * 0.5 - ty * 2.8);
  ctx.lineTo(cx + tx * 0.8, cy + ty * 0.8);
  ctx.lineTo(cx - nx * R * 0.5 - tx * 2.8, cy - ny * R * 0.5 - ty * 2.8);
  ctx.lineTo(cx - nx * R, cy - ny * R);
  // Down the far side of the brush (a hair outside it: the clip trims the excess), round the tip, back up the near side.
  for (let i = k + 1; i <= e; i++) ctx.lineTo(tailCx[i]! - tailNx[i]! * (tail.radius(i) + 2), tailCy[i]! - tailNy[i]! * (tail.radius(i) + 2));
  ctx.lineTo(tailCx[e]! + tailTx[e]! * 3, tailCy[e]! + tailTy[e]! * 3);
  for (let i = e; i > k; i--) ctx.lineTo(tailCx[i]! + tailNx[i]! * (tail.radius(i) + 2), tailCy[i]! + tailNy[i]! * (tail.radius(i) + 2));
  ctx.closePath();
  ctx.fillStyle = skin.tailTip;
  ctx.fill();
  if (fine) {
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * 0.5;
    ctx.strokeStyle = skin.saddle;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (let i = 1; i < k; i++) {
      const r = tail.radius(i) * 0.55;
      const x = tailCx[i]! - tailNx[i]! * r;
      const y = tailCy[i]! - tailNy[i]! * r;
      if (i === 1) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = a;
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Head

function traceHead(ctx: Ctx2D): void {
  ctx.beginPath();
  traceClosedSpline(ctx, HEAD_SHAPE, HEAD_POINTS);
}

function traceEar(ctx: Ctx2D, e: Float64Array, shrink: number): void {
  let x0 = e[0]!;
  let y0 = e[1]!;
  let x1 = e[2]!;
  let y1 = e[3]!;
  let x2 = e[4]!;
  let y2 = e[5]!;
  if (shrink > 0) {
    const cx = (x0 + x1 + x2) / 3;
    const cy = (y0 + y1 + y2) / 3 + 1.6;
    x0 = lerp(x0, cx, shrink);
    y0 = lerp(y0, cy, shrink);
    x1 = lerp(x1, cx, shrink);
    y1 = lerp(y1, cy, shrink);
    x2 = lerp(x2, cx, shrink);
    y2 = lerp(y2, cy, shrink);
  }
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo((x0 + x2) / 2 - 0.9, (y0 + y2) / 2 + 0.5, x2, y2);
  ctx.quadraticCurveTo((x1 + x2) / 2 + 0.9, (y1 + y2) / 2 + 0.5, x1, y1);
  ctx.closePath();
}

function drawEar(ctx: Ctx2D, e: Float64Array, color: string, inner: string, innerAlpha: number, ol: number, outlined: boolean, skin: FoxSkin): void {
  if (outlined) {
    traceEar(ctx, e, 0);
    strokeOutline(ctx, skin.outline, ol);
  }
  traceEar(ctx, e, 0);
  fillShape(ctx, color);
  if (innerAlpha > 0.03) {
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * innerAlpha;
    traceEar(ctx, e, 0.42);
    fillShape(ctx, inner);
    ctx.globalAlpha = a;
  }
}

function drawHead(ctx: Ctx2D, rig: Rig, p: Pose, skin: FoxSkin, ol: number, fine: boolean): void {
  ctx.save();
  ctx.translate(rig.headX, rig.headY);
  ctx.rotate(-rig.headRot);
  const flip = clamp(rig.headFlip, -1, 1);
  if (flip !== 1) ctx.scale(1, flip);

  // Far ear behind the head.
  earGeom(EAR_FAR_SRC, p.earFR, p.earFF, earA);
  drawEar(ctx, earA, skin.earDark, skin.earInner, 0.7 * (1 - 0.6 * clamp01(p.earFF)), ol, true, skin);

  // Lower jaw (behind the face), with the dark mouth wedge when open.
  const open = clamp01(p.mouthOpen);
  const ja = open * 0.62;
  const jc = Math.cos(ja);
  const js = Math.sin(ja);
  for (let i = 0; i < JAW_POINTS; i++) {
    const x = JAW_SHAPE[i * 2]! - JAW_HX;
    const y = JAW_SHAPE[i * 2 + 1]! - JAW_HY;
    jawPts[i * 2] = JAW_HX + x * jc - y * js;
    jawPts[i * 2 + 1] = JAW_HY + x * js + y * jc;
  }
  if (open > 0.04) {
    ctx.beginPath();
    ctx.moveTo(JAW_HX - 1, JAW_HY - 2);
    ctx.lineTo(21.6, 2.4);
    ctx.lineTo(jawPts[2]! + 0.4, jawPts[3]! - 0.2);
    ctx.lineTo(JAW_HX + 1, JAW_HY + 3.4);
    ctx.closePath();
    ctx.strokeStyle = skin.outline;
    ctx.lineWidth = ol * 2;
    ctx.stroke();
    ctx.fillStyle = skin.mouth;
    ctx.fill();
  }
  ctx.beginPath();
  traceClosedSpline(ctx, jawPts, JAW_POINTS);
  strokeOutline(ctx, skin.outline, ol);
  fillShape(ctx, skin.light);
  if (open > 0.3 && p.tongue > 0.02) {
    ctx.fillStyle = skin.tongue;
    ctx.beginPath();
    ctx.ellipse(jawPts[2]! * 0.62 + JAW_HX * 0.38, jawPts[3]! * 0.62 + JAW_HY * 0.38 - 0.4, 5.2 * (0.6 + 0.4 * p.tongue), 1.5 + 1.4 * p.tongue, ja * 0.8, 0, TAU);
    ctx.fill();
  }

  // Head: outline, fill, then the white cheeks and muzzle clipped to it.
  traceHead(ctx);
  strokeOutline(ctx, skin.outline, ol);
  traceHead(ctx);
  fillShape(ctx, skin.coat);
  ctx.save();
  traceHead(ctx);
  ctx.clip();
  ctx.fillStyle = skin.light;
  ctx.beginPath();
  // The white lower face, built from the head outline's own points so nothing reaches outside the head.
  ctx.moveTo(22.6, 1.1);
  ctx.bezierCurveTo(19, 0.8, 14, 0.4, 9.4, 1.8);
  ctx.bezierCurveTo(5, 3.2, 0, 2, -5, 5);
  ctx.lineTo(-9.6, 7.6);
  ctx.lineTo(-7, 13.4);
  ctx.lineTo(-0.5, 11.5);
  ctx.lineTo(5.5, 9.1);
  ctx.lineTo(9, 5.5);
  ctx.lineTo(14, 4.5);
  ctx.lineTo(20.5, 3.7);
  ctx.lineTo(23, 2);
  ctx.closePath();
  ctx.fill();
  if (fine) {
    ctx.strokeStyle = skin.earDark;
    ctx.lineWidth = 1.1;
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * 0.55;
    ctx.beginPath();
    ctx.moveTo(10.2, -1.2);
    ctx.quadraticCurveTo(12.5, 1.2, 14.5, 2.6);
    ctx.stroke();
    ctx.globalAlpha = a;
  }
  ctx.restore();

  // Near ear in front.
  earGeom(EAR_NEAR_SRC, p.earNR, p.earNF, earB);
  traceEar(ctx, earB, 0);
  strokeOutline(ctx, skin.outline, ol);
  drawEar(ctx, earB, skin.earDark, skin.earInner, 0.85 * (1 - 0.6 * clamp01(p.earNF)), ol, false, skin);
  // The roots of the ears blend into the head (a patch of coat over them).
  ctx.fillStyle = skin.coat;
  ctx.beginPath();
  ctx.ellipse(-0.5, -7.5, 7, 2.2, -0.12, 0, TAU);
  ctx.fill();

  drawFace(ctx, p, skin, ol, fine);
  ctx.restore();
}

function drawFace(ctx: Ctx2D, p: Pose, skin: FoxSkin, ol: number, fine: boolean): void {
  const lw = Math.max(0.9, ol * 0.75);
  ctx.fillStyle = skin.nose;
  ctx.beginPath();
  ctx.ellipse(21.4, 0.9, 2.9, 2.3, -0.2, 0, TAU);
  ctx.fill();
  if (fine) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.ellipse(20.6, 0.1, 0.9, 0.5, -0.3, 0, TAU);
    ctx.fill();
  }
  if (clamp01(p.mouthOpen) < 0.1) {
    ctx.strokeStyle = skin.outline;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(20, 3.5);
    ctx.quadraticCurveTo(14, 5.8, 9.8, 4.4);
    ctx.stroke();
  }
  drawEye(ctx, 9.2, -3.9, p, skin, lw);
}

function drawEye(ctx: Ctx2D, cx: number, cy: number, p: Pose, skin: FoxSkin, lw: number): void {
  const open = clamp01(p.eyeOpen * (1 - 0.3 * clamp01(p.eyeSquint)));
  const happy = clamp01(p.eyeHappy);
  if (happy > 0.5) {
    ctx.strokeStyle = skin.eye;
    ctx.lineWidth = lw * 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy + 1.6, 2.7, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
    return;
  }
  if (open < 0.14) {
    ctx.strokeStyle = skin.eye;
    ctx.lineWidth = lw * 1.3;
    ctx.beginPath();
    ctx.moveTo(cx - 2.6, cy + 0.8);
    ctx.quadraticCurveTo(cx, cy + 2.1, cx + 2.6, cy + 0.2);
    ctx.stroke();
    return;
  }
  const ry = 3.1 * open;
  ctx.fillStyle = skin.eye;
  ctx.beginPath();
  ctx.ellipse(cx, cy + (3.1 - ry) * 0.5, 2.6, Math.max(0.8, ry), -0.22, 0, TAU);
  ctx.fill();
  if (open > 0.4) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx + 0.7 + p.pupilX * 0.7, cy - 1 + p.pupilY * 0.6, pixelMode ? 1.1 : 0.9, 0, TAU);
    ctx.fill();
  }
  if (clamp01(p.eyeSquint) > 0.3) {
    ctx.strokeStyle = skin.outline;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(cx - 2.8, cy - 1.8 + p.eyeSquint * 1.2);
    ctx.lineTo(cx + 2.8, cy - 2.6 + p.eyeSquint * 1.2);
    ctx.stroke();
  }
}
