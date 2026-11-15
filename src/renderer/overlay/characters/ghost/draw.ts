// Ghost: painter. Two-pass language like the rest of the roster: the outline of the whole group
// first (here only the part outside the sheet, so the translucent fill never shows it through), then
// the fills, then the face. The body is gently translucent and fades towards the hem by stacking
// a few clipped layers (no gradient objects, no per-frame allocation).
import { drawBlobShadow, drawPendantBetween, isFineDetail, isPixelMode, limbStroke, TAU, traceClosedSpline, type Ctx2D } from '../../character/kit';
import type { DrawParams } from '../../character/types';
import { getGhostPalette } from './palette';
import type { GhostPose } from './pose';
import { BODY_N, type GhostRig } from './rig';

const BIG = 400;
export const SPARKLE_COUNT = 5;

export interface SparkleSpot {
  x: number;
  y: number;
  /** Half size of the star. */
  s: number;
  /** 0..1 twinkle opacity. */
  a: number;
}

/** Sparkle i around the sheet's centre (positions identical in every render mode so bounds are a superset). */
export function sparkleAt(rig: GhostRig, i: number, phase: number, out: SparkleSpot): void {
  const cx = (rig.topX + rig.hemX) / 2;
  const cy = (rig.topY + rig.hemY) / 2;
  const ang = phase * 0.12 + (i * TAU) / SPARKLE_COUNT;
  const r = 30 + 8 * Math.sin(phase * 0.14 + i * 1.7);
  out.x = cx + Math.cos(ang) * r;
  out.y = cy + Math.sin(ang) * r * 1.1;
  const w = Math.sin(phase * 0.3 + i * 2.1);
  out.s = 2.6 + 2 * w * w;
  out.a = 0.55 + 0.45 * Math.sin(phase * 0.35 + i * 1.9);
}

const spot: SparkleSpot = { x: 0, y: 0, s: 0, a: 0 };

export function drawGhostShadow(ctx: Ctx2D, rig: GhostRig): void {
  drawBlobShadow(ctx, rig.shadowX, 0, rig.shadowHalf, rig.shadowRh, rig.shadowAlpha);
}

function traceBody(ctx: Ctx2D, rig: GhostRig): void {
  ctx.beginPath();
  traceClosedSpline(ctx, rig.pts, BODY_N);
}

function star(ctx: Ctx2D, x: number, y: number, s: number): void {
  const k = s * 0.2;
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.quadraticCurveTo(x + k, y - k, x + s, y);
  ctx.quadraticCurveTo(x + k, y + k, x, y + s);
  ctx.quadraticCurveTo(x - k, y + k, x - s, y);
  ctx.quadraticCurveTo(x - k, y - k, x, y - s);
  ctx.closePath();
}

export function drawGhost(ctx: Ctx2D, rig: GhostRig, p: GhostPose, o: DrawParams, sparklePhase: number): void {
  const pal = getGhostPalette(o.skin);
  const ppu = Number.isFinite(o.pixelsPerUnit) && o.pixelsPerUnit > 0 ? o.pixelsPerUnit : 1;
  const pixel = isPixelMode(ppu);
  const fine = isFineDetail(ppu);
  const ol = Math.max(0.3, Number.isFinite(o.outline) ? o.outline : 1.6);
  if (o.shadow) drawGhostShadow(ctx, rig);

  const outer = ctx.globalAlpha;
  const base = outer * p.alpha * p.vis;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (base > 0.01) {
    // Pale glow rings (sleep pulse, startle and boo flare).
    if (p.glow > 0.02 && !pixel) {
      ctx.strokeStyle = pal.glow;
      for (let i = 0; i < 2; i++) {
        ctx.globalAlpha = base * p.glow * (0.2 - i * 0.08);
        ctx.lineWidth = 2 * (ol + 2 + i * 3.5);
        traceBody(ctx, rig);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = base;
    // Outline: only the part outside the sheet, body and arms together.
    ctx.save();
    ctx.beginPath();
    ctx.rect(-BIG, -BIG, BIG * 2, BIG * 2);
    traceClosedSpline(ctx, rig.pts, BODY_N);
    ctx.clip('evenodd');
    ctx.strokeStyle = pal.outline;
    ctx.lineWidth = ol * 2;
    traceBody(ctx, rig);
    ctx.stroke();
    const aw = rig.armW + ol * 2;
    limbStroke(ctx, rig.shLx, rig.shLy, rig.enLx, rig.enLy, aw, pal.outline);
    limbStroke(ctx, rig.shRx, rig.shRy, rig.enRx, rig.enRy, aw, pal.outline);
    ctx.restore();

    // Sheet fill: one translucent layer, then extra layers clipped above the hem so it thickens upwards.
    ctx.fillStyle = pal.body;
    if (pixel) {
      ctx.globalAlpha = base;
      traceBody(ctx, rig);
      ctx.fill();
    } else {
      ctx.globalAlpha = base * 0.72;
      traceBody(ctx, rig);
      ctx.fill();
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(-BIG, -BIG, BIG * 2, rig.hemY - (i === 0 ? 3 : i === 1 ? 9 : 16) + BIG);
        ctx.clip();
        ctx.globalAlpha = base * (i === 2 ? 0.5 : 0.4);
        traceBody(ctx, rig);
        ctx.fill();
        ctx.restore();
      }
    }
    if (p.flare > 0.02) {
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = base * p.flare * 0.6;
      traceBody(ctx, rig);
      ctx.fill();
    }
    if (p.dim > 0.02) {
      ctx.fillStyle = pal.shade;
      ctx.globalAlpha = base * p.dim * 0.7;
      traceBody(ctx, rig);
      ctx.fill();
    }
    if (fine) {
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = base * 0.4 * (1 - p.dim);
      ctx.beginPath();
      ctx.ellipse(rig.hlX, rig.hlY, 3.6 * rig.scaleX, 8 * rig.scaleY, rig.rot - 0.3, 0, TAU);
      ctx.fill();
    }

    // Arms: only the part outside the sheet (the fills are the same, so the join is seamless).
    ctx.save();
    ctx.beginPath();
    ctx.rect(-BIG, -BIG, BIG * 2, BIG * 2);
    traceClosedSpline(ctx, rig.pts, BODY_N);
    ctx.clip('evenodd');
    ctx.globalAlpha = pixel ? base : base * 0.94;
    const aww = pixel ? rig.armW + 1 : rig.armW;
    limbStroke(ctx, rig.shLx, rig.shLy, rig.enLx, rig.enLy, aww, pal.body);
    limbStroke(ctx, rig.shRx, rig.shRy, rig.enRx, rig.enRy, aww, pal.body);
    if (p.dim > 0.02) {
      ctx.globalAlpha = base * p.dim * 0.7;
      limbStroke(ctx, rig.shLx, rig.shLy, rig.enLx, rig.enLy, aww, pal.shade);
      limbStroke(ctx, rig.shRx, rig.shRy, rig.enRx, rig.enRy, aww, pal.shade);
    }
    ctx.restore();

    drawFace(ctx, rig, p, pal.eye, pal.cheek, base * rig.faceVisK, pixel, fine);

    if (o.accessory === 'heartPendant' && rig.faceVisK > 0.25) {
      ctx.globalAlpha = base;
      drawPendantBetween(ctx, rig.neckAx, rig.neckAy, rig.neckBx, rig.neckBy, rig.hangX, rig.hangY, 1.15 * Math.min(1.1, Math.max(0.45, rig.scaleY)), pal.outline, ol, ppu);
    }
  }
  ctx.restore();

  if (p.sparkle > 0.02) {
    ctx.save();
    ctx.lineJoin = 'round';
    for (let i = 0; i < SPARKLE_COUNT; i += pixel ? 2 : 1) {
      sparkleAt(rig, i, sparklePhase, spot);
      const s = spot.s * (pixel ? 1.5 : 1);
      ctx.globalAlpha = outer * p.sparkle * spot.a;
      star(ctx, spot.x, spot.y, s);
      ctx.strokeStyle = pal.outline;
      ctx.lineWidth = ol * 1.4;
      ctx.stroke();
      ctx.fillStyle = pal.spark;
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.globalAlpha = outer;
}

function drawFace(ctx: Ctx2D, rig: GhostRig, p: GhostPose, eye: string, cheek: string, alpha: number, pixel: boolean, fine: boolean): void {
  if (alpha < 0.01) return;
  const rx = rig.eyeRX;
  const ry = rig.eyeRY;
  const lw = pixel ? 3 : 2.3;
  const es = clamp01(p.eyeSmile);
  const lid = clamp01((0.25 - p.eyeOpen) / 0.15);
  const openA = (1 - es) * (1 - lid);
  const closedA = (1 - es) * lid;
  for (let side = 0; side < 2; side++) {
    const cx = side === 0 ? rig.eyeLx : rig.eyeRx;
    const cy = side === 0 ? rig.eyeLy : rig.eyeRy;
    const oy = ry * Math.max(0.12, p.eyeOpen);
    if (openA > 0.01) {
      ctx.globalAlpha = alpha * openA;
      ctx.fillStyle = eye;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, oy, rig.rot, 0, TAU);
      ctx.fill();
      if (!pixel && p.eyeOpen > 0.35) {
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = alpha * openA * 0.95;
        ctx.beginPath();
        ctx.arc(cx + rx * 0.3, cy - oy * 0.38, Math.max(1, rx * 0.3), 0, TAU);
        ctx.fill();
        if (fine) {
          ctx.beginPath();
          ctx.arc(cx - rx * 0.32, cy + oy * 0.35, Math.max(0.5, rx * 0.14), 0, TAU);
          ctx.fill();
        }
      }
    }
    ctx.strokeStyle = eye;
    ctx.lineWidth = lw;
    if (es > 0.01) {
      ctx.globalAlpha = alpha * es;
      ctx.beginPath();
      ctx.arc(cx, cy + ry * 0.3, rx * 0.9, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
    }
    if (closedA > 0.01) {
      ctx.globalAlpha = alpha * closedA;
      ctx.beginPath();
      ctx.arc(cx, cy - 0.5, rx * 0.9, Math.PI * 0.12, Math.PI * 0.88);
      ctx.stroke();
    }
    if (Math.abs(p.brow) > 0.08) {
      const s = side === 0 ? 1 : -1;
      const by = cy - ry - 2.5;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = pixel ? 2.6 : 2;
      ctx.beginPath();
      ctx.moveTo(cx + s * rx * 0.9, by + p.brow * 3.5);
      ctx.lineTo(cx - s * rx * 1.0, by - p.brow * 1.5);
      ctx.stroke();
    }
  }
  if (p.cheek > 0.04 && !pixel) {
    ctx.fillStyle = cheek;
    ctx.globalAlpha = alpha * p.cheek * 0.5;
    ctx.beginPath();
    ctx.ellipse(rig.eyeLx - 2, rig.eyeLy + 9 * rig.scaleY, 3.6, 2.2, 0, 0, TAU);
    ctx.ellipse(rig.eyeRx + 2, rig.eyeRy + 9 * rig.scaleY, 3.6, 2.2, 0, 0, TAU);
    ctx.fill();
  }
  // Mouth: a small smile, or an open oval.
  ctx.globalAlpha = alpha;
  const w = 3.6 * p.mouthW * Math.max(0.3, rig.scaleX);
  if (p.mouthOpen > 0.08) {
    ctx.fillStyle = eye;
    ctx.beginPath();
    ctx.ellipse(rig.mouthX, rig.mouthY + 1 + p.mouthOpen * 2, w * (0.55 + 0.25 * p.mouthOpen), (1.2 + 5 * p.mouthOpen) * Math.max(0.4, rig.scaleY), rig.rot, 0, TAU);
    ctx.fill();
  } else {
    ctx.strokeStyle = eye;
    ctx.lineWidth = pixel ? 2.8 : 2;
    ctx.beginPath();
    ctx.moveTo(rig.mouthX - w, rig.mouthY);
    ctx.quadraticCurveTo(rig.mouthX, rig.mouthY + p.mouthSmile * 4.4, rig.mouthX + w, rig.mouthY);
    ctx.stroke();
  }
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
