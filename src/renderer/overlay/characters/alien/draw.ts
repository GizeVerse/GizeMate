// The alien's painter: outline-then-fill in groups (stalks, legs, torso+head, arms), a face of big
// almond eyes with glints, glowing antenna tips, and the effect layers (scan line, light rings,
// pixel-dissolve teleport). Everything is read from the solved rig; nothing is allocated per frame.
import { drawBlobShadow, drawPendantBetween, fillShape, isFineDetail, isPixelMode, strokeOutline, TAU, traceClosedSpline, type Ctx2D } from '../../character/kit';
import type { CatAccessory } from '../../../../shared/cat';
import type { AlienPalette } from './palettes';
import type { Pose } from './pose';
import { HEAD_POINTS, TORSO_POINTS, type AlienRig } from './rig';

export const ARM_W = 2.8;
export const LEG_W = 3.4;
export const STALK_W = 2;
export const BULB_R = 3.4;
export const HAND_R = 2.6;
export const SCAN_TOP = -86;
export const SCAN_BOTTOM = -4;
export const SCAN_LEN = 46;
export const SCAN_FRONT = 26;
export const SPARKS = 14;

/** What the painter needs beyond the rig: effect clocks and the calm weight. */
export interface DrawState {
  pose: Pose;
  clock: number;
  calm: number;
  glowL: number;
  glowR: number;
}

export interface DrawOpts {
  outline: number;
  shadow: boolean;
  pixelsPerUnit: number;
  accessory?: CatAccessory | undefined;
}

/** Deterministic 0..1 hash for the dissolve sparks. */
export function sparkHash(i: number, k: number): number {
  const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

/** One spark of the teleport dissolve (grid-snapped square), written into out [x, y, size, alpha]. */
export function sparkAt(i: number, shim: number, dir: number, cx: number, out: Float64Array): void {
  const gx = (sparkHash(i, 1) - 0.5) * 34;
  const gy = -6 - sparkHash(i, 2) * 74;
  const rise = shim * (14 + 22 * sparkHash(i, 3));
  const size = 2.2;
  out[0] = Math.round((cx + gx) / size) * size;
  out[1] = Math.round((gy - rise * (dir >= 0 ? 1 : 1)) / size) * size;
  out[2] = size;
  out[3] = Math.min(1, shim * 2.2) * (0.45 + 0.55 * sparkHash(i, 4));
}

const spark = new Float64Array(4);

export function drawAlienShadow(ctx: Ctx2D, rig: AlienRig, pal: AlienPalette, pixel: boolean): void {
  const k = rig.shadowK;
  if (!(k > 0.01)) return;
  drawBlobShadow(ctx, rig.shadowX, 0.5, 20 * k + 1, 4 * k + 0.5, 0.3 * Math.min(1, k + 0.2));
  if (!pixel) {
    // A faint pool of the tips' light beneath the hovering body.
    ctx.save();
    ctx.globalAlpha *= 0.2 * Math.min(1, k);
    ctx.fillStyle = pal.glow;
    ctx.beginPath();
    ctx.ellipse(rig.shadowX, 0.5, 11 * k + 1, 2.2 * k + 0.3, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

function limbPath(ctx: Ctx2D, a: Float64Array): void {
  ctx.moveTo(a[0]!, a[1]!);
  ctx.lineTo(a[2]!, a[3]!);
  ctx.lineTo(a[4]!, a[5]!);
}

function arcAt(ctx: Ctx2D, x: number, y: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, TAU);
}

/** Head-local to final. */
const hx = (rig: AlienRig, u: number, v: number): number => rig.hcx + rig.exx * u + rig.eyx * v;
const hy = (rig: AlienRig, u: number, v: number): number => rig.hcy + rig.exy * u + rig.eyy * v;

function drawEye(ctx: Ctx2D, rig: AlienRig, pal: AlienPalette, pose: Pose, side: number, pixel: boolean, fine: boolean, ppu: number): void {
  const turn = Math.max(-1, Math.min(1, pose.turn));
  const sh = turn * 4;
  const wf = 1 - 0.22 * Math.max(0, -side * turn) + 0.08 * Math.max(0, side * turn);
  const size = pose.eyeSize;
  const u = side * 7.2 + sh;
  const v = 3.2;
  const ew = 5.4 * size * wf;
  const open = Math.max(0, pose.eye);
  const eh = 3.9 * size * open;
  const sl = pose.slant;
  const iu = u - side * ew * 0.95;
  const iv = v - 1 + sl * 3.5;
  const ou = u + side * ew;
  const ov = v + 1.9 - sl * 5;
  const mu = (iu + ou) / 2;
  const mv = (iv + ov) / 2;
  const sc = rig.scale;
  ctx.lineCap = 'round';
  if (pose.happy > 0.5 || open < 0.14) {
    // Closed: a happy arch (petted) or a sleepy downward curve.
    const arch = pose.happy > 0.5 ? -3.4 : 2.4;
    ctx.strokeStyle = pal.eye;
    ctx.lineWidth = (pose.happy > 0.5 ? 2.2 : 1.6) * (pixel ? 1.4 : 1);
    ctx.beginPath();
    ctx.moveTo(hx(rig, iu, iv), hy(rig, iu, iv));
    ctx.quadraticCurveTo(hx(rig, mu, mv + arch * 2), hy(rig, mu, mv + arch * 2), hx(rig, ou, ov), hy(rig, ou, ov));
    ctx.stroke();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(hx(rig, iu, iv), hy(rig, iu, iv));
  ctx.quadraticCurveTo(hx(rig, mu, mv - 1.8 * eh), hy(rig, mu, mv - 1.8 * eh), hx(rig, ou, ov), hy(rig, ou, ov));
  ctx.quadraticCurveTo(hx(rig, mu, mv + 1.5 * eh), hy(rig, mu, mv + 1.5 * eh), hx(rig, iu, iv), hy(rig, iu, iv));
  ctx.closePath();
  ctx.fillStyle = pal.eye;
  ctx.fill();
  if (open > 0.35 && (fine || ppu >= 0.45)) {
    ctx.fillStyle = pal.glint;
    ctx.beginPath();
    arcAt(ctx, hx(rig, mu - side * 1.2, mv - eh * 0.45), hy(rig, mu - side * 1.2, mv - eh * 0.45), 1.3 * sc * Math.min(1.2, size));
    ctx.fill();
    if (fine) {
      ctx.save();
      ctx.globalAlpha *= 0.8;
      ctx.beginPath();
      arcAt(ctx, hx(rig, mu + side * 1.8, mv + eh * 0.3), hy(rig, mu + side * 1.8, mv + eh * 0.3), 0.6 * sc);
      ctx.fill();
      ctx.restore();
    }
  }
}

function drawFace(ctx: Ctx2D, rig: AlienRig, pal: AlienPalette, pose: Pose, pixel: boolean, fine: boolean, ppu: number): void {
  drawEye(ctx, rig, pal, pose, -1, pixel, fine, ppu);
  drawEye(ctx, rig, pal, pose, 1, pixel, fine, ppu);
  const mxu = Math.max(-1, Math.min(1, pose.turn)) * 3;
  const mv = 10.6;
  if (pose.mouth > 0.08) {
    ctx.fillStyle = pal.mouth;
    ctx.beginPath();
    ctx.ellipse(hx(rig, mxu, mv + pose.mouth), hy(rig, mxu, mv + pose.mouth), 2.2 * rig.scale, (0.8 + pose.mouth * 3) * rig.scale, rig.headAng, 0, TAU);
    ctx.fill();
  } else if (!pixel || pose.smile < -0.2) {
    ctx.strokeStyle = pal.mouth;
    ctx.lineWidth = 1.1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hx(rig, mxu - 2.8, mv), hy(rig, mxu - 2.8, mv));
    const cv = mv + pose.smile * 5;
    ctx.quadraticCurveTo(hx(rig, mxu, cv), hy(rig, mxu, cv), hx(rig, mxu + 2.8, mv), hy(rig, mxu + 2.8, mv));
    ctx.stroke();
  }
}

function drawBulb(ctx: Ctx2D, pal: AlienPalette, x: number, y: number, glow: number, ol: number, pixel: boolean, fine: boolean, calm: number): void {
  const r = pixel ? BULB_R + 0.6 : BULB_R;
  if (fine && glow > 0.05) {
    ctx.save();
    ctx.globalAlpha *= 0.22 * glow * (1 - 0.3 * calm);
    ctx.fillStyle = pal.glow;
    ctx.beginPath();
    arcAt(ctx, x, y, r + 3.2 + 2.4 * glow);
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  arcAt(ctx, x, y, r);
  strokeOutline(ctx, pal.outline, ol);
  fillShape(ctx, pal.glowDim);
  ctx.save();
  ctx.globalAlpha *= pixel ? (glow > 0.4 ? 1 : 0) : 0.35 + 0.65 * glow;
  ctx.fillStyle = pal.glow;
  ctx.beginPath();
  arcAt(ctx, x, y, r);
  ctx.fill();
  ctx.restore();
  if (fine) {
    ctx.save();
    ctx.globalAlpha *= 0.7;
    ctx.fillStyle = pal.glint;
    ctx.beginPath();
    arcAt(ctx, x - 1, y - 1.1, 0.9);
    ctx.fill();
    ctx.restore();
  }
}

function drawEffects(ctx: Ctx2D, rig: AlienRig, pal: AlienPalette, st: DrawState, pixel: boolean): void {
  const pose = st.pose;
  if (pose.scan >= 0) {
    const cx = rig.hcx + SCAN_FRONT;
    const y = SCAN_BOTTOM + (SCAN_TOP - SCAN_BOTTOM) * pose.scan;
    ctx.save();
    const baseA = ctx.globalAlpha;
    ctx.strokeStyle = pal.glow;
    ctx.lineCap = 'round';
    if (!pixel) {
      ctx.globalAlpha = baseA * 0.14;
      ctx.fillStyle = pal.glow;
      ctx.fillRect(cx - SCAN_LEN / 2, y, SCAN_LEN, 7);
    }
    ctx.globalAlpha = baseA * 0.9;
    ctx.lineWidth = pixel ? 2.2 : 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - SCAN_LEN / 2, y);
    ctx.lineTo(cx + SCAN_LEN / 2, y);
    ctx.moveTo(cx - SCAN_LEN / 2, y - 3);
    ctx.lineTo(cx - SCAN_LEN / 2, y + 3);
    ctx.moveTo(cx + SCAN_LEN / 2, y - 3);
    ctx.lineTo(cx + SCAN_LEN / 2, y + 3);
    ctx.stroke();
    ctx.restore();
  }
  if (pose.beam >= 0 && pose.beam <= 1) {
    const a = rig.antenna[0]!;
    const b = rig.antenna[1]!;
    const mx = (a.tx + b.tx) / 2;
    const my = (a.ty + b.ty) / 2;
    const rings = st.calm > 0.5 ? 1 : 3;
    ctx.save();
    const baseA = ctx.globalAlpha;
    ctx.strokeStyle = pal.glow;
    ctx.lineCap = 'round';
    for (let k = 0; k < rings; k++) {
      const rp = pose.beam - k * 0.18;
      if (rp <= 0 || rp >= 1) continue;
      const fade = (1 - rp) * (1 - 0.5 * st.calm);
      if (pixel && fade < 0.35) continue;
      ctx.globalAlpha = baseA * (pixel ? 1 : 0.85 * fade);
      ctx.lineWidth = (pixel ? 2 : 0.8) + 1.4 * (1 - rp);
      ctx.beginPath();
      ctx.arc(mx, my, 5 + 34 * rp, -2.45, -0.69);
      ctx.stroke();
    }
    ctx.restore();
    if (!pixel) {
      const f = Math.sin(Math.PI * Math.min(1, pose.beam * 1.4));
      ctx.save();
      ctx.globalAlpha *= 0.3 * f * (1 - 0.6 * st.calm);
      ctx.fillStyle = pal.glow;
      ctx.beginPath();
      arcAt(ctx, a.tx, a.ty, 7 * f + 2);
      arcAt(ctx, b.tx, b.ty, 7 * f + 2);
      ctx.fill();
      ctx.restore();
    }
  }
  if (pose.shim > 0.002 && st.calm < 0.7) {
    const s = pose.shim;
    const cx = rig.hcx;
    ctx.save();
    const baseA = ctx.globalAlpha;
    ctx.fillStyle = pal.glow;
    for (let i = 0; i < SPARKS; i++) {
      sparkAt(i, s, pose.shimDir, cx, spark);
      if (spark[3]! < 0.05) continue;
      ctx.globalAlpha = baseA * spark[3]!;
      ctx.fillRect(spark[0]! - spark[2]! / 2, spark[1]! - spark[2]! / 2, spark[2]!, spark[2]!);
    }
    // Three scan bars sliding through the body.
    ctx.strokeStyle = pal.glow;
    ctx.lineWidth = pixel ? 2 : 1.4;
    ctx.lineCap = 'butt';
    for (let k = 0; k < 3; k++) {
      const ph = (st.clock * 1.3 + k / 3) % 1;
      const y = pose.shimDir >= 0 ? SCAN_BOTTOM + (SCAN_TOP - SCAN_BOTTOM) * ph : SCAN_TOP + (SCAN_BOTTOM - SCAN_TOP) * ph;
      ctx.globalAlpha = baseA * 0.65 * Math.min(1, s * 2);
      ctx.beginPath();
      ctx.moveTo(cx - 13 * (0.4 + 0.6 * s), y);
      ctx.lineTo(cx + 13 * (0.4 + 0.6 * s), y);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawArms(ctx: Ctx2D, rig: AlienRig, pal: AlienPalette, ol: number, armW: number): void {
  ctx.strokeStyle = pal.outline;
  ctx.lineWidth = armW + 2 * ol;
  ctx.beginPath();
  limbPath(ctx, rig.arm[0]!);
  limbPath(ctx, rig.arm[1]!);
  ctx.stroke();
  ctx.beginPath();
  for (let s = 0; s < 2; s++) arcAt(ctx, rig.arm[s]![4]!, rig.arm[s]![5]!, HAND_R * (armW / ARM_W));
  strokeOutline(ctx, pal.outline, ol);
  for (let s = 0; s < 2; s++) {
    const a = rig.arm[s]!;
    ctx.strokeStyle = s === 0 ? pal.shade : pal.body;
    ctx.fillStyle = s === 0 ? pal.shade : pal.body;
    ctx.lineWidth = armW;
    ctx.beginPath();
    limbPath(ctx, a);
    ctx.stroke();
    ctx.beginPath();
    arcAt(ctx, a[4]!, a[5]!, HAND_R * (armW / ARM_W));
    ctx.fill();
  }

}

export function drawAlien(ctx: Ctx2D, rig: AlienRig, st: DrawState, pal: AlienPalette, o: DrawOpts): void {
  const pose = st.pose;
  const ppu = o.pixelsPerUnit;
  const pixel = isPixelMode(ppu);
  const fine = isFineDetail(ppu);
  const ol = o.outline;
  const sc = rig.scale;
  const px = pixel ? 1.35 : 1;
  if (o.shadow) drawAlienShadow(ctx, rig, pal, pixel);
  ctx.save();
  ctx.globalAlpha *= Math.max(0, Math.min(1, pose.alpha));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Antenna stalks.
  const stalkW = STALK_W * px;
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass === 0 ? pal.outline : pal.body;
    ctx.lineWidth = pass === 0 ? stalkW + 2 * ol : stalkW;
    ctx.beginPath();
    for (let s = 0; s < 2; s++) {
      const a = rig.antenna[s]!;
      ctx.moveTo(a.bx, a.by);
      ctx.quadraticCurveTo(a.cx, a.cy, a.tx, a.ty);
    }
    ctx.stroke();
  }

  // Legs (back leg shaded).
  const legW = LEG_W * px * sc;
  ctx.strokeStyle = pal.outline;
  ctx.lineWidth = legW + 2 * ol;
  ctx.beginPath();
  limbPath(ctx, rig.leg[0]!);
  limbPath(ctx, rig.leg[1]!);
  ctx.stroke();
  ctx.beginPath();
  for (let s = 0; s < 2; s++) {
    const l = rig.leg[s]!;
    ctx.moveTo(l[4]! + 1.2 + 3.4 * px, l[5]! + 0.6);
    ctx.ellipse(l[4]! + 1.2, l[5]! + 0.6, 3.4 * px * sc, 2 * px * sc, 0, 0, TAU);
  }
  strokeOutline(ctx, pal.outline, ol);
  for (let s = 0; s < 2; s++) {
    const l = rig.leg[s]!;
    ctx.strokeStyle = s === 0 ? pal.shade : pal.body;
    ctx.fillStyle = s === 0 ? pal.shade : pal.body;
    ctx.lineWidth = legW;
    ctx.beginPath();
    limbPath(ctx, l);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(l[4]! + 1.2, l[5]! + 0.6, 3.4 * px * sc, 2 * px * sc, 0, 0, TAU);
    ctx.fill();
  }

  const armW = ARM_W * px * sc;
  const armsBehind = pose.armsBack > 0.5;
  if (armsBehind) drawArms(ctx, rig, pal, ol, armW);

  // Torso and head as one outlined group.
  ctx.beginPath();
  traceClosedSpline(ctx, rig.torso, TORSO_POINTS);
  traceClosedSpline(ctx, rig.head, HEAD_POINTS);
  strokeOutline(ctx, pal.outline, ol);
  fillShape(ctx, pal.body);
  if (fine) {
    // Soft belly patch and a small shine on the cranium.
    ctx.save();
    ctx.globalAlpha *= 0.55;
    ctx.fillStyle = pal.light;
    const t = rig.torso;
    const bx = t[0]! + (t[10]! - t[0]!) * 0.5;
    const by = t[1]! + (t[11]! - t[1]!) * 0.5;
    ctx.beginPath();
    ctx.ellipse(bx, by, 2.8 * sc, 5.2 * sc, Math.atan2(t[10]! - t[0]!, t[11]! - t[1]!) * -1, 0, TAU);
    ctx.fill();
    ctx.globalAlpha *= 0.8;
    ctx.beginPath();
    ctx.ellipse(hx(rig, -6.5, -8.5), hy(rig, -6.5, -8.5), 5 * sc, 2.4 * sc, rig.headAng - 0.55, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawFace(ctx, rig, pal, pose, pixel, fine, ppu);

  if (!armsBehind) drawArms(ctx, rig, pal, ol, armW);

  if (o.accessory === 'heartPendant') {
    drawPendantBetween(ctx, rig.collarAx, rig.collarAy, rig.collarBx, rig.collarBy, rig.hangX, rig.hangY, 0.7 * sc, pal.outline, ol, ppu);
  }

  // Antenna tips on top.
  const l = rig.antenna[0]!;
  const r = rig.antenna[1]!;
  drawBulb(ctx, pal, l.tx, l.ty, st.glowL, ol, pixel, fine, st.calm);
  drawBulb(ctx, pal, r.tx, r.ty, st.glowR, ol, pixel, fine, st.calm);

  ctx.restore();
  // Effects keep their own alpha (the teleport fades the body, not its sparks).
  ctx.save();
  drawEffects(ctx, rig, pal, st, pixel);
  ctx.restore();
}
