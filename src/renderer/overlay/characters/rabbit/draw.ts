// Rabbit painter: two-pass outline-then-fill in the shared language (kit/paint helpers). Everything is
// drawn from the solved rig inside the pose matrix; the ground shadow is drawn outside it. Allocation
// free: all geometry lives in the rig and the animator.
import type { CatAccessory } from '../../../../shared/cat';
import { clamp, clamp01, drawBlobShadow, drawPendantBetween, fillShape, isFineDetail, isPixelMode, strokeOutline, TAU, traceClosedSpline } from '../../character/kit';
import type { Ctx2D } from '../../character/types';
import type { RabbitAnimator } from './animator';
import type { RabbitPalette } from './palettes';
import type { RPose } from './pose';
import { EAR_SAMPLES, FOOT_RX, FOOT_RY, HEAD_N, HEAD_SHAPE, PAW_RX, PAW_RY, type LegGeom, type RabbitRig } from './rig';

const NO_DASH: number[] = [];
/** Ground clip line of the burrow (local y, down). */
const BURROW_LINE = 3;
const EYE = '#fff';
const MOUTH_IN = '#5a2a38';
const TONGUE = '#ec8aa0';
const TEETH = '#fffdf6';

export interface RabbitDrawOptions {
  outline: number;
  shadow: boolean;
  pixelsPerUnit: number;
  accessory?: CatAccessory | undefined;
}

/** Soft ground shadow (drawn in the view transform, outside the pose matrix). */
export function drawRabbitShadow(ctx: Ctx2D, rig: RabbitRig, p: RPose): void {
  const k = clamp(p.shadow, 0, 1.5);
  if (k <= 0.01) return;
  const m = rig.m;
  const cx = m[0]! * rig.bx + m[2]! * rig.by + m[4]!;
  const air = clamp01(-p.offY / 16);
  const w = shadowHalfWidth(rig, k, air) * Math.abs(m[0]!);
  const h = 4.2 * k * (1 - 0.3 * air) + 0.8;
  drawBlobShadow(ctx, cx, -0.6, w, h, 0.2 * Math.min(1, k) * (1 - 0.5 * air));
}

/** Half width of the shadow before the pose matrix's x scale (also what measure() reports). */
export function shadowHalfWidth(rig: RabbitRig, k: number, air: number): number {
  return (rig.brx * 1.2 + 4) * k * (1 - 0.35 * air) + 4;
}

export function drawRabbit(ctx: Ctx2D, an: RabbitAnimator, rig: RabbitRig, pal: RabbitPalette, o: RabbitDrawOptions): void {
  const p = an.pose;
  const ol = o.outline;
  const fine = isFineDetail(o.pixelsPerUnit);
  const pixel = isPixelMode(o.pixelsPerUnit);
  if (o.shadow) drawRabbitShadow(ctx, rig, p);

  ctx.save();
  // Burrowing: nothing below the ground line (a few units under the feet, so a standing foot is never cut) is
  // drawn, so the body sinks into the earth; and the body fades with its own alpha.
  if (p.burrow > 0.5) {
    ctx.beginPath();
    ctx.rect(-400, -400, 800, 400 + BURROW_LINE);
    ctx.clip();
  }
  ctx.globalAlpha *= clamp01(p.alpha);
  const m = rig.m;
  ctx.transform(m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(NO_DASH);

  // Far side first: far ear, far forepaw, far hind foot.
  drawEar(ctx, rig.earF, rig.earFIn, pal.shade, pal, ol, pal.earInner, fine || pixel);
  if (!rig.ffOver) drawFrontLeg(ctx, rig.ff, pal.shade, pal, ol);
  drawFoot(ctx, rig.hfX, rig.hfY, rig.hfA, pal.shade, pal, ol);

  drawMass(ctx, rig, pal, ol, fine);
  drawTail(ctx, rig, pal, ol);

  drawFoot(ctx, rig.hnX, rig.hnY, rig.hnA, pal.fur, pal, ol);
  if (!rig.fnOver) drawFrontLeg(ctx, rig.fn, pal.fur, pal, ol);

  const earFront = rig.earNFront;
  const nearFill = pal.spot ?? pal.fur;
  if (!earFront) drawEar(ctx, rig.earN, rig.earNIn, nearFill, pal, ol, pal.earInner, fine || pixel);
  drawHead(ctx, an, rig, p, pal, ol, fine, pixel);
  if (earFront) drawEar(ctx, rig.earN, rig.earNIn, nearFill, pal, ol, pal.earInner, fine || pixel);
  if (rig.ffOver) drawFrontLeg(ctx, rig.ff, pal.shade, pal, ol);
  if (rig.fnOver) drawFrontLeg(ctx, rig.fn, pal.fur, pal, ol);

  if (o.accessory === 'heartPendant') {
    drawPendantBetween(ctx, rig.collarAX, rig.collarAY, rig.collarBX, rig.collarBY, rig.hangX, rig.hangY, 0.85, pal.outline, ol, o.pixelsPerUnit);
  }
  ctx.restore();
}

function ellipse(ctx: Ctx2D, x: number, y: number, rx: number, ry: number, rot: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU);
}

function drawEar(ctx: Ctx2D, poly: Float64Array, inner: Float64Array, fill: string, pal: RabbitPalette, ol: number, innerFill: string, detail: boolean): void {
  ctx.beginPath();
  traceClosedSpline(ctx, poly, EAR_SAMPLES * 2);
  strokeOutline(ctx, pal.outline, ol);
  fillShape(ctx, fill);
  if (detail) {
    ctx.beginPath();
    traceClosedSpline(ctx, inner, EAR_SAMPLES * 2);
    fillShape(ctx, innerFill);
  }
}

function drawFrontLeg(ctx: Ctx2D, g: LegGeom, fill: string, pal: RabbitPalette, ol: number): void {
  const w = 7;
  ctx.strokeStyle = pal.outline;
  ctx.lineWidth = w + ol * 2;
  ctx.beginPath();
  ctx.moveTo(g.rx, g.ry);
  ctx.lineTo(g.kx, g.ky);
  ctx.lineTo(g.fx, g.fy);
  ctx.stroke();
  ellipse(ctx, g.fx, g.fy, PAW_RX, PAW_RY, 0);
  strokeOutline(ctx, pal.outline, ol);
  ctx.strokeStyle = fill;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(g.rx, g.ry);
  ctx.lineTo(g.kx, g.ky);
  ctx.lineTo(g.fx, g.fy);
  ctx.stroke();
  ellipse(ctx, g.fx, g.fy, PAW_RX, PAW_RY, 0);
  fillShape(ctx, fill);
}

function drawFoot(ctx: Ctx2D, x: number, y: number, ang: number, fill: string, pal: RabbitPalette, ol: number): void {
  ellipse(ctx, x, y, FOOT_RX, FOOT_RY, ang);
  strokeOutline(ctx, pal.outline, ol);
  fillShape(ctx, fill);
}

/** Body, haunch, thighs and neck as one merged silhouette: all outlined first, then all filled. */
function drawMass(ctx: Ctx2D, rig: RabbitRig, pal: RabbitPalette, ol: number, fine: boolean): void {
  const thigh = rig.hry * 0.9;
  const neck = 16;
  for (let pass = 0; pass < 2; pass++) {
    const out = pass === 0;
    const col = out ? pal.outline : pal.fur;
    const extra = out ? ol * 2 : 0;
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = out ? ol * 2 : 1;
    ellipse(ctx, rig.bx, rig.by, rig.brx, rig.bry, rig.bAng);
    if (out) ctx.stroke();
    else ctx.fill();
    ellipse(ctx, rig.hx, rig.hy, rig.hrx, rig.hry, 0);
    if (out) ctx.stroke();
    else ctx.fill();
    ctx.lineWidth = thigh + extra;
    ctx.beginPath();
    ctx.moveTo(rig.hx, rig.hy);
    ctx.lineTo(rig.hfX, rig.hfY - 1);
    ctx.moveTo(rig.hx, rig.hy);
    ctx.lineTo(rig.hnX, rig.hnY - 1);
    ctx.stroke();
    ctx.lineWidth = neck + extra;
    ctx.beginPath();
    ctx.moveTo(rig.nx0, rig.ny0);
    ctx.lineTo(rig.nx1, rig.ny1);
    ctx.stroke();
  }
  // Soft belly and chest, and the haunch's thigh line.
  ellipse(ctx, rig.bx + (rig.nx0 - rig.bx) * 0.25 + 3, rig.by + rig.bry * 0.38, rig.brx * 0.5, rig.bry * 0.3, rig.bAng);
  ctx.fillStyle = pal.belly;
  ctx.globalAlpha *= 0.85;
  ctx.fill();
  ctx.globalAlpha /= 0.85;
  if (pal.spot) {
    ctx.save();
    ellipse(ctx, rig.bx, rig.by, rig.brx, rig.bry, rig.bAng);
    ctx.clip();
    ellipse(ctx, rig.bx + rig.brx * 0.15, rig.by - rig.bry * 0.45, rig.brx * 0.5, rig.bry * 0.55, rig.bAng);
    fillShape(ctx, pal.spot);
    ctx.restore();
    ctx.save();
    ellipse(ctx, rig.hx, rig.hy, rig.hrx, rig.hry, 0);
    ctx.clip();
    ellipse(ctx, rig.hx - rig.hrx * 0.25, rig.hy + rig.hry * 0.35, rig.hrx * 0.55, rig.hry * 0.5, 0);
    fillShape(ctx, pal.spot);
    ctx.restore();
  }
  if (fine) {
    ctx.strokeStyle = pal.shade;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(rig.hx + 1, rig.hy, rig.hry * 0.66, -2.5, -0.55);
    ctx.stroke();
  }
}

function drawTail(ctx: Ctx2D, rig: RabbitRig, pal: RabbitPalette, ol: number): void {
  ellipse(ctx, rig.tailX, rig.tailY, rig.tailR, rig.tailR * 0.94, 0);
  strokeOutline(ctx, pal.outline, ol);
  fillShape(ctx, pal.tail);
}

function drawEye(ctx: Ctx2D, an: RabbitAnimator, p: RPose, pal: RabbitPalette, ol: number, x: number, y: number, r: number, fine: boolean, pixel: boolean): void {
  const open = clamp01(p.eyeOpen) * an.lids;
  if (open > 0.17) {
    const rr = pixel ? r * 1.2 : r;
    const ex = x + p.pupilX * 0.9;
    const ey = y + p.pupilY * 0.8;
    ellipse(ctx, ex, ey, rr, rr * 1.14 * open, 0);
    ctx.fillStyle = pal.eye;
    ctx.fill();
    if (!pixel) {
      ctx.fillStyle = EYE;
      ctx.beginPath();
      ctx.arc(ex - rr * 0.28 + p.pupilX * 0.3, ey - rr * 0.38 * open, Math.max(0.5, rr * 0.34), 0, TAU);
      ctx.fill();
      if (fine) {
        ctx.beginPath();
        ctx.arc(ex + rr * 0.32, ey + rr * 0.42 * open, Math.max(0.4, rr * 0.16), 0, TAU);
        ctx.fill();
      }
    }
    return;
  }
  // Closed: a content curve, or a joyful arch.
  ctx.strokeStyle = pal.eye;
  ctx.lineWidth = Math.max(1.3, ol * 0.95);
  ctx.beginPath();
  if (p.eyeHappy > 0.5) {
    ctx.moveTo(x - r, y + 0.9);
    ctx.quadraticCurveTo(x, y - r * 1.5, x + r, y + 0.9);
  } else {
    ctx.moveTo(x - r, y - 0.3);
    ctx.quadraticCurveTo(x, y + r * 1.1, x + r, y - 0.3);
  }
  ctx.stroke();
}

function drawHead(ctx: Ctx2D, an: RabbitAnimator, rig: RabbitRig, p: RPose, pal: RabbitPalette, ol: number, fine: boolean, pixel: boolean): void {
  ctx.save();
  ctx.translate(rig.headX, rig.headY);
  ctx.rotate(-p.headRot);
  const sh = clamp(p.turn, -1, 1) * 2.4;
  ctx.beginPath();
  traceClosedSpline(ctx, HEAD_SHAPE, HEAD_N);
  strokeOutline(ctx, pal.outline, ol);
  fillShape(ctx, pal.fur);
  if (pal.spot) {
    ctx.save();
    ctx.beginPath();
    traceClosedSpline(ctx, HEAD_SHAPE, HEAD_N);
    ctx.clip();
    ellipse(ctx, 3 + sh, -3.5, 6.6, 6.3, 0);
    fillShape(ctx, pal.spot);
    ctx.restore();
  }
  // Muzzle.
  ellipse(ctx, 9.8 + sh * 0.6, 3.9, 6, 4.6, 0);
  ctx.fillStyle = pal.belly;
  ctx.fill();
  if (fine && p.blush > 0.02) {
    ctx.globalAlpha *= clamp01(p.blush) * 0.7;
    ellipse(ctx, 2.2 + sh * 0.6, 5.9, 3.8, 2.4, 0);
    ctx.fillStyle = pal.blush;
    ctx.fill();
    ctx.globalAlpha /= clamp01(p.blush) * 0.7;
  }
  // Eyes: the far eye shrinks and disappears as the face turns away.
  if (rig.eyeFVis > 0.05) drawEye(ctx, an, p, pal, ol, 11.4 + sh * 1.2, -4.5, 2.25 * (0.55 + 0.45 * rig.eyeFVis), fine, pixel);
  drawEye(ctx, an, p, pal, ol, 3.6 + sh, -3.1, 3.1, fine, pixel);

  // Nose (twitching) and mouth.
  const tw = an.noseWave;
  const nx = 15.2 + sh * 0.5 + tw * 0.35;
  const ny = -1.3 + tw * 0.9;
  const ns = 1 + tw * 0.1;
  ellipse(ctx, nx, ny, 2.5 * ns, 1.9 * ns, 0);
  strokeOutline(ctx, pal.outline, Math.min(ol, 1.1));
  fillShape(ctx, pal.nose);
  const mouth = clamp01(p.mouth);
  const mx = nx - 0.6;
  if (mouth > 0.06) {
    const my = 6.3;
    ellipse(ctx, mx - 2.4, my + mouth * 1.8, 3.1, 0.7 + mouth * 4.6, 0.25);
    ctx.fillStyle = MOUTH_IN;
    ctx.fill();
    if (mouth > 0.45) {
      ellipse(ctx, mx - 2.6, my + mouth * 3.6, 2.1, 1.1 + mouth * 1.2, 0.25);
      ctx.fillStyle = TONGUE;
      ctx.fill();
    }
    if (fine && mouth > 0.15) {
      ctx.fillStyle = TEETH;
      ctx.fillRect(mx - 2.6, my - 0.5, 2.4, 1.6 + mouth);
    }
  } else {
    ctx.strokeStyle = pal.outline;
    ctx.lineWidth = Math.max(1, ol * 0.75);
    ctx.beginPath();
    ctx.moveTo(mx, ny + 2);
    ctx.lineTo(mx, ny + 3.9);
    ctx.quadraticCurveTo(mx - 0.4, ny + 5.6, mx - 3, ny + 5.3);
    ctx.moveTo(mx, ny + 3.9);
    ctx.quadraticCurveTo(mx + 0.4, ny + 5.5, mx + 1.7, ny + 4.9);
    ctx.stroke();
  }
  if (fine) {
    // Whiskers: three fine lines that sway with the twitch.
    ctx.strokeStyle = pal.outline;
    ctx.globalAlpha *= 0.55;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = -0.22 + i * 0.26 + p.whisker * 0.5 + an.whiskWave;
      ctx.moveTo(11.8 + sh * 0.5, 3.6);
      ctx.lineTo(11.8 + sh * 0.5 + 13 * Math.cos(a), 3.6 + 13 * Math.sin(a));
    }
    ctx.stroke();
    ctx.globalAlpha /= 0.55;
  }
  ctx.restore();
}
